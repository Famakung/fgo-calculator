"""Self-checks for the event shop sync path in sync_atlas_data.py.

Run: python3 scripts/test_sync_event_shop.py

Fully offline: get_cached_json / _make_event_icon are swapped for fixture doubles, so no network
and no Pillow are needed (the CI self-test job installs neither). Mirrors the stub-keeping policy
and the EVENT_SHOP_DATA output shape the site ships: Amendment G's `{ events: [...] }` list, each
snapshot carrying Amendment L's farm model (quest list + best map, challenge quests excluded) and
upgrade trades, Amendment E's NA-first names, Amendment F's costume faces and Amendment L1's
selection (active farm events plus the latest past farm event, campaigns and memorials pruned).

The pre-G single-event fixtures are adapted to the events[] shape; no assertion was dropped — the
old checks now run per snapshot, and the new ones cover the window filter, the farm quest model
(best line per quest/currency, sampleRuns, gift-only challenge exclusion), the trade parsing, the
latest-past-event scan with its cap and outage behaviour, the name chain, costume resolution and
the selection rules.
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

# Everything the active-window filter is judged against; the fixtures are written around this clock.
NOW = 1794500000

GOLD = {"id": 94164002, "name": "YAKIまんじゅう", "icon": "JP/Items/94164002.png", "background": "gold"}
SILVER = {"id": 94164001, "name": "SHIMONITAネギ", "icon": "JP/Items/94164001.png", "background": "silver"}
BRONZE = {"id": 94164000, "name": "MISOおでん", "icon": "JP/Items/94164000.png", "background": "bronze"}
TICKET = {"id": 94162101, "name": "1億DLチケット", "icon": "JP/Items/94162101.png"}

# A closed event and a live one: only the live one may reach the active pass. The closed farm event
# also feeds the Amendment L1 history scan — the past scan reads it BEFORE the no-shop OLD_EVENT.
OLD_EVENT = {"id": 70000, "name": "Old event", "shortName": "Old", "type": "eventQuest", "startedAt": 1700000000, "finishedAt": 1700999999}
LIVE_EVENT = {"id": 80639, "name": "Gudagudapuni Puni Wars!", "shortName": "GudaPuni", "type": "eventQuest", "startedAt": 1794394800, "finishedAt": 1796788799, "warIds": [9208]}
EARLIER_LIVE_EVENT = {"id": 80630, "name": "100M DL campaign", "shortName": "100M", "type": "eventQuest", "startedAt": 1794052800, "finishedAt": 1798729199, "warIds": []}
# Amendment J fixtures: a second ACTIVE farm event (multi-active kept), a live MEMORIAL (repeatable
# quests, zero drop submissions -> pruned) and an ENDED farm event for the history entry.
SECOND_FARM_EVENT = {"id": 80642, "name": "Second farm event", "shortName": "Second", "type": "eventQuest", "startedAt": 1794200000, "finishedAt": 1796788799, "warIds": [9208]}
MEMORIAL_EVENT = {"id": 80379, "name": "Memorial battle", "shortName": "Memorial", "type": "eventQuest", "startedAt": 1794300000, "finishedAt": 1796788799, "warIds": [9999]}
ENDED_FARM_EVENT = {"id": 70001, "name": "Ended farm event", "shortName": "Ended", "type": "eventQuest", "startedAt": 1789556400, "finishedAt": 1791000000, "warIds": [9208]}
# An eventQuest whose window never closes is live; a story quest is never a shop.
OPEN_ENDED_EVENT = {"id": 80640, "name": "Still running", "shortName": "Still", "type": "eventQuest", "startedAt": 1790000000, "finishedAt": 1893423600}
STORY = {"id": 100, "name": "Main story", "type": "storyQuest", "startedAt": 1700000000, "finishedAt": 1893423600}
NO_END_EVENT = {"id": 80641, "name": "No finishedAt", "type": "eventQuest", "startedAt": 1700000000}

SHOP_ENTRIES = [
    {
        "id": 80639001, "name": "霊衣「夏の奇兵隊」開放権", "purchaseType": "costumeRelease", "targetIds": [20470011],
        "cost": {"item": GOLD, "amount": 150}, "limitNum": 1, "setNum": 1, "priority": 1, "slot": 1,
    },
    {
        "id": 80639002, "name": "いざ、尋常に川中島！？", "purchaseType": "servant", "targetIds": [9409690],
        "cost": {"item": GOLD, "amount": 100}, "limitNum": 1, "setNum": 1, "priority": 10, "slot": 1,
    },
    {
        "id": 80639005, "name": "サーヴァントコイン（松永久秀）", "purchaseType": "item", "targetIds": [705500],
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
        "id": 80639008, "name": "Servant Coin ×20", "purchaseType": "item", "targetIds": [705500],
        "cost": {"item": BRONZE, "amount": 20}, "limitNum": 1, "setNum": 20, "priority": 100, "slot": 1,
    },
    {
        "id": 80639009, "name": "JP-only crystal", "purchaseType": "item", "targetIds": [7400],
        "cost": {"item": BRONZE, "amount": 1}, "limitNum": 0, "setNum": 1, "priority": 200, "slot": 1,
    },
    # Amendment L8 upgrade trades: buy one silver currency for 10 bronze, one gold for 10 silver.
    {
        "id": 80639053, "name": "SHIMONITAネギ交換", "purchaseType": "item", "targetIds": [94164001],
        "cost": {"item": BRONZE, "amount": 10}, "limitNum": 0, "setNum": 1, "priority": 300, "slot": 1,
    },
    {
        "id": 80639054, "name": "YAKIまんじゅう交換", "purchaseType": "item", "targetIds": [94164002],
        "cost": {"item": SILVER, "amount": 10}, "limitNum": 0, "setNum": 1, "priority": 310, "slot": 1,
    },
    # Not a trade: the reward is an ordinary item, not a shop currency.
    {
        "id": 80639055, "name": "Trinket", "purchaseType": "item", "targetIds": [705500],
        "cost": {"item": BRONZE, "amount": 5}, "limitNum": 0, "setNum": 1, "priority": 320, "slot": 1,
    },
]

TICKET_SHOP = [
    {
        "id": 80630001, "name": "圣杯", "purchaseType": "item", "targetIds": [1041],
        "cost": {"item": TICKET, "amount": 1}, "limitNum": 1, "setNum": 1, "priority": 1, "slot": 1,
    },
]

NICE_ITEM_MAP = [
    {"id": 705500, "name": "サーヴァントコイン", "icon": "JP/Coins/705500.png"},
    {"id": 7400, "name": "魔法の宝石", "icon": "JP/Items/7400.png"},
    {"id": 94164000, "name": "MISOおでん", "icon": "JP/Items/94164000.png"},
    {"id": 94164001, "name": "SHIMONITAネギ", "icon": "JP/Items/94164001.png"},
    {"id": 94164002, "name": "YAKIまんじゅう", "icon": "JP/Items/94164002.png"},
    {"id": 1041, "name": "聖杯", "icon": "JP/Items/1041.png"},
]
# NA knows the coin by its NA English text and has nothing for the event currencies.
NA_ITEM_MAP = [{"id": 705500, "name": "Servant Coin"}, {"id": 1041, "name": "Chalice"}]
# Atlas' JP-EN export: translated rows carry English, untranslated rows repeat the Japanese.
JP_EN_ITEM_MAP = [
    {"id": 7400, "name": "Magic Gem"},
    {"id": 94164000, "name": "MISOおでん"},
    {"id": 94164002, "name": "YAKIまんじゅう"},
]
NA_EQUIP_MAP = [{"id": 9409690, "name": "Kawanakajima Charge"}]
EQUIP_DETAIL = {"id": 9409690, "name": "いざ、尋常に川中島！？", "extraAssets": {"faces": {"equip": {"0": "JP/Faces/f_94096900.png", "1": "JP/Faces/f_94096901.png"}}}}
# Hero crystals / materials come back as statusUp|combineMaterial with faces under .ascension, no .equip.
EQUIP_CRYSTAL = {"id": 9570400, "name": "No Name", "extraAssets": {"faces": {"ascension": {"0": f"{m.STATIC_BASE}/JP/Faces/f_95704000.png"}}}}

# Costume faces (Amendment F).
SERVANT_SINGLE_COSTUME = {"id": 204700, "costumeMaterials": {"204730": {"qp": 3000000}}}
SERVANT_MULTI_COSTUME = {"id": 102800, "costumeMaterials": {"102830": {}, "102840": {}, "102850": {}}}
SERVANT_NO_COSTUME = {"id": 200200, "costumeMaterials": {}}
LORE_FIXTURE = [{"id": 102800, "profile": {"costume": {"102830": {"id": 11}, "102840": {"id": 12}, "102850": {"id": 13}}}}]
COSTUME_RELEASE_ENTRY = {
    "id": 102800001, "name": "簡易霊衣：首切りバニー", "purchaseType": "costumeRelease", "targetIds": [10280012],
    "cost": {"item": GOLD, "amount": 1}, "limitNum": 1, "setNum": 1, "priority": 1, "slot": 1,
}

# Farm drops (Amendment L). Two quests tie on MISO so the lower quest id must win; two more prove
# the challenge exclusion: 94164105 gifts a shop currency its repeat runs never drop (excluded),
# 94164106 gifts a currency it also repeats (kept).
WAR = {
    "id": 9208,
    "spots": [
        {"id": 920700, "quests": [
            {"id": 94164001, "name": "第１話", "afterClear": "close", "phases": [1]},
            {"id": 94164100, "name": "【GUNMA巡り】だるまを買いにいこう", "afterClear": "repeatLast", "phases": [1], "recommendLv": "70", "consume": 40},
            {"id": 94164103, "name": "tie breaker", "afterClear": "repeat", "phases": [2], "recommendLv": "70", "consume": 40},
        ]},
        {"id": 920701, "quests": [
            {"id": 94164101, "name": "【GUNMA巡り】こんにゃくとネギ", "afterClear": "repeatLast", "phases": [1], "recommendLv": "70", "consume": 40},
            {"id": 94164102, "name": "【GUNMA巡り】槍をスキーに連れていけ", "afterClear": "repeatLast", "phases": [1], "recommendLv": "70", "consume": 40},
            {"id": 94164104, "name": "no submissions", "afterClear": "repeatLast", "phases": [1], "recommendLv": "90", "consume": 50},
        ]},
        {"id": 920702, "quests": [
            {"id": 94164105, "name": "challenge gift-only", "afterClear": "repeatLast", "phases": [1], "recommendLv": "80", "consume": 40},
            {"id": 94164106, "name": "gift subset of drops", "afterClear": "repeatLast", "phases": [1], "recommendLv": "80", "consume": 40},
        ]},
    ]
}

# Memorial war (Amendment J): repeatable quests exist, but nobody has submitted drops for them.
MEMORIAL_WAR = {
    "id": 9999,
    "spots": [
        {"id": 999800, "quests": [
            {"id": 94164104, "name": "no submissions", "afterClear": "repeatLast", "phases": [1]},
        ]},
    ],
}

# The second farm event sells only gold — its own currencies, its own snapshot.
SECOND_SHOP = [
    {
        "id": 80642001, "name": "聖杯", "purchaseType": "item", "targetIds": [1041],
        "cost": {"item": GOLD, "amount": 10}, "limitNum": 1, "setNum": 1, "priority": 1, "slot": 1,
    },
]


def _quest(quest_id, name, recommend_lv, ap, drops, gifts=()):
    return {"id": quest_id, "name": name, "recommendLv": recommend_lv, "consume": ap, "drops": drops, "gifts": list(gifts)}


QUEST_FIXTURES = {
    "nice_quest_94164100_1.json": _quest(94164100, "【GUNMA巡り】だるまを買いにいこう", "70", 40, [
        {"type": "item", "objectId": 94164000, "num": 3, "dropExpected": 10.711711711711711, "runs": 111},
        {"type": "item", "objectId": 94164001, "num": 3, "dropExpected": 1.882882882882883, "runs": 111},
        # Event points: the biggest drop on the quest, and never a farm line (Amendment L2),
        # because the shop does not sell them — they are not in this event's currencies at all.
        {"type": "item", "objectId": 94164050, "num": 10, "dropExpected": 40.0, "runs": 111},
    ]),
    # Same MISO rate as 94164100 — the tie must go to the lower quest id.
    "nice_quest_94164103_2.json": _quest(94164103, "tie breaker", "70", 40, [
        {"type": "item", "objectId": 94164000, "num": 3, "dropExpected": 10.711711711711711, "runs": 5},
    ]),
    "nice_quest_94164101_1.json": _quest(94164101, "【GUNMA巡り】こんにゃくとネギ", "70", 40, [
        {"type": "item", "objectId": 94164001, "num": 3, "dropExpected": 11.210526315789474, "runs": 57},
        {"type": "item", "objectId": 94164002, "num": 3, "dropExpected": 2.0350877192982554, "runs": 57},
    ]),
    "nice_quest_94164102_1.json": _quest(94164102, "【GUNMA巡り】槍をスキーに連れていけ", "70", 40, [
        {"type": "item", "objectId": 94164002, "num": 3, "dropExpected": 10.831521739130435, "runs": 89},
        {"type": "item", "objectId": 94164000, "num": 3, "dropExpected": 2.3258, "runs": 89},
        {"type": "item", "objectId": 94164000, "num": 1, "dropExpected": 6.0, "runs": 89},
    ], gifts=[{"type": "item", "objectId": 94164000, "num": 1}]),  # gift ⊆ drops: kept
    # A quest nobody has submitted drops for: dropExpected absent entirely.
    "nice_quest_94164104_1.json": _quest(94164104, "no submissions", "90", 50, [
        {"type": "item", "objectId": 94164002, "num": 3, "runs": 0},
    ]),
    # Challenge quest (Amendment L2): it repeats the bronze currency but its GOLD reward is a
    # first-clear gift the repeat runs never drop — excluded whole from the farm list.
    "nice_quest_94164105_1.json": _quest(94164105, "challenge gift-only", "80", 40, [
        {"type": "item", "objectId": 94164000, "num": 3, "dropExpected": 20.0, "runs": 30},
    ], gifts=[{"type": "item", "objectId": 94164002, "num": 5}]),
    "nice_quest_94164106_1.json": _quest(94164106, "gift subset of drops", "80", 40, [
        {"type": "item", "objectId": 94164001, "num": 2, "dropExpected": 5.0, "runs": 12},
    ], gifts=[{"type": "item", "objectId": 94164001, "num": 1}]),
}


def fixture_json(cache_dir, filename, url, force=False):
    """Stand-in for get_cached_json, keyed on the plan's cache filenames."""
    if filename == "basic_event.json":
        return [OLD_EVENT, LIVE_EVENT, EARLIER_LIVE_EVENT, MEMORIAL_EVENT, SECOND_FARM_EVENT, ENDED_FARM_EVENT, STORY, NO_END_EVENT]
    if filename == "nice_event_80639.json":
        return {"id": 80639, "shop": SHOP_ENTRIES, "warIds": [9208]}
    if filename == "nice_event_80630.json":
        return {"id": 80630, "shop": TICKET_SHOP, "warIds": []}
    if filename == "nice_event_80642.json":
        return {"id": 80642, "shop": SECOND_SHOP, "warIds": [9208]}
    if filename == "nice_event_80379.json":
        return {"id": 80379, "shop": SHOP_ENTRIES, "warIds": [9999]}
    if filename == "nice_event_70001.json":
        return {"id": 70001, "shop": SHOP_ENTRIES, "warIds": [9208]}
    if filename == "nice_event_70000.json" or filename == "nice_event_100.json" or filename == "nice_event_80641.json":
        return {"id": 1, "shop": []}
    if filename.startswith("nice_event_9"):
        # Amendment J cap-30 fillers: campaign-style shops (non-empty, no war) that never pass.
        return {"id": 90000, "shop": TICKET_SHOP, "warIds": []}
    if filename == "nice_item.json":
        return NICE_ITEM_MAP
    if filename == "na_nice_item.json":
        return NA_ITEM_MAP
    if filename == "nice_item_lang_en.json":
        return JP_EN_ITEM_MAP
    if filename == "na_basic_equip.json":
        return NA_EQUIP_MAP
    if filename == "nice_equip_9409690.json":
        return EQUIP_DETAIL
    if filename == "nice_equip_9570400.json":
        return EQUIP_CRYSTAL
    if filename == "nice_war_9208.json":
        return WAR
    if filename == "nice_war_9999.json":
        return MEMORIAL_WAR
    if filename in QUEST_FIXTURES:
        return QUEST_FIXTURES[filename]
    if filename == "nice_servant_204700.json":
        return SERVANT_SINGLE_COSTUME
    if filename == "nice_servant_102800.json":
        return SERVANT_MULTI_COSTUME
    if filename == "nice_servant_200200.json":
        return SERVANT_NO_COSTUME
    if filename == m.LORE_EXPORT_FILENAME:
        return LORE_FIXTURE
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
        self.old = (m.EVENT_SHOP_JS, m.PUBLIC_EVENT_SHOP_DIR, m.get_cached_json, m._make_event_icon, m.select_events)
        m.EVENT_SHOP_JS = os.path.join(self.tmp, "event_shop.js")
        m.PUBLIC_EVENT_SHOP_DIR = os.path.join(self.tmp, "event_shop")
        m.get_cached_json = fixture_json
        self.fetched = []
        self.icon_calls = []
        m._make_event_icon = make_icon_stub(self.icon_calls)
        # Amendment J reads are memoized per run inside the module; a fresh sandbox is a fresh run.
        m._event_icon_results.clear()
        m._event_detail_results.clear()
        m._farm_quests_results.clear()
        return self

    def __exit__(self, *exc):
        (m.EVENT_SHOP_JS, m.PUBLIC_EVENT_SHOP_DIR, m.get_cached_json, m._make_event_icon, m.select_events) = self.old
        return False

    def spy_json(self):
        """Wrap the fixture so a test can see which cache files the sync actually asked for."""
        inner = m.get_cached_json

        def spy(cache_dir, filename, url, force=False):
            self.fetched.append(filename)
            return inner(cache_dir, filename, url, force=force)

        m.get_cached_json = spy
        return spy

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


