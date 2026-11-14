import { DEBOUNCE_MS, IMAGE_VERSION, TIERS } from "./constants.js";
import { EventShop, Schema } from "./domain.js";
import { DOMFactory, debounce } from "./presentation.js";
import { EventPlanner } from "./event-planner.js";
import { applySlidingName, refreshSlidingNames } from "./event-shop-farm-names.js";

/* ===...=== Event Shop bonus CE cards & equip limit ===...=== */

const BONUS_CE_GRID_ID = "bonusCeGrid";
const CE_EQUIP_WRAP_ID = "ceBonusEquipWrap";
const CE_EQUIP_INPUT_ID = "ceBonusEquipInput";

export function buildCeImg(ce, className, fallbackClass) {
  const fallbackText = ce.rarity ? `\u2605${ce.rarity}` : String(ce.id);
  if (!ce.icon) return buildCeFallback(fallbackClass, fallbackText);
  const img = DOMFactory.createLazyImg(`${ce.icon}?v=${IMAGE_VERSION}`, className, {
    alt: ce.name || String(ce.id),
    title: ce.name || String(ce.id),
  });
  DOMFactory.addSimpleFallback(img, fallbackClass, fallbackText);
  return img;
}

function buildCeFallback(className, text) {
  const fb = DOMFactory.el("div", className);
  fb.textContent = text;
  return fb;
}

export function hydrateBonusCeGrid(snapshot, plan) {
  const grid = document.getElementById(BONUS_CE_GRID_ID);
  if (!grid) return;
  const ces = snapshot && Array.isArray(snapshot.bonusCes) ? snapshot.bonusCes : [];
  if (!ces.length) {
    grid.replaceChildren();
    return;
  }
  const ordered = sortBonusCes(ces, snapshot);
  const fragment = document.createDocumentFragment();
  for (const ce of ordered) {
    const owned = (plan.ceOwned || {})[String(ce.id)] || { limitBreak: 0, nonLimitBreak: 0 };
    fragment.appendChild(buildBonusCeCard(ce, owned));
  }
  grid.replaceChildren(fragment);
  refreshSlidingNames(grid);
}

/* Align bonus CE cards with the currency column order above (bronze/3★, silver/4★, gold/5★),
   falling back to rarity ascending then id ascending when a CE is unmapped. */
function sortBonusCes(ces, snapshot) {
  const currencies = snapshot?.currencies || [];
  const tierIndex = new Map();
  TIERS.forEach((tier, idx) => {
    const currency = EventShop.currencyForTier(currencies, tier);
    if (currency) tierIndex.set(String(currency.id), idx);
  });
  const currencyOrder = new Map(currencies.map((c, idx) => [String(c.id), idx]));
  const rankOf = (ce) => {
    const ids = Object.keys(ce.bonuses || {});
    let bestTier = Number.POSITIVE_INFINITY;
    let bestCurrency = Number.POSITIVE_INFINITY;
    for (const cid of ids) {
      if (tierIndex.has(cid)) bestTier = Math.min(bestTier, tierIndex.get(cid));
      if (currencyOrder.has(cid)) bestCurrency = Math.min(bestCurrency, currencyOrder.get(cid));
    }
    return [bestTier, bestCurrency, ce.rarity ?? Number.POSITIVE_INFINITY, Number(ce.id) || 0];
  };
  return [...ces].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    return 0;
  });
}

function buildBonusCeCard(ce, owned) {
  const card = DOMFactory.el("div", ["material-card", "bonus-ce-card"], {
    dataset: { ceId: String(ce.id) },
  });
  const iconWrap = DOMFactory.el("div", "bonus-ce-icon-wrapper");
  iconWrap.replaceChildren(buildCeImg(ce, "bonus-ce-img", "bonus-ce-fallback"));
  const nameEl = DOMFactory.el("div", ["material-name", "bonus-ce-name"]);
  applySlidingName(nameEl, ce.name || String(ce.id));
  card.appendChild(iconWrap);
  card.appendChild(nameEl);
  card.appendChild(buildCeInputs(ce, owned));
  return card;
}

