"""Self-checks for the event shop sync path in sync_atlas_data.py.

Run: python3 scripts/test_sync_event_shop.py

Fully offline: get_cached_json / _make_event_icon are swapped for fixture doubles, so no network
and no Pillow are needed (the CI self-test job installs neither). Mirrors the stub-keeping policy
and the EVENT_SHOP_DATA output shape the site ships: Amendment G's `{ events: [...] }` list, each
snapshot carrying Amendment D's farm map, Amendment E's NA-first names, Amendment F's costume
faces and Amendment J's farm-event selection (campaigns and memorials pruned, latest-farm fallback).

The pre-G single-event fixtures are adapted to the events[] shape; no assertion was dropped — the
old checks now run per snapshot, and the new ones cover the window filter, farm pick, name chain,
costume resolution and the Amendment J selection rules.
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

# A closed event and a live one: only the live one may reach the output.
OLD_EVENT = {"id": 70000, "name": "Old event", "shortName": "Old", "type": "eventQuest", "startedAt": 1700000000, "finishedAt": 1700999999}
LIVE_EVENT = {"id": 80639, "name": "Gudagudapuni Puni Wars!", "shortName": "GudaPuni", "type": "eventQuest", "startedAt": 1794394800, "finishedAt": 1796788799, "warIds": [9208]}
EARLIER_LIVE_EVENT = {"id": 80630, "name": "100M DL campaign", "shortName": "100M", "type": "eventQuest", "startedAt": 1794052800, "finishedAt": 1798729199, "warIds": []}
# Amendment J fixtures: a second ACTIVE farm event (multi-active kept), a live MEMORIAL (repeatable
# quests, zero drop submissions -> pruned) and an ENDED farm event for the fallback scan.
SECOND_FARM_EVENT = {"id": 80642, "name": "Second farm event", "shortName": "Second", "type": "eventQuest", "startedAt": 1794200000, "finishedAt": 1796788799, "warIds": [9208]}
MEMORIAL_EVENT = {"id": 80379, "name": "Memorial battle", "shortName": "Memorial", "type": "eventQuest", "startedAt": 1794300000, "finishedAt": 1796788799, "warIds": [9999]}
ENDED_FARM_EVENT = {"id": 70001, "name": "Ended farm event", "shortName": "Ended", "type": "eventQuest", "startedAt": 1700000000, "finishedAt": 1700999999, "warIds": [9208]}
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

# Farm drops (Amendment D). Two quests tie on MISO so the lower quest id must win.
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
        {"id": 920702, "quests": []},
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


def _quest(quest_id, name, recommend_lv, ap, drops):
    return {"id": quest_id, "name": name, "recommendLv": recommend_lv, "consume": ap, "drops": drops}


QUEST_FIXTURES = {
    "nice_quest_94164100_1.json": _quest(94164100, "【GUNMA巡り】だるまを買いにいこう", "70", 40, [
        {"type": "item", "objectId": 94164000, "num": 3, "dropExpected": 10.711711711711711, "runs": 111},
        {"type": "item", "objectId": 94164001, "num": 3, "dropExpected": 1.882882882882883, "runs": 111},
        # Event points: the biggest drop on the quest, and never a card's second line (Amendment I1),
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
    ]),
    # A quest nobody has submitted drops for: dropExpected absent entirely.
    "nice_quest_94164104_1.json": _quest(94164104, "no submissions", "90", 50, [
        {"type": "item", "objectId": 94164002, "num": 3, "runs": 0},
    ]),
}


def fixture_json(cache_dir, filename, url, force=False):
    """Stand-in for get_cached_json, keyed on the plan's cache filenames."""
    if filename == "basic_event.json":
        return [OLD_EVENT, LIVE_EVENT, EARLIER_LIVE_EVENT, MEMORIAL_EVENT, SECOND_FARM_EVENT, STORY, NO_END_EVENT]
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
    """Amendment D1: best dropExpected×num per shop currency, ties to the lower quest id."""
    with Sandbox() as s:
        quests = m._collect_farm_quests(s.tmp, [9208])
        assert sorted(q["questId"] for q in quests) == [94164100, 94164101, 94164102, 94164103, 94164104], "repeatLast and repeat only"

        miso = m._best_farm_entry(quests, 94164000)
        assert miso["questId"] == 94164100, "the 10.7117 x 3 tie goes to the lower quest id"
        assert miso["questName"] == "【GUNMA巡り】だるまを買いにいこう"
        assert miso["recommendLv"] == "70", "recommendLv is Atlas' string"
        assert miso["ap"] == 40
        assert miso["dropExpected"] == 10.7117, "dropExpected keeps 4 decimals"
        assert miso["num"] == 3 and miso["sampleRuns"] == 111
        assert "amount" not in miso, "the ranking figure stays internal"

        assert m._best_farm_entry(quests, 94164001)["questId"] == 94164101, "silver peaks at its own quest"
        assert m._best_farm_entry(quests, 94164002)["questId"] == 94164102
        assert m._best_farm_entry(quests, 94164002)["dropExpected"] == 10.8315
        assert m._best_farm_entry(quests, 94162101) is None, "a currency nobody drops is null"
        assert m._best_farm_entry(quests, 94164003) is None, "a quest with no submissions contributes nothing"
        assert m._collect_farm(s.tmp, [], [94164000]) == {"94164000": None}, "an event with no war has no farm data"
    return 1


