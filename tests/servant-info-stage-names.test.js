import { test } from "node:test";
import assert from "node:assert/strict";

const elements = new Map();

function matchesSimple(el, part) {
  if (!el || !el.classList) return false;
  const attrs = [];
  const attrRe = /\[([^\]]+)\]/g;
  let m;
  while ((m = attrRe.exec(part))) attrs.push(m[1]);
  let rest = part.replace(/\[[^\]]+\]/g, "");

  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  for (const cls of rest.split(".").filter(Boolean)) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const attr of attrs) {
    const eqIdx = attr.indexOf("=");
    if (eqIdx === -1) {
      if (el.getAttribute(attr) == null) return false;
      continue;
    }
    const name = attr.slice(0, eqIdx).trim();
    let val = attr.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (el.getAttribute(name) !== val) return false;
  }
  return true;
}

function matchesSelector(el, selector) {
  if (!el || !el.classList) return false;
  const parts = String(selector).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.length === 1) return matchesSimple(el, parts[0]);
  if (!matchesSimple(el, parts[parts.length - 1])) return false;
  let ancestor = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (ancestor) {
      if (matchesSimple(ancestor, parts[i])) {
        found = true;
        ancestor = ancestor.parentNode;
        break;
      }
      ancestor = ancestor.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function collectMatches(root, selector, out = []) {
  for (const child of root.children || []) {
    if (matchesSelector(child, selector)) out.push(child);
    collectMatches(child, selector, out);
  }
  return out;
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
    _listeners: listeners,
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
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = String(v);
      }
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
      const evt = { target: this };
      let cur = this;
      while (cur) {
        for (const fn of (cur._listeners && cur._listeners.get("click")) || []) {
          fn(evt);
        }
        cur = cur.parentNode;
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

test("_renderDetailModal updates NP and Skill titles from active Saint Graph stage and reverts when stage has no override", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  const bodyEl = getMockElement("servantInfoModalBody");
  const titleEl = getMockElement("servantInfoModalTitle");
  const baseServant = {
    id: "2501700",
    collectionNo: 487,
    name: "Dynamite Rikyu",
    image: "servants/2501700/000.webp",
  };

  const svt = {
    id: 2501700,
    collectionNo: 487,
    name: "Dynamite Rikyu",
    originalName: "ダイナマイト利休",
    className: "Foreigner",
    rarity: 5,
    cost: 16,
    hpBase: 2000,
    hpMax: 14000,
    atkBase: 1800,
    atkMax: 12000,
    saintGraphs: [
      {
        key: "1",
        label: "1st Ascension",
        file: "2501700a@1.webp",
        kind: "ascension",
        form: 0,
        ascensionStage: "1",
        skillNames: { skill_1: "Wabisa & Beauty EX" },
      },
      {
        key: "2",
        label: "2nd Ascension",
        file: "2501700a@2.webp",
        kind: "ascension",
        form: 0,
        ascensionStage: "2",
        npName: "Naraku Flower",
        skillNames: { skill_1: "Pretty & Cutie EX", skill_2: "Tamayura Crimson A" },
      },
      {
        key: "3",
        label: "3rd Ascension",
        file: "2501700a@3.webp",
        kind: "ascension",
        form: 0,
        ascensionStage: "3",
        npName: "Nirvana Unity",
      },
    ],
    formatted: {
      profile: {
        forms: [
          {
            label: "Default",
            className: "Foreigner",
            alignment: "Neutral-Good",
            subAttr: "Human",
            gender: "Female",
            rarity: 5,
            hpBase: 2000,
            hpMax: 14000,
            atkBase: 1800,
            atkMax: 12000,
            cardDeck: "QQABB",
            hits: ["Q 4", "A 3", "B 3", "EX 5"],
          },
        ],
      },
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
              cleanTitle: "Noble Phantasm (Konzen Ittai)",
              name: "Konzen Ittai",
              metaLines: ["Arts AOE 4 Hits", "NP Gain 0.50%"],
              effects: ["Deal heavy damage to all enemies"],
              forms: [],
            },
          },
        },
        {
          slotKey: "skill_1",
          type: "skill",
          slotNum: 1,
          tiers: [0, 1],
          maxTier: 1,
          activeTier: 1,
          variantsByTier: {
            0: {
              tier: 0,
              type: "skill",
              cleanTitle: "Skill 1 (Sexy & Beauty)",
              cooldown: "Cooldown 7-5 turns",
              effects: ["Increase Arts Card effectiveness by 20%"],
              forms: [],
            },
            1: {
              tier: 1,
              type: "skill",
              cleanTitle: "Skill 1 (Sexy & Beauty EX)",
              cooldown: "Cooldown 7-5 turns",
              effects: ["Increase Arts Card effectiveness by 30%"],
              forms: [],
            },
          },
        },
        {
          slotKey: "skill_2",
          type: "skill",
          slotNum: 2,
          tiers: [0],
          maxTier: 0,
          activeTier: 0,
          variantsByTier: {
            0: {
              tier: 0,
              type: "skill",
              cleanTitle: "Skill 2 (Eternal Black A)",
              cooldown: "Cooldown 8-6 turns",
              effects: ["Increase NP Gauge by 30%"],
              forms: [],
            },
          },
        },
      ],
      passives: [],
    },
  };

  ServantInfoApp._renderDetailModal(svt, baseServant, bodyEl, titleEl);

  const slotCards = ServantInfoApp._modalState.slotCards;
  const npTitle = slotCards[0]._refs.titleText;
  const s1Title = slotCards[1]._refs.titleText;
  const s2Title = slotCards[2]._refs.titleText;

  // Initial Stage 1: skill_1 overridden, np_1 & skill_2 keep base cleanTitle
  assert.equal(npTitle.textContent, "Noble Phantasm (Konzen Ittai)");
  assert.equal(s1Title.textContent, "Skill 1 (Wabisa & Beauty EX)");
  assert.equal(s2Title.textContent, "Skill 2 (Eternal Black A)");

  // Step to Stage 2: np_1, skill_1, skill_2 all overridden
  ServantInfoApp._modalState.sgController.step(1);
  assert.equal(npTitle.textContent, "Noble Phantasm (Naraku Flower)");
  assert.equal(s1Title.textContent, "Skill 1 (Pretty & Cutie EX)");
  assert.equal(s2Title.textContent, "Skill 2 (Tamayura Crimson A)");

  // Switch Skill 1 strengthen tier to Base on Stage 2: stage override persists
  const s1StrengthenBtns = slotCards[1]._refs.strengthenWrap.querySelectorAll(".f-strengthen-btn");
  assert.equal(s1StrengthenBtns.length, 2);
  s1StrengthenBtns[0].click();
  assert.equal(s1Title.textContent, "Skill 1 (Pretty & Cutie EX)");

  // Step to Stage 3: np_1 overridden, skill_1 & skill_2 revert to cleanTitle (Base tier for skill_1)
  ServantInfoApp._modalState.sgController.step(1);
  assert.equal(npTitle.textContent, "Noble Phantasm (Nirvana Unity)");
  assert.equal(s1Title.textContent, "Skill 1 (Sexy & Beauty)");
  assert.equal(s2Title.textContent, "Skill 2 (Eternal Black A)");

  // Step back to Stage 1: skill_1 overridden again, np_1 & skill_2 revert
  ServantInfoApp._modalState.sgController.step(-2);
  assert.equal(npTitle.textContent, "Noble Phantasm (Konzen Ittai)");
  assert.equal(s1Title.textContent, "Skill 1 (Wabisa & Beauty EX)");
  assert.equal(s2Title.textContent, "Skill 2 (Eternal Black A)");
});

