import { test } from "node:test";
import assert from "node:assert/strict";

const elements = new Map();

function matchesSelector(el, selector) {
  if (!el || !el.classList) return false;
  if (selector.startsWith(".")) {
    return el.classList.contains(selector.slice(1));
  }
  return false;
}

function collectMatches(root, selector, out = []) {
  for (const child of root.children || []) {
    if (matchesSelector(child, selector)) out.push(child);
    collectMatches(child, selector, out);
  }
  return out;
}

function getNodeText(node) {
  if (!node) return "";
  if (node.children && node.children.length > 0) {
    return node.children.map((c) => getNodeText(c)).join("");
  }
  return node.textContent || "";
}

function createMockElement(tag) {
  let _className = "";
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    textContent: "",
    hidden: false,
    disabled: false,
    tabIndex: 0,
    dataset: {},
    style: {},
    children: [],
    attributes: {},
    parentNode: null,
    classList: {
      _classes: new Set(),
      add(...cls) {
        cls.forEach((c) => this._classes.add(c));
        _className = [...this._classes].join(" ");
      },
      remove(...cls) {
        cls.forEach((c) => this._classes.delete(c));
        _className = [...this._classes].join(" ");
      },
      toggle(c, force) {
        const next = force !== undefined ? Boolean(force) : !this._classes.has(c);
        if (next) this._classes.add(c);
        else this._classes.delete(c);
        _className = [...this._classes].join(" ");
      },
      contains(c) {
        return this._classes.has(c);
      },
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return this.attributes[k];
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    },
    appendChild(child) {
      this.append(child);
      return child;
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n && n.nodeType === 11) {
          for (const c of n.children) {
            c.parentNode = this;
            this.children.push(c);
          }
          n.children = [];
        } else if (n) {
          n.parentNode = this;
          this.children.push(n);
        }
      }
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click() {
      for (const fn of listeners.get("click") || []) {
        fn({ target: this });
      }
    },
    closest(selector) {
      let cur = this;
      while (cur) {
        if (matchesSelector(cur, selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    },
    focus() {},
    querySelectorAll(selector) {
      return collectMatches(this, selector);
    },
    querySelector(selector) {
      return collectMatches(this, selector)[0] || null;
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

function getMockElement(id) {
  if (!elements.has(id)) {
    const el = createMockElement("div");
    el.id = id;
    elements.set(id, el);
  }
  return elements.get(id);
}

globalThis.window = { innerWidth: 1280 };
globalThis.document = {
  getElementById: (id) => getMockElement(id),
  createElement: (tag) => createMockElement(tag),
  createTextNode: (text) => ({ textContent: text, parentNode: null }),
  createDocumentFragment: () => ({
    nodeType: 11,
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n) this.children.push(n);
      }
    },
  }),
  addEventListener: () => {},
  activeElement: null,
};

function makeModalPayload({ collectionNo, id, name, slots }) {
  return {
    baseServant: {
      id: String(id),
      collectionNo,
      name,
      image: `servants/${id}/000.webp`,
    },
    svt: {
      id,
      collectionNo,
      name,
      originalName: name,
      className: "lancer",
      rarity: 5,
      saintGraphs: [
        { key: "1", label: "1st Ascension", file: `${id}a@1.webp`, kind: "ascension", form: 0, ascensionStage: "1" },
      ],
      formatted: {
        profile: {
          forms: [
            {
              label: "Default",
              className: "Lancer",
              alignment: "True-Neutral",
              subAttr: "Sky",
              gender: "Unknown",
              rarity: 5,
              hpBase: 2000,
              hpMax: 14000,
              atkBase: 1800,
              atkMax: 12000,
              cardDeck: "QQAAB",
              hits: ["Q 4", "A 2", "B 1", "EX 5"],
            },
          ],
        },
        slots,
        passives: [],
      },
    },
  };
}

function getOptionBarsAndBullets(effectsContainer) {
  const bars = effectsContainer.querySelectorAll(".f-option-selector-bar");
  const bullets = effectsContainer.querySelectorAll(".f-bullet-item").map((li) => getNodeText(li));
  return { bars, bullets };
}

test("random-weight skill renders duplicate percentage buttons and switches branch while keeping shared effects", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");
  const bodyEl = getMockElement("servantInfoModalBody");
  const titleEl = getMockElement("servantInfoModalTitle");

  const { svt, baseServant } = makeModalPayload({
    collectionNo: 143,
    id: 300800,
    name: "Enkidu",
    slots: [
      {
        slotKey: "skill_1",
        type: "skill",
        slotNum: 1,
        tiers: [0],
        maxTier: 0,
        activeTier: 0,
        variantsByTier: {
          0: {
            tier: 0,
            type: "skill",
            cleanTitle: "Skill 1 (Transformation A)",
            cooldown: "Cooldown 7-5 turns",
            effects: [
              "Increase Buster Card effectiveness by 30-50% (1 turn) for yourself",
              "[50% Chance]",
              "Increase Quick Card effectiveness by 30-50% (1 turn) for yourself",
              "[50% Chance]",
              "Increase Arts Card effectiveness by 30-50% (1 turn) for yourself",
            ],
            forms: [],
          },
        },
      },
    ],
  });

  ServantInfoApp._renderDetailModal(svt, baseServant, bodyEl, titleEl);
  const card = ServantInfoApp._modalState.slotCards[0];
  const { effectsContainer } = card._refs;

  let state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 1);
  let btns = state.bars[0].querySelectorAll(".f-option-btn");
  assert.deepEqual(
    btns.map((b) => b.textContent),
    ["50%", "50%"],
  );
  assert.equal(btns[0].classList.contains("active"), true);
  assert.deepEqual(state.bullets, [
    "Increase Buster Card effectiveness by 30-50% (1 turn) for yourself",
    "Increase Quick Card effectiveness by 30-50% (1 turn) for yourself",
  ]);

  btns[1].click();
  state = getOptionBarsAndBullets(effectsContainer);
  btns = state.bars[0].querySelectorAll(".f-option-btn");
  assert.equal(btns[1].classList.contains("active"), true);
  assert.deepEqual(state.bullets, [
    "Increase Buster Card effectiveness by 30-50% (1 turn) for yourself",
    "Increase Arts Card effectiveness by 30-50% (1 turn) for yourself",
  ]);
});

