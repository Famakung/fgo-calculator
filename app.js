/**
 * FGO Event Calculator - Clean Architecture
 * app.js
 *
 * Architecture:
 * 1. Domain Layer - Pure business logic, no DOM
 * 2. Application Layer - State, persistence, orchestration
 * 3. Presentation Layer - DOM factory, UI builder, events
 * 4. Initialization - Bootstrap
 */
(function() {
"use strict";

/* ============================================
   CONSTANTS
   ============================================ */
const TIERS = ["bronze", "silver", "gold"];
const TIER_FIELDS = ["Need", "Have", "Bonus"];
const MAX_ITERATIONS = 10000;
const EPSILON = 0.01;
const DEBOUNCE_MS = 100;
const STORAGE_KEY = "fgo_calculator_data";

const ICON_URLS = {
  bronze: {
    bg: "icons/materials/bronze_bg.webp",
    fg: "icons/materials/bronze_fg.webp"
  },
  silver: {
    bg: "icons/materials/silver_bg.webp",
    fg: "icons/materials/silver_fg.webp"
  },
  gold: {
    bg: "icons/materials/gold_bg.webp",
    fg: "icons/materials/gold_fg.webp"
  }
};

const TIER_COLORS = {
  bronze: "#cd7f32",
  silver: "#71717a",
  gold: "#eab308"
};

const QUEST_DROPS = {
  bronze: { primary: "bronze", secondary: "silver" },
  silver: { primary: "silver", secondary: "gold" },
  gold: { primary: "gold", secondary: "bronze" }
};

/* ============================================
   DOMAIN LAYER - Schema & Validation
   ============================================ */
const Schema = {
  tier: {
    Need: { min: 0, max: 999999, default: 0 },
    Have: { min: 0, max: 999999, default: 0 },
    Bonus: { min: 0, max: 1000, default: 0 }
  },
  baseDrop: { min: 0, max: 100, default: 3 },
  primaryMultiplier: { min: 100, max: 100000, default: 1500 },
  secondaryMultiplier: { min: 100, max: 100000, default: 225 }
};

const Validator = {
  clamp(value, min, max) {
    const num = parseFloat(value);
    if (isNaN(num)) return min;
    return Math.min(max, Math.max(min, num));
  },

  validate(value, schema) {
    return this.clamp(value, schema.min, schema.max);
  },

  validateTierData(data) {
    const result = {};
    TIERS.forEach(tier => {
      result[tier] = {};
      TIER_FIELDS.forEach(field => {
        const key = `${tier}${field}`;
        const val = data[key];
        result[tier][field.toLowerCase()] = this.validate(
          val,
          Schema.tier[field]
        );
      });
    });
    return result;
  },

  validateSettings(data) {
    return {
      baseDrop: this.validate(data.baseDrop, Schema.baseDrop),
      primaryMultiplier: this.validate(data.primaryMultiplier, Schema.primaryMultiplier),
      secondaryMultiplier: this.validate(data.secondaryMultiplier, Schema.secondaryMultiplier)
    };
  },

  validateStorageData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }
    const allowedKeys = [
      ...TIERS.flatMap(t => TIER_FIELDS.map(f => `${t}${f}`)),
      "baseDrop", "primaryMultiplier", "secondaryMultiplier"
    ];
    const sanitized = {};
    for (const key of allowedKeys) {
      if (key in data) {
        // Validate value is a valid number
        const num = parseFloat(data[key]);
        if (!isNaN(num)) {
          sanitized[key] = num;
        }
      }
    }
    return sanitized;
  }
};

/* ============================================
   DOMAIN LAYER - Calculator
   ============================================ */
const Calculator = {
  calcDropRate(base, bonus, multiplier) {
    return Math.round((base + bonus) * multiplier * 100) / 100;
  },

  calcDeficits(needs, haves) {
    const deficits = {};
    TIERS.forEach(tier => {
      deficits[tier] = Math.max(0, needs[tier] - haves[tier]);
    });
    return deficits;
  },

  calcOptimalRuns(deficits, dropRates) {
    const runs = { bronze: 0, silver: 0, gold: 0 };
    const remaining = { ...deficits };
    let iterations = 0;

    while (
      TIERS.some(t => remaining[t] > EPSILON) &&
      iterations < MAX_ITERATIONS
    ) {
      iterations++;

      // Find highest deficit
      const maxTier = TIERS.reduce((a, b) =>
        remaining[a] >= remaining[b] ? a : b
      );

      const quest = dropRates[maxTier];
      const totalRate = quest.primary.rate + quest.secondary.rate;

      if (totalRate <= 0) {
        return { runs, error: "Drop rates too low" };
      }

      remaining[quest.primary.tier] -= quest.primary.rate;
      remaining[quest.secondary.tier] -= quest.secondary.rate;
      runs[maxTier]++;
    }

    if (iterations >= MAX_ITERATIONS) {
      return { runs, warning: "Calculation limit reached" };
    }

    return { runs };
  }
};

/* ============================================
   APPLICATION LAYER - State Manager
   ============================================ */
const StateManager = {
  createInitial() {
    const tiers = {};
    TIERS.forEach(tier => {
      tiers[tier] = { need: 0, have: 0, bonus: 0 };
    });
    return {
      tiers,
      baseDrop: Schema.baseDrop.default,
      primaryMultiplier: Schema.primaryMultiplier.default,
      secondaryMultiplier: Schema.secondaryMultiplier.default,
      results: null
    };
  },

  updateTier(state, tier, field, value) {
    return {
      ...state,
      tiers: {
        ...state.tiers,
        [tier]: {
          ...state.tiers[tier],
          [field]: value
        }
      }
    };
  },

  updateSetting(state, key, value) {
    return { ...state, [key]: value };
  },

  setResults(state, results) {
    return { ...state, results };
  }
};

/* ============================================
   APPLICATION LAYER - Persistence
   ============================================ */
const Persistence = {
  save(state) {
    try {
      const data = {
        ...TIERS.flatMap(tier =>
          TIER_FIELDS.map(field => ({
            [`${tier}${field}`]: state.tiers[tier][field.toLowerCase()]
          }))
        ).reduce((a, b) => ({ ...a, ...b }), {}),
        baseDrop: state.baseDrop,
        primaryMultiplier: state.primaryMultiplier,
        secondaryMultiplier: state.secondaryMultiplier
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("Failed to save:", e);
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw);
      const sanitized = Validator.validateStorageData(data);
      if (!sanitized) return null;

      const state = StateManager.createInitial();

      // Load tier data
      TIERS.forEach(tier => {
        TIER_FIELDS.forEach(field => {
          const key = `${tier}${field}`;
          if (key in sanitized) {
            state.tiers[tier][field.toLowerCase()] = Validator.validate(
              sanitized[key],
              Schema.tier[field]
            );
          }
        });
      });

      // Load settings
      if ("baseDrop" in sanitized) {
        state.baseDrop = Validator.validate(sanitized.baseDrop, Schema.baseDrop);
      }
      if ("primaryMultiplier" in sanitized) {
        state.primaryMultiplier = Validator.validate(sanitized.primaryMultiplier, Schema.primaryMultiplier);
      }
      if ("secondaryMultiplier" in sanitized) {
        state.secondaryMultiplier = Validator.validate(sanitized.secondaryMultiplier, Schema.secondaryMultiplier);
      }

      return state;
    } catch (e) {
      console.warn("Failed to load:", e);
      return null;
    }
  }
};

/* ============================================
   PRESENTATION LAYER - DOM Factory
   ============================================ */
