import { test } from "node:test";
import assert from "node:assert/strict";
import process from "node:process";

/* Mock minimal DOM for presentation and selector tests */
const elements = new Map();
function getMockElement(id) {
  if (!elements.has(id)) {
    const el = createMockElement("div");
    el.id = id;
    elements.set(id, el);
  }
  return elements.get(id);
}

function createMockElement(tag) {
  let _className = "";
  const el = {
    tagName: tag.toUpperCase(),
    textContent: "",
    disabled: false,
    value: "",
    dataset: {},
    style: {},
    children: [],
    classList: {
      _classes: new Set(),
      add(...cls) {
        cls.forEach((c) => {
          this._classes.add(c);
          _className = [...this._classes].join(" ");
        });
      },
      remove(...cls) {
        cls.forEach((c) => {
          this._classes.delete(c);
          _className = [...this._classes].join(" ");
        });
      },
      contains(c) {
        return this._classes.has(c);
      },
    },
    attributes: {},
    setAttribute(k, v) {
      this.attributes[k] = v;
      if (k === "value") this.value = v;
    },
    getAttribute(k) {
      return this.attributes[k];
    },
    replaceChildren(...children) {
      this.children = [];
      for (const item of children) {
        if (item && item.nodeType === 11) {
          this.children.push(...item.children);
          item.children = [];
        } else if (item) {
          this.children.push(item);
        }
      }
    },
    appendChild(child) {
      if (child && child.nodeType === 11) {
        this.children.push(...child.children);
        child.children = [];
      } else if (child) {
        this.children.push(child);
      }
    },
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === "string") {
          this.children.push({ textContent: n });
        } else if (n && n.nodeType === 11) {
          this.children.push(...n.children);
          n.children = [];
        } else if (n) {
          this.children.push(n);
        }
      }
    },
    scrollIntoView() {},
    addEventListener() {},
    querySelector(sel) {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        const findRecursive = (node) => {
          for (const child of node.children || []) {
            if (child.classList && child.classList.contains(cls)) return child;
            const nested = findRecursive(child);
            if (nested) return nested;
          }
          return null;
        };
        return findRecursive(this);
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        const result = [];
        const findRecursive = (node) => {
          for (const child of node.children || []) {
            if (child.classList && child.classList.contains(cls)) result.push(child);
            findRecursive(child);
          }
        };
        findRecursive(this);
        return result;
      }
      return [];
    },
  };
  Object.defineProperty(el, "className", {
    get() {
      return _className;
    },
    set(val) {
      _className = val;
      el.classList._classes = new Set(String(val).split(" ").filter(Boolean));
    },
  });
  return el;
}

