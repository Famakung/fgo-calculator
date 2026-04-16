import { CLASS_FILTERS, RARITY_FILTERS } from "./constants.js";
import { TraitMatcher } from "./domain.js";
import { ServantData, CEById, TraitCEs, TraitNames } from "./data.js";
import { DOMFactory, CollapsibleFactory, debounce } from "./presentation.js";

/* === Worker setup for off-thread CE match computation === */
let _worker = null;
let _workerResolve = null;

function getWorker() {
  if (_worker) return _worker;
  try {
    _worker = new Worker("ce-match-worker.min.js");
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
    if (e.data.type === "result" && _workerResolve) {
      const resolve = _workerResolve;
      _workerResolve = null;
      resolve(e.data);
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
}

export const CEFilterApp = {
  state: {
    selectedCEs: [],
    mode: "all",
    searchQuery: "",
    classFilters: [],
    rarityFilters: [],
    matchCounts: [],
    matchCustomCounts: [],
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

    const addBtn = document.getElementById("cefilterAddBtn");
    const modeSelect = document.getElementById("cefilterMode");

    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (this._callbacks.openFilterPicker) this._callbacks.openFilterPicker();
      });
    }

    if (modeSelect) {
      modeSelect.value = this.state.mode;
      modeSelect.addEventListener("change", () => {
        this.state.mode = modeSelect.value;
        this.state.currentPage = 1;
        this.render();
      });
    }

    if (this._callbacks.initFilterPicker) this._callbacks.initFilterPicker();
    if (this._callbacks.initOverlap) this._callbacks.initOverlap();

    // Build collapsible filter area with search, class, rarity, CE count
    const filterArea = document.getElementById("cefilter-filter-area");
    if (filterArea) {
      CollapsibleFactory.populateFilterArea(
        filterArea,
        this.state.searchQuery,
        (query) => {
          this.state.searchQuery = query;
          this.state.currentPage = 1;
          this.render();
        },
        (content) => {
          const classDiv = DOMFactory.el("div", "class-filter");
          classDiv.id = "cefilterClassFilter";
          content.appendChild(classDiv);

          const rarityDiv = DOMFactory.el("div", "rarity-filter");
          rarityDiv.id = "cefilterRarityFilter";
          content.appendChild(rarityDiv);

          const countDiv = DOMFactory.el("div", "ce-count-filter");
          countDiv.id = "cefilterMatchCount";
          content.appendChild(countDiv);
        },
      );
    }

    this.buildClassFilter();
    this.buildRarityFilter();

    initWorker();

    // Render immediately (synchronous computation) for faster first paint
    this.render();
  },

  render() {
    this.renderChips();
    this.buildCustomCountFilter();

    const allMatches = this.computeAllCEMatches();
    this._finishRender(allMatches);
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
    const preFiltered = this._applySearchClassRarity(ceFiltered);
    this.buildMatchCountFilter(preFiltered);
    this.renderResults(ceFiltered);
  },

  _applySearchClassRarity(entries) {
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
    if (this.state.classFilters.length > 0) {
      const classSet = new Set(this.state.classFilters);
      filtered = filtered.filter((s) => s.servant.traits.some((t) => classSet.has(t)));
    }
    if (this.state.rarityFilters.length > 0) {
      const raritySet = new Set(this.state.rarityFilters);
      filtered = filtered.filter((s) => s.servant.traits.some((t) => raritySet.has(t)));
    }
    return filtered;
  },

  buildClassFilter() {
    const container = document.getElementById("cefilterClassFilter");
    if (!container) return;

    const { standard, extra } = CLASS_FILTERS;

    container.replaceChildren();

    const selected = new Set(this.state.classFilters);

    const buildRow = (classes) => {
      classes.forEach((cls) => {
        const btn = DOMFactory.el("div", "class-btn" + (selected.has(cls.id) ? " active" : ""));
        btn.dataset.traitId = cls.id;
        const img = DOMFactory.el("img", "", {
          src: `icons/classes/${cls.icon}.webp`,
          alt: cls.label,
          title: cls.label,
          loading: "lazy",
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
          this.state.classFilters = [...selected];
          this.state.currentPage = 1;
          this._debouncedRender();
        });
        container.appendChild(btn);
      });
    };

    buildRow(standard);
    buildRow(extra);
    this._classBtns = Array.from(container.querySelectorAll(".class-btn"));
  },

  buildRarityFilter() {
    const container = document.getElementById("cefilterRarityFilter");
    if (!container) return;

    const rarities = RARITY_FILTERS;

    container.replaceChildren();
    const selected = new Set(this.state.rarityFilters);

    rarities.forEach((rarity) => {
      const btn = DOMFactory.el("div", "rarity-btn" + (selected.has(rarity.id) ? " active" : ""));
      btn.dataset.traitId = rarity.id;
      btn.textContent = rarity.label;
      btn.addEventListener("click", () => {
        if (selected.has(rarity.id)) {
          selected.delete(rarity.id);
          btn.classList.remove("active");
        } else {
          selected.add(rarity.id);
          btn.classList.add("active");
        }
        this.state.rarityFilters = [...selected];
        this.state.currentPage = 1;
        this._debouncedRender();
      });
      container.appendChild(btn);
    });
    this._rarityBtns = Array.from(container.querySelectorAll(".rarity-btn"));
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

    container.replaceChildren();

    const selected = new Set(this.state.matchCounts);
    const maxCount = Math.max(...availableCounts);

    for (let n = 0; n <= maxCount; n++) {
      if (!availableCounts.has(n)) continue;
      const btn = DOMFactory.el("div", "ce-count-btn" + (selected.has(n) ? " active" : ""));
      btn.textContent = n + " CE";
      btn.addEventListener("click", () => {
        if (selected.has(n)) {
          selected.delete(n);
        } else {
          selected.add(n);
        }
        this.state.matchCounts = [...selected];
        this.state.currentPage = 1;
        this._debouncedRender();
      });
      container.appendChild(btn);
    }
  },

  renderChips() {
    const container = document.getElementById("cefilterChips");
    if (!container) return;
    container.replaceChildren();

    if (this.state.selectedCEs.length === 0) {
      return;
    }

    this.state.selectedCEs.forEach((ceId) => {
      const ce = CEById.get(ceId);
      if (!ce) return;

      const chip = DOMFactory.el("div", "cefilter-chip");

      const img = DOMFactory.createLazyImg(ce.thumbImage, null, { alt: ce.name });
      DOMFactory.addSimpleFallback(img, "cefilter-match-badge-fallback", ce.id);
      chip.appendChild(img);

      const nameSpan = DOMFactory.el("span");
      nameSpan.textContent = ce.name;
      chip.appendChild(nameSpan);

      const removeBtn = DOMFactory.el("button", "cefilter-chip-remove", { type: "button" });
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

    // Hide class/rarity buttons not present in CE-filtered results
    const availableClassIds = new Set();
    const availableRarityIds = new Set();
    base.forEach(({ servant }) => {
      servant.traits.forEach((t) => {
        if (t.startsWith("01")) availableClassIds.add(t);
        if (t.startsWith("04")) availableRarityIds.add(t);
      });
    });
    (this._classBtns || []).forEach((btn) => {
      const avail = availableClassIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });
    (this._rarityBtns || []).forEach((btn) => {
      const avail = availableRarityIds.has(btn.dataset.traitId);
      btn.style.display = avail ? "" : "none";
      if (!avail) btn.classList.remove("active");
    });
    this.state.classFilters = this.state.classFilters.filter((id) => availableClassIds.has(id));
    this.state.rarityFilters = this.state.rarityFilters.filter((id) => availableRarityIds.has(id));

    // Apply search, class, and rarity filters
    let filtered = this._applySearchClassRarity(base);

    // Apply match count filter
    if (this.state.matchCounts.length > 0) {
      const countSet = new Set(this.state.matchCounts);
      filtered = filtered.filter((s) => countSet.has(s.matchingCEs.length));
    }

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

    if (!baseMatchesAll && matchedAscensions.length > 0) {
      const ascLabel = DOMFactory.el("div", "cefilter-ascension-label");
      ascLabel.textContent = matchedAscensions.map((key) => ServantData.getAscensionLabel(servant.id, key)).join("\n");
      card.appendChild(ascLabel);
    }

    if (matchingCEs.length > 0) {
      const badges = DOMFactory.el("div", "cefilter-match-badges");
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

          results.push({
            servant,
            matchingCEs,
            allTraitNames: relevantTraits,
            matchedAscensions: [],
            baseMatchesAll: true,
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