function primaryBonusSpec(ce) {
  return Object.values(ce?.bonuses || {}).find(
    (spec) => spec && (spec.limitBreak !== undefined || spec.nonLimitBreak !== undefined),
  );
}

function formatCeInputLabel(baseLabel, bonusValue) {
  return Number.isFinite(Number(bonusValue)) ? `${baseLabel} (+${Number(bonusValue)})` : baseLabel;
}

function buildCeInputs(ce, owned) {
  const spec = primaryBonusSpec(ce);
  const lbLabel = formatCeInputLabel("Limit Break", spec?.limitBreak);
  const nlbLabel = formatCeInputLabel("Non-Limit Break", spec?.nonLimitBreak);
  const wrap = DOMFactory.el("div", "bonus-ce-inputs");
  wrap.appendChild(buildCeCountBox(ce, "limitBreak", "lb", lbLabel, owned.limitBreak || 0));
  wrap.appendChild(buildCeCountBox(ce, "nonLimitBreak", "nlb", nlbLabel, owned.nonLimitBreak || 0));
  return wrap;
}

function buildCeCountBox(ce, kind, suffix, labelText, initialValue) {
  const schema = Schema.ceOwned || { min: 0, max: 99 };
  const inputId = `bonusCe_${ce.id}_${suffix}`;
  const box = DOMFactory.el("div", "material-input-box");
  const label = DOMFactory.el("label", "material-input-box-label", { for: inputId });
  label.textContent = labelText;
  const input = DOMFactory.el("input", "material-input-box-field", {
    type: "number",
    id: inputId,
    min: String(schema.min),
    max: String(schema.max),
    step: "1",
    inputmode: "numeric",
    "aria-label": `${ce.name || ce.id} ${labelText}`,
  });
  input.value = String(initialValue);
  input.addEventListener(
    "input",
    debounce(() => {
      if (!input.isConnected) return;
      EventPlanner.setCeOwned(ce.id, kind, input.value);
    }, DEBOUNCE_MS),
  );
  input.addEventListener("change", () => {
    EventPlanner.setCeOwned(ce.id, kind, input.value);
    input.value = String(EventPlanner.ceOwnedOf(ce.id)[kind]);
  });
  box.replaceChildren(label, input);
  return box;
}

export function commitBonusCeInputs(snapshot) {
  for (const ce of (snapshot && snapshot.bonusCes) || []) {
    for (const [kind, suffix] of [
      ["limitBreak", "lb"],
      ["nonLimitBreak", "nlb"],
    ]) {
      const input = document.getElementById(`bonusCe_${ce.id}_${suffix}`);
      if (!input) continue;
      EventPlanner.setCeOwned(ce.id, kind, input.value);
      input.value = String(EventPlanner.ceOwnedOf(ce.id)[kind]);
    }
  }
}

export function syncCeEquipInput(snapshot) {
  const wrap = document.getElementById(CE_EQUIP_WRAP_ID);
  const input = document.getElementById(CE_EQUIP_INPUT_ID);
  const hasCes = Boolean(snapshot && Array.isArray(snapshot.bonusCes) && snapshot.bonusCes.length > 0);
  if (wrap) wrap.style.display = hasCes ? "" : "none";
  if (input && hasCes) input.value = String(EventPlanner.ceEquipLimit());
}

export function bindCeEquipInput() {
  const input = document.getElementById(CE_EQUIP_INPUT_ID);
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.addEventListener(
    "input",
    debounce(() => {
      if (!EventPlanner.activeEvent()) return;
      EventPlanner.setCeEquipLimit(input.value);
    }, DEBOUNCE_MS),
  );
  input.addEventListener("change", () => {
    if (!EventPlanner.activeEvent()) return;
    EventPlanner.setCeEquipLimit(input.value);
    input.value = String(EventPlanner.ceEquipLimit());
  });
}

export function commitCeEquipInput() {
  const input = document.getElementById(CE_EQUIP_INPUT_ID);
  if (!input || !EventPlanner.activeEvent()) return;
  EventPlanner.setCeEquipLimit(input.value);
  input.value = String(EventPlanner.ceEquipLimit());
}
