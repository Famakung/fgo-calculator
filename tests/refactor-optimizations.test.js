import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  TraitMatcher,
  computeCEMatchMatrix,
  ServantComboCalculator,
  ServantFilters,
  ServantSort,
} from "../src/scripts/domain.js";

describe("TraitMatcher", () => {
  test("matches single trait", () => {
    const servantTraitSet = new Set(["0100", "0405", "1001"]);
    const ce = { traits: ["1001"], traitGroups: [], alsoMatch: [] };
    assert.equal(TraitMatcher.matches(servantTraitSet, ce), true);

    const ceMismatch = { traits: ["9999"], traitGroups: [], alsoMatch: [] };
    assert.equal(TraitMatcher.matches(servantTraitSet, ceMismatch), false);
  });

  test("matches matchAll traits (AND logic)", () => {
    const servantTraitSet = new Set(["0100", "1001", "1002"]);
    const ceMatch = { traits: ["1001", "1002"], matchAll: true, traitGroups: [], alsoMatch: [] };
    assert.equal(TraitMatcher.matches(servantTraitSet, ceMatch), true);

    const ceMissingOne = { traits: ["1001", "9999"], matchAll: true, traitGroups: [], alsoMatch: [] };
    assert.equal(TraitMatcher.matches(servantTraitSet, ceMissingOne), false);
  });

  test("matches traitGroups (AND of OR groups)", () => {
    const servantTraitSet = new Set(["0100", "1001", "2002"]);
    const ce = {
      traits: [],
      traitGroups: [
        ["1001", "1009"], // group 1: OR
        ["2001", "2002"], // group 2: OR
      ],
      alsoMatch: [],
    };
    assert.equal(TraitMatcher.matches(servantTraitSet, ce), true);

    const ceFailsGroup = {
      traits: [],
      traitGroups: [
        ["1001", "1009"],
        ["3001", "3002"],
      ],
      alsoMatch: [],
    };
    assert.equal(TraitMatcher.matches(servantTraitSet, ceFailsGroup), false);
  });

  test("alsoMatch provides alternate match branch", () => {
    const servantTraitSet = new Set(["0100", "3000"]);
    const ce = {
      traits: ["9999"],
      traitGroups: [],
      alsoMatch: ["3000"],
    };
    assert.equal(TraitMatcher.matches(servantTraitSet, ce), true);
  });
});

describe("computeCEMatchMatrix", () => {
  test("computes matches and inverted index accurately", () => {
    const servants = [
      {
        id: "001",
        name: "Servant A",
        hasAscensions: false,
        traits: ["0100", "1001"],
        traitSet: new Set(["0100", "1001"]),
      },
      {
        id: "002",
        name: "Servant B",
        hasAscensions: false,
        traits: ["0101", "1002"],
        traitSet: new Set(["0101", "1002"]),
      },
    ];
    const traitCEs = [
      { id: "ce1", traits: ["1001"], traitGroups: [], alsoMatch: [] },
      { id: "ce2", traits: ["1002"], traitGroups: [], alsoMatch: [] },
      { id: "ce3", traits: ["0100"], traitGroups: [], alsoMatch: [] },
    ];
    const traitNames = { "0100": "Saber", 1001: "Female", 1002: "Male" };

    const { results, index } = computeCEMatchMatrix(servants, traitCEs, traitNames);
    assert.equal(results.length, 2);
    assert.equal(results[0].servant.id, "001");
    assert.deepEqual(results[0].matchingCEIds, ["ce1", "ce3"]);
    assert.deepEqual(results[1].matchingCEIds, ["ce2"]);

    assert.deepEqual(index["ce1"], [0]);
    assert.deepEqual(index["ce2"], [1]);
    assert.deepEqual(index["ce3"], [0]);
  });
});

describe("ServantComboCalculator.buildServantOverlapGroups", () => {
  test("produces maximal closed intersection groups matching expected combinations", () => {
    const clickedEntry = {
      servant: { id: "001" },
      matchingCEIds: ["ceA", "ceB", "ceC"],
    };

    const allMatches = [
      clickedEntry,
      {
        servant: { id: "002" },
        matchingCEIds: ["ceA", "ceB"],
      },
      {
        servant: { id: "003" },
        matchingCEIds: ["ceB", "ceC"],
      },
      {
        servant: { id: "004" },
        matchingCEIds: ["ceA", "ceB", "ceC"],
      },
      {
        servant: { id: "005" },
        matchingCEIds: ["ceZ"], // no overlap
      },
    ];

    const groups = ServantComboCalculator.buildServantOverlapGroups(allMatches, clickedEntry);
    assert.ok(groups.length > 0);

    // Group with ceA, ceB, ceC should be shared by 004
    const fullGroup = groups.find((g) => g.ceIds.length === 3);
    assert.ok(fullGroup);
    assert.deepEqual(fullGroup.ceIds, ["ceA", "ceB", "ceC"]);
    assert.equal(fullGroup.otherMembers.length, 1);
    assert.equal(fullGroup.otherMembers[0].servant.id, "004");

    // Group with ceA, ceB should be shared by 002 and 004
    const abGroup = groups.find((g) => g.ceIds.length === 2 && g.ceIds.includes("ceA") && g.ceIds.includes("ceB"));
    assert.ok(abGroup);
    assert.equal(abGroup.otherMembers.length, 2);
    assert.deepEqual(abGroup.otherMembers.map((m) => m.servant.id).sort(), ["002", "004"]);
  });

  test("runs in < 15ms for large overlapping sets without exponential explosion", () => {
    const ceIds = Array.from({ length: 25 }, (_, i) => `ce_${i}`);
    const clickedEntry = {
      servant: { id: "hero" },
      matchingCEIds: ceIds,
    };

    const allMatches = [clickedEntry];
    for (let s = 1; s <= 20; s++) {
      allMatches.push({
        servant: { id: `svt_${s}` },
        matchingCEIds: ceIds.filter((_, idx) => (idx + s) % 3 === 0),
      });
    }

    const t0 = globalThis.performance.now();
    const groups = ServantComboCalculator.buildServantOverlapGroups(allMatches, clickedEntry);
    const duration = globalThis.performance.now() - t0;

    assert.ok(duration < 50, `Expected < 50ms, took ${duration}ms`);
    assert.ok(Array.isArray(groups));
  });
});

