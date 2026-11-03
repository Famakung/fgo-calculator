import { ServantData, CEById } from "./data.js";
import { ServantComboCalculator } from "./domain.js";
import { DOMFactory } from "./presentation.js";
import { ServantSelector } from "./selectors.js";

const VISIBLE_PER_BUCKET = 5;
const MAX_INITIAL_ROWS = 60;

/* ============================================
   SERVENT SELECT SUB-TAB (inside the CE Filter tab)
   ============================================ */
export const ServantSelect = {
  state: {
    pickedIds: [],
  },

  _deps: null,
  _initialized: false,

  init(deps) {
    if (this._initialized) return;
    this._initialized = true;
    this._deps = deps || {};

    const addBtn = document.getElementById("cefilterServantAddBtn");
    const clearBtn = document.getElementById("cefilterServantClearBtn");

    if (addBtn) {
      addBtn.addEventListener("click", () => {
        ServantSelector.open(
          0,
          false,
          { onSelect: (slotIndex, id) => this.addServant(id) },
          { skipAscension: true },
        );
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => this.clearPicked());
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

  clearPicked() {
    if (this.state.pickedIds.length === 0) return;
    this.state.pickedIds = [];
    this.renderChips();
    this.render();
  },

  _nameOf(id) {
    const servant = ServantData.getServant(id);
    return servant ? servant.name : id;
  },

  renderChips() {
    const count = document.getElementById("cefilterServantCount");
    if (count) count.textContent = `Servants (${this.state.pickedIds.length})`;

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

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this._paintResults(groups);
        this._paintNotes(groups.length, unshared, truncated);
      });
    });
  },

  _paintResults(groups) {
    const container = document.getElementById("cefilterComboResults");
    if (!container) return;

    // Bucket by CE count, keeping the calculator's descending order. A CE count with no rows
    // never gets a bucket, so an empty section can never print.
    const buckets = new Map();
    groups.forEach((group) => {
      const size = group.ceIds.length;
      if (!buckets.has(size)) buckets.set(size, []);
      buckets.get(size).push(group);
    });

    const frag = document.createDocumentFragment();
    let built = 0;
    buckets.forEach((rows, size) => {
      const section = DOMFactory.el("div", "cefilter-combo-bucket");
      const header = DOMFactory.el("h3", "cefilter-combo-size");
      header.textContent = `${size} CE · ${rows.length} ${rows.length === 1 ? "group" : "groups"}`;
      section.appendChild(header);

      const room = Math.min(VISIBLE_PER_BUCKET, Math.max(0, MAX_INITIAL_ROWS - built));
      const shown = rows.slice(0, room);
      const hidden = rows.slice(room);
      shown.forEach((group) => {
        section.appendChild(this._buildGroup(group));
        built += 1;
      });

      if (hidden.length > 0) section.appendChild(this._buildMoreButton(hidden));
      frag.appendChild(section);
    });

    container.replaceChildren(frag);
  },

  _buildMoreButton(hidden) {
    const btn = DOMFactory.el("button", "cefilter-combo-more", { type: "button", "aria-expanded": "false" });
    btn.textContent = `Show ${hidden.length} more`;
    btn.addEventListener("click", () => {
      const section = btn.parentElement;
      hidden.forEach((group) => section.insertBefore(this._buildGroup(group), btn));
      btn.remove();
    });
    return btn;
  },

  _buildGroup(group) {
    const row = DOMFactory.el("div", "cefilter-combo-group");
    const ceLine = DOMFactory.el("div", "cefilter-combo-ce-list");

    group.ceIds.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;
      const chip = DOMFactory.el("button", "cefilter-combo-ce", {
        type: "button",
        title: ce.name,
        "aria-label": `Select ${ce.name} in Craft Essence Select`,
      });
      const img = DOMFactory.createLazyImg(ce.thumbImage, "cefilter-combo-ce-img", { alt: ce.name, title: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-combo-ce-fallback", ce.id);
      const label = DOMFactory.el("span", "cefilter-combo-ce-name");
      label.textContent = ce.name;
      chip.appendChild(img);
      chip.appendChild(label);
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deps?.onSelectCE?.(ceId);
      });
      ceLine.appendChild(chip);
    });

    row.appendChild(ceLine);

    const servants = DOMFactory.el("div", "cefilter-combo-servants");
    servants.textContent = group.servantIds.map((id) => this._nameOf(id)).join(", ");
    row.appendChild(servants);
    return row;
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
