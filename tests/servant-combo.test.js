import { test } from "node:test";
import assert from "node:assert/strict";

import { ServantComboCalculator } from "../src/scripts/domain.js";

/* Design section ids: 0001 Chaldea Morning, 0002 Checking Reports, 0003 Needle of Sincerity,
   0004 Blessed Bride, 0005 Foreign God. Servant ids are the real ones: 001 Mash Kyrielight,
   059 Jeanne d'Arc, 373 Kukulcan, 444 U-Olga Marie. */
const entry = (id, ceIds) => ({ servant: { id }, matchingCEIds: new Set(ceIds) });

const MASH = ["0001", "0002", "0003", "0004"];
const JEANNE = ["0002", "0003", "0004", "0005"];
const KUKULCAN = ["0002", "0003", "0004", "0005"];
const OLGA = ["0001", "0002", "0003", "0004", "0005"];

const fourServants = () => [entry("001", MASH), entry("059", JEANNE), entry("373", KUKULCAN), entry("444", OLGA)];

test("union across ascension entries", () => {
  // Neither entry alone, and not the last one, is the usable list: the union is.
  const entries = [entry("001", ["0001"]), entry("001", ["0002"]), entry("059", ["0001", "0002"])];
  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.deepStrictEqual(groups, [{ ceIds: ["0001", "0002"], servantIds: ["001", "059"] }]);
  assert.deepStrictEqual(unshared, []);
  assert.equal(truncated, false);
});

test("collapses identical CE lists to the union of servants", () => {
  const entries = [entry("001", MASH), entry("059", JEANNE), entry("373", KUKULCAN)];
  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "373"]);

  const collapsed = groups.find((g) => g.ceIds.join() === ["0002", "0003", "0004"].join());
  assert.ok(collapsed, "the shared 3-CE row is present");
  assert.deepStrictEqual(collapsed.servantIds, ["001", "059", "373"]);
  assert.equal(new Set(collapsed.servantIds).size, collapsed.servantIds.length, "no repeated servant");
  assert.equal(groups.length, 2);
});

test("prunes single-servant groups", () => {
  const entries = [entry("001", ["0001", "0002", "0003"])];
  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001"]);

  assert.deepStrictEqual(groups, []);
  assert.deepStrictEqual(unshared, ["001"]);
  assert.equal(truncated, false);
});

test("names a servant that shares nothing", () => {
  const entries = [entry("001", ["0001"]), entry("059", ["0005"])];
  const { groups, unshared } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.deepStrictEqual(groups, []);
  assert.deepStrictEqual(unshared, ["001", "059"]);
});

test("sorts by CE count then servant count", () => {
  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(fourServants(), [
    "001",
    "059",
    "373",
    "444",
  ]);

  assert.equal(truncated, false);
  assert.deepStrictEqual(unshared, []);
  assert.deepStrictEqual(
    groups.map((g) => [g.ceIds.length, g.servantIds.length]),
    [
      [4, 3],
      [4, 2],
      [3, 4],
    ],
  );
  assert.deepStrictEqual(groups[0].ceIds, ["0002", "0003", "0004", "0005"]);
  assert.deepStrictEqual(groups[0].servantIds, ["059", "373", "444"]);
  assert.deepStrictEqual(groups[1].ceIds, ["0001", "0002", "0003", "0004"]);
  assert.deepStrictEqual(groups[1].servantIds, ["001", "444"]);
  assert.deepStrictEqual(groups[2].ceIds, ["0002", "0003", "0004"]);
  assert.deepStrictEqual(groups[2].servantIds, ["001", "059", "373", "444"]);
});

test("maximal group expansion", () => {
  // 059 and 444 were never enumerated together with 001 for this CE list; expansion must
  // still put all three in the row, because all three can use both CEs.
  const entries = [
    entry("001", ["0002", "0003"]),
    entry("059", ["0002", "0003", "0004"]),
    entry("444", ["0002", "0003", "0005"]),
  ];
  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "444"]);

  assert.deepStrictEqual(groups, [{ ceIds: ["0002", "0003"], servantIds: ["001", "059", "444"] }]);
});

test("truncated run makes no unshared claims", () => {
  const budget = ServantComboCalculator.MAX_COMBO_NODES;
  ServantComboCalculator.MAX_COMBO_NODES = 1;
  try {
    const entries = [entry("001", ["0001", "0002"]), entry("059", ["0001", "0003"]), entry("444", ["0001", "0004"])];
    const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "444"]);

    assert.equal(truncated, true);
    assert.equal(groups.length, 0, "the budget cut enumeration off before any group of two survived");
    assert.deepStrictEqual(unshared, [], "a partial result cannot call any servant unshared");
  } finally {
    ServantComboCalculator.MAX_COMBO_NODES = budget;
  }
});

test("input is not mutated", () => {
  const entries = fourServants();
  const before = entries.map((e) => [...e.matchingCEIds].sort());
  ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "373", "444"]);

  assert.deepStrictEqual(
    entries.map((e) => [...e.matchingCEIds].sort()),
    before,
  );
});

test("truncated at the node budget", () => {
  const shared = "0001";
  const entries = [];
  const picked = [];
  for (let i = 0; i < 20; i++) {
    const id = String(i + 1).padStart(3, "0");
    entries.push(entry(id, [shared, `9${String(i + 1).padStart(3, "0")}`]));
    picked.push(id);
  }
  const { groups, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, picked);

  assert.equal(truncated, true);
  assert.ok(groups.length > 0, "a partial result is still returned");
});

test("truncated run claims no unshared servants", () => {
  // Servant 020 shares only with 444, and that subset is reached late, so a low node budget
  // truncates before it is ever seen. Naming 020 as "shares nothing" would be false.
  const budget = ServantComboCalculator.MAX_COMBO_NODES;
  ServantComboCalculator.MAX_COMBO_NODES = 2;
  try {
    const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(fourServants(), [
      "001",
      "059",
      "373",
      "444",
    ]);

    assert.equal(truncated, true);
    assert.ok(groups.length < 3, "the truncated result is smaller than the full ladder");
    assert.deepStrictEqual(unshared, [], "a partial ladder may not name anyone as unshared");
  } finally {
    ServantComboCalculator.MAX_COMBO_NODES = budget;
  }
});

test("duplicate picked ids", () => {
  const entries = fourServants();
  const withDupes = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "001", "059"]);
  const clean = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.deepStrictEqual(withDupes, clean);
});
