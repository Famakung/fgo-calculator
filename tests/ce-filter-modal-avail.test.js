import { test } from "node:test";
import assert from "node:assert/strict";
import { FilterSections, FilterModalController, createAvailPredicates } from "../src/scripts/filter-sections.js";
import { ServantFilters } from "../src/scripts/domain.js";
import {
  CLASS_FILTERS,
  CLASS_GROUPS,
  RARITY_FILTERS,
  ALIGNMENT_LNC_FILTERS,
  ALIGNMENT_GBE_FILTERS,
  SUB_ATTR_FILTERS,
  GENDER_FILTERS,
} from "../src/scripts/constants.js";

// Mock minimal DOM and storage
class MockClassList {
  constructor() {
    this._set = new Set();
  }
  add(...classes) {
    for (const c of classes) if (c) this._set.add(c);
  }
  remove(...classes) {
    for (const c of classes) this._set.delete(c);
  }
  toggle(c, force) {
    const has = this._set.has(c);
    const next = force !== undefined ? Boolean(force) : !has;
    if (next) this._set.add(c);
    else this._set.delete(c);
    return next;
  }
  contains(c) {
    return this._set.has(c);
  }
}

class MockElement {
  constructor(id = "", tagName = "div") {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.nodeType = tagName === "#fragment" ? 11 : 1;
    this.classList = new MockClassList();
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.disabled = false;
    this.textContent = "";
    this.style = {};
  }
  get className() {
    return [...this.classList._set].join(" ");
  }
  set className(val) {
    this.classList._set.clear();
    if (typeof val === "string") {
      val
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => this.classList._set.add(c));
    }
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  appendChild(child) {
    this.children.push(child);
  }
  replaceChildren(...args) {
    const next = [];
    for (const arg of args) {
      if (arg && arg.nodeType === 11) {
        next.push(...arg.children);
        arg.children = [];
      } else if (arg) {
        next.push(arg);
      }
    }
    this.children = next;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((l) => l !== fn),
    );
  }
  click() {
    if (this.disabled) return;
    const list = this.listeners.get("click") || [];
    for (const fn of list) fn({ type: "click", target: this });
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

const elements = new Map();
function getMockElement(id) {
  if (!elements.has(id)) {
    elements.set(id, new MockElement(id));
  }
  return elements.get(id);
}

globalThis.document = {
  getElementById: (id) => getMockElement(id),
  createElement: (tag) => new MockElement("", tag),
  createDocumentFragment: () => new MockElement("#fragment", "#fragment"),
  querySelector: () => new MockElement(),
  querySelectorAll: () => [],
};

globalThis.window = { innerWidth: 1200 };

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, val) => storage.set(key, String(val)),
};

const { CEFilterApp } = await import("../src/scripts/ce-filter-app.js");

/* -------------------------------------------------------------
 * 1. FilterModalController.selectAll tests
 * ------------------------------------------------------------- */
test("FilterModalController.selectAll: without avail selects all filter options", () => {
  const res = FilterModalController.selectAll();
  assert.equal(res.rarityFilters.length, 6);
  assert.equal(res.groupClassFilters.length, CLASS_GROUPS.length);
  assert.equal(res.classFilters.length, 15);
  assert.equal(res.aliFilters.length, ALIGNMENT_LNC_FILTERS.length);
  assert.equal(res.subAliFilters.length, ALIGNMENT_GBE_FILTERS.length);
  assert.equal(res.subAttrFilters.length, SUB_ATTR_FILTERS.length);
  assert.equal(res.genderFilters.length, GENDER_FILTERS.length);
});

test("FilterModalController.selectAll: with empty avail object selects all filter options", () => {
  const emptyAvail = {
    class: new Set(),
    rarity: new Set(),
    ali: new Set(),
    subAli: new Set(),
    subAttr: new Set(),
    gender: new Set(),
  };
  const res = FilterModalController.selectAll(emptyAvail);
  assert.equal(res.rarityFilters.length, 6);
  assert.equal(res.groupClassFilters.length, CLASS_GROUPS.length);
  assert.equal(res.classFilters.length, 15);
  assert.equal(res.aliFilters.length, ALIGNMENT_LNC_FILTERS.length);
  assert.equal(res.subAliFilters.length, ALIGNMENT_GBE_FILTERS.length);
  assert.equal(res.subAttrFilters.length, SUB_ATTR_FILTERS.length);
  assert.equal(res.genderFilters.length, GENDER_FILTERS.length);
});

