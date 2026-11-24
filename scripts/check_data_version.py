"""Check the Atlas Academy JP and NA data versions via GET /info; prints CHECK=UNCHANGED|CHANGED|UNKNOWN.

Run in CI before the sync so idle schedule runs can stop after one ~230-byte fetch.
Never fails the workflow: any network/parse problem yields CHECK=UNKNOWN (continue).
"""

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://api.atlasacademy.io/info"
DEFAULT_API_BASE = "https://api.atlasacademy.io"
DEFAULT_VERSION_FILE = os.path.join(".ci-baselines", "data_version.txt")
DEFAULT_SHOP_PROBE_FILE = os.path.join(".ci-baselines", "shop_probe.json")
TIMEOUT_SECONDS = 10
ATTEMPTS = 2
RETRY_DELAY_SECONDS = 3


def fetch_latest(url):
    """GET url, return (jp_hash, na_hash) — either may be None if absent from the body;
    (None, None) on any network/parse failure. Two attempts, 3s between."""
    for attempt in range(ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fgo-calculator-ci"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return (data.get("JP", {}).get("hash"), data.get("NA", {}).get("hash"))
        except Exception:
            if attempt < ATTEMPTS - 1:
                time.sleep(RETRY_DELAY_SECONDS)
    return (None, None)


def decide(latest, stored, force):
    """Pure decision on (jp, na) pairs. UNKNOWN when either latest is None (force cannot invent
    a hash); CHANGED when forced, either stored is missing, or either differs; else UNCHANGED."""
    if latest[0] is None or latest[1] is None:
        return "UNKNOWN"
    if force or stored[0] is None or stored[1] is None or latest[0] != stored[0] or latest[1] != stored[1]:
        return "CHANGED"
    return "UNCHANGED"


def _read_stored(path):
    """Return {"JP": hash, "NA": hash} from a two-line file; a key is absent if its line is missing."""
    stored = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) == 2 and parts[0] in ("JP", "NA"):
                    stored[parts[0]] = parts[1]
    except OSError:
        pass
    return stored


def _write_version(path, jp, na):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"JP {jp}\nNA {na}\n")


DEFAULT_DATA_DIR = os.path.join("src", "scripts", "data")
DEFAULT_SERVANT_INFO_DIR = os.path.join("public", "servant_info")


