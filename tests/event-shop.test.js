import { test } from "node:test";
import assert from "node:assert/strict";
import { Calculator, EventShop, Schema, cascadeYields, spendSurplusUpChain } from "../src/scripts/domain.js";
import { EVENT_SHOP_DATA } from "../src/scripts/data/event_shop.js";

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

/* --- Amendment L: EventShop.dropPerRun, the one multiply behind a card's drop line --- */

test("dropPerRun pays dropExpected × (num + bonus), the figure the card prints", () => {
  assert.equal(EventShop.dropPerRun({ dropExpected: 10.7117, num: 3 }), 10.7117 * 3, "no bonus is the plain stack");
  assert.equal(
    EventShop.dropPerRun({ dropExpected: 10.7117, num: 3 }, 3),
    10.7117 * 6,
    "bonus joins the stack, not the total",
  );
  assert.equal(
    EventShop.dropPerRun({ dropExpected: 1.8829, num: 3 }, 1),
    1.8829 * 4,
    "each line pays with its own currency's bonus",
  );
});

test("dropPerRun is 0 without a drop line and clamps a junk or negative bonus", () => {
  assert.equal(EventShop.dropPerRun(null, 3), 0, "a card with no quest has nothing to print");
  assert.equal(
    EventShop.dropPerRun({ dropExpected: 10.7117, num: 3 }, -50),
    10.7117 * 3,
    "a negative bonus reads as no bonus",
  );
  assert.equal(
    EventShop.dropPerRun({ dropExpected: 10.7117, num: 3 }, "abc"),
    10.7117 * 3,
    "an empty box reads as no bonus",
  );
  assert.equal(EventShop.dropPerRun({ dropExpected: "junk", num: 3 }, 1), 0, "junk figures pay nothing");
});

/* --- Amendment L5: the trade-aware minimum-play optimizer, pinned by the lead's fixtures.

   80627 (くたばれ！パンプキンファーム・スローター) community figures as the sync emits them
   (dropExpected 4dp, best line per quest and currency). Currencies: 94160901 けもみみクッキー
   (bronze "cookie"), 94160902 首輪ドーナッツ (silver "donut"), 94160903 三日月パイ (gold "pie").
   Quests: 誓い 94161108 (90++ drops everything ~33.4/run), 牛追い 94161105 (best pie), ここ掘れ
   94161103 (best cookie), 妙案奇案 94161104 (best donut), plus the dominated mid-quests.
   Trades: 10 cookie → 1 donut, 10 donut → 1 pie. --- */

const B_QUESTS = [
  {
    questId: 94161100,
    questName: "パンプキン収穫 目で愛でファーム",
    recommendLv: "70",
    ap: 40,
    sampleRuns: 435,
    drops: { 94160901: { dropExpected: 10.9149, num: 3 }, 94160902: { dropExpected: 2.1379, num: 3 } },
  },
  {
    questId: 94161101,
    questName: "パンプキン収穫 ぷちぷちファーム",
    recommendLv: "70",
    ap: 40,
    sampleRuns: 317,
    drops: { 94160902: { dropExpected: 11.0189, num: 3 }, 94160903: { dropExpected: 2.205, num: 3 } },
  },
  {
    questId: 94161102,
    questName: "パンプキン収穫 分け合いファーム",
    recommendLv: "70",
    ap: 40,
    sampleRuns: 591,
    drops: { 94160901: { dropExpected: 2.2081, num: 3 }, 94160903: { dropExpected: 11.1421, num: 3 } },
  },
  {
    questId: 94161103,
    questName: "パンプキン収穫 ここ掘れファーム",
    recommendLv: "75",
    ap: 40,
    sampleRuns: 742,
    drops: { 94160901: { dropExpected: 14.4205, num: 3 }, 94160902: { dropExpected: 2.9394, num: 3 } },
  },
  {
    questId: 94161104,
    questName: "パンプキン収穫 妙案奇案ファーム",
    recommendLv: "80",
    ap: 40,
    sampleRuns: 973,
    drops: { 94160902: { dropExpected: 14.555, num: 3 }, 94160903: { dropExpected: 2.8828, num: 3 } },
  },
  {
    questId: 94161105,
    questName: "パンプキン収穫 牛追いファーム",
    recommendLv: "85",
    ap: 40,
    sampleRuns: 981,
    drops: { 94160901: { dropExpected: 2.8685, num: 3 }, 94160903: { dropExpected: 14.4954, num: 3 } },
  },
  {
    questId: 94161107,
    questName: "パンプキン収穫 父と子のファーム",
    recommendLv: "90+",
    ap: 40,
    sampleRuns: 1736,
    drops: {
      94160901: { dropExpected: 9.254, num: 3 },
      94160902: { dropExpected: 9.3001, num: 3 },
      94160903: { dropExpected: 9.2068, num: 3 },
    },
  },
  {
    questId: 94161108,
    questName: "パンプキン収穫 誓いのファーム",
    recommendLv: "90++",
    ap: 40,
    sampleRuns: 13472,
    drops: {
      94160901: { dropExpected: 11.1328, num: 3 },
      94160902: { dropExpected: 11.1377, num: 3 },
      94160903: { dropExpected: 11.0917, num: 3 },
    },
  },
];
const B_FARM = { quests: B_QUESTS, best: { 94160901: 94161103, 94160902: 94161104, 94160903: 94161105 } };
const B_TRADES = [
  { fromId: 94160901, toId: 94160902, costAmount: 10, getNum: 1 },
  { fromId: 94160902, toId: 94160903, costAmount: 10, getNum: 1 },
];
const B_NEEDS = { 94160901: 4000, 94160902: 3000, 94160903: 5000 };

function runsOf(plan) {
  const map = {};
  for (const play of plan.plays) map[play.questId] = play.runs;
  return map;
}

/* Fixture A (Amendment L5): priority 誓い, no bonus, no trades → the minimum is 142 plays =
   113×誓い + 29×牛追い, and the tie-break least-surplus picks it over the equal-total 114+28
   and 115+27 neighbours. */
test("farmPlan fixture A: 誓い-priority, no bonus no trades → 142 plays = 113誓い + 29牛追い", () => {
  const plan = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: {},
    farm: B_FARM,
    trades: [],
    priorityQuestId: 94161108,
  });
  assert.equal(plan.totalPlays, 142);
  assert.deepEqual(runsOf(plan), { 94161108: 113, 94161105: 29 });
  assert.deepEqual(plan.trades, [], "no trades in this fixture");
  assert.ok(Math.abs(plan.yields["94160901"] - 4023.5787) < 1e-3, `cookie ${plan.yields["94160901"]}`);
  assert.ok(Math.abs(plan.yields["94160902"] - 3775.6803) < 1e-3, `donut ${plan.yields["94160902"]}`);
  assert.ok(Math.abs(plan.yields["94160903"] - 5021.1861) < 1e-3, `pie ${plan.yields["94160903"]}`);
  for (const key of Object.keys(B_NEEDS))
    assert.equal(plan.surplus[key], Math.round((plan.yields[key] - B_NEEDS[key]) * 1e6) / 1e6);
  assert.equal(plan.plays[0].questId, 94161108, "most-ridden first");
  assert.equal(plan.plays[0].questName, "パンプキン収穫 誓いのファーム");
  assert.equal(plan.plays[0].recommendLv, "90++");
  assert.equal(plan.plays[0].isAllDrop, true, "誓い drops every shop currency");
  assert.equal(plan.plays[0].mainDropId, 94160902, "誓い's biggest line is the donut");
  assert.equal(plan.plays[1].isAllDrop, false, "牛追い drops no donut");
  assert.equal(plan.plays[1].mainDropId, 94160903);
});

