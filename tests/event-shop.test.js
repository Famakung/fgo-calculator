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

test("mergeRequires keeps only ids the shop sells and clamps what survives", () => {
  const merged = EventShop.mergeRequires({ 80639005: 1 }, { 80639005: 99, 80639010: 4, 70000001: 5 }, [
    limited,
    unlimited,
  ]);
  assert.deepEqual(merged, { 80639005: 3, 80639010: 4 });
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

/* --- Amendment D: EventShop.farmPlan, the best-quest farm model --- */

/* Live community figures for the ぐだぐだぷにぷにウォーズ！ quests (Atlas drops, 2026-11-12):
   MISO 94164100 at 10.7117 stacks/run × 3, SHIMONITA 94164101 at 11.2105 × 3, YAKI 94164102 at
   10.8315 × 3, every quest 40 AP. */
const farm = {
  94164000: {
    questId: 94164100,
    questName: "だるまを買いにいこう",
    recommendLv: "70",
    ap: 40,
    dropExpected: 10.7117,
    num: 3,
    sampleRuns: 111,
  },
  94164001: {
    questId: 94164101,
    questName: "こんにゃくとネギ",
    recommendLv: "70",
    ap: 40,
    dropExpected: 11.2105,
    num: 3,
    sampleRuns: 57,
  },
  94164002: null,
};

test("farmPlan prices one run as dropExpected × (num + bonus) — bonus joins the stack, not the total", () => {
  const plan = EventShop.farmPlan({ totals: { 94164000: 0 }, held: {}, bonus: { 94164000: 3 }, farm });
  const row = plan["94164000"];
  // The user-corrected example from the plan: 10.8315 × (3 + 3) = 64.9890, so here 10.7117 × 6.
  assert.equal(row.perRun, 10.7117 * 6);
  assert.ok(row.perRun > 10.7117 * 3 * 1.9, "a flat bonus would pay far less than doubling the stack");
});

test("farmPlan divides the deficit by perRun and rounds the runs up", () => {
  const plan = EventShop.farmPlan({ totals: { 94164001: 100 }, held: { 94164001: 5 }, bonus: {}, farm });
  const row = plan["94164001"];
  assert.equal(row.deficit, 95);
  assert.equal(row.perRun, 11.2105 * 3);
  assert.equal(row.runs, Math.ceil(95 / (11.2105 * 3)));
  assert.equal(row.ap, row.runs * 40);
});

test("farmPlan holds more than the plan needs, so nothing has to be farmed", () => {
  const plan = EventShop.farmPlan({ totals: { 94164000: 10 }, held: { 94164000: 40 }, bonus: {}, farm });
  assert.equal(plan["94164000"].deficit, 0);
  assert.equal(plan["94164000"].runs, 0);
  assert.equal(plan["94164000"].ap, 0);
});

test("farmPlan gives a currency with no drop data a null plan, never a divide by zero", () => {
  const plan = EventShop.farmPlan({ totals: { 94164002: 500 }, held: {}, bonus: { 94164002: 5 }, farm });
  assert.equal(plan["94164002"].deficit, 500);
  assert.equal(plan["94164002"].perRun, 0);
  assert.equal(plan["94164002"].runs, null);
  assert.equal(plan["94164002"].ap, null);
});

test("farmPlan covers every currency in totals and every key of farm", () => {
  const plan = EventShop.farmPlan({ totals: { 94164000: 1 }, held: {}, bonus: {}, farm: { 94164002: null } });
  assert.deepEqual(Object.keys(plan).sort(), ["94164000", "94164002"]);
});

/* --- Amendment I: EventShop.dropPerRun, the one multiply behind a card's drop lines --- */

test("dropPerRun pays dropExpected × (num + bonus), the figure the card prints", () => {
  assert.equal(EventShop.dropPerRun(farm["94164000"]), 10.7117 * 3, "no bonus is the plain stack");
  assert.equal(EventShop.dropPerRun(farm["94164000"], 3), 10.7117 * 6, "bonus joins the stack, not the total");
  assert.equal(
    EventShop.dropPerRun({ dropExpected: 1.8829, num: 3 }, 1),
    1.8829 * 4,
    "a secondary line pays with its own currency's bonus",
  );
});

test("dropPerRun reads the same figures farmPlan prices with, per currency", () => {
  const plan = EventShop.farmPlan({ totals: { 94164000: 0 }, held: {}, bonus: { 94164000: 2 }, farm });
  assert.equal(plan["94164000"].perRun, EventShop.dropPerRun(farm["94164000"], 2));
  const planWithBonus2 = EventShop.farmPlan({ totals: {}, held: {}, bonus: { 94164001: 2 }, farm });
  assert.equal(planWithBonus2["94164001"].perRun, EventShop.dropPerRun(farm["94164001"], 2));
});

test("dropPerRun is 0 without a drop line and clamps a junk or negative bonus", () => {
  assert.equal(EventShop.dropPerRun(null, 3), 0, "a card with no quest has nothing to print");
  assert.equal(EventShop.dropPerRun(farm["94164000"], -50), 10.7117 * 3, "a negative bonus reads as no bonus");
  assert.equal(EventShop.dropPerRun(farm["94164000"], "abc"), 10.7117 * 3, "an empty box reads as no bonus");
  assert.equal(EventShop.dropPerRun({ dropExpected: "junk", num: 3 }, 1), 0, "junk figures pay nothing");
});

test("farmPlan survives an absent snapshot, junk figures and a negative or oversized bonus", () => {
  const empty = EventShop.farmPlan({ totals: { 1: 10 }, held: {}, bonus: {}, farm: {} });
  assert.equal(empty["1"].runs, null);

  const junk = EventShop.farmPlan({ totals: { 94164000: "many" }, held: { 94164000: "some" }, bonus: {}, farm });
  assert.equal(junk["94164000"].deficit, 0);

  const negative = EventShop.farmPlan({ totals: { 94164000: 30 }, held: {}, bonus: { 94164000: -50 }, farm });
  assert.equal(negative["94164000"].perRun, 10.7117 * 3);

  const oversized = EventShop.farmPlan({ totals: { 94164000: 30 }, held: {}, bonus: { 94164000: 1e9 }, farm });
  assert.equal(oversized["94164000"].perRun, 10.7117 * (3 + Schema.tier.Bonus.max));

  assert.deepEqual(EventShop.farmPlan(), {});
});

/* --- Amendment G: multi-event snapshots, per-event plans, storage migration --- */

const goldItem = { id: 101, cost: { itemId: 94164002, amount: 10 }, limitNum: 2, setNum: 1, priority: 1 };
const silverItem = { id: 201, cost: { itemId: 94164001, amount: 5 }, limitNum: 0, setNum: 1, priority: 1 };
const EVENT_A = { event: { id: 80639, name: "A", shortName: "A" }, currencies, items: [goldItem, silverItem], farm };
const EVENT_B = {
  event: { id: 80630, name: "B", shortName: "B" },
  currencies: [{ id: 94162101, name: "Ticket", background: "gold" }],
  items: [{ id: 101, cost: { itemId: 94162101, amount: 1 }, limitNum: 5, setNum: 1, priority: 1 }],
  farm: { 94162101: null },
};
const EVENTS = [EVENT_A, EVENT_B];

test("sanitizePlans keeps one plan per event and starts unseen events empty", () => {
  const saved = {
    selectedEventId: 80639,
    plans: { 80639: { requires: { 101: 2 }, held: { gold: 7 }, bonus: { gold: 1 } } },
  };
  const state = EventShop.sanitizePlans(saved, EVENTS);
  assert.equal(state.selectedEventId, 80639);
  assert.deepEqual(state.plans["80639"], {
    requires: { 101: 2 },
    held: { 94164000: 0, 94164001: 0, 94164002: 7 },
    bonus: { 94164000: 0, 94164001: 0, 94164002: 1 },
  });
  assert.deepEqual(state.plans["80630"], {
    requires: {},
    held: { 94162101: 0 },
    bonus: { 94162101: 0 },
  });
});

test("sanitizePlans isolates events: an id one shop sells is dead data for the other", () => {
  const saved = { selectedEventId: 80630, plans: { 80630: { requires: { 101: 5 } }, 80639: { requires: { 101: 2 } } } };
  const state = EventShop.sanitizePlans(saved, EVENTS);
  assert.deepEqual(state.plans["80630"].requires, { 101: 5 });
  assert.deepEqual(state.plans["80639"].requires, { 101: 2 });
});

test("sanitizePlans migrates the pre-G { eventId, requires } blob", () => {
  const state = EventShop.sanitizePlans({ eventId: 80639, requires: { 101: 1 } }, EVENTS);
  assert.equal(state.selectedEventId, 80639, "the saved event becomes the selection");
  assert.deepEqual(state.plans["80639"].requires, { 101: 1 });
  assert.deepEqual(state.plans["80639"].held, { 94164000: 0, 94164001: 0, 94164002: 0 }, "held defaults to 0");
});

test("sanitizePlans drops plans for events the data no longer lists", () => {
  const saved = { selectedEventId: 70000, plans: { 70000: { requires: { 101: 3 } } } };
  const state = EventShop.sanitizePlans(saved, EVENTS);
  assert.equal(Object.keys(state.plans).includes("70000"), false);
  assert.equal(state.selectedEventId, 80639, "an unknown selection falls back to the first event");
});

test("sanitizePlans clamps requires per that event's items and held/bonus to the tier schema", () => {
  const saved = {
    selectedEventId: 80639,
    plans: {
      80639: {
        requires: { 101: 999, "": 4 },
        held: { gold: -3, silver: 1e9, bronze: "x", nothere: 5 },
        bonus: { gold: 2.7 },
      },
    },
  };
  const state = EventShop.sanitizePlans(saved, EVENTS);
  const plan = state.plans["80639"];
  assert.deepEqual(plan.requires, { 101: 2 }, "goldItem buys out at limitNum 2");
  assert.equal(plan.held["94164002"], 0, "legacy tier key migrates onto the currency and clamps");
  assert.equal(plan.held["94164001"], Schema.tier.Have.max);
  assert.equal(plan.held["94164000"], 0);
  assert.deepEqual(Object.keys(plan.held).sort(), ["94164000", "94164001", "94164002"], "nothere dropped");
  assert.equal(plan.bonus["94164002"], 2, "fractions floor");
});

test("sanitizePlans survives junk blobs and an absent event list", () => {
  for (const junk of [null, undefined, "nope", 42, [], "80639"]) {
    const state = EventShop.sanitizePlans(junk, EVENTS);
    assert.equal(state.selectedEventId, 80639);
    assert.deepEqual(Object.keys(state.plans).sort(), ["80630", "80639"]);
  }
  const noEvents = EventShop.sanitizePlans({ selectedEventId: 80639, plans: {} }, []);
  assert.equal(noEvents.selectedEventId, null);
  assert.deepEqual(noEvents.plans, {});
  assert.deepEqual(EventShop.sanitizePlans({ selectedEventId: 5, plans: 7 }, [EVENT_B]), {
    selectedEventId: 80630,
    plans: {
      80630: { requires: {}, held: { 94162101: 0 }, bonus: { 94162101: 0 } },
    },
  });
});

/* --- Amendment G at the app layer: EventPlanner state, persistence and event switching --- */

function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    dump: () => Object.fromEntries(data),
  };
}

