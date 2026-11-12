#!/usr/bin/env node
/**
 * scripts/test_event_shop_optimizer_oracle.js — QA Amendment L5/L8 math oracle.
 *
 * The shipped optimizer is EventShop.farmPlan (src/scripts/domain.js). This file never takes an
 * expected value from it: the minimum-play farm plan is computed here by EXHAUSTIVE integer search,
 * in units of 1e-4 of a currency (dropExpected carries 4 decimals, so every rate is an exact integer
 * and the search carries no floating-point slack). Contract pinned: Amendment L5/L8 — minimum total
 * quest plays, full secondary cross-credit, integer cascade trades, tie-breaks "least total surplus,
 * then least AP" — and the lead's frozen fixtures (80627: 142 plays no bonus / no trades = 113 誓い +
 * 29 牛追い; 104 plays trade-aware = 90 誓い + 14 牛追い with 16 cookie→donut + 202 donut→pie, 103
 * infeasible; 80639 shipped snapshot: 306 plays at needs 3000/4000/5000 — Amendment Q re-pin: this
 * file's own exhaustive kernel brute-forced 306; the "335" was the shipped greedy's overproduction,
 * never a minimum. The search here is unchanged).
 *
 * Every EventShop plan is also re-checked independently: its play vector is replayed through THIS
 * file's own integer yield + cascade arithmetic, so a plan that claims coverage it does not have is
 * caught even when its own reported figures look plausible.
 *
 * Run: node --test scripts/test_event_shop_optimizer_oracle.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventShop } from "../src/scripts/domain.js";

const SCALE = 10000; // 1 currency unit = 10^4 micro-units; dropExpected is 4dp, so rates are integers
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- the exhaustive kernel ---------- */

/* Integer per-run payout of one quest, in micro-units, per currency key. */
function intRates(quest, bonus) {
  const rates = {};
  for (const [key, drop] of Object.entries(quest.drops || {})) {
    const perRun = Math.round(drop.dropExpected * SCALE) * (drop.num + (Number(bonus[key]) || 0));
    if (perRun > 0) rates[key] = perRun;
  }
  return rates;
}

/* A quest fully replayed by another (>= every rate, no more AP) never lowers the minimum play count,
   so dominated quests leave the search without moving the answer. */
function nondominated(quests) {
  return quests.filter((b) => {
    const keysB = Object.keys(b.rates);
    if (!keysB.length) return false;
    return !quests.some(
      (a) =>
        a !== b &&
        a.ap <= b.ap &&
        keysB.every((k) => (a.rates[k] || 0) >= b.rates[k]) &&
        (keysB.some((k) => (a.rates[k] || 0) > b.rates[k]) || Object.keys(a.rates).length > keysB.length),
    );
  });
}

/* A plain integer trade chain (cost/get in micro-units) plus a bottom-up processing order. */
function buildKernel({ deficits, quests, trades }) {
  const keys = [...new Set([...Object.keys(deficits), ...quests.flatMap((q) => Object.keys(q.rates))])].sort(
    (a, b) => Number(a) - Number(b),
  );
  const index = new Map(keys.map((key, position) => [key, position]));
  const deficit = new Int32Array(keys.length);
  keys.forEach((key, position) => {
    deficit[position] = Math.round((deficits[key] || 0) * SCALE);
  });

  const edges = keys.map(() => []);
  for (const trade of trades || []) {
    const from = index.get(String(trade.fromId));
    const to = index.get(String(trade.toId));
    if (from === undefined || to === undefined || from === to) continue;
    edges[from].push({ to, cost: trade.costAmount * SCALE, get: trade.getNum * SCALE });
  }
  for (const list of edges) list.sort((a, b) => a.to - b.to);

  const indegree = new Int32Array(keys.length);
  edges.forEach((list, from) => {
    if (list.length) indegree[from] += 0;
    for (const edge of list) indegree[edge.to] += 1;
  });
  const order = [];
  const used = new Set();
  let ready = keys.map((_, position) => position).filter((position) => indegree[position] === 0);
  while (ready.length) {
    const position = ready.shift();
    order.push(position);
    used.add(position);
    for (const edge of edges[position]) {
      indegree[edge.to] -= 1;
      if (indegree[edge.to] === 0 && !used.has(edge.to)) ready.push(edge.to);
    }
    ready.sort((a, b) => a - b);
  }
  for (let position = 0; position < keys.length; position++) if (!order.includes(position)) order.push(position);

  const pool = nondominated(quests);
  const rateMatrix = pool.map((quest) => {
    const row = new Float64Array(keys.length);
    for (const [key, rate] of Object.entries(quest.rates)) row[index.get(key)] = rate;
    return row;
  });

  /* What can end up AT a currency: its own drops plus everything upstream that can be traded into it
     (transitively). Counting raw upstream units ignores the 10:1 loss, so it over-estimates — which is
     exactly what a prune needs: a branch this cuts could never have covered. */
  const upstream = keys.map((_, position) => {
    const set = new Set([position]);
    let grew = true;
    while (grew) {
      grew = false;
      edges.forEach((list, from) => {
        for (const edge of list)
          if (set.has(edge.to) && !set.has(from)) {
            set.add(from);
            grew = true;
          }
      });
    }
    return [...set];
  });
  return { keys, deficit, edges, order, pool, rateMatrix, upstream };
}