/* Fixture B (Amendment L5/L8, re-pinned by R22): the same needs with bonuses cookie+1 / donut+2 /
   pie+1 and the 10:1 upgrade trades. The trade-aware minimum is still 104 plays = 90×誓い + 14×牛追い.
   Its raw drops cover cookie (4,168.4 over 4,000) and donut (5,011.9 over 3,000) on their own, and pie
   is 195.2456 short, so the MINIMUM cover is 196 donut→pie trades and no cookie→donut trade at all —
   the full cascade used to report 16 + 202 by converting every spare unit upward. Finals after the
   minimum cover: donut 3051.965 / cookie 4168.444 / pie 5000.7544 (total surplus 221.1634, higher by
   design — what the cascade would have traded away now stays in the bag). A greedy that farmed every
   deficit without trades is worse. */
test("farmPlan fixture B: trade-aware bonus plan → 104 plays, minimum cover 196 donut→pie", () => {
  const plan = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: { 94160901: 1, 94160902: 2, 94160903: 1 },
    farm: B_FARM,
    trades: B_TRADES,
    priorityQuestId: 94161108,
  });
  assert.equal(plan.totalPlays, 104);
  assert.deepEqual(runsOf(plan), { 94161108: 90, 94161105: 14 });
  assert.deepEqual(plan.trades, [{ fromId: 94160902, toId: 94160903, count: 196 }]);
  assert.ok(Math.abs(plan.yields["94160902"] - 3051.965) < 0.01, `donut ${plan.yields["94160902"]}`);
  assert.ok(Math.abs(plan.yields["94160901"] - 4168.444) < 0.01, `cookie ${plan.yields["94160901"]}`);
  assert.ok(Math.abs(plan.yields["94160903"] - 5000.7544) < 0.01, `pie ${plan.yields["94160903"]}`);
  const totalSurplus = Object.values(plan.surplus).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(totalSurplus - 221.1634) < 0.01, `surplus ${totalSurplus}`);
});

/* --- Amendment R1: farmPlan also reports `farmed` — the plan's runs' raw quest drops,
   bonus-priced, BEFORE the trade cascade. The Item Receive card prints that figure, so what a
   player reads there is what the listed runs actually produce, not what the trades move. --- */

function planFixtureB() {
  return EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: { 94160901: 1, 94160902: 2, 94160903: 1 },
    farm: B_FARM,
    trades: B_TRADES,
    priorityQuestId: 94161108,
  });
}

test("farmPlan fixture B farmed pins the runs' raw drops, pre-cascade", () => {
  const plan = planFixtureB();
  assert.ok(Math.abs(plan.farmed["94160901"] - 4168.444) < 1e-3, `cookie ${plan.farmed["94160901"]}`);
  assert.ok(Math.abs(plan.farmed["94160902"] - 5011.965) < 1e-3, `donut ${plan.farmed["94160902"]}`);
  assert.ok(Math.abs(plan.farmed["94160903"] - 4804.7544) < 1e-3, `pie ${plan.farmed["94160903"]}`);
});

test("farmPlan farmed reconciles through its reported trades to yields: farmed − spent + received", () => {
  const plan = planFixtureB();
  const spent = tradeFlow(plan.trades, "fromId", "costAmount");
  const received = tradeFlow(plan.trades, "toId", "getNum");
  for (const key of Object.keys(B_NEEDS)) {
    const net = plan.farmed[key] - (spent[key] || 0) + (received[key] || 0);
    assert.ok(Math.abs(net - plan.yields[key]) < 1e-6, `${key} net ${net} vs yields ${plan.yields[key]}`);
  }
});

/* Amendment R22: the trade list is the MINIMUM that covers, so no shorter list can do the job. Pie is
   195.2456 short of its 5,000 (fixture B above) and each donut→pie trade buys one pie, so 196 is the
   fewest that covers; the cookie and donut stacks need no top-up of their own and trade nothing up. */
test("farmPlan minimum cover: 196 is the fewest trades that covers, and a covered currency trades nothing", () => {
  const plan = planFixtureB();
  const pieNeed = B_NEEDS[94160903];
  assert.equal(plan.trades.length, 1, "minimum cover is one trade row");
  const [trades] = plan.trades;
  const ratio = B_TRADES.find((row) => Number(row.fromId) === trades.fromId && Number(row.toId) === trades.toId);
  assert.equal(trades.count, 196);
  const oneFewer = plan.farmed["94160903"] + (trades.count - 1) * ratio.getNum;
  assert.ok(oneFewer < pieNeed, `${oneFewer} pie after ${trades.count - 1} trades still misses ${pieNeed}`);
  assert.ok(plan.farmed["94160903"] + trades.count * ratio.getNum >= pieNeed, "and 196 covers it");
  assert.equal(
    plan.yields["94160901"],
    plan.farmed["94160901"],
    "cookie trades nothing up: its own surplus stays in the bag",
  );
});

/* R22 drift guard: the full-cascade walk exists three times — cascadeYields (the search's oracle),
   cascadeIntoArrays (the fused inner kernel) and spendSurplusUpChain (the min-cover seed). Twin
   semantics by comment, not by call. Pin per-(from, to) trade counts equal across two of them on
   every fixture chain plus a branching one, so an edit to one twin fails here, not silently in the
   minCoverTrades seed. CASCADE_MICRO mirrors domain.js's private CURRENCY_MICRO. */
const CASCADE_MICRO = 10000;

function microUnits(units) {
  const map = {};
  for (const [key, value] of Object.entries(units)) map[key] = Math.round(value * CASCADE_MICRO);
  return map;
}

/* The valid-row subset of domain.js's tradeChain: cost/get on the micro grid, targets id ascending. */
function chainFromShop(trades) {
  const chain = {};
  for (const trade of trades) {
    const entry = {
      toKey: String(trade.toId),
      costMicro: trade.costAmount * CASCADE_MICRO,
      getMicro: trade.getNum * CASCADE_MICRO,
    };
    (chain[String(trade.fromId)] = chain[String(trade.fromId)] || []).push(entry);
  }
  for (const outs of Object.values(chain)) outs.sort((a, b) => Number(a.toKey) - Number(b.toKey));
  return chain;
}

function pairCounts(items) {
  const counts = {};
  for (const item of items) {
    if (item.count <= 0) continue;
    const key = `${Number(item.fromId)}->${Number(item.toId)}`;
    counts[key] = (counts[key] || 0) + item.count;
  }
  return counts;
}

test("R22 drift guard: spendSurplusUpChain seeds exactly what cascadeYields walks, per fixture chain", () => {
  const planA = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: {},
    farm: B_FARM,
    trades: [],
    priorityQuestId: 94161108,
  });
  const planC = EventShop.farmPlan({
    totals: { 94164000: 3000, 94164001: 4000, 94164002: 5000 },
    held: {},
    bonus: {},
    farm: C_FARM,
    trades: C_TRADES,
    priorityQuestId: null,
  });
  // A branching chain: two sources into one merge, then to the top; ids ascending so the numeric
  // sort below is the bottom-up (topological) order every fixture chain walks.
  const branchTrades = [
    { fromId: 94169901, toId: 94169903, costAmount: 10, getNum: 1 },
    { fromId: 94169902, toId: 94169903, costAmount: 10, getNum: 1 },
    { fromId: 94169903, toId: 94169904, costAmount: 10, getNum: 1 },
  ];
  const fixtures = [
    { name: "fixture A (empty chain)", trades: [], needs: B_NEEDS, farmed: planA.farmed, pinned: {} },
    {
      name: "fixture B",
      trades: B_TRADES,
      needs: B_NEEDS,
      farmed: planFixtureB().farmed,
      pinned: { "94160901->94160902": 16, "94160902->94160903": 202 },
    },
    {
      name: "fixture C",
      trades: C_TRADES,
      needs: { 94164000: 3000, 94164001: 4000, 94164002: 5000 },
      farmed: planC.farmed,
      pinned: { "94164000->94164001": 3 },
    },
    {
      name: "branching chain",
      trades: branchTrades,
      needs: { 94169901: 100, 94169902: 100, 94169903: 100, 94169904: 100 },
      farmed: { 94169901: 120, 94169902: 150, 94169903: 120, 94169904: 0 },
      pinned: { "94169901->94169903": 2, "94169902->94169903": 5, "94169903->94169904": 2 },
    },
  ];
  for (const fixture of fixtures) {
    const deficits = microUnits(fixture.needs);
    const yields = microUnits(fixture.farmed);
    const chain = chainFromShop(fixture.trades);
    const keys = new Set([...Object.keys(deficits), ...Object.keys(chain)]);
    for (const outs of Object.values(chain)) for (const out of outs) keys.add(out.toKey);
    const order = [...keys].sort((a, b) => Number(a) - Number(b));
    const table = { deficits, chain, keys: order, order };
    const walked = pairCounts(cascadeYields(table, yields).trades);
    // The same working rows minCoverTrades seeds via tradeRows(chain, order).
    const rows = [];
    for (const key of order) for (const entry of chain[key] || []) rows.push({ ...entry, fromKey: key, count: 0 });
    spendSurplusUpChain(yields, deficits, rows);
    const seeded = pairCounts(rows.map((row) => ({ fromId: row.fromKey, toId: row.toKey, count: row.count })));
    assert.deepEqual(seeded, walked, `${fixture.name}: seed must equal the full cascade`);
    assert.deepEqual(walked, fixture.pinned, `${fixture.name}: pinned full-cascade counts`);
  }
});

