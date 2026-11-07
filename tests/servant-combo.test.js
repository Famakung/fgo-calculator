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
    const entries = [
      entry("001", ["0001", "0002", "0003"]),
      entry("059", ["0001", "0002"]),
      entry("444", ["0001", "0003"]),
    ];
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
  const budget = ServantComboCalculator.MAX_COMBO_NODES;
  ServantComboCalculator.MAX_COMBO_NODES = 5;
  try {
    const entries = [];
    const picked = [];
    for (let i = 0; i < 10; i++) {
      const id = String(i + 1).padStart(3, "0");
      entries.push(entry(id, ["0001", "0002", `9${String(i % 5).padStart(3, "0")}`]));
      picked.push(id);
    }
    const { groups, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, picked);

    assert.equal(truncated, true);
    assert.ok(groups.length > 0, "a partial result is still returned");
  } finally {
    ServantComboCalculator.MAX_COMBO_NODES = budget;
  }
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

test("buildSharedCEGroups pre-filters CEs not shared by at least two distinct picked servants", () => {
  // S1 has CE1, CE2, CE3. S2 has CE1, CE2, CE4. S3 has CE1, CE5.
  // CE3, CE4, CE5 each appear on only one servant, so they are pruned upfront.
  // CE1 is on S1, S2, S3. CE2 is on S1, S2.
  const entries = [
    entry("001", ["0001", "0002", "0003"]),
    entry("059", ["0001", "0002", "0004"]),
    entry("444", ["0001", "0005"]),
  ];
  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "444"]);

  assert.equal(truncated, false);
  assert.deepStrictEqual(unshared, []);
  assert.equal(groups.length, 2);
  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0002"]);
  assert.deepStrictEqual(ids(groups[0]), ["001", "059"]);
  assert.deepStrictEqual(groups[1].ceIds, ["0001"]);
  assert.deepStrictEqual(ids(groups[1]), ["001", "059", "444"]);
});

test("buildSharedCEGroups prunes subsets with same member group keeping maximal CEs", () => {
  // S1 has CE1, CE2, CE3. S2 has CE1, CE2, CE3.
  // Both match CE1, CE2, CE3. Subsets [CE1], [CE2], [CE3], [CE1, CE2], etc. all match {S1, S2}.
  // Same-member-pruning must keep only [CE1, CE2, CE3] for {S1, S2}.
  const entries = [entry("001", ["0001", "0002", "0003"]), entry("059", ["0001", "0002", "0003"])];
  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.equal(groups.length, 1);
  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0002", "0003"]);
  assert.deepStrictEqual(ids(groups[0]), ["001", "059"]);
});

test("buildSharedCEGroups seen-key memoization skips redundant intersection branches", () => {
  // 4 servants sharing overlapping combinations where multiple branch paths yield the same CE set.
  const entries = [
    entry("001", ["0001", "0002", "0003"]),
    entry("059", ["0001", "0002", "0004"]),
    entry("373", ["0001", "0003", "0004"]),
    entry("444", ["0001", "0002", "0003", "0004"]),
  ];
  const { groups, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "373", "444"]);

  assert.equal(truncated, false);
  // Verify no duplicate member combinations exist
  const memberKeys = groups.map((g) => ids(g).join(","));
  const uniqueMemberKeys = new Set(memberKeys);
  assert.equal(memberKeys.length, uniqueMemberKeys.size);
});