async function plannerWith(storage, events = EVENTS) {
  globalThis.localStorage = storage;
  const { EventPlanner } = await import("../src/scripts/event-planner.js");
  EventPlanner._initialized = false;
  const raw = storage.getItem("fgo_event_shop_data");
  EventPlanner.load(raw ? JSON.parse(raw) : null, { events });
  return EventPlanner;
}

test("EventPlanner migrates an old single-event blob into that event's plan", async () => {
  const storage = fakeStorage({ fgo_event_shop_data: JSON.stringify({ eventId: 80639, requires: { 101: 1 } }) });
  const planner = await plannerWith(storage);
  assert.equal(planner.state.selectedEventId, 80639);
  assert.deepEqual(planner.activePlan().requires, { 101: 1 });
  assert.deepEqual(planner.activePlan().held, { 94164000: 0, 94164001: 0, 94164002: 0 });
  assert.equal(planner.activeEvent().event.id, 80639);
});

test("EventPlanner falls back to the first event when the saved one is gone", async () => {
  const storage = fakeStorage({
    fgo_event_shop_data: JSON.stringify({ selectedEventId: 70000, plans: { 70000: { requires: { 101: 4 } } } }),
  });
  const planner = await plannerWith(storage);
  assert.equal(planner.state.selectedEventId, 80639, "the newest listed event becomes the selection");
  assert.deepEqual(planner.activePlan().requires, {}, "the dead event's plan is not carried over");
});

