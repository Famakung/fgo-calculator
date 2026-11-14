"""Adversarial self-checks for the event shop sync helpers in sync_atlas_data.py.

Run: python3 scripts/test_sync_event_shop_adversarial.py

Companion to scripts/test_sync_event_shop.py (which owns the happy path, the bordered-first icon
order and the outage stub). This file pins the decisions nobody asked for but the nightly job will
eventually hit: two events opening on the same timestamp, an event with no startedAt at all, an
override id that points at a main story, and Atlas shop entries that arrive with missing or null
fields. Fully offline: no network, no Pillow, no writes.
"""

import os
import sys
import types
from unittest.mock import patch

if "PIL" not in sys.modules:
    _pil = types.ModuleType("PIL")
    _pil.Image = types.ModuleType("PIL.Image")
    sys.modules["PIL"] = _pil
    sys.modules["PIL.Image"] = _pil.Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_atlas_data as m  # noqa: E402

NOW = 1794500000
FAR = 1893423600
QUEST_A = {"id": 1, "type": "eventQuest", "startedAt": 1794394800, "finishedAt": FAR}
QUEST_B = {"id": 2, "type": "eventQuest", "startedAt": 1794394800, "finishedAt": FAR}
QUEST_C = {"id": 3, "type": "eventQuest", "finishedAt": FAR}
OLD_QUEST = {"id": 70000, "type": "eventQuest", "startedAt": 1700000000, "finishedAt": 1700999999}
STORY = {"id": 4, "type": "storyQuest", "startedAt": 1900000000, "finishedAt": FAR}
GOLD = {"id": 94164002, "name": "YAKI bun", "icon": "JP/Items/94164002.png", "background": "gold"}


def no_icon_fetch(*args, **kwargs):
    raise AssertionError("icon download attempted — this probe must stay offline")