globalThis.document = {
  getElementById: (id) => getMockElement(id),
  createElement: (tag) => createMockElement(tag),
  createDocumentFragment: () => ({
    nodeType: 11,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
  documentElement: {
    getAttribute: () => "bond",
  },
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

globalThis.alert = () => {};

test("servant 467: data and schema invariants", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  const svt = ServantData.getServant("505600");
  assert.ok(svt, "Servant 505600 (cno 467) must exist in ServantData");
  assert.equal(svt.id, "505600");
  assert.equal(svt.collectionNo, 467);
  assert.equal(svt.altId, "505700");
  assert.equal(svt.name, "François Prélat");
  assert.equal(svt.altName, "Francesca Prélat");
  assert.equal(svt.hasAscensions, false);
  assert.ok(svt.image.includes("servants/505600/000.webp"));
  assert.ok(svt.altImage.includes("servants/505700/000.webp"));

  // Traits check: both male (0001) and female (0002), but not unknown gender (0003)
  assert.ok(svt.traitSet.has("0001"), "must contain male trait 0001");
  assert.ok(svt.traitSet.has("0002"), "must contain female trait 0002");
  assert.ok(!svt.traitSet.has("0003"), "must NOT contain unknown-gender trait 0003");

  // Legacy split ID resolution
  assert.equal(ServantData.getServant("467"), svt, "467 must resolve to 505600");
  assert.equal(ServantData.getServant("467-1"), svt, "467-1 must resolve to 505600");
  assert.equal(ServantData.getServant("467-2"), svt, "467-2 must resolve to 505600");
  assert.equal(ServantData.getServant("467-99"), svt, "467-99 must resolve to 505600");
  assert.equal(ServantData.getServant("nonexistent"), null);
});

test("ServantData.migrateId: maps legacy collection numbers and 467 splits to Atlas svt IDs", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  // Legacy collection numbers (string and number)
  assert.equal(ServantData.migrateId("001"), "800100");
  assert.equal(ServantData.migrateId("1"), "800100");
  assert.equal(ServantData.migrateId("002"), "100100");
  assert.equal(ServantData.migrateId("467"), "505600");

  // 467 split variants
  assert.equal(ServantData.migrateId("467-1"), "505600");
  assert.equal(ServantData.migrateId("467-2"), "505600");

  // Already-valid Atlas IDs pass through unchanged
  assert.equal(ServantData.migrateId("800100"), "800100");
  assert.equal(ServantData.migrateId("100100"), "100100");
  assert.equal(ServantData.migrateId("505600"), "505600");

  // Unknown IDs and falsy values pass through unchanged
  assert.equal(ServantData.migrateId("999999"), "999999");
  assert.equal(ServantData.migrateId(null), null);
  assert.equal(ServantData.migrateId(""), "");
});

test("servant 467: Bond Calculator lookup and ascension helpers", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  // Bond table lookup
  const table467 = ServantData.getBondGrowth("505600");
  assert.ok(Array.isArray(table467), "Bond growth table must be an array for 505600");
  assert.equal(table467.length > 0, true);

  // Split and legacy IDs also return the growth table
  assert.equal(ServantData.getBondGrowth("467"), table467);
  assert.equal(ServantData.getBondGrowth("467-1"), table467);
  assert.equal(ServantData.getBondGrowth("467-2"), table467);

  // Ascension helpers
  assert.equal(ServantData.getDefaultAscension("505600", null), null, "non-ascension servant returns null");
  assert.equal(ServantData.getDefaultAscension("467-1", null), null);
  assert.equal(ServantData.getDefaultAscension("505600", "001"), "001");

  assert.equal(ServantData.getAscensionName("505600", null), "François Prélat");
  assert.equal(ServantData.getAscensionName("505600", "001"), "Francesca Prélat");

  const defaultImg = ServantData.getImageForAscension("505600", null);
  assert.ok(defaultImg.includes("servants/505600/000.webp"), `Default image is 000.webp: ${defaultImg}`);
});

test("servant 467: search and filter behavior in modal picker", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  const { ServantFilters } = await import("../src/scripts/domain.js");
  ServantData.load();

  const svt = ServantData.getServant("467");
  assert.ok(svt._search.includes("françois"), "search index includes 'françois'");
  assert.ok(svt._search.includes("francesca"), "search index includes 'francesca'");
  assert.ok(svt._search.includes("prélat"), "search index includes 'prélat'");
  assert.ok(svt._search.includes("467"), "search index includes '467'");

  // Gender filter matching
  const matchMale = ServantFilters.compile({ genderFilters: ["0001"] });
  assert.equal(matchMale(svt.traitSet), true, "matches Male filter");

  const matchFemale = ServantFilters.compile({ genderFilters: ["0002"] });
  assert.equal(matchFemale(svt.traitSet), true, "matches Female filter");

  const matchBoth = ServantFilters.compile({ genderFilters: ["0001", "0002"] });
  assert.equal(matchBoth(svt.traitSet), true, "matches Both Male and Female filter");

  const matchUnknown = ServantFilters.compile({ genderFilters: ["0003"] });
  assert.equal(matchUnknown(svt.traitSet), false, "does NOT match Unknown gender filter");
});

