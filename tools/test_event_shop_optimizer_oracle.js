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
 * infeasible; 80639 shipped snapshot: 263 plays at needs 3000/4000/5000 — Amendment Q re-pin
 * brute-forced 306 on the pre-sync data; the owner-ordered 2026-11-12 Atlas refetch moved 80639's
 * community drops and this file's OWN exhaustive kernel re-derived 263 (133×94164102 + 83×94164104 +
 * 47×94164103, zero cascade trades, 262 proven infeasible) on the fresh data module — sanctioned data
 * drift, not a code change; the "335" was the shipped greedy's overproduction, never a minimum. The
 * search here is unchanged).
 *
 * Amendment R22 (minimum-cover trades): the REPORTED trade list is no longer the full cascade. The
 * play search above still prices coverage with the whole cascade (that is what keeps the play count
 * provably minimal), but the trade OUTPUT is re-derived here independently of the app's seed-then-trim
 * algorithm: requirement propagation top-down the chain (each tier demands exactly ceil(shortfall/get)
 * from below, a source owes its own deficit plus the cost of what it sells), cross-checked by a
 * bounded brute-force minimum and a sequential integer micro replay that proves coverage AND
 * affordability of the reported list on every fixture and every fuzz case. Fixture B re-pins to the
 * minimum-cover answer: ONE trade card donut→pie ×196 (pie 4,804.7544 short of 5,000 → ceil 196;
 * donut 5,011.965 − 1,960 = 3,051.965 ≥ 3,000, so the cookie→donut row empties), finals
 * 4,168.444 / 3,051.965 / 5,000.7544, reported surplus 168.444 / 51.965 / 0.7544 (Σ 221.1634).
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
/* The exhaustive kernel, the app-plan audit and the shipped-data access live in
   scripts/test_event_shop_oracle_kernel.js (verbatim extract, shared with the R30 over-farm repro
   script). The kernel bodies were moved without edits; these bindings are this file's own
   oracle — nothing here takes an expected value from the app. */
import {
  SCALE,
  intRates,
  buildKernel,
  cascade,
  bestAtTotal,
  oraclePlan,
  appPlan,
  appVector,
  auditAppPlan,
  rawMicroOfPlan,
  intQuests,
  EVENTS,
  snapshot,
  PAST,
  A_KEYS,
} from "./test_event_shop_oracle_kernel.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- Amendment R22: INDEPENDENT minimum-cover trade oracle ---------- */

/* This block must NOT copy the app. The shipped minCoverTrades (domain.js, R22) SEEDS the full
   cascade row-by-row and then TRIMS top-down, dropping floor(slack/get) per row. The oracle here
   derives the same answer from the opposite direction — REQUIREMENT PROPAGATION: the chain top
   demands exactly what it lacks, each demand is paid downward in ceil(shortfall/get) whole trades,
   and a source must cover its own deficit PLUS the cost of everything it sells. On a linear chain
   that is provably the global minimum: the top row needs >= ceil(its own short/get) trades because
   nothing else feeds it, and every row below inherits a demand that only grows with the row above,
   so the per-row ceils are simultaneously minimal and feasible. The brute-force enumeration below
   checks the same statement by exhaustion on small cases, and a sequential integer replay checks
   coverage + affordability on every case. The app's figure must equal the propagated figure or the
   app either under-covers or wastes trades — a real defect either way. */

/* The same validity reading as the frozen tradeChain contract (not re-litigated): a row joins the
   chain only when both ids are finite numbers, from != to, cost > 0 and get > 0. Keys stay VERBATIM
   strings (the app indexes its chain by String(id)), so a trade id of "01" is its own zero-drop node
   here exactly as there. Invalid rows are dropped — and the audit separately proves the app never
   reports a trade on an invalid pair. */
const cnt = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function validEdges(trades) {
  const edges = [];
  for (const trade of Array.isArray(trades) ? trades : []) {
    const fromKey = trade && trade.fromId;
    const toKey = trade && trade.toId;
    if (fromKey === undefined || fromKey === null || fromKey === "") continue;
    if (toKey === undefined || toKey === null || toKey === "") continue;
    if (!Number.isFinite(Number(fromKey)) || !Number.isFinite(Number(toKey))) continue;
    if (String(fromKey) === String(toKey)) continue;
    if (!(cnt(trade.costAmount) > 0) || !(cnt(trade.getNum) > 0)) continue;
    edges.push({
      fromKey: String(fromKey),
      toKey: String(toKey),
      cost: Math.round(cnt(trade.costAmount) * SCALE),
      get: Math.round(cnt(trade.getNum) * SCALE),
    });
  }
  return edges;
}

/* Shape of a valid-edge set, used to pick the minimality check (never the coverage check):
   linear  — every node has in-degree ≤ 1 AND out-degree ≤ 1, no duplicate pair, acyclic by shape.
   branching — acyclic but some node has in-degree or out-degree > 1 (the app's documented
   row-by-row trim shortcut: per-row tight, may sit above the global minimum).
   cyclic  — a directed cycle among valid edges (invalid shop data the validator rejects; only the
   coverage/affordability replay runs). */
function chainShape(edges) {
  // cycle first (Kahn): cyclic data is invalid-shop territory and earns only the coverage replay —
  // neither the linear propagation nor the branching tightness argument holds on a cycle.
  {
    const indeg = {};
    const nodes = new Set();
    for (const e of edges) {
      nodes.add(e.fromKey);
      nodes.add(e.toKey);
      indeg[e.toKey] = cnt(indeg[e.toKey]) + 1;
    }
    const outMap = {};
    for (const e of edges) (outMap[e.fromKey] = outMap[e.fromKey] || []).push(e);
    const queue = [...nodes].filter((n) => !cnt(indeg[n]));
    const seen = new Set();
    while (queue.length) {
      const n = queue.shift();
      if (seen.has(n)) continue;
      seen.add(n);
      for (const e of outMap[n] || []) if (--indeg[e.toKey] <= 0) queue.push(e.toKey);
    }
    if (seen.size !== nodes.size) return "cyclic";
  }
  const inn = {};
  const out = {};
  const seen = new Set();
  for (const e of edges) {
    if (seen.has(`${e.fromKey}>${e.toKey}`)) return "branching"; // duplicate pair: two rows, row-by-row
    seen.add(`${e.fromKey}>${e.toKey}`);
    inn[e.toKey] = (inn[e.toKey] || 0) + 1;
    out[e.fromKey] = (out[e.fromKey] || 0) + 1;
  }
  const nodes = new Set([...Object.keys(inn), ...Object.keys(out)]);
  for (const n of nodes) if ((inn[n] || 0) > 1 || (out[n] || 0) > 1) return "branching";
  return "linear";
}