test("FilterModalController.selectAll: filters options based on provided avail sets", () => {
  const avail = {
    class: new Set(["0100"]), // Saber only (knight group)
    rarity: new Set(["0405"]),
    ali: new Set(["0300"]), // Lawful
    subAli: new Set([ServantFilters.SUB_ALI_OTHER]), // Other
    subAttr: new Set(["0200"]), // Sky
    gender: new Set(["0002"]), // Female
  };

  const res = FilterModalController.selectAll(avail);
  assert.deepStrictEqual(res.classFilters, ["0100"]);
  assert.deepStrictEqual(res.groupClassFilters, ["knight"]);
  assert.deepStrictEqual(res.rarityFilters, ["0405"]);
  assert.deepStrictEqual(res.aliFilters, ["0300"]);
  assert.deepStrictEqual(res.subAliFilters, [ServantFilters.SUB_ALI_OTHER]);
  assert.deepStrictEqual(res.subAttrFilters, ["0200"]);
  assert.deepStrictEqual(res.genderFilters, ["0002"]);
});

test("FilterModalController.selectAll: executes extraHandler to augment results", () => {
  const avail = { class: new Set(["0100"]), count: new Set([1, 2]) };
  const res = FilterModalController.selectAll(avail, (r) => {
    r.matchCounts = [1, 2];
  });
  assert.deepStrictEqual(res.classFilters, ["0100"]);
  assert.deepStrictEqual(res.matchCounts, [1, 2]);
});

/* -------------------------------------------------------------
 * 2. CEFilterApp._computeAvail tests
 * ------------------------------------------------------------- */
test("CEFilterApp._computeAvail: extracts traits and CE counts accurately", () => {
  const origTraitsOf = CEFilterApp._traitsOf;
  try {
    const fakeTraits = new Map([
      ["mock1", ["0100", "0405", "0002", "0201", "0300", "0303"]], // Saber, 5*, Female, Earth, Lawful, Good
      ["mock2", ["0104", "0404", "0001", "0202", "0301"]], // Caster, 4*, Male, Human, Chaotic (no GBE -> other)
    ]);
    CEFilterApp._traitsOf = (entry) => fakeTraits.get(entry.servant.id) || [];

    const fakeEntries = [
      { matchingCEs: [1, 2], servant: { id: "mock1" } },
      { matchingCEs: [1], servant: { id: "mock2" } },
    ];

    const avail = CEFilterApp._computeAvail(fakeEntries);

    assert.deepStrictEqual([...avail.count].sort(), [1, 2]);
    assert.deepStrictEqual([...avail.class].sort(), ["0100", "0104"]);
    assert.deepStrictEqual([...avail.rarity].sort(), ["0404", "0405"]);
    assert.deepStrictEqual([...avail.gender].sort(), ["0001", "0002"]);
    assert.deepStrictEqual([...avail.subAttr].sort(), ["0201", "0202"]);
    assert.deepStrictEqual([...avail.ali].sort(), ["0300", "0301"]);
    assert.deepStrictEqual([...avail.subAli].sort(), ["0303", ServantFilters.SUB_ALI_OTHER]);
  } finally {
    CEFilterApp._traitsOf = origTraitsOf;
  }
});

test("CEFilterApp._computeAvail: handles empty or null base gracefully", () => {
  const avail = CEFilterApp._computeAvail(null);
  assert.equal(avail.class.size, 0);
  assert.equal(avail.rarity.size, 0);
  assert.equal(avail.ali.size, 0);
  assert.equal(avail.subAli.size, 0);
  assert.equal(avail.subAttr.size, 0);
  assert.equal(avail.gender.size, 0);
  assert.equal(avail.count.size, 0);

  const availEmpty = CEFilterApp._computeAvail([]);
  assert.equal(availEmpty.class.size, 0);
  assert.equal(availEmpty.rarity.size, 0);
  assert.equal(availEmpty.ali.size, 0);
  assert.equal(availEmpty.subAli.size, 0);
  assert.equal(availEmpty.subAttr.size, 0);
  assert.equal(availEmpty.gender.size, 0);
  assert.equal(availEmpty.count.size, 0);
});

