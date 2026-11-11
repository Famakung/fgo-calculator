import { test } from "node:test";
import assert from "node:assert/strict";
import { EventShop, Schema } from "../src/scripts/domain.js";

/* A limited coin row from the 2026-11 event shop: 10 YAKIまんじゅう per purchase, 3 allowed. */
const limited = {
  id: 80639005,
  name: "coin",
  purchaseType: "item",
  cost: { itemId: 94164002, amount: 10 },
  limitNum: 3,
  setNum: 10,
  priority: 1,
  icon: null,
};
/* An unlimited row paid in the silver currency. */
const unlimited = {
  id: 80639010,
  name: "mana prism",
  purchaseType: "item",
  cost: { itemId: 94164001, amount: 1 },
  limitNum: 0,
  setNum: 1,
  priority: 2,
  icon: null,
};

test("maxRequire follows the purchase limit, unlimited falls back to the schema max", () => {
  assert.equal(EventShop.maxRequire(limited), 3);
  assert.equal(EventShop.maxRequire(unlimited), Schema.shopRequire.max);
});

test("clampRequire clamps to the limit and floors fractions", () => {
  assert.equal(EventShop.clampRequire(limited, 14), 3);
  assert.equal(EventShop.clampRequire(limited, -5), 0);
  assert.equal(EventShop.clampRequire(limited, "abc"), 0);
  assert.equal(EventShop.clampRequire(limited, 2.7), 2);
  assert.equal(EventShop.clampRequire(unlimited, 999999), 999999);
  assert.equal(EventShop.clampRequire(unlimited, 1000000), Schema.shopRequire.max);
});

test("rowCost is require × per-purchase amount", () => {
  assert.equal(EventShop.rowCost(limited, 14), 140);
  assert.equal(EventShop.rowCost(limited, 0), 0);
});

test("totals sum per currency across items, zero rows included", () => {
  const totals = EventShop.totals([limited, unlimited], { 80639005: 14, 80639010: 0 });
  assert.equal(totals["94164002"], 140);
  assert.equal(totals["94164001"], 0);
});

test("totals covers every currency present in items when requires is empty", () => {
  const totals = EventShop.totals([limited, unlimited], {});
  assert.deepEqual(totals, { 94164002: 0, 94164001: 0 });
});

test("totals ignores require keys for items no longer in the shop", () => {
  const totals = EventShop.totals([limited], { 99999999: 5, 80639005: 1 });
  assert.equal(totals["94164002"], 10);
});

test("clearRequires buys out limited rows and leaves unlimited rows at 0", () => {
  const requires = EventShop.clearRequires([limited, unlimited]);
  assert.equal(requires["80639005"], 3);
  assert.equal(requires["80639010"], 0);
});

test("sanitizeRequires restores a matching event's plan keyed by item id", () => {
  const saved = { eventId: 80639, requires: { 80639005: 2 } };
  assert.deepEqual(EventShop.sanitizeRequires(saved, [limited, unlimited], 80639), { 80639005: 2 });
});

test("sanitizeRequires drops a plan saved under a different event", () => {
  const saved = { eventId: 12345, requires: { 80639005: 2 } };
  assert.deepEqual(EventShop.sanitizeRequires(saved, [limited], 80639), {});
});

test("sanitizeRequires drops unknown ids and clamps garbage values", () => {
  const saved = { eventId: 80639, requires: { 80639005: "abc", 80639010: -3, 70000001: 5 } };
  assert.deepEqual(EventShop.sanitizeRequires(saved, [limited, unlimited], 80639), {
    80639005: 0,
    80639010: 0,
  });
});

test("sanitizeRequires survives non-object blobs without crashing", () => {
  for (const junk of [null, undefined, "nope", 42, [], { requires: "nope" }, { eventId: 80639, requires: [] }]) {
    assert.deepEqual(EventShop.sanitizeRequires(junk, [limited], 80639), {});
  }
});

/* --- Amendment A: EventShop.currencyForTier + tier-need integration shape --- */

const currencies = [
  { id: 94164002, name: "YAKIまんじゅう", background: "gold", icon: null },
  { id: 94164001, name: "SHIMONITAネギ", background: "silver", icon: null },
  { id: 94164000, name: "MISOおでん", background: "bronze", icon: null },
];

test("currencyForTier maps each tier to the currency carrying that background", () => {
  assert.equal(EventShop.currencyForTier(currencies, "gold").id, 94164002);
  assert.equal(EventShop.currencyForTier(currencies, "silver").id, 94164001);
  assert.equal(EventShop.currencyForTier(currencies, "bronze").id, 94164000);
});

test("currencyForTier returns null for a tier no currency carries", () => {
  assert.equal(EventShop.currencyForTier([{ id: 1, background: "gold" }], "bronze"), null);
  assert.equal(EventShop.currencyForTier([], "gold"), null);
  assert.equal(EventShop.currencyForTier([{ id: 1 }], "gold"), null);
});

test("currencyForTier guards non-array currency lists without crashing", () => {
  for (const junk of [null, undefined, "gold", 42, {}, () => {}]) {
    assert.equal(EventShop.currencyForTier(junk, "gold"), null);
  }
});

test("currencyForTier takes the first currency when backgrounds duplicate", () => {
  const duplicated = [
    { id: 7, background: "gold" },
    { id: 8, background: "gold" },
  ];
  assert.equal(EventShop.currencyForTier(duplicated, "gold").id, 7);
});

test("event tier need = totals keyed through currencyForTier, missing tier reads 0", () => {
  const totals = EventShop.totals([limited, unlimited], { 80639005: 14, 80639010: 5 });
  const gold = EventShop.currencyForTier(currencies, "gold");
  const silver = EventShop.currencyForTier(currencies, "silver");
  const bronze = EventShop.currencyForTier(currencies, "bronze");
  assert.equal(totals[String(gold.id)], 140);
  assert.equal(totals[String(silver.id)], 5);
  assert.equal(totals[String(bronze.id)] || 0, 0);
});

test("event tier need with an empty plan is 0 for every mapped currency", () => {
  const totals = EventShop.totals([limited, unlimited], {});
  const gold = EventShop.currencyForTier(currencies, "gold");
  assert.equal(totals[String(gold.id)] || 0, 0);
});