test("multi-ascension forms of same servant sharing CE without other servants do not form combo", () => {
  // Servant 001 has 3 forms; all 3 share CE 9999, but NO other servant has CE 9999.
  // Servant 001 forms also have CE 0001 (form 1) and CE 0002 (form 2).
  // Servant 059 has CE 0001 and CE 0002.
  // CE 9999 must NOT count as shared in _filterSharedCESet or _evaluateCandidateGroup.
  const form1 = entry("001", ["0001", "9999"]);
  const form2 = entry("001", ["0002", "9999"]);
  const form3 = entry("001", ["9999"]);
  const jeanne = entry("059", ["0001", "0002"]);
  const entries = [form1, form2, form3, jeanne];

  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059"]);

  assert.equal(truncated, false);
  assert.deepStrictEqual(unshared, []);
  // CE 9999 must not appear in any group
  assert.equal(
    groups.some((g) => g.ceIds.includes("9999")),
    false,
  );
  // Only CE 0001 and CE 0002 form combos
  assert.deepStrictEqual(
    groups.map((g) => g.ceIds),
    [["0001"], ["0002"]],
  );
  assert.deepStrictEqual(groups[0].members, [form1, jeanne]);
  assert.deepStrictEqual(groups[1].members, [form2, jeanne]);
});

test("same-member pruning keeps maximal CE list and prunes non-closed subsets", () => {
  // S1 has [1, 2, 3], S2 has [1, 2, 3], S3 has [1, 2, 4], S4 has [1, 2, 4]
  // Intersections:
  // [1, 2, 3] matches {S1, S2} (closed, 3 CEs)
  // [1, 2, 4] matches {S3, S4} (closed, 3 CEs)
  // [1, 2] matches {S1, S2, S3, S4} (closed, 2 CEs)
  // No non-closed subset like [1] or [2] is retained for any group.
  const s1 = entry("001", ["0001", "0002", "0003"]);
  const s2 = entry("059", ["0001", "0002", "0003"]);
  const s3 = entry("373", ["0001", "0002", "0004"]);
  const s4 = entry("444", ["0001", "0002", "0004"]);
  const entries = [s1, s2, s3, s4];

  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "059", "373", "444"]);
  assert.equal(groups.length, 3);
  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0002", "0003"]);
  assert.deepStrictEqual(ids(groups[0]), ["001", "059"]);
  assert.deepStrictEqual(groups[1].ceIds, ["0001", "0002", "0004"]);
  assert.deepStrictEqual(ids(groups[1]), ["373", "444"]);
  assert.deepStrictEqual(groups[2].ceIds, ["0001", "0002"]);
  assert.deepStrictEqual(ids(groups[2]), ["001", "059", "373", "444"]);

  // Direct test of _recordCandidateGroup tie-breaking and replacement
  const map = new Map();
  const cShort = { memberKey: "0,1", ceIds: ["0001"], members: [s1, s2], servantCount: 2 };
  const cLong = { memberKey: "0,1", ceIds: ["0001", "0002"], members: [s1, s2], servantCount: 2 };
  ServantComboCalculator._recordCandidateGroup(map, cShort);
  assert.equal(map.get("0,1").ceIds.length, 1);
  ServantComboCalculator._recordCandidateGroup(map, cLong);
  assert.equal(map.get("0,1").ceIds.length, 2, "Longer CE list replaces shorter for same memberKey");
  ServantComboCalculator._recordCandidateGroup(map, cShort);
  assert.equal(map.get("0,1").ceIds.length, 2, "Shorter CE list does not replace longer for same memberKey");
});

test("unshared servant reporting distinguishes partial sharing vs budget truncation", () => {
  // S1 and S2 share CE 0001. S3 has only CE 0002 (unshared with S1, S2). S4 has no matching CEs.
  const s1 = entry("001", ["0001"]);
  const s2 = entry("059", ["0001"]);
  const s3 = entry("373", ["0002"]);
  const s4 = entry("444", []);
  const entries = [s1, s2, s3, s4];
  const picked = ["001", "059", "373", "444"];

  const normal = ServantComboCalculator.buildSharedCEGroups(entries, picked);
  assert.equal(normal.truncated, false);
  assert.equal(normal.groups.length, 1);
  assert.deepStrictEqual(ids(normal.groups[0]), ["001", "059"]);
  // Both 373 and 444 must be reported as unshared
  assert.deepStrictEqual(normal.unshared, ["373", "444"]);

  // When truncated is true, unshared MUST be empty array even if unshared servants exist
  const budget = ServantComboCalculator.MAX_COMBO_NODES;
  ServantComboCalculator.MAX_COMBO_NODES = 0;
  try {
    const trunc = ServantComboCalculator.buildSharedCEGroups(entries, picked);
    assert.equal(trunc.truncated, true);
    assert.deepStrictEqual(trunc.unshared, [], "truncated run must never report unshared servants");
  } finally {
    ServantComboCalculator.MAX_COMBO_NODES = budget;
  }
});