def check_farm_secondary():
    """Amendment I1: each farm entry also names the same quest's next-best SHOP-currency drop."""
    shop_ids = [94164000, 94164001, 94164002]
    with Sandbox() as s:
        quests = m._collect_farm_quests(s.tmp, [9208])
        farm = m._collect_farm(s.tmp, [9208], shop_ids)

        miso = farm["94164000"]
        assert miso["questId"] == 94164100
        assert miso["secondary"] == {"currencyId": 94164001, "dropExpected": 1.8829, "num": 3}, (
            "the quest's other shop currency is the second line, at its own figures"
        )

        assert farm["94164001"]["secondary"] == {"currencyId": 94164002, "dropExpected": 2.0351, "num": 3}, (
            "the silver card pairs with the gold the same quest drops"
        )
        assert farm["94164002"]["secondary"] == {"currencyId": 94164000, "dropExpected": 2.3258, "num": 3}, (
            "two bronze lines on one quest: the higher amount per run wins, 2.3258x3 over 6.0x1"
        )
        secondaries = [entry["secondary"]["currencyId"] for entry in farm.values() if entry["secondary"]]
        assert 94164050 not in secondaries, "event points are never a second line, however big the drop"
        assert all(currency_id in shop_ids for currency_id in secondaries), "every secondary is a shop currency"

        single = m._find_farm_quest(quests, 94164103)
        assert m._secondary_drop(single, 94164000, shop_ids) is None, "a quest whose only shop currency is the card's own has no second line"
        assert m._farm_entry(quests, 94162101, shop_ids) is None, "a currency nobody drops stays null, secondary and all"

    tie_quest = m._farm_quest(
        {"id": 94164199, "name": "tie", "recommendLv": "70", "consume": 40},
        {
            "id": 94164199,
            "name": "tie",
            "recommendLv": "70",
            "consume": 40,
            "drops": [
                {"type": "item", "objectId": 94164002, "num": 2, "dropExpected": 3.0, "runs": 10},
                {"type": "item", "objectId": 94164001, "num": 3, "dropExpected": 2.0, "runs": 10},
            ],
        },
    )
    assert m._secondary_drop(tie_quest, 94164000, shop_ids) == {"currencyId": 94164001, "dropExpected": 2.0, "num": 3}, (
        "6 per run on two currencies: the lower currency id is the deterministic pick"
    )
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
        assert farm == {"94164000": None, "94164001": None}, "the snapshot path stays lenient: an outage is a null farm entry"
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


def check_farm_fallback():
    """Amendment J: no active farm event -> the LATEST FARM event wins the capped newest-first scan."""
    with Sandbox() as s:
        picked = [e["id"] for e in m._select_farm_events(s.tmp, [MEMORIAL_EVENT, EARLIER_LIVE_EVENT, ENDED_FARM_EVENT], now=NOW)]
        assert picked == [70001], "the newest entries are a memorial and a campaign; the ended farm event ships alone"

        fillers = [dict(EARLIER_LIVE_EVENT, id=90000 + i) for i in range(1, 30)]
        assert [e["id"] for e in m._select_farm_events(s.tmp, fillers + [ENDED_FARM_EVENT], now=NOW)] == [70001], (
            "the 30th scan candidate is still inside FARM_FALLBACK_SCAN_CAP"
        )
        fillers.append(dict(EARLIER_LIVE_EVENT, id=90030))
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
        assert raised, "a fallback candidate that cannot be read raises: one hiccup must not stub a good previous file"
    return 1