test("CEFilterApp._computeAvail: servant with only GBE traits does NOT receive other", () => {
  const origTraitsOf = CEFilterApp._traitsOf;
  try {
    CEFilterApp._traitsOf = () => ["0100", "0300", "0303"]; // Saber, Lawful, Good
    const fakeEntries = [{ matchingCEs: [1], servant: { id: "mock" } }];
    const avail = CEFilterApp._computeAvail(fakeEntries);
    assert.ok(avail.subAli.has("0303"));
    assert.ok(!avail.subAli.has(ServantFilters.SUB_ALI_OTHER));
  } finally {
    CEFilterApp._traitsOf = origTraitsOf;
  }
});

test("CEFilterApp._computeAvail: servant without GBE (e.g. Madness 0306) receives other", () => {
  const origTraitsOf = CEFilterApp._traitsOf;
  try {
    CEFilterApp._traitsOf = () => ["0106", "0301", "0306"]; // Berserker, Chaotic, Madness
    const fakeEntries = [{ matchingCEs: [1], servant: { id: "mock" } }];
    const avail = CEFilterApp._computeAvail(fakeEntries);
    assert.ok(avail.subAli.has(ServantFilters.SUB_ALI_OTHER));
    assert.equal(avail.subAli.size, 1);
  } finally {
    CEFilterApp._traitsOf = origTraitsOf;
  }
});

/* -------------------------------------------------------------
 * 3. FilterModalController.renderStandardRows DOM & availability tests
 * ------------------------------------------------------------- */
test("renderStandardRows: with missing or empty avail, no filter chips are disabled", () => {
  const prefix = "testEmpty";
  const filterState = FilterModalController.createInitial();
  const toggle = () => () => {};

  // Case A: opts = {}
  FilterModalController.renderStandardRows(prefix, filterState, toggle, {});
  [
    `${prefix}RarityFilter`,
    `${prefix}ClassFilter`,
    `${prefix}GroupFilter`,
    `${prefix}AliFilter`,
    `${prefix}SubAliFilter`,
    `${prefix}AttrFilter`,
    `${prefix}GenderFilter`,
  ].forEach((id) => {
    const container = getMockElement(id);
    assert.ok(container.children.length > 0, `${id} should have children`);
    container.children.forEach((btn) => {
      assert.equal(btn.disabled, false, `Button in ${id} should not be disabled`);
      assert.ok(!btn.className.includes("--disabled"), `Button in ${id} should not have --disabled class`);
    });
  });

  // Case B: opts.avail with empty Sets
  const emptyAvail = {
    class: new Set(),
    rarity: new Set(),
    ali: new Set(),
    subAli: new Set(),
    subAttr: new Set(),
    gender: new Set(),
  };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail: emptyAvail });
  [
    `${prefix}RarityFilter`,
    `${prefix}ClassFilter`,
    `${prefix}GroupFilter`,
    `${prefix}AliFilter`,
    `${prefix}SubAliFilter`,
    `${prefix}AttrFilter`,
    `${prefix}GenderFilter`,
  ].forEach((id) => {
    const container = getMockElement(id);
    container.children.forEach((btn) => {
      assert.equal(btn.disabled, false, `Button in ${id} with empty avail sets should not be disabled`);
    });
  });
});

test("renderStandardRows: lockedClasses disables groups and classes outside lock without affecting others", () => {
  const prefix = "testLock";
  const filterState = FilterModalController.createInitial();
  const toggle = () => () => {};

  // Lock to Saber (0100)
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { lockedClasses: ["0100"] });

  const groupContainer = getMockElement(`${prefix}GroupFilter`);
  const knightBtn = groupContainer.children.find((b) => b.textContent === "Three Knights");
  const cavalryBtn = groupContainer.children.find((b) => b.textContent === "Four Cavalries");
  assert.equal(knightBtn.disabled, false, "Three Knights contains Saber so enabled");
  assert.equal(cavalryBtn.disabled, true, "Four Cavalries does not contain Saber so disabled");
  assert.ok(cavalryBtn.className.includes("ce-group-btn--disabled"));

  // Alignment, Sub-attribute, Gender must not be affected by lockedClasses
  const aliContainer = getMockElement(`${prefix}AliFilter`);
  aliContainer.children.forEach((b) => assert.equal(b.disabled, false));
});

