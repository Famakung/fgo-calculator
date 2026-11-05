import { DOMFactory } from "./presentation.js";
import { ServantFilters } from "./domain.js";

/* ============================================
   FILTER SECTIONS (the Filter Settings modal rows)
   ============================================ */

/* The house chip control for every Filter Settings row. A div cannot say "this chip exists but you may
   not touch it", and the class row now has to say exactly that for every class outside the chosen group,
   so a chip is a button and carries aria-pressed, disabled and the --disabled class together. */
export const FilterSections = {
  chipEl(chip, isActive, isDisabled) {
    const cls = chip.icon ? "class-btn" : chip.count ? "ce-count-btn" : chip.group ? "ce-group-btn" : "rarity-btn";
    const btn = DOMFactory.el(
      "button",
      cls + (isActive ? " active" : "") + (isDisabled ? " " + cls + "--disabled" : ""),
      {
        type: "button",
        title: chip.label,
      },
    );
    btn.setAttribute("aria-pressed", String(isActive));
    btn.dataset.traitId = chip.id === null || chip.id === undefined ? String(chip.value) : chip.id;
    if (isDisabled) btn.disabled = true;
    if (chip.icon) {
      // src, never data-src: nothing promotes a deferred icon once the row sits inside a modal.
      btn.appendChild(
        DOMFactory.el("img", "", {
          src: `icons/classes/${chip.icon}.webp`,
          alt: chip.label,
        }),
      );
    } else {
      btn.textContent = chip.label;
    }
    return btn;
  },

  /* The row itself: emptied, refilled, and toggling any chip reports the whole new selection. `selected`
     is read from the caller's state, so a row rebuilt after a quest or a group change shows what is
     actually in force now — never what a previous render left behind. */
  renderRow(container, chips, selected, onToggle, opts = {}) {
    if (!container) return;
    const chosen = selected instanceof Set ? selected : new Set(selected || []);
    const frag = document.createDocumentFragment();
    chips.forEach((chip) => {
      const value = chip.other ? ServantFilters.SUB_ALI_OTHER : chip.id;
      const isDisabled = opts.disabled ? opts.disabled(chip) : false;
      const btn = this.chipEl(chip, chosen.has(value), isDisabled);
      if (!isDisabled) {
        btn.addEventListener("click", () => {
          if (chosen.has(value)) chosen.delete(value);
          else chosen.add(value);
          onToggle([...chosen]);
        });
      }
      frag.appendChild(btn);
    });
    container.replaceChildren(frag);
  },
};