/* Bottom-up Kahn node order over the valid edges (ids ascending at every choice point, cycle
   leftovers last), mirroring the shape of the shop's row order — used only for OUTPUT order and
   affordable-walk enumeration; every coverage number is order-independent at the end stack. */
function bottomUpOrder(edges, keys) {
  const sorted = [...keys].sort((a, b) => Number(a) - Number(b));
  const indeg = {};
  for (const e of edges) indeg[e.toKey] = cnt(indeg[e.toKey]) + 1;
  const outMap = {};
  for (const e of edges) (outMap[e.fromKey] = outMap[e.fromKey] || []).push(e);
  const queue = sorted.filter((n) => !cnt(indeg[n]));
  const seen = new Set();
  const order = [];
  while (queue.length) {
    queue.sort((a, b) => Number(a) - Number(b));
    const n = queue.shift();
    if (seen.has(n)) continue;
    seen.add(n);
    order.push(n);
    for (const e of outMap[n] || []) if (--indeg[e.toKey] <= 0) queue.push(e.toKey);
  }
  for (const n of sorted) if (!seen.has(n)) order.push(n);
  return order;
}

/* Requirement propagation over a LINEAR edge set: returns { trades, finalMicro } or null when the
   shape is not linear (caller falls back to replay + brute force). Trades are aggregated per pair in
   chain order bottom-up, in the { fromId, toId, count } shape the results card consumes. */
function minCoverPropagate(rawMicro, deficitsMicro, edges, allKeys) {
  if (chainShape(edges) !== "linear") return null;
  const settled = new Set();
  const tradesByEdge = {};
  const outOf = {};
  for (const e of edges) outOf[e.fromKey] = e;
  let progress = true;
  while (progress) {
    progress = false;
    for (const e of edges) {
      if (settled.has(e)) continue;
      const downstream = outOf[e.toKey];
      if (downstream && !settled.has(downstream)) continue; // wait until the dest's own sale is known
      const obligation = downstream
        ? (tradesByEdge[downstream.fromKey + ">" + downstream.toKey] || 0) * downstream.cost
        : 0;
      const need = cnt(deficitsMicro[e.toKey]) + obligation - cnt(rawMicro[e.toKey]);
      tradesByEdge[e.fromKey + ">" + e.toKey] = Math.max(0, Math.ceil(need / e.get));
      settled.add(e);
      progress = true;
    }
    if (!progress && settled.size < edges.length) return null; // cycle among "linear" — refuse
  }
  const finalMicro = {};
  for (const key of allKeys) finalMicro[key] = cnt(rawMicro[key]);
  const position = {};
  bottomUpOrder(edges, allKeys).forEach((key, index) => {
    position[key] = index;
  });
  const trades = [];
  for (const e of [...edges].sort(
    (a, b) => position[a.fromKey] - position[b.fromKey] || Number(a.toKey) - Number(b.toKey),
  )) {
    const n = tradesByEdge[e.fromKey + ">" + e.toKey] || 0;
    if (n <= 0) continue;
    finalMicro[e.toKey] = cnt(finalMicro[e.toKey]) + n * e.get;
    finalMicro[e.fromKey] = cnt(finalMicro[e.fromKey]) - n * e.cost;
    trades.push({ fromId: Number(e.fromKey), toId: Number(e.toKey), count: n });
  }
  return { trades, finalMicro };
}

/* Sequential integer replay of ONE trade list: rows execute in list order, a source pays from what it
   holds at that moment (raw drops plus arrivals already made), and the run ends with the final stacks.
   This is the coverage oracle: never under-covers means final ≥ deficit for every key AND every step
   affordable. Returns { ok, reason, final }. */
function replayTradeList(rawMicro, deficitsMicro, reported, edges) {
  const stack = {};
  for (const key of Object.keys(rawMicro)) stack[key] = cnt(rawMicro[key]);
  // Number-based pair resolution: identical to the results renderer's resolveTradeRatio, so the
  // reported { fromId: Number(key) } rows resolve exactly as the card resolves them.
  const ratio = (fromId, toId) =>
    edges.find((e) => Number(e.fromKey) === Number(fromId) && Number(e.toKey) === Number(toId));
  for (const row of reported) {
    const e = ratio(row.fromId, row.toId);
    if (!e)
      return { ok: false, reason: `reported trade ${row.fromId}→${row.toId} is not a valid shop row`, final: stack };
    if (!(row.count > 0))
      return { ok: false, reason: `reported trade ${row.fromId}→${row.toId} carries count ${row.count}`, final: stack };
    const cost = row.count * e.cost;
    if (cnt(stack[e.fromKey]) < cost)
      return {
        ok: false,
        reason: `unaffordable: ${e.fromKey} holds ${cnt(stack[e.fromKey])} micro, ${row.count} trades cost ${cost}`,
        final: stack,
      };
    stack[e.fromKey] = cnt(stack[e.fromKey]) - cost;
    stack[e.toKey] = cnt(stack[e.toKey]) + row.count * e.get;
  }
  for (const key of Object.keys(deficitsMicro)) {
    if (cnt(stack[key]) < cnt(deficitsMicro[key]))
      return {
        ok: false,
        reason: `${key} ends at ${cnt(stack[key])} micro below deficit ${cnt(deficitsMicro[key])}`,
        final: stack,
      };
  }
  return { ok: true, reason: "", final: stack };
}

