import { ServantData, CEById } from "./data.js";
import { ServantComboCalculator } from "./domain.js";
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
  },

  addServant(id) {
    if (!id || this.state.pickedIds.includes(id)) return;
    this.state.pickedIds.push(id);
    this.renderChips();
    this.render();
  },

  removeServant(id) {
    this.state.pickedIds = this.state.pickedIds.filter((picked) => picked !== id);
    this.renderChips();
    this.render();
  },

  _nameOf(id) {
    const servant = ServantData.getServant(id);
    return servant ? servant.name : id;
  },

  renderChips() {
    const container = document.getElementById("cefilterServantChips");
    if (!container) return;

    const frag = document.createDocumentFragment();
    this.state.pickedIds.forEach((id) => {
      const name = this._nameOf(id);
      const chip = DOMFactory.el("div", "cefilter-servant-chip");

      const servant = ServantData.getServant(id);
      const img = servant
        ? DOMFactory.createLazyImg(servant.image, "cefilter-servant-chip-img", { alt: name })
        : DOMFactory.el("div", "cefilter-servant-chip-img");
      if (servant) DOMFactory.addAscensionFallback(img, id);
      chip.appendChild(img);

      const label = DOMFactory.el("span", "cefilter-servant-chip-name");
      label.textContent = name;
      chip.appendChild(label);

      const remove = DOMFactory.el("button", "cefilter-servant-chip-remove", {
        type: "button",
        "aria-label": `Remove ${name}`,
      });
      remove.textContent = "×";
      remove.addEventListener("click", () => this.removeServant(id));
      chip.appendChild(remove);

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

    const grid = DOMFactory.el("div", ["cefilter-results-grid", "grid"]);
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

  /* One card per servant group, on the CE Select card grid: the shared CEs are the main
     row, the servants that all share them are the badge row below. */
  _buildCard(group) {
    const card = DOMFactory.el("div", ["cefilter-servant-card", "cefilter-combo-card"]);

    const ceRow = DOMFactory.el("div", ["ce-badges", "grid-micro"]);
    group.ceIds.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;
      const cell = DOMFactory.el("button", "cefilter-combo-ce", {
        type: "button",
        "aria-label": `Select ${ce.name} in Craft Essence Select`,
      });
      const img = DOMFactory.createLazyImg(ce.thumbImage, "cefilter-match-badge", { alt: ce.name, title: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      const name = DOMFactory.el("span", "cefilter-combo-ce-name");
      name.textContent = ce.name;
      cell.appendChild(img);
      cell.appendChild(name);
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deps?.onSelectCE?.(ceId);
      });
      ceRow.appendChild(cell);
    });
    card.appendChild(ceRow);

    const caption = DOMFactory.el("div", "cefilter-combo-caption");
    caption.textContent = `${group.ceIds.length} CE shared`;
    card.appendChild(caption);

    const servantRow = DOMFactory.el("div", ["ce-badges", "grid-micro"]);
    group.servantIds.forEach((id) => {
      const servant = ServantData.getServant(id);
      if (!servant) return;
      const img = DOMFactory.createLazyImg(servant.image, ["cefilter-match-badge", "cefilter-combo-servant-badge"], {
        alt: servant.name,
        title: servant.name,
      });
      DOMFactory.addAscensionFallback(img, id);
      servantRow.appendChild(img);
    });
    card.appendChild(servantRow);

    return card;
  },

  _paintNotes(groupCount, unshared, truncated) {
    const count = document.getElementById("cefilterComboCount");
    if (count) {
      count.textContent =
        this.state.pickedIds.length === 0 ? "" : `${groupCount} ${groupCount === 1 ? "group" : "groups"}`;
    }

    const empty = document.getElementById("cefilterComboEmpty");
    if (empty) {
      const show = this.state.pickedIds.length > 0 && groupCount === 0;
      empty.hidden = !show;
      if (show) empty.textContent = "No CE is usable by two or more of these servants.";
    }

    const unsharedEl = document.getElementById("cefilterComboUnshared");
    if (unsharedEl) {
      unsharedEl.hidden = unshared.length === 0;
      if (unshared.length > 0) {
        unsharedEl.textContent = `No shared CE with: ${unshared.map((id) => this._nameOf(id)).join(", ")}`;
      }
    }

    const truncatedEl = document.getElementById("cefilterComboTruncated");
    if (truncatedEl) {
      truncatedEl.hidden = !truncated;
    }
  },
};
