import { test } from "node:test";
import assert from "node:assert/strict";

import { ServantComboCalculator } from "../src/scripts/domain.js";

/* Design section ids: 0001 Chaldea Morning, 0002 Checking Reports, 0003 Needle of Sincerity,
   0004 Blessed Bride, 0005 Foreign God. Servant ids are the real ones: 001 Mash Kyrielight,
   059 Jeanne d'Arc, 373 Kukulcan, 444 U-Olga Marie. */
const entry = (id, ceIds) => ({ servant: { id }, matchingCEIds: new Set(ceIds) });

/* A row's members are the matching entries themselves, in servant-id order. */
const ids = (group) => group.members.map((member) => member.servant.id);

const MASH = ["0001", "0002", "0003", "0004"];
const JEANNE = ["0002", "0003", "0004", "0005"];
const KUKULCAN = ["0002", "0003", "0004", "0005"];
const OLGA = ["0001", "0002", "0003", "0004", "0005"];

const fourServants = () => [entry("001", MASH), entry("059", JEANNE), entry("373", KUKULCAN), entry("444", OLGA)];

test("splits a servant whose ascensions match different CEs", () => {
  // Mash's two forms each hold one of the pair, so no row may claim Mash uses both at once:
  // the two rows are the split, the way Craft Essence Select gives each form its own card.
  const entries = [entry("001", ["0001"]), entry("001", ["0002"]), entry("059", ["0001", "0002"])];
  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.deepStrictEqual(
    groups.map((g) => [g.ceIds, ids(g)]),
    [
      [["0001"], ["001", "059"]],
      [["0002"], ["001", "059"]],
    ],
  );
  assert.deepStrictEqual(unshared, []);
  assert.equal(truncated, false);
});

test("a split servant shows every form that can use the row", () => {
  // The stage form's list is a superset, so both Mash entries qualify for the shared pair.
  const base = entry("001", ["0001", "0002"]);
  const stage = entry("001", ["0001", "0002", "0003"]);
  const entries = [base, stage, entry("059", ["0001", "0002"])];
  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0002"]);
  assert.deepStrictEqual(groups[0].members, [base, stage, entries[2]], "both Mash forms, in entry order");
});

test("one servant split across forms is still not a combo", () => {
  const { groups, unshared } = ServantComboCalculator.buildSharedCEGroups(
    [entry("001", ["0001"]), entry("001", ["0002"])],
    ["001"],
  );

  assert.deepStrictEqual(groups, []);
  assert.deepStrictEqual(unshared, ["001"]);
});

test("collapses identical CE lists into one member group", () => {
  const entries = [entry("001", MASH), entry("059", JEANNE), entry("373", KUKULCAN)];
  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "373"]);

  const collapsed = groups.find((g) => g.ceIds.join() === ["0002", "0003", "0004"].join());
  assert.ok(collapsed, "the shared 3-CE row is present");
  assert.deepStrictEqual(ids(collapsed), ["001", "059", "373"]);
  assert.equal(new Set(ids(collapsed)).size, ids(collapsed).length, "one entry per servant, so no repeats");
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
    groups.map((g) => [g.ceIds.length, ids(g).length]),
    [
      [4, 3],
      [4, 2],
      [3, 4],
    ],
  );
  assert.deepStrictEqual(groups[0].ceIds, ["0002", "0003", "0004", "0005"]);
  assert.deepStrictEqual(ids(groups[0]), ["059", "373", "444"]);
  assert.deepStrictEqual(groups[1].ceIds, ["0001", "0002", "0003", "0004"]);
  assert.deepStrictEqual(ids(groups[1]), ["001", "444"]);
  assert.deepStrictEqual(groups[2].ceIds, ["0002", "0003", "0004"]);
  assert.deepStrictEqual(ids(groups[2]), ["001", "059", "373", "444"]);
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

  assert.deepStrictEqual(
    groups.map((g) => [g.ceIds, ids(g)]),
    [
      [
        ["0002", "0003"],
        ["001", "059", "444"],
      ],
    ],
  );
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

test("buildServantOverlapGroups prunes combinations with no other servant match", () => {
  // S1 matches CE1, CE2. S2 matches only CE1.
  // Combo [CE1, CE2] matches only S1 -> pruned!
  // Combo [CE1] matches S1 and S2 -> kept!
  const s1 = entry("001", ["0001", "0002"]);
  const s2 = entry("002", ["0001"]);
  const allMatches = [s1, s2];

  const groups = ServantComboCalculator.buildServantOverlapGroups(allMatches, s1);
  assert.equal(groups.length, 1);
  assert.deepStrictEqual(groups[0].ceIds, ["0001"]);
  assert.deepStrictEqual(
    groups[0].otherMembers.map((m) => m.servant.id),
    ["002"],
  );
});

test("buildServantOverlapGroups prunes combinations with same servant group keeping maximal CEs", () => {
  // S1 matches CE1, CE2. S2 matches CE1, CE2.
  // Combos:
  // [CE1, CE2] -> otherMembers: [S2]
  // [CE1] -> otherMembers: [S2] (same servant in group)
  // [CE2] -> otherMembers: [S2] (same servant in group)
  // Prunes [CE1] and [CE2], keeps maximal [CE1, CE2].
  const s1 = entry("001", ["0001", "0002"]);
  const s2 = entry("002", ["0001", "0002"]);
  const allMatches = [s1, s2];

  const groups = ServantComboCalculator.buildServantOverlapGroups(allMatches, s1);
  assert.equal(groups.length, 1);
  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0002"]);
  assert.deepStrictEqual(
    groups[0].otherMembers.map((m) => m.servant.id),
    ["002"],
  );
});

test("buildServantOverlapGroups keeps distinct servant groups and sorts by CE count then servant count", () => {
  // S1 matches CE1, CE2, CE3.
  // S2 matches CE1, CE2, CE3.
  // S3 matches CE1, CE2.
  // S4 matches CE1.
  // Combinations:
  // [CE1, CE2, CE3] -> otherMembers: [S2] (3 CEs)
  // [CE1, CE2] -> otherMembers: [S2, S3] (2 CEs, distinct group!)
  // [CE1] -> otherMembers: [S2, S3, S4] (1 CE, distinct group!)
  const s1 = entry("001", ["0001", "0002", "0003"]);
  const s2 = entry("002", ["0001", "0002", "0003"]);
  const s3 = entry("003", ["0001", "0002"]);
  const s4 = entry("004", ["0001"]);
  const allMatches = [s1, s2, s3, s4];

  const groups = ServantComboCalculator.buildServantOverlapGroups(allMatches, s1);
  assert.equal(groups.length, 3);
  // Sort order: most CEs first
  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0002", "0003"]);
  assert.deepStrictEqual(
    groups[0].otherMembers.map((m) => m.servant.id),
    ["002"],
  );

  assert.deepStrictEqual(groups[1].ceIds, ["0001", "0002"]);
  assert.deepStrictEqual(
    groups[1].otherMembers.map((m) => m.servant.id),
    ["002", "003"],
  );

  assert.deepStrictEqual(groups[2].ceIds, ["0001"]);
  assert.deepStrictEqual(
    groups[2].otherMembers.map((m) => m.servant.id),
    ["002", "003", "004"],
  );
});

test("buildServantOverlapGroups returns empty array when no CEs or no other matches", () => {
  const s1 = entry("001", []);
  assert.deepStrictEqual(ServantComboCalculator.buildServantOverlapGroups([s1], s1), []);

  const s2 = entry("001", ["0001"]);
  assert.deepStrictEqual(ServantComboCalculator.buildServantOverlapGroups([s2], s2), []);
});
