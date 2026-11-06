import { DOMFactory } from "./presentation.js";
import { ServantFilters } from "./domain.js";
import {
  CLASS_FILTERS,
  CLASS_GROUPS,
  RARITY_FILTERS,
  ALIGNMENT_LNC_FILTERS,
  ALIGNMENT_GBE_FILTERS,
  SUB_ATTR_FILTERS,
  GENDER_FILTERS,
} from "./constants.js";

/* ============================================
   FILTER SECTIONS (the Filter Settings modal rows)
   ============================================ */

/* The house chip control for every Filter Settings row. A div cannot say "this chip exists but you may
   not touch it", and the class row now has to say exactly that for every class outside the chosen group,
   so a chip is a button and carries aria-pressed, disabled and the --disabled class together. */
export const FilterSections = {
  /* `className` wins, then icon / group / count decide: the CE Bonus row counts numbers, not traits, and
     the house `ce-count-btn` box is the one that sizes it. */
  chipEl(chip, isActive, isDisabled, className, isWord) {
    const baseCls =
      className || (chip.icon ? "class-btn" : chip.count ? "ce-count-btn" : chip.group ? "ce-group-btn" : "rarity-btn");
    const wordModifier = !className && (isWord || chip.word) ? " rarity-btn--word" : "";
    const activeModifier = isActive ? " active" : "";
    const disabledModifier = isDisabled ? " " + baseCls + "--disabled" : "";
    const btn = DOMFactory.el("button", baseCls + wordModifier + activeModifier + disabledModifier, {
      type: "button",
      title: chip.label,
    });
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
      const value = chip.value !== undefined ? chip.value : chip.other ? ServantFilters.SUB_ALI_OTHER : chip.id;
      const isDisabled = opts.disabled ? opts.disabled(chip) : false;
      /* A greyed chip cannot be honoured — `ServantFilters.effectiveClassIds` drops a class pick outside the
         group, and a Grand Duel lock drops one outside its bound — so it must not press itself out. Kept in
         state, so leaving the group highlights it again; only the paint says "not in force right now". */
      const btn = this.chipEl(chip, isDisabled ? false : chosen.has(value), isDisabled, opts.className, opts.word);
      if (!isDisabled) {
        btn.addEventListener("click", () => {
          const nowActive = !chosen.has(value);
          if (nowActive) chosen.add(value);
          else chosen.delete(value);
          /* Paint the chip itself: a row is only rebuilt when something else asks for it, so the row
             cannot wait for a render to show what the click it just made actually did. */
          btn.classList.toggle("active", nowActive);
          btn.setAttribute("aria-pressed", String(nowActive));
          onToggle([...chosen]);
        });
      }
      frag.appendChild(btn);
    });
    container.replaceChildren(frag);
  },
};

/* ============================================
   FILTER MODAL CONTROLLER (shared modal lifecycle & row orchestration)
   ============================================ */
export const FilterModalController = {
  STANDARD_KEYS: [
    "rarityFilters",
    "classFilters",
    "groupClassFilters",
    "aliFilters",
    "subAliFilters",
    "subAttrFilters",
    "genderFilters",
  ],

  createInitial() {
    return {
      rarityFilters: [],
      classFilters: [],
      groupClassFilters: [],
      aliFilters: [],
      subAliFilters: [],
      subAttrFilters: [],
      genderFilters: [],
    };
  },

  clone(src = {}, extraKeys = []) {
    const res = {};
    [...this.STANDARD_KEYS, ...extraKeys].forEach((k) => {
      res[k] = Array.isArray(src[k]) ? [...src[k]] : [];
    });
    return res;
  },

  selectAll(avail = {}, extraHandler = null) {
    const hasRarity = (id) => !avail.rarity || avail.rarity.size === 0 || avail.rarity.has(id);
    const hasClass = (id) => !avail.class || avail.class.size === 0 || avail.class.has(id);
    const allClasses = [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra].map((c) => c.id);

    const res = {
      rarityFilters: RARITY_FILTERS.map((c) => c.id).filter(hasRarity),
      groupClassFilters: CLASS_GROUPS.map((g) => g.key),
      classFilters: allClasses.filter(hasClass),
      aliFilters: ALIGNMENT_LNC_FILTERS.map((c) => c.id),
      subAliFilters: ALIGNMENT_GBE_FILTERS.map((c) => (c.other ? ServantFilters.SUB_ALI_OTHER : c.id)),
      subAttrFilters: SUB_ATTR_FILTERS.map((c) => c.id),
      genderFilters: GENDER_FILTERS.map((c) => c.id),
    };
    if (extraHandler) extraHandler(res);
    return res;
  },

  renderStandardRows(prefix, filterState, toggle, opts = {}) {
    const scope = ServantFilters.rowScope(filterState.groupClassFilters, opts.lockedClasses);
    const hasRarity = opts.avail?.rarity
      ? (chip) => opts.avail.rarity.size === 0 || opts.avail.rarity.has(chip.id)
      : () => true;
    const hasClass = opts.avail?.class
      ? (chip) => opts.avail.class.size === 0 || opts.avail.class.has(chip.id)
      : () => true;

    FilterSections.renderRow(
      document.getElementById(`${prefix}RarityFilter`),
      RARITY_FILTERS,
      filterState.rarityFilters,
      toggle("rarityFilters"),
      { disabled: (chip) => !hasRarity(chip) },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}ClassFilter`),
      [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra],
      filterState.classFilters,
      toggle("classFilters"),
      { disabled: (chip) => !hasClass(chip) || (scope !== null && !scope.includes(chip.id)) },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}GroupFilter`),
      CLASS_GROUPS.map((g) => ({ id: g.key, label: g.label, group: true, classes: g.classes })),
      filterState.groupClassFilters,
      toggle("groupClassFilters"),
      {
        disabled: (chip) => Boolean(opts.lockedClasses) && !chip.classes.some((id) => opts.lockedClasses.includes(id)),
      },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}AliFilter`),
      ALIGNMENT_LNC_FILTERS,
      filterState.aliFilters,
      toggle("aliFilters"),
      { word: true },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}SubAliFilter`),
      ALIGNMENT_GBE_FILTERS,
      filterState.subAliFilters,
      toggle("subAliFilters"),
      { word: true },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}AttrFilter`),
      SUB_ATTR_FILTERS,
      filterState.subAttrFilters,
      toggle("subAttrFilters"),
      { word: true },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}GenderFilter`),
      GENDER_FILTERS,
      filterState.genderFilters,
      toggle("genderFilters"),
      { word: true },
    );
  },
};