test("Spiritron Dress without ascensionStage syncs Profile and Skill back to 1st&2nd Ascension", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  const bodyEl = getMockElement("servantInfoModalBody");
  const titleEl = getMockElement("servantInfoModalTitle");
  const baseServant = {
    id: "4400100",
    collectionNo: 444,
    name: "U-Olga Marie",
    image: "servants/4400100/000.webp",
  };

  const svt = {
    id: 4400100,
    collectionNo: 444,
    name: "U-Olga Marie",
    originalName: "U-オルガマリー",
    className: "Beast",
    rarity: 5,
    saintGraphs: [
      { key: "1", label: "1st Ascension", file: "4400100a@1.webp", kind: "ascension", form: 0, ascensionStage: "1" },
      { key: "2", label: "2nd Ascension", file: "4400100a@2.webp", kind: "ascension", form: 0, ascensionStage: "2" },
      {
        key: "3",
        label: "3rd Ascension",
        file: "4400100a@3.webp",
        kind: "ascension",
        form: 0,
        ascensionStage: "3",
        name: "Olga Marie Animusphere",
      },
      {
        key: "4",
        label: "Final Ascension",
        file: "4400100a@4.webp",
        kind: "ascension",
        form: 0,
        ascensionStage: "4",
        name: "Olga Marie Animusphere",
      },
      { key: "4000130", label: "Spiritron Dress", file: "4400100a@5.webp", kind: "costume", form: 0 },
      {
        key: "3120000",
        label: "Spiritron Dress",
        file: "4400100a@6.webp",
        kind: "costume",
        form: 0,
        ascensionStage: "3",
      },
    ],
    formatted: {
      profile: {
        forms: [
          {
            label: "Default",
            className: "Beast",
            alignment: "Lawful-Evil",
            subAttr: "Star",
            gender: "Female",
            rarity: 5,
            hpBase: 3000,
            hpMax: 15000,
            atkBase: 2000,
            atkMax: 13000,
            cardDeck: "QAABB",
            hits: ["Q 3", "A 3", "B 3", "EX 5"],
          },
        ],
        alignmentBlocks: ["[1st&2nd Ascension]", "Lawful-Evil", "[3rd Ascension]", "Lawful-Good"],
        attributeBlocks: ["[1st&2nd Ascension]", "Star", "[3rd Ascension]", "Human"],
      },
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
              cleanTitle: "Skill 1 (Unparalleled)",
              cooldown: "Cooldown 8-6 turns",
              effects: ["Increase Buster Card effectiveness by 30%"],
              forms: [
                {
                  label: "1st&2nd Ascension",
                  name: "Unparalleled EX",
                  effects: ["Increase Buster Card effectiveness by 30%"],
                },
                {
                  label: "3rd Ascension",
                  name: "Ultra Manifest EX",
                  effects: ["Increase Buster Card effectiveness by 50%"],
                },
              ],
            },
          },
        },
      ],
      passives: [],
    },
  };

  ServantInfoApp._renderDetailModal(svt, baseServant, bodyEl, titleEl);

  const state = ServantInfoApp._modalState;
  const profileBtns = state.profileCard.querySelectorAll(".f-option-btn");
  const skillCard = state.slotCards[0];
  const skillTitle = skillCard._refs.titleText;
  const activeLabel = (btns) => {
    const active = btns.find((b) => b.classList.contains("active"));
    return active ? active.textContent : null;
  };

  // Initial Stage 1: Profile and Skill both on "1st&2nd Ascension"
  assert.equal(activeLabel(profileBtns), "1st&2nd Ascension");
  assert.equal(skillTitle.textContent, "Skill 1 (Unparalleled EX)");

  // Step to 3rd Ascension: both Profile and Skill select "3rd Ascension"
  state.sgController.step(1);
  state.sgController.step(1);
  assert.equal(activeLabel(profileBtns), "3rd Ascension");
  assert.equal(activeLabel(skillCard._refs.formBar.querySelectorAll(".f-option-btn")), "3rd Ascension");
  assert.equal(skillTitle.textContent, "Skill 1 (Ultra Manifest EX)");

  // Step to Final Ascension: stays on "3rd Ascension"
  state.sgController.step(1);
  assert.equal(state.sgController.getCurrentEntry().key, "4");
  assert.equal(activeLabel(profileBtns), "3rd Ascension");
  assert.equal(skillTitle.textContent, "Skill 1 (Ultra Manifest EX)");

  // Step to the Spiritron Dress (no ascensionStage): both revert to "1st&2nd Ascension"
  state.sgController.step(1);
  assert.equal(state.sgController.getCurrentEntry().key, "4000130");
  assert.equal(activeLabel(profileBtns), "1st&2nd Ascension");
  assert.equal(activeLabel(skillCard._refs.formBar.querySelectorAll(".f-option-btn")), "1st&2nd Ascension");
  assert.equal(skillTitle.textContent, "Skill 1 (Unparalleled EX)");

  // Clicking the already-active Profile button does not jump the Saint Graph back
  const activeProfileBtn = profileBtns.find((b) => b.classList.contains("active"));
  activeProfileBtn.click();
  assert.equal(state.sgController.getCurrentEntry().key, "4000130");

  // Costume with an explicit ascensionStage still selects "3rd Ascension"
  state.sgController.step(1);
  assert.equal(state.sgController.getCurrentEntry().key, "3120000");
  assert.equal(activeLabel(profileBtns), "3rd Ascension");
  assert.equal(skillTitle.textContent, "Skill 1 (Ultra Manifest EX)");
});
