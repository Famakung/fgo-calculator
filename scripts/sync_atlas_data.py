#!/usr/bin/env python3
"""
scripts/sync_atlas_data.py
Incremental Build-Time Atlas Academy Data Sync Engine for FGO Calculator.

Fetches data from Atlas Academy API:
  - Extracts servant traits/names/classes, downloads and converts bordered face WebP icons to public/servants/{id}/,
    and updates src/scripts/data/servants.js in-place.
  - Automatically discovers permanent bond Craft Essences (filtering event-only CEs), parses traits/bonuses,
    auto-groups same-effect campaign series variants, formats src/scripts/data/craft_essences.js, and
    downloads bordered face WebP icons to public/craft_essences/{id}.webp.
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
from typing import Dict, List, Optional, Set, Tuple, Union
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "scripts", "data")
SERVANTS_JS = os.path.join(DATA_DIR, "servants.js")
TRAITS_JS = os.path.join(DATA_DIR, "traits.js")
CE_DATA_JS = os.path.join(DATA_DIR, "craft_essences.js")
PUBLIC_SERVANTS_DIR = os.path.join(BASE_DIR, "public", "servants")

API_BASE = "https://api.atlasacademy.io"
STATIC_BASE = "https://static.atlasacademy.io"
EQUIP_EXPORT_URL = f"{API_BASE}/export/JP/nice_equip_lang_en.json"
NA_NICE_TRAIT_URL = f"{API_BASE}/export/NA/nice_trait.json"

# Trait ranges to recognize and format to 4-digit zero-padded strings
TRAIT_PREFIX_RANGES = [
    (1, 3),      # Gender: 0001 - 0003
    (100, 124),  # Class: 0100 - 0124
    (200, 204),  # Attribute: 0200 - 0204
    (300, 308),  # Alignment: 0300 - 0308
    (400, 405),  # Rarity: 0400 - 0405
]

STANDARD_7_CLASSES = ["0100", "0101", "0102", "0103", "0104", "0105", "0106"]

# Playable servant classes in FGO (maps to 0100 - 0124)
VALID_CLASS_IDS = {
    100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 115, 117, 120, 124
}

# Atlas Academy trait IDs for Beast class variants that map to 0124 (Class Beast)
BEAST_CLASS_TRAIT_IDS = {
    113, 114, 116, 118, 119, 121, 122, 124, 125, 126, 129, 132, 133, 135, 194
}

# Special trait mappings bridging Atlas internal identifiers with official in-game NA terminology
# (e.g. Attribute 200 in official NA in-game status is "Heaven Attribute", not Atlas's internal "Sky")
INTERNAL_TRAIT_OVERRIDES = {
    "0200": "Heaven Attribute",
    "200": "Heaven Attribute",
    "2780": "Spiritron Dresses",
    "2883": "Fate/stay night",
    "2801200": "Solomon",
}

KNOWN_SPECIAL_TRAIT_IDS = {2654, 2780, 2821, 2883, 2801200}

SERIES_NAME_OVERRIDES = {
    "Twilight Portrait": "Heroic Spirit Encounter",
    "英霊逢魔": "Heroic Spirit Encounter",
}

# Unofficial English translations for JP-only CEs unreleased in NA
UNOFFICIAL_JP_TRANSLATIONS = {
    "2583": "Great Library of Memories",
    "2607": "Sword Saints of Wandering",
    "2701": "Gun Dealer",
}

CE_OVERRIDES = {
    "0910": {"bonus": 15},
}

KNOWN_COSTUME_LABELS = {
    "301330": "Piercing Bunny",
    "102830": "Decapitating Bunny (First Ascension)",
    "102840": "Decapitating Bunny (Second Ascension)",
    "102850": "Decapitating Bunny (Third Ascension)",
    "702830": "Mad Bunny",
    "204330": "Bloody Bunny",
    "1101630": "Serious Mode",
    "4000130": "Earth President",
    "2301130": "Incognito Glasses",
}

COSTUME_STAGE_KEYS = ["300", "400", "500"]


def camel_to_words(s: str) -> str:
    """Split camelCase or PascalCase into space-separated words."""
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', s)
    return s.strip()


def format_api_trait_name(tid_str: str, raw_name: str) -> str:
    """Transform Atlas Academy internal camelCase trait names into canonical in-game display names."""
    norm_id = f"{int(tid_str):04d}" if tid_str.isdigit() and int(tid_str) < 1000 else tid_str
    if norm_id in INTERNAL_TRAIT_OVERRIDES:
        return INTERNAL_TRAIT_OVERRIDES[norm_id]
    if tid_str in INTERNAL_TRAIT_OVERRIDES:
        return INTERNAL_TRAIT_OVERRIDES[tid_str]

    if raw_name.startswith("gender"):
        return f"Gender {raw_name[6:].capitalize()}"

    if raw_name.startswith("class"):
        suffix = raw_name[5:]
        if suffix.startswith("Beast"):
            return "Class Beast"
        return f"Class {camel_to_words(suffix)}"

    if raw_name.startswith("attribute"):
        return f"{camel_to_words(raw_name[9:])} Attribute"

    if raw_name.startswith("alignment"):
        return f"{camel_to_words(raw_name[9:])} Alignment"

    if raw_name.endswith("StarServant"):
        return camel_to_words(raw_name).title()

    return camel_to_words(raw_name).title()


def normalize_trait_id(tid: int) -> Optional[str]:
    """Normalize Atlas Academy trait ID to FGO Calculator trait ID string."""
    if tid in BEAST_CLASS_TRAIT_IDS:
        return "0124"

    for start, end in TRAIT_PREFIX_RANGES:
        if start <= tid <= end:
            return f"{tid:04d}"

    if tid in KNOWN_SPECIAL_TRAIT_IDS or str(tid) in INTERNAL_TRAIT_OVERRIDES:
        return str(tid)

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
    """Fetch URL with polite rate-limiting, retries, gzip decompression, and HTTP 429 backoff."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; FGOCalculatorDataSync/1.0)",
        "Accept-Encoding": "gzip",
    }
    req = urllib.request.Request(url, headers=headers)
    last_err = None

    for attempt in range(retries):
        rate_limiter.wait()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data
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


