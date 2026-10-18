#!/usr/bin/env python3
"""
Fetch and convert Atlas Academy bordered Craft Essence (CE) face icons to WebP.
Source URL: https://static.atlasacademy.io/JP/Faces/f_{long_id}_bordered.png
Outputs:
  - public/craft_essences/{ce_id}.webp (142x155 WebP, q80)

Dynamic: Resolves 8-digit face IDs directly from Atlas Academy data (extraAssets.faces.equip),
eliminating hardcoded ID mappings.
"""

import argparse
import gzip
import io
import json
import os
import re
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


def extract_face_id(equip: dict) -> str:
    """Extract 8-digit face icon ID from equip extraAssets."""
    faces = equip.get("extraAssets", {}).get("faces", {}).get("equip", {})
    if not faces:
        return ""
    face_url = list(faces.values())[0] if isinstance(faces, dict) else str(faces)
    match = re.search(r"f_(\d+)\.png", face_url)
    return match.group(1) if match else ""


def load_ce_face_map(cache_dir: str = DEFAULT_CACHE_DIR, force: bool = False) -> dict:
    """Load or download nice_equip_lang_en.json and build a collectionNo -> face_id map."""
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

    face_map = {}
    for ce in data:
        cid = ce.get("collectionNo", 0)
        if cid > 0:
            face_id = extract_face_id(ce)
            if face_id:
                face_map[f"{cid:04d}"] = face_id

    return face_map


def load_active_ce_ids() -> list:
    """Parse active CE IDs from src/scripts/data/craft_essences.js (including grouped options)."""
    if not os.path.exists(CE_DATA_JS):
        return []

    with open(CE_DATA_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # Matches keys: "0099": or 2512:
    found_keys = re.findall(r'^\s*["\']?(\d{4})["\']?\s*:\s*\{', content, re.MULTILINE)
    # Also find sub-option keys
    opt_keys = re.findall(r'["\']?(\d{4})["\']?\s*:\s*\{\s*name:', content)
    all_ids = sorted(list(set(found_keys + opt_keys)))
    return all_ids


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
                img.save(dest_file, "WEBP", quality=80, method=6)

                return (ce_id, True, f"{img.size[0]}x{img.size[1]}", url)
            except Exception as e:
                last_err = e
                time.sleep(0.5 * (attempt + 1))

    return (ce_id, False, str(last_err), bordered_url)


def sync_ces(items_map=None, ids=None, workers=8, force=False, dry_run=False, cache_dir=DEFAULT_CACHE_DIR):
    """Sync CE icons from Atlas Academy, skipping existing files if force=False."""
    if items_map is None:
        face_map = load_ce_face_map(cache_dir=cache_dir, force=force)
        target_ids = ids if ids else load_active_ce_ids()
        items_map = {cid: face_map[cid] for cid in target_ids if cid in face_map}

    if ids:
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