const DOMFactory = {
  el(tag, className, attrs = {}) {
    const element = document.createElement(tag);
    if (className) {
      if (Array.isArray(className)) {
        className.forEach(c => element.classList.add(c));
      } else {
        element.className = className;
      }
    }
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "dataset") {
        Object.entries(value).forEach(([k, v]) => {
          element.dataset[k] = v;
        });
      } else {
        element.setAttribute(key, value);
      }
    });
    return element;
  },

  createIcon(tier, size = "normal") {
    const container = this.el(
      "div",
      size === "normal" ? "material-icon" : "mini-icon"
    );
    container.id = size === "normal" ? `${tier}Icon` : undefined;

    const bgImg = this.el("img", "bg-layer", {
      src: ICON_URLS[tier].bg,
      alt: ""
    });
    bgImg.onerror = () => { bgImg.style.display = "none"; };

    const fgImg = this.el("img", "fg-layer", {
      src: ICON_URLS[tier].fg,
      alt: `${this.capitalize(tier)} material icon`
    });

    fgImg.onerror = () => {
      const fallback = this.el("div", "icon-fallback");
      fallback.style.background = TIER_COLORS[tier];
      fallback.textContent = this.capitalize(tier).charAt(0);
      fgImg.replaceWith(fallback);
    };

    container.appendChild(bgImg);
    container.appendChild(fgImg);
    return container;
  },

  createInput(id, label, value, min, max) {
    const row = this.el("div", "input-row");

    const labelEl = this.el("label", "input-label", { for: id });
    labelEl.textContent = label;

    const input = this.el("input", "input-field", {
      type: "number",
      id,
      min: String(min),
      max: String(max),
      value: String(value)
    });

    row.appendChild(labelEl);
    row.appendChild(input);
    return { row, input };
  },

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
};

/* ============================================
   PRESENTATION LAYER - UI Builder
   ============================================ */
const UIBuilder = {
  // DOM cache
  elements: {},

  buildMaterialsGrid(container, state) {
    container.innerHTML = "";

    TIERS.forEach(tier => {
      const card = DOMFactory.el("div", "material-card", {
        dataset: { tier }
      });

      // Icon
      const iconWrapper = DOMFactory.el("div", "material-icon-wrapper");
      const icon = DOMFactory.createIcon(tier);
      iconWrapper.appendChild(icon);
      card.appendChild(iconWrapper);

      // Name
      const name = DOMFactory.el("div", "material-name");
      name.textContent = DOMFactory.capitalize(tier);
      card.appendChild(name);

      // Inputs
      TIER_FIELDS.forEach(field => {
        const id = `${tier}${field}`;
        const max = field === "Bonus" ? 1000 : 999999;
        const { row, input } = DOMFactory.createInput(
          id,
          field,
          state.tiers[tier][field.toLowerCase()],
          0,
          max
        );
        this.elements[id] = input;
        card.appendChild(row);
      });

      container.appendChild(card);
    });
  },

  buildQuestDropsGrid(container) {
    container.innerHTML = "";

    Object.entries(QUEST_DROPS).forEach(([questTier, drops]) => {
      const item = DOMFactory.el("div", "quest-drops-item", {
        dataset: { tier: questTier }
      });

      const title = DOMFactory.el("div", "quest-drops-title");
      title.textContent = `${DOMFactory.capitalize(questTier)} Quest`;
      item.appendChild(title);

      [drops.primary, drops.secondary].forEach(material => {
        const line = DOMFactory.el("div", "drop-line");

        const miniIcon = DOMFactory.el("span", "mini-icon");
        miniIcon.id = `${questTier}Quest_${material}_icon`;
        line.appendChild(miniIcon);

        const label = DOMFactory.el("span", "drop-material");
        label.id = `${questTier}Quest_${material}_label`;
        label.textContent = "3(+0)";
        line.appendChild(label);

        const value = DOMFactory.el("span", "drop-value");
        value.id = `${questTier}Quest_${material}`;
        value.textContent = "0";
        line.appendChild(value);

        item.appendChild(line);
      });

      container.appendChild(item);
    });
  },

  buildDeficitGrid(container) {
    container.innerHTML = "";

    TIERS.forEach(tier => {
      const item = DOMFactory.el("div", "deficit-item", {
        dataset: { tier }
      });

      const label = DOMFactory.el("div", "deficit-label");
      label.textContent = DOMFactory.capitalize(tier);

      const value = DOMFactory.el("div", "deficit-value");
      value.id = `${tier}Deficit`;
      value.textContent = "0";

      item.appendChild(label);
      item.appendChild(value);
      container.appendChild(item);
    });
  },

  buildQuestGrid(container) {
    container.innerHTML = "";

    TIERS.forEach(tier => {
      const item = DOMFactory.el("div", "quest-item", {
        dataset: { tier }
      });

      const name = DOMFactory.el("div", "quest-name");
      name.textContent = `${DOMFactory.capitalize(tier)} Quest`;

      const count = DOMFactory.el("div", "quest-count");
      count.id = `${tier}Play`;
      count.textContent = "0";

      const label = DOMFactory.el("div", "quest-label");
      label.textContent = "runs";

      item.appendChild(name);
      item.appendChild(count);
      item.appendChild(label);
      container.appendChild(item);
    });
  },

  loadQuestIcons() {
    Object.entries(QUEST_DROPS).forEach(([quest, drops]) => {
      [drops.primary, drops.secondary].forEach(material => {
        const container = document.getElementById(`${quest}Quest_${material}_icon`);
        if (container) {
          const icon = DOMFactory.createIcon(material, "mini");
          container.appendChild(icon);
        }
      });
    });
  }
};

/* ============================================
   PRESENTATION LAYER - View Manager
   ============================================ */
