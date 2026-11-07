import { test } from "node:test";
import assert from "node:assert/strict";
import { ServantFilters } from "../src/scripts/domain.js";
import {
  CLASS_FILTERS,
  CLASS_GROUPS,
  SUB_ATTR_FILTERS,
  ALIGNMENT_GBE_FILTERS,
  GENDER_FILTERS,
} from "../src/scripts/constants.js";

const sabers = ["0001", "0100", "0200", "0300", "0303", "0404"];
const helena = ["0002", "0104", "0202", "0301", "0303", "0404", "2780"];
const summerOnly = ["0002", "0103", "0201", "0308", "0404"];
const madnessOnly = ["0001", "0106", "0202", "0306", "0402"];

test("the four class groups tile the fifteen classes exactly once", () => {
  assert.deepEqual(
    CLASS_GROUPS.map((g) => g.key),
    ["knight", "cavalry", "extra1", "extra2"],
  );
  const tiled = CLASS_GROUPS.flatMap((g) => g.classes);
  assert.equal(tiled.length, 15);
  assert.equal(new Set(tiled).size, 15);
  const all = [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra].map((c) => c.id);
  assert.deepEqual([...tiled].sort(), [...all].sort());
});

test("a class group is the row's bound, clipped by a lock", () => {
  assert.equal(ServantFilters.rowScope([]), null);
  assert.equal(ServantFilters.rowScope(undefined, null), null);
  assert.deepEqual(ServantFilters.rowScope(["knight"]), ["0100", "0102", "0101"]);
  assert.equal(ServantFilters.rowScope(["knight", "extra1"]).length, 7);
  assert.deepEqual(ServantFilters.rowScope(["nope"]), null);
  // the quest's party lock clips the bound to what the two have in common, and a group it clips to
  // nothing leaves the lock itself — the party is still that class and nothing else
  assert.deepEqual(ServantFilters.rowScope(["knight"], ["0100", "0107"]), ["0100"]);
  assert.deepEqual(ServantFilters.rowScope(["cavalry"], ["0107"]), ["0107"]);
  // no group: the lock alone is the bound, so a single-class quest still bounds the row
  assert.deepEqual(ServantFilters.rowScope([], ["0100"]), ["0100"]);
});

test("a class pick filters to that pick inside the group, and is ignored from outside it", () => {
  assert.deepEqual(ServantFilters.effectiveClassIds({ groupClassFilters: ["knight"], classFilters: ["0100"] }), [
    "0100",
  ]);
  assert.deepEqual(
    ServantFilters.effectiveClassIds({ groupClassFilters: ["knight"], classFilters: ["0100", "0101"] }),
    ["0100", "0101"],
  );
  // the pick came from outside the group, so it narrows nothing
  assert.deepEqual(ServantFilters.effectiveClassIds({ groupClassFilters: ["knight"], classFilters: ["0107"] }), [
    "0100",
    "0102",
    "0101",
  ]);
  // a group clipped to nothing by the lock is still bound by the lock, pick or no pick
  assert.deepEqual(
    ServantFilters.effectiveClassIds({
      groupClassFilters: ["cavalry"],
      lockedClasses: ["0107"],
      classFilters: ["0100"],
    }),
    ["0107"],
  );
  assert.equal(ServantFilters.effectiveClassIds({}), null);
});

test("picking a class greys nothing: only the group chips and a quest lock bound the row", () => {
  assert.deepEqual(ServantFilters.rowScope(["knight"]), ServantFilters.rowScope(["knight"]));
  assert.equal(ServantFilters.rowScope(["knight"], null).includes("0102"), true);
});

test("no row selected is no filter", () => {
  assert.equal(ServantFilters.match(sabers, {}), true);
});

test("a fresh state is six empty rows, and that is still no filter", () => {
  const blank = {
    classFilters: [],
    rarityFilters: [],
    groupClassFilters: [],
    aliFilters: [],
    subAliFilters: [],
    subAttrFilters: [],
  };
  assert.equal(ServantFilters.match(sabers, blank), true);
  assert.equal(ServantFilters.match(helena, blank), true);
});