# ==============================================================================
# Servant Synchronization Engine
# ==============================================================================

def load_existing_servant_keys() -> Set[str]:
    """Parse existing servant keys from src/scripts/data/servants.js."""
    if not os.path.exists(SERVANTS_JS):
        return set()
    with open(SERVANTS_JS, "r", encoding="utf-8") as f:
        content = f.read()
    return set(re.findall(r'^\s*["\']?([0-9a-zA-Z-]+)["\']?\s*:\s*\{', content, re.MULTILINE))


def extract_servant_traits(svt_data: dict) -> Tuple[List[str], Dict[str, List[str]], Dict[str, str], Dict[str, str], Dict[str, int]]:
    """Extract base traits, multi-ascension diffs, optionLabels, optionNames, and costume battleCharaIds."""
    raw_traits = svt_data.get("traits", [])
    rarity = svt_data.get("rarity", 0)
    cno = svt_data.get("collectionNo", 0)
    has_costumes = bool(svt_data.get("costumes")) or bool(svt_data.get("profile", {}).get("costume"))

    # Helper to parse and normalize trait list
    def parse_traits(tlist):
        tset = set()
        for t in tlist:
            tid = t.get("id") if isinstance(t, dict) else t
            norm = normalize_trait_id(tid)
            if norm:
                tset.add(norm)
        if 0 <= rarity <= 5:
            tset.add(f"{400 + rarity:04d}")
        if has_costumes:
            tset.add("2780")
        if "0001" not in tset and "0002" not in tset:
            tset.add("0003")
        if cno == 238:
            tset.add("2821")
        if cno in (377, 417, 444):
            tset.add("0124")
        return tset

    default_set = parse_traits(raw_traits)

    asc_add = svt_data.get("ascensionAdd", {})
    indiv_asc = asc_add.get("individuality", {}).get("ascension", {})
    name_asc = asc_add.get("overWriteServantName", {}).get("ascension", {})
    indiv_costume = asc_add.get("individuality", {}).get("costume", {})
    costumes_profile = svt_data.get("profile", {}).get("costume", {})

    # Build stage trait sets
    stage_sets = {}
    raw_0 = indiv_asc.get("0") or indiv_asc.get("1")
    raw_1 = indiv_asc.get("2") or indiv_asc.get("1") or indiv_asc.get("0")
    raw_2 = indiv_asc.get("3") or indiv_asc.get("4") or indiv_asc.get("2")

    stage_sets["000"] = parse_traits(raw_0) if raw_0 else set(default_set)
    stage_sets["001"] = parse_traits(raw_1) if raw_1 else set(default_set)
    stage_sets["002"] = parse_traits(raw_2) if raw_2 else set(default_set)

    # Costumes
    sorted_cids = sorted(
        indiv_costume.keys(),
        key=lambda c: (
            costumes_profile.get(str(c), {}).get("costumeCollectionNo", int(c) if str(c).isdigit() else 0)
        )
    )

    costume_stages = {}
    costume_labels = {}
    costume_battle_ids = {}
    costume_idx = 0
    for cid in sorted_cids:
        ctraits = indiv_costume[cid]
        c_str = str(cid)
        c_info = costumes_profile.get(c_str, {})
        battle_chara_id = c_info.get("battleCharaId") or (int(cid) if str(cid).isdigit() else None)
        label = KNOWN_COSTUME_LABELS.get(c_str) or c_info.get("shortName") or c_info.get("name")

        if ctraits:
            cset = parse_traits(ctraits)
            if cset != default_set or c_str in KNOWN_COSTUME_LABELS:
                st_key = COSTUME_STAGE_KEYS[costume_idx] if costume_idx < len(COSTUME_STAGE_KEYS) else f"{300 + costume_idx * 100}"
                costume_idx += 1
                costume_stages[st_key] = cset
                if battle_chara_id:
                    costume_battle_ids[st_key] = battle_chara_id
                if label:
                    costume_labels[st_key] = label

    # Check if ascensions differ amongst themselves
    has_asc_diff = (stage_sets["000"] != stage_sets["001"]) or (stage_sets["001"] != stage_sets["002"]) or (stage_sets["000"] != stage_sets["002"])
    has_costume_diff = bool(costume_stages)

    ascension_diffs = {}
    option_labels = dict(costume_labels)
    option_names = {}

    # Overwrite names
    for api_idx, name_val in name_asc.items():
        if not name_val or name_val == svt_data.get("name"):
            continue
        if api_idx in ("0",):
            option_names["000"] = name_val
        elif api_idx in ("1", "2"):
            option_names["001"] = name_val
        elif api_idx in ("3", "4"):
            option_names["002"] = name_val

    if cno == 388:
        option_labels["300"] = "Serious Mode"
        costume_battle_ids["300"] = 1101630
    if cno == 448:
        option_names["300"] = "Jade Rabbit"

    if not has_asc_diff and not has_costume_diff:
        base_traits = sorted(list(default_set), key=lambda x: (len(x), x))
        return base_traits, ascension_diffs, option_labels, option_names, costume_battle_ids

    if has_asc_diff:
        if cno in (351, 385, 415, 416, 444, 448, 449, 465):
            base_set = stage_sets["000"] & stage_sets["001"] & stage_sets["002"]
            if costume_stages:
                for cset in costume_stages.values():
                    base_set = base_set & cset
            for sk in ["000", "001", "002"]:
                ascension_diffs[sk] = sorted(list(stage_sets[sk] - base_set), key=lambda x: (len(x), x))
            for ck, cset in costume_stages.items():
                ascension_diffs[ck] = sorted(list(cset - base_set), key=lambda x: (len(x), x))
        else:
            base_set = default_set
            for sk in ["000", "001", "002"]:
                diff = stage_sets[sk] - base_set
                if diff:
                    ascension_diffs[sk] = sorted(list(diff), key=lambda x: (len(x), x))
            for ck, cset in costume_stages.items():
                diff = cset - base_set
                if diff:
                    ascension_diffs[ck] = sorted(list(diff), key=lambda x: (len(x), x))
    else:
        base_set = default_set
        for ck, cset in costume_stages.items():
            diff = cset - base_set
            if diff:
                ascension_diffs[ck] = sorted(list(diff), key=lambda x: (len(x), x))

    base_traits = sorted(list(base_set), key=lambda x: (len(x), x))
    return base_traits, ascension_diffs, option_labels, option_names, costume_battle_ids


