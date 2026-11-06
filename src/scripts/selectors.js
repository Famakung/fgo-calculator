import { ServantData, CEList, TraitCEs, CEById } from "./data.js";
import {
  CLASS_FILTERS,
  CLASS_GROUPS,
  RARITY_FILTERS,
  ALIGNMENT_LNC_FILTERS,
  ALIGNMENT_GBE_FILTERS,
  SUB_ATTR_FILTERS,
  GENDER_FILTERS,
  DEBOUNCE_MS,
} from "./constants.js";
import { ServantSort, ServantFilters, ServantComboCalculator } from "./domain.js";
import { FilterSections } from "./filter-sections.js";
import { DOMFactory, CollapsibleFactory, debounce } from "./presentation.js";

/* Longest search the servant picker keeps. Names top out well under this, so it only trims a paste someone
   has no hope of matching, and the box itself is left free to hold what the player typed. */
const MAX_SEARCH = 40;

/* ============================================
   SERVANT SELECTOR MODAL
   ============================================ */
export const ServantSelector = {
  activeSlotIndex: null,
  pendingSlot: false,
  _skipAscension: false,
  _multi: false,
  _selectedIds: new Set(),
  classFilters: [],
  /* Set by a Grand Duel quest: the party is limited to these class ids, so the grid is pre-filtered to
     them and the class row offers nothing outside them — greyed, never absent. null = no bound. */
  lockedClasses: null,
  rarityFilters: [],
  /* The other four Filter Settings rows. Like class and rarity they are kept across a close and a reopen
     for the page, are never saved, and are ANDed with it by ServantFilters.match. */
  groupClassFilters: [],
  aliFilters: [],
  subAliFilters: [],
  subAttrFilters: [],
  genderFilters: [],
  _searchQuery: "",
  /* Sort sits with the rest of the picker row: kept for the page, blank after a refresh, and never saved. */
  sortBy: "id",
  sortOrder: "asc",
  _callbacks: null,

  _listenersBound: false,

  // Called by both the Bond tab and the Bond Gain CE's Servant Select sub-tab: the modal is
  // shared, and its close controls must work whichever tab opens it first.
  init() {
    if (this._listenersBound) return;
    this._listenersBound = true;

    const modal = document.getElementById("servantModal");
    const closeBtn = document.getElementById("servantModalClose");
    const subModal = document.getElementById("servantFilterModal");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    /* Search sits outside the filters and the sort row sits beside them, like the Bond Gain CE tab: the
       controls live in the page, so they are wired once here and only read back on every open(). */
    const searchInput = document.getElementById("servantPickerSearch");
    if (searchInput) {
      const debouncedSearch = debounce((query) => {
        // Bounded, so a pasted wall of text cannot become the matcher's input or the reopened box.
        this._searchQuery = query.slice(0, MAX_SEARCH);
        this.filter();
      }, DEBOUNCE_MS);
      searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));
    }

    const filterBtn = document.getElementById("servantPickerFilterBtn");
    if (filterBtn) {
      filterBtn.addEventListener("click", () => this._openFilterModal());
    }

    const subClose = document.getElementById("servantFilterModalClose");
    if (subClose) {
      subClose.addEventListener("click", () => this._cancelFilterModal());
    }

    if (subModal) {
      subModal.addEventListener("click", (e) => {
        if (e.target === subModal) this._cancelFilterModal();
      });
    }

    const defaultBtn = document.getElementById("servantFilterDefaultBtn");
    if (defaultBtn) {
      defaultBtn.addEventListener("click", () => this._defaultFilterModal());
    }

    const selectAllBtn = document.getElementById("servantFilterSelectAllBtn");
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => this._selectAllFilterModal());
    }

    const cancelBtn = document.getElementById("servantFilterCancelBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => this._cancelFilterModal());
    }

    const okBtn = document.getElementById("servantFilterOkBtn");
    if (okBtn) {
      okBtn.addEventListener("click", () => this._okFilterModal());
    }

    const sortSelect = document.getElementById("servantPickerSortBy");
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        this.sortBy = sortSelect.value;
        sortSelect.blur();
        this.filter();
      });
    }

    const orderBtn = document.getElementById("servantPickerSortOrder");
    if (orderBtn) {
      orderBtn.addEventListener("click", () => {
        this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
        this._paintSortOrder();
        this.filter();
      });
      this._paintSortOrder();
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !modal.classList.contains("open")) return;
        // The filter modal sits on top of this one, so Escape takes the top layer off first.
        if (subModal && subModal.classList.contains("open")) {
          this._cancelFilterModal();
          return;
        }
        this.close();
      });
    }
  },

  _paintSortOrder() {
    const btn = document.getElementById("servantPickerSortOrder");
    if (!btn) return;
    const isDesc = this.sortOrder === "desc";
    const label = isDesc ? "Sort descending" : "Sort ascending";
    btn.dataset.order = this.sortOrder;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    const icon = btn.querySelector(".cefilter-sort-order-icon");
    if (icon) icon.textContent = isDesc ? "▼" : "▲";
  },

  open(slotIndex, pending = false, callbacks = null, options = {}) {
    this.activeSlotIndex = slotIndex;
    this.pendingSlot = pending;
    this._callbacks = callbacks;
    // The Servant Select sub-tab unions every ascension's traits, so it never needs an ascension pick.
    this._skipAscension = options.skipAscension === true;
    // Multi keeps the modal open and marks items like the CE picker does.
    this._multi = options.multi === true;
    this._selectedIds = new Set(this._multi ? options.selected : []);
    const newLock = Array.isArray(options.lockClasses) && options.lockClasses.length ? options.lockClasses : null;
    const lockChanged =
      (this.lockedClasses === null) !== (newLock === null) ||
      (Boolean(this.lockedClasses) &&
        Boolean(newLock) &&
        (this.lockedClasses.length !== newLock.length || !this.lockedClasses.every((id, i) => id === newLock[i])));
    if (lockChanged) {
      this.resetFilters();
    }
    this.lockedClasses = newLock;
    // The row is kept as the player left it for the rest of the page, and starts blank again after a refresh.

    this.syncPickerControls();
    // Filtered, not raw: a locked party has to be filtered from the first paint, not after a click.
    this.renderGrid(this.getFilteredServants());

    const modal = document.getElementById("servantModal");
    if (modal) modal.classList.add("open");
  },

  resetFilters() {
    this.classFilters = [];
    this.rarityFilters = [];
    this.groupClassFilters = [];
    this.aliFilters = [];
    this.subAliFilters = [];
    this.subAttrFilters = [];
    this.genderFilters = [];
    this.draftFilters = null;
    this._searchQuery = "";
    const searchInput = document.getElementById("servantPickerSearch");
    if (searchInput) searchInput.value = "";
    const modal = document.getElementById("servantModal");
    if (modal && modal.classList.contains("open")) {
      this.syncPickerControls();
      this.filter();
    }
  },

  close() {
    // If this was a pending add and no servant was picked, remove the slot
    if (this.pendingSlot && this.activeSlotIndex !== null) {
      this._callbacks?.onPendingRemove?.(this.activeSlotIndex);
    }
    const modal = document.getElementById("servantModal");
    if (modal) modal.classList.remove("open");
    // The filter sub-modal belongs to this one: never leave it sitting over the tab behind.
    const subModal = document.getElementById("servantFilterModal");
    if (subModal) subModal.classList.remove("open");
    this.activeSlotIndex = null;
    this.pendingSlot = false;
  },

  renderGrid(servants) {
    const grid = document.getElementById("servantPickerGrid");
    if (!grid) return;

    const frag = document.createDocumentFragment();

    servants.forEach((servant) => {
      // ce-filter-picker-item carries the highlight and the tick, so every multi item needs it,
      // not only the ones already picked.
      const classes = this._multi
        ? ["servant-picker-item", "ce-filter-picker-item", ...(this._selectedIds.has(servant.id) ? ["selected"] : [])]
        : "servant-picker-item";
      const item = DOMFactory.el("div", classes);
      if (this._multi) DOMFactory.appendCheckMark(item);

      const img = DOMFactory.createLazyImg(servant.image, null, {
        alt: servant.name,
      });
      DOMFactory.addAscensionFallback(img, servant.id);

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = servant.name;

      item.appendChild(img);
      item.appendChild(name);

      item.addEventListener("click", () => {
        if (this._multi) {
          const picked = new Set(this._selectedIds);
          if (picked.has(servant.id)) {
            picked.delete(servant.id);
            item.classList.remove("selected");
          } else {
            picked.add(servant.id);
            item.classList.add("selected");
          }
          this._selectedIds = picked;
          this._callbacks?.onToggle?.(this.activeSlotIndex, servant.id, picked.has(servant.id));
          return; // stay open, like the CE picker
        }
        this.pendingSlot = false; // servant selected, don't remove on close
        if (servant.hasAscensions && !this._skipAscension) {
          const idx = this.activeSlotIndex;
          this.close();
          AscensionSelector.open(servant, idx, this._callbacks);
        } else {
          this._callbacks?.onSelect?.(this.activeSlotIndex, servant.id, null);
          this.close();
        }
      });

      frag.appendChild(item);
    });

    grid.replaceChildren(frag);
  },

  filter() {
    this.renderGrid(this.getFilteredServants());
  },

  getFilteredServants() {
    let result = ServantData.servants;
    const query = this._searchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter(
        (s) =>
          s.id.toLowerCase().includes(query) ||
          ServantData.getAllNames(s.id).some((n) => n.toLowerCase().includes(query)),
      );
    }
    /* Every row at once, the class row included: a locked party is bound by its group whether or not the
       player picked a class in it, a pick inside the group narrows it, and a pick from outside is ignored.
       Read across the servant's forms — the picker names no ascension, and a sub-attribute can arrive with
       one (415 is Human in her 1st form and Earth in her 3rd). */
    result = result.filter((s) => ServantFilters.match(ServantData.getAllTraits(s.id), this));
    // Ordered last: what the player sorted by is a property of the rows the grid shows, never of the filter.
    return ServantSort.sorted(result, this.sortBy, this.sortOrder);
  },

  /* The controls live in the page, so an open() only reads the player's row back into them. What it does
     rebuild is the two rows the filter sub-modal shows: a Grand Duel group decides which classes exist
     there, and a pick made while another quest was active must not show as active now. */
  syncPickerControls() {
    const searchInput = document.getElementById("servantPickerSearch");
    if (searchInput) searchInput.value = this._searchQuery;

    /* A Grand Duel choice that names exactly one class has nothing to sort by class — that class is the
       whole party, and the class row can only ever show it greyed but selectable-in-effect — so the option
       goes grey and a remembered "class" sort falls back to ID. The three Extra groups span several
       classes, so theirs stay usable. */
    const singleClass = Boolean(this.lockedClasses) && this.lockedClasses.length === 1;
    const sortSelect = document.getElementById("servantPickerSortBy");
    if (sortSelect) {
      const classOption = sortSelect.querySelector('option[value="class"]');
      if (classOption) {
        if (singleClass) classOption.setAttribute("disabled", "");
        else classOption.removeAttribute("disabled");
      }
      if (singleClass && this.sortBy === "class") this.sortBy = "id";
      sortSelect.value = this.sortBy;
    }
    this._paintSortOrder();

    this._renderFilterRows();
  },

  /* The six rows, rebuilt on every open so what shows as active is what is in force for the quest that
     opened the picker. The class row is always built: outside the group or the quest's lock its chips are
     greyed rather than absent, so the row cannot be escaped by a stale pick and comes back whole when the
     group is cleared. */
  _renderFilterRows(customFilters = null) {
    const filterState = customFilters || this.draftFilters || this;
    const scope = ServantFilters.rowScope(filterState.groupClassFilters, this.lockedClasses);
    const lock = this.lockedClasses;
    const toggle = (key) => (ids) => {
      if (this.draftFilters) {
        this.draftFilters[key] = ids;
        if (key === "groupClassFilters") {
          this._renderFilterRows(this.draftFilters);
        }
      } else {
        this[key] = ids;
        this.filter();
      }
    };

    FilterSections.renderRow(
      document.getElementById("servantRarityFilter"),
      RARITY_FILTERS,
      filterState.rarityFilters,
      toggle("rarityFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("servantClassFilter"),
      [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra],
      filterState.classFilters,
      toggle("classFilters"),
      { disabled: (chip) => scope !== null && !scope.includes(chip.id) },
    );
    FilterSections.renderRow(
      document.getElementById("servantGroupFilter"),
      CLASS_GROUPS.map((g) => ({ id: g.key, label: g.label, group: true, classes: g.classes })),
      filterState.groupClassFilters,
      toggle("groupClassFilters"),
      { disabled: (chip) => Boolean(lock) && !chip.classes.some((id) => lock.includes(id)) },
    );
    FilterSections.renderRow(
      document.getElementById("servantAliFilter"),
      ALIGNMENT_LNC_FILTERS,
      filterState.aliFilters,
      toggle("aliFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("servantSubAliFilter"),
      ALIGNMENT_GBE_FILTERS,
      filterState.subAliFilters,
      toggle("subAliFilters"),
      { disabled: () => (filterState.subAliFilters || []).includes(ServantFilters.SUB_ALI_OTHER) },
    );
    FilterSections.renderRow(
      document.getElementById("servantAttrFilter"),
      SUB_ATTR_FILTERS,
      filterState.subAttrFilters,
      toggle("subAttrFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("servantGenderFilter"),
      GENDER_FILTERS,
      filterState.genderFilters,
      toggle("genderFilters"),
    );
  },

  _openFilterModal() {
    const subModal = document.getElementById("servantFilterModal");
    if (!subModal) return;
    this.draftFilters = {
      rarityFilters: [...this.rarityFilters],
      classFilters: [...this.classFilters],
      groupClassFilters: [...this.groupClassFilters],
      aliFilters: [...this.aliFilters],
      subAliFilters: [...this.subAliFilters],
      subAttrFilters: [...this.subAttrFilters],
      genderFilters: [...this.genderFilters],
    };
    this._renderFilterRows(this.draftFilters);
    subModal.classList.add("open");
  },

  _cancelFilterModal() {
    this.draftFilters = null;
    this._renderFilterRows();
    const subModal = document.getElementById("servantFilterModal");
    if (subModal) subModal.classList.remove("open");
  },

  _okFilterModal() {
    if (this.draftFilters) {
      this.rarityFilters = [...this.draftFilters.rarityFilters];
      this.classFilters = [...this.draftFilters.classFilters];
      this.groupClassFilters = [...this.draftFilters.groupClassFilters];
      this.aliFilters = [...this.draftFilters.aliFilters];
      this.subAliFilters = [...this.draftFilters.subAliFilters];
      this.subAttrFilters = [...this.draftFilters.subAttrFilters];
      this.genderFilters = [...this.draftFilters.genderFilters];
      this.draftFilters = null;
    }
    this.filter();
    const subModal = document.getElementById("servantFilterModal");
    if (subModal) subModal.classList.remove("open");
  },

  _defaultFilterModal() {
    if (!this.draftFilters) return;
    this.draftFilters.rarityFilters = [];
    this.draftFilters.classFilters = [];
    this.draftFilters.groupClassFilters = [];
    this.draftFilters.aliFilters = [];
    this.draftFilters.subAliFilters = [];
    this.draftFilters.subAttrFilters = [];
    this.draftFilters.genderFilters = [];
    this._renderFilterRows(this.draftFilters);
  },

  _selectAllFilterModal() {
    if (!this.draftFilters) return;
    this.draftFilters.rarityFilters = RARITY_FILTERS.map((c) => c.id);
    this.draftFilters.groupClassFilters = CLASS_GROUPS.map((g) => g.key);
    const scope = ServantFilters.rowScope(this.draftFilters.groupClassFilters, this.lockedClasses);
    const allClasses = [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra].map((c) => c.id);
    this.draftFilters.classFilters = scope ? allClasses.filter((id) => scope.includes(id)) : allClasses;
    this.draftFilters.aliFilters = ALIGNMENT_LNC_FILTERS.map((c) => c.id);
    this.draftFilters.subAliFilters = ALIGNMENT_GBE_FILTERS.map((c) => (c.other ? ServantFilters.SUB_ALI_OTHER : c.id));
    this.draftFilters.subAttrFilters = SUB_ATTR_FILTERS.map((c) => c.id);
    this.draftFilters.genderFilters = GENDER_FILTERS.map((c) => c.id);
    this._renderFilterRows(this.draftFilters);
  },
};

/* ============================================
   ASCENSION SELECTOR MODAL
   ============================================ */
export const AscensionSelector = {
  servant: null,
  slotIndex: null,
  _callbacks: null,

  init() {
    const modal = document.getElementById("ascensionModal");
    const closeBtn = document.getElementById("ascensionModalClose");
    const backBtn = document.getElementById("ascensionModalBack");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (backBtn) {
      backBtn.addEventListener("click", () => this.back());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(servant, slotIndex, callbacks = null) {
    this.servant = servant;
    this.slotIndex = slotIndex;
    this._callbacks = callbacks;
    const modal = document.getElementById("ascensionModal");
    const title = document.getElementById("ascensionModalTitle");

    if (title) title.textContent = servant.name;
    this.renderGrid();
    if (modal) modal.classList.add("open");
  },

  close() {
    const modal = document.getElementById("ascensionModal");
    if (modal) modal.classList.remove("open");
    this.servant = null;
    this.slotIndex = null;
  },

  back() {
    const idx = this.slotIndex;
    const cb = this._callbacks;
    this.close();
    if (idx !== null) {
      ServantSelector.open(idx, false, cb);
    }
  },

  renderGrid() {
    const grid = document.getElementById("ascensionPickerGrid");
    if (!grid || !this.servant) return;
    grid.replaceChildren();

    const options = ServantData.getAscensionOptions(this.servant.id);
    options.forEach((asc) => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const imgSrc = ServantData.getImageForAscension(this.servant.id, asc);
      const img = DOMFactory.createLazyImg(imgSrc, null, {
        alt: ServantData.getAscensionLabel(this.servant.id, asc),
      });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", this.servant.id);

      const label = DOMFactory.el("div", "servant-picker-name");
      label.textContent = ServantData.getAscensionLabel(this.servant.id, asc);

      item.appendChild(img);
      item.appendChild(label);

      item.addEventListener("click", () => {
        this._callbacks?.onSelect?.(this.slotIndex, this.servant.id, asc);
        this.close();
        ServantSelector.close();
      });

      grid.appendChild(item);
    });
  },
};

/* ============================================
   SERVANT DRAG REORDER
   ============================================ */
export const ServantDrag = {
  dragIndex: null,
  holdTimer: null,
  isDragging: false,
  _callbacks: null,

  init(callbacks = null) {
    this._callbacks = callbacks;
    const grid = document.getElementById("servantGrid");
    grid.addEventListener("mousedown", (e) => this.onHoldStart(e));
    grid.addEventListener("touchstart", (e) => this.onHoldStart(e), { passive: false });
    document.addEventListener("mousemove", (e) => this.onHoldMove(e));
    document.addEventListener("touchmove", (e) => this.onHoldMove(e), { passive: false });
    document.addEventListener("mouseup", () => this.onHoldEnd());
    document.addEventListener("touchend", () => this.onHoldEnd());
  },

  onHoldStart(e) {
    // Don't interfere with inputs/selects/checkboxes/labels
    if (e.target.closest("input, select, option, label")) return;

    const slot = e.target.closest(".servant-slot:not(.servant-add-slot)");
    if (!slot || slot.dataset.slotIndex === undefined) return;
    const index = parseInt(slot.dataset.slotIndex);
    if (isNaN(index)) return;

    // Prevent native image drag on desktop
    if (e.type === "mousedown") e.preventDefault();

    this.dragIndex = index;
    this.isDragging = false;
    this.holdTimer = setTimeout(() => {
      this.isDragging = true;
      slot.classList.add("dragging");
    }, 300);
  },

  onHoldMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();

    const grid = document.getElementById("servantGrid");
    const touch = e.touches ? e.touches[0] : e;
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const slot = target ? target.closest(".servant-slot") : null;

    grid.querySelectorAll(".servant-slot.drag-over").forEach((s) => s.classList.remove("drag-over"));
    if (slot && slot.dataset.slotIndex !== undefined) {
      const targetIndex = parseInt(slot.dataset.slotIndex);
      if (targetIndex !== this.dragIndex) {
        slot.classList.add("drag-over");
      }
    }
  },

  onHoldEnd() {
    clearTimeout(this.holdTimer);
    if (!this.isDragging) {
      this.dragIndex = null;
      return;
    }

    const grid = document.getElementById("servantGrid");
    const dragOver = grid.querySelector(".servant-slot.drag-over");
    if (dragOver && this.dragIndex !== null) {
      const targetIndex = parseInt(dragOver.dataset.slotIndex);
      if (!isNaN(targetIndex) && targetIndex !== this.dragIndex) {
        this._callbacks?.onSwap?.(this.dragIndex, targetIndex);
      }
    }

    grid.querySelectorAll(".servant-slot").forEach((s) => {
      s.classList.remove("dragging", "drag-over");
    });
    this.dragIndex = null;
    this.isDragging = false;
  },
};

/* ============================================
   CE SELECTOR MODAL
   ============================================ */
export const CESelector = {
  activeSlotIndex: null,
  pendingSlot: false,
  _searchQuery: "",
  _callbacks: null,

  init() {
    const modal = document.getElementById("ceModal");
    const closeBtn = document.getElementById("ceModalClose");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(slotIndex, pending = false, callbacks = null) {
    this.activeSlotIndex = slotIndex;
    this.pendingSlot = pending;
    this._callbacks = callbacks;
    this._searchQuery = "";

    this.buildFilterArea();
    this.renderGrid(CEList);

    const modal = document.getElementById("ceModal");
    if (modal) modal.classList.add("open");
  },

  close() {
    if (this.pendingSlot && this.activeSlotIndex !== null) {
      this._callbacks?.onPendingRemove?.(this.activeSlotIndex);
    }
    const modal = document.getElementById("ceModal");
    if (modal) modal.classList.remove("open");
    this.activeSlotIndex = null;
    this.pendingSlot = false;
  },

  renderGrid(ces) {
    const grid = document.getElementById("cePickerGrid");
    if (!grid) return;

    const frag = document.createDocumentFragment();

    ces.forEach((ce) => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.createLazyImg(ce.image, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", ce.id);

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = ce.name;
      item.appendChild(img);
      item.appendChild(name);

      item.addEventListener("click", () => {
        if (ce.isGroup) {
          const idx = this.activeSlotIndex;
          this.pendingSlot = false;
          this.close();
          CESubSelector.open(ce, idx, this._callbacks);
          return;
        }
        this.pendingSlot = false;
        this._callbacks?.onSelect?.(this.activeSlotIndex, ce.id, null);
        this.close();
      });

      frag.appendChild(item);
    });

    grid.replaceChildren(frag);
  },

  filter() {
    const q = this._searchQuery.toLowerCase().trim();
    if (!q) {
      this.renderGrid(CEList);
      return;
    }
    const filtered = CEList.filter((c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    this.renderGrid(filtered);
  },

  buildFilterArea() {
    const container = document.getElementById("ceFilterArea");
    if (!container) return;
    CollapsibleFactory.populateFilterArea(container, this._searchQuery, (query) => {
      this._searchQuery = query;
      this.filter();
    });
  },
};

/* ============================================
   CE SUB-SELECTOR (GROUP OPTIONS)
   ============================================ */
export const CESubSelector = {
  groupCE: null,
  activeSlotIndex: null,
  _callbacks: null,
  _selected: false,

  init() {
    const modal = document.getElementById("ceSubModal");
    const closeBtn = document.getElementById("ceSubModalClose");
    const backBtn = document.getElementById("ceSubModalBack");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (backBtn) {
      backBtn.addEventListener("click", () => this.back());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(groupCE, slotIndex, callbacks = null) {
    this.groupCE = groupCE;
    this.activeSlotIndex = slotIndex;
    this._callbacks = callbacks;
    this._selected = false;
    const modal = document.getElementById("ceSubModal");
    const title = document.getElementById("ceSubModalTitle");

    if (title) title.textContent = groupCE.name;
    this.renderGrid();
    if (modal) modal.classList.add("open");
  },

  close() {
    const idx = this.activeSlotIndex;
    const modal = document.getElementById("ceSubModal");
    if (modal) modal.classList.remove("open");
    this.groupCE = null;
    this.activeSlotIndex = null;
    // Remove pending null slot if no option was selected
    if (!this._selected && idx !== null) {
      this._callbacks?.onPendingRemove?.(idx);
    }
    this._selected = false;
  },

  back() {
    const idx = this.activeSlotIndex;
    const cb = this._callbacks;
    this._selected = true; // prevent close() from removing pending slot
    this.close();
    if (idx !== null) {
      CESelector.open(idx, false, cb);
    }
  },

  renderGrid() {
    const grid = document.getElementById("ceSubPickerGrid");
    if (!grid || !this.groupCE) return;
    grid.replaceChildren();

    const options = this.groupCE.options || [];
    options.forEach((opt) => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.createLazyImg(opt.image, null, { alt: opt.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", opt.id);

      const label = DOMFactory.el("div", "servant-picker-name");
      const colonIdx = opt.name.indexOf(": ");
      label.textContent = colonIdx !== -1 ? opt.name.substring(colonIdx + 2) : opt.name;

      item.appendChild(img);
      item.appendChild(label);

      item.addEventListener("click", () => {
        this._selected = true;
        CESelector.pendingSlot = false;
        this._callbacks?.onSelect?.(this.activeSlotIndex, this.groupCE.id, opt.id);
        this.close();
        CESelector.close();
      });

      grid.appendChild(item);
    });
  },
};

/* ============================================
   BOND GAIN CE PICKER
   ============================================ */
export const CEFilterPicker = {
  tempSelected: new Set(),
  _searchQuery: "",
  _callbacks: null,
  _ceMatchEntries: null,

  init() {
    const modal = document.getElementById("ceFilterModal");
    const closeBtn = document.getElementById("ceFilterModalClose");
    const defaultBtn = document.getElementById("ceFilterDefaultBtn");
    const cancelBtn = document.getElementById("ceFilterCancelBtn");
    const okBtn = document.getElementById("ceFilterOkBtn");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.cancel());
    }
    if (defaultBtn) {
      defaultBtn.addEventListener("click", () => this.default());
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => this.cancel());
    }
    if (okBtn) {
      okBtn.addEventListener("click", () => this.ok());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.cancel();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("open")) {
          this.cancel();
        }
      });
    }

    const searchInput = document.getElementById("ceFilterPickerSearch");
    if (searchInput) {
      const debouncedSearch = debounce((q) => {
        this._searchQuery = q;
        this.filter();
      }, DEBOUNCE_MS);
      searchInput.addEventListener("input", (e) => {
        debouncedSearch(e.target.value);
      });
    }
  },

  open(callbacks = null) {
    this._callbacks = callbacks;
    this.tempSelected = new Set(callbacks?.getSelectedCEs?.() || []);
    this._searchQuery = "";

    const searchInput = document.getElementById("ceFilterPickerSearch");
    if (searchInput) {
      searchInput.value = "";
    }

    const traitCEs = TraitCEs;

    // Use cached CE->entry index from computeAllCEMatches()
    this._callbacks?.getCEMatches?.();
    this._ceMatchEntries = this._callbacks?.getCEMatchEntries?.() || {};

    this.renderGrid(traitCEs);

    const modal = document.getElementById("ceFilterModal");
    if (modal) modal.classList.add("open");
  },

  close() {
    const modal = document.getElementById("ceFilterModal");
    if (modal) modal.classList.remove("open");
    this.tempSelected = new Set();
  },

  cancel() {
    this.close();
  },

  default() {
    this.tempSelected.clear();
    const grid = document.getElementById("ceFilterPickerGrid");
    if (grid) {
      grid.querySelectorAll(".ce-filter-picker-item.selected").forEach((item) => {
        item.classList.remove("selected");
      });
    }
    this.updateNoMatchState();
  },

  ok() {
    this._callbacks?.onApply?.([...this.tempSelected]);
    this.close();
  },

  renderGrid(ces) {
    const grid = document.getElementById("ceFilterPickerGrid");
    if (!grid) return;

    const frag = document.createDocumentFragment();

    ces.forEach((ce) => {
      const isSelected = this.tempSelected.has(ce.id);
      const item = DOMFactory.el("div", "servant-picker-item ce-filter-picker-item" + (isSelected ? " selected" : ""));
      item.dataset.ceId = ce.id;

      DOMFactory.appendCheckMark(item);

      const img = DOMFactory.createLazyImg(ce.image, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", ce.id);
      item.appendChild(img);

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = ce.name;
      item.appendChild(name);

      item.addEventListener("click", () => {
        if (this.tempSelected.has(ce.id)) {
          this.tempSelected.delete(ce.id);
          item.classList.remove("selected");
        } else {
          this.tempSelected.add(ce.id);
          item.classList.add("selected");
        }
        this.updateNoMatchState();
      });

      frag.appendChild(item);
    });

    grid.replaceChildren(frag);
    this.updateNoMatchState();
  },

  updateNoMatchState() {
    const selectedIds = [...this.tempSelected];
    const grid = document.getElementById("ceFilterPickerGrid");
    if (!grid) return;

    // Intersect entry indices across all selected CEs
    let intersection = null;
    if (selectedIds.length > 0) {
      for (const selId of selectedIds) {
        const set = this._ceMatchEntries[selId];
        if (!set) {
          intersection = new Set();
          break;
        }
        if (!intersection) {
          intersection = new Set(set);
        } else {
          for (const idx of intersection) {
            if (!set.has(idx)) intersection.delete(idx);
          }
        }
      }
    }

    grid.querySelectorAll(".ce-filter-picker-item").forEach((item) => {
      const ceId = item.dataset.ceId;
      if (this.tempSelected.has(ceId)) {
        item.classList.remove("ce-filter-picker-item--no-match");
        return;
      }
      if (selectedIds.length === 0 || !intersection) {
        item.classList.remove("ce-filter-picker-item--no-match");
        return;
      }
      const entries = this._ceMatchEntries[ceId];
      if (!entries) {
        item.classList.add("ce-filter-picker-item--no-match");
        return;
      }
      const hasOverlap = [...intersection].some((idx) => entries.has(idx));
      item.classList.toggle("ce-filter-picker-item--no-match", !hasOverlap);
    });
  },

  filter() {
    const q = this._searchQuery.toLowerCase().trim();
    const traitCEs = TraitCEs;
    if (!q) {
      this.renderGrid(traitCEs);
      return;
    }
    const filtered = traitCEs.filter((c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    this.renderGrid(filtered);
  },
};

/* ============================================
   CE SERVANT OVERLAP MODAL
   ============================================ */

export const CEServantOverlap = {
  _modal: null,
  _subModal: null,
  _getCEMatches: null,
  _groups: [],
  _listenersBound: false,
  draftFilters: null,
  filterState: {
    rarityFilters: [],
    classFilters: [],
    groupClassFilters: [],
    aliFilters: [],
    subAliFilters: [],
    subAttrFilters: [],
    genderFilters: [],
  },

  init(getCEMatches) {
    if (this._listenersBound) {
      this._getCEMatches = getCEMatches;
      return;
    }
    this._listenersBound = true;

    const modal = document.getElementById("ceOverlapModal");
    const closeBtn = document.getElementById("ceOverlapClose");
    const subModal = document.getElementById("ceOverlapFilterModal");
    const subCloseBtn = document.getElementById("ceOverlapFilterModalClose");
    const filterBtn = document.getElementById("ceOverlapFilterBtn");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }

    if (filterBtn) {
      filterBtn.addEventListener("click", () => this._openFilterModal());
    }
    if (subCloseBtn) {
      subCloseBtn.addEventListener("click", () => this._cancelFilterModal());
    }
    if (subModal) {
      subModal.addEventListener("click", (e) => {
        if (e.target === subModal) this._cancelFilterModal();
      });
    }

    const defaultBtn = document.getElementById("ceOverlapFilterDefaultBtn");
    if (defaultBtn) {
      defaultBtn.addEventListener("click", () => this._defaultFilterModal());
    }
    const selectAllBtn = document.getElementById("ceOverlapFilterSelectAllBtn");
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => this._selectAllFilterModal());
    }
    const cancelBtn = document.getElementById("ceOverlapFilterCancelBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => this._cancelFilterModal());
    }
    const okBtn = document.getElementById("ceOverlapFilterOkBtn");
    if (okBtn) {
      okBtn.addEventListener("click", () => this._okFilterModal());
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this._subModal && this._subModal.classList.contains("open")) {
          this._cancelFilterModal();
          return;
        }
        if (this._modal && this._modal.classList.contains("open")) {
          this.close();
        }
      }
    });

    this._modal = modal;
    this._subModal = subModal;
    this._getCEMatches = getCEMatches;
  },

  open(entry) {
    if (!this._modal || !entry) return;

    const titleEl = document.getElementById("ceOverlapTitle");
    if (titleEl) {
      const imgAsc =
        !entry.baseMatchesAll && entry.matchedAscensions && entry.matchedAscensions.length > 0
          ? entry.primaryAscension || entry.matchedAscensions[0]
          : null;
      const displayName = imgAsc
        ? ServantData.getAscensionName(entry.servant.id, imgAsc) || entry.servant.name
        : entry.servant.name;
      titleEl.textContent = displayName;
    }

    const allMatches = this._getCEMatches ? this._getCEMatches() : [];
    this._groups = ServantComboCalculator.buildServantOverlapGroups(allMatches, entry);

    this.renderGrid();
    this._modal.classList.add("open");
  },

  close() {
    if (this._subModal) {
      this._subModal.classList.remove("open");
    }
    if (this._modal) {
      this._modal.classList.remove("open");
    }
  },

  _openFilterModal() {
    if (!this._subModal) return;
    this.draftFilters = {
      rarityFilters: [...this.filterState.rarityFilters],
      classFilters: [...this.filterState.classFilters],
      groupClassFilters: [...this.filterState.groupClassFilters],
      aliFilters: [...this.filterState.aliFilters],
      subAliFilters: [...this.filterState.subAliFilters],
      subAttrFilters: [...this.filterState.subAttrFilters],
      genderFilters: [...this.filterState.genderFilters],
    };
    this._renderFilterRows(this.draftFilters);
    this._subModal.classList.add("open");
  },

  _cancelFilterModal() {
    this.draftFilters = null;
    if (this._subModal) this._subModal.classList.remove("open");
  },

  _defaultFilterModal() {
    if (!this.draftFilters) return;
    this.draftFilters.rarityFilters = [];
    this.draftFilters.classFilters = [];
    this.draftFilters.groupClassFilters = [];
    this.draftFilters.aliFilters = [];
    this.draftFilters.subAliFilters = [];
    this.draftFilters.subAttrFilters = [];
    this.draftFilters.genderFilters = [];
    this._renderFilterRows(this.draftFilters);
  },

  _selectAllFilterModal() {
    if (!this.draftFilters) return;
    this.draftFilters.rarityFilters = RARITY_FILTERS.map((c) => c.id);
    this.draftFilters.groupClassFilters = CLASS_GROUPS.map((g) => g.key);
    const scope = ServantFilters.rowScope(this.draftFilters.groupClassFilters);
    const allClasses = [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra].map((c) => c.id);
    this.draftFilters.classFilters = scope ? allClasses.filter((id) => scope.includes(id)) : allClasses;
    this.draftFilters.aliFilters = ALIGNMENT_LNC_FILTERS.map((c) => c.id);
    this.draftFilters.subAliFilters = ALIGNMENT_GBE_FILTERS.map((c) => (c.other ? ServantFilters.SUB_ALI_OTHER : c.id));
    this.draftFilters.subAttrFilters = SUB_ATTR_FILTERS.map((c) => c.id);
    this.draftFilters.genderFilters = GENDER_FILTERS.map((c) => c.id);
    this._renderFilterRows(this.draftFilters);
  },

  _okFilterModal() {
    if (this.draftFilters) {
      this.filterState.rarityFilters = [...this.draftFilters.rarityFilters];
      this.filterState.classFilters = [...this.draftFilters.classFilters];
      this.filterState.groupClassFilters = [...this.draftFilters.groupClassFilters];
      this.filterState.aliFilters = [...this.draftFilters.aliFilters];
      this.filterState.subAliFilters = [...this.draftFilters.subAliFilters];
      this.filterState.subAttrFilters = [...this.draftFilters.subAttrFilters];
      this.filterState.genderFilters = [...this.draftFilters.genderFilters];
      this.draftFilters = null;
    }
    if (this._subModal) this._subModal.classList.remove("open");
    this.renderGrid();
  },

  _renderFilterRows(customFilters = null) {
    const filterState = customFilters || this.draftFilters || this.filterState;
    const scope = ServantFilters.rowScope(filterState.groupClassFilters);

    const toggle = (key) => (ids) => {
      if (this.draftFilters) {
        this.draftFilters[key] = ids;
        if (key === "groupClassFilters") {
          this._renderFilterRows(this.draftFilters);
        }
      } else {
        this.filterState[key] = ids;
        this.renderGrid();
      }
    };

    FilterSections.renderRow(
      document.getElementById("ceOverlapRarityFilter"),
      RARITY_FILTERS,
      filterState.rarityFilters,
      toggle("rarityFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("ceOverlapClassFilter"),
      [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra],
      filterState.classFilters,
      toggle("classFilters"),
      { disabled: (chip) => scope !== null && !scope.includes(chip.id) },
    );
    FilterSections.renderRow(
      document.getElementById("ceOverlapGroupFilter"),
      CLASS_GROUPS.map((g) => ({ id: g.key, label: g.label, group: true, classes: g.classes })),
      filterState.groupClassFilters,
      toggle("groupClassFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("ceOverlapAliFilter"),
      ALIGNMENT_LNC_FILTERS,
      filterState.aliFilters,
      toggle("aliFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("ceOverlapSubAliFilter"),
      ALIGNMENT_GBE_FILTERS,
      filterState.subAliFilters,
      toggle("subAliFilters"),
      { disabled: () => (filterState.subAliFilters || []).includes(ServantFilters.SUB_ALI_OTHER) },
    );
    FilterSections.renderRow(
      document.getElementById("ceOverlapAttrFilter"),
      SUB_ATTR_FILTERS,
      filterState.subAttrFilters,
      toggle("subAttrFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("ceOverlapGenderFilter"),
      GENDER_FILTERS,
      filterState.genderFilters,
      toggle("genderFilters"),
    );
  },

  _traitsOf(entry) {
    const traits = entry.primaryAscension
      ? ServantData.getTraitsForAscension(entry.servant.id, entry.primaryAscension)
      : ServantData.getAllTraits(entry.servant.id);
    return traits || ServantData.getAllTraits(entry.servant.id);
  },

  renderGrid() {
    const grid = document.getElementById("ceOverlapGrid");
    if (!grid) return;
    grid.replaceChildren();

    const visibleCards = [];
    (this._groups || []).forEach((group) => {
      const filteredMembers = (group.otherMembers || []).filter((entry) =>
        ServantFilters.match(this._traitsOf(entry), this.filterState),
      );
      if (filteredMembers.length > 0) {
        visibleCards.push({
          ceIds: group.ceIds,
          otherMembers: filteredMembers,
        });
      }
    });

    if (visibleCards.length === 0) {
      const msg = DOMFactory.el("div", "ceoverlap-empty");
      msg.textContent =
        this._groups && this._groups.length > 0
          ? "No other servants match selected filter."
          : "No other servants share these CEs.";
      grid.appendChild(msg);
      return;
    }

    const frag = document.createDocumentFragment();
    visibleCards.forEach((group) => {
      frag.appendChild(this._buildCard(group));
    });
    grid.replaceChildren(frag);
  },

  _buildCard(group) {
    const card = DOMFactory.el("div", ["cefilter-servant-card", "cefilter-combo-card"]);

    // Unclickable CE row
    const ceRow = DOMFactory.el("div", ["ce-badges", "cefilter-combo-ce-row"]);
    group.ceIds.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;
      const cell = DOMFactory.el("div", "cefilter-combo-ce", {
        title: ce.name,
      });
      const img = DOMFactory.createLazyImg(ce.thumbImage, "cefilter-combo-ce-img", { alt: ce.name, title: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      cell.appendChild(img);
      ceRow.appendChild(cell);
    });
    card.appendChild(ceRow);

    // Unclickable servant row showing only other servants
    const servantRow = DOMFactory.el("div", ["ce-badges", "cefilter-combo-servant-row"]);
    const rowCEs = group.ceIds.map((ceId) => CEById.get(ceId)).filter(Boolean);
    group.otherMembers.forEach((entry) => {
      if (!entry || !entry.servant) return;
      servantRow.appendChild(this._buildServantCell(entry, rowCEs));
    });
    card.appendChild(servantRow);

    return card;
  },

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
};