/* Apply the whole integer cascade over a yields vector (micro-units, mutated in place is avoided). */
function cascade(kernel, yields, tradeSink) {
  const inflow = new Float64Array(kernel.keys.length);
  const final = new Float64Array(kernel.keys.length);
  for (const position of kernel.order) {
    const avail = yields[position] + inflow[position];
    let free = avail - kernel.deficit[position];
    let spent = 0;
    for (const edge of kernel.edges[position]) {
      const times = Math.floor(Math.max(0, free) / edge.cost);
      if (times <= 0) continue;
      free -= times * edge.cost;
      spent += times * edge.cost;
      inflow[edge.to] += times * edge.get;
      if (tradeSink) tradeSink.push({ from: position, to: edge.to, times });
    }
    final[position] = avail - spent;
  }
  return final;
}

/* The best plan at one exact play total: every composition, ties resolved by the contract's
   least-total-surplus then least-AP order. */
function bestAtTotal(kernel, total) {
  const rowCount = kernel.rateMatrix.length;
  if (!rowCount) return null;
  const size = kernel.keys.length;
  const yields = new Float64Array(size);
  const runs = new Int32Array(rowCount);
  let best = null;

  /* suffixBest[row][currency] = the highest per-run rate for that currency among quests row..end. */
  const suffixBest = [];
  for (let row = 0; row <= rowCount; row++) suffixBest[row] = new Float64Array(size);
  for (let row = rowCount - 1; row >= 0; row--)
    for (let position = 0; position < size; position++)
      suffixBest[row][position] = Math.max(suffixBest[row + 1][position], kernel.rateMatrix[row][position]);

  /* A branch is hopeless when some currency cannot reach its deficit even with every upstream unit
     converted in at full value and the best remaining rate for every spare run. */
  const hopeless = (row, remaining) => {
    const bestRates = suffixBest[row];
    for (let position = 0; position < size; position++) {
      if (kernel.deficit[position] === 0) continue;
      let bound = 0;
      for (const source of kernel.upstream[position]) bound += yields[source] + remaining * bestRates[source];
      if (bound < kernel.deficit[position]) return true;
    }
    return false;
  };

  const finish = () => {
    const final = cascade(kernel, yields);
    let surplus = 0;
    for (let position = 0; position < size; position++) {
      const gap = final[position] - kernel.deficit[position];
      if (gap < 0) return;
      surplus += gap;
    }
    let ap = 0;
    for (let row = 0; row < rowCount; row++) ap += runs[row] * kernel.pool[row].ap;
    if (!best || surplus < best.surplus - 0.5 || (Math.abs(surplus - best.surplus) <= 0.5 && ap < best.ap))
      best = { runs: Array.from(runs), surplus, ap, final: Array.from(final) };
  };

  const applyRow = (row, value, sign) => {
    const base = kernel.rateMatrix[row];
    for (let position = 0; position < size; position++) yields[position] += sign * value * base[position];
  };

  const walk = (row, left) => {
    if (row === rowCount - 1) {
      runs[row] = left;
      applyRow(row, left, 1);
      finish();
      applyRow(row, left, -1);
      runs[row] = 0;
      return;
    }
    for (let value = left; value >= 0; value--) {
      const remaining = left - value;
      runs[row] = value;
      applyRow(row, value, 1);
      if (!hopeless(row + 1, remaining)) walk(row + 1, remaining);
      applyRow(row, value, -1);
    }
    runs[row] = 0;
  };
  walk(0, total);
  return best;
}