def _entry_by_id(eid, entries=None):
    return next(e for e in (entries or SHOP_ENTRIES) if e["id"] == eid)


def _snapshot(data, event_id):
    return next(s for s in data["events"] if s["event"]["id"] == event_id)


def check_select_events():
    """Amendment G1: the active window, the newest-first order, and the --event-id override."""
    with patch.object(m.time, "time", lambda: NOW):
        picked = [e["id"] for e in m.select_events([OLD_EVENT, LIVE_EVENT, EARLIER_LIVE_EVENT, STORY, NO_END_EVENT])]
        assert picked == [80639, 80630], "only open eventQuests, newest startedAt first"
        assert m.select_events([OPEN_ENDED_EVENT, LIVE_EVENT])[0]["id"] == 80639, "newest start wins the first slot"
        assert [e["id"] for e in m.select_events([OPEN_ENDED_EVENT, STORY, OLD_EVENT])] == [80640], "stories and closed events never appear"
        assert m.select_events([LIVE_EVENT, OLD_EVENT], 70000) == [OLD_EVENT], "--event-id returns only that event, closed or not"
        assert m.select_events([LIVE_EVENT, STORY], 100)[0]["id"] == 100, "--event-id is an id lookup, not a type filter"
        assert m.select_events([LIVE_EVENT], 999999) == [], "--event-id absent from the list finds nothing"
        assert m.select_events([]) == [] and m.select_events([], 80639) == [], "an empty list snapshots nothing"
        assert m.select_events([NO_END_EVENT]) == [], "no finishedAt means no open window"
        tie_a = dict(LIVE_EVENT, id=1, name="A")
        tie_b = dict(LIVE_EVENT, id=2, name="B")
        assert [e["id"] for e in m.select_events([tie_a, tie_b])] == [1, 2], "a startedAt tie keeps the API's order"
        assert [e["id"] for e in m.select_events([tie_b, tie_a])] == [2, 1], "the tie follows list order, not id order"
    return 1


