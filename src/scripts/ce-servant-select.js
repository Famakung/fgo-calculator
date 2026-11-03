import { ServantData } from "./data.js";
import { DOMFactory } from "./presentation.js";
import { ServantSelector } from "./selectors.js";

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

  /* Filled in by Task 4: the shared-CE rows. */
  render() {},
};