test("EventPlanner isolates plans: committing to the selected event never touches another", async () => {
  const storage = fakeStorage({
    fgo_event_shop_data: JSON.stringify({
      selectedEventId: 80639,
      plans: {
        80639: { requires: { 101: 2 }, held: { gold: 4 }, bonus: { gold: 1 } },
        80630: { requires: { 101: 5 } },
      },
    }),
  });
  const planner = await plannerWith(storage);
  planner.applyRequires({ 101: 1 });
  assert.deepEqual(planner.activePlan().requires, { 101: 1 });
  assert.deepEqual(planner.state.plans["80630"].requires, { 101: 5 }, "event B kept its own buy-out");

  planner.select(80630);
  assert.equal(planner.activeEvent().event.id, 80630);
  planner.applyRequires({ 101: 3 });
  planner.setHeld(94162101, 9);
  planner.setBonus(94162101, 2);
  assert.deepEqual(planner.activePlan().requires, { 101: 3 });
  assert.equal(planner.heldOf(94162101), 9);
  assert.equal(planner.bonusOf(94162101), 2);
  assert.deepEqual(
    planner.state.plans["80639"],
    {
      requires: { 101: 1 },
      held: { 94164000: 0, 94164001: 0, 94164002: 4 },
      bonus: { 94164000: 0, 94164001: 0, 94164002: 1 },
    },
    "event A is exactly what it was before the switch",
  );
});