def download_face_icon(short_id: str, long_id: int, stage: Union[int, str] = "000", dest_filename: Optional[str] = None, battle_chara_id: Optional[int] = None, force: bool = False, dry_run: bool = False) -> bool:
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

    candidate_urls = []
    if battle_chara_id:
        candidate_urls.extend([
            f"{STATIC_BASE}/JP/Faces/f_{battle_chara_id}0_bordered.png",
            f"{STATIC_BASE}/JP/Faces/f_{battle_chara_id}_bordered.png",
            f"{STATIC_BASE}/JP/Faces/f_{battle_chara_id}0.png",
            f"{STATIC_BASE}/JP/Faces/f_{battle_chara_id}.png",
        ])
    candidate_urls.extend([
        f"{STATIC_BASE}/JP/Faces/f_{base}{stage_str}_bordered.png",
        f"{STATIC_BASE}/JP/Faces/f_{base}{stage_str}.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}{stage_int}_bordered.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}{stage_int}.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}0_bordered.png",
        f"{STATIC_BASE}/JP/Faces/f_{long_str}0.png",
    ])

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


def format_servant_js_entry(
    short_id: str,
    name: str,
    base_traits: List[str],
    ascension_diffs: Dict[str, List[str]],
    option_labels: Optional[Dict[str, str]] = None,
    option_names: Optional[Dict[str, str]] = None,
) -> str:
    """Format a servant JS entry matching code conventions."""
    key_repr = f'"{short_id}"' if (short_id.startswith("0") or "-" in short_id) else short_id
    escaped_name = name.replace('"', '\\"')

    if not ascension_diffs and not option_labels and not option_names:
        traits_json = json.dumps(base_traits)
        return f'  {key_repr}: {{ name: "{escaped_name}", traits: {{ base: {traits_json} }} }},'

    lines = [f'  {key_repr}: {{']
    lines.append(f'    name: "{escaped_name}",')
    lines.append('    traits: {')
    lines.append(f'      base: {json.dumps(base_traits)},')
    for stage, diff in sorted(ascension_diffs.items()):
        stage_repr = stage if stage.isdigit() and int(stage) >= 300 else f'"{stage}"'
        lines.append(f'      {stage_repr}: {json.dumps(diff)},')
    lines.append('    },')
    if option_labels:
        labels_parts = [f'{k}: {json.dumps(v)}' for k, v in sorted(option_labels.items())]
        if len(labels_parts) > 1:
            lines.append('    optionLabels: {')
            for lp in labels_parts:
                lines.append(f'      {lp},')
            lines.append('    },')
        else:
            lines.append(f'    optionLabels: {{ {labels_parts[0]} }},')
    if option_names:
        names_parts = []
        for k, v in sorted(option_names.items()):
            k_repr = f'"{k}"' if k.startswith("0") else k
            names_parts.append(f'{k_repr}: {json.dumps(v)}')
        lines.append(f'    optionNames: {{ {", ".join(names_parts)} }},')
    lines.append('  },')
    return "\n".join(lines)