/* Brute-force global minimum trade count over every whole-count combination the source stacks could
   ever afford (cap: raw + every possible arrival, spent bottom-up in chain order). Returns
   { min, checked } or null when the space exceeds the budget (caller records the skip). */
function bruteForceMinCount(rawMicro, deficitsMicro, edges, orderKeys) {
  if (!edges.length) return { min: 0, checked: 1 };
  /* A GENEROUS spend budget per node — its raw drops plus everything it could ever receive, relaxed
     to a fixed point (a source converts at most floor(budget/cost) trades, worth ×get). Under-capping
     would prune a feasible combination and over-estimate the minimum, manufacturing a phantom
     defect; over-capping only enumerates combinations the real replay inside the walk then rejects
     on affordability, so the answer stays honest. Cycles inflate the budget, the 80-cap bites, the
     space guard trips and the brute force simply skips. */
  const budget = {};
  for (const key of orderKeys) budget[key] = cnt(rawMicro[key]);
  for (let pass = 0; pass <= edges.length; pass++) {
    const add = {};
    for (const e of edges) add[e.toKey] = cnt(add[e.toKey]) + Math.floor(cnt(budget[e.fromKey]) / e.cost) * e.get;
    for (const key of Object.keys(add)) budget[key] = Math.max(cnt(budget[key]), cnt(rawMicro[key]) + cnt(add[key]));
  }
  const caps = edges.map((e) => Math.min(400, Math.floor(cnt(budget[e.fromKey]) / e.cost)));
  let space = 1;
  for (const c of caps) {
    space *= c + 1;
    if (space > 250000) return null;
  }
  let min = null;
  let checked = 0;
  const counts = edges.map(() => 0);
  // Bottom-up Kahn order over the edge graph (ids ascending at choices): a source's rows must be
  // priced AFTER its own arrivals, or an affordable plan looks unaffordable and the enumeration
  // reports a minimum that is too high — a phantom defect waiting to fire.
  const flowOrder = bottomUpOrder(edges, orderKeys);
  const walk = (index, total) => {
    if (index === edges.length) {
      checked++;
      if (min !== null && total >= min) return;
      const rows = edges
        .map((e, i) => ({ fromKey: e.fromKey, toKey: e.toKey, count: counts[i], e }))
        .filter((r) => r.count > 0); // each enumerated row carries ITS edge's cost/get — a duplicated pair prices on its own figures
      const stack = {};
      for (const key of flowOrder) stack[key] = cnt(rawMicro[key]);
      for (const key of flowOrder) {
        for (const r of rows) {
          if (r.fromKey !== key) continue;
          if (cnt(stack[key]) < r.count * r.e.cost) return;
          stack[key] -= r.count * r.e.cost;
          stack[r.toKey] = cnt(stack[r.toKey]) + r.count * r.e.get;
        }
      }
      for (const key of flowOrder) if (cnt(stack[key]) < cnt(deficitsMicro[key])) return;
      min = total;
      return;
    }
    for (let n = 0; n <= caps[index]; n++) {
      counts[index] = n;
      walk(index + 1, total + n);
    }
    counts[index] = 0;
  };
  walk(0, 0);
  return { min, checked };
}

/* One-stop audit of an app plan's REPORTED trades against the independent derivations:
   (a) coverage + affordability + the plan's own yields/farmed/surplus figures — every shape;
   (b) minimality — linear: exact equality with requirement propagation AND the brute-force count;
       branching: per-row tightness (the trim cannot leave slack ≥ get on any row it trimmed) plus
       app count ≥ brute force (the documented shortcut may sit above the global minimum — exceeding
       even a tight row-by-row result is a defect); cyclic/invalid: coverage only. */
