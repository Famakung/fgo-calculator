#!/usr/bin/env node
/**
 * scripts/test_event_shop_overfarm_r30.js — R30 over-farm (too many runs) repro harness.
 *
 * Owner report: "over surplus on 3 card non-all drop quest is back" → TOO MANY RUNS: the app's
 * farmPlan.totalPlays EXCEEDS the independent oracle's exhaustive minimum play count on a
 * non-all-drop event (80639: every quest drops 2 of 3 currencies, no all-covering quest).
 *
 * Reference: scripts/test_event_shop_oracle_kernel.js — the frozen oracle's own kernel, extracted
 * verbatim (oracle suite stays 7/7). App plays > oracle minimum = over-farm. A play count the
 * oracle itself cannot reach is impossible: the oracle searches EVERY composition of the SAME
 * dominance pool the app audits against.
 *
 * Knobs swept (owner surface, event-shop.js _calculateFarm):
 *   S1  live 80639, priorityQuestId = each non-all-drop quest × need set (R30 core suspect)
 *   S2  + bonus variants
 *   S3  currencyQuest per-currency picks (default picks; contract note below)
 *   S4  held ≥ one currency (a key with no shortfall — the corpus never exercised this)
 *   S5  deterministic fuzz over non-all-drop shapes × needs × bonus × priority × picks × held
 *
 * M6 CONTRACT NOTE: a picked case is priced against the FARMER-RULE minimum — the exhaustive oracle
 * over exactly the quest set the M6 selection allows (pinnedPlan below, built from the kernel's own
 * dominance pool, never from the app). Amendment R30: a pick the search cannot honour (dominated out
 * of the pool, or a quest that does not even drop this currency) counts as unhonoured (no farmer pin,
 * no demotion — its currency keeps every dropper) and must cost no extra plays, so it cannot hide
 * behind "M6 latitude" any more. A gap against the farmer-rule minimum is
 * DEFECT-CANDIDATE (exit nonzero); a gap against the UNCONSTRAINED oracle that the farmer-rule
 * minimum explains is CONTRACT. Priority and held (with no picks) carry NO contract latitude: they
 * must equal the oracle. Picked cases WITH a priority quest keep the loose CONTRACT bucket — the
 * priority scan legitimately plays the priority quest outside the farmer-rule pool.
 *
 * Run: node scripts/test_event_shop_overfarm_r30.js          (prints the ledger, exits nonzero on any gap)
 *      node scripts/test_event_shop_overfarm_r30.js --stress  (widens the fuzz)
 */

import assert from "node:assert/strict";
import {
  intQuests,
  oraclePlan,
  buildKernel,
  appPlan,
  appVector,
  auditAppPlan,
  snapshot,
  A_KEYS,
} from "./test_event_shop_oracle_kernel.js";
import { EventShop } from "../src/scripts/domain.js";

/* ---------- the pinned farmer-rule space, priced by the FROZEN kernel ----------
   Amendment M6 lets a USABLE per-currency pick (a quest the dominance pool keeps) raise the minimum
   play count: that gap is CONTRACT. Amendment R30 says a pick the search cannot honour — a quest the
   pool drops, or one that does not even drop this currency — counts as unhonoured (no farmer pin, no
   demotion — its currency keeps every dropper) and must never cost an extra play. So the reference
   for a picked case is the exhaustive minimum over exactly the quest set
   the farmer rule allows, computed here from the frozen kernel's own pool (never from the app).
   Rules mirrored from the contract, domain.js exactPool/keyCandidates:
     farmer(key)  = the picked quest, only while it is in the dominance pool and drops this currency
     pinned key   = the farmer alone
     unhonoured   = every quest dropping the currency (greedy's best-rate fallback space, R30)
     unchosen     = every dropper except quests that also drop a currency farmed by another farmer */
function pinnedPlan(deficitQuests, deficits, picks, priority, bound) {
  const droppersOf = (key) => deficitQuests.filter((quest) => (quest.rates || {})[key] > 0);
  const eligible = new Set();
  for (const key of Object.keys(deficits).filter((short) => deficits[short] > 0)) {
    const options = droppersOf(key);
    if (!options.length) continue;
    const selected = picks ? picks[key] : null;
    const chosen =
      selected !== null && selected !== undefined
        ? options.find((quest) => String(quest.id) === String(selected))
        : null;
    const best =
      chosen ||
      options.reduce((a, b) =>
        (a.rates[key] || 0) !== (b.rates[key] || 0) ? (a.rates[key] > b.rates[key] ? a : b) : a.id <= b.id ? a : b,
      );
    eligible.add(best);
  }
  if (priority !== null && priority !== undefined) {
    const extra = deficitQuests.find((quest) => String(quest.id) === String(priority));
    if (extra) eligible.add(extra);
  }
  const poolQuests = deficitQuests.filter((quest) => eligible.has(quest));
  if (!poolQuests.length) return null;
  return oraclePlan({ deficits, quests: poolQuests, trades: snapshot.trades }, bound);
}