test("EventPlanner.select refuses an event the data does not list and persists every move", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage);
  assert.equal(planner.select(999999), false);
  assert.equal(planner.state.selectedEventId, 80639);
  assert.equal(planner.select(80630), true);
  const saved = JSON.parse(storage.dump()["fgo_event_shop_data"]);
  assert.equal(saved.selectedEventId, 80630);
  assert.deepEqual(Object.keys(saved.plans).sort(), ["80630", "80639"]);
});

test("EventPlanner clamps the currency boxes through the tier schema, not by trust", async () => {
  const planner = await plannerWith(fakeStorage());
  planner.setHeld(94164002, "1e9");
  planner.setBonus(94164002, -7);
  assert.equal(planner.heldOf(94164002), Schema.tier.Have.max);
  assert.equal(planner.bonusOf(94164002), 0);
  planner.setHeld("nothere", 5);
  assert.equal(Object.keys(planner.activePlan().held).includes("nothere"), false);
  planner.setHeld("toString", 5);
  planner.setBonus("constructor", 5);
  assert.deepEqual(
    Object.keys(planner.activePlan().held).sort(),
    ["94164000", "94164001", "94164002"],
    "a prototype-chain key is not a currency the plan carries",
  );
});

test("EventPlanner reads the selected event for the modal: items and currencies only from it", async () => {
  const planner = await plannerWith(fakeStorage());
  assert.deepEqual(
    planner.itemsFor(94164002).map((it) => it.id),
    [101],
  );
  planner.select(80630);
  assert.deepEqual(
    planner.itemsFor(94164002).map((it) => it.id),
    [],
    "the other event does not sell that currency",
  );
  assert.deepEqual(
    planner.currenciesForActive().map((c) => c.id),
    [94162101],
  );
});

test("EventPlanner survives a snapshot list with no events", async () => {
  const planner = await plannerWith(fakeStorage(), []);
  assert.equal(planner.activeEvent(), null);
  assert.equal(planner.state.selectedEventId, null);
  planner.applyRequires({ 101: 3 });
  planner.setHeld(94164002, 3);
  assert.deepEqual(planner.activePlan().requires, {}, "no plan to write into, and nothing throws");
  assert.deepEqual(planner.activePlan().held, {}, "no currencies, so nothing was written");
});

/* --- Amendment J5: a pruned event's saved plan stays in storage --- */

test("EventPlanner writes a pruned event's saved plan back verbatim on the first mutation", async () => {
  const saved = {
    selectedEventId: 80639,
    plans: { 80639: { requires: { 101: 1 } }, 80630: { requires: { 101: 5 }, held: { 94162101: 2 } } },
  };
  const storage = fakeStorage({ fgo_event_shop_data: JSON.stringify(saved) });
  const planner = await plannerWith(storage, [EVENT_A]);
  assert.equal(planner.state.plans["80630"], undefined, "the pruned event has no live plan");
  planner.setHeld(94164002, 3);
  const stored = JSON.parse(storage.dump()["fgo_event_shop_data"]);
  assert.deepEqual(stored.plans["80630"], saved.plans["80630"], "one mutation must not erode the pruned plan");
});

