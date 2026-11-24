#!/usr/bin/env python3
"""Token-minimal local query helper for Atlas raw skill/NP effects and formatted output."""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ATLAS_SVT = ROOT / ".cache/atlas/nice_servant_lore_lang_en.json"
ATLAS_INNER = ROOT / ".cache/atlas/inner_skills.json"
FMT_DIR = ROOT / "public/servant_info"
DB_PATH = ROOT / ".cache/atlas/effects.db"
SCHEMA_VER = "1"

KIND_MAP = {
    "skill": ("skills",),
    "np": ("noblePhantasms",),
    "passive": ("classPassive",),
    "append": ("appendPassive",),
    "all": ("skills", "noblePhantasms", "classPassive", "appendPassive"),
}

KEY_TO_KIND = {
    "skills": "skill",
    "noblePhantasms": "np",
    "classPassive": "passive",
    "appendPassive": "append",
}


def _trait_names(items):
    out = []
    for item in items or ():
        if isinstance(item, dict):
            out.append(item.get("name") or item.get("id"))
        else:
            out.append(item)
    return out


def _compact_svals(vals, full_svals=False):
    if not vals:
        return None
    if full_svals:
        return vals
    if len(vals) == 1 or vals[0] == vals[-1]:
        return [vals[0]]
    return [vals[0], vals[-1]]


def compact_func(fn, full_svals=False):
    out = {
        "funcId": fn.get("funcId"),
        "funcType": fn.get("funcType"),
        "target": fn.get("funcTargetType"),
        "team": fn.get("funcTargetTeam"),
    }
    ftvals = _trait_names(fn.get("functvals"))
    if ftvals:
        out["functvals"] = ftvals
    if fn.get("script"):
        out["script"] = fn["script"]

    buffs = []
    for b in fn.get("buffs") or ():
        bd = {
            "id": b.get("id"),
            "type": b.get("type"),
            "name": b.get("name"),
        }
        for key in ("tvals", "vals", "ckSelfIndv", "ckOpIndv"):
            tlist = _trait_names(b.get(key))
            if tlist:
                bd[key] = tlist
        if b.get("script"):
            bd["script"] = b["script"]
        buffs.append(bd)
    if buffs:
        out["buffs"] = buffs

    base_svals = _compact_svals(fn.get("svals"), full_svals=full_svals)
    if base_svals is not None:
        out["svals"] = base_svals
    for skey in ("svals2", "svals3", "svals4", "svals5"):
        compacted = _compact_svals(fn.get(skey), full_svals=full_svals)
        if compacted is not None and (full_svals or compacted != base_svals):
            out[skey] = compacted
    return out


def _compact_formatted_slots(svt_id, kind):
    fmt_path = FMT_DIR / f"{svt_id}.json"
    if not fmt_path.exists():
        return None
    data = json.loads(fmt_path.read_text(encoding="utf-8"))
    slots = (data.get("formatted") or {}).get("slots") or []
    wanted_type = None if kind == "all" else kind
    summary = []
    for slot in slots:
        stype = slot.get("type")
        if wanted_type and stype != wanted_type:
            continue
        variants = {}
        for tier, v in (slot.get("variantsByTier") or {}).items():
            ventry = {"title": v.get("cleanTitle") or v.get("rawTitle")}
            if v.get("effects"):
                ventry["effects"] = v["effects"]
            if v.get("forms"):
                ventry["forms"] = [
                    {
                        "label": f.get("label"),
                        "name": f.get("name"),
                        **({"effects": f["effects"]} if f.get("effects") else {}),
                    }
                    for f in v["forms"]
                ]
            variants[tier] = ventry
        if variants:
            summary.append({"slotKey": slot.get("slotKey"), "variants": variants})
    return summary


def _entry_matches(entry, skill_id, func_q, buff_q):
    if skill_id is not None and entry.get("id") != skill_id:
        return False
    funcs = entry.get("functions") or ()
    if func_q:
        if not any(func_q in (fn.get("funcType") or "").lower() for fn in funcs):
            return False
    if buff_q:
        matched_buff = False
        for fn in funcs:
            for b in fn.get("buffs") or ():
                if buff_q in (b.get("type") or "").lower() or buff_q in (b.get("name") or "").lower():
                    matched_buff = True
                    break
            if matched_buff:
                break
        if not matched_buff:
            return False
    return True