test("renderStandardRows: dynamically disables GroupFilter based on avail.class", () => {
  const prefix = "testGroupAvail";
  const filterState = FilterModalController.createInitial();
  let toggledKey = null;
  let toggledIds = null;
  const toggle = (key) => (ids) => {
    toggledKey = key;
    toggledIds = ids;
  };

  // Only Extra I classes available (e.g. Shielder 0107)
  const avail = { class: new Set(["0107"]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail });

  const groupContainer = getMockElement(`${prefix}GroupFilter`);
  const knightBtn = groupContainer.children.find((b) => b.textContent === "Three Knights");
  const cavalryBtn = groupContainer.children.find((b) => b.textContent === "Four Cavalries");
  const extra1Btn = groupContainer.children.find((b) => b.textContent === "Extra I");
  const extra2Btn = groupContainer.children.find((b) => b.textContent === "Extra II");

  assert.equal(extra1Btn.disabled, false, "Extra I contains 0107 -> enabled");
  assert.ok(!extra1Btn.className.includes("--disabled"));
  assert.equal(knightBtn.disabled, true, "Three Knights has 0 results -> disabled");
  assert.ok(knightBtn.className.includes("ce-group-btn--disabled"));
  assert.equal(cavalryBtn.disabled, true, "Four Cavalries has 0 results -> disabled");
  assert.equal(extra2Btn.disabled, true, "Extra II has 0 results -> disabled");

  // Adversarial: clicking disabled group button does NOT toggle
  knightBtn.click();
  assert.equal(toggledKey, null, "Clicking disabled group button should not trigger toggle");

  // Clicking enabled group button DOES toggle
  extra1Btn.click();
  assert.equal(toggledKey, "groupClassFilters");
  assert.deepStrictEqual(toggledIds, ["extra1"]);
});

test("renderStandardRows: dynamically disables AliFilter based on avail.ali", () => {
  const prefix = "testAliAvail";
  const filterState = FilterModalController.createInitial();
  let toggledIds = null;
  const toggle = () => (ids) => {
    toggledIds = ids;
  };

  // Only Lawful (0300) available
  const avail = { ali: new Set(["0300"]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail });

  const aliContainer = getMockElement(`${prefix}AliFilter`);
  const lawfulBtn = aliContainer.children.find((b) => b.textContent === "Lawful");
  const neutralBtn = aliContainer.children.find((b) => b.textContent === "Neutral");
  const chaoticBtn = aliContainer.children.find((b) => b.textContent === "Chaotic");

  assert.equal(lawfulBtn.disabled, false, "Lawful in avail -> enabled");
  assert.ok(!lawfulBtn.className.includes("--disabled"));
  assert.equal(neutralBtn.disabled, true, "Neutral not in avail -> disabled");
  assert.ok(neutralBtn.className.includes("rarity-btn--disabled"));
  assert.equal(chaoticBtn.disabled, true, "Chaotic not in avail -> disabled");
  assert.ok(chaoticBtn.className.includes("rarity-btn--disabled"));

  // Adversarial: clicking disabled Chaotic button does nothing
  chaoticBtn.click();
  assert.equal(toggledIds, null);

  // Clicking enabled Lawful button toggles active and calls toggle
  lawfulBtn.click();
  assert.deepStrictEqual(toggledIds, ["0300"]);
  assert.ok(lawfulBtn.classList.contains("active"));
  assert.equal(lawfulBtn.getAttribute("aria-pressed"), "true");
});

