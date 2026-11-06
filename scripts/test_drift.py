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


def trait_add_entry(cno, traits, adds):
    """Base traits + traitAdd entries -> normalized base list."""
    svt = make_nice(cno, 5, traits)
    svt["traitAdd"] = adds
    base, _d, _ol, _on, _cb = m.extract_servant_traits(svt)
    return base


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

    # E. permanent traitAdd (condType "none", no eventId) merges into the base set.
    # 2821 = Beast Servants; Atlas keeps it out of the servant's own trait list.
    perm_2821 = [{"idx": 1, "condType": "none", "eventId": 0, "limitCount": -1, "trait": [{"id": 2821}]}]
    base = trait_add_entry(314, ["0002", "0105", "0204", "0300", "0304", "2780"], perm_2821)
    assert "2821" in base, f"permanent traitAdd 2821 dropped for 314: {base}"
    assert "2821" in trait_add_entry(238, ["0002", "0109", "0201", "0300", "0303"], perm_2821), \
        "238 needs traitAdd now that the hard-coded 2821 is gone"
    n += 1

    # F. event- and quest-gated traitAdd entries are not always-on -> ignored
    for gated in ({"idx": 1, "condType": "none", "eventId": 80432, "trait": [{"id": 2821}]},
                  {"idx": 1, "condType": "questClear", "eventId": 0, "trait": [{"id": 2821}]}):
        assert "2821" not in trait_add_entry(314, ["0002", "0105"], [gated]), f"gated entry merged: {gated}"
    n += 1

    # G. class-form entries (Mash, idx = classId) must not leak another form's rarity
    form_adds = [{"idx": 100, "condType": "none", "eventId": 0, "trait": [{"id": 403}, {"id": 2008}, {"id": 2795}]},
                 {"idx": 117, "condType": "none", "eventId": 0, "trait": [{"id": 405}]}]
    base = trait_add_entry(1, ["0002", "0107", "0200", "0301", "0303"], form_adds)
    assert "0403" not in base and "0405" in base, f"form rarity leaked: {base}"
    n += 1

    # H. a servant stored before its permanent traitAdd was read is flagged, so
    # the scheduled run rewrites it (this is what fixes 314/334 in place).
    stale_key, stale_entry = normal_entry(334, make_nice(334, 5, ["0002", "0117", "0204", "0301", "0304"]))
    m.SERVANTS_JS = write_servants_file(tmp, {stale_key: stale_entry})
    fixed = make_nice(334, 5, ["0002", "0117", "0204", "0301", "0304"])
    fixed["traitAdd"] = perm_2821
    changed = m.revalidate_servant_traits({334: {}}, [fixed])
    assert 334 in changed, f"missing traitAdd trait not flagged: {changed}"
    n += 1

    # I. a servant with an unofficial translation (483 Tamamo Aria) uses the translated name in revalidation
    stored_key, stored_entry = normal_entry(483, make_nice(483, 5, ["0103"], name="Tamamo Aria"))
    m.SERVANTS_JS = write_servants_file(tmp, {stored_key: stored_entry})
    changed = m.revalidate_servant_traits({483: {}}, [make_nice(483, 5, ["0103"], name="タマモアリア")])
    assert 483 not in changed, f"translated servant wrongly flagged as drifted: {changed}"
    n += 1

    # J. a costume with a known translation (Red Hood & Big Bad Wolf) uses the translated label
    svt_81 = make_nice(81, 3, ["0105", "2780"], name="Henry Jekyll & Hyde")
    svt_81["ascensionAdd"] = {"individuality": {"costume": {600730: [{"id": 2821}]}}}
    svt_81["profile"] = {"costume": {"600730": {"name": "レッドフード＆ビッグバッドウルフ", "battleCharaId": 600730}}}
    stored_key, stored_entry = normal_entry(81, svt_81)
    assert "Red Hood & Big Bad Wolf" in stored_entry, f"costume label not translated: {stored_entry}"
    m.SERVANTS_JS = write_servants_file(tmp, {stored_key: stored_entry})
    changed = m.revalidate_servant_traits({81: {}}, [svt_81])
    assert 81 not in changed, f"costume translated servant wrongly flagged as drifted: {changed}"
    n += 1

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
