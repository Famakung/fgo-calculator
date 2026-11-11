import { EventShop } from "./domain.js";
import { fmt, buildCurrencyIcon, buildFilters, buildGroup, requireAriaLabel } from "./event-planner-parts.js";
import { DOMFactory } from "./presentation.js";

/* ===...=== Event Shop Planner (view) ===...=== */
/* Presentation layer for the Event Shop planner: builds and patches the #eventPlannerCard DOM
   from an EVENT_SHOP_DATA snapshot plus the app's { requires, filter } state, and reports every
   edit request through the handlers the app injects (onFilter + onEdit only — Amendment A moved
   Require entry into the currency modal). The view owns no state and caches no nodes — each
   function re-queries the card. updateTotals patches text/classes only; the read-only require
   numbers and their row labels are written in syncInputs alone. */

const TOKYO_DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Asia/Tokyo" });

function displayName(event) {
  const raw = event.shortName || event.name || "Event Shop";
  return raw.replace(/\n/g, " ").trim() || "Event Shop";
}

function windowText(event) {
  if (!event.startedAt || !event.endedAt) return "";
  const start = TOKYO_DATE.format(new Date(event.startedAt * 1000));
  const end = TOKYO_DATE.format(new Date(event.endedAt * 1000));
  return start + " – " + end;
}

function summaryChip(currency, totals) {
  const chip = DOMFactory.el("div", "eshop-summary-chip", {
    "data-currency": String(currency.id),
    "data-tier": currency.background || "silver",
  });
  const icon = buildCurrencyIcon(currency, "eshop-summary-icon");
  const name = DOMFactory.el("span", "eshop-summary-name");
  name.textContent = currency.name;
  const total = DOMFactory.el("span", "eshop-summary-total");
  total.textContent = "\u00d7" + fmt(totals[String(currency.id)] || 0);
  chip.replaceChildren(...(icon ? [icon, name, total] : [name, total]));
  return chip;
}

function emptyMessage() {
  const msg = DOMFactory.el("div", "eshop-empty");
  msg.textContent = "No event shop data yet \u2014 run npm run data:sync.";
  return msg;
}

function isEmpty(data) {
  return !data || !data.event || !data.items || data.items.length === 0;
}

/* Assign only when the text actually changes: the summary carries role="status", and rewriting
   identical strings on every debounced tick would re-announce the same totals to a screen reader
   and repaint nodes for no visible reason. */
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/* Same no-op-write rule as setText, for the row's accessible name: re-setting an identical
   aria-label re-announces the focused row on every commit. */
function setAriaLabel(el, label) {
  if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
}

export const EventPlannerView = {
  render(card, data, state, handlers) {
    const nameEl = card.querySelector("#eventPlannerEventName");
    const windowEl = card.querySelector("#eventPlannerWindow");
    const summaryEl = card.querySelector("#eventPlannerSummary");
    const controlsEl = card.querySelector("#eventPlannerControls");
    const listEl = card.querySelector("#eventPlannerList");

    if (isEmpty(data)) {
      nameEl.textContent = "Event Shop";
      windowEl.textContent = "";
      summaryEl.setAttribute("hidden", "");
      controlsEl.setAttribute("hidden", "");
      summaryEl.replaceChildren();
      controlsEl.replaceChildren();
      listEl.replaceChildren(emptyMessage());
      return;
    }

    const ctx = { state, handlers };
    nameEl.textContent = displayName(data.event);
    windowEl.textContent = windowText(data.event);
    summaryEl.removeAttribute("hidden");
    controlsEl.removeAttribute("hidden");
    const totals = EventShop.totals(data.items, state.requires);
    summaryEl.replaceChildren(...data.currencies.map((c) => summaryChip(c, totals)));
    controlsEl.replaceChildren(buildFilters(data, ctx));
    this.renderList(card, data, state, handlers);
  },

  renderList(card, data, state, handlers) {
    const listEl = card.querySelector("#eventPlannerList");
    if (isEmpty(data)) {
      listEl.replaceChildren(emptyMessage());
      return;
    }
    const ctx = { state, handlers };
    const totals = EventShop.totals(data.items, state.requires);
    const visibleCurrencies =
      state.filter === "all" ? data.currencies : data.currencies.filter((c) => String(c.id) === state.filter);
    const fragment = document.createDocumentFragment();
    for (const currency of visibleCurrencies) {
      const items = data.items.filter((item) => String(item.cost.itemId) === String(currency.id));
      if (items.length === 0) continue;
      fragment.appendChild(buildGroup(currency, items, totals[String(currency.id)] || 0, ctx));
    }
    listEl.replaceChildren(fragment);
  },

  updateTotals(card, data, state) {
    if (isEmpty(data)) return;
    const byId = new Map(data.items.map((item) => [String(item.id), item]));
    const totals = EventShop.totals(data.items, state.requires);
    for (const row of card.querySelectorAll(".eshop-item")) {
      const idKey = row.getAttribute("data-item-id");
      const item = byId.get(idKey);
      if (!item) continue;
      const require = state.requires[idKey] || 0;
      row.classList.toggle("eshop-item--active", require > 0);
      setText(row.querySelector(".eshop-item-total"), fmt(EventShop.rowCost(item, require)));
    }
    for (const chip of card.querySelectorAll(".eshop-summary-chip")) {
      setText(
        chip.querySelector(".eshop-summary-total"),
        "\u00d7" + fmt(totals[chip.getAttribute("data-currency")] || 0),
      );
    }
    for (const group of card.querySelectorAll(".eshop-group")) {
      setText(
        group.querySelector(".eshop-group-total"),
        "\u00d7" + fmt(totals[group.getAttribute("data-currency")] || 0),
      );
    }
  },

  /* Amendment A: a card row shows its require as read-only text, so a refresh writes that number
     and the row's aria-label (the row is the button that opens the modal). No input lives here —
     the draft steppers belong to EventShopModal, which patches its own rows. */
  syncInputs(card, state) {
    for (const display of card.querySelectorAll(".eshop-require-display")) {
      const require = state.requires[display.getAttribute("data-item-id")] || 0;
      setText(display, fmt(require));
      const row = display.closest(".eshop-item");
      const name = row?.querySelector(".eshop-item-name")?.textContent || "";
      if (row) setAriaLabel(row, requireAriaLabel(name, require));
    }
  },
};