def _drops_digest(drops):
    """16-hex-char SHA-256 of canonical (objectId, num) pairs with positive drops."""
    canonical = sorted({
        (
            int(d.get("objectId") or 0),
            int(d.get("num") or 0),
        )
        for d in (drops or [])
        if isinstance(d, dict) and (d.get("dropExpected") or 0) > 0 and (d.get("num") or 0) > 0
    })
    return hashlib.sha256(json.dumps(canonical, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def _strip_volatile_quest_drops(quest):
    if not isinstance(quest, dict):
        return
    quest.pop("sampleRuns", None)
    drops = quest.get("drops")
    if isinstance(drops, dict):
        for drop in drops.values():
            if isinstance(drop, dict):
                drop.pop("dropExpected", None)


def _normalize_event_shop_js(raw_bytes):
    """Strip volatile sampleRuns and dropExpected from event_shop.js for deterministic hashing."""
    try:
        text = raw_bytes.decode("utf-8").strip()
        prefix = "export const EVENT_SHOP_DATA ="
        if not text.startswith(prefix) or not text.endswith(";"):
            return raw_bytes
        data = json.loads(text[len(prefix) : -1].strip())
        if not isinstance(data, dict):
            return raw_bytes
        for event in data.get("events") or []:
            if not isinstance(event, dict):
                continue
            farm = event.get("farm")
            if not isinstance(farm, dict):
                continue
            for quest in farm.get("quests") or []:
                _strip_volatile_quest_drops(quest)
            for raid in farm.get("raids") or []:
                if isinstance(raid, dict):
                    for quest in raid.get("quests") or []:
                        _strip_volatile_quest_drops(quest)
        return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    except Exception:
        return raw_bytes


def compute_data_hash(data_dir=DEFAULT_DATA_DIR, servant_info_dir=DEFAULT_SERVANT_INFO_DIR):
    """Return (64-char combined SHA-256 hex, dict of 12-char component prefixes)."""
    combined = hashlib.sha256()
    parts = {}
    for filename in ("servants.js", "craft_essences.js", "traits.js", "bond_growth.js", "event_shop.js"):
        path = os.path.join(data_dir, filename)
        try:
            with open(path, "rb") as f:
                raw = f.read()
        except OSError:
            raw = b""
        payload = _normalize_event_shop_js(raw) if filename == "event_shop.js" else raw
        parts[filename] = hashlib.sha256(payload).hexdigest()[:12]
        combined.update(filename.encode("utf-8") + b"\0" + payload + b"\0")

    svt_hasher = hashlib.sha256()
    if os.path.isdir(servant_info_dir):
        for name in sorted(n for n in os.listdir(servant_info_dir) if n.endswith(".json")):
            fpath = os.path.join(servant_info_dir, name)
            if not os.path.isfile(fpath):
                continue
            with open(fpath, "rb") as f:
                content = f.read()
            entry = name.encode("utf-8") + b"\0" + content + b"\0"
            svt_hasher.update(entry)
            combined.update(entry)
    parts["servant_info"] = svt_hasher.hexdigest()[:12]
    return combined.hexdigest(), parts


def _fetch_quest_drops(url, etag=None):
    """GET quest detail URL; return ('NOT_MODIFIED', None), ('OK', drops), or ('ERROR', None)."""
    headers = {"User-Agent": "fgo-calculator-ci", "Accept-Encoding": "gzip"}
    if etag:
        headers["If-None-Match"] = etag
    for attempt in range(ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                data = json.loads(raw.decode("utf-8"))
                if not isinstance(data, dict):
                    return ("ERROR", None)
                return ("OK", data.get("drops") or [])
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return ("NOT_MODIFIED", None)
            if attempt < ATTEMPTS - 1:
                time.sleep(RETRY_DELAY_SECONDS)
        except Exception:
            if attempt < ATTEMPTS - 1:
                time.sleep(RETRY_DELAY_SECONDS)
    return ("ERROR", None)


def check_shop_probe(probe_path, api_base=DEFAULT_API_BASE, now=None):
    """Check whether active event window transitions or quest drop submissions changed."""
    try:
        with open(probe_path, "r", encoding="utf-8") as f:
            probe = json.load(f)
        if not isinstance(probe, dict):
            return "CHANGED"
    except Exception:
        return "CHANGED"

    moment = int(time.time()) if now is None else now
    next_ts = probe.get("nextTransitionAt")
    if isinstance(next_ts, int) and moment >= next_ts:
        return "CHANGED"

    base = api_base.rstrip("/")
    quests = probe.get("activeQuests") or []
    if not quests:
        return "UNCHANGED"

    def _check_one(q):
        qid = q.get("id")
        phase = q.get("phase")
        url = f"{base}/nice/JP/quest/{qid}/{phase}?lang=en"
        state, drops = _fetch_quest_drops(url, etag=q.get("etag"))
        if state == "ERROR":
            return "UNKNOWN"
        if state == "NOT_MODIFIED":
            return "UNCHANGED"
        if _drops_digest(drops) != q.get("dropsHash"):
            return "CHANGED"
        return "UNCHANGED"

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(quests))) as pool:
        results = list(pool.map(_check_one, quests))

    if "CHANGED" in results:
        return "CHANGED"
    if "UNKNOWN" in results:
        return "UNKNOWN"
    return "UNCHANGED"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check Atlas Academy data version (JP + NA) via /info")
    parser.add_argument("--version-file", default=DEFAULT_VERSION_FILE)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--check-shop", action="store_true")
    parser.add_argument("--shop-probe-file", default=DEFAULT_SHOP_PROBE_FILE)
    parser.add_argument("--data-hash", action="store_true")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument("--servant-info-dir", default=DEFAULT_SERVANT_INFO_DIR)
    args = parser.parse_args(argv)

    if args.data_hash:
        combined_hex, parts = compute_data_hash(args.data_dir, args.servant_info_dir)
        summary = " ".join(f"{k}={v}" for k, v in parts.items())
        print(f"data-hash parts: {summary}", file=sys.stderr)
        print(combined_hex)
        return 0

    url = os.environ.get("ATLAS_INFO_URL", DEFAULT_URL)
    latest = fetch_latest(url)
    stored = _read_stored(args.version_file)
    stored = (stored.get("JP"), stored.get("NA"))
    status = decide(latest, stored, force=args.force)

    if status == "CHANGED":
        _write_version(args.version_file, latest[0], latest[1])
    elif status == "UNCHANGED" and args.check_shop:
        api_base = os.environ.get("ATLAS_API_BASE", DEFAULT_API_BASE)
        status = check_shop_probe(args.shop_probe_file, api_base=api_base)

    print(f"DATA_VERSION=JP:{latest[0] or '-'}|NA:{latest[1] or '-'}")
    print(f"CHECK={status}")

    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"CHECK={status}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
