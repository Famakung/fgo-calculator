/**
 * scripts/event_shop_oracle_kernel.js — the exhaustive-integer oracle kernel of
 * test_event_shop_optimizer_oracle.js, EXTRACTED verbatim so repro/verification scripts
 * (test_event_shop_overfarm_r30.js) import the SAME reference the frozen oracle runs.
 * Pure move: every function body below is byte-identical to the oracle's originals; the
 * oracle file imports these bindings and its 7 tests must stay green exactly as before.
 *
 * NEVER take an expected value from the app here: this is the independent reference.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventShop } from "../src/scripts/domain.js";

export const SCALE = 10000; // 1 currency unit = 10^4 micro-units; dropExpected is 4dp, so rates are integers
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- the exhaustive kernel ---------- */

/* Integer per-run payout of one quest, in micro-units, per currency key. */
export function intRates(quest, bonus) {
  const rates = {};
  for (const [key, drop] of Object.entries(quest.drops || {})) {
    const perRun = Math.round(drop.dropExpected * SCALE) * (drop.num + (Number(bonus[key]) || 0));
    if (perRun > 0) rates[key] = perRun;
  }
  return rates;
}

/* A quest fully replayed by another (>= every rate, no more AP) never lowers the minimum play count,
   so dominated quests leave the search without moving the answer. */
export function nondominated(quests) {
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
export function buildKernel({ deficits, quests, trades }) {
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
export function cascade(kernel, yields, tradeSink) {
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
export function bestAtTotal(kernel, total) {
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
export function oraclePlan(input, upperBound = 400) {
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
        for (let position = 0; position < yields.length; position++)
          yields[position] += count * kernel.rateMatrix[index][position];
      });
      const sink = [];
      const final = cascade(kernel, yields, sink);
      return {
        total,
        vector,
        surplusUnits: best.surplus,
        ap: best.ap,
        finalUnits: Object.fromEntries(kernel.keys.map((key, position) => [key, final[position] / SCALE])),
        trades: sink.map((trade) => ({
          fromId: Number(kernel.keys[trade.from]),
          toId: Number(kernel.keys[trade.to]),
          count: trade.times,
        })),
        deficits: input.deficits,
        kernel,
      };
    }
  }
  return { total: null, vector: {}, finalUnits: {}, trades: [], deficits: input.deficits, kernel };
}

/* ---------- the app under test, and an independent re-check of whatever it returns ---------- */

export function appPlan({ totals, held, bonus, farm, trades, priorityQuestId, currencyQuest, currencyIds }) {
  return EventShop.farmPlan({ totals, held, bonus, farm, trades, priorityQuestId, currencyQuest, currencyIds });
}

export function appVector(plan) {
  const vector = {};
  for (const play of plan.plays) vector[play.questId] = play.runs;
  return vector;
}

/* Replay the app's own play vector through the oracle kernel: coverage, finals and total, none of it
   taken from the app's reported figures. */
export function auditAppPlan(plan, input) {
  if (!plan || plan.totalPlays === null)
    return { feasible: false, short: [], total: null, finalUnits: {}, surplusUnits: null };
  const kernel = buildKernel(input);
  const index = new Map(kernel.keys.map((key, position) => [key, position]));
  const questById = new Map(input.quests.map((quest) => [quest.id, quest]));
  const vector = appVector(plan);
  const yields = new Float64Array(kernel.keys.length);
  let total = 0;
  let unknown = 0;
  for (const [id, count] of Object.entries(vector)) {
    const quest = questById.get(Number(id));
    if (!quest) {
      unknown++;
      continue;
    }
    total += count;
    for (const [key, rate] of Object.entries(quest.rates || {})) {
      const position = index.get(key);
      if (position !== undefined) yields[position] += count * rate;
    }
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
  return {
    feasible: short.length === 0 && unknown === 0,
    short,
    total,
    finalUnits,
    surplusUnits,
    unknownQuests: unknown,
  };
}

/* Micro-integer raw drops of the app's OWN play vector — this file's intRates over the input quest
   data, never plan.farmed. Null when a card names a quest the inputs do not have (caller fails). */
const cnt = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function rawMicroOfPlan(quests, bonus, plan) {
  const byId = new Map(quests.map((q) => [String(q.questId), q]));
  const raw = {};
  for (const play of plan.plays || []) {
    const quest = byId.get(String(play.questId));
    if (!quest) return null;
    const rates = intRates(quest, bonus);
    for (const [key, value] of Object.entries(rates)) raw[key] = cnt(raw[key]) + play.runs * value;
  }
  return raw;
}

export const intQuests = (quests, bonus) =>
  quests.map((quest) => ({ id: quest.questId, ap: quest.ap, rates: intRates(quest, bonus) }));

/* ---------- shipped data access (the same module the site bundles) ---------- */

export function loadEvents(repoDir = REPO) {
  const dataSrc = fs
    .readFileSync(path.join(repoDir, "src/scripts/data/event_shop.js"), "utf8")
    .replace(/^[\s\S]*?=\s*/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(dataSrc).events;
}

export const EVENTS = loadEvents();
export const snapshot = EVENTS.find((event) => event.event.id === 80639);
export const PAST = EVENTS.find((event) => event.event.id === 80632);
export const A_KEYS = snapshot.currencies.map((currency) => String(currency.id)).sort((a, b) => Number(a) - Number(b));