test("an event that re-enters the data takes its plan back from storage", async () => {
  const storage = fakeStorage({
    fgo_event_shop_data: JSON.stringify({
      selectedEventId: 80639,
      plans: { 80630: { requires: { 101: 5 }, held: { 94162101: 2 } } },
    }),
  });
  const pruned = await plannerWith(storage, [EVENT_A]);
  pruned.setHeld(94164002, 3);
  assert.deepEqual(Object.keys(JSON.parse(storage.dump()["fgo_event_shop_data"]).plans).sort(), ["80630", "80639"]);

  const planner = await plannerWith(storage, EVENTS);
  assert.deepEqual(planner.state.plans["80630"].requires, { 101: 5 }, "the returning event reads its own saved plan");
  assert.deepEqual(planner.state.plans["80630"].held, { 94162101: 2 });
  assert.deepEqual(planner._retired, {}, "a live event is not retired, so the stash rebuilds without it");
});

test("a live plan wins the key collision against the retired stash", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage);
  planner._retired = { 80639: { requires: { 999: 7 }, held: { junk: 9 } } };
  planner.setHeld(94164002, 1);
  const stored = JSON.parse(storage.dump()["fgo_event_shop_data"]);
  assert.equal(stored.plans["80639"].held["94164002"], 1, "the sanitized live plan is what ships");
  assert.deepEqual(Object.keys(stored.plans["80639"].requires), [], "a retired entry under a live key is overwritten");
  assert.deepEqual(Object.keys(stored.plans["80639"].held).sort(), ["94164000", "94164001", "94164002"]);
});

test("hostile keys in a retired plan are kept as bytes and stay inert", async () => {
  const hostile =
    '{"selectedEventId":80639,"plans":{"70000":{"requires":{"101":2}},"__proto__":{"polluted":"yes"},"constructor":{"hack":1}}}';
  const storage = fakeStorage({ fgo_event_shop_data: hostile });
  const planner = await plannerWith(storage, [EVENT_A]);
  assert.equal(
    Object.getPrototypeOf(planner._retired),
    Object.prototype,
    "a retired key cannot swap the stash prototype",
  );
  assert.equal(Object.hasOwn(planner._retired, "__proto__"), true, "the hostile entry survives as an own data key");
  assert.equal({}.polluted, undefined, "Object.prototype is clean");

  planner.setHeld(94164002, 2);
  const storedText = storage.dump()["fgo_event_shop_data"];
  assert.ok(storedText.includes('"__proto__"'), "the save writes the retired bytes back");
  assert.equal(Object.getPrototypeOf(JSON.parse(storedText)), Object.prototype);
  assert.equal({}.polluted, undefined, "pollution never reaches Object.prototype through the stash");
});

/* --- Amendment H: N-currency collision — held/bonus keyed by currency id --- */

/* Event 80379's shape: two gold currencies plus a QP row, listed id-ascending as the snapshot does.
   currencyForTier first-maps gold to 94164002, so 94164003 has no tier card — its farm card owns the
   Held/Bonus input pair and its Required display is the modal entry point. */
const collCurrencies = [
  { id: 94164000, name: "MISOおでん", background: "bronze", icon: null },
  { id: 94164001, name: "SHIMONITAネギ", background: "silver", icon: null },
  { id: 94164002, name: "YAKIまんじゅう", background: "gold", icon: null },
  { id: 94164003, name: "大判小判", background: "gold", icon: null },
  { id: 94164004, name: "QP", background: "zero", icon: null },
];
const collGoldA = { id: 401, cost: { itemId: 94164002, amount: 10 }, limitNum: 2, setNum: 1, priority: 1 };
const collGoldB = { id: 402, cost: { itemId: 94164003, amount: 5 }, limitNum: 40, setNum: 1, priority: 1 };
const collQp = { id: 403, cost: { itemId: 94164004, amount: 100 }, limitNum: 0, setNum: 1, priority: 1 };
const COLLISION = {
  event: { id: 80379, name: "C", shortName: "C" },
  currencies: collCurrencies,
  items: [collGoldA, collGoldB, collQp],
  farm: {
    94164002: { questId: 1, questName: "A", recommendLv: "70", ap: 40, dropExpected: 10, num: 3, sampleRuns: 9 },
    94164003: { questId: 2, questName: "B", recommendLv: "70", ap: 40, dropExpected: 2, num: 5, sampleRuns: 9 },
    94164004: null,
  },
};