def check_name_chain():
    """Amendment E2: NA first, then Atlas' JP-EN translation, then JP, then nothing."""
    na = {it["id"]: it for it in NA_ITEM_MAP}
    jp_en = {it["id"]: it for it in JP_EN_ITEM_MAP}
    jp = {it["id"]: it for it in NICE_ITEM_MAP}
    assert m.resolve_item_name(705500, na, jp_en, jp) == "Servant Coin", "NA name wins"
    assert m.resolve_item_name(7400, na, jp_en, jp) == "Magic Gem", "no NA row -> Atlas JP-EN name"
    assert m.resolve_item_name(94164000, na, jp_en, jp) == "MISOおでん", "untranslated currency keeps the JP text"
    assert m.resolve_item_name(1041, na, {}, jp) == "Chalice", "NA still wins with the other maps empty"
    assert m.resolve_item_name(1041, {}, jp_en, jp) == "聖杯", "chain falls to JP when the EN sources miss"
    assert m.resolve_item_name(99999999, na, jp_en, jp) == "", "an id no map knows resolves to empty"
    assert m.resolve_item_name(None, na, jp_en, jp) == "", "no target id resolves to empty"
    assert m.resolve_item_name(705500, None, None, None) == "", "missing maps are simply skipped"
    return 1


def check_costume_faces():
    """Amendment F: one costume material key is the face; several need the lore; none is the base face."""
    with Sandbox() as s:
        item_map = {it["id"]: it for it in NICE_ITEM_MAP}
        assert m._resolve_entry_icon(_entry_by_id(80639001), item_map, s.tmp) == (
            "costume",
            20470011,
            "JP/Faces/f_2047300.png",
        ), "single costumeMaterials key is the costume detail id"
        assert m._resolve_entry_icon(COSTUME_RELEASE_ENTRY, item_map, s.tmp) == (
            "costume",
            10280012,
            "JP/Faces/f_1028400.png",
        ), "multiple keys disambiguate through lore profile.costume by costumeLimit"

        s.fetched.clear()
        assert m._resolve_entry_icon(_entry_by_id(80639005), item_map, s.tmp) == ("item", 705500, "JP/Coins/705500.png")
        assert m.LORE_EXPORT_FILENAME not in s.fetched, "an item row never pays for the 195 MB lore export"

        assert m._costume_asset_path(20020011, s.tmp) == "JP/Faces/f_2002000.png", "no costume -> base face"
        assert m._costume_asset_path(20470011, s.tmp) == "JP/Faces/f_2047300.png"
    return 1