def _build_record(svt, kind, entry, full_svals=False):
    rec = {}
    if svt is not None:
        rec["svtId"] = svt.get("id")
        rec["cno"] = svt.get("collectionNo")
        rec["svtName"] = svt.get("name")
    rec["kind"] = kind
    rec["id"] = entry.get("id")
    if entry.get("num") is not None:
        rec["num"] = entry["num"]
    rec["name"] = entry.get("name")
    if entry.get("strengthStatus") is not None:
        rec["strengthStatus"] = entry["strengthStatus"]
    cd = entry.get("coolDown")
    if cd:
        if full_svals or not isinstance(cd, list):
            rec["coolDown"] = cd
        else:
            rec["coolDown"] = [cd[0]] if cd[0] == cd[-1] else [cd[0], cd[-1]]
    rec["functions"] = [compact_func(fn, full_svals=full_svals) for fn in (entry.get("functions") or ())]
    return rec


def _file_sig(path):
    if not path.exists():
        return ""
    st = path.stat()
    return f"{st.st_mtime_ns}:{st.st_size}"


def _fmt_dir_sig():
    if not FMT_DIR.exists():
        return ""
    count = 0
    max_mtime = 0
    with os.scandir(FMT_DIR) as it:
        for entry in it:
            name = entry.name
            if name.endswith(".json") and name[:-5].isdigit():
                count += 1
                mt = entry.stat().st_mtime_ns
                if mt > max_mtime:
                    max_mtime = mt
    return f"{count}:{max_mtime}" if count else ""


def _source_sigs():
    return {
        "schema_ver": SCHEMA_VER,
        "svt_sig": _file_sig(ATLAS_SVT),
        "inner_sig": _file_sig(ATLAS_INNER),
        "fmt_sig": _fmt_dir_sig(),
    }


def _func_types_str(entry):
    return " ".join((fn.get("funcType") or "").lower() for fn in (entry.get("functions") or ()))


def _buff_text_str(entry):
    parts = []
    for fn in entry.get("functions") or ():
        for b in fn.get("buffs") or ():
            parts.append((b.get("type") or "").lower())
            parts.append((b.get("name") or "").lower())
    return " ".join(parts)