const ViewManager = {
  updateDropDisplay(state) {
    const base = state.baseDrop;
    const primaryMult = state.primaryMultiplier / 100;
    const secondaryMult = state.secondaryMultiplier / 100;

    TIERS.forEach(questTier => {
      const drops = QUEST_DROPS[questTier];
      const primaryBonus = state.tiers[drops.primary].bonus;
      const secondaryBonus = state.tiers[drops.secondary].bonus;

      const primaryDrop = Calculator.calcDropRate(base, primaryBonus, primaryMult);
      const secondaryDrop = Calculator.calcDropRate(base, secondaryBonus, secondaryMult);

      const primaryLabel = document.getElementById(`${questTier}Quest_${drops.primary}_label`);
      const secondaryLabel = document.getElementById(`${questTier}Quest_${drops.secondary}_label`);
      const primaryValue = document.getElementById(`${questTier}Quest_${drops.primary}`);
      const secondaryValue = document.getElementById(`${questTier}Quest_${drops.secondary}`);

      if (primaryLabel) primaryLabel.textContent = `${base}(+${primaryBonus})`;
      if (secondaryLabel) secondaryLabel.textContent = `${base}(+${secondaryBonus})`;
      if (primaryValue) primaryValue.textContent = primaryDrop;
      if (secondaryValue) secondaryValue.textContent = secondaryDrop;
    });
  },

  showResults(deficits, runs) {
    const results = document.getElementById("results");
    if (results) results.classList.add("visible");

    TIERS.forEach(tier => {
      const deficitEl = document.getElementById(`${tier}Deficit`);
      if (deficitEl) deficitEl.textContent = Math.max(0, Math.ceil(deficits[tier]));

      const runEl = document.getElementById(`${tier}Play`);
      if (runEl) runEl.textContent = runs[tier];
    });

    setTimeout(() => {
      results?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  },

  syncInputsFromState(state) {
    TIERS.forEach(tier => {
      TIER_FIELDS.forEach(field => {
        const input = UIBuilder.elements[`${tier}${field}`];
        if (input) {
          input.value = state.tiers[tier][field.toLowerCase()];
        }
      });
    });

    document.getElementById("baseDrop").value = state.baseDrop;
    document.getElementById("primaryMultiplier").value = state.primaryMultiplier;
    document.getElementById("secondaryMultiplier").value = state.secondaryMultiplier;
  }
};

/* ============================================
   PRESENTATION LAYER - Event Handler
   ============================================ */
const EventHandler = {
  debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  },

  bind(app) {
    const debouncedUpdate = this.debounce(() => {
      ViewManager.updateDropDisplay(app.state);
    }, DEBOUNCE_MS);

    // Tier bonus inputs
    TIERS.forEach(tier => {
      const input = UIBuilder.elements[`${tier}Bonus`];
      if (input) {
        input.addEventListener("input", (e) => {
          const value = Validator.validate(e.target.value, Schema.tier.Bonus);
          app.state = StateManager.updateTier(app.state, tier, "bonus", value);
          debouncedUpdate();
        });
      }
    });

    // Base drop and multiplier inputs
    ["baseDrop", "primaryMultiplier", "secondaryMultiplier"].forEach(key => {
      const input = document.getElementById(key);
      if (input) {
        input.addEventListener("input", (e) => {
          const value = Validator.validate(e.target.value, Schema[key]);
          app.state = StateManager.updateSetting(app.state, key, value);
          debouncedUpdate();
        });
      }
    });

    // Calculate button
    const calcBtn = document.getElementById("calculateBtn");
    if (calcBtn) {
      calcBtn.addEventListener("click", () => app.calculate());
    }
  }
};

/* ============================================
   APPLICATION - App Controller
   ============================================ */
const App = {
  state: null,

  init() {
    // Initialize state
    this.state = Persistence.load() || StateManager.createInitial();

    // Build UI
    UIBuilder.buildMaterialsGrid(
      document.getElementById("materialsGrid"),
      this.state
    );
    UIBuilder.buildQuestDropsGrid(document.getElementById("questDropsGrid"));
    UIBuilder.buildDeficitGrid(document.getElementById("deficitGrid"));
    UIBuilder.buildQuestGrid(document.getElementById("questGrid"));

    // Sync inputs
    ViewManager.syncInputsFromState(this.state);

    // Load icons
    UIBuilder.loadQuestIcons();

    // Update display
    ViewManager.updateDropDisplay(this.state);

    // Bind events
    EventHandler.bind(this);
  },

  calculate() {
    // Read all inputs
    TIERS.forEach(tier => {
      TIER_FIELDS.forEach(field => {
        const input = UIBuilder.elements[`${tier}${field}`];
        if (input) {
          const value = Validator.validate(input.value, Schema.tier[field]);
          this.state = StateManager.updateTier(
            this.state,
            tier,
            field.toLowerCase(),
            value
          );
        }
      });
    });

    // Save
    Persistence.save(this.state);

    // Calculate
    const needs = {};
    const haves = {};
    TIERS.forEach(tier => {
      needs[tier] = this.state.tiers[tier].need;
      haves[tier] = this.state.tiers[tier].have;
    });

    const deficits = Calculator.calcDeficits(needs, haves);

    // Build drop rates
    const dropRates = {};
    const base = this.state.baseDrop;
    const primaryMult = this.state.primaryMultiplier / 100;
    const secondaryMult = this.state.secondaryMultiplier / 100;

    TIERS.forEach(questTier => {
      const drops = QUEST_DROPS[questTier];
      dropRates[questTier] = {
        primary: {
          tier: drops.primary,
          rate: Calculator.calcDropRate(
            base,
            this.state.tiers[drops.primary].bonus,
            primaryMult
          )
        },
        secondary: {
          tier: drops.secondary,
          rate: Calculator.calcDropRate(
            base,
            this.state.tiers[drops.secondary].bonus,
            secondaryMult
          )
        }
      };
    });

    // Calculate runs
    const result = Calculator.calcOptimalRuns(deficits, dropRates);

    if (result.error) {
      alert(result.error);
      return;
    }

    if (result.warning) {
      console.warn(result.warning);
    }

    // Show results
    ViewManager.showResults(deficits, result.runs);
  }
};

/* ============================================
   TAB NAVIGATION
   ============================================ */
const TabNavigator = {
  init() {
    const tabBar = document.querySelector(".tab-bar");
    if (!tabBar) return;

    // Restore active tab
    try {
      const savedTab = localStorage.getItem("fgo_active_tab");
      if (savedTab) {
        document.querySelectorAll(".tab-btn").forEach(btn => {
          btn.classList.toggle("active", btn.dataset.tab === savedTab);
        });
        document.querySelectorAll(".tab-panel").forEach(panel => {
          panel.classList.toggle("active", panel.id === "panel-" + savedTab);
        });
      }
    } catch (e) { /* ignore */ }

    tabBar.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab-btn")) return;
      const tab = e.target.dataset.tab;

      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

      e.target.classList.add("active");
      document.getElementById("panel-" + tab).classList.add("active");

      try {
        localStorage.setItem("fgo_active_tab", tab);
      } catch (e) { /* ignore */ }
    });
  }
};

/* ============================================
   BOND CALCULATOR
   ============================================ */
const BOND_QUESTS = [
  { key: "fq83", name: "FreeQuest Lv.83", bond: 835 },
  { key: "fq84", name: "FreeQuest Lv.84", bond: 855 },
  { key: "gd100", name: "GrandDuel Lv.100\u2605\u2605\u2605", bond: 4748 }
];
const BOND_STORAGE_KEY = "fgo_bond_calculator_data";

/* Trait names from traits/traits.js */
const TraitNames = (typeof TRAIT_DATA !== "undefined") ? TRAIT_DATA : {};

/* CE data from craft_essences/craft_essences.js */
const CEList = (() => {
  const map = (typeof CE_DATA !== "undefined") ? CE_DATA : {};
  return Object.entries(map).map(([id, data]) => {
    const isGroup = !!data.isGroup;
    const base = {
      id,
      name: data.name || `CE ${id}`,
      bonus: data.bonus || 0,
      traits: Array.isArray(data.traits) ? data.traits : [],
      matchAll: !!data.matchAll,
      traitGroups: Array.isArray(data.traitGroups) ? data.traitGroups : [],
      isGroup,
      flatBonus: isGroup ? (data.flatBonus || 0) : 0,
      image: `craft_essences/${id}.webp`
    };
    if (isGroup && data.options) {
      const folder = data.folder || id;
      base.options = Object.entries(data.options).map(([optId, opt]) => ({
        id: optId,
        name: opt.name || `CE ${optId}`,
        image: `craft_essences/${folder}/${optId}.webp`
      }));
      // Use the specified groupImage option, fallback to option matching group ID, then first
      const groupOpt = data.groupImage
        ? base.options.find(o => o.id === data.groupImage)
        : (base.options.find(o => o.id === id) || base.options[0]);
      if (groupOpt) {
        base.image = groupOpt.image;
      }
    }
    return base;
  }).sort((a, b) => a.id.localeCompare(b.id));
})();

/* ============================================
   SERVANT DATA
   ============================================ */
const ServantData = {
  servants: [],

  load() {
    const map = (typeof SERVANT_DATA !== "undefined") ? SERVANT_DATA : {};
    this.servants = Object.entries(map)
      .map(([id, data]) => {
        const name = typeof data === "string" ? data : (data.name || "");
        const rawTraits = (typeof data === "object" && data.traits) ? data.traits : [];
        const isArray = Array.isArray(rawTraits);
        const traits = isArray ? rawTraits : (rawTraits.base || []);
        const hasAscensions = !isArray && typeof rawTraits === "object";
        const optionLabels = (typeof data === "object" && data.optionLabels) ? data.optionLabels : {};
        const optionNames = (typeof data === "object" && data.optionNames) ? data.optionNames : {};
        return {
          id,
          name: name || `Servant ${id}`,
          traits,
          rawTraits,
          hasAscensions,
          optionLabels,
          optionNames,
          image: `servants/${id}.webp`
        };
      }).sort((a, b) => a.id.localeCompare(b.id));
  },

  getServant(id) {
    return this.servants.find(s => s.id === id) || null;
  },

  getTraitsForAscension(id, ascension) {
    const servant = this.getServant(id);
    if (!servant) return [];
    if (!servant.hasAscensions) return servant.traits;
    const raw = servant.rawTraits;
    const base = raw.base || [];
    if (!ascension || !raw[ascension]) return base;
    return [...base, ...raw[ascension]];
  },

  getImageForAscension(id, ascension) {
    if (ascension) {
      return `servants/${id}/${ascension}.webp`;
    }
    return `servants/${id}.webp`;
  },

  getAscensionOptions(id) {
    const servant = this.getServant(id);
    if (!servant || !servant.hasAscensions) return [];
    const raw = servant.rawTraits;
    // Always include all three standard ascensions, plus any custom keys
    const standard = ["000", "001", "002"];
    const custom = Object.keys(raw).filter(k => k !== "base" && !standard.includes(k));
    return [...standard, ...custom];
  },

  getAscensionLabel(id, key) {
    const LABELS = {"000": "1st Ascension", "001": "2nd Ascension", "002": "3rd Ascension"};
    if (LABELS[key]) return LABELS[key];
    const servant = this.getServant(id);
    if (servant && servant.optionLabels && servant.optionLabels[key]) {
      return servant.optionLabels[key];
    }
    return key;
  },

  getAscensionName(id, ascension) {
    const servant = this.getServant(id);
    if (!servant) return "";
    if (ascension && servant.optionNames && servant.optionNames[ascension]) {
      return servant.optionNames[ascension];
    }
    return servant.name;
  },

  getAllNames(id) {
    const servant = this.getServant(id);
    if (!servant) return [];
    const names = [servant.name];
    if (servant.optionNames) {
      Object.values(servant.optionNames).forEach(n => {
        if (!names.includes(n)) names.push(n);
      });
    }
    return names;
  }
};

