"""Self-check for revalidate_servant_traits (drift detection) in sync_atlas_data.py.

Run: python3 scripts/test_drift.py

Pins the behavior the incremental CI path depends on: a change to an
EXISTING servant's data must be flagged for in-place update, including the
hard-coded 467 (Francois/Francesca) split that used to be skipped.
"""

import os
import sys
import tempfile
import types

# sync_atlas_data imports PIL at module top; the drift path never uses it, so
# stub it out so this test runs without Pillow installed.
if "PIL" not in sys.modules:
    _pil = types.ModuleType("PIL")
    _pil.Image = types.ModuleType("PIL.Image")
    sys.modules["PIL"] = _pil
    sys.modules["PIL.Image"] = _pil.Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_atlas_data as m  # noqa: E402


def make_nice(cno, rarity, trait_ids, name=None):
    """Minimal nice_servant detail payload enough for extract_servant_traits.
    trait_ids are ints (the API returns ints; normalize_trait_id compares to int bounds)."""
    return {
        "collectionNo": cno,
        "id": 100000 + cno,
        "name": name or f"S{cno}",
        "rarity": rarity,
        "traits": [{"id": int(t)} for t in trait_ids],
    }


def write_servants_file(tmpdir, entries):
    path = os.path.join(tmpdir, "servants.js")
    body = "\n".join(entries.values())
    with open(path, "w", encoding="utf-8") as f:
        f.write("export const SERVANT_DATA = {\n" + body + "\n};\n")
    return path


def normal_entry(cno, svt):
    key = f"{cno:03d}" if cno < 100 else str(cno)
    base, diffs, ol, on, _cb = m.extract_servant_traits(svt)
    return key, m.format_servant_js_entry(key, svt.get("name") or "", base, diffs, ol, on)


def main():
    tmp = tempfile.mkdtemp()
    n = 0

    # A. existing normal servant whose data changed -> flagged
    stored_key, stored_entry = normal_entry(1, make_nice(1, 4, ["0100"]))  # was rarity 4
    m.SERVANTS_JS = write_servants_file(tmp, {stored_key: stored_entry})
    changed = m.revalidate_servant_traits({1: {}}, [make_nice(1, 5, ["0100"])])
    assert 1 in changed, f"normal-servant trait change not detected: {changed}"
    n += 1

    # B. existing normal servant, no change -> NOT flagged (control)
    stored_key, stored_entry = normal_entry(1, make_nice(1, 5, ["0100"]))
    m.SERVANTS_JS = write_servants_file(tmp, {stored_key: stored_entry})
    changed = m.revalidate_servant_traits({1: {}}, [make_nice(1, 5, ["0100"])])
    assert 1 not in changed, f"unchanged servant wrongly flagged: {changed}"
    n += 1

    # C. the 467 split whose data changed -> flagged (was the stale-entry wedge)
    stored = m.format_467_split(make_nice(467, 4, ["0100"]))  # stored at rarity 4
    m.SERVANTS_JS = write_servants_file(tmp, stored)
    changed = m.revalidate_servant_traits({467: {}}, [make_nice(467, 5, ["0100"])])
    assert 467 in changed, f"467 drift not detected: {changed}"
    n += 1

    # D. the 467 split, no change -> NOT flagged
    stored = m.format_467_split(make_nice(467, 5, ["0100"]))
    m.SERVANTS_JS = write_servants_file(tmp, stored)
    changed = m.revalidate_servant_traits({467: {}}, [make_nice(467, 5, ["0100"])])
    assert 467 not in changed, f"unchanged 467 wrongly flagged: {changed}"
    n += 1

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
