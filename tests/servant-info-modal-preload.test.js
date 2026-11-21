import { test } from "node:test";
import assert from "node:assert/strict";

const elements = new Map();
const createdImages = [];
let imageBehavior = "load"; // "load" | "error" | "manual" | "decodeReject"

function createMockElement(tag) {
  let _className = "";
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
    complete: false,
    naturalWidth: 0,
    onload: null,
    onerror: null,
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
      this.attributes[k] = v;
      if (this.tagName === "IMG" && k === "src") {
        createdImages.push(this);
        if (imageBehavior === "load") {
          queueMicrotask(() => {
            this.complete = true;
            this.naturalWidth = 512;
            if (typeof this.onload === "function") this.onload();
          });
        } else if (imageBehavior === "error") {
          queueMicrotask(() => {
            this.complete = true;
            this.naturalWidth = 0;
            if (typeof this.onerror === "function") this.onerror();
          });
        } else if (imageBehavior === "decodeReject") {
          this.decode = () => Promise.reject(new Error("decode failed"));
          queueMicrotask(() => {
            this.complete = true;
            this.naturalWidth = 512;
            if (typeof this.onload === "function") this.onload();
          });
        }
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
    },
    append(...nodes) {
      for (const n of nodes) {
        if (n && n.nodeType === 11) {
          this.children.push(...n.children);
          n.children = [];
        } else if (n) {
          this.children.push(n);
        }
      }
    },
    addEventListener() {},
    focus() {},
    querySelectorAll() {
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

function getMockElement(id) {
  if (!elements.has(id)) {
    const el = createMockElement("div");
    el.id = id;
    elements.set(id, el);
  }
  return elements.get(id);
}

globalThis.document = {
  getElementById: (id) => getMockElement(id),
  createElement: (tag) => createMockElement(tag),
  createTextNode: (text) => ({ textContent: text }),
  createDocumentFragment: () => ({
    nodeType: 11,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  }),
  addEventListener: () => {},
  activeElement: null,
};

test("_collectModalImageUrls: collects and deduplicates Saint Graphs, base/alt portraits, stage faces, formConfig faces, and skill icons", async () => {
  const { IMAGE_VERSION } = await import("../src/scripts/constants.js");
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  const baseServant = {
    id: "505600",
    name: "François Prélat",
    image: `servants/505600/000.webp?v=${IMAGE_VERSION}`,
    altImage: `servants/505700/000.webp?v=${IMAGE_VERSION}`,
  };

  const svt = {
    id: 505600,
    saintGraphs: [
      { file: "505600a@1.webp", face: "505600/000.webp" },
      { file: "505600a@2.webp", face: "505600/001.webp" },
      { file: "505600a@1.webp", face: "505600/000.webp" }, // duplicate
      { file: "505700a@1.webp", face: "505700/000.webp" },
      { file: "505730a.webp", face: "505700/c_505730.webp" },
    ],
    formatted: {
      formConfig: {
        0: { index: 0, label: "Form 0" },
        1: {
          index: 1,
          label: "Form 1",
          faces: {
            1: "600710/000.webp",
            2: "600710/001.webp",
            3: "600710/000.webp", // duplicate
          },
        },
      },
      slots: [
        {
          slotKey: "skill_1",
          type: "skill",
          variantsByTier: {
            0: {
              tier: 0,
              icon: "skill_icons/skill_00300.webp",
              forms: [{ icon: "skill_icons/skill_00300.webp" }, { icon: "skill_icons/skill_00601.webp" }],
            },
            1: {
              tier: 1,
              icon: "skill_icons/skill_00400.webp",
              forms: [],
            },
          },
        },
        {
          slotKey: "np_1",
          type: "np",
          variantsByTier: {
            0: { tier: 0, icon: "skill_icons/should_ignore_np.webp" },
          },
        },
      ],
    },
  };

  const urls = ServantInfoApp._collectModalImageUrls(svt, baseServant);
  const expected = [
    `servants/505600/000.webp?v=${IMAGE_VERSION}`,
    `servants/505700/000.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505600a@1.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505600a@2.webp?v=${IMAGE_VERSION}`,
    `servants/505600/001.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505700a@1.webp?v=${IMAGE_VERSION}`,
    `saint_graphs/505730a.webp?v=${IMAGE_VERSION}`,
    `servants/505700/c_505730.webp?v=${IMAGE_VERSION}`,
    `servants/600710/000.webp?v=${IMAGE_VERSION}`,
    `servants/600710/001.webp?v=${IMAGE_VERSION}`,
    `skill_icons/skill_00300.webp?v=${IMAGE_VERSION}`,
    `skill_icons/skill_00601.webp?v=${IMAGE_VERSION}`,
    `skill_icons/skill_00400.webp?v=${IMAGE_VERSION}`,
  ];

  assert.deepEqual(urls, expected);
  assert.equal(new Set(urls).size, urls.length, "URLs must be deduplicated");
});

test("_preloadImageUrl: caches promises per URL and resolves gracefully on error or decode rejection", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  ServantInfoApp._imagePreloadCache.clear();
  createdImages.length = 0;

  imageBehavior = "load";
  const p1 = ServantInfoApp._preloadImageUrl("servants/100100/000.webp?v=test");
  const p2 = ServantInfoApp._preloadImageUrl("servants/100100/000.webp?v=test");
  assert.equal(p1, p2, "Repeated preload for same URL must reuse cached promise");
  await p1;
  assert.equal(createdImages.length, 1, "Only one <img> element created for cached URL");

  imageBehavior = "error";
  await ServantInfoApp._preloadImageUrl("servants/missing/404.webp?v=test");

  imageBehavior = "decodeReject";
  await ServantInfoApp._preloadImageUrl("saint_graphs/corrupt.webp?v=test");
});

test("_openDetailModal: stays in loading state until JSON and all images finish preloading, and guards against stale renders", async () => {
  const { IMAGE_VERSION } = await import("../src/scripts/constants.js");
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  ServantInfoApp._infoCache.clear();
  ServantInfoApp._imagePreloadCache.clear();
  createdImages.length = 0;
  imageBehavior = "manual";

  const modal = getMockElement("servantInfoModal");
  const titleEl = getMockElement("servantInfoModalTitle");
  const bodyEl = getMockElement("servantInfoModalBody");
  getMockElement("servantInfoModalClose");

  const servant = {
    id: "100100",
    collectionNo: 2,
    name: "Altria Pendragon",
    image: `servants/100100/000.webp?v=${IMAGE_VERSION}`,
  };

  const payload = {
    id: 100100,
    collectionNo: 2,
    name: "Altria Pendragon",
    originalName: "アルトリア・ペンドラゴン",
    className: "Saber",
    rarity: 5,
    cost: 16,
    saintGraphs: [
      { key: "1", label: "1st Ascension", file: "100100a@1.webp", kind: "ascension", form: 0, face: "100100/000.webp" },
      { key: "2", label: "2nd Ascension", file: "100100a@2.webp", kind: "ascension", form: 0, face: "100100/001.webp" },
    ],
    formatted: { profile: { forms: [] }, slots: [] },
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });

  try {
    const openPromise = ServantInfoApp._openDetailModal(servant);

    // Wait a tick for fetch() to resolve and image preloading to start
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(modal.classList.contains("open"), true);
    assert.equal(titleEl.textContent, "No.002 Altria Pendragon");
    assert.equal(bodyEl.children.length, 1);
    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      true,
      "Modal must remain in loading state while images are still preloading",
    );
    assert.equal(createdImages.length, 4, "Should preload 2 Saint Graphs + 2 deduplicated face icons");

    // Finish loading the first 3 images — modal must STILL be in loading state
    for (let i = 0; i < 3; i++) {
      createdImages[i].onload();
    }
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      true,
      "Modal must still show loading state when 1 image has not settled",
    );

    // Settle the 4th image (even with onerror) -> modal renders content
    createdImages[3].onerror();
    await openPromise;

    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      false,
      "Modal must replace loading state after all images settle",
    );
    assert.equal(bodyEl.children[0].classList.contains("servant-info-hero"), true);

    // Repeat open with warm _infoCache + _imagePreloadCache renders without spawning duplicate image requests
    const preloadImgsBeforeRepeat = createdImages.filter((img) => typeof img.onload === "function").length;
    await ServantInfoApp._openDetailModal(servant);
    const preloadImgsAfterRepeat = createdImages.filter((img) => typeof img.onload === "function").length;
    assert.equal(
      preloadImgsAfterRepeat,
      preloadImgsBeforeRepeat,
      "Repeat open must reuse cached image preload promises",
    );

    // Stale render guard: closing modal while preloading prevents render
    ServantInfoApp._infoCache.clear();
    ServantInfoApp._imagePreloadCache.clear();
    createdImages.length = 0;
    const staleOpen = ServantInfoApp._openDetailModal(servant);
    await new Promise((r) => setTimeout(r, 10));
    ServantInfoApp._closeDetailModal();
    createdImages.forEach((img) => img.onload && img.onload());
    await staleOpen;
    assert.equal(modal.classList.contains("open"), false);
    assert.equal(
      bodyEl.children[0].classList.contains("servant-info-loading"),
      true,
      "Closed modal must not render detail content after stale preload finishes",
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("_buildSlotCard & _renderSkillContent: renders 32px skill icon before Skill X, updates on strengthen tier and form switch, and hides when absent", async () => {
  const { IMAGE_VERSION } = await import("../src/scripts/constants.js");
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  const modalState = {
    svt: { formatted: {} },
    activeFormIndex: 0,
    servantForms: null,
    slotCards: [],
  };

  const skillSlot = {
    slotKey: "skill_1",
    type: "skill",
    slotNum: 1,
    tiers: [0, 1],
    maxTier: 1,
    activeTier: 1,
    activeTierByForm: {},
    variantsByTier: {
      0: {
        tier: 0,
        type: "skill",
        cleanTitle: "Skill 1 (Charisma B)",
        cooldown: "Cooldown 7-5 turns",
        icon: "skill_icons/skill_00300.webp",
        effects: ["Increase ATK"],
        forms: [],
      },
      1: {
        tier: 1,
        type: "skill",
        cleanTitle: "Skill 1 (Knight of Utopia EX)",
        cooldown: "Cooldown 7-5 turns",
        icon: "skill_icons/skill_00301.webp",
        effects: ["Increase ATK + NP"],
        forms: [
          {
            label: "1st&2nd Ascension",
            name: "Form A Skill",
            cooldown: "Cooldown 7-5 turns",
            icon: "skill_icons/skill_00301.webp",
            effects: ["Effect A"],
          },
          {
            label: "3rd Ascension",
            name: "Form B Skill",
            cooldown: "Cooldown 6-4 turns",
            icon: "skill_icons/skill_00302.webp",
            effects: ["Effect B"],
          },
        ],
      },
    },
  };

  const card = ServantInfoApp._buildSlotCard(skillSlot, modalState);
  const { skillIconEl, titleText, strengthenWrap } = card._refs;
  assert.ok(skillIconEl, "skillIconEl must be created in slot card refs");
  assert.equal(skillIconEl.tagName, "IMG");
  assert.equal(skillIconEl.classList.contains("f-skill-icon"), true);
  assert.equal(skillIconEl.getAttribute("width"), "32");
  assert.equal(skillIconEl.getAttribute("height"), "32");

  // Verify skillIconEl is placed immediately before titleText inside .f-section-title
  const header = card.children.find((c) => c.classList && c.classList.contains("f-section-header"));
  assert.ok(header);
  const titleWrap = header.children[0];
  assert.equal(titleWrap.children[0], skillIconEl, "skillIconEl must be the first child before titleText");
  assert.equal(titleWrap.children[1], titleText, "titleText must immediately follow skillIconEl");
  assert.equal(titleWrap.children[2], strengthenWrap);

  // Initial render uses maxTier (1) and form 0
  assert.equal(skillIconEl.hidden, false);
  assert.equal(skillIconEl.style.display, "");
  assert.equal(skillIconEl.getAttribute("src"), `skill_icons/skill_00301.webp?v=${IMAGE_VERSION}`);
  assert.equal(titleText.textContent, "Skill 1 (Form A Skill)");

  // Switch skill form to form 1 -> icon updates to skill_00302.webp
  ServantInfoApp._renderSkillContent(card, skillSlot.variantsByTier[1], "1", "0", modalState);
  assert.equal(skillIconEl.hidden, false);
  assert.equal(skillIconEl.getAttribute("src"), `skill_icons/skill_00302.webp?v=${IMAGE_VERSION}`);
  assert.equal(titleText.textContent, "Skill 1 (Form B Skill)");

  // Switch to tier 0 (base) -> icon updates to skill_00300.webp
  ServantInfoApp._renderSkillContent(card, skillSlot.variantsByTier[0], "0", "0", modalState);
  assert.equal(skillIconEl.hidden, false);
  assert.equal(skillIconEl.getAttribute("src"), `skill_icons/skill_00300.webp?v=${IMAGE_VERSION}`);
  assert.equal(titleText.textContent, "Skill 1 (Charisma B)");

  // Passive or skill without icon hides skillIconEl gracefully
  const passiveSlot = {
    slotKey: "passive_1",
    type: "passive",
    tiers: [0],
    maxTier: 0,
    activeTier: 0,
    activeTierByForm: {},
    variantsByTier: {
      0: {
        tier: 0,
        type: "passive",
        cleanTitle: "Passives",
        effects: ["Magic Resistance A"],
        forms: [],
      },
    },
  };
  const passiveCard = ServantInfoApp._buildSlotCard(passiveSlot, modalState);
  assert.equal(passiveCard._refs.skillIconEl.hidden, true);
  assert.equal(passiveCard._refs.skillIconEl.style.display, "none");
});

test("parseSkillOptions, OPTION_TRANSLATIONS, and appendHighlightedEffect: ignores [unknown ...] lines, translates JP option labels, and highlights scaling notes", async () => {
  const { ServantInfoApp } = await import("../src/scripts/servant-info-app.js");

  const modalState = {
    svt: { formatted: {} },
    activeFormIndex: 0,
    servantForms: null,
    slotCards: [],
  };

  // 1. Non-option [unknown ...] lines without Select header must NOT create option tabs
  const unknownSkillSlot = {
    slotKey: "skill_1",
    type: "skill",
    slotNum: 1,
    tiers: [0],
    maxTier: 0,
    activeTier: 0,
    activeTierByForm: {},
    variantsByTier: {
      0: {
        tier: 0,
        type: "skill",
        cleanTitle: "Skill 1",
        cooldown: "Cooldown 7-5 turns",
        effects: [
          "Increase ATK by 20% (3 turns) for all allies",
          "[unknown buff type: downStarweight] for yourself",
          "[unknown func type: extendBuffturn (id: 21123)] for all allies",
        ],
        forms: [],
      },
    },
  };

  const unknownCard = ServantInfoApp._buildSlotCard(unknownSkillSlot, modalState);
  const unknownEffectsWrap = unknownCard._refs.effectsContainer;
  assert.equal(
    unknownEffectsWrap.children.some((c) => c.classList && c.classList.contains("f-option-selector-bar")),
    false,
    "[unknown ...] lines without Select header must not render an option selector bar",
  );
  const bulletList = unknownEffectsWrap.children[0];
  assert.equal(bulletList.children.length, 3, "All 3 lines must render directly as bullet items");

  // 2. Real selectable skills (Select X Options with JP labels AND Mash [Normal]/[When loaded with the Holy Sword]) create translated option tabs
  const jpSelectVariant = {
    tier: 1,
    type: "skill",
    cleanTitle: "Skill 3",
    cooldown: "Cooldown 8-6 turns",
    effects: [
      "Select 3 Options ([ガッツなし] / [ガッツ50%回復] / [ガッツ1回復])",
      "Apply Quick Card effectiveness up (3 turns) for yourself",
      "[ガッツ50%回復] Apply Guts by 50% (1 time, 6 turns) for yourself",
      "[ガッツ1回復] Apply Guts by 1 (1 time, 6 turns) for yourself",
    ],
    forms: [],
  };
  ServantInfoApp._renderSkillContent(unknownCard, jpSelectVariant, "0", "0", modalState);
  const optBar = unknownEffectsWrap.children.find((c) => c.classList && c.classList.contains("f-option-selector-bar"));
  assert.ok(optBar, "Select 3 Options skill must render option selector bar");
  const optButtons = optBar.children[0].children;
  assert.equal(optButtons.length, 3);
  assert.equal(optButtons[0].textContent, "No Guts");
  assert.equal(optButtons[1].textContent, "Guts (50% HP)");
  assert.equal(optButtons[2].textContent, "Guts (1 HP)");

  // Check additional JP option labels (e.g. Dante, Charlotte, Barghest, Flora, Lilith, Aśvatthāman, Van Gogh Miner)
  const extraOptionLabels = [
    ["無敵", "ガッツ", "Invincible", "Guts"],
    ["Artsアップ", "クリティカル威力アップ", "Arts Up", "Critical STR Up"],
    ["宝具威力アップ", "Quickアップ", "NP STR Up", "Quick Up"],
    ["Busterアップ", "単体化しない", "Buster Up", "Do not change to Single-Target"],
    ["単体化する", "付与しない", "Change to Single-Target", "Do not apply"],
    ["付与する", "通常状態", "Apply", "Normal State"],
    ["〔冥界の花園〕状態", "天国化(Arts強化)", "[Underworld Flower Garden] State", "Heaven (Arts Up)"],
    ["地獄化(Buster強化)", "消費しない", "Hell (Buster Up)", "Do not expend"],
  ];
  for (const [rawA, rawB, expA, expB] of extraOptionLabels) {
    ServantInfoApp._renderSkillContent(
      unknownCard,
      {
        tier: 0,
        type: "skill",
        cleanTitle: "Skill 1",
        effects: [`Select 2 Options ([${rawA}] / [${rawB}])`, `[${rawA}] Effect A`, `[${rawB}] Effect B`],
        forms: [],
      },
      "0",
      "0",
      modalState,
    );
    const bar = unknownEffectsWrap.children.find((c) => c.classList && c.classList.contains("f-option-selector-bar"));
    assert.ok(bar);
    assert.equal(bar.children[0].children[0].textContent, expA);
    assert.equal(bar.children[0].children[1].textContent, expB);
  }

  // Mash [Normal] / [When loaded with the Holy Sword] (no Select header, known option tags) still splits into 2 options
  ServantInfoApp._renderSkillContent(
    unknownCard,
    {
      tier: 0,
      type: "skill",
      cleanTitle: "Skill 2",
      effects: [
        "[Normal] Increase NP Gauge by 20% for a single ally",
        "[When loaded with the Holy Sword] Increase NP Strength by 50-100% (3 turns) for yourself",
      ],
      forms: [],
    },
    "0",
    "0",
    modalState,
  );
  const mashBar = unknownEffectsWrap.children.find((c) => c.classList && c.classList.contains("f-option-selector-bar"));
  assert.ok(mashBar, "Mash [Normal] / [When loaded with the Holy Sword] must still render option tabs");
  assert.equal(mashBar.children[0].children[0].textContent, "Normal");
  assert.equal(mashBar.children[0].children[1].textContent, "When loaded with the Holy Sword");

  // 3. appendHighlightedEffect highlights [Demerit] and scaling notes, but keeps <Apply a state ...> and <Change NP Card type ...> as plain text
  ServantInfoApp._renderEffectsList(unknownEffectsWrap, [
    "Deal heavy damage <Special Attack damage increases with Overcharge> by 300-500% <effect increases with Level> [Demerit]",
    "Increase ATK <effect increases when HP is low> & <strength increases with Overcharge> & <times increase with Overcharge>",
    "Deal damage <STR increases by 5% based on the number of [Likes!] states (Max 10) on yourself> & <Special Attack damage increases by 10% with each [Burn] status (Maximum 10) on the target> & <increases by 25%>",
    'Inflict state <Apply a state that "Inflict Curse" at turn end> and <Change NP Card type to [Buster]>',
  ]);
  const renderedUl = unknownEffectsWrap.children[0];
  const li0 = renderedUl.children[0];
  const li0Notes = li0.children.filter((c) => c.tagName === "EM" && c.classList.contains("f-overcharge-note"));
  const li0Demerits = li0.children.filter((c) => c.tagName === "SPAN" && c.classList.contains("f-demerit-tag"));
  assert.equal(li0Notes.length, 2);
  assert.equal(li0Notes[0].textContent, "<Special Attack damage increases with Overcharge>");
  assert.equal(li0Notes[1].textContent, "<effect increases with Level>");
  assert.equal(li0Demerits.length, 1);
  assert.equal(li0Demerits[0].textContent, "Demerit");

  const li1Notes = renderedUl.children[1].children.filter(
    (c) => c.tagName === "EM" && c.classList.contains("f-overcharge-note"),
  );
  assert.equal(li1Notes.length, 3);

  const li2Notes = renderedUl.children[2].children.filter(
    (c) => c.tagName === "EM" && c.classList.contains("f-overcharge-note"),
  );
  assert.equal(li2Notes.length, 3);

  const li3Notes = renderedUl.children[3].children.filter(
    (c) => c.tagName === "EM" && c.classList.contains("f-overcharge-note"),
  );
  assert.equal(li3Notes.length, 0, "<Apply a state ...> and <Change NP Card type ...> must not be italicized");
});
