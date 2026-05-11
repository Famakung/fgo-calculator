import { ServantData, CEList, TraitCEs } from "./data.js";
import { CLASS_FILTERS, RARITY_FILTERS } from "./constants.js";
import { DOMFactory, CollapsibleFactory, debounce } from "./presentation.js";

/* ============================================
   SERVANT SELECTOR MODAL
   ============================================ */
export const ServantSelector = {
  activeSlotIndex: null,
  pendingSlot: false,
  classFilters: [],
  rarityFilters: [],
  _searchQuery: "",
  _callbacks: null,

  init() {
    const modal = document.getElementById("servantModal");
    const closeBtn = document.getElementById("servantModalClose");

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
    this.classFilters = [];
    this.rarityFilters = [];
    this._searchQuery = "";

    this.buildFilterArea();
    this.renderGrid(ServantData.servants);

    const modal = document.getElementById("servantModal");
    if (modal) modal.classList.add("open");
  },

  close() {
    // If this was a pending add and no servant was picked, remove the slot
    if (this.pendingSlot && this.activeSlotIndex !== null) {
      this._callbacks?.onPendingRemove?.(this.activeSlotIndex);
    }
    const modal = document.getElementById("servantModal");
    if (modal) modal.classList.remove("open");
    this.activeSlotIndex = null;
    this.pendingSlot = false;
  },

  renderGrid(servants) {
    const grid = document.getElementById("servantPickerGrid");
    if (!grid) return;

    const frag = document.createDocumentFragment();

    servants.forEach((servant) => {
      const item = DOMFactory.el("div", "servant-picker-item");

      const img = DOMFactory.createLazyImg(servant.image, null, {
        alt: servant.name,
      });
      DOMFactory.addAscensionFallback(img, servant.id);

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = servant.name;

      item.appendChild(img);
      item.appendChild(name);

      item.addEventListener("click", () => {
        this.pendingSlot = false; // servant selected, don't remove on close
        if (servant.hasAscensions) {
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
    if (this.classFilters.length > 0) {
      const classSet = new Set(this.classFilters);
      result = result.filter((s) => s.traits.some((t) => classSet.has(t)));
    }
    if (this.rarityFilters.length > 0) {
      const raritySet = new Set(this.rarityFilters);
      result = result.filter((s) => s.traits.some((t) => raritySet.has(t)));
    }
    return result;
  },

  buildFilterArea() {
    const container = document.getElementById("servantFilterArea");
    if (!container) return;
    CollapsibleFactory.populateFilterArea(
      container,
      this._searchQuery,
      (query) => {
        this._searchQuery = query;
        this.filter();
      },
      (content) => {
        this._buildClassFilter(content);
        this._buildRarityFilter(content);
      },
    );
  },

  _buildClassFilter(container) {
    const { standard, extra } = CLASS_FILTERS;

    const filterDiv = DOMFactory.el("div", "class-filter");
    const selected = new Set(this.classFilters);

    const buildRow = (classes) => {
      classes.forEach((cls) => {
        const btn = DOMFactory.el("div", "class-btn" + (selected.has(cls.id) ? " active" : ""));
        const img = DOMFactory.el("img", "", {
          dataset: { src: "icons/classes/" + cls.icon + ".webp" },
          alt: cls.label,
          title: cls.label,
        });
        btn.appendChild(img);
        btn.addEventListener("click", () => {
          if (selected.has(cls.id)) {
            selected.delete(cls.id);
            btn.classList.remove("active");
          } else {
            selected.add(cls.id);
            btn.classList.add("active");
          }
          this.classFilters = [...selected];
          this.filter();
        });
        filterDiv.appendChild(btn);
      });
    };

    buildRow(standard);
    buildRow(extra);
    container.appendChild(filterDiv);
  },

  _buildRarityFilter(container) {
    const rarities = RARITY_FILTERS;

    const filterDiv = DOMFactory.el("div", "rarity-filter");
    const selected = new Set(this.rarityFilters);

    rarities.forEach((rarity) => {
      const btn = DOMFactory.el("div", "rarity-btn" + (selected.has(rarity.id) ? " active" : ""));
      btn.textContent = rarity.label;
      btn.addEventListener("click", () => {
        if (selected.has(rarity.id)) {
          selected.delete(rarity.id);
          btn.classList.remove("active");
        } else {
          selected.add(rarity.id);
          btn.classList.add("active");
        }
        this.rarityFilters = [...selected];
        this.filter();
      });
      filterDiv.appendChild(btn);
    });

    container.appendChild(filterDiv);
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
    // Don't interfere with inputs/selects
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "OPTION") return;

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
   CE FILTER PICKER
   ============================================ */
export const CEFilterPicker = {
  tempSelected: new Set(),
  _searchQuery: "",
  _callbacks: null,
  _ceMatchEntries: null,

  init() {
    const modal = document.getElementById("ceFilterModal");
    const closeBtn = document.getElementById("ceFilterModalClose");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
  },

  open(callbacks = null) {
    this._callbacks = callbacks;
    this.tempSelected = new Set(callbacks?.getSelectedCEs?.() || []);
    this._searchQuery = "";

    this.buildFilterArea();

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
        this._callbacks?.onApply?.([...this.tempSelected]);
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

  buildFilterArea() {
    const container = document.getElementById("ceFilterPickerArea");
    if (!container) return;
    CollapsibleFactory.populateFilterArea(container, this._searchQuery, (query) => {
      this._searchQuery = query;
      this.filter();
    });
  },
};

/* ============================================
   CE SERVANT OVERLAP MODAL
   ============================================ */

export const CEServantOverlap = {
  _allEntries: [],
  _clickedCEIds: new Set(),
  _clickedCEs: [],
  _selectedCEFilter: new Set(),
  _selectedCounts: new Set(),
  _searchQuery: "",
  _classFilters: [],
  _rarityFilters: [],
  _debouncedUpdateFilters: null,
  _modal: null,
  _getCEMatches: null,

  init(getCEMatches) {
    const modal = document.getElementById("ceOverlapModal");
    const closeBtn = document.getElementById("ceOverlapClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.close());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this.close();
      });
    }
    this._modal = modal;
    this._getCEMatches = getCEMatches;
  },

  open(entry) {
    if (!this._modal) return;
    const clickedCEIds = new Set(entry.matchingCEs.map((c) => c.id));
    const totalCEs = clickedCEIds.size;
    if (totalCEs === 0) return;

    this._clickedCEIds = clickedCEIds;
    this._clickedCEs = entry.matchingCEs;
    this._selectedCEFilter = new Set();
    this._selectedCounts = new Set();
    this._searchQuery = "";
    this._classFilters = [];
    this._rarityFilters = [];
    this._debouncedUpdateFilters = debounce(() => this.updateFilters(), 50);

    const titleEl = document.getElementById("ceOverlapTitle");
    if (titleEl) {
      titleEl.textContent = entry.servant.name;
    }

    const allMatches = this._getCEMatches();
    this._allEntries = [];
    allMatches.forEach((other) => {
      if (other.servant.id === entry.servant.id) return;
      const overlap = other.matchingCEs.filter((ce) => clickedCEIds.has(ce.id)).length;
      if (overlap > 0) {
        this._allEntries.push({ entry: other, overlap: overlap });
      }
    });

    this.buildFilterArea();
    this._modal.classList.add("open");
  },

  close() {
    if (this._modal) {
      this._modal.classList.remove("open");
    }
  },

  buildFilterArea() {
    const container = document.getElementById("ceOverlapFilterArea");
    if (!container) return;
    container.replaceChildren();

    if (this._allEntries.length === 0) {
      const msg = DOMFactory.el("div", "ceoverlap-empty");
      msg.textContent = "No other servants share these CEs.";
      container.appendChild(msg);
      return;
    }

    this._buildCEFilter(container);

    const content = DOMFactory.el("div", "filter-content");

    content.appendChild(
      CollapsibleFactory.createSearchInput(this._searchQuery, (query) => {
        this._searchQuery = query;
        this.updateFilters();
      }),
    );

    const group = DOMFactory.el("div", "filter-group");

    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    this._allEntries.forEach(({ entry }) => {
      entry.servant.traits.forEach((t) => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });
    this._buildClassFilter(group, availableClassIds);
    this._buildRarityFilter(group, availableRarityIds);

    this._buildCountFilter(group, this._getFilteredEntries());
    content.appendChild(group);
    container.appendChild(CollapsibleFactory.build("Filters", content));

    // Cache button refs for fast visibility updates
    this._overlapClassBtns = Array.from(container.querySelectorAll(".class-btn"));
    this._overlapRarityBtns = Array.from(container.querySelectorAll(".rarity-btn"));

    this.renderGrid();
  },

  _buildCEFilter(container) {
    const filterDiv = DOMFactory.el("div", ["ceoverlap-ce-filter", "grid-mini"]);
    const selected = this._selectedCEFilter;

    this._clickedCEs.forEach((ce) => {
      const btn = DOMFactory.el(
        "div",
        "servant-picker-item ce-filter-picker-item" + (selected.has(ce.id) ? " selected" : ""),
      );
      DOMFactory.appendCheckMark(btn);
      const img = DOMFactory.createLazyImg(ce.image, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "servant-slot-portrait-fallback", ce.id);
      btn.appendChild(img);

      const name = DOMFactory.el("div", "servant-picker-name");
      name.textContent = ce.name;
      btn.appendChild(name);
      btn.addEventListener("click", () => {
        if (selected.has(ce.id)) {
          selected.delete(ce.id);
          btn.classList.remove("selected");
        } else {
          selected.add(ce.id);
          btn.classList.add("selected");
        }
        this._debouncedUpdateFilters();
      });
      filterDiv.appendChild(btn);
    });

    container.appendChild(filterDiv);
  },

  _getFilteredEntries(options) {
    let filtered = this._allEntries;

    if (this._selectedCEFilter.size > 0) {
      filtered = filtered.filter(({ entry }) =>
        [...this._selectedCEFilter].every((id) => entry.matchingCEs.some((ce) => ce.id === id)),
      );
    }

    const query = this._searchQuery.toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(
        ({ entry }) =>
          entry.servant.id.toLowerCase().includes(query) ||
          entry.servant.name.toLowerCase().includes(query) ||
          ServantData.getAllNames(entry.servant.id).some((n) => n.toLowerCase().includes(query)),
      );
    }

    if (!options?.skipClassRarity) {
      if (this._classFilters.length > 0) {
        const classSet = new Set(this._classFilters);
        filtered = filtered.filter(({ entry }) => entry.servant.traits.some((t) => classSet.has(t)));
      }

      if (this._rarityFilters.length > 0) {
        const raritySet = new Set(this._rarityFilters);
        filtered = filtered.filter(({ entry }) => entry.servant.traits.some((t) => raritySet.has(t)));
      }
    }

    return filtered;
  },

  updateFilters() {
    const forVisibility = this._getFilteredEntries({ skipClassRarity: true });
    const preFiltered = this._getFilteredEntries();
    this._updateClassRarityVisibility(forVisibility);
    this._rebuildCountFilter(preFiltered);
    this.renderGrid(preFiltered);
  },

  _updateClassRarityVisibility(preFiltered) {
    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    preFiltered.forEach(({ entry }) => {
      entry.servant.traits.forEach((t) => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });

    (this._overlapClassBtns || []).forEach((btn) => {
      const avail = availableClassIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });
    (this._overlapRarityBtns || []).forEach((btn) => {
      const avail = availableRarityIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });

    this._classFilters = this._classFilters.filter((id) => availableClassIds.has(id));
    this._rarityFilters = this._rarityFilters.filter((id) => availableRarityIds.has(id));
  },

  _buildCountFilter(container, preFiltered) {
    const availableCounts = new Set(preFiltered.map((e) => e.entry.matchingCEs.length));
    if (availableCounts.size === 0) return;

    this._selectedCounts.forEach((n) => {
      if (!availableCounts.has(n)) this._selectedCounts.delete(n);
    });

    const filterRow = DOMFactory.el("div", "ce-count-filter");
    const selected = this._selectedCounts;

    for (let n = 1; n <= Math.max(...availableCounts); n++) {
      if (!availableCounts.has(n)) continue;
      const btn = DOMFactory.el("div", "ce-count-btn" + (selected.has(n) ? " active" : ""));
      btn.textContent = n + " CE";
      btn.addEventListener("click", () => {
        if (selected.has(n)) {
          selected.delete(n);
        } else {
          selected.add(n);
        }
        btn.classList.toggle("active", selected.has(n));
        this.renderGrid();
      });
      filterRow.appendChild(btn);
    }

    container.appendChild(filterRow);
  },

  _rebuildCountFilter(preFiltered) {
    const container = document.getElementById("ceOverlapFilterArea");
    if (!container) return;

    const group = container.querySelector(".filter-group");
    const oldRow = (group || container).querySelector(".ce-count-filter");
    if (oldRow) oldRow.remove();

    this._buildCountFilter(group || container, preFiltered);
    const grid = document.getElementById("ceOverlapGrid");
    if (grid) grid.replaceChildren();
  },

  _buildClassFilter(container, availableClassIds) {
    const { standard, extra } = CLASS_FILTERS;

    const filterDiv = DOMFactory.el("div", "class-filter");

    const buildRow = (classes) => {
      classes.forEach((cls) => {
        if (!availableClassIds.has(cls.id)) return;
        const btn = DOMFactory.el("div", "class-btn" + (this._classFilters.includes(cls.id) ? " active" : ""));
        btn.dataset.traitId = cls.id;
        const img = DOMFactory.el("img", "", {
          dataset: { src: "icons/classes/" + cls.icon + ".webp" },
          alt: cls.label,
          title: cls.label,
        });
        btn.appendChild(img);
        btn.addEventListener("click", () => {
          const selected = new Set(this._classFilters);
          if (selected.has(cls.id)) {
            selected.delete(cls.id);
            btn.classList.remove("active");
          } else {
            selected.add(cls.id);
            btn.classList.add("active");
          }
          this._classFilters = [...selected];
          this._debouncedUpdateFilters();
        });
        filterDiv.appendChild(btn);
      });
    };

    buildRow(standard);
    buildRow(extra);
    container.appendChild(filterDiv);
  },

  _buildRarityFilter(container, availableRarityIds) {
    const rarities = RARITY_FILTERS;

    const filterDiv = DOMFactory.el("div", "rarity-filter");

    rarities.forEach((rarity) => {
      if (!availableRarityIds.has(rarity.id)) return;
      const btn = DOMFactory.el("div", "rarity-btn" + (this._rarityFilters.includes(rarity.id) ? " active" : ""));
      btn.dataset.traitId = rarity.id;
      btn.textContent = rarity.label;
      btn.addEventListener("click", () => {
        const selected = new Set(this._rarityFilters);
        if (selected.has(rarity.id)) {
          selected.delete(rarity.id);
          btn.classList.remove("active");
        } else {
          selected.add(rarity.id);
          btn.classList.add("active");
        }
        this._rarityFilters = [...selected];
        this._debouncedUpdateFilters();
      });
      filterDiv.appendChild(btn);
    });

    container.appendChild(filterDiv);
  },

  renderGrid(preFiltered) {
    const grid = document.getElementById("ceOverlapGrid");
    if (!grid) return;
    grid.replaceChildren();

    if (this._allEntries.length === 0) return;

    let filtered = preFiltered || this._getFilteredEntries();

    if (this._selectedCounts.size > 0) {
      filtered = filtered.filter((e) => this._selectedCounts.has(e.entry.matchingCEs.length));
    }

    if (filtered.length === 0) {
      const msg = DOMFactory.el("div", "ceoverlap-empty");
      msg.textContent = "No servants match selected filter.";
      grid.appendChild(msg);
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(({ entry }) => {
      frag.appendChild(this.createServantMiniCard(entry, this._clickedCEIds));
    });
    grid.replaceChildren(frag);
  },

  createServantMiniCard(entry, overlapCEIds) {
    const card = DOMFactory.el("div", "cefilter-servant-card");

    const imgAsc =
      !entry.baseMatchesAll && entry.matchedAscensions && entry.matchedAscensions.length > 0
        ? entry.primaryAscension || entry.matchedAscensions[0]
        : null;
    const imgSrc = imgAsc ? ServantData.getImageForAscension(entry.servant.id, imgAsc) : entry.servant.image;

    const img = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", { alt: entry.servant.name });
    DOMFactory.addAscensionFallback(img, entry.servant.id);
    card.appendChild(img);

    const displayName = imgAsc
      ? ServantData.getAscensionName(entry.servant.id, imgAsc) || entry.servant.name
      : entry.servant.name;
    const nameEl = DOMFactory.el("div", "cefilter-servant-name");
    nameEl.textContent = displayName;
    card.appendChild(nameEl);

    if (!entry.baseMatchesAll && entry.matchedAscensions && entry.matchedAscensions.length > 0) {
      const ascLabel = DOMFactory.el("div", "cefilter-ascension-label");
      ascLabel.textContent = entry.matchedAscensions
        .map((key) => ServantData.getAscensionLabel(entry.servant.id, key))
        .join("\n");
      card.appendChild(ascLabel);
    }

    if (entry.matchingCEs && entry.matchingCEs.length > 0) {
      const badges = DOMFactory.el("div", ["ce-badges", "grid-micro"]);
      entry.matchingCEs.forEach((ce) => {
        const badge = DOMFactory.createLazyImg(
          ce.thumbImage,
          "cefilter-match-badge" + (overlapCEIds.has(ce.id) ? "" : " cefilter-match-badge--nonshared"),
          { alt: ce.name, title: ce.name },
        );
        DOMFactory.addSimpleFallback(badge, "cefilter-match-badge-fallback", ce.id);
        badges.appendChild(badge);
      });
      card.appendChild(badges);
    }

    return card;
  },
};
