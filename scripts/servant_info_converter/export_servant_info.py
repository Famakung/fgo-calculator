"""Batch static exporter generating public/servant_info/<id>.json files.

Consumes already-downloaded nice_servant_lore_lang_en.json (and optionally
nice_skill_lang_en.json) purely in memory with zero per-servant HTTP calls.
"""

import argparse
import json
import os
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlparse

from .servant_formatter import build_formatted_servant
from .utils import find_transform_svt_id

_FORBIDDEN_KEYS = {"convertedText", "charaGraphs", "faceUrl", "borderedFaceUrl"}


def _sanitize_no_forbidden(obj):
    """Defense-in-depth strip of forbidden keys/URLs from nested dict/list structures."""
    if isinstance(obj, dict):
        return {
            k: _sanitize_no_forbidden(v)
            for k, v in obj.items()
            if k not in _FORBIDDEN_KEYS
        }
    if isinstance(obj, list):
        return [_sanitize_no_forbidden(item) for item in obj]
    return obj


def build_svt_by_id(nice_servants: Iterable[dict]) -> Dict[int, dict]:
    """Index all servant objects (including transform partners with collectionNo=0) by ID."""
    svt_by_id: Dict[int, dict] = {}
    for svt in nice_servants or []:
        sid = svt.get("id")
        if sid is not None:
            svt_by_id[sid] = svt
    return svt_by_id


def build_skill_by_id(
    nice_servants: Iterable[dict],
    nice_skills: Optional[Iterable[dict]] = None,
) -> Dict[int, dict]:
    """Build in-memory skill lookup dict from servant-embedded skills and optional bulk skills."""
    skill_by_id: Dict[int, dict] = {}
    for svt in nice_servants or []:
        for group_key in ("skills", "classPassive", "appendPassive"):
            for sk in svt.get(group_key, []) or []:
                sk_id = sk.get("id")
                if sk_id is not None:
                    skill_by_id[sk_id] = sk
    for sk in nice_skills or []:
        sk_id = sk.get("id")
        if sk_id is not None:
            skill_by_id[sk_id] = sk
    return skill_by_id


_NO_SAINT_GRAPH_FORM_IDS = {600710, 1002100, 2501500}  # Transform partner CharaGraphs that 404 on Atlas CDN


def _sg_sorted_keys(d: dict) -> List[str]:
    return sorted(d, key=lambda k: (0, int(k)) if str(k).lstrip("-").isdigit() else (1, 0))


def _sg_file(url: str) -> str:
    base = os.path.basename(urlparse(url).path)
    return os.path.splitext(base)[0] + ".webp"


def _bordered_face_url(url: str) -> str:
    if isinstance(url, str) and url.endswith(".png") and not url.endswith("_bordered.png"):
        return url[:-4] + "_bordered.png"
    return url


_MASH_ID = 800100
_MASH_SKIP_KEYS = {"800151", "800200"}  # duplicate Ortinax costume / NPC art
_ASC_FACE = {"1": "000.webp", "2": "001.webp", "3": "002.webp", "4": "003.webp"}
_ASC_LIMIT_KEYS = {"1": ("0",), "2": ("1", "2"), "3": ("3",), "4": ("4",)}
_ASC_KEYWORDS = (
    (("First Ascension", "1st Ascension", "第一再臨"), "1"),
    (("Second Ascension", "2nd Ascension", "第二再臨"), "2"),
    (("Third Ascension", "3rd Ascension", "第三再臨"), "3"),
)


def _costume_id(k, info: dict) -> int:
    cid = info.get("id")
    return cid if isinstance(cid, int) else int(k) % 100


def _mash_form(cid: int) -> int:
    if cid in (12, 13, 18):
        return 1
    if cid in (17, 19, 20):
        return 2
    return 0


def _stage_from_label(info: dict) -> Optional[str]:
    text = f"{info.get('shortName', '')} {info.get('name', '')}"
    for words, stage in _ASC_KEYWORDS:
        if any(w in text for w in words):
            return stage
    return None


def _item_conds(item: dict) -> Tuple[List[dict], List[dict]]:
    direct = item.get("releaseConditions") or []
    all_c = list(direct)
    for sv in item.get("skillSvts") or []:
        all_c.extend(sv.get("releaseConditions") or [])
    return direct, all_c