test("renderStandardRows: dynamically disables SubAliFilter and handles Other correctly", () => {
  const prefix = "testSubAliAvail";
  const filterState = FilterModalController.createInitial();
  const toggle = () => () => {};

  // Case A: Only Good (0303) available
  const availGood = { subAli: new Set(["0303"]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail: availGood });

  const containerA = getMockElement(`${prefix}SubAliFilter`);
  const goodBtnA = containerA.children.find((b) => b.textContent === "Good");
  const balancedBtnA = containerA.children.find((b) => b.textContent === "Balanced");
  const evilBtnA = containerA.children.find((b) => b.textContent === "Evil");
  const otherBtnA = containerA.children.find((b) => b.textContent === "Other");

  assert.equal(goodBtnA.disabled, false, "Good in avail -> enabled");
  assert.equal(balancedBtnA.disabled, true, "Balanced not in avail -> disabled");
  assert.equal(evilBtnA.disabled, true, "Evil not in avail -> disabled");
  assert.equal(otherBtnA.disabled, true, "Other not in avail -> disabled");

  // Case B: Only Other available (servants with no GBE traits)
  const availOther = { subAli: new Set([ServantFilters.SUB_ALI_OTHER]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail: availOther });

  const containerB = getMockElement(`${prefix}SubAliFilter`);
  const goodBtnB = containerB.children.find((b) => b.textContent === "Good");
  const otherBtnB = containerB.children.find((b) => b.textContent === "Other");

  assert.equal(goodBtnB.disabled, true, "Good not in avail -> disabled");
  assert.equal(otherBtnB.disabled, false, "Other in avail -> enabled");
  assert.ok(!otherBtnB.className.includes("--disabled"));

  // Case C: Evil + Other available
  const availMixed = { subAli: new Set(["0304", ServantFilters.SUB_ALI_OTHER]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail: availMixed });

  const containerC = getMockElement(`${prefix}SubAliFilter`);
  const goodBtnC = containerC.children.find((b) => b.textContent === "Good");
  const evilBtnC = containerC.children.find((b) => b.textContent === "Evil");
  const otherBtnC = containerC.children.find((b) => b.textContent === "Other");

  assert.equal(goodBtnC.disabled, true, "Good not in avail -> disabled");
  assert.equal(evilBtnC.disabled, false, "Evil in avail -> enabled");
  assert.equal(otherBtnC.disabled, false, "Other in avail -> enabled");
});

test("renderStandardRows: dynamically disables SubAttrFilter based on avail.subAttr", () => {
  const prefix = "testAttrAvail";
  const filterState = FilterModalController.createInitial();
  const toggle = () => () => {};

  // Only Earth (0201) and Human (0202) available
  const avail = { subAttr: new Set(["0201", "0202"]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail });

  const container = getMockElement(`${prefix}AttrFilter`);
  const heavenBtn = container.children.find((b) => b.textContent === "Heaven");
  const earthBtn = container.children.find((b) => b.textContent === "Earth");
  const humanBtn = container.children.find((b) => b.textContent === "Human");
  const starBtn = container.children.find((b) => b.textContent === "Star");
  const beastBtn = container.children.find((b) => b.textContent === "Beast");

  assert.equal(earthBtn.disabled, false, "Earth in avail -> enabled");
  assert.equal(humanBtn.disabled, false, "Human in avail -> enabled");
  assert.equal(heavenBtn.disabled, true, "Heaven not in avail -> disabled");
  assert.equal(starBtn.disabled, true, "Star not in avail -> disabled");
  assert.equal(beastBtn.disabled, true, "Beast not in avail -> disabled");
});

test("renderStandardRows: dynamically disables GenderFilter based on avail.gender", () => {
  const prefix = "testGenderAvail";
  const filterState = FilterModalController.createInitial();
  const toggle = () => () => {};

  // Only Female (0002) available
  const avail = { gender: new Set(["0002"]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail });

  const container = getMockElement(`${prefix}GenderFilter`);
  const maleBtn = container.children.find((b) => b.textContent === "Male");
  const femaleBtn = container.children.find((b) => b.textContent === "Female");
  const unknownBtn = container.children.find((b) => b.textContent === "Unknown");

  assert.equal(femaleBtn.disabled, false, "Female in avail -> enabled");
  assert.equal(maleBtn.disabled, true, "Male not in avail -> disabled");
  assert.equal(unknownBtn.disabled, true, "Unknown not in avail -> disabled");
});

test("renderStandardRows: a selected chip that becomes disabled is painted inactive and aria-pressed false", () => {
  const prefix = "testSelectedDisabled";
  // Filter state has Chaotic (0301) selected
  const filterState = {
    ...FilterModalController.createInitial(),
    aliFilters: ["0301"],
  };
  const toggle = () => () => {};

  // But avail only has Lawful (0300)
  const avail = { ali: new Set(["0300"]) };
  FilterModalController.renderStandardRows(prefix, filterState, toggle, { avail });

  const container = getMockElement(`${prefix}AliFilter`);
  const chaoticBtn = container.children.find((b) => b.textContent === "Chaotic");

  assert.equal(chaoticBtn.disabled, true);
  assert.ok(!chaoticBtn.classList.contains("active"), "Disabled chip must not have active class");
  assert.equal(chaoticBtn.getAttribute("aria-pressed"), "false");
});