function auditMinCover(plan, rawMicro, deficitsUnits, tradeInput, context) {
  const notes = [];
  const edges = validEdges(tradeInput);
  const deficitsMicro = {};
  for (const [key, value] of Object.entries(deficitsUnits || {})) deficitsMicro[key] = Math.round(cnt(value) * SCALE);
  const keys = [
    ...new Set([...Object.keys(rawMicro || {}), ...Object.keys(deficitsMicro), ...Object.keys(plan.yields || {})]),
  ].sort((a, b) => Number(a) - Number(b));
  const reported = plan.trades || [];
  const replay = replayTradeList(rawMicro, deficitsMicro, reported, edges);
  assert.ok(replay.ok, `${context}: reported trades fail coverage/affordability — ${replay.reason}`);
  for (const key of keys) {
    const wantUnits = Math.round((cnt(replay.final[key]) / SCALE) * 1e6) / 1e6;
    assert.ok(
      Math.abs(cnt(plan.yields[key]) - wantUnits) < 1e-6,
      `${context}: plan.yields[${key}] ${plan.yields[key]} != replayed final ${wantUnits}`,
    );
    const farmedUnits = Math.round((cnt(rawMicro[key]) / SCALE) * 1e6) / 1e6;
    assert.ok(
      Math.abs(cnt(plan.farmed[key]) - farmedUnits) < 1e-6,
      `${context}: plan.farmed[${key}] ${plan.farmed[key]} != raw drops ${farmedUnits} (R22 keeps farmed = raw)`,
    );
    const wantSurplus = Math.max(
      0,
      Math.round(((cnt(replay.final[key]) - cnt(deficitsMicro[key])) / SCALE) * 1e6) / 1e6,
    );
    assert.ok(
      Math.abs(cnt(plan.surplus[key]) - wantSurplus) < 1e-6,
      `${context}: plan.surplus[${key}] ${plan.surplus[key]} != replayed slack ${wantSurplus}`,
    );
  }
  const shape = chainShape(edges);
  const appTotal = reported.reduce((sum, t) => sum + t.count, 0);
  if (shape === "linear") {
    const prop = minCoverPropagate(rawMicro, deficitsMicro, edges, keys);
    assert.ok(prop, `${context}: propagation refused a linear shape`);
    const got = reported.map((t) => `${t.fromId}>${t.toId}:${t.count}`).join("|");
    const want = prop.trades.map((t) => `${t.fromId}>${t.toId}:${t.count}`).join("|");
    assert.equal(got, want, `${context}: app trades != requirement propagation`);
    for (const key of keys)
      assert.ok(
        Math.abs(cnt(plan.yields[key]) - Math.round((cnt(prop.finalMicro[key]) / SCALE) * 1e6) / 1e6) < 1e-6,
        `${context}: plan.yields[${key}] != propagated final`,
      );
    const brute = bruteForceMinCount(rawMicro, deficitsMicro, edges, keys);
    if (brute && brute.min !== null)
      assert.equal(
        appTotal,
        brute.min,
        `${context}: app trade count ${appTotal} above the brute-force minimum ${brute.min}`,
      );
    else notes.push("brute space skipped (linear)");
    // single-trade-removal property: dropping ONE trade from any row must break coverage (linear minimum)
    for (let i = 0; i < reported.length; i++) {
      const thinner = reported.map((t, j) => (j === i ? { ...t, count: t.count - 1 } : t)).filter((t) => t.count > 0);
      const broke = replayTradeList(rawMicro, deficitsMicro, thinner, edges);
      assert.equal(
        broke.ok,
        false,
        `${context}: removing one trade from row ${reported[i].fromId}→${reported[i].toId} still covers — the row is over-allocated`,
      );
    }
  } else if (shape === "branching") {
    // the accepted shortcut: per-row tightness, never a row the trim should have cut further.
    // A pair the shop lists TWICE keeps two rows the reported list cannot name apart — its slack
    // bound belongs to whichever row was trimmed last, so those rows are covered by coverage +
    // the brute lower bound only (recorded, never silently passed).
    const pairCount = {};
    for (const e of edges) {
      const k = `${Number(e.fromKey)}>${Number(e.toKey)}`;
      pairCount[k] = (pairCount[k] || 0) + 1;
    }
    for (const row of reported) {
      const k = `${Number(row.fromId)}>${Number(row.toId)}`;
      if (pairCount[k] > 1) {
        notes.push(`tightness skipped on duplicated pair ${k}`);
        continue;
      }
      const e = edges.find((x) => Number(x.fromKey) === Number(row.fromId) && Number(x.toKey) === Number(row.toId));
      const slack = cnt(replay.final[e.toKey]) - cnt(deficitsMicro[e.toKey]);
      assert.ok(
        slack < e.get,
        `${context}: branching row ${row.fromId}→${row.toId} leaves slack ${slack} >= get ${e.get} — the app exceeded even its row-by-row trim`,
      );
    }
    const brute = bruteForceMinCount(rawMicro, deficitsMicro, edges, keys);
    if (brute && brute.min !== null) {
      assert.ok(
        appTotal >= brute.min,
        `${context}: app count ${appTotal} below brute force ${brute.min} — brute bound wrong`,
      );
      if (appTotal > brute.min) notes.push(`shortcut slack ${appTotal - brute.min} over brute min ${brute.min}`);
    } else notes.push("brute space skipped (branching)");
  } else notes.push("cyclic: coverage-only audit");
  return { shape, appTotal, notes };
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

/* ---------- the frozen fixtures ---------- */

test("L5 fixture A — 80627, priority 誓い, no bonus, no trades: minimum 142 plays, tie-break 113誓い + 29牛追い", () => {
  const input = { deficits: B_NEEDS, quests: intQuests(B_QUESTS, {}), trades: [] };
  const oracle = oraclePlan(input);
  assert.equal(oracle.total, 142, `oracle minimum ${oracle.total} (pool ${oracle.kernel.pool.map((q) => q.id)})`);
  assert.deepEqual(
    oracle.vector,
    { 94161108: 113, 94161105: 29 },
    `least-surplus witness ${JSON.stringify(oracle.vector)}`,
  );

  const plan = appPlan({ totals: B_NEEDS, held: {}, bonus: {}, farm: B_FARM, trades: [], priorityQuestId: PRIORITY });
  assert.equal(plan.totalPlays, 142, `EventShop found ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))}`);
  assert.deepEqual(appVector(plan), oracle.vector, "app vector must be the oracle's tie-broken optimum");
  const audit = auditAppPlan(plan, input);
  assert.equal(audit.feasible, true, `app plan leaves ${audit.short.join(",")} short under integer replay`);
  assert.equal(audit.total, plan.totalPlays, "reported totalPlays must equal Σ plays");
  assert.deepEqual(plan.trades, [], "no trades in this fixture");
  auditMinCover(plan, rawMicroOfPlan(B_QUESTS, {}, plan), B_NEEDS, [], "fixture A");
  for (const key of B_KEYS) {
    assert.ok(
      Math.abs(plan.yields[key] - oracle.finalUnits[key]) < 1e-3,
      `${key} app ${plan.yields[key]} vs oracle ${oracle.finalUnits[key]}`,
    );
    assert.ok(plan.surplus[key] >= 0, `${key} surplus ${plan.surplus[key]}`);
  }
});

test("L5/L8/R22 fixture B — trade-aware bonus plan: 104 plays (90誓い + 14牛追い), 103 infeasible, minimum-cover trades = donut→pie ×196 only", () => {
  const bonus = { [COOKIE]: 1, [DONUT]: 2, [PIE]: 1 };
  const input = { deficits: B_NEEDS, quests: intQuests(B_QUESTS, bonus), trades: B_TRADES };
  const oracle = oraclePlan(input, 120);
  assert.equal(oracle.total, 104, `oracle minimum ${oracle.total}`);

  /* Prove the floor: no 103-run split of the search pool covers, cascade included. */
  assert.equal(bestAtTotal(oracle.kernel, 103), null, "a 103-play plan exists — the contract floor is wrong");

  /* R22: the oracle's OWN minimum-cover trades, propagated from the oracle's winning play vector —
     never from the app and never from the cascade. pie is 5,000 − 4,804.7544 = 195.2456 short →
     ceil 196 donut→pie; donut then holds 5,011.965 − 1,960 = 3,051.965 ≥ 3,000, so the cookie→donut
     row is not needed at all. */
  const deficitsMicro = Object.fromEntries(B_KEYS.map((key) => [key, Math.round(B_NEEDS[key] * SCALE)]));
  const oracleRaw = {};
  for (const key of B_KEYS) oracleRaw[key] = 0;
  for (const [id, runs] of Object.entries(oracle.vector)) {
    const row = oracle.kernel.pool.findIndex((quest) => String(quest.id) === String(id));
    assert.ok(row >= 0, `oracle vector names quest ${id} outside its own pool`);
    B_KEYS.forEach((key, position) => {
      oracleRaw[key] += runs * oracle.kernel.rateMatrix[row][position];
    });
  }
  const minCover = minCoverPropagate(oracleRaw, deficitsMicro, validEdges(B_TRADES), B_KEYS);
  assert.ok(minCover, "fixture B trades are a linear chain — propagation must answer");
  assert.deepEqual(
    minCover.trades,
    [{ fromId: Number(DONUT), toId: Number(PIE), count: 196 }],
    `propagated minimum-cover trades ${JSON.stringify(minCover.trades)}`,
  );
  assert.equal(minCover.finalMicro[COOKIE], 41684440, "cookie final micro");
  assert.equal(minCover.finalMicro[DONUT], 30519650, "donut final micro");
  assert.equal(minCover.finalMicro[PIE], 50007544, "pie final micro");

  const plan = appPlan({ totals: B_NEEDS, held: {}, bonus, farm: B_FARM, trades: B_TRADES, priorityQuestId: PRIORITY });
  assert.equal(plan.totalPlays, 104, `EventShop found ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))}`);
  assert.deepEqual(
    appVector(plan),
    oracle.vector,
    `app vector ${JSON.stringify(appVector(plan))} vs oracle ${JSON.stringify(oracle.vector)}`,
  );

  /* R22 app-vs-oracle: the app reports the MINIMUM cover, the cookie→donut cascade row is GONE. */
  assert.deepEqual(
    plan.trades,
    [{ fromId: Number(DONUT), toId: Number(PIE), count: 196 }],
    `app trades ${JSON.stringify(plan.trades)}`,
  );

  const audit = auditAppPlan(plan, input);
  assert.equal(audit.feasible, true, `app plan leaves ${audit.short.join(",")} short under integer replay`);
  assert.equal(
    Math.round(audit.surplusUnits),
    Math.round(oracle.surplusUnits),
    "app surplus must equal the oracle's tie-broken surplus",
  );
  const raw = rawMicroOfPlan(B_QUESTS, bonus, plan);
  assert.ok(raw, "app play cards name a quest the fixture does not have");
  assert.deepEqual(
    auditMinCover(plan, raw, B_NEEDS, B_TRADES, "fixture B"),
    { shape: "linear", appTotal: 196, notes: [] },
    "fixture B min-cover audit",
  );
  assert.equal(plan.yields[COOKIE], 4168.444, `cookie final ${plan.yields[COOKIE]}`);
  assert.equal(plan.yields[DONUT], 3051.965, `donut final ${plan.yields[DONUT]}`);
  assert.equal(plan.yields[PIE], 5000.7544, `pie final ${plan.yields[PIE]}`);
  for (const key of B_KEYS) assert.ok(plan.yields[key] >= B_NEEDS[key] - 1e-6, `${key} final below need`);
  assert.equal(plan.surplus[COOKIE], 168.444, `cookie surplus ${plan.surplus[COOKIE]}`);
  assert.equal(plan.surplus[DONUT], 51.965, `donut surplus ${plan.surplus[DONUT]}`);
  assert.equal(plan.surplus[PIE], 0.7544, `pie surplus ${plan.surplus[PIE]}`);
  const surplusSum = Object.values(plan.surplus).reduce((sum, value) => sum + value, 0);
  assert.ok(
    Math.abs(surplusSum - 221.1634) < 1e-6,
    `total surplus ${surplusSum} — R22 minimum-cover fixture says 221.1634`,
  );
});

/* 2026-11-14 live sync re-pin: quest 94164105 unlocked on 80639 (L2 data-truth passes against the
   fresh cache rows) and THIS file's exhaustive kernel below re-derived the minimum as 229 — the
   old 263 literal is what the pre-94164105 drops produced. Never guessed, never taken from
   EventShop: oracle.total and the vector both come from oraclePlan on the fresh module. */
test("L5 fixture C — shipped 80639 snapshot, no all-covering quest, bonus 0, needs 3000/4000/5000 = 229 plays", () => {
  const needs = { [A_KEYS[0]]: 3000, [A_KEYS[1]]: 4000, [A_KEYS[2]]: 5000 };
  const input = { deficits: needs, quests: intQuests(snapshot.farm.quests, {}), trades: snapshot.trades };
  const oracle = oraclePlan(input, 360);
  assert.equal(oracle.total, 229, `oracle minimum for ${JSON.stringify(needs)} is ${oracle.total}`);

  const plan = appPlan({
    totals: needs,
    held: {},
    bonus: {},
    farm: snapshot.farm,
    trades: snapshot.trades,
    priorityQuestId: null,
  });
  assert.equal(plan.totalPlays, 229, `EventShop found ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))}`);
  const audit = auditAppPlan(plan, input);
  assert.equal(audit.feasible, true, `app plan leaves ${audit.short.join(",")} short under integer replay`);
  assert.deepEqual(
    appVector(plan),
    oracle.vector,
    `app ${JSON.stringify(appVector(plan))} vs oracle ${JSON.stringify(oracle.vector)}`,
  );

  /* R22: the 229-play optimum trades 60 Silver → 6 Gold (minimum cover audited independently below
     through replay + propagation on the linear chain 94164000→94164001→94164002, 10:1). */
  assert.deepEqual(
    plan.trades,
    [{ fromId: Number(A_KEYS[1]), toId: Number(A_KEYS[2]), count: 6 }],
    `R22 trades on the 229-play optimum ${JSON.stringify(plan.trades)}`,
  );
  const cRaw = rawMicroOfPlan(snapshot.farm.quests, {}, plan);
  assert.ok(cRaw, "app play cards name a quest the snapshot does not have");
  auditMinCover(plan, cRaw, needs, snapshot.trades, "fixture C");

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
    const theirs = appPlan({
      totals: needsRow,
      held: {},
      bonus: {},
      farm: snapshot.farm,
      trades: snapshot.trades,
      priorityQuestId: null,
    });
    const rowAudit = auditAppPlan(theirs, rowInput);
    assert.equal(
      rowAudit.feasible,
      true,
      `needs ${JSON.stringify(needsRow)}: app plan leaves ${rowAudit.short.join(",")} short`,
    );
    assert.equal(
      theirs.totalPlays,
      mine.total,
      `needs ${JSON.stringify(needsRow)}: EventShop ${theirs.totalPlays} vs oracle ${mine.total} (${JSON.stringify(appVector(theirs))} / ${JSON.stringify(mine.vector)})`,
    );
    if (theirs.totalPlays !== null) {
      const rowRaw = rawMicroOfPlan(snapshot.farm.quests, {}, theirs);
      assert.ok(rowRaw, `needs ${JSON.stringify(needsRow)}: app plan names a quest outside the snapshot`);
      const rowCover = auditMinCover(
        theirs,
        rowRaw,
        needsRow,
        snapshot.trades,
        `fixture C permutation ${JSON.stringify(needsRow)}`,
      );
      if (rowCover.notes.length)
        console.log(`[min-cover] permutation ${JSON.stringify(needsRow)}: ${rowCover.notes.join("; ")}`);
    }
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
      total: Object.values(quest.drops).reduce(
        (sum, drop) => sum + Math.round(drop.dropExpected * SCALE) * drop.num,
        0,
      ),
    }))
    .sort((a, b) => b.total - a.total || a.id - b.id);
  assert.equal(EventShop.defaultFarmQuest(PAST.farm, pastIds), ranked[0].id, "default = highest total drop value");

  const everyQuest = PAST.farm.quests.map((quest) => quest.questId);
  assert.ok(covering.length < everyQuest.length, `80632 quests ${everyQuest.length}, all-covering ${covering.length}`);
  for (const quest of covering)
    for (const key of pastIds) assert.ok(quest.drops[String(key)], `quest ${quest.questId} lacks ${key}`);
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
  const notes = [];
  let comparable = 0;
  for (let caseIndex = 0; caseIndex < 150; caseIndex++) {
    const questCount = 2 + Math.floor(rnd() * 3);
    const quests = [];
    for (let q = 0; q < questCount; q++) {
      const drops = {};
      for (const key of keys)
        if (rnd() < 0.55) drops[key] = { dropExpected: Math.round((1 + rnd() * 14) * 10000) / 10000, num: 3 };
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
    const bonusQuests = intQuests(quests, bonus);
    const coveringIds = new Set(allCovering.map((quest) => quest.questId));
    const topUpQuests = bonusQuests.filter((quest) => !coveringIds.has(quest.id));
    const selectedIds = new Set();
    for (const key of keys) {
      const topUpOpts = topUpQuests.filter((quest) => (quest.rates[key] || 0) > 0);
      const opts = topUpOpts.length ? topUpOpts : bonusQuests.filter((quest) => (quest.rates[key] || 0) > 0);
      if (opts.length) {
        opts.sort((a, b) => b.rates[key] - a.rates[key] || a.id - b.id);
        selectedIds.add(opts[0].id);
      }
    }
    const defaultAllDrop = allCovering.length
      ? [...allCovering].sort(
          (a, b) =>
            Object.values(b.drops).reduce((s, d) => s + d.dropExpected * d.num, 0) -
              Object.values(a.drops).reduce((s, d) => s + d.dropExpected * d.num, 0) || a.questId - b.questId,
        )[0].questId
      : null;
    const pickedAllDrop = priority !== null ? priority : defaultAllDrop;
    if (pickedAllDrop !== null) selectedIds.add(pickedAllDrop);
    const selectedQuests = bonusQuests.filter((quest) => selectedIds.has(quest.id));
    const input = { deficits: needs, quests: bonusQuests, trades };
    const context = `case ${caseIndex} needs ${JSON.stringify(needs)} bonus ${JSON.stringify(bonus)} trades ${useTrades} priority ${priority}`;

    const mine = oraclePlan({ deficits: needs, quests: selectedQuests, trades }, 120);
    const theirs = appPlan({ totals: needs, held: {}, bonus, farm, trades, priorityQuestId: priority });

    if (mine.total === null) {
      if (theirs.totalPlays !== null) {
        const audit = auditAppPlan(theirs, input);
        assert.equal(
          audit.feasible,
          true,
          `${context}: oracle proves nothing ≤120 covers; EventShop claims ${theirs.totalPlays} plays (${JSON.stringify(appVector(theirs))}) leaving ${audit.short.join(",")} short`,
        );
        assert.ok(
          theirs.totalPlays > 120,
          `${context}: EventShop found ${theirs.totalPlays} the oracle's 120 bound missed`,
        );
        const bigRaw = rawMicroOfPlan(quests, bonus, theirs);
        assert.ok(bigRaw, `${context}: plan names a quest the case does not have`);
        auditMinCover(theirs, bigRaw, needs, trades, `${context} (above the 120 bound)`);
      }
      continue;
    }
    comparable++;
    const audit = auditAppPlan(theirs, input);
    assert.notEqual(
      theirs.totalPlays,
      null,
      `${context}: oracle covers in ${mine.total}, EventShop reports infeasible`,
    );
    assert.equal(
      audit.feasible,
      true,
      `${context}: app plan leaves ${audit.short.join(",")} short under integer replay`,
    );
    assert.equal(
      audit.total,
      theirs.totalPlays,
      `${context}: Σ plays ${audit.total} != reported totalPlays ${theirs.totalPlays}`,
    );
    for (const key of keys)
      assert.ok(
        theirs.yields[key] + 1e-6 >= needs[key],
        `${context}: ${key} final ${theirs.yields[key]} below need ${needs[key]}`,
      );
    // R22: the REPORTED trade list must be the minimum cover of these very drops, replay-verified.
    const fuzzRaw = rawMicroOfPlan(quests, bonus, theirs);
    assert.ok(fuzzRaw, `${context}: plan names a quest the case does not have`);
    const cover = auditMinCover(theirs, fuzzRaw, needs, trades, context);
    if (cover.notes.length) notes.push(`${context}: ${cover.notes.join("; ")}`);
    if (theirs.totalPlays !== mine.total)
      gaps.push(`${context}: EventShop ${theirs.totalPlays} vs minimum ${mine.total}`);
    else if (Math.round(audit.surplusUnits) !== Math.round(mine.surplusUnits))
      gaps.push(`${context}: same ${mine.total} plays but surplus ${audit.surplusUnits} vs least ${mine.surplusUnits}`);
  }
  assert.ok(comparable >= 80, `only ${comparable} fuzz cases produced a comparable plan`);
  assert.deepEqual(gaps, [], `sub-optimal plans found:\n${gaps.join("\n")}`);
  if (notes.length) console.log(`[min-cover fuzz notes]\n${notes.join("\n")}`);
});