test("random-weight NP renders percentage buttons and switches branch while keeping shared NP effects", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");
  const bodyEl = getMockElement("servantInfoModalBody");
  const titleEl = getMockElement("servantInfoModalTitle");

  const { svt, baseServant } = makeModalPayload({
    collectionNo: 320,
    id: 901200,
    name: "Leonardo da Vinci",
    slots: [
      {
        slotKey: "np_1",
        type: "np",
        tiers: [0],
        maxTier: 0,
        activeTier: 0,
        variantsByTier: {
          0: {
            tier: 0,
            type: "np",
            cleanTitle: "Noble Phantasm (Dinosaur Summer Goodbye)",
            name: "Dinosaur Summer Goodbye",
            metaLines: ["Buster Single-Target 3 Hits", "NP Gain 0.67%"],
            effects: [
              "Increase NP Strength by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
              "Deal significant damage by 600-1000% <effect increases with Level> to a single enemy",
              "[33% Chance]",
              "Gain Critical Stars by 30",
              "[33% Chance]",
              "Increase NP Gauge by 20% for all allies",
              "[33% Chance]",
              "Increase ATK by 20% (3 turns) for all allies",
            ],
            forms: [],
          },
        },
      },
    ],
  });

  ServantInfoApp._renderDetailModal(svt, baseServant, bodyEl, titleEl);
  const card = ServantInfoApp._modalState.slotCards[0];
  const { effectsContainer } = card._refs;

  let state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 1);
  let btns = state.bars[0].querySelectorAll(".f-option-btn");
  assert.deepEqual(
    btns.map((b) => b.textContent),
    ["33%", "33%", "33%"],
  );
  assert.deepEqual(state.bullets, [
    "Increase NP Strength by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
    "Deal significant damage by 600-1000% <effect increases with Level> to a single enemy",
    "Gain Critical Stars by 30",
  ]);

  btns[1].click();
  state = getOptionBarsAndBullets(effectsContainer);
  assert.deepEqual(state.bullets, [
    "Increase NP Strength by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
    "Deal significant damage by 600-1000% <effect increases with Level> to a single enemy",
    "Increase NP Gauge by 20% for all allies",
  ]);

  state.bars[0].querySelectorAll(".f-option-btn")[2].click();
  state = getOptionBarsAndBullets(effectsContainer);
  assert.deepEqual(state.bullets, [
    "Increase NP Strength by 20-40% (1 turn) for yourself <effect increases with Overcharge>",
    "Deal significant damage by 600-1000% <effect increases with Level> to a single enemy",
    "Increase ATK by 20% (3 turns) for all allies",
  ]);
});