describe("ServantFilters.compile", () => {
  const traits = ["0100", "0405", "0300", "0303", "0201", "0002"]; // Saber (0100), 5★ (0405), Lawful (0300), Good (0303), Earth (0201), Female (0002)

  test("matches when filters are empty", () => {
    const matcher = ServantFilters.compile({});
    assert.equal(matcher(traits), true);
  });

  test("filters by class and rarity correctly", () => {
    const matchSaber = ServantFilters.compile({ classFilters: ["0100"] });
    assert.equal(matchSaber(traits), true);

    const matchArcher = ServantFilters.compile({ classFilters: ["0101"] });
    assert.equal(matchArcher(traits), false);

    const match5Star = ServantFilters.compile({ rarityFilters: ["0405"] });
    assert.equal(match5Star(traits), true);

    const match4Star = ServantFilters.compile({ rarityFilters: ["0404"] });
    assert.equal(match4Star(traits), false);
  });

  test("handles subAliFilters with Other correctly", () => {
    const matchGood = ServantFilters.compile({ subAliFilters: ["0303"] });
    assert.equal(matchGood(traits), true);

    // A servant without GBE (Good/Balanced/Evil) has Other
    const otherTraits = ["0100", "0405", "0300", "0201"];
    const matchOther = ServantFilters.compile({ subAliFilters: [ServantFilters.SUB_ALI_OTHER] });
    assert.equal(matchOther(otherTraits), true);
    assert.equal(matchOther(traits), false); // traits has 0303 (Good)

    // Select all subAli includes Good and Other
    const matchAllSubAli = ServantFilters.compile({
      subAliFilters: ["0303", "0305", "0304", ServantFilters.SUB_ALI_OTHER],
    });
    assert.equal(matchAllSubAli(traits), true);
    assert.equal(matchAllSubAli(otherTraits), true);
  });

  test("handles Set trait input with identical results", () => {
    const traitSet = new Set(traits);
    const otherTraitSet = new Set(["0100", "0405", "0300", "0201"]);

    const matchSaber = ServantFilters.compile({ classFilters: ["0100"] });
    assert.equal(matchSaber(traitSet), true);

    const matchArcher = ServantFilters.compile({ classFilters: ["0101"] });
    assert.equal(matchArcher(traitSet), false);

    const matchOther = ServantFilters.compile({ subAliFilters: [ServantFilters.SUB_ALI_OTHER] });
    assert.equal(matchOther(otherTraitSet), true);
    assert.equal(matchOther(traitSet), false);

    const filters = {
      classFilters: ["0100", "0101"],
      rarityFilters: ["0405"],
      aliFilters: ["0300"],
    };
    const compiled = ServantFilters.compile(filters);
    assert.equal(compiled(traitSet), true);
    assert.equal(compiled(new Set(["0102", "0405"])), false);
  });

  test("parity between ServantFilters.compile and ServantFilters.match", () => {
    const filters = {
      classFilters: ["0100", "0101"],
      rarityFilters: ["0405"],
      aliFilters: ["0300"],
    };
    const compiled = ServantFilters.compile(filters);
    assert.equal(compiled(traits), ServantFilters.match(traits, filters));

    const mismatchTraits = ["0102", "0405"];
    assert.equal(compiled(mismatchTraits), ServantFilters.match(mismatchTraits, filters));
  });
});

describe("ServantSort.sorted", () => {
  const servants = [
    { id: "100", traits: ["0100", "0403"] }, // Saber 3★
    { id: "002", traits: ["0101", "0405"] }, // Archer 5★
    { id: "015", traits: ["0100", "0405"] }, // Saber 5★
    { id: "001", traits: ["0100", "0404"] }, // Saber 4★
  ];

  test("sorts by ID ascending and descending", () => {
    const asc = ServantSort.sorted(servants, "id", "asc");
    assert.deepEqual(
      asc.map((s) => s.id),
      ["001", "002", "015", "100"],
    );

    const desc = ServantSort.sorted(servants, "id", "desc");
    assert.deepEqual(
      desc.map((s) => s.id),
      ["100", "015", "002", "001"],
    );
  });

  test("sorts by rarity with ID tie-breaking", () => {
    const asc = ServantSort.sorted(servants, "rarity", "asc");
    assert.deepEqual(
      asc.map((s) => s.id),
      ["100", "001", "002", "015"],
    );

    const desc = ServantSort.sorted(servants, "rarity", "desc");
    assert.deepEqual(
      desc.map((s) => s.id),
      ["015", "002", "001", "100"],
    );
  });
});
