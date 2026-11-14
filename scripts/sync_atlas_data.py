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
  - Writes src/scripts/data/bond_growth.js from the same cached servant export: the bond point cost of every
    bond level, deduped into shared tables.
  - Snapshots every farmable JP event shop (active ones, plus the latest ended farm event; or one
    event of any kind with --event-id) into src/scripts/data/event_shop.js as
    EVENT_SHOP_DATA.events[], each with item/currency/equip/costume icons as WebP under
    public/event_shop/, NA-first item names, the farm quest list with per-currency repeat drops
    and best quest ids from Atlas' community drop submissions, and the shop's upgrade trades.
    An API outage keeps the previous file, or writes an empty
    list stub so the build never dies.
"""

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from typing import Dict, List, Optional, Set, Tuple, Union
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "scripts", "data")
SERVANTS_JS = os.path.join(DATA_DIR, "servants.js")
TRAITS_JS = os.path.join(DATA_DIR, "traits.js")
CE_DATA_JS = os.path.join(DATA_DIR, "craft_essences.js")
BOND_GROWTH_JS = os.path.join(DATA_DIR, "bond_growth.js")
EVENT_SHOP_JS = os.path.join(DATA_DIR, "event_shop.js")
DEFAULT_SHOP_PROBE_FILE = os.path.join(BASE_DIR, ".ci-baselines", "shop_probe.json")
PUBLIC_SERVANTS_DIR = os.path.join(BASE_DIR, "public", "servants")
PUBLIC_EVENT_SHOP_DIR = os.path.join(BASE_DIR, "public", "event_shop")

API_BASE = "https://api.atlasacademy.io"
STATIC_BASE = "https://static.atlasacademy.io"
EQUIP_EXPORT_URL = f"{API_BASE}/export/JP/nice_equip_lang_en.json"
NA_NICE_TRAIT_URL = f"{API_BASE}/export/NA/nice_trait.json"
BASIC_SERVANT_URL = f"{API_BASE}/export/JP/basic_servant.json"
NICE_SERVANT_URL = f"{API_BASE}/export/JP/nice_servant_lore_lang_en.json"
BASIC_EVENT_URL = f"{API_BASE}/export/JP/basic_event.json"
NICE_ITEM_EXPORT_URL = f"{API_BASE}/export/JP/nice_item.json"
# Event shop name chain (Amendment E): NA item names first, then Atlas' JP-EN translations, then JP.
NA_NICE_ITEM_EXPORT_URL = f"{API_BASE}/export/NA/nice_item.json"
JP_ITEM_LANG_EN_EXPORT_URL = f"{API_BASE}/export/JP/nice_item_lang_en.json"
NA_BASIC_EQUIP_EXPORT_URL = f"{API_BASE}/export/NA/basic_equip.json"

# Event shop icon sizing: faces render at the card frame, item icons stay native up to this cap
EVENT_ICON_MAX_PX = 160
FACE_ICON_SIZE = (142, 155)

# Atlas bondGrowth is a 16-entry running total (levels 0..15); the app stores the step costs
BOND_GROWTH_LEVELS = 16

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
    "9409210": "Great Library of Memories",
    "2607": "Sword Saints of Wandering",
    "9409320": "Sword Saints of Wandering",
    "2701": "Gun Dealer",
    "9409490": "Gun Dealer",
}

# Unofficial English translations for JP-only Servants unreleased in NA
UNOFFICIAL_SERVANT_TRANSLATIONS = {
    "483": "Tamamo Aria",
    "406000": "Tamamo Aria",
}

CE_OVERRIDES = {}

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
    "600730": "Red Hood & Big Bad Wolf",
    "レッドフード＆ビッグバッドウルフ": "Red Hood & Big Bad Wolf",
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


def fetch_url(url: str, timeout: int = 15, retries: int = 4, if_none_match: Optional[str] = None) -> Tuple[Optional[bytes], Optional[str]]:
    """Fetch URL with polite rate-limiting, retries, gzip decompression, and HTTP 429 backoff.

    Returns (data, etag). On 304 (resource unchanged since if_none_match) returns (None, None).
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; FGOCalculatorDataSync/1.0)",
        "Accept-Encoding": "gzip",
    }
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    req = urllib.request.Request(url, headers=headers)
    last_err = None

    for attempt in range(retries):
        rate_limiter.wait()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data, resp.headers.get("ETag")
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return None, None
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


def _load_cached(cache_path: str) -> Optional[dict]:
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _stored_etag(cache_dir: str, filename: str) -> Optional[str]:
    etag_path = os.path.join(cache_dir, filename + ".etag")
    if os.path.exists(etag_path):
        try:
            with open(etag_path, "r", encoding="utf-8") as f:
                return f.read().strip() or None
        except Exception:
            return None
    return None


def _save_etag(cache_dir: str, filename: str, etag: Optional[str]):
    if etag:
        with open(os.path.join(cache_dir, filename + ".etag"), "w", encoding="utf-8") as f:
            f.write(etag)


def get_cached_json(cache_dir: str, filename: str, url: str, force: bool = False) -> dict:
    """Retrieve JSON payload, reading from cache with a conditional-GET revalidation."""
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, filename)

    if not force:
        cached = _load_cached(cache_path)
        if cached is not None:
            try:
                raw_bytes, etag = fetch_url(url, if_none_match=_stored_etag(cache_dir, filename))
                if raw_bytes is None:
                    return cached  # 304: server data unchanged
                data = json.loads(raw_bytes.decode("utf-8"))
                if data == cached:
                    # Body differs (e.g. encoding) but payload is identical.
                    _save_etag(cache_dir, filename, etag)
                    return data
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                _save_etag(cache_dir, filename, etag)
                return data
            except Exception as e:
                print(f"  [INFO] Offline/network error ({e}), using cached {filename}.")
                return cached

    raw_bytes, etag = fetch_url(url)
    data = json.loads(raw_bytes.decode("utf-8"))
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    _save_etag(cache_dir, filename, etag)
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

    # Always-on individualities Atlas keeps out of the servant's own trait list.
    # e.g. 2821 (Beast Servants) on Koyanskaya of Light (314) / Dark (334), whose
    # base traits only carry 2632. condType "none" + no eventId = not quest- or
    # event-gated. shortcut: only special traits (>1000) merge — the class-form
    # entries (Mash, idx = classId) add rarity/divine ids we already derive.
    extra_traits = [
        t.get("id")
        for e in (svt_data.get("traitAdd") or [])
        if e.get("condType") == "none" and not e.get("eventId")
        for t in e.get("trait", [])
        if (t.get("id") or 0) > 1000
    ]

    # Helper to parse and normalize trait list
    def parse_traits(tlist):
        tset = set()
        for t in list(tlist) + extra_traits:
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
        if cno in (377, 417, 444):
            tset.add("0124")
        return tset

    default_set = parse_traits(raw_traits)

    asc_add = svt_data.get("ascensionAdd", {})
    indiv_asc = asc_add.get("individuality", {}).get("ascension", {})
    # A servant's sub-attribute is NOT in the individuality lists: the server stores it in its own field,
    # where a late ascension overwrites it (415 Kuonji Alice is `human` at base and `earth` from her 3rd
    # ascension on; 465 Demeter `star`; 416 Hibiki & Chikagi `earth` then `star`; 444 U-Olga Marie
    # `human`). Reading only `individuality` loses it, which is why the Sub-Attribute row could never name
    # them. Same stage keys as individuality: 0/1 -> 000, 2 (or 1/0) -> 001, 3/4 (or 2) -> 002.
    attr_asc = asc_add.get("attribute", {}).get("ascension", {})
    ATTRIBUTE_TRAIT_IDS = {"sky": "0200", "earth": "0201", "human": "0202", "star": "0203", "beast": "0204"}
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

    # `attribute.ascension` is keyed 1..4 (the in-game ascension number), NOT individuality's 0..4, and
    # each stage says for itself: 1 -> 000, 2 -> 001, 3 or 4 -> 002. No fallback — 416 says earth for 1
    # and 2 but star for 3 and 4, and borrowing a later stage's word would invent an attribute she lacks.
    def attr_for(*api_stages):
        for st in api_stages:
            got = ATTRIBUTE_TRAIT_IDS.get(attr_asc.get(st))
            if got:
                return got
        return None

    def apply_attribute_overwrite(traits: set, trait_id) -> set:
        if not trait_id:
            return traits
        return {t for t in traits if not t.startswith("02")} | {trait_id}

    # The attribute replaces the family rather than joining it, so it is applied to the finished stage
    # lists. shortcut: a stage that changes attribute still carries the base one in the diff model, because
    # diffs are additive at runtime (see ServantData.load) — upgrade when a stage needs the old one gone.
    stage_sets["000"] = apply_attribute_overwrite(stage_sets["000"], attr_for("1"))
    stage_sets["001"] = apply_attribute_overwrite(stage_sets["001"], attr_for("2"))
    stage_sets["002"] = apply_attribute_overwrite(stage_sets["002"], attr_for("3", "4"))

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
        raw_label = c_info.get("shortName") or c_info.get("name")
        label = KNOWN_COSTUME_LABELS.get(c_str) or (KNOWN_COSTUME_LABELS.get(raw_label) if raw_label else None) or raw_label

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


def download_face_icon(folder_id: str, long_id: int, stage: Union[int, str] = "000", dest_filename: Optional[str] = None, battle_chara_id: Optional[int] = None, force: bool = False, dry_run: bool = False) -> bool:
    """Download bordered face icon from Atlas Academy CDN and save as 142x155 WebP."""
    stage_str = str(stage).zfill(3) if str(stage).isdigit() else str(stage)
    dest_dir = os.path.join(PUBLIC_SERVANTS_DIR, folder_id)
    dest_file = os.path.join(dest_dir, dest_filename or f"{stage_str}.webp")

    if not force and os.path.exists(dest_file):
        return True

    if dry_run:
        print(f"  [DRY-RUN] Would download face icon for {folder_id}/{stage_str} -> {dest_file}")
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
            raw_data, _ = fetch_url(url, timeout=10, retries=2)
            img = Image.open(io.BytesIO(raw_data)).convert("RGBA")
            if img.size != (142, 155):
                img = img.resize((142, 155), Image.Resampling.LANCZOS)
            img.save(dest_file, "WEBP", lossless=True, method=6)
            return True
        except Exception:
            continue

    print(f"  [WARN] Failed to download face icon for {folder_id}/{stage_str} (long_id={long_id})", file=sys.stderr)
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
    svt_id: str,
    name: str,
    base_traits: List[str],
    ascension_diffs: Dict[str, List[str]],
    option_labels: Optional[Dict[str, str]] = None,
    option_names: Optional[Dict[str, str]] = None,
    collection_no: Optional[int] = None,
    alt_id: Optional[str] = None,
) -> str:
    """Format a servant JS entry matching code conventions."""
    escaped_name = name.replace('"', '\\"')
    cno_part = f", collectionNo: {collection_no}" if collection_no is not None else ""

    if not ascension_diffs and not option_labels and not option_names and not alt_id:
        traits_json = json.dumps(base_traits)
        return f'  "{svt_id}": {{ name: "{escaped_name}"{cno_part}, traits: {{ base: {traits_json} }} }},'

    lines = [f'  "{svt_id}": {{']
    lines.append(f'    name: "{escaped_name}",')
    if collection_no is not None:
        lines.append(f'    collectionNo: {collection_no},')
    if alt_id:
        lines.append(f'    altId: "{alt_id}",')
    lines.append('    traits: {')
    lines.append(f'      base: {json.dumps(base_traits)},')
    for stage, diff in sorted(ascension_diffs.items()):
        stage_repr = stage if stage.isdigit() and int(stage) >= 300 else f'"{stage}"'
        lines.append(f'      {stage_repr}: {json.dumps(diff)},')
    lines.append('    },')
    if option_labels:
        labels_parts = [f'{k}: {json.dumps(v, ensure_ascii=False)}' for k, v in sorted(option_labels.items())]
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
            names_parts.append(f'{k_repr}: {json.dumps(v, ensure_ascii=False)}')
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


