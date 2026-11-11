import { TIERS, TIER_FIELDS, QUEST_DROPS, DEBOUNCE_MS } from "./constants.js";
import { Schema, Validator, Calculator } from "./domain.js";
import { StateManager, Persistence } from "./state.js";
import { debounce } from "./presentation.js";
import { EventPlanner } from "./event-planner.js";
import { eventTierNeeds, hydrateTierCards, hydrateQuestIcons, buildFallbackIcon } from "./event-shop-tier.js";

/* ============================================
   PRESENTATION LAYER - UI Builder
   ============================================ */

/* The markup ships icon boxes empty (Amendment C: no generic material art), so the tier-colour
   letter badge is built here. Built unconditionally: hydrateTierCards/hydrateQuestIcons below run
   in the same tick and replaceChildren() the badge wherever a currency is mapped, so event mode
   never paints it and an unmapped tier keeps its badge. */
function buildTierFallback(container, tier) {
  if (container) container.replaceChildren(buildFallbackIcon(tier));
}

export const UIBuilder = {
  // DOM cache
  elements: {},

  buildMaterialsGrid(container, _state) {
    // Elements already exist in HTML — cache input refs, then fill the empty icon boxes
    TIERS.forEach((tier) => {
      TIER_FIELDS.forEach((field) => {
        const id = `${tier}${field}`;
        this.elements[id] = document.getElementById(id);
      });
      buildTierFallback(document.getElementById(`${tier}Icon`), tier);
    });

    // Event mode (Amendment A): mapped tiers show the currency's art, name and plan total
    hydrateTierCards(this.elements, container, eventTierNeeds(EventPlanner.state.requires));
  },

  loadQuestIcons() {
    // Every drop line has an empty `…_icon` span to fill with its material's badge
    Object.entries(QUEST_DROPS).forEach(([quest, drops]) => {
      [drops.primary, drops.secondary].forEach((material) => {
        buildTierFallback(document.getElementById(`${quest}Quest_${material}_icon`), material);
      });
    });

    // Event mode (Amendment A): mapped quest icons show the currency's art, titles its name
    hydrateQuestIcons();
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

  syncInputsFromState(state, eventNeeds = null) {
    const view = { state, eventNeeds };
    TIERS.forEach((tier) => {
      TIER_FIELDS.forEach((field) => setTierFieldValue(view, tier, field));
    });

    document.getElementById("baseDrop").value = state.baseDrop;
    document.getElementById("primaryMultiplier").value = state.primaryMultiplier;
    document.getElementById("secondaryMultiplier").value = state.secondaryMultiplier;
  },
};

/* Event mode (Amendment A): the read-only Required display shows the plan's per-currency spend
   from the planner, never the stale saved tier.need. Legacy (eventNeeds null) is untouched. */
function setTierFieldValue(view, tier, field) {
  const input = UIBuilder.elements[`${tier}${field}`];
  if (!input) return;
  const display = field === "Need" && view.eventNeeds ? view.eventNeeds[tier] : undefined;
  input.value = display === undefined ? view.state.tiers[tier][field.toLowerCase()] : display;
}

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
    // Sync inputs (event mode: Required shows the plan total, not the raw saved need)
    ViewManager.syncInputsFromState(this.state, this._eventNeeds());

    // Load icons
    UIBuilder.loadQuestIcons();

    // Update display
    ViewManager.updateDropDisplay(this.state);

    // Bind events
    EventHandler.bind(this);

    // Event mode: tier needs follow the loaded plan before anything reads them
    this.refreshNeeds();
  },

  /* The planner's requires are the single source of truth while an event is mapped: recompute
     every mapped tier's need from Σ require × cost, store it, and refresh the read-only displays.
     Legacy mode returns from the first line — state and storage untouched. */
  refreshNeeds() {
    const needs = this._eventNeeds();
    if (!needs) return;
    for (const tier of Object.keys(needs)) {
      this.state = StateManager.updateTier(this.state, tier, "need", needs[tier]);
    }
    Persistence.save(this.state);
    ViewManager.syncInputsFromState(this.state, needs);
  },

  _eventNeeds() {
    return eventTierNeeds(EventPlanner.state.requires);
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