test("performance on 25 picked servants with overlapping CEs stays within budget", () => {
  // 25 servants divided into 3 overlapping equivalence classes
  const entries = [];
  const picked = [];
  for (let i = 1; i <= 25; i++) {
    const id = String(i).padStart(3, "0");
    picked.push(id);
    if (i <= 10) entries.push(entry(id, ["0001", "0002", "0003"]));
    else if (i <= 20) entries.push(entry(id, ["0002", "0003", "0004"]));
    else entries.push(entry(id, ["0001", "0003", "0004"]));
  }

  const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, picked);
  assert.equal(truncated, false, "must not hit MAX_COMBO_NODES");
  assert.deepStrictEqual(unshared, []);
  assert.equal(groups.length, 7, "exactly 7 maximal closed intersection groups");
});

test("null, empty, and malformed inputs handled gracefully", () => {
  // null / undefined
  assert.deepStrictEqual(ServantComboCalculator.buildSharedCEGroups(null, null), {
    groups: [],
    unshared: [],
    truncated: false,
  });
  assert.deepStrictEqual(ServantComboCalculator.buildSharedCEGroups(undefined, undefined), {
    groups: [],
    unshared: [],
    truncated: false,
  });
  assert.deepStrictEqual(ServantComboCalculator.buildSharedCEGroups([], []), {
    groups: [],
    unshared: [],
    truncated: false,
  });

  // matchingCEIds as Array vs Set produce identical results
  const arrayEntries = [
    { servant: { id: "001" }, matchingCEIds: ["0001", "0002"] },
    { servant: { id: "059" }, matchingCEIds: ["0001", "0002"] },
  ];
  const setEntries = [
    { servant: { id: "001" }, matchingCEIds: new Set(["0001", "0002"]) },
    { servant: { id: "059" }, matchingCEIds: new Set(["0001", "0002"]) },
  ];
  const fromArray = ServantComboCalculator.buildSharedCEGroups(arrayEntries, ["001", "059"]);
  const fromSet = ServantComboCalculator.buildSharedCEGroups(setEntries, ["001", "059"]);
  assert.deepStrictEqual(
    fromArray.groups.map((g) => g.ceIds),
    fromSet.groups.map((g) => g.ceIds),
  );
  assert.deepStrictEqual(fromArray.unshared, fromSet.unshared);
  assert.equal(fromArray.truncated, fromSet.truncated);

  // duplicate CE IDs in an Array matchingCEIds input are deduplicated
  const dupeArrayEntries = [
    { servant: { id: "001" }, matchingCEIds: ["0001", "0001", "0002", "0002"] },
    { servant: { id: "059" }, matchingCEIds: ["0001", "0002"] },
  ];
  const fromDupeArray = ServantComboCalculator.buildSharedCEGroups(dupeArrayEntries, ["001", "059"]);
  assert.equal(fromDupeArray.groups.length, 1);
  assert.deepStrictEqual(fromDupeArray.groups[0].ceIds, ["0001", "0002"]);

  // malformed entries in list
  const malformedEntries = [
    null,
    undefined,
    {},
    { servant: null },
    { servant: { id: null } },
    { servant: { id: "001" }, matchingCEIds: null },
    { servant: { id: "001" }, matchingCEIds: ["0001"] },
    { servant: { id: "059" }, matchingCEIds: ["0001"] },
  ];
  const res = ServantComboCalculator.buildSharedCEGroups(malformedEntries, ["001", "059"]);
  assert.equal(res.groups.length, 1);
  assert.deepStrictEqual(res.groups[0].ceIds, ["0001"]);
  assert.deepStrictEqual(ids(res.groups[0]), ["001", "059"]);
});

