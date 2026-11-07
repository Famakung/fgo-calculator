import { ServantData } from "./data.js";
import { ServantComboCalculator, Validator } from "./domain.js";
import { CEFILTER_STORAGE_KEY } from "./constants.js";
import { DOMFactory, ComboCardRenderer } from "./presentation.js";
import { ServantSelector } from "./selectors.js";

/* ============================================
   BOND GAIN CE SUB-TAB STORE
   ============================================ */

/* Both Bond Gain CE sub-tabs share the one key, so every write is read-modify-write: a blind
   setItem of a single field erases the other sub-tab's picks on the next refresh. Lives here
   rather than in ce-filter-app.js because ServantSelect already owns the key and CEFilterApp
   imports this module, not the other way round. */
export const CEFilterStore = {
  read() {
    let raw;
    try {
      raw = localStorage.getItem(CEFILTER_STORAGE_KEY);
    } catch (_e) {
      return {};
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_e) {
      return {};
    }
  },

  write(patch) {
    try {
      localStorage.setItem(CEFILTER_STORAGE_KEY, JSON.stringify({ ...CEFilterStore.read(), ...patch }));
    } catch (_e) {
      /* private mode / quota — nothing to recover */
    }
  },
};

/* ============================================
   SERVENT SELECT SUB-TAB (inside the Bond Gain CE tab)
   ============================================ */
