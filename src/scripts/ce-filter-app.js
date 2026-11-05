import {
  CLASS_FILTERS,
  CLASS_GROUPS,
  RARITY_FILTERS,
  ALIGNMENT_LNC_FILTERS,
  ALIGNMENT_GBE_FILTERS,
  SUB_ATTR_FILTERS,
  DEBOUNCE_MS,
} from "./constants.js";
import { TraitMatcher, Validator, ServantSort, ServantFilters } from "./domain.js";
import { FilterSections } from "./filter-sections.js";
import { ServantData, CEById, TraitCEs, TraitNames } from "./data.js";
import { DOMFactory, debounce } from "./presentation.js";
import { ServantSelect, CEFilterStore } from "./ce-servant-select.js";

/* The #cefilterMode select's option values; a stored mode outside this list is ignored. */
const CE_MODES = ["all", "any", "custom"];

/* === Worker setup for off-thread CE match computation === */
let _worker = null;
let _workerResolve = null;

function getWorker() {
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL("./ce-match-worker.js", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("Worker creation failed:", e);
    return null;
  }
  _worker.onerror = function (e) {
    console.warn("Worker error:", e.message);
    if (_workerResolve) {
      const resolve = _workerResolve;
      _workerResolve = null;
      resolve(null);
    }
  };
  _worker.onmessage = function (e) {
    if (e.data.type === "result") {
      CEFilterApp._processWorkerResults(e.data);
      if (_workerResolve) {
        const resolve = _workerResolve;
        _workerResolve = null;
        resolve(e.data);
      }
    } else if (e.data.type === "error" && _workerResolve) {
      console.warn("Worker computation error:", e.data.message);
      const resolve = _workerResolve;
      _workerResolve = null;
      resolve(null);
    }
  };
  return _worker;
}

function initWorker() {
  const worker = getWorker();
  if (!worker) return;
  worker.postMessage({
    type: "init",
    servants: ServantData.servants,
    traitCEs: TraitCEs,
    traitNames: TraitNames,
  });
  worker.postMessage({ type: "compute" });
}