test("bitset engine: _createMask, _intersectMasks, _isSubsetMask, and _decodeMask", () => {
  const cePool = ["0001", "0002", "0003", "0004", "0005"];
  const ceIndexMap = ServantComboCalculator._createIndexMap(cePool);

  const maskA = ServantComboCalculator._createMask(["0001", "0002", "0003"], ceIndexMap, 1);
  const maskB = ServantComboCalculator._createMask(["0002", "0003", "0004"], ceIndexMap, 1);
  const maskC = ServantComboCalculator._createMask(["0005"], ceIndexMap, 1);

  // Intersection of A and B is [0002, 0003]
  const maskAB = ServantComboCalculator._intersectMasks(maskA, maskB);
  assert.ok(maskAB !== null);
  assert.deepStrictEqual(ServantComboCalculator._decodeMask(maskAB, cePool), ["0002", "0003"]);

  // Disjoint intersection produces null
  const maskAC = ServantComboCalculator._intersectMasks(maskA, maskC);
  assert.equal(maskAC, null);

  // Subset checks
  assert.equal(ServantComboCalculator._isSubsetMask(maskAB, maskA), true);
  assert.equal(ServantComboCalculator._isSubsetMask(maskAB, maskB), true);
  assert.equal(ServantComboCalculator._isSubsetMask(maskA, maskAB), false);

  // Mask key canonical string
  assert.equal(ServantComboCalculator._maskKey(maskA), String(maskA[0]));
});

test("bitset engine: multi-word bitsets spanning > 32 CEs", () => {
  // 70 distinct CEs requires 3 32-bit words (wordCount = 3)
  const cePool = Array.from({ length: 70 }, (_, i) => String(i + 1).padStart(4, "0"));
  const ceIndexMap = ServantComboCalculator._createIndexMap(cePool);
  const wordCount = Math.ceil(cePool.length / 32);
  assert.equal(wordCount, 3);

  // s1 has CEs in word 0, word 1, word 2
  const s1CEs = ["0001", "0033", "0065"];
  // s2 has CEs in word 0, word 1, word 2
  const s2CEs = ["0001", "0033", "0066"];
  const mask1 = ServantComboCalculator._createMask(s1CEs, ceIndexMap, wordCount);
  const mask2 = ServantComboCalculator._createMask(s2CEs, ceIndexMap, wordCount);

  const inter = ServantComboCalculator._intersectMasks(mask1, mask2);
  assert.ok(inter !== null);
  assert.deepStrictEqual(ServantComboCalculator._decodeMask(inter, cePool), ["0001", "0033"]);
  assert.equal(ServantComboCalculator._isSubsetMask(inter, mask1), true);
  assert.equal(ServantComboCalculator._isSubsetMask(inter, mask2), true);
  assert.equal(ServantComboCalculator._maskKey(inter), `${inter[0]},${inter[1]},${inter[2]}`);

  // Test full combo calculation with multi-word bitsets
  const entries = [
    { servant: { id: "001" }, matchingCEIds: s1CEs },
    { servant: { id: "002" }, matchingCEIds: s2CEs },
  ];
  const { groups } = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "002"]);
  assert.equal(groups.length, 1);
  assert.deepStrictEqual(groups[0].ceIds, ["0001", "0033"]);
  assert.deepStrictEqual(ids(groups[0]), ["001", "002"]);
});

test("bitset engine: _isSubsetMask handles bit 31 (0x80000000) correctly without signed overflow", () => {
  const mask = new Uint32Array([0x80000000]);
  assert.equal(
    ServantComboCalculator._isSubsetMask(mask, mask),
    true,
    "Mask with bit 31 set must be recognized as subset of itself",
  );

  const ceIds = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(4, "0"));
  const entries = [
    { servant: { id: "001" }, matchingCEIds: ceIds },
    { servant: { id: "002" }, matchingCEIds: ceIds },
  ];

  const shared = ServantComboCalculator.buildSharedCEGroups(entries, ["001", "002"]);
  assert.equal(shared.groups.length, 1, "Expected 1 shared group containing all 32 CEs");
  assert.equal(shared.groups[0]?.ceIds.length, 32, "Expected group to retain all 32 CEs including index 31");

  const overlap = ServantComboCalculator.buildServantOverlapGroups(entries, entries[0]);
  assert.equal(overlap.length, 1, "Expected 1 overlap group sharing all 32 CEs");
  assert.equal(overlap[0]?.ceIds.length, 32);
});