/* Trade figures per currency at one end of the executed pairs: what each side sends or receives,
   priced on the shop's own B_TRADES ratios. */
function tradeFlow(trades, endField, figureField) {
  const flow = {};
  for (const trade of trades) {
    const ratio = B_TRADES.find(
      (candidate) => Number(candidate.fromId) === trade.fromId && Number(candidate.toId) === trade.toId,
    );
    const key = String(trade[endField]);
    flow[key] = (flow[key] || 0) + trade.count * ratio[figureField];
  }
  return flow;
}

test("farmPlan without trades farmeds exactly what it yields", () => {
  const plan = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: {},
    farm: B_FARM,
    trades: [],
    priorityQuestId: 94161108,
  });
  assert.deepEqual(plan.farmed, plan.yields, "no cascade: the raw drops ARE the finals");
});

test("farmPlan with zero deficits farmeds a 0 row on the same keys", () => {
  const plan = EventShop.farmPlan({ totals: { 1: 5 }, held: { 1: 9 }, bonus: {}, farm: C_FARM, trades: [] });
  assert.deepEqual(plan.farmed, plan.yields);
  assert.equal(plan.farmed["1"], 0, "no runs, no drops");
});

test("infeasible farmPlan farmeds nothing", () => {
  const plan = EventShop.farmPlan({
    totals: { 1: 10 },
    held: {},
    bonus: {},
    farm: { quests: [], best: {} },
    trades: [],
  });
  assert.equal(plan.totalPlays, null);
  assert.deepEqual(plan.farmed, {});
});

/* Fixture B's floor (Amendment L5): 103 plays cannot cover the plan. The four Pareto quests
   (誓い/牛追い/ここ掘れ/妙案奇案 dominate every other quest currency-for-currency), so every
   103-play vector reduces to their split — and none of them covers even with the full cascade.
   This brute force is written independently of the optimizer, and the best 103-play mix leaves
   pie short ~19.7 (the lead's 19.66, before the sync's 4-decimal rounding). */
test("farmPlan fixture B floor: no 103-play mix covers the needs even with the full trade cascade", () => {
  const rate = {
    94161108: { c: 11.1328 * 4, d: 11.1377 * 5, p: 11.0917 * 4 },
    94161105: { c: 2.8685 * 4, d: 0, p: 14.4954 * 4 },
    94161103: { c: 14.4205 * 4, d: 2.9394 * 5, p: 0 },
    94161104: { c: 0, d: 14.555 * 5, p: 2.8828 * 4 },
  };
  let minPieShort = Infinity;
  for (let a = 0; a <= 103; a++) {
    for (let b = 0; b <= 103 - a; b++) {
      for (let e = 0; e <= 103 - a - b; e++) {
        const f = 103 - a - b - e;
        const y = cover103(a, b, e, f, rate);
        if (y.feasible) assert.fail(`Σ=103 was feasible at ${a},${b},${e},${f}`);
        if (y.cookieCovered) minPieShort = Math.min(minPieShort, y.pieShort);
      }
    }
  }
  assert.ok(minPieShort > 19 && minPieShort < 20.5, `best 103-mix pie short ${minPieShort}`);
});

function cover103(a, b, e, f, rate) {
  const cookie = a * rate[94161108].c + b * rate[94161105].c + e * rate[94161103].c;
  const donut = a * rate[94161108].d + e * rate[94161103].d + f * rate[94161104].d;
  const pie = a * rate[94161108].p + b * rate[94161105].p + f * rate[94161104].p;
  const cookieTrades = Math.floor(Math.max(0, cookie - 4000) / 10);
  const donutPool = donut + cookieTrades - 3000;
  const pieTrades = Math.floor(Math.max(0, donutPool) / 10);
  return {
    cookieCovered: cookie >= 4000 - 1e-9,
    pieShort: Math.max(0, 5000 - pie - pieTrades),
    feasible: cookie >= 4000 - 1e-9 && donutPool - pieTrades * 10 >= -1e-9 && pie + pieTrades >= 5000 - 1e-9,
  };
}

/* Fixture C (Amendment L5, re-pinned by Amendment Q2): 80639 has no all-covering quest, so the
   exact no-priority search prices the plan over the shipped snapshot's own three quests (rates and
   10:1 trade chain refreshed to the data module — the old fixture carried a stale 94164101 line and
   no trades). needs bronze 3000 / silver 4000 / gold 5000 → the oracle's brute-forced minimum is
   306 plays = 64×だるま + 108×こんにゃく + 134×槍, whose drops cover all three needs, so the R22
   minimum cover trades nothing (the full cascade used to report 3 bronze→silver by pushing every
   spare unit up). The old greedy walked
   334 plays and left ~800 gold of surplus (the buy-all spend, pinned in the hostile suite, was even
   worse: 498 plays with a +1084 gold surplus — the owner-reported "+1093 YAKI"). */
const C_FARM = {
  quests: [
    {
      questId: 94164100,
      questName: "【GUNMA巡り】だるまを買いにいこう",
      recommendLv: "70",
      ap: 40,
      sampleRuns: 224,
      drops: { 94164000: { dropExpected: 10.8214, num: 3 }, 94164001: { dropExpected: 2.058, num: 3 } },
    },
    {
      questId: 94164101,
      questName: "【GUNMA巡り】こんにゃくとネギ",
      recommendLv: "70",
      ap: 40,
      sampleRuns: 103,
      drops: { 94164001: { dropExpected: 11.1442, num: 3 }, 94164002: { dropExpected: 2.0481, num: 3 } },
    },
    {
      questId: 94164102,
      questName: "【GUNMA巡り】槍をスキーに連れていけ",
      recommendLv: "70",
      ap: 40,
      sampleRuns: 178,
      drops: { 94164000: { dropExpected: 2.382, num: 3 }, 94164002: { dropExpected: 10.809, num: 3 } },
    },
  ],
  best: { 94164000: 94164100, 94164001: 94164101, 94164002: 94164102 },
};
const C_TRADES = [
  { fromId: 94164000, toId: 94164001, costAmount: 10, getNum: 1 },
  { fromId: 94164001, toId: 94164002, costAmount: 10, getNum: 1 },
];

test("farmPlan fixture C: no all-covering quest → exact minimum 306 plays = 64だるま + 108こんにゃく + 134槍", () => {
  const plan = EventShop.farmPlan({
    totals: { 94164000: 3000, 94164001: 4000, 94164002: 5000 },
    held: {},
    bonus: {},
    farm: C_FARM,
    trades: C_TRADES,
    priorityQuestId: null,
  });
  assert.equal(plan.totalPlays, 306, "the oracle brute-forces 306 as the minimum (was: greedy 334)");
  assert.deepEqual(runsOf(plan), { 94164102: 134, 94164101: 108, 94164100: 64 });
  assert.deepEqual(plan.trades, [], "R22 minimum cover: every currency's own drops reach its need");
  assert.ok(Math.abs(plan.yields["94164002"] - 5008.8024) < 0.01, `gold ${plan.yields["94164002"]}`);
  assert.ok(Math.abs(plan.yields["94164000"] - 3035.2728) < 0.01, `bronze ${plan.yields["94164000"]}`);
  assert.ok(Math.abs(plan.yields["94164001"] - 4005.8568) < 0.01, `silver ${plan.yields["94164001"]}`);
  assert.ok(
    plan.plays.every((play) => play.isAllDrop === false),
    "80639 ships no all-drop quest",
  );
  assert.equal(plan.plays[0].mainDropId, 94164002, "槍's main drop is the gold");
});

