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

test("the shipped farm map covers exactly the shop currencies of every event", () => {
  for (const snapshot of EVENT_SHOP_DATA.events || []) {
    assert.deepEqual(
      Object.keys(snapshot.farm || {}).sort(),
      snapshot.currencies.map((c) => String(c.id)).sort(),
      `event ${snapshot.event.id}: farm keys must equal the currency ids`,
    );
    for (const entry of Object.values(snapshot.farm || {})) {
      if (entry === null) continue;
      assert.ok(Number.isInteger(entry.questId) && entry.questId > 0);
      assert.ok(entry.dropExpected > 0, "a reported quest must drop something");
      assert.ok(Number.isInteger(entry.num) && entry.num > 0);
      assert.ok(Number.isInteger(entry.ap) && entry.ap >= 0);
      assert.equal(typeof entry.recommendLv === "string" || typeof entry.recommendLv === "number", true);
    }
  }
});

test("farmPlan over a shipped snapshot stays finite and never under-coverage the deficit", () => {
  for (const snapshot of EVENT_SHOP_DATA.events || []) {
    const totals = EventShop.totals(snapshot.items, EventShop.clearRequires(snapshot.items));
    const plan = EventShop.farmPlan({ totals, held: {}, bonus: {}, farm: snapshot.farm || {} });
    for (const [currencyId, row] of Object.entries(plan)) {
      assert.equal(row.deficit, Math.max(0, totals[currencyId] || 0));
      if (row.runs === null) continue;
      assert.ok(row.runs * (row.perRun || 1) >= row.deficit, `${currencyId}: the runs must cover the deficit`);
    }
  }
});
