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
const SERVANT_MAX_SLOTS = 6;
const CE_MAX_SLOTS = 8;
const STORAGE_KEY = "fgo_calculator_data";
const BOND_STORAGE_KEY = "fgo_bond_calculator_data";
const BOND_CONSTANTS = {
  MAX_BOND_NEEDED: 9999999,
  MAX_CUSTOM_BOND: 99999,
  FRONTLINE_SIZE: 3,
  MAX_BOND_BONUS_PCT: 25,
  SUPPORT_BONUS_PCT: 4,
  FRONTLINE_BONUS_PCT: 20,
  FRONTLINE_BONUS_FRACTION: 0.2
};

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

const TraitMatcher = {
  matches(servantTraits, ce) {
    if (ce.alsoMatch && ce.alsoMatch.some(t => servantTraits.includes(t))) return true;
    if (ce.traitGroups.length > 0) {
      return ce.traitGroups.every(group =>
        group.some(t => servantTraits.includes(t))
      );
    }
    if (ce.traits.length === 0) return true;
    if (ce.matchAll) {
      return ce.traits.every(t => servantTraits.includes(t));
    }
    return ce.traits.some(t => servantTraits.includes(t));
  },

  getAllTraitSets(servant) {
    if (!servant.hasAscensions) return [{ key: "base", traits: servant.traits }];
    const raw = servant.rawTraits;
    const base = raw.base || [];
    const standard = ["000", "001", "002"];
    const allKeys = Object.keys(raw).filter(k => k !== "base");
    const custom = allKeys.filter(k => !standard.includes(k));
    // Always include all three standard ascensions; missing ones get base-only traits
    const sets = standard.map(k => ({ key: k, traits: [...base, ...(raw[k] || [])] }));
    // Append custom keys (e.g. Spiritron Dress) after standard ones
    custom.forEach(k => sets.push({ key: k, traits: [...base, ...(raw[k] || [])] }));
    return sets;
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

  createLazyImg(src, className, attrs = {}) {
    const img = this.el("img", className, { src, ...attrs });
    img.loading = "lazy";
    img.decoding = "async";
    return img;
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
  },

  addSimpleFallback(img, cssClass, text) {
    img.onerror = () => {
      const fb = this.el("div", cssClass);
      fb.textContent = text;
      img.replaceWith(fb);
    };
  },

  addAscensionFallback(img, fallbackText) {
    img.onerror = () => {
      const fb = this.el("div", "servant-slot-portrait-fallback");
      fb.textContent = fallbackText;
      img.replaceWith(fb);
    };
  }
};

const CollapsibleFactory = {
  build(title, content) {
    const wrapper = DOMFactory.el("div", "ceoverlap-collapsible collapsed");
    const header = DOMFactory.el("div", "ceoverlap-collapsible-header");
    const label = DOMFactory.el("span", "");
    label.textContent = title;
    const arrow = DOMFactory.el("span", "ceoverlap-collapsible-arrow");
    arrow.textContent = "\u25BC";
    header.appendChild(label);
    header.appendChild(arrow);
    header.addEventListener("click", () => {
      wrapper.classList.toggle("collapsed");
    });
    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  },

  createSearchInput(query, onSearch) {
    const searchInput = DOMFactory.el("input", "servant-search ceoverlap-search");
    searchInput.type = "text";
    searchInput.placeholder = "Search by ID or name...";
    searchInput.value = query;
    const debouncedSearch = EventHandler.debounce(onSearch, DEBOUNCE_MS);
    searchInput.addEventListener("input", (e) => {
      debouncedSearch(e.target.value);
    });
    return searchInput;
  },

  populateFilterArea(container, query, onSearch, buildExtra) {
    container.replaceChildren();
    const content = DOMFactory.el("div", "ceoverlap-collapsible-content");
    content.appendChild(CollapsibleFactory.createSearchInput(query, onSearch));
    if (buildExtra) buildExtra(content);
    container.appendChild(CollapsibleFactory.build("Filters", content));
  }
};

/* ============================================
   PRESENTATION LAYER - UI Builder
   ============================================ */
const UIBuilder = {
  // DOM cache
  elements: {},

  buildMaterialsGrid(container, state) {
    // Elements already exist in HTML — cache input refs and add icon error handlers
    TIERS.forEach(tier => {
      TIER_FIELDS.forEach(field => {
        const id = `${tier}${field}`;
        this.elements[id] = document.getElementById(id);
      });

      // Add icon error handlers
      const card = container.querySelector(`[data-tier="${tier}"]`);
      if (card) {
        const bgImg = card.querySelector(".bg-layer");
        const fgImg = card.querySelector(".fg-layer");
        if (bgImg) bgImg.onerror = () => { bgImg.style.display = "none"; };
        if (fgImg) {
          fgImg.onerror = () => {
            const fallback = document.createElement("div");
            fallback.className = "icon-fallback";
            fallback.style.background = TIER_COLORS[tier];
            fallback.textContent = DOMFactory.capitalize(tier).charAt(0);
            fgImg.replaceWith(fallback);
          };
        }
      }
    });
  },

  buildQuestDropsGrid(container) {
    // Elements already exist in HTML — no-op
  },

  buildDeficitGrid(container) {
    // Elements already exist in HTML — no-op
  },

  buildQuestGrid(container) {
    // Elements already exist in HTML — no-op
  },

  loadQuestIcons() {
    // Add error handlers to existing quest drop icons in HTML
    Object.entries(QUEST_DROPS).forEach(([quest, drops]) => {
      [drops.primary, drops.secondary].forEach(material => {
        const container = document.getElementById(`${quest}Quest_${material}_icon`);
        if (container) {
          const bgImg = container.querySelector(".bg-layer");
          const fgImg = container.querySelector(".fg-layer");
          if (bgImg) bgImg.onerror = () => { bgImg.style.display = "none"; };
          if (fgImg) {
            fgImg.onerror = () => {
              const fallback = document.createElement("div");
              fallback.className = "icon-fallback";
              fallback.style.background = TIER_COLORS[material];
              fallback.textContent = DOMFactory.capitalize(material).charAt(0);
              fgImg.replaceWith(fallback);
            };
          }
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
      const labelEl = document.getElementById(`${tier}Label`);
      if (labelEl) labelEl.textContent = runs[tier] === 1 ? "run" : "runs";
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

    // Remove CSS-only tab override — JS now controls tab state
    document.documentElement.removeAttribute("data-tab");

    tabBar.addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab-btn")) return;
      const tab = e.target.dataset.tab;

      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

      e.target.classList.add("active");
      document.getElementById("panel-" + tab).classList.add("active");

      if (tab === "cefilter") CEFilterApp.init();

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
  { key: "fq83", name: "Free Quest Lv.83", bond: 835 },
  { key: "fq84", name: "Free Quest Lv.84", bond: 855 },
  { key: "gd100", name: "Grand Duel Lv.100\u2605\u2605\u2605", bond: 4748 }
];

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
      alsoMatch: Array.isArray(data.alsoMatch) ? data.alsoMatch : [],
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
        const hasAscensions = !isArray && typeof rawTraits === "object" && Object.keys(rawTraits).some(k => k !== "base");
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
          image: `servants/${id}/000.webp`
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
    return `servants/${id}/${ascension || '000'}.webp`;
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
  },

  getDefaultAscension(servantId, slotAscension) {
    if (slotAscension) return slotAscension;
    const servant = this.getServant(servantId);
    return (servant && servant.hasAscensions) ? "000" : null;
  }
};

/* ============================================
   SERVANT SELECTOR MODAL
   ============================================ */
const ServantSelector = {
  activeSlotIndex: null,
  pendingSlot: false,
  classFilters: [],
  rarityFilters: [],
  _searchQuery: "",

  init() {
    const modal = document.getElementById("servantModal");
    const closeBtn = document.getElementById("servantModalClose");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(slotIndex, pending = false) {
    this.activeSlotIndex = slotIndex;
    this.pendingSlot = pending;
    this.classFilters = [];
    this.rarityFilters = [];
    this._searchQuery = "";

    this.buildFilterArea();
    this.renderGrid(ServantData.servants);

    const modal = document.getElementById("servantModal");
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

    const frag = document.createDocumentFragment();

    servants.forEach(servant => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.createLazyImg(servant.image, null, {
        alt: servant.name
      });
      DOMFactory.addAscensionFallback(img, servant.id);

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

      frag.appendChild(item);
    });

    grid.replaceChildren(frag);
  },

  filter() {
    this.renderGrid(this.getFilteredServants());
  },

  getFilteredServants() {
    let result = ServantData.servants;
    const query = this._searchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter(s =>
        s.id.toLowerCase().includes(query) || ServantData.getAllNames(s.id).some(n => n.toLowerCase().includes(query))
      );
    }
    if (this.classFilters.length > 0) {
      const classSet = new Set(this.classFilters);
      result = result.filter(s => s.traits.some(t => classSet.has(t)));
    }
    if (this.rarityFilters.length > 0) {
      const raritySet = new Set(this.rarityFilters);
      result = result.filter(s => s.traits.some(t => raritySet.has(t)));
    }
    return result;
  },

  buildFilterArea() {
    const container = document.getElementById("servantFilterArea");
    if (!container) return;
    CollapsibleFactory.populateFilterArea(container, this._searchQuery,
      (query) => { this._searchQuery = query; this.filter(); },
      (content) => { this._buildClassFilter(content); this._buildRarityFilter(content); }
    );
  },

  _buildClassFilter(container) {
    const standard = [
      { id: "0100", icon: "saber", label: "Saber" },
      { id: "0102", icon: "archer", label: "Archer" },
      { id: "0101", icon: "lancer", label: "Lancer" },
      { id: "0103", icon: "rider", label: "Rider" },
      { id: "0104", icon: "caster", label: "Caster" },
      { id: "0105", icon: "assassin", label: "Assassin" },
      { id: "0106", icon: "berserker", label: "Berserker" }
    ];

    const extra = [
      { id: "0107", icon: "shielder", label: "Shielder" },
      { id: "0108", icon: "ruler", label: "Ruler" },
      { id: "0110", icon: "avenger", label: "Avenger" },
      { id: "0115", icon: "mooncancer", label: "Moon Cancer" },
      { id: "0109", icon: "alterego", label: "Alter Ego" },
      { id: "0117", icon: "foreigner", label: "Foreigner" },
      { id: "0120", icon: "pretender", label: "Pretender" },
      { id: "0124", icon: "beast", label: "Beast" }
    ];

    const filterDiv = DOMFactory.el("div", "servant-class-filter");
    const selected = new Set(this.classFilters);

    const buildRow = (classes) => {
      const row = DOMFactory.el("div", "servant-class-row");
      classes.forEach(cls => {
        const btn = DOMFactory.el("div", "servant-class-btn" +
          (selected.has(cls.id) ? " active" : ""));
        const img = DOMFactory.el("img", "", {
          src: "icons/classes/" + cls.icon + ".webp",
          alt: cls.label,
          title: cls.label
        });
        btn.appendChild(img);
        btn.addEventListener("click", () => {
          if (selected.has(cls.id)) {
            selected.delete(cls.id);
            btn.classList.remove("active");
          } else {
            selected.add(cls.id);
            btn.classList.add("active");
          }
          this.classFilters = [...selected];
          this.filter();
        });
        row.appendChild(btn);
      });
      filterDiv.appendChild(row);
    };

    buildRow(standard);
    buildRow(extra);
    container.appendChild(filterDiv);
  },

  _buildRarityFilter(container) {
    const rarities = [
      { id: "0400", label: "0 \u2605" },
      { id: "0401", label: "1 \u2605" },
      { id: "0402", label: "2 \u2605" },
      { id: "0403", label: "3 \u2605" },
      { id: "0404", label: "4 \u2605" },
      { id: "0405", label: "5 \u2605" }
    ];

    const filterDiv = DOMFactory.el("div", "servant-rarity-filter");
    const selected = new Set(this.rarityFilters);

    rarities.forEach(rarity => {
      const btn = DOMFactory.el("div", "servant-rarity-btn" +
        (selected.has(rarity.id) ? " active" : ""));
      btn.textContent = rarity.label;
      btn.addEventListener("click", () => {
        if (selected.has(rarity.id)) {
          selected.delete(rarity.id);
          btn.classList.remove("active");
        } else {
          selected.add(rarity.id);
          btn.classList.add("active");
        }
        this.rarityFilters = [...selected];
        this.filter();
      });
      filterDiv.appendChild(btn);
    });

    container.appendChild(filterDiv);
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
    grid.replaceChildren();

    const options = ServantData.getAscensionOptions(this.servant.id);
    options.forEach(asc => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const imgSrc = ServantData.getImageForAscension(this.servant.id, asc);
      const img = DOMFactory.createLazyImg(imgSrc, null, {
        alt: ServantData.getAscensionLabel(this.servant.id, asc)
      });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", this.servant.id);

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
  _searchQuery: "",

  init() {
    const modal = document.getElementById("ceModal");
    const closeBtn = document.getElementById("ceModalClose");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(slotIndex, pending = false) {
    this.activeSlotIndex = slotIndex;
    this.pendingSlot = pending;
    this._searchQuery = "";

    this.buildFilterArea();
    this.renderGrid(CEList);

    const modal = document.getElementById("ceModal");
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

    const frag = document.createDocumentFragment();

    ces.forEach(ce => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.createLazyImg(ce.image, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", ce.id);

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

      frag.appendChild(item);
    });

    grid.replaceChildren(frag);
  },

  filter() {
    const q = this._searchQuery.toLowerCase().trim();
    if (!q) {
      this.renderGrid(CEList);
      return;
    }
    const filtered = CEList.filter(c =>
      c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
    this.renderGrid(filtered);
  },

  buildFilterArea() {
    const container = document.getElementById("ceFilterArea");
    if (!container) return;
    CollapsibleFactory.populateFilterArea(container, this._searchQuery,
      (query) => { this._searchQuery = query; this.filter(); }
    );
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
    const idx = this.activeSlotIndex;
    const modal = document.getElementById("ceSubModal");
    if (modal) modal.classList.remove("open");
    this.groupCE = null;
    this.activeSlotIndex = null;
    // Remove pending null slot if no option was selected
    if (idx !== null && idx < BondApp.state.ces.length && BondApp.state.ces[idx] === null) {
      BondApp.state.ces.splice(idx, 1);
      BondApp.buildCESlots();
    }
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
    grid.replaceChildren();

    const options = this.groupCE.options || [];
    options.forEach(opt => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.createLazyImg(opt.image, null, { alt: opt.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", opt.id);

      const label = DOMFactory.el("div", "servant-picker-name");
      const colonIdx = opt.name.indexOf(": ");
      label.textContent = colonIdx !== -1 ? opt.name.substring(colonIdx + 2) : opt.name;

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
   CE FILTER PICKER
   ============================================ */
const CEFilterPicker = {
  tempSelected: new Set(),
  _searchQuery: "",

  init() {
    const modal = document.getElementById("ceFilterModal");
    const closeBtn = document.getElementById("ceFilterModalClose");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open() {
    this.tempSelected = new Set(CEFilterApp.state.selectedCEs);
    this._searchQuery = "";

    this.buildFilterArea();
    this.renderGrid(CEList.filter(ce => ce.traits.length > 0 || ce.traitGroups.length > 0));

    const modal = document.getElementById("ceFilterModal");
    if (modal) modal.classList.add("open");
  },

  close() {
    CEFilterApp.state.selectedCEs = [...this.tempSelected];
    CEFilterApp.saveState();
    CEFilterApp.render();
    const modal = document.getElementById("ceFilterModal");
    if (modal) modal.classList.remove("open");
    this.tempSelected = new Set();
  },

  renderGrid(ces) {
    const grid = document.getElementById("ceFilterPickerGrid");
    if (!grid) return;

    // Build CE → entry index map (each entry = unique servant + ascension group)
    const allMatches = CEFilterApp.computeAllCEMatches();
    this._ceMatchEntries = {};
    allMatches.forEach((entry, idx) => {
      entry.matchingCEs.forEach(ce => {
        if (!this._ceMatchEntries[ce.id]) this._ceMatchEntries[ce.id] = new Set();
        this._ceMatchEntries[ce.id].add(idx);
      });
    });

    const frag = document.createDocumentFragment();

    ces.forEach(ce => {
      const isSelected = this.tempSelected.has(ce.id);
      const item = DOMFactory.el("div", "servant-picker-item ce-filter-picker-item" +
        (isSelected ? " selected" : ""));
      item.dataset.ceId = ce.id;

      const check = DOMFactory.el("div", "ce-filter-check");
      check.textContent = "\u2713";
      item.appendChild(check);

      const img = DOMFactory.createLazyImg(ce.image, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", ce.id);
      item.appendChild(img);

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = ce.name;
      item.appendChild(name);

      item.addEventListener("click", () => {
        if (this.tempSelected.has(ce.id)) {
          this.tempSelected.delete(ce.id);
          item.classList.remove("selected");
        } else {
          this.tempSelected.add(ce.id);
          item.classList.add("selected");
        }
        this.updateNoMatchState();
      });

      frag.appendChild(item);
    });

    grid.replaceChildren(frag);
    this.updateNoMatchState();
  },

  updateNoMatchState() {
    const selectedIds = [...this.tempSelected];
    const grid = document.getElementById("ceFilterPickerGrid");
    if (!grid) return;

    // Intersect entry indices across all selected CEs
    let intersection = null;
    if (selectedIds.length > 0) {
      for (const selId of selectedIds) {
        const set = this._ceMatchEntries[selId];
        if (!set) { intersection = new Set(); break; }
        if (!intersection) {
          intersection = new Set(set);
        } else {
          for (const idx of intersection) {
            if (!set.has(idx)) intersection.delete(idx);
          }
        }
      }
    }

    grid.querySelectorAll(".ce-filter-picker-item").forEach(item => {
      const ceId = item.dataset.ceId;
      if (this.tempSelected.has(ceId)) {
        item.classList.remove("ce-filter-picker-item--no-match");
        return;
      }
      if (selectedIds.length === 0 || !intersection) {
        item.classList.remove("ce-filter-picker-item--no-match");
        return;
      }
      const entries = this._ceMatchEntries[ceId];
      if (!entries) {
        item.classList.add("ce-filter-picker-item--no-match");
        return;
      }
      const hasOverlap = [...intersection].some(idx => entries.has(idx));
      item.classList.toggle("ce-filter-picker-item--no-match", !hasOverlap);
    });
  },

  filter() {
    const q = this._searchQuery.toLowerCase().trim();
    const traitCEs = CEList.filter(ce => ce.traits.length > 0 || ce.traitGroups.length > 0);
    if (!q) {
      this.renderGrid(traitCEs);
      return;
    }
    const filtered = traitCEs.filter(c =>
      c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    );
    this.renderGrid(filtered);
  },

  buildFilterArea() {
    const container = document.getElementById("ceFilterPickerArea");
    if (!container) return;
    CollapsibleFactory.populateFilterArea(container, this._searchQuery,
      (query) => { this._searchQuery = query; this.filter(); }
    );
  }
};

/* ============================================
   CE SERVANT OVERLAP MODAL
   ============================================ */

const CEServantOverlap = {
  _allEntries: [],
  _clickedCEIds: new Set(),
  _clickedCEs: [],
  _selectedCEFilter: new Set(),
  _selectedCounts: new Set(),
  _searchQuery: "",
  _classFilters: [],
  _rarityFilters: [],
  _debouncedUpdateFilters: null,

  init() {
    const modal = document.getElementById("ceOverlapModal");
    const closeBtn = document.getElementById("ceOverlapClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
    this._modal = modal;
  },

  open(entry) {
    if (!this._modal) return;
    const clickedCEIds = new Set(entry.matchingCEs.map(c => c.id));
    const totalCEs = clickedCEIds.size;
    if (totalCEs === 0) return;

    this._clickedCEIds = clickedCEIds;
    this._clickedCEs = entry.matchingCEs;
    this._selectedCEFilter = new Set();
    this._selectedCounts = new Set();
    this._searchQuery = "";
    this._classFilters = [];
    this._rarityFilters = [];
    this._debouncedUpdateFilters = EventHandler.debounce(() => this.updateFilters(), 50);

    const titleEl = document.getElementById("ceOverlapTitle");
    if (titleEl) {
      titleEl.textContent = "Servants sharing CEs with " + entry.servant.name;
    }

    const allMatches = CEFilterApp.computeAllCEMatches();
    this._allEntries = [];
    allMatches.forEach(other => {
      if (other.servant.id === entry.servant.id) return;
      const overlap = other.matchingCEs.filter(ce => clickedCEIds.has(ce.id)).length;
      if (overlap > 0) {
        this._allEntries.push({ entry: other, overlap: overlap });
      }
    });

    this.buildFilterArea();
    this._modal.classList.add("open");
  },

  close() {
    if (this._modal) {
      this._modal.classList.remove("open");
    }
  },

  buildFilterArea() {
    const container = document.getElementById("ceOverlapFilterArea");
    if (!container) return;
    container.replaceChildren();

    if (this._allEntries.length === 0) {
      const msg = DOMFactory.el("div", "ceoverlap-empty");
      msg.textContent = "No other servants share these CEs.";
      container.appendChild(msg);
      return;
    }

    this._buildCEFilter(container);

    const content = DOMFactory.el("div", "ceoverlap-collapsible-content");

    content.appendChild(CollapsibleFactory.createSearchInput(this._searchQuery, (query) => {
      this._searchQuery = query;
      this.updateFilters();
    }));

    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    this._allEntries.forEach(({ entry }) => {
      entry.servant.traits.forEach(t => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });
    this._buildClassFilter(content, availableClassIds);
    this._buildRarityFilter(content, availableRarityIds);

    this._buildCountFilter(content);
    container.appendChild(CollapsibleFactory.build("Filters", content));
    this.renderGrid();
  },

  _buildCEFilter(container) {
    const filterDiv = DOMFactory.el("div", "ceoverlap-ce-filter");
    const selected = this._selectedCEFilter;

    this._clickedCEs.forEach(ce => {
      const btn = DOMFactory.el("div", "ceoverlap-ce-btn" +
        (selected.has(ce.id) ? " active" : ""));
      const img = DOMFactory.createLazyImg(ce.image, "", { alt: ce.name, title: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      btn.appendChild(img);
      btn.addEventListener("click", () => {
        if (selected.has(ce.id)) {
          selected.delete(ce.id);
          btn.classList.remove("active");
        } else {
          selected.add(ce.id);
          btn.classList.add("active");
        }
        this._debouncedUpdateFilters();
      });
      filterDiv.appendChild(btn);
    });

    container.appendChild(filterDiv);
  },

  _getFilteredEntries() {
    let filtered = this._allEntries;

    if (this._selectedCEFilter.size > 0) {
      filtered = filtered.filter(({ entry }) =>
        [...this._selectedCEFilter].every(id =>
          entry.matchingCEs.some(ce => ce.id === id)
        )
      );
    }

    const query = this._searchQuery.toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(({ entry }) =>
        entry.servant.id.toLowerCase().includes(query) ||
        entry.servant.name.toLowerCase().includes(query) ||
        ServantData.getAllNames(entry.servant.id).some(n => n.toLowerCase().includes(query))
      );
    }

    if (this._classFilters.length > 0) {
      const classSet = new Set(this._classFilters);
      filtered = filtered.filter(({ entry }) =>
        entry.servant.traits.some(t => classSet.has(t))
      );
    }

    if (this._rarityFilters.length > 0) {
      const raritySet = new Set(this._rarityFilters);
      filtered = filtered.filter(({ entry }) =>
        entry.servant.traits.some(t => raritySet.has(t))
      );
    }

    return filtered;
  },

  updateFilters() {
    this._updateClassRarityVisibility();
    this._rebuildCountFilter();
    this.renderGrid();
  },

  _updateClassRarityVisibility() {
    let ceFiltered = this._allEntries;
    if (this._selectedCEFilter.size > 0) {
      ceFiltered = ceFiltered.filter(({ entry }) =>
        [...this._selectedCEFilter].every(id =>
          entry.matchingCEs.some(ce => ce.id === id)
        )
      );
    }

    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    ceFiltered.forEach(({ entry }) => {
      entry.servant.traits.forEach(t => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });

    const container = document.getElementById("ceOverlapFilterArea");
    if (!container) return;
    container.querySelectorAll(".ceoverlap-class-btn").forEach(btn => {
      const avail = availableClassIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });
    container.querySelectorAll(".ceoverlap-rarity-btn").forEach(btn => {
      const avail = availableRarityIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });

    this._classFilters = this._classFilters.filter(id => availableClassIds.has(id));
    this._rarityFilters = this._rarityFilters.filter(id => availableRarityIds.has(id));
  },

  _buildCountFilter(container) {
    const preFiltered = this._getFilteredEntries();
    const availableCounts = new Set(preFiltered.map(e => e.entry.matchingCEs.length));
    if (availableCounts.size === 0) return;

    this._selectedCounts.forEach(n => {
      if (!availableCounts.has(n)) this._selectedCounts.delete(n);
    });

    const filterRow = DOMFactory.el("div", "ceoverlap-filter-row");
    const selected = this._selectedCounts;

    for (let n = 1; n <= Math.max(...availableCounts); n++) {
      if (!availableCounts.has(n)) continue;
      const btn = DOMFactory.el("div", "cefilter-match-count-btn" +
        (selected.has(n) ? " active" : ""));
      btn.textContent = n + " CE";
      btn.addEventListener("click", () => {
        if (selected.has(n)) {
          selected.delete(n);
        } else {
          selected.add(n);
        }
        btn.classList.toggle("active", selected.has(n));
        this.renderGrid();
      });
      filterRow.appendChild(btn);
    }

    container.appendChild(filterRow);
  },

  _rebuildCountFilter() {
    const container = document.getElementById("ceOverlapFilterArea");
    if (!container) return;

    const content = container.querySelector(".ceoverlap-collapsible-content");
    const oldRow = (content || container).querySelector(".ceoverlap-filter-row");
    if (oldRow) oldRow.remove();

    this._buildCountFilter(content || container);
    const grid = document.getElementById("ceOverlapGrid");
    if (grid) grid.replaceChildren();
  },

  _buildClassFilter(container, availableClassIds) {
    const standard = [
      { id: "0100", icon: "saber", label: "Saber" },
      { id: "0102", icon: "archer", label: "Archer" },
      { id: "0101", icon: "lancer", label: "Lancer" },
      { id: "0103", icon: "rider", label: "Rider" },
      { id: "0104", icon: "caster", label: "Caster" },
      { id: "0105", icon: "assassin", label: "Assassin" },
      { id: "0106", icon: "berserker", label: "Berserker" }
    ];

    const extra = [
      { id: "0107", icon: "shielder", label: "Shielder" },
      { id: "0108", icon: "ruler", label: "Ruler" },
      { id: "0110", icon: "avenger", label: "Avenger" },
      { id: "0115", icon: "mooncancer", label: "Moon Cancer" },
      { id: "0109", icon: "alterego", label: "Alter Ego" },
      { id: "0117", icon: "foreigner", label: "Foreigner" },
      { id: "0120", icon: "pretender", label: "Pretender" },
      { id: "0124", icon: "beast", label: "Beast" }
    ];

    const filterDiv = DOMFactory.el("div", "ceoverlap-class-filter");

    const buildRow = (classes) => {
      const row = DOMFactory.el("div", "ceoverlap-class-row");
      classes.forEach(cls => {
        if (!availableClassIds.has(cls.id)) return;
        const btn = DOMFactory.el("div", "ceoverlap-class-btn" +
          (this._classFilters.includes(cls.id) ? " active" : ""));
        btn.dataset.traitId = cls.id;
        const img = DOMFactory.el("img", "", {
          src: "icons/classes/" + cls.icon + ".webp",
          alt: cls.label,
          title: cls.label
        });
        btn.appendChild(img);
        btn.addEventListener("click", () => {
          const selected = new Set(this._classFilters);
          if (selected.has(cls.id)) {
            selected.delete(cls.id);
            btn.classList.remove("active");
          } else {
            selected.add(cls.id);
            btn.classList.add("active");
          }
          this._classFilters = [...selected];
          this._debouncedUpdateFilters();
        });
        row.appendChild(btn);
      });
      filterDiv.appendChild(row);
    };

    buildRow(standard);
    buildRow(extra);
    container.appendChild(filterDiv);
  },

  _buildRarityFilter(container, availableRarityIds) {
    const rarities = [
      { id: "0400", label: "0 \u2605" },
      { id: "0401", label: "1 \u2605" },
      { id: "0402", label: "2 \u2605" },
      { id: "0403", label: "3 \u2605" },
      { id: "0404", label: "4 \u2605" },
      { id: "0405", label: "5 \u2605" }
    ];

    const filterDiv = DOMFactory.el("div", "ceoverlap-rarity-filter");

    rarities.forEach(rarity => {
      if (!availableRarityIds.has(rarity.id)) return;
      const btn = DOMFactory.el("div", "ceoverlap-rarity-btn" +
        (this._rarityFilters.includes(rarity.id) ? " active" : ""));
      btn.dataset.traitId = rarity.id;
      btn.textContent = rarity.label;
      btn.addEventListener("click", () => {
        const selected = new Set(this._rarityFilters);
        if (selected.has(rarity.id)) {
          selected.delete(rarity.id);
          btn.classList.remove("active");
        } else {
          selected.add(rarity.id);
          btn.classList.add("active");
        }
        this._rarityFilters = [...selected];
        this._debouncedUpdateFilters();
      });
      filterDiv.appendChild(btn);
    });

    container.appendChild(filterDiv);
  },

  renderGrid() {
    const grid = document.getElementById("ceOverlapGrid");
    if (!grid) return;
    grid.replaceChildren();

    if (this._allEntries.length === 0) return;

    let filtered = this._getFilteredEntries();

    if (this._selectedCounts.size > 0) {
      filtered = filtered.filter(e => this._selectedCounts.has(e.entry.matchingCEs.length));
    }

    if (filtered.length === 0) {
      const msg = DOMFactory.el("div", "ceoverlap-empty");
      msg.textContent = "No servants match selected filter.";
      grid.appendChild(msg);
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(({ entry }) => {
      frag.appendChild(this.createServantMiniCard(entry, this._clickedCEIds));
    });
    grid.replaceChildren(frag);
  },

  createServantMiniCard(entry, overlapCEIds) {
    const card = DOMFactory.el("div", "cefilter-servant-card");

    const imgAsc = (!entry.baseMatchesAll && entry.matchedAscensions && entry.matchedAscensions.length > 0)
      ? (entry.primaryAscension || entry.matchedAscensions[0])
      : null;
    const imgSrc = imgAsc
      ? ServantData.getImageForAscension(entry.servant.id, imgAsc)
      : entry.servant.image;

    const img = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", { alt: entry.servant.name });
    DOMFactory.addAscensionFallback(img, entry.servant.id);
    card.appendChild(img);

    if (entry.matchingCEs && entry.matchingCEs.length > 0) {
      const badges = DOMFactory.el("div", "cefilter-match-badges");
      entry.matchingCEs.forEach(ce => {
        const badge = DOMFactory.createLazyImg(ce.image,
          "cefilter-match-badge" +
          (overlapCEIds.has(ce.id) ? "" : " cefilter-match-badge--nonshared"),
          { alt: ce.name, title: ce.name }
        );
        DOMFactory.addSimpleFallback(badge, "cefilter-match-badge-fallback", ce.id);
        badges.appendChild(badge);
      });
      card.appendChild(badges);
    }

    const displayName = imgAsc
      ? ServantData.getAscensionName(entry.servant.id, imgAsc) || entry.servant.name
      : entry.servant.name;
    const nameEl = DOMFactory.el("div", "cefilter-servant-name");
    nameEl.textContent = displayName;
    card.appendChild(nameEl);

    if (entry.matchedAscensions && entry.matchedAscensions.length > 0) {
      entry.matchedAscensions.forEach(k => {
        const ascEl = DOMFactory.el("div", "cefilter-ascension-label");
        ascEl.textContent = ServantData.getAscensionLabel(entry.servant.id, k);
        card.appendChild(ascEl);
      });
    }

    return card;
  }
};

/* ============================================
   CE FILTER APP
   ============================================ */
const CEFILTER_STORAGE_KEY = "fgo_ce_filter_data";

const CEFilterApp = {
  state: {
    selectedCEs: [],
    mode: "all",
    searchQuery: "",
    classFilters: [],
    rarityFilters: [],
    matchCounts: [],
    matchCustomCounts: []
  },

  _allCEMatchesCache: null,
  _initialized: false,
  _debouncedRender: null,

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.loadState();
    this._debouncedRender = EventHandler.debounce(() => this.renderResults(), 50);

    const addBtn = document.getElementById("cefilterAddBtn");
    const modeSelect = document.getElementById("cefilterMode");
    const searchInput = document.getElementById("cefilterSearch");

    if (addBtn) {
      addBtn.addEventListener("click", () => CEFilterPicker.open());
    }

    if (modeSelect) {
      modeSelect.value = this.state.mode;
      modeSelect.addEventListener("change", () => {
        this.state.mode = modeSelect.value;
        this.saveState();
        this.render();
      });
    }

    if (searchInput) {
      searchInput.value = this.state.searchQuery;
      const debouncedSearch = EventHandler.debounce((query) => {
        this.state.searchQuery = query;
        this.renderResults();
      }, DEBOUNCE_MS);
      searchInput.addEventListener("input", (e) => {
        debouncedSearch(e.target.value);
      });
    }

    CEFilterPicker.init();
    CEServantOverlap.init();
    this.buildClassFilter();
    this.buildRarityFilter();

    this.render();
  },

  render() {
    this.renderChips();
    this.buildCustomCountFilter();
    this.buildMatchCountFilter();
    this.renderResults();
  },

  buildClassFilter() {
    const container = document.getElementById("cefilterClassFilter");
    if (!container) return;

    const standard = [
      { id: "0100", icon: "saber", label: "Saber" },
      { id: "0102", icon: "archer", label: "Archer" },
      { id: "0101", icon: "lancer", label: "Lancer" },
      { id: "0103", icon: "rider", label: "Rider" },
      { id: "0104", icon: "caster", label: "Caster" },
      { id: "0105", icon: "assassin", label: "Assassin" },
      { id: "0106", icon: "berserker", label: "Berserker" }
    ];

    const extra = [
      { id: "0107", icon: "shielder", label: "Shielder" },
      { id: "0108", icon: "ruler", label: "Ruler" },
      { id: "0110", icon: "avenger", label: "Avenger" },
      { id: "0115", icon: "mooncancer", label: "Moon Cancer" },
      { id: "0109", icon: "alterego", label: "Alter Ego" },
      { id: "0117", icon: "foreigner", label: "Foreigner" },
      { id: "0120", icon: "pretender", label: "Pretender" },
      { id: "0124", icon: "beast", label: "Beast" }
    ];

    container.replaceChildren();

    const selected = new Set(this.state.classFilters);

    const buildRow = (classes) => {
      const row = DOMFactory.el("div", "cefilter-class-row");
      classes.forEach(cls => {
        const btn = DOMFactory.el("div", "cefilter-class-btn" +
          (selected.has(cls.id) ? " active" : ""));
        btn.dataset.traitId = cls.id;
        const img = DOMFactory.el("img", "", {
          src: `icons/classes/${cls.icon}.webp`,
          alt: cls.label,
          title: cls.label
        });
        btn.appendChild(img);
        btn.addEventListener("click", () => {
          if (selected.has(cls.id)) {
            selected.delete(cls.id);
            btn.classList.remove("active");
          } else {
            selected.add(cls.id);
            btn.classList.add("active");
          }
          this.state.classFilters = [...selected];
          this.saveState();
          this._debouncedRender();
        });
        row.appendChild(btn);
      });
      container.appendChild(row);
    };

    buildRow(standard);
    buildRow(extra);
  },

  buildRarityFilter() {
    const container = document.getElementById("cefilterRarityFilter");
    if (!container) return;

    const rarities = [
      { id: "0400", label: "0 \u2605" },
      { id: "0401", label: "1 \u2605" },
      { id: "0402", label: "2 \u2605" },
      { id: "0403", label: "3 \u2605" },
      { id: "0404", label: "4 \u2605" },
      { id: "0405", label: "5 \u2605" }
    ];

    container.replaceChildren();
    const selected = new Set(this.state.rarityFilters);

    rarities.forEach(rarity => {
      const btn = DOMFactory.el("div", "cefilter-rarity-btn" +
        (selected.has(rarity.id) ? " active" : ""));
      btn.dataset.traitId = rarity.id;
      btn.textContent = rarity.label;
      btn.addEventListener("click", () => {
        if (selected.has(rarity.id)) {
          selected.delete(rarity.id);
          btn.classList.remove("active");
        } else {
          selected.add(rarity.id);
          btn.classList.add("active");
        }
        this.state.rarityFilters = [...selected];
        this.saveState();
        this._debouncedRender();
      });
      container.appendChild(btn);
    });
  },

  filterByCEs(results) {
    const selectedCEObjs = this.state.selectedCEs
      .map(id => CEList.find(c => c.id === id))
      .filter(ce => ce != null);

    if (selectedCEObjs.length === 0) return results;

    const selectedIds = new Set(selectedCEObjs.map(c => c.id));
    if (this.state.mode === "all") {
      return results.filter(entry =>
        selectedCEObjs.every(sel => entry.matchingCEs.some(m => m.id === sel.id))
      );
    }
    if (this.state.mode === "any") {
      return results.filter(entry =>
        entry.matchingCEs.some(m => selectedIds.has(m.id))
      );
    }
    // "custom" mode — filter by how many selected CEs match
    const matchCustomCounts = this.state.matchCustomCounts;
    return results.filter(entry => {
      const matchedCount = selectedCEObjs.filter(sel =>
        entry.matchingCEs.some(m => m.id === sel.id)
      ).length;
      if (matchCustomCounts.length > 0) {
        return matchCustomCounts.includes(matchedCount);
      }
      return matchedCount > 0;
    });
  },

  buildCustomCountFilter() {
    const container = document.getElementById("cefilterCustomCount");
    if (!container) return;

    const ceCount = this.state.selectedCEs.length;
    const isCustom = this.state.mode === "custom";

    if (!isCustom || ceCount < 2) {
      container.replaceChildren();
      container.classList.remove("visible");
      this.state.matchCustomCounts = [];
      return;
    }

    container.classList.add("visible");
    container.replaceChildren();

    const maxCount = ceCount;

    // Remove stale selections
    this.state.matchCustomCounts = this.state.matchCustomCounts.filter(n => n >= 1 && n <= maxCount);

    const selected = new Set(this.state.matchCustomCounts);

    for (let n = 1; n <= maxCount; n++) {
      const btn = DOMFactory.el("div", "cefilter-match-count-btn" +
        (selected.has(n) ? " active" : ""));
      btn.textContent = n;
      btn.addEventListener("click", () => {
        if (selected.has(n)) {
          selected.delete(n);
        } else {
          selected.add(n);
        }
        this.state.matchCustomCounts = [...selected];
        this.saveState();
        this.buildCustomCountFilter();
        this.buildMatchCountFilter();
        this._debouncedRender();
      });
      container.appendChild(btn);
    }
  },

  buildMatchCountFilter() {
    const container = document.getElementById("cefilterMatchCount");
    if (!container) return;

    const ceFiltered = this.filterByCEs(this.computeAllCEMatches());
    const availableCounts = new Set(ceFiltered.map(r => r.matchingCEs.length));
    if (availableCounts.size === 0) { container.replaceChildren(); return; }

    // Remove stale selections
    this.state.matchCounts = this.state.matchCounts.filter(n => availableCounts.has(n));

    container.replaceChildren();

    const selected = new Set(this.state.matchCounts);

    for (let n = 1; n <= Math.max(...availableCounts); n++) {
      if (!availableCounts.has(n)) continue;
      const btn = DOMFactory.el("div", "cefilter-match-count-btn" +
        (selected.has(n) ? " active" : ""));
      btn.textContent = n + " CE";
      btn.addEventListener("click", () => {
        if (selected.has(n)) {
          selected.delete(n);
        } else {
          selected.add(n);
        }
        this.state.matchCounts = [...selected];
        this.saveState();
        this.buildMatchCountFilter();
        this._debouncedRender();
      });
      container.appendChild(btn);
    }
  },

  renderChips() {
    const container = document.getElementById("cefilterChips");
    if (!container) return;
    container.replaceChildren();

    if (this.state.selectedCEs.length === 0) {
      const placeholder = DOMFactory.el("div", "servant-slot-placeholder");
      placeholder.textContent = "No craft essences selected \u2014 showing all servants. Add Craft Essence to filter.";
      container.appendChild(placeholder);
      return;
    }

    this.state.selectedCEs.forEach(ceId => {
      const ce = CEList.find(c => c.id === ceId);
      if (!ce) return;

      const chip = DOMFactory.el("div", "cefilter-chip");

      const img = DOMFactory.createLazyImg(ce.image, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      chip.appendChild(img);

      const nameSpan = DOMFactory.el("span");
      nameSpan.textContent = ce.name;
      chip.appendChild(nameSpan);

      const removeBtn = DOMFactory.el("button", "cefilter-chip-remove", { type: "button" });
      removeBtn.textContent = "\u2715";
      removeBtn.addEventListener("click", () => {
        this.state.selectedCEs = this.state.selectedCEs.filter(id => id !== ceId);
        this.saveState();
        this.render();
      });
      chip.appendChild(removeBtn);

      container.appendChild(chip);
    });
  },

  renderResults() {
    const grid = document.getElementById("cefilterResults");
    const countEl = document.getElementById("cefilterCount");
    const modeSelect = document.getElementById("cefilterMode");
    const modeRow = document.querySelector(".cefilter-mode-row");
    if (!grid) return;

    const selectedCEObjs = this.state.selectedCEs
      .map(id => CEList.find(c => c.id === id))
      .filter(ce => ce != null);

    if (selectedCEObjs.length >= 2) {
      if (modeRow) modeRow.style.display = "";
    } else {
      if (modeRow) modeRow.style.display = "none";
      if (this.state.mode !== "all") {
        this.state.mode = "all";
        if (modeSelect) modeSelect.value = "all";
        this.saveState();
      }
    }

    const allMatches = this.computeAllCEMatches();
    let filtered = this.filterByCEs(allMatches);

    // Hide class/rarity buttons not present in CE-filtered results
    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    filtered.forEach(({ servant }) => {
      servant.traits.forEach(t => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });
    document.querySelectorAll(".cefilter-class-btn").forEach(btn => {
      const avail = availableClassIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });
    document.querySelectorAll(".cefilter-rarity-btn").forEach(btn => {
      const avail = availableRarityIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });
    this.state.classFilters = this.state.classFilters.filter(id => availableClassIds.has(id));
    this.state.rarityFilters = this.state.rarityFilters.filter(id => availableRarityIds.has(id));

    // Apply search query
    const query = (this.state.searchQuery || "").toLowerCase().trim();
    const matchesSearch = (s) =>
      s.id.toLowerCase().includes(query) ||
      s.name.toLowerCase().includes(query) ||
      ServantData.getAllNames(s.id).some(n => n.toLowerCase().includes(query));
    if (query) {
      filtered = filtered.filter(s => matchesSearch(s.servant));
    }

    // Apply class filter
    const classSet = new Set(this.state.classFilters);
    if (this.state.classFilters.length > 0) {
      filtered = filtered.filter(s =>
        s.servant.traits.some(t => classSet.has(t))
      );
    }

    // Apply rarity filter
    const raritySet = new Set(this.state.rarityFilters);
    if (this.state.rarityFilters.length > 0) {
      filtered = filtered.filter(s =>
        s.servant.traits.some(t => raritySet.has(t))
      );
    }

    // Apply match count filter
    if (this.state.matchCounts.length > 0) {
      const countSet = new Set(this.state.matchCounts);
      filtered = filtered.filter(s => countSet.has(s.matchingCEs.length));
    }

    if (countEl) {
      countEl.textContent = `${filtered.length} servant${filtered.length !== 1 ? "s" : ""} found`;
    }

    const frag = document.createDocumentFragment();

    filtered.forEach(({ servant, matchingCEs, allTraitNames, matchedAscensions, baseMatchesAll, primaryAscension }) => {
      const card = DOMFactory.el("div", "cefilter-servant-card");

      const imgAsc = (!baseMatchesAll && matchedAscensions.length > 0)
        ? (primaryAscension || matchedAscensions[0])
        : null;
      const imgSrc = imgAsc
        ? ServantData.getImageForAscension(servant.id, imgAsc)
        : servant.image;
      const img = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", {
        alt: servant.name
      });
      DOMFactory.addAscensionFallback(img, servant.id);
      if (matchingCEs.length > 0) {
        img.style.cursor = "pointer";
        img.addEventListener("click", () => {
          CEServantOverlap.open({ servant, matchingCEs, allTraitNames,
            matchedAscensions, baseMatchesAll, primaryAscension });
        });
      }
      card.appendChild(img);

      if (matchingCEs.length > 0) {
        const badges = DOMFactory.el("div", "cefilter-match-badges");
        matchingCEs.forEach(ce => {
          const badge = DOMFactory.createLazyImg(ce.image, "cefilter-match-badge", {
            alt: ce.name,
            title: ce.name
          });
          DOMFactory.addSimpleFallback(badge, "cefilter-match-badge-fallback", ce.id);
          badge.style.cursor = "pointer";
          badge.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!this.state.selectedCEs.includes(ce.id)) {
              this.state.selectedCEs.push(ce.id);
              this.saveState();
              this.render();
            }
          });
          badges.appendChild(badge);
        });
        card.appendChild(badges);
      }

      const displayName = imgAsc
        ? ServantData.getAscensionName(servant.id, imgAsc) || servant.name
        : servant.name;
      const nameEl = DOMFactory.el("div", "cefilter-servant-name");
      nameEl.textContent = displayName;
      card.appendChild(nameEl);

      if (matchedAscensions && matchedAscensions.length > 0) {
        matchedAscensions.forEach(k => {
          const ascEl = DOMFactory.el("div", "cefilter-ascension-label");
          ascEl.textContent = ServantData.getAscensionLabel(servant.id, k);
          card.appendChild(ascEl);
        });
      }

      if (allTraitNames.length > 0) {
        const tags = DOMFactory.el("div", "cefilter-trait-tags");
        const show = allTraitNames.slice(0, 4);
        show.forEach(t => {
          const tag = DOMFactory.el("span", "cefilter-trait-tag");
          tag.textContent = t;
          tags.appendChild(tag);
        });
        if (allTraitNames.length > 4) {
          const more = DOMFactory.el("span", "cefilter-trait-tag");
          more.textContent = `+${allTraitNames.length - 4} more`;
          tags.appendChild(more);
        }
        card.appendChild(tags);
      }

      frag.appendChild(card);
    });

    grid.replaceChildren(frag);

    // --- No Matching CE section ---
    const noMatchGrid = document.getElementById("cefilterNoMatch");
    const noMatchCountEl = document.getElementById("cefilterNoMatchCount");
    const noMatchHeader = document.getElementById("cefilterNoMatchHeader");
    if (!noMatchGrid) return;

    const noMatchFrag = document.createDocumentFragment();

    const matchedIds = new Set(allMatches.map(r => r.servant.id));
    let noMatchServants = ServantData.servants.filter(s => !matchedIds.has(s.id));

    if (query) {
      noMatchServants = noMatchServants.filter(s => matchesSearch(s));
    }
    if (this.state.classFilters.length > 0) {
      noMatchServants = noMatchServants.filter(s =>
        s.traits.some(t => classSet.has(t))
      );
    }
    if (this.state.rarityFilters.length > 0) {
      noMatchServants = noMatchServants.filter(s =>
        s.traits.some(t => raritySet.has(t))
      );
    }

    const hasCESelected = selectedCEObjs.length > 0;
    const hasMatchCountFilter = this.state.matchCounts.length > 0;
    const showNoMatch = !hasCESelected && !hasMatchCountFilter && noMatchServants.length > 0;
    if (noMatchHeader) {
      noMatchHeader.style.display = showNoMatch ? "" : "none";
    }
    if (noMatchGrid) {
      noMatchGrid.style.display = showNoMatch ? "" : "none";
    }
    if (noMatchCountEl) {
      noMatchCountEl.textContent = `${noMatchServants.length} servant${noMatchServants.length !== 1 ? "s" : ""}`;
    }

    if (showNoMatch) {
      noMatchServants.forEach(servant => {
        const card = DOMFactory.el("div", "cefilter-servant-card");

        const img = DOMFactory.createLazyImg(servant.image, "servant-slot-portrait", {
          alt: servant.name
        });
        DOMFactory.addAscensionFallback(img, servant.id);
        card.appendChild(img);

        const nameEl = DOMFactory.el("div", "cefilter-servant-name");
        nameEl.textContent = servant.name;
        card.appendChild(nameEl);

        noMatchFrag.appendChild(card);
      });
    }

    noMatchGrid.replaceChildren(noMatchFrag);
  },

  computeAllCEMatches() {
    if (this._allCEMatchesCache) return this._allCEMatchesCache;
    const traitCEs = CEList.filter(ce => ce.traits.length > 0 || ce.traitGroups.length > 0);
    const relevantTraitIds = new Set();
    traitCEs.forEach(ce => {
      ce.traits.forEach(t => relevantTraitIds.add(t));
      ce.traitGroups.forEach(group => group.forEach(t => relevantTraitIds.add(t)));
    });

    const results = [];

    ServantData.servants.forEach(servant => {
      const traitSets = TraitMatcher.getAllTraitSets(servant);

      if (!servant.hasAscensions) {
        const matchingCEs = traitCEs.filter(ce => TraitMatcher.matches(servant.traits, ce));
        if (matchingCEs.length === 0) return;

        const relevantTraits = servant.traits
          .filter(t => relevantTraitIds.has(t))
          .map(t => TraitNames[t] || t);

        results.push({
          servant, matchingCEs, allTraitNames: relevantTraits,
          matchedAscensions: [], baseMatchesAll: true
        });
      } else {
        const ascResults = traitSets.map(set => ({
          key: set.key,
          traits: set.traits,
          matchingCEs: traitCEs.filter(ce => TraitMatcher.matches(set.traits, ce))
        }));

        const groups = new Map();
        ascResults.forEach(ar => {
          const key = ar.matchingCEs.map(c => c.id).sort().join(',');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(ar);
        });

        const nonEmptyGroups = [...groups.entries()]
          .filter(([_, entries]) => entries[0].matchingCEs.length > 0);
        if (nonEmptyGroups.length === 0) return;

        if (nonEmptyGroups.length === 1) {
          const entries = nonEmptyGroups[0][1];
          const matchingCEs = entries[0].matchingCEs;
          const mergedTraits = [...new Set(entries.flatMap(e => e.traits))];
          const relevantTraits = mergedTraits
            .filter(t => relevantTraitIds.has(t))
            .map(t => TraitNames[t] || t);

          results.push({
            servant, matchingCEs, allTraitNames: relevantTraits,
            matchedAscensions: [], baseMatchesAll: true
          });
        } else {
          nonEmptyGroups.forEach(([_, entries]) => {
            const matchingCEs = entries[0].matchingCEs;
            const ascKeys = entries.map(e => e.key);
            const mergedTraits = [...new Set(entries.flatMap(e => e.traits))];
            const relevantTraits = mergedTraits
              .filter(t => relevantTraitIds.has(t))
              .map(t => TraitNames[t] || t);

            results.push({
              servant, matchingCEs, allTraitNames: relevantTraits,
              matchedAscensions: ascKeys, baseMatchesAll: false,
              primaryAscension: ascKeys[0]
            });
          });
        }
      }
    });

    this._allCEMatchesCache = results;
    return results;
  },

  saveState() {
    try {
      localStorage.setItem(CEFILTER_STORAGE_KEY, JSON.stringify({
        selectedCEs: this.state.selectedCEs,
        mode: this.state.mode,
        classFilters: this.state.classFilters,
        rarityFilters: this.state.rarityFilters,
        matchCounts: this.state.matchCounts,
        matchCustomCounts: this.state.matchCustomCounts
      }));
    } catch (e) { /* ignore */ }
  },

  loadState() {
    try {
      const raw = localStorage.getItem(CEFILTER_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.selectedCEs && Array.isArray(data.selectedCEs)) {
        this.state.selectedCEs = data.selectedCEs.filter(id =>
          CEList.some(c => c.id === id)
        );
      }
      if (data.mode === "all" || data.mode === "any" || data.mode === "custom") {
        this.state.mode = data.mode;
      } else if (data.mode === "some") {
        this.state.mode = "custom";
      }
      if (Array.isArray(data.classFilters)) {
        this.state.classFilters = data.classFilters;
      }
      if (Array.isArray(data.rarityFilters)) {
        this.state.rarityFilters = data.rarityFilters;
      }
      if (Array.isArray(data.matchCounts)) {
        this.state.matchCounts = data.matchCounts;
      }
      if (Array.isArray(data.matchCustomCounts)) {
        this.state.matchCustomCounts = data.matchCustomCounts;
      } else if (Array.isArray(data.matchSomeCounts)) {
        this.state.matchCustomCounts = data.matchSomeCounts;
      }
    } catch (e) { /* ignore */ }
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
    grid.replaceChildren();

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
        const img = DOMFactory.createLazyImg(ceImage, "ce-portrait", { alt: ceName });
        DOMFactory.addSimpleFallback(img, "ce-portrait-fallback", typeof ceEntry === "object" ? ceEntry.groupId : ceEntry);
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

    // Add button (hidden when at max slots)
    if (this.state.ces.length < CE_MAX_SLOTS) {
      const addSlot = DOMFactory.el("div", ["ce-slot", "ce-add-slot"]);
      const addPortrait = DOMFactory.el("div", "ce-portrait-fallback");
      addPortrait.textContent = "+";
      addSlot.appendChild(addPortrait);
      const addInfo = DOMFactory.el("div");
      const addLabel = DOMFactory.el("div", "ce-slot-name");
      addLabel.textContent = "Add Craft Essence";
      addInfo.appendChild(addLabel);
      addSlot.appendChild(addInfo);
      addSlot.addEventListener("click", () => {
        if (this.state.ces.length >= CE_MAX_SLOTS) return;
        this.state.ces.push(null);
        this.buildCESlots();
        CESelector.open(this.state.ces.length - 1, true);
      });
      grid.appendChild(addSlot);
    }
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
        slot.bondNeeded = Validator.clamp(input.value, 0, BOND_CONSTANTS.MAX_BOND_NEEDED);
      }
    });
  },

  buildServantSlots() {
    const grid = document.getElementById("servantGrid");
    if (!grid) return;
    this.elements = {};

    const frag = document.createDocumentFragment();
    const count = this.state.slots.length;

    for (let i = 0; i < count; i++) {
      const slotData = this.state.slots[i];

      // Insert group labels before first slot of each group
      if (i === 0) {
        const label = DOMFactory.el("div", "bond-group-label bond-group-label--frontline");
        label.textContent = "Starting Member";
        frag.appendChild(label);
      } else if (i === BOND_CONSTANTS.FRONTLINE_SIZE) {
        const label = DOMFactory.el("div", "bond-group-label bond-group-label--backline");
        label.textContent = "Sub Member";
        frag.appendChild(label);
      }

      if (!slotData.servantId) continue; // skip pending slots
      const slotClass = i < BOND_CONSTANTS.FRONTLINE_SIZE
        ? "servant-slot servant-slot--frontline"
        : "servant-slot servant-slot--backline";
      const slot = DOMFactory.el("div", slotClass);
      slot.dataset.slotIndex = i;
      slot.style.cursor = "grab";

      // Frontline bonus badge
      if (i < BOND_CONSTANTS.FRONTLINE_SIZE) {
        const slotType = slotData.type || "normal";
        const badge = DOMFactory.el("div", "servant-slot-frontline-badge");
        const badgeImg = DOMFactory.el("img", "", {
          src: "icons/bond_icon.webp",
          alt: "Frontline",
          draggable: "false"
        });
        if (slotType === "support") {
          const imgWrap = DOMFactory.el("div", "servant-slot-frontline-img");
          imgWrap.appendChild(badgeImg);
          const badgeOverlay = DOMFactory.el("span", "servant-slot-frontline-overlay");
          badgeOverlay.textContent = "All";
          imgWrap.appendChild(badgeOverlay);
          badge.appendChild(imgWrap);
        } else {
          badge.appendChild(badgeImg);
        }
        const badgeText = DOMFactory.el("span");
        badgeText.textContent = slotType === "support" ? "+4%" : "+20%";
        badge.appendChild(badgeText);
        slot.appendChild(badge);
      }

      // Portrait area (clickable to open selector)
      const portraitArea = DOMFactory.el("div", "servant-slot-select-btn");
      let servantHasAscensions = false;

      if (slotData.servantId) {
        const servant = ServantData.getServant(slotData.servantId);
        if (servant) {
          servantHasAscensions = servant.hasAscensions;
          const ascension = ServantData.getDefaultAscension(slotData.servantId, slotData.ascension);
          const imgSrc = ServantData.getImageForAscension(servant.id, ascension);
          const img = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", {
            alt: servant.name,
            draggable: "false"
          });
          DOMFactory.addAscensionFallback(img, servant.id);
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
        placeholder.textContent = "Click to select";
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
        inputLabel.textContent = "Bond Needed";
        const input = DOMFactory.el("input", "input-field", {
          type: "number",
          id: `slotBond_${i}`,
          min: "0",
          max: String(BOND_CONSTANTS.MAX_BOND_NEEDED),
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
      frag.appendChild(slot);
    }

    // Add button (hidden when at max slots)
    if (count < SERVANT_MAX_SLOTS) {
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
        if (this.state.slots.length >= SERVANT_MAX_SLOTS) return;
        this.flushInputsToState();
        this.state.slots.push({ servantId: null, bondNeeded: 0, type: "normal", ascension: null });
        this.buildServantSlots();
        const newIndex = this.state.slots.length - 1;
        ServantSelector.open(newIndex, true);
      });
      addSlot.style.cursor = "pointer";
      frag.appendChild(addSlot);
    }

    grid.replaceChildren(frag);
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
        document.getElementById("customBondPerRun").value, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND
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
        this.state.slots[i].bondNeeded = Validator.clamp(input.value, 0, BOND_CONSTANTS.MAX_BOND_NEEDED);
      }
    }

    // Collect max bond servants for +25% bonus
    const maxBondServants = [];
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      if (slot.servantId && (slot.type || "normal") === "maxbond") {
        const servant = ServantData.getServant(slot.servantId);
        const mbAsc = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
        maxBondServants.push({
          servantId: slot.servantId,
          name: servant ? ServantData.getAscensionName(slot.servantId, mbAsc) : slot.servantId,
          image: servant ? ServantData.getImageForAscension(slot.servantId, mbAsc) : null,
        });
      }
    }
    const maxBondBonus = maxBondServants.length * BOND_CONSTANTS.MAX_BOND_BONUS_PCT;

    // Collect frontline support servants for +4% bonus
    const frontlineSupports = [];
    for (let i = 0; i < Math.min(count, BOND_CONSTANTS.FRONTLINE_SIZE); i++) {
      const slot = this.state.slots[i];
      if (slot.servantId && (slot.type || "normal") === "support") {
        const servant = ServantData.getServant(slot.servantId);
        const supAsc = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
        frontlineSupports.push({
          servantId: slot.servantId,
          name: servant ? ServantData.getAscensionName(slot.servantId, supAsc) : slot.servantId,
          image: servant ? ServantData.getImageForAscension(slot.servantId, supAsc) : null,
        });
      }
    }

    // Check for normal servants with missing bond value
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      const slotType = slot.type || "normal";
      if (slotType !== "normal") continue;
      if (!slot.servantId) continue;
      const bondNeeded = slot.bondNeeded || 0;
      if (bondNeeded <= 0) {
        const servant = ServantData.getServant(slot.servantId);
        const asc = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
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
      const isFrontline = i < BOND_CONSTANTS.FRONTLINE_SIZE;

      // Sum percentage bonuses (CEs + max bond, NOT frontline or support)
      let ceBonusPercent = maxBondBonus;
      const appliedCEs = [];
      if (isFrontline) {
        appliedCEs.push({ id: "frontline", name: "Frontline", bonus: BOND_CONSTANTS.FRONTLINE_BONUS_PCT, image: "icons/bond_icon.webp" });
      }
      frontlineSupports.forEach(fs => {
        appliedCEs.push({ id: "support_" + fs.servantId, name: fs.name, bonus: 4, image: fs.image, isSupport: true });
      });
      maxBondServants.forEach(mb => {
        appliedCEs.push({ id: "maxbond_" + mb.servantId, name: mb.name, bonus: 25, image: mb.image, isMaxBond: true });
      });

      // CE trait matching + flat bonus
      const ascension = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
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
          const matched = TraitMatcher.matches(servantTraits, ce);

          if (matched) {
            ceBonusPercent += ce.bonus;
            appliedCEs.push(ce);
          }
        }
      });

      // Step 1: bonus = base * bonus% rounded down (just the bonus part)
      let totalBonus = Math.floor(bondPerRun * ceBonusPercent / 100);
      // Step 2: apply frontline (+0.2) and support (+0.04 each) to multiplier and flat
      const supportMult = frontlineSupports.length * BOND_CONSTANTS.SUPPORT_BONUS_PCT / 100;
      const multiplier = 1 + (isFrontline ? BOND_CONSTANTS.FRONTLINE_BONUS_PCT / 100 : 0) + supportMult;
      if (multiplier > 1) {
        totalBonus = Math.floor(totalBonus * multiplier);
      }
      if (isFrontline) {
        totalBonus += Math.floor(bondPerRun * BOND_CONSTANTS.FRONTLINE_BONUS_FRACTION);
      }
      if (frontlineSupports.length > 0) {
        totalBonus += Math.floor(bondPerRun * frontlineSupports.length * BOND_CONSTANTS.SUPPORT_BONUS_PCT / 100);
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

    // Per-servant results grid
    const resultGrid = DOMFactory.el("div", "bond-result-servant-grid");
    slotResults.forEach(sr => {
      const card = DOMFactory.el("div", "bond-result-servant-card");

      // Portrait
      if (sr.image) {
        const img = DOMFactory.createLazyImg(sr.image, "servant-slot-portrait", {
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
            const servantImg = DOMFactory.createLazyImg(ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`
            });
            DOMFactory.addSimpleFallback(servantImg, "bond-result-ce-fallback", `+${ce.bonus}%`);
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
            const servantImg = DOMFactory.createLazyImg(ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`
            });
            DOMFactory.addSimpleFallback(servantImg, "bond-result-ce-fallback", `+${ce.bonus}%`);
            wrap.appendChild(servantImg);
            const icon = DOMFactory.el("img", "bond-result-ce-maxbond-icon", {
              src: "icons/fp_icon.webp",
              alt: "Frontline Support",
              title: "Frontline Support"
            });
            icon.onerror = () => { icon.style.display = "none"; };
            wrap.appendChild(icon);
            ceImgGrid.appendChild(wrap);
          } else if (ce.isFlatBonus) {
            const ceImg = DOMFactory.createLazyImg(ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.flatBonus} pts`
            });
            DOMFactory.addSimpleFallback(ceImg, "bond-result-ce-fallback", `+${ce.flatBonus} pts`);
            ceImgGrid.appendChild(ceImg);
          } else {
            const ceImg = DOMFactory.createLazyImg(ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`
            });
            DOMFactory.addSimpleFallback(ceImg, "bond-result-ce-fallback", `+${ce.bonus}%`);
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
      runsEl.textContent = `${sr.runs} ${sr.runs === 1 ? "run" : "runs"}`;
      card.appendChild(runsEl);

      resultGrid.appendChild(card);
    });
    container.replaceChildren(resultGrid);

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
            bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, BOND_CONSTANTS.MAX_BOND_NEEDED),
            type: ["normal", "support", "maxbond"].includes(s.type) ? s.type : "normal",
            ascension: (typeof s.ascension === "string" && s.ascension) ? s.ascension : null
          }));
      } else {
        slots = [];
        if (data.bondNeeded) {
          slots.push({ servantId: null, bondNeeded: Validator.clamp(data.bondNeeded, 0, BOND_CONSTANTS.MAX_BOND_NEEDED) });
        }
      }

      return {
        slots: slots.map(s => ({
          servantId: s.servantId || null,
          bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, BOND_CONSTANTS.MAX_BOND_NEEDED),
          type: s.type || "normal",
          ascension: (typeof s.ascension === "string" && s.ascension) ? s.ascension : null
        })),
        selectedQuest: typeof data.selectedQuest === "string" ? data.selectedQuest : "",
        customBond: Validator.clamp(data.customBond || 0, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND),
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

  // Lazy-init CEFilterApp: only if saved tab is cefilter
  let activeTab = "cefilter";
  try {
    activeTab = localStorage.getItem("fgo_active_tab") || "cefilter";
  } catch (e) { /* ignore */ }
  if (activeTab === "cefilter") CEFilterApp.init();
});

})();
