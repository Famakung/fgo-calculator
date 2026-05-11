import { TIERS, TIER_FIELDS, QUEST_DROPS, TIER_COLORS, DEBOUNCE_MS } from "./constants.js";
import { Schema, Validator, Calculator } from "./domain.js";
import { StateManager, Persistence } from "./state.js";
import { DOMFactory, debounce } from "./presentation.js";

/* ============================================
   PRESENTATION LAYER - UI Builder
   ============================================ */
export const UIBuilder = {
  // DOM cache
  elements: {},

  buildMaterialsGrid(container, _state) {
    // Elements already exist in HTML — cache input refs and add icon error handlers
    TIERS.forEach((tier) => {
      TIER_FIELDS.forEach((field) => {
        const id = `${tier}${field}`;
        this.elements[id] = document.getElementById(id);
      });

      // Add icon error handlers
      const card = container.querySelector(`[data-tier="${tier}"]`);
      if (card) {
        const bgImg = card.querySelector(".bg-layer");
        const fgImg = card.querySelector(".fg-layer");
        if (bgImg)
          bgImg.onerror = () => {
            bgImg.style.display = "none";
          };
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

  loadQuestIcons() {
    // Add error handlers to existing quest drop icons in HTML
    Object.entries(QUEST_DROPS).forEach(([quest, drops]) => {
      [drops.primary, drops.secondary].forEach((material) => {
        const container = document.getElementById(`${quest}Quest_${material}_icon`);
        if (container) {
          const bgImg = container.querySelector(".bg-layer");
          const fgImg = container.querySelector(".fg-layer");
          if (bgImg)
            bgImg.onerror = () => {
              bgImg.style.display = "none";
            };
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
  },
};

/* ============================================
   PRESENTATION LAYER - View Manager
   ============================================ */
export const ViewManager = {
  updateDropDisplay(state) {
    const base = state.baseDrop;
    const primaryMult = state.primaryMultiplier / 100;
    const secondaryMult = state.secondaryMultiplier / 100;

    TIERS.forEach((questTier) => {
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

    TIERS.forEach((tier) => {
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
    TIERS.forEach((tier) => {
      TIER_FIELDS.forEach((field) => {
        const input = UIBuilder.elements[`${tier}${field}`];
        if (input) {
          input.value = state.tiers[tier][field.toLowerCase()];
        }
      });
    });

    document.getElementById("baseDrop").value = state.baseDrop;
    document.getElementById("primaryMultiplier").value = state.primaryMultiplier;
    document.getElementById("secondaryMultiplier").value = state.secondaryMultiplier;
  },
};

/* ============================================
   PRESENTATION LAYER - Event Handler
   ============================================ */
export const EventHandler = {
  bind(app) {
    const debouncedUpdate = debounce(() => {
      ViewManager.updateDropDisplay(app.state);
    }, DEBOUNCE_MS);

    // Tier bonus inputs
    TIERS.forEach((tier) => {
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
    ["baseDrop", "primaryMultiplier", "secondaryMultiplier"].forEach((key) => {
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
  },
};

/* ============================================
   APPLICATION - App Controller
   ============================================ */
export const App = {
  state: null,

  init() {
    // Initialize state
    this.state = Persistence.load() || StateManager.createInitial();

    // Build UI
    UIBuilder.buildMaterialsGrid(document.getElementById("materialsGrid"), this.state);
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
    TIERS.forEach((tier) => {
      TIER_FIELDS.forEach((field) => {
        const input = UIBuilder.elements[`${tier}${field}`];
        if (input) {
          const value = Validator.validate(input.value, Schema.tier[field]);
          this.state = StateManager.updateTier(this.state, tier, field.toLowerCase(), value);
        }
      });
    });

    // Save
    Persistence.save(this.state);

    // Calculate
    const needs = {};
    const haves = {};
    TIERS.forEach((tier) => {
      needs[tier] = this.state.tiers[tier].need;
      haves[tier] = this.state.tiers[tier].have;
    });

    const deficits = Calculator.calcDeficits(needs, haves);

    // Build drop rates
    const dropRates = {};
    const base = this.state.baseDrop;
    const primaryMult = this.state.primaryMultiplier / 100;
    const secondaryMult = this.state.secondaryMultiplier / 100;

    TIERS.forEach((questTier) => {
      const drops = QUEST_DROPS[questTier];
      dropRates[questTier] = {
        primary: {
          tier: drops.primary,
          rate: Calculator.calcDropRate(base, this.state.tiers[drops.primary].bonus, primaryMult),
        },
        secondary: {
          tier: drops.secondary,
          rate: Calculator.calcDropRate(base, this.state.tiers[drops.secondary].bonus, secondaryMult),
        },
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
  },
};