test("servant 467: combo and overlap calculations never form single-servant group", async () => {
  const { ServantData, TraitCEs } = await import("../src/scripts/data.js");
  const { ServantComboCalculator, computeCEMatchMatrix } = await import("../src/scripts/domain.js");
  ServantData.load();

  const svt467 = ServantData.getServant("505600");
  const svt001 = ServantData.getServant("800100"); // Mash

  // 1. Single picked 467 produces 0 shared CE groups
  const matrix1 = computeCEMatchMatrix([svt467], TraitCEs);
  const res1 = ServantComboCalculator.buildSharedCEGroups(matrix1.results, ["505600"]);
  assert.equal(res1.groups.length, 0, "467 alone produces 0 combo groups");

  // 2. 467 + 001 produces valid shared CE groups with both servants
  const matrix2 = computeCEMatchMatrix([svt467, svt001], TraitCEs);
  const res2 = ServantComboCalculator.buildSharedCEGroups(matrix2.results, ["505600", "800100"]);
  assert.ok(res2.groups.length > 0, "467 + Mash produces shared CE groups");
  for (const group of res2.groups) {
    const servantIds = new Set(group.members.map((m) => m.servant.id));
    assert.equal(servantIds.size >= 2, true, "Every group must have at least 2 distinct servants");
  }

  // 3. buildServantOverlapGroups when clicking 467's result card
  const entry467 = matrix2.results.find((r) => r.servant.id === "505600");
  const overlaps = ServantComboCalculator.buildServantOverlapGroups(matrix2.results, entry467);
  for (const group of overlaps) {
    for (const other of group.otherMembers) {
      assert.notEqual(other.servant.id, "505600", "Other members must not include 467");
    }
  }
});

test("servant 467: legacy localStorage migration in ServantSelect._loadPicks vs Validator.validatePicks", async () => {
  const { Validator } = await import("../src/scripts/domain.js");
  const { ServantSelect, CEFilterStore } = await import("../src/scripts/ce-servant-select.js");
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  // Raw validatePicks rejects hyphenated IDs
  assert.deepEqual(Validator.validatePicks(["467-1", "467-2"]), [], "validatePicks contract rejects hyphenated IDs");

  // ServantSelect._loadPicks safely migrates and dedupes
  const origRead = CEFilterStore.read;
  CEFilterStore.read = () => ({ servantPicks: ["467-1", "467-2", "001"] });
  try {
    const loaded = ServantSelect._loadPicks();
    assert.deepEqual(loaded, ["505600", "800100"], "migrates 467-1 and 467-2 to 505600 and 001 to 800100 and dedupes");
  } finally {
    CEFilterStore.read = origRead;
  }
});

test("servant 467: DOM presentation, swap image, and overlap modal title", async () => {
  const { ServantData, TraitCEs } = await import("../src/scripts/data.js");
  const { computeCEMatchMatrix } = await import("../src/scripts/domain.js");
  const { ComboCardRenderer } = await import("../src/scripts/presentation.js");
  const { CEServantOverlap } = await import("../src/scripts/selectors.js");
  ServantData.load();

  const svt467 = ServantData.getServant("505600");
  const matrix = computeCEMatchMatrix([svt467], TraitCEs);
  const entry467 = matrix.results[0];

  // 1. ComboCardRenderer builds swap cell
  const cell = ComboCardRenderer.buildServantCell(entry467, entry467.matchingCEs);
  assert.ok(cell);
  const swapWrap = cell.querySelector(".servant-swap-wrap");
  assert.ok(swapWrap, "ComboCardRenderer must create .servant-swap-wrap for 467");
  assert.equal(swapWrap.children.length, 2);
  assert.ok(swapWrap.children[0].classList.contains("servant-swap-a"));
  assert.ok(swapWrap.children[1].classList.contains("servant-swap-b"));

  // 2. CEServantOverlap.open sets title with swap name for 467
  const titleEl = getMockElement("ceOverlapTitle");
  getMockElement("ceOverlapModal");

  CEServantOverlap.init(() => matrix.results);
  CEServantOverlap.open(entry467);
  assert.ok(titleEl.classList.contains("servant-swap-name"), "titleEl must have servant-swap-name for 467");
  assert.equal(titleEl.children.length, 2);
  assert.equal(titleEl.children[0].textContent, "François Prélat");
  assert.equal(titleEl.children[1].textContent, "Francesca Prélat");

  // Opening for servant without altName clears swap name
  const svt001 = ServantData.getServant("800100");
  const entry001 = { servant: svt001, matchingCEs: [] };
  CEServantOverlap.open(entry001);
  assert.equal(titleEl.classList.contains("servant-swap-name"), false);
  assert.equal(titleEl.textContent, "Mash Kyrielight");
});

