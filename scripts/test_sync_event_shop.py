"""Self-checks for the event shop sync path in sync_atlas_data.py.

Run: python3 scripts/test_sync_event_shop.py

Fully offline: get_cached_json / _make_event_icon are swapped for fixture doubles, so no network
and no Pillow are needed (the CI self-test job installs neither). Mirrors the stub-keeping policy
and the EVENT_SHOP_DATA output shape the site ships.
"""

import json
import os
import sys
import tempfile
import types
from unittest.mock import patch

# sync_atlas_data imports PIL at module top; the stubbed icon writer never uses it, so stub it out
# to keep this test runnable without Pillow installed (same trick as test_drift.py).
if "PIL" not in sys.modules:
    _pil = types.ModuleType("PIL")
    _pil.Image = types.ModuleType("PIL.Image")
    sys.modules["PIL"] = _pil
    sys.modules["PIL.Image"] = _pil.Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_atlas_data as m  # noqa: E402

GOLD = {"id": 94164002, "name": "YAKI bun", "icon": "JP/Items/94164002.png", "background": "gold"}
SILVER = {"id": 94164001, "name": "SHIMONITA negi", "icon": "JP/Items/94164001.png"}
OLD_EVENT = {"id": 70000, "name": "Old event", "shortName": "Old", "type": "eventQuest", "startedAt": 1700000000, "endedAt": 1700999999}
LIVE_EVENT = {"id": 80639, "name": "Gudagudapuni Puni Wars!", "shortName": "GudaPuni", "type": "eventQuest", "startedAt": 1794394800, "endedAt": 1796183999}
MAIN_STORY = {"id": 100, "name": "Main story", "type": "storyQuest", "startedAt": 1800000000, "endedAt": 1800999999}

SHOP_ENTRIES = [
    {
        "id": 80639001, "name": "Spirit robe release", "purchaseType": "costumeRelease", "targetIds": [20470011],
        "cost": {"item": GOLD, "amount": 150}, "limitNum": 1, "setNum": 1, "priority": 1, "slot": 1,
    },
    {
        "id": 80639002, "name": "Event CE", "purchaseType": "servant", "targetIds": [9409690],
        "cost": {"item": GOLD, "amount": 100}, "limitNum": 1, "setNum": 1, "priority": 10, "slot": 1,
    },
    {
        "id": 80639005, "name": "Silver Coins (10)", "purchaseType": "item", "targetIds": [705500],
        "cost": {"item": GOLD, "amount": 10}, "limitNum": 0, "setNum": 10, "priority": 100, "slot": 1,
    },
    {
        "id": 80639006, "name": "Fake gacha ticket", "purchaseType": "fgoLottery", "targetIds": [94164002],
        "cost": {"item": SILVER, "amount": 5}, "limitNum": 2, "setNum": 1, "priority": 5, "slot": 1,
    },
    {
        "id": 80639007, "name": "Free daily login", "purchaseType": "item", "targetIds": [705500],
        "cost": {"item": SILVER, "amount": 0}, "limitNum": 1, "setNum": 1, "priority": 1, "slot": 1,
    },
    {
        "id": 80639008, "name": "Silver Coins (20)", "purchaseType": "item", "targetIds": [705500],
        "cost": {"item": SILVER, "amount": 20}, "limitNum": 1, "setNum": 20, "priority": 100, "slot": 1,
    },
]

NICE_ITEM_MAP = [
    {"id": 705500, "name": "Silver Coins", "icon": "JP/Coins/705500.png"},
    {"id": 94164002, "name": "YAKI bun", "icon": "JP/Items/94164002.png"},
]
EQUIP_DETAIL = {"id": 9409690, "extraAssets": {"faces": {"equip": {"0": "JP/Faces/f_94096900.png", "1": "JP/Faces/f_94096901.png"}}}}
# Hero crystals / materials come back as statusUp|combineMaterial with faces under .ascension, no .equip.
EQUIP_CRYSTAL = {"id": 9570400, "extraAssets": {"faces": {"ascension": {"0": f"{m.STATIC_BASE}/JP/Faces/f_95704000.png"}}}}