def _ensure_db(force=False):
    sigs = _source_sigs()
    if not force and DB_PATH.exists():
        try:
            conn = sqlite3.connect(DB_PATH)
            meta = dict(conn.execute("SELECT k, v FROM meta").fetchall())
            if meta == sigs:
                return conn
            conn.close()
        except sqlite3.Error:
            pass

    if not ATLAS_SVT.exists():
        print("Missing .cache/atlas/nice_servant_lore_lang_en.json — run npm run data:sync", file=sys.stderr)
        return None

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix(".db.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
    conn.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE entries (
            svt_id INT,
            cno INT,
            svt_name TEXT,
            orig_name TEXT,
            name_lower TEXT,
            kind TEXT,
            entry_id INT,
            func_types TEXT,
            buff_text TEXT,
            payload TEXT
        );
        CREATE TABLE fmt_effects (
            svt_id INT,
            cno INT,
            svt_name TEXT,
            name_lower TEXT,
            slot TEXT,
            slot_type TEXT,
            tier TEXT,
            title TEXT,
            effect TEXT,
            effect_lower TEXT
        );
        """
    )

    servants = json.loads(ATLAS_SVT.read_text(encoding="utf-8"))
    entry_rows = []
    for svt in servants:
        sid = svt.get("id")
        cno = svt.get("collectionNo")
        sname = svt.get("name")
        oname = svt.get("originalName")
        nlower = f"{(sname or '').lower()}\n{(oname or '').lower()}"
        for gkey, kind in KEY_TO_KIND.items():
            for entry in svt.get(gkey) or ():
                rec = _build_record(svt, kind, entry, full_svals=False)
                entry_rows.append(
                    (
                        sid,
                        cno,
                        sname,
                        oname,
                        nlower,
                        kind,
                        entry.get("id"),
                        _func_types_str(entry),
                        _buff_text_str(entry),
                        json.dumps(rec, ensure_ascii=False, separators=(",", ":")),
                    )
                )

    if ATLAS_INNER.exists():
        inner = json.loads(ATLAS_INNER.read_text(encoding="utf-8"))
        if isinstance(inner, dict):
            for entry in inner.values():
                rec = _build_record(None, "inner_skill", entry, full_svals=False)
                entry_rows.append(
                    (
                        None,
                        None,
                        None,
                        None,
                        "",
                        "inner_skill",
                        entry.get("id"),
                        _func_types_str(entry),
                        _buff_text_str(entry),
                        json.dumps(rec, ensure_ascii=False, separators=(",", ":")),
                    )
                )

    conn.executemany("INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?)", entry_rows)

    fmt_rows = []
    if FMT_DIR.exists():
        for path in sorted(FMT_DIR.glob("*.json")):
            if not path.stem.isdigit():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            sid = data.get("id")
            cno = data.get("collectionNo")
            sname = data.get("name")
            oname = data.get("originalName")
            nlower = f"{(sname or '').lower()}\n{(oname or '').lower()}"
            for slot in (data.get("formatted") or {}).get("slots") or ():
                slot_key = slot.get("slotKey")
                slot_type = slot.get("type")
                for tier, v in (slot.get("variantsByTier") or {}).items():
                    vtitle = v.get("cleanTitle") or v.get("rawTitle")
                    for line in v.get("effects") or ():
                        fmt_rows.append(
                            (sid, cno, sname, nlower, slot_key, slot_type, tier, vtitle, line, line.lower())
                        )
                    for form in v.get("forms") or ():
                        ftitle = f"{vtitle}: {form.get('name') or form.get('label')}"
                        for line in form.get("effects") or ():
                            fmt_rows.append(
                                (sid, cno, sname, nlower, slot_key, slot_type, tier, ftitle, line, line.lower())
                            )

    conn.executemany("INSERT INTO fmt_effects VALUES (?,?,?,?,?,?,?,?,?,?)", fmt_rows)
    conn.executescript(
        """
        CREATE INDEX idx_entries_svt_kind ON entries(svt_id, kind);
        CREATE INDEX idx_entries_cno ON entries(cno);
        CREATE INDEX idx_entries_id ON entries(entry_id);
        CREATE INDEX idx_fmt_svt ON fmt_effects(svt_id);
        """
    )
    conn.executemany("INSERT INTO meta VALUES (?,?)", list(sigs.items()))
    conn.commit()
    conn.close()
    os.replace(tmp_path, DB_PATH)
    return sqlite3.connect(DB_PATH)


def _query_text_db(conn, text_q, svt_num, name_q, kind, limit):
    clauses = ["instr(effect_lower, ?) > 0"]
    params = [text_q]
    if svt_num is not None:
        clauses.append("(svt_id = ? OR cno = ?)")
        params.extend((svt_num, svt_num))
    if name_q is not None:
        clauses.append("instr(name_lower, ?) > 0")
        params.append(name_q)
    if kind != "all":
        clauses.append("slot_type = ?")
        params.append(kind)
    sql = (
        "SELECT svt_id, cno, svt_name, slot, tier, title, effect "
        f"FROM fmt_effects WHERE {' AND '.join(clauses)} LIMIT ?"
    )
    params.append(limit + 1)
    rows = conn.execute(sql, params).fetchall()
    truncated = len(rows) > limit
    for svt_id, cno, svt_name, slot, tier, title, effect in rows[:limit]:
        rec = {
            "svtId": svt_id,
            "cno": cno,
            "svtName": svt_name,
            "slot": slot,
            "tier": tier,
            "title": title,
            "effect": effect,
        }
        print(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
    if truncated:
        print(f"# truncated at {limit}", file=sys.stderr)
    return 0


def _query_entries_db(conn, svt_num, name_q, skill_id, func_q, buff_q, kind, attach_fmt, limit):
    clauses = []
    params = []
    if svt_num is not None:
        clauses.append("(svt_id = ? OR cno = ?)")
        params.extend((svt_num, svt_num))
    if name_q is not None:
        clauses.append("instr(name_lower, ?) > 0")
        params.append(name_q)
    if skill_id is not None:
        clauses.append("entry_id = ?")
        params.append(skill_id)
    if func_q is not None:
        clauses.append("instr(func_types, ?) > 0")
        params.append(func_q)
    if buff_q is not None:
        clauses.append("instr(buff_text, ?) > 0")
        params.append(buff_q)
    if kind != "all":
        clauses.append("kind = ?")
        params.append(kind)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT svt_id, payload FROM entries {where} LIMIT ?"
    params.append(limit + 1)
    rows = conn.execute(sql, params).fetchall()
    truncated = len(rows) > limit
    fmt_emitted_for = set()
    for svt_id, payload in rows[:limit]:
        if attach_fmt and svt_id is not None and svt_id not in fmt_emitted_for:
            rec = json.loads(payload)
            fmt_slots = _compact_formatted_slots(svt_id, kind)
            if fmt_slots is not None:
                rec["formattedSlots"] = fmt_slots
            fmt_emitted_for.add(svt_id)
            print(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
        else:
            print(payload)
    if truncated:
        print(f"# truncated at {limit}", file=sys.stderr)
    return 0


def _query_full_svals_json(svt_num, name_q, skill_id, func_q, buff_q, kind_arg, attach_fmt, limit):
    if not ATLAS_SVT.exists():
        print("Missing .cache/atlas/nice_servant_lore_lang_en.json — run npm run data:sync", file=sys.stderr)
        return 1

    servants = json.loads(ATLAS_SVT.read_text(encoding="utf-8"))
    group_keys = KIND_MAP[kind_arg]
    emitted = 0
    truncated = False
    fmt_emitted_for = set()

    for svt in servants:
        if svt_num is not None and svt.get("id") != svt_num and svt.get("collectionNo") != svt_num:
            continue
        if name_q is not None:
            sname = (svt.get("name") or "").lower()
            oname = (svt.get("originalName") or "").lower()
            if name_q not in sname and name_q not in oname:
                continue

        for gkey in group_keys:
            kind = KEY_TO_KIND[gkey]
            for entry in svt.get(gkey) or ():
                if not _entry_matches(entry, skill_id, func_q, buff_q):
                    continue
                if emitted >= limit:
                    truncated = True
                    break
                rec = _build_record(svt, kind, entry, full_svals=True)
                if attach_fmt and svt.get("id") not in fmt_emitted_for:
                    fmt_slots = _compact_formatted_slots(svt.get("id"), kind_arg)
                    if fmt_slots is not None:
                        rec["formattedSlots"] = fmt_slots
                    fmt_emitted_for.add(svt.get("id"))
                print(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
                emitted += 1
            if truncated:
                break
        if truncated:
            break

    if not truncated and skill_id is not None and ATLAS_INNER.exists():
        inner = json.loads(ATLAS_INNER.read_text(encoding="utf-8"))
        entry = inner.get(str(skill_id)) if isinstance(inner, dict) else None
        if entry and _entry_matches(entry, skill_id, func_q, buff_q):
            if emitted >= limit:
                truncated = True
            else:
                rec = _build_record(None, "inner_skill", entry, full_svals=True)
                print(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
                emitted += 1

    if truncated:
        print(f"# truncated at {limit}", file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Query local Atlas raw skill/NP effects with minimal token output."
    )
    parser.add_argument("--svt", help="Match servant id or collectionNo (exact numeric match)")
    parser.add_argument("--name", help="Case-insensitive substring match on servant name/originalName")
    parser.add_argument("--skill", type=int, help="Exact skill/NP id (also checks inner_skills.json)")
    parser.add_argument("--func", help="Case-insensitive substring match on funcType")
    parser.add_argument("--buff", help="Case-insensitive substring match on buffs[].type or buffs[].name")
    parser.add_argument(
        "--text",
        help="Case-insensitive substring search across formatted effects in public/servant_info/",
    )
    parser.add_argument(
        "--kind",
        choices=("all", "skill", "np", "passive", "append"),
        default="all",
        help="Skill/NP group to inspect",
    )
    parser.add_argument(
        "--fmt",
        action="store_true",
        help="Attach formatted slots summary from public/servant_info/<svtId>.json when --svt or --name matches",
    )
    parser.add_argument(
        "--full-svals",
        action="store_true",
        help="Include full svals list instead of [svals[0], svals[-1]]",
    )
    parser.add_argument("--rebuild", action="store_true", help="Force rebuild of .cache/atlas/effects.db")
    parser.add_argument("--limit", type=int, default=20, help="Max output records (default: 20)")
    args = parser.parse_args()

    if not any((args.svt, args.name, args.skill is not None, args.func, args.buff, args.text)):
        parser.error("at least one filter (--svt, --name, --skill, --func, --buff, --text) is required")

    svt_num = None
    if args.svt is not None:
        try:
            svt_num = int(args.svt)
        except ValueError:
            print(f"Invalid --svt value: {args.svt}", file=sys.stderr)
            return 2

    name_q = args.name.lower() if args.name else None
    func_q = args.func.lower() if args.func else None
    buff_q = args.buff.lower() if args.buff else None
    attach_fmt = args.fmt and (args.svt is not None or args.name is not None)

    if args.full_svals and not (args.text and args.skill is None and not func_q and not buff_q):
        return _query_full_svals_json(
            svt_num, name_q, args.skill, func_q, buff_q, args.kind, attach_fmt, args.limit
        )

    conn = _ensure_db(force=args.rebuild)
    if conn is None:
        return 1
    try:
        if args.text and args.skill is None and not func_q and not buff_q:
            return _query_text_db(conn, args.text.lower(), svt_num, name_q, args.kind, args.limit)
        return _query_entries_db(
            conn, svt_num, name_q, args.skill, func_q, buff_q, args.kind, attach_fmt, args.limit
        )
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
