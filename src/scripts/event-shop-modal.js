import { EventShop } from "./domain.js";
import { DOMFactory } from "./presentation.js";
import { buildDraftRow, fmt } from "./event-planner-parts.js";

/* ===...=== Event Shop currency modal (draft editor) ===...=== */
/* House modal controller (selectors.js pattern): the player edits a throwaway draft of ONE
   currency's shop rows and nothing published survives unless Done commits it. App wiring arrives
   through configure() callbacks so this module never imports an app — planner and tier code import
   it, never the other way. Draft edits patch the touched row in place (stepper value + subtotal);
   rows are never rebuilt mid-typing, so focus survives every keystroke. buildDraftRow is the
   parts-module row builder for draft state, ctx = { state: { requires }, handlers }.
   Amendment G made the snapshot a list, so the currency is resolved through the wiring too: the
   modal edits the event the Event Select is on, not a module-level single event. */

const MODAL_ELEMENT_ID = "eventShopModal";
const LIST_ELEMENT_ID = "eventShopModalList";
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TEXT_INPUT_SELECTOR =
  'input[type="search"]:not([disabled]), input[type="text"]:not([disabled]), input:not([type]):not([disabled])';

function focusNoScroll(el) {
  if (!el || typeof el.focus !== "function") return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

function isVisibleFocusable(el) {
  if (!el || el.disabled) return false;
  if (el.hidden || el.closest?.("[hidden]")) return false;
  if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    const style = window.getComputedStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
}

function getFocusableElements(modal) {
  if (!modal || typeof modal.querySelectorAll !== "function") return [];
  return [...modal.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isVisibleFocusable);
}

function focusModalContainer(modal) {
  const container = modal?.querySelector?.(".servant-modal-content") || modal;
  if (!container) return;
  if (!container.hasAttribute?.("tabindex")) container.setAttribute?.("tabindex", "-1");
  focusNoScroll(container);
}

function focusModalInitial(modal) {
  if (!modal) return;
  const textInputs =
    typeof modal.querySelectorAll === "function"
      ? [...modal.querySelectorAll(TEXT_INPUT_SELECTOR)].filter(isVisibleFocusable)
      : [];
  if (textInputs.length > 0) {
    focusNoScroll(textInputs[0]);
    return;
  }
  const focusables = getFocusableElements(modal);
  if (focusables.length > 0) {
    focusNoScroll(focusables[0]);
    return;
  }
  focusModalContainer(modal);
}

function trapModalTab(e, modal) {
  const focusables = getFocusableElements(modal);
  if (focusables.length === 0) {
    e.preventDefault();
    focusModalContainer(modal);
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const inside = typeof modal.contains === "function" ? modal.contains(active) : false;
  if (e.shiftKey) {
    if (!inside || active === first || active === modal || active === modal.querySelector?.(".servant-modal-content")) {
      e.preventDefault();
      focusNoScroll(last);
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    focusNoScroll(first);
  }
}

export const EventShopModal = {
  _config: null,
  _bound: false,
  _currency: null,
  _items: [],
  _draft: {},
  _opener: null,

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
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== document.documentElement &&
      !(typeof modal.contains === "function" && modal.contains(active))
    ) {
      this._opener = active;
    }
    this._items = this._config.itemsOf(this._currency.id) || [];
    this._draft = this._cloneDraft();
    this._setTitle();
    this._renderRows(list);
    this._syncFooterButtons();
    list.scrollTop = 0;
    modal.classList.add("open");
    focusModalInitial(modal);
  },

  close() {
    const modal = document.getElementById(MODAL_ELEMENT_ID);
    if (modal) modal.classList.remove("open");
    const opener = this._opener;
    this._opener = null;
    this._currency = null;
    this._items = [];
    this._draft = {};
    if (opener && opener.isConnected !== false && !opener.disabled) {
      focusNoScroll(opener);
    }
  },

  _findCurrency(currencyId) {
    const currencies = this._config.currenciesOf() || [];
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

  _syncFooterButtons() {
    const empty = this._items.length === 0;
    for (const id of ["eventShopModalDefaultBtn", "eventShopModalSelectAllBtn"]) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = empty;
    }
  },

  _renderRows(list) {
    if (!this._items.length) {
      const empty = DOMFactory.el("div", "ceoverlap-empty");
      empty.textContent = "No shop items for this currency.";
      list.replaceChildren(empty);
      return;
    }
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
    const list = document.getElementById(LIST_ELEMENT_ID);
    if (!list) return null;
    const key = String(itemId);
    let row = null;
    if (
      typeof window !== "undefined" &&
      typeof window.CSS?.escape === "function" &&
      typeof list.querySelector === "function"
    ) {
      row = list.querySelector(`.eshop-item[data-item-id="${window.CSS.escape(key)}"]`);
    } else if (typeof list.querySelectorAll === "function") {
      row = [...list.querySelectorAll(".eshop-item")].find((el) => el.dataset?.itemId === key) || null;
    }
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

  /* Keep the modal open and preserve the draft if onCommit throws so errors stay visible and edits
     are not silently lost; Cancel/Close/Escape still close cleanly. */
  _commitDraft() {
    if (this._config?.onCommit) this._config.onCommit({ ...this._draft });
    this.close();
  },

  /* Static markup holds the footer; ✕, Cancel and Escape all discard — only OK publishes. Bound
     once per page: the guard covers a re-configure, and a missing modal element (markup not
     shipped) simply leaves the module inert. */
  _bindChrome() {
    if (this._bound) return;
    const modal = document.getElementById(MODAL_ELEMENT_ID);
    if (!modal) return;
    this._bound = true;
    this._bindButton("eventShopModalClose", () => this.close());
    this._bindButton("eventShopModalCancelBtn", () => this.close());
    this._bindButton("eventShopModalDefaultBtn", () => this._zeroDraft());
    this._bindButton("eventShopModalSelectAllBtn", () => this._buyOutDraft());
    this._bindButton("eventShopModalOkBtn", () => this._commitDraft());
    document.addEventListener("keydown", (e) => this._onKeydown(e, modal));
  },

  _bindButton(id, handler) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", handler);
  },

  _onKeydown(e, modal) {
    if (!modal.classList.contains("open")) return;
    if (e.key === "Escape") {
      this.close();
      return;
    }
    if (e.key === "Tab") {
      trapModalTab(e, modal);
    }
  },
};
