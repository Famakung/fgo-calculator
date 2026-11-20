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


def extract_saint_graphs(svt: dict, svt_by_id: Optional[Dict[int, dict]] = None) -> Tuple[List[dict], Dict[str, str]]:
    """Return (saintGraphs entries, {webp filename: source url}), deduped by filename."""
    entries: List[dict] = []
    url_by_filename: Dict[str, str] = {}

    def add(key, label, url, kind):
        if not isinstance(url, str) or not url:
            return
        fname = _sg_file(url)
        if fname in url_by_filename:
            return
        url_by_filename[fname] = url
        entries.append({"key": str(key), "label": label, "file": fname, "kind": kind})

    graph = (svt.get("extraAssets") or {}).get("charaGraph") or {}
    asc = graph.get("ascension") or {}
    for k in _sg_sorted_keys(asc):
        add(k, f"Stage {k}", asc[k], "ascension")
    costumes = (svt.get("profile") or {}).get("costume") or {}
    cos = graph.get("costume") or {}
    for k in _sg_sorted_keys(cos):
        info = costumes.get(str(k)) or {}
        add(k, info.get("shortName") or info.get("name") or f"Costume {k}", cos[k], "costume")

    partner_id = find_transform_svt_id(svt)
    if svt_by_id and partner_id and partner_id not in _NO_SAINT_GRAPH_FORM_IDS and svt.get("id") not in _NO_SAINT_GRAPH_FORM_IDS:
        partner = svt_by_id.get(partner_id)
        if partner:
            passets = ((partner.get("extraAssets") or {}).get("charaGraph") or {}).get("ascension") or {}
            for k in _sg_sorted_keys(passets):
                add(k, f"{partner.get('name', 'Form')} Stage {k}", passets[k], "form")
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
        "saintGraphs": extract_saint_graphs(data, svt_by_id)[0],
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
            saint_graph_urls.update(extract_saint_graphs(svt, svt_by_id)[1])
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
