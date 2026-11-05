import { test } from "node:test";
import assert from "node:assert/strict";
import { Teapot } from "../src/scripts/domain.js";

/* Altria's step costs (3,000 for Lv.0->1, then 6,125 per level). The shape a frontline slot on a
   1,000-point quest hands over: 1,200 bond a run ordinary, 2,400 while a teapot is spent, standing at
   Lv.0 with 1,000 typed into the box and Lv.3 as the target — 13,250 points in all. */
const A = [
  3000, 6125, 6125, 6125, 6125, 282500, 300000, 320000, 340000, 370000, 1090000, 1230000, 1360000, 1500000, 1640000,
  5000000,
];
const base = { growth: A, current: 0, target: 3, onPerRun: 2400, offPerRun: 1200, typedCost: 1000 };

test("a stock that reaches the end of the plan pays for all of it", () => {
  const teapot = Teapot.plan({ ...base, stock: 6 });
  assert.equal(teapot.out, false);
  assert.equal(teapot.off, null);
  // one run clears Lv.0 (typed 1,000), its surplus carries into Lv.1->2, and Lv.2->3 takes the rest
  assert.deepEqual(
    teapot.on.rows.map((r) => r.runs),
    [1, 2, 3],
  );
  assert.equal(teapot.runs, 6);
});

test("the ordinary rate continues from the level the teapots died on", () => {
  const teapot = Teapot.plan({ ...base, stock: 1 });
  assert.equal(teapot.out, true);
  assert.equal(teapot.runs, 1);
  assert.deepEqual(
    teapot.on.rows.map((r) => r.runs),
    [1],
  );
  // Lv.1->2 still owed 4,725 after that boosted run, and 1,200 a run carries through both levels above.
  assert.deepEqual(
    teapot.off.rows.map((r) => [r.from, r.to, r.runs]),
    [
      [1, 2, 4],
      [2, 3, 6],
    ],
  );
  assert.equal(teapot.off.spansLevels, true);
});

test("runs that clear no level name no level", () => {
  // The reported bug: 30 teapots aimed at a Lv.13->14 that costs more than 30 boosted runs.
  const far = {
    growth: A,
    current: 13,
    target: 15,
    onPerRun: 2400,
    offPerRun: 1200,
    typedCost: 1500000, // Lv.13->14; 30 x 2,400 = 72,000 never clears it
    stock: 30,
  };
  const teapot = Teapot.plan(far);
  assert.equal(teapot.out, true);
  assert.equal(teapot.runs, 30);
  assert.deepEqual(teapot.on.rows, []); // no fabricated "Bond Lv.13->14" row on the boosted block
  assert.equal(teapot.on.stopLevel, 13);
  // Lv.13->14 stays owed, and the continuation is the block that names it.
  assert.equal(teapot.off.rows[0].from, 13);
  assert.ok(teapot.off.rows[0].runs > 0);
});

test("the last teapot spent mid-level still counts as a run", () => {
  const teapot = Teapot.plan({ ...base, stock: 4 });
  assert.equal(teapot.out, true);
  // 3 runs cleared Lv.0->1 and Lv.1->2, the fourth went into Lv.2->3 without finishing it.
  assert.equal(teapot.runs, 4);
  assert.equal(teapot.on.stopRuns, 1);
  assert.equal(teapot.on.stopOwed, 3650);
  // 3,650 at 1,200 a run is four ordinary runs for the level the teapots left unfinished.
  assert.equal(teapot.off.total, 4);
});

test("stock 0 is no teapot at all", () => {
  const teapot = Teapot.plan({ ...base, onPerRun: 1200, offPerRun: 1200, stock: 0 });
  assert.equal(teapot.out, false);
  assert.equal(teapot.off, null);
  assert.equal(teapot.runs, teapot.on.total);
});
