import { IMAGE_VERSION } from "./constants.js";
import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";

/* One number voice for the whole planner: en-US grouping, thin-space-free, predictable. */
export function fmt(value) {
  return Number(value).toLocaleString("en-US");
}

function iconUrl(path) {
  return path + "?v=" + IMAGE_VERSION;
}

function metaText(item, currency) {
  const parts = [currency.name + " \u00d7" + fmt(item.cost.amount)];
  parts.push(item.limitNum > 0 ? "Limit " + fmt(item.limitNum) : "Unlimited");
  if (item.setNum > 1) parts.push("\u00d7" + fmt(item.setNum) + " per buy");
  return parts.join(" \u00b7 ");
}

/* Currency icon at 24px, decorative next to its own name; null icon renders nothing. */
export function buildCurrencyIcon(currency, className) {
  if (!currency.icon) return null;
  const img = DOMFactory.createLazyImg(iconUrl(currency.icon), className, { alt: "" });
  DOMFactory.addSimpleFallback(img, "eshop-icon-fallback", "\u00d7");
  return img;
}

/* Row icon at 48px with the item name as alt; unresolved icons fall back to the id badge
   directly instead of firing a request for a null path. */
function buildRowIcon(item) {
  if (!item.icon) {
    const fb = DOMFactory.el("div", "eshop-item-icon-fallback");
    fb.textContent = String(item.id);
    return fb;
  }
  const img = DOMFactory.createLazyImg(iconUrl(item.icon), "eshop-item-icon", { alt: item.name });
  DOMFactory.addSimpleFallback(img, "eshop-item-icon-fallback", String(item.id));
  return img;
}

export function buildInfo(item, currency) {
  const name = DOMFactory.el("div", "eshop-item-name");
  name.textContent = item.name;
  const meta = DOMFactory.el("div", "eshop-item-meta");
  meta.textContent = metaText(item, currency);
  const info = DOMFactory.el("div", "eshop-item-info");
  info.replaceChildren(name, meta);
  return info;
}

export function stepButton(item, delta, handlers) {
  const btn = DOMFactory.el("button", "eshop-step-btn", {
    type: "button",
    "data-step": String(delta),
    "data-item-id": String(item.id),
    "aria-label": (delta < 0 ? "Decrease " : "Increase ") + item.name,
  });
  btn.textContent = delta < 0 ? "\u2212" : "+";
  btn.addEventListener("click", () => handlers.onStep(item.id, delta));
  return btn;
}

export function buildStepper(item, require, handlers) {
  const input = DOMFactory.el("input", "eshop-require-input", {
    type: "number",
    min: "0",
    max: String(EventShop.maxRequire(item)),
    "data-item-id": String(item.id),
    "aria-label": item.name + " require",
    inputmode: "numeric",
  });
  input.value = String(require);
  input.addEventListener("input", () => handlers.onRequire(item.id, input.value));

  const stepper = DOMFactory.el("div", "eshop-item-stepper");
  stepper.replaceChildren(stepButton(item, -1, handlers), input, stepButton(item, 1, handlers));
  return stepper;
}

/* Both row kinds are icon | name+meta | require cell | subtotal, so they share one skeleton and
   identical geometry: the card shows the number, the modal edits it. */
function rowShell(item, currency, require, requireCell) {
  const row = DOMFactory.el("div", "eshop-item" + (require > 0 ? " eshop-item--active" : ""), {
    "data-item-id": String(item.id),
  });

  const iconWrap = DOMFactory.el("div", "eshop-item-icon-wrap");
  iconWrap.appendChild(buildRowIcon(item));

  const total = DOMFactory.el("div", "eshop-item-total");
  total.textContent = fmt(EventShop.rowCost(item, require));

  row.replaceChildren(iconWrap, buildInfo(item, currency), requireCell, total);
  return row;
}

/* The card row IS the button that opens the currency modal, so its label carries the live number.
   Shared with EventPlannerView.syncInputs, which refreshes it after every commit. */
export function requireAriaLabel(name, require) {
  return name + ": require " + fmt(require) + ", edit";
}

/* Row children that need both live state and the app's callbacks travel together as one ctx
   object — keeps every builder at three params or fewer without restating the pair. */
export function buildRow(item, currency, ctx) {
  const idKey = String(item.id);
  const require = ctx.state.requires[idKey] || 0;

  const display = DOMFactory.el("span", "eshop-require-display", { "data-item-id": idKey });
  display.textContent = fmt(require);

  const row = rowShell(item, currency, require, display);
  row.classList.add("eshop-item--editable");
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-haspopup", "dialog");
  row.setAttribute("aria-label", requireAriaLabel(item.name, require));

  const open = () => ctx.handlers.onEdit(item.id);
  row.addEventListener("click", open);
  row.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    open();
  });
  return row;
}

/* Modal draft row: the stepper lives here and nowhere else. ctx.state.requires is the draft, so
   EventShopModal can patch one row's value and subtotal through .eshop-item[data-item-id]. */
export function buildDraftRow(item, currency, ctx) {
  const require = ctx.state.requires[String(item.id)] || 0;
  return rowShell(item, currency, require, buildStepper(item, require, ctx.handlers));
}

/* One .eshop-group per currency, ordered by data.currencies; header keeps its total even when
   the filter narrows the list to a single group. */
export function buildGroup(currency, items, total, ctx) {
  const group = DOMFactory.el("div", "eshop-group", {
    "data-currency": String(currency.id),
    "data-tier": currency.background || "silver",
  });

  const header = DOMFactory.el("div", "eshop-group-header");
  const icon = buildCurrencyIcon(currency, "eshop-group-icon");
  const name = DOMFactory.el("span", "eshop-group-name");
  name.textContent = currency.name;
  const totalEl = DOMFactory.el("span", "eshop-group-total");
  totalEl.textContent = "\u00d7" + fmt(total);
  header.replaceChildren(...(icon ? [icon, name, totalEl] : [name, totalEl]));

  group.appendChild(header);
  for (const item of items) group.appendChild(buildRow(item, currency, ctx));
  return group;
}

export function createFilterChip(entry, ctx, chips) {
  const active = ctx.state.filter === entry.key;
  const attrs = { type: "button", "data-filter": entry.key, "aria-pressed": String(active) };
  if (entry.tier) attrs["data-tier"] = entry.tier;
  const chip = DOMFactory.el("button", "eshop-filter-chip" + (active ? " eshop-filter-chip--active" : ""), attrs);
  chip.textContent = entry.label;
  chip.addEventListener("click", () => {
    for (const sibling of chips) {
      const pressed = sibling === chip;
      sibling.classList.toggle("eshop-filter-chip--active", pressed);
      sibling.setAttribute("aria-pressed", String(pressed));
    }
    ctx.handlers.onFilter(entry.key);
  });
  return chip;
}

export function buildFilters(data, ctx) {
  const filters = DOMFactory.el("div", "eshop-filters");
  const keys = [{ key: "all", label: "All", tier: null }].concat(
    data.currencies.map((c) => ({ key: String(c.id), label: c.name, tier: c.background || "silver" })),
  );
  const chips = [];
  for (const entry of keys) {
    const chip = createFilterChip(entry, ctx, chips);
    chips.push(chip);
    filters.appendChild(chip);
  }
  return filters;
}
