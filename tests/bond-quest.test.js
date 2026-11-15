import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Quest } from "../src/scripts/domain.js";
import { GRAND_CLASSES, GRAND_DIFFICULTIES, CLASS_FILTERS, QUEST_TIERS } from "../src/scripts/constants.js";

const blobs = new Map();
globalThis.localStorage = {
  getItem: (key) => (blobs.has(key) ? blobs.get(key) : null),
  setItem: (key, value) => blobs.set(key, String(value)),
};

const { BondApp } = await import("../src/scripts/bond-app.js");
const KEY = "fgo_bond_calculator_data";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("freeQuestBond and Free Quest bondPerRun compute recLv * 10 + 15 with clamping", () => {
  assert.equal(Quest.freeQuestBond(83), 845);
  assert.equal(Quest.freeQuestBond(84), 855);
  assert.equal(Quest.freeQuestBond(90), 915);
  assert.equal(Quest.freeQuestBond(0), 25);
  assert.equal(Quest.freeQuestBond(-10), 25);
  assert.equal(Quest.freeQuestBond(91), 915);
  assert.equal(Quest.freeQuestBond(9999), 915);
  assert.equal(Quest.freeQuestBond(83.9), 845);
  assert.equal(Quest.bondPerRun({ questMain: "fq" }), 855);
  assert.equal(Quest.bondPerRun({ questMain: "fq" }, 83), 845);
  assert.equal(Quest.bondPerRun({ questMain: "fq" }, 90), 915);
  assert.equal(Quest.bondPerRun({ questMain: "fq" }, 9999), 915);
  assert.equal(Quest.freeQuestBond(90, ""), 915);
  assert.equal(Quest.freeQuestBond(90, "+"), 1098);
  assert.equal(Quest.freeQuestBond(90, "++"), 1318);
  assert.equal(Quest.freeQuestBond(90, "+++"), 1582);
  assert.equal(Quest.freeQuestBond(90, "★"), 1582);
  assert.equal(Quest.freeQuestBond(90, "★★"), 1899);
  assert.equal(Quest.freeQuestBond(90, "★★★"), 2279);
  assert.equal(Quest.bondPerRun({ questMain: "fq", customTier: "★" }, 90), 1582);
  assert.equal(QUEST_TIERS[0].label, "None");
});

test("a free quest uses customAp (defaulting to 22 AP), grand duel costs 40 AP", () => {
  assert.equal(Quest.apPerRun({ questMain: "fq" }), 22);
  assert.equal(Quest.apPerRun({ questMain: "fq" }, 30), 30);
  assert.equal(Quest.apPerRun({ questMain: "fq" }, 0), 0);
  assert.equal(Quest.apPerRun({ questMain: "fq" }, 9999), 999);
  assert.equal(Quest.apPerRun({ questMain: "gd", questClass: "0100", questDiff: "1" }), 40);
  assert.equal(Quest.apPerRun({ questMain: "gd" }), 40);
  assert.equal(Quest.apPerRun({ questMain: "" }), 0);
});

test("golden fruit divides total AP by max AP rounded up", () => {
  assert.equal(Quest.goldenFruit(9280, 152), 62);
  assert.equal(Quest.goldenFruit(152, 152), 1);
  assert.equal(Quest.goldenFruit(153, 152), 2);
  assert.equal(Quest.goldenFruit(0, 152), 0);
  assert.equal(Quest.goldenFruit(100, 0), 0);
  assert.equal(Quest.goldenFruit(-50, 152), 0);
});

test("a grand duel pays its difficulty whatever the class, and nothing pays zero", () => {
  assert.equal(Quest.bondPerRun({ questMain: "gd", questClass: "0100", questDiff: "1" }), 3164);
  assert.equal(Quest.bondPerRun({ questMain: "gd", questClass: "extra", questDiff: "7" }), 4748);
  assert.equal(Quest.bondPerRun({ questMain: "gd", questClass: "all", questDiff: "8" }), 5081);
  assert.equal(Quest.bondPerRun({ questMain: "gd", questClass: "all", questDiff: "9" }), 5436);
  assert.equal(Quest.bondPerRun({ questMain: "gd", questDiff: "" }), 0);
  assert.equal(Quest.bondPerRun({ questMain: "" }), 0);
});

