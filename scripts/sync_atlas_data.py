#!/usr/bin/env python3
"""
scripts/sync_atlas_data.py
Incremental Build-Time Atlas Academy Data Sync Engine for FGO Calculator.

Fetches data from Atlas Academy API, extracts servant traits/names/classes,
downloads and converts bordered face WebP icons to public/servants/{id}/,
and updates src/scripts/data/servants.js in-place.
"""

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.request
from typing import Dict, List, Optional, Set, Tuple, Union
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "scripts", "data")
SERVANTS_JS = os.path.join(DATA_DIR, "servants.js")
TRAITS_JS = os.path.join(DATA_DIR, "traits.js")
PUBLIC_SERVANTS_DIR = os.path.join(BASE_DIR, "public", "servants")

API_BASE = "https://api.atlasacademy.io"
STATIC_BASE = "https://static.atlasacademy.io"

# Trait ranges to recognize and format to 4-digit zero-padded strings
TRAIT_PREFIX_RANGES = [
    (1, 3),      # Gender: 0001 - 0003
    (100, 124),  # Class: 0100 - 0124
    (200, 204),  # Attribute: 0200 - 0204
    (300, 308),  # Alignment: 0300 - 0308
    (400, 405),  # Rarity: 0400 - 0405
]

SPECIAL_TRAITS = {
    2654: "Modern Human",
    2780: "Spiritron Dresses",
    2821: "Beast Servants",
    2801200: "Solomon",
}


def normalize_trait_id(tid: int) -> Optional[str]:
    """Normalize Atlas Academy trait ID to FGO Calculator trait ID string."""
    if tid in SPECIAL_TRAITS:
        return str(tid)

    for start, end in TRAIT_PREFIX_RANGES:
        if start <= tid <= end:
            return f"{tid:04d}"

    return None


class PoliteRateLimiter:
    """Enforces minimum interval between consecutive network requests to prevent rate-limiting."""

    def __init__(self, delay_seconds: float = 0.1):
        self.delay = delay_seconds
        self.last_request_time = 0.0

    def wait(self):
        if self.delay <= 0:
            return
        elapsed = time.time() - self.last_request_time
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self.last_request_time = time.time()


# Global rate limiter instance (defaults to 0.1s inter-request delay)
rate_limiter = PoliteRateLimiter(delay_seconds=0.1)