test("benchmark & verification: bitset engine on real 471 servant dataset", async () => {
  const { ServantData, TraitCEs } = await import("../src/scripts/data.js");
  const { computeCEMatchMatrix } = await import("../src/scripts/domain.js");
  ServantData.load();

  assert.equal(ServantData.servants.length, 471, "dataset has 471 total playable servants");
  const matrix = computeCEMatchMatrix(ServantData.servants, TraitCEs);
  const allEntries = matrix.results;
  const allIds = ServantData.servants.map((s) => s.id);

  // Benchmark buildSharedCEGroups on all 471 servants
  const start = globalThis.performance.now();
  const resAll = ServantComboCalculator.buildSharedCEGroups(allEntries, allIds);
  const duration = globalThis.performance.now() - start;

  assert.equal(resAll.truncated, false, "all 471 servants must complete without truncation");
  assert.equal(resAll.groups.length, 133, "must produce exactly 133 maximal closed groups");
  assert.equal(resAll.unshared.length, 22, "exactly 22 servants have no matching bond gain CEs");
  assert.ok(resAll.unshared.includes("300700"), "300700 Cu Chulainn (Prototype) is correctly identified as unshared");
  assert.ok(duration < 50, `execution must complete under 50ms, took ${duration.toFixed(2)}ms`);

  // Benchmark buildServantOverlapGroups on Mash Kyrielight
  const mashEntry = allEntries.find((e) => e.servant.id === "800100");
  const t0 = globalThis.performance.now();
  const overlap = ServantComboCalculator.buildServantOverlapGroups(allEntries, mashEntry);
  const overlapDuration = globalThis.performance.now() - t0;

  assert.ok(overlap.length > 0, "Mash Kyrielight must have overlap groups");
  assert.ok(overlapDuration < 20, `overlap execution must complete under 20ms, took ${overlapDuration.toFixed(2)}ms`);
});

test("servant 467: unified François & Francesca Prélat traits, lookup fallback and combo grouping", async () => {
  const { ServantData, TraitCEs } = await import("../src/scripts/data.js");
  const { computeCEMatchMatrix } = await import("../src/scripts/domain.js");
  ServantData.load();

  const svt467 = ServantData.getServant("505600");
  assert.ok(svt467, "Servant 505600 exists");
  assert.equal(svt467.name, "François Prélat");
  assert.equal(svt467.altName, "Francesca Prélat");
  assert.ok(svt467.altImage.includes("servants/505700/000.webp"));
  assert.ok(svt467.traitSet.has("0001"), "has male trait 0001");
  assert.ok(svt467.traitSet.has("0002"), "has female trait 0002");

  // Fallback for legacy split IDs
  assert.equal(ServantData.getServant("467-1"), svt467, "467-1 resolves to 505600");
  assert.equal(ServantData.getServant("467-2"), svt467, "467-2 resolves to 505600");

  // Servant 467 alone is never a combo group
  const matrix = computeCEMatchMatrix([svt467], TraitCEs);
  const singleRes = ServantComboCalculator.buildSharedCEGroups(matrix.results, ["505600"]);
  assert.equal(singleRes.groups.length, 0, "467 alone is not a combo");

  // resolveEntryDisplay for 467
  const entry467 = matrix.results[0];
  const display = ServantData.resolveEntryDisplay(entry467, entry467.matchingCEs);
  assert.equal(display.altDisplayName, "Francesca Prélat");
  assert.ok(display.altImgSrc.includes("servants/505700/000.webp"));
});