/* -------------------------------------------------------------
 * 4. CEFilterApp.renderResults active filter pruning tests
 * ------------------------------------------------------------- */
test("CEFilterApp.renderResults: prunes active filters that no longer exist in CE-filtered results", () => {
  const origTraitsOf = CEFilterApp._traitsOf;
  try {
    // Only Saber, 5*, Female, Earth, Lawful, Good, 1 CE
    CEFilterApp._traitsOf = () => ["0100", "0405", "0002", "0201", "0300", "0303"];

    // Populate state with various active filters, many of which do not match the result
    CEFilterApp.state.classFilters = ["0100", "0104"]; // Saber + Caster
    CEFilterApp.state.groupClassFilters = ["knight", "cavalry"]; // Knight + Cavalry
    CEFilterApp.state.rarityFilters = ["0404", "0405"]; // 4* + 5*
    CEFilterApp.state.aliFilters = ["0300", "0301"]; // Lawful + Chaotic
    CEFilterApp.state.subAliFilters = ["0303", ServantFilters.SUB_ALI_OTHER]; // Good + Other
    CEFilterApp.state.subAttrFilters = ["0200", "0201"]; // Heaven + Earth
    CEFilterApp.state.genderFilters = ["0001", "0002"]; // Male + Female
    CEFilterApp.state.matchCounts = [1, 3]; // 1 CE + 3 CE

    const fakeEntry = {
      matchingCEs: [{ id: 100 }],
      matchingCEIds: new Set([100]),
      servant: { id: "mock1", name: "Mock Saber", image: "img.webp" },
      allTraitNames: [],
      matchedAscensions: [],
      baseMatchesAll: true,
      primaryAscension: null,
    };

    CEFilterApp.renderResults([fakeEntry]);

    assert.deepStrictEqual(CEFilterApp.state.classFilters, ["0100"], "Caster pruned");
    assert.deepStrictEqual(CEFilterApp.state.groupClassFilters, ["knight"], "Cavalry pruned");
    assert.deepStrictEqual(CEFilterApp.state.rarityFilters, ["0405"], "4* pruned");
    assert.deepStrictEqual(CEFilterApp.state.aliFilters, ["0300"], "Chaotic pruned");
    assert.deepStrictEqual(CEFilterApp.state.subAliFilters, ["0303"], "Other pruned");
    assert.deepStrictEqual(CEFilterApp.state.subAttrFilters, ["0201"], "Heaven pruned");
    assert.deepStrictEqual(CEFilterApp.state.genderFilters, ["0002"], "Male pruned");
    assert.deepStrictEqual(CEFilterApp.state.matchCounts, [1], "3 CE pruned");
  } finally {
    CEFilterApp._traitsOf = origTraitsOf;
  }
});

test("CEFilterApp.renderResults: does not wipe active filters when results are empty", () => {
  CEFilterApp.state.classFilters = ["0100"];
  CEFilterApp.state.groupClassFilters = ["knight"];
  CEFilterApp.state.rarityFilters = ["0405"];
  CEFilterApp.state.aliFilters = ["0300"];
  CEFilterApp.state.subAliFilters = ["0303"];
  CEFilterApp.state.subAttrFilters = ["0201"];
  CEFilterApp.state.genderFilters = ["0002"];
  CEFilterApp.state.matchCounts = [1];

  // Render with 0 results
  CEFilterApp.renderResults([]);

  // Active filters should be preserved, not wiped to []
  assert.deepStrictEqual(CEFilterApp.state.classFilters, ["0100"]);
  assert.deepStrictEqual(CEFilterApp.state.groupClassFilters, ["knight"]);
  assert.deepStrictEqual(CEFilterApp.state.rarityFilters, ["0405"]);
  assert.deepStrictEqual(CEFilterApp.state.aliFilters, ["0300"]);
  assert.deepStrictEqual(CEFilterApp.state.subAliFilters, ["0303"]);
  assert.deepStrictEqual(CEFilterApp.state.subAttrFilters, ["0201"]);
  assert.deepStrictEqual(CEFilterApp.state.genderFilters, ["0002"]);
  assert.deepStrictEqual(CEFilterApp.state.matchCounts, [1]);
});

