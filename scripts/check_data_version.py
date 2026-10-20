"""Check the Atlas Academy JP data version via GET /info; prints CHECK=UNCHANGED|CHANGED|UNKNOWN.

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
    """GET url, return the JP hash string, or None on any failure. Two attempts, 3s between."""
    for attempt in range(ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fgo-calculator-ci"})
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data["JP"]["hash"]
        except Exception:
            if attempt < ATTEMPTS - 1:
                time.sleep(RETRY_DELAY_SECONDS)
    return None


def decide(latest, stored, force):
    """Pure decision: UNKNOWN when latest is None; CHANGED when force, no stored, or differs; else UNCHANGED."""
    if latest is None:
        return "UNKNOWN"
    if force or stored is None or latest != stored:
        return "CHANGED"
    return "UNCHANGED"


def _read_stored(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def _write_version(path, value):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(value + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check Atlas Academy data version (JP) via /info")
    parser.add_argument("--version-file", default=DEFAULT_VERSION_FILE)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    url = os.environ.get("ATLAS_INFO_URL", DEFAULT_URL)
    latest = fetch_latest(url)
    stored = _read_stored(args.version_file)
    status = decide(latest, stored, force=args.force)

    if status == "CHANGED" and latest is not None:
        _write_version(args.version_file, latest)

    print(f"DATA_VERSION={latest or '-'}")
    print(f"CHECK={status}")

    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"CHECK={status}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