def fixture_json(cache_dir, filename, url, force=False):
    """Stand-in for get_cached_json, keyed on the plan's cache filenames."""
    if filename == "basic_event.json":
        return [OLD_EVENT, LIVE_EVENT, MAIN_STORY]
    if filename == "nice_event_80639.json":
        return {"id": 80639, "shop": SHOP_ENTRIES}
    if filename == "nice_item.json":
        return NICE_ITEM_MAP
    if filename == "nice_equip_9409690.json":
        return EQUIP_DETAIL
    if filename == "nice_equip_9570400.json":
        return EQUIP_CRYSTAL
    raise AssertionError(f"unexpected cache filename {filename!r} (url {url})")


def make_icon_stub(calls):
    def fake_make(asset_path, dest, kind):
        calls.append((asset_path, dest, kind))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(b"webp")

    return fake_make


class Sandbox:
    """Patch module paths + network doubles, restore everything on exit."""

    def __enter__(self):
        self.tmp = tempfile.mkdtemp(prefix="eshop_test_")
        self.old = (m.EVENT_SHOP_JS, m.PUBLIC_EVENT_SHOP_DIR, m.get_cached_json, m._make_event_icon)
        m.EVENT_SHOP_JS = os.path.join(self.tmp, "event_shop.js")
        m.PUBLIC_EVENT_SHOP_DIR = os.path.join(self.tmp, "event_shop")
        m.get_cached_json = fixture_json
        self.icon_calls = []
        m._make_event_icon = make_icon_stub(self.icon_calls)
        return self

    def __exit__(self, *exc):
        m.EVENT_SHOP_JS, m.PUBLIC_EVENT_SHOP_DIR, m.get_cached_json, m._make_event_icon = self.old
        return False

    def read_data(self):
        with open(m.EVENT_SHOP_JS, "r", encoding="utf-8") as f:
            text = f.read()
        assert text.startswith("export const EVENT_SHOP_DATA = ")
        return json.loads(text.split("=", 1)[1].strip().rstrip(";"))


class FakeImage:
    """PIL.Image double for _make_event_icon tests: no decoding, records the save (CI has no Pillow)."""

    Resampling = types.SimpleNamespace(LANCZOS=1)

    def __init__(self):
        self.size = (512, 512)

    @staticmethod
    def open(_buf):
        return FakeImage()

    def convert(self, _mode):
        return self

    def thumbnail(self, size, _resample=None):
        self.size = size

    def resize(self, size, _resample=None):
        self.size = size
        return self

    def save(self, dest, _fmt, **_kw):
        with open(dest, "wb") as f:
            f.write(b"webp")