def update_servants_js_full(replace_entries: Dict[str, str], dry_run: bool = False):
    """Rewrite servants.js, replacing the entries for the given keys and re-sorting.

    Used when drifted (existing) servants must be updated in place — append-only
    insert cannot replace a key. Unchanged entries keep their original text."""
    if not os.path.exists(SERVANTS_JS):
        print("[ERROR] update_servants_js_full called without existing servants.js", file=sys.stderr)
        return

    with open(SERVANTS_JS, "r", encoding="utf-8") as f:
        content = f.read()

    match = re.search(r'(export\s+const\s+SERVANT_DATA\s*=\s*\{)([\s\S]*?)(\n\};)(.*)', content, re.DOTALL)
    if not match:
        print("[ERROR] Could not parse SERVANT_DATA in servants.js", file=sys.stderr)
        return
    header, body, footer, tail = match.groups()

    entries = {}
    # Top-level entries only (two-space indent). Key forms per format_servant_js_entry:
    # quoted when zero-padded ("001":) or dashed ("467-1":), unquoted otherwise (200:).
    for m in re.finditer(r"""(?:^|\n)  (?:"([0-9]+(?:-[0-9]+)?)":|([0-9]+):)(?=\s*\{)""", body):
        key = m.group(1) or m.group(2)
        start = body.index("{", m.end())  # position of the entry's "{"
        depth = 0
        end = start
        for pos in range(start, len(body)):
            if body[pos] == "{":
                depth += 1
            elif body[pos] == "}":
                depth -= 1
                if depth == 0:
                    end = pos + 1
                    break
        if end < len(body) and body[end] == ",":
            end += 1
        # Skip the leading newline consumed by the (?:^|\n) match anchor.
        text_start = m.start() + 1 if body[m.start() : m.start() + 1] == "\n" else m.start()
        entries[key] = body[text_start:end]

    replaced = [k for k in replace_entries if k in entries]
    if "505600" in replace_entries or "467" in replace_entries:
        entries.pop("467-1", None)
        entries.pop("467-2", None)
        entries.pop("467", None)

    # Drop any legacy collectionNo keys (< 10000 or containing a dash)
    for lk in [k for k in entries if "-" in k or (k.isdigit() and int(k) < 10000)]:
        entries.pop(lk, None)

    for k, v in replace_entries.items():
        entries[k] = v  # replace existing keys, add new ones

    def _sort_key(k: str):
        entry_text = entries.get(k, "")
        m = re.search(r"collectionNo:\s*([0-9]+)", entry_text)
        if m:
            return (int(m.group(1)), 0)
        base, _, suffix = k.partition("-")
        return (int(base) if base.isdigit() else 999999, int(suffix) if suffix and suffix.isdigit() else 0)

    new_body = "\n" + "\n".join(entries[k] for k in sorted(entries, key=_sort_key))

    if dry_run:
        print(f"[DRY-RUN] Would replace {len(replaced)} servant entries in servants.js: {replaced}")
        return

    with open(SERVANTS_JS, "w", encoding="utf-8") as f:
        f.write(header + new_body + footer + tail)

    print(f"Successfully replaced {len(replaced)} servant entries in {SERVANTS_JS}")


def _parse_servant_entries() -> Dict[str, str]:
    """Parse SERVANT_DATA into {key: entry text} (text includes the trailing comma).

    Key forms per format_servant_js_entry: quoted when zero-padded ("001")
    or dashed ("467-1"), unquoted otherwise (200). Only top-level (2-space
    indent) entries match."""
    if not os.path.exists(SERVANTS_JS):
        return {}
    with open(SERVANTS_JS, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"export\s+const\s+SERVANT_DATA\s*=\s*\{([\s\S]*)\};?\s*$", text)
    body = m.group(1) if m else text

    entries = {}
    for m in re.finditer(r"""(?:^|\n)  (?:"([0-9]+(?:-[0-9]+)?)":|([0-9]+):)(?=\s*\{)""", body):
        key = m.group(1) or m.group(2)
        start = body.index("{", m.end())  # position of the entry's "{"
        depth = 0
        end = start
        for pos in range(start, len(body)):
            if body[pos] == "{":
                depth += 1
            elif body[pos] == "}":
                depth -= 1
                if depth == 0:
                    end = pos + 1
                    break
        if end < len(body) and body[end] == ",":
            end += 1
        # Skip the leading newline consumed by the (?:^|\n) match anchor.
        text_start = m.start() + 1 if body[m.start() : m.start() + 1] == "\n" else m.start()
        entries[key] = body[text_start:end]
    return entries


def format_467_split(svt: dict) -> Dict[str, str]:
    """Format the François/Francesca Prélat (cno 467) unified entry.

    cno 467 is unified under single ID "505600" with traits from both forms:
    François ("0001") and Francesca ("0002"), omitting "0003" (unknown gender).
    altId is "505700", optionNames["001"] is "Francesca Prélat"."""
    base, _diffs, _ol, _on, _cb = extract_servant_traits(svt)
    traits = sorted(list((set(base) - {"0003"}) | {"0001", "0002"}), key=lambda x: (len(x), x))
    return {
        "505600": format_servant_js_entry(
            "505600",
            "François Prélat",
            traits,
            {},
            {},
            {"001": "Francesca Prélat"},
            collection_no=467,
            alt_id="505700",
        ),
    }


def revalidate_servant_traits(playable_by_cno: Dict[int, dict], nice_servants: List[dict]) -> List[int]:
    """Re-check existing servants against the bulk detail export.

    Atlas can alter an existing servant without adding a new one: base-trait
    changes, a new Spiritron Dress granting costume-stage traits (turning a
    base-only servant into a multi-ascension entry), or label/name changes.
    The basic export alone only reveals additions, so each stored entry is
    reformatted and diffed against the current file text (505600 via its unified
    entry, everyone else via format_servant_js_entry). The bulk fetch is one
    conditional GET (304 = ~0 bytes idle). Returns the collectionNos whose
    entry drifted (need a fresh entry)."""
    existing = _parse_servant_entries()
    if not existing:
        return []

    changed = []
    for s in nice_servants:
        cno = s.get("collectionNo", 0)
        if cno <= 0 or cno not in playable_by_cno:
            continue
        if cno == 467:
            fresh = format_467_split(s)
            if "467-1" in existing or "467-2" in existing or "467" in existing or fresh["505600"] != existing.get("505600"):
                print(f"  Entry change detected for servant 467 (split traits differ)")
                changed.append(cno)
            continue
        long_id = s.get("id")
        key = str(long_id) if long_id else (f"{cno:03d}" if cno < 100 else str(cno))
        old_key = f"{cno:03d}" if cno < 100 else str(cno)
        if key not in existing and old_key not in existing:
            continue
        base, asc_diffs, opt_labels, opt_names, _ = extract_servant_traits(s)
        name = UNOFFICIAL_SERVANT_TRANSLATIONS.get(key) or UNOFFICIAL_SERVANT_TRANSLATIONS.get(str(cno)) or s.get("name") or ""
        fresh = format_servant_js_entry(key, name, base, asc_diffs, opt_labels, opt_names, collection_no=cno)
        if key not in existing or fresh != existing[key]:
            print(f"  Entry change detected for servant {key} (traits/ascensions/labels differ)")
            changed.append(cno)
    if changed:
        print(f"Trait revalidation: {len(changed)} servant(s) drifted, will re-sync: {changed}")
    return changed


def _extra_image_stages(asc_diffs: Dict[str, List[str]], costume_battle_ids: Dict[str, int], opt_labels: Dict[str, str]) -> List[str]:
    """Stages needing face icons beyond standard 000-002 ascensions.

    A spiritron dress stage can appear without a trait diff (e.g. 388 "Serious
    Mode"), so it is not in asc_diffs — the validator still requires its image,
    hence the union with costume_battle_ids and option_labels.
    """
    return sorted((set(asc_diffs) | set(costume_battle_ids) | set(opt_labels)) - {"000", "001", "002"})


def migrate_servant_image_folders(playable_by_cno: Dict[int, dict], dry_run: bool = False):
    """One-time migration renaming existing public/servants/{cno} folders to {atlasId}.

    Idempotent: local checkouts and CI cache-restores rename existing image folders
    in place instead of redownloading. 467/000.webp -> 505600/000.webp, 467/001.webp -> 505700/000.webp.
    Leaves no leftover collectionNo-named folders.
    """
    if not os.path.isdir(PUBLIC_SERVANTS_DIR):
        return

    migrated = 0

    # 1. Servant 467 split portraits
    old_467 = os.path.join(PUBLIC_SERVANTS_DIR, "467")
    if os.path.isdir(old_467):
        if not dry_run:
            dir_505600 = os.path.join(PUBLIC_SERVANTS_DIR, "505600")
            dir_505700 = os.path.join(PUBLIC_SERVANTS_DIR, "505700")
            os.makedirs(dir_505600, exist_ok=True)
            os.makedirs(dir_505700, exist_ok=True)
            f000 = os.path.join(old_467, "000.webp")
            f001 = os.path.join(old_467, "001.webp")
            if os.path.exists(f000):
                dst = os.path.join(dir_505600, "000.webp")
                if not os.path.exists(dst):
                    shutil.move(f000, dst)
                else:
                    os.remove(f000)
            if os.path.exists(f001):
                dst = os.path.join(dir_505700, "000.webp")
                if not os.path.exists(dst):
                    shutil.move(f001, dst)
                else:
                    os.remove(f001)
            for extra in os.listdir(old_467):
                src = os.path.join(old_467, extra)
                dst = os.path.join(dir_505600, extra)
                if not os.path.exists(dst):
                    shutil.move(src, dst)
                else:
                    os.remove(src)
            try:
                os.rmdir(old_467)
            except OSError:
                pass
        migrated += 1

    # 2. All other playable servants
    for cno, s_info in playable_by_cno.items():
        if cno == 467:
            continue
        long_id = s_info.get("id")
        if not long_id:
            continue
        target_dir = os.path.join(PUBLIC_SERVANTS_DIR, str(long_id))
        candidates = [f"{cno:03d}", str(cno)]
        for cand in candidates:
            if cand == str(long_id):
                continue
            old_dir = os.path.join(PUBLIC_SERVANTS_DIR, cand)
            if os.path.isdir(old_dir):
                if not dry_run:
                    if not os.path.exists(target_dir):
                        os.rename(old_dir, target_dir)
                    else:
                        for item in os.listdir(old_dir):
                            src = os.path.join(old_dir, item)
                            dst = os.path.join(target_dir, item)
                            if not os.path.exists(dst):
                                shutil.move(src, dst)
                            else:
                                os.remove(src)
                        try:
                            os.rmdir(old_dir)
                        except OSError:
                            pass
                migrated += 1

    # 3. Clean up any leftover empty cno folders (numeric <= 4 digits)
    if not dry_run:
        for entry in os.listdir(PUBLIC_SERVANTS_DIR):
            folder = os.path.join(PUBLIC_SERVANTS_DIR, entry)
            if os.path.isdir(folder) and entry.isdigit() and int(entry) < 10000:
                try:
                    os.rmdir(folder)
                except OSError:
                    pass

    if migrated > 0:
        print(f"Migrated {migrated} servant image folder(s) to Atlas IDs.")


