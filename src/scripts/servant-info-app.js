import { CLASS_FILTERS, DEBOUNCE_MS, IMAGE_VERSION } from "./constants.js";
import { ServantData } from "./data.js";
import { ServantFilters, ServantSort } from "./domain.js";
import { FilterModalController } from "./filter-sections.js";
import { DOMFactory, debounce } from "./presentation.js";

/* ============================================
   CONSTANTS & TRANSLATION HELPERS
   ============================================ */

const KNOWN_CLASS_ICONS = new Set([...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra].map((c) => c.icon));

const OPTION_TRANSLATIONS = {
  消費しない: "Do not expend",
  "10個消費する": "Expend 10 Critical Stars",
  "20個消費する": "Expend 20 Critical Stars",
  "30個消費する": "Expend 30 Critical Stars",
  "月下(全体タイプ)": "Under the Moonlight (AOE)",
  "日輪(単体タイプ)": "Under the Sunlight (Single-Target)",
  "威力アップ〔天の力〕": "STR Up [Heaven]",
  "威力アップ〔地の力〕": "STR Up [Earth]",
  "威力アップ〔人の力〕": "STR Up [Human]",
  入れ替えない: "Do not switch",
  入れ替える: "Switch",
  Normal: "Normal",
  "When loaded with the Holy Sword": "When loaded with the Holy Sword",
  聖剣装填時: "When loaded with the Holy Sword",
  ストレンジドレス: "Strange Dress",
  "簡易霊衣：ストレンジドレス": "Spiritron Dress: Strange Dress",
  "常夏の水着Ver.03": "Swimsuit of Everlasting Summer Ver. 03",
  "簡易霊衣：常夏の水着Ver.03": "Simple Spiritron Dress: Swimsuit of Everlasting Summer Ver. 03",
  "レッドフード＆ビッグバッドウルフ": "Red Hood & Big Bad Wolf",
  "アトランティス・スタイル": "Atlantis Style",
  地球大統領: "Earth President",
  "ブラッディ・バニー": "Bloody Bunny",
  夏の銀騎士: "Silver Knight of Summer",
  ヴァンプ武者: "Vampire Warrior",
  白の虎徹: "White Kotetsu",
  夏の奇兵隊: "Summer Kiheitai",
  "西の王、突如の目覚め！": "The Western King's Sudden Awakening!",
  "ディノス・ウィッチ": "Deinos Witch",
  "笠・オフ・Re/Q": "Hat Off Re/Q",
  "リラクシング・ダンテ": "Relaxing Dante",
  シーサー着ぐるみパーカー: "Shisa Onesie Hoodie",
  切り裂きゾンビナース: "Zombie Nurse the Ripper",
  "ビビッド・サマー": "Vivid Summer",
  笠無し彦斎: "Hatless Gensai",
  "ボンバー☆ギャル": "Bomber☆Gal",
  "メイク無し（第一再臨）": "No Makeup (First Ascension)",
};

function formatNumber(val) {
  if (val === null || val === undefined || val === "") return "-";
  const num = Number(String(val).replace(/,/g, ""));
  return isNaN(num) ? String(val) : num.toLocaleString();
}

function getRarityStars(rarity) {
  const r = parseInt(rarity, 10) || 0;
  return r > 0 ? "\u2605".repeat(r) : "0\u2605";
}

function getRarityBadgeClass(rarity) {
  const r = parseInt(rarity, 10) || 0;
  if (r >= 4) return "badge-rarity-gold";
  if (r === 3) return "badge-rarity-silver";
  if (r >= 1) return "badge-rarity-bronze";
  return "badge-rarity-0";
}

function resolveClassIconKey(className) {
  if (!className) return null;
  const key = String(className).toLowerCase().replace(/\s+/g, "");
  if (key.startsWith("beast") || key === "olgamarie") return "beast";
  if (key === "loregrandcaster") return "caster";
  return KNOWN_CLASS_ICONS.has(key) ? key : null;
}

function formatServantNo(collectionNo, id) {
  return collectionNo > 0 ? `No.${String(collectionNo).padStart(3, "0")}` : `ID.${id}`;
}

function translateOptionLabel(rawLabel) {
  if (!rawLabel) return rawLabel;
  const clean = rawLabel.trim();
  const stripped = clean.replace(/^\[+|\]+$/g, "").trim();
  if (OPTION_TRANSLATIONS[clean]) return OPTION_TRANSLATIONS[clean];
  if (OPTION_TRANSLATIONS[stripped]) return OPTION_TRANSLATIONS[stripped];
  const starMatch = clean.match(/^(\d+)個消費する$/) || stripped.match(/^(\d+)個消費する$/);
  if (starMatch) return `Expend ${starMatch[1]} Critical Stars`;
  return clean;
}

function getFormDisplayLabel(form) {
  if (!form) return "";
  let lbl = (form.label || form.name || "").trim();
  if (OPTION_TRANSLATIONS[lbl]) return OPTION_TRANSLATIONS[lbl];
  let stripped = lbl.replace(/^\[+|\]+$/g, "").trim();
  if (OPTION_TRANSLATIONS[stripped]) return OPTION_TRANSLATIONS[stripped];
  if (/^If\s+/i.test(stripped)) stripped = stripped.replace(/^If\s+/i, "").trim();
  if (OPTION_TRANSLATIONS[stripped]) return OPTION_TRANSLATIONS[stripped];
  if (/^If\s+/i.test(lbl)) lbl = lbl.replace(/^If\s+/i, "").trim();
  if (OPTION_TRANSLATIONS[lbl]) return OPTION_TRANSLATIONS[lbl];

  const formNumMatch = lbl.match(/^Form\s+(\d+)$/i);
  if (formNumMatch) {
    if (form.metaLines && form.metaLines.length > 0) {
      let card = "";
      let type = "";
      if (form.metaLines.some((m) => /^Arts\b/i.test(m))) card = "Arts";
      else if (form.metaLines.some((m) => /^Buster\b/i.test(m))) card = "Buster";
      else if (form.metaLines.some((m) => /^Quick\b/i.test(m))) card = "Quick";

      if (form.metaLines.some((m) => /\bSingle-Target\b/i.test(m))) type = "Single-Target";
      else if (form.metaLines.some((m) => /\bAOE\b/i.test(m))) type = "AOE";
      else if (form.metaLines.some((m) => /\bSpecial\b|\bSupport\b/i.test(m))) type = "Special";

      if (card && type) return `${card} ${type}`;
      if (card) return card;
      if (type) return type;
    }
    return `[ Form ${formNumMatch[1]} ]`;
  }

  const finalLabel = stripped || lbl;
  return /^If\s+/i.test(finalLabel) ? finalLabel.replace(/^If\s+/i, "").trim() : finalLabel;
}

function parseSkillOptions(rawEffects) {
  if (!rawEffects || !Array.isArray(rawEffects)) {
    return { hasOptions: false, options: [] };
  }

  let headerOptions = [];
  let hasSelectHeader = false;
  const cleanLines = [];

  rawEffects.forEach((line) => {
    const headerMatch = line.match(/^Select\s+\d+\s+Options(?:\s*\((.+?)\))?/i);
    if (headerMatch) {
      hasSelectHeader = true;
      if (headerMatch[1]) {
        const rawTags = [...headerMatch[1].matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
        if (rawTags.length > 0) headerOptions = rawTags;
      }
    } else {
      cleanLines.push(line);
    }
  });

  const tagsFound = [];
  cleanLines.forEach((line) => {
    const m = line.match(/^\[([^[\]]+)\]\s+/);
    if (m) {
      const tag = m[1].trim();
      if (
        tag.toLowerCase() !== "demerit" &&
        !tag.toLowerCase().startsWith("usable only when") &&
        !tagsFound.includes(tag)
      ) {
        tagsFound.push(tag);
      }
    }
  });

  if (!hasSelectHeader && tagsFound.length === 0 && !cleanLines.some((t) => /^Option\s+\d+/i.test(t))) {
    return { hasOptions: false, options: [] };
  }

  let optionRaws = [];
  if (headerOptions.length >= 2) {
    optionRaws = headerOptions;
  } else if (tagsFound.length >= 2) {
    optionRaws = tagsFound;
  } else if (tagsFound.length === 1) {
    const singleTag = tagsFound[0];
    const opt1 = singleTag === "10個消費する" || singleTag.includes("消費") ? "消費しない" : "Option 1";
    optionRaws = [opt1, singleTag];
  } else if (hasSelectHeader) {
    optionRaws = ["Option 1", "Option 2"];
  }

  if (optionRaws.length < 2) {
    return { hasOptions: false, options: [] };
  }

  const options = optionRaws.map((raw, idx) => ({
    idx,
    raw,
    label: translateOptionLabel(raw || `Option ${idx + 1}`),
    effects: [],
  }));

  cleanLines.forEach((line) => {
    let matchedOptIdx = -1;
    let strippedLine = line;

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (opt.raw && line.startsWith(`[${opt.raw}]`)) {
        matchedOptIdx = i;
        strippedLine = line.replace(`[${opt.raw}]`, "").trim();
        break;
      }
      const optRegex = new RegExp(`^\\[Option\\s+${i + 1}\\]\\s*`, "i");
      if (optRegex.test(line)) {
        matchedOptIdx = i;
        strippedLine = line.replace(optRegex, "").trim();
        break;
      }
    }

    if (matchedOptIdx >= 0) {
      options[matchedOptIdx].effects.push(strippedLine);
    } else {
      options.forEach((opt) => opt.effects.push(line));
    }
  });

  return { hasOptions: true, options };
}

