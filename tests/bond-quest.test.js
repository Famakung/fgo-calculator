import { test } from "node:test";
import assert from "node:assert/strict";
import { Quest } from "../src/scripts/domain.js";
import { GRAND_CLASSES, GRAND_DIFFICULTIES, CLASS_FILTERS } from "../src/scripts/constants.js";

test("a free quest pays its own figure, and Custom pays what was typed", () => {
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "fq83" }), 845);
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "fq84" }), 855);
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "custom" }, 1234), 1234);
  // past the input's ceiling the box clamps it back
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "custom" }, 999999), 99999);
});

test("a grand duel pays its difficulty whatever the class, and nothing pays zero", () => {
  assert.equal(Quest.bondPerRun({ questMain: "gd", questClass: "0100", questDiff: "1" }), 3164);
  assert.equal(Quest.bondPerRun({ questMain: "gd", questClass: "extra", questDiff: "7" }), 4748);
  assert.equal(Quest.bondPerRun({ questMain: "gd", questDiff: "" }), 0);
  assert.equal(Quest.bondPerRun({ questMain: "" }), 0);
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "gone" }), 0);
});

test("the difficulties rise with their level, seven steps from Lv.100 to Lv.100★★★", () => {
  assert.equal(GRAND_DIFFICULTIES.length, 7);
  GRAND_DIFFICULTIES.reduce((prev, d) => {
    assert.ok(d.bond > prev, `${d.roman} must pay more than the level below it`);
    return d.bond;
  }, 0);
});

test("the eleven grand choices cover every class once, and All unlocks the party", () => {
  assert.equal(GRAND_CLASSES.length, 11);
  assert.equal(GRAND_CLASSES.filter((c) => c.key === "all").length, 1);
  assert.deepEqual(
    GRAND_CLASSES.filter((c) => c.classes && c.classes.length === 1).map((c) => c.classes[0]),
    [...CLASS_FILTERS.standard.map((c) => c.id)],
  );
  assert.deepEqual(Quest.classIds("all"), null);
  assert.deepEqual(Quest.classIds(""), null);
  assert.deepEqual(Quest.classIds("0100"), ["0100"]);
  assert.deepEqual(Quest.classIds("extra1"), ["0107", "0108", "0110", "0115"]);
  assert.deepEqual(Quest.classIds("extra2"), ["0109", "0117", "0120", "0124"]);
  assert.equal(Quest.classIds("extra").length, 8);
  assert.deepEqual(Quest.classIds("nope"), null);
});

test("the picker filters on what was picked, kept inside the quest's group", () => {
  const extra1 = ["0107", "0108", "0110", "0115"];
  // nothing picked inside a group is the whole group, never the roster
  assert.deepEqual(Quest.pickedClassIds([], extra1), extra1);
  assert.deepEqual(Quest.pickedClassIds(undefined, extra1), extra1);
  assert.deepEqual(Quest.pickedClassIds(["0107"], extra1), ["0107"]);
  // a row restored from another quest cannot reach outside the group it is locked to
  assert.deepEqual(Quest.pickedClassIds(["0100", "0107"], extra1), ["0107"]);
  assert.deepEqual(Quest.pickedClassIds(["0100"], extra1), extra1);
  // no group: the row's own selection rules, and empty means no class filter
  assert.deepEqual(Quest.pickedClassIds(["0100"], null), ["0100"]);
  assert.deepEqual(Quest.pickedClassIds([], null), []);
});

test("the party check reads the servant's own class trait", () => {
  const saber = ["0001", "0100", "0203", "0405"];
  assert.equal(Quest.matchesClass(saber, "0100"), true);
  assert.equal(Quest.matchesClass(saber, "extra1"), false);
  // an unrestricted choice lets anything through, and a servant with no class trait never matches
  assert.equal(Quest.matchesClass(saber, "all"), true);
  assert.equal(Quest.matchesClass([], "extra"), false);
  assert.equal(Quest.matchesClass(undefined, "0100"), false);
});