export const CEFilterApp = {
  state: {
    subTab: "ce",
    selectedCEs: [],
    mode: "all",
    searchQuery: "",
    classFilters: [],
    rarityFilters: [],
    /* Class (Group) narrows the class row instead of replacing it; the two alignment rows and the
       sub-attribute row are independent ANDed filters like those two. None of these four are persisted —
       like the rest of the rows, they reset on refresh. */
    groupClassFilters: [],
    aliFilters: [],
    subAliFilters: [],
    subAttrFilters: [],
    matchCounts: [],
    matchCustomCounts: [],
    sortBy: "id",
    sortOrder: "asc",
    currentPage: 1,
  },

  _allCEMatchesCache: null,
  _lastCEFiltered: null,
  _initialized: false,
  _debouncedRender: null,
  _callbacks: null,

  _getPageSize() {
    const w = window.innerWidth;
    const cols = w >= 1120 ? 6 : w >= 940 ? 5 : w >= 760 ? 4 : w >= 580 ? 3 : 2;
    return cols * 5;
  },

  init(callbacks) {
    if (this._initialized) return;
    this._initialized = true;
    this._callbacks = callbacks || {};
    this._debouncedRender = debounce(() => this.render(), 50);
    this._loadPicks();

    const addBtn = document.getElementById("cefilterAddBtn");
    const modeSelect = document.getElementById("cefilterMode");
    const sortBySelect = document.getElementById("cefilterSortBy");
    const sortOrderSelect = document.getElementById("cefilterSortOrder");
    const sortOrderToggle = document.getElementById("cefilterSortOrderToggle");

    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (this._callbacks.openFilterPicker) this._callbacks.openFilterPicker();
      });
    }

    const clearBtn = document.getElementById("cefilterClearBtn");
    if (clearBtn) clearBtn.addEventListener("click", () => this.clearAllCEs());

    if (modeSelect) {
      modeSelect.value = this.state.mode;
      modeSelect.addEventListener("change", () => {
        this.state.mode = modeSelect.value;
        this.state.currentPage = 1;
        modeSelect.blur();
        this.render();
      });
    }

    if (sortBySelect) {
      sortBySelect.value = this.state.sortBy;
      sortBySelect.addEventListener("change", () => {
        this.state.sortBy = sortBySelect.value;
        this.state.currentPage = 1;
        sortBySelect.blur();
        this.renderResults(this._lastCEFiltered);
      });
    }

    const updateSortOrderUI = () => {
      const isDesc = this.state.sortOrder === "desc";
      if (sortOrderSelect) sortOrderSelect.value = this.state.sortOrder;
      if (sortOrderToggle) {
        sortOrderToggle.dataset.order = this.state.sortOrder;
        const label = isDesc ? "Sort descending" : "Sort ascending";
        sortOrderToggle.setAttribute("aria-label", label);
        sortOrderToggle.title = label;
        const iconSpan = sortOrderToggle.querySelector(".cefilter-sort-order-icon");
        if (iconSpan) iconSpan.textContent = isDesc ? "\u25BC" : "\u25B2";
      }
    };

    if (sortOrderToggle) {
      updateSortOrderUI();
      sortOrderToggle.addEventListener("click", () => {
        this.state.sortOrder = this.state.sortOrder === "asc" ? "desc" : "asc";
        updateSortOrderUI();
        this.state.currentPage = 1;
        this.renderResults(this._lastCEFiltered);
      });
    }

    if (sortOrderSelect) {
      sortOrderSelect.value = this.state.sortOrder;
      sortOrderSelect.addEventListener("change", () => {
        this.state.sortOrder = sortOrderSelect.value;
        updateSortOrderUI();
        this.state.currentPage = 1;
        this.renderResults(this._lastCEFiltered);
      });
    }

    if (this._callbacks.initFilterPicker) this._callbacks.initFilterPicker();
    if (this._callbacks.initOverlap) this._callbacks.initOverlap();

    // Search input
    const searchInput = document.getElementById("cefilterSearchInput");
    if (searchInput) {
      searchInput.value = this.state.searchQuery || "";
      const debouncedSearch = debounce((query) => {
        this.state.searchQuery = query;
        this.state.currentPage = 1;
        this.render();
      }, DEBOUNCE_MS);
      searchInput.addEventListener("input", (e) => {
        debouncedSearch(e.target.value);
      });
    }

    // Filter modal toggle
    const filterBtn = document.getElementById("cefilterFilterBtn");
    const filterModal = document.getElementById("cefilterFilterModal");
    const filterModalClose = document.getElementById("cefilterFilterModalClose");

    if (filterBtn && filterModal) {
      filterBtn.addEventListener("click", () => {
        filterModal.classList.add("open");
      });
    }

    if (filterModalClose && filterModal) {
      filterModalClose.addEventListener("click", () => {
        filterModal.classList.remove("open");
      });
    }

    if (filterModal) {
      filterModal.addEventListener("click", (e) => {
        if (e.target === filterModal) {
          filterModal.classList.remove("open");
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && filterModal.classList.contains("open")) {
          filterModal.classList.remove("open");
        }
      });
    }

    const subtabs = document.getElementById("cefilterSubtabs");
    if (subtabs) {
      subtabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".cefilter-subtab-btn");
        if (btn) this._switchSubTab(btn.dataset.subtab);
      });
    }

    ServantSelect.init({
      getEntries: () => this.computeAllCEMatches(),
      onSelectCE: (ceId) => this.selectCEFromCombo(ceId),
    });

    this._renderFilterRows();

    initWorker();

    // Render immediately (synchronous computation) for faster first paint. Going through
    // _switchSubTab also restores the saved sub-tab — the markup ships with "ce" visible.
    this._switchSubTab(this.state.subTab);
  },

  selectCEFromCombo(ceId) {
    if (!ceId) return;
    if (!this.state.selectedCEs.includes(ceId)) {
      this.state.selectedCEs.push(ceId);
      this.state.currentPage = 1;
    }
    // _switchSubTab renders, so the CE side paints once with the new selection.
    this._switchSubTab("ce");
  },

  _switchSubTab(sub) {
    if (sub !== "ce" && sub !== "servant") return;
    const changed = this.state.subTab !== sub;
    this.state.subTab = sub;
    // The head script sets this before the body parses; keep it in step with the panels' `hidden`.
    document.documentElement.dataset.subtab = sub;
    // init() calls this on the saved value, so only a real change is worth a write.
    if (changed) CEFilterStore.write({ subTab: sub });

    document.querySelectorAll(".cefilter-subtab-btn").forEach((btn) => {
      const active = btn.dataset.subtab === sub;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    // Each sub-tab owns one panel in the controls card and one in the results card.
    ["ce", "servant"].forEach((name) => {
      document.querySelectorAll(`.cefilter-subpanel[data-subpanel="${name}"]`).forEach((panel) => {
        panel.hidden = name !== sub;
      });
    });

    if (sub === "ce") this.render();
    else ServantSelect.render();
  },

  render() {
    /* Every pick change ends in render(), so this is the only save point — the list is also mutated
       from main.js (picker onApply) and from card badges, which would each need a call otherwise. */
    this._saveState();
    this.renderChips();
    this.buildCustomCountFilter();

    const allMatches = this.computeAllCEMatches();
    this._finishRender(allMatches);
  },

  /* Picks plus the match mode: mode alone would restore chips under "any" that the user left
     filtered by "all". matchCustomCounts, class/rarity filters, search and paging still reset. */
  _saveState() {
    CEFilterStore.write({ cePicks: this.state.selectedCEs, ceMode: this.state.mode });
  },

  _loadPicks() {
    const stored = CEFilterStore.read();
    this.state.selectedCEs = Validator.validatePicks(stored.cePicks).filter((id) => CEById.has(id));
    this.state.mode = CE_MODES.includes(stored.ceMode) ? stored.ceMode : this.state.mode;
    this.state.subTab = stored.subTab === "servant" ? "servant" : "ce";
  },

  _processWorkerResults(data) {
    // Rebuild matchingCEIds as Sets and CE match index
    const { results, index } = data;
    results.forEach((entry) => {
      entry.matchingCEIds = new Set(entry.matchingCEIds);
    });
    this._allCEMatchesCache = results;
    this._ceMatchEntriesIndex = {};
    for (const ceId in index) {
      this._ceMatchEntriesIndex[ceId] = new Set(index[ceId]);
    }
  },

  _finishRender(allMatches) {
    const ceFiltered = this.filterByCEs(allMatches);
    this._lastCEFiltered = ceFiltered;
    const preFiltered = this._applyFilters(ceFiltered);
    this.buildMatchCountFilter(preFiltered);
    this.renderResults(ceFiltered);
  },

  /* Search, then every Filter Settings row at once: a row with nothing selected is no filter, and a row
     with something selected must be met by the traits of the ascension this card actually shows. */
  _applyFilters(entries) {
    let filtered = entries;
    const query = (this.state.searchQuery || "").toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(
        (s) =>
          s.servant.id.toLowerCase().includes(query) ||
          s.servant.name.toLowerCase().includes(query) ||
          ServantData.getAllNames(s.servant.id).some((n) => n.toLowerCase().includes(query)),
      );
    }
    return filtered.filter((s) => ServantFilters.match(this._traitsOf(s), this.state));
  },

  /* The classes the Class row may offer. A group is the whole row when no class is picked inside it, and
     clips back to the pick when one is — the same rule `ServantFilters` matches on. */
  _classScope() {
    return ServantFilters.rowScope(this.state.groupClassFilters);
  },

  /* The six trait rows, in modal order, on the page the results grid is showing: a class or rarity nobody
     in the CE-filtered results has is hidden, and a class outside the chosen group is greyed rather than
     removed, so the row cannot be escaped by accident and comes back whole when the group is cleared. */
  _renderFilterRows() {
    const base = this._lastCEFiltered || [];
    const avail = { class: new Set(), rarity: new Set() };
    base.forEach((entry) => {
      this._traitsOf(entry).forEach((t) => {
        if (t.startsWith("01")) avail.class.add(t);
        if (t.startsWith("04")) avail.rarity.add(t);
      });
    });
    const has = (set, chip) => set.size === 0 || set.has(chip.id);
    const scope = this._classScope();
    const toggle = (key) => (ids) => {
      this.state[key] = ids;
      this.state.currentPage = 1;
      this._debouncedRender();
    };

    FilterSections.renderRow(
      document.getElementById("cefilterRarityFilter"),
      RARITY_FILTERS,
      this.state.rarityFilters,
      toggle("rarityFilters"),
      {
        disabled: (chip) => !has(avail.rarity, chip),
      },
    );
    FilterSections.renderRow(
      document.getElementById("cefilterClassFilter"),
      [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra],
      this.state.classFilters,
      toggle("classFilters"),
      { disabled: (chip) => !has(avail.class, chip) || (scope !== null && !scope.includes(chip.id)) },
    );
    FilterSections.renderRow(
      document.getElementById("cefilterGroupFilter"),
      CLASS_GROUPS.map((g) => ({ id: g.key, label: g.label, group: true })),
      this.state.groupClassFilters,
      toggle("groupClassFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("cefilterAliFilter"),
      ALIGNMENT_LNC_FILTERS,
      this.state.aliFilters,
      toggle("aliFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("cefilterSubAliFilter"),
      ALIGNMENT_GBE_FILTERS,
      this.state.subAliFilters,
      toggle("subAliFilters"),
    );
    FilterSections.renderRow(
      document.getElementById("cefilterAttrFilter"),
      SUB_ATTR_FILTERS,
      this.state.subAttrFilters,
      toggle("subAttrFilters"),
    );
  },

  filterByCEs(results) {
    const selectedCEObjs = this.state.selectedCEs.map((id) => CEById.get(id)).filter((ce) => ce != null);

    if (selectedCEObjs.length === 0) return results;

    const selectedIds = new Set(selectedCEObjs.map((c) => c.id));
    if (this.state.mode === "all") {
      return results.filter((entry) => selectedCEObjs.every((sel) => entry.matchingCEIds.has(sel.id)));
    }
    if (this.state.mode === "any") {
      return results.filter((entry) => entry.matchingCEs.some((m) => selectedIds.has(m.id)));
    }
    // "custom" mode — filter by how many selected CEs match
    const matchCustomCounts = this.state.matchCustomCounts;
    const customCountSet = new Set(matchCustomCounts);
    return results.filter((entry) => {
      const matchedCount = selectedCEObjs.filter((sel) => entry.matchingCEIds.has(sel.id)).length;
      if (matchCustomCounts.length > 0) {
        return customCountSet.has(matchedCount);
      }
      return matchedCount > 0;
    });
  },

  buildCustomCountFilter() {
    const container = document.getElementById("cefilterCustomCount");
    if (!container) return;

    const ceCount = this.state.selectedCEs.length;
    const isCustom = this.state.mode === "custom";

    if (!isCustom || ceCount < 2) {
      container.replaceChildren();
      container.classList.remove("visible");
      this.state.matchCustomCounts = [];
      return;
    }

    container.classList.add("visible");
    container.replaceChildren();

    const maxCount = ceCount;

    // Remove stale selections
    this.state.matchCustomCounts = this.state.matchCustomCounts.filter((n) => n >= 1 && n <= maxCount);

    const selected = new Set(this.state.matchCustomCounts);

    for (let n = 1; n <= maxCount; n++) {
      const btn = DOMFactory.el("div", "ce-count-btn" + (selected.has(n) ? " active" : ""));
      btn.textContent = n;
      btn.addEventListener("click", () => {
        if (selected.has(n)) {
          selected.delete(n);
        } else {
          selected.add(n);
        }
        this.state.matchCustomCounts = [...selected];
        this.state.currentPage = 1;
        this._debouncedRender();
      });
      container.appendChild(btn);
    }
  },

  buildMatchCountFilter(ceFiltered) {
    const container = document.getElementById("cefilterMatchCount");
    if (!container) return;

    const availableCounts = new Set(ceFiltered.map((r) => r.matchingCEs.length));
    if (availableCounts.size === 0) {
      container.replaceChildren();
      return;
    }

    // Remove stale selections
    this.state.matchCounts = this.state.matchCounts.filter((n) => availableCounts.has(n));

    /* One chip per count that actually occurs: the row is built from the results, so a count nobody
       reaches is never offered, and the ceiling follows however many CEs are picked. */
    const maxCount = Math.max(...availableCounts);
    const chips = [];
    for (let n = 0; n <= maxCount; n++) {
      if (!availableCounts.has(n)) continue;
      chips.push({ id: n, value: n, label: n + " CE", count: true });
    }
    FilterSections.renderRow(container, chips, this.state.matchCounts, (counts) => {
      this.state.matchCounts = counts;
      this.state.currentPage = 1;
      this._debouncedRender();
    });
  },

  /* Bulk empty of the selected CEs — the same contract as ServantSelect.clearAll(): the label
     carries the count, and clearing re-paginates instead of stranding the old page. */
  clearAllCEs() {
    if (this.state.selectedCEs.length === 0) return;
    this.state.selectedCEs = [];
    this.state.currentPage = 1;
    this.render();
  },

  renderChips() {
    const container = document.getElementById("cefilterChips");
    if (!container) return;
    container.replaceChildren();

    const clearBtn = document.getElementById("cefilterClearBtn");
    if (clearBtn) {
      const count = this.state.selectedCEs.length;
      clearBtn.hidden = count === 0;
      clearBtn.textContent = count > 0 ? `Clear all (${count})` : "Clear all";
    }

    if (this.state.selectedCEs.length === 0) {
      return;
    }

    this.state.selectedCEs.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;

      const chip = DOMFactory.el("div", ["cefilter-chip", "flex-row"]);

      const img = DOMFactory.createLazyImg(ce.thumbImage, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      chip.appendChild(img);

      const removeBtn = DOMFactory.el("button", ["cefilter-chip-remove", "flex-row"], {
        type: "button",
        "aria-label": `Remove ${ce.name}`,
      });
      removeBtn.textContent = "\u2715";
      removeBtn.addEventListener("click", () => {
        this.state.selectedCEs = this.state.selectedCEs.filter((id) => id !== ceId);
        this.state.currentPage = 1;
        this.render();
      });
      chip.appendChild(removeBtn);

      container.appendChild(chip);
    });
  },

  renderResults(ceFiltered) {
    const grid = document.getElementById("cefilterResults");
    const modeSelect = document.getElementById("cefilterMode");
    const modeRow = document.querySelector(".cefilter-mode-row");
    if (!grid) return;

    const selectedCEObjs = this.state.selectedCEs.map((id) => CEById.get(id)).filter((ce) => ce != null);

    if (selectedCEObjs.length >= 2) {
      if (modeRow) modeRow.style.display = "flex";
    } else {
      if (modeRow) modeRow.style.display = "none";
      if (this.state.mode !== "all") {
        this.state.mode = "all";
        if (modeSelect) modeSelect.value = "all";
      }
    }

    const base = ceFiltered || this._lastCEFiltered || [];

    // Hide class/rarity chips not present in CE-filtered results, and re-read what that leaves selected
    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    base.forEach((entry) => {
      this._traitsOf(entry).forEach((t) => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });
    this.state.classFilters = this.state.classFilters.filter((id) => availableClassIds.has(id));
    this.state.rarityFilters = this.state.rarityFilters.filter((id) => availableRarityIds.has(id));
    this._renderFilterRows();

    // Apply search and every Filter Settings row
    let filtered = this._applyFilters(base);

    // Apply match count filter
    if (this.state.matchCounts.length > 0) {
      const countSet = new Set(this.state.matchCounts);
      filtered = filtered.filter((s) => countSet.has(s.matchingCEs.length));
    }

    // Apply sorting
    filtered = this._sortEntries(filtered);

    const pageSize = this._getPageSize();
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (this.state.currentPage > totalPages) {
      this.state.currentPage = totalPages;
    }
    const pageStart = (this.state.currentPage - 1) * pageSize;
    const pageSlice = filtered.slice(pageStart, pageStart + pageSize);

    const frag = document.createDocumentFragment();
    const isFirstPage = this.state.currentPage === 1;
    const eagerAttrs = isFirstPage ? { loading: "eager" } : {};
    let isFirstCard = isFirstPage;

    // Reuse existing placeholder cards from inline script to avoid LCP render delay
    const existingCards = isFirstPage ? grid.querySelectorAll(":scope > .cefilter-servant-card") : null;

    pageSlice.forEach(
      ({ servant, matchingCEs, allTraitNames, matchedAscensions, baseMatchesAll, primaryAscension }, idx) => {
        const cardAttrs = isFirstCard ? { ...eagerAttrs, fetchpriority: "high" } : eagerAttrs;
        isFirstCard = false;
        const existing = existingCards && existingCards[idx];
        frag.appendChild(
          this._buildCard(
            { servant, matchingCEs, allTraitNames, matchedAscensions, baseMatchesAll, primaryAscension },
            cardAttrs,
            existing,
          ),
        );
      },
    );

    grid.replaceChildren(frag);
    this._renderPagination(totalPages);
  },

  _buildCard(
    { servant, matchingCEs, allTraitNames, matchedAscensions, baseMatchesAll, primaryAscension },
    eagerAttrs,
    existingCard,
  ) {
    const card = DOMFactory.el("div", "cefilter-servant-card");

    const imgAsc = !baseMatchesAll && matchedAscensions.length > 0 ? primaryAscension || matchedAscensions[0] : null;
    const imgSrc = imgAsc ? ServantData.getImageForAscension(servant.id, imgAsc) : servant.image;

    let img;
    if (existingCard) {
      // Reuse placeholder img to avoid LCP render delay from re-decode
      const placeholderImg = existingCard.querySelector("img.servant-slot-portrait");
      if (placeholderImg) {
        img = placeholderImg;
        img.src = imgSrc;
        img.alt = servant.name;
        if (eagerAttrs.fetchpriority) img.fetchPriority = eagerAttrs.fetchpriority;
        if (eagerAttrs.loading) img.loading = eagerAttrs.loading;
      }
    }
    if (!img) {
      img = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", {
        alt: servant.name,
        ...eagerAttrs,
      });
    }
    DOMFactory.addAscensionFallback(img, servant.id);
    if (matchingCEs.length > 0) {
      img.style.cursor = "pointer";
      img.onclick = () => {
        if (this._callbacks.openOverlap) {
          this._callbacks.openOverlap({
            servant,
            matchingCEs,
            allTraitNames,
            matchedAscensions,
            baseMatchesAll,
            primaryAscension,
          });
        }
      };
    } else {
      img.onclick = null;
    }
    card.appendChild(img);

    const displayName = imgAsc ? ServantData.getAscensionName(servant.id, imgAsc) || servant.name : servant.name;
    const nameEl = DOMFactory.el("div", "cefilter-servant-name");
    nameEl.textContent = displayName;
    card.appendChild(nameEl);

    const spiritronLabel = ServantData.getSpiritronLabel(servant.id, matchingCEs, matchedAscensions, baseMatchesAll);
    const labelParts = (matchedAscensions || []).map((key) => ServantData.getAscensionLabel(servant.id, key));
    if (spiritronLabel) labelParts.push(spiritronLabel);
    if (labelParts.length > 0) {
      const ascLabel = DOMFactory.el("div", "cefilter-ascension-label");
      ascLabel.textContent = labelParts.join("\n");
      card.appendChild(ascLabel);
    }

    if (matchingCEs.length > 0) {
      const badges = DOMFactory.el("div", ["ce-badges", "grid-micro"]);
      matchingCEs.forEach((ce) => {
        const badge = DOMFactory.createLazyImg(ce.thumbImage, "cefilter-match-badge", {
          alt: ce.name,
          title: ce.name,
          ...eagerAttrs,
        });
        DOMFactory.addSimpleFallback(badge, "cefilter-match-badge-fallback", ce.id);
        badge.style.cursor = "pointer";
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!this.state.selectedCEs.includes(ce.id)) {
            this.state.selectedCEs.push(ce.id);
            this.state.currentPage = 1;
            this.render();
          }
        });
        badges.appendChild(badge);
      });
      card.appendChild(badges);
    }

    return card;
  },

  _renderPagination(totalPages) {
    ["cefilterPaginationTop", "cefilterPaginationBottom"].forEach((id) => {
      const container = document.getElementById(id);
      if (!container) return;
      container.replaceChildren();

      const currentPage = this.state.currentPage;
      const frag = document.createDocumentFragment();

      const prevBtn = DOMFactory.el("button", "cefilter-page-btn", { type: "button" });
      prevBtn.textContent = "\u2039";
      prevBtn.setAttribute("aria-label", "Previous page");
      if (currentPage <= 1) {
        prevBtn.disabled = true;
      } else {
        prevBtn.addEventListener("click", () => {
          this.state.currentPage = currentPage - 1;
          this.renderResults(this._lastCEFiltered);
        });
      }
      frag.appendChild(prevBtn);

      const indicator = DOMFactory.el("span", "cefilter-page-indicator");
      indicator.textContent = `${currentPage} / ${totalPages}`;
      frag.appendChild(indicator);

      const nextBtn = DOMFactory.el("button", "cefilter-page-btn", { type: "button" });
      nextBtn.textContent = "\u203a";
      nextBtn.setAttribute("aria-label", "Next page");
      if (currentPage >= totalPages) {
        nextBtn.disabled = true;
      } else {
        nextBtn.addEventListener("click", () => {
          this.state.currentPage = currentPage + 1;
          this.renderResults(this._lastCEFiltered);
        });
      }
      frag.appendChild(nextBtn);

      container.replaceChildren(frag);
    });
  },

  /* A result card is a servant plus the ascension its traits were matched on, and that list is what both
     the sort keys and every filter row reads. With no ascension named the card shows no single form, so it
     reads every form: a sub-attribute that arrives with an ascension (415's Earth, from her 3rd) is not on
     `servant.traits`, which is the intersection of her stages. */
  _traitsOf(entry) {
    const traits = entry.primaryAscension
      ? ServantData.getTraitsForAscension(entry.servant.id, entry.primaryAscension)
      : ServantData.getAllTraits(entry.servant.id);
    return traits || ServantData.getAllTraits(entry.servant.id);
  },

  _sortEntries(entries) {
    return ServantSort.sorted(
      entries,
      this.state.sortBy,
      this.state.sortOrder,
      (entry) => entry.servant.id,
      (entry) => this._traitsOf(entry),
    );
  },

  computeAllCEMatches() {
    if (this._allCEMatchesCache) return this._allCEMatchesCache;
    const traitCEs = TraitCEs;
    const relevantTraitIds = new Set();
    traitCEs.forEach((ce) => {
      ce.traits.forEach((t) => relevantTraitIds.add(t));
      ce.traitGroups.forEach((group) => group.forEach((t) => relevantTraitIds.add(t)));
    });

    const results = [];

    ServantData.servants.forEach((servant) => {
      const traitSets = TraitMatcher.getAllTraitSets(servant);

      if (!servant.hasAscensions) {
        const matchingCEs = traitCEs.filter((ce) => TraitMatcher.matches(servant.traitSet, ce));

        const relevantTraits = servant.traits.filter((t) => relevantTraitIds.has(t)).map((t) => TraitNames[t] || t);

        results.push({
          servant,
          matchingCEs,
          allTraitNames: relevantTraits,
          matchedAscensions: [],
          baseMatchesAll: true,
          matchingCEIds: new Set(matchingCEs.map((c) => c.id)),
        });
      } else {
        const ascResults = traitSets.map((set) => ({
          key: set.key,
          traits: set.traits,
          matchingCEs: traitCEs.filter((ce) => TraitMatcher.matches(set.traitSet, ce)),
        }));

        const groups = new Map();
        ascResults.forEach((ar) => {
          const key = ar.matchingCEs
            .map((c) => c.id)
            .sort()
            .join(",");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(ar);
        });

        const nonEmptyGroups = [...groups.entries()].filter(([_, entries]) => entries[0].matchingCEs.length > 0);
        if (nonEmptyGroups.length === 0) {
          results.push({
            servant,
            matchingCEs: [],
            allTraitNames: [],
            matchedAscensions: [],
            baseMatchesAll: true,
            matchingCEIds: new Set(),
          });
          return;
        }

        if (nonEmptyGroups.length === 1) {
          const entries = nonEmptyGroups[0][1];
          const matchingCEs = entries[0].matchingCEs;
          const mergedTraits = [...new Set(entries.flatMap((e) => e.traits))];
          const relevantTraits = mergedTraits.filter((t) => relevantTraitIds.has(t)).map((t) => TraitNames[t] || t);
          // A single group can still be partial: e.g. a spiritron CE (2780 is in
          // every base trait set) matches 000-002 but not the costume stage 300.
          const ascKeys = entries.map((e) => e.key);
          const partialMatch = traitSets.length > entries.length;

          results.push({
            servant,
            matchingCEs,
            allTraitNames: relevantTraits,
            matchedAscensions: partialMatch ? ascKeys : [],
            baseMatchesAll: !partialMatch,
            primaryAscension: partialMatch ? ascKeys[0] : undefined,
            matchingCEIds: new Set(matchingCEs.map((c) => c.id)),
          });
        } else {
          nonEmptyGroups.forEach(([_, entries]) => {
            const matchingCEs = entries[0].matchingCEs;
            const ascKeys = entries.map((e) => e.key);
            const mergedTraits = [...new Set(entries.flatMap((e) => e.traits))];
            const relevantTraits = mergedTraits.filter((t) => relevantTraitIds.has(t)).map((t) => TraitNames[t] || t);

            results.push({
              servant,
              matchingCEs,
              allTraitNames: relevantTraits,
              matchedAscensions: ascKeys,
              baseMatchesAll: false,
              primaryAscension: ascKeys[0],
              matchingCEIds: new Set(matchingCEs.map((c) => c.id)),
            });
          });
        }
      }
    });

    this._allCEMatchesCache = results;

    // Build CE->entry index for CEFilterPicker overlap detection
    this._ceMatchEntriesIndex = {};
    results.forEach((entry, idx) => {
      entry.matchingCEs.forEach((ce) => {
        if (!this._ceMatchEntriesIndex[ce.id]) this._ceMatchEntriesIndex[ce.id] = new Set();
        this._ceMatchEntriesIndex[ce.id].add(idx);
      });
    });

    return results;
  },
};