def sync_servants(args):
    """Check for new servants and sync traits and face icons."""
    print("Checking Atlas Academy API for latest servant data...")
    basic_data = get_cached_json(args.cache_dir, "basic_servant.json", BASIC_SERVANT_URL, force=args.force)

    existing_keys = load_existing_servant_keys()
    print(f"Current local dataset contains {len(existing_keys)} servants.")

    playable = [s for s in basic_data if s.get("type") in ("normal", "heroine")]
    playable_by_cno = {}
    for s in playable:
        cno = s.get("collectionNo", 0)
        if cno > 0:
            playable_by_cno[cno] = s

    # Ensure image folders are migrated to Atlas IDs
    migrate_servant_image_folders(playable_by_cno, dry_run=args.dry_run)

    servant_stages_map = load_all_servant_stages()

    # Bulk detail export: used for revalidating existing servants' traits and as
    # the fast path for new servants. Cached with conditional GET (304 on idle).
    nice_servants = []
    bulk_svt_map = {}
    if not args.dry_run:
        try:
            nice_servants = get_cached_json(args.cache_dir, "nice_servant_lore_lang_en.json", NICE_SERVANT_URL, force=args.force)
            bulk_svt_map = {s.get("id"): s for s in nice_servants if s.get("id")}
        except Exception as e:
            print(f"Bulk nice_servant_lore_lang_en.json fetch failed ({e}), trait revalidation skipped.", file=sys.stderr)

    if args.ids:
        target_cnos = []
        cno_by_id = {s.get("id"): cno for cno, s in playable_by_cno.items() if s.get("id")}
        for x in args.ids:
            if x.isdigit():
                val = int(x)
                if val in playable_by_cno:
                    target_cnos.append(val)
                elif val in cno_by_id:
                    target_cnos.append(cno_by_id[val])
    else:
        target_cnos = []
        for cno in sorted(playable_by_cno.keys()):
            s_info = playable_by_cno[cno]
            long_id = s_info.get("id")
            svt_id = "505600" if cno == 467 else str(long_id)

            has_existing = svt_id in existing_keys
            if cno == 467:
                img_missing = (
                    not os.path.exists(os.path.join(PUBLIC_SERVANTS_DIR, "505600", "000.webp")) or
                    not os.path.exists(os.path.join(PUBLIC_SERVANTS_DIR, "505700", "000.webp"))
                )
            else:
                expected_stages = servant_stages_map.get(svt_id, ["000"])
                img_missing = any(
                    not os.path.exists(os.path.join(PUBLIC_SERVANTS_DIR, svt_id, f"{st}.webp"))
                    for st in expected_stages
                )

            if not has_existing or img_missing:
                target_cnos.append(cno)

    # Re-check existing servants for trait drift (new costume traits, reworks).
    # The basic-export scan above only reveals additions; this diff catches
    # changes to existing servants using the cached bulk detail export.
    drifted_cnos = set()
    if not args.ids and nice_servants:
        drifted_cnos = set(revalidate_servant_traits(playable_by_cno, nice_servants))
        if drifted_cnos:
            target_cnos = list(target_cnos) + sorted(drifted_cnos - set(target_cnos))

    if not target_cnos:
        print("Servant dataset is already 100% up-to-date with Atlas Academy.")
        return

    print(f"Found {len(target_cnos)} servant(s) to synchronize: {target_cnos}")

    new_entries = {}
    full_replacement = any("-" in k or (k.isdigit() and int(k) < 10000) for k in existing_keys)
    for cno in target_cnos:
        s_info = playable_by_cno[cno]
        long_id = s_info.get("id")
        svt_id = "505600" if cno == 467 else str(long_id)

        has_existing = svt_id in existing_keys

        if not has_existing:
            svt_payload = bulk_svt_map.get(long_id)
            if svt_payload is None and not args.dry_run:
                print(f"Fetching new Servant {cno} (ID: {svt_id})...")
                svt_url = f"{API_BASE}/nice/JP/svt/{long_id}?lore=true&lang=en"
                svt_payload = get_cached_json(
                    os.path.join(args.cache_dir, "svt"),
                    f"{long_id}.json",
                    svt_url,
                    force=args.force
                )
            if svt_payload is None:
                print(f"  [DRY-RUN] Skipping new servant {svt_id} (bulk detail unavailable)")
                continue

            name = (
                UNOFFICIAL_SERVANT_TRANSLATIONS.get(svt_id)
                or UNOFFICIAL_SERVANT_TRANSLATIONS.get(str(cno))
                or svt_payload.get("name")
                or s_info.get("name", f"Servant {cno}")
            )
            base_traits, asc_diffs, opt_labels, opt_names, costume_battle_ids = extract_servant_traits(svt_payload)

            if cno == 467:
                # Handle François and Francesca Prélat unified entry
                download_face_icon("505600", 505600, stage="000", force=args.force, dry_run=args.dry_run)
                download_face_icon("505700", 505700, stage="000", force=args.force, dry_run=args.dry_run)
                new_entries.update(format_467_split(svt_payload))
                continue

            download_face_icon(svt_id, long_id, stage="000", force=args.force, dry_run=args.dry_run)
            if asc_diffs:
                download_face_icon(svt_id, long_id, stage="001", force=args.force, dry_run=args.dry_run)
                download_face_icon(svt_id, long_id, stage="002", force=args.force, dry_run=args.dry_run)
            for stage in _extra_image_stages(asc_diffs, costume_battle_ids, opt_labels):
                download_face_icon(svt_id, long_id, stage=stage, battle_chara_id=costume_battle_ids.get(stage), force=args.force, dry_run=args.dry_run)

            entry_code = format_servant_js_entry(svt_id, name, base_traits, asc_diffs, opt_labels, opt_names, collection_no=cno)
            new_entries[svt_id] = entry_code
        else:
            svt_payload = bulk_svt_map.get(long_id)
            if svt_payload is not None and cno in drifted_cnos:
                # Trait drift detected for this existing servant: replace its entry
                # with fresh data (name, traits, option labels) and backfill images.
                if cno == 467:
                    # The unified entry stores as "505600"; rebuild and download both portraits
                    download_face_icon("505600", 505600, stage="000", force=args.force, dry_run=args.dry_run)
                    download_face_icon("505700", 505700, stage="000", force=args.force, dry_run=args.dry_run)
                    new_entries.update(format_467_split(svt_payload))
                    full_replacement = True
                    continue
                name = (
                    UNOFFICIAL_SERVANT_TRANSLATIONS.get(svt_id)
                    or UNOFFICIAL_SERVANT_TRANSLATIONS.get(str(cno))
                    or svt_payload.get("name")
                    or s_info.get("name", f"Servant {cno}")
                )
                base_traits, asc_diffs, opt_labels, opt_names, costume_battle_ids = extract_servant_traits(svt_payload)
                download_face_icon(svt_id, long_id, stage="000", force=args.force, dry_run=args.dry_run)
                if asc_diffs:
                    download_face_icon(svt_id, long_id, stage="001", force=args.force, dry_run=args.dry_run)
                    download_face_icon(svt_id, long_id, stage="002", force=args.force, dry_run=args.dry_run)
                for stage in _extra_image_stages(asc_diffs, costume_battle_ids, opt_labels):
                    download_face_icon(svt_id, long_id, stage=stage, battle_chara_id=costume_battle_ids.get(stage), force=args.force, dry_run=args.dry_run)
                new_entries[svt_id] = format_servant_js_entry(svt_id, name, base_traits, asc_diffs, opt_labels, opt_names, collection_no=cno)
                full_replacement = True
            elif cno == 467:
                download_face_icon("505600", 505600, stage="000", force=args.force, dry_run=args.dry_run)
                download_face_icon("505700", 505700, stage="000", force=args.force, dry_run=args.dry_run)
            else:
                stages_to_fetch = servant_stages_map.get(svt_id, ["000"])
                for st in stages_to_fetch:
                    download_face_icon(svt_id, long_id, stage=st, force=args.force, dry_run=args.dry_run)

    if new_entries:
        if full_replacement:
            # Drifted entries replace existing keys: rewrite the whole file so the
            # updated entries land in sorted position (append-only insert cannot).
            update_servants_js_full(new_entries, dry_run=args.dry_run)
        else:
            update_servants_js(new_entries, dry_run=args.dry_run)