def update_servants_js(new_entries: Dict[str, str], dry_run: bool = False):
    """Insert new servant entries into src/scripts/data/servants.js in sorted order."""
    if not os.path.exists(SERVANTS_JS):
        header = "export const SERVANT_DATA = {\n"
        body = ""
        footer = "};\n"
        content = header + footer
    else:
        with open(SERVANTS_JS, "r", encoding="utf-8") as f:
            content = f.read()

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

    addition = "\n" + "\n".join(new_entries.values()) + "\n"
    if body:
        updated_content = header + body.rstrip() + addition + "};" + content[match.end():]
    else:
        updated_content = header + "\n".join(new_entries.values()) + "\n};\n"

    os.makedirs(os.path.dirname(SERVANTS_JS), exist_ok=True)
    with open(SERVANTS_JS, "w", encoding="utf-8") as f:
        f.write(updated_content)

    print(f"Successfully added {len(new_entries)} new servants to {SERVANTS_JS}")


def sync_servants(args):
    """Check for new servants and sync traits and face icons."""
    print("Checking Atlas Academy API for latest servant data...")
    basic_url = f"{API_BASE}/export/JP/basic_servant.json"
    basic_data = get_cached_json(args.cache_dir, "basic_servant.json", basic_url, force=args.force)

    existing_keys = load_existing_servant_keys()
    print(f"Current local dataset contains {len(existing_keys)} servants.")

    playable = [s for s in basic_data if s.get("type") in ("normal", "heroine")]
    playable_by_cno = {}
    for s in playable:
        cno = s.get("collectionNo", 0)
        if cno > 0:
            playable_by_cno[cno] = s

    servant_stages_map = load_all_servant_stages()

    if args.ids:
        target_cnos = [int(x) for x in args.ids if x.isdigit() and int(x) in playable_by_cno]
    else:
        target_cnos = []
        for cno in sorted(playable_by_cno.keys()):
            cno_str = str(cno)
            cno_padded = cno_str.zfill(3)
            short_id = cno_padded if cno < 100 else cno_str

            has_existing = any(
                k == cno_str or k == cno_padded or k.startswith(f"{cno_str}-") or k.startswith(f"{cno_padded}-")
                for k in existing_keys
            )
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
        print("Servant dataset is already 100% up-to-date with Atlas Academy.")
        return

    print(f"Found {len(target_cnos)} servant(s) to synchronize: {target_cnos}")

    bulk_svt_map = {}
    if len(target_cnos) > 20:
        print(f"Large batch detected ({len(target_cnos)} servants). Fetching bulk nice_servant_lore_lang_en.json...")
        try:
            nice_servants = get_cached_json(args.cache_dir, "nice_servant_lore_lang_en.json", f"{API_BASE}/export/JP/nice_servant_lore_lang_en.json", force=args.force)
            bulk_svt_map = {s.get("id"): s for s in nice_servants if s.get("id")}
        except Exception as e:
            print(f"Bulk download failed ({e}), will fall back to individual requests.", file=sys.stderr)

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
            if long_id in bulk_svt_map:
                svt_payload = bulk_svt_map[long_id]
            else:
                print(f"Fetching new Servant {short_id} (long ID: {long_id})...")
                svt_url = f"{API_BASE}/nice/JP/svt/{long_id}?lore=true&lang=en"
                svt_payload = get_cached_json(
                    os.path.join(args.cache_dir, "svt"),
                    f"{long_id}.json",
                    svt_url,
                    force=args.force
                )

            name = svt_payload.get("name") or s_info.get("name", f"Servant {cno}")
            base_traits, asc_diffs, opt_labels, opt_names, costume_battle_ids = extract_servant_traits(svt_payload)

            if cno == 467:
                # Handle François and Francesca Prélat split
                download_face_icon("467-1", 505600, stage="000", force=args.force, dry_run=args.dry_run)
                download_face_icon("467-2", 505700, stage="000", force=args.force, dry_run=args.dry_run)
                t_m = sorted(list((set(base_traits) - {"0002", "0003"}) | {"0001"}))
                t_f = sorted(list((set(base_traits) - {"0001", "0003"}) | {"0002"}))
                new_entries["467-1"] = format_servant_js_entry("467-1", "François Prélat", t_m, {}, {}, {})
                new_entries["467-2"] = format_servant_js_entry("467-2", "Francesca Prélat", t_f, {}, {}, {})
                continue

            download_face_icon(short_id, long_id, stage="000", force=args.force, dry_run=args.dry_run)
            if asc_diffs:
                download_face_icon(short_id, long_id, stage="001", force=args.force, dry_run=args.dry_run)
                download_face_icon(short_id, long_id, stage="002", force=args.force, dry_run=args.dry_run)
                for stage in asc_diffs.keys():
                    b_id = costume_battle_ids.get(stage)
                    download_face_icon(short_id, long_id, stage=stage, battle_chara_id=b_id, force=args.force, dry_run=args.dry_run)

            entry_code = format_servant_js_entry(short_id, name, base_traits, asc_diffs, opt_labels, opt_names)
            new_entries[short_id] = entry_code
        else:
            if cno == 467:
                download_face_icon("467-1", 505600, stage="000", force=args.force, dry_run=args.dry_run)
                download_face_icon("467-2", 505700, stage="000", force=args.force, dry_run=args.dry_run)
            else:
                stages_to_fetch = servant_stages_map.get(short_id, ["000"])
                for st in stages_to_fetch:
                    download_face_icon(short_id, long_id, stage=st, force=args.force, dry_run=args.dry_run)

    if new_entries:
        update_servants_js(new_entries, dry_run=args.dry_run)