test("regression: across all 474 servants, ONLY servant 467 has altImage and altName", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  assert.equal(ServantData.servants.length, 474);

  // Check all servants: only 467 may define altImage or altName
  const withAltImage = ServantData.servants.filter((s) => s.altImage !== undefined);
  const withAltName = ServantData.servants.filter((s) => s.altName !== undefined);

  assert.deepEqual(
    withAltImage.map((s) => s.id),
    ["505600"],
    "ONLY servant 505600 (467) has altImage defined",
  );
  assert.deepEqual(
    withAltName.map((s) => s.id),
    ["505600"],
    "ONLY servant 505600 (467) has altName defined",
  );

  // Specifically verify single-trait-set servants with optionNames (418, 417, 431, 250, etc.)
  const targetIds = ["250", "267", "369", "372", "391", "392", "417", "418", "431"];
  for (const id of targetIds) {
    const svt = ServantData.getServant(id);
    if (!svt) continue;
    assert.equal(svt.altImage, undefined, `servant ${id} must NOT have altImage`);
    assert.equal(svt.altName, undefined, `servant ${id} must NOT have altName`);
  }

  // Verify search indexing still preserves optionNames in allNames
  const svt418 = ServantData.getServant("418");
  assert.ok(svt418);
  assert.ok(svt418.allNames.includes("Teach Me! Miss Ciel"), "servant 418 preserves optionNames for search indexing");
  assert.ok(svt418._search.includes("teach me! miss ciel"), "servant 418 search string includes optionNames");
});

test("filesystem verification: every servant image and altImage URL resolves to disk file", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  assert.equal(ServantData.servants.length, 474);

  for (const s of ServantData.servants) {
    const defaultRel = s.image.split("?")[0];
    const defaultFull = path.join(process.cwd(), "public", defaultRel);
    assert.ok(fs.existsSync(defaultFull), `Servant ${s.id} image must exist at ${defaultRel}`);

    if (s.altImage) {
      const altRel = s.altImage.split("?")[0];
      const altFull = path.join(process.cwd(), "public", altRel);
      assert.ok(fs.existsSync(altFull), `Servant ${s.id} altImage must exist at ${altRel}`);
    }
  }
});

test("ServantSelector._createGridItem: builds swap portrait and swap name for 467, plain img and text for 418", async () => {
  const { ServantData } = await import("../src/scripts/data.js");
  const { ServantSelector } = await import("../src/scripts/selectors.js");
  ServantData.load();

  const svt467 = ServantData.getServant("467");
  const svt418 = ServantData.getServant("418");

  // Servant 467 grid item
  const item467 = ServantSelector._createGridItem(svt467);
  assert.ok(item467);
  const swapWrap = item467.querySelector(".servant-swap-wrap");
  assert.ok(swapWrap, "Servant 467 modal item must contain .servant-swap-wrap");
  assert.equal(swapWrap.children.length, 2);
  assert.ok(swapWrap.children[0].classList.contains("servant-swap-a"));
  assert.ok(swapWrap.children[1].classList.contains("servant-swap-b"));

  const name467 = item467.querySelector(".servant-picker-name");
  assert.ok(name467);
  assert.ok(
    name467.classList.contains("servant-swap-name"),
    "Servant 467 modal item name must have .servant-swap-name",
  );
  assert.equal(name467.children.length, 2);
  assert.equal(name467.children[0].textContent, "François Prélat");
  assert.equal(name467.children[1].textContent, "Francesca Prélat");

  // Servant 418 grid item
  const item418 = ServantSelector._createGridItem(svt418);
  assert.ok(item418);
  assert.equal(item418.querySelector(".servant-swap-wrap"), null, "Servant 418 must NOT have .servant-swap-wrap");
  const name418 = item418.querySelector(".servant-picker-name");
  assert.ok(name418);
  assert.equal(name418.classList.contains("servant-swap-name"), false, "Servant 418 must NOT have .servant-swap-name");
  assert.equal(name418.textContent, "Mysterious Executor C.I.E.L");
});