/* Amendment Q correctness fix (oracle fuzz case 64): quest 1000 drops all three currencies but is
   fully replayed by 1001 (same AP, higher on every line), so the integer-replay audit — and any
   honest minimum — excludes it. The old priority scan seeded the user's pick without that check
   and shipped a {1000:5} plan whose farming the replay could not see, reading as every currency
   short. The plan must now replay as exact integer stacks (dropExpected snapped to the 1e-4 grid
   × (num + bonus), like the oracle) and cover every deficit with zero trades. */
const Q64_NEEDS = { 10: 96, 20: 221, 30: 127 };
const Q64_BONUS = { 10: 2, 20: 2, 30: 0 };
const Q64_QUESTS = [
  {
    questId: 1000,
    questName: "q0",
    recommendLv: "70",
    ap: 40,
    drops: {
      10: { dropExpected: 6.9042, num: 3 },
      20: { dropExpected: 9.1202, num: 3 },
      30: { dropExpected: 10.7336, num: 3 },
    },
  },
  {
    questId: 1001,
    questName: "q1",
    recommendLv: "70",
    ap: 40,
    drops: {
      10: { dropExpected: 9.1836, num: 3 },
      20: { dropExpected: 14.1605, num: 3 },
      30: { dropExpected: 14.3909, num: 3 },
    },
  },
  {
    questId: 1002,
    questName: "q2",
    recommendLv: "70",
    ap: 40,
    drops: { 20: { dropExpected: 11.0602, num: 3 }, 30: { dropExpected: 12.4878, num: 3 } },
  },
  { questId: 1003, questName: "q3", recommendLv: "70", ap: 40, drops: { 30: { dropExpected: 4.3916, num: 3 } } },
];
const Q64_FARM = { quests: Q64_QUESTS, best: { 10: 1001, 20: 1001, 30: 1001 } };

/* Σ runs × integer micro rate per currency, plus the integer trade cascade (floor(max(0, free) /
   cost), bottom-up ids ascending) — the oracle's replay arithmetic, restated here independently.
   Returns null when a play names a quest the farm data does not carry. */
function integerReplayFinals(plan, farm, bonus, trades, needs) {
  const micro = {};
  for (const play of plan.plays) {
    const quest = farm.quests.find((q) => q.questId === play.questId);
    if (!quest) return null;
    for (const [key, drop] of Object.entries(quest.drops)) {
      const perRun = Math.round(drop.dropExpected * 10000) * (drop.num + (bonus[key] || 0));
      micro[key] = (micro[key] || 0) + play.runs * perRun;
    }
  }
  const keys = Object.keys(needs).sort((a, b) => Number(a) - Number(b));
  const inflow = {};
  const final = {};
  for (const key of keys) {
    const deficit = Math.round(needs[key] * 10000);
    const avail = (micro[key] || 0) + (inflow[key] || 0);
    let free = avail - deficit;
    let spent = 0;
    for (const trade of trades.filter((t) => String(t.fromId) === key).sort((a, b) => a.toId - b.toId)) {
      const times = Math.floor(Math.max(0, free) / (trade.costAmount * 10000));
      if (times <= 0) continue;
      free -= times * trade.costAmount * 10000;
      spent += times * trade.costAmount * 10000;
      inflow[String(trade.toId)] = (inflow[String(trade.toId)] || 0) + times * trade.getNum * 10000;
    }
    final[key] = avail - spent;
  }
  return final;
}

test("farmPlan replays integer-safe on the fuzz case-64 shape: dominated priority pick never ships, 4 plays cover exactly", () => {
  const plan = EventShop.farmPlan({
    totals: Q64_NEEDS,
    held: {},
    bonus: Q64_BONUS,
    farm: Q64_FARM,
    trades: [],
    priorityQuestId: 1000,
  });
  assert.equal(plan.totalPlays, 4, "the exact integer minimum is 4×q1; a dominated priority quest cannot lower it");
  assert.deepEqual(
    runsOf(plan),
    { 1001: 4 },
    "quest 1000 is replayed for free by 1001 — it never enters an auditable plan",
  );
  const finals = integerReplayFinals(plan, Q64_FARM, Q64_BONUS, [], Q64_NEEDS);
  assert.notEqual(finals, null, "every played quest must be farm data the replay can see");
  for (const key of Object.keys(Q64_NEEDS)) {
    assert.ok(
      finals[key] >= Q64_NEEDS[key] * 10000,
      `${key} integer final ${finals[key]} micro below need ${Q64_NEEDS[key] * 10000} micro`,
    );
    assert.ok(plan.surplus[key] >= 0, `${key} reported surplus ${plan.surplus[key]} negative`);
    assert.equal(
      Math.round(plan.yields[key] * 10000),
      finals[key],
      `${key} reported yield disagrees with the integer replay`,
    );
  }
});

/* --- Amendment L optimizer contract: determinism, guards and trade behaviour --- */

test("farmPlan with zero deficits plays nothing and covers every currency with a 0 row", () => {
  const plan = EventShop.farmPlan({ totals: { 1: 5 }, held: { 1: 9 }, bonus: {}, farm: C_FARM, trades: [] });
  assert.equal(plan.totalPlays, 0);
  assert.deepEqual(plan.plays, []);
  assert.deepEqual(plan.trades, []);
  assert.equal(plan.yields["1"], 0);
  assert.equal(plan.surplus["1"], 0);
});

test("farmPlan prices held over the deficit as covered — runs nothing it does not need", () => {
  const plan = EventShop.farmPlan({
    totals: { 94164000: 3000, 94164001: 0, 94164002: 0 },
    held: { 94164000: 3000 },
    bonus: {},
    farm: C_FARM,
    trades: [],
    priorityQuestId: null,
  });
  assert.equal(plan.totalPlays, 0);
});

test("farmPlan with no farm quests or a currency nobody drops reports an infeasible plan, never a partial one", () => {
  const noQuests = EventShop.farmPlan({
    totals: { 1: 10 },
    held: {},
    bonus: {},
    farm: { quests: [], best: {} },
    trades: [],
  });
  assert.equal(noQuests.totalPlays, null);
  assert.deepEqual(noQuests.plays, []);

  const silverless = { quests: [C_FARM.quests[2]], best: { 94164000: 94164102, 94164002: 94164102 } };
  const noSilver = EventShop.farmPlan({
    totals: { 94164000: 100, 94164001: 100, 94164002: 100 },
    held: {},
    bonus: {},
    farm: silverless,
    trades: [],
  });
  assert.equal(noSilver.totalPlays, null, "an unfarmable currency is no plan at all");
});

test("farmPlan survives a missing snapshot, junk figures and hostile bonuses without crashing", () => {
  assert.equal(EventShop.farmPlan().totalPlays, 0);
  assert.deepEqual(EventShop.farmPlan().plays, []);

  const junk = EventShop.farmPlan({ totals: { 1: "many" }, held: { 1: "some" }, bonus: {}, farm: {}, trades: [] });
  assert.equal(junk.totalPlays, 0, "junk figures read as 0 need, which needs no farming");

  const hugeBonus = EventShop.farmPlan({
    totals: { 94164000: 100 },
    held: {},
    bonus: { 94164000: 1e9 },
    farm: C_FARM,
    trades: null,
  });
  assert.ok(hugeBonus.totalPlays >= 1, "a clamped giant bonus still covers 100 inside a few runs");
  assert.ok(hugeBonus.yields["94164000"] >= 100);

  const negativeHeld = EventShop.farmPlan({
    totals: { 94164000: 100 },
    held: { 94164000: -5 },
    bonus: {},
    farm: C_FARM,
  });
  assert.ok(negativeHeld.yields["94164000"] >= 105, "a negative held only makes the deficit bigger");
});