def main():
    n = 0

    # --- pick_event ---
    assert m.pick_event([OLD_EVENT, LIVE_EVENT, MAIN_STORY])["id"] == 80639, "latest eventQuest by startedAt wins"
    assert m.pick_event([OLD_EVENT, LIVE_EVENT], 70000)["id"] == 70000, "override wins over newer quest"
    assert m.pick_event([LIVE_EVENT]) is LIVE_EVENT
    assert m.pick_event([MAIN_STORY]) is None, "no eventQuest -> None"
    assert m.pick_event([LIVE_EVENT], 999999) is None, "override id absent -> None"
    n += 1

    # --- _atlas_asset_url ---
    assert m._atlas_asset_url("JP/Coins/705500.png") == f"{m.STATIC_BASE}/JP/Coins/705500.png"
    assert m._atlas_asset_url("/JP/Items/1604.png") == f"{m.STATIC_BASE}/JP/Items/1604.png", "leading slash stripped"
    n += 1

    # --- entry mapping + icon resolution (fixture network) ---
    with Sandbox() as s:
        item_map = {it["id"]: it for it in NICE_ITEM_MAP}
        coin = _entry_by_id(80639005)
        ce = _entry_by_id(80639002)
        costume = _entry_by_id(80639001)
        ticket = _entry_by_id(80639006)
        assert m._resolve_entry_icon(coin, item_map, s.tmp) == ("item", 705500, "JP/Coins/705500.png")
        assert m._resolve_entry_icon(ce, item_map, s.tmp) == ("equip", 9409690, "JP/Faces/f_94096900.png"), "lowest equip face"
        assert m._resolve_entry_icon(costume, item_map, s.tmp) == ("costume", 20470011, "JP/Faces/f_2047000.png")
        assert m._resolve_entry_icon(ticket, item_map, s.tmp) is None, "unknown purchaseType -> no icon"
        crystal = {"id": 1, "purchaseType": "servant", "targetIds": [9570400], "cost": {"item": GOLD, "amount": 1}}
        assert m._resolve_entry_icon(crystal, item_map, s.tmp) == ("equip", 9570400, f"{m.STATIC_BASE}/JP/Faces/f_95704000.png"), "ascension face fallback for non-CE servant rows"
        orphan = dict(coin, targetIds=[99999999])
        assert m._resolve_entry_icon(orphan, item_map, s.tmp) == ("item", 99999999, None)
        assert m._shop_item(_entry_by_id(80639007), item_map, s.tmp) is None, "amount 0 is not a purchasable row"
        slim = m._shop_item(coin, item_map, s.tmp)
        assert set(slim) == {"id", "name", "purchaseType", "cost", "limitNum", "setNum", "priority", "icon"}, "slim item shape"
        assert slim["cost"] == {"itemId": 94164002, "amount": 10}
        assert slim["name"] == "Silver Coins (10)"
        no_name = m._shop_item({"id": 1, "purchaseType": "item", "targetIds": [705500], "cost": {"item": GOLD, "amount": 3}}, item_map, s.tmp)
        assert no_name["name"] == "Silver Coins", "name falls back to the nice_item map"
    n += 1

    # --- sync_event_shop happy path: file shape, sorting, currencies, unique icon fetches ---
    with Sandbox() as s:
        m.sync_event_shop(cache_dir=s.tmp)
        data = s.read_data()
        assert data["event"]["id"] == 80639
        assert data["event"]["shortName"] == "GudaPuni"
        assert [c["id"] for c in data["currencies"]] == [94164001, 94164002], "currencies sorted asc"
        assert data["currencies"][1]["background"] == "gold"
        assert data["currencies"][0]["background"] == "silver", "absent background defaults to silver"
        assert [i["id"] for i in data["items"]] == [80639001, 80639006, 80639002, 80639005, 80639008], "items sorted (priority, id)"
        icons = {i["id"]: i["icon"] for i in data["items"]}
        assert icons[80639001] == "event_shop/costume_20470011.webp"
        assert icons[80639002] == "event_shop/equip_9409690.webp"
        assert icons[80639005] == "event_shop/item_705500.webp"
        assert icons[80639006] is None, "unknown type keeps the row, drops the icon"
        assert icons[80639008] == "event_shop/item_705500.webp"
        fetched = [dest for _path, dest, _kind in s.icon_calls]
        assert len(fetched) == len(set(fetched)) == 5, "two rows on 705500 fetch that icon once"
        assert os.path.exists(os.path.join(m.PUBLIC_EVENT_SHOP_DIR, "item_705500.webp"))
    n += 1

    # --- outage: no existing file -> stub written, exit clean ---
    with Sandbox() as s:
        def boom(*a, **k):
            raise RuntimeError("Atlas down")

        m.get_cached_json = boom
        m.sync_event_shop(cache_dir=s.tmp)
        assert s.read_data() == {"event": None, "currencies": [], "items": []}
    n += 1

    # --- outage: existing file kept byte-identical, not clobbered by the stub ---
    with Sandbox() as s:
        with open(m.EVENT_SHOP_JS, "w", encoding="utf-8") as f:
            f.write("export const EVENT_SHOP_DATA = {\"event\": \"PREVIOUS\"};\n")
        m.get_cached_json = boom
        m.sync_event_shop(cache_dir=s.tmp)
        with open(m.EVENT_SHOP_JS, "r", encoding="utf-8") as f:
            assert "PREVIOUS" in f.read(), "previous snapshot survives an outage"
    n += 1

    # --- no eventQuest in a healthy API -> stub + WARN (not an exception path) ---
    with Sandbox() as s:
        m.get_cached_json = lambda cache_dir, filename, url, force=False: [MAIN_STORY]
        m.sync_event_shop(cache_dir=s.tmp)
        assert s.read_data() == {"event": None, "currencies": [], "items": []}
    n += 1

    # --- _make_event_icon: bordered attempted first, plain only as fallback ---
    with tempfile.TemporaryDirectory(prefix="eshop_icon_") as tmp:
        dest = os.path.join(tmp, "icon.webp")
        calls = []

        def fetch_ok(url, timeout=10, retries=2):
            calls.append(url)
            return b"png", None

        with patch.object(m, "fetch_url", fetch_ok), patch.object(m, "Image", FakeImage):
            m._make_event_icon("JP/Items/1604.png", dest, "item")
        assert calls == [f"{m.STATIC_BASE}/JP/Items/1604_bordered.png"], "bordered URL first, no plain retry when it succeeds"
        assert os.path.exists(dest), "bordered success writes the icon"
        n += 1

        calls = []

        def bordered_missing(url, timeout=10, retries=2):
            calls.append(url)
            if url.endswith("_bordered.png"):
                raise RuntimeError("HTTP Error 404: Not Found")
            return b"png", None

        os.remove(dest)
        with patch.object(m, "fetch_url", bordered_missing), patch.object(m, "Image", FakeImage):
            m._make_event_icon("JP/Coins/705500.png", dest, "item")
        assert calls == [
            f"{m.STATIC_BASE}/JP/Coins/705500_bordered.png",
            f"{m.STATIC_BASE}/JP/Coins/705500.png",
        ], "bordered fetch failure falls back to plain (coins have no bordered variant)"
        assert os.path.exists(dest), "plain fallback writes the icon"
        n += 1

        # --- bordered 5xx/timeout: re-raise, NEVER fall back to plain, write nothing ---
        # _event_icon_file skips an existing dest forever, so a transient failure that shipped a
        # plain icon would make it permanent; the raised error must abort the write instead.
        for label, err in (
            ("500", RuntimeError("Failed to fetch x after 2 retries: HTTP Error 500: Internal Server Error")),
            ("timeout", RuntimeError("Failed to fetch x after 2 retries: timed out")),
        ):
            calls = []
            hard_dest = os.path.join(tmp, f"hard_{label}.webp")

            def bordered_hard_fail(url, timeout=10, retries=2, _err=err):
                calls.append(url)
                raise _err

            raised = None
            with patch.object(m, "fetch_url", bordered_hard_fail), patch.object(m, "Image", FakeImage):
                try:
                    m._make_event_icon("JP/Items/1604.png", hard_dest, "item")
                except RuntimeError as e:
                    raised = e
            assert raised is not None, f"bordered {label} must re-raise, not silently fall back"
            assert calls == [f"{m.STATIC_BASE}/JP/Items/1604_bordered.png"], f"bordered {label}: no plain-variant attempt"
            assert not os.path.exists(hard_dest), f"bordered {label}: no icon file written"
        n += 1

        # --- id containing "404" (f_9404xxx): the URL embedded in the RuntimeError must not
        # misread a bordered 5xx as a 404. Gate on the HTTPError phrase "HTTP Error 404" only.
        faces_base = f"{m.STATIC_BASE}/JP/Faces/f_94045200"

        calls = []
        four0four_500_dest = os.path.join(tmp, "four0four_500.webp")

        def bordered_500_url_has_404(url, timeout=10, retries=2):
            calls.append(url)
            raise RuntimeError(f"Failed to fetch {url} after 2 retries: HTTP Error 500: Internal Server Error")

        raised = None
        with patch.object(m, "fetch_url", bordered_500_url_has_404), patch.object(m, "Image", FakeImage):
            try:
                m._make_event_icon("JP/Faces/f_94045200.png", four0four_500_dest, "equip")
            except RuntimeError as e:
                raised = e
        assert raised is not None, '"404" inside the failed URL must not read as an HTTP 404'
        assert calls == [f"{faces_base}_bordered.png"], "500 on a 404-containing id: no plain-variant attempt"
        assert not os.path.exists(four0four_500_dest), "500 on a 404-containing id: no icon file written"
        n += 1

        # --- companion: a real "HTTP Error 404" on the same id still fires the plain fallback ---
        calls = []
        four0four_404_dest = os.path.join(tmp, "four0four_404.webp")

        def bordered_404_url_has_404(url, timeout=10, retries=2):
            calls.append(url)
            if url.endswith("_bordered.png"):
                raise RuntimeError(f"Failed to fetch {url} after 2 retries: HTTP Error 404: Not Found")
            return b"png", None

        with patch.object(m, "fetch_url", bordered_404_url_has_404), patch.object(m, "Image", FakeImage):
            m._make_event_icon("JP/Faces/f_94045200.png", four0four_404_dest, "equip")
        assert calls == [f"{faces_base}_bordered.png", f"{faces_base}.png"], "real 404 on the same id still falls back to plain"
        assert os.path.exists(four0four_404_dest), "plain fallback writes the icon"
        n += 1

    print(f"{n} tests passed")


def _entry_by_id(eid):
    return next(e for e in SHOP_ENTRIES if e["id"] == eid)


if __name__ == "__main__":
    main()