def _stage_from_skills(svt: dict, cid: int) -> Optional[str]:
    """Resolve costume -> ascension stage from skill/NP releaseConditions."""
    for group in ("skills", "noblePhantasms"):
        items = svt.get(group) or []
        for it in items:
            direct_conds, all_conds = _item_conds(it)
            if not any(c.get("condType") == "equipWithTargetCostume" and c.get("condNum") == cid for c in all_conds):
                continue
            for c in all_conds:
                cn = c.get("condNum")
                if c.get("condType") in ("svtLimit", "equipWithTargetCostume") and cn != cid and isinstance(cn, int) and 1 <= cn <= 4:
                    return str(cn)
            num = it.get("num")
            if num is not None:
                for sib in items:
                    if sib is it or sib.get("num") != num:
                        continue
                    _, sib_conds = _item_conds(sib)
                    for c in sib_conds:
                        cn = c.get("condNum")
                        if c.get("condType") == "svtLimit" and isinstance(cn, int) and 1 <= cn <= 4:
                            return str(cn)
            if any(c.get("condType") == "equipWithTargetCostume" and c.get("condNum") == cid for c in direct_conds):
                lim = it.get("condLimitCount")
                if isinstance(lim, int) and 1 <= lim <= 4:
                    return str(lim)
    return None


def _overwrite_name(svt: dict, field: str, kind: str, k) -> Optional[str]:
    maps = (svt.get("ascensionAdd") or {}).get(field) or {}
    if kind == "costume":
        m = maps.get("costume") or {}
        return m.get(str(k))
    m = maps.get("ascension") or {}
    for lk in _ASC_LIMIT_KEYS.get(str(k), (str(k),)):
        if lk in m:
            return m[lk]
    return None


_ASC_LABELS = {
    "1": "1st Ascension",
    "2": "2nd Ascension",
    "3": "3rd Ascension",
    "4": "Final Ascension",
}


def _asc_label(k) -> str:
    return _ASC_LABELS.get(str(k), f"Stage {k}")


def extract_saint_graphs(
    svt: dict,
    svt_by_id: Optional[Dict[int, dict]] = None,
    *,
    include_faces: bool = False,
):
    """Return (saintGraphs entries, {webp filename: source url}), or 4-tuple with face maps when include_faces=True."""
    entries: List[dict] = []
    url_by_filename: Dict[str, str] = {}
    face_urls: Dict[str, str] = {}
    partner_faces: Dict[str, str] = {}
    svt_id = svt.get("id")
    is_mash = svt_id == _MASH_ID

    def add(key, label, url, kind, extra=None):
        if not isinstance(url, str) or not url:
            return
        fname = _sg_file(url)
        if fname in url_by_filename:
            return
        url_by_filename[fname] = url
        entry = {"key": str(key), "label": label, "file": fname, "kind": kind}
        entry.update(extra or {})
        entries.append(entry)

    def names(extra, kind, k):
        name = _overwrite_name(svt, "overWriteServantName", kind, k)
        if name and name != svt.get("name"):
            extra["name"] = name
            orig = _overwrite_name(svt, "originalOverWriteServantName", kind, k)
            if orig and orig != svt.get("originalName"):
                extra["originalName"] = orig

    extra_assets = svt.get("extraAssets") or {}
    faces = extra_assets.get("faces") or {}
    asc_faces = faces.get("ascension") or {}
    cos_faces = faces.get("costume") or {}

    graph = extra_assets.get("charaGraph") or {}
    asc = graph.get("ascension") or {}
    for k in _sg_sorted_keys(asc):
        extra = {"form": 0, "ascensionStage": str(k)}
        names(extra, "ascension", k)
        face_url = asc_faces.get(str(k))
        if isinstance(face_url, str) and face_url and str(k) in _ASC_FACE:
            rel = f"{svt_id}/{_ASC_FACE[str(k)]}"
            face_urls[rel] = _bordered_face_url(face_url)
            extra["face"] = rel
        add(k, _asc_label(k), asc[k], "ascension", extra)
    costumes = (svt.get("profile") or {}).get("costume") or {}
    cos = graph.get("costume") or {}
    cos_keys = [k for k in _sg_sorted_keys(cos) if not (is_mash and str(k) in _MASH_SKIP_KEYS)]
    for k in cos_keys:
        info = costumes.get(str(k)) or {}
        cid = _costume_id(k, info)
        extra = {"form": _mash_form(cid) if is_mash else 0}
        stage = _stage_from_skills(svt, cid) or _stage_from_label(info)
        if stage:
            extra["ascensionStage"] = stage
        face_url = cos_faces.get(str(k))
        if isinstance(face_url, str) and face_url:
            rel = f"{svt_id}/c_{k}.webp"
            face_urls[rel] = _bordered_face_url(face_url)
            extra["face"] = rel
        names(extra, "costume", cid)
        add(k, info.get("shortName") or info.get("name") or f"Costume {k}", cos[k], "costume", extra)

    partner_id = find_transform_svt_id(svt)
    if svt_by_id and partner_id and svt_id not in _NO_SAINT_GRAPH_FORM_IDS:
        partner = svt_by_id.get(partner_id)
        if partner:
            partner_assets = partner.get("extraAssets") or {}
            partner_faces_assets = partner_assets.get("faces") or {}
            partner_asc_faces = partner_faces_assets.get("ascension") or {}
            if partner_id not in _NO_SAINT_GRAPH_FORM_IDS:
                partner_name = partner.get("name")
                partner_orig = partner.get("originalName", "")
                partner_graph = partner_assets.get("charaGraph") or {}
                passets = partner_graph.get("ascension") or {}
                for k in _sg_sorted_keys(passets):
                    extra = {"form": 1, "name": partner_name, "originalName": partner_orig}
                    face_url = partner_asc_faces.get(str(k))
                    if isinstance(face_url, str) and face_url and str(k) in _ASC_FACE:
                        rel = f"{partner_id}/{_ASC_FACE[str(k)]}"
                        face_urls[rel] = _bordered_face_url(face_url)
                        extra["face"] = rel
                    add(k, _asc_label(k), passets[k], "form", extra)
                partner_costumes_cg = partner_graph.get("costume") or {}
                partner_costumes_meta = (partner.get("profile") or {}).get("costume") or {}
                partner_costume_faces = partner_faces_assets.get("costume") or {}
                for k in _sg_sorted_keys(partner_costumes_cg):
                    info = partner_costumes_meta.get(str(k)) or {}
                    extra = {"form": 1}
                    if partner_name:
                        extra["name"] = partner_name
                    if partner_orig:
                        extra["originalName"] = partner_orig
                    face_url = partner_costume_faces.get(str(k))
                    if isinstance(face_url, str) and face_url:
                        rel = f"{partner_id}/c_{k}.webp"
                        face_urls[rel] = _bordered_face_url(face_url)
                        extra["face"] = rel
                    label = info.get("shortName") or info.get("name") or f"Costume {k}"
                    add(k, label, partner_costumes_cg[k], "costume", extra)
            else:
                for k in _sg_sorted_keys(partner_asc_faces):
                    face_url = partner_asc_faces.get(str(k))
                    if isinstance(face_url, str) and face_url and str(k) in _ASC_FACE:
                        rel = f"{partner_id}/{_ASC_FACE[str(k)]}"
                        face_urls[rel] = _bordered_face_url(face_url)
                        partner_faces[str(k)] = rel

    if include_faces:
        return entries, url_by_filename, face_urls, partner_faces
    return entries, url_by_filename