def fetch_url(url: str, timeout: int = 15, retries: int = 4) -> bytes:
    """Fetch URL with polite rate-limiting, retries, and HTTP 429 backoff."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; FGOCalculatorDataSync/1.0)"}
    req = urllib.request.Request(url, headers=headers)
    last_err = None

    for attempt in range(retries):
        rate_limiter.wait()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                retry_after = e.headers.get("Retry-After")
                backoff = float(retry_after) + 1.0 if retry_after and retry_after.isdigit() else (5.0 * (attempt + 1))
                print(f"  [RATE-LIMIT] HTTP 429 encountered for {url}. Waiting {backoff:.1f}s before retry...", file=sys.stderr)
                time.sleep(backoff)
                continue
            time.sleep(1.0 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(1.0 * (attempt + 1))

    raise RuntimeError(f"Failed to fetch {url} after {retries} retries: {last_err}")


def get_cached_json(cache_dir: str, filename: str, url: str, force: bool = False) -> dict:
    """Retrieve JSON payload, reading from cache if available."""
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, filename)

    if not force and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    raw_bytes = fetch_url(url)
    data = json.loads(raw_bytes.decode("utf-8"))
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def load_existing_servant_keys() -> Set[str]:
    """Parse existing servant keys from src/scripts/data/servants.js."""
    if not os.path.exists(SERVANTS_JS):
        return set()
    with open(SERVANTS_JS, "r", encoding="utf-8") as f:
        content = f.read()
    # Matches keys like "001": or 458: or "467-1":
    return set(re.findall(r'^\s*["\']?([0-9a-zA-Z-]+)["\']?\s*:\s*\{', content, re.MULTILINE))


def extract_servant_traits(svt_data: dict) -> Tuple[List[str], Dict[str, List[str]], Dict[str, str]]:
    """
    Extract base traits, multi-ascension diffs, and optionLabels/optionNames.
    Returns: (base_traits, ascension_diffs, option_names)
    """
    raw_traits = svt_data.get("traits", [])
    rarity = svt_data.get("rarity", 0)
    has_costumes = bool(svt_data.get("costumes"))

    base_trait_set = set()
    for t in raw_traits:
        tid = t.get("id") if isinstance(t, dict) else t
        norm = normalize_trait_id(tid)
        if norm:
            base_trait_set.add(norm)

    # Add rarity trait (e.g. 5★ -> "0405")
    if 0 <= rarity <= 5:
        base_trait_set.add(f"{400 + rarity:04d}")

    # Add Spiritron Dresses trait if servant has costumes
    if has_costumes:
        base_trait_set.add("2780")

    base_traits = sorted(list(base_trait_set), key=lambda x: (len(x), x))

    ascension_diffs = {}
    option_names = {}

    asc_add = svt_data.get("ascensionAdd", {})
    indiv_asc = asc_add.get("individuality", {}).get("ascension", {})
    name_asc = asc_add.get("overWriteServantName", {}).get("ascension", {})

    # Check ascensions 0, 1, 2
    stage_keys = [("0", "000"), ("1", "001"), ("2", "002")]
    has_diff = False
    temp_stage_traits = {}

    for api_idx, stage_key in stage_keys:
        if api_idx in indiv_asc and indiv_asc[api_idx]:
            stage_set = set()
            for t in indiv_asc[api_idx]:
                tid = t.get("id") if isinstance(t, dict) else t
                norm = normalize_trait_id(tid)
                if norm:
                    stage_set.add(norm)
            if 0 <= rarity <= 5:
                stage_set.add(f"{400 + rarity:04d}")
            if has_costumes:
                stage_set.add("2780")
            temp_stage_traits[stage_key] = stage_set
            if stage_set != base_trait_set:
                has_diff = True

    if has_diff:
        for _, stage_key in stage_keys:
            if stage_key in temp_stage_traits:
                # Store diff from base
                diff = temp_stage_traits[stage_key] - base_trait_set
                ascension_diffs[stage_key] = sorted(list(diff), key=lambda x: (len(x), x))

    # Check for alternate names
    for api_idx, stage_key in stage_keys:
        if api_idx in name_asc and name_asc[api_idx]:
            alt_name = name_asc[api_idx]
            if alt_name and alt_name != svt_data.get("name"):
                option_names[stage_key] = alt_name

    return base_traits, ascension_diffs, option_names


def download_face_icon(short_id: str, long_id: int, stage: Union[int, str] = "000", dest_filename: Optional[str] = None, force: bool = False, dry_run: bool = False) -> bool:
    """Download bordered face icon from Atlas Academy CDN and save as 142x155 WebP."""
    stage_str = str(stage).zfill(3) if str(stage).isdigit() else str(stage)
    dest_dir = os.path.join(PUBLIC_SERVANTS_DIR, short_id)
    dest_file = os.path.join(dest_dir, dest_filename or f"{stage_str}.webp")

    if not force and os.path.exists(dest_file):
        return True

    if dry_run:
        print(f"  [DRY-RUN] Would download face icon for {short_id}/{stage_str} -> {dest_file}")
        return True

    os.makedirs(dest_dir, exist_ok=True)

    long_str = str(long_id)
    base = long_str[:-2] if len(long_str) > 2 else long_str
    stage_int = int(stage_str) if stage_str.isdigit() else 0

    candidate_urls = [
        f"{STATIC_BASE}/JP/Faces/f_{base}{stage_str}_bordered.png",
        f"{STATIC_BASE}/JP/Faces/f_{base}{stage_str}.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}{stage_int}_bordered.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}{stage_int}.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}0_bordered.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}0.png",
    ]

    for url in candidate_urls:
        try:
            raw_data = fetch_url(url, timeout=10, retries=2)
            img = Image.open(io.BytesIO(raw_data)).convert("RGBA")
            if img.size != (142, 155):
                img = img.resize((142, 155), Image.Resampling.LANCZOS)
            img.save(dest_file, "WEBP", quality=80, method=6)
            return True
        except Exception:
            continue

    print(f"  [WARN] Failed to download face icon for {short_id}/{stage_str} (long_id={long_id})", file=sys.stderr)
    return False


def load_all_servant_stages() -> Dict[str, List[str]]:
    """Parse src/scripts/data/servants.js to find all expected ascension stages for each servant."""
    stages_by_id = {}
    if not os.path.exists(SERVANTS_JS):
        return stages_by_id

    with open(SERVANTS_JS, "r", encoding="utf-8") as f:
        text = f.read()

    m = re.search(r"export\s+const\s+SERVANT_DATA\s*=\s*\{([\s\S]*)\};?\s*$", text)
    body = m.group(1) if m else text

    entry_starts = list(re.finditer(r"""(?:^|\n)\s*["\x27]?([0-9a-zA-Z\-_]+)["\x27]?\s*:\s*\{""", body))

    for match in entry_starts:
        sid = match.group(1)
        start_pos = match.end() - 1
        depth = 0
        end_pos = start_pos
        for pos in range(start_pos, len(body)):
            if body[pos] == "{":
                depth += 1
            elif body[pos] == "}":
                depth -= 1
                if depth == 0:
                    end_pos = pos + 1
                    break
        entry_text = body[start_pos:end_pos]

        # Check if multi-ascension
        has_ascensions = bool(re.search(r"""traits\s*:\s*\{[^}]*?["\x27]?[0-9]{3}["\x27]?\s*:""", entry_text))
        stages = set(["000"])
        if has_ascensions:
            stages.add("001")
            stages.add("002")
            for opt_field in ["traits", "optionLabels", "optionNames"]:
                fm = re.search(r"""(?:""" + opt_field + r""")\s*:\s*\{([\s\S]*?)\}""", entry_text)
                if fm:
                    for st in re.findall(r"""["\x27]?([0-9]{3})["\x27]?\s*:""", fm.group(1)):
                        if st != "base":
                            stages.add(st)
        stages_by_id[sid] = sorted(list(stages))

    return stages_by_id


def format_servant_js_entry(short_id: str, name: str, base_traits: List[str], ascension_diffs: Dict[str, List[str]], option_names: Dict[str, str]) -> str:
    """Format a servant JS entry matching code conventions."""
    key_repr = f'"{short_id}"' if (short_id.startswith("0") or "-" in short_id) else short_id
    escaped_name = name.replace('"', '\\"')

    if not ascension_diffs:
        traits_json = json.dumps(base_traits)
        return f'  {key_repr}: {{ name: "{escaped_name}", traits: {{ base: {traits_json} }} }},'

    lines = [f'  {key_repr}: {{']
    lines.append(f'    name: "{escaped_name}",')
    lines.append('    traits: {')
    lines.append(f'      base: {json.dumps(base_traits)},')
    for stage, diff in sorted(ascension_diffs.items()):
        lines.append(f'      "{stage}": {json.dumps(diff)},')
    lines.append('    },')
    if option_names:
        opt_str = json.dumps(option_names)
        lines.append(f'    optionNames: {opt_str},')
    lines.append('  },')
    return "\n".join(lines)


def update_servants_js(new_entries: Dict[str, str], dry_run: bool = False):
    """Insert new servant entries into src/scripts/data/servants.js in sorted order."""
    if not os.path.exists(SERVANTS_JS):
        print(f"[ERROR] {SERVANTS_JS} not found", file=sys.stderr)
        return

    with open(SERVANTS_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # Find the closing brace of SERVANT_DATA = { ... };
    match = re.search(r'(export\s+const\s+SERVANT_DATA\s*=\s*\{)(.*?)(\n\};)', content, re.DOTALL)
    if not match:
        print("[ERROR] Could not parse SERVANT_DATA in servants.js", file=sys.stderr)
        return

    header, body, footer = match.groups()

    if dry_run:
        print(f"[DRY-RUN] Would append {len(new_entries)} new servants into servants.js:")
        for k, v in new_entries.items():
            print(v)
        return

    # Append new entries before closing brace
    addition = "\n" + "\n".join(new_entries.values()) + "\n"
    updated_content = header + body.rstrip() + addition + "};" + content[match.end():]

    with open(SERVANTS_JS, "w", encoding="utf-8") as f:
        f.write(updated_content)

    print(f"Successfully added {len(new_entries)} new servants to {SERVANTS_JS}")


def cleanup_cache_dir(cache_dir: str):
    """Remove cache directory and any empty parent directory."""
    if os.path.exists(cache_dir):
        shutil.rmtree(cache_dir, ignore_errors=True)
        parent = os.path.dirname(cache_dir)
        try:
            if os.path.exists(parent) and not os.listdir(parent):
                os.rmdir(parent)
        except Exception:
            pass
        print("Local cache cleaned.")


def ensure_ce_images(force: bool = False, dry_run: bool = False):
    """Ensure all craft essence face icons exist in public/craft_essences/."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from fetch_bordered_ces import sync_ces
        sync_ces(force=force, dry_run=dry_run)
    except Exception as e:
        print(f"Warning: CE sync failed: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Incremental Atlas Academy Data Sync for FGO Calculator")
    parser.add_argument("--cache-dir", default=os.path.join(BASE_DIR, ".cache", "atlas"), help="Path to cache directory")
    parser.add_argument("--ids", nargs="+", help="Specific collection numbers to process (e.g. 482 481)")
    parser.add_argument("--delay", type=float, default=0.1, help="Polite delay between requests in seconds (default: 0.1s)")
    parser.add_argument("--clean-cache", action="store_true", help="Remove cache directory on finish to keep local files clean")
    parser.add_argument("--force", action="store_true", help="Force re-fetching and overwriting assets")
    parser.add_argument("--dry-run", action="store_true", help="Perform dry run without writing files")
    args = parser.parse_args()

    # Configure global rate limiter delay
    rate_limiter.delay = max(0.0, args.delay)
    if rate_limiter.delay > 0:
        print(f"Polite rate limiter active: minimum {rate_limiter.delay}s delay between requests.")

    print("Checking Atlas Academy API for latest servant data...")
    basic_url = f"{API_BASE}/export/JP/basic_servant.json"
    basic_data = get_cached_json(args.cache_dir, "basic_servant.json", basic_url, force=args.force)

    existing_keys = load_existing_servant_keys()
    print(f"Current local dataset contains {len(existing_keys)} servants.")

    # Filter playable servants
    playable = [s for s in basic_data if s.get("type") in ("normal", "heroine")]
    playable_by_cno = {}
    for s in playable:
        cno = s.get("collectionNo", 0)
        if cno > 0:
            playable_by_cno[cno] = s

    # Map all required stages per servant from dataset
    servant_stages_map = load_all_servant_stages()

    # Determine targets
    if args.ids:
        target_cnos = [int(x) for x in args.ids if x.isdigit() and int(x) in playable_by_cno]
    else:
        target_cnos = []
        for cno in sorted(playable_by_cno.keys()):
            cno_str = str(cno)
            cno_padded = cno_str.zfill(3)
            short_id = cno_padded if cno < 100 else cno_str

            # Check if text entry exists in servants.js
            has_existing = any(
                k == cno_str or k == cno_padded or k.startswith(f"{cno_str}-") or k.startswith(f"{cno_padded}-")
                for k in existing_keys
            )
            # Check if all expected face icons exist on disk (including multi-ascensions and split IDs)
            if cno == 467:
                img_missing = (
                    not os.path.exists(os.path.join(PUBLIC_SERVANTS_DIR, "467-1", "000.webp")) or
                    not os.path.exists(os.path.join(PUBLIC_SERVANTS_DIR, "467-2", "000.webp"))
                )
            else:
                expected_stages = servant_stages_map.get(short_id, ["000"])
                img_missing = any(
                    not os.path.exists(os.path.join(PUBLIC_SERVANTS_DIR, short_id, f"{st}.webp"))
                    for st in expected_stages
                )

            if not has_existing or img_missing:
                target_cnos.append(cno)

    if not target_cnos:
        print("Dataset is already 100% up-to-date with Atlas Academy. No new servants to sync.")
        ensure_ce_images(force=args.force, dry_run=args.dry_run)
        if args.clean_cache:
            cleanup_cache_dir(args.cache_dir)
        sys.exit(0)

    print(f"Found {len(target_cnos)} servant(s) to synchronize: {target_cnos}")

    new_entries = {}
    for cno in target_cnos:
        s_info = playable_by_cno[cno]
        long_id = s_info.get("id")
        short_id = str(cno).zfill(3) if cno < 100 else str(cno)

        has_existing = any(
            k == short_id or k == str(cno) or k.startswith(f"{short_id}-") or k.startswith(f"{cno}-")
            for k in existing_keys
        )

        if not has_existing:
            print(f"Fetching new Servant {short_id} (long ID: {long_id})...")
            svt_url = f"{API_BASE}/nice/JP/svt/{long_id}?lore=false&lang=en"
            svt_payload = get_cached_json(
                os.path.join(args.cache_dir, "svt"),
                f"{long_id}.json",
                svt_url,
                force=args.force
            )

            name = svt_payload.get("name") or s_info.get("name", f"Servant {cno}")
            base_traits, asc_diffs, opt_names = extract_servant_traits(svt_payload)

            download_face_icon(short_id, long_id, stage="000", force=args.force, dry_run=args.dry_run)
            for stage in asc_diffs.keys():
                download_face_icon(short_id, long_id, stage=stage, force=args.force, dry_run=args.dry_run)

            entry_code = format_servant_js_entry(short_id, name, base_traits, asc_diffs, opt_names)
            new_entries[short_id] = entry_code
        else:
            # Existing servant with missing images: download directly without API overhead
            if cno == 467:
                # 467-1: François Prelati (long ID: 505600)
                download_face_icon("467-1", 505600, stage="000", force=args.force, dry_run=args.dry_run)
                # 467-2: Francesca Prelati (long ID: 505700)
                download_face_icon("467-2", 505700, stage="000", force=args.force, dry_run=args.dry_run)
            else:
                stages_to_fetch = servant_stages_map.get(short_id, ["000"])
                for st in stages_to_fetch:
                    download_face_icon(short_id, long_id, stage=st, force=args.force, dry_run=args.dry_run)

    if new_entries:
        update_servants_js(new_entries, dry_run=args.dry_run)

    ensure_ce_images(force=args.force, dry_run=args.dry_run)

    if args.clean_cache:
        cleanup_cache_dir(args.cache_dir)

    print("Sync completed successfully.")


if __name__ == "__main__":
    main()