test("BondApp: party setup slot and result card render swap display for 467", async () => {
  const { BondApp } = await import("../src/scripts/bond-app.js");
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  // Test legacy migration in loadState sanitize (both slots and parties)
  const rawSave = JSON.stringify({
    slots: [
      { servantId: "467-1", bondNeeded: 10000, type: "normal" },
      { servantId: "467-2", bondNeeded: 20000, type: "support" },
      { servantId: "001", bondNeeded: 5000, type: "normal" },
    ],
    parties: {
      "0101": [{ servantId: "467-1", bondNeeded: 10000 }],
      all: [{ servantId: "467-2", bondNeeded: 20000 }],
    },
  });
  const origGet = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = (key) => (key === "fgo_bond_calculator_data" ? rawSave : null);
  try {
    const loaded = BondApp.loadState();
    assert.equal(loaded.slots[0].servantId, "505600", "migrates slots[0] 467-1 to 505600");
    assert.equal(loaded.slots[1].servantId, "505600", "migrates slots[1] 467-2 to 505600");
    assert.equal(loaded.slots[2].servantId, "800100", "migrates slots[2] 001 to 800100");
    assert.equal(loaded.parties["0101"][0].servantId, "505600", "migrates parties['0101'][0] 467-1 to 505600");
    assert.equal(loaded.parties.all[0].servantId, "505600", "migrates parties.all[0] 467-2 to 505600");
    BondApp.state = loaded;
  } finally {
    globalThis.localStorage.getItem = origGet;
  }

  // Test slot creation for 467, including eager/fetchpriority preservation on slot 0 when bond tab is active
  BondApp.state.slots[0] = { servantId: "505600", bondNeeded: 10000, type: "normal", ascension: null, ces: [] };
  const mockGrid = getMockElement("servantGrid");
  BondApp.buildServantSlots();
  assert.ok(mockGrid.children.length > 0);
  const firstSlot = mockGrid.querySelector(".servant-slot");
  assert.ok(firstSlot, "First servant slot must be rendered");
  const swapWrap = firstSlot.querySelector(".servant-swap-wrap");
  assert.ok(swapWrap, "Slot 0 for 467 must render .servant-swap-wrap");
  assert.equal(swapWrap.children[0].attributes.loading, "eager", "Slot 0 first image has loading=eager");
  assert.equal(swapWrap.children[0].attributes.fetchpriority, "high", "Slot 0 first image has fetchpriority=high");
  const slotName = firstSlot.querySelector(".servant-slot-name");
  assert.ok(slotName && slotName.classList.contains("servant-swap-name"), "Slot name has swap name");

  // Test result card creation for 467
  BondApp.state.questMain = "fq";
  BondApp.state.questSub = "fq83";
  BondApp.state.teapotCount = 0;
  BondApp.calculate();
  const resultContent = getMockElement("bondResultContent");
  const resultCard = resultContent.querySelector(".bond-result-servant-card");
  assert.ok(resultCard, "Result card for 467 must be rendered");
  const cardSwapWrap = resultCard.querySelector(".servant-swap-wrap");
  assert.ok(cardSwapWrap, "Result card for 467 must render .servant-swap-wrap");
  const cardName = resultCard.querySelector(".servant-slot-name");
  assert.ok(cardName && cardName.classList.contains("servant-swap-name"), "Result card name has swap name");

  // Test frontline support mini-badge swap & tooltip for 467
  BondApp.state.slots[0] = { servantId: "800100", bondNeeded: 10000, type: "normal", ascension: null, ces: [] };
  BondApp.state.slots[1] = { servantId: "505600", bondNeeded: 0, type: "support", ascension: null, ces: [] };
  BondApp.calculate();
  const supportBadgeWrap = resultContent.querySelector(".bond-result-ce-maxbond-wrap");
  assert.ok(supportBadgeWrap, "Support badge wrap must be rendered");
  const supportSwapWrap = supportBadgeWrap.querySelector(".servant-swap-wrap");
  assert.ok(supportSwapWrap, "Support badge for 467 must render .servant-swap-wrap");
  assert.equal(
    supportSwapWrap.children[0].attributes.title,
    "François Prélat / Francesca Prélat +4%",
    "Support badge title tooltip has swap names and +4%",
  );

  // Test Max Bond mini-badge swap & tooltip for 467
  BondApp.state.slots[0] = { servantId: "800100", bondNeeded: 10000, type: "normal", ascension: null, ces: [] };
  BondApp.state.slots[1] = {
    servantId: "505600",
    bondNeeded: 0,
    type: "maxbond",
    bond15: true,
    ascension: null,
    ces: [],
  };
  BondApp.calculate();
  const maxBondBadgeWrap = resultContent.querySelector(".bond-result-ce-maxbond-wrap");
  assert.ok(maxBondBadgeWrap, "Max Bond badge wrap must be rendered");
  const maxBondSwapWrap = maxBondBadgeWrap.querySelector(".servant-swap-wrap");
  assert.ok(maxBondSwapWrap, "Max Bond badge for 467 must render .servant-swap-wrap");
  assert.equal(
    maxBondSwapWrap.children[0].attributes.title,
    "François Prélat / Francesca Prélat +25%",
    "Max Bond badge title tooltip has swap names and +25%",
  );

  // Test after-teapot split phase: teapot runs out mid-plan -> renders 2 cards, both with swap wrap and name
  BondApp.state.slots = [
    { servantId: "505600", bondNeeded: 50000, type: "normal", ascension: null, ces: [] },
    ...Array.from({ length: 5 }, () => ({ servantId: null, bondNeeded: 0, type: "normal", ascension: null, ces: [] })),
  ];
  BondApp.state.teapotOn = true;
  BondApp.state.teapotCount = 1; // 1 teapot covers 1 run, 50k bond needed takes multiple runs
  BondApp.calculate();
  const splitCards = resultContent.querySelectorAll(".bond-result-servant-card");
  assert.equal(splitCards.length, 2, "Teapot exhaustion must produce 2 result cards (boosted + after-teapot)");
  assert.ok(splitCards[0].querySelector(".servant-swap-wrap"), "Boosted card must render swap wrap");
  assert.ok(
    splitCards[0].querySelector(".servant-slot-name").classList.contains("servant-swap-name"),
    "Boosted card must render swap name",
  );
  assert.ok(splitCards[1].querySelector(".servant-swap-wrap"), "After-teapot card must render swap wrap");
  assert.ok(
    splitCards[1].querySelector(".servant-slot-name").classList.contains("servant-swap-name"),
    "After-teapot card must render swap name",
  );
});

