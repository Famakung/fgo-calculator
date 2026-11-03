import { ServantData, CEById } from "./data.js";
import { ServantComboCalculator, Validator } from "./domain.js";
import { CEFILTER_STORAGE_KEY } from "./constants.js";
import { DOMFactory } from "./presentation.js";
import { ServantSelector } from "./selectors.js";

const MAX_INITIAL_CARDS = 60;
const CARDS_PER_PAGE = 60;

/* ============================================
   SERVENT SELECT SUB-TAB (inside the CE Filter tab)
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
    this.state.visibleCards = MAX_INITIAL_CARDS;
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

  /* Same key CE Filter has always declared and never read; only the pick list survives a refresh —
     the sub-tab choice and the visible-card count still reset. */
  _savePicks() {
    try {
      localStorage.setItem(CEFILTER_STORAGE_KEY, JSON.stringify({ servantPicks: this.state.pickedIds }));
    } catch (_e) {
      /* ignore */
    }
  },

  _loadPicks() {
    let raw;
    try {
      raw = localStorage.getItem(CEFILTER_STORAGE_KEY);
    } catch (_e) {
      return [];
    }
    if (!raw) return [];
    let picks;
    try {
      picks = Validator.validateServantPicks(JSON.parse(raw).servantPicks);
    } catch (_e) {
      return [];
    }
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

  render() {
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

  /* One card per servant group, twice the width of a CE Select card: the shared CEs are the
     main row at portrait size, the servants that all share them are the badge row below.
     Names stay off the card — the portraits are the content, and title/alt carry the name. */
  _buildCard(group) {
    const card = DOMFactory.el("div", ["cefilter-servant-card", "cefilter-combo-card"]);

    const ceRow = DOMFactory.el("div", ["ce-badges", "cefilter-combo-ce-row"]);
    group.ceIds.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;
      const cell = DOMFactory.el("button", "cefilter-combo-ce", {
        type: "button",
        "aria-label": `Select ${ce.name} in Craft Essence Select`,
        title: ce.name,
      });
      const img = DOMFactory.createLazyImg(ce.thumbImage, "cefilter-combo-ce-img", { alt: ce.name, title: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      cell.appendChild(img);
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deps?.onSelectCE?.(ceId);
      });
      ceRow.appendChild(cell);
    });
    card.appendChild(ceRow);

    const servantRow = DOMFactory.el("div", ["ce-badges", "cefilter-combo-servant-row"]);
    const rowCEs = group.ceIds.map((ceId) => CEById.get(ceId)).filter(Boolean);
    group.members.forEach((entry) => {
      if (!entry || !entry.servant) return;
      servantRow.appendChild(this._buildServantCell(entry, rowCEs));
    });
    card.appendChild(servantRow);

    return card;
  },

  /* One badge per ascension group, portraited like that group's own card in Craft Essence Select,
     so a servant whose forms match different CEs shows both forms here. Image only: the ascension
     names live in the badge's title/alt, never as text under the portrait. */
  _buildServantCell(entry, rowCEs) {
    const servant = entry.servant;
    const matchedAscensions = entry.matchedAscensions || [];
    const imgAsc =
      !entry.baseMatchesAll && matchedAscensions.length > 0 ? entry.primaryAscension || matchedAscensions[0] : null;
    const imgSrc = imgAsc ? ServantData.getImageForAscension(servant.id, imgAsc) : servant.image;

    const labelParts = matchedAscensions.map((key) => ServantData.getAscensionLabel(servant.id, key));
    const spiritronLabel = ServantData.getSpiritronLabel(servant.id, rowCEs, matchedAscensions, entry.baseMatchesAll);
    if (spiritronLabel) labelParts.push(spiritronLabel);

    const displayName = imgAsc ? ServantData.getAscensionName(servant.id, imgAsc) || servant.name : servant.name;
    const name = labelParts.length > 0 ? `${displayName} (${labelParts.join(", ")})` : displayName;

    const cell = DOMFactory.el("div", "cefilter-combo-servant");
    const img = DOMFactory.createLazyImg(imgSrc, ["cefilter-match-badge", "cefilter-combo-servant-badge"], {
      alt: name,
      title: name,
    });
    DOMFactory.addAscensionFallback(img, servant.id);
    cell.appendChild(img);

    return cell;
  },

  _paintNotes(groupCount, unshared, truncated) {
    const empty = document.getElementById("cefilterComboEmpty");
    if (empty) {
      const show = this.state.pickedIds.length > 0 && groupCount === 0;
      empty.hidden = !show;
      empty.textContent = show ? "No CE is usable by two or more of these servants." : "";
    }

    const unsharedEl = document.getElementById("cefilterComboUnshared");
    if (unsharedEl) {
      unsharedEl.hidden = unshared.length === 0;
      unsharedEl.textContent =
        unshared.length > 0 ? `No shared CE with: ${unshared.map((id) => this._nameOf(id)).join(", ")}` : "";
    }

    const truncatedEl = document.getElementById("cefilterComboTruncated");
    if (truncatedEl) {
      truncatedEl.hidden = !truncated;
    }
  },
};
