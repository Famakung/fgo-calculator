import { IMAGE_VERSION } from "./constants.js";
import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";

/* DOM builders for the Event Shop currency modal's draft rows. Amendment B removed the planner
   card, so everything exported here serves EventShopModal: buildDraftRow is the public entry and
   fmt its number voice. Nothing else is imported from outside this module. */

/* One number voice for the whole shop UI: en-US grouping, thin-space-free, predictable. */
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

function buildInfo(item, currency) {
  const name = DOMFactory.el("div", "eshop-item-name", { title: item.name });
  name.textContent = item.name;
  const meta = DOMFactory.el("div", "eshop-item-meta");
  meta.textContent = metaText(item, currency);
  const info = DOMFactory.el("div", "eshop-item-info");
  info.replaceChildren(name, meta);
  return info;
}

function stepButton(item, delta, handlers) {
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

function buildStepper(item, require, handlers) {
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

/* Draft rows are icon | name+meta | require cell | subtotal, one skeleton so every row carries
   identical geometry; the require cell is supplied by the caller. */
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

/* Modal draft row: the stepper lives here and nowhere else. ctx.state.requires is the draft, so
   EventShopModal can patch one row's value and subtotal through .eshop-item[data-item-id]. */
export function buildDraftRow(item, currency, ctx) {
  const require = ctx.state.requires[String(item.id)] || 0;
  return rowShell(item, currency, require, buildStepper(item, require, ctx.handlers));
}