/* -------------------------------------------------------------
 * 5. Edge cases: multi-ascension traits in _computeAvail
 * ------------------------------------------------------------- */
test("CEFilterApp._computeAvail: collects traits across all ascensions when primaryAscension is null", () => {
  const origTraitsOf = CEFilterApp._traitsOf;
  try {
    // Servant with changing alignment across ascensions: 1st Good (0303), 3rd Evil (0304)
    CEFilterApp._traitsOf = (entry) => {
      if (entry.primaryAscension === "001") return ["0100", "0300", "0303"];
      if (entry.primaryAscension === "003") return ["0100", "0300", "0304"];
      return ["0100", "0300", "0303", "0304"]; // All ascensions union
    };

    const entryWithoutPrimary = {
      matchingCEs: [1],
      servant: { id: "multiAsc" },
      primaryAscension: null,
    };
    const availAll = CEFilterApp._computeAvail([entryWithoutPrimary]);
    assert.ok(availAll.subAli.has("0303"));
    assert.ok(availAll.subAli.has("0304"));

    const entryWithPrimary = {
      matchingCEs: [1],
      servant: { id: "multiAsc" },
      primaryAscension: "001",
    };
    const availPrimary = CEFilterApp._computeAvail([entryWithPrimary]);
    assert.ok(availPrimary.subAli.has("0303"));
    assert.ok(!availPrimary.subAli.has("0304"));
  } finally {
    CEFilterApp._traitsOf = origTraitsOf;
  }
});

/* -------------------------------------------------------------
 * 6. Predicate and pruning helper unit tests
 * ------------------------------------------------------------- */
test("createAvailPredicates: standardizes predicate signatures and checks chips or IDs", () => {
  const avail = {
    class: new Set(["0100"]),
    rarity: new Set(["0405"]),
    ali: new Set(["0300"]),
    subAli: new Set(["0303", ServantFilters.SUB_ALI_OTHER]),
    subAttr: new Set(["0201"]),
    gender: new Set(["0002"]),
  };
  const p = createAvailPredicates(avail);

  assert.equal(p.hasRarity({ id: "0405" }), true);
  assert.equal(p.hasRarity({ id: "0404" }), false);
  assert.equal(p.hasRarity("0405"), true);

  assert.equal(p.hasClass({ id: "0100" }), true);
  assert.equal(p.hasClass({ id: "0101" }), false);
  assert.equal(p.hasClass("0100"), true);

  assert.equal(p.hasGroup({ classes: ["0100", "0101"] }), true);
  assert.equal(p.hasGroup({ classes: ["0103", "0104"] }), false);

  assert.equal(p.hasAli({ id: "0300" }), true);
  assert.equal(p.hasAli({ id: "0301" }), false);

  assert.equal(p.hasSubAli({ id: "0303" }), true);
  assert.equal(p.hasSubAli({ id: "0304" }), false);
  assert.equal(p.hasSubAli({ other: true }), true);

  assert.equal(p.hasSubAttr({ id: "0201" }), true);
  assert.equal(p.hasSubAttr({ id: "0202" }), false);

  assert.equal(p.hasGender({ id: "0002" }), true);
  assert.equal(p.hasGender({ id: "0001" }), false);
});

test("CEFilterApp._pruneActiveFilters: prunes active filters matching unavailable traits", () => {
  CEFilterApp.state.classFilters = ["0100", "0101"];
  CEFilterApp.state.groupClassFilters = ["knight", "cavalry"];
  CEFilterApp.state.rarityFilters = ["0404", "0405"];
  CEFilterApp.state.matchCounts = [1, 2, 3];

  const avail = {
    class: new Set(["0100"]),
    rarity: new Set(["0405"]),
    count: new Set([1]),
  };

  CEFilterApp._pruneActiveFilters(avail);

  assert.deepStrictEqual(CEFilterApp.state.classFilters, ["0100"]);
  assert.deepStrictEqual(CEFilterApp.state.groupClassFilters, ["knight"]);
  assert.deepStrictEqual(CEFilterApp.state.rarityFilters, ["0405"]);
  assert.deepStrictEqual(CEFilterApp.state.matchCounts, [1]);
});
