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
} from "../scripts/test_event_shop_oracle_kernel.js";
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

test("owner 80639 gold pick 94164101 honors selected pool [103,104,101] and hits oracle minimum over selected quests", () => {
  const { input, plan } = ownerRun(94164101);
  const selectedPool = input.quests.filter((q) => [94164103, 94164104, 94164101].includes(q.id));
  const selectedOracle = oraclePlan({ ...input, quests: selectedPool }, 500);

  assert.equal(
    plan.totalPlays,
    selectedOracle.total,
    `selected pool minimum ${selectedOracle.total}, got ${plan.totalPlays}`,
  );
  assert.deepEqual(appVector(plan), selectedOracle.vector, "app vector must match selected-pool oracle minimum");
  assert.equal(
    bestAtTotal(buildKernel({ ...input, quests: selectedPool }), selectedOracle.total - 1),
    null,
    "one fewer play must be infeasible on the selected pool",
  );
  assert.equal(auditAppPlan(plan, input).feasible, true, "app plan must cover");
});

test("R30 control — default gold pick: app == oracle", () => {
  const { oracle, plan } = ownerRun(DEFAULT_PICKS[A_KEYS[2]]);
  assert.ok(oracle.total > 0);
  assert.equal(plan.totalPlays, oracle.total, `app ${plan.totalPlays} vs oracle ${oracle.total} with the default pick`);
});

test("R30 context — 80639 ships no all-covering quest (non-all-drop defect surface)", () => {
  assert.equal(EventShop.allCoveringQuests(snapshot.farm, IDS).length, 0, "80639 must have no all-cover quest");
});

const DEFAULT_PICKS = Object.fromEntries(
  A_KEYS.map((key) => [key, EventShop.defaultCurrencyQuest(snapshot.farm, IDS, key)]),
);

const CARD_SWAPS = [
  { [A_KEYS[0]]: 94164100 },
  { [A_KEYS[0]]: 94164104 },
  { [A_KEYS[1]]: 94164101 },
  { [A_KEYS[1]]: 94164102 },
  { [A_KEYS[2]]: 94164101 },
  { [A_KEYS[2]]: 94164103 },
].map((swap) => ({ ...DEFAULT_PICKS, ...swap }));

const RATES_BY_ID = new Map(INPUT.quests.map((quest) => [quest.id, quest.rates]));

function selectedIdsFor(picks) {
  const ids = new Set();
  for (const key of A_KEYS) {
    const pickedId = picks[key];
    const pickedRate = (RATES_BY_ID.get(pickedId) || {})[key] || 0;
    ids.add(pickedRate > 0 ? pickedId : DEFAULT_PICKS[key]);
  }
  return ids;
}

test("80639 card swaps honor every valid dropper pick and match oracle minimum over the selected pool", () => {
  for (const picks of CARD_SWAPS) {
    const selectedIds = selectedIdsFor(picks);
    const poolOracle = oraclePlan({ ...INPUT, quests: INPUT.quests.filter((q) => selectedIds.has(q.id)) }, 500);
    const { plan } = runWith(picks);
    const label = JSON.stringify(picks);
    assert.equal(
      plan.totalPlays,
      poolOracle.total,
      `selected-pool mismatch on ${label}: ${plan.totalPlays} vs ${poolOracle.total}`,
    );
    assert.deepEqual(appVector(plan), poolOracle.vector, `tie-break on ${label}`);
    assert.equal(auditAppPlan(plan, INPUT).feasible, true, `picks ${label} must still cover`);
  }
});