def main():
    n = 0

    def picked(events, override_id=None):
        return [e["id"] for e in m.select_events(events, override_id, now=NOW)]

    # --- select_events: a tie is broken by list order, and that order must be the API's, not a sort ---
    assert picked([QUEST_A, QUEST_B]) == [1, 2], "startedAt tie keeps the first listed event first"
    assert picked([QUEST_B, QUEST_A]) == [2, 1], "the tie follows list order, not id order"
    n += 1

    # --- select_events: an undated event starts at the epoch, and a closed window is never live ---
    assert picked([QUEST_C, QUEST_A]) == [1, 3], "missing startedAt cannot outrank a real one"
    assert picked([QUEST_C, dict(QUEST_C, id=9, startedAt=None)]) == [3, 9], "absent and explicit None both read as epoch"
    assert picked([dict(QUEST_A, finishedAt=None)]) == [], "an event with no finishedAt has no window"
    assert picked([dict(QUEST_A, finishedAt=NOW)]) == [], "now is not yet inside a window ending now"
    assert picked([dict(QUEST_A, finishedAt=NOW + 1)]) == [1], "the window is half-open: < finishedAt"
    assert picked([dict(QUEST_A, startedAt=NOW + 1)]) == [], "a future start is not live yet"
    n += 1

    # --- select_events: the override is an id lookup, not a type filter or a window check ---
    assert picked([QUEST_A, STORY], 4) == [4], "--event-id may point at a non-eventQuest"
    assert picked([QUEST_A, OLD_QUEST], 70000) == [70000], "--event-id ignores a closed window"
    assert picked([QUEST_A]) == [1], "no override means the live list"
    assert picked([QUEST_A, dict(QUEST_A, id=0)], 0) == [0], "override 0 is a lookup, not 'no override'"
    assert m.select_events([], 80639) == [], "empty list with an override finds nothing"
    assert m.select_events([]) == [], "empty list auto-picks nothing"
    assert picked([STORY]) == [], "stories alone never become the shop snapshot"
    n += 1

    # --- _shop_item: half-filled Atlas entries must drop or default, never crash the sync ---
    item_map = {705500: {"id": 705500, "name": "Silver Coins", "icon": "JP/Coins/705500.png"}}
    base = {"id": 80639005, "purchaseType": "item", "targetIds": [705500], "cost": {"item": GOLD, "amount": 10}}

    with patch.object(m, "_make_event_icon", no_icon_fetch):
        assert m._shop_item(base, item_map, "/tmp", dry_run=True)["icon"] == "event_shop/item_705500.webp"
        assert m._shop_item(dict(base, cost=None), item_map, "/tmp", dry_run=True) is None, "no cost -> no row"
        assert m._shop_item({"id": 1, "cost": {"amount": 10}}, item_map, "/tmp", dry_run=True) is None, "cost without an item -> no row"
        assert m._shop_item(dict(base, cost={"item": {}, "amount": 10}), item_map, "/tmp", dry_run=True) is None, "cost item without id -> no row"
        assert m._shop_item(dict(base, cost={"item": GOLD, "amount": None}), item_map, "/tmp", dry_run=True) is None, "null amount -> no row"
        assert m._shop_item(dict(base, cost={"item": GOLD, "amount": -5}), item_map, "/tmp", dry_run=True) is None, "negative amount -> no row"
        defaulted = m._shop_item(
            {"id": 7, "purchaseType": "item", "targetIds": [705500], "cost": {"item": GOLD, "amount": 1}},
            item_map,
            "/tmp",
            dry_run=True,
        )
        assert defaulted["limitNum"] == 0, "absent limitNum becomes unlimited"
        assert defaulted["setNum"] == 1, "absent setNum becomes one"
        assert defaulted["priority"] == 0, "absent priority sorts first"
        assert defaulted["name"] == "Silver Coins", "an entry with no name borrows the item name"
        assert defaulted["purchaseType"] == "item"
        orphan = m._shop_item(dict(base, targetIds=[99999999], name=None), item_map, "/tmp", dry_run=True)
        assert orphan["name"] == "", "an unknown target with no entry name yields an empty name, not a crash"
        assert orphan["icon"] is None, "an item id the export does not know keeps a null icon, never a guessed URL"
    n += 1

    # --- _shop_currency: background is Atlas' own vocabulary, copied verbatim; falsy defaults to silver ---
    # Event 80292 ships "zero" (QP) live. The site's tier map ignores strings it cannot name and the
    # CSS :where() fallback absorbs them, so the sync never rewrites or rejects a non-empty value;
    # missing/empty/null fall to "silver" (the `or "silver"` default). validate_data.js then errors
    # on empty/non-string backgrounds only — a closed tier set there would reject the next Atlas word.
    with patch.object(m, "_make_event_icon", no_icon_fetch):
        currencies = {}
        zero = {"id": 94164003, "name": "QP", "icon": "JP/Items/94164003.png", "background": "zero"}
        m._shop_currency({"id": 1, "cost": {"item": zero, "amount": 1}}, currencies, {}, dry_run=True)
        assert currencies[94164003]["background"] == "zero", "an unknown tier string survives the sync untouched"
        no_bg = {"id": 94164004, "name": "No bg", "icon": "JP/Items/94164004.png"}
        m._shop_currency({"id": 2, "cost": {"item": no_bg, "amount": 1}}, currencies, {}, dry_run=True)
        assert currencies[94164004]["background"] == "silver", "missing background defaults to silver"
        blank = {"id": 94164005, "name": "Blank bg", "icon": "JP/Items/94164005.png", "background": ""}
        m._shop_currency({"id": 3, "cost": {"item": blank, "amount": 1}}, currencies, {}, dry_run=True)
        assert currencies[94164005]["background"] == "silver", "empty string background defaults to silver"
        null_bg = {"id": 94164006, "name": "Null bg", "icon": "JP/Items/94164006.png", "background": None}
        m._shop_currency({"id": 4, "cost": {"item": null_bg, "amount": 1}}, currencies, {}, dry_run=True)
        assert currencies[94164006]["background"] == "silver", "explicit null background defaults to silver"
    n += 1

    # --- _collect_event_shops: a currency only seen on free (amount<=0) entries must not register ---
    # Otherwise the planner renders a ghost chip + empty group for a currency nothing can buy.
    BRONZE = {"id": 94164000, "name": "MISO oden", "icon": "JP/Items/94164000.png", "background": "bronze"}
    free_only = {"id": 1, "name": "Free loginreward", "purchaseType": "item", "targetIds": [705500], "cost": {"item": BRONZE, "amount": 0}}
    paid_row = {"id": 2, "name": "YAKI bun pack", "purchaseType": "item", "targetIds": [705500], "cost": {"item": GOLD, "amount": 10}}

    def collect_json(cache_dir, filename, url, force=False):
        if filename == "basic_event.json":
            return [{"id": 1, "type": "eventQuest", "startedAt": 1, "finishedAt": FAR}]
        if filename == "nice_event_1.json":
            return {"id": 1, "shop": [free_only, paid_row]}
        if filename == "nice_item.json":
            return item_map
        return []  # the optional name-chain exports: an empty map simply keeps the entry's own name

    # Amendment J makes a no-war shop fail the farm-event test, so this mapping probe ships it the
    # way the site still can: --event-id, which skips every selection filter. The "no warIds means
    # an empty farm list, not missing keys" pin moves to the override path here.
    with patch.object(m, "get_cached_json", collect_json), patch.object(m, "_make_event_icon", no_icon_fetch):
        payload = m._collect_event_shops("/tmp", 1, dry_run=True)
    snapshot = payload["events"][0]
    assert [c["id"] for c in snapshot["currencies"]] == [94164002], "a free-entry-only currency stays out of the registry"
    assert [i["id"] for i in snapshot["items"]] == [2], "the free entry itself is still dropped from items"
    assert snapshot["farm"] == {"quests": [], "best": {}, "raids": []}, "no warIds means empty quest/raid lists and an empty best map, not missing keys"
    assert snapshot["trades"] == [], "no upgrade rows in this shop means an empty trades list, never a missing key"
    assert snapshot["bonusCes"] == [], "no matching bonus CEs means an empty bonusCes list, never a missing key"
    n += 1

    # --- an open eventQuest whose shop is empty is not an event shop: it drops out of the list ---
    # Event 6 needs a farmable war (Amendment J prunes no-drop shops); event 5 has no shop at all.
    farm_war = {"id": 77, "spots": [{"id": 770, "quests": [{"id": 771, "name": "farm quest", "afterClear": "repeatLast", "phases": [1]}]}]}
    farm_quest = {"id": 771, "name": "farm quest", "recommendLv": "50", "consume": 20,
                  "drops": [{"type": "item", "objectId": 94164002, "num": 1, "dropExpected": 1.0, "runs": 10}]}

    def empty_shop_json(cache_dir, filename, url, force=False):
        if filename == "basic_event.json":
            return [{"id": 5, "type": "eventQuest", "startedAt": 1, "finishedAt": FAR}, {"id": 6, "type": "eventQuest", "startedAt": 2, "finishedAt": FAR}]
        if filename == "nice_event_5.json":
            return {"id": 5, "shop": []}
        if filename == "nice_event_6.json":
            return {"id": 6, "shop": [paid_row], "warIds": [77]}
        if filename == "nice_war_77.json":
            return farm_war
        if filename == "nice_quest_771_1.json":
            return farm_quest
        if filename == "nice_item.json":
            return item_map
        return []

    with patch.object(m, "get_cached_json", empty_shop_json), patch.object(m, "_make_event_icon", no_icon_fetch):
        payload = m._collect_event_shops("/tmp", None, dry_run=True)
    assert [snap["event"]["id"] for snap in payload["events"]] == [6], "the shopless event is skipped, the one with rows ships"
    n += 1

    # --- _farm_quest_entry: quests with missing gift rows or only-unusable drops never ship ---
    bare_quest = {"questId": 1, "questName": "q", "recommendLv": "", "ap": 0, "drops": [], "gifts": None}
    assert m._farm_quest_entry(bare_quest, [94164002]) is None, "a quest with no drop lines is not a farm quest"
    junk_drops = {
        "questId": 2,
        "questName": "junk",
        "recommendLv": "",
        "ap": 0,
        "drops": [
            {"type": "item", "objectId": 94164002, "num": 3, "dropExpected": None, "runs": 4},
            {"type": "item", "objectId": 94164002, "num": 0, "dropExpected": 5.0, "runs": 4},
            {"type": "item", "objectId": 94164002, "num": 3, "dropExpected": -1.0, "runs": 4},
        ],
        "gifts": [],
    }
    assert m._farm_quest_entry(junk_drops, [94164002]) is None, "null, zero-stack and negative drop figures are all unusable"
    partial = dict(junk_drops, drops=junk_drops["drops"] + [{"type": "item", "objectId": 94164002, "num": 2, "dropExpected": 1.5, "runs": 9}])
    entry = m._farm_quest_entry(partial, [94164002])
    assert entry["drops"] == {"94164002": {"dropExpected": 1.5, "num": 2}} and entry["sampleRuns"] == 9, (
        "the one usable line ships, and sampleRuns counts its runs, not the junk rows' submissions"
    )
    gift_only = {"questId": 3, "questName": "challenge", "recommendLv": "", "ap": 0, "drops": [], "gifts": [{"objectId": 94164002, "num": 1}]}
    assert m._farm_quest_entry(gift_only, [94164002]) is None, "a challenge quest's gift is not a farm drop"
    n += 1

    # --- _shop_trades: half-filled rows drop out; ids, ratios and self-swaps must all hold ---
    currency_ids = [94164000, 94164002]
    assert m._shop_trades([None, {"purchaseType": "item"}, {"purchaseType": "item", "targetIds": [], "cost": {"item": GOLD, "amount": 5}}], currency_ids) == [], (
        "entries with no target, no cost or a null row are never trades"
    )
    assert m._shop_trades([{"purchaseType": "servant", "targetIds": [94164002], "cost": {"item": BRONZE, "amount": 10}, "setNum": 1}], currency_ids) == [], (
        "a servant row paying with a currency is not an upgrade trade"
    )
    assert m._shop_trades([{"purchaseType": "item", "targetIds": [94164002], "cost": {"item": BRONZE, "amount": 10}, "setNum": None}], currency_ids) == [], (
        "a row that sells nothing per purchase is not a usable ratio"
    )
    n += 1

    # --- _collect_bonus_ces: malformed equip entries, null skills/svals, invalid AddCount/rarity ---
    broken_equips = [
        None,
        {"id": 0, "skills": [{"functions": [{"funcType": "eventDropUp", "svals": [{"EventId": 1, "Individuality": 11, "AddCount": 1}]}]}]},
        {
            "id": 9400001,
            "name": "Junk CE",
            "rarity": 99,
            "skills": [
                None,
                {"functions": [None, {"funcType": "eventDropUp", "svals": [None, {"EventId": 1, "Individuality": 11, "AddCount": 0}, {"EventId": 1, "Individuality": 11, "AddCount": -2}]}]},
            ],
        },
        {
            "id": 9400002,
            "name": None,
            "rarity": None,
            "skills": [{"functions": [{"funcType": "eventDropUp", "svals": [{"EventId": 1, "Individuality": 11, "AddCount": 1}]}]}],
        },
    ]
    bad_items = {94164002: {"id": 94164002, "individuality": [None, {"id": 11}, {"id": -1}]}}
    with patch.object(m, "_make_event_icon", no_icon_fetch):
        ces = m._collect_bonus_ces(1, [94164002], bad_items, broken_equips, {"naEquips": {}}, dry_run=True)
    assert ces == [{"id": 9400002, "name": "", "rarity": 3, "icon": None, "bonuses": {"94164002": {"nonLimitBreak": 1, "limitBreak": 1}}}], (
        f"malformed rows drop out; missing rarity/name/face safely default (got {ces!r})"
    )
    assert m._collect_bonus_ces(1, [94164002], {}, broken_equips, {}, dry_run=True) == [], "no item individuality -> no bonus CEs"
    n += 1

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