# ==============================================================================
# Craft Essence Synchronization Engine
# ==============================================================================

def extract_bond_craft_essences(equips: List[dict], na_names: Optional[Dict[str, str]] = None) -> List[dict]:
    """Extract permanent Bond Gain CEs, parse traits/bonuses, and auto-group same-effect campaign series."""
    parsed_ces = []
    for ce in equips:
        cid = ce.get("collectionNo", 0)
        if cid <= 0:
            continue

        bond_funcs = []
        for s in ce.get("skills", []):
            for f in s.get("functions", []):
                if f.get("funcType") == "servantFriendshipUp":
                    if any(not sv.get("EventId") for sv in f.get("svals", [])):
                        bond_funcs.append((s, f))
        if not bond_funcs:
            continue

        last_skill, f = bond_funcs[-1]
        max_rate = 0
        max_add = 0
        for sv in f.get("svals", []):
            if not sv.get("EventId"):
                if "RateCount" in sv:
                    max_rate = max(max_rate, sv["RateCount"] // 10)
                if "AddCount" in sv:
                    max_add = max(max_add, sv["AddCount"])

        cid_str = f"{cid:04d}"
        if cid_str in CE_OVERRIDES and "bonus" in CE_OVERRIDES[cid_str]:
            max_rate = CE_OVERRIDES[cid_str]["bonus"]

        traits = []
        match_all = False
        trait_groups = []
        also_match = []

        overwrite = f.get("script", {}).get("overwriteTvals") or f.get("overWriteTvalsList")
        if overwrite:
            if len(overwrite) == 1:
                raw_tids = [t.get("id") if isinstance(t, dict) else t for t in overwrite[0]]
                traits = sorted([normalize_trait_id(tid) or f"{tid:04d}" for tid in raw_tids], key=lambda x: (len(x), x))
                match_all = True
            else:
                for grp in overwrite:
                    raw_tids = [t.get("id") if isinstance(t, dict) else t for t in grp]
                    if len(raw_tids) == 1 and raw_tids[0] == 2801200:
                        also_match.append("2801200")
                    else:
                        for tid in raw_tids:
                            if tid == 2858:  # standardClassServant
                                trait_groups.append(STANDARD_7_CLASSES)
                            else:
                                trait_groups.append([normalize_trait_id(tid) or f"{tid:04d}"])
        else:
            raw_tids = [t.get("id") for t in f.get("functvals", [])]
            traits = sorted([normalize_trait_id(tid) or f"{tid:04d}" for tid in raw_tids], key=lambda x: (len(x), x))

        raw_name = ce.get("name", "").strip()
        if na_names and cid_str in na_names and na_names[cid_str]:
            raw_name = na_names[cid_str]
        elif cid_str in UNOFFICIAL_JP_TRANSLATIONS:
            raw_name = UNOFFICIAL_JP_TRANSLATIONS[cid_str]
        elif cid_str in CE_OVERRIDES and "name" in CE_OVERRIDES[cid_str]:
            raw_name = CE_OVERRIDES[cid_str]["name"]

        prefix_match = re.match(r"^(.+?)(?:\s*[:：]\s*.+)?$", raw_name)
        base_title = prefix_match.group(1).strip() if prefix_match else raw_name

        parsed_ces.append({
            "cid": cid,
            "cid_str": cid_str,
            "name": raw_name,
            "base_title": base_title,
            "flag": ce.get("flag"),
            "bonus": max_rate,
            "flatBonus": max_add,
            "traits": traits,
            "matchAll": match_all,
            "traitGroups": trait_groups,
            "alsoMatch": also_match,
        })

    parsed_ces.sort(key=lambda x: x["cid"])

    # Grouping: Consecutive CEs sharing identical effect signature and series identity
    groups = []
    curr = []
    for ce in parsed_ces:
        if not curr:
            curr.append(ce)
            continue
        prev = curr[-1]
        same_eff = (
            ce["bonus"] == prev["bonus"]
            and ce["flatBonus"] == prev["flatBonus"]
            and ce["traits"] == prev["traits"]
            and ce["matchAll"] == prev["matchAll"]
            and ce["traitGroups"] == prev["traitGroups"]
            and ce["alsoMatch"] == prev["alsoMatch"]
        )
        same_series = ce["base_title"] == prev["base_title"] and ce["cid"] == prev["cid"] + 1
        is_campaign = ce["flag"] == "svtEquipCampaign" and prev["flag"] == "svtEquipCampaign" and ce["cid"] == prev["cid"] + 1

        if same_eff and (same_series or is_campaign):
            curr.append(ce)
        else:
            groups.append(curr)
            curr = [ce]
    if curr:
        groups.append(curr)

    result = []
    for g in groups:
        first = g[0]
        if len(g) > 1:
            last = g[-1]
            base_title = first["base_title"]
            group_name = SERIES_NAME_OVERRIDES.get(base_title, base_title)
            options = {}
            group_image = None
            for opt in g:
                opt_name = opt["name"]
                if base_title in SERIES_NAME_OVERRIDES:
                    opt_name = re.sub(r"^" + re.escape(base_title), group_name, opt_name)
                options[opt["cid_str"]] = {"name": opt_name}
                if "Mash" in opt_name:
                    group_image = opt["cid_str"]

            entry = {
                "id": first["cid_str"],
                "name": group_name,
                "isGroup": True,
                "folder": f"{first['cid_str']}-{last['cid_str']}",
                "options": options,
            }
            if group_image:
                entry["groupImage"] = group_image
            if first["flatBonus"]:
                entry["flatBonus"] = first["flatBonus"]
            if first["bonus"]:
                entry["bonus"] = first["bonus"]
            if first["traits"]:
                entry["traits"] = first["traits"]
            if first["matchAll"]:
                entry["matchAll"] = True
            if first["traitGroups"]:
                entry["traitGroups"] = first["traitGroups"]
            if first["alsoMatch"]:
                entry["alsoMatch"] = first["alsoMatch"]
            result.append(entry)
        else:
            entry = {
                "id": first["cid_str"],
                "name": first["name"],
            }
            if first["bonus"]:
                entry["bonus"] = first["bonus"]
            if first["flatBonus"]:
                entry["flatBonus"] = first["flatBonus"]
            if first["traits"] is not None and not first["traitGroups"]:
                entry["traits"] = first["traits"]
            if first["matchAll"]:
                entry["matchAll"] = True
            if first["traitGroups"]:
                entry["traitGroups"] = first["traitGroups"]
            if first["alsoMatch"]:
                entry["alsoMatch"] = first["alsoMatch"]
            result.append(entry)

    return result


def extract_special_traits_from_ce_skills(cache_dir: str, equips: List[dict], force: bool = False) -> Dict[int, str]:
    """Dynamically extract bracketed trait names from NA CE skills for traits > 1000."""
    extracted = {}
    for ce in equips:
        long_id = ce.get("id")
        for s in ce.get("skills", []):
            for fn in s.get("functions", []):
                if fn.get("funcType") == "servantFriendshipUp":
                    ow = fn.get("script", {}).get("overwriteTvals") or fn.get("overWriteTvalsList")
                    target_tids = []
                    if ow:
                        for g in ow:
                            for t in g:
                                tid = t.get("id") if isinstance(t, dict) else t
                                if tid > 1000 and tid != 2858 and tid != 2801200:
                                    target_tids.append(tid)
                    else:
                        for t in fn.get("functvals", []):
                            tid = t.get("id") if isinstance(t, dict) else t
                            if tid > 1000 and tid != 2858 and tid != 2801200:
                                target_tids.append(tid)

                    if target_tids and long_id:
                        try:
                            na_ce_url = f"{API_BASE}/nice/NA/equip/{long_id}"
                            na_ce = get_cached_json(os.path.join(cache_dir, "equip"), f"{long_id}.json", na_ce_url, force=force)
                            for ns in na_ce.get("skills", []):
                                detail = ns.get("detail", "")
                                matches = re.findall(r"\[([a-zA-Z\s]+?)(?:\s*\(.+?\))?\]", detail)
                                for m in matches:
                                    clean = m.strip()
                                    if clean and clean.upper() != "MAX":
                                        for tid in target_tids:
                                            extracted[tid] = clean.title()
                        except Exception:
                            pass
    return extracted


def fetch_and_build_trait_data(cache_dir: str, equips: List[dict], force: bool = False) -> Dict[str, str]:
    """Dynamically fetch traits from Atlas Academy API and extract bracketed names from CE skills."""
    print("Fetching trait definitions from Atlas Academy API...")
    try:
        api_traits = get_cached_json(cache_dir, "na_nice_trait.json", NA_NICE_TRAIT_URL, force=force)
    except Exception as e:
        print(f"  [WARN] Failed to fetch na_nice_trait.json ({e}), using cached/fallback traits.", file=sys.stderr)
        api_traits = {}

    traits_map: Dict[str, str] = {}

    # 1. Standard trait ranges from API (Gender, Class, Attribute, Alignment, Rarity)
    for start, end in TRAIT_PREFIX_RANGES:
        for tid in range(start, end + 1):
            if start == 100 and tid not in VALID_CLASS_IDS:
                continue
            s_tid = str(tid)
            raw = api_traits.get(s_tid, "")
            norm_id = f"{tid:04d}"
            if raw or s_tid in INTERNAL_TRAIT_OVERRIDES:
                traits_map[norm_id] = format_api_trait_name(s_tid, raw)

    # 2. Extract special traits (>1000) from NA CE skill text dynamically
    ce_skill_special = extract_special_traits_from_ce_skills(cache_dir, equips, force=force)
    for tid, name in ce_skill_special.items():
        traits_map[str(tid)] = name

    # 3. Add known internal traits (Spiritron Dresses, FSN, Solomon)
    for tid_str, name in INTERNAL_TRAIT_OVERRIDES.items():
        if len(tid_str) > 4 or int(tid_str) > 1000:
            if tid_str not in traits_map:
                traits_map[tid_str] = name

    return traits_map


def sync_traits_js(cache_dir: str = os.path.join(BASE_DIR, ".cache", "atlas"), equips: Optional[List[dict]] = None, force: bool = False, dry_run: bool = False):
    """Generate and write src/scripts/data/traits.js dynamically from API trait data."""
    if equips is None:
        equips = get_cached_json(cache_dir, "nice_equip_lang_en.json", EQUIP_EXPORT_URL, force=force)

    traits_dict = fetch_and_build_trait_data(cache_dir, equips, force=force)

    # Sort keys: 4-digit standard traits first, then special traits numerically
    def sort_key(k: str):
        if len(k) == 4 and k.isdigit():
            return (0, int(k))
        return (1, int(k) if k.isdigit() else 99999999)

    sorted_keys = sorted(traits_dict.keys(), key=sort_key)

    lines = ["export const TRAIT_DATA = {"]
    for k in sorted_keys:
        val = traits_dict[k]
        lines.append(f'  "{k}": {json.dumps(val)},')
    lines.append("};\n")

    content = "\n".join(lines)

    if dry_run:
        print(f"[DRY-RUN] Would write {len(sorted_keys)} traits to {TRAITS_JS}")
        return

    os.makedirs(os.path.dirname(TRAITS_JS), exist_ok=True)
    with open(TRAITS_JS, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Successfully synchronized {len(sorted_keys)} traits into {TRAITS_JS}")


def update_craft_essences_js(ce_entries: List[dict], dry_run: bool = False):
    """Write src/scripts/data/craft_essences.js with formatted CE entries."""
    lines = ["export const CE_DATA = {"]
    for entry in ce_entries:
        key_repr = f'"{entry["id"]}"'
        lines.append(f"  {key_repr}: {{")
        lines.append(f'    name: {json.dumps(entry["name"])},')
        if entry.get("isGroup"):
            lines.append("    isGroup: true,")
            if entry.get("flatBonus"):
                lines.append(f'    flatBonus: {entry["flatBonus"]},')
            if entry.get("bonus"):
                lines.append(f'    bonus: {entry["bonus"]},')
            if entry.get("traits"):
                lines.append(f'    traits: {json.dumps(entry["traits"])},')
            if entry.get("groupImage"):
                lines.append(f'    groupImage: "{entry["groupImage"]}",')
            if entry.get("folder"):
                lines.append(f'    folder: "{entry["folder"]}",')
            lines.append("    options: {")
            for opt_id, opt in entry["options"].items():
                lines.append(f'      "{opt_id}": {{ name: {json.dumps(opt["name"])} }},')
            lines.append("    },")
        else:
            if entry.get("bonus"):
                lines.append(f'    bonus: {entry["bonus"]},')
            if entry.get("flatBonus"):
                lines.append(f'    flatBonus: {entry["flatBonus"]},')
            if entry.get("traits") is not None and not entry.get("traitGroups"):
                lines.append(f'    traits: {json.dumps(entry["traits"])},')
            if entry.get("matchAll"):
                lines.append("    matchAll: true,")
            if entry.get("traitGroups"):
                lines.append(f'    traitGroups: {json.dumps(entry["traitGroups"])},')
            if entry.get("alsoMatch"):
                lines.append(f'    alsoMatch: {json.dumps(entry["alsoMatch"])},')
        lines.append("  },")
    lines.append("};\n")
    content = "\n".join(lines)

    if dry_run:
        print(f"[DRY-RUN] Would write {len(ce_entries)} CE entries to {CE_DATA_JS}")
        return

    os.makedirs(os.path.dirname(CE_DATA_JS), exist_ok=True)
    with open(CE_DATA_JS, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Successfully synchronized {len(ce_entries)} Craft Essences into {CE_DATA_JS}")


def sync_craft_essences(cache_dir: str = os.path.join(BASE_DIR, ".cache", "atlas"), force: bool = False, dry_run: bool = False):
    """Synchronize all permanent Bond Gain Craft Essences, trait registry, and their icons."""
    print("Checking Atlas Academy API for latest Craft Essence data...")
    na_url = f"{API_BASE}/export/NA/basic_equip.json"
    na_names = {}
    try:
        na_data = get_cached_json(cache_dir, "na_basic_equip.json", na_url, force=force)
        na_names = {f"{eq.get('collectionNo', 0):04d}": eq.get("name", "").strip() for eq in na_data if eq.get("collectionNo")}
    except Exception as e:
        print(f"  [WARN] NA basic_equip fetch failed, falling back to JP names/overrides: {e}", file=sys.stderr)

    equip_data = get_cached_json(cache_dir, "nice_equip_lang_en.json", EQUIP_EXPORT_URL, force=force)
    ce_entries = extract_bond_craft_essences(equip_data, na_names=na_names)
    update_craft_essences_js(ce_entries, dry_run=dry_run)

    # Automatically fetch and generate traits from API & CE skills
    sync_traits_js(cache_dir=cache_dir, equips=equip_data, force=force, dry_run=dry_run)

    # Dynamic face icon sync
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from fetch_bordered_ces import sync_ces
        sync_ces(force=force, dry_run=dry_run, cache_dir=cache_dir)
    except Exception as e:
        print(f"Warning: CE icon sync failed: {e}", file=sys.stderr)


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


def main():
    parser = argparse.ArgumentParser(description="Incremental Atlas Academy Data Sync for FGO Calculator")
    parser.add_argument("--cache-dir", default=os.path.join(BASE_DIR, ".cache", "atlas"), help="Path to cache directory")
    parser.add_argument("--ids", nargs="+", help="Specific collection numbers to process (e.g. 482 481)")
    parser.add_argument("--delay", type=float, default=0.1, help="Polite delay between requests in seconds (default: 0.1s)")
    parser.add_argument("--clean-cache", action="store_true", help="Remove cache directory on finish to keep local files clean")
    parser.add_argument("--force", action="store_true", help="Force re-fetching and overwriting assets")
    parser.add_argument("--dry-run", action="store_true", help="Perform dry run without writing files")
    parser.add_argument("--skip-servants", action="store_true", help="Skip servant synchronization")
    parser.add_argument("--skip-ces", action="store_true", help="Skip Craft Essence synchronization")
    parser.add_argument("--skip-traits", action="store_true", help="Skip trait synchronization")
    args = parser.parse_args()

    # Configure global rate limiter delay
    rate_limiter.delay = max(0.0, args.delay)
    if rate_limiter.delay > 0:
        print(f"Polite rate limiter active: minimum {rate_limiter.delay}s delay between requests.")

    # 1. Sync Servants
    if not args.skip_servants:
        sync_servants(args)

    # 2. Sync Craft Essences & Traits
    if not args.skip_ces:
        sync_craft_essences(cache_dir=args.cache_dir, force=args.force, dry_run=args.dry_run)
    elif not args.skip_traits:
        sync_traits_js(cache_dir=args.cache_dir, force=args.force, dry_run=args.dry_run)

    if args.clean_cache:
        cleanup_cache_dir(args.cache_dir)

    print("Sync process completed.")


if __name__ == "__main__":
    main()