def check_farm_pick():
    """Amendment L2: farm.quests lists every repeatable quest that repeats a shop currency, each
    with its per-currency best drop line; best maps each currency to its highest-amount quest."""
    with Sandbox() as s:
        farm = m._collect_farm(s.tmp, [9208], [94164000, 94164001, 94164002])
        assert [q["questId"] for q in farm["quests"]] == [94164100, 94164103, 94164101, 94164102, 94164106], (
            "104 (no submissions) and 105 (gift-only gold) are out; everything else is in, war order"
        )

        miso = next(q for q in farm["quests"] if q["questId"] == 94164100)
        assert miso["questName"] == "【GUNMA巡り】だるまを買いにいこう"
        assert miso["recommendLv"] == "70", "recommendLv is Atlas' string"
        assert miso["ap"] == 40
        assert miso["sampleRuns"] == 111
        assert miso["drops"] == {
            "94164000": {"dropExpected": 10.7117, "num": 3},
            "94164001": {"dropExpected": 1.8829, "num": 3},
        }, "point drops never enter the map"

        # Two bronze lines on one quest: the best (highest amount/run) is the one that ships.
        spear = next(q for q in farm["quests"] if q["questId"] == 94164102)
        assert spear["drops"]["94164000"] == {"dropExpected": 2.3258, "num": 3}, "2.3258×3 beats 6.0×1"
        assert spear["drops"]["94164002"] == {"dropExpected": 10.8315, "num": 3}

        assert farm["best"] == {"94164000": 94164100, "94164001": 94164101, "94164002": 94164102}, (
            "bronze ties 100 against 103 at the same rate and goes to the lower quest id"
        )
        assert "94164105" not in json.dumps(farm), "a gift-only challenge quest cannot enter the farm model"
        assert m._collect_farm(s.tmp, [], [94164000]) == {"quests": [], "best": {}}, "an event with no war has no farm data"
    return 1