/* ============================================
   SERVANT SELECTOR MODAL
   ============================================ */
const ServantSelector = {
  activeSlotIndex: null,
  pendingSlot: false,

  init() {
    const modal = document.getElementById("servantModal");
    const closeBtn = document.getElementById("servantModalClose");
    const searchInput = document.getElementById("servantSearch");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.filter(e.target.value);
      });
    }
  },

  open(slotIndex, pending = false) {
    this.activeSlotIndex = slotIndex;
    this.pendingSlot = pending;
    const modal = document.getElementById("servantModal");
    const searchInput = document.getElementById("servantSearch");

    this.renderGrid(ServantData.servants);
    if (searchInput) searchInput.value = "";
    if (modal) modal.classList.add("open");
  },

  close() {
    // If this was a pending add and no servant was picked, remove the slot
    if (this.pendingSlot && this.activeSlotIndex !== null) {
      BondApp.state.slots.splice(this.activeSlotIndex, 1);
      BondApp.buildServantSlots();
    }
    const modal = document.getElementById("servantModal");
    if (modal) modal.classList.remove("open");
    this.activeSlotIndex = null;
    this.pendingSlot = false;
  },

  renderGrid(servants) {
    const grid = document.getElementById("servantPickerGrid");
    if (!grid) return;
    grid.innerHTML = "";

    servants.forEach(servant => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const imgSrc = servant.hasAscensions
        ? ServantData.getImageForAscension(servant.id, "000")
        : servant.image;
      const img = DOMFactory.el("img", null, {
        src: imgSrc,
        alt: servant.name
      });
      img.onerror = () => {
        if (servant.hasAscensions && !img.dataset.retriedFlat) {
          img.dataset.retriedFlat = "1";
          img.src = servant.image;
        } else {
          const fallback = DOMFactory.el("div", "servant-slot-portrait-fallback");
          fallback.textContent = servant.id;
          img.replaceWith(fallback);
        }
      };

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = servant.name;

      item.appendChild(img);
      item.appendChild(name);

      item.addEventListener("click", () => {
        this.pendingSlot = false; // servant selected, don't remove on close
        if (servant.hasAscensions) {
          const idx = this.activeSlotIndex;
          this.close();
          AscensionSelector.open(servant, idx);
        } else {
          BondApp.setServant(this.activeSlotIndex, servant.id, null);
          this.close();
        }
      });

      grid.appendChild(item);
    });
  },

  filter(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.renderGrid(ServantData.servants);
      return;
    }
    const filtered = ServantData.servants.filter(s =>
      s.id.toLowerCase().includes(q) || ServantData.getAllNames(s.id).some(n => n.toLowerCase().includes(q))
    );
    this.renderGrid(filtered);
  }
};

/* ============================================
   ASCENSION SELECTOR MODAL
   ============================================ */
const AscensionSelector = {
  servant: null,
  slotIndex: null,

  init() {
    const modal = document.getElementById("ascensionModal");
    const closeBtn = document.getElementById("ascensionModalClose");
    const backBtn = document.getElementById("ascensionModalBack");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (backBtn) {
      backBtn.addEventListener("click", () => this.back());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(servant, slotIndex) {
    this.servant = servant;
    this.slotIndex = slotIndex;
    const modal = document.getElementById("ascensionModal");
    const title = document.getElementById("ascensionModalTitle");

    if (title) title.textContent = servant.name;
    this.renderGrid();
    if (modal) modal.classList.add("open");
  },

  close() {
    const modal = document.getElementById("ascensionModal");
    if (modal) modal.classList.remove("open");
    this.servant = null;
    this.slotIndex = null;
  },

  back() {
    const idx = this.slotIndex;
    this.close();
    if (idx !== null) {
      ServantSelector.open(idx);
    }
  },

  renderGrid() {
    const grid = document.getElementById("ascensionPickerGrid");
    if (!grid || !this.servant) return;
    grid.innerHTML = "";

    const options = ServantData.getAscensionOptions(this.servant.id);
    options.forEach(asc => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const imgSrc = ServantData.getImageForAscension(this.servant.id, asc);
      const img = DOMFactory.el("img", null, {
        src: imgSrc,
        alt: ServantData.getAscensionLabel(this.servant.id, asc)
      });
      img.onerror = () => {
        const fallback = DOMFactory.el("div", "servant-slot-portrait-fallback");
        fallback.textContent = this.servant.id;
        img.replaceWith(fallback);
      };

      const label = DOMFactory.el("div", "servant-picker-name");
      label.textContent = ServantData.getAscensionLabel(this.servant.id, asc);

      item.appendChild(img);
      item.appendChild(label);

      item.addEventListener("click", () => {
        BondApp.setServant(this.slotIndex, this.servant.id, asc);
        this.close();
        ServantSelector.close();
      });

      grid.appendChild(item);
    });
  }
};

/* ============================================
   SERVANT DRAG REORDER
   ============================================ */
const ServantDrag = {
  dragIndex: null,
  holdTimer: null,
  isDragging: false,

  init() {
    const grid = document.getElementById("servantGrid");
    grid.addEventListener("mousedown", (e) => this.onHoldStart(e));
    grid.addEventListener("touchstart", (e) => this.onHoldStart(e), { passive: false });
    document.addEventListener("mousemove", (e) => this.onHoldMove(e));
    document.addEventListener("touchmove", (e) => this.onHoldMove(e), { passive: false });
    document.addEventListener("mouseup", () => this.onHoldEnd());
    document.addEventListener("touchend", () => this.onHoldEnd());
  },

  onHoldStart(e) {
    // Don't interfere with inputs/selects
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "OPTION") return;

    const slot = e.target.closest(".servant-slot:not(.servant-add-slot)");
    if (!slot || slot.dataset.slotIndex === undefined) return;
    const index = parseInt(slot.dataset.slotIndex);
    if (isNaN(index)) return;

    // Prevent native image drag on desktop
    if (e.type === "mousedown") e.preventDefault();

    this.dragIndex = index;
    this.isDragging = false;
    this.holdTimer = setTimeout(() => {
      this.isDragging = true;
      slot.classList.add("dragging");
    }, 300);
  },

  onHoldMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();

    const grid = document.getElementById("servantGrid");
    const touch = e.touches ? e.touches[0] : e;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const slot = target ? target.closest(".servant-slot:not(.servant-add-slot)") : null;

    grid.querySelectorAll(".servant-slot.drag-over").forEach(s => s.classList.remove("drag-over"));
    if (slot && slot.dataset.slotIndex !== undefined) {
      const targetIndex = parseInt(slot.dataset.slotIndex);
      if (targetIndex !== this.dragIndex) {
        slot.classList.add("drag-over");
      }
    }
  },

  onHoldEnd() {
    clearTimeout(this.holdTimer);
    if (!this.isDragging) {
      this.dragIndex = null;
      return;
    }

    const grid = document.getElementById("servantGrid");
    const dragOver = grid.querySelector(".servant-slot.drag-over");
    if (dragOver && this.dragIndex !== null) {
      const targetIndex = parseInt(dragOver.dataset.slotIndex);
      if (!isNaN(targetIndex) && targetIndex !== this.dragIndex) {
        BondApp.flushInputsToState();
        const slots = BondApp.state.slots;
        const temp = slots[this.dragIndex];
        slots[this.dragIndex] = slots[targetIndex];
        slots[targetIndex] = temp;
        BondApp.saveState();
        BondApp.buildServantSlots();
      }
    }

    grid.querySelectorAll(".servant-slot").forEach(s => {
      s.classList.remove("dragging", "drag-over");
    });
    this.dragIndex = null;
    this.isDragging = false;
  }
};

