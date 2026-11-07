import { test } from "node:test";
import assert from "node:assert/strict";

/* Mock minimal DOM for ce-servant-select.js */
const elements = new Map();
function getMockElement(id) {
  if (!elements.has(id)) {
    const el = {
      id,
      hidden: false,
      textContent: "",
      clientWidth: 0,
      children: [],
      classList: {
        add() {},
        remove() {},
        contains() {
          return false;
        },
      },
      setAttribute() {},
      replaceChildren(...newChildren) {
        this.children = newChildren;
      },
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener() {},
    };
    elements.set(id, el);
  }
  return elements.get(id);
}

globalThis.document = {
  getElementById: (id) => getMockElement(id),
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    textContent: "",
    disabled: false,
    classList: {
      _classes: new Set(),
      add(...cls) {
        cls.forEach((c) => this._classes.add(c));
      },
      remove(...cls) {
        cls.forEach((c) => this._classes.delete(c));
      },
      contains(c) {
        return this._classes.has(c);
      },
    },
    attributes: {},
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return this.attributes[k];
    },
    replaceChildren(...children) {
      this.children = children;
    },
    appendChild(child) {
      this.children = this.children || [];
      this.children.push(child);
    },
    addEventListener() {},
  }),
  createDocumentFragment: () => ({
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  }),
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { ServantSelect } = await import("../src/scripts/ce-servant-select.js");

test("ServantSelect._effectivePickedIds: 0 pickedIds returns all unique servant IDs from entries", () => {
  ServantSelect.state.pickedIds = [];

  const entries = [
    { servant: { id: "001" }, matchingCEIds: ["0001"] },
    { servant: { id: "001" }, matchingCEIds: ["0002"] }, // multi-ascension duplicate ID
    { servant: { id: "059" }, matchingCEIds: ["0001"] },
    { servant: { id: "373" }, matchingCEIds: ["0003"] },
  ];

  const result = ServantSelect._effectivePickedIds(entries);
  assert.deepStrictEqual(result, ["001", "059", "373"]);
});

test("ServantSelect._effectivePickedIds: >=1 pickedIds returns pickedIds verbatim", () => {
  ServantSelect.state.pickedIds = ["059"];
  const entries = [
    { servant: { id: "001" }, matchingCEIds: ["0001"] },
    { servant: { id: "059" }, matchingCEIds: ["0001"] },
  ];
  assert.deepStrictEqual(ServantSelect._effectivePickedIds(entries), ["059"]);

  ServantSelect.state.pickedIds = ["001", "373"];
  assert.deepStrictEqual(ServantSelect._effectivePickedIds(entries), ["001", "373"]);
});

test("ServantSelect._effectivePickedIds: handles malformed, empty, or null entries gracefully", () => {
  ServantSelect.state.pickedIds = [];

  assert.deepStrictEqual(ServantSelect._effectivePickedIds(null), []);
  assert.deepStrictEqual(ServantSelect._effectivePickedIds(undefined), []);
  assert.deepStrictEqual(ServantSelect._effectivePickedIds([]), []);

  const malformed = [
    null,
    undefined,
    {},
    { servant: null },
    { servant: { id: null } },
    { servant: { id: "" } },
    { servant: { id: "444" } },
  ];
  assert.deepStrictEqual(ServantSelect._effectivePickedIds(malformed), ["444"]);
});

test("ServantSelect._getCols and _getPageSize: calculates 5 rows based on container clientWidth", () => {
  const wrapper = getMockElement("cefilterComboResults");

  // 1 column: cw = 300 -> Math.floor((300 - 16 + 8) / 288) = 1
  wrapper.clientWidth = 300;
  assert.equal(ServantSelect._getCols(), 1);
  assert.equal(ServantSelect._getPageSize(), 5);

  // 2 columns: cw = 600 -> Math.floor((600 - 16 + 8) / 288) = 2
  wrapper.clientWidth = 600;
  assert.equal(ServantSelect._getCols(), 2);
  assert.equal(ServantSelect._getPageSize(), 10);

  // 3 columns: cw = 900 -> Math.floor((900 - 16 + 8) / 288) = 3
  wrapper.clientWidth = 900;
  assert.equal(ServantSelect._getCols(), 3);
  assert.equal(ServantSelect._getPageSize(), 15);

  // 4 columns: cw = 1200 -> Math.floor((1200 - 16 + 8) / 288) = 4
  wrapper.clientWidth = 1200;
  assert.equal(ServantSelect._getCols(), 4);
  assert.equal(ServantSelect._getPageSize(), 20);
});