test("farmPlan trades are integer and minimum-cover — every shortfall still gets covered", () => {
  /* Needs pie 5000, farms none directly: 誓い alone pays donut past 3000 and cookie past 4000, so the
     minimum cover is whole 10:1 donut→pie trades and no cookie→donut trade — the fewest that leaves
     every currency at or above its need (Amendment R22). */
  const plan = EventShop.farmPlan({
    totals: { 94160901: 4000, 94160902: 3000, 94160903: 5000 },
    held: {},
    bonus: {},
    farm: B_FARM,
    trades: B_TRADES,
    priorityQuestId: 94161108,
  });
  for (const trade of plan.trades) {
    assert.ok(Number.isInteger(trade.count) && trade.count > 0, `trade ${JSON.stringify(trade)}`);
  }
  assert.ok(
    plan.trades.every((trade) => trade.toId === 94160903),
    "only the short currency is fed",
  );
  assert.ok(plan.totalPlays < 155, `trades must save plays: ${plan.totalPlays}`);
  for (const key of Object.keys(B_NEEDS)) {
    assert.ok(plan.yields[key] >= B_NEEDS[key] - 1e-6, `${key} covered: ${plan.yields[key]}`);
  }
});

test("farmPlan is deterministic: the same inputs print the same plan twice", () => {
  const args = {
    totals: B_NEEDS,
    held: {},
    bonus: { 94160903: 1 },
    farm: B_FARM,
    trades: B_TRADES,
    priorityQuestId: 94161108,
  };
  assert.deepEqual(EventShop.farmPlan(args), EventShop.farmPlan(args));
});

/* --- Amendment M6: the top-up quest of a currency is the card's SELECTION, default the best.
   With the default picks (each currency's farm.best quest) every Amendment L fixture must still
   hold; a deliberate pick moves the top-up onto that quest; a pick equal to the priority quest
   falls back so the pinned optimum survives. --- */

const B_DEFAULT_PICKS = { 94160901: 94161103, 94160902: 94161104, 94160903: 94161105 };
const C_DEFAULT_PICKS = { 94164000: 94164100, 94164001: 94164101, 94164002: 94164102 };

test("farmPlan with default currencyQuest picks holds every pinned fixture (142 / 104 / 306)", () => {
  const a = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: {},
    farm: B_FARM,
    trades: [],
    priorityQuestId: 94161108,
    currencyQuest: B_DEFAULT_PICKS,
  });
  assert.equal(a.totalPlays, 142);
  assert.deepEqual(runsOf(a), { 94161108: 113, 94161105: 29 });
  const b = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: { 94160901: 1, 94160902: 2, 94160903: 1 },
    farm: B_FARM,
    trades: B_TRADES,
    priorityQuestId: 94161108,
    currencyQuest: B_DEFAULT_PICKS,
  });
  assert.equal(b.totalPlays, 104);
  assert.deepEqual(runsOf(b), { 94161108: 90, 94161105: 14 });
  const c = EventShop.farmPlan({
    totals: { 94164000: 3000, 94164001: 4000, 94164002: 5000 },
    held: {},
    bonus: {},
    farm: C_FARM,
    trades: C_TRADES,
    priorityQuestId: null,
    currencyQuest: C_DEFAULT_PICKS,
  });
  assert.equal(
    c.totalPlays,
    306,
    "default picks name the same farmers the unselected search would, so the exact minimum holds",
  );
  assert.deepEqual(runsOf(c), { 94164102: 134, 94164101: 108, 94164100: 64 });
});

test("farmPlan farms a currency's shortfall with the SELECTED quest, not the auto-best", () => {
  const plan = EventShop.farmPlan({
    totals: { 94164000: 3000, 94164001: 4000, 94164002: 5000 },
    held: {},
    bonus: {},
    farm: C_FARM,
    trades: C_TRADES,
    priorityQuestId: null,
    currencyQuest: { 94164000: 94164102 },
  });
  assert.equal(
    plan.totalPlays,
    540,
    "bronze picked onto the 槍 quest (7.146/run over its own gold) instead of the だるま best: bronze 420×7.146, silver 120×33.4326 (shipped rate) — the exact minimum under that pick",
  );
  assert.deepEqual(runsOf(plan), { 94164102: 420, 94164101: 120 });
  assert.ok(plan.yields["94164000"] >= 3000 && plan.yields["94164001"] >= 4000 && plan.yields["94164002"] >= 5000);
});

test("farmPlan survives a currency selected onto the priority quest — the scan already prices it", () => {
  const plan = EventShop.farmPlan({
    totals: B_NEEDS,
    held: {},
    bonus: {},
    farm: B_FARM,
    trades: [],
    priorityQuestId: 94161108,
    currencyQuest: { 94160903: 94161108 },
  });
  assert.equal(plan.totalPlays, 142, "the top-up falls back to the best usable rate, fixture stays");
  assert.deepEqual(runsOf(plan), { 94161108: 113, 94161105: 29 });
});

/* --- Amendment L3/L4: all-covering detection and the farmQuest default --- */

test("allCoveringQuests lists only quests dropping every shop currency, in snapshot order", () => {
  const ids = [94160901, 94160902, 94160903];
  assert.deepEqual(
    EventShop.allCoveringQuests(B_FARM, ids).map((quest) => quest.questId),
    [94161107, 94161108],
  );
  assert.deepEqual(EventShop.allCoveringQuests(C_FARM, [94164000, 94164001, 94164002]), [], "80639 has none");
  assert.deepEqual(EventShop.allCoveringQuests(null, [1]), []);
  assert.deepEqual(EventShop.allCoveringQuests(B_FARM, []), [], "no currencies, no coverage");
});

test("defaultFarmQuest picks the all-covering quest with the highest total dropExpected×num", () => {
  const ids = [94160901, 94160902, 94160903];
  assert.equal(EventShop.defaultFarmQuest(B_FARM, ids), 94161108, "誓い out-pays 父と子の every line");
  assert.equal(
    EventShop.defaultFarmQuest(C_FARM, [94164000, 94164001, 94164002]),
    null,
    "no all-covering quest, no default",
  );
  const tieFarm = {
    quests: [
      {
        questId: 7,
        questName: "b",
        recommendLv: "1",
        ap: 1,
        sampleRuns: 1,
        drops: { 1: { dropExpected: 1, num: 3 }, 2: { dropExpected: 1, num: 3 } },
      },
      {
        questId: 6,
        questName: "a",
        recommendLv: "1",
        ap: 1,
        sampleRuns: 1,
        drops: { 1: { dropExpected: 1, num: 3 }, 2: { dropExpected: 1, num: 3 } },
      },
    ],
    best: {},
  };
  assert.equal(EventShop.defaultFarmQuest(tieFarm, [1, 2]), 6, "a total tie goes to the lower quest id");
});

/* --- Amendment G: multi-event snapshots, per-event plans, storage migration --- */