def check_override_bypass():
    """Amendment J5: --event-id ships whatever it names — every filter skipped, campaign included."""
    with Sandbox() as s:
        m.sync_event_shop(cache_dir=s.tmp, event_id=80630)
        data = s.read_data()
        assert [snap["event"]["id"] for snap in data["events"]] == [80630], "the campaign shop the active pass prunes ships under --event-id"
        assert data["events"][0]["farm"] == {"94162101": None}, "override snapshot keeps the null-farm shape: every currency a key, not a missing one"
        m.sync_event_shop(cache_dir=s.tmp, event_id=70000)
        assert s.read_data() == {"events": []}, "an override onto an event with no shop rows yields the empty list"
    return 1


def check_no_duplicate_fetches():
    """Amendment J efficiency: test and snapshot share one read per event/war/quest file per run."""
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        s.spy_json()
        m.sync_event_shop(cache_dir=s.tmp)
        for filename in ("nice_event_80639.json", "nice_event_80642.json", "nice_war_9208.json", "nice_quest_94164100_1.json"):
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
    """Happy path (Amendment J): both active FARM shops ship, campaign and memorial are pruned."""
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        m.sync_event_shop(cache_dir=s.tmp)
        data = s.read_data()
        ids = [snap["event"]["id"] for snap in data["events"]]
        assert ids == [80639, 80642], "farm events newest-first; the campaign (no war) and memorial (no drops) shops are pruned"
        snap = data["events"][0]
        assert snap["event"]["shortName"] == "GudaPuni"
        assert snap["event"]["startedAt"] == 1794394800
        assert [c["id"] for c in snap["currencies"]] == [94164000, 94164001, 94164002], "currencies sorted asc"
        assert snap["currencies"][2]["background"] == "gold"
        assert snap["currencies"][0]["name"] == "MISOおでん", "untranslated currency keeps the JP name"
        assert [i["id"] for i in snap["items"]] == [80639001, 80639006, 80639002, 80639005, 80639008, 80639009], "items sorted (priority, id)"
        icons = {i["id"]: i["icon"] for i in snap["items"]}
        assert icons[80639001] == "event_shop/costume_20470011.webp"
        assert icons[80639002] == "event_shop/equip_9409690.webp"
        assert icons[80639005] == "event_shop/item_705500.webp"
        assert icons[80639006] is None, "unknown type keeps the row, drops the icon"
        assert icons[80639008] == "event_shop/item_705500.webp", "the same asset is reused across rows"
        fetched = [dest for _path, dest, _kind in s.icon_calls]
        assert len(fetched) == len(set(fetched)) == 8, (
            "one fetch per unique asset, and the pruned events' ticket currency and chalice are never downloaded"
        )
        assert os.path.exists(os.path.join(m.PUBLIC_EVENT_SHOP_DIR, "item_705500.webp"))

        farm = snap["farm"]
        assert sorted(farm.keys()) == ["94164000", "94164001", "94164002"], "farm covers exactly the shop currencies"
        assert farm["94164000"]["questId"] == 94164100 and farm["94164000"]["recommendLv"] == "70"
        assert farm["94164002"]["questId"] == 94164102
        assert farm["94164000"]["secondary"] == {"currencyId": 94164001, "dropExpected": 1.8829, "num": 3}, (
            "the secondary drop ships in the generated snapshot, not just in the picker"
        )

        second = _snapshot(data, 80642)
        assert [c["id"] for c in second["currencies"]] == [94164002], "the second farm event keeps its own currencies"
        assert [i["id"] for i in second["items"]] == [80642001]
        assert second["items"][0]["name"] == "Chalice", "NA name wins in the second event too"
        assert sorted(second["farm"]) == ["94164002"], "its farm map covers only its own currency"
        assert second["farm"]["94164002"]["questId"] == 94164102, "the same war's drops hydrate the second event"
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

    # One open farm event whose detail fetch raises while the other answers: the good one still ships.
    with Sandbox() as s, patch.object(m.time, "time", lambda: NOW):
        inner = fixture_json

        def partial(cache_dir, filename, url, force=False):
            if filename == "nice_event_80642.json":
                raise RuntimeError("single event down")
            return inner(cache_dir, filename, url, force=force)

        m.get_cached_json = partial
        m.sync_event_shop(cache_dir=s.tmp)
        data = s.read_data()
        assert [snap["event"]["id"] for snap in data["events"]] == [80639], "the failing farm event is skipped, the other ships"

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
        check_farm_secondary,
        check_farm_event_test,
        check_farm_test_read_outage,
        check_farm_fallback,
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
