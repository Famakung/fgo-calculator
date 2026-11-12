import { TIERS, TIER_FIELDS, QUEST_DROPS, DEBOUNCE_MS } from "./constants.js";
import { Schema, Validator, Calculator, EventShop } from "./domain.js";
import { StateManager, Persistence } from "./state.js";
import { debounce } from "./presentation.js";
import { EventPlanner } from "./event-planner.js";
import { eventTierNeeds, hydrateTierCards, hydrateQuestIcons, buildFallbackIcon } from "./event-shop-tier.js";
import { refreshFarmDropLines } from "./event-shop-farm-lines.js";
import { hydrateFarmGrid, showFarmResults, syncPlanBoxes, showFarmCard } from "./event-shop-farm.js";

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

    // Event mode (Amendment A, per-event since Amendment G): mapped tiers show that event's art,
    // name and plan spend. With no snapshot every card keeps the generic look it was built with.
    const snapshot = EventPlanner.activeEvent();
    hydrateTierCards({
      elements: this.elements,
      container,
      snapshot,
      needs: eventTierNeeds(snapshot, EventPlanner.activePlan().requires),
    });
  },

  loadQuestIcons() {
    // Every drop line has an empty `…_icon` span to fill with its material's badge
    Object.entries(QUEST_DROPS).forEach(([quest, drops]) => {
      [drops.primary, drops.secondary].forEach((material) => {
        buildTierFallback(document.getElementById(`${quest}Quest_${material}_icon`), material);
      });
    });

    // Event mode (Amendment A): mapped quest icons show the currency's art, titles its name
    hydrateQuestIcons(EventPlanner.activeEvent());
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
    revealResults();

    TIERS.forEach((tier) => {
      const deficitEl = document.getElementById(`${tier}Deficit`);
      if (deficitEl) deficitEl.textContent = Math.max(0, Math.ceil(deficits[tier]));

      const runEl = document.getElementById(`${tier}Play`);
      if (runEl) runEl.textContent = runs[tier];
      const labelEl = document.getElementById(`${tier}Label`);
      if (labelEl) labelEl.textContent = runs[tier] === 1 ? "run" : "runs";
    });
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

  resetResults() {
    document.getElementById("results")?.classList.remove("visible");
  },
};