const goldItem = { id: 101, cost: { itemId: 94164002, amount: 10 }, limitNum: 2, setNum: 1, priority: 1 };
const silverItem = { id: 201, cost: { itemId: 94164001, amount: 5 }, limitNum: 0, setNum: 1, priority: 1 };
const FARM_GOLD = {
  quests: [
    {
      questId: 501,
      questName: "qa",
      recommendLv: "70",
      ap: 40,
      sampleRuns: 9,
      drops: { 94164002: { dropExpected: 10, num: 3 } },
    },
  ],
  best: { 94164002: 501 },
};
const EVENT_A = {
  event: { id: 80639, name: "A", shortName: "A" },
  currencies,
  items: [goldItem, silverItem],
  farm: FARM_GOLD,
  trades: [],
};
const EVENT_B = {
  event: { id: 80630, name: "B", shortName: "B" },
  currencies: [{ id: 94162101, name: "Ticket", background: "gold" }],
  items: [{ id: 101, cost: { itemId: 94162101, amount: 1 }, limitNum: 5, setNum: 1, priority: 1 }],
  farm: { quests: [], best: {} },
  trades: [],
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
    farmQuest: null,
    currencyQuest: {},
  });
  assert.deepEqual(state.plans["80630"], {
    requires: {},
    held: { 94162101: 0 },
    bonus: { 94162101: 0 },
    farmQuest: null,
    currencyQuest: {},
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
      80630: { requires: {}, held: { 94162101: 0 }, bonus: { 94162101: 0 }, farmQuest: null, currencyQuest: {} },
    },
  });
});

/* --- Amendment L4: farmQuest survives the sanitizer only if the event's farm list carries it --- */

const B_SNAPSHOT = {
  event: { id: 80627, name: "B27", shortName: "B27" },
  currencies: [
    { id: 94160901, name: "cookie", background: "bronze", icon: null },
    { id: 94160902, name: "donut", background: "silver", icon: null },
    { id: 94160903, name: "pie", background: "gold", icon: null },
  ],
  items: [goldItem],
  farm: B_FARM,
  trades: B_TRADES,
};

test("sanitizePlans defaults farmQuest to the best all-covering quest and keeps a stored known quest", () => {
  assert.equal(EventShop.sanitizePlans({}, [B_SNAPSHOT]).plans["80627"].farmQuest, 94161108);
  assert.equal(
    EventShop.sanitizePlans({ plans: { 80627: { farmQuest: 94161107 } } }, [B_SNAPSHOT]).plans["80627"].farmQuest,
    94161107,
    "a quest the event still ships survives, even while not the default",
  );
});

test("sanitizePlans re-defaults a farmQuest the event's farm list no longer carries", () => {
  assert.equal(
    EventShop.sanitizePlans({ plans: { 80627: { farmQuest: 424242 } } }, [B_SNAPSHOT]).plans["80627"].farmQuest,
    94161108,
  );
  assert.equal(
    EventShop.sanitizePlans({ plans: { 80627: { farmQuest: "94x" } } }, [B_SNAPSHOT]).plans["80627"].farmQuest,
    94161108,
  );
  assert.equal(
    EventShop.sanitizePlans({ plans: { 80627: { farmQuest: [] } } }, [B_SNAPSHOT]).plans["80627"].farmQuest,
    94161108,
  );
  assert.equal(
    EventShop.sanitizePlans({ plans: { 80627: { farmQuest: 94161108 } } }, [EVENT_A]).plans["80639"].farmQuest,
    null,
  );
});

/* --- Amendment M4: currencyQuest picks survive only as quests that drop their own currency --- */

test("sanitizePlans migrates a plan without currencyQuest to {} and keeps unseen events on {}", () => {
  assert.deepEqual(EventShop.sanitizePlans({}, [B_SNAPSHOT]).plans["80627"].currencyQuest, {});
  assert.deepEqual(
    EventShop.sanitizePlans({ eventId: 80639, requires: { 101: 1 } }, EVENTS).plans["80639"].currencyQuest,
    {},
  );
});

test("sanitizePlans keeps a currencyQuest pick that drops its own currency and re-defaults the rest", () => {
  const saved = {
    plans: {
      80627: {
        currencyQuest: { 94160901: 94161103, 94160902: 94161102, 94160903: 94161107, 999999: 94161108 },
      },
    },
  };
  const plan = EventShop.sanitizePlans(saved, [B_SNAPSHOT]).plans["80627"];
  assert.equal(plan.currencyQuest["94160901"], 94161103, "the cookie pick drops cookies");
  assert.equal(plan.currencyQuest["94160902"], 94161104, "94161102 drops no donut — re-defaulted to the donut best");
  assert.equal(
    plan.currencyQuest["94160903"],
    94161105,
    "94161107 is all-covering — Amendment N2 re-defaults it to the best non-all-covering pie quest",
  );
  assert.equal(Object.hasOwn(plan.currencyQuest, "999999"), false, "a key that is not an event currency is dead data");
});

test("sanitizedCurrencyQuest: valid pick, wrong-currency re-default, all-covering re-default, unknown id re-default, no dropper null", () => {
  const farm = B_FARM;
  const ids = [94160901, 94160902, 94160903];
  const pick = (currencyKey, saved) => EventShop.sanitizedCurrencyQuest({ farm, currencyIds: ids, currencyKey, saved });
  assert.equal(pick("94160901", 94161100), 94161100, "目で愛で drops cookies");
  assert.equal(pick("94160901", 94161101), 94161103, "no cookies on it — the best");
  assert.equal(pick("94160901", 94161108), 94161103, "an all-covering pick is card 4's, not the card's");
  assert.equal(pick("94160901", "nonsense"), 94161103, "junk re-defaults");
  assert.equal(pick("94160901", null), 94161103, "a missing pick reads as the best");
  assert.equal(pick("4242", 94161101), null, "no currency, no pick");
  assert.equal(
    EventShop.sanitizedCurrencyQuest({ farm: {}, currencyIds: ids, currencyKey: "94160901", saved: 1 }),
    null,
    "a farm-less event has no picks at all",
  );
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
      farmQuest: null,
      currencyQuest: {},
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

test("EventPlanner.setFarmQuest persists an all-covering pick per event and re-defaults junk", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage, [B_SNAPSHOT]);
  assert.equal(planner.activePlan().farmQuest, 94161108, "a fresh plan starts on the default quest");
  planner.setFarmQuest(94161107);
  assert.equal(planner.activePlan().farmQuest, 94161107);
  planner.setFarmQuest("nonsense");
  assert.equal(planner.activePlan().farmQuest, 94161108, "an id the farm list lacks re-defaults");
  planner.setFarmQuest(424242);
  assert.equal(planner.activePlan().farmQuest, 94161108);
  const saved = JSON.parse(storage.dump()["fgo_event_shop_data"]);
  assert.equal(saved.plans["80627"].farmQuest, 94161108, "and the persisted plan says so too");
});

test("EventPlanner farmQuest is per-event: switching events swaps the choice, not the store", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage, [B_SNAPSHOT, EVENT_A]);
  planner.setFarmQuest(94161107);
  planner.select(80639);
  assert.equal(planner.activePlan().farmQuest, null, "the other event has no all-covering quest");
  planner.select(80627);
  assert.equal(planner.activePlan().farmQuest, 94161107, "the first event kept its own pick");
});

/* --- Amendment M4 at the app layer: the per-currency picks are one map inside the plan --- */

test("EventPlanner.setCurrencyQuest persists per-currency picks and re-defaults excluded quests", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage, [B_SNAPSHOT]);
  assert.deepEqual(
    planner.activePlan().currencyQuest,
    {},
    "a fresh plan has no explicit picks — each card shows its best",
  );
  planner.setCurrencyQuest(94160903, 94161107);
  assert.equal(
    planner.activePlan().currencyQuest["94160903"],
    94161105,
    "Amendment N2: an all-covering pick is card 4's — the card re-defaults to the best non-all-covering quest",
  );
  planner.setCurrencyQuest(94160903, 94161103);
  assert.equal(
    planner.activePlan().currencyQuest["94160903"],
    94161105,
    "94161103 drops no pie — re-defaulted to the best",
  );
  planner.setCurrencyQuest(94160901, 94161100);
  assert.equal(planner.activePlan().currencyQuest["94160901"], 94161100, "a deliberate non-all-covering pick survives");
  const saved = JSON.parse(storage.dump()["fgo_event_shop_data"]);
  assert.equal(saved.plans["80627"].currencyQuest["94160903"], 94161105, "and the persisted plan says so too");
});

