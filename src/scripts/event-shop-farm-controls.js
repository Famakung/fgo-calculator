import { DEBOUNCE_MS, TIERS } from "./constants.js";
import { EventShop, Schema } from "./domain.js";
import { DOMFactory, debounce } from "./presentation.js";
import { EventPlanner } from "./event-planner.js";

/* ===...=== Farm-card currency controls (Amendment H, I7) ===...=== */
/* The controls a farm card owns but a tier card never shows for the same currency: a currency with
   no tier card gets its own Held/Bonus input pair, writing the same currency-keyed plan the tier
   boxes write. Exactly one input pair per currency: a tier-mapped currency gets no farm Held/Bonus,
   because its tier card already owns them. Amendment I7 removed the farm Required display — the
   tier cards are its only home now, and every currency stays modal-reachable through its farm
   card's header (event-shop-farm.js). The boxes reuse the house .material-input-box markup, so the
   label and field geometry match the tier cards'. */

/* The currency ids the tier cards own: the first currency carrying each TIERS background, through
   EventShop.currencyForTier — the single mapping rule. Snapshot currencies list in id-ascending
   order, so "first of its background" is exactly what the tier card shows. */
export function tierMappedIds(currencies) {
  const ids = new Set();
  for (const tier of TIERS) {
    const currency = EventShop.currencyForTier(currencies, tier);
    if (currency) ids.add(String(currency.id));
  }
  return ids;
}

/* A labelled box in the house shape: .material-input-box wrapping label + field. */
function labelledBox(labelText, input) {
  const box = DOMFactory.el("div", "material-input-box");
  const label = DOMFactory.el("label", "material-input-box-label", { for: input.id });
  label.textContent = labelText;
  box.replaceChildren(label, input);
  return box;
}

function planFigureBox(spec) {
  const input = DOMFactory.el("input", "material-input-box-field", {
    type: "number",
    id: `farm${spec.labelText}${spec.currency.id}`,
    min: "0",
    max: String(spec.schema.max),
    "aria-label": `${spec.currency.name} ${spec.labelText.toLowerCase()}`,
    inputmode: "numeric",
  });
  input.value = String(spec.value);
  /* Debounced write, the house input pattern (finding 7): typing reaches localStorage at most once
     per DEBOUNCE_MS. The clamp-on-read at Calculate never depends on this listener firing. */
  input.addEventListener(
    "input",
    debounce(() => {
      /* Detached input: timer pending across an Event Select switch; the stale value must not hit the new plan. */
      if (!input.isConnected) return;
      spec.write(input.value);
      spec.onWritten?.();
    }, DEBOUNCE_MS),
  );
  return labelledBox(spec.labelText, input);
}

/* The Held/Bonus pair of a currency no tier card owns. Writes go to EventPlanner keyed by this
   card's currency id — the same plan and clamps the tier boxes use. `onBonusChange` is the farm
   view's own line refresh (Amendment I): Bonus is the only figure a drop line reads, so only that
   box reports its writes; the pair is built here, and the callback comes from event-shop-farm.js
   rather than an import, which would close a cycle between the two farm modules. */
export function buildHeldBonusBoxes(currency, plan, onBonusChange = null) {
  const key = String(currency.id);
  const figures = [
    {
      labelText: "Held",
      schema: Schema.tier.Have,
      value: plan.held[key] || 0,
      write: (v) => EventPlanner.setHeld(key, v),
    },
    {
      labelText: "Bonus",
      schema: Schema.tier.Bonus,
      value: plan.bonus[key] || 0,
      write: (v) => EventPlanner.setBonus(key, v),
      onWritten: onBonusChange,
    },
  ];
  const fragment = document.createDocumentFragment();
  for (const figure of figures) fragment.appendChild(planFigureBox({ ...figure, currency }));
  return fragment;
}