test("usage-cycle looping skill renders 2-layer multi-choice and resets layer 2 when returning to 1st Time", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");
  const bodyEl = getMockElement("servantInfoModalBody");
  const titleEl = getMockElement("servantInfoModalTitle");

  const { svt, baseServant } = makeModalPayload({
    collectionNo: 475,
    id: 705300,
    name: "Beni-Enma",
    slots: [
      {
        slotKey: "skill_1",
        type: "skill",
        slotNum: 1,
        tiers: [0],
        maxTier: 0,
        activeTier: 0,
        variantsByTier: {
          0: {
            tier: 0,
            type: "skill",
            cleanTitle: "Skill 1 (Kurakura's Meals A)",
            cooldown: "Cooldown 3-1 turns",
            effects: [
              "[1st Time]",
              "Gain Critical Stars by 20-30",
              "[95% Chance]",
              "Increase ATK by 10-20% (3 turns) for all allies",
              "Increases Fullness gauge by 2 for all allies",
              "[5% Chance]",
              "Increase ATK by 10-20% (3 turns) for all allies",
              "Restore HP by 5000-10000 for all allies",
              "Increases Fullness gauge by 12 for all allies",
              "[2nd Time]",
              "Gain Critical Stars by 20-30",
              "Increase Max HP by 1000-2000 (3 turns) for all allies",
              "Increases Fullness gauge by 2 for all allies",
              "[3rd Time]",
              "Gain Critical Stars by 20-30",
              "Increase NP Gauge by 10-20% for all allies",
              "[4th Time]",
              "Gain Critical Stars by 20-30",
              "Increase NP Strength by 10-20% (3 turns) for all allies",
              "[5th Time]",
              "Gain Critical Stars by 20-30",
              "Increase Critical Strength by 30-50% (3 turns) for all allies",
              "[6th Time]",
              "Gain Critical Stars by 20-30",
              "Restore HP by 5000-10000 for all allies",
            ],
            forms: [],
          },
        },
      },
    ],
  });

  ServantInfoApp._renderDetailModal(svt, baseServant, bodyEl, titleEl);
  const card = ServantInfoApp._modalState.slotCards[0];
  const { effectsContainer } = card._refs;

  // Initial: Layer 1 (6 cycles) + Layer 2 (95% / 5%)
  let state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 2);
  let layer1Btns = state.bars[0].querySelectorAll(".f-option-btn");
  let layer2Btns = state.bars[1].querySelectorAll(".f-option-btn");
  assert.deepEqual(
    layer1Btns.map((b) => b.textContent),
    ["1st Time", "2nd Time", "3rd Time", "4th Time", "5th Time", "6th Time -> 1st Time"],
  );
  assert.deepEqual(
    layer2Btns.map((b) => b.textContent),
    ["95%", "5%"],
  );
  assert.equal(layer2Btns[0].classList.contains("active"), true);
  assert.deepEqual(state.bullets, [
    "Gain Critical Stars by 20-30",
    "Increase ATK by 10-20% (3 turns) for all allies",
    "Increases Fullness gauge by 2 for all allies",
  ]);

  // Switch Layer 2 to 5%
  layer2Btns[1].click();
  state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 2);
  assert.equal(state.bars[1].querySelectorAll(".f-option-btn")[1].classList.contains("active"), true);
  assert.deepEqual(state.bullets, [
    "Gain Critical Stars by 20-30",
    "Increase ATK by 10-20% (3 turns) for all allies",
    "Restore HP by 5000-10000 for all allies",
    "Increases Fullness gauge by 12 for all allies",
  ]);

  // Switch Layer 1 to 2nd Time: Layer 2 disappears
  state.bars[0].querySelectorAll(".f-option-btn")[1].click();
  state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 1);
  assert.deepEqual(state.bullets, [
    "Gain Critical Stars by 20-30",
    "Increase Max HP by 1000-2000 (3 turns) for all allies",
    "Increases Fullness gauge by 2 for all allies",
  ]);

  // Switch Layer 1 back to 1st Time: Layer 2 returns reset to 95%
  state.bars[0].querySelectorAll(".f-option-btn")[0].click();
  state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 2);
  assert.equal(state.bars[1].querySelectorAll(".f-option-btn")[0].classList.contains("active"), true);
  assert.deepEqual(state.bullets, [
    "Gain Critical Stars by 20-30",
    "Increase ATK by 10-20% (3 turns) for all allies",
    "Increases Fullness gauge by 2 for all allies",
  ]);
});

test("existing Select N Options skills continue to work identically", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");
  const bodyEl = getMockElement("servantInfoModalBody");
  const titleEl = getMockElement("servantInfoModalTitle");

  const { svt, baseServant } = makeModalPayload({
    collectionNo: 248,
    id: 203300,
    name: "Aśvatthāman",
    slots: [
      {
        slotKey: "skill_1",
        type: "skill",
        slotNum: 1,
        tiers: [1],
        maxTier: 1,
        activeTier: 1,
        variantsByTier: {
          1: {
            tier: 1,
            type: "skill",
            cleanTitle: "Skill 1 (Mystic Gem of Mani A)",
            cooldown: "Cooldown 8-6 turns",
            effects: [
              "Select 2 Options ([Invincible] / [Guts])",
              "[Invincible] Apply Invincible (1 turn) for yourself",
              "[Guts] Apply Guts by 1 (1 time, 3 turns) for yourself",
              "Increase NP Gauge by 20-30% for yourself",
            ],
            forms: [],
          },
        },
      },
    ],
  });

  ServantInfoApp._renderDetailModal(svt, baseServant, bodyEl, titleEl);
  const card = ServantInfoApp._modalState.slotCards[0];
  const { effectsContainer } = card._refs;

  let state = getOptionBarsAndBullets(effectsContainer);
  assert.equal(state.bars.length, 1);
  const btns = state.bars[0].querySelectorAll(".f-option-btn");
  assert.deepEqual(
    btns.map((b) => b.textContent),
    ["Invincible", "Guts"],
  );
  assert.deepEqual(state.bullets, [
    "Apply Invincible (1 turn) for yourself",
    "Increase NP Gauge by 20-30% for yourself",
  ]);

  btns[1].click();
  state = getOptionBarsAndBullets(effectsContainer);
  assert.deepEqual(state.bullets, [
    "Apply Guts by 1 (1 time, 3 turns) for yourself",
    "Increase NP Gauge by 20-30% for yourself",
  ]);
});