/* ---------- R22: min-cover trade fuzz — every chain shape against the independent derivations ---- */

test("R22 min-cover fuzz — linear, branching, cycles, zero-cost, duplicate pairs, hostile ids: coverage, affordability and the independent minimum", () => {
  let seed = 20261113;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const intUpTo = (n) => Math.floor(rnd() * n);
  const RATIOS = [
    [10, 1],
    [5, 1],
    [3, 1],
    [1, 1],
    [2, 5],
    [1, 10],
    [7, 3],
  ];
  const JUNK_TRADES = [
    { fromId: "__proto__", toId: 20, costAmount: 10, getNum: 1 },
    { fromId: 10, toId: "", costAmount: 10, getNum: 1 },
    { fromId: null, toId: 20, costAmount: 10, getNum: 1 },
    { fromId: undefined, toId: 30, costAmount: 5, getNum: 1 },
    { fromId: 10, toId: 10, costAmount: 4, getNum: 1 }, // self-conversion
    { fromId: 10, toId: 20, costAmount: 0, getNum: 1 }, // zero cost
    { fromId: 20, toId: 30, costAmount: 10, getNum: 0 }, // zero get
    { fromId: "abc", toId: 30, costAmount: 10, getNum: 1 }, // non-numeric id
    { fromId: 30, toId: 20, costAmount: -5, getNum: 1 }, // negative cost
  ];
  const shapes = {
    linear2: (r) => [{ fromId: 10, toId: 20, costAmount: r[0], getNum: r[1] }],
    linear3: (r, s) => [
      { fromId: 10, toId: 20, costAmount: r[0], getNum: r[1] },
      { fromId: 20, toId: 30, costAmount: s[0], getNum: s[1] },
    ],
    branchIn: (r) => [
      { fromId: 10, toId: 30, costAmount: r[0], getNum: r[1] },
      { fromId: 20, toId: 30, costAmount: r[0], getNum: r[1] },
    ],
    branchOut: (r) => [
      { fromId: 10, toId: 20, costAmount: r[0], getNum: r[1] },
      { fromId: 10, toId: 30, costAmount: r[0], getNum: r[1] },
    ],
    cycle: (r) => [
      { fromId: 10, toId: 20, costAmount: r[0], getNum: r[1] },
      { fromId: 20, toId: 10, costAmount: r[0], getNum: r[1] },
      { fromId: 20, toId: 30, costAmount: r[0], getNum: r[1] },
    ],
    duplicatePair: (r) => [
      { fromId: 10, toId: 20, costAmount: r[0], getNum: r[1] },
      { fromId: 10, toId: 20, costAmount: 20, getNum: 1 },
      { fromId: 20, toId: 30, costAmount: r[0], getNum: r[1] },
    ],
    hostileExtras: (r, s) => [...shapes.linear3(r, s), ...JUNK_TRADES],
    allInvalid: () => [
      { fromId: 10, toId: 20, costAmount: 0, getNum: 1 },
      { fromId: "nope", toId: 30, costAmount: 10, getNum: 1 },
      { fromId: 20, toId: 20, costAmount: 5, getNum: 2 },
    ],
  };
  const keysByShape = { branchIn: ["10", "20", "30"], branchOut: ["10", "20", "30"], cycle: ["10", "20", "30"] };
  const stats = { plans: 0, infeasible: 0, withTrades: 0 };
  const perShape = {};
  const gaps = [];
  const notes = [];
  for (const [shapeName, makeTrades] of Object.entries(shapes)) {
    perShape[shapeName] = { plans: 0, infeasible: 0, withTrades: 0 };
    for (let caseIndex = 0; caseIndex < 60; caseIndex++) {
      const keys = keysByShape[shapeName] || ["10", "20", "30"];
      const questCount = 2 + intUpTo(2);
      const quests = [];
      for (let q = 0; q < questCount; q++) {
        const drops = {};
        for (const key of keys)
          if (rnd() < 0.6) drops[key] = { dropExpected: Math.round((1 + rnd() * 14) * 10000) / 10000, num: 3 };
        if (!Object.keys(drops).length) drops[keys[0]] = { dropExpected: 5, num: 3 };
        quests.push({ questId: 2000 + q, questName: `${shapeName}q${q}`, recommendLv: "70", ap: 40, drops });
      }
      const farm = { quests, best: {} };
      for (const key of keys) {
        const candidates = quests.filter((quest) => quest.drops[key]);
        if (candidates.length)
          farm.best[key] = candidates
            .map((quest) => ({ id: quest.questId, amount: quest.drops[key].dropExpected * quest.drops[key].num }))
            .sort((a, b) => b.amount - a.amount || a.id - b.id)[0].id;
      }
      const trades = makeTrades(RATIOS[intUpTo(RATIOS.length)], RATIOS[intUpTo(RATIOS.length)]);
      const needs = {};
      for (const key of keys) needs[key] = 40 + intUpTo(200);
      const bonus = {};
      for (const key of keys) bonus[key] = intUpTo(3);
      const context = `${shapeName}#${caseIndex} needs ${JSON.stringify(needs)} bonus ${JSON.stringify(bonus)}`;
      const theirs = appPlan({ totals: needs, held: {}, bonus, farm, trades, priorityQuestId: null });
      perShape[shapeName].plans++;
      stats.plans++;
      if (theirs.totalPlays === null) {
        assert.deepEqual(theirs.trades, [], `${context}: infeasible plan still carries trades`);
        perShape[shapeName].infeasible++;
        stats.infeasible++;
        continue;
      }
      const raw = rawMicroOfPlan(quests, bonus, theirs);
      assert.ok(raw, `${context}: plan names a quest the case does not have`);
      const cover = auditMinCover(theirs, raw, needs, trades, context);
      if (cover.appTotal > 0) {
        perShape[shapeName].withTrades++;
        stats.withTrades++;
      }
      for (const note of cover.notes) notes.push(`${context}: ${note} (${cover.shape})`);
      // reported trades must reference ONLY valid shop pairs (hostile/invalid rows never appear)
      for (const t of theirs.trades) {
        const valid = validEdges(trades).some(
          (e) => Number(e.fromKey) === Number(t.fromId) && Number(e.toKey) === Number(t.toId),
        );
        if (!valid) gaps.push(`${context}: reported trade ${t.fromId}→${t.toId} is not a valid shop row`);
      }
    }
  }
  // The corpus must actually exercise the trade paths — a silent all-infeasible fuzz proves nothing.
  assert.ok(stats.withTrades >= 60, `only ${stats.withTrades} audited plans carried trades — corpus too easy`);
  for (const shapeName of ["linear2", "linear3", "branchIn", "branchOut", "cycle", "duplicatePair", "hostileExtras"])
    assert.ok(
      perShape[shapeName].withTrades >= 4,
      `${shapeName}: only ${perShape[shapeName].withTrades} trade-carrying plans`,
    );
  assert.ok(
    perShape.allInvalid.plans === 60 && perShape.allInvalid.withTrades === 0,
    "allInvalid rows must never trade",
  );
  assert.deepEqual(gaps, [], `fuzz defects:\n${gaps.join("\n")}`);
  const noteKinds = {};
  for (const note of notes) {
    const kind = note.slice(note.indexOf(": ") + 2, note.indexOf(" (")).replace(/\d+(\.\d+)?/g, "#");
    noteKinds[kind] = (noteKinds[kind] || 0) + 1;
  }
  if (notes.length) console.log(`[R22 fuzz notes] ${JSON.stringify(noteKinds)} (first: ${notes[0]})`);
  console.log(
    `[R22 fuzz] plans ${stats.plans} infeasible ${stats.infeasible} with-trades ${stats.withTrades} notes ${notes.length}`,
  );
});