def check_challenge_exclusion():
    """Amendment L2: a quest whose shop-currency reward is FIRST-TIME ONLY (in gifts, not in repeat
    drops) is not a farm quest; a gift that is a subset of the repeat drops keeps the quest in."""
    with Sandbox() as s:
        quests = m._collect_farm_quests(s.tmp, [9208])
        shop = [94164000, 94164001, 94164002]

        challenge = next(q for q in quests if q["questId"] == 94164105)
        assert m._farm_quest_entry(challenge, shop) is None, "gift gold with no repeat gold drop: first-time-only, excluded"
        kept = m._farm_quest_entry(challenge, [94164000])
        assert kept and kept["drops"] == {"94164000": {"dropExpected": 20.0, "num": 3}}, (
            "a bronze-only shop has no gift-only currency at all — the gift rule reads per event, not per quest"
        )

        subset = next(q for q in quests if q["questId"] == 94164106)
        entry = m._farm_quest_entry(subset, shop)
        assert entry and entry["drops"] == {"94164001": {"dropExpected": 5.0, "num": 2}}, "gift ⊆ repeat drops: kept"

        no_gift = next(q for q in quests if q["questId"] == 94164100)
        assert m._farm_quest_entry(no_gift, [94164003]) is None, "a quest dropping none of the event's currencies is not a farm quest for it"
    return 1


def check_shop_trades():
    """Amendment L8: upgrade rows (purchaseType item, reward is another shop currency) become
    {fromId, toId, costAmount, getNum}; ordinary rewards and foreign targets never do."""
    trades = m._shop_trades(SHOP_ENTRIES, [94164000, 94164001, 94164002])
    assert trades == [
        {"fromId": 94164000, "toId": 94164001, "costAmount": 10, "getNum": 1},
        {"fromId": 94164001, "toId": 94164002, "costAmount": 10, "getNum": 1},
    ], "both 10:1 upgrades, sorted by (fromId, toId); the coin row (80639055) is not a trade"
    assert m._shop_trades([], [94164000]) == []
    assert m._shop_trades(SHOP_ENTRIES, [94164003]) == [], "an event whose shop holds no upgrade rows ships none"
    self_swap = {"id": 1, "purchaseType": "item", "targetIds": [94164000], "cost": {"item": BRONZE, "amount": 5}, "setNum": 1}
    assert m._shop_trades([self_swap], [94164000]) == [], "a currency is never an upgrade of itself"
    zero = {"id": 2, "purchaseType": "item", "targetIds": [94164001], "cost": {"item": BRONZE, "amount": 0}, "setNum": 1}
    assert m._shop_trades([zero], [94164000, 94164001]) == [], "a free row is not a trade"
    return 1


def check_farm_event_test():
    """Amendment J: the farm-event test admits farm events and prunes campaigns, memorials, empty shops."""
    with Sandbox() as s:
        assert m._farm_event_passes(s.tmp, LIVE_EVENT), "a repeatable quest dropping a shop currency is a farm event"
        assert not m._farm_event_passes(s.tmp, EARLIER_LIVE_EVENT), "a campaign exchange shop (no war) is not farmable"
        assert not m._farm_event_passes(s.tmp, MEMORIAL_EVENT), "a memorial's repeatable quests without submissions are not drops"
        assert not m._farm_event_passes(s.tmp, OLD_EVENT), "an event with no shop rows fails the test"

        s.spy_json()
        m._farm_event_passes(s.tmp, OLD_EVENT)
        assert not any(f.startswith("nice_war") for f in s.fetched), "an empty shop never pays for a war read"
        s.fetched.clear()
        m._farm_event_passes(s.tmp, LIVE_EVENT)
        assert "nice_item.json" not in s.fetched, "the farm test reads quest drops, not the shop exports"

    with Sandbox() as s:
        inner = fixture_json

        def detail_down(cache_dir, filename, url, force=False):
            if filename == "nice_event_80639.json":
                raise RuntimeError("detail down")
            return inner(cache_dir, filename, url, force=force)

        m.get_cached_json = detail_down
        raised = False
        try:
            m._farm_event_passes(s.tmp, LIVE_EVENT)
        except RuntimeError:
            raised = True
        assert raised, "an event that cannot be read raises instead of being silently pruned"
    return 1


