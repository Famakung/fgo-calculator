import { test } from "node:test";
import assert from "node:assert/strict";
import { CEList, CEById, CEData, TraitCEs } from "../src/scripts/data.js";
import { SlotCEs, Validator } from "../src/scripts/domain.js";

/* Mock localStorage for BondApp and CEFilterStore */
const blobs = new Map();
globalThis.localStorage = {
  getItem: (k) => (blobs.has(k) ? blobs.get(k) : null),
  setItem: (k, v) => blobs.set(k, String(v)),
  removeItem: (k) => blobs.delete(k),
  clear: () => blobs.clear(),
};

const BOND_KEY = "fgo_bond_calculator_data";
const FILTER_KEY = "fgo_ce_filter_data";

const { BondApp } = await import("../src/scripts/bond-app.js");
const { CEFilterApp } = await import("../src/scripts/ce-filter-app.js");
const { CEFilterStore } = await import("../src/scripts/ce-servant-select.js");

/* =========================================================================
   Dimension 1: CE Grouping, Ordering & Image Resolution
   ========================================================================= */

test("CEList is strictly ordered by collectionNo ascending", () => {
  assert.ok(CEList.length >= 24, `Expected at least 24 CEs, got ${CEList.length}`);
  for (let i = 1; i < CEList.length; i++) {
    const prev = CEList[i - 1];
    const curr = CEList[i];
    assert.ok(
      prev.collectionNo < curr.collectionNo,
      `CEList not sorted ascending: [${i - 1}] cno ${prev.collectionNo} (${prev.id}) vs [${i}] cno ${curr.collectionNo} (${curr.id})`,
    );
  }
});

test("9400970 (cno 99) comes before 9308100 (cno 1973) despite lexical ordering", () => {
  const idx9400970 = CEList.findIndex((ce) => ce.id === "9400970");
  const idx9308100 = CEList.findIndex((ce) => ce.id === "9308100");
  assert.ok(idx9400970 !== -1, "9400970 not found in CEList");
  assert.ok(idx9308100 !== -1, "9308100 not found in CEList");
  assert.ok(idx9400970 < idx9308100, `Expected 9400970 (idx ${idx9400970}) before 9308100 (idx ${idx9308100})`);
});

test("Grouped CE options are strictly ordered by collectionNo ascending", () => {
  const grouped = CEList.filter((ce) => ce.isGroup);
  assert.ok(grouped.length >= 3, `Expected at least 3 grouped CEs, got ${grouped.length}`);

  for (const group of grouped) {
    assert.ok(Array.isArray(group.options), `Group ${group.id} missing options array`);
    assert.ok(group.options.length > 0, `Group ${group.id} has empty options`);
    for (let i = 1; i < group.options.length; i++) {
      const prev = group.options[i - 1];
      const curr = group.options[i];
      assert.ok(
        prev.collectionNo <= curr.collectionNo,
        `Group ${group.id} options out of order: [${i - 1}] cno ${prev.collectionNo} vs [${i}] cno ${curr.collectionNo}`,
      );
    }
  }
});

test("Heroic Portrait (9400970) resolves image to Mash option (9400970)", () => {
  const ce = CEById.get("9400970");
  assert.ok(ce, "Heroic Portrait not found in CEById");
  assert.match(ce.image, /^craft_essences\/9400970\.webp/);
  assert.match(ce.thumbImage, /^craft_essences\/9400970\.webp/);
});

test("Heroic Spirit Apex (9311310) resolves image to Mash groupImage (9311450)", () => {
  const ce = CEById.get("9311310");
  assert.ok(ce, "Heroic Spirit Apex not found in CEById");
  assert.match(ce.image, /^craft_essences\/9311450\.webp/);
  assert.match(ce.thumbImage, /^craft_essences\/9311450\.webp/);
});

test("Heroic Spirit Encounter (9308100) resolves image to Saber (9308100) and is present in TraitCEs", () => {
  const ce = CEById.get("9308100");
  assert.ok(ce, "Heroic Spirit Encounter not found in CEById");
  assert.match(ce.image, /^craft_essences\/9308100\.webp/);
  assert.match(ce.thumbImage, /^craft_essences\/9308100\.webp/);
  assert.deepEqual(ce.traits, ["2883"]);

  const inTraitCEs = TraitCEs.find((c) => c.id === "9308100");
  assert.ok(inTraitCEs, "9308100 must be included in TraitCEs");
  assert.match(inTraitCEs.image, /^craft_essences\/9308100\.webp/);
});

/* =========================================================================
   Dimension 2: Search Indexing
   ========================================================================= */