/* ============================================
   CE SELECTOR MODAL
   ============================================ */
const CESelector = {
  activeSlotIndex: null,
  pendingSlot: false,

  init() {
    const modal = document.getElementById("ceModal");
    const closeBtn = document.getElementById("ceModalClose");
    const searchInput = document.getElementById("ceSearch");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.filter(e.target.value);
      });
    }
  },

  open(slotIndex, pending = false) {
    this.activeSlotIndex = slotIndex;
    this.pendingSlot = pending;
    const modal = document.getElementById("ceModal");
    const searchInput = document.getElementById("ceSearch");

    this.renderGrid(CEList);
    if (searchInput) searchInput.value = "";
    if (modal) modal.classList.add("open");
  },

  close() {
    if (this.pendingSlot && this.activeSlotIndex !== null) {
      BondApp.state.ces.splice(this.activeSlotIndex, 1);
      BondApp.buildCESlots();
    }
    const modal = document.getElementById("ceModal");
    if (modal) modal.classList.remove("open");
    this.activeSlotIndex = null;
    this.pendingSlot = false;
  },

  renderGrid(ces) {
    const grid = document.getElementById("cePickerGrid");
    if (!grid) return;
    grid.innerHTML = "";

    ces.forEach(ce => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.el("img", null, { src: ce.image, alt: ce.name });
      img.onerror = () => {
        const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
        fb.textContent = ce.id;
        img.replaceWith(fb);
      };

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = ce.name;
      item.appendChild(img);
      item.appendChild(name);

      item.addEventListener("click", () => {
        if (ce.isGroup) {
          const idx = this.activeSlotIndex;
          this.pendingSlot = false;
          this.close();
          CESubSelector.open(ce, idx);
          return;
        }
        this.pendingSlot = false;
        BondApp.setCE(this.activeSlotIndex, ce.id);
        this.close();
      });

      grid.appendChild(item);
    });
  },

  filter(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      this.renderGrid(CEList);
      return;
    }
    const filtered = CEList.filter(c =>
      c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
    this.renderGrid(filtered);
  }
};

/* ============================================
   CE SUB-SELECTOR (GROUP OPTIONS)
   ============================================ */
