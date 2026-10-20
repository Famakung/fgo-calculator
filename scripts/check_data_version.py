"""Check the Atlas Academy JP and NA data versions via GET /info; prints CHECK=UNCHANGED|CHANGED|UNKNOWN.

Run in CI before the sync so idle schedule runs can stop after one ~230-byte fetch.
Never fails the workflow: any network/parse problem yields CHECK=UNKNOWN (continue).
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://api.atlasacademy.io/info"
DEFAULT_VERSION_FILE = os.path.join(".cache", "atlas", "data_version.txt")
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


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check Atlas Academy data version (JP + NA) via /info")
    parser.add_argument("--version-file", default=DEFAULT_VERSION_FILE)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    url = os.environ.get("ATLAS_INFO_URL", DEFAULT_URL)
    latest = fetch_latest(url)
    stored = _read_stored(args.version_file)
    stored = (stored.get("JP"), stored.get("NA"))
    status = decide(latest, stored, force=args.force)

    if status == "CHANGED":
        _write_version(args.version_file, latest[0], latest[1])

    print(f"DATA_VERSION=JP:{latest[0] or '-'}|NA:{latest[1] or '-'}")
    print(f"CHECK={status}")

    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"CHECK={status}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
