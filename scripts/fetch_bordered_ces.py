#!/usr/bin/env python3
"""
Fetch and convert Atlas Academy bordered Craft Essence (CE) face icons to WebP.
Source URL: https://static.atlasacademy.io/JP/Faces/f_{long_id}_bordered.png
Outputs:
  - public/craft_essences/{ce_id}.webp (142x155 WebP, q80)
"""

import argparse
import io
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CE_DIR = os.path.join(BASE_DIR, "public", "craft_essences")

CE_MAP = {
    # Heroic Portrait (0099–0108) — 4★
    "0099": "94009700",
    "0100": "94009800",
    "0101": "94009900",
    "0102": "94010000",
    "0103": "94010100",
    "0104": "94010200",
    "0105": "94010300",
    "0106": "94010400",
    "0107": "94010500",
    "0108": "94010600",
    # Standalone CEs — 5★
    "0330": "94019700",
    "0910": "94035200",
    "1080": "94039900",
    "1949": "94074800",
    "2020": "94077400",
    "2052": "94078500",
    "2124": "94080600",
    "2142": "94082200",
    "2209": "94083900",
    "2233": "94085900",
    "2437": "94088000",
    "2509": "94089900",
    "2583": "94092100",
    "2607": "94093200",
    "2701": "94094900",
    # Heroic Spirit Apex (2512–2532) — 4★
    "2512": "93113100",
    "2513": "93113200",
    "2514": "93113300",
    "2515": "93113400",
    "2516": "93113500",
    "2517": "93113600",
    "2518": "93113700",
    "2519": "93113800",
    "2520": "93113900",
    "2521": "93114000",
    "2522": "93114100",
    "2523": "93114200",
    "2524": "93114300",
    "2525": "93114400",
    "2526": "93114500",
    "2527": "93114600",
    "2528": "93114700",
    "2529": "93114800",
    "2530": "93114900",
    "2531": "93115000",
    "2532": "93115100",
}

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
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
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

def sync_ces(ids=None, workers=8, force=False, dry_run=False):
    """Sync CE icons from Atlas Academy, skipping existing files if force=False."""
    if ids:
        items = [(cid, CE_MAP[cid], force, dry_run) for cid in ids if cid in CE_MAP]
    else:
        items = [(cid, lid, force, dry_run) for cid, lid in sorted(CE_MAP.items())]

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
    parser = argparse.ArgumentParser(description="Fetch and convert CE icons to bordered WebP")
    parser.add_argument("--ids", nargs="+", help="Specific CE IDs to process (e.g. 0330 0910)")
    parser.add_argument("--workers", type=int, default=8, help="Parallel worker threads")
    parser.add_argument("--force", action="store_true", help="Force re-download and overwrite existing files")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without modifying files")
    args = parser.parse_args()

    sync_ces(ids=args.ids, workers=args.workers, force=args.force, dry_run=args.dry_run)

if __name__ == "__main__":
    main()