def sync_bond_growth(cache_dir: str = os.path.join(BASE_DIR, ".cache", "atlas"), force: bool = False, dry_run: bool = False):
    """Generate src/scripts/data/bond_growth.js — bond point cost of each level step per servant.

    Atlas' nice_servant_lore_lang_en.json carries `bondGrowth` as a RUNNING TOTAL: its [1] is 9,125 for
    Altria, the points from Lv.0 to Lv.2, so the Lv.1 -> Lv.2 step itself is 9,125 - 3,000 = 6,125. The
    emitted table is the per-step cost, where index i is what Lv.i -> Lv.i+1 asks for.
    Playable servants share only a few dozen distinct tables, so the file holds one table per shape plus
    a servant -> table key map instead of 16 numbers per servant.
    """
    basic_data = get_cached_json(cache_dir, "basic_servant.json", BASIC_SERVANT_URL, force=force)
    nice_servants = get_cached_json(cache_dir, "nice_servant_lore_lang_en.json", NICE_SERVANT_URL, force=force)
    total_by_id = {s.get("id"): s.get("bondGrowth") for s in nice_servants if s.get("id")}

    tables: Dict[str, str] = {}
    by_svt: Dict[str, str] = {}
    skipped = 0
    for s in basic_data:
        if s.get("type") not in ("normal", "heroine"):
            continue
        cno = s.get("collectionNo", 0)
        if cno <= 0:
            continue
        totals = total_by_id.get(s.get("id"))
        if not isinstance(totals, list) or len(totals) != BOND_GROWTH_LEVELS or not all(isinstance(v, int) and v > 0 for v in totals):
            skipped += 1
            continue
        steps = [totals[0]] + [totals[i] - totals[i - 1] for i in range(1, len(totals))]
        if not all(v > 0 for v in steps):
            skipped += 1
            continue
        svt_id = str(s.get("id"))
        canonical = json.dumps(steps)
        by_svt[svt_id] = tables.setdefault(canonical, f"t{len(tables)}")

    if skipped:
        print(f"[WARN] {skipped} playable servant(s) have no complete bondGrowth table; skipped.", file=sys.stderr)

    lines = ["export const BOND_TABLES = {"]
    for canonical, table_key in tables.items():
        lines.append(f'  "{table_key}": {canonical},')
    lines.append("};")
    lines.append("")
    lines.append("export const BOND_TABLE_BY_SVT = {")
    for svt_id in sorted(by_svt, key=lambda k: int(k)):
        lines.append(f'  "{svt_id}": "{by_svt[svt_id]}",')
    lines.append("};\n")
    content = "\n".join(lines)

    if dry_run:
        print(f"[DRY-RUN] Would write {len(by_svt)} servants over {len(tables)} bond tables to {BOND_GROWTH_JS}")
        return

    os.makedirs(os.path.dirname(BOND_GROWTH_JS), exist_ok=True)
    with open(BOND_GROWTH_JS, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Successfully synchronized {len(by_svt)} servants over {len(tables)} bond tables into {BOND_GROWTH_JS}")


# ==============================================================================
# Craft Essence Synchronization Engine
# ==============================================================================

def _bond_rates(vals: List[dict]) -> Tuple[float, int]:
    """Max bond percentage and flat gain over the non-event entries of one effect's value list."""
    max_rate = 0
    max_add = 0
    for sv in vals or []:
        if sv.get("EventId"):
            continue
        if "RateCount" in sv:
            val = sv["RateCount"] / 10
            max_rate = max(max_rate, int(val) if val.is_integer() else val)
        if "AddCount" in sv:
            max_add = max(max_add, sv["AddCount"])
    return max_rate, max_add


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
        max_rate, max_add = _bond_rates(f.get("svals"))
        # followerVals is the effect when the wearer is borrowed as a support servant (e.g. 0910).
        # shortcut: only the percentage differs today, no followerVals carries AddCount, so flat gains ignore it.
        support_rate, _support_add = _bond_rates(f.get("followerVals"))

        ce_id = str(ce.get("id"))
        cid_str = f"{cid:04d}"
        if cid_str in CE_OVERRIDES and "bonus" in CE_OVERRIDES[cid_str]:
            max_rate = CE_OVERRIDES[cid_str]["bonus"]
        elif ce_id in CE_OVERRIDES and "bonus" in CE_OVERRIDES[ce_id]:
            max_rate = CE_OVERRIDES[ce_id]["bonus"]

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
        if na_names and (ce_id in na_names or cid_str in na_names):
            raw_name = na_names.get(ce_id) or na_names.get(cid_str)
        elif ce_id in UNOFFICIAL_JP_TRANSLATIONS:
            raw_name = UNOFFICIAL_JP_TRANSLATIONS[ce_id]
        elif cid_str in UNOFFICIAL_JP_TRANSLATIONS:
            raw_name = UNOFFICIAL_JP_TRANSLATIONS[cid_str]
        elif ce_id in CE_OVERRIDES and "name" in CE_OVERRIDES[ce_id]:
            raw_name = CE_OVERRIDES[ce_id]["name"]
        elif cid_str in CE_OVERRIDES and "name" in CE_OVERRIDES[cid_str]:
            raw_name = CE_OVERRIDES[cid_str]["name"]

        prefix_match = re.match(r"^(.+?)(?:\s*[:：]\s*.+)?$", raw_name)
        base_title = prefix_match.group(1).strip() if prefix_match else raw_name

        parsed_ces.append({
            "cid": cid,
            "cid_str": cid_str,
            "ce_id": ce_id,
            "name": raw_name,
            "base_title": base_title,
            "flag": ce.get("flag"),
            "bonus": max_rate,
            "supportBonus": support_rate if support_rate and support_rate != max_rate else 0,
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
            and ce["supportBonus"] == prev["supportBonus"]
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
                options[opt["ce_id"]] = {"name": opt_name, "collectionNo": opt["cid"]}
                if "Mash" in opt_name:
                    group_image = opt["ce_id"]

            entry = {
                "id": first["ce_id"],
                "collectionNo": first["cid"],
                "name": group_name,
                "isGroup": True,
                "folder": f"{first['ce_id']}-{last['ce_id']}",
                "options": options,
            }
            if group_image:
                entry["groupImage"] = group_image
            if first["flatBonus"]:
                entry["flatBonus"] = first["flatBonus"]
            if first["bonus"]:
                entry["bonus"] = first["bonus"]
            if first["supportBonus"]:
                entry["supportBonus"] = first["supportBonus"]
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
                "id": first["ce_id"],
                "collectionNo": first["cid"],
                "name": first["name"],
            }
            if first["bonus"]:
                entry["bonus"] = first["bonus"]
            if first["supportBonus"]:
                entry["supportBonus"] = first["supportBonus"]
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
        lines.append(f'    collectionNo: {entry["collectionNo"]},')
        if entry.get("isGroup"):
            lines.append("    isGroup: true,")
            if entry.get("flatBonus"):
                lines.append(f'    flatBonus: {entry["flatBonus"]},')
            if entry.get("bonus"):
                lines.append(f'    bonus: {entry["bonus"]},')
            if entry.get("supportBonus"):
                lines.append(f'    supportBonus: {entry["supportBonus"]},')
            if entry.get("traits"):
                lines.append(f'    traits: {json.dumps(entry["traits"])},')
            if entry.get("groupImage"):
                lines.append(f'    groupImage: "{entry["groupImage"]}",')
            if entry.get("folder"):
                lines.append(f'    folder: "{entry["folder"]}",')
            lines.append("    options: {")
            for opt_id, opt in entry["options"].items():
                lines.append(f'      "{opt_id}": {{ name: {json.dumps(opt["name"])}, collectionNo: {opt["collectionNo"]} }},')
            lines.append("    },")
        else:
            if entry.get("bonus"):
                lines.append(f'    bonus: {entry["bonus"]},')
            if entry.get("supportBonus"):
                lines.append(f'    supportBonus: {entry["supportBonus"]},')
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
    """Synchronize all permanent Craft Essences, trait registry, and their icons."""
    print("Checking Atlas Academy API for latest Craft Essence data...")
    na_url = NA_BASIC_EQUIP_EXPORT_URL
    na_names = {}
    try:
        na_data = get_cached_json(cache_dir, "na_basic_equip.json", na_url, force=force)
        for eq in na_data:
            cno = eq.get("collectionNo", 0)
            eid = str(eq.get("id")) if eq.get("id") else ""
            name = eq.get("name", "").strip()
            if cno:
                na_names[f"{cno:04d}"] = name
            if eid:
                na_names[eid] = name
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


# ==============================================================================
# Event Shop Synchronization Engine
# ==============================================================================
#
# Amendment G: every event shop open right now is snapshotted (newest first) so the site can offer
# an Event Select instead of one hidden auto-pick. Inside each snapshot, Amendment E resolves names
# through the NA -> JP-EN -> JP chain, and Amendment F points a costume row at that costume's own
# face instead of the servant's 1st-ascension one. Amendment J prunes shops nobody can farm: an
# event is a farm event when a repeatable quest of its wars reports community drops for one of its
# shop currencies. Amendment L replaces the per-currency best-only farm map with the full quest
# list (every repeatable quest that pays a shop currency on REPEAT runs, first-time-only challenge
# rewards excluded), the per-currency best quest id, and the shop's upgrade trades (bronze -> silver
# -> gold exchanges read straight from the shop rows); the Event Select also carries the LATEST 1
# past farm event (capped newest-first scan) so players can plan high-level quests after a rerun.

EVENT_SHOP_STUB = {"events": []}

# A quest the game closes after one clear is not farmable; only these two repeat.
REPEATABLE_AFTER_CLEAR = ("repeatLast", "repeat")

# Amendment L1 past-event scan: how many ended events the newest-first scan reads before giving up.
FARM_FALLBACK_SCAN_CAP = 30

# The lore export is the only source naming a servant's costume details and it is 195 MB, so it is
# read at most once per run, and only when a servant ships more than one costume.
LORE_EXPORT_FILENAME = "nice_servant_lore_lang_en.json"

# Icon files already produced this run, keyed "kind_id" -> site-relative path (unique URLs fetched once)
_event_icon_results: Dict[str, Optional[str]] = {}
# servant id -> lore entry, built only when a costume detail has to be named; None means "not read"
_servant_lore: Optional[Dict[int, dict]] = None
# Event details and farmable quests already read this run (Amendment J): the farm-event test runs
# before the snapshot and --force re-downloads uncached reads, so both share one fetch per file.
_event_detail_results: Dict[int, dict] = {}
_farm_quests_results: Dict[tuple, List[dict]] = {}


def _atlas_asset_url(path: str) -> str:
    """Absolute CDN URL for an Atlas asset path like 'JP/Items/1604.png' (leading slash tolerated)."""
    clean = str(path).lstrip("/")
    return clean if clean.startswith("http") else f"{STATIC_BASE}/{clean}"


def load_nice_item_map(cache_dir: str, force: bool = False) -> Dict[int, dict]:
    """Atlas JP item export keyed by id. Icon paths vary (coins live under JP/Coins/), so the map — not
    a filename pattern — is the only reliable id -> icon source for purchaseType "item"."""
    data = get_cached_json(cache_dir, "nice_item.json", NICE_ITEM_EXPORT_URL, force=force)
    entries = data.values() if isinstance(data, dict) else data
    return {it.get("id"): it for it in entries if it.get("id")}


def select_events(basic_events: List[dict], override_id: Optional[int] = None, now: Optional[int] = None) -> List[dict]:
    """The events to snapshot: --event-id takes only that event, else every eventQuest whose shop
    window is open right now, newest startedAt first. Python's sort is stable, so events sharing a
    startedAt keep the API's own list order."""
    events = basic_events if isinstance(basic_events, list) else []
    if override_id is not None:
        return [e for e in events if e.get("id") == override_id]
    moment = int(time.time()) if now is None else now
    return sorted((e for e in events if _shop_window_open(e, moment)), key=lambda e: -(e.get("startedAt") or 0))


def _shop_window_open(event: dict, moment: int) -> bool:
    """startedAt <= now < finishedAt on an eventQuest. An event with no finishedAt has no window."""
    return (
        event.get("type") == "eventQuest"
        and (event.get("startedAt") or 0) <= moment
        and moment < (event.get("finishedAt") or 0)
    )


def _select_farm_events(cache_dir: str, basic_events: List[dict], now: Optional[int] = None, force: bool = False) -> List[dict]:
    """Amendment L1 selection: every ACTIVE farm event plus the LATEST 1 past farm event.

    A farm-event fetch that raises skips only that event on the active pass — its open siblings
    still ship. The past scan raises when nothing active passed: there the caller could not prove
    nothing farmable exists, and writing the stub would replace a good previous file on one hiccup.
    With at least one active farm event shipping, a past-scan hiccup only loses the history entry."""
    moment = int(time.time()) if now is None else now
    passing = []
    for event in select_events(basic_events, now=moment):
        try:
            if _farm_event_passes(cache_dir, event, force=force):
                passing.append(event)
        except Exception as e:
            print(f"  [WARN] Event {event.get('id')} farm test fetch failed, skipped: {e}", file=sys.stderr)
    live_ids = {event.get("id") for event in passing}
    past = None
    try:
        past = _latest_past_farm_event(cache_dir, basic_events, moment, live_ids, force=force)
    except Exception as e:
        if not passing:
            raise
        print(f"  [WARN] Past farm event scan failed, history entry skipped: {e}", file=sys.stderr)
    if past:
        passing.append(past)
    return sorted(passing, key=lambda e: -(e.get("startedAt") or 0))


def _latest_past_farm_event(
    cache_dir: str, basic_events: List[dict], now: int, live_ids: Set[int], force: bool = False
) -> Optional[dict]:
    """Amendment L1: the newest ENDED eventQuest that passes the farm-event test, scanned
    newest-startedAt-first and capped at FARM_FALLBACK_SCAN_CAP. Atlas keeps historical drop
    data, so a closed event stays a usable farm reference for the planner."""
    events = basic_events if isinstance(basic_events, list) else []
    ended = sorted(
        (
            e
            for e in events
            if isinstance(e, dict)
            and e.get("type") == "eventQuest"
            and e.get("id") not in live_ids
            and (e.get("finishedAt") or 0)
            and (e.get("finishedAt") or 0) <= now
        ),
        key=lambda e: -(e.get("startedAt") or 0),
    )
    for event in ended[:FARM_FALLBACK_SCAN_CAP]:
        if _farm_event_passes(cache_dir, event, force=force):
            return event
    return None


def _farm_event_passes(cache_dir: str, event: dict, force: bool = False) -> bool:
    """Amendment J farm-event test: the event's shop has rows, and at least one repeatable quest
    (afterClear repeatLast|repeat, free or raid) in its wars reports community drops for at least
    one of the shop's own currencies on REPEAT runs — the same quests the snapshot ships (Amendment
    L's challenge exclusion included). A campaign exchange shop (no war) and a memorial battle
    (quests without submissions) both fail it. Reads the same event/war/quest files the snapshot's
    farm collection reads, once per run; a fetch that cannot be read raises, never a silent prune."""
    detail = _event_detail(cache_dir, event, force=force)
    currency_ids = _shop_currency_ids(_shop_entries(detail))
    if not currency_ids:
        return False
    war_ids = (detail or {}).get("warIds") or event.get("warIds") or []
    quests = _collect_farm_quests(cache_dir, war_ids, force=force, strict=True)
    return any(_farm_quest_entry(quest, currency_ids) for quest in quests)


def _shop_currency_ids(entries: List[dict]) -> List[int]:
    """Distinct cost.item ids of the raw shop rows — the currencies the farm test prices."""
    ids = []
    for entry in entries:
        cid = ((entry.get("cost") or {}).get("item") or {}).get("id")
        if cid and cid not in ids:
            ids.append(cid)
    return ids


def _shop_trades(entries: List[dict], currency_ids: List[int]) -> List[dict]:
    """Upgrade trades (Amendment L8): shop rows that sell one currency in exchange for another —
    purchaseType "item" whose target is a shop currency, paid for with a different shop currency.
    The in-game exchange rate is costAmount per getNum (10 bronze for 1 silver), the rows are
    unlimited, and trading costs no AP — the optimizer treats the chain as a free coverage source.
    Sorted (fromId, toId) so the generated file is byte-stable across syncs."""
    currencies = set(currency_ids)
    trades = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("purchaseType") != "item":
            continue
        cost = entry.get("cost") or {}
        from_id = (cost.get("item") or {}).get("id")
        targets = entry.get("targetIds") or []
        to_id = targets[0] if targets else None
        cost_amount = int(cost.get("amount") or 0)
        get_num = int(entry.get("setNum") or 0)
        if not from_id or from_id == to_id or to_id not in currencies or cost_amount <= 0 or get_num <= 0:
            continue
        trades.append({"fromId": from_id, "toId": to_id, "costAmount": cost_amount, "getNum": get_num})
    return sorted(trades, key=lambda t: (t["fromId"], t["toId"]))


def _export_by_id(cache_dir: str, filename: str, url: str, force: bool = False) -> Dict[int, dict]:
    """One Atlas export keyed by id. A source the name chain reads is optional: an outage leaves the
    map empty and the chain falls through to the next language rather than killing the sync."""
    try:
        data = get_cached_json(cache_dir, filename, url, force=force)
    except Exception as e:
        print(f"  [WARN] {filename} unavailable, name chain falls back: {e}", file=sys.stderr)
        return {}
    entries = data.values() if isinstance(data, dict) else data
    return {it.get("id"): it for it in entries if it.get("id")}


def load_event_name_maps(cache_dir: str, item_map: Dict[int, dict], force: bool = False) -> Dict[str, Dict[int, dict]]:
    """Every export the shop name chains read (Amendment E). The JP item map is the one the sync
    already loaded for icons, so it is passed in rather than fetched twice."""
    return {
        "na": _export_by_id(cache_dir, "na_nice_item.json", NA_NICE_ITEM_EXPORT_URL, force=force),
        "jpEn": _export_by_id(cache_dir, "nice_item_lang_en.json", JP_ITEM_LANG_EN_EXPORT_URL, force=force),
        "jp": item_map,
        "naEquips": _export_by_id(cache_dir, "na_basic_equip.json", NA_BASIC_EQUIP_EXPORT_URL, force=force),
    }


def resolve_item_name(item_id: Optional[int], na_map: dict, jp_en_map: dict, jp_map: dict) -> str:
    """Amendment E chain: NA name -> Atlas JP-EN name -> JP name, "" when no map knows the id.
    Atlas' JP-EN export carries the Japanese text for an untranslated item, so an event currency
    nobody has translated simply comes back with the same name the JP export gives it."""
    for source in (na_map, jp_en_map, jp_map):
        name = ((source or {}).get(item_id) or {}).get("name")
        if name:
            return name
    return ""


def resolve_equip_name(equip_id: Optional[int], entry: dict, names: Dict[str, Dict[int, dict]], detail: dict) -> str:
    """Craft-essence and servant rows: NA equip name -> the per-id lang=en name -> the shop entry's
    own name. Event CEs are absent from the NA export, so the detail name carries them."""
    for source in ((names.get("naEquips") or {}).get(equip_id), detail, entry):
        name = (source or {}).get("name")
        if name:
            return name
    return ""


# --- Farm model (Amendment L): every repeatable quest that pays a shop currency on repeat runs ---


def _war_repeatable_quests(cache_dir: str, war_id: int, force: bool = False, strict: bool = False) -> List[Tuple[dict, dict]]:
    """(spot, quest) pairs of one war the game reopens after a clear; a war that cannot be read has
    none. Strict is the farm-event test's call: there an unreadable war raises, because a swallowed
    read looks exactly like an event with no repeatable quests and would silently prune a good shop."""
    try:
        war = get_cached_json(cache_dir, f"nice_war_{war_id}.json", f"{API_BASE}/nice/JP/war/{war_id}?lang=en", force=force)
    except Exception as e:
        if strict:
            raise
        print(f"  [WARN] War {war_id} unavailable, farm data skipped: {e}", file=sys.stderr)
        return []
    spots = war.get("spots") if isinstance(war, dict) else None
    return [
        (spot, quest)
        for spot in (spots or [])
        for quest in (spot.get("quests") or [])
        if quest.get("afterClear") in REPEATABLE_AFTER_CLEAR
    ]


def _quest_phase_detail(cache_dir: str, quest: dict, force: bool = False, strict: bool = False) -> Optional[dict]:
    """Drops are published per released phase, so the highest phase is the quest players farm today.
    The war payload lists the phases a quest has, and the detail carries the community submissions.
    Strict (the farm-event test) lets the read failure through for the same reason as the war read."""
    quest_id = quest.get("id")
    phase = max(quest.get("phases") or [0])
    try:
        return get_cached_json(
            cache_dir, f"nice_quest_{quest_id}_{phase}.json", f"{API_BASE}/nice/JP/quest/{quest_id}/{phase}?lang=en", force=force
        )
    except Exception as e:
        if strict:
            raise
        print(f"  [WARN] Quest {quest_id} phase {phase} unavailable: {e}", file=sys.stderr)
        return None


def _farm_quest(quest: dict, detail: dict, spot: Optional[dict] = None) -> dict:
    """The farm candidate: what the quest asks and pays, plus its repeat drop lines, first-clear
    gifts, and raid/boss grouping metadata."""
    quest_name = detail.get("name") or quest.get("name") or ""
    spot_obj = spot or {}
    return {
        "questId": quest.get("id"),
        "phase": max(quest.get("phases") or [0]),
        "questName": quest_name,
        "recommendLv": detail.get("recommendLv") or quest.get("recommendLv") or "",
        "ap": int(detail.get("consume") or quest.get("consume") or 0),
        "drops": detail.get("drops") or [],
        "gifts": detail.get("gifts") or [],
        "isRaid": "raid" in (quest.get("flags") or []),
        "bossId": spot_obj.get("id") or quest.get("spotId") or quest.get("id"),
        "bossName": spot_obj.get("name") or detail.get("spotName") or quest_name,
    }


def _collect_farm_quests(cache_dir: str, war_ids: List[int], force: bool = False, strict: bool = False) -> List[dict]:
    """Every farmable quest of the event, with drops — read once per distinct war-id set per run
    (Amendment J): the farm-event test walks the wars first and the snapshot's farm collection
    gets the same list from the memo instead of a second download of every war and quest.
    strict marks the test path: a war or quest that cannot be read raises rather than contributing
    an empty list, so an outage is never mistaken for "not a farm event" and pruned. The snapshot
    stays lenient (an empty quest list), and a raise leaves this memo untouched."""
    key = tuple(war_ids or [])
    if key not in _farm_quests_results:
        quests = []
        for war_id in key:
            for spot, quest in _war_repeatable_quests(cache_dir, war_id, force=force, strict=strict):
                detail = _quest_phase_detail(cache_dir, quest, force=force, strict=strict)
                if detail:
                    quests.append(_farm_quest(quest, detail, spot=spot))
        _farm_quests_results[key] = quests
    return _farm_quests_results[key]


def _drop_rows(quests: List[dict], currency_id: int) -> List[dict]:
    """Every reported drop line of one currency, ranked by items per run.

    A quest can list the same currency at several stack sizes (600/700/1000/2000 of an item), and
    each line is its own community figure, so each is a candidate: amount per run is dropExpected
    (stacks per run) times num (units per stack)."""
    rows = []
    for quest in quests:
        for drop in quest["drops"]:
            row = _drop_row(quest, drop, currency_id)
            if row:
                rows.append(row)
    rows.sort(key=lambda row: (-row["amount"], row["questId"]))
    return rows


def _drop_row(quest: dict, drop: dict, currency_id: int) -> Optional[dict]:
    """One drop line as a farm candidate; None when it is another item or has no submissions yet."""
    if drop.get("objectId") != currency_id:
        return None
    expected = drop.get("dropExpected")
    num = drop.get("num") or 0
    if not isinstance(expected, (int, float)) or expected <= 0 or num <= 0:
        return None
    return {
        "questId": quest["questId"],
        "questName": quest["questName"],
        "recommendLv": quest["recommendLv"],
        "ap": quest["ap"],
        "dropExpected": round(float(expected), 4),
        "num": int(num),
        "sampleRuns": int(drop.get("runs") or 0),
        "amount": float(expected) * num,
    }


def _first_time_only_reward(quest: dict, shop_currency_ids: List[int], drops: Dict[str, dict]) -> bool:
    """Amendment L2 challenge exclusion: the quest pays a shop currency once on first clear (it is in
    the gifts) but never again on a repeat run (it is not in the repeat drops), so its farm-item
    reward is first-time-only and the quest is not farmable for the shop."""
    gift_ids = {
        gift.get("objectId")
        for gift in quest.get("gifts") or []
        if gift.get("objectId") in shop_currency_ids
    }
    return any(str(currency_id) not in drops for currency_id in gift_ids)


_REC_SUFFIX_RANK = {"": 0, "+": 1, "++": 2, "+++": 3, "★": 4}
_REC_LV_RE = re.compile(r"^\s*(\d+)\s*(.*)$")


def _quest_shop_drops(quest: dict, shop_currency_ids: List[int]) -> Tuple[Dict[str, dict], int]:
    """Best repeat-drop line per shop currency for one quest, plus max sampleRuns (0 when none)."""
    rows = {str(currency_id): (_drop_rows([quest], currency_id) or [None])[0] for currency_id in shop_currency_ids}
    drops = {key: {"dropExpected": row["dropExpected"], "num": row["num"]} for key, row in rows.items() if row}
    sample_runs = max((row["sampleRuns"] for row in rows.values() if row), default=0)
    return drops, sample_runs


def _farm_quest_entry(quest: dict, shop_currency_ids: List[int]) -> Optional[dict]:
    """The shipped farm card for one quest: its per-currency repeat drops plus the reported-run
    count. None when the quest repeats no shop currency at all, or when a gift-only shop-currency
    reward marks it a challenge quest (Amendment L2). sampleRuns is the highest run count among the
    drop lines the card ships."""
    drops, sample_runs = _quest_shop_drops(quest, shop_currency_ids)
    if not drops or _first_time_only_reward(quest, shop_currency_ids, drops):
        return None
    return {
        "questId": quest["questId"],
        "questName": quest["questName"],
        "recommendLv": quest["recommendLv"],
        "ap": quest["ap"],
        "sampleRuns": sample_runs,
        "drops": drops,
    }


def _raid_difficulty_label(quest_name: str, boss_name: str) -> str:
    """Strip leading bossName + whitespace from questName; fall back to questName if empty."""
    if boss_name and quest_name.startswith(boss_name):
        stripped = quest_name[len(boss_name) :].lstrip()
        if stripped:
            return stripped
    return quest_name


def _rec_lv_sort_key(quest: dict) -> Tuple[int, int, int, int]:
    """Sort key for REC Lv descending (numeric desc, suffix rank desc, missing last, tie questId asc)."""
    raw = quest.get("recommendLv")
    text = "" if raw is None else str(raw).strip()
    match = _REC_LV_RE.match(text)
    if not match:
        return (1, 0, 0, quest["questId"])
    level = int(match.group(1))
    suffix = match.group(2).strip()
    suffix_rank = _REC_SUFFIX_RANK.get(suffix, 5)
    return (0, -level, -suffix_rank, quest["questId"])


def _raid_quest_entry(quest: dict, shop_currency_ids: List[int]) -> Optional[dict]:
    """One raid difficulty entry; kept even when drops is {} and sampleRuns is 0, unless first-time-only."""
    drops, sample_runs = _quest_shop_drops(quest, shop_currency_ids)
    if _first_time_only_reward(quest, shop_currency_ids, drops):
        return None
    rec_lv = quest.get("recommendLv")
    return {
        "questId": quest["questId"],
        "questName": quest["questName"],
        "difficultyLabel": _raid_difficulty_label(quest["questName"], quest.get("bossName") or ""),
        "recommendLv": "" if rec_lv is None else str(rec_lv),
        "ap": quest["ap"],
        "sampleRuns": sample_runs,
        "drops": drops,
    }


def _collect_raids(quests: List[dict], currency_ids: List[int]) -> List[dict]:
    """Group repeatable raid-flagged quests by boss spot, sorted by bossId asc and REC Lv desc."""
    bosses: Dict[int, dict] = {}
    for quest in quests:
        if not quest.get("isRaid"):
            continue
        entry = _raid_quest_entry(quest, currency_ids)
        if not entry:
            continue
        boss_id = quest.get("bossId") or quest["questId"]
        boss_name = quest.get("bossName") or quest["questName"]
        if boss_id not in bosses:
            bosses[boss_id] = {"bossId": boss_id, "bossName": boss_name, "quests": []}
        bosses[boss_id]["quests"].append(entry)
    result = []
    for boss_id in sorted(bosses):
        boss = bosses[boss_id]
        boss["quests"].sort(key=_rec_lv_sort_key)
        result.append(boss)
    return result


def _farm_best(quests: List[dict], shop_currency_ids: List[int]) -> Dict[str, int]:
    """{ currencyId: questId } — the quest dropping this currency most per run (dropExpected×num),
    ties to the lower quest id. A currency no shipped quest drops has no key at all: the site reads
    a missing key as "no best quest" rather than a null entry."""
    best = {}
    for currency_id in shop_currency_ids:
        key = str(currency_id)
        candidates = [quest for quest in quests if key in quest["drops"]]
        if not candidates:
            continue
        top = min(candidates, key=lambda quest: (-quest["drops"][key]["dropExpected"] * quest["drops"][key]["num"], quest["questId"]))
        best[key] = top["questId"]
    return best


def _collect_farm(cache_dir: str, war_ids: List[int], currency_ids: List[int], force: bool = False) -> dict:
    """farm = { quests: [repeat-drop free quests], best: { currencyId: questId }, raids: [boss groups] }.
    Free Quests and Raid Bosses are separated by the 'raid' quest flag; an event with no wars has
    empty lists and an empty best map."""
    quests = _collect_farm_quests(cache_dir, war_ids, force=force) if war_ids else []
    free_quests = [quest for quest in quests if not quest.get("isRaid")]
    shipped = [entry for entry in (_farm_quest_entry(quest, currency_ids) for quest in free_quests) if entry]
    return {"quests": shipped, "best": _farm_best(shipped, currency_ids), "raids": _collect_raids(quests, currency_ids)}


# --- Costume faces (Amendment F): the costume detail, not the servant's base face ---


def _servant_lore_map(cache_dir: str) -> Dict[int, dict]:
    """servant id -> lore entry, read from the cache when it is there and fetched only when it is
    not. The export is 195 MB and is never re-downloaded on --force: the servants step of a full
    sync keeps it current, and this is only reached for a servant with more than one costume."""
    global _servant_lore
    if _servant_lore is not None:
        return _servant_lore
    cached = _load_cached(os.path.join(cache_dir, LORE_EXPORT_FILENAME))
    data = cached if cached is not None else get_cached_json(cache_dir, LORE_EXPORT_FILENAME, NICE_SERVANT_URL)
    _servant_lore = {s.get("id"): s for s in (data if isinstance(data, list) else []) if s.get("id")}
    return _servant_lore


def _costume_material_keys(servant_id: int, cache_dir: str, force: bool = False) -> List[str]:
    """costumeMaterials keys of a servant — the costume DETAIL ids its costume release can hand out."""
    try:
        servant = get_cached_json(
            cache_dir, f"nice_servant_{servant_id}.json", f"{API_BASE}/nice/JP/servant/{servant_id}?lang=en", force=force
        )
    except Exception as e:
        print(f"  [WARN] Servant {servant_id} detail unavailable, costume face unresolved: {e}", file=sys.stderr)
        return []
    return list((servant.get("costumeMaterials") or {}).keys())


def _costume_detail_from_lore(servant_id: int, costume_limit: int, cache_dir: str) -> Optional[str]:
    """profile.costume is keyed by costume detail id and each entry carries the costumeLimit as id,
    which is the last two digits of the shop's costumeRelease target."""
    entry = _servant_lore_map(cache_dir).get(servant_id) or {}
    costumes = (entry.get("profile") or {}).get("costume") or {}
    for detail_id, costume in costumes.items():
        if (costume or {}).get("id") == costume_limit:
            return str(detail_id)
    return None


def _costume_detail_id(target: int, cache_dir: str, force: bool = False) -> Optional[str]:
    """Which costume face this release target buys: one material key is unambiguous, several need the
    lore export to name the limit the shop sold."""
    servant_id = target // 100
    keys = _costume_material_keys(servant_id, cache_dir, force=force)
    if len(keys) == 1:
        return str(keys[0])
    if len(keys) > 1:
        return _costume_detail_from_lore(servant_id, target % 100, cache_dir)
    return None


def _costume_asset_path(target: int, cache_dir: str, force: bool = False) -> str:
    """Atlas asset path for a costume release: the costume face, or the servant base face plus a
    WARN when Atlas gives nothing to disambiguate it with."""
    detail_id = _costume_detail_id(target, cache_dir, force=force)
    servant_id = target // 100
    if not detail_id:
        print(f"  [WARN] Costume {target}: no costume face resolved, keeping servant {servant_id} base face", file=sys.stderr)
        return f"JP/Faces/f_{servant_id}0.png"
    return f"JP/Faces/f_{detail_id}0.png"


def _equip_detail(equip_id: int, cache_dir: str, force: bool = False) -> dict:
    """Per-id equip detail (cached): faces for the icon, name for the chain. An event CE is not in
    the NA export, so this is where its readable name comes from."""
    try:
        return get_cached_json(cache_dir, f"nice_equip_{equip_id}.json", f"{API_BASE}/nice/JP/equip/{equip_id}?lang=en", force=force)
    except Exception as e:
        print(f"  [WARN] Equip {equip_id} detail fetch failed: {e}", file=sys.stderr)
        return {}


def _equip_face_asset_path(equip: dict) -> Optional[str]:
    """Face path from an equip detail: equip faces first, then any other face group (hero crystals
    and materials carry faces.ascension, CEs carry faces.equip)."""
    faces = (equip.get("extraAssets") or {}).get("faces") or {}
    ordered_groups = sorted(faces, key=lambda g: g != "equip")
    for group in ordered_groups:
        entries = faces[group] or {}
        ordered = sorted(entries, key=lambda k: int(k) if str(k).isdigit() else 99)
        if ordered:
            return entries[ordered[0]]
    return None


def _resolve_entry_icon(entry: dict, item_map: Dict[int, dict], cache_dir: str, targets: Optional[list] = None, force: bool = False) -> Optional[Tuple[str, int, str]]:
    """(kind, id, Atlas asset path) for a shop entry's reward icon, or None when unresolvable.

    targets may be pre-extracted by the caller (_shop_item needs targetIds for the name fallback
    anyway); None re-reads them from the entry for standalone callers. Costume rows resolve through
    _costume_asset_path, which falls back to the servant base face when Atlas gives no detail id."""
    purchase_type = entry.get("purchaseType")
    if targets is None:
        targets = entry.get("targetIds") or []
    target = targets[0] if targets else None
    if target is None:
        return None
    if purchase_type == "item":
        return ("item", target, (item_map.get(target) or {}).get("icon"))
    if purchase_type in ("servant", "equip"):
        return ("equip", target, _equip_face_asset_path(_equip_detail(target, cache_dir, force=force)))
    if purchase_type == "costumeRelease":
        return ("costume", target, _costume_asset_path(target, cache_dir, force=force))
    return None


def _make_event_icon(asset_path: str, dest: str, kind: str):
    """Fetch one Atlas asset and encode it as lossless WebP (faces 142x155, item icons capped 160px).

    Bordered variant first (user directive); the plain variant of the SAME asset is fetched only
    when the bordered URL 404s (coins have no bordered art). Any other fetch error — 5xx, timeout —
    re-raises instead of falling back: _event_icon_file never re-fetches an existing dest, so a
    transient failure would otherwise permanently ship a borderless icon. The caller's WARN fires
    and no file is written, so the next sync retries the bordered asset."""
    bordered = re.sub(r"\.png$", "_bordered.png", asset_path)
    try:
        raw, _ = fetch_url(_atlas_asset_url(bordered), timeout=10, retries=2)
    except Exception as e:
        # Match the HTTPError phrase, not bare "404": the message embeds the URL, and asset ids
        # like f_94045200 contain "404", which would misread a bordered 5xx/timeout as a 404.
        if "HTTP Error 404" not in str(e):
            raise
        print(f"  [INFO] plain-variant fallback for {asset_path}")
        raw, _ = fetch_url(_atlas_asset_url(asset_path), timeout=10, retries=2)
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    if kind == "item":
        if max(img.size) > EVENT_ICON_MAX_PX:
            img.thumbnail((EVENT_ICON_MAX_PX, EVENT_ICON_MAX_PX), Image.Resampling.LANCZOS)
    else:
        img = img.resize(FACE_ICON_SIZE, Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    img.save(dest, "WEBP", lossless=True, method=6)


def _event_icon_file(kind: str, ident: int, asset_path: Optional[str], force: bool = False, dry_run: bool = False) -> Optional[str]:
    """Ensure public/event_shop/{kind}_{id}.webp exists; return the site-relative path or None."""
    if not asset_path:
        return None
    cache_key = f"{kind}_{ident}"
    if cache_key in _event_icon_results:
        return _event_icon_results[cache_key]
    dest = os.path.join(PUBLIC_EVENT_SHOP_DIR, f"{cache_key}.webp")
    if dry_run:
        print(f"  [DRY-RUN] Would fetch {asset_path} -> event_shop/{cache_key}.webp")
        return f"event_shop/{cache_key}.webp"
    if not os.path.exists(dest) or force:
        try:
            _make_event_icon(asset_path, dest, kind)
        except Exception as e:
            print(f"  [WARN] Event icon fetch failed for {asset_path}: {e}", file=sys.stderr)
    result = f"event_shop/{cache_key}.webp" if os.path.exists(dest) else None
    _event_icon_results[cache_key] = result
    return result


def _entry_icon(entry: dict, item_map: Dict[int, dict], cache_dir: str, targets: Optional[list], force: bool, dry_run: bool) -> Optional[str]:
    resolved = _resolve_entry_icon(entry, item_map, cache_dir, targets=targets, force=force)
    if not resolved:
        return None
    kind, ident, asset_path = resolved
    return _event_icon_file(kind, ident, asset_path, force=force, dry_run=dry_run)


def _shop_currency(entry: dict, currencies: Dict[int, dict], names: Dict[str, Dict[int, dict]], force: bool = False, dry_run: bool = False):
    """Register one shop entry's payment currency (embedded in cost.item) if not seen yet.

    The currency's own name goes through the NA-first chain: an event currency no one has
    translated comes back as the Japanese text, which is what the game really shows."""
    cost_item = (entry.get("cost") or {}).get("item") or {}
    cid = cost_item.get("id")
    if not cid or cid in currencies:
        return
    currencies[cid] = {
        "id": cid,
        "name": resolve_item_name(cid, names.get("na"), names.get("jpEn"), names.get("jp")) or cost_item.get("name") or "",
        "background": cost_item.get("background") or "silver",
        "icon": _event_icon_file("item", cid, cost_item.get("icon"), force=force, dry_run=dry_run),
    }


def _shop_item(entry: dict, item_map: Dict[int, dict], cache_dir: str, force: bool = False, dry_run: bool = False, names: Optional[Dict[str, Dict[int, dict]]] = None) -> Optional[dict]:
    """Map one Atlas shop entry to the slim snapshot item shape; None when not purchasable.

    names is the Amendment E export bundle; without it (standalone callers) the row keeps the shop
    entry's own name and the JP item map, which is the pre-chain behavior."""
    cost = entry.get("cost") or {}
    cost_item = cost.get("item") or {}
    amount = cost.get("amount") or 0
    if not cost_item.get("id") or amount <= 0:
        return None
    targets = entry.get("targetIds") or []
    bundle = names or {"na": {}, "jpEn": {}, "jp": item_map, "naEquips": {}}
    return {
        "id": entry.get("id"),
        "name": _shop_item_name(entry, targets, item_map, cache_dir, bundle, force=force),
        "purchaseType": entry.get("purchaseType") or "",
        "cost": {"itemId": cost_item.get("id"), "amount": amount},
        "limitNum": entry.get("limitNum") or 0,
        "setNum": entry.get("setNum") or 1,
        "priority": entry.get("priority") or 0,
        "icon": _entry_icon(entry, item_map, cache_dir, targets, force, dry_run),
    }


def _shop_item_name(entry: dict, targets: list, item_map: Dict[int, dict], cache_dir: str, names: Dict[str, Dict[int, dict]], force: bool = False) -> str:
    """Name a row by purchaseType: shop items through the item chain, CE/servant rows through the
    equip chain, everything else (costumeRelease, unknown types) the shop entry's own name."""
    target = targets[0] if targets else None
    purchase_type = entry.get("purchaseType")
    if target is None:
        return entry.get("name") or ""
    if purchase_type == "item":
        return resolve_item_name(target, names.get("na"), names.get("jpEn"), names.get("jp")) or entry.get("name") or ""
    if purchase_type in ("servant", "equip"):
        return resolve_equip_name(target, entry, names, _equip_detail(target, cache_dir, force=force))
    return entry.get("name") or ""


def _event_window(event: dict) -> dict:
    return {
        "id": event.get("id"),
        "name": event.get("name") or "",
        "shortName": event.get("shortName") or event.get("name") or "",
        "startedAt": event.get("startedAt"),
        "endedAt": event.get("endedAt"),
    }


def _map_shop_entries(cache_dir: str, entries: List[dict], item_map: Dict[int, dict], names: Dict[str, Dict[int, dict]], force: bool, dry_run: bool):
    """Currencies and items of one shop. A currency is registered only on a kept row: one seen
    solely on amount<=0 (free) entries would otherwise yield a ghost chip with an empty group."""
    currencies: Dict[int, dict] = {}
    items = []
    for entry in entries:
        item = _shop_item(entry, item_map, cache_dir, force=force, dry_run=dry_run, names=names)
        if item:
            _shop_currency(entry, currencies, names, force=force, dry_run=dry_run)
            items.append(item)
    return currencies, items


def _event_detail(cache_dir: str, event: dict, force: bool = False) -> dict:
    """One event's nice detail, fetched once per run (Amendment J): the farm-event test reads the
    shop rows and war ids first, and the snapshot step reuses the same result."""
    event_id = event["id"]
    if event_id not in _event_detail_results:
        _event_detail_results[event_id] = get_cached_json(
            cache_dir, f"nice_event_{event_id}.json", f"{API_BASE}/nice/JP/event/{event_id}?lang=en", force=force
        )
    return _event_detail_results[event_id]


def _shop_entries(detail: dict) -> List[dict]:
    """The detail's shop rows; a detail that came back empty simply has none."""
    return [e for e in ((detail or {}).get("shop") or []) if isinstance(e, dict)]


def _load_equip_export(cache_dir: str, force: bool = False) -> List[dict]:
    """Bulk JP equip export (shared with CE sync); an outage warns and skips bonus CEs."""
    try:
        data = get_cached_json(cache_dir, "nice_equip_lang_en.json", EQUIP_EXPORT_URL, force=force)
    except Exception as e:
        print(f"  [WARN] nice_equip_lang_en.json unavailable, bonus CEs skipped: {e}", file=sys.stderr)
        return []
    return data if isinstance(data, list) else []


def _currency_individuality_map(currency_ids: List[int], item_map: Dict[int, dict]) -> Dict[int, int]:
    """Map each shop currency's Atlas drop individuality id -> currency item id."""
    ind_to_currency: Dict[int, int] = {}
    for cid in currency_ids:
        item = (item_map or {}).get(cid) or {}
        for ind in item.get("individuality") or []:
            ind_id = ind.get("id") if isinstance(ind, dict) else ind
            if isinstance(ind_id, int) and ind_id > 0:
                ind_to_currency[ind_id] = cid
    return ind_to_currency


def _equip_event_bonuses(equip: dict, event_id: int, ind_to_currency: Dict[int, int]) -> Dict[str, dict]:
    """Extract {str(currencyId): {nonLimitBreak, limitBreak}} from eventDropUp skills for event_id."""
    adds_by_currency: Dict[int, List[int]] = {}
    for skill in equip.get("skills") or []:
        if not isinstance(skill, dict):
            continue
        for fn in skill.get("functions") or []:
            if not isinstance(fn, dict) or fn.get("funcType") != "eventDropUp":
                continue
            for sv in fn.get("svals") or []:
                if not isinstance(sv, dict) or sv.get("EventId") != event_id:
                    continue
                cid = ind_to_currency.get(sv.get("Individuality"))
                add = sv.get("AddCount")
                if cid and isinstance(add, int) and add > 0:
                    adds_by_currency.setdefault(cid, []).append(add)
    return {
        str(cid): {"nonLimitBreak": min(adds), "limitBreak": max(adds)}
        for cid, adds in sorted(adds_by_currency.items())
    }


def _collect_bonus_ces(
    event_id: int,
    currency_ids: List[int],
    item_map: Dict[int, dict],
    equips: Optional[List[dict]],
    names: Dict[str, Dict[int, dict]],
    force: bool = False,
    dry_run: bool = False,
) -> List[dict]:
    """Discover event bonus CEs boosting at least one shop currency, sorted (rarity, id)."""
    ind_to_currency = _currency_individuality_map(currency_ids, item_map)
    if not ind_to_currency or not equips:
        return []
    bonus_ces = []
    for equip in equips:
        if not isinstance(equip, dict):
            continue
        eid = equip.get("id")
        if not isinstance(eid, int) or eid <= 0:
            continue
        bonuses = _equip_event_bonuses(equip, event_id, ind_to_currency)
        if not bonuses:
            continue
        rarity = equip.get("rarity")
        rarity = rarity if isinstance(rarity, int) and 1 <= rarity <= 5 else 3
        bonus_ces.append({
            "id": eid,
            "name": resolve_equip_name(eid, {}, names, equip),
            "rarity": rarity,
            "icon": _event_icon_file("equip", eid, _equip_face_asset_path(equip), force=force, dry_run=dry_run),
            "bonuses": bonuses,
        })
    bonus_ces.sort(key=lambda ce: (ce["rarity"], ce["id"]))
    return bonus_ces


def _collect_event_snapshot(
    cache_dir: str,
    event: dict,
    item_map: Dict[int, dict],
    names: Dict[str, Dict[int, dict]],
    equips: Optional[List[dict]] = None,
    force: bool = False,
    dry_run: bool = False,
) -> Optional[dict]:
    """One event's snapshot, or None when it has no shop to snapshot (the G1 non-empty filter)."""
    detail = _event_detail(cache_dir, event, force=force)
    entries = _shop_entries(detail)
    if not entries:
        return None
    currencies, items = _map_shop_entries(cache_dir, entries, item_map, names, force, dry_run)
    if not items:
        return None
    sorted_currencies = sorted(currencies)
    war_ids = detail.get("warIds") or event.get("warIds") or []
    return {
        "event": _event_window(event),
        "currencies": [currencies[cid] for cid in sorted_currencies],
        "items": sorted(items, key=lambda it: (it["priority"], it["id"])),
        "farm": _collect_farm(cache_dir, war_ids, sorted_currencies, force=force),
        "trades": _shop_trades(entries, sorted_currencies),
        "bonusCes": _collect_bonus_ces(
            event["id"],
            sorted_currencies,
            item_map,
            equips,
            names,
            force=force,
            dry_run=dry_run,
        ),
    }


def _drops_digest(drops: Optional[list]) -> str:
    """16-hex-char SHA-256 of canonical (objectId, num, dropExpected, runs) tuples with positive drops."""
    canonical = sorted(
        (
            int(d.get("objectId") or 0),
            int(d.get("num") or 0),
            round(float(d.get("dropExpected") or 0), 4),
            int(d.get("runs") or 0),
        )
        for d in (drops or [])
        if isinstance(d, dict) and (d.get("dropExpected") or 0) > 0 and (d.get("num") or 0) > 0
    )
    return hashlib.sha256(json.dumps(canonical, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def _write_shop_probe(
    cache_dir: str,
    basic_events: List[dict],
    now: Optional[int] = None,
    probe_path: Optional[str] = None,
    force: bool = False,
):
    """Persist active event-shop window and repeatable quest drop digests into .ci-baselines/shop_probe.json
    when the parent directory (.ci-baselines) exists."""
    if probe_path is None:
        probe_path = DEFAULT_SHOP_PROBE_FILE
    parent = os.path.dirname(probe_path)
    if parent and not os.path.isdir(parent):
        return
    moment = int(time.time()) if now is None else now
    events = basic_events if isinstance(basic_events, list) else []
    future_ts = [
        t
        for e in events
        if isinstance(e, dict) and e.get("type") == "eventQuest"
        for t in (e.get("startedAt"), e.get("finishedAt"))
        if isinstance(t, int) and t > moment
    ]
    next_transition = min(future_ts) if future_ts else None
    open_events = select_events(events, now=moment)
    open_ids = [e.get("id") for e in open_events if e.get("id")]
    seen_quests = set()
    active_quests = []
    for event in open_events:
        try:
            detail = _event_detail(cache_dir, event, force=force)
            if not _shop_currency_ids(_shop_entries(detail)):
                continue
            war_ids = (detail or {}).get("warIds") or event.get("warIds") or []
            quests = _collect_farm_quests(cache_dir, war_ids, force=force)
        except Exception:
            continue
        for q in quests:
            qid = q.get("questId")
            phase = q.get("phase") or 0
            if not qid or phase <= 0 or (qid, phase) in seen_quests:
                continue
            seen_quests.add((qid, phase))
            active_quests.append({
                "id": qid,
                "phase": phase,
                "etag": _stored_etag(cache_dir, f"nice_quest_{qid}_{phase}.json"),
                "dropsHash": _drops_digest(q.get("drops")),
            })
    probe = {
        "openIds": open_ids,
        "nextTransitionAt": next_transition,
        "activeQuests": active_quests,
    }
    with open(probe_path, "w", encoding="utf-8") as f:
        json.dump(probe, f, ensure_ascii=False, indent=2)


def _collect_event_shops(cache_dir: str, event_id: Optional[int] = None, force: bool = False, dry_run: bool = False) -> dict:
    """Build the full EVENT_SHOP_DATA payload from the live API (all fetches ETag-cached).

    --event-id snapshots exactly that event with every Amendment J filter skipped; otherwise the
    farmable shops ship: active farm events plus the latest past farm event (Amendment L1). One
    event failing does not sink the run: it is skipped with a WARN and the others still ship.
    When every open event failed, the caller's outage policy keeps the previous file instead."""
    _event_icon_results.clear()
    _event_detail_results.clear()
    _farm_quests_results.clear()
    global _servant_lore
    _servant_lore = None
    basic = get_cached_json(cache_dir, "basic_event.json", BASIC_EVENT_URL, force=force)
    if event_id is not None:
        events = select_events(basic, event_id)
    else:
        events = _select_farm_events(cache_dir, basic, force=force)
    if not events:
        if event_id is None and not dry_run:
            _write_shop_probe(cache_dir, basic, force=force)
        print("  [WARN] No farmable event shop found; writing an empty event shop list.", file=sys.stderr)
        return json.loads(json.dumps(EVENT_SHOP_STUB))

    item_map = load_nice_item_map(cache_dir, force=force)
    names = load_event_name_maps(cache_dir, item_map, force=force)
    equips = _load_equip_export(cache_dir, force=force)

    snapshots, failures = [], 0
    for event in events:
        try:
            snapshot = _collect_event_snapshot(cache_dir, event, item_map, names, equips=equips, force=force, dry_run=dry_run)
        except Exception as e:
            failures += 1
            print(f"  [WARN] Event {event.get('id')} shop fetch failed: {e}", file=sys.stderr)
            continue
        if snapshot:
            snapshots.append(snapshot)
    if failures and not snapshots:
        raise RuntimeError(f"all {failures} open event shop fetch(es) failed")
    if event_id is None and not dry_run:
        _write_shop_probe(cache_dir, basic, force=force)
    return {"events": snapshots}


def _event_shop_js_text(data: dict) -> str:
    """Serialize EVENT_SHOP_DATA as a valid-JS, JSON-parseable module body (quoted keys, indent 2)."""
    body = json.dumps(data, ensure_ascii=False, indent=2)
    return f"export const EVENT_SHOP_DATA = {body};\n"


def _write_event_shop_js(data: dict, dry_run: bool = False):
    snapshots = data.get("events") or []
    item_count = sum(len(snap.get("items", [])) for snap in snapshots)
    if dry_run:
        print(f"[DRY-RUN] Would write {len(snapshots)} event shops / {item_count} items to {EVENT_SHOP_JS}")
        return
    os.makedirs(os.path.dirname(EVENT_SHOP_JS), exist_ok=True)
    with open(EVENT_SHOP_JS, "w", encoding="utf-8") as f:
        f.write(_event_shop_js_text(data))
    listed = ", ".join(str((snap.get("event") or {}).get("id")) for snap in snapshots) or "(empty)"
    print(f"Successfully synchronized {len(snapshots)} event shop(s) [{listed}] / {item_count} items into {EVENT_SHOP_JS}")


def sync_event_shop(cache_dir: str = os.path.join(BASE_DIR, ".cache", "atlas"), event_id: Optional[int] = None, force: bool = False, dry_run: bool = False):
    """Generate src/scripts/data/event_shop.js + public/event_shop/ icons for every farmable event shop.

    Outage policy: a fetch failure keeps the previously generated file; with none, an empty stub is
    written so `ensure_data.js` sees the file as present and the build never dies on an API hiccup."""
    print("Checking Atlas Academy API for the open event shops...")
    try:
        data = _collect_event_shops(cache_dir, event_id, force=force, dry_run=dry_run)
    except Exception as e:
        print(f"  [WARN] Event shop sync failed: {e}", file=sys.stderr)
        if os.path.exists(EVENT_SHOP_JS):
            print("  [INFO] Keeping the existing event_shop.js.")
            return
        data = json.loads(json.dumps(EVENT_SHOP_STUB))
    _write_event_shop_js(data, dry_run=dry_run)


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
    parser.add_argument("--skip-event-shop", action="store_true", help="Skip event shop synchronization")
    parser.add_argument("--event-id", type=int, help="Snapshot only this event id (default: every event shop open now)")
    args = parser.parse_args()

    # Configure global rate limiter delay
    rate_limiter.delay = max(0.0, args.delay)
    if rate_limiter.delay > 0:
        print(f"Polite rate limiter active: minimum {rate_limiter.delay}s delay between requests.")

    # 1. Sync Servants
    if not args.skip_servants:
        sync_servants(args)
        sync_bond_growth(cache_dir=args.cache_dir, force=args.force, dry_run=args.dry_run)

    # 2. Sync Craft Essences & Traits
    if not args.skip_ces:
        sync_craft_essences(cache_dir=args.cache_dir, force=args.force, dry_run=args.dry_run)
    elif not args.skip_traits:
        sync_traits_js(cache_dir=args.cache_dir, force=args.force, dry_run=args.dry_run)

    # 3. Sync Event Shop (current JP event + icons)
    if not args.skip_event_shop:
        sync_event_shop(cache_dir=args.cache_dir, event_id=args.event_id, force=args.force, dry_run=args.dry_run)

    if args.clean_cache:
        cleanup_cache_dir(args.cache_dir)

    print("Sync process completed.")


if __name__ == "__main__":
    main()
