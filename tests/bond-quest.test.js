import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Quest } from "../src/scripts/domain.js";
import { GRAND_CLASSES, GRAND_DIFFICULTIES, CLASS_FILTERS } from "../src/scripts/constants.js";

const blobs = new Map();
globalThis.localStorage = {
  getItem: (key) => (blobs.has(key) ? blobs.get(key) : null),
  setItem: (key, value) => blobs.set(key, String(value)),
};

const { BondApp } = await import("../src/scripts/bond-app.js");
const KEY = "fgo_bond_calculator_data";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a free quest pays its own figure, and Custom pays what was typed", () => {
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "fq83" }), 845);
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "fq84" }), 855);
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "custom" }, 1234), 1234);
  // past the input's ceiling the box clamps it back
  assert.equal(Quest.bondPerRun({ questMain: "fq", questSub: "custom" }, 999999), 99999);
});

test("a free quest costs 22 AP, grand duel costs 40 AP, and Custom costs what was typed", () => {
  assert.equal(Quest.apPerRun({ questMain: "fq", questSub: "fq83" }), 22);
  assert.equal(Quest.apPerRun({ questMain: "fq", questSub: "fq84" }), 22);
  assert.equal(Quest.apPerRun({ questMain: "fq", questSub: "custom" }), 22);
  assert.equal(Quest.apPerRun({ questMain: "fq", questSub: "custom" }, 30), 30);
  assert.equal(Quest.apPerRun({ questMain: "fq", questSub: "custom" }, 9999), 999);
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

test("blank, missing, or invalid questMain in saved state defaults to Free Quest", () => {
  for (const raw of [{ questMain: "" }, {}, { questMain: "unknown" }]) {
    blobs.set(KEY, JSON.stringify(raw));
    const state = BondApp.loadState();
    assert.equal(state.questMain, "fq");
  }
  blobs.set(KEY, JSON.stringify({ questMain: "gd" }));
  assert.equal(BondApp.loadState().questMain, "gd");
  blobs.set(KEY, JSON.stringify({ selectedQuest: "gd100" }));
  assert.equal(BondApp.loadState().questMain, "gd");
});

test("bondQuestSelect has no blank option in markup and stays unblankable in initQuestSelects", () => {
  const html = fs.readFileSync(path.join(repoRoot, "src/pages/index.astro"), "utf8");
  const match = html.match(/<select[^>]*id="bondQuestSelect"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(match, "bondQuestSelect must exist in index.astro");
  assert.equal(match[1].trim(), "", "bondQuestSelect must not ship a blank <option>");

  const makeEl = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      children,
      value: "",
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      appendChild: (node) => {
        if (node.children) children.push(...node.children);
        else children.push(node);
        return node;
      },
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      closest: () => ({ style: {} }),
      trigger: (ev) => listeners.get(ev)?.(),
    };
    return el;
  };

  const elements = new Map([
    ["bondQuestSelect", makeEl("select")],
    ["bondFreeQuestSelect", makeEl("select")],
    ["bondGrandClassSelect", makeEl("select")],
    ["bondGrandDiffSelect", makeEl("select")],
    ["customQuestSection", makeEl("div")],
    ["customBondPerRun", makeEl("input")],
    ["customApPerRun", makeEl("input")],
  ]);
  const docEl = makeEl("html");
  const prevDoc = globalThis.document;
  globalThis.document = {
    documentElement: docEl,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => makeEl(tag),
    createDocumentFragment: () => ({ children: [], appendChild(n) { this.children.push(n); } }),
  };

  try {
    BondApp.state = {
      slots: [],
      parties: {},
      questMain: "",
      questSub: "",
      questClass: "",
      questDiff: "",
      customBond: 0,
      customAp: 22,
    };
    BondApp.initQuestSelects();
    const main = elements.get("bondQuestSelect");
    assert.deepEqual(
      main.children.map((opt) => opt.getAttribute("value")),
      ["fq", "gd"],
    );
    assert.equal(main.value, "fq");
    assert.equal(BondApp.state.questMain, "fq");
    assert.equal(docEl.getAttribute("data-bond-quest"), "fq");

    main.value = "";
    main.trigger("change");
    assert.equal(main.value, "fq");
    assert.equal(BondApp.state.questMain, "fq");
  } finally {
    globalThis.document = prevDoc;
  }
});