def check_farm_test_read_outage():
    """Round-1 review: a WAR or QUEST read failing is the same outage as a failing event detail.
    Swallowed, the farm-event test sees no repeatable quest, prunes the event, the fallback scan
    hits the memo, and a stub replaces a good previous file — the first CI run after a cache-key
    rotation. So the test path is strict; only the snapshot's farm collection stays lenient."""

    def war_down(cache_dir, filename, url, force=False):
        if filename.startswith("nice_war"):
            raise RuntimeError("war export down")
        return fixture_json(cache_dir, filename, url, force=force)

    def quest_down(cache_dir, filename, url, force=False):
        if filename.startswith("nice_quest"):
            raise RuntimeError("quest detail down")
        return fixture_json(cache_dir, filename, url, force=force)

    for broken in (war_down, quest_down):
        with Sandbox() as s:
            m.get_cached_json = broken
            raised = False
            try:
                m._farm_event_passes(s.tmp, LIVE_EVENT)
            except RuntimeError:
                raised = True
            assert raised, f"{broken.__name__}: an unreadable read must raise, never silently prune"

    with Sandbox() as s:
        m.get_cached_json = war_down
        farm = m._collect_farm(s.tmp, [9208], [94164000, 94164001])
        assert farm == {"quests": [], "best": {}}, "the snapshot path stays lenient: an outage is an empty quest list"
        assert m._collect_farm_quests(s.tmp, [9208]) == [], "the lenient read still memoizes what it could collect"
        m._farm_quests_results.clear()
        m.get_cached_json = fixture_json
        assert m._farm_event_passes(s.tmp, LIVE_EVENT), "a strict test after a lenient read re-reads the war: nothing was poisoned"

    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        with open(m.EVENT_SHOP_JS, "w", encoding="utf-8") as f:
            f.write("export const EVENT_SHOP_DATA = {\"events\": [\"PREVIOUS\"]};\n")
        m.get_cached_json = war_down
        m.sync_event_shop(cache_dir=s.tmp)
        with open(m.EVENT_SHOP_JS, "r", encoding="utf-8") as f:
            assert "PREVIOUS" in f.read(), "a war outage during selection raises to the outage policy, not a stub"
    return 6


def check_past_farm_selection():
    """Amendment L1: the list is the ACTIVE farm events PLUS the LATEST 1 past farm event — the
    newest ENDED eventQuest passing the farm test in a capped newest-first scan."""
    with Sandbox() as s:
        picked = [e["id"] for e in m._select_farm_events(s.tmp, [MEMORIAL_EVENT, EARLIER_LIVE_EVENT, ENDED_FARM_EVENT], now=NOW)]
        assert picked == [70001], "no active farm event: the past entry ships alone"

        both = [e["id"] for e in m._select_farm_events(s.tmp, [LIVE_EVENT, SECOND_FARM_EVENT, ENDED_FARM_EVENT, MEMORIAL_EVENT], now=NOW)]
        assert both == [80639, 80642, 70001], "actives newest-first, then the latest past event — appended, never replacing"

        only_past = [e["id"] for e in m._select_farm_events(s.tmp, [ENDED_FARM_EVENT, OLD_EVENT], now=NOW)]
        assert only_past == [70001], "OLD_EVENT has no shop; the closed farm event is the first ended one that passes"

        fillers = [dict(ENDED_FARM_EVENT, id=90000 + i, startedAt=1792000000 + i) for i in range(1, 30)]
        assert [e["id"] for e in m._select_farm_events(s.tmp, fillers + [ENDED_FARM_EVENT], now=NOW)] == [70001], (
            "the 30th ended candidate is still inside the cap"
        )
        fillers.append(dict(ENDED_FARM_EVENT, id=90030, startedAt=1792030000))
        assert m._select_farm_events(s.tmp, fillers + [ENDED_FARM_EVENT], now=NOW) == [], (
            "the 31st candidate is outside the cap: the scan stops at 30"
        )

    with Sandbox() as s:
        inner = fixture_json

        def ended_down(cache_dir, filename, url, force=False):
            if filename == "nice_event_70001.json":
                raise RuntimeError("ended event unreadable")
            return inner(cache_dir, filename, url, force=force)

        m.get_cached_json = ended_down
        raised = False
        try:
            m._select_farm_events(s.tmp, [ENDED_FARM_EVENT], now=NOW)
        except RuntimeError:
            raised = True
        assert raised, "a past candidate that cannot be read raises when nothing active shipped: one hiccup must not stub a good previous file"

        shipping = m._select_farm_events(s.tmp, [LIVE_EVENT, ENDED_FARM_EVENT], now=NOW)
        assert [e["id"] for e in shipping] == [80639], "with an active farm event shipping, the same raise only drops the history entry"
    return 1


def check_override_bypass():
    """Amendment J5/L1: --event-id ships whatever it names — every filter skipped, campaign and
    closed events included — with the new farm/trades keys."""
    with Sandbox() as s:
        m.sync_event_shop(cache_dir=s.tmp, event_id=80630)
        data = s.read_data()
        assert [snap["event"]["id"] for snap in data["events"]] == [80630], "the campaign shop the farm pass prunes ships under --event-id"
        assert data["events"][0]["farm"] == {"quests": [], "best": {}}, "override snapshot keeps the empty farm shape: no war, no quests, no best entries"
        assert data["events"][0]["trades"] == [], "a shop with no upgrade rows ships an empty trades list"
        m.sync_event_shop(cache_dir=s.tmp, event_id=80639)
        snap = s.read_data()["events"][0]
        assert snap["farm"]["best"] == {"94164000": 94164100, "94164001": 94164101, "94164002": 94164102}, "override ships the full farm model too"
        assert [t["toId"] for t in snap["trades"]] == [94164001, 94164002], "and the parsed upgrade trades"
        m.sync_event_shop(cache_dir=s.tmp, event_id=70000)
        assert s.read_data() == {"events": []}, "an override onto an event with no shop rows yields the empty list"
    return 1


def check_no_duplicate_fetches():
    """Amendment J efficiency, kept under L: test, snapshot and past scan share one read per
    event/war/quest file per run — including the history event's own detail."""
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        s.spy_json()
        m.sync_event_shop(cache_dir=s.tmp)
        for filename in ("nice_event_80639.json", "nice_event_80642.json", "nice_event_70001.json", "nice_war_9208.json", "nice_quest_94164100_1.json"):
            assert s.fetched.count(filename) == 1, f"{filename} read exactly once: the farm test's reads feed the snapshot"
    return 1