test("sanitizePlans migrates the tier key onto the first-mapped currency and keeps id-keyed figures apart", () => {
  const saved = {
    selectedEventId: 80379,
    plans: { 80379: { held: { gold: 7, 94164003: 9 }, bonus: { 94164003: 4 } } },
  };
  const plan = EventShop.sanitizePlans(saved, [COLLISION]).plans["80379"];
  assert.deepEqual(plan.held, { 94164000: 0, 94164001: 0, 94164002: 7, 94164003: 9, 94164004: 0 });
  assert.deepEqual(plan.bonus, { 94164000: 0, 94164001: 0, 94164002: 0, 94164003: 4, 94164004: 0 });
});

test("sanitizePlans drops keys that are neither an event currency nor a tier it maps", () => {
  const saved = { plans: { 80379: { held: { nothere: 5, zero: 2, "": 3 } } } };
  const plan = EventShop.sanitizePlans(saved, [COLLISION]).plans["80379"];
  assert.deepEqual(Object.keys(plan.held).sort(), ["94164000", "94164001", "94164002", "94164003", "94164004"]);
  assert.equal(plan.held["94164004"], 0, '"zero" is not a tier, so no figure migrates to the QP currency');
});

test("sanitizePlans on a single-currency event migrates the tier figure onto its one currency", () => {
  const saved = { selectedEventId: 80630, plans: { 80630: { held: { gold: 4 }, bonus: { gold: 2 } } } };
  const plan = EventShop.sanitizePlans(saved, [EVENT_B]).plans["80630"];
  assert.deepEqual(plan.held, { 94162101: 4 });
  assert.deepEqual(plan.bonus, { 94162101: 2 });
});

test("farmPlan prices each colliding gold with its own held and bonus", () => {
  const totals = EventShop.totals(COLLISION.items, { 401: 2, 402: 20, 403: 1 });
  const plan = EventShop.farmPlan({
    totals,
    held: { 94164002: 15, 94164003: 0 },
    bonus: { 94164003: 2 },
    farm: COLLISION.farm,
  });
  assert.equal(plan["94164002"].deficit, 5, "gold A: 20 spend minus 15 held");
  assert.equal(plan["94164003"].deficit, 100, "gold B carries its own deficit, not gold A's");
  assert.equal(plan["94164003"].perRun, 2 * (5 + 2), "bonus joins the second gold's own stack");
  assert.equal(plan["94164003"].runs, Math.ceil(100 / 14));
  assert.equal(plan["94164003"].ap, Math.ceil(100 / 14) * 40);
});

test("EventPlanner keeps the two golds apart and persists the blob by currency id", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage, [COLLISION]);
  planner.setHeld(94164003, 9);
  planner.setBonus(94164003, 4);
  assert.equal(planner.heldOf(94164003), 9);
  assert.equal(planner.bonusOf(94164003), 4);
  assert.equal(planner.heldOf(94164002), 0, "the tier-mapped gold has its own untouched figure");
  planner.setHeld("gold", 5);
  assert.equal(Object.keys(planner.activePlan().held).includes("gold"), false, "tier keys are no longer writable ids");
  const saved = JSON.parse(storage.dump()["fgo_event_shop_data"]);
  assert.equal(saved.plans["80379"].held["94164003"], 9, "storage carries currency-id keys");
});

test("the second gold is modal-reachable: the planner feeds its items and currency to the modal wiring", async () => {
  const planner = await plannerWith(fakeStorage(), [COLLISION]);
  assert.deepEqual(
    planner.itemsFor(94164003).map((it) => it.id),
    [402],
  );
  assert.deepEqual(
    planner.itemsFor(94164004).map((it) => it.id),
    [403],
  );
  assert.equal(
    planner.currenciesForActive().some((c) => String(c.id) === "94164003"),
    true,
  );
});

test("tierMappedIds owns exactly the first currency per tier background", async () => {
  const { tierMappedIds } = await import("../src/scripts/event-shop-farm-controls.js");
  assert.deepEqual([...tierMappedIds(collCurrencies)].sort(), ["94164000", "94164001", "94164002"]);
  assert.deepEqual([...tierMappedIds(EVENT_B.currencies)], ["94162101"], "single currency maps as before");
});