const QUEST_IDS = snapshot.farm.quests.map((quest) => quest.questId);
const TRADES = snapshot.trades;
const STRESS = process.argv.includes("--stress");
const ledger = [];
const gaps = [];
const contractGaps = [];

function runCase(
  label,
  { needs, bonus = {}, held = {}, priority = null, picks = null, oracleBound = 400, quests = snapshot.farm.quests },
) {
  /* same netting the app's planDeficits does — the oracle prices the SAME deficits object */
  const deficits = {};
  for (const key of new Set([...Object.keys(needs), ...Object.keys(held)]))
    deficits[key] = Math.max(0, (Number(needs[key]) || 0) - (Number(held[key]) || 0));
  const input = { deficits, quests: intQuests(quests, bonus), trades: TRADES };
  const oracle = oraclePlan(input, oracleBound);
  const plan = appPlan({
    totals: needs,
    held,
    bonus,
    farm: snapshot.farm,
    trades: TRADES,
    priorityQuestId: priority,
    currencyQuest: picks || {},
    currencyIds: snapshot.currencies.map((c) => c.id),
  });
  /* R30 reference: only for the no-priority picked surface — a priority quest legitimately plays its
     own quest outside the farmer-rule space, so picked+priority cases keep the loose CONTRACT bucket.
     Bound = the app's own answer: its play vector would itself witness a covering mix, so a null at
     that bound means the app played OUTSIDE the pool its picks allow, not that a bound ran out. */
  const pinned = pinnedPlan(input.quests, deficits, picks, priority, plan.totalPlays ?? oracleBound);
  const audit = auditAppPlan(plan, input);
  const total = plan.totalPlays;
  const row = {
    label,
    needs,
    bonus,
    held,
    priority,
    picks,
    oracle: oracle.total,
    pinned: pinned ? pinned.total : null,
    app: total,
    appVector: appVector(plan),
    oracleVector: oracle.vector,
    feasible: audit.feasible,
    gap: oracle.total !== null && total !== null ? total - oracle.total : null,
    pinnedGap: pinned && pinned.total !== null && total !== null ? total - pinned.total : null,
  };
  ledger.push(row);
  if (total !== null)
    assert.equal(audit.feasible, true, `${label}: app plan leaves ${audit.short.join(",")} short — separate defect`);
  if (row.pinnedGap !== null && row.pinnedGap > 0) {
    gaps.push(r30Entry(label, row, needs, bonus, held, `farmer-rule minimum ${row.pinned}`, row.pinnedGap));
    return row;
  }
  if (pinned && pinned.total === null && total !== null)
    gaps.push(r30Entry(label, row, needs, bonus, held, "no covering mix inside the farmer-rule pool", null));
  if (oracle.total === null || row.gap === null || row.gap <= 0) return row; // oracle bound exhausted: no comparison
  const entry = `${label}: app ${total} vs oracle min ${oracle.total} (gap +${row.gap}) app ${JSON.stringify(row.appVector)} oracle ${JSON.stringify(row.oracleVector)} needs ${JSON.stringify(needs)} bonus ${JSON.stringify(bonus)} held ${JSON.stringify(held)} priority ${priority} picks ${JSON.stringify(picks)}`;
  if (picks) contractGaps.push(entry);
  else gaps.push(entry);
  return row;
}

function r30Entry(label, row, needs, bonus, held, reference, gap) {
  return `${label}: R30 app ${row.app} vs ${reference}${gap === null ? "" : ` (gap +${gap})`} app ${JSON.stringify(row.appVector)} needs ${JSON.stringify(needs)} bonus ${JSON.stringify(bonus)} held ${JSON.stringify(held)} picks ${JSON.stringify(row.picks)}`;
}

/* ---- S1: live 80639, every non-all-drop quest as priority, across needs ---- */
const NEED_ROWS = [
  { [A_KEYS[0]]: 3000, [A_KEYS[1]]: 4000, [A_KEYS[2]]: 5000 },
  { [A_KEYS[0]]: 1000, [A_KEYS[1]]: 1000, [A_KEYS[2]]: 1000 },
  { [A_KEYS[0]]: 500, [A_KEYS[1]]: 1500, [A_KEYS[2]]: 500 },
  { [A_KEYS[0]]: 2000, [A_KEYS[1]]: 200, [A_KEYS[2]]: 200 },
  { [A_KEYS[0]]: 200, [A_KEYS[1]]: 2000, [A_KEYS[2]]: 200 },
  { [A_KEYS[0]]: 200, [A_KEYS[1]]: 200, [A_KEYS[2]]: 2000 },
  { [A_KEYS[0]]: 3000, [A_KEYS[1]]: 4000, [A_KEYS[2]]: 0 },
];
for (const needs of NEED_ROWS) {
  runCase("S1 priority=null", { needs });
  for (const priority of QUEST_IDS) runCase(`S1 priority=${priority}`, { needs, priority });
}

