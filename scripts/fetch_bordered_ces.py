#!/usr/bin/env python3
"""
Fetch and convert Atlas Academy bordered Craft Essence (CE) face icons to WebP.
Source URL: https://static.atlasacademy.io/JP/Faces/f_{long_id}_bordered.png
Outputs:
  - public/craft_essences/{ce_id}.webp (142x155 WebP, lossless)

Dynamic: Resolves 8-digit face IDs directly from Atlas Academy data (extraAssets.faces.equip),
eliminating hardcoded ID mappings.
"""

import argparse
import gzip
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CE_DIR = os.path.join(BASE_DIR, "public", "craft_essences")
CE_DATA_JS = os.path.join(BASE_DIR, "src", "scripts", "data", "craft_essences.js")
DEFAULT_CACHE_DIR = os.path.join(BASE_DIR, ".cache", "atlas")
EXPORT_URL = "https://api.atlasacademy.io/export/JP/nice_equip_lang_en.json"


class CEFaceMap(dict):
    """Dict of Atlas equip ID -> face_id, carrying cno_to_id mapping for CLI compatibility."""

    def __init__(self, *args, cno_to_id=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.cno_to_id = cno_to_id or {}


def extract_face_id(equip: dict) -> str:
    """Extract 8-digit face icon ID from equip extraAssets."""
    faces = equip.get("extraAssets", {}).get("faces", {}).get("equip", {})
    if not faces:
        return ""
    face_url = list(faces.values())[0] if isinstance(faces, dict) else str(faces)
    match = re.search(r"f_(\d+)\.png", face_url)
    return match.group(1) if match else ""


def _migrate_single_ce(cid: int, ce_id: str, dry_run: bool) -> bool:
    target_file = os.path.join(CE_DIR, f"{ce_id}.webp")
    candidates = [f"{cid:04d}.webp", f"{cid}.webp"]
    migrated = False
    for cand in candidates:
        if cand == f"{ce_id}.webp":
            continue
        old_file = os.path.join(CE_DIR, cand)
        if os.path.isfile(old_file):
            if not dry_run:
                if not os.path.exists(target_file):
                    shutil.move(old_file, target_file)
                else:
                    os.remove(old_file)
            migrated = True
    return migrated


def _cleanup_legacy_ce_files(dry_run: bool):
    if dry_run or not os.path.isdir(CE_DIR):
        return
    for entry in os.listdir(CE_DIR):
        if entry.endswith(".webp") and entry[:-5].isdigit() and int(entry[:-5]) < 10000:
            try:
                os.remove(os.path.join(CE_DIR, entry))
            except OSError:
                pass


def migrate_ce_images(data: list, dry_run: bool = False):
    """One-time migration renaming existing public/craft_essences/{cno}.webp to {ce_id}.webp."""
    if not os.path.isdir(CE_DIR):
        return
    migrated = sum(
        1
        for ce in data
        if ce.get("collectionNo", 0) > 0 and ce.get("id") and _migrate_single_ce(ce["collectionNo"], ce["id"], dry_run)
    )
    _cleanup_legacy_ce_files(dry_run)
    if migrated > 0:
        print(f"Migrated {migrated} CE image(s) to Atlas IDs.")


def load_ce_face_map(cache_dir: str = DEFAULT_CACHE_DIR, force: bool = False, dry_run: bool = False) -> CEFaceMap:
    """Load or download nice_equip_lang_en.json and build an Atlas equip ID -> face_id map."""
    os.makedirs(cache_dir, exist_ok=True)
    cache_file = os.path.join(cache_dir, "nice_equip_lang_en.json")

    if not force and os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = None
    else:
        data = None

    if data is None:
        print("Fetching latest Craft Essence catalog from Atlas Academy...")
        req = urllib.request.Request(
            EXPORT_URL,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; FGOCalculatorDataSync/1.0)",
                "Accept-Encoding": "gzip",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw_bytes = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw_bytes = gzip.decompress(raw_bytes)
            data = json.loads(raw_bytes.decode("utf-8"))

        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    migrate_ce_images(data, dry_run=dry_run)

    face_map = {}
    cno_to_id = {}
    for ce in data:
        cid = ce.get("collectionNo", 0)
        ce_id = ce.get("id")
        if cid > 0 and ce_id:
            s_id = str(ce_id)
            cno_to_id[f"{cid:04d}"] = s_id
            cno_to_id[str(cid)] = s_id
            face_id = extract_face_id(ce)
            if face_id:
                face_map[s_id] = face_id

    return CEFaceMap(face_map, cno_to_id=cno_to_id)


def load_active_ce_ids() -> list:
    """Parse active CE IDs from src/scripts/data/craft_essences.js (including grouped options)."""
    if not os.path.exists(CE_DATA_JS):
        return []

    with open(CE_DATA_JS, "r", encoding="utf-8") as f:
        content = f.read()

    found_keys = re.findall(r'^\s*["\']?(\d{5,8})["\']?\s*:\s*\{', content, re.MULTILINE)
    opt_keys = re.findall(r'["\']?(\d{5,8})["\']?\s*:\s*\{\s*name:', content)
    return sorted(list(set(found_keys + opt_keys)))


def download_and_convert(item):
    ce_id, long_id, force, dry_run = item
    bordered_url = f"https://static.atlasacademy.io/JP/Faces/f_{long_id}_bordered.png"
    plain_url = f"https://static.atlasacademy.io/JP/Faces/f_{long_id}.png"

    dest_file = os.path.join(CE_DIR, f"{ce_id}.webp")

    if not force and os.path.exists(dest_file):
        return (ce_id, True, "EXISTS", bordered_url)

    if dry_run:
        return (ce_id, True, "DRY_RUN", bordered_url)

    urls_to_try = [bordered_url, plain_url]
    last_err = None

    for url in urls_to_try:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; FGOCalculatorDataSync/1.0)"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    img_data = resp.read()

                img = Image.open(io.BytesIO(img_data)).convert("RGBA")
                os.makedirs(CE_DIR, exist_ok=True)
                img.save(dest_file, "WEBP", lossless=True, method=6)

                return (ce_id, True, f"{img.size[0]}x{img.size[1]}", url)
            except Exception as e:
                last_err = e
                time.sleep(0.5 * (attempt + 1))

    return (ce_id, False, str(last_err), bordered_url)