test("ServantSelect._getCols: falls back to window.innerWidth when clientWidth <= 16", () => {
  const wrapper = getMockElement("cefilterComboResults");
  wrapper.clientWidth = 0;

  globalThis.window = { innerWidth: 1000 };
  assert.equal(ServantSelect._getCols(), 3);
  assert.equal(ServantSelect._getPageSize(), 15);

  globalThis.window = { innerWidth: 940 };
  assert.equal(ServantSelect._getCols(), 3);

  globalThis.window = { innerWidth: 800 };
  assert.equal(ServantSelect._getCols(), 2);
  assert.equal(ServantSelect._getPageSize(), 10);

  globalThis.window = { innerWidth: 660 };
  assert.equal(ServantSelect._getCols(), 2);

  globalThis.window = { innerWidth: 500 };
  assert.equal(ServantSelect._getCols(), 1);
  assert.equal(ServantSelect._getPageSize(), 5);
});

test("ServantSelect._getEmptyNote: handles 0, 1, and >=2 picked servants across combinations and truncation", () => {
  // picked === 0:
  // - combinations exist (groupCount > 0): empty note
  assert.equal(ServantSelect._getEmptyNote(0, 5, false), "");
  // - no combinations and not truncated: empty state note
  assert.equal(ServantSelect._getEmptyNote(0, 0, false), "No CE is usable by two or more servants.");
  // - truncated: empty note (handled by truncatedEl)
  assert.equal(ServantSelect._getEmptyNote(0, 0, true), "");
  assert.equal(ServantSelect._getEmptyNote(0, 5, true), "");

  // picked === 1: always shows "Add one more servant"
  assert.equal(
    ServantSelect._getEmptyNote(1, 0, false),
    "Add one more servant to see which Craft Essences they share.",
  );
  assert.equal(ServantSelect._getEmptyNote(1, 0, true), "Add one more servant to see which Craft Essences they share.");
  assert.equal(
    ServantSelect._getEmptyNote(1, 2, false),
    "Add one more servant to see which Craft Essences they share.",
  );

  // picked >= 2:
  // - combinations exist: empty note
  assert.equal(ServantSelect._getEmptyNote(2, 3, false), "");
  assert.equal(ServantSelect._getEmptyNote(4, 1, false), "");
  // - no combinations and not truncated: scoped note
  assert.equal(ServantSelect._getEmptyNote(2, 0, false), "No CE is usable by two or more of these servants.");
  assert.equal(ServantSelect._getEmptyNote(3, 0, false), "No CE is usable by two or more of these servants.");
  // - truncated: empty note (handled by truncatedEl)
  assert.equal(ServantSelect._getEmptyNote(2, 0, true), "");
  assert.equal(ServantSelect._getEmptyNote(2, 3, true), "");
});

test("ServantSelect._paintUnsharedNote: only visible when picked >= 2 and unshared > 0", () => {
  const el = getMockElement("cefilterComboUnshared");

  // 0 picks: hidden even if unshared array is non-empty
  ServantSelect._paintUnsharedNote(["001"], 0);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, "");

  // 1 pick: hidden even if unshared array is non-empty
  ServantSelect._paintUnsharedNote(["001"], 1);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, "");

  // 2 picks with 0 unshared: hidden
  ServantSelect._paintUnsharedNote([], 2);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, "");

  // 2 picks with unshared: shown
  ServantSelect._paintUnsharedNote(["001"], 2);
  assert.equal(el.hidden, false);
  assert.ok(el.textContent.includes("No shared CE with:"));
});