const CESubSelector = {
  groupCE: null,
  activeSlotIndex: null,

  init() {
    const modal = document.getElementById("ceSubModal");
    const closeBtn = document.getElementById("ceSubModalClose");
    const backBtn = document.getElementById("ceSubModalBack");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (backBtn) {
      backBtn.addEventListener("click", () => this.back());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(groupCE, slotIndex) {
    this.groupCE = groupCE;
    this.activeSlotIndex = slotIndex;
    const modal = document.getElementById("ceSubModal");
    const title = document.getElementById("ceSubModalTitle");

    if (title) title.textContent = groupCE.name;
    this.renderGrid();
    if (modal) modal.classList.add("open");
  },

  close() {
    const modal = document.getElementById("ceSubModal");
    if (modal) modal.classList.remove("open");
    this.groupCE = null;
    this.activeSlotIndex = null;
  },

  back() {
    const idx = this.activeSlotIndex;
    this.close();
    if (idx !== null) {
      CESelector.open(idx);
    }
  },

  renderGrid() {
    const grid = document.getElementById("ceSubPickerGrid");
    if (!grid || !this.groupCE) return;
    grid.innerHTML = "";

    const options = this.groupCE.options || [];
    options.forEach(opt => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.el("img", null, { src: opt.image, alt: opt.name });
      img.onerror = () => {
        const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
        fb.textContent = opt.id;
        img.replaceWith(fb);
      };

      const label = DOMFactory.el("div", "servant-picker-name");
      label.textContent = opt.name;

      item.appendChild(img);
      item.appendChild(label);

      item.addEventListener("click", () => {
        CESelector.pendingSlot = false;
        BondApp.setCE(this.activeSlotIndex, this.groupCE.id, opt.id);
        this.close();
        CESelector.close();
      });

      grid.appendChild(item);
    });
  }
};

/* ============================================
   BOND APP
   ============================================ */
const BondApp = {
  state: null,
  elements: {},

  init() {
    const saved = this.loadState();
    this.state = saved || {
      slots: [],
      selectedQuest: "",
      customBond: 0,
      ces: []
    };

    const select = document.getElementById("bondQuestSelect");
    const customInput = document.getElementById("customBondPerRun");
    const customSection = document.getElementById("customQuestSection");

    // Populate presets
    BOND_QUESTS.forEach(q => {
      const opt = DOMFactory.el("option", null, { value: q.key });
      opt.textContent = `${q.name} (${q.bond} pts)`;
      select.appendChild(opt);
    });

    // Custom option
    const customOpt = DOMFactory.el("option", null, { value: "custom" });
    customOpt.textContent = "-- Custom --";
    select.appendChild(customOpt);

    // Build servant slots
    this.buildServantSlots();

    // Build CE slots
    this.buildCESlots();

    // Restore quest state
    select.value = this.state.selectedQuest;
    if (this.state.selectedQuest === "custom") {
      customInput.disabled = false;
      customInput.value = this.state.customBond;
      customSection.style.display = "block";
    } else if (this.state.selectedQuest) {
      customInput.disabled = true;
      customSection.style.display = "none";
    } else {
      customSection.style.display = "none";
    }

    // Quest select handler
    select.addEventListener("change", () => {
      const val = select.value;
      if (val === "custom") {
        customInput.disabled = false;
        customSection.style.display = "block";
      } else {
        customInput.disabled = true;
        customSection.style.display = "none";
      }
    });

    // Calculate button
    const calcBtn = document.getElementById("bondCalculateBtn");
    if (calcBtn) {
      calcBtn.addEventListener("click", () => this.calculate());
    }

    // Init servant selector
    ServantSelector.init();

    // Init ascension selector
    AscensionSelector.init();

    // Init servant drag reorder
    ServantDrag.init();

    // Init CE selector
    CESelector.init();
    CESubSelector.init();
  },

  addSlot() {
    if (this.state.slots.length >= SERVANT_MAX_SLOTS) return;
    this.flushInputsToState();
    this.state.slots.push({ servantId: null, bondNeeded: 0, type: "normal", ascension: null });
    this.saveState();
    this.buildServantSlots();
  },

  removeSlot(index) {
    this.flushInputsToState();
    this.state.slots.splice(index, 1);
    this.saveState();
    this.buildServantSlots();
  },

  buildCESlots() {
    const grid = document.getElementById("ceGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const count = this.state.ces.length;

    for (let i = 0; i < count; i++) {
      const ceEntry = this.state.ces[i];
      if (!ceEntry) continue; // skip pending null slots

      // Resolve CE entry (string or group object)
      let ce, ceName, ceImage, ceBonusText;
      if (typeof ceEntry === "object" && ceEntry.groupId) {
        ce = CEList.find(c => c.id === ceEntry.groupId);
        const selectedOption = ce && ce.options ? ce.options.find(o => o.id === ceEntry.optionId) : null;
        ceName = selectedOption ? selectedOption.name : (ce ? ce.name : ceEntry.groupId);
        ceImage = selectedOption ? selectedOption.image : (ce ? ce.image : null);
        ceBonusText = ce ? (ce.flatBonus > 0 ? `+${ce.flatBonus} pts All` : `+${ce.bonus}% All`) : "";
      } else {
        ce = CEList.find(c => c.id === ceEntry);
        ceName = ce ? ce.name : ceEntry;
        ceImage = ce ? ce.image : null;
        ceBonusText = null;
      }

      const slot = DOMFactory.el("div", "ce-slot");
      slot.dataset.slotIndex = i;

      // Portrait
      const portraitArea = DOMFactory.el("div");
      if (ceImage) {
        const img = DOMFactory.el("img", "ce-portrait", { src: ceImage, alt: ceName });
        img.onerror = () => {
          const fb = DOMFactory.el("div", "ce-portrait-fallback");
          fb.textContent = typeof ceEntry === "object" ? ceEntry.groupId : ceEntry;
          img.replaceWith(fb);
        };
        portraitArea.appendChild(img);
      } else {
        const fb = DOMFactory.el("div", "ce-portrait-fallback");
        fb.textContent = typeof ceEntry === "object" ? ceEntry.groupId : ceEntry;
        portraitArea.appendChild(fb);
      }
      slot.appendChild(portraitArea);

      // Name + bonus
      const info = DOMFactory.el("div");
      if (ce) {
        const nameEl = DOMFactory.el("div", "ce-slot-name");
        nameEl.textContent = ceName;
        info.appendChild(nameEl);
        const bonusEl = DOMFactory.el("div", "ce-slot-bonus");
        if (ceBonusText !== null) {
          // Grouped CE (pre-computed bonus text)
          bonusEl.textContent = ceBonusText;
        } else if (ce.traitGroups.length > 0) {
          const groups = ce.traitGroups.map(group =>
            group.map(t => TraitNames[t] || t).join(" or ")
          ).join(" and ");
          bonusEl.textContent = `+${ce.bonus}% ${groups}`;
        } else if (ce.traits.length === 0) {
          bonusEl.textContent = `+${ce.bonus}% All`;
        } else {
          const traitNames = ce.traits.map(t => TraitNames[t] || t);
          const joiner = ce.matchAll ? " and " : " or ";
          bonusEl.textContent = `+${ce.bonus}% ${traitNames.join(joiner)}`;
        }
        info.appendChild(bonusEl);
      }
      slot.appendChild(info);

      // Click slot to re-select
      slot.style.cursor = "pointer";
      slot.addEventListener("click", () => {
        if (ce && ce.isGroup) {
          CESubSelector.open(ce, i);
        } else {
          CESelector.open(i);
        }
      });

      // Remove button
      const removeBtn = DOMFactory.el("button", "servant-remove-btn", { type: "button" });
      removeBtn.textContent = "\u2715";
      removeBtn.title = "Remove CE";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeCE(i);
      });
      slot.appendChild(removeBtn);

      grid.appendChild(slot);
    }

    // Add button
    const addSlot = DOMFactory.el("div", ["ce-slot", "ce-add-slot"]);
    const addPortrait = DOMFactory.el("div", "ce-portrait-fallback");
    addPortrait.textContent = "+";
    addSlot.appendChild(addPortrait);
    const addInfo = DOMFactory.el("div");
    const addLabel = DOMFactory.el("div", "ce-slot-name");
    addLabel.textContent = "Add CE";
    addInfo.appendChild(addLabel);
    addSlot.appendChild(addInfo);
    addSlot.addEventListener("click", () => {
      this.state.ces.push(null);
      this.buildCESlots();
      CESelector.open(this.state.ces.length - 1, true);
    });
    grid.appendChild(addSlot);
  },

  setCE(slotIndex, ceId, optionId) {
    if (slotIndex < 0 || slotIndex >= this.state.ces.length) return;
    if (optionId) {
      this.state.ces[slotIndex] = { groupId: ceId, optionId: optionId };
    } else {
      this.state.ces[slotIndex] = ceId;
    }
    this.saveState();
    this.buildCESlots();
  },

  removeCE(index) {
    this.state.ces.splice(index, 1);
    this.saveState();
    this.buildCESlots();
  },

  flushInputsToState() {
    this.state.slots.forEach((slot, i) => {
      const input = this.elements[`slotBond_${i}`];
      if (input && (slot.type || "normal") === "normal") {
        slot.bondNeeded = Validator.clamp(input.value, 0, 9999999);
      }
    });
  },

  buildServantSlots() {
    const grid = document.getElementById("servantGrid");
    if (!grid) return;
    grid.innerHTML = "";
    this.elements = {};

    const count = this.state.slots.length;

    for (let i = 0; i < count; i++) {
      const slotData = this.state.slots[i];
      if (!slotData.servantId) continue; // skip pending slots
      const slot = DOMFactory.el("div", "servant-slot");
      slot.dataset.slotIndex = i;
      slot.style.cursor = "grab";

      // Portrait area (clickable to open selector)
      const portraitArea = DOMFactory.el("div", "servant-slot-select-btn");
      let servantHasAscensions = false;

      if (slotData.servantId) {
        const servant = ServantData.getServant(slotData.servantId);
        if (servant) {
          servantHasAscensions = servant.hasAscensions;
          const ascension = slotData.ascension || (servant.hasAscensions ? "000" : null);
          const imgSrc = ServantData.getImageForAscension(servant.id, ascension);
          const img = DOMFactory.el("img", "servant-slot-portrait", {
            src: imgSrc,
            alt: servant.name,
            draggable: "false"
          });
          img.onerror = () => {
            if (ascension && !img.dataset.retriedFlat) {
              img.dataset.retriedFlat = "1";
              img.src = servant.image;
            } else {
              const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
              fb.textContent = servant.id;
              img.replaceWith(fb);
            }
          };
          portraitArea.appendChild(img);
          if (servant.hasAscensions) {
            portraitArea.style.cursor = "pointer";
            portraitArea.addEventListener("click", () => {
              AscensionSelector.open(servant, i);
            });
          }
        } else {
          const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
          fb.textContent = slotData.servantId;
          portraitArea.appendChild(fb);
        }
      } else {
        const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
        fb.textContent = "+";
        portraitArea.appendChild(fb);
      }

      // Click portrait to open selector (non-ascension servants or empty slots)
      if (!servantHasAscensions) {
        portraitArea.addEventListener("click", () => {
          ServantSelector.open(i);
        });
        portraitArea.style.cursor = "pointer";
      }
      slot.appendChild(portraitArea);

      // Info area: name + type dropdown + bond input
      const info = DOMFactory.el("div", "servant-slot-info");

      if (slotData.servantId) {
        const servant = ServantData.getServant(slotData.servantId);
        const nameEl = DOMFactory.el("div", "servant-slot-name");
        nameEl.textContent = servant ? ServantData.getAscensionName(servant.id, slotData.ascension) : slotData.servantId;
        info.appendChild(nameEl);
      } else {
        const placeholder = DOMFactory.el("div", "servant-slot-placeholder");
        placeholder.textContent = "Tap to select";
        info.appendChild(placeholder);
      }

      // Type dropdown
      const typeRow = DOMFactory.el("div", "input-row");
      const typeSelect = DOMFactory.el("select", "select-field", { id: `slotType_${i}` });
      const typeOpts = [
        { value: "normal", text: "Normal Servant" },
        { value: "support", text: "Support Servant" },
        { value: "maxbond", text: "Max Bond Servant" }
      ];
      typeOpts.forEach(opt => {
        const o = DOMFactory.el("option", null, { value: opt.value });
        o.textContent = opt.text;
        if (opt.value === (slotData.type || "normal")) o.selected = true;
        typeSelect.appendChild(o);
      });
      typeRow.appendChild(typeSelect);
      info.appendChild(typeRow);

      typeSelect.addEventListener("change", () => {
        this.flushInputsToState();
        this.state.slots[i].type = typeSelect.value;
        this.saveState();
        this.buildServantSlots();
      });

      // Bond input row (only for normal)
      const slotType = slotData.type || "normal";
      if (slotType === "normal") {
        const inputRow = DOMFactory.el("div", "input-row");
        const inputLabel = DOMFactory.el("label", "input-label", { for: `slotBond_${i}` });
        inputLabel.textContent = "Require";
        const input = DOMFactory.el("input", "input-field", {
          type: "number",
          id: `slotBond_${i}`,
          min: "0",
          max: "9999999",
          value: String(slotData.bondNeeded || 0)
        });
        inputRow.appendChild(inputLabel);
        inputRow.appendChild(input);
        info.appendChild(inputRow);

        this.elements[`slotBond_${i}`] = input;
      }

      // Remove button
      const removeBtn = DOMFactory.el("button", "servant-remove-btn", { type: "button" });
      removeBtn.textContent = "\u2715";
      removeBtn.title = "Remove servant";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeSlot(i);
      });
      slot.appendChild(removeBtn);

      slot.appendChild(info);
      grid.appendChild(slot);
    }

    // Add button
    const addSlot = DOMFactory.el("div", ["servant-slot", "servant-add-slot"]);
      const addPortrait = DOMFactory.el("div", "servant-slot-portrait-fallback");
      addPortrait.textContent = "+";
      addSlot.appendChild(addPortrait);
      const addInfo = DOMFactory.el("div", "servant-slot-info");
      const addLabel = DOMFactory.el("div", "servant-slot-placeholder");
      addLabel.textContent = "Add servant";
      addInfo.appendChild(addLabel);
      addSlot.appendChild(addInfo);
      addSlot.addEventListener("click", () => {
        // Add slot and open modal; if closed without picking, remove it
        this.flushInputsToState();
        this.state.slots.push({ servantId: null, bondNeeded: 0, type: "normal", ascension: null });
        this.buildServantSlots();
        const newIndex = this.state.slots.length - 1;
        ServantSelector.open(newIndex, true); // pending = true
      });
      addSlot.style.cursor = "pointer";
      grid.appendChild(addSlot);
  },

  setServant(slotIndex, servantId, ascension) {
    if (slotIndex < 0 || slotIndex >= this.state.slots.length) return;
    this.flushInputsToState();
    this.state.slots[slotIndex].servantId = servantId;
    this.state.slots[slotIndex].ascension = ascension || null;
    this.saveState();
    this.buildServantSlots();
  },

  calculate() {
    // Determine quest bond/run
    const select = document.getElementById("bondQuestSelect");
    const questKey = select.value;
    let questName = "";
    let bondPerRun = 0;

    if (questKey && questKey !== "custom") {
      const preset = BOND_QUESTS.find(q => q.key === questKey);
      if (preset) {
        questName = preset.name;
        bondPerRun = preset.bond;
      }
    } else if (questKey === "custom") {
      bondPerRun = Validator.clamp(
        document.getElementById("customBondPerRun").value, 0, 99999
      );
      questName = "Custom Quest";
    }

    if (bondPerRun <= 0) {
      alert("Please select a quest or enter bond points per run.");
      return;
    }

    // Read all slot inputs
    const count = this.state.slots.length;
    for (let i = 0; i < count; i++) {
      const input = this.elements[`slotBond_${i}`];
      if (input) {
        this.state.slots[i].bondNeeded = Validator.clamp(input.value, 0, 9999999);
      }
    }

    // Collect max bond servants for +25% bonus
    const maxBondServants = [];
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      if (slot.servantId && (slot.type || "normal") === "maxbond") {
        const servant = ServantData.getServant(slot.servantId);
        const mbAsc = slot.ascension || (servant && servant.hasAscensions ? "000" : null);
        maxBondServants.push({
          servantId: slot.servantId,
          name: servant ? ServantData.getAscensionName(slot.servantId, mbAsc) : slot.servantId,
          image: servant ? ServantData.getImageForAscension(slot.servantId, mbAsc) : null,
        });
      }
    }
    const maxBondBonus = maxBondServants.length * 25;

    // Collect frontline support servants for +4% bonus
    const frontlineSupports = [];
    for (let i = 0; i < Math.min(count, 3); i++) {
      const slot = this.state.slots[i];
      if (slot.servantId && (slot.type || "normal") === "support") {
        const servant = ServantData.getServant(slot.servantId);
        const supAsc = slot.ascension || (servant && servant.hasAscensions ? "000" : null);
        frontlineSupports.push({
          servantId: slot.servantId,
          name: servant ? ServantData.getAscensionName(slot.servantId, supAsc) : slot.servantId,
          image: servant ? ServantData.getImageForAscension(slot.servantId, supAsc) : null,
        });
      }
    }
    const supportBonus = frontlineSupports.length * 4;

    // Check for normal servants with missing bond value
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      const slotType = slot.type || "normal";
      if (slotType !== "normal") continue;
      if (!slot.servantId) continue;
      const bondNeeded = slot.bondNeeded || 0;
      if (bondNeeded <= 0) {
        const servant = ServantData.getServant(slot.servantId);
        const asc = slot.ascension || (servant && servant.hasAscensions ? "000" : null);
        const name = servant ? ServantData.getAscensionName(slot.servantId, asc) : "";
        alert(`Please enter required bond points for ${name || "servant in slot " + (i + 1)}.`);
        return;
      }
    }

    // Calculate for normal servants only
    const slotResults = [];
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      const slotType = slot.type || "normal";
      if (slotType !== "normal") continue;
      if (!slot.servantId) continue;

      const bondNeeded = slot.bondNeeded || 0;
      if (bondNeeded <= 0) continue;

      const servantId = slot.servantId;
      const servant = ServantData.getServant(servantId);

      // Frontline bonus: first 3 slots get +20% (applied separately)
      const isFrontline = i < 3;

      // Sum percentage bonuses (CEs + max bond + support, NOT frontline)
      let ceBonusPercent = maxBondBonus + supportBonus;
      const appliedCEs = [];
      if (isFrontline) {
        appliedCEs.push({ id: "frontline", name: "Frontline", bonus: 20, image: "icons/bond_icon.webp" });
      }
      frontlineSupports.forEach(fs => {
        appliedCEs.push({ id: "support_" + fs.servantId, name: fs.name, bonus: 4, image: fs.image, isSupport: true });
      });
      maxBondServants.forEach(mb => {
        appliedCEs.push({ id: "maxbond_" + mb.servantId, name: mb.name, bonus: 25, image: mb.image, isMaxBond: true });
      });

      // CE trait matching + flat bonus
      const ascension = slot.ascension || (servant && servant.hasAscensions ? "000" : null);
      const servantTraits = servant ? ServantData.getTraitsForAscension(servantId, ascension) : [];
      let flatBonus = 0;
      this.state.ces.forEach(ceEntry => {
        // Resolve CE from entry (string or group object)
        let ceId, optionId;
        if (typeof ceEntry === "object" && ceEntry.groupId) {
          ceId = ceEntry.groupId;
          optionId = ceEntry.optionId;
        } else {
          ceId = ceEntry;
          optionId = null;
        }

        const ce = CEList.find(c => c.id === ceId);
        if (!ce) return;

        if (ce.isGroup) {
          // Grouped CE: universal bonus (percentage or flat)
          const option = ce.options ? ce.options.find(o => o.id === optionId) : null;
          if (option) {
            if (ce.flatBonus > 0) {
              flatBonus += ce.flatBonus;
              appliedCEs.push({
                id: option.id,
                name: option.name,
                flatBonus: ce.flatBonus,
                image: option.image,
                isFlatBonus: true
              });
            } else if (ce.bonus > 0) {
              ceBonusPercent += ce.bonus;
              appliedCEs.push({
                id: option.id,
                name: option.name,
                bonus: ce.bonus,
                image: option.image
              });
            }
          }
        } else {
          // Normal CE: trait matching
          let matched = false;
          if (ce.traitGroups.length > 0) {
            const allGroupsMatch = ce.traitGroups.every(group =>
              group.some(t => servantTraits.includes(t))
            );
            if (allGroupsMatch) matched = true;
          } else if (ce.traits.length === 0) {
            matched = true;
          } else if (ce.matchAll) {
            const hasAll = ce.traits.every(t => servantTraits.includes(t));
            if (hasAll) matched = true;
          } else {
            const hasTrait = ce.traits.some(t => servantTraits.includes(t));
            if (hasTrait) matched = true;
          }

          if (matched) {
            ceBonusPercent += ce.bonus;
            appliedCEs.push(ce);
          }
        }
      });

      // Step 1: bonus = base * bonus% rounded down (just the bonus part)
      let totalBonus = Math.floor(bondPerRun * ceBonusPercent / 100);
      // Step 2: if frontline, multiply bonus by 1.2 and add base*0.2
      if (isFrontline) {
        totalBonus = Math.floor(totalBonus * 1.2) + Math.floor(bondPerRun * 0.2);
      }
      // Step 3: add flat bonus
      totalBonus += flatBonus;
      // Step 4: effectiveBond = base + totalBonus
      const effectiveBond = bondPerRun + totalBonus;
      slotResults.push({
        index: i,
        servantId,
        name: servant ? ServantData.getAscensionName(servantId, ascension) : servantId,
        image: servant ? ServantData.getImageForAscension(servantId, ascension) : null,
        bondNeeded,
        effectiveBond,
        totalBonus,
        runs: Math.ceil(bondNeeded / effectiveBond),
        ceBonus: ceBonusPercent,
        appliedCEs,
        isFrontline
      });
    }

    if (slotResults.length === 0) {
      alert("Please select servants and enter bond points needed.");
      return;
    }

    this.state.selectedQuest = questKey;
    this.state.customBond = questKey === "custom" ? bondPerRun : 0;
    this.saveState();

    // Show results
    const container = document.getElementById("bondResultContent");
    container.innerHTML = "";

    // Per-servant results grid
    const resultGrid = DOMFactory.el("div", "bond-result-servant-grid");
    slotResults.forEach(sr => {
      const card = DOMFactory.el("div", "bond-result-servant-card");

      // Portrait
      if (sr.image) {
        const img = DOMFactory.el("img", "servant-slot-portrait", {
          src: sr.image,
          alt: sr.name
        });
        card.appendChild(img);
      } else {
        const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
        fb.textContent = sr.servantId;
        card.appendChild(fb);
      }

      // Name
      const nameEl = DOMFactory.el("div", "servant-slot-name");
      nameEl.textContent = sr.name;
      card.appendChild(nameEl);

      // Applied CE images grid
      if (sr.appliedCEs.length > 0) {
        const ceImgGrid = DOMFactory.el("div", "bond-result-ce-grid");
        sr.appliedCEs.forEach(ce => {
          if (ce.isMaxBond) {
            // Max bond: servant portrait with 00205 icon overlay
            const wrap = DOMFactory.el("div", "bond-result-ce-maxbond-wrap");
            const servantImg = DOMFactory.el("img", "bond-result-ce-img", {
              src: ce.image,
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`
            });
            servantImg.onerror = () => {
              const fb = DOMFactory.el("div", "bond-result-ce-fallback");
              fb.textContent = `+${ce.bonus}`;
              servantImg.replaceWith(fb);
            };
            wrap.appendChild(servantImg);
            const icon = DOMFactory.el("img", "bond-result-ce-maxbond-icon", {
              src: "icons/bond_icon.webp",
              alt: "Max Bond",
              title: "Max Bond"
            });
            icon.onerror = () => { icon.style.display = "none"; };
            wrap.appendChild(icon);
            ceImgGrid.appendChild(wrap);
          } else if (ce.isSupport) {
            // Frontline support: servant portrait with FP icon overlay
            const wrap = DOMFactory.el("div", "bond-result-ce-maxbond-wrap");
            const servantImg = DOMFactory.el("img", "bond-result-ce-img", {
              src: ce.image,
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`
            });
            servantImg.onerror = () => {
              const fb = DOMFactory.el("div", "bond-result-ce-fallback");
              fb.textContent = `+${ce.bonus}`;
              servantImg.replaceWith(fb);
            };
            wrap.appendChild(servantImg);
            const icon = DOMFactory.el("img", "bond-result-ce-maxbond-icon", {
              src: "icons/fp_icon.webp",
              alt: "Support",
              title: "Frontline Support"
            });
            icon.onerror = () => { icon.style.display = "none"; };
            wrap.appendChild(icon);
            ceImgGrid.appendChild(wrap);
          } else if (ce.isFlatBonus) {
            const ceImg = DOMFactory.el("img", "bond-result-ce-img", {
              src: ce.image,
              alt: ce.name,
              title: `${ce.name} +${ce.flatBonus} pts`
            });
            ceImg.onerror = () => {
              const fb = DOMFactory.el("div", "bond-result-ce-fallback");
              fb.textContent = `+${ce.flatBonus}`;
              ceImg.replaceWith(fb);
            };
            ceImgGrid.appendChild(ceImg);
          } else {
            const ceImg = DOMFactory.el("img", "bond-result-ce-img", {
              src: ce.image,
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`
            });
            ceImg.onerror = () => {
              const fb = DOMFactory.el("div", "bond-result-ce-fallback");
              fb.textContent = `+${ce.bonus}`;
              ceImg.replaceWith(fb);
            };
            ceImgGrid.appendChild(ceImg);
          }
        });
        card.appendChild(ceImgGrid);
      }

      // Bond breakdown: base(+total bonus)
      const bondInfo = DOMFactory.el("div", "bond-result-bond-info");
      bondInfo.textContent = sr.totalBonus > 0
        ? `${bondPerRun.toLocaleString()}(+${sr.totalBonus.toLocaleString()})`
        : `${bondPerRun.toLocaleString()}`;
      card.appendChild(bondInfo);

      // Runs count
      const runsEl = DOMFactory.el("div", "bond-result-runs");
      runsEl.textContent = `${sr.runs} runs`;
      card.appendChild(runsEl);

      resultGrid.appendChild(card);
    });
    container.appendChild(resultGrid);

    const results = document.getElementById("bondResults");
    results.classList.add("visible");

    setTimeout(() => {
      results.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  },

  saveState() {
    try {
      localStorage.setItem(BOND_STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) { /* ignore */ }
  },

  loadState() {
    try {
      const raw = localStorage.getItem(BOND_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;

      // Migrate old format (single bondNeeded) to new slots format
      let slots;
      if (data.slots && Array.isArray(data.slots)) {
        // Only keep slots that have a servant selected
        slots = data.slots
          .filter(s => s.servantId)
          .map(s => ({
            servantId: s.servantId || null,
            bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, 9999999),
            type: ["normal", "support", "maxbond"].includes(s.type) ? s.type : "normal",
            ascension: (typeof s.ascension === "string" && s.ascension) ? s.ascension : null
          }));
      } else {
        slots = [];
        if (data.bondNeeded) {
          slots.push({ servantId: null, bondNeeded: Validator.clamp(data.bondNeeded, 0, 9999999) });
        }
      }

      return {
        slots: slots.map(s => ({
          servantId: s.servantId || null,
          bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, 9999999),
          type: s.type || "normal",
          ascension: (typeof s.ascension === "string" && s.ascension) ? s.ascension : null
        })),
        selectedQuest: typeof data.selectedQuest === "string" ? data.selectedQuest : "",
        customBond: Validator.clamp(data.customBond || 0, 0, 99999),
        ces: Array.isArray(data.ces) ? data.ces.filter(entry => {
          if (typeof entry === "string" && entry) return true;
          if (entry && typeof entry === "object" && entry.groupId && entry.optionId) return true;
          return false;
        }) : []
      };
    } catch (e) {
      return null;
    }
  }
};

/* ============================================
   INITIALIZATION
   ============================================ */
document.addEventListener("DOMContentLoaded", () => {
  ServantData.load();
  TabNavigator.init();
  App.init();
  BondApp.init();
});

})();