/* ---- S2: bonus sweep with the GUNMA priorities ---- */
for (const bonus of [
  {},
  { [A_KEYS[0]]: 1, [A_KEYS[1]]: 1, [A_KEYS[2]]: 1 },
  { [A_KEYS[0]]: 2, [A_KEYS[1]]: 0, [A_KEYS[2]]: 1 },
  { [A_KEYS[0]]: 3, [A_KEYS[1]]: 3, [A_KEYS[2]]: 3 },
]) {
  const needs = NEED_ROWS[0];
  runCase(`S2 bonus=${JSON.stringify(bonus)} priority=null`, { needs, bonus });
  for (const priority of [94164100, 94164103])
    runCase(`S2 bonus=${JSON.stringify(bonus)} priority=${priority}`, { needs, bonus, priority });
}

/* ---- S3: per-currency card picks (M6 surface) ---- */
const defaultPicks = {};
for (const key of A_KEYS)
  defaultPicks[key] = EventShop.defaultCurrencyQuest(
    snapshot.farm,
    snapshot.currencies.map((c) => c.id),
    key,
  );
runCase("S3 default picks", { needs: NEED_ROWS[0], picks: defaultPicks });
runCase("S3 default picks + priority 94164103", { needs: NEED_ROWS[0], picks: defaultPicks, priority: 94164103 });
/* every single-quest swap on one card, mid needs */
for (const key of A_KEYS)
  for (const q of QUEST_IDS) {
    if (!(snapshot.farm.quests.find((x) => x.questId === q).drops || {})[key]) continue;
    const picks = { ...defaultPicks, [key]: q };
    runCase(`S3 picks[${key}]=${q}`, { needs: NEED_ROWS[2], picks });
  }

/* ---- S4: held covers one currency outright (key not short — cascade-fed coverage) ---- */
runCase("S4 held key0 fully covered", { needs: NEED_ROWS[0], held: { [A_KEYS[0]]: 3000 } });
runCase("S4 held key0 fully covered, priority 94164101", {
  needs: NEED_ROWS[0],
  held: { [A_KEYS[0]]: 3000 },
  priority: 94164101,
});
runCase("S4 needs key0=0", { needs: { [A_KEYS[0]]: 0, [A_KEYS[1]]: 4000, [A_KEYS[2]]: 5000 } });
runCase("S4 needs key2=0", { needs: { [A_KEYS[0]]: 3000, [A_KEYS[1]]: 4000, [A_KEYS[2]]: 0 }, priority: 94164103 });

/* ---- S5: deterministic fuzz over non-all-drop shapes ---- */
let seed = 20261113;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const fuzzCount = STRESS ? 400 : 160;
for (let i = 0; i < fuzzCount; i++) {
  const needs = {};
  for (const key of A_KEYS) needs[key] = rnd() < 0.12 ? 0 : Math.floor(rnd() * 50) * 100; // incl. zero needs
  if (!Object.values(needs).some((v) => v > 0)) needs[A_KEYS[1]] = 100;
  const bonus = {};
  for (const key of A_KEYS) bonus[key] = Math.floor(rnd() * 3);
  const held = {};
  for (const key of A_KEYS) held[key] = rnd() < 0.15 ? needs[key] : 0; // sometimes fully held
  const priority = rnd() < 0.6 ? QUEST_IDS[Math.floor(rnd() * QUEST_IDS.length)] : null;
  let picks = null;
  if (rnd() < 0.5) {
    picks = {};
    for (const key of A_KEYS) picks[key] = QUEST_IDS[Math.floor(rnd() * QUEST_IDS.length)];
  }
  runCase(`S5 fuzz#${i}`, { needs, bonus, held, priority, picks, oracleBound: 320 });
}

/* ---- ledger ---- */
console.log("case | oracle | pinned | app | gap | feasible");
for (const row of ledger)
  console.log(
    `${row.label} | ${row.oracle} | ${row.pinned === null ? "-" : row.pinned} | ${row.app} | ${row.gap === null ? "-" : (row.gap > 0 ? "+" : "") + row.gap} | ${row.feasible}`,
  );
console.log(`\ncases ${ledger.length}, defect-candidate gaps ${gaps.length}, M6-contract gaps ${contractGaps.length}`);
for (const g of gaps) console.log(`DEFECT-CANDIDATE ${g}`);
for (const g of contractGaps) console.log(`CONTRACT(M6 farmer rule) ${g}`);
process.exit(gaps.length ? 1 : 0);
