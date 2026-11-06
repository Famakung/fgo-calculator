import { test } from "node:test";
import assert from "node:assert/strict";

/* Mock minimal document for selectors.js */
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({
    classList: { add() {} },
    setAttribute() {},
    appendChild() {},
  }),
  createDocumentFragment: () => ({
    appendChild() {},
  }),
};

const { ServantSelector } = await import("../src/scripts/selectors.js");

test("resetFilters clears every filter row, draft filters, and search query", () => {
  ServantSelector.classFilters = ["0100"];
  ServantSelector.rarityFilters = ["0405"];
  ServantSelector.groupClassFilters = ["knight"];
  ServantSelector.aliFilters = ["0300"];
  ServantSelector.subAliFilters = ["0303"];
  ServantSelector.subAttrFilters = ["0200"];
  ServantSelector.genderFilters = ["0001"];
  ServantSelector.draftFilters = { rarityFilters: ["0405"] };
  ServantSelector._searchQuery = "Artoria";

  ServantSelector.resetFilters();

  assert.deepEqual(ServantSelector.classFilters, []);
  assert.deepEqual(ServantSelector.rarityFilters, []);
  assert.deepEqual(ServantSelector.groupClassFilters, []);
  assert.deepEqual(ServantSelector.aliFilters, []);
  assert.deepEqual(ServantSelector.subAliFilters, []);
  assert.deepEqual(ServantSelector.subAttrFilters, []);
  assert.deepEqual(ServantSelector.genderFilters, []);
  assert.equal(ServantSelector.draftFilters, null);
  assert.equal(ServantSelector._searchQuery, "");
});

test("open() resets filters if lockClasses changes", () => {
  ServantSelector.lockedClasses = ["0100"];
  ServantSelector.classFilters = ["0100"];
  ServantSelector.rarityFilters = ["0405"];

  // Open with Archer lockClasses
  ServantSelector.open(0, false, null, { lockClasses: ["0101"] });

  assert.deepEqual(ServantSelector.classFilters, []);
  assert.deepEqual(ServantSelector.rarityFilters, []);
  assert.deepEqual(ServantSelector.lockedClasses, ["0101"]);
});

test("open() preserves filters if lockClasses stays identical", () => {
  ServantSelector.lockedClasses = ["0100"];
  ServantSelector.classFilters = ["0100"];
  ServantSelector.rarityFilters = ["0405"];

  // Open with same lockClasses
  ServantSelector.open(1, false, null, { lockClasses: ["0100"] });

  assert.deepEqual(ServantSelector.classFilters, ["0100"]);
  assert.deepEqual(ServantSelector.rarityFilters, ["0405"]);
});

test("open() resets filters when switching between locked (Grand Duel) and unlocked (Free Quest)", () => {
  ServantSelector.lockedClasses = ["0100"];
  ServantSelector.classFilters = ["0100"];

  // Open without lockClasses (Free Quest)
  ServantSelector.open(0, false, null, {});

  assert.deepEqual(ServantSelector.classFilters, []);
  assert.equal(ServantSelector.lockedClasses, null);

  // Set filter in Free Quest
  ServantSelector.classFilters = ["0102"];

  // Switch to Grand Duel Saber
  ServantSelector.open(0, false, null, { lockClasses: ["0100"] });

  assert.deepEqual(ServantSelector.classFilters, []);
  assert.deepEqual(ServantSelector.lockedClasses, ["0100"]);
});