/* The oracle answer: the smallest total plays that covers, with its best tie-broken witness. */
function oraclePlan(input, upperBound = 400) {
  const kernel = buildKernel(input);
  for (let total = 0; total <= upperBound; total++) {
    const best = bestAtTotal(kernel, total);
    if (best) {
      const vector = {};
      best.runs.forEach((count, index) => {
        if (count) vector[kernel.pool[index].id] = count;
      });
      const yields = new Float64Array(kernel.keys.length);
      best.runs.forEach((count, index) => {
        if (!count) return;
        for (let position = 0; position < yields.length; position++) yields[position] += count * kernel.rateMatrix[index][position];
      });
      const sink = [];
      const final = cascade(kernel, yields, sink);
      return {
        total,
        vector,
        surplusUnits: best.surplus,
        ap: best.ap,
        finalUnits: Object.fromEntries(kernel.keys.map((key, position) => [key, final[position] / SCALE])),
        trades: sink.map((trade) => ({ fromId: Number(kernel.keys[trade.from]), toId: Number(kernel.keys[trade.to]), count: trade.times })),
        deficits: input.deficits,
        kernel,
      };
    }
  }
  return { total: null, vector: {}, finalUnits: {}, trades: [], deficits: input.deficits, kernel };
}

/* ---------- the app under test, and an independent re-check of whatever it returns ---------- */

function appPlan({ totals, held, bonus, farm, trades, priorityQuestId }) {
  return EventShop.farmPlan({ totals, held, bonus, farm, trades, priorityQuestId });
}

function appVector(plan) {
  const vector = {};
  for (const play of plan.plays) vector[play.questId] = play.runs;
  return vector;
}

/* Replay the app's own play vector through the oracle kernel: coverage, finals and total, none of it
   taken from the app's reported figures. */
function auditAppPlan(plan, input) {
  if (!plan || plan.totalPlays === null) return { feasible: false, short: [], total: null, finalUnits: {}, surplusUnits: null };
  const kernel = buildKernel(input);
  const positionById = new Map(kernel.pool.map((quest, index) => [quest.id, index]));
  const vector = appVector(plan);
  const yields = new Float64Array(kernel.keys.length);
  let total = 0;
  let unknown = 0;
  for (const [id, count] of Object.entries(vector)) {
    const index = positionById.get(Number(id));
    if (index === undefined) {
      unknown++;
      continue;
    }
    total += count;
    for (let position = 0; position < yields.length; position++) yields[position] += count * kernel.rateMatrix[index][position];
  }
  const final = cascade(kernel, yields);
  const short = [];
  let surplusUnits = 0;
  for (let position = 0; position < kernel.keys.length; position++) {
    const gap = final[position] - kernel.deficit[position];
    if (gap < -0.5) short.push(kernel.keys[position]);
    surplusUnits += Math.max(0, gap);
  }
  const finalUnits = Object.fromEntries(kernel.keys.map((key, position) => [key, final[position] / SCALE]));
  return { feasible: short.length === 0 && unknown === 0, short, total, finalUnits, surplusUnits, unknownQuests: unknown };
}

/* ---------- fixture data ---------- */

/* 80627 community figures, re-verified live against Atlas on 2026-11-12
   (GET /nice/JP/quest/{id}/1?lang=en): every dropExpected, num, runs, ap and recommendLv below
   matched the API response exactly. */