def check_entry_mapping():
    """Entry mapping + icon resolution over the fixture network."""
    with Sandbox() as s:
        item_map = {it["id"]: it for it in NICE_ITEM_MAP}
        names = {"na": {it["id"]: it for it in NA_ITEM_MAP}, "jpEn": {it["id"]: it for it in JP_EN_ITEM_MAP}, "jp": item_map, "naEquips": {it["id"]: it for it in NA_EQUIP_MAP}}
        coin = _entry_by_id(80639005)
        ce = _entry_by_id(80639002)
        ticket = _entry_by_id(80639006)

        assert m._resolve_entry_icon(coin, item_map, s.tmp) == ("item", 705500, "JP/Coins/705500.png")
        assert m._resolve_entry_icon(ce, item_map, s.tmp) == ("equip", 9409690, "JP/Faces/f_94096900.png"), "lowest equip face"
        assert m._resolve_entry_icon(ticket, item_map, s.tmp) is None, "unknown purchaseType -> no icon"
        crystal = {"id": 1, "purchaseType": "servant", "targetIds": [9570400], "cost": {"item": GOLD, "amount": 1}}
        assert m._resolve_entry_icon(crystal, item_map, s.tmp) == ("equip", 9570400, f"{m.STATIC_BASE}/JP/Faces/f_95704000.png"), "ascension face fallback for non-CE servant rows"
        orphan = dict(coin, targetIds=[99999999])
        assert m._resolve_entry_icon(orphan, item_map, s.tmp) == ("item", 99999999, None)
        assert m._shop_item(_entry_by_id(80639007), item_map, s.tmp) is None, "amount 0 is not a purchasable row"
        slim = m._shop_item(coin, item_map, s.tmp, names=names)
        assert set(slim) == {"id", "name", "purchaseType", "cost", "limitNum", "setNum", "priority", "icon"}, "slim item shape"
        assert slim["cost"] == {"itemId": 94164002, "amount": 10}
        assert slim["name"] == "Servant Coin", "NA name wins over the shop entry's JP text"
        assert m._shop_item(coin, item_map, s.tmp)["name"] == "サーヴァントコイン", "no name maps -> the chain's JP step"
        entry_only = dict(coin, targetIds=[99999999])
        assert m._shop_item(entry_only, item_map, s.tmp, names=names)["name"] == "サーヴァントコイン（松永久秀）", "an id no map knows keeps the entry's own text"
        assert m._shop_item(ce, item_map, s.tmp, names=names)["name"] == "Kawanakajima Charge", "NA equip name wins"
        assert m._shop_item(ce, item_map, s.tmp, names={**names, "naEquips": {}})["name"] == "いざ、尋常に川中島！？", "no NA row -> the lang=en detail"
        assert m._shop_item(_entry_by_id(80639001), item_map, s.tmp, names=names)["name"] == "霊衣「夏の奇兵隊」開放権", "costume rows keep the entry name"
        no_name = m._shop_item({"id": 1, "purchaseType": "item", "targetIds": [7400], "cost": {"item": GOLD, "amount": 3}}, item_map, s.tmp)
        assert no_name["name"] == "魔法の宝石", "an entry with no name borrows the JP item map"
        untyped = m._shop_item({"id": 2, "purchaseType": "item", "targetIds": [99999999], "cost": {"item": GOLD, "amount": 3}}, item_map, s.tmp)
        assert untyped["name"] == "", "an unknown target with no entry name yields an empty name, not a crash"
    return 1


def check_sync_multi_event():
    """Happy path (Amendment L1): both active FARM shops plus the latest past farm event ship,
    campaign and memorial are pruned."""
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        m.sync_event_shop(cache_dir=s.tmp)
        data = s.read_data()
        ids = [snap["event"]["id"] for snap in data["events"]]
        assert ids == [80639, 80642, 70001], "farm events newest-first with the latest past entry after them; the campaign and memorial are pruned"
        snap = data["events"][0]
        assert snap["event"]["shortName"] == "GudaPuni"
        assert snap["event"]["startedAt"] == 1794394800
        assert [c["id"] for c in snap["currencies"]] == [94164000, 94164001, 94164002], "currencies sorted asc"
        assert snap["currencies"][2]["background"] == "gold"
        assert snap["currencies"][0]["name"] == "MISOおでん", "untranslated currency keeps the JP name"
        assert [i["id"] for i in snap["items"]] == [80639001, 80639006, 80639002, 80639005, 80639008, 80639009, 80639053, 80639054, 80639055], "items sorted (priority, id)"
        icons = {i["id"]: i["icon"] for i in snap["items"]}
        assert icons[80639001] == "event_shop/costume_20470011.webp"
        assert icons[80639002] == "event_shop/equip_9409690.webp"
        assert icons[80639005] == "event_shop/item_705500.webp"
        assert icons[80639006] is None, "unknown type keeps the row, drops the icon"
        assert icons[80639008] == "event_shop/item_705500.webp", "the same asset is reused across rows"
        assert icons[80639053] == "event_shop/item_94164001.webp", "the trade row's reward reuses the currency's own icon"
        fetched = [dest for _path, dest, _kind in s.icon_calls]
        assert len(fetched) == len(set(fetched)) == 8, (
            "one fetch per unique asset, and the pruned events' ticket currency and chalice are never downloaded"
        )
        assert os.path.exists(os.path.join(m.PUBLIC_EVENT_SHOP_DIR, "item_705500.webp"))

        farm = snap["farm"]
        assert [q["questId"] for q in farm["quests"]] == [94164100, 94164103, 94164101, 94164102, 94164106], (
            "the shipped quest list is the farm model the site reads: challenge and no-submission quests out"
        )
        assert farm["best"] == {"94164000": 94164100, "94164001": 94164101, "94164002": 94164102}
        assert farm["quests"][0]["recommendLv"] == "70"
        assert farm["quests"][0]["drops"]["94164001"] == {"dropExpected": 1.8829, "num": 3}, (
            "every shop-currency drop line ships in the generated snapshot, not just the best"
        )
        assert snap["trades"] == [
            {"fromId": 94164000, "toId": 94164001, "costAmount": 10, "getNum": 1},
            {"fromId": 94164001, "toId": 94164002, "costAmount": 10, "getNum": 1},
        ], "the upgrade trades ship parsed and sorted"

        second = _snapshot(data, 80642)
        assert [c["id"] for c in second["currencies"]] == [94164002], "the second farm event keeps its own currencies"
        assert [i["id"] for i in second["items"]] == [80642001]
        assert second["items"][0]["name"] == "Chalice", "NA name wins in the second event too"
        assert [q["questId"] for q in second["farm"]["quests"]] == [94164101, 94164102], "only quests dropping ITS currencies are farm quests for it"
        assert second["farm"]["best"] == {"94164002": 94164102}, "the same war's drops hydrate the second event"
        assert second["trades"] == [], "no upgrade rows in its own shop, no trades"

        past = _snapshot(data, 70001)
        assert past["farm"]["best"] == farm["best"], "the history entry carries the full farm model, same war data"
        assert len(past["trades"]) == 2, "and its trades — the planner tests past events with the same math"
    return 1


