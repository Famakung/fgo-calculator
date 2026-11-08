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
  _setChipContent(btn, chip) {
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
  },

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
    this._setChipContent(btn, chip);
    return btn;
  },

  _buildRowBtn(chip, chosen, onToggle, opts) {
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
    return btn;
  },

  /* The row itself: emptied, refilled, and toggling any chip reports the whole new selection. `selected`
     is read from the caller's state, so a row rebuilt after a quest or a group change shows what is
     actually in force now — never what a previous render left behind. */
  renderRow(container, chips, selected, onToggle, opts = {}) {
    if (!container) return;
    const chosen = selected instanceof Set ? selected : new Set(selected || []);
    const frag = document.createDocumentFragment();
    chips.forEach((chip) => frag.appendChild(this._buildRowBtn(chip, chosen, onToggle, opts)));
    container.replaceChildren(frag);
  },
};

/* ============================================
   AVAILABILITY PREDICATES (shared between selectAll & renderStandardRows)
   ============================================ */
export function createAvailPredicates(avail = {}) {
  const hasId = (set, id) => !set || set.size === 0 || set.has(id);
  const getSubAliId = (chip) => (chip?.other ? ServantFilters.SUB_ALI_OTHER : (chip?.id ?? chip));
  return {
    hasRarity: (chip) => hasId(avail?.rarity, chip?.id ?? chip),
    hasClass: (chip) => hasId(avail?.class, chip?.id ?? chip),
    hasGroup: (chip) => !avail?.class || avail.class.size === 0 || chip.classes.some((id) => avail.class.has(id)),
    hasAli: (chip) => hasId(avail?.ali, chip?.id ?? chip),
    hasSubAli: (chip) => hasId(avail?.subAli, getSubAliId(chip)),
    hasSubAttr: (chip) => hasId(avail?.subAttr, chip?.id ?? chip),
    hasGender: (chip) => hasId(avail?.gender, chip?.id ?? chip),
  };
}

/* ============================================
   FILTER MODAL CONTROLLER (shared modal lifecycle & row orchestration)
   ============================================ */
export const FilterModalController = {
  createAvailPredicates,
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
    const p = createAvailPredicates(avail);
    const allClasses = [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra];
    const res = {
      rarityFilters: RARITY_FILTERS.filter(p.hasRarity).map((c) => c.id),
      groupClassFilters: CLASS_GROUPS.filter(p.hasGroup).map((g) => g.key),
      classFilters: allClasses.filter(p.hasClass).map((c) => c.id),
      aliFilters: ALIGNMENT_LNC_FILTERS.filter(p.hasAli).map((c) => c.id),
      subAliFilters: ALIGNMENT_GBE_FILTERS.filter(p.hasSubAli).map((c) =>
        c.other ? ServantFilters.SUB_ALI_OTHER : c.id,
      ),
      subAttrFilters: SUB_ATTR_FILTERS.filter(p.hasSubAttr).map((c) => c.id),
      genderFilters: GENDER_FILTERS.filter(p.hasGender).map((c) => c.id),
    };
    if (extraHandler) extraHandler(res);
    return res;
  },

  _renderTraitRows(prefix, filterState, toggle, p) {
    const traitRows = [
      { key: "aliFilters", id: `${prefix}AliFilter`, chips: ALIGNMENT_LNC_FILTERS, pred: p.hasAli },
      { key: "subAliFilters", id: `${prefix}SubAliFilter`, chips: ALIGNMENT_GBE_FILTERS, pred: p.hasSubAli },
      { key: "subAttrFilters", id: `${prefix}AttrFilter`, chips: SUB_ATTR_FILTERS, pred: p.hasSubAttr },
      { key: "genderFilters", id: `${prefix}GenderFilter`, chips: GENDER_FILTERS, pred: p.hasGender },
    ];
    traitRows.forEach(({ key, id, chips, pred }) => {
      FilterSections.renderRow(document.getElementById(id), chips, filterState[key], toggle(key), {
        disabled: (chip) => !pred(chip),
        word: true,
      });
    });
  },

  _renderClassAndGroupRows(prefix, filterState, toggle, p, opts) {
    const scope = ServantFilters.rowScope(filterState.groupClassFilters, opts.lockedClasses);
    const isLocked = (c) => Boolean(opts.lockedClasses) && !c.classes.some((id) => opts.lockedClasses.includes(id));
    const groupChips = CLASS_GROUPS.map((g) => ({ id: g.key, label: g.label, group: true, classes: g.classes }));
    const allClasses = [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra];

    FilterSections.renderRow(
      document.getElementById(`${prefix}ClassFilter`),
      allClasses,
      filterState.classFilters,
      toggle("classFilters"),
      { disabled: (chip) => !p.hasClass(chip) || (scope !== null && !scope.includes(chip.id)) },
    );
    FilterSections.renderRow(
      document.getElementById(`${prefix}GroupFilter`),
      groupChips,
      filterState.groupClassFilters,
      toggle("groupClassFilters"),
      { disabled: (chip) => isLocked(chip) || !p.hasGroup(chip) },
    );
  },

  renderStandardRows(prefix, filterState, toggle, opts = {}) {
    const p = createAvailPredicates(opts.avail);
    FilterSections.renderRow(
      document.getElementById(`${prefix}RarityFilter`),
      RARITY_FILTERS,
      filterState.rarityFilters,
      toggle("rarityFilters"),
      { disabled: (chip) => !p.hasRarity(chip) },
    );
    this._renderClassAndGroupRows(prefix, filterState, toggle, p, opts);
    this._renderTraitRows(prefix, filterState, toggle, p);
  },
};
