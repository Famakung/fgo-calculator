import { test } from "node:test";
import assert from "node:assert/strict";

/* Mock minimal document for selectors.js */
const elements = new Map();
function getMockElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      hidden: false,
      dataset: {},
      classList: {
        add() {},
        remove() {},
        contains() {
          return false;
        },
      },
      addEventListener() {},
      setAttribute() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      replaceChildren() {},
    });
  }
  return elements.get(id);
}

globalThis.document = {
  getElementById: (id) => getMockElement(id),
  querySelectorAll: () => [],
  createElement: () => ({
    dataset: {},
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      },
    },
    setAttribute() {},
    appendChild() {},
    addEventListener() {},
  }),
  createDocumentFragment: () => ({
    appendChild() {},
  }),
  addEventListener() {},
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

test("open() with multi: true unhides footer and initializes _selectedIds", () => {
  const footer = getMockElement("servantModalFooter");
  ServantSelector.open(0, false, null, { multi: true, selected: ["001", "002"] });
  assert.equal(footer.hidden, false);
  assert.ok(ServantSelector._selectedIds.has("001"));
  assert.ok(ServantSelector._selectedIds.has("002"));
  assert.equal(ServantSelector._selectedIds.size, 2);

  ServantSelector.close();
  assert.equal(footer.hidden, true);
});

test("open() with multi: false (single select) hides footer", () => {
  const footer = getMockElement("servantModalFooter");
  ServantSelector.open(0, false, null, { multi: false });
  assert.equal(footer.hidden, true);
  ServantSelector.close();
});

test("multi-select staging: item click updates _selectedIds, OK calls onApply, close discards unapplied", () => {
  let appliedPicks = null;
  let toggleCalled = false;
  const callbacks = {
    onApply: (ids) => {
      appliedPicks = ids;
    },
    onToggle: () => {
      toggleCalled = true;
    },
  };

  ServantSelector.open(0, false, callbacks, { multi: true, selected: ["001"] });

  const dummyItem = {
    classList: {
      contains: () => false,
      add() {},
      remove() {},
    },
  };

  // Click 002 -> stages 002, does NOT call onToggle because onApply is passed
  ServantSelector._handleMultiItemClick(dummyItem, "002");
  assert.ok(ServantSelector._selectedIds.has("002"));
  assert.equal(toggleCalled, false);
  assert.equal(appliedPicks, null);

  // Click Default -> clears staged selection
  ServantSelector._defaultMulti();
  assert.equal(ServantSelector._selectedIds.size, 0);

  // Re-add 001
  ServantSelector._handleMultiItemClick(dummyItem, "001");
  assert.ok(ServantSelector._selectedIds.has("001"));

  // Click OK -> triggers onApply and closes
  ServantSelector._okMulti();
  assert.deepEqual(appliedPicks, ["001"]);
  assert.equal(ServantSelector.activeSlotIndex, null);
});

test("multi-select: _selectAllMulti selects all filtered servants", () => {
  const orig = ServantSelector.getFilteredServants;
  ServantSelector.getFilteredServants = () => [{ id: "001" }, { id: "002" }];
  try {
    ServantSelector.open(0, false, null, { multi: true, selected: [] });
    assert.equal(ServantSelector._selectedIds.size, 0);

    ServantSelector._selectAllMulti();
    assert.equal(ServantSelector._selectedIds.size, 2);
    assert.ok(ServantSelector._selectedIds.has("001"));
    assert.ok(ServantSelector._selectedIds.has("002"));

    ServantSelector.close();
  } finally {
    ServantSelector.getFilteredServants = orig;
  }
});

test("multi-select: _defaultMulti clears all staged selections including those hidden by current filter", () => {
  // Start with 001 and 002 staged
  ServantSelector.open(0, false, null, { multi: true, selected: ["001", "002"] });
  assert.equal(ServantSelector._selectedIds.size, 2);

  // Even if grid only renders 002 (e.g. 001 hidden by filter), default clears all staged IDs
  ServantSelector._defaultMulti();
  assert.equal(ServantSelector._selectedIds.size, 0);

  ServantSelector.close();
});

test("multi-select: _selectAllMulti preserves previously selected servants outside current filter", () => {
  const orig = ServantSelector.getFilteredServants;
  // Filter currently shows only 003, but 001 was already selected
  ServantSelector.getFilteredServants = () => [{ id: "003" }];
  try {
    ServantSelector.open(0, false, null, { multi: true, selected: ["001"] });
    assert.equal(ServantSelector._selectedIds.size, 1);
    assert.ok(ServantSelector._selectedIds.has("001"));

    ServantSelector._selectAllMulti();
    // Must contain both 001 (previously selected) and 003 (from current filter)
    assert.equal(ServantSelector._selectedIds.size, 2);
    assert.ok(ServantSelector._selectedIds.has("001"));
    assert.ok(ServantSelector._selectedIds.has("003"));

    ServantSelector.close();
  } finally {
    ServantSelector.getFilteredServants = orig;
  }
});

test("multi-select: cancel or escape discards staged changes without calling onApply", () => {
  let applied = null;
  const callbacks = {
    onApply: (ids) => {
      applied = ids;
    },
  };

  // Open with 001
  ServantSelector.open(0, false, callbacks, { multi: true, selected: ["001"] });

  // Stage addition of 002
  const dummyItem = { classList: { contains: () => false, add() {}, remove() {} } };
  ServantSelector._handleMultiItemClick(dummyItem, "002");
  assert.ok(ServantSelector._selectedIds.has("002"));

  // Close (simulating Cancel button, backdrop click, or Escape key)
  ServantSelector.close();
  assert.equal(applied, null, "onApply must not be called on close/cancel");

  // Verify modal state is reset
  assert.equal(ServantSelector.activeSlotIndex, null);
  const footer = getMockElement("servantModalFooter");
  assert.equal(footer.hidden, true);
});

test("single-select mode: immediately executes single click and keeps footer hidden", () => {
  let selectedServant = null;
  const callbacks = {
    onSelect: (_slot, id) => {
      selectedServant = id;
    },
  };

  const footer = getMockElement("servantModalFooter");
  ServantSelector.open(1, false, callbacks, { multi: false, skipAscension: true });
  assert.equal(footer.hidden, true);

  // Single click directly invokes onSelect and closes
  ServantSelector._handleSingleItemClick({ id: "059", hasAscensions: false });
  assert.equal(selectedServant, "059");
  assert.equal(footer.hidden, true);
  assert.equal(ServantSelector.activeSlotIndex, null);
});