def check_lore_not_fetched_unless_needed():
    """Amendment F1: the 195 MB lore export is read only when a servant has several costumes."""
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        s.spy_json()
        m.sync_event_shop(cache_dir=s.tmp)
        assert m.LORE_EXPORT_FILENAME not in s.fetched, "the live event's servant has one costume, so no lore"

    with Sandbox() as s:
        s.spy_json()
        item_map = {it["id"]: it for it in NICE_ITEM_MAP}
        m._resolve_entry_icon(_entry_by_id(80639001), item_map, s.tmp)
        assert m.LORE_EXPORT_FILENAME not in s.fetched, "a single costume key is answered without lore"
        m._resolve_entry_icon(COSTUME_RELEASE_ENTRY, item_map, s.tmp)
        assert m.LORE_EXPORT_FILENAME in s.fetched, "several keys pay for the lore exactly once"
        m._resolve_entry_icon(COSTUME_RELEASE_ENTRY, item_map, s.tmp)
        assert s.fetched.count(m.LORE_EXPORT_FILENAME) == 1, "the lore is read once per run"
    return 1


def check_outage_policy():
    """Total failure keeps the previous file; a single event failing does not sink the run."""
    with Sandbox() as s:

        def boom(*a, **k):
            raise RuntimeError("Atlas down")

        m.get_cached_json = boom
        m.sync_event_shop(cache_dir=s.tmp)
        assert s.read_data() == {"events": []}, "no previous file -> empty list stub"

    with Sandbox() as s:
        with open(m.EVENT_SHOP_JS, "w", encoding="utf-8") as f:
            f.write("export const EVENT_SHOP_DATA = {\"events\": [\"PREVIOUS\"]};\n")
        m.get_cached_json = boom
        m.sync_event_shop(cache_dir=s.tmp)
        with open(m.EVENT_SHOP_JS, "r", encoding="utf-8") as f:
            assert "PREVIOUS" in f.read(), "previous snapshot survives an outage"

    with Sandbox() as s:
        m.get_cached_json = lambda cache_dir, filename, url, force=False: [STORY]
        m.sync_event_shop(cache_dir=s.tmp)
        assert s.read_data() == {"events": []}, "healthy API, nothing open -> empty list (not an exception path)"

    # One open farm event whose detail fetch raises while the other answers: the good one still
    # ships — and the history entry rides along with it.
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        inner = fixture_json

        def partial(cache_dir, filename, url, force=False):
            if filename == "nice_event_80642.json":
                raise RuntimeError("single event down")
            return inner(cache_dir, filename, url, force=force)

        m.get_cached_json = partial
        m.sync_event_shop(cache_dir=s.tmp)
        data = s.read_data()
        assert [snap["event"]["id"] for snap in data["events"]] == [80639, 70001], "the failing farm event is skipped, the other plus the history entry ship"

    # Every farm-test fetch failing is a total failure: the fallback scan raises too, and the
    # caller's outage policy keeps the previous file instead of stubbing over it (Amendment J).
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        with open(m.EVENT_SHOP_JS, "w", encoding="utf-8") as f:
            f.write("export const EVENT_SHOP_DATA = {\"events\": [\"PREVIOUS\"]};\n")

        def all_events_down(cache_dir, filename, url, force=False):
            if filename.startswith("nice_event_"):
                raise RuntimeError("every event detail is failing")
            return fixture_json(cache_dir, filename, url, force=force)

        m.get_cached_json = all_events_down
        m.sync_event_shop(cache_dir=s.tmp)
        with open(m.EVENT_SHOP_JS, "r", encoding="utf-8") as f:
            assert "PREVIOUS" in f.read(), "total failure keeps the previous file"
    return 1


def check_icon_candidates():
    """_make_event_icon: bordered attempted first, plain only as a 404 fallback."""
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

        # bordered 5xx/timeout: re-raise, NEVER fall back to plain, write nothing —
        # _event_icon_file skips an existing dest forever, so shipping a plain icon here would
        # make the downgrade permanent.
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

        # id containing "404" (f_9404xxx): the URL embedded in the RuntimeError must not misread a
        # bordered 5xx as a 404. Gate on the HTTPError phrase "HTTP Error 404" only.
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

        # companion: a real "HTTP Error 404" on the same id still fires the plain fallback
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
    return 6


def main():
    n = 0
    for check in (
        check_select_events,
        check_name_chain,
        check_costume_faces,
        check_farm_pick,
        check_challenge_exclusion,
        check_shop_trades,
        check_farm_event_test,
        check_farm_test_read_outage,
        check_past_farm_selection,
        check_override_bypass,
        check_no_duplicate_fetches,
        check_entry_mapping,
        check_sync_multi_event,
        check_lore_not_fetched_unless_needed,
        check_outage_policy,
        check_icon_candidates,
    ):
        n += check()
    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