def sync_ces(items_map=None, ids=None, workers=8, force=False, dry_run=False, cache_dir=DEFAULT_CACHE_DIR):
    """Sync CE icons from Atlas Academy, skipping existing files if force=False."""
    target_ids = None
    if items_map is None:
        face_map = load_ce_face_map(cache_dir=cache_dir, force=force, dry_run=dry_run)
        cno_to_id = getattr(face_map, "cno_to_id", {})
        target_ids = [cno_to_id.get(cid, cid) for cid in ids] if ids else load_active_ce_ids()
        items_map = {cid: face_map[cid] for cid in target_ids if cid in face_map}

    if target_ids is not None:
        items = [(cid, items_map[cid], force, dry_run) for cid in target_ids if cid in items_map]
    elif ids:
        items = [(cid, items_map[cid], force, dry_run) for cid in ids if cid in items_map]
    else:
        items = [(cid, lid, force, dry_run) for cid, lid in sorted(items_map.items())]

    missing_or_target = [it for it in items if force or not os.path.exists(os.path.join(CE_DIR, f"{it[0]}.webp"))]
    if not missing_or_target and not force:
        print(f"All {len(items)} Craft Essence images exist on disk. No download needed.")
        return True

    print(f"Processing {len(missing_or_target)} Craft Essences ({len(missing_or_target)} WebP files)...")
    start_time = time.time()
    success_count = 0
    fail_count = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(download_and_convert, item): item for item in missing_or_target}
        for i, future in enumerate(as_completed(futures), 1):
            ce_id, success, detail, url = future.result()
            if success:
                success_count += 1
                if i % 10 == 0 or i == len(missing_or_target):
                    print(f"[{i}/{len(missing_or_target)}] Done: {ce_id} ({detail})")
            else:
                fail_count += 1
                print(f"[{i}/{len(missing_or_target)}] FAILED: {ce_id} from {url} - {detail}", file=sys.stderr)

    elapsed = time.time() - start_time
    print(f"CE Sync finished in {elapsed:.1f}s: {success_count} succeeded, {fail_count} failed.")
    return fail_count == 0


def main():
    parser = argparse.ArgumentParser(description="Fetch and convert CE icons to bordered WebP dynamically")
    parser.add_argument("--ids", nargs="+", help="Specific CE IDs to process (e.g. 0330 0910)")
    parser.add_argument("--workers", type=int, default=8, help="Parallel worker threads")
    parser.add_argument("--force", action="store_true", help="Force re-download and overwrite existing files")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without modifying files")
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR, help="Atlas API cache directory")
    args = parser.parse_args()

    sync_ces(ids=args.ids, workers=args.workers, force=args.force, dry_run=args.dry_run, cache_dir=args.cache_dir)


if __name__ == "__main__":
    main()
