import { DEBOUNCE_MS } from "./constants.js";
import { Validator, ServantSort, ServantFilters, computeCEMatchMatrix } from "./domain.js";
import { FilterSections, FilterModalController } from "./filter-sections.js";
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
    genderFilters: [],
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

  // The same width staircase as the LCP preload in BaseLayout.astro's head script — keep the two in step.
  _getCols() {
    const w = window.innerWidth;
    return w >= 1120 ? 6 : w >= 940 ? 5 : w >= 760 ? 4 : w >= 580 ? 3 : 2;
  },

  _getPageSize() {
    return this._getCols() * 5;
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

    if (filterBtn) {
      filterBtn.addEventListener("click", () => this._openFilterModal());
    }

    if (filterModalClose) {
      filterModalClose.addEventListener("click", () => this._cancelFilterModal());
    }

    if (filterModal) {
      filterModal.addEventListener("click", (e) => {
        if (e.target === filterModal) this._cancelFilterModal();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && filterModal.classList.contains("open")) {
          this._cancelFilterModal();
        }
      });
    }

    const defaultBtn = document.getElementById("cefilterFilterDefaultBtn");
    if (defaultBtn) {
      defaultBtn.addEventListener("click", () => this._defaultFilterModal());
    }

    const selectAllBtn = document.getElementById("cefilterFilterSelectAllBtn");
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => this._selectAllFilterModal());
    }

    const cancelBtn = document.getElementById("cefilterFilterCancelBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => this._cancelFilterModal());
    }

    const okBtn = document.getElementById("cefilterFilterOkBtn");
    if (okBtn) {
      okBtn.addEventListener("click", () => this._okFilterModal());
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

  warmWorker() {
    initWorker();
  },

  _hydrateMatchResults({ results, index }) {
    results.forEach((entry) => {
      if (!(entry.matchingCEIds instanceof Set)) {
        entry.matchingCEIds = new Set(entry.matchingCEIds);
      }
    });
    this._allCEMatchesCache = results;
    this._ceMatchEntriesIndex = {};
    for (const ceId in index) {
      this._ceMatchEntriesIndex[ceId] = index[ceId] instanceof Set ? index[ceId] : new Set(index[ceId]);
    }
    return results;
  },

  _processWorkerResults(data) {
    this._hydrateMatchResults(data);
  },

  _finishRender(allMatches) {
    const ceFiltered = this.filterByCEs(allMatches);
    this._lastCEFiltered = ceFiltered;
    this.renderResults(ceFiltered);
  },

  /* Search, then every Filter Settings row at once: a row with nothing selected is no filter, and a row
     with something selected must be met by the traits of the ascension this card actually shows. */
  _applyFilters(entries) {
    let filtered = entries;
    const query = (this.state.searchQuery || "").toLowerCase().trim();
    if (query) {
      filtered = filtered.filter((s) =>
        s.servant._search
          ? s.servant._search.includes(query)
          : s.servant.id.toLowerCase().includes(query) ||
            s.servant.name.toLowerCase().includes(query) ||
            ServantData.getAllNames(s.servant.id).some((n) => n.toLowerCase().includes(query)),
      );
    }
    const matcher = ServantFilters.compile(this.state);
    return filtered.filter((s) => matcher(ServantData.getEntryTraitSet(s)));
  },

  /* The eight modal sections, in modal order, on the page the results grid is showing.
     Renders only when the filter modal is actually open. */
  _renderFilterRows(customFilters = null) {
    const filterModal = document.getElementById("cefilterFilterModal");
    if (!filterModal || (!filterModal.classList.contains("open") && !customFilters)) return;

    const filterState = customFilters || this.draftFilters || this.state;
    const base = this._lastCEFiltered || [];
    const avail = { class: new Set(), rarity: new Set(), count: new Set() };
    base.forEach((entry) => {
      avail.count.add(entry.matchingCEs.length);
      this._traitsOf(entry).forEach((t) => {
        if (t.startsWith("01")) avail.class.add(t);
        if (t.startsWith("04")) avail.rarity.add(t);
      });
    });

    const toggle = (key) => (ids) => {
      if (this.draftFilters) {
        this.draftFilters[key] = ids;
        if (key === "groupClassFilters") {
          this._renderFilterRows(this.draftFilters);
        }
      } else {
        this.state[key] = ids;
        this.state.currentPage = 1;
        this._debouncedRender();
      }
    };

    FilterModalController.renderStandardRows("cefilter", filterState, toggle, { avail });

    const maxCeCount = Math.max(5, ...(this._allCEMatchesCache || []).map((r) => r.matchingCEs.length));
    const ceCountChips = [];
    for (let n = 0; n <= maxCeCount; n++) {
      ceCountChips.push({ id: n, value: n, label: n + " CE", count: true });
    }
    const hasCount = (chip) => avail.count.size === 0 || avail.count.has(chip.id);
    FilterSections.renderRow(
      document.getElementById("cefilterMatchCount"),
      ceCountChips,
      filterState.matchCounts,
      toggle("matchCounts"),
      { disabled: (chip) => !hasCount(chip) },
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

  _openFilterModal() {
    const filterModal = document.getElementById("cefilterFilterModal");
    if (!filterModal) return;
    this.draftFilters = FilterModalController.clone(this.state, ["matchCounts"]);
    this._renderFilterRows(this.draftFilters);
    filterModal.classList.add("open");
  },

  _cancelFilterModal() {
    this.draftFilters = null;
    const filterModal = document.getElementById("cefilterFilterModal");
    if (filterModal) filterModal.classList.remove("open");
  },

  _okFilterModal() {
    if (this.draftFilters) {
      Object.assign(this.state, this.draftFilters);
      this.draftFilters = null;
    }
    this.state.currentPage = 1;
    this.render();
    const filterModal = document.getElementById("cefilterFilterModal");
    if (filterModal) filterModal.classList.remove("open");
  },

  _defaultFilterModal() {
    if (!this.draftFilters) return;
    this.draftFilters = { ...FilterModalController.createInitial(), matchCounts: [] };
    this._renderFilterRows(this.draftFilters);
  },

  _selectAllFilterModal() {
    if (!this.draftFilters) return;
    const base = this._lastCEFiltered || [];
    const avail = { class: new Set(), rarity: new Set(), count: new Set() };
    base.forEach((entry) => {
      avail.count.add(entry.matchingCEs.length);
      this._traitsOf(entry).forEach((t) => {
        if (t.startsWith("01")) avail.class.add(t);
        if (t.startsWith("04")) avail.rarity.add(t);
      });
    });

    this.draftFilters = FilterModalController.selectAll(avail, (res) => {
      const maxCeCount = Math.max(5, ...(this._allCEMatchesCache || []).map((r) => r.matchingCEs.length));
      const allCounts = [];
      for (let n = 0; n <= maxCeCount; n++) allCounts.push(n);
      res.matchCounts = allCounts.filter((n) => avail.count.size === 0 || avail.count.has(n));
    });
    this._renderFilterRows(this.draftFilters);
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

    // Grey out class/rarity/count chips not present in CE-filtered results, and re-read what that leaves selected
    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    const availableCounts = new Set();
    base.forEach((entry) => {
      availableCounts.add(entry.matchingCEs.length);
      this._traitsOf(entry).forEach((t) => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });
    this.state.classFilters = this.state.classFilters.filter((id) => availableClassIds.has(id));
    this.state.rarityFilters = this.state.rarityFilters.filter((id) => availableRarityIds.has(id));
    this.state.matchCounts = this.state.matchCounts.filter((n) => availableCounts.has(n));
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
    const cols = this._getCols();

    // Reuse existing placeholder cards from inline script to avoid LCP render delay
    const existingCards = isFirstPage ? grid.querySelectorAll(":scope > .cefilter-servant-card") : null;

    pageSlice.forEach(
      ({ servant, matchingCEs, allTraitNames, matchedAscensions, baseMatchesAll, primaryAscension }, idx) => {
        // Only the first row can be inside the tile. Eager-loading all pageSize cards puts ~100 portraits
        // and CE badges in the same pipe as the chunks that build them, so the LCP portrait queues behind them.
        const cardAttrs = !isFirstPage
          ? {}
          : idx < cols
            ? { loading: "eager", fetchpriority: "high" }
            : { loading: "lazy" };
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

    let portraitEl;
    if (!imgAsc && servant.altImage) {
      portraitEl = DOMFactory.createSwapImg({
        src: imgSrc,
        altSrc: servant.altImage,
        className: "servant-slot-portrait",
        attrs: { alt: servant.name, ...eagerAttrs },
        fallbackId: servant.id,
      });
    } else if (existingCard) {
      // Reuse placeholder img to avoid LCP render delay from re-decode
      const placeholderImg = existingCard.querySelector("img.servant-slot-portrait");
      if (placeholderImg) {
        placeholderImg.src = imgSrc;
        placeholderImg.alt = servant.name;
        if (eagerAttrs.fetchpriority) placeholderImg.fetchPriority = eagerAttrs.fetchpriority;
        if (eagerAttrs.loading) placeholderImg.loading = eagerAttrs.loading;
        portraitEl = placeholderImg;
      }
    }
    if (!portraitEl) {
      portraitEl = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", {
        alt: servant.name,
        ...eagerAttrs,
      });
      DOMFactory.addAscensionFallback(portraitEl, servant.id);
    }
    if (matchingCEs.length > 0) {
      portraitEl.style.cursor = "pointer";
      portraitEl.onclick = () => {
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
      portraitEl.onclick = null;
    }
    card.appendChild(portraitEl);

    const displayName = imgAsc ? ServantData.getAscensionName(servant.id, imgAsc) || servant.name : servant.name;
    const nameEl = DOMFactory.el("div", "cefilter-servant-name");
    if (!imgAsc && servant.altName) {
      DOMFactory.fillSwapName(nameEl, displayName, servant.altName);
    } else {
      nameEl.textContent = displayName;
    }
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
    return ServantData.getEntryTraits(entry);
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
    const matrix = computeCEMatchMatrix(ServantData.servants, TraitCEs, TraitNames);
    return this._hydrateMatchResults(matrix);
  },
};
