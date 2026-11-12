import { test } from "node:test";
import assert from "node:assert/strict";
import { EventShop, Schema } from "../src/scripts/domain.js";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";

/* Adversarial companion to tests/event-shop.test.js: hostile Require values and hostile storage blobs
   beyond the builder's own cases. The planner reads localStorage without a schema, so anything a
   tampered or half-written save can hold has to arrive as an integer inside [0, maxRequire]. */

const limited = { id: 80639005, cost: { itemId: 94164002, amount: 10 }, limitNum: 3, setNum: 10 };
const unlimited = { id: 80639010, cost: { itemId: 94164001, amount: 1 }, limitNum: 0, setNum: 1 };
const ITEMS = [limited, unlimited];
const MAX = Schema.shopRequire.max;

/** Every value a tampered save or a keyboard can produce must come back as a safe integer in range. */
const hostileValues = [
  -0,
  -0.5,
  -1e300,
  0.7,
  2.9999,
  3.0000001,
  Infinity,
  -Infinity,
  NaN,
  "1e3",
  "1e999",
  "  12abc",
  "3.7",
  "-5",
  "1e21",
  "9".repeat(40),
  true,
  false,
  null,
  undefined,
  {},
  [],
  [7],
  () => 3,
];

test("clampRequire returns a safe integer inside [0, maxRequire] for every hostile value", () => {
  for (const item of [limited, unlimited]) {
    for (const value of hostileValues) {
      const out = EventShop.clampRequire(item, value);
      assert.equal(typeof out, "number", `value ${String(value)} did not produce a number`);
      assert.ok(Number.isSafeInteger(out), `value ${String(value)} produced ${out}`);
      assert.ok(out >= 0 && out <= EventShop.maxRequire(item), `value ${String(value)} produced ${out}`);
    }
  }
});

test("clampRequire clamps to the purchase limit, floors fractions and never leaks -0", () => {
  assert.equal(EventShop.clampRequire(limited, -0.5), 0);
  assert.equal(EventShop.clampRequire(limited, 2.9999), 2);
  assert.equal(EventShop.clampRequire(limited, "3.7"), 3);
  assert.equal(EventShop.clampRequire(limited, Infinity), 3);
  assert.equal(EventShop.clampRequire(limited, "1e999"), 3);
  assert.equal(EventShop.clampRequire(limited, "-5"), 0);
  assert.equal(EventShop.clampRequire(limited, "9".repeat(40)), 3);
  assert.equal(EventShop.clampRequire(unlimited, "1e3"), 1000);
  assert.ok(Object.is(EventShop.clampRequire(limited, -0), 0), "-0 reached the caller");
  assert.ok(Object.is(EventShop.clampRequire(limited, "-0"), 0), "string -0 reached the caller");
});

test("maxRequire and clampRequire stay numeric when limitNum arrives as a string", () => {
  const loose = { id: 1, cost: { itemId: 9, amount: 1 }, limitNum: "3" };
  assert.equal(EventShop.clampRequire(loose, 5), 3);
  assert.equal(EventShop.clampRequire(loose, -5), 0);
});

test("a negative or absent limitNum is treated as unlimited, not as a ceiling below zero", () => {
  for (const limitNum of [-1, 0, undefined, null]) {
    assert.equal(EventShop.maxRequire({ limitNum }), MAX, `limitNum ${String(limitNum)}`);
    assert.equal(EventShop.clampRequire({ cost: { itemId: 1, amount: 1 }, limitNum }, 500), 500);
  }
});

test("rowCost stays an exact safe integer at the widest plan", () => {
  const cost = EventShop.rowCost({ cost: { itemId: 1, amount: 300 } }, MAX);
  assert.equal(cost, 999999 * 300);
  assert.ok(Number.isSafeInteger(cost));
});

test("sanitizeRequires drops prototype-pollution keys and leaves Object.prototype clean", () => {
  const blob = JSON.parse(
    `{"eventId":80639,"requires":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":1}},` +
      `"toString":"hack","hasOwnProperty":9,"valueOf":1,"${limited.id}":2,"${unlimited.id}":4}}`,
  );
  const out = EventShop.sanitizeRequires(blob, ITEMS, 80639);
  assert.deepEqual(out, { [limited.id]: 2, [unlimited.id]: 4 });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.x, undefined);
  assert.equal(typeof Object.prototype.polluted, "undefined");
  assert.equal(Object.hasOwn(out, "__proto__"), false);
});