test("CE search index contains padded cno, unpadded cno, 7-digit Atlas ID, and name", () => {
  const checkSearch = (id, cno, name) => {
    const ce = CEById.get(id);
    assert.ok(ce, `CE ${id} not found`);
    const qPad = String(cno).padStart(4, "0");
    const qUnpad = String(cno);
    const qId = id;
    const qName = name.toLowerCase();

    assert.ok(ce._search.includes(qPad), `CE ${id} _search does not include padded cno ${qPad}`);
    assert.ok(ce._search.includes(qUnpad), `CE ${id} _search does not include unpadded cno ${qUnpad}`);
    assert.ok(ce._search.includes(qId), `CE ${id} _search does not include Atlas ID ${qId}`);
    assert.ok(ce._search.includes(qName), `CE ${id} _search does not include name ${qName}`);
  };

  checkSearch("9400970", 99, "Heroic Portrait");
  checkSearch("9401970", 330, "Chaldea Lunchtime");
  checkSearch("9403520", 910, "Chaldea Teatime");
  checkSearch("9308100", 1973, "Heroic Spirit Encounter");
  checkSearch("9311310", 2512, "Heroic Spirit Apex");
  checkSearch("9409490", 2701, "Gun Dealer");
});

test("CEList filter matching behaves correctly for padded, unpadded, ID, and name queries", () => {
  const matchCE = (query) => {
    const q = query.toLowerCase().trim();
    return CEList.filter((c) =>
      c._search ? c._search.includes(q) : c.id.includes(q) || c.name.toLowerCase().includes(q),
    );
  };

  assert.equal(matchCE("0099")[0]?.id, "9400970");
  assert.equal(matchCE("99")[0]?.id, "9400970");
  assert.equal(matchCE("9400970")[0]?.id, "9400970");
  assert.equal(matchCE("heroic portrait")[0]?.id, "9400970");

  assert.equal(matchCE("0330")[0]?.id, "9401970");
  assert.equal(matchCE("330")[0]?.id, "9401970");
  assert.equal(matchCE("9401970")[0]?.id, "9401970");
  assert.equal(matchCE("lunchtime")[0]?.id, "9401970");

  assert.equal(matchCE("0910")[0]?.id, "9403520");
  assert.equal(matchCE("910")[0]?.id, "9403520");
  assert.equal(matchCE("9403520")[0]?.id, "9403520");
  assert.equal(matchCE("teatime")[0]?.id, "9403520");
});

/* =========================================================================
   Dimension 3: Backward-Compatible localStorage Migration
   ========================================================================= */

test("CEData.migrateId maps all known legacy collectionNos and preserves Atlas IDs", () => {
  // Padded 4-digit
  assert.equal(CEData.migrateId("0099"), "9400970");
  assert.equal(CEData.migrateId("0100"), "9400980");
  assert.equal(CEData.migrateId("0330"), "9401970");
  assert.equal(CEData.migrateId("0910"), "9403520");
  assert.equal(CEData.migrateId("1949"), "9407480");
  assert.equal(CEData.migrateId("1973"), "9308100");
  assert.equal(CEData.migrateId("2512"), "9311310");
  assert.equal(CEData.migrateId("2526"), "9311450");
  assert.equal(CEData.migrateId("2583"), "9409210");
  assert.equal(CEData.migrateId("2607"), "9409320");
  assert.equal(CEData.migrateId("2701"), "9409490");

  // Unpadded strings
  assert.equal(CEData.migrateId("99"), "9400970");
  assert.equal(CEData.migrateId("100"), "9400980");
  assert.equal(CEData.migrateId("330"), "9401970");
  assert.equal(CEData.migrateId("910"), "9403520");
  assert.equal(CEData.migrateId("1973"), "9308100");
  assert.equal(CEData.migrateId("2512"), "9311310");
  assert.equal(CEData.migrateId("2526"), "9311450");

  // Numeric literals
  assert.equal(CEData.migrateId(99), "9400970");
  assert.equal(CEData.migrateId(330), "9401970");
  assert.equal(CEData.migrateId(910), "9403520");
  assert.equal(CEData.migrateId(2512), "9311310");

  // Already-migrated 7-digit Atlas IDs
  assert.equal(CEData.migrateId("9400970"), "9400970");
  assert.equal(CEData.migrateId("9401970"), "9401970");
  assert.equal(CEData.migrateId("9403520"), "9403520");
  assert.equal(CEData.migrateId("9308100"), "9308100");
  assert.equal(CEData.migrateId("9311310"), "9311310");
  assert.equal(CEData.migrateId("9311450"), "9311450");

  // Whitespace-padded strings
  assert.equal(CEData.migrateId("  0099  "), "9400970");
  assert.equal(CEData.migrateId("  9400970  "), "9400970");

  // Malformed / non-existent / edge cases
  assert.equal(CEData.migrateId(null), null);
  assert.equal(CEData.migrateId(undefined), undefined);
  assert.equal(CEData.migrateId(""), "");
  assert.equal(CEData.migrateId("nonexistent"), "nonexistent");
  assert.equal(CEData.migrateId("9999999"), "9999999");
  assert.equal(CEData.migrateId("0"), "0");
  assert.equal(CEData.migrateId("-1"), "-1");
});

