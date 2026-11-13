#!/usr/bin/env node
/**
 * tests/event-shop-overfarm-r30.test.js — R30 owner over-farm repro (Amendment R30, LOGIC defect).
 *
 * Owner's exact case, live event 80639 (non-all-drop: no quest drops all three currencies):
 *   per-currency picks  bronze=94164103 (Lv75), silver=94164104 (Lv80), gold=94164101 (Lv70,
 *   the secondary-gold farmer the owner picked; the data default is 94164102)
 *   totals 5740 / 5390 / 6310, bonus 2 / 1 / 2, held 0.
 *
 * The app USED to answer 270 plays {94164102:117, 94164103:60, 94164104:93}, farmed 5797.254 /
 * 6058.824 / 7625.457 — the owner's reported numbers. The independent exhaustive oracle's
 * minimum is 240 {94164102:96, 94164103:63, 94164104:81}. GAP +30 was the over-farm; the app now
 * answers the oracle's 240 on this input (pins below re-pinned at R30's fix, 270 → 240).
 *
 * Why this is a defect, not M6 contract latitude: the oracle optimum plays exactly the quests
 * the APP itself plays (102/103/104) — 94164102 because greedy's topUpQuest falls back to the
 * best gold rate when the picked farmer 94164101 is dominated out of the search pool, and 102's
 * 117 runs are what shipped. The exact search nevertheless keeps 94164101 as gold's farmer
 * (selectedFarmers, domain.js), locks 102 out of the gold shortfall (exactPool), drops 101 itself
 * by the poolSet intersection, searches {103,104} where nothing covers at or below the 270 bound,
 * returns null, and bestFarmPlan ships the greedy incumbent. Greedy and exact price DIFFERENT
 * spaces for the same input — the "true minimum for that input" promise (farmPlan doc) breaks.
 *
 * Falsified hypotheses, falsified below (two pinned) and recorded: pre-R22 HEAD answers 270 too (not
 * R22-introduced); the default gold pick 94164102 hits app == oracle == 240 (trigger is the dominated
 * pick); 80639 ships no all-covering quest (the all-drop path is clean on 80632 where an all-cover exists).
 *
 * R30 FIX: selectedFarmers now treats a pick outside the searched pool as absent, and exactPool
 * prices that currency with greedy's best-rate fallback over every usable dropper, so exact's pool
 * contains greedy's whole fallback space for that currency — the only direction over-farm hides in —
 * and the two coincide when no all-covering quest drops the key, and the case below answers 240.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  intQuests,
  buildKernel,
  bestAtTotal,
  oraclePlan,
  appPlan,
  appVector,
  auditAppPlan,
  snapshot,
  A_KEYS,
} from "../scripts/event_shop_oracle_kernel.js";
import { EventShop } from "../src/scripts/domain.js";

const NEEDS = { [A_KEYS[0]]: 5740, [A_KEYS[1]]: 5390, [A_KEYS[2]]: 6310 };
const BONUS = { [A_KEYS[0]]: 2, [A_KEYS[1]]: 1, [A_KEYS[2]]: 2 };
const IDS = snapshot.currencies.map((c) => c.id);

const INPUT = { deficits: NEEDS, quests: intQuests(snapshot.farm.quests, BONUS), trades: snapshot.trades };
const ORACLE = oraclePlan(INPUT, 400);

function runWith(picks) {
  const plan = appPlan({
    totals: NEEDS,
    held: {},
    bonus: BONUS,
    farm: snapshot.farm,
    trades: snapshot.trades,
    priorityQuestId: null,
    currencyQuest: picks,
    currencyIds: IDS,
  });
  return { input: INPUT, oracle: ORACLE, plan };
}

function ownerRun(goldPick) {
  return runWith({ [A_KEYS[0]]: 94164103, [A_KEYS[1]]: 94164104, [A_KEYS[2]]: goldPick });
}

test("R30 owner exact case — dominated gold pick 94164101: app totalPlays must equal the oracle minimum", () => {
  const { input, oracle, plan } = ownerRun(94164101);

  // the owner's repro input, pinned at the fixed answer so the over-farm cannot come back silently
  assert.equal(
    plan.totalPlays,
    240,
    `R30 repro: the dominated gold pick must answer the oracle minimum, got ${plan.totalPlays}`,
  );
  assert.deepEqual(appVector(plan), { 94164102: 96, 94164103: 63, 94164104: 81 }, "R30 repro vector");

  // the independent oracle: exhaustive minimum 240, and 239 proven infeasible by the kernel itself
  assert.equal(oracle.total, 240, `oracle minimum ${oracle.total}`);
  assert.deepEqual(oracle.vector, { 94164102: 96, 94164103: 63, 94164104: 81 }, "oracle witness");
  assert.equal(bestAtTotal(buildKernel(input), 239), null, "a 239-play plan exists — the oracle floor is wrong");

  // THE CONTRACT: minimum plays, never over-farm.
  assert.equal(
    plan.totalPlays,
    oracle.total,
    `R30 over-farm: EventShop ${plan.totalPlays} plays ${JSON.stringify(appVector(plan))} vs oracle minimum ${oracle.total} ${JSON.stringify(oracle.vector)} (gap +${plan.totalPlays - oracle.total}) on the owner's 80639 case (needs 5740/5390/6310, bonus 2/1/2, picks 103/104/101)`,
  );
  assert.deepEqual(appVector(plan), oracle.vector, "app vector must be the oracle's tie-broken optimum");

  // coverage and the app-vs-oracle audit machinery stay green on both plans (over-farm, not under-cover)
  assert.equal(auditAppPlan(plan, input).feasible, true, "app plan must cover");
});

test("R30 control — default gold pick 94164102: app == oracle 240 (trigger is the dominated pick, not the need set)", () => {
  const { oracle, plan } = ownerRun(94164102);
  assert.equal(oracle.total, 240);
  assert.equal(plan.totalPlays, 240, `app ${plan.totalPlays} vs oracle 240 with the default pick`);
});

test("R30 context — 80639 ships no all-covering quest (non-all-drop defect surface)", () => {
  assert.equal(EventShop.allCoveringQuests(snapshot.farm, IDS).length, 0, "80639 must have no all-cover quest");
});

/* R30 generalised beyond the owner's single pick: a selection the searched pool cannot honour — a quest
   the dominance rule drops, or one that does not even drop this currency — counts as unhonoured: no
   farmer pin, no demotion. Every card of 80639 (non-all-drop) is swept once with an unhonourable pick
   of each kind while the other two keep their defaults, and each must answer the UNCONSTRAINED oracle
   minimum: an unhonourable pick may not cost a single play. Picks the pool CAN honour keep their M6
   latitude and are not part of this fixture (pre-fix, all six below answered 270 = +30 over-farm). */