test("sanitizeRequires coerces every surviving value into an in-range integer", () => {
  const blob = {
    eventId: 80639,
    requires: {
      [limited.id]: "1e3",
      [unlimited.id]: -Infinity,
    },
  };
  assert.deepEqual(EventShop.sanitizeRequires(blob, ITEMS, 80639), { [limited.id]: 3, [unlimited.id]: 0 });

  const fractions = { eventId: 80639, requires: { [limited.id]: 2.7, [unlimited.id]: "999999.9" } };
  assert.deepEqual(EventShop.sanitizeRequires(fractions, ITEMS, 80639), { [limited.id]: 2, [unlimited.id]: MAX });
});

test("sanitizeRequires compares the event id strictly, so a string id cannot resurrect a dead plan", () => {
  const blob = { eventId: "80639", requires: { [limited.id]: 2 } };
  assert.deepEqual(EventShop.sanitizeRequires(blob, ITEMS, 80639), {});
  assert.deepEqual(EventShop.sanitizeRequires({ eventId: null, requires: { [limited.id]: 2 } }, ITEMS, null), {
    [limited.id]: 2,
  });
});

test("sanitizeRequires survives a non-array iterable, nested garbage and an empty item list", () => {
  const cases = [
    { eventId: 80639, requires: { [limited.id]: { requires: 5 } } },
    { eventId: 80639, requires: { [limited.id]: [1, 2, 3] } },
    { eventId: 80639, requires: Object.assign(Object.create({ [limited.id]: 9 }), {}) },
    { eventId: 80639, requires: { __proto__: null } },
  ];
  for (const saved of cases) {
    const out = EventShop.sanitizeRequires(saved, ITEMS, 80639);
    assert.equal(typeof out, "object");
    for (const [key, value] of Object.entries(out)) {
      const item = ITEMS.find((it) => String(it.id) === key);
      assert.ok(item, `unknown key ${key} survived`);
      assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= EventShop.maxRequire(item), `${key}=${value}`);
    }
  }
  assert.deepEqual(EventShop.sanitizeRequires({ eventId: 80639, requires: { [limited.id]: 2 } }, [], 80639), {});
});

test("totals ignores polluted and unknown require keys and reports exactly the currencies in play", () => {
  const requires = JSON.parse(`{"__proto__":9,"${limited.id}":3,"99999999":99,"${unlimited.id}":2}`);
  const totals = EventShop.totals(ITEMS, requires);
  assert.deepEqual(totals, { 94164002: 30, 94164001: 2 });
  assert.equal(Object.getPrototypeOf(totals), Object.prototype);
});

test("the shipped snapshot keeps the planner's own arithmetic honest", () => {
  for (const snapshot of EVENT_SHOP_DATA.events || []) {
    const items = snapshot.items;
    const currencies = snapshot.currencies;
    const buyAll = EventShop.clearRequires(items);
    const totals = EventShop.totals(items, buyAll);

    assert.deepEqual(
      Object.keys(totals).sort(),
      currencies.map((c) => String(c.id)).sort(),
      `event ${snapshot.event.id}: totals must cover exactly the declared currencies`,
    );
    for (const currency of currencies) {
      const exact = items
        .filter((item) => String(item.cost.itemId) === String(currency.id))
        .reduce((sum, item) => sum + (item.limitNum > 0 ? item.limitNum * item.cost.amount : 0), 0);
      assert.equal(totals[String(currency.id)], exact, `${currency.name} buy-all total`);
      assert.ok(Number.isSafeInteger(exact));
    }
    for (const item of items) {
      assert.ok(
        currencies.some((c) => String(c.id) === String(item.cost.itemId)),
        `item ${item.id} costs an undeclared currency ${item.cost.itemId}`,
      );
      assert.equal(buyAll[String(item.id)], item.limitNum > 0 ? item.limitNum : 0);
    }
  }
});

/* The shipped data is the planner's real input: farm quests, best and trades must hold the
   Amendment L shape, and the optimizer run over it must stay finite, whole and never leave a
   buy-all deficit uncovered. */
