#!/usr/bin/env python3
"""
Fetch and convert Atlas Academy bordered servant face icons to WebP.
Source URL: https://static.atlasacademy.io/JP/Faces/f_{base}{asc}_bordered.png
Destination: public/servants/{short_id}/{asc}.webp
"""

import argparse
import io
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS_FILE = os.path.join(BASE_DIR, ".claude", "docs", "fetch-data-guideline.md")
SERVANTS_DIR = os.path.join(BASE_DIR, "public", "servants")
ATLAS_BASIC_URL = "https://api.atlasacademy.io/export/JP/basic_servant.json"

def build_id_mapping():
    mapping = {}
    
    # 1. Parse markdown table in fetch-data-guideline.md
    if os.path.exists(DOCS_FILE):
        with open(DOCS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("|"):
                    parts = [p.strip() for p in line.split("|")[1:-1]]
                    if len(parts) >= 2 and parts[1].isdigit():
                        mapping[parts[0]] = parts[1]
    
    # 2. Fetch basic_servant.json for collectionNo mapping
    try:
        req = urllib.request.Request(ATLAS_BASIC_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
            for s in data:
                col = str(s.get("collectionNo", ""))
                if col and col != "0":
                    col_padded = col.zfill(3)
                    if col_padded not in mapping:
                        mapping[col_padded] = str(s["id"])
                    if col not in mapping:
                        mapping[col] = str(s["id"])
    except Exception as e:
        print(f"Warning: Failed to fetch {ATLAS_BASIC_URL}: {e}", file=sys.stderr)
        
    # 3. Explicit overrides
    mapping["467-1"] = "505600"
    mapping["467-2"] = "505700"
    
    return mapping

def download_and_convert(task):
    short_id, asc, base, target_path, dry_run = task
    bordered_url = f"https://static.atlasacademy.io/JP/Faces/f_{base}{asc}_bordered.png"
    plain_url = f"https://static.atlasacademy.io/JP/Faces/f_{base}{asc}.png"
    
    if dry_run:
        return (short_id, asc, True, "DRY_RUN", bordered_url)

    urls_to_try = [bordered_url, plain_url]
    last_err = None
    
    for url in urls_to_try:
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    img_data = resp.read()
                    
                img = Image.open(io.BytesIO(img_data))
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                
                # Save as WebP quality 80
                img.save(target_path, "WEBP", quality=80, method=6)
                return (short_id, asc, True, f"{img.size[0]}x{img.size[1]}", url)
            except Exception as e:
                last_err = e
                time.sleep(0.5 * (attempt + 1))
                
    return (short_id, asc, False, str(last_err), bordered_url)

def main():
    parser = argparse.ArgumentParser(description="Fetch and convert servant icons to bordered WebP")
    parser.add_argument("--ids", nargs="+", help="Specific short IDs to process (e.g. 001 016 070)")
    parser.add_argument("--limit", type=int, help="Limit number of servants to process")
    parser.add_argument("--workers", type=int, default=12, help="Parallel worker threads")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without modifying files")
    args = parser.parse_args()

    print("Building servant ID mapping...")
    mapping = build_id_mapping()

    all_folders = sorted(os.listdir(SERVANTS_DIR))
    if args.ids:
        folders = [f for f in all_folders if f in args.ids]
    else:
        folders = all_folders

    if args.limit:
        folders = folders[:args.limit]

    tasks = []
    for folder in folders:
        fpath = os.path.join(SERVANTS_DIR, folder)
        if not os.path.isdir(fpath):
            continue

        if folder not in mapping:
            print(f"Error: No long ID mapping found for {folder}!", file=sys.stderr)
            continue

        base = mapping[folder][:-2]

        for fname in sorted(os.listdir(fpath)):
            if fname.endswith(".webp"):
                asc = fname.replace(".webp", "")
                target_path = os.path.join(fpath, fname)
                tasks.append((folder, asc, base, target_path, args.dry_run))

    print(f"Prepared {len(tasks)} image tasks across {len(folders)} servants.")
    
    start_time = time.time()
    success_count = 0
    fail_count = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(download_and_convert, t): t for t in tasks}
        for i, future in enumerate(as_completed(futures), 1):
            short_id, asc, success, detail, url = future.result()
            if success:
                success_count += 1
                if i % 25 == 0 or i == len(tasks):
                    print(f"[{i}/{len(tasks)}] Done: {short_id}/{asc}.webp ({detail})")
            else:
                fail_count += 1
                print(f"[{i}/{len(tasks)}] FAILED: {short_id}/{asc}.webp from {url} - {detail}", file=sys.stderr)

    elapsed = time.time() - start_time
    print(f"\nFinished in {elapsed:.1f}s: {success_count} succeeded, {fail_count} failed.")

if __name__ == "__main__":
    main()