const DEFAULT_PICKS = { [A_KEYS[0]]: 94164103, [A_KEYS[1]]: 94164104, [A_KEYS[2]]: 94164102 };

const UNHONOURABLE_PICKS = [
  { [A_KEYS[0]]: 94164100 },
  { [A_KEYS[0]]: 94164104 },
  { [A_KEYS[1]]: 94164101 },
  { [A_KEYS[1]]: 94164102 },
  { [A_KEYS[2]]: 94164101 },
  { [A_KEYS[2]]: 94164103 },
].map((swap) => ({ ...DEFAULT_PICKS, ...swap }));

const POOL_IDS = new Set(buildKernel(INPUT).pool.map((quest) => quest.id));
const RATES_BY_ID = new Map(INPUT.quests.map((quest) => [quest.id, quest.rates]));

function isUnhonourable(key, questId) {
  const rate = (RATES_BY_ID.get(questId) || {})[key] || 0;
  return !POOL_IDS.has(questId) || rate <= 0;
}

test("R30 regression — every unhonourable pick on every 80639 card hits the oracle minimum", () => {
  for (const picks of UNHONOURABLE_PICKS) {
    const swapped = Object.keys(picks).find((key) => picks[key] !== DEFAULT_PICKS[key]);
    assert.equal(
      isUnhonourable(swapped, picks[swapped]),
      true,
      `fixture pick ${picks[swapped]} for ${swapped} is honourable: it proves nothing`,
    );
    const { plan } = runWith(picks);
    const label = JSON.stringify(picks);
    assert.equal(
      plan.totalPlays,
      ORACLE.total,
      `R30 over-farm on unhonourable picks ${label}: ${plan.totalPlays} vs ${ORACLE.total}`,
    );
    assert.deepEqual(appVector(plan), ORACLE.vector, `R30 tie-break on unhonourable picks ${label}`);
    assert.equal(auditAppPlan(plan, INPUT).feasible, true, `unhonourable picks ${label} must still cover`);
  }
});