test("CEFilterApp, ServantSelect chip, and ComboCardRenderer: render swap display for 467", async () => {
  const { CEFilterApp } = await import("../src/scripts/ce-filter-app.js");
  const { ComboCardRenderer } = await import("../src/scripts/presentation.js");
  const { ServantSelect } = await import("../src/scripts/ce-servant-select.js");
  const { ServantData } = await import("../src/scripts/data.js");
  ServantData.load();

  const s467 = ServantData.getServant("505600");
  assert.ok(s467);

  // CEFilterApp card
  const card = CEFilterApp._buildCard(
    {
      servant: s467,
      matchingCEs: [],
      allTraitNames: [],
      matchedAscensions: [],
      baseMatchesAll: true,
      primaryAscension: null,
    },
    {},
  );
  assert.ok(card.querySelector(".servant-swap-wrap"), "CEFilter card renders swap wrap");
  const nameEl = card.querySelector(".cefilter-servant-name");
  assert.ok(nameEl && nameEl.classList.contains("servant-swap-name"), "CEFilter card renders swap name");

  // ServantSelect chip
  const chip = ServantSelect._buildChip("505600");
  assert.ok(chip.querySelector(".servant-swap-wrap"), "ServantSelect chip renders swap wrap");

  // ComboCardRenderer servant cell
  const cell = ComboCardRenderer.buildServantCell({ servant: s467, matchedAscensions: [], baseMatchesAll: true }, []);
  assert.ok(cell.querySelector(".servant-swap-wrap"), "Combo servant cell renders swap wrap");
});