test("the shipped farm data carries quests, best and trades for every event", () => {
  for (const snapshot of EVENT_SHOP_DATA.events || []) {
    const currencyIds = snapshot.currencies.map((c) => String(c.id));
    const farm = snapshot.farm || {};
    assert.ok(Array.isArray(farm.quests), `event ${snapshot.event.id}: farm.quests must be an array`);
    const questIds = new Set();
    for (const quest of farm.quests) {
      assert.ok(
        Number.isInteger(quest.questId) && quest.questId > 0 && !questIds.has(quest.questId),
        `quest id ${quest.questId}`,
      );
      questIds.add(quest.questId);
      assert.ok(Number.isInteger(quest.ap) && quest.ap >= 0);
      assert.ok(typeof quest.recommendLv === "string" || typeof quest.recommendLv === "number", true);
      const keys = Object.keys(quest.drops || {});
      assert.ok(keys.length >= 1, `quest ${quest.questId}: a farm quest must drop a shop currency`);
      for (const key of keys) {
        assert.ok(currencyIds.includes(key), `quest ${quest.questId}: drops an undeclared currency ${key}`);
        assert.ok(quest.drops[key].dropExpected > 0, "a reported drop must pay");
        assert.ok(Number.isInteger(quest.drops[key].num) && quest.drops[key].num > 0);
      }
    }
    for (const [key, questId] of Object.entries(farm.best || {})) {
      assert.ok(currencyIds.includes(key), `best key ${key} is not a shop currency`);
      assert.ok(questIds.has(questId), `best ${key} → quest ${questId} is not in farm.quests`);
    }
    for (const trade of snapshot.trades || []) {
      assert.ok(
        currencyIds.includes(String(trade.fromId)) && currencyIds.includes(String(trade.toId)),
        `trade ${JSON.stringify(trade)} leaves the shop`,
      );
      assert.notEqual(trade.fromId, trade.toId);
      assert.ok(Number.isInteger(trade.costAmount) && trade.costAmount > 0, "the cascade ratio is strictly positive");
      assert.ok(Number.isInteger(trade.getNum) && trade.getNum > 0);
    }
  }
});

test("farmPlan over a shipped snapshot stays finite and never under-coverage the deficit", () => {
  for (const snapshot of EVENT_SHOP_DATA.events || []) {
    const totals = EventShop.totals(snapshot.items, EventShop.clearRequires(snapshot.items));
    const plan = EventShop.farmPlan({
      totals,
      held: {},
      bonus: {},
      farm: snapshot.farm || { quests: [], best: {} },
      trades: snapshot.trades || [],
      priorityQuestId: EventShop.defaultFarmQuest(
        snapshot.farm || {},
        snapshot.currencies.map((c) => c.id),
      ),
    });
    if (plan.totalPlays === null) continue;
    assert.ok(Number.isInteger(plan.totalPlays) && plan.totalPlays >= 0);
    let sum = 0;
    for (const play of plan.plays) {
      assert.ok(Number.isInteger(play.runs) && play.runs >= 1, `quest ${play.questId} plays a whole number of runs`);
      sum += play.runs;
    }
    assert.equal(sum, plan.totalPlays, "totalPlays is the plays column summed");
    for (const [currencyId, required] of Object.entries(totals)) {
      assert.ok(
        (plan.yields[currencyId] || 0) >= required - 1e-6,
        `${currencyId}: the plan must cover the buy-all spend`,
      );
    }
    for (const trade of plan.trades)
      assert.ok(Number.isInteger(trade.count) && trade.count > 0, "executed trades are whole and used");
  }
});

/* farmChain indexes trades on a plain object keyed by fromId: a hostile id like "__proto__" made
   `chain[fromKey] || []` read through Object.prototype and the entry push throw. tradeKey now drops
   every non-numeric id as a null key, so tradeChain skips it and valid trades keep cascading. */
test("farmPlan drops trades with hostile ids instead of throwing through Object.prototype", () => {
  const farm = {
    quests: [{ questId: 7, ap: 0, drops: { 5: { dropExpected: 1, num: 5 } } }],
    best: { 5: 7 },
  };
  const hostileTrades = [
    { fromId: "__proto__", toId: 6, costAmount: 10, getNum: 1 },
    { fromId: "constructor", toId: 6, costAmount: 10, getNum: 1 },
    { fromId: "12abc", toId: 6, costAmount: 10, getNum: 1 },
    { fromId: 5, toId: "toString", costAmount: 10, getNum: 1 },
  ];

  const hostileOnly = EventShop.farmPlan({ totals: { 5: 9, 6: 1 }, held: {}, bonus: {}, farm, trades: hostileTrades });
  assert.equal(hostileOnly.totalPlays, null, "no hostile trade can cover currency 6");

  const mixed = EventShop.farmPlan({
    totals: { 5: 9, 6: 1 },
    held: {},
    bonus: {},
    farm,
    trades: [{ fromId: 5, toId: 6, costAmount: 1, getNum: 1 }, ...hostileTrades],
  });
  assert.equal(mixed.totalPlays, 2, "the valid trade still prices the plan");
  assert.deepEqual(mixed.trades, [{ fromId: 5, toId: 6, count: 1 }], "hostile trades never join the chain");
});
