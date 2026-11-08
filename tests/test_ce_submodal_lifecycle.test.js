import { test } from "node:test";
import assert from "node:assert/strict";

/* Minimal DOM mock */
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
  constructor(id) {
    this.id = id;
    this.classList = new MockClassList();
    this.dataset = {};
    this._listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  click() {
    const list = this._listeners.get("click") || [];
    for (const fn of list) fn({ type: "click", target: this });
  }
  setAttribute() {}
  replaceChildren() {}
  appendChild() {}
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
  createElement: (tag) => new MockElement(tag),
  createDocumentFragment: () => new MockElement("#fragment"),
  addEventListener: (type, fn) => {
    if (!docListeners.has(type)) docListeners.set(type, []);
    docListeners.get(type).push(fn);
  },
  dispatchEvent: (event) => {
    const list = docListeners.get(event.type) || [];
    for (const fn of list) fn(event);
  },
};

const { CESelector, CESubSelector } = await import("../src/scripts/selectors.js");

CESelector.init();
CESubSelector.init();

function triggerEscape() {
  document.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault() {},
    stopPropagation() {},
  });
}

test("Scenario 1: Close button (X) on ceSubModal closes only ceSubModal, preserving ceModal and pendingSlot", () => {
  let pendingRemovedCount = 0;
  const callbacks = {
    onSelect: () => {},
    onPendingRemove: () => {
      pendingRemovedCount++;
    },
  };

  // 1. Open CE selector with pending = true
  CESelector.open(0, true, callbacks);
  assert.equal(CESelector.pendingSlot, true);
  assert.equal(getMock("ceModal").classList.contains("open"), true);

  // 2. Open group CE
  const groupCE = { id: "9400970", name: "Heroic Portrait", isGroup: true, options: [] };
  CESubSelector.open(groupCE, 0, callbacks);
  assert.equal(getMock("ceSubModal").classList.contains("open"), true);
  assert.equal(getMock("ceModal").classList.contains("open"), true);

  // 3. User clicks Close (X) on ceSubModal -> closes ONLY ceSubModal
  getMock("ceSubModalClose").click();
  assert.equal(getMock("ceSubModal").classList.contains("open"), false);
  assert.equal(getMock("ceModal").classList.contains("open"), true, "ceModal must remain open underneath");
  assert.equal(CESelector.pendingSlot, true, "pendingSlot must still be true after sub-modal close");
  assert.equal(pendingRemovedCount, 0, "No pending remove on submodal X");

  // 4. User cancels out of ceModal via close button
  getMock("ceModalClose").click();
  assert.equal(getMock("ceModal").classList.contains("open"), false);
  assert.equal(pendingRemovedCount, 1, "pending slot cleaned up on parent modal close");
});

test("Scenario 3: Escape unwinds ceSubModal first, then ceModal", () => {
  let pendingRemovedCount = 0;
  const callbacks = {
    onSelect: () => {},
    onPendingRemove: () => {
      pendingRemovedCount++;
    },
  };

  CESelector.open(2, true, callbacks);
  const groupCE = { id: "9400970", name: "Heroic Portrait", isGroup: true, options: [] };
  CESubSelector.open(groupCE, 2, callbacks);

  assert.equal(getMock("ceModal").classList.contains("open"), true);
  assert.equal(getMock("ceSubModal").classList.contains("open"), true);

  // 1st Escape: Closes ceSubModal only
  triggerEscape();
  assert.equal(getMock("ceSubModal").classList.contains("open"), false);
  assert.equal(getMock("ceModal").classList.contains("open"), true);
  assert.equal(pendingRemovedCount, 0);

  // 2nd Escape: Closes ceModal and removes pending slot
  triggerEscape();
  assert.equal(getMock("ceModal").classList.contains("open"), false);
  assert.equal(pendingRemovedCount, 1);
});
