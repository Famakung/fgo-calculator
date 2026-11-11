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

QUEST_A = {"id": 1, "type": "eventQuest", "startedAt": 1794394800}
QUEST_B = {"id": 2, "type": "eventQuest", "startedAt": 1794394800}
QUEST_C = {"id": 3, "type": "eventQuest"}
STORY = {"id": 4, "type": "storyQuest", "startedAt": 1900000000}
GOLD = {"id": 94164002, "name": "YAKI bun", "icon": "JP/Items/94164002.png", "background": "gold"}


def no_icon_fetch(*args, **kwargs):
    raise AssertionError("icon download attempted — this probe must stay offline")


def main():
    n = 0

    # --- pick_event: a tie is broken by list order, and that order must be the API's, not a sort ---
    assert m.pick_event([QUEST_A, QUEST_B])["id"] == 1, "startedAt tie takes the first listed event"
    assert m.pick_event([QUEST_B, QUEST_A])["id"] == 2, "the tie follows list order, not id order"
    n += 1

    # --- pick_event: an event without startedAt is never "now", it is the oldest possible ---
    assert m.pick_event([QUEST_C, QUEST_A])["id"] == 1, "missing startedAt cannot outrank a real one"
    assert m.pick_event([QUEST_C, dict(QUEST_C, startedAt=None)])["id"] == 3, "all-undated list returns the first"
    assert m.pick_event([dict(QUEST_A, startedAt=None), QUEST_B])["id"] == 2, "explicit None behaves like absent"
    n += 1

    # --- pick_event: the override is an id lookup, not a type filter ---
    assert m.pick_event([QUEST_A, STORY], 4)["id"] == 4, "--event-id may point at a non-eventQuest"
    assert m.pick_event([QUEST_A], None)["id"] == 1, "None means auto-pick"
    assert m.pick_event([QUEST_A, dict(QUEST_A, id=0)], 0)["id"] == 0, "override 0 is a lookup, not 'no override'"
    assert m.pick_event([], 80639) is None, "empty list with an override finds nothing"
    assert m.pick_event([]) is None, "empty list auto-picks nothing"
    assert m.pick_event([STORY]) is None, "stories alone never become the shop snapshot"
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

    # --- _collect_event_shop: a currency only seen on free (amount<=0) entries must not register ---
    # Otherwise the planner renders a ghost chip + empty group for a currency nothing can buy.
    BRONZE = {"id": 94164000, "name": "MISO oden", "icon": "JP/Items/94164000.png", "background": "bronze"}
    free_only = {"id": 1, "name": "Free loginreward", "purchaseType": "item", "targetIds": [705500], "cost": {"item": BRONZE, "amount": 0}}
    paid_row = {"id": 2, "name": "YAKI bun pack", "purchaseType": "item", "targetIds": [705500], "cost": {"item": GOLD, "amount": 10}}

    def collect_json(cache_dir, filename, url, force=False):
        if filename == "basic_event.json":
            return [{"id": 1, "type": "eventQuest", "startedAt": 1}]
        if filename == "nice_event_1.json":
            return {"id": 1, "shop": [free_only, paid_row]}
        if filename == "nice_item.json":
            return item_map
        raise AssertionError(f"unexpected cache filename {filename!r} (url {url})")

    with patch.object(m, "get_cached_json", collect_json), patch.object(m, "_make_event_icon", no_icon_fetch):
        payload = m._collect_event_shop("/tmp", None, dry_run=True)
    assert [c["id"] for c in payload["currencies"]] == [94164002], "a free-entry-only currency stays out of the registry"
    assert [i["id"] for i in payload["items"]] == [2], "the free entry itself is still dropped from items"
    n += 1

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