test("one row is a union", () => {
  assert.equal(ServantFilters.match(sabers, { rarityFilters: ["0404", "0405"] }), true);
  assert.equal(ServantFilters.match(["0001", "0100", "0403"], { rarityFilters: ["0404", "0405"] }), false);
});

test("rows are ANDed", () => {
  const good = { subAliFilters: ["0303"] };
  assert.equal(ServantFilters.match(helena, good), true);
  const lawful = { aliFilters: ["0300"] };
  assert.equal(ServantFilters.match(helena, lawful), false);
  assert.equal(ServantFilters.match(helena, { ...good, ...lawful }), false);
  assert.equal(ServantFilters.match(helena, { aliFilters: ["0301"], ...good }), true);
});

test("the Other alignment is everything without Good, Balanced or Evil", () => {
  const other = { subAliFilters: [ServantFilters.SUB_ALI_OTHER] };
  assert.equal(ServantFilters.match(summerOnly, other), true);
  assert.equal(ServantFilters.match(madnessOnly, other), true);
  assert.equal(ServantFilters.match(helena, other), false);
});

test("a sub-attribute chip is not a class or a special trait", () => {
  const beast = { subAttrFilters: ["0204"] };
  assert.equal(ServantFilters.match(["0001", "0124", "2821", "0404"], beast), false);
  assert.equal(ServantFilters.match(["0002", "0106", "0204", "0405"], beast), true);
});

test("a group bounds the class row instead of replacing it", () => {
  assert.equal(ServantFilters.match(sabers, { groupClassFilters: ["knight"] }), true);
  assert.equal(
    ServantFilters.match(["0001", "0107", "0200", "0302", "0400"], { groupClassFilters: ["knight"] }),
    false,
  );
  // a class pick carried from outside the group is ignored, never honoured: a Shielder the shielder
  // pick would have let through is still outside the knight scope
  assert.equal(
    ServantFilters.match(["0001", "0107", "0200", "0302", "0400"], {
      groupClassFilters: ["knight"],
      classFilters: ["0107"],
    }),
    false,
  );
  assert.equal(ServantFilters.match(sabers, { groupClassFilters: ["knight"], classFilters: ["0100"] }), true);
});

test("a class pick without a group still filters, and nonsense matches nothing", () => {
  assert.equal(ServantFilters.match(sabers, { classFilters: ["0104"] }), false);
  assert.equal(ServantFilters.match(sabers, { aliFilters: ["nonsense"] }), false);
});

test("an ascension's alignment and sub-attribute reach the row it is filtered on", async () => {
  /* 415 is Chaotic with no second-axis alignment on `base`; Good arrives in her 1st and 2nd ascension and
     Evil in her 3rd, and the 3rd also swaps Human for Earth — the sub-attribute comes from Atlas's
     `ascensionAdd.attribute.ascension`, a field the individuality lists never carry. `base` is the
     intersection of her stages, so it now holds no sub-attribute at all. */
  const { ServantData } = await import("../src/scripts/data.js");
  const assert1 = await import("node:assert/strict");
  ServantData.load();
  const base = ServantData.getTraitsForAscension("505500", "base");
  const first = ServantData.getTraitsForAscension("505500", "000");
  const third = ServantData.getTraitsForAscension("505500", "002");
  assert1.deepEqual(ServantFilters.match(base, { aliFilters: ["0301"] }), true);
  assert1.deepEqual(ServantFilters.match(base, { aliFilters: ["0301"], subAliFilters: ["0303"] }), false);
  assert1.deepEqual(
    ServantFilters.match(first, { aliFilters: ["0301"], subAliFilters: ["0303"], subAttrFilters: ["0202"] }),
    true,
  );
  assert1.deepEqual(
    ServantFilters.match(third, { aliFilters: ["0301"], subAliFilters: ["0304"], subAttrFilters: ["0201"] }),
    true,
  );
  // the 3rd form is Earth, not Human: the attribute replaces rather than joins
  assert1.deepEqual(ServantFilters.match(third, { subAttrFilters: ["0202"] }), false);
  assert1.deepEqual(ServantFilters.match(third, { aliFilters: ["0301"], subAliFilters: ["0303"] }), false);
  assert1.deepEqual(base.filter((t) => t.startsWith("02")).length, 0);
  // 465 Demeter: Heaven in the first two forms, Star in the third
  assert1.deepEqual(
    ServantFilters.match(ServantData.getTraitsForAscension("306400", "000"), { subAttrFilters: ["0200"] }),
    true,
  );
  assert1.deepEqual(
    ServantFilters.match(ServantData.getTraitsForAscension("306400", "002"), { subAttrFilters: ["0203"] }),
    true,
  );
});