def build_servant_info_payload(
    data: dict,
    svt_by_id: Optional[Dict[int, dict]] = None,
    skill_by_id: Optional[Dict[int, dict]] = None,
    name_overrides: Optional[Dict[str, str]] = None,
) -> dict:
    """Build the static per-servant JSON payload without external URLs or raw markdown."""
    svt_id = data["id"]
    cno = data.get("collectionNo", 0)
    overrides = name_overrides or {}
    name = (
        overrides.get(str(svt_id))
        or overrides.get(str(cno))
        or data.get("name", "Unknown")
    )

    formatted_data = build_formatted_servant(
        data,
        svt_by_id=svt_by_id,
        skill_by_id=skill_by_id,
    )
    if formatted_data.get("profile"):
        formatted_data["profile"]["name"] = name

    saint_graphs, _, _, partner_faces = extract_saint_graphs(
        data, svt_by_id, include_faces=True
    )
    if (
        partner_faces
        and isinstance(formatted_data.get("formConfig"), dict)
        and "1" in formatted_data["formConfig"]
    ):
        formatted_data["formConfig"]["1"]["faces"] = partner_faces

    payload = {
        "id": svt_id,
        "collectionNo": cno,
        "name": name,
        "originalName": data.get("originalName", ""),
        "className": str(data.get("className", "unknown")).capitalize(),
        "rarity": data.get("rarity", 0),
        "cost": data.get("cost", 0),
        "hpBase": data.get("hpBase"),
        "hpMax": data.get("hpMax"),
        "atkBase": data.get("atkBase"),
        "atkMax": data.get("atkMax"),
        "formatted": formatted_data,
        "saintGraphs": saint_graphs,
    }
    return _sanitize_no_forbidden(payload)


def is_playable_servant(svt: dict) -> bool:
    """Match the playable servant filter used by sync_atlas_data.py."""
    return (
        svt.get("type") in ("normal", "heroine")
        and isinstance(svt.get("collectionNo"), int)
        and svt["collectionNo"] > 0
    )


