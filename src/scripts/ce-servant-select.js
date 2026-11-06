import { ServantData } from "./data.js";
import { ServantComboCalculator, Validator } from "./domain.js";
import { CEFILTER_STORAGE_KEY } from "./constants.js";
import { DOMFactory, ComboCardRenderer } from "./presentation.js";
import { ServantSelector } from "./selectors.js";

const MAX_INITIAL_CARDS = 60;
const CARDS_PER_PAGE = 60;

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
    visibleCards: MAX_INITIAL_CARDS,
  },

  _deps: null,
  _initialized: false,
  _lastGroups: [],

  init(deps) {
    if (this._initialized) return;
    this._initialized = true;
    this._deps = deps || {};

    // The modal's close button, backdrop click and Escape are bound here too: without the Bond
    // tab, nothing else ever called ServantSelector.init().
    ServantSelector.init();

    const addBtn = document.getElementById("cefilterServantAddBtn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        ServantSelector.open(
          0,
          false,
          {
            // Toggle in place, modal stays open — the same contract as the CE picker.
            onToggle: (slotIndex, id, selected) => (selected ? this.addServant(id) : this.removeServant(id)),
          },
          { skipAscension: true, multi: true, selected: this.state.pickedIds },
        );
      });
    }

    const clearBtn = document.getElementById("cefilterServantClearBtn");
    if (clearBtn) clearBtn.addEventListener("click", () => this.clearAll());

    this.state.pickedIds = this._loadPicks();
    this.renderChips();
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
    const picks = Validator.validatePicks(CEFilterStore.read().servantPicks);
    return picks.filter((id) => ServantData.getServant(id) != null);
  },

  _nameOf(id) {
    const servant = ServantData.getServant(id);
    return servant ? servant.name : id;
  },

  /* Same chip as the CE side builds under Add Craft Essence, minus the visible name. */
  renderChips() {
    const container = document.getElementById("cefilterServantChips");
    if (!container) return;
    container.replaceChildren();

    const clearBtn = document.getElementById("cefilterServantClearBtn");
    if (clearBtn) {
      const count = this.state.pickedIds.length;
      clearBtn.hidden = count === 0;
      clearBtn.textContent = count > 0 ? `Clear all (${count})` : "Clear all";
    }

    const frag = document.createDocumentFragment();
    this.state.pickedIds.forEach((id) => {
      const servant = ServantData.getServant(id);
      if (!servant) return;

      const chip = DOMFactory.el("div", ["cefilter-chip", "flex-row"]);

      const img = DOMFactory.createLazyImg(servant.image, null, { alt: servant.name });
      DOMFactory.addAscensionFallback(img, id);
      chip.appendChild(img);

      const removeBtn = DOMFactory.el("button", ["cefilter-chip-remove", "flex-row"], {
        type: "button",
        "aria-label": `Remove ${servant.name}`,
      });
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => this.removeServant(id));
      chip.appendChild(removeBtn);

      frag.appendChild(chip);
    });
    container.replaceChildren(frag);
  },

  /* Called whenever the pick list changes or the sub-tab is entered, so the visible-row count
     restarts here: a counter left over from a 60-row list would start a fresh pick deep in it.
     "Show N more" repaints through _paintResults() directly and is not affected. */
  render() {
    this.state.visibleCards = MAX_INITIAL_CARDS;
    const entries = this._deps?.getEntries?.() || [];
    const { groups, unshared, truncated } = ServantComboCalculator.buildSharedCEGroups(entries, this.state.pickedIds);
    this._lastGroups = groups;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._paintResults();
        this._paintNotes(groups.length, unshared, truncated);
      });
    });
  },

  _paintResults() {
    const wrapper = document.getElementById("cefilterComboResults");
    if (!wrapper) return;

    const groups = this._lastGroups;
    const shown = groups.slice(0, this.state.visibleCards);

    const grid = DOMFactory.el("div", "cefilter-combo-grid");
    shown.forEach((group) => grid.appendChild(this._buildCard(group)));

    const frag = document.createDocumentFragment();
    frag.appendChild(grid);

    const hidden = groups.length - shown.length;
    if (hidden > 0) {
      const btn = DOMFactory.el("button", "cefilter-combo-more", { type: "button", "aria-expanded": "false" });
      btn.textContent = `Show ${hidden} more`;
      btn.addEventListener("click", () => {
        this.state.visibleCards += CARDS_PER_PAGE;
        this._paintResults();
      });
      frag.appendChild(btn);
    }

    wrapper.replaceChildren(frag);
  },

  _buildCard(group) {
    return ComboCardRenderer.buildCard(group, {
      onSelectCE: (ceId) => this._deps?.onSelectCE?.(ceId),
    });
  },

  _paintNotes(groupCount, unshared, truncated) {
    const picked = this.state.pickedIds.length;

    const empty = document.getElementById("cefilterComboEmpty");
    if (empty) {
      /* One servant has nothing to share with yet, so below two picks this line says what to add
         instead of reporting an empty result — and it never leaves the card blank under its title.
         A truncated walk visited only part of the subset lattice, so zero rows prove nothing —
         the same reason buildSharedCEGroups names nobody as unshared when truncated. */
      const note =
        picked < 2
          ? picked === 0
            ? "Add two or more servants to see which Craft Essences they share."
            : "Add one more servant to see which Craft Essences they share."
          : groupCount === 0 && !truncated
            ? "No CE is usable by two or more of these servants."
            : "";
      empty.textContent = note;
      empty.hidden = note === "";
    }

    const unsharedEl = document.getElementById("cefilterComboUnshared");
    if (unsharedEl) {
      // Naming a servant as sharing nothing takes two to compare, so with fewer picks the list is noise.
      const showUnshared = unshared.length > 0 && picked >= 2;
      unsharedEl.hidden = !showUnshared;
      unsharedEl.textContent = showUnshared
        ? `No shared CE with: ${unshared.map((id) => this._nameOf(id)).join(", ")}`
        : "";
    }

    const truncatedEl = document.getElementById("cefilterComboTruncated");
    if (truncatedEl) {
      truncatedEl.hidden = !truncated;
    }
  },
};