test("the picker reads every form, so a per-ascension attribute is findable", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  const assert1 = await import("node:assert/strict");
  ServantData.load();
  // 415's base is the intersection of her stages and holds no sub-attribute at all
  assert1.deepEqual(ServantData.getServant("505500").traits.filter((t) => t.startsWith("02")).length, 0);
  const every = ServantData.getAllTraits("505500");
  assert1.deepEqual(ServantFilters.match(every, { subAttrFilters: ["0202"] }), true); // 1st/2nd form
  assert1.deepEqual(ServantFilters.match(every, { subAttrFilters: ["0201"] }), true); // 3rd form
  assert1.deepEqual(ServantFilters.match(every, { subAliFilters: ["0303"] }), true);
  assert1.deepEqual(ServantFilters.match(every, { subAliFilters: ["0304"] }), true);
  // the union never invents: she is a Caster, never a Saber, and never the Beast attribute
  assert1.deepEqual(ServantFilters.match(every, { classFilters: ["0104"] }), true);
  assert1.deepEqual(ServantFilters.match(every, { classFilters: ["0100"] }), false);
  assert1.deepEqual(ServantFilters.match(every, { subAttrFilters: ["0204"] }), false);
  // a servant with no ascension diffs is unaffected
  assert1.deepEqual([...ServantData.getAllTraits("502300")].sort(), [...ServantData.getServant("502300").traits].sort());
});

test("gender is a row like the others", () => {
  assert.deepEqual(ServantFilters.match(sabers, { genderFilters: ["0001"] }), true);
  assert.deepEqual(ServantFilters.match(sabers, { genderFilters: ["0002"] }), false);
  assert.deepEqual(ServantFilters.match(helena, { genderFilters: ["0001", "0002"] }), true); // union inside the row
  assert.deepEqual(ServantFilters.match(helena, { genderFilters: [], rarityFilters: ["0404"] }), true);
  assert.deepEqual(ServantFilters.match(helena, { genderFilters: ["0003"] }), false);
});

test("the gender row offers the three traits the data uses", () => {
  assert.deepEqual(
    GENDER_FILTERS.map((g) => g.id),
    ["0001", "0002", "0003"],
  );
  assert.deepEqual(
    GENDER_FILTERS.map((g) => g.label),
    ["Male", "Female", "Unknown"],
  );
});

test("Other unions with the chips beside it instead of vetoing them", () => {
  const row = { subAliFilters: [ServantFilters.SUB_ALI_OTHER, "0303"] };
  assert.equal(ServantFilters.match(helena, row), true); // Good: met by the chip beside Other
  assert.equal(ServantFilters.match(summerOnly, row), true); // no second axis: met by Other
  assert.equal(ServantFilters.match(madnessOnly, { subAliFilters: ["0303"] }), false);
  assert.equal(ServantFilters.match(madnessOnly, { subAliFilters: ["0303", "0304"] }), false);
  assert.equal(ServantFilters.match(summerOnly, { subAliFilters: ["0303", "0304"] }), false);
});

test("every chip row's ids are trait ids, except Other", () => {
  assert.deepEqual(
    SUB_ATTR_FILTERS.map((c) => c.id),
    ["0200", "0201", "0202", "0203", "0204"],
  );
  const last = ALIGNMENT_GBE_FILTERS[ALIGNMENT_GBE_FILTERS.length - 1];
  assert.equal(last.other, true);
  assert.equal(last.id, null);
});