test("CSS verification: BaseLayout.astro contains all required swap layout selectors", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const layoutPath = path.join(process.cwd(), "src/layouts/BaseLayout.astro");
  const content = fs.readFileSync(layoutPath, "utf8");

  const requiredSelectors = [
    ".servant-picker-item .servant-swap-wrap",
    ".servant-slot-select-btn .servant-swap-wrap",
    ".bond-result-servant-card .servant-swap-wrap",
    ".bond-result-ce-maxbond-wrap .servant-swap-wrap",
    "#ceOverlapTitle.servant-swap-name",
  ];

  for (const sel of requiredSelectors) {
    assert.ok(content.includes(sel), `BaseLayout.astro must contain CSS selector: ${sel}`);
  }

  // Display grid to prevent line-box strut extra height/gap
  assert.ok(
    content.includes(".servant-swap-wrap { position: relative; display: grid;"),
    ".servant-swap-wrap must use display: grid",
  );
  assert.ok(
    content.includes(".servant-swap-name { display: grid;"),
    ".servant-swap-name must use display: grid (not inline-grid)",
  );

  // Party setup slot select button must not have margin-bottom (.servant-slot supplies gap: 4px, slot-name has margin-top: 0)
  const slotBtnMatch = content.match(/\.servant-slot-select-btn \.servant-swap-wrap\s*\{([^}]+)\}/);
  assert.ok(slotBtnMatch, "Must find .servant-slot-select-btn .servant-swap-wrap rule");
  assert.equal(
    slotBtnMatch[1].includes("margin-bottom"),
    false,
    ".servant-slot-select-btn .servant-swap-wrap must not contain margin-bottom",
  );

  // The .servant-slot container gap is what separates portrait from name now, so it must stay pinned
  const slotMatch = content.match(/\.servant-slot\s*\{([^}]+)\}/);
  assert.ok(slotMatch && slotMatch[1].includes("gap: 4px"), ".servant-slot must keep gap: 4px");

  // Verify other portrait-to-name gaps match standard servant rules:
  // 1. .servant-picker-item: gap: 4px on the item container, margin-bottom: 0 on wrap, margin-bottom: 0 on inner img
  const pickerItemMatch = content.match(/\.servant-picker-item\s*\{([^}]+)\}/);
  assert.ok(pickerItemMatch && pickerItemMatch[1].includes("gap: 4px"), ".servant-picker-item must keep gap: 4px");
  const pickerWrapMatch = content.match(/\.servant-picker-item \.servant-swap-wrap\s*\{([^}]+)\}/);
  assert.ok(pickerWrapMatch && pickerWrapMatch[1].includes("margin-bottom: 0"));
  const pickerImgMatch = content.match(
    /\.servant-picker-grid--servant \.servant-picker-item \.servant-swap-wrap img,\s*\.servant-picker-item \.servant-swap-wrap img\s*\{([^}]+)\}/,
  );
  assert.ok(pickerImgMatch && pickerImgMatch[1].includes("margin-bottom: 0"));

  // 2. .cefilter-servant-card: gap: 4px on card, margin-bottom: 0 on wrap, margin-bottom: 0 on inner img
  const cefilterCardMatch = content.match(/\.cefilter-servant-card\s*\{([^}]+)\}/);
  assert.ok(cefilterCardMatch && cefilterCardMatch[1].includes("gap: 4px"));
  const cefilterWrapMatch = content.match(/\.cefilter-servant-card \.servant-swap-wrap\s*\{([^}]+)\}/);
  assert.ok(cefilterWrapMatch && cefilterWrapMatch[1].includes("margin-bottom: 0"));
  const cefilterImgMatch = content.match(
    /\.cefilter-servant-card \.servant-swap-wrap img\.servant-slot-portrait\s*\{([^}]+)\}/,
  );
  assert.ok(cefilterImgMatch && cefilterImgMatch[1].includes("margin-bottom: 0"));

  // 3. .bond-result-servant-card: gap: 4px on card, margin-bottom: 0 on wrap, margin-bottom: 0 on inner img
  const bondResultCardMatch = content.match(/\.bond-result-servant-card\s*\{([^}]+)\}/);
  assert.ok(bondResultCardMatch && bondResultCardMatch[1].includes("gap: 4px"));
  const bondResultWrapMatch = content.match(/\.bond-result-servant-card \.servant-swap-wrap\s*\{([^}]+)\}/);
  assert.ok(bondResultWrapMatch && bondResultWrapMatch[1].includes("margin-bottom: 0"));
  const bondResultImgMatch = content.match(
    /\.bond-result-servant-card \.servant-swap-wrap \.servant-slot-portrait\s*\{([^}]+)\}/,
  );
  assert.ok(bondResultImgMatch && bondResultImgMatch[1].includes("margin-bottom: 0"));
});