const B_QUESTS = [
  {
    questId: 94161100,
    questName: "パンプキン収穫 目で愛でファーム",
    recommendLv: "70",
    ap: 40,
    drops: { 94160901: { dropExpected: 10.9149, num: 3 }, 94160902: { dropExpected: 2.1379, num: 3 } },
  },
  {
    questId: 94161101,
    questName: "パンプキン収穫 ぷちぷちファーム",
    recommendLv: "70",
    ap: 40,
    drops: { 94160902: { dropExpected: 11.0189, num: 3 }, 94160903: { dropExpected: 2.205, num: 3 } },
  },
  {
    questId: 94161102,
    questName: "パンプキン収穫 分け合いファーム",
    recommendLv: "70",
    ap: 40,
    drops: { 94160901: { dropExpected: 2.2081, num: 3 }, 94160903: { dropExpected: 11.1421, num: 3 } },
  },
  {
    questId: 94161103,
    questName: "パンプキン収穫 ここ掘れファーム",
    recommendLv: "75",
    ap: 40,
    drops: { 94160901: { dropExpected: 14.4205, num: 3 }, 94160902: { dropExpected: 2.9394, num: 3 } },
  },
  {
    questId: 94161104,
    questName: "パンプキン収穫 妙案奇案ファーム",
    recommendLv: "80",
    ap: 40,
    drops: { 94160902: { dropExpected: 14.555, num: 3 }, 94160903: { dropExpected: 2.8828, num: 3 } },
  },
  {
    questId: 94161105,
    questName: "パンプキン収穫 牛追いファーム",
    recommendLv: "85",
    ap: 40,
    drops: { 94160901: { dropExpected: 2.8685, num: 3 }, 94160903: { dropExpected: 14.4954, num: 3 } },
  },
  {
    questId: 94161107,
    questName: "パンプキン収穫 父と子のファーム",
    recommendLv: "90+",
    ap: 40,
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
const COOKIE = "94160901";
const DONUT = "94160902";
const PIE = "94160903";
const B_NEEDS = { [COOKIE]: 4000, [DONUT]: 3000, [PIE]: 5000 };
const PRIORITY = 94161108;
const B_KEYS = [COOKIE, DONUT, PIE];

/* The shipped 80639 / 80632 snapshot — the same data module the site bundles. */
const dataSrc = fs
  .readFileSync(path.join(REPO, "src/scripts/data/event_shop.js"), "utf8")
  .replace(/^[\s\S]*?=\s*/, "")
  .replace(/;\s*$/, "");
const EVENTS = JSON.parse(dataSrc).events;
const snapshot = EVENTS.find((event) => event.event.id === 80639);
const PAST = EVENTS.find((event) => event.event.id === 80632);
const A_KEYS = snapshot.currencies.map((currency) => String(currency.id)).sort((a, b) => Number(a) - Number(b));

const intQuests = (quests, bonus) => quests.map((quest) => ({ id: quest.questId, ap: quest.ap, rates: intRates(quest, bonus) }));

/* ---------- the frozen fixtures ---------- */

test("L5 fixture A — 80627, priority 誓い, no bonus, no trades: minimum 142 plays, tie-break 113誓い + 29牛追い", () => {
  const input = { deficits: B_NEEDS, quests: intQuests(B_QUESTS, {}), trades: [] };
  const oracle = oraclePlan(input);
  assert.equal(oracle.total, 142, `oracle minimum ${oracle.total} (pool ${oracle.kernel.pool.map((q) => q.id)})`);
  assert.deepEqual(oracle.vector, { 94161108: 113, 94161105: 29 }, `least-surplus witness ${JSON.stringify(oracle.vector)}`);

  const plan = appPlan({ totals: B_NEEDS, held: {}, bonus: {}, farm: B_FARM, trades: [], priorityQuestId: PRIORITY });
  assert.equal(plan.totalPlays, 142, `EventShop found ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))}`);
  assert.deepEqual(appVector(plan), oracle.vector, "app vector must be the oracle's tie-broken optimum");
  const audit = auditAppPlan(plan, input);
  assert.equal(audit.feasible, true, `app plan leaves ${audit.short.join(",")} short under integer replay`);
  assert.equal(audit.total, plan.totalPlays, "reported totalPlays must equal Σ plays");
  assert.deepEqual(plan.trades, [], "no trades in this fixture");
  for (const key of B_KEYS) {
    assert.ok(Math.abs(plan.yields[key] - oracle.finalUnits[key]) < 1e-3, `${key} app ${plan.yields[key]} vs oracle ${oracle.finalUnits[key]}`);
    assert.ok(plan.surplus[key] >= 0, `${key} surplus ${plan.surplus[key]}`);
  }
});

test("L5/L8 fixture B — trade-aware bonus plan: 104 plays (90誓い + 14牛追い), 103 infeasible, 16 cookie→donut + 202 donut→pie", () => {
  const bonus = { [COOKIE]: 1, [DONUT]: 2, [PIE]: 1 };
  const input = { deficits: B_NEEDS, quests: intQuests(B_QUESTS, bonus), trades: B_TRADES };
  const oracle = oraclePlan(input, 120);
  assert.equal(oracle.total, 104, `oracle minimum ${oracle.total}`);

  /* Prove the floor: no 103-run split of the search pool covers, cascade included. */
  assert.equal(bestAtTotal(oracle.kernel, 103), null, "a 103-play plan exists — the contract floor is wrong");

  const plan = appPlan({ totals: B_NEEDS, held: {}, bonus, farm: B_FARM, trades: B_TRADES, priorityQuestId: PRIORITY });
  assert.equal(plan.totalPlays, 104, `EventShop found ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))}`);
  assert.deepEqual(appVector(plan), oracle.vector, `app vector ${JSON.stringify(appVector(plan))} vs oracle ${JSON.stringify(oracle.vector)}`);

  const tradesByKey = {};
  for (const trade of plan.trades) tradesByKey[`${trade.fromId}>${trade.toId}`] = trade.count;
  assert.equal(tradesByKey[`${COOKIE}>${DONUT}`], 16, `cookie→donut trades ${JSON.stringify(plan.trades)}`);
  assert.equal(tradesByKey[`${DONUT}>${PIE}`], 202, `donut→pie trades ${JSON.stringify(plan.trades)}`);

  const audit = auditAppPlan(plan, input);
  assert.equal(audit.feasible, true, `app plan leaves ${audit.short.join(",")} short under integer replay`);
  assert.equal(Math.round(audit.surplusUnits), Math.round(oracle.surplusUnits), "app surplus must equal the oracle's tie-broken surplus");
  for (const key of B_KEYS) {
    assert.ok(plan.yields[key] >= B_NEEDS[key] - 1e-6, `${key} final ${plan.yields[key]} below need ${B_NEEDS[key]}`);
    assert.ok(Math.abs(plan.yields[key] - oracle.finalUnits[key]) < 1e-3, `${key} app ${plan.yields[key]} vs oracle ${oracle.finalUnits[key]}`);
  }
  const surplusSum = Object.values(plan.surplus).reduce((sum, value) => sum + value, 0);
  assert.ok(surplusSum > 20 && surplusSum < 26, `total surplus ${surplusSum} — the frozen fixture says ~23`);
});

test("L5 fixture C — shipped 80639 snapshot, no all-covering quest, bonus 0, needs 3000/4000/5000 = 306 plays", () => {
  const needs = { [A_KEYS[0]]: 3000, [A_KEYS[1]]: 4000, [A_KEYS[2]]: 5000 };
  const input = { deficits: needs, quests: intQuests(snapshot.farm.quests, {}), trades: snapshot.trades };
  const oracle = oraclePlan(input, 360);
  assert.equal(oracle.total, 306, `oracle minimum for ${JSON.stringify(needs)} is ${oracle.total}`);

  const plan = appPlan({ totals: needs, held: {}, bonus: {}, farm: snapshot.farm, trades: snapshot.trades, priorityQuestId: null });
  assert.equal(plan.totalPlays, 306, `EventShop found ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))}`);
  const audit = auditAppPlan(plan, input);
  assert.equal(audit.feasible, true, `app plan leaves ${audit.short.join(",")} short under integer replay`);
  assert.deepEqual(appVector(plan), oracle.vector, `app ${JSON.stringify(appVector(plan))} vs oracle ${JSON.stringify(oracle.vector)}`);

  /* Every assignment of 3000/4000/5000 across the three currencies: app and oracle must agree. */
  for (const permutation of [
    [3000, 4000, 5000],
    [3000, 5000, 4000],
    [4000, 3000, 5000],
    [4000, 5000, 3000],
    [5000, 3000, 4000],
    [5000, 4000, 3000],
  ]) {
    const needsRow = { [A_KEYS[0]]: permutation[0], [A_KEYS[1]]: permutation[1], [A_KEYS[2]]: permutation[2] };
    const rowInput = { deficits: needsRow, quests: intQuests(snapshot.farm.quests, {}), trades: snapshot.trades };
    const mine = oraclePlan(rowInput, 400);
    const theirs = appPlan({ totals: needsRow, held: {}, bonus: {}, farm: snapshot.farm, trades: snapshot.trades, priorityQuestId: null });
    const rowAudit = auditAppPlan(theirs, rowInput);
    assert.equal(rowAudit.feasible, true, `needs ${JSON.stringify(needsRow)}: app plan leaves ${rowAudit.short.join(",")} short`);
    assert.equal(
      theirs.totalPlays,
      mine.total,
      `needs ${JSON.stringify(needsRow)}: EventShop ${theirs.totalPlays} vs oracle ${mine.total} (${JSON.stringify(appVector(theirs))} / ${JSON.stringify(mine.vector)})`,
    );
  }
});

test("L3/L4 conditional 4th card — 80639 has no all-covering quest, 80632 has exactly three", () => {
  const ids = snapshot.currencies.map((currency) => currency.id);
  assert.equal(EventShop.allCoveringQuests(snapshot.farm, ids).length, 0, "80639 must show 3 cards");
  assert.equal(EventShop.defaultFarmQuest(snapshot.farm, ids), null, "80639 has no farmQuest default");

  const pastIds = PAST.currencies.map((currency) => currency.id);
  const covering = EventShop.allCoveringQuests(PAST.farm, pastIds);
  assert.equal(covering.length, 3, `80632 all-covering quests ${covering.map((q) => q.questId).join(",")}`);
  const ranked = covering
    .map((quest) => ({
      id: quest.questId,
      total: Object.values(quest.drops).reduce((sum, drop) => sum + Math.round(drop.dropExpected * SCALE) * drop.num, 0),
    }))
    .sort((a, b) => b.total - a.total || a.id - b.id);
  assert.equal(EventShop.defaultFarmQuest(PAST.farm, pastIds), ranked[0].id, "default = highest total drop value");

  const everyQuest = PAST.farm.quests.map((quest) => quest.questId);
  assert.ok(covering.length < everyQuest.length, `80632 quests ${everyQuest.length}, all-covering ${covering.length}`);
  for (const quest of covering) for (const key of pastIds) assert.ok(quest.drops[String(key)], `quest ${quest.questId} lacks ${key}`);
});

/* Data-truth: the shipped snapshot's farm figures are the community numbers Atlas reports today. */
test("L2 sync data truth — 80639 quests match the cached Atlas drop rows", () => {
  const cache = path.join(REPO, ".cache/atlas");
  for (const quest of snapshot.farm.quests) {
    const file = path.join(cache, `nice_quest_${quest.questId}_1.json`);
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = (raw.drops || []).filter((drop) => quest.drops[String(drop.objectId)]);
    for (const row of rows) {
      const shipped = quest.drops[String(row.objectId)];
      assert.equal(shipped.num, row.num, `quest ${quest.questId} num drift`);
      assert.ok(
        Math.abs(shipped.dropExpected - Math.round(row.dropExpected * 1e4) / 1e4) < 1e-9,
        `quest ${quest.questId} item ${row.objectId}: shipped ${shipped.dropExpected} vs Atlas ${row.dropExpected}`,
      );
    }
    assert.equal(quest.ap, raw.consume, `quest ${quest.questId} ap drift`);
    assert.equal(quest.recommendLv, raw.recommendLv, `quest ${quest.questId} recommendLv drift`);
  }
  /* best[] must be the max dropExpected×num per currency, ties to the lower quest id. */
  for (const [key, questId] of Object.entries(snapshot.farm.best)) {
    const candidates = snapshot.farm.quests
      .filter((quest) => quest.drops[key])
      .map((quest) => ({ id: quest.questId, amount: quest.drops[key].dropExpected * quest.drops[key].num }))
      .sort((a, b) => b.amount - a.amount || a.id - b.id);
    assert.equal(questId, candidates[0].id, `best[${key}] should be ${candidates[0].id}`);
  }
});

/* ---------- fuzz: every small case checked against the exhaustive minimum ---------- */

test("oracle fuzz — 150 random plans: EventShop never under-covers and always hits the exact minimum", () => {
  let seed = 20261112;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const keys = ["10", "20", "30"];
  const gaps = [];
  let comparable = 0;
  for (let caseIndex = 0; caseIndex < 150; caseIndex++) {
    const questCount = 2 + Math.floor(rnd() * 3);
    const quests = [];
    for (let q = 0; q < questCount; q++) {
      const drops = {};
      for (const key of keys) if (rnd() < 0.55) drops[key] = { dropExpected: Math.round((1 + rnd() * 14) * 10000) / 10000, num: 3 };
      if (!Object.keys(drops).length) drops["10"] = { dropExpected: 5, num: 3 };
      quests.push({ questId: 1000 + q, questName: `q${q}`, recommendLv: "70", ap: 40, drops });
    }
    const farm = { quests, best: {} };
    for (const key of keys) {
      const candidates = quests.filter((quest) => quest.drops[key]);
      if (candidates.length)
        farm.best[key] = candidates
          .map((quest) => ({ id: quest.questId, amount: quest.drops[key].dropExpected * quest.drops[key].num }))
          .sort((a, b) => b.amount - a.amount || a.id - b.id)[0].id;
    }
    const useTrades = rnd() < 0.5;
    const trades = useTrades
      ? [
          { fromId: 10, toId: 20, costAmount: 10, getNum: 1 },
          { fromId: 20, toId: 30, costAmount: 10, getNum: 1 },
        ]
      : [];
    const needs = {};
    for (const key of keys) needs[key] = Math.floor(rnd() * 240) + 20;
    const bonus = { 10: Math.floor(rnd() * 3), 20: Math.floor(rnd() * 3), 30: Math.floor(rnd() * 3) };
    const allCovering = quests.filter((quest) => keys.every((key) => quest.drops[key]));
    const priority = rnd() < 0.5 && allCovering.length ? allCovering[0].questId : null;
    const input = { deficits: needs, quests: intQuests(quests, bonus), trades };
    const context = `case ${caseIndex} needs ${JSON.stringify(needs)} bonus ${JSON.stringify(bonus)} trades ${useTrades} priority ${priority}`;

    const mine = oraclePlan(input, 120);
    const theirs = appPlan({ totals: needs, held: {}, bonus, farm, trades, priorityQuestId: priority });

    if (mine.total === null) {
      if (theirs.totalPlays !== null) {
        const audit = auditAppPlan(theirs, input);
        assert.equal(
          audit.feasible,
          true,
          `${context}: oracle proves nothing ≤120 covers; EventShop claims ${theirs.totalPlays} plays (${JSON.stringify(appVector(theirs))}) leaving ${audit.short.join(",")} short`,
        );
        assert.ok(theirs.totalPlays > 120, `${context}: EventShop found ${theirs.totalPlays} the oracle's 120 bound missed`);
      }
      continue;
    }
    comparable++;
    const audit = auditAppPlan(theirs, input);
    assert.notEqual(theirs.totalPlays, null, `${context}: oracle covers in ${mine.total}, EventShop reports infeasible`);
    assert.equal(audit.feasible, true, `${context}: app plan leaves ${audit.short.join(",")} short under integer replay`);
    assert.equal(audit.total, theirs.totalPlays, `${context}: Σ plays ${audit.total} != reported totalPlays ${theirs.totalPlays}`);
    for (const key of keys) assert.ok(theirs.yields[key] + 1e-6 >= needs[key], `${context}: ${key} final ${theirs.yields[key]} below need ${needs[key]}`);
    if (theirs.totalPlays !== mine.total) gaps.push(`${context}: EventShop ${theirs.totalPlays} vs minimum ${mine.total}`);
    else if (Math.round(audit.surplusUnits) !== Math.round(mine.surplusUnits))
      gaps.push(`${context}: same ${mine.total} plays but surplus ${audit.surplusUnits} vs least ${mine.surplusUnits}`);
  }
  assert.ok(comparable >= 80, `only ${comparable} fuzz cases produced a comparable plan`);
  assert.deepEqual(gaps, [], `sub-optimal plans found:\n${gaps.join("\n")}`);
});