test("ServantSelect._renderPagination: updates both top and bottom pagination containers", () => {
  const top = getMockElement("cefilterComboPaginationTop");
  const bottom = getMockElement("cefilterComboPaginationBottom");

  // totalPages = 0 hides both containers and clears them
  ServantSelect._renderPagination(0);
  assert.equal(top.hidden, true);
  assert.equal(bottom.hidden, true);
  assert.deepStrictEqual(top.children, []);
  assert.deepStrictEqual(bottom.children, []);

  // totalPages > 0 shows both containers and builds controls
  ServantSelect.state.currentPage = 1;
  ServantSelect._renderPagination(5);
  assert.equal(top.hidden, false);
  assert.equal(bottom.hidden, false);
  assert.ok(top.children.length > 0);
  assert.ok(bottom.children.length > 0);
});

test("ServantSelect.setServants: updates pickedIds deduplicated, re-renders and saves", () => {
  let saved = null;
  const origSave = ServantSelect._savePicks;
  const origRender = ServantSelect.render;
  const origRenderChips = ServantSelect.renderChips;
  let renderCalled = false;
  let renderChipsCalled = false;
  ServantSelect._savePicks = () => {
    saved = ServantSelect.state.pickedIds;
  };
  ServantSelect.render = () => {
    renderCalled = true;
  };
  ServantSelect.renderChips = () => {
    renderChipsCalled = true;
  };

  try {
    ServantSelect.setServants(["001", "002", "001", null, ""]);
    assert.deepEqual(ServantSelect.state.pickedIds, ["001", "002"]);
    assert.deepEqual(saved, ["001", "002"]);
    assert.equal(renderCalled, true);
    assert.equal(renderChipsCalled, true);
  } finally {
    ServantSelect._savePicks = origSave;
    ServantSelect.render = origRender;
    ServantSelect.renderChips = origRenderChips;
  }
});

test("ServantSelect._loadPicks: migrates legacy 467-1 and 467-2 to 467 and dedupes", async () => {
  const { CEFilterStore } = await import("../src/scripts/ce-servant-select.js");
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();
  const origRead = CEFilterStore.read;
  CEFilterStore.read = () => ({ servantPicks: ["001", "467-1", "467-2", "002"] });
  try {
    const loaded = ServantSelect._loadPicks();
    assert.deepEqual(loaded, ["001", "467", "002"]);
  } finally {
    CEFilterStore.read = origRead;
  }
});

test("ServantSelect._buildChip: builds swap portrait for servant 467", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();
  const chip = ServantSelect._buildChip("467");
  assert.ok(chip);
  const swapWrap = chip.children[0];
  assert.equal(swapWrap.className, "servant-swap-wrap");
  assert.equal(swapWrap.children.length, 2);
  assert.ok(swapWrap.children[0].classList.contains("servant-swap-a"));
  assert.ok(swapWrap.children[1].classList.contains("servant-swap-b"));
  assert.equal(swapWrap.children[1].attributes["aria-hidden"], "true");
});

test("DOMFactory: createSwapImg and fillSwapName", async () => {
  const { DOMFactory } = await import("../src/scripts/presentation.js");
  const wrap = DOMFactory.createSwapImg({
    src: "servants/467/000.webp",
    altSrc: "servants/467/001.webp",
    className: "portrait",
    attrs: { alt: "François Prélat", title: "François Prélat / Francesca Prélat" },
  });
  assert.equal(wrap.className, "servant-swap-wrap");
  assert.equal(wrap.children.length, 2);
  assert.ok(wrap.children[0].classList.contains("servant-swap-a"));
  assert.ok(wrap.children[1].classList.contains("servant-swap-b"));

  const nameEl = globalThis.document.createElement("div");
  DOMFactory.fillSwapName(nameEl, "François Prélat", "Francesca Prélat");
  assert.ok(nameEl.classList.contains("servant-swap-name"));
  assert.equal(nameEl.children.length, 2);
  assert.equal(nameEl.children[0].textContent, "François Prélat");
  assert.equal(nameEl.children[1].textContent, "Francesca Prélat");
});