test("EventPlanner currencyQuest is per-event: switching swaps the picks, not the store", async () => {
  const storage = fakeStorage();
  const planner = await plannerWith(storage, [B_SNAPSHOT, EVENT_A]);
  planner.setCurrencyQuest(94160901, 94161100);
  planner.select(80639);
  assert.deepEqual(planner.activePlan().currencyQuest, {}, "the other event kept its own (empty) map");
  planner.select(80627);
  assert.equal(planner.activePlan().currencyQuest["94160901"], 94161100, "the first event kept its own pick");
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
  planner.setFarmQuest(5);
  assert.equal(planner.activePlan().farmQuest, null, "no event, no pick to remember");
  planner.setHeld(94164002, 3);
  assert.deepEqual(planner.activePlan().requires, {}, "no plan to write into, and nothing throws");
  assert.deepEqual(planner.activePlan().held, {}, "no currencies, so nothing was written");
});

/* --- Amendment J5: a pruned event's saved plan stays in storage --- */

test("EventPlanner writes a pruned event's saved plan back verbatim on the first mutation", async () => {
  const saved = {
    selectedEventId: 80639,
    plans: { 80639: { requires: { 101: 1 } }, 80630: { requires: { 101: 5 }, held: { 94162101: 2 }, farmQuest: 7 } },
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
   Held/Bonus input pair; the tier card's Required field is the tab's only modal opener. */
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
    quests: [
      {
        questId: 1,
        questName: "A",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 9,
        drops: { 94164002: { dropExpected: 10, num: 3 } },
      },
      {
        questId: 2,
        questName: "B",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 9,
        drops: { 94164003: { dropExpected: 2, num: 5 } },
      },
    ],
    best: { 94164002: 1, 94164003: 2 },
  },
  trades: [],
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

/* The collision still prices: the optimizer gives each gold its own deficit (held subtracts only
   the currency it keys) and covers both. QP is not in these totals: nothing drops it and the shop
   row is unlimited, so the plan prices only the two golds. */
test("farmPlan prices each colliding gold with its own held and bonus", () => {
  const plan = EventShop.farmPlan({
    totals: { 94164002: 20, 94164003: 100 },
    held: { 94164002: 15 },
    bonus: { 94164003: 2 },
    farm: COLLISION.farm,
    trades: COLLISION.trades,
    priorityQuestId: null,
  });
  assert.equal(plan.totalPlays, 9, "8 runs of the 14/run gold B + 1 run of gold A's 30/run quest");
  assert.deepEqual(runsOf(plan), { 2: 8, 1: 1 });
  assert.equal(plan.yields["94164003"], 2 * (5 + 2) * 8, "bonus joins the second gold's own stack");
  assert.ok(plan.yields["94164003"] >= 100 && plan.yields["94164002"] >= 20 - 15 + 15);
  assert.equal(plan.surplus["94164003"], 112 - 100);
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

/* --- Amendment N: the REC Lv dropdown order and the cards 1-to-3 all-covering exclusion --- */

test("recLvRank orders the numeric part first, then plain < + < ++ < ★, missing levels last", async () => {
  const { recLvRank } = await import("../src/scripts/event-shop-farm-controls.js");
  const ordered = ["70", "75", "80", "85", "90", "90+", "90++", "100★"];
  const ranks = ordered.map((lv) => recLvRank(lv));
  ranks.forEach((rank, index) => {
    if (index === 0) return;
    assert.ok(rank > ranks[index - 1], `${ordered[index]} must rank above ${ordered[index - 1]}`);
  });
  assert.equal(recLvRank(80), recLvRank("80"), "a numeric recommendLv ranks like its string");
  assert.equal(recLvRank(" 90++ "), recLvRank("90++"), "surrounding spaces do not change the rank");
  for (const missing of [null, undefined, "", "junk", "★"]) {
    assert.equal(recLvRank(missing), Number.POSITIVE_INFINITY, `${JSON.stringify(missing)} sorts last`);
  }
  const sortedLevels = ["100★", "junk", "90", "70", "90++", "", "85", "90+", "75", "80", null].sort(
    (a, b) => recLvRank(a) - recLvRank(b),
  );
  assert.equal(sortedLevels[0], "70", "sorting the raw levels by rank starts at 70");
});

test("questsDroppingCurrency lists main drops only, REC-descending, no all-covering; card 4 keeps them", async () => {
  const { questsDroppingCurrency, byRecommendLv } = await import("../src/scripts/event-shop-farm-controls.js");
  const ids = [94160901, 94160902, 94160903];
  const listed = (currencyId) => questsDroppingCurrency(B_FARM, { id: currencyId }, ids).map((quest) => quest.questId);
  assert.deepEqual(
    listed(94160901),
    [94161103, 94161100],
    "Lv 75 then 70 — 牛追い/分け合い hold only secondary cookies",
  );
  assert.deepEqual(
    listed(94160902),
    [94161104, 94161101],
    "donut mains — 誓い/父と子 are donut mains but all-covering",
  );
  assert.deepEqual(listed(94160903), [94161105, 94161102], "pie mains — ここ掘れ/妙案奇案 hold only secondary pies");
  const covering = EventShop.allCoveringQuests(B_FARM, ids)
    .slice()
    .sort(byRecommendLv)
    .map((quest) => quest.questId);
  assert.deepEqual(covering, [94161108, 94161107], "90++ then 90+ — the all-covering quests are exactly card 4's list");
  assert.deepEqual(
    questsDroppingCurrency(C_FARM, { id: 94164000 }, [94164000, 94164001, 94164002]).map((quest) => quest.questId),
    [94164100],
    "80639: no all-covering to exclude, and 槍's MISO is only a secondary — だるま is the sole main",
  );
});

/* Amendment O: cards 1-to-3 never list a quest whose card currency is a secondary drop. The three
   80639 quests each hand a second currency to a neighbour, so every card keeps exactly one entry. */
test("questsDroppingCurrency excludes secondary drops (Amendment O)", async () => {
  const { questsDroppingCurrency } = await import("../src/scripts/event-shop-farm-controls.js");
  const ids = [94164000, 94164001, 94164002];
  const listed = (currencyId) => questsDroppingCurrency(C_FARM, { id: currencyId }, ids).map((quest) => quest.questId);
  assert.deepEqual(listed(94164000), [94164100], "MISO card lists だるま, not 槍 — MISO is 槍's secondary");
  assert.deepEqual(listed(94164001), [94164101], "ネギ card lists こんにゃく, not だるま — ネギ is だるま's secondary");
  assert.deepEqual(listed(94164002), [94164102], "YAKI card lists 槍, not こんにゃく — YAKI is こんにゃく's secondary");
});

test("defaultCurrencyQuest is the best-rate non-all-covering dropper — the card default and the optimizer share it", () => {
  const ids = [94160901, 94160902, 94160903];
  assert.equal(EventShop.defaultCurrencyQuest(B_FARM, ids, 94160901), 94161103, "ここ掘れ tops cookies");
  assert.equal(EventShop.defaultCurrencyQuest(B_FARM, ids, 94160902), 94161104, "妙案奇案 tops donuts");
  assert.equal(EventShop.defaultCurrencyQuest(B_FARM, ids, 94160903), 94161105, "牛追い tops pies");
  assert.equal(EventShop.defaultCurrencyQuest(B_FARM, ids, 4242), null, "no dropper, no default");
  assert.equal(
    EventShop.defaultCurrencyQuest(C_FARM, [94164000, 94164001, 94164002], 94164000),
    94164100,
    "no all-covering quests: 80639 defaults are unchanged",
  );
  const coveringOnlyFarm = {
    quests: [B_QUESTS.find((quest) => quest.questId === 94161108)],
    best: {},
  };
  assert.equal(
    EventShop.defaultCurrencyQuest(coveringOnlyFarm, ids, 94160903),
    null,
    "only 誓い drops pies — exclusion leaves nothing",
  );
  assert.equal(
    EventShop.defaultCurrencyQuest(coveringOnlyFarm, [], 94160903),
    94161108,
    "an empty currency list excludes nothing — the card fallback shows the best dropper",
  );
});

/* Amendment Q2 re-pinned what the no-priority plan may include: the exact search prices the FULL
   quest set — an all-covering quest IS farmable, and the oracle's minimum counts it (the shipped
   QA oracle fuzz asserts exact minima with priority null). What stays pinned here: the priority
   scan still excludes card 4's quest from its top-ups (the third assertion), and that exclusion
   keeps ruling the cards' dropdowns (defaultCurrencyQuest, untouched domain rules). The old
   assertion that a no-priority plan of this farm played two single-currency quests instead of one
   all-covering run priced the greedy walk's top-up heuristic, not the minimum — the greedy answer
   survives as the incumbent only while the search cannot beat it. */
test("an all-covering quest never tops up inside the priority scan, and prices into the exact no-priority minimum", () => {
  const farm = {
    quests: [
      {
        questId: 1,
        questName: "general",
        recommendLv: "90++",
        ap: 40,
        sampleRuns: 1,
        drops: { 1: { dropExpected: 10, num: 3 }, 2: { dropExpected: 10, num: 3 } },
      },
      {
        questId: 2,
        questName: "bronze",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 1,
        drops: { 1: { dropExpected: 5, num: 3 } },
      },
      {
        questId: 3,
        questName: "silver",
        recommendLv: "70",
        ap: 40,
        sampleRuns: 1,
        drops: { 2: { dropExpected: 5, num: 3 } },
      },
    ],
    best: { 1: 1, 2: 1 },
  };
  const base = { totals: { 1: 30, 2: 30 }, held: {}, bonus: {}, farm, trades: [], currencyIds: [1, 2] };
  assert.deepEqual(
    runsOf(EventShop.farmPlan({ ...base, priorityQuestId: null })),
    { 1: 1 },
    "the exact minimum prices the 30/run all-covering quest at one run — betterPlan keeps that, not the greedy 2+2",
  );
  assert.deepEqual(
    runsOf(EventShop.farmPlan({ ...base, priorityQuestId: null, currencyQuest: { 1: 1, 2: 1 } })),
    { 1: 1 },
    "a selection naming the all-covering quest farms through it: the M6 farmer rule keeps every other quest out",
  );
  assert.deepEqual(
    runsOf(EventShop.farmPlan({ ...base, priorityQuestId: 1 })),
    { 1: 1 },
    "as the 3-in-1 card's priority quest it still farms every currency in one run",
  );
});

test("Event 80632 honors user-selected all-drop quest (90++, 90+, Lv.50) and finds optimum under 100ms", () => {
  const e80632 = EVENT_SHOP_DATA.events.find((e) => e.event.id === 80632);
  assert.ok(e80632, "event 80632 snapshot present");
  const totals = EventShop.totals(e80632.items, EventShop.clearRequires(e80632.items));
  const cases = [
    { priorityQuestId: null, totalPlays: 166, runs: { 94162811: 161, 94162809: 5 } },
    { priorityQuestId: 94162811, totalPlays: 166, runs: { 94162811: 161, 94162809: 5 } },
    { priorityQuestId: 94162810, totalPlays: 200, runs: { 94162810: 197, 94162809: 3 } },
    { priorityQuestId: 94162803, totalPlays: 296, runs: { 94162809: 107, 94162807: 99, 94162808: 89, 94162803: 1 } },
  ];
  for (const expected of cases) {
    const start = performance.now();
    const plan = EventShop.farmPlan({
      totals,
      farm: e80632.farm,
      trades: e80632.trades,
      priorityQuestId: expected.priorityQuestId,
    });
    const elapsedMs = performance.now() - start;
    assert.equal(plan.totalPlays, expected.totalPlays);
    assert.deepEqual(runsOf(plan), expected.runs);
    assert.ok(elapsedMs < 100, `priority ${expected.priorityQuestId} took ${elapsedMs.toFixed(1)}ms`);
  }
});

test("Event 80632 tie-breaks equal-play mixes to least surplus on 2000/6000/6000", () => {
  const e80632 = EVENT_SHOP_DATA.events.find((e) => e.event.id === 80632);
  assert.ok(e80632, "event 80632 snapshot present");
  const plan = EventShop.farmPlan({
    totals: { 94162301: 2000, 94162302: 6000, 94162303: 6000 },
    farm: e80632.farm,
    trades: e80632.trades,
    priorityQuestId: 94162811,
  });
  assert.equal(plan.totalPlays, 178);
  assert.deepEqual(runsOf(plan), { 94162811: 169, 94162809: 8, 94162808: 1 });
});

test("Calculator.calcOptimalRuns finds minimum legacy runs and handles large deficits", () => {
  const dropRates = {
    bronze: { primary: { tier: "bronze", rate: 10 }, secondary: { tier: "silver", rate: 8 } },
    silver: { primary: { tier: "silver", rate: 10 }, secondary: { tier: "gold", rate: 8 } },
    gold: { primary: { tier: "gold", rate: 10 }, secondary: { tier: "bronze", rate: 8 } },
  };
  const balanced = Calculator.calcOptimalRuns({ bronze: 80, silver: 80, gold: 80 }, dropRates);
  assert.equal(balanced.error, undefined);
  assert.equal(balanced.warning, undefined);
  assert.equal(balanced.runs.bronze + balanced.runs.silver + balanced.runs.gold, 14);
  assert.ok(balanced.runs.bronze * 10 + balanced.runs.gold * 8 >= 80);
  assert.ok(balanced.runs.silver * 10 + balanced.runs.bronze * 8 >= 80);
  assert.ok(balanced.runs.gold * 10 + balanced.runs.silver * 8 >= 80);

  const large = Calculator.calcOptimalRuns({ bronze: 200000, silver: 0, gold: 0 }, dropRates);
  assert.equal(large.warning, undefined);
  assert.deepEqual(large.runs, { bronze: 20000, silver: 0, gold: 0 });
});

test("App.onFarmQuestChanged hides visible results instead of auto-calculating", async () => {
  await plannerWith(fakeStorage());
  const classes = new Set(["visible"]);
  const resultsEl = {
    classList: {
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "results" ? resultsEl : null),
  };
  try {
    const { App } = await import("../src/scripts/event-shop.js");
    const originalCalculate = App._calculateFarm;
    let calculateCalls = 0;
    App._calculateFarm = () => {
      calculateCalls += 1;
    };
    try {
      App.onFarmQuestChanged();
      assert.equal(resultsEl.classList.contains("visible"), false);
      assert.equal(calculateCalls, 0);
    } finally {
      App._calculateFarm = originalCalculate;
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("App.refreshNeeds hides visible results when shop item requirements change", async () => {
  await plannerWith(fakeStorage());
  const classes = new Set(["visible"]);
  const resultsEl = {
    classList: {
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "results" ? resultsEl : null),
    querySelectorAll: () => [],
  };
  try {
    const { App } = await import("../src/scripts/event-shop.js");
    App.state = {
      tiers: {
        bronze: { need: 0, have: 0, bonus: 0 },
        silver: { need: 0, have: 0, bonus: 0 },
        gold: { need: 0, have: 0, bonus: 0 },
      },
      baseDrop: 1,
      primaryMultiplier: 100,
      secondaryMultiplier: 100,
    };
    App.refreshNeeds();
    assert.equal(resultsEl.classList.contains("visible"), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("EventShopModal ignores backdrop mousedown and keeps modal open", async () => {
  const modalClasses = new Set(["open"]);
  const listeners = {};
  const modalEl = {
    classList: {
      add: (name) => modalClasses.add(name),
      remove: (name) => modalClasses.delete(name),
      contains: (name) => modalClasses.has(name),
    },
    addEventListener: (type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "eventShopModal" ? modalEl : null),
    addEventListener: () => {},
  };
  try {
    const { EventShopModal } = await import("../src/scripts/event-shop-modal.js");
    EventShopModal._bound = false;
    EventShopModal.configure({ itemsOf: () => [], requiresOf: () => ({}), currenciesOf: () => [], onCommit: () => {} });
    assert.equal(listeners.mousedown?.length || 0, 0);
    assert.equal(modalEl.classList.contains("open"), true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