def collect_missing_inner_skill_ids(
    nice_servants: List[dict],
    svt_by_id: Optional[Dict[int, dict]] = None,
    skill_by_id: Optional[Dict] = None,
    target_ids: Optional[Iterable[str | int]] = None,
) -> Set[str]:
    """Dry-scan playable servants to discover inner skill IDs absent from skill_by_id."""
    if svt_by_id is None:
        svt_by_id = build_svt_by_id(nice_servants)
    base_skills = skill_by_id if skill_by_id is not None else build_skill_by_id(nice_servants)
    missing: Set[str] = set()

    class _TrackingSkills(dict):
        def get(self, key, default=None):
            if key in self:
                return self[key]
            skey = str(key)
            if skey in self:
                return self[skey]
            if skey.isdigit() and int(skey) in self:
                return self[int(skey)]
            missing.add(skey)
            return default

    tracked = _TrackingSkills(base_skills)
    target_set: Optional[Set[str]] = (
        {str(tid) for tid in target_ids} if target_ids is not None else None
    )

    for svt in nice_servants:
        if not is_playable_servant(svt):
            continue
        if target_set is not None and str(svt["id"]) not in target_set:
            continue
        try:
            build_formatted_servant(svt, svt_by_id=svt_by_id, skill_by_id=tracked)
        except Exception:
            pass

    return missing


def export_all_servant_info(
    nice_servants: List[dict],
    output_dir: str | Path,
    nice_skills: Optional[List[dict]] = None,
    skill_by_id: Optional[Dict[int, dict]] = None,
    target_ids: Optional[Iterable[str | int]] = None,
    name_overrides: Optional[Dict[str, str]] = None,
    dry_run: bool = False,
) -> dict:
    """Export per-servant formatted JSON files into output_dir/<id>.json."""
    svt_by_id = build_svt_by_id(nice_servants)
    if skill_by_id is None:
        skill_by_id = build_skill_by_id(nice_servants, nice_skills=nice_skills)

    target_set: Optional[Set[str]] = (
        {str(tid) for tid in target_ids} if target_ids is not None else None
    )

    out_path = Path(output_dir)
    if not dry_run:
        out_path.mkdir(parents=True, exist_ok=True)

    exported = 0
    exported_ids: List[str] = []
    errors: List[str] = []
    saint_graph_urls: Dict[str, str] = {}
    face_urls: Dict[str, str] = {}

    for svt in nice_servants:
        if not is_playable_servant(svt):
            continue
        svt_id_str = str(svt["id"])
        if target_set is not None and svt_id_str not in target_set:
            continue

        try:
            payload = build_servant_info_payload(
                svt,
                svt_by_id=svt_by_id,
                skill_by_id=skill_by_id,
                name_overrides=name_overrides,
            )
            _, sg_urls, svt_face_urls, _ = extract_saint_graphs(
                svt, svt_by_id, include_faces=True
            )
            saint_graph_urls.update(sg_urls)
            face_urls.update(svt_face_urls)
            if not dry_run:
                dest = out_path / f"{svt_id_str}.json"
                serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                dest.write_text(serialized, encoding="utf-8")
            exported += 1
            exported_ids.append(svt_id_str)
        except Exception as exc:
            errors.append(f"Servant {svt_id_str} (No.{svt.get('collectionNo')}): {exc}")

    return {
        "exported": exported,
        "ids": exported_ids,
        "errors": errors,
        "saint_graph_urls": saint_graph_urls,
        "face_urls": face_urls,
        "output_dir": str(out_path),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Export static per-servant info JSON files from cached Atlas exports."
    )
    parser.add_argument(
        "--nice-servants",
        required=True,
        help="Path to nice_servant_lore_lang_en.json",
    )
    parser.add_argument(
        "--nice-skills",
        default=None,
        help="Optional path to nice_skill_lang_en.json",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join("public", "servant_info"),
        help="Destination directory for <id>.json files",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not write output files")
    args = parser.parse_args()

    with open(args.nice_servants, "r", encoding="utf-8") as f:
        nice_servants = json.load(f)

    nice_skills = None
    if args.nice_skills and os.path.exists(args.nice_skills):
        with open(args.nice_skills, "r", encoding="utf-8") as f:
            nice_skills = json.load(f)

    result = export_all_servant_info(
        nice_servants,
        output_dir=args.output_dir,
        nice_skills=nice_skills,
        dry_run=args.dry_run,
    )
    print(f"Exported {result['exported']} servant info file(s) to {result['output_dir']}.")
    if result["errors"]:
        for err in result["errors"]:
            print(f"  [ERROR] {err}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
