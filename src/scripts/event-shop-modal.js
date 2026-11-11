import { EVENT_SHOP_DATA } from "./data/event_shop.js";
import { EventShop } from "./domain.js";
import { buildDraftRow, fmt } from "./event-planner-parts.js";

/* ===...=== Event Shop currency modal (draft editor) ===...=== */
/* House modal controller (selectors.js pattern): the player edits a throwaway draft of ONE
   currency's shop rows and nothing published survives unless Done commits it. App wiring arrives
   through configure() callbacks so this module never imports an app — planner and tier code import
   it, never the other way. Draft edits patch the touched row in place (stepper value + subtotal);
   rows are never rebuilt mid-typing, so focus survives every keystroke. buildDraftRow is the
   parts-module row builder for draft state, ctx = { state: { requires }, handlers }. */

const MODAL_ELEMENT_ID = "eventShopModal";
const LIST_ELEMENT_ID = "eventShopModalList";

export const EventShopModal = {
  _config: null,
  _bound: false,
  _currency: null,
  _items: [],
  _draft: {},

  configure(config) {
    this._config = config;
    this._bindChrome();
  },

  open(currencyId) {
    const modal = document.getElementById(MODAL_ELEMENT_ID);
    const list = document.getElementById(LIST_ELEMENT_ID);
    if (!modal || !list || !this._config) return;
    this._currency = this._findCurrency(currencyId);
    if (!this._currency) return;
    this._items = this._config.itemsOf(this._currency.id) || [];
    this._draft = this._cloneDraft();
    this._setTitle();
    this._renderRows(list);
    modal.classList.add("open");
  },

  close() {
    const modal = document.getElementById(MODAL_ELEMENT_ID);
    if (modal) modal.classList.remove("open");
    this._currency = null;
    this._items = [];
    this._draft = {};
  },

  _findCurrency(currencyId) {
    const currencies = (EVENT_SHOP_DATA && EVENT_SHOP_DATA.currencies) || [];
    return currencies.find((currency) => String(currency.id) === String(currencyId)) || null;
  },

  /* The draft mirrors only this currency's rows: Cancel then leaves the planner's stored requires
     byte-identical, keys and all. */
  _cloneDraft() {
    const requires = this._config.requiresOf() || {};
    const draft = {};
    for (const item of this._items) draft[String(item.id)] = requires[String(item.id)] || 0;
    return draft;
  },

  _setTitle() {
    const title = document.getElementById("eventShopModalTitle");
    if (title) title.textContent = this._currency.name + " \u2014 Shop Items";
  },

  _renderRows(list) {
    const ctx = { state: { requires: this._draft }, handlers: this._draftHandlers() };
    const fragment = document.createDocumentFragment();
    for (const item of this._items) fragment.appendChild(buildDraftRow(item, this._currency, ctx));
    list.replaceChildren(fragment);
  },

  _draftHandlers() {
    return {
      onRequire: (itemId, rawValue) => this._onRequire(itemId, rawValue),
      onStep: (itemId, delta) => this._onStep(itemId, delta),
    };
  },

  /* Typed values: the box keeps the player's keystrokes (no write-back = no focus or caret loss),
     the draft takes the clamped number and the subtotal follows live. */
  _onRequire(itemId, rawValue) {
    this._setDraft(itemId, rawValue);
    this._syncRowTotal(itemId);
  },

  _onStep(itemId, delta) {
    const key = String(itemId);
    this._setDraft(key, (this._draft[key] || 0) + delta);
    this._syncRowValue(key);
  },

  _setDraft(itemId, value) {
    const item = this._itemFor(itemId);
    if (!item) return;
    this._draft[String(item.id)] = EventShop.clampRequire(item, value);
  },

  _itemFor(itemId) {
    return this._items.find((item) => String(item.id) === String(itemId)) || null;
  },

  _rowNodes(itemId) {
    const selector = `.eshop-item[data-item-id="${String(itemId)}"]`;
    const row = document.getElementById(LIST_ELEMENT_ID)?.querySelector(selector);
    if (!row) return null;
    return { row, input: row.querySelector(".eshop-require-input"), total: row.querySelector(".eshop-item-total") };
  },

  _syncRowTotal(itemId) {
    const nodes = this._rowNodes(itemId);
    if (nodes) this._paintRow(nodes, itemId, this._draft[String(itemId)] || 0);
  },

  _syncRowValue(itemId) {
    const nodes = this._rowNodes(itemId);
    if (!nodes) return;
    const value = this._draft[String(itemId)] || 0;
    if (nodes.input) nodes.input.value = String(value);
    this._paintRow(nodes, itemId, value);
  },

  _paintRow(nodes, itemId, value) {
    const item = this._itemFor(itemId);
    if (!item) return;
    if (nodes.total) nodes.total.textContent = fmt(EventShop.rowCost(item, value));
    nodes.row.classList.toggle("eshop-item--active", value > 0);
  },

  _zeroDraft() {
    const draft = {};
    for (const item of this._items) draft[String(item.id)] = 0;
    this._draft = draft;
    this._syncAllRows();
  },

  _buyOutDraft() {
    this._draft = EventShop.clearRequires(this._items);
    this._syncAllRows();
  },

  _syncAllRows() {
    for (const item of this._items) this._syncRowValue(String(item.id));
  },

  _commitDraft() {
    this._config.onCommit({ ...this._draft });
    this.close();
  },

  /* Static markup holds the footer; ✕, Cancel, backdrop mousedown and Escape all discard — only
     Done publishes. Bound once per page: the guard covers a re-configure, and a missing modal
     element (markup not shipped) simply leaves the module inert. */
  _bindChrome() {
    if (this._bound) return;
    const modal = document.getElementById(MODAL_ELEMENT_ID);
    if (!modal) return;
    this._bound = true;
    this._bindButton("eventShopModalClose", () => this.close());
    this._bindButton("eventShopModalCancelBtn", () => this.close());
    this._bindButton("eventShopModalDefaultBtn", () => this._zeroDraft());
    this._bindButton("eventShopModalSelectAllBtn", () => this._buyOutDraft());
    this._bindButton("eventShopModalDoneBtn", () => this._commitDraft());
    modal.addEventListener("mousedown", (e) => {
      if (e.target === modal) this.close();
    });
    document.addEventListener("keydown", (e) => this._onKeydown(e, modal));
  },

  _bindButton(id, handler) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", handler);
  },

  _onKeydown(e, modal) {
    if (e.key !== "Escape" || !modal.classList.contains("open")) return;
    this.close();
  },
};