function revealResults() {
  const results = document.getElementById("results");
  if (!results) return;
  results.classList.add("visible");
  setTimeout(() => {
    results.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

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
    const calcBtn = document.getElementById("calculateBtn");
    if (calcBtn) calcBtn.addEventListener("click", () => app.calculate());

    if (EventPlanner.activeEvent()) this.bindPlanBoxes();
    else this.bindLegacyBoxes(app);
  },

  /* Tier Held and Bonus boxes edit the plan figure of the currency mapped to that tier (Amendment H),
      so an event with two golds keeps their numbers apart. Required is the plan's spend and is
      written by the hydration, never typed. A Bonus write also repaints the farm cards' drop lines
      (Amendment I): the stack a line prints is num + that currency's bonus. */
  bindPlanBoxes() {
    TIERS.forEach((tier) => {
      bindPlanBox(tier, "Have", (currencyId, value) => EventPlanner.setHeld(currencyId, value));
      bindPlanBox(tier, "Bonus", (currencyId, value) => {
        EventPlanner.setBonus(currencyId, value);
        refreshFarmDropLines();
      });
    });
  },

  /* Legacy stub snapshot: the tier calculator's own wiring, unchanged since before the planner. */
  bindLegacyBoxes(app) {
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

    if (EventPlanner.activeEvent()) this._initEventMode();
    else this._initLegacyMode();

    // Bind events — the snapshot decides which boxes the inputs drive
    EventHandler.bind(this);
  },

  /* Legacy calculator (empty snapshot list): exactly the flow the page shipped before the planner.
     #farmGrid ships hidden in the markup, so the legacy card needs no chrome change here. */
  _initLegacyMode() {
    UIBuilder.buildMaterialsGrid(document.getElementById("materialsGrid"), this.state);
    ViewManager.syncInputsFromState(this.state, this._eventNeeds());
    UIBuilder.loadQuestIcons();
    ViewManager.updateDropDisplay(this.state);
  },

  /* Event mode: the selected event owns the tier figures, and the drop-rate card shows the best
     farm quest per currency instead of the configurable base/multiplier model (Amendment D). */
  _initEventMode() {
    this.rehydrate();
  },

  /* Full re-hydration behind the Event Select: tier cards, farm cards, box values, results reset.
     Handlers are not rebound — the Required display resolves its currency from a data attribute, so
     a switch re-points the one bound listener instead of stacking another per switch. */
  rehydrate() {
    const snapshot = EventPlanner.activeEvent();
    if (!snapshot) return;
    UIBuilder.buildMaterialsGrid(document.getElementById("materialsGrid"), this.state);
    showFarmCard();
    UIBuilder.loadQuestIcons();
    hydrateFarmGrid(snapshot, EventPlanner.activePlan(), this._farmHandlers());
    ViewManager.resetResults();
    this.refreshNeeds();
  },

  /* The farm grid's two write paths (Amendment L, M4): a Bonus figure repaints the live drop
     lines; any quest pick — a card's own dropdown or the 3-in-1's — repaints the whole grid (each
     card resolves its own selected quest through it) and reprices the results when they are
     showing. */
  _farmHandlers() {
    return { onBonusChange: refreshFarmDropLines, onQuestChange: () => this.onFarmQuestChanged() };
  },

  onFarmQuestChanged() {
    const snapshot = EventPlanner.activeEvent();
    if (!snapshot) return;
    hydrateFarmGrid(snapshot, EventPlanner.activePlan(), this._farmHandlers());
    if (document.getElementById("results")?.classList.contains("visible")) this._calculateFarm();
  },

  /* Event-mode boxes: Required is the plan's spend and Held/Bonus are the plan's figures. */
  _writePlanBoxes() {
    syncPlanBoxes(UIBuilder.elements, planTierValues(), this._eventNeeds() || {});
  },

  /* The planner's requires are the single source of truth while an event is mapped: recompute
     every mapped tier's need from Σ require × cost, keep the legacy mirror in step, and refresh the
     read-only displays. Legacy mode returns from the first line — state and storage untouched. */
  refreshNeeds() {
    const needs = this._eventNeeds();
    if (!needs) return;
    for (const tier of Object.keys(needs)) {
      this.state = StateManager.updateTier(this.state, tier, "need", needs[tier]);
    }
    Persistence.save(this.state);
    this._writePlanBoxes();
    if (!EventPlanner.activeEvent()) return;
    refreshFarmDropLines();
  },

  _eventNeeds() {
    return eventTierNeeds(EventPlanner.activeEvent(), EventPlanner.activePlan().requires);
  },

  calculate() {
    if (EventPlanner.activeEvent()) return this._calculateFarm();
    return this._calculateLegacy();
  },

  /* Trade-aware minimum-play math (Amendment L5, M6, N2): what each currency still needs after the
      plan's spend minus its held figure, over the whole farm optimizer — priority quest scan,
      each currency's SELECTED non-all-covering top-up quest (currencyIds names the shop's list so
      the exclusion is the cards' own rule), full-drop cross-credit, integer cascade trades. The
      plan's held/bonus are currency-keyed since
      Amendment H, so farmPlan reads them whole: every currency — mapped to a tier or not — prices
      with its own figures. The legacy base/primary/secondary model and Calculator.calcOptimalRuns
      are not consulted. */
  _calculateFarm() {
    const snapshot = EventPlanner.activeEvent();
    this._commitTierBoxes();
    this._commitFarmBoxes(snapshot);
    const plan = EventPlanner.activePlan();
    const totals = EventShop.totals(snapshot.items, plan.requires);
    const result = EventShop.farmPlan({
      totals,
      held: plan.held,
      bonus: plan.bonus,
      farm: snapshot.farm,
      trades: snapshot.trades || [],
      priorityQuestId: plan.farmQuest,
      currencyQuest: plan.currencyQuest,
      currencyIds: (snapshot.currencies || []).map((currency) => currency.id),
    });
    refreshFarmDropLines();
    showFarmResults(snapshot, { plan, totals, result, reveal: revealResults });
  },

  /* Event Select switch inside the debounce window: commit every live Held/Bonus figure to the
     still-active event before select/rehydrate repaints the boxes. Without this the pending debounce
     resolves the NEW event's currency and reads the repainted box, so the typed figure never lands
     in the original event's plan. The later debounce write repeats the shown figure — harmless. */
  flushPlanBoxes() {
    const snapshot = EventPlanner.activeEvent();
    if (!snapshot) return;
    this._commitTierBoxes();
    this._commitFarmBoxes(snapshot);
  },

  /* Commit what the boxes hold into the plan before pricing it: typing into a box and pressing
     Calculate without the box losing focus must still price the typed figure. The write goes to the
     currency the tier maps to (Amendment H); an unmapped tier has no figure to commit. */
  _commitTierBoxes() {
    const currencies = EventPlanner.activeEvent()?.currencies;
    TIERS.forEach((tier) => {
      const currency = EventShop.currencyForTier(currencies, tier);
      if (!currency) return;
      EventPlanner.setHeld(currency.id, boxValue(`${tier}Have`));
      EventPlanner.setBonus(currency.id, boxValue(`${tier}Bonus`));
    });
  },

  /* Farm Held/Bonus boxes (currencies no tier card owns) persist through a trailing debounce, so
     Calculate commits their live values too — the same clamp path as the tier flush above. The
     later debounce write repeats the same figure and is harmless. */
  _commitFarmBoxes(snapshot) {
    for (const currency of snapshot.currencies) {
      const key = String(currency.id);
      const held = document.getElementById(`farmHeld${key}`);
      const bonus = document.getElementById(`farmBonus${key}`);
      if (held) EventPlanner.setHeld(key, held.value);
      if (bonus) EventPlanner.setBonus(key, bonus.value);
    }
  },

  _calculateLegacy() {
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

function boxValue(id) {
  const input = UIBuilder.elements[id];
  return input ? input.value : 0;
}

/* One plan-box listener, debounced through the house debounce(fn, DEBOUNCE_MS) pattern so typing
   persists at most once per window. The mapped currency and the box value are read when the write
   fires, not when it was scheduled: an Event Select switch inside the debounce window repaints the
   box, and the write then carries the shown figure rather than a stale one. A tier the event has
   no currency for has no plan figure to write. */
function bindPlanBox(tier, field, write) {
  const input = UIBuilder.elements[`${tier}${field}`];
  if (!input) return;
  input.addEventListener(
    "input",
    debounce(() => {
      const currency = EventShop.currencyForTier(EventPlanner.activeEvent()?.currencies, tier);
      if (currency) write(currency.id, input.value);
    }, DEBOUNCE_MS),
  );
}

/* Both plan figures, read per currency (Amendment H) through the tier map and keyed by tier the way
   the boxes are: an unmapped tier reads 0, exactly as before the plan was currency-keyed. */
function planTierValues() {
  const currencies = EventPlanner.activeEvent()?.currencies;
  const held = {};
  const bonus = {};
  TIERS.forEach((tier) => {
    const currency = EventShop.currencyForTier(currencies, tier);
    held[tier] = currency ? EventPlanner.heldOf(currency.id) : 0;
    bonus[tier] = currency ? EventPlanner.bonusOf(currency.id) : 0;
  });
  return { held, bonus };
}
