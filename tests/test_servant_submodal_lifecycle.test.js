import { test } from "node:test";
import assert from "node:assert/strict";

/* Comprehensive DOM mock */
class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(c) {
    this._classes.add(c);
  }
  remove(c) {
    this._classes.delete(c);
  }
  contains(c) {
    return this._classes.has(c);
  }
}

class MockElement {
  constructor(id, tagName = "div") {
    this.id = id;
    this.tagName = tagName;
    this.hidden = false;
    this.dataset = {};
    this.classList = new MockClassList();
    this.children = [];
    this._listeners = new Map();
    this.value = "";
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(type, list.filter((l) => l !== fn));
  }
  click() {
    const list = this._listeners.get("click") || [];
    for (const fn of list) fn({ type: "click", target: this });
  }
  setAttribute(k, v) {
    this.dataset[k] = v;
  }
  removeAttribute(k) {
    delete this.dataset[k];
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  appendChild(child) {
    this.children.push(child);
  }
  replaceChildren(...newChildren) {
    this.children = [...newChildren];
  }
}

const elements = new Map();
function getMock(id) {
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
}

const docListeners = new Map();
globalThis.document = {
  getElementById: (id) => getMock(id),
  querySelectorAll: () => [],
  createElement: (tag) => new MockElement("", tag),
  createDocumentFragment: () => new MockElement("#fragment"),
  addEventListener: (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(fn);
  },
  removeEventListener: (type, fn) => {
    const list = docListeners.get(type) || [];
    docListeners.set(type, list.filter((l) => l !== fn));
  },
  dispatchEvent: (event) => {
    const list = docListeners.get(event.type) || [];
    for (const fn of list) fn(event);
  },
};

const { ServantData } = await import("../src/scripts/data.js");
ServantData.load();

const { ServantSelector, AscensionSelector } = await import("../src/scripts/selectors.js");

ServantSelector.init();
AscensionSelector.init();

function triggerEscape() {
  document.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
}

const servantWithAsc = ServantData.servants.find((s) => s.hasAscensions);

test("Scenario 1: Close button (X) on ascensionModal closes only ascensionModal, preserving servantModal and pendingSlot", () => {
  let pendingRemovedCount = 0;
  const callbacks = {
    onSelect: () => {},
    onPendingRemove: () => {
      pendingRemovedCount++;
    },
  };

  // 1. Open ServantSelector with pending = true
  ServantSelector.open(0, true, callbacks);
  assert.equal(ServantSelector.pendingSlot, true);
  assert.equal(getMock("servantModal").classList.contains("open"), true);

  // 2. Click servant with ascensions -> submodal opens
  ServantSelector._handleSingleItemClick(servantWithAsc);
  assert.equal(getMock("ascensionModal").classList.contains("open"), true);
  assert.equal(getMock("servantModal").classList.contains("open"), true);

  // 3. Click Close (X) on ascensionModal -> closes ONLY ascensionModal
  getMock("ascensionModalClose").click();
  assert.equal(getMock("ascensionModal").classList.contains("open"), false);
  assert.equal(getMock("servantModal").classList.contains("open"), true, "servantModal must remain open underneath");
  assert.equal(ServantSelector.pendingSlot, true, "pendingSlot preserved");
  assert.equal(pendingRemovedCount, 0, "No pending remove on submodal X");

  // 4. Cancel servantModal via close button -> cleans up pending slot
  getMock("servantModalClose").click();
  assert.equal(getMock("servantModal").classList.contains("open"), false);
  assert.equal(pendingRemovedCount, 1, "pending slot cleaned up on servantModal close");
});

test("Scenario 3: Escape unwinds servantFilterModal first, then servantModal", () => {
  let pendingRemovedCount = 0;
  const callbacks = {
    onSelect: () => {},
    onPendingRemove: () => {
      pendingRemovedCount++;
    },
  };

  ServantSelector.open(2, true, callbacks);
  assert.equal(getMock("servantModal").classList.contains("open"), true);

  // Open filter modal
  ServantSelector._openFilterModal();
  assert.equal(getMock("servantFilterModal").classList.contains("open"), true);

  // 1st Escape: Closes servantFilterModal only
  triggerEscape();
  assert.equal(getMock("servantFilterModal").classList.contains("open"), false);
  assert.equal(getMock("servantModal").classList.contains("open"), true);
  assert.equal(pendingRemovedCount, 0);

  // 2nd Escape: Closes servantModal and cleans up pending slot
  triggerEscape();
  assert.equal(getMock("servantModal").classList.contains("open"), false);
  assert.equal(pendingRemovedCount, 1);
});

test("Scenario 4: Escape unwinds ascensionModal first, then servantModal", () => {
  let pendingRemovedCount = 0;
  const callbacks = {
    onSelect: () => {},
    onPendingRemove: () => {
      pendingRemovedCount++;
    },
  };

  ServantSelector.open(3, true, callbacks);
  ServantSelector._handleSingleItemClick(servantWithAsc);

  assert.equal(getMock("servantModal").classList.contains("open"), true);
  assert.equal(getMock("ascensionModal").classList.contains("open"), true);

  // 1st Escape: Closes ascensionModal only
  triggerEscape();
  assert.equal(getMock("ascensionModal").classList.contains("open"), false);
  assert.equal(getMock("servantModal").classList.contains("open"), true);
  assert.equal(pendingRemovedCount, 0);

  // 2nd Escape: Closes servantModal and cleans up pending slot
  triggerEscape();
  assert.equal(getMock("servantModal").classList.contains("open"), false);
  assert.equal(pendingRemovedCount, 1);
});

test("Scenario 5: Selecting an ascension closes both modals and calls onSelect without removing slot", () => {
  let selected = null;
  let pendingRemovedCount = 0;
  const callbacks = {
    onSelect: (slotIdx, servantId, asc) => {
      selected = { slotIdx, servantId, asc };
    },
    onPendingRemove: () => {
      pendingRemovedCount++;
    },
  };

  ServantSelector.open(4, true, callbacks);
  ServantSelector._handleSingleItemClick(servantWithAsc);

  // Trigger ascension selection via grid item click
  const ascOptions = ServantData.getAscensionOptions(servantWithAsc.id);
  assert.ok(ascOptions.length > 0);
  const chosenAsc = ascOptions[0];

  // In AscensionSelector.renderGrid, the item click calls:
  ServantSelector.pendingSlot = false;
  AscensionSelector._callbacks?.onSelect?.(AscensionSelector.slotIndex, AscensionSelector.servant.id, chosenAsc);
  AscensionSelector.close();
  ServantSelector.close();

  assert.deepEqual(selected, { slotIdx: 4, servantId: servantWithAsc.id, asc: chosenAsc });
  assert.equal(getMock("ascensionModal").classList.contains("open"), false);
  assert.equal(getMock("servantModal").classList.contains("open"), false);
  assert.equal(pendingRemovedCount, 0, "onPendingRemove must NOT be called on selection");
});

test("Scenario 6: Standalone AscensionSelector opened from portraitArea responds to Escape and Close", () => {
  // servantModal is closed
  assert.equal(getMock("servantModal").classList.contains("open"), false);

  // Open standalone
  AscensionSelector.open(servantWithAsc, 0, {});
  assert.equal(getMock("ascensionModal").classList.contains("open"), true);

  // Escape closes standalone ascensionModal
  triggerEscape();
  assert.equal(getMock("ascensionModal").classList.contains("open"), false);
  assert.equal(getMock("servantModal").classList.contains("open"), false);

  // Re-open and verify close button
  AscensionSelector.open(servantWithAsc, 0, {});
  assert.equal(getMock("ascensionModal").classList.contains("open"), true);
  getMock("ascensionModalClose").click();
  assert.equal(getMock("ascensionModal").classList.contains("open"), false);
  assert.equal(getMock("servantModal").classList.contains("open"), false);
});