test("EventShop CE optimizer oracle audit on shipped 80639 and 80632 bonusCes", () => {
  for (const snap of [snapshot, PAST]) {
    const cids = snap.currencies.map((c) => String(c.id));
    const needs = Object.fromEntries(cids.map((cid, idx) => [cid, 3000 + idx * 1000]));
    const flatBonus = Object.fromEntries(cids.map((cid) => [cid, 1]));
    const ceById = new Map(snap.bonusCes.map((ce) => [ce.id, ce]));
    const ceOwned = Object.fromEntries(
      snap.bonusCes.map((ce, idx) => [ce.id, { limitBreak: idx + 1, nonLimitBreak: 2 }]),
    );
    for (const limit of [2, 6]) {
      const plan = EventShop.farmPlan({
        totals: needs,
        held: {},
        bonus: flatBonus,
        farm: snap.farm,
        trades: snap.trades,
        priorityQuestId: null,
        currencyIds: cids,
        bonusCes: snap.bonusCes,
        ceOwned,
        ceEquipLimit: limit,
      });
      assert.ok(plan.totalPlays > 0);
      const questById = new Map(snap.farm.quests.map((q) => [String(q.questId), q]));
      const rawMicro = {};
      const boostedQuests = [];
      for (const play of plan.plays) {
        let slots = 0;
        const effectiveBonus = { ...flatBonus };
        for (const entry of play.ceCombo) {
          slots += entry.limitBreak + entry.nonLimitBreak;
          const ce = ceById.get(entry.ceId);
          assert.ok(ce, `unknown CE ${entry.ceId}`);
          for (const [cid, spec] of Object.entries(ce.bonuses)) {
            effectiveBonus[cid] =
              (effectiveBonus[cid] || 0) + entry.limitBreak * spec.limitBreak + entry.nonLimitBreak * spec.nonLimitBreak;
          }
        }
        assert.ok(slots <= limit, `equipped ${slots} > limit ${limit}`);
        const q = questById.get(String(play.questId));
        assert.ok(q, `unknown quest ${play.questId}`);
        const [boosted] = intQuests([q], effectiveBonus);
        boostedQuests.push(boosted);
        for (const [key, rate] of Object.entries(boosted.rates)) {
          rawMicro[key] = (rawMicro[key] || 0) + play.runs * rate;
        }
      }
      const audit = auditAppPlan(plan, { deficits: needs, quests: boostedQuests, trades: snap.trades });
      assert.equal(audit.feasible, true, `${snap.event.id} limit ${limit} short: ${audit.short.join(",")}`);
      auditMinCover(plan, rawMicro, needs, snap.trades, `CE oracle ${snap.event.id} limit=${limit}`);
    }
  }
});
