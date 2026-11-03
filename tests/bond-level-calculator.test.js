import { test } from "node:test";
import assert from "node:assert/strict";
import { BondLevelCalculator } from "../src/scripts/domain.js";

/* Altria Pendragon's step costs: Atlas publishes bondGrowth as a running total
   (3000, 9125, 15250, …), and the data sync stores the difference per level, so index i is
   what Lv.i -> Lv.i+1 asks for. */
const A = [
  3000, 6125, 6125, 6125, 6125, 282500, 300000, 320000, 340000, 370000, 1090000, 1230000, 1360000, 1500000, 1640000,
  5000000,
];
const FLAT = Array.from({ length: 16 }, () => 100);

test("single level span stays one row and does not ask for a breakdown", () => {
  const plan = BondLevelCalculator.plan({ growth: A, current: 2, target: 3, bondPerRun: 1000 });
  assert.deepEqual(plan.rows, [{ from: 2, to: 3, runs: 7 }]);
  assert.equal(plan.total, 7);
  assert.equal(plan.spansLevels, false);
});

test("surplus carries from level to level up to the bond cap", () => {
  const plan = BondLevelCalculator.plan({ growth: A, current: 0, target: 10, bondPerRun: 1000 });
  assert.equal(plan.spansLevels, true);
  assert.deepEqual(
    plan.rows.map((r) => r.runs),
    [3, 7, 6, 6, 6, 282, 300, 320, 340, 370],
  );
  // Lv.0 to Lv.10 costs 1,640,000 points, so 1,000 a run is exactly 1,640 runs.
  assert.equal(plan.total, 1640);
});

test("one run that clears two levels reports them as a single stretch", () => {
  const plan = BondLevelCalculator.plan({ growth: A, current: 0, target: 10, bondPerRun: 10000 });
  assert.deepEqual(plan.rows[0], { from: 0, to: 2, runs: 1 });
  assert.deepEqual(plan.rows[1], { from: 2, to: 3, runs: 1 });
  assert.equal(
    plan.rows.reduce((sum, r) => sum + r.runs, 0),
    plan.total,
  );
});

test("the bond cap discards surplus, so Lv.11 and above need whole runs", () => {
  const below = BondLevelCalculator.plan({ growth: FLAT, current: 8, target: 10, bondPerRun: 250 });
  assert.deepEqual(below.rows, [{ from: 8, to: 10, runs: 1 }]);

  const above = BondLevelCalculator.plan({ growth: FLAT, current: 10, target: 12, bondPerRun: 250 });
  assert.deepEqual(above.rows, [
    { from: 10, to: 11, runs: 1 },
    { from: 11, to: 12, runs: 1 },
  ]);
});

test("a typed figure prices only the level the player stands on", () => {
  const tableOnly = BondLevelCalculator.plan({ growth: A, current: 0, target: 2, bondPerRun: 1000 });
  const typed = BondLevelCalculator.plan({ growth: A, current: 0, target: 2, bondPerRun: 1000, typedCost: 1000 });
  assert.deepEqual(
    tableOnly.rows.map((r) => r.runs),
    [3, 7],
  );
  assert.deepEqual(
    typed.rows.map((r) => r.runs),
    [1, 7],
  );
});

test("rejects unusable input instead of dividing by it", () => {
  const empty = { rows: [], total: 0, spansLevels: false };
  assert.deepEqual(BondLevelCalculator.plan({ growth: A, current: 5, target: 5, bondPerRun: 1000 }), empty);
  // a target above the table is clamped to the last level the table prices
  assert.equal(BondLevelCalculator.plan({ growth: A, current: 0, target: 99, bondPerRun: 1000 }).total, 13460);
  assert.deepEqual(BondLevelCalculator.plan({ growth: null, current: 0, target: 5, bondPerRun: 1000 }), empty);
  assert.deepEqual(BondLevelCalculator.plan({ growth: A, current: 0, target: 5, bondPerRun: 0 }), empty);
});