export const ServantSelect = {
  state: {
    pickedIds: [],
    currentPage: 1,
  },

  _deps: null,
  _initialized: false,
  _lastGroups: [],

  _bindEvents() {
    const addBtn = document.getElementById("cefilterServantAddBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        ServantSelector.open(
          0,
          false,
          { onApply: (ids) => this.setServants(ids) },
          { skipAscension: true, multi: true, selected: this.state.pickedIds },
        );
      });
    }
    const clearBtn = document.getElementById("cefilterServantClearBtn");
    if (clearBtn) clearBtn.addEventListener("click", () => this.clearAll());
  },

  init(deps) {
    if (this._initialized) return;
    this._initialized = true;
    this._deps = deps || {};
    ServantSelector.init();
    this._bindEvents();
    this.state.pickedIds = this._loadPicks();
    this.renderChips();
  },

  setServants(ids) {
    this.state.pickedIds = [...new Set((ids || []).filter(Boolean))];
    this.renderChips();
    this._savePicks();
    this.render();
  },

  addServant(id) {
    if (!id || this.state.pickedIds.includes(id)) return;
    this.state.pickedIds.push(id);
    this.renderChips();
    this._savePicks();
    this.render();
  },

  /* Bulk empty of the pick list. A blind label would hide how much is about to go, so the button
     carries the count; the row count resets so the next pick starts on the first page. */
  clearAll() {
    if (this.state.pickedIds.length === 0) return;
    this.state.pickedIds = [];
    this.renderChips();
    this._savePicks();
    this.render();
  },

  removeServant(id) {
    this.state.pickedIds = this.state.pickedIds.filter((picked) => picked !== id);
    this.renderChips();
    this._savePicks();
    this.render();
  },

  /* Only the pick list survives a refresh here: the sub-tab choice and the visible-card count
     still reset. Both sub-tabs share one key, so writes go through CEFilterStore. */
  _savePicks() {
    CEFilterStore.write({ servantPicks: this.state.pickedIds });
  },

  _loadPicks() {
    const raw = CEFilterStore.read().servantPicks;
    const migrated = Array.isArray(raw) ? raw.map((id) => ServantData.migrateId(id)) : [];
    return Validator.validatePicks(migrated).filter((id) => ServantData.getServant(id) != null);
  },

  _nameOf(id) {
    const servant = ServantData.getServant(id);
    return servant ? servant.name : id;
  },

  _buildChipImg(servant, id) {
    const title = servant.altName ? `${servant.name} / ${servant.altName}` : servant.name;
    if (servant.altImage) {
      return DOMFactory.createSwapImg({
        src: servant.image,
        altSrc: servant.altImage,
        attrs: { alt: servant.name, title },
        fallbackId: id,
      });
    }
    const imgEl = DOMFactory.createLazyImg(servant.image, null, { alt: servant.name, title });
    DOMFactory.addAscensionFallback(imgEl, id);
    return imgEl;
  },

  _buildChip(id) {
    const servant = ServantData.getServant(id);
    if (!servant) return null;
    const chip = DOMFactory.el("div", ["cefilter-chip", "flex-row"]);
    chip.appendChild(this._buildChipImg(servant, id));
    const removeBtn = DOMFactory.el("button", ["cefilter-chip-remove", "flex-row"], {
      type: "button",
      "aria-label": `Remove ${servant.name}`,
    });
    removeBtn.textContent = "\u2715";
    removeBtn.addEventListener("click", () => this.removeServant(id));
    chip.appendChild(removeBtn);
    return chip;
  },

  /* Same chip as the CE side builds under Add Craft Essence, minus the visible name. */
  renderChips() {
    const container = document.getElementById("cefilterServantChips");
    if (!container) return;
    const clearBtn = document.getElementById("cefilterServantClearBtn");
    if (clearBtn) {
      const count = this.state.pickedIds.length;
      clearBtn.hidden = count === 0;
      clearBtn.textContent = count > 0 ? `Clear all (${count})` : "Clear all";
    }
    const frag = document.createDocumentFragment();
    this.state.pickedIds.forEach((id) => {
      const chip = this._buildChip(id);
      if (chip) frag.appendChild(chip);
    });
    container.replaceChildren(frag);
  },

  _getCols() {
    const wrapper = document.getElementById("cefilterComboResults");
    const cw = wrapper ? wrapper.clientWidth : 0;
    if (cw > 16) return Math.max(1, Math.floor((cw - 16 + 8) / (280 + 8)));
    const w = typeof window !== "undefined" ? window.innerWidth : 1120;
    return w >= 940 ? 3 : w >= 660 ? 2 : 1;
  },

  _getPageSize() {
    return this._getCols() * 5;
  },

  _effectivePickedIds(entries) {
    if (this.state.pickedIds.length > 0) return this.state.pickedIds;
    return [...new Set((entries || []).map((e) => e?.servant?.id).filter(Boolean))];
  },

  /* Called whenever the pick list changes or the sub-tab is entered, so the visible-row count
     restarts here: a counter left over from a 60-row list would start a fresh pick deep in it. */
  render() {
    this.state.currentPage = 1;
    const entries = this._deps?.getEntries?.() || [];
    const effectiveIds = this._effectivePickedIds(entries);
    const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, effectiveIds);
    this._lastGroups = groups;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._paintResults();
        this._paintNotes(groups.length, unshared, truncated);
      });
    });
  },

  _buildGrid(shown) {
    const grid = DOMFactory.el("div", "cefilter-combo-grid");
    shown.forEach((group) => grid.appendChild(this._buildCard(group)));
    return grid;
  },

  _paintResults() {
    const wrapper = document.getElementById("cefilterComboResults");
    if (!wrapper) return;
    const groups = this._lastGroups || [];
    if (groups.length === 0) {
      wrapper.replaceChildren();
      this._renderPagination(0);
      return;
    }
    const pageSize = this._getPageSize();
    const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
    if (this.state.currentPage > totalPages) this.state.currentPage = totalPages;
    const start = (this.state.currentPage - 1) * pageSize;
    wrapper.replaceChildren(this._buildGrid(groups.slice(start, start + pageSize)));
    this._renderPagination(totalPages);
  },

  _buildCard(group) {
    return ComboCardRenderer.buildCard(group, {
      onSelectCE: (ceId) => this._deps?.onSelectCE?.(ceId),
    });
  },

  _createPageBtn({ label, ariaLabel, disabled, onClick }) {
    const btn = DOMFactory.el("button", "cefilter-page-btn", { type: "button", "aria-label": ariaLabel });
    btn.textContent = label;
    if (disabled) {
      btn.disabled = true;
    } else if (onClick) {
      btn.addEventListener("click", onClick);
    }
    return btn;
  },

  _changePage(delta) {
    this.state.currentPage += delta;
    this._paintResults();
  },

  _buildPaginationFrag(cur, totalPages) {
    const frag = document.createDocumentFragment();
    const btnCfg = (label, ariaLabel, disabled, delta) =>
      this._createPageBtn({ label, ariaLabel, disabled, onClick: () => this._changePage(delta) });
    frag.appendChild(btnCfg("\u2039", "Previous page", cur <= 1, -1));
    const ind = DOMFactory.el("span", "cefilter-page-indicator");
    ind.textContent = `${cur} / ${totalPages}`;
    frag.appendChild(ind);
    frag.appendChild(btnCfg("\u203a", "Next page", cur >= totalPages, 1));
    return frag;
  },

  _renderPagination(totalPages) {
    ["cefilterComboPaginationTop", "cefilterComboPaginationBottom"].forEach((id) => {
      const container = document.getElementById(id);
      if (!container) return;
      if (totalPages <= 0) {
        container.replaceChildren();
        container.hidden = true;
        return;
      }
      container.hidden = false;
      container.replaceChildren(this._buildPaginationFrag(this.state.currentPage, totalPages));
    });
  },

  _getEmptyNote(picked, groupCount, truncated) {
    if (picked === 1) return "Add one more servant to see which Craft Essences they share.";
    if (groupCount > 0 || truncated) return "";
    return picked === 0
      ? "No CE is usable by two or more servants."
      : "No CE is usable by two or more of these servants.";
  },

  _paintUnsharedNote(unshared, picked) {
    const el = document.getElementById("cefilterComboUnshared");
    if (!el) return;
    const show = unshared.length > 0 && picked >= 2;
    el.hidden = !show;
    el.textContent = show ? `No shared CE with: ${unshared.map((id) => this._nameOf(id)).join(", ")}` : "";
  },

  _paintNotes(groupCount, unshared, truncated) {
    const picked = this.state.pickedIds.length;
    const empty = document.getElementById("cefilterComboEmpty");
    if (empty) {
      const note = this._getEmptyNote(picked, groupCount, truncated);
      empty.textContent = note;
      empty.hidden = note === "";
    }
    this._paintUnsharedNote(unshared, picked);
    const truncatedEl = document.getElementById("cefilterComboTruncated");
    if (truncatedEl) truncatedEl.hidden = !truncated;
  },
};