function appendHighlightedEffect(container, text) {
  const str = String(text || "");
  const tokenRegex = /(\[Demerit\]|<effect increases with [^>]+>)/g;
  let lastIdx = 0;
  let match;

  while ((match = tokenRegex.exec(str)) !== null) {
    if (match.index > lastIdx) {
      container.appendChild(document.createTextNode(str.slice(lastIdx, match.index)));
    }
    const token = match[0];
    if (token === "[Demerit]") {
      const tag = DOMFactory.el("span", "f-demerit-tag");
      tag.textContent = "Demerit";
      container.appendChild(tag);
    } else {
      const note = DOMFactory.el("em", "f-overcharge-note");
      note.textContent = token;
      container.appendChild(note);
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < str.length) {
    container.appendChild(document.createTextNode(str.slice(lastIdx)));
  }
}

function getTargetStageForAscensionForm(formLabel) {
  if (!formLabel) return "1";
  const lbl = formLabel.toLowerCase();
  if (/\b3rd\b/i.test(lbl) && !/\b1st\s*&\s*3rd\b/i.test(lbl)) return "3";
  if (/\b4th\b|\bfinal\b/i.test(lbl)) return "4";
  if (/\b2nd\b/i.test(lbl) && !/\b1st&2nd\b/i.test(lbl) && !/\b1st\s*&\s*2nd\b/i.test(lbl)) return "2";
  return "1";
}

function getMatchingButtonForStage(buttonGroup, stageStr) {
  const btns = Array.from(buttonGroup.querySelectorAll(".f-option-btn"));
  if (btns.length === 0) return null;
  const stage = String(stageStr);

  for (const btn of btns) {
    const lbl = (btn.dataset.formLabel || btn.textContent || "").toLowerCase();
    if (stage === "1" && /\b1st\b/i.test(lbl)) return btn;
    if (stage === "2" && (/\b2nd\b/i.test(lbl) || /\b1st&2nd\b/i.test(lbl) || /\b1st\s*&\s*2nd\b/i.test(lbl))) {
      return btn;
    }
    if (stage === "3" && /\b3rd\b/i.test(lbl)) return btn;
    if (stage === "4" && /\b4th\b|\bfinal\b/i.test(lbl)) return btn;
  }

  if (stage === "4") {
    for (const btn of btns) {
      const lbl = (btn.dataset.formLabel || btn.textContent || "").toLowerCase();
      if (/\b3rd\b/i.test(lbl)) return btn;
    }
  }

  if (stage === "2") {
    for (const btn of btns) {
      const lbl = (btn.dataset.formLabel || btn.textContent || "").toLowerCase();
      if (/\b1st\b/i.test(lbl)) return btn;
    }
  }

  return btns[0];
}

function getVariantByTier(slot, tier) {
  if (!slot || !slot.variantsByTier) return null;
  return (
    slot.variantsByTier[String(tier)] ||
    slot.variantsByTier[tier] ||
    slot.variantsByTier["0"] ||
    slot.variantsByTier[0] ||
    Object.values(slot.variantsByTier)[0]
  );
}

/* ============================================
   SERVANT INFO APPLICATION
   ============================================ */

export const ServantInfoApp = {
  state: {
    searchQuery: "",
    classFilters: [],
    rarityFilters: [],
    groupClassFilters: [],
    aliFilters: [],
    subAliFilters: [],
    subAttrFilters: [],
    genderFilters: [],
    sortBy: "id",
    sortOrder: "asc",
    currentPage: 1,
  },

  _initialized: false,
  _lastFiltered: [],
  _draftFilters: null,
  _infoCache: new Map(),
  _activeRequestId: 0,
  _modalOpener: null,
  _modalState: null,

  _getCols() {
    const w = window.innerWidth;
    return w >= 1120 ? 6 : w >= 940 ? 5 : w >= 760 ? 4 : w >= 580 ? 3 : 2;
  },

  _getPageSize() {
    return this._getCols() * 5;
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;

    this._bindControls();
    this._bindFilterModal();
    this._bindDetailModal();
    this.render();
  },

  _bindControls() {
    const searchInput = document.getElementById("servantInfoSearchInput");
    const sortSelect = document.getElementById("servantInfoSortSelect");
    const sortDirBtn = document.getElementById("servantInfoSortDirBtn");

    if (searchInput) {
      searchInput.value = this.state.searchQuery;

      const debouncedSearch = debounce((query) => {
        this.state.searchQuery = query;
        this.state.currentPage = 1;
        this.render();
      }, DEBOUNCE_MS);

      searchInput.addEventListener("input", (e) => {
        debouncedSearch(e.target.value);
      });
    }

    if (sortSelect) {
      sortSelect.value = this.state.sortBy;
      sortSelect.addEventListener("change", () => {
        this.state.sortBy = sortSelect.value;
        this.state.currentPage = 1;
        sortSelect.blur();
        this.render();
      });
    }

    const updateSortDirUI = () => {
      if (!sortDirBtn) return;
      const isDesc = this.state.sortOrder === "desc";
      const label = isDesc ? "Sort descending" : "Sort ascending";
      sortDirBtn.dataset.order = this.state.sortOrder;
      sortDirBtn.setAttribute("aria-label", label);
      sortDirBtn.title = label;
      const iconSpan = sortDirBtn.querySelector(".cefilter-sort-order-icon");
      if (iconSpan) iconSpan.textContent = isDesc ? "\u25BC" : "\u25B2";
      else sortDirBtn.textContent = isDesc ? "\u25BC" : "\u25B2";
    };

    if (sortDirBtn) {
      updateSortDirUI();
      sortDirBtn.addEventListener("click", () => {
        this.state.sortOrder = this.state.sortOrder === "asc" ? "desc" : "asc";
        updateSortDirUI();
        this.state.currentPage = 1;
        this.render();
      });
    }
  },

  _bindFilterModal() {
    const filterBtn = document.getElementById("servantInfoFilterBtn");
    const modal = document.getElementById("servantInfoFilterModal");
    const closeBtn = document.getElementById("servantInfoFilterModalClose");
    const defaultBtn = document.getElementById("servantInfoFilterDefaultBtn");
    const selectAllBtn = document.getElementById("servantInfoFilterSelectAllBtn");
    const cancelBtn = document.getElementById("servantInfoFilterCancelBtn");
    const okBtn = document.getElementById("servantInfoFilterOkBtn");

    if (filterBtn) {
      filterBtn.addEventListener("click", () => this._openFilterModal());
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this._cancelFilterModal());
    }
    if (defaultBtn) {
      defaultBtn.addEventListener("click", () => this._defaultFilterModal());
    }
    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", () => this._selectAllFilterModal());
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => this._cancelFilterModal());
    }
    if (okBtn) {
      okBtn.addEventListener("click", () => this._okFilterModal());
    }
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) this._cancelFilterModal();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("open")) {
          this._cancelFilterModal();
        }
      });
    }
  },

  _bindDetailModal() {
    const modal = document.getElementById("servantInfoModal");
    const closeBtn = document.getElementById("servantInfoModalClose");
    if (!modal) return;

    if (closeBtn) {
      closeBtn.addEventListener("click", () => this._closeDetailModal());
    }
    modal.addEventListener("click", (e) => {
      if (e.target === modal) this._closeDetailModal();
    });
    document.addEventListener("keydown", (e) => {
      if (!modal.classList.contains("open")) return;
      const filterModal = document.getElementById("servantInfoFilterModal");
      if (filterModal && filterModal.classList.contains("open")) return;
      if (e.key === "Escape") {
        this._closeDetailModal();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const tag = e.target && e.target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) {
          return;
        }
        const sgCtrl = this._modalState && this._modalState.sgController;
        if (sgCtrl && typeof sgCtrl.step === "function") {
          e.preventDefault();
          sgCtrl.step(e.key === "ArrowRight" ? 1 : -1);
        }
      }
    });
  },

  _openFilterModal() {
    const modal = document.getElementById("servantInfoFilterModal");
    if (!modal) return;
    this._draftFilters = FilterModalController.clone(this.state);
    this._renderFilterRows(this._draftFilters);
    modal.classList.add("open");
  },

  _cancelFilterModal() {
    this._draftFilters = null;
    const modal = document.getElementById("servantInfoFilterModal");
    if (modal) modal.classList.remove("open");
  },

  _defaultFilterModal() {
    if (!this._draftFilters) return;
    this._draftFilters = FilterModalController.createInitial();
    this._renderFilterRows(this._draftFilters);
  },

  _selectAllFilterModal() {
    if (!this._draftFilters) return;
    this._draftFilters = FilterModalController.selectAll({}, (res) => {
      const scope = ServantFilters.rowScope(res.groupClassFilters);
      if (scope) res.classFilters = res.classFilters.filter((id) => scope.includes(id));
    });
    this._renderFilterRows(this._draftFilters);
  },

  _okFilterModal() {
    if (this._draftFilters) {
      Object.assign(this.state, this._draftFilters);
      this._draftFilters = null;
    }
    this.state.currentPage = 1;
    const modal = document.getElementById("servantInfoFilterModal");
    if (modal) modal.classList.remove("open");
    this.render();
  },

  _renderFilterRows(customFilters = null) {
    const filterState = customFilters || this._draftFilters || this.state;
    const toggle = (key) => (ids) => {
      if (this._draftFilters) {
        this._draftFilters[key] = ids;
        if (key === "groupClassFilters") {
          this._renderFilterRows(this._draftFilters);
        }
      } else {
        this.state[key] = ids;
        this.state.currentPage = 1;
        this.render();
      }
    };
    FilterModalController.renderStandardRows("servantInfo", filterState, toggle);
  },

  _hasActiveFilters() {
    return FilterModalController.STANDARD_KEYS.some((key) => this.state[key].length > 0);
  },

  _updateFilterBtn() {
    const filterBtn = document.getElementById("servantInfoFilterBtn");
    if (filterBtn) {
      filterBtn.classList.toggle("active", this._hasActiveFilters());
    }
  },

  _filterServants() {
    const query = (this.state.searchQuery || "").toLowerCase().trim();
    const hasFilter = this._hasActiveFilters();
    const matcher = hasFilter ? ServantFilters.compile(this.state) : null;

    return ServantData.servants.filter((servant) => {
      if (query) {
        const matchesQuery = servant._search
          ? servant._search.includes(query)
          : servant.id.toLowerCase().includes(query) ||
            servant.name.toLowerCase().includes(query) ||
            ServantData.getAllNames(servant.id).some((n) => n.toLowerCase().includes(query));
        if (!matchesQuery) return false;
      }
      if (matcher && !matcher(ServantData.getAllTraitSet(servant.id))) return false;
      return true;
    });
  },

  render() {
    this._updateFilterBtn();
    const filtered = ServantSort.sorted(
      this._filterServants(),
      this.state.sortBy,
      this.state.sortOrder,
      (s) => s.collectionNo || s.id,
      (s) => ServantData.getAllTraits(s.id),
    );
    this._lastFiltered = filtered;

    const grid = document.getElementById("servantInfoResults");
    if (!grid) return;

    const pageSize = this._getPageSize();
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (this.state.currentPage > totalPages) {
      this.state.currentPage = totalPages;
    }

    const pageStart = (this.state.currentPage - 1) * pageSize;
    const pageSlice = filtered.slice(pageStart, pageStart + pageSize);
    const isFirstPage = this.state.currentPage === 1;
    const cols = this._getCols();

    const frag = document.createDocumentFragment();
    if (pageSlice.length === 0) {
      const empty = DOMFactory.el("div", "servant-info-empty");
      empty.textContent = "No servants matched your search.";
      frag.appendChild(empty);
    } else {
      pageSlice.forEach((servant, idx) => {
        const imgAttrs = !isFirstPage
          ? {}
          : idx < cols
            ? { loading: "eager", fetchpriority: "high" }
            : { loading: "lazy" };
        frag.appendChild(this._buildCard(servant, imgAttrs));
      });
    }

    grid.replaceChildren(frag);
    this._renderPagination(totalPages);
  },

  _buildCard(servant, imgAttrs) {
    const card = DOMFactory.el("div", ["cefilter-servant-card", "servant-info-card"], {
      role: "button",
      tabindex: "0",
      "aria-label": `View ${servant.name} info`,
    });

    let portraitEl;
    if (servant.altImage) {
      portraitEl = DOMFactory.createSwapImg({
        src: servant.image,
        altSrc: servant.altImage,
        className: "servant-slot-portrait",
        attrs: { alt: servant.name, ...imgAttrs },
        fallbackId: servant.id,
      });
    } else {
      portraitEl = DOMFactory.createLazyImg(servant.image, "servant-slot-portrait", {
        alt: servant.name,
        ...imgAttrs,
      });
      DOMFactory.addAscensionFallback(portraitEl, servant.id);
    }
    card.appendChild(portraitEl);

    const nameEl = DOMFactory.el("div", "cefilter-servant-name");
    if (servant.altName) {
      DOMFactory.fillSwapName(nameEl, servant.name, servant.altName);
    } else {
      nameEl.textContent = servant.name;
    }
    card.appendChild(nameEl);

    const open = () => this._openDetailModal(servant, card);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    return card;
  },

  _renderPagination(totalPages) {
    ["servantInfoPaginationTop", "servantInfoPaginationBottom"].forEach((id) => {
      const container = document.getElementById(id);
      if (!container) return;

      const currentPage = this.state.currentPage;
      const frag = document.createDocumentFragment();

      const prevBtn = DOMFactory.el("button", "cefilter-page-btn", {
        type: "button",
        "aria-label": "Previous page",
      });
      prevBtn.textContent = "\u2039";
      if (currentPage <= 1) {
        prevBtn.disabled = true;
      } else {
        prevBtn.addEventListener("click", () => {
          this.state.currentPage = currentPage - 1;
          this.render();
        });
      }
      frag.appendChild(prevBtn);

      const indicator = DOMFactory.el("span", "cefilter-page-indicator");
      indicator.textContent = `${currentPage} / ${totalPages}`;
      frag.appendChild(indicator);

      const nextBtn = DOMFactory.el("button", "cefilter-page-btn", {
        type: "button",
        "aria-label": "Next page",
      });
      nextBtn.textContent = "\u203a";
      if (currentPage >= totalPages) {
        nextBtn.disabled = true;
      } else {
        nextBtn.addEventListener("click", () => {
          this.state.currentPage = currentPage + 1;
          this.render();
        });
      }
      frag.appendChild(nextBtn);

      container.replaceChildren(frag);
    });
  },

  /* ===...=== Detail Popup Modal ===...=== */

  async _openDetailModal(servant, openerEl) {
    const modal = document.getElementById("servantInfoModal");
    const titleEl = document.getElementById("servantInfoModalTitle");
    const bodyEl = document.getElementById("servantInfoModalBody");
    if (!modal || !bodyEl) return;

    this._modalOpener = openerEl || document.activeElement;
    const reqId = ++this._activeRequestId;
    const noStr = formatServantNo(servant.collectionNo, servant.id);

    if (titleEl) {
      titleEl.textContent = `${noStr} ${servant.name}`;
    }

    const loadingEl = DOMFactory.el("div", "servant-info-loading");
    loadingEl.textContent = `Loading ${servant.name} info...`;
    bodyEl.replaceChildren(loadingEl);
    modal.classList.add("open");

    const closeBtn = document.getElementById("servantInfoModalClose");
    if (closeBtn) closeBtn.focus();

    const svtId = String(servant.id);
    if (this._infoCache.has(svtId)) {
      if (reqId === this._activeRequestId && modal.classList.contains("open")) {
        this._renderDetailModal(this._infoCache.get(svtId), servant, bodyEl, titleEl);
      }
      return;
    }

    try {
      const resp = await fetch(`./servant_info/${encodeURIComponent(svtId)}.json`);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      this._infoCache.set(svtId, data);
      if (reqId !== this._activeRequestId || !modal.classList.contains("open")) return;
      this._renderDetailModal(data, servant, bodyEl, titleEl);
    } catch (_err) {
      if (reqId !== this._activeRequestId || !modal.classList.contains("open")) return;
      this._renderFallbackModal(servant, bodyEl);
    }
  },

  _closeDetailModal() {
    const modal = document.getElementById("servantInfoModal");
    if (!modal) return;
    this._activeRequestId++;
    this._modalState = null;
    modal.classList.remove("open");
    if (this._modalOpener && this._modalOpener.isConnected && typeof this._modalOpener.focus === "function") {
      this._modalOpener.focus();
    }
    this._modalOpener = null;
  },

  _renderFallbackModal(servant, bodyEl) {
    const frag = document.createDocumentFragment();
    frag.appendChild(
      this._buildHero({
        id: servant.id,
        collectionNo: servant.collectionNo,
        name: servant.name,
        originalName: "",
        className: "",
        rarity: ServantSort.rarity(ServantData.getAllTraits(servant.id)),
      }),
    );
    const msg = DOMFactory.el("div", "servant-info-empty");
    msg.textContent = "Detailed servant info data is not available yet. Run data sync to generate servant_info files.";
    frag.appendChild(msg);
    bodyEl.replaceChildren(frag);
  },

  _renderDetailModal(svt, baseServant, bodyEl, titleEl) {
    const noStr = formatServantNo(svt.collectionNo, svt.id);
    if (titleEl) {
      titleEl.textContent = `${noStr} ${svt.name || baseServant.name}`;
    }

    const formatted = svt.formatted || {};
    const formConfig = formatted.formConfig || svt.formConfig || null;
    const modalState = {
      svt,
      activeFormIndex: 0,
      servantForms: null,
      profileCard: null,
      slotCards: [],
      heroRefs: null,
      isSyncingForms: false,
      isSyncingAscension: false,
      isSyncingSg: false,
      sgController: null,
      lastSgIdxByForm: {},
    };
    this._modalState = modalState;

    const formsToUse = this._normalizeProfileForms(svt, formatted.profile);
    const isAscensionProfile = formsToUse.some(
      (f) =>
        /^(1st|2nd|3rd|4th|final|ascension\s+\d)/i.test(f.label) && !/spiritron\s+dress|all\s+ascension/i.test(f.label),
    );
    const isServantFormProfile = !isAscensionProfile && formsToUse.length > 1;

    modalState.servantForms = this._resolveServantFormsList(
      formConfig,
      formsToUse,
      isServantFormProfile,
      formatted.slots,
    );

    const frag = document.createDocumentFragment();
    const heroEl = this._buildHero(svt, baseServant, modalState);
    if (modalState.heroRefs) modalState.heroRefs.titleEl = titleEl || null;
    frag.appendChild(heroEl);

    const cardsWrap = DOMFactory.el("div", "servant-info-cards");
    if (Array.isArray(svt.saintGraphs) && svt.saintGraphs.length > 0) {
      cardsWrap.appendChild(this._buildSaintGraphCard(svt.saintGraphs, svt.name || baseServant.name || "", modalState));
    }
    const profileCard = this._buildProfileCard(svt, formsToUse, isAscensionProfile, isServantFormProfile, modalState);
    modalState.profileCard = profileCard;
    cardsWrap.appendChild(profileCard);

    const slots = Array.isArray(formatted.slots) ? formatted.slots : [];
    slots.forEach((rawSlot) => {
      const slot = {
        ...rawSlot,
        activeTierByForm: {},
        activeTier: 0,
      };
      const slotCard = this._buildSlotCard(slot, modalState);
      modalState.slotCards.push(slotCard);
      cardsWrap.appendChild(slotCard);
    });

    frag.appendChild(cardsWrap);
    bodyEl.replaceChildren(frag);
  },

  _buildSaintGraphCard(entries, name, modalState) {
    const card = DOMFactory.el("div", "f-section-box");
    const isMash = Boolean(
      modalState &&
      modalState.svt &&
      (Number(modalState.svt.id) === 800100 || Number(modalState.svt.collectionNo) === 1),
    );
    const distinctForms = [...new Set(entries.map((e) => e.form).filter((f) => f !== undefined))].sort((a, b) => a - b);
    const hasIsolatedFormTabs = Boolean(modalState) && !isMash && distinctForms.length > 1;

    let activeFormIdx = hasIsolatedFormTabs
      ? distinctForms.includes(modalState.activeFormIndex)
        ? modalState.activeFormIndex
        : distinctForms[0]
      : null;
    let activeEntries = hasIsolatedFormTabs ? entries.filter((e) => e.form === activeFormIdx) : entries;
    let idx = 0;

    let formBtnGroup = null;
    const updateSgFormButtons = () => {
      if (!formBtnGroup) return;
      formBtnGroup.querySelectorAll(".f-option-btn").forEach((b) => {
        const isActive = parseInt(b.dataset.globalIdx, 10) === activeFormIdx;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", String(isActive));
      });
    };

    if (hasIsolatedFormTabs) {
      const formBar = DOMFactory.el("div", "f-form-selector-bar", { "data-servant-form": "true" });
      formBtnGroup = DOMFactory.el("div", "f-option-btn-group");
      const formConfig = modalState.svt.formatted?.formConfig || modalState.svt.formConfig;
      distinctForms.forEach((f) => {
        const sf = modalState.servantForms && modalState.servantForms.find((item) => item.index === f);
        const fc = formConfig && formConfig[String(f)];
        const rawLabel = (sf && sf.label) || (fc && (fc.label || fc.name)) || `Form ${f}`;
        const isActive = f === activeFormIdx;
        const btn = DOMFactory.el("button", ["f-option-btn", ...(isActive ? ["active"] : [])], {
          type: "button",
          "aria-pressed": String(isActive),
          "data-global-idx": String(f),
        });
        btn.textContent = translateOptionLabel(rawLabel);
        btn.addEventListener("click", () => {
          if (f === activeFormIdx) return;
          this._syncAllCardsToForm(modalState, f, true);
        });
        formBtnGroup.appendChild(btn);
      });
      formBar.appendChild(formBtnGroup);
      card.appendChild(formBar);
    }

    const header = DOMFactory.el("div", "f-section-header");
    const title = DOMFactory.el("span", "f-section-title");
    title.textContent = "Saint Graph";
    header.appendChild(title);
    card.appendChild(header);

    const viewer = DOMFactory.el("div", "f-sg-viewer");
    const wrap = DOMFactory.el("div", "f-sg-stage-wrap");
    const img = DOMFactory.el("img", "f-sg-img", { width: "512", height: "724", decoding: "async" });
    const caption = DOMFactory.el("div", "f-sg-caption", { "aria-live": "polite" });
    const errorEl = DOMFactory.el("div", "f-sg-error");
    errorEl.hidden = true;

    img.addEventListener("load", () => {
      img.classList.remove("f-sg-img--loading");
    });
    img.addEventListener("error", () => {
      img.classList.remove("f-sg-img--loading");
      img.hidden = true;
      errorEl.textContent = "Saint Graph image not available locally.";
      errorEl.hidden = false;
    });

    let prev = null;
    let next = null;

    const update = (syncOut = true) => {
      const currentTotal = activeEntries.length;
      if (currentTotal === 0) return;
      idx = Math.max(0, Math.min(currentTotal - 1, idx));
      const entry = activeEntries[idx];
      const fallbackLabel =
        ["1st Ascension", "2nd Ascension", "3rd Ascension", "Final Ascension"][idx] || `Stage ${idx + 1}`;
      const label = translateOptionLabel(entry.label || fallbackLabel);
      const nextSrc = `saint_graphs/${entry.file}?v=${IMAGE_VERSION}`;
      caption.textContent = label;
      errorEl.hidden = true;
      img.hidden = false;
      img.setAttribute("alt", `${name} — ${label}`);
      if (img.getAttribute("src") !== nextSrc) {
        img.classList.add("f-sg-img--loading");
        img.setAttribute("src", nextSrc);
        if (img.complete && img.naturalWidth > 0) {
          img.classList.remove("f-sg-img--loading");
        }
      }
      if (modalState) {
        const activeFormHasSg = entries.some((e) => e.form === modalState.activeFormIndex);
        const activeFormOverride =
          modalState.activeFormIndex > 0 && !activeFormHasSg ? modalState.activeFormIndex : null;
        this._applyStageIdentity(modalState, entry, activeFormOverride);
        if (entry.form !== undefined) modalState.lastSgIdxByForm[entry.form] = idx;
        if (syncOut && !modalState.isSyncingSg) {
          modalState.isSyncingSg = true;
          try {
            if (entry.form !== undefined && entry.form !== modalState.activeFormIndex && activeFormHasSg) {
              this._syncAllCardsToForm(modalState, entry.form, false);
            }
            if (entry.ascensionStage) {
              this._setServantAscensionStage(modalState, entry.ascensionStage, false);
            }
          } finally {
            modalState.isSyncingSg = false;
          }
        }
      }
      const activeEl = document.activeElement;
      if (prev) {
        const atStart = idx <= 0;
        prev.classList.toggle("f-sg-nav-btn--hidden", atStart);
        prev.disabled = atStart;
        prev.setAttribute("aria-hidden", atStart ? "true" : "false");
        prev.tabIndex = atStart ? -1 : 0;
        if (atStart && activeEl === prev) {
          if (next && !next.disabled) {
            next.focus();
          } else {
            const closeBtn = document.getElementById("servantInfoModalClose");
            if (closeBtn) closeBtn.focus();
          }
        }
      }
      if (next) {
        const atEnd = idx >= currentTotal - 1;
        next.classList.toggle("f-sg-nav-btn--hidden", atEnd);
        next.disabled = atEnd;
        next.setAttribute("aria-hidden", atEnd ? "true" : "false");
        next.tabIndex = atEnd ? -1 : 0;
        if (atEnd && activeEl === next) {
          if (prev && !prev.disabled) {
            prev.focus();
          } else {
            const closeBtn = document.getElementById("servantInfoModalClose");
            if (closeBtn) closeBtn.focus();
          }
        }
      }
    };

    const step = (delta) => {
      const nextIdx = Math.max(0, Math.min(activeEntries.length - 1, idx + delta));
      if (nextIdx === idx) return;
      idx = nextIdx;
      update();
    };

    if (modalState) {
      const goTo = (target) => {
        if (target >= 0 && target !== idx) idx = target;
        update(false);
      };
      modalState.sgController = {
        step,
        stepToForm: (formIdx) => {
          if (hasIsolatedFormTabs) {
            if (distinctForms.includes(formIdx)) {
              activeFormIdx = formIdx;
              activeEntries = entries.filter((e) => e.form === activeFormIdx);
              const remembered = modalState.lastSgIdxByForm[activeFormIdx];
              idx = remembered !== undefined ? Math.max(0, Math.min(activeEntries.length - 1, remembered)) : 0;
              updateSgFormButtons();
              update(false);
            } else {
              updateSgFormButtons();
              this._applyStageIdentity(modalState, activeEntries[idx], formIdx);
            }
            return;
          }
          const remembered = modalState.lastSgIdxByForm[formIdx];
          const target = remembered !== undefined ? remembered : entries.findIndex((e) => e.form === formIdx);
          if (target >= 0) {
            goTo(target);
          } else {
            this._applyStageIdentity(modalState, entries[idx], formIdx);
          }
        },
        stepToAscension: (stageStr) =>
          goTo(activeEntries.findIndex((e) => e.kind === "ascension" && e.ascensionStage === String(stageStr))),
        getCurrentEntry: () => activeEntries[idx],
      };
    }

    if (entries.length > 1) {
      prev = DOMFactory.el("button", ["f-option-btn", "f-sg-nav-btn"], {
        type: "button",
        "aria-label": "Previous stage",
      });
      prev.textContent = "‹";
      prev.addEventListener("click", () => step(-1));
      next = DOMFactory.el("button", ["f-option-btn", "f-sg-nav-btn"], {
        type: "button",
        "aria-label": "Next stage",
      });
      next.textContent = "›";
      next.addEventListener("click", () => step(1));
      wrap.append(prev, img, next);
    } else {
      wrap.appendChild(img);
    }

    viewer.append(wrap, caption, errorEl);
    card.appendChild(viewer);
    update(false);
    return card;
  },

  _applyStageIdentity(modalState, entry, activeFormOverride = null) {
    const refs = modalState.heroRefs;
    if (!refs) return;
    const formIdx =
      activeFormOverride !== null && activeFormOverride !== undefined
        ? activeFormOverride
        : entry && entry.form !== undefined
          ? entry.form
          : modalState.activeFormIndex;
    const formConfig = modalState.svt.formatted?.formConfig || modalState.svt.formConfig;
    const formRule = formConfig && formConfig[String(formIdx)];
    const allowFormName = Boolean(formRule && formRule.changeName === true);
    const displayName = (entry && entry.name) || (allowFormName && formRule.name) || refs.baseName;
    const jpName = (entry && entry.originalName) || (allowFormName && formRule.originalName) || refs.baseOriginalName;
    refs.nameEl.textContent = displayName;
    refs.jpEl.textContent = jpName;
    refs.jpEl.hidden = !jpName || jpName === displayName;
    if (refs.titleEl) {
      refs.titleEl.textContent = `${formatServantNo(modalState.svt.collectionNo, modalState.svt.id)} ${displayName}`;
    }
    const portrait = refs.portraitEl;
    if (!portrait) return;
    let targetFace;
    if (formRule && formRule.faces) {
      const stageKey = String((entry && (entry.ascensionStage || entry.key)) || "1");
      targetFace = formRule.faces[stageKey] || formRule.faces["1"] || null;
    } else {
      targetFace = (entry && entry.face) || null;
    }
    const targetImgSrc = targetFace ? `servants/${targetFace}?v=${IMAGE_VERSION}` : refs.baseImgSrc;
    if (portrait.getAttribute("src") !== targetImgSrc) {
      if (refs.portraitFallbackEl) {
        refs.portraitFallbackEl.hidden = true;
        refs.portraitFallbackEl.style.display = "none";
      }
      portrait.hidden = false;
      portrait.style.display = "";
      portrait.dataset.fallbackTried = "";
      portrait.setAttribute("src", targetImgSrc);
    }
    portrait.setAttribute("alt", displayName);
    portrait.setAttribute("data-stage-face", targetFace ? "1" : "0");
  },

  _buildHero(svt, baseServant, modalState) {
    const hero = DOMFactory.el("div", "servant-info-hero");
    const imgSrc = (baseServant && baseServant.image) || `servants/${svt.id}/000.webp?v=${IMAGE_VERSION}`;

    const portraitEl = DOMFactory.el("img", "servant-info-portrait", {
      src: imgSrc,
      alt: svt.name || "",
    });
    const portraitFallbackEl = DOMFactory.el("div", "servant-slot-portrait-fallback");
    portraitFallbackEl.textContent = String(svt.id);
    portraitFallbackEl.hidden = true;
    portraitFallbackEl.style.display = "none";
    portraitEl.addEventListener("error", () => {
      if (portraitEl.dataset.fallbackTried !== "1" && portraitEl.getAttribute("src") !== imgSrc) {
        portraitEl.dataset.fallbackTried = "1";
        portraitEl.setAttribute("src", imgSrc);
        return;
      }
      portraitEl.hidden = true;
      portraitEl.style.display = "none";
      portraitFallbackEl.hidden = false;
      portraitFallbackEl.style.display = "";
    });
    hero.append(portraitEl, portraitFallbackEl);

    const meta = DOMFactory.el("div", "servant-info-meta");
    const badges = DOMFactory.el("div", "servant-info-badges");

    const noBadge = DOMFactory.el("span", "badge-no");
    noBadge.textContent = formatServantNo(svt.collectionNo, svt.id);
    badges.appendChild(noBadge);

    const classBadge = DOMFactory.el("span", "badge-class");
    const classIconEl = DOMFactory.el("img", null, {
      alt: "",
      width: "16",
      height: "16",
    });
    classIconEl.style.marginRight = "4px";
    classIconEl.addEventListener("error", () => {
      classIconEl.hidden = true;
      classIconEl.style.display = "none";
    });
    const iconKey = resolveClassIconKey(svt.className);
    if (iconKey) {
      classIconEl.setAttribute("src", `icons/classes/${iconKey}.webp`);
    } else {
      classIconEl.hidden = true;
      classIconEl.style.display = "none";
    }
    classBadge.appendChild(classIconEl);
    const classText = DOMFactory.el("span");
    classText.textContent = svt.className || "-";
    classBadge.appendChild(classText);
    if (!svt.className) {
      classBadge.hidden = true;
      classBadge.style.display = "none";
    }
    badges.appendChild(classBadge);

    const rarityBadge = DOMFactory.el("span", ["badge-rarity", getRarityBadgeClass(svt.rarity)]);
    rarityBadge.textContent = getRarityStars(svt.rarity);
    badges.appendChild(rarityBadge);

    if (svt.cost !== undefined && svt.cost !== null && svt.cost !== "") {
      const costBadge = DOMFactory.el("span", "badge-class");
      costBadge.textContent = `Cost ${svt.cost}`;
      badges.appendChild(costBadge);
    }

    meta.appendChild(badges);

    const nameEl = DOMFactory.el("div", "servant-info-name");
    nameEl.textContent = svt.name || (baseServant && baseServant.name) || "";
    meta.appendChild(nameEl);

    const jpEl = DOMFactory.el("div", "servant-info-jp");
    if (svt.originalName && svt.originalName !== svt.name) {
      jpEl.textContent = svt.originalName;
    } else {
      jpEl.hidden = true;
    }
    meta.appendChild(jpEl);

    hero.appendChild(meta);
    if (modalState) {
      modalState.heroRefs = {
        classText,
        classIconEl,
        rarityBadge,
        classBadge,
        nameEl,
        jpEl,
        portraitEl,
        portraitFallbackEl,
        baseName: svt.name || (baseServant && baseServant.name) || "",
        baseOriginalName: svt.originalName || "",
        baseImgSrc: imgSrc,
        titleEl: null,
      };
    }
    return hero;
  },

  _parseProfileBlocksByStage(blocks, fallbackValue) {
    const byStage = { 1: fallbackValue, 2: fallbackValue, 3: fallbackValue };
    if (!Array.isArray(blocks) || blocks.length === 0) return byStage;
    let currentStages = null;
    for (const rawItem of blocks) {
      const item = String(rawItem || "").trim();
      if (!item) continue;
      const tagMatch = item.match(/^\[(.+)\]$/);
      if (tagMatch) {
        const hdr = tagMatch[1].toLowerCase();
        const stages = [];
        if (/\b1st\b/.test(hdr)) stages.push("1");
        if (/\b2nd\b/.test(hdr)) stages.push("2");
        if (/\b3rd\b/.test(hdr)) stages.push("3");
        currentStages = stages.length > 0 ? stages : null;
        continue;
      }
      const val = item.replace(/^(?:Alignment|Sub-Attribute|Gender)\s*:\s*/i, "").trim();
      if (!val) continue;
      const targets = currentStages || ["1", "2", "3"];
      targets.forEach((s) => {
        byStage[s] = val;
      });
    }
    return byStage;
  },

  _normalizeProfileForms(svt, profile) {
    if (profile && Array.isArray(profile.forms) && profile.forms.length > 0) {
      const normalized = profile.forms.map((f, i) => ({
        index: i,
        globalFormIndex: f.globalFormIndex !== undefined ? f.globalFormIndex : i,
        label: f.label || "",
        className: f.className || svt.className || "",
        alignment: f.alignment || "Unknown",
        subAttr: f.subAttr || "Unknown",
        gender: f.gender || "Unknown",
        rarity: f.rarity !== undefined ? f.rarity : svt.rarity || 0,
        hpBase: f.hpBase !== undefined ? f.hpBase : svt.hpBase || "",
        hpMax: f.hpMax !== undefined ? f.hpMax : svt.hpMax || "",
        atkBase: f.atkBase !== undefined ? f.atkBase : svt.atkBase || "",
        atkMax: f.atkMax !== undefined ? f.atkMax : svt.atkMax || "",
        cardDeck: f.cardDeck || "",
        hits: Array.isArray(f.hits) ? f.hits : [],
      }));
      const hasBracketedBlock =
        normalized.length === 1 &&
        [profile.attributeBlocks, profile.alignmentBlocks, profile.genderBlocks].some(
          (arr) => Array.isArray(arr) && arr.some((line) => /^\[.+\]$/.test(String(line || "").trim())),
        );
      if (hasBracketedBlock) {
        const base = normalized[0];
        const alignByStage = this._parseProfileBlocksByStage(profile.alignmentBlocks, base.alignment);
        const attrByStage = this._parseProfileBlocksByStage(profile.attributeBlocks, base.subAttr);
        const genderByStage = this._parseProfileBlocksByStage(profile.genderBlocks, base.gender);
        const stageTuple = (s) => `${alignByStage[s]}\0${attrByStage[s]}\0${genderByStage[s]}`;
        const t1 = stageTuple("1");
        const t2 = stageTuple("2");
        const t3 = stageTuple("3");
        const groups =
          t1 === t2 && t2 === t3
            ? null
            : t1 === t2
              ? [
                  { label: "1st&2nd Ascension", stage: "1" },
                  { label: "3rd Ascension", stage: "3" },
                ]
              : t1 === t3
                ? [
                    { label: "1st&3rd Ascension", stage: "1" },
                    { label: "2nd Ascension", stage: "2" },
                  ]
                : t2 === t3
                  ? [
                      { label: "1st Ascension", stage: "1" },
                      { label: "2nd&3rd Ascension", stage: "2" },
                    ]
                  : [
                      { label: "1st Ascension", stage: "1" },
                      { label: "2nd Ascension", stage: "2" },
                      { label: "3rd Ascension", stage: "3" },
                    ];
        if (groups) {
          return groups.map((g, i) => ({
            ...base,
            index: i,
            label: g.label,
            alignment: alignByStage[g.stage],
            subAttr: attrByStage[g.stage],
            gender: genderByStage[g.stage],
          }));
        }
      }
      return normalized;
    }
    return [
      {
        index: 0,
        globalFormIndex: 0,
        label: "",
        className: svt.className || "",
        alignment: "Unknown",
        subAttr: "Unknown",
        gender: "Unknown",
        rarity: svt.rarity || 0,
        hpBase: svt.hpBase || "",
        hpMax: svt.hpMax || "",
        atkBase: svt.atkBase || "",
        atkMax: svt.atkMax || "",
        cardDeck: "",
        hits: [],
      },
    ];
  },

  _resolveServantFormsList(formConfig, formsToUse, isServantFormProfile, slots) {
    if (formConfig) {
      const keys = Object.keys(formConfig).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      if (keys.length > 1) {
        return keys.map((k) => ({
          index: parseInt(k, 10),
          label: formConfig[k].label || formConfig[k].name || `Form ${k}`,
          key: (formConfig[k].key || formConfig[k].label || "").toLowerCase(),
        }));
      }
    }
    if (isServantFormProfile && formsToUse.length > 1) {
      return formsToUse.map((f, i) => ({
        index: f.globalFormIndex !== undefined ? f.globalFormIndex : i,
        label: f.label.replace(/^If\s+/i, "").trim(),
        key: f.label
          .replace(/^If\s+/i, "")
          .trim()
          .toLowerCase(),
      }));
    }
    if (Array.isArray(slots)) {
      const seen = new Set();
      const uniqueForms = [];
      for (const slot of slots) {
        const variants = slot.variantsByTier ? Object.values(slot.variantsByTier) : [];
        for (const v of variants) {
          for (const f of v.forms || []) {
            if (/^If\s+|Spiritron Dress|All Ascensions/i.test(f.label || "")) {
              const clean = f.label.replace(/^If\s+/i, "").trim();
              if (clean && !seen.has(clean.toLowerCase())) {
                seen.add(clean.toLowerCase());
                uniqueForms.push({ index: uniqueForms.length, label: clean, key: clean.toLowerCase() });
              }
            }
          }
        }
      }
      if (uniqueForms.length > 1) return uniqueForms;
    }
    return null;
  },

  _buildProfileCard(svt, formsToUse, isAscensionProfile, isServantFormProfile, modalState) {
    const card = DOMFactory.el("div", "f-section-box");
    const activeForm = formsToUse[0];
    const hasMultipleForms = formsToUse.length > 1;
    const hasMultipleClasses = formsToUse.some(
      (f) => f.className && f.className.toLowerCase() !== formsToUse[0].className.toLowerCase(),
    );

    let formBtnGroup = null;
    if (hasMultipleForms) {
      const formBar = DOMFactory.el("div", "f-form-selector-bar");
      if (isServantFormProfile) formBar.setAttribute("data-servant-form", "true");
      else if (isAscensionProfile) formBar.setAttribute("data-ascension-form", "true");

      formBtnGroup = DOMFactory.el("div", "f-option-btn-group");
      formsToUse.forEach((f, i) => {
        const btn = DOMFactory.el("button", ["f-option-btn", ...(i === 0 ? ["active"] : [])], {
          type: "button",
          "aria-pressed": String(i === 0),
          "data-form-idx": String(i),
          "data-global-idx": String(f.globalFormIndex !== undefined ? f.globalFormIndex : i),
          "data-form-label": f.label || "",
        });
        btn.textContent = getFormDisplayLabel(f);
        formBtnGroup.appendChild(btn);
      });
      formBar.appendChild(formBtnGroup);
      card.appendChild(formBar);
    }

    const header = DOMFactory.el("div", "f-section-header");
    const title = DOMFactory.el("span", "f-section-title");
    title.textContent = "Profile & Status";
    header.appendChild(title);
    card.appendChild(header);

    const table = DOMFactory.el("div", "f-profile-table");
    const makeRow = (labelText, initialVal, hidden = false) => {
      const row = DOMFactory.el("div", "f-table-row");
      if (hidden) {
        row.hidden = true;
        row.style.display = "none";
      }
      const lbl = DOMFactory.el("span", "f-table-label");
      lbl.textContent = labelText;
      const val = DOMFactory.el("span", "f-table-val");
      val.textContent = initialVal;
      row.append(lbl, val);
      table.appendChild(row);
      return val;
    };

    const classVal = makeRow("Class", activeForm.className || "", !hasMultipleClasses);
    const alignVal = makeRow("Alignment", activeForm.alignment || "Unknown");
    const subAttrVal = makeRow("Sub-Attribute", activeForm.subAttr || "Unknown");
    const genderVal = makeRow("Gender", activeForm.gender || "Unknown");
    const rarityVal = makeRow("Rarity", getRarityStars(activeForm.rarity));
    const paintRarity = (r) => {
      const num = parseInt(r, 10) || 0;
      rarityVal.className = `f-table-val ${num > 0 ? "f-rarity-stars" : ""}`;
      rarityVal.textContent = getRarityStars(num);
    };
    paintRarity(activeForm.rarity);
    card.appendChild(table);

    const statsGrid = DOMFactory.el("div", "f-stats-grid");
    const makeStatCol = (heading) => {
      const col = DOMFactory.el("div", "f-stat-col");
      const titleSpan = DOMFactory.el("span", "f-stat-title");
      titleSpan.textContent = heading;
      const numSpan = DOMFactory.el("span", "f-stat-numbers");
      col.append(titleSpan, numSpan);
      statsGrid.appendChild(col);
      return numSpan;
    };
    const hpVal = makeStatCol("HP (Base \u2022 Max)");
    const atkVal = makeStatCol("ATK (Base \u2022 Max)");
    const paintStat = (el, base, max) => {
      const baseText = document.createTextNode(`${formatNumber(base)} / `);
      const maxStrong = DOMFactory.el("strong");
      maxStrong.textContent = formatNumber(max);
      el.replaceChildren(baseText, maxStrong);
    };
    paintStat(hpVal, activeForm.hpBase, activeForm.hpMax);
    paintStat(atkVal, activeForm.atkBase, activeForm.atkMax);
    card.appendChild(statsGrid);

    const deckBar = DOMFactory.el("div", "f-deck-bar");
    const deckLabel = DOMFactory.el("span", "f-table-label");
    deckLabel.textContent = "Cards:";
    const deckContainer = DOMFactory.el("div", "f-profile-deck-container");
    const hitsContainer = DOMFactory.el("div", "f-profile-hits-container");
    deckBar.append(deckLabel, deckContainer, hitsContainer);

    const paintDeck = (deckStr, hitsArr) => {
      deckBar.hidden = !deckStr;
      deckBar.style.display = deckStr ? "" : "none";
      const dFrag = document.createDocumentFragment();
      for (const ch of deckStr || "") {
        const chip = DOMFactory.el("span", ["deck-card-chip", `card-${ch}`]);
        chip.textContent = ch;
        dFrag.appendChild(chip);
      }
      deckContainer.replaceChildren(dFrag);

      const hFrag = document.createDocumentFragment();
      (hitsArr || []).forEach((h) => {
        const badge = DOMFactory.el("span", "f-hit-badge");
        badge.textContent = h;
        hFrag.appendChild(badge);
      });
      hitsContainer.replaceChildren(hFrag);
    };
    paintDeck(activeForm.cardDeck, activeForm.hits);
    card.appendChild(deckBar);

    const applyFormProfile = (f) => {
      if (f.className) {
        classVal.textContent = f.className;
        if (modalState.heroRefs) {
          modalState.heroRefs.classText.textContent = f.className;
          modalState.heroRefs.classBadge.hidden = false;
          modalState.heroRefs.classBadge.style.display = "";
          const iconEl = modalState.heroRefs.classIconEl;
          if (iconEl) {
            const iconKey = resolveClassIconKey(f.className);
            if (iconKey) {
              const iconSrc = `icons/classes/${iconKey}.webp`;
              if (iconEl.getAttribute("src") !== iconSrc) iconEl.setAttribute("src", iconSrc);
              iconEl.hidden = false;
              iconEl.style.display = "";
            } else {
              iconEl.hidden = true;
              iconEl.style.display = "none";
            }
          }
        }
      }
      alignVal.textContent = f.alignment || "Unknown";
      subAttrVal.textContent = f.subAttr || "Unknown";
      genderVal.textContent = f.gender || "Unknown";
      paintRarity(f.rarity !== undefined ? f.rarity : svt.rarity);
      paintStat(hpVal, f.hpBase, f.hpMax);
      paintStat(atkVal, f.atkBase, f.atkMax);
      paintDeck(f.cardDeck, f.hits);
    };

    card._applyFormIdx = (idx) => {
      if (!formBtnGroup || !formsToUse[idx]) return;
      formBtnGroup.querySelectorAll(".f-option-btn").forEach((b) => {
        const isActive = parseInt(b.dataset.formIdx, 10) === idx;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", String(isActive));
      });
      applyFormProfile(formsToUse[idx]);
    };

    card._formsToUse = formsToUse;

    if (formBtnGroup) {
      formBtnGroup.addEventListener("click", (e) => {
        const btn = e.target.closest(".f-option-btn");
        if (!btn) return;
        const idx = parseInt(btn.dataset.formIdx, 10);
        if (isNaN(idx) || !formsToUse[idx]) return;

        card._applyFormIdx(idx);

        if (isServantFormProfile && !modalState.isSyncingForms) {
          const clickedForm = formsToUse[idx];
          const targetGlobalIdx = clickedForm.globalFormIndex !== undefined ? clickedForm.globalFormIndex : idx;
          this._syncAllCardsToForm(modalState, targetGlobalIdx);
        } else if (isAscensionProfile && !modalState.isSyncingAscension) {
          this._setServantAscensionStage(modalState, getTargetStageForAscensionForm(formsToUse[idx].label));
        }
      });
    }

    return card;
  },

  _slotHasServantForms(slot, modalState) {
    if (!slot || !slot.variantsByTier) return false;
    const variants = Object.values(slot.variantsByTier);
    if (!variants.some((v) => Array.isArray(v.forms) && v.forms.length > 1)) return false;
    const formConfig = modalState.svt.formatted?.formConfig || modalState.svt.formConfig;
    if (formConfig && Object.keys(formConfig).length > 1) return true;
    return variants.some(
      (v) =>
        Array.isArray(v.forms) &&
        v.forms.length > 1 &&
        v.forms.some((f) => /^If\s+|Spiritron Dress|All Ascensions/i.test(f.label || "")),
    );
  },

  _getSupportedTiersForForm(slot, formIdx, modalState) {
    if (!slot) return [0];
    const tiers = slot.tiers && slot.tiers.length > 0 ? slot.tiers : [0];
    if (!this._slotHasServantForms(slot, modalState)) return tiers;

    const numIdx = parseInt(formIdx, 10) || 0;
    const formConfig = modalState.svt.formatted?.formConfig || modalState.svt.formConfig;
    const formRule = formConfig && formConfig[String(numIdx)];
    const sfItem = modalState.servantForms && modalState.servantForms[numIdx];
    const formLabel = (formRule && formRule.label ? formRule.label : sfItem ? sfItem.label : "").toLowerCase();
    const formKey = (formRule && formRule.key ? formRule.key : sfItem ? sfItem.key : "").toLowerCase();

    const validTiers = [];
    tiers.forEach((t) => {
      const v = getVariantByTier(slot, t);
      if (!v) return;
      if (!v.forms || v.forms.length === 0) {
        validTiers.push(t);
        return;
      }
      const matches = v.forms.some((f) => {
        const lbl = (f.label || "").toLowerCase();
        return (formLabel && lbl.includes(formLabel)) || (formKey && lbl.includes(formKey));
      });
      if (matches) validTiers.push(t);
    });

    return validTiers.length > 0 ? validTiers : [0];
  },

  _findFormEntry(variant, formIdx, modalState) {
    if (!variant || !variant.forms || variant.forms.length === 0) {
      return { formEntry: variant, formEntryIdx: 0 };
    }
    const numIdx = parseInt(formIdx, 10) || 0;
    const formConfig = modalState.svt.formatted?.formConfig || modalState.svt.formConfig;
    const formRule = formConfig && formConfig[String(numIdx)];
    const sfItem = modalState.servantForms && modalState.servantForms[numIdx];
    const formLabel = (formRule && formRule.label ? formRule.label : sfItem ? sfItem.label : "").toLowerCase();
    const formKey = (formRule && formRule.key ? formRule.key : sfItem ? sfItem.key : "").toLowerCase();

    if (formLabel || formKey) {
      const foundIdx = variant.forms.findIndex((f) => {
        const lbl = (f.label || "").toLowerCase();
        return (formLabel && lbl.includes(formLabel)) || (formKey && lbl.includes(formKey));
      });
      if (foundIdx >= 0) {
        return { formEntry: variant.forms[foundIdx], formEntryIdx: foundIdx };
      }
    }

    if (variant.forms[numIdx]) {
      return { formEntry: variant.forms[numIdx], formEntryIdx: numIdx };
    }
    return { formEntry: variant.forms[0], formEntryIdx: 0 };
  },

  _buildSlotCard(slot, modalState) {
    const card = DOMFactory.el("div", "f-section-box");
    card._slot = slot;

    const currentFormIdx = modalState.activeFormIndex || 0;
    const validTiers = this._getSupportedTiersForForm(slot, currentFormIdx, modalState);
    const maxTier = Math.max(...validTiers);
    slot.activeTierByForm[currentFormIdx] = maxTier;
    slot.activeTier = maxTier;

    const formBar = DOMFactory.el("div", "f-form-selector-bar");
    formBar.hidden = true;
    formBar.style.display = "none";
    card.appendChild(formBar);

    const header = DOMFactory.el("div", "f-section-header");
    const titleWrap = DOMFactory.el("span", "f-section-title");
    const titleText = DOMFactory.el("span", "f-title-text");
    const strengthenWrap = DOMFactory.el("span", "f-strengthen-icons");
    titleWrap.append(titleText, strengthenWrap);

    const cooldownText = DOMFactory.el("span", "f-cooldown-text");
    cooldownText.hidden = true;
    cooldownText.style.display = "none";
    header.append(titleWrap, cooldownText);
    card.appendChild(header);

    const npOptionsBar = DOMFactory.el("div", ["f-np-options-bar", "f-option-selector-bar"]);
    npOptionsBar.hidden = true;
    npOptionsBar.style.display = "none";
    card.appendChild(npOptionsBar);

    const npMetaEl = DOMFactory.el("div", "f-np-meta");
    npMetaEl.hidden = true;
    npMetaEl.style.display = "none";
    card.appendChild(npMetaEl);

    const effectsContainer = DOMFactory.el("div", "f-effects-container");
    card.appendChild(effectsContainer);

    card._refs = { formBar, titleText, strengthenWrap, cooldownText, npOptionsBar, npMetaEl, effectsContainer };

    this._updateCardStrengthenUI(card, slot, currentFormIdx, modalState);
    const activeVariant = getVariantByTier(slot, slot.activeTier);
    if (slot.type === "np") {
      this._renderNpContent(card, activeVariant, String(currentFormIdx), modalState);
    } else {
      this._renderSkillContent(card, activeVariant, String(currentFormIdx), "0", modalState);
    }

    return card;
  },

  _updateCardStrengthenUI(card, slot, formIdx, modalState) {
    const { strengthenWrap } = card._refs;
    const validTiers = this._getSupportedTiersForForm(slot, formIdx, modalState);
    if (validTiers.length <= 1) {
      strengthenWrap.hidden = true;
      strengthenWrap.style.display = "none";
      strengthenWrap.replaceChildren();
      return;
    }

    strengthenWrap.hidden = false;
    strengthenWrap.style.display = "";
    const frag = document.createDocumentFragment();
    validTiers.forEach((tier) => {
      const isActive = tier === slot.activeTier;
      const btn = DOMFactory.el("button", ["f-strengthen-btn", isActive ? "active" : "inactive"], {
        type: "button",
        "aria-pressed": String(isActive),
      });
      btn.textContent = tier === 0 ? "Base" : validTiers.length === 2 ? "Rank Up" : `Rank Up ${tier}`;
      btn.addEventListener("click", () => {
        if (slot.activeTier === tier) return;
        const hasServantForms =
          this._slotHasServantForms(slot, modalState) && modalState.servantForms && modalState.servantForms.length > 1;
        const curFormIdx = modalState.activeFormIndex || 0;
        slot.activeTier = tier;
        slot.activeTierByForm[curFormIdx] = tier;
        const variant = getVariantByTier(slot, tier);
        if (slot.type === "np") {
          const selectedNpForm = hasServantForms ? String(curFormIdx) : card.dataset.activeNpForm || "0";
          this._renderNpContent(card, variant, selectedNpForm, modalState);
        } else {
          const selectedSkillForm = hasServantForms ? String(curFormIdx) : card.dataset.activeSkillForm || "0";
          this._renderSkillContent(card, variant, selectedSkillForm, card.dataset.activeOption || "0", modalState);
        }
        this._updateCardStrengthenUI(card, slot, curFormIdx, modalState);
      });
      frag.appendChild(btn);
    });
    strengthenWrap.replaceChildren(frag);
  },

  _renderFormSelectorButtons(formBar, buttons, onClick) {
    const group = DOMFactory.el("div", "f-option-btn-group");
    buttons.forEach(({ label, formIdx, formLabel, active }) => {
      const btn = DOMFactory.el("button", ["f-option-btn", ...(active ? ["active"] : [])], {
        type: "button",
        "aria-pressed": String(Boolean(active)),
        "data-form-idx": String(formIdx),
        "data-form-label": formLabel || "",
      });
      btn.textContent = label;
      btn.addEventListener("click", () => onClick(formIdx));
      group.appendChild(btn);
    });
    formBar.hidden = false;
    formBar.style.display = "";
    formBar.replaceChildren(group);
  },

  _renderEffectsList(effectsContainer, effects, emptyFallback = "") {
    const list = effects || [];
    if (list.length === 0 && emptyFallback) {
      const empty = DOMFactory.el("div", "f-table-val");
      empty.textContent = emptyFallback;
      effectsContainer.replaceChildren(empty);
      return;
    }
    const ul = DOMFactory.el("ul", "f-bullet-list");
    list.forEach((eff) => {
      const li = DOMFactory.el("li", "f-bullet-item");
      appendHighlightedEffect(li, eff);
      ul.appendChild(li);
    });
    effectsContainer.replaceChildren(ul);
  },

  _renderSkillContent(card, variant, selectedForm, selectedOption, modalState) {
    if (!variant) return;
    const { formBar, titleText, cooldownText, effectsContainer } = card._refs;
    const slot = card._slot;
    const servantForms = modalState.servantForms;
    const hasServantForms = this._slotHasServantForms(slot, modalState) && servantForms && servantForms.length > 1;

    let activeEffects = variant.effects || [];
    const applyTitleAndCooldown = (activeForm) => {
      if (activeForm && activeForm.name) {
        const numMatch = variant.cleanTitle.match(/^Skill\s+(\d+)/i);
        titleText.textContent = numMatch
          ? `Skill ${numMatch[1]} (${activeForm.name})`
          : `${variant.cleanTitle} (${activeForm.name})`;
      } else {
        titleText.textContent = variant.cleanTitle;
      }
      const cdText = (activeForm && activeForm.cooldown) || variant.cooldown;
      cooldownText.hidden = !cdText;
      cooldownText.style.display = cdText ? "" : "none";
      cooldownText.textContent = cdText || "";
    };

    if (hasServantForms) {
      const currentFormIdx = modalState.activeFormIndex || 0;
      card.dataset.activeSkillForm = String(currentFormIdx);
      const activeForm = this._findFormEntry(variant, currentFormIdx, modalState).formEntry;
      activeEffects = activeForm ? activeForm.effects || [] : variant.effects || [];
      applyTitleAndCooldown(activeForm);

      formBar.setAttribute("data-servant-form", "true");
      formBar.removeAttribute("data-ascension-form");
      this._renderFormSelectorButtons(
        formBar,
        servantForms.map((sf) => ({
          label: sf.label,
          formIdx: sf.index,
          formLabel: sf.label,
          active: sf.index === currentFormIdx,
        })),
        (newIdx) => {
          if (newIdx !== modalState.activeFormIndex) this._syncAllCardsToForm(modalState, newIdx);
        },
      );
    } else if (variant.forms && variant.forms.length > 1) {
      const fIdx = Math.min(Math.max(0, parseInt(selectedForm, 10) || 0), variant.forms.length - 1);
      card.dataset.activeSkillForm = String(fIdx);
      const activeForm = variant.forms[fIdx];
      activeEffects = activeForm ? activeForm.effects || [] : variant.effects || [];
      applyTitleAndCooldown(activeForm);

      const isAscensionForm = variant.forms.some((f) => /ascension/i.test(f.label || ""));
      if (isAscensionForm) formBar.setAttribute("data-ascension-form", "true");
      else formBar.removeAttribute("data-ascension-form");
      formBar.removeAttribute("data-servant-form");

      this._renderFormSelectorButtons(
        formBar,
        variant.forms.map((f, i) => ({
          label: getFormDisplayLabel(f),
          formIdx: i,
          formLabel: f.label || "",
          active: i === fIdx,
        })),
        (newIdx) => {
          if (String(newIdx) === card.dataset.activeSkillForm) return;
          this._renderSkillContent(card, variant, String(newIdx), card.dataset.activeOption || "0", modalState);
          if (isAscensionForm && variant.forms[newIdx]) {
            this._setServantAscensionStage(modalState, getTargetStageForAscensionForm(variant.forms[newIdx].label));
          }
        },
      );
    } else {
      formBar.hidden = true;
      formBar.style.display = "none";
      formBar.replaceChildren();
      formBar.removeAttribute("data-servant-form");
      formBar.removeAttribute("data-ascension-form");
      titleText.textContent = variant.cleanTitle;
      cooldownText.hidden = !variant.cooldown;
      cooldownText.style.display = variant.cooldown ? "" : "none";
      cooldownText.textContent = variant.cooldown || "";
    }

    const optInfo = parseSkillOptions(activeEffects);
    if (!optInfo.hasOptions || optInfo.options.length < 2) {
      this._renderEffectsList(effectsContainer, activeEffects, slot.type === "passive" ? "No class passives." : "");
      return;
    }

    const parsedOpt = parseInt(selectedOption, 10);
    const activeOptIdx = !isNaN(parsedOpt) && parsedOpt >= 0 && parsedOpt < optInfo.options.length ? parsedOpt : 0;
    card.dataset.activeOption = String(activeOptIdx);
    const currentOpt = optInfo.options[activeOptIdx] || optInfo.options[0];

    const frag = document.createDocumentFragment();
    const optBar = DOMFactory.el("div", "f-option-selector-bar");
    const optGroup = DOMFactory.el("div", "f-option-btn-group");
    optInfo.options.forEach((opt, idx) => {
      const btn = DOMFactory.el("button", ["f-option-btn", ...(idx === activeOptIdx ? ["active"] : [])], {
        type: "button",
        "aria-pressed": String(idx === activeOptIdx),
      });
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        if (String(idx) === card.dataset.activeOption) return;
        this._renderSkillContent(card, variant, card.dataset.activeSkillForm || "0", String(idx), modalState);
      });
      optGroup.appendChild(btn);
    });
    optBar.appendChild(optGroup);
    frag.appendChild(optBar);

    const ul = DOMFactory.el("ul", "f-bullet-list");
    (currentOpt ? currentOpt.effects : []).forEach((eff) => {
      const li = DOMFactory.el("li", "f-bullet-item");
      appendHighlightedEffect(li, eff);
      ul.appendChild(li);
    });
    frag.appendChild(ul);
    effectsContainer.replaceChildren(frag);
  },

  _isNpAscensionOrFormBase(variant) {
    if (!variant || !variant.forms || variant.forms.length <= 1) return false;
    if (variant.forms.some((f) => /ascension|spiritron\s+dress|if\s+/i.test(f.label || ""))) return true;
    const distinctNames = new Set(variant.forms.map((f) => (f.name || "").trim()).filter(Boolean));
    return distinctNames.size > 1;
  },

  _renderNpSubOptions(card, variant, activeForm, optionsBar, titleText, modalState) {
    if (!activeForm || !activeForm.options || activeForm.options.length <= 1) {
      optionsBar.hidden = true;
      optionsBar.style.display = "none";
      optionsBar.replaceChildren();
      return false;
    }

    const optIdx = Math.min(Math.max(0, parseInt(card.dataset.activeNpOption, 10) || 0), activeForm.options.length - 1);
    card.dataset.activeNpOption = String(optIdx);
    const activeOpt = activeForm.options[optIdx];

    const group = DOMFactory.el("div", "f-option-btn-group");
    activeForm.options.forEach((opt, i) => {
      const btn = DOMFactory.el("button", ["f-option-btn", ...(i === optIdx ? ["active"] : [])], {
        type: "button",
        "aria-pressed": String(i === optIdx),
      });
      btn.textContent = getFormDisplayLabel(opt);
      btn.addEventListener("click", () => {
        if (String(i) === card.dataset.activeNpOption) return;
        card.dataset.activeNpOption = String(i);
        this._renderNpContent(card, variant, card.dataset.activeNpForm || "0", modalState);
      });
      group.appendChild(btn);
    });

    optionsBar.hidden = false;
    optionsBar.style.display = "";
    optionsBar.replaceChildren(group);

    if (activeOpt && activeOpt.name) {
      titleText.textContent = `Noble Phantasm (${activeOpt.name})`;
    } else {
      titleText.textContent = activeForm.name ? `Noble Phantasm (${activeForm.name})` : variant.cleanTitle;
    }
    this._renderNpDetails(card, activeOpt.metaLines, activeOpt.effects);
    return true;
  },

  _renderNpDetails(card, metaLines, effects) {
    const { npMetaEl, effectsContainer } = card._refs;
    const lines = metaLines || [];
    if (lines.length > 0) {
      const frag = document.createDocumentFragment();
      lines.forEach((m) => {
        const badge = DOMFactory.el("span", "f-hit-badge");
        badge.textContent = m;
        frag.appendChild(badge);
      });
      npMetaEl.replaceChildren(frag);
      npMetaEl.hidden = false;
      npMetaEl.style.display = "";
    } else {
      npMetaEl.replaceChildren();
      npMetaEl.hidden = true;
      npMetaEl.style.display = "none";
    }
    this._renderEffectsList(effectsContainer, effects);
  },

  _renderNpContent(card, variant, selectedIndex, modalState) {
    if (!variant) return;
    const { formBar, npOptionsBar, titleText } = card._refs;
    const slot = card._slot;
    const servantForms = modalState.servantForms;
    const hasServantForms = this._slotHasServantForms(slot, modalState) && servantForms && servantForms.length > 1;

    if (hasServantForms) {
      const currentFormIdx = modalState.activeFormIndex || 0;
      card.dataset.activeNpForm = String(currentFormIdx);
      formBar.setAttribute("data-servant-form", "true");
      formBar.removeAttribute("data-ascension-form");
      this._renderFormSelectorButtons(
        formBar,
        servantForms.map((sf) => ({
          label: sf.label,
          formIdx: sf.index,
          formLabel: sf.label,
          active: sf.index === currentFormIdx,
        })),
        (newIdx) => {
          if (newIdx !== modalState.activeFormIndex) this._syncAllCardsToForm(modalState, newIdx);
        },
      );

      const activeForm = this._findFormEntry(variant, currentFormIdx, modalState).formEntry;
      if (this._renderNpSubOptions(card, variant, activeForm, npOptionsBar, titleText, modalState)) return;

      titleText.textContent =
        activeForm && activeForm.name ? `Noble Phantasm (${activeForm.name})` : variant.cleanTitle;
      this._renderNpDetails(
        card,
        activeForm ? activeForm.metaLines : variant.metaLines,
        activeForm ? activeForm.effects : variant.effects,
      );
      return;
    }

    if (!variant.forms || variant.forms.length === 0) {
      formBar.hidden = true;
      formBar.style.display = "none";
      formBar.replaceChildren();
      formBar.removeAttribute("data-servant-form");
      formBar.removeAttribute("data-ascension-form");
      npOptionsBar.hidden = true;
      npOptionsBar.style.display = "none";
      npOptionsBar.replaceChildren();
      titleText.textContent = variant.cleanTitle;
      this._renderNpDetails(card, variant.metaLines, variant.effects);
      return;
    }

    const idx = Math.min(Math.max(0, parseInt(selectedIndex, 10) || 0), variant.forms.length - 1);
    if (String(idx) !== card.dataset.activeNpForm) card.dataset.activeNpOption = "0";
    card.dataset.activeNpForm = String(idx);
    const activeForm = variant.forms[idx];

    if (this._isNpAscensionOrFormBase(variant)) {
      if (variant.forms.length > 1) {
        const isAscensionForm = variant.forms.some((f) => /ascension/i.test(f.label || ""));
        if (isAscensionForm) formBar.setAttribute("data-ascension-form", "true");
        else formBar.removeAttribute("data-ascension-form");
        formBar.removeAttribute("data-servant-form");

        this._renderFormSelectorButtons(
          formBar,
          variant.forms.map((f, i) => ({
            label: getFormDisplayLabel(f),
            formIdx: i,
            formLabel: f.label || "",
            active: i === idx,
          })),
          (newIdx) => {
            if (String(newIdx) === card.dataset.activeNpForm) return;
            this._renderNpContent(card, variant, String(newIdx), modalState);
            if (isAscensionForm && variant.forms[newIdx]) {
              this._setServantAscensionStage(modalState, getTargetStageForAscensionForm(variant.forms[newIdx].label));
            }
          },
        );
      } else {
        formBar.hidden = true;
        formBar.style.display = "none";
        formBar.replaceChildren();
      }

      if (this._renderNpSubOptions(card, variant, activeForm, npOptionsBar, titleText, modalState)) return;
    } else {
      formBar.hidden = true;
      formBar.style.display = "none";
      formBar.replaceChildren();
      formBar.removeAttribute("data-servant-form");
      formBar.removeAttribute("data-ascension-form");

      const group = DOMFactory.el("div", "f-option-btn-group");
      variant.forms.forEach((f, i) => {
        const btn = DOMFactory.el("button", ["f-option-btn", ...(i === idx ? ["active"] : [])], {
          type: "button",
          "aria-pressed": String(i === idx),
          "data-form-idx": String(i),
          "data-form-label": f.label || "",
        });
        btn.textContent = getFormDisplayLabel(f);
        btn.addEventListener("click", () => {
          if (String(i) === card.dataset.activeNpForm) return;
          this._renderNpContent(card, variant, String(i), modalState);
        });
        group.appendChild(btn);
      });
      npOptionsBar.hidden = false;
      npOptionsBar.style.display = "";
      npOptionsBar.replaceChildren(group);
    }

    if (activeForm && activeForm.name && /^Noble Phantasm(\s+\(|$)/.test(variant.cleanTitle)) {
      titleText.textContent = `Noble Phantasm (${activeForm.name})`;
    } else {
      titleText.textContent = variant.cleanTitle;
    }

    this._renderNpDetails(
      card,
      activeForm ? activeForm.metaLines : variant.metaLines,
      activeForm ? activeForm.effects : variant.effects,
    );
  },

  _syncAllCardsToForm(modalState, formIdx, syncSg = true) {
    if (modalState.isSyncingForms) return;
    const nextIdx = Math.max(0, parseInt(formIdx, 10) || 0);
    modalState.activeFormIndex = nextIdx;
    if (syncSg && modalState.sgController && !modalState.isSyncingSg) {
      modalState.sgController.stepToForm(nextIdx);
    }
    modalState.isSyncingForms = true;

    try {
      const profileCard = modalState.profileCard;
      if (profileCard && profileCard._formsToUse) {
        const formsList = modalState.servantForms;
        const currentForm = formsList && formsList[nextIdx];
        const currentLabel = (currentForm ? currentForm.label || "" : "").toLowerCase();
        let matchIdx = profileCard._formsToUse.findIndex((f) => {
          if (f.globalFormIndex !== undefined && f.globalFormIndex === nextIdx) return true;
          const fLabel = (f.label || "").trim().toLowerCase();
          return (
            fLabel === currentLabel ||
            (currentLabel.includes("paladin") && fLabel.includes("paladin")) ||
            (currentLabel.includes("ortinax") && fLabel.includes("ortinax"))
          );
        });
        if (matchIdx < 0 && !currentLabel.includes("ortinax") && nextIdx < profileCard._formsToUse.length) {
          matchIdx = nextIdx;
        }
        if (matchIdx < 0) {
          matchIdx = profileCard._formsToUse.findIndex((f) => {
            const fLabel = (f.label || "").trim().toLowerCase();
            return fLabel.includes("all ascension") || fLabel === "default";
          });
        }
        if (matchIdx < 0) matchIdx = 0;
        profileCard._applyFormIdx(matchIdx);
      }

      modalState.slotCards.forEach((card) => {
        const slot = card._slot;
        if (!this._slotHasServantForms(slot, modalState)) return;
        const validTiers = this._getSupportedTiersForForm(slot, nextIdx, modalState);
        const maxEffectiveTier = Math.max(...validTiers);
        let activeTier = slot.activeTierByForm[nextIdx];
        if (activeTier === undefined || !validTiers.includes(activeTier)) {
          activeTier = maxEffectiveTier;
          slot.activeTierByForm[nextIdx] = activeTier;
        }
        slot.activeTier = activeTier;
        this._updateCardStrengthenUI(card, slot, nextIdx, modalState);

        const variant = getVariantByTier(slot, activeTier);
        if (slot.type === "np") {
          this._renderNpContent(card, variant, String(nextIdx), modalState);
        } else {
          this._renderSkillContent(card, variant, String(nextIdx), card.dataset.activeOption || "0", modalState);
        }
      });
    } finally {
      modalState.isSyncingForms = false;
    }
  },

  _setServantAscensionStage(modalState, stageStr, syncSg = true) {
    if (modalState.isSyncingAscension) return;
    if (syncSg && modalState.sgController && !modalState.isSyncingSg) {
      modalState.sgController.stepToAscension(stageStr);
    }
    modalState.isSyncingAscension = true;
    try {
      const modalBody = document.getElementById("servantInfoModalBody");
      if (!modalBody) return;
      modalBody
        .querySelectorAll('.f-form-selector-bar[data-ascension-form="true"] .f-option-btn-group')
        .forEach((group) => {
          const targetBtn = getMatchingButtonForStage(group, stageStr);
          if (targetBtn && !targetBtn.classList.contains("active")) {
            targetBtn.click();
          }
        });
    } finally {
      modalState.isSyncingAscension = false;
    }
  },
};