test("CEData.migrateEntry handles strings, legacy group objects, already-migrated objects, and malformed inputs", () => {
  // String and numeric primitive inputs
  assert.equal(CEData.migrateEntry("0910"), "9403520");
  assert.equal(CEData.migrateEntry("9403520"), "9403520");
  assert.equal(CEData.migrateEntry(910), "9403520");
  assert.equal(CEData.migrateEntry(9403520), "9403520");
  assert.equal(CEData.migrateEntry(99), "9400970");

  // Numeric primitive inputs
  assert.equal(CEData.migrateEntry(910), "9403520");
  assert.equal(CEData.migrateEntry(330), "9401970");

  // Legacy group objects
  assert.deepEqual(CEData.migrateEntry({ groupId: "0099", optionId: "0100" }), {
    groupId: "9400970",
    optionId: "9400980",
  });
  assert.deepEqual(CEData.migrateEntry({ groupId: "2512", optionId: "2526" }), {
    groupId: "9311310",
    optionId: "9311450",
  });

  // Already-migrated group objects
  assert.deepEqual(CEData.migrateEntry({ groupId: "9400970", optionId: "9400980" }), {
    groupId: "9400970",
    optionId: "9400980",
  });

  // Group object with extra metadata preserved
  assert.deepEqual(CEData.migrateEntry({ groupId: "0099", optionId: "0100", customFlag: true }), {
    groupId: "9400970",
    optionId: "9400980",
    customFlag: true,
  });

  // Object without optionId
  assert.deepEqual(CEData.migrateEntry({ groupId: "0099" }), {
    groupId: "9400970",
  });

  // Malformed inputs
  assert.equal(CEData.migrateEntry(null), null);
  assert.equal(CEData.migrateEntry(undefined), undefined);
  assert.deepEqual(CEData.migrateEntry({}), {});
  assert.deepEqual(CEData.migrateEntry({ otherField: "abc" }), { otherField: "abc" });
});

test("BondApp.loadState migrates CE lists in both state.slots and state.parties", () => {
  blobs.clear();
  const rawSave = {
    questMain: "gd",
    questClass: "0100",
    slots: [
      {
        servantId: "100100",
        ces: ["0910", { groupId: "0099", optionId: "0100" }],
        grand: true,
      },
    ],
    parties: {
      "0101": [
        {
          servantId: "200100",
          ces: ["0330", { groupId: "2512", optionId: "2526" }],
          grand: true,
        },
      ],
      "0102": [
        {
          servantId: "300100",
          ces: ["9403520", { groupId: "9400970", optionId: "9400980" }],
          grand: false,
        },
      ],
    },
  };

  blobs.set(BOND_KEY, JSON.stringify(rawSave));
  const loaded = BondApp.loadState();

  // Verify live slots (which was Saber "0100")
  assert.deepEqual(loaded.slots[0].ces, ["9403520", { groupId: "9400970", optionId: "9400980" }]);

  // Verify archer party in parties ("0101")
  assert.deepEqual(loaded.parties["0101"][0].ces, ["9401970", { groupId: "9311310", optionId: "9311450" }]);

  // Verify lancer party in parties ("0102", already migrated remains clean)
  assert.deepEqual(loaded.parties["0102"][0].ces, ["9403520"]); // grand was false so clamped to 1
});

test("CEFilterApp._loadPicks migrates legacy padded, unpadded, and dedupes Atlas IDs", () => {
  blobs.clear();
  // 1949 -> 9407480 (From NFF with Love)
  // 99 / 0099 -> 9400970 (Heroic Portrait)
  // 1973 -> 9308100 (Heroic Spirit Encounter)
  CEFilterStore.write({
    cePicks: ["1949", "9407480", "99", "0099", "9308100", "junk", null, "9999999"],
    ceMode: "all",
  });

  CEFilterApp._loadPicks();

  // 9400970 and 9407480 and 9308100 exist in CEById, deduplicated, invalid/unknown dropped
  assert.deepStrictEqual(CEFilterApp.state.selectedCEs, ["9407480", "9400970", "9308100"]);
});