test("the difficulties rise with their level, nine steps from Lv.100 to Lv.120★★★", () => {
  assert.equal(GRAND_DIFFICULTIES.length, 9);
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

test("blank, missing, or invalid questMain in saved state defaults to Free Quest", () => {
  for (const raw of [{ questMain: "" }, {}, { questMain: "unknown" }]) {
    blobs.set(KEY, JSON.stringify(raw));
    const state = BondApp.loadState();
    assert.equal(state.questMain, "fq");
  }
  blobs.set(KEY, JSON.stringify({ questMain: "fq", customTier: "★★" }));
  assert.equal(BondApp.loadState().customTier, "★★");
  blobs.set(KEY, JSON.stringify({ questMain: "fq", customTier: "invalid" }));
  assert.equal(BondApp.loadState().customTier, "");
  blobs.set(KEY, JSON.stringify({ questMain: "gd" }));
  assert.equal(BondApp.loadState().questMain, "gd");
  blobs.set(KEY, JSON.stringify({ questMain: "rb", raidAp: 30, raidRecLv: 90, raidTier: "★" }));
  const rbState = BondApp.loadState();
  assert.equal(rbState.questMain, "rb");
  assert.equal(rbState.raidAp, 30);
  assert.equal(rbState.raidRecLv, 90);
  assert.equal(rbState.raidTier, "★");
  blobs.set(KEY, JSON.stringify({ selectedQuest: "gd100" }));
  assert.equal(BondApp.loadState().questMain, "gd");
});

test("blank, missing, or invalid questClass and questDiff in saved state default to first choice", () => {
  for (const raw of [{}, { questClass: "", questDiff: "" }, { questClass: "nope", questDiff: "99" }]) {
    blobs.set(KEY, JSON.stringify(raw));
    const state = BondApp.loadState();
    assert.equal(state.questClass, GRAND_CLASSES[0].key);
    assert.equal(state.questDiff, GRAND_DIFFICULTIES[0].key);
  }
  blobs.set(KEY, JSON.stringify({ questMain: "gd", questClass: "0100", questDiff: "5" }));
  const saved = BondApp.loadState();
  assert.equal(saved.questClass, "0100");
  assert.equal(saved.questDiff, "5");
});

test("raidQuestBond, bondPerRun, and apPerRun compute Raid Boss / Storm Pod values", () => {
  assert.equal(Quest.raidQuestBond(90, ""), 1830);
  assert.equal(Quest.raidQuestBond(90, "+"), 2196);
  assert.equal(Quest.raidQuestBond(90, "++"), 2636);
  assert.equal(Quest.raidQuestBond(90, "+++"), 3164);
  assert.equal(Quest.raidQuestBond(90, "★"), 3164);
  assert.equal(Quest.raidQuestBond(90, "★★"), 3797);
  assert.equal(Quest.raidQuestBond(90, "★★★"), 4557);
  assert.equal(Quest.raidQuestBond(90, "invalid"), 1830);
  assert.equal(Quest.raidQuestBond(91, ""), 1830);
  assert.equal(Quest.raidQuestBond(9999, ""), 1830);
  assert.equal(Quest.bondPerRun({ questMain: "rb" }), 1830);
  assert.equal(Quest.bondPerRun({ questMain: "rb", raidRecLv: 90, raidTier: "★" }), 3164);
  assert.equal(Quest.bondPerRun({ questMain: "rb", raidRecLv: 90, raidTier: "★★★" }), 4557);
  assert.equal(Quest.apPerRun({ questMain: "rb" }), 40);
  assert.equal(Quest.apPerRun({ questMain: "rb", raidAp: 20 }), 20);
  assert.equal(Quest.apPerRun({ questMain: "rb", raidAp: 9999 }), 999);
});

test("Raid Boss / Storm Pod does not trigger Grand Duel party or class locks", () => {
  BondApp.state = {
    slots: [],
    parties: {},
    questMain: "rb",
    questClass: "0100",
    questDiff: "1",
  };
  assert.deepEqual(BondApp._pickerOptions(), {});
  assert.equal(BondApp._partyKey(), "");
});

test("Select Quest tabs, Grand Duel class select, and tier pills initialize cleanly and update live summary", () => {
  const html = fs.readFileSync(path.join(repoRoot, "src/pages/index.astro"), "utf8");
  const classMatch = html.match(/<select[^>]*id="bondGrandClassSelect"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(classMatch, "bondGrandClassSelect must exist in index.astro");
  assert.ok(!classMatch[1].includes('value=""'), "bondGrandClassSelect must not ship a blank <option>");
  for (const family of ["fq", "rb", "gd"]) {
    assert.ok(
      html.includes(`data-quest-family="${family}"`),
      `bondQuestTabs must include data-quest-family="${family}"`,
    );
  }

  const makeEl = (tag, dataset = {}) => {
    const attrs = new Map();
    const listeners = new Map();
    const classes = new Set();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      dataset: { ...dataset },
      children,
      value: "",
      textContent: "",
      tabIndex: 0,
      classList: {
        toggle: (cls, force) => {
          if (force === undefined) {
            if (classes.has(cls)) classes.delete(cls);
            else classes.add(cls);
          } else if (force) {
            classes.add(cls);
          } else {
            classes.delete(cls);
          }
        },
        contains: (cls) => classes.has(cls),
      },
      setAttribute: (k, v) => {
        attrs.set(k, String(v));
        if (k.startsWith("data-")) {
          const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
          el.dataset[camel] = String(v);
        }
      },
      removeAttribute: (k) => attrs.delete(k),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      appendChild: (node) => {
        if (!node.tagName && Array.isArray(node.children)) children.push(...node.children);
        else children.push(node);
        return node;
      },
      replaceChildren: (...nodes) => {
        children.length = 0;
        for (const node of nodes) {
          if (node && !node.tagName && Array.isArray(node.children)) children.push(...node.children);
          else if (node) children.push(node);
        }
      },
      querySelectorAll: () => children,
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      closest: () => ({ style: {} }),
      focus: () => {},
      trigger: (ev, eventObj = {}) => listeners.get(ev)?.(eventObj),
    };
    return el;
  };

  const tabList = makeEl("div");
  for (const family of ["fq", "rb", "gd"]) {
    tabList.appendChild(makeEl("button", { questFamily: family }));
  }

  const elements = new Map([
    ["bondQuestTabs", tabList],
    ["bondGrandClassSelect", makeEl("select")],
    ["bondGrandDiffPills", makeEl("div")],
    ["freeQuestRecLv", makeEl("input")],
    ["freeQuestTierPills", makeEl("div")],
    ["customApPerRun", makeEl("input")],
    ["raidTierPills", makeEl("div")],
    ["raidRecLv", makeEl("input")],
    ["raidApPerRun", makeEl("input")],
    ["bondSummaryAp", makeEl("dd")],
    ["bondSummaryRecLv", makeEl("dd")],
    ["bondSummaryBond", makeEl("dd")],
  ]);
  const docEl = makeEl("html");
  const prevDoc = globalThis.document;
  globalThis.document = {
    documentElement: docEl,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => makeEl(tag),
    createDocumentFragment: () => ({
      children: [],
      appendChild(n) {
        this.children.push(n);
      },
    }),
  };

  try {
    BondApp.state = {
      slots: [],
      parties: {},
      questMain: "",
      questClass: "",
      questDiff: "",
      customRecLv: 84,
      customAp: 22,
      customTier: "",
      raidAp: 40,
      raidRecLv: 90,
      raidTier: "",
    };
    BondApp.initQuestSelects();

    assert.equal(BondApp.state.questMain, "fq");
    assert.equal(docEl.getAttribute("data-bond-quest"), "fq");
    assert.equal(elements.get("bondSummaryAp").textContent, "22");
    assert.equal(elements.get("bondSummaryRecLv").textContent, "84");
    assert.equal(elements.get("bondSummaryBond").textContent, (855).toLocaleString());

    const recLvInput = elements.get("freeQuestRecLv");
    recLvInput.value = "90";
    recLvInput.trigger("input");
    assert.equal(BondApp.state.customRecLv, 90);
    assert.equal(elements.get("bondSummaryRecLv").textContent, "90");
    assert.equal(elements.get("bondSummaryBond").textContent, (915).toLocaleString());

    const freePills = elements.get("freeQuestTierPills").children;
    freePills.find((b) => b.dataset.value === "★").trigger("click");
    assert.equal(BondApp.state.customTier, "★");
    assert.equal(elements.get("bondSummaryRecLv").textContent, "90★");
    assert.equal(elements.get("bondSummaryBond").textContent, (1582).toLocaleString());

    tabList.children.find((b) => b.dataset.questFamily === "rb").trigger("click");
    assert.equal(BondApp.state.questMain, "rb");
    assert.equal(docEl.getAttribute("data-bond-quest"), "rb");
    assert.equal(elements.get("bondSummaryRecLv").textContent, "90");
    assert.equal(elements.get("bondSummaryBond").textContent, (1830).toLocaleString());

    const raidPills = elements.get("raidTierPills").children;
    raidPills.find((b) => b.dataset.value === "★").trigger("click");
    assert.equal(BondApp.state.raidTier, "★");
    assert.equal(elements.get("bondSummaryRecLv").textContent, "90★");
    assert.equal(elements.get("bondSummaryBond").textContent, (3164).toLocaleString());

    tabList.children.find((b) => b.dataset.questFamily === "gd").trigger("click");
    assert.equal(BondApp.state.questMain, "gd");
    assert.equal(docEl.getAttribute("data-bond-quest"), "gd");

    const gdClass = elements.get("bondGrandClassSelect");
    assert.equal(gdClass.value, GRAND_CLASSES[0].key);
    assert.equal(BondApp.state.questClass, GRAND_CLASSES[0].key);
    assert.equal(BondApp.state.questDiff, GRAND_DIFFICULTIES[0].key);
    assert.equal(elements.get("bondSummaryRecLv").textContent, "100");
    assert.equal(elements.get("bondSummaryBond").textContent, (3164).toLocaleString());

    gdClass.value = "";
    gdClass.trigger("change");
    assert.equal(gdClass.value, GRAND_CLASSES[0].key);
    assert.equal(BondApp.state.questClass, GRAND_CLASSES[0].key);

    const gdPills = elements.get("bondGrandDiffPills").children;
    gdPills.find((b) => b.dataset.value === "7").trigger("click");
    assert.equal(BondApp.state.questDiff, "7");
    assert.equal(elements.get("bondSummaryRecLv").textContent, "100★★★");
    assert.equal(elements.get("bondSummaryBond").textContent, (4748).toLocaleString());
  } finally {
    globalThis.document = prevDoc;
  }
});
