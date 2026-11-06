import {
  BOND_CONSTANTS,
  SERVANT_MAX_SLOTS,
  QUEST_FAMILIES,
  FREE_QUESTS,
  GRAND_CLASSES,
  GRAND_DIFFICULTIES,
  BOND_STORAGE_KEY,
} from "./constants.js";
import { Validator, TraitMatcher, SlotCEs, Teapot, Quest } from "./domain.js";
import { ServantData, CEById, TraitNames } from "./data.js";
import { DOMFactory } from "./presentation.js";

/* One servant slot's shape. Every place a slot is created or cleared goes through here, so a new
   field is added once instead of in each of the eight copies this replaced. */
function defaultSlot(overrides = {}) {
  return {
    servantId: null,
    bondNeeded: 0,
    bondLevel: BOND_CONSTANTS.MIN_BOND_LEVEL,
    targetLevel: BOND_CONSTANTS.MIN_BOND_LEVEL + 1,
    type: "normal",
    maxBond: false,
    bond15: false,
    ascension: null,
    ces: [],
    grand: false,
    ...overrides,
  };
}

export const BondApp = {
  state: null,
  elements: {},
  _refs: null,
  /* The teapot count box and its switch live in the page markup, not in buildServantSlots(), so they
     are kept apart from `elements`, which that builder clears on every re-render. */
  _teapotInputs: null,

  configure(refs) {
    // refs = { ServantSelector, AscensionSelector, CESelector, CESubSelector, ServantDrag }
    this._refs = refs;
  },

  _createServantCallbacks(slotIndex) {
    return {
      onSelect: (_slotIdx, servantId, ascension) => this.setServant(slotIndex, servantId, ascension),
      onPendingRemove: () => {
        this.state.slots[slotIndex] = defaultSlot();
        this.saveState();
        this.buildServantSlots();
      },
      onOpenAscension: (servant, idx) => {
        this._refs.AscensionSelector.open(servant, idx, {
          onSelect: (_si, servantId, asc) => this.setServant(idx, servantId, asc),
          onBack: (backIdx) => {
            this._refs.ServantSelector.open(
              backIdx,
              false,
              this._createServantCallbacks(backIdx),
              this._pickerOptions(),
            );
          },
        });
      },
    };
  },

  /* One callback set per (slot, position). The selectors only carry a number through to
     onPendingRemove, so the position they hand back is ignored in favour of the closed-over one. */
  _createCECallbacks(slotIndex, position) {
    return {
      onSelect: (_position, ceId, optionId) => this.setCE(slotIndex, position, ceId, optionId),
      onPendingRemove: () => this.removeCE(slotIndex, position),
    };
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;
    const saved = this.loadState();
    this.state = saved || {
      slots: Array.from({ length: SERVANT_MAX_SLOTS }, () => defaultSlot()),
      questMain: "",
      questSub: "",
      questClass: "",
      questDiff: "",
      customBond: 0,
      customAp: BOND_CONSTANTS.DEFAULT_CUSTOM_AP,
      maxAp: BOND_CONSTANTS.DEFAULT_MAX_AP,
      teapotCount: 0,
      teapotOn: false,
      // Parties filed by quest choice; the live one is `slots`, so its own key is absent here.
      parties: {},
    };

    this.initQuestSelects();

    // Build servant slots (each card renders its own essences)
    this.buildServantSlots();

    // Calculate button
    const calcBtn = document.getElementById("bondCalculateBtn");
    if (calcBtn) {
      calcBtn.addEventListener("click", () => this.calculate());
    }

    // Max AP (for Golden Fruit conversion)
    const maxApInput = document.getElementById("maxApInput");
    if (maxApInput) {
      maxApInput.value = this.state.maxAp;
      maxApInput.addEventListener("change", () => {
        this.state.maxAp = Validator.clamp(maxApInput.value, 1, BOND_CONSTANTS.MAX_PLAYER_AP);
        maxApInput.value = this.state.maxAp;
        this.saveState();
      });
    }

    // Stargazer's Teapot: how many the player holds, and whether the plan spends them.
    const teapotCount = document.getElementById("teapotCountInput");
    const teapotToggle = document.getElementById("teapotToggle");
    if (teapotCount && teapotToggle) {
      this._teapotInputs = { count: teapotCount, toggle: teapotToggle };
      teapotCount.value = this.state.teapotCount;
      teapotToggle.checked = this.state.teapotOn;
      // Saving only: the teapot changes what the *next* plan costs, so pricing stays the Calculate button's job.
      const syncTeapot = () => {
        this.state.teapotCount = Validator.clamp(teapotCount.value, 0, BOND_CONSTANTS.MAX_TEAPOT_COUNT);
        teapotCount.value = this.state.teapotCount;
        this.state.teapotOn = teapotToggle.checked;
        this.saveState();
      };
      teapotCount.addEventListener("change", syncTeapot);
      teapotToggle.addEventListener("change", syncTeapot);
    }

    // Init servant selector
    this._refs.ServantSelector.init();

    // Init ascension selector
    this._refs.AscensionSelector.init();

    // Init servant drag reorder
    this._refs.ServantDrag.init({
      onSwap: (fromIndex, toIndex) => {
        this.flushInputsToState();
        const temp = this.state.slots[fromIndex];
        this.state.slots[fromIndex] = this.state.slots[toIndex];
        this.state.slots[toIndex] = temp;
        this.saveState();
        this.buildServantSlots();
      },
    });

    // Init CE selector
    this._refs.CESelector.init();
    this._refs.CESubSelector.init();
  },

  /* ============================================
     QUEST SELECTS
     ============================================ */
  /* The Select Quest card cascades: a family first (Free Quest or Grand Duel), then the choice inside it —
     one of the two free quests or a custom figure, or a class group plus a Rank-Up Training Battle level.
     Every label and every bond figure comes from constants.js, so a number has one home. */
  initQuestSelects() {
    const main = document.getElementById("bondQuestSelect");
    const free = document.getElementById("bondFreeQuestSelect");
    const gdClass = document.getElementById("bondGrandClassSelect");
    const gdDiff = document.getElementById("bondGrandDiffSelect");
    const customInput = document.getElementById("customBondPerRun");
    const customApInput = document.getElementById("customApPerRun");
    if (!main || !free || !gdClass || !gdDiff) return;

    const addOptions = (select, items) => {
      const frag = document.createDocumentFragment();
      items.forEach(({ value, label }) => {
        const opt = DOMFactory.el("option", null, { value });
        opt.textContent = label;
        frag.appendChild(opt);
      });
      select.appendChild(frag);
    };

    addOptions(
      main,
      QUEST_FAMILIES.map((f) => ({ value: f.key, label: f.name })),
    );
    addOptions(free, [
      ...FREE_QUESTS.map((q) => ({ value: q.key, label: `${q.name} (${q.bond} pts)` })),
      { value: "custom", label: "-- Custom --" },
    ]);
    addOptions(
      gdClass,
      GRAND_CLASSES.map((c) => ({ value: c.key, label: c.name })),
    );
    addOptions(
      gdDiff,
      GRAND_DIFFICULTIES.map((d) => ({
        value: d.key,
        label: `Rank-Up Training Battle ${d.roman} ${d.lv} (${d.bond} pts)`,
      })),
    );

    this._questSelects = { main, free, gdClass, gdDiff };

    /* Each select owns one state field and saves it on change — the class limit has to survive a reload
       even if the player never presses Calculate. The two fields that decide which party is on screen
       also swap it, so the old one is put away before the new one is named. */
    const bind = (key, select) => {
      const swaps = key === "questMain" || key === "questClass";
      select.value = this.state[key];
      select.addEventListener("change", () => {
        if (swaps) this.stashParty();
        this.state[key] = select.value;
        if (swaps) {
          this.applyParty();
          this._refs?.ServantSelector?.resetFilters?.();
        }
        this.saveState();
        this.syncQuestRows();
      });
    };
    bind("questMain", main);
    bind("questSub", free);
    bind("questClass", gdClass);
    bind("questDiff", gdDiff);

    if (customInput) customInput.value = this.state.customBond;
    if (customApInput) customApInput.value = this.state.customAp;
    this.syncQuestRows();
  },

  /* Only the rows belonging to the chosen family show, and the custom bond box only under Custom.
     `hidden` cannot do this job: `.input-row` declares a display, which outranks the UA rule. */
  syncQuestRows() {
    const { free, gdClass, gdDiff } = this._questSelects;
    const customRow = document.getElementById("customQuestSection");
    const customInput = document.getElementById("customBondPerRun");
    const customApInput = document.getElementById("customApPerRun");
    const freeOn = this.state.questMain === "fq";
    const grandOn = this.state.questMain === "gd";
    free.closest(".input-row").style.display = freeOn ? "flex" : "none";
    gdClass.closest(".input-row").style.display = grandOn ? "flex" : "none";
    gdDiff.closest(".input-row").style.display = grandOn ? "flex" : "none";
    const customOn = freeOn && this.state.questSub === "custom";
    if (customInput) customInput.disabled = !customOn;
    if (customApInput) customApInput.disabled = !customOn;
    if (customRow) customRow.style.display = customOn ? "block" : "none";
  },

  /* A Grand Duel class choice limits the party, so the servant picker opens already filtered to those
     classes and locked to them. Everywhere else the player filters the list themselves. */
  _pickerOptions() {
    return this.state.questMain === "gd" ? { lockClasses: Quest.classIds(this.state.questClass) } : {};
  },

  /* ============================================
     PARTY PER QUEST CHOICE
     ============================================ */
  /* Which party is on screen: one per Grand Duel choice, and the shared one (`""`) for Free Quest or no
     quest at all. A class not picked yet counts as "all", so entering Grand Duel never opens an orphan. */
  _partyKey() {
    return this.state.questMain === "gd" ? this.state.questClass || "all" : "";
  },

  /* Put the party on screen away under its own key before the quest moves off it. Copied, so the stored
     party and the live array stop sharing slot objects the moment the rack is rebuilt. */
  stashParty() {
    this.flushInputsToState();
    const party = this.state.slots.map((slot) => ({ ...slot, ces: [...slot.ces] }));
    // A rack with nobody in it carries nothing worth filing — an absent key already means empty, and
    // twelve of these per save would only bloat localStorage.
    if (party.some((slot) => slot.servantId)) this.state.parties[this._partyKey()] = party;
  },

  /* The other choice's party, or an empty rack: a save from before parties existed has nothing filed by
     class, so every Grand Duel choice starts blank and fills itself up. */
  applyParty() {
    const key = this._partyKey();
    const stored = this.state.parties[key];
    this.state.slots = stored || Array.from({ length: SERVANT_MAX_SLOTS }, () => defaultSlot());
    // The live party travels as `state.slots`, so its key must not be written twice.
    if (stored) delete this.state.parties[key];
    this.buildServantSlots();
  },

  removeSlot(index) {
    this.flushInputsToState();
    this.state.slots[index] = defaultSlot();
    this.saveState();
    this.buildServantSlots();
  },

  /* The bonus line the old CE card printed under each portrait. It now only feeds the chip's title and
     alt text, since the card keeps the essence to a portrait. */
  _ceBonusText(ce, ceEntry, isSupport) {
    const bonus = SlotCEs.rate(ce, isSupport);
    if (typeof ceEntry === "object" && ceEntry.groupId) {
      return ce.flatBonus > 0 ? `+${ce.flatBonus} pts All` : `+${bonus}% All`;
    }
    if (ce.traitGroups.length > 0) {
      const groups = ce.traitGroups.map((group) => group.map((t) => TraitNames[t] || t).join(" or ")).join(" and ");
      return `+${bonus}% ${groups}`;
    }
    if (ce.traits.length === 0) return `+${bonus}% All`;
    const traitNames = ce.traits.map((t) => TraitNames[t] || t);
    const joiner = ce.matchAll ? " and " : " or ";
    return `+${bonus}% ${traitNames.join(joiner)}`;
  },

  /* A blank position, or a pending hole the picker owns. */
  _buildCEAddChip(slotIndex, position) {
    const chip = DOMFactory.el("div", ["ce-chip", "ce-chip--add"]);
    chip.textContent = "+";
    chip.title = "Add craft essence";
    chip.addEventListener("click", () => this.addCE(slotIndex, position));
    return chip;
  },

  /* One position of the slot's essence list: a 64px portrait and nothing else \u2014 the name and the bonus
     live in the chip's title and in the results card. An id that no longer resolves still gets a chip
     (the id as its text) so the player can always remove it. */
  _buildCEChip(slotData, slotIndex, position) {
    const ceEntry = slotData.ces[position];
    if (!ceEntry) return this._buildCEAddChip(slotIndex, position);

    const grouped = typeof ceEntry === "object" && ceEntry.groupId;
    const ce = CEById.get(grouped ? ceEntry.groupId : ceEntry);
    const option = grouped && ce && ce.options ? ce.options.find((o) => o.id === ceEntry.optionId) : null;
    const ceName = grouped ? (option ? option.name : ce ? ce.name : ceEntry.groupId) : ce ? ce.name : ceEntry;
    const ceImage = grouped ? (option ? option.image : ce ? ce.image : null) : ce ? ce.image : null;
    const idText = grouped ? ceEntry.groupId : ceEntry;

    const chip = DOMFactory.el("div", "ce-chip");
    chip.title = ce ? `${ceName} \u00b7 ${this._ceBonusText(ce, ceEntry, slotData.type === "support")}` : ceName;
    if (ceImage) {
      const img = DOMFactory.createLazyImg(ceImage, "ce-chip-img", { alt: ceName });
      DOMFactory.addSimpleFallback(img, "ce-chip-fallback", idText);
      chip.appendChild(img);
    } else {
      const fb = DOMFactory.el("div", "ce-chip-fallback");
      fb.textContent = idText;
      chip.appendChild(fb);
    }

    // Click to re-pick this position, straight to the options when it is a grouped essence.
    chip.addEventListener("click", () => {
      const callbacks = this._createCECallbacks(slotIndex, position);
      if (ce && ce.isGroup) {
        this._refs.CESubSelector.open(ce, position, callbacks);
      } else {
        this._refs.CESelector.open(position, false, callbacks);
      }
    });

    const removeBtn = DOMFactory.el("button", "ce-chip-x", { type: "button" });
    removeBtn.textContent = "\u2715";
    removeBtn.title = "Remove craft essence";
    removeBtn.setAttribute("aria-label", `Remove ${ceName}`);
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeCE(slotIndex, position);
    });
    chip.appendChild(removeBtn);

    return chip;
  },

  /* The card's own essence block: a bordered field labelled "Craft Essence" holding the Grand Servant
     tick and one chip per position the slot can wear. The tick belongs to Grand Duel alone — a Free Quest
     party never wears two essences, so it is not offered the choice. Building the row or leaving it out
     (never hiding it) is what the house does for fields a state cannot use, and a quest change already
     rebuilds the rack through applyParty(), so the tick appears and goes with it. */
  _buildSlotCEs(slotData, slotIndex) {
    const block = DOMFactory.el("div", "slot-ce-block");
    const grandOn = this.state.questMain === "gd";

    const label = DOMFactory.el("label", "bond-input-box-label", grandOn ? { for: `slotGrand_${slotIndex}` } : {});
    label.textContent = "Craft Essence";
    block.appendChild(label);

    if (grandOn) {
      const grandCheckbox = DOMFactory.el("input", "bond-checkbox", {
        type: "checkbox",
        id: `slotGrand_${slotIndex}`,
      });
      if (slotData.grand) grandCheckbox.checked = true;
      const grandText = DOMFactory.el("span");
      grandText.textContent = "Grand Servant";
      const grandLabel = DOMFactory.el("label", "bond-checkbox-label");
      grandLabel.appendChild(grandCheckbox);
      grandLabel.appendChild(grandText);
      const checkboxRow = DOMFactory.el("div", "bond-checkbox-row");
      checkboxRow.appendChild(grandLabel);
      block.appendChild(checkboxRow);

      grandCheckbox.addEventListener("change", () => {
        this.flushInputsToState();
        slotData.grand = grandCheckbox.checked;
        SlotCEs.trim(slotData); // unticking drops the second essence, no confirmation, no restore
        this.saveState();
        this.buildServantSlots();
      });
    }

    const strip = DOMFactory.el("div", "slot-ce-strip");
    const chips = document.createDocumentFragment();
    for (let position = 0; position < SlotCEs.capacity(slotData); position++) {
      chips.appendChild(this._buildCEChip(slotData, slotIndex, position));
    }
    strip.replaceChildren(chips);
    block.appendChild(strip);

    return block;
  },

  setCE(slotIndex, position, ceId, optionId) {
    const slot = this.state.slots[slotIndex];
    if (!slot || position < 0 || position >= SlotCEs.capacity(slot)) return;
    slot.ces[position] = optionId ? { groupId: ceId, optionId: optionId } : ceId;
    this.saveState();
    this.buildServantSlots();
  },

  removeCE(slotIndex, position) {
    const slot = this.state.slots[slotIndex];
    if (!slot) return;
    slot.ces.splice(position, 1);
    this.saveState();
    this.buildServantSlots();
  },

  /* Pending Slot: the hole is a null in the slot's own list, so partyPool skips it while the picker is
     open and cancelling splices it back out. */
  addCE(slotIndex, position) {
    const slot = this.state.slots[slotIndex];
    if (!slot) return;
    slot.ces[position] = null;
    this.buildServantSlots();
    this._refs.CESelector.open(position, true, this._createCECallbacks(slotIndex, position));
  },

  flushInputsToState() {
    this.state.slots.forEach((slot, i) => {
      const input = this.elements[`slotBond_${i}`];
      if (input && (slot.type || "normal") === "normal" && !slot.maxBond) {
        slot.bondNeeded = Validator.clamp(input.value, 0, BOND_CONSTANTS.MAX_BOND_NEEDED);
      }
    });
  },

  buildServantSlots() {
    const grid = document.getElementById("servantGrid");
    if (!grid) return;
    this.elements = {};

    const frag = document.createDocumentFragment();
    const bondTabActive = document.documentElement.getAttribute("data-tab") === "bond";
    let firstPortraitCreated = false;

    for (let i = 0; i < SERVANT_MAX_SLOTS; i++) {
      const slotData = this.state.slots[i] || defaultSlot();

      // Insert group labels before first slot of each group
      if (i === 0) {
        const label = DOMFactory.el("div", "bond-group-label bond-group-label--frontline");
        label.textContent = "Starting Member";
        frag.appendChild(label);
      } else if (i === BOND_CONSTANTS.FRONTLINE_SIZE) {
        const label = DOMFactory.el("div", "bond-group-label bond-group-label--backline");
        label.textContent = "Sub Member";
        frag.appendChild(label);
      }

      const isFrontline = i < BOND_CONSTANTS.FRONTLINE_SIZE;
      const slotClass = isFrontline ? "servant-slot servant-slot--frontline" : "servant-slot servant-slot--backline";
      const slot = DOMFactory.el("div", slotClass);
      slot.dataset.slotIndex = i;

      if (slotData.servantId) {
        // --- Filled slot ---
        slot.style.cursor = "grab";

        // Portrait area (clickable to open selector)
        const portraitArea = DOMFactory.el("div", "servant-slot-select-btn");
        let servantHasAscensions = false;

        const servant = ServantData.getServant(slotData.servantId);
        if (servant) {
          servantHasAscensions = servant.hasAscensions;
          const ascension = ServantData.getDefaultAscension(slotData.servantId, slotData.ascension);
          const imgSrc = ServantData.getImageForAscension(servant.id, ascension);
          const isFirstPortrait = bondTabActive && !firstPortraitCreated;
          if (isFirstPortrait) firstPortraitCreated = true;
          const img = DOMFactory.createLazyImg(imgSrc, "servant-slot-portrait", {
            alt: servant.name,
            draggable: "false",
            ...(isFirstPortrait ? { loading: "eager", fetchpriority: "high" } : {}),
          });
          DOMFactory.addAscensionFallback(img, servant.id);
          portraitArea.appendChild(img);
          if (servant.hasAscensions) {
            const ascSlotIndex = i;
            portraitArea.style.cursor = "pointer";
            portraitArea.addEventListener("click", () => {
              this._refs.AscensionSelector.open(servant, ascSlotIndex, {
                onSelect: (_si, servantId, asc) => this.setServant(ascSlotIndex, servantId, asc),
                onBack: (backIdx) => {
                  this._refs.ServantSelector.open(
                    backIdx,
                    false,
                    this._createServantCallbacks(backIdx),
                    this._pickerOptions(),
                  );
                },
              });
            });
          }
        } else {
          const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
          fb.textContent = slotData.servantId;
          portraitArea.appendChild(fb);
        }

        if (!servantHasAscensions) {
          const selectorSlotIndex = i;
          portraitArea.addEventListener("click", () => {
            this._refs.ServantSelector.open(
              selectorSlotIndex,
              false,
              this._createServantCallbacks(selectorSlotIndex),
              this._pickerOptions(),
            );
          });
          portraitArea.style.cursor = "pointer";
        }

        // Badges: Frontline bonus and/or Bond >= 15 bonus (placed at top-left outside servant portrait)
        const slotType = slotData.type || "normal";
        const hasFrontlineBadge = isFrontline;
        const hasBond15Badge = slotType === "normal" && !!slotData.bond15;

        if (hasFrontlineBadge || hasBond15Badge) {
          const badgeContainer = DOMFactory.el("div", "servant-slot-frontline-badge");

          const createBadge = (isAll, percentText, titleText, altText) => {
            const item = DOMFactory.el("div", "servant-slot-badge-item");
            const badgeImg = DOMFactory.el("img", "", {
              src: "icons/bond_icon.webp",
              alt: altText,
              title: titleText,
              draggable: "false",
            });
            item.appendChild(badgeImg);

            const overlay = DOMFactory.el("div", "servant-slot-badge-overlay");
            if (isAll) {
              const scope = DOMFactory.el("span", "servant-slot-badge-scope");
              scope.textContent = "All";
              overlay.appendChild(scope);
            }
            const percent = DOMFactory.el(
              "span",
              isAll ? "servant-slot-badge-percent" : "servant-slot-badge-percent servant-slot-badge-percent--single",
            );
            percent.textContent = percentText;
            overlay.appendChild(percent);

            item.appendChild(overlay);
            return item;
          };

          // 1. Frontline bonus badge (Starting Member: +20% self for normal, +4% All for support)
          if (hasFrontlineBadge) {
            const isAll = slotType === "support";
            const percentText = isAll ? "+4%" : "+20%";
            const titleText = isAll ? "Starting member support: +4% Bond (All)" : "Starting member: +20% Bond (Self)";
            const altText = isAll ? "Support (+4% All)" : "Frontline (+20%)";
            badgeContainer.appendChild(createBadge(isAll, percentText, titleText, altText));
          }

          // 2. Bond >= 15 bonus badge (+25% All)
          // Always present in any slot if Bond >= 15 is checked; displayed below +self 20% when in starting member
          if (hasBond15Badge) {
            badgeContainer.appendChild(
              createBadge(true, "+25%", "Bond \u226515: +25% Bond (All)", "Bond \u226515 (+25% All)"),
            );
          }

          slot.appendChild(badgeContainer);
        }

        slot.appendChild(portraitArea);

        // Info area: name + type dropdown + bond input
        const info = DOMFactory.el("div", "servant-slot-info");

        const nameEl = DOMFactory.el("div", "servant-slot-name");
        nameEl.textContent = servant
          ? ServantData.getAscensionName(servant.id, slotData.ascension)
          : slotData.servantId;
        info.appendChild(nameEl);

        // Type dropdown
        const typeRow = DOMFactory.el("div", "input-row");
        const typeSelect = DOMFactory.el("select", "select-field", { id: `slotType_${i}` });
        const typeOpts = [
          { value: "normal", text: "Normal Servant" },
          { value: "support", text: "Support Servant" },
        ];
        typeOpts.forEach((opt) => {
          const o = DOMFactory.el("option", null, { value: opt.value });
          o.textContent = opt.text;
          if (opt.value === (slotData.type || "normal")) o.selected = true;
          typeSelect.appendChild(o);
        });
        typeRow.appendChild(typeSelect);
        info.appendChild(typeRow);

        const typeSlotIndex = i;
        typeSelect.addEventListener("change", () => {
          this.flushInputsToState();
          this.state.slots[typeSlotIndex].type = typeSelect.value;
          if (typeSelect.value === "support") {
            this.state.slots[typeSlotIndex].maxBond = false;
            this.state.slots[typeSlotIndex].bond15 = false;
          }
          this.saveState();
          this.buildServantSlots();
        });

        // Controls: checkboxes + bond required input
        const isSupport = slotType === "support";
        const isBondHidden = isSupport || !!slotData.maxBond;

        /* Checkboxes row: "Max Bond" and "Bond >=15". A support servant has neither, so the row is not
           built at all; it used to sit here invisible, holding the height of a row nobody can reach. */
        if (!isSupport) {
          const checkboxRow = DOMFactory.el("div", "bond-checkbox-row");

          const maxBondLabel = DOMFactory.el("label", "bond-checkbox-label");
          const maxBondCheckbox = DOMFactory.el("input", "bond-checkbox", {
            type: "checkbox",
            id: `slotMaxBond_${i}`,
          });
          if (slotData.maxBond) maxBondCheckbox.checked = true;
          const maxBondText = DOMFactory.el("span");
          maxBondText.textContent = "Max Bond";
          maxBondLabel.appendChild(maxBondCheckbox);
          maxBondLabel.appendChild(maxBondText);
          checkboxRow.appendChild(maxBondLabel);

          const bond15Label = DOMFactory.el("label", "bond-checkbox-label");
          const bond15Checkbox = DOMFactory.el("input", "bond-checkbox", {
            type: "checkbox",
            id: `slotBond15_${i}`,
          });
          if (slotData.bond15) bond15Checkbox.checked = true;
          const bond15Text = DOMFactory.el("span");
          bond15Text.textContent = "Bond \u226515";
          bond15Label.appendChild(bond15Checkbox);
          bond15Label.appendChild(bond15Text);
          checkboxRow.appendChild(bond15Label);

          info.appendChild(checkboxRow);

          maxBondCheckbox.addEventListener("change", () => {
            this.flushInputsToState();
            slotData.maxBond = maxBondCheckbox.checked;
            this.saveState();
            this.buildServantSlots();
          });

          bond15Checkbox.addEventListener("change", () => {
            this.flushInputsToState();
            slotData.bond15 = bond15Checkbox.checked;
            this.saveState();
            this.buildServantSlots();
          });
        }

        /* Bond level selects, then the point box the player reads off the in-game bond screen. A support
           or Max Bond slot prices nothing level by level, so those fields are never built for it — and
           the essence block below moves up into the space they used to reserve. */
        const bondGrowth = ServantData.getBondGrowth(slotData.servantId);
        const maxLevel = bondGrowth ? bondGrowth.length - 1 : BOND_CONSTANTS.MAX_BOND_LEVEL - 1;
        const currentLevel = Math.min(Validator.clamp(slotData.bondLevel, 0, maxLevel), maxLevel);
        const targetLevel = Math.round(Validator.clamp(slotData.targetLevel, currentLevel + 1, maxLevel + 1));
        // A slot with an empty box (fresh pick, or an old save) starts on its own level's cost. The
        // player's own figure and their own tick are left alone here; only the controls set those.
        if (bondGrowth && !slotData.bondNeeded) {
          slotData.bondNeeded = bondGrowth[currentLevel];
          this.saveState();
        }

        const levelValues = (from, to) => {
          const out = [];
          for (let v = from; v <= to; v++) out.push(v);
          return out;
        };

        if (!isBondHidden) {
          const levelBox = (refKey, labelText, id, values, selected, onChange) => {
            const box = DOMFactory.el("div", "bond-input-box");
            const label = DOMFactory.el("label", "bond-input-box-label", { for: id });
            label.textContent = labelText;
            const select = DOMFactory.el("select", "bond-input-box-field bond-level-select", { id });
            values.forEach((value) => {
              const opt = DOMFactory.el("option", null, { value: String(value) });
              opt.textContent = String(value);
              if (value === selected) opt.selected = true;
              select.appendChild(opt);
            });
            select.addEventListener("change", () => onChange(select.value));
            this.elements[refKey] = select;
            box.appendChild(label);
            box.appendChild(select);
            return box;
          };

          // Moving off a level always re-prices the box from the table — the old level's figure is stale.
          const currentBox = levelBox(
            `slotBondLv_${i}`,
            "Current Lv.",
            `slotBondLv_${i}`,
            levelValues(0, maxLevel),
            currentLevel,
            (value) => {
              this.flushInputsToState();
              const next = Math.round(Validator.clamp(value, 0, maxLevel));
              slotData.bondLevel = next;
              if (slotData.targetLevel <= next) slotData.targetLevel = next + 1;
              if (bondGrowth) slotData.bondNeeded = bondGrowth[next];
              // The +25% all-servant bonus belongs to bond 15+, so the box follows the level both ways.
              slotData.bond15 = next >= BOND_CONSTANTS.BOND_BONUS_LEVEL;
              this.saveState();
              this.buildServantSlots();
            },
          );

          const targetBox = levelBox(
            `slotBondTgt_${i}`,
            "Target Lv.",
            `slotBondTgt_${i}`,
            levelValues(currentLevel + 1, maxLevel + 1),
            targetLevel,
            (value) => {
              this.flushInputsToState();
              slotData.targetLevel = Math.round(Validator.clamp(value, currentLevel + 1, maxLevel + 1));
              this.saveState();
            },
          );

          const levelRow = DOMFactory.el("div", "bond-level-row");
          levelRow.appendChild(currentBox);
          levelRow.appendChild(targetBox);
          info.appendChild(levelRow);

          // Bond input box with border label
          const inputBox = DOMFactory.el("div", "bond-input-box");
          const inputLabel = DOMFactory.el("label", "bond-input-box-label", { for: `slotBond_${i}` });
          inputLabel.textContent = "Next Lv. Required";
          const input = DOMFactory.el("input", "bond-input-box-field", {
            type: "number",
            id: `slotBond_${i}`,
            min: "0",
            max: String(BOND_CONSTANTS.MAX_BOND_NEEDED),
            value: String(slotData.bondNeeded || 0),
          });
          inputBox.appendChild(inputLabel);
          inputBox.appendChild(input);
          info.appendChild(inputBox);
          this.elements[`slotBond_${i}`] = input;
        }

        // The essences belong to this card, so they follow the point box — or take its place.
        info.appendChild(this._buildSlotCEs(slotData, i));

        // Remove button
        const removeSlotIndex = i;
        const removeBtn = DOMFactory.el("button", "servant-remove-btn", { type: "button" });
        removeBtn.textContent = "\u2715";
        removeBtn.title = "Remove servant";
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.removeSlot(removeSlotIndex);
        });
        slot.appendChild(removeBtn);

        slot.appendChild(info);
      } else {
        // --- Empty slot (Add Servant) ---
        slot.style.cursor = "pointer";
        slot.classList.add("servant-add-slot");

        const addPortrait = DOMFactory.el("div", "servant-slot-portrait-fallback");
        addPortrait.textContent = "+";
        slot.appendChild(addPortrait);

        const addInfo = DOMFactory.el("div");
        const addLabel = DOMFactory.el("div", "servant-slot-name");
        addLabel.textContent = "Add Servant";
        addInfo.appendChild(addLabel);
        slot.appendChild(addInfo);

        const selectorSlotIndex = i;
        slot.addEventListener("click", () => {
          this._refs.ServantSelector.open(
            selectorSlotIndex,
            true,
            this._createServantCallbacks(selectorSlotIndex),
            this._pickerOptions(),
          );
        });
      }

      frag.appendChild(slot);
    }

    grid.replaceChildren(frag);
  },

  setServant(slotIndex, servantId, ascension) {
    if (slotIndex < 0 || slotIndex >= this.state.slots.length) return;
    this.flushInputsToState();
    const slot = this.state.slots[slotIndex];
    slot.servantId = servantId;
    slot.ascension = ascension || null;
    // Every servant prices its own levels, so a new pick re-prices the box the same way a level change does.
    const growth = ServantData.getBondGrowth(servantId);
    if (growth) slot.bondNeeded = growth[Math.round(Validator.clamp(slot.bondLevel, 0, growth.length - 1))];
    this.saveState();
    this.buildServantSlots();
  },

  calculate() {
    // Determine quest bond/run: the selects own the choice, the custom box owns its own figure.
    const customInput = document.getElementById("customBondPerRun");
    const customApInput = document.getElementById("customApPerRun");
    const maxApInput = document.getElementById("maxApInput");
    if (customInput) {
      this.state.customBond = Validator.clamp(customInput.value, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND);
      customInput.value = this.state.customBond;
    }
    if (customApInput) {
      this.state.customAp = Validator.clamp(customApInput.value, 0, BOND_CONSTANTS.MAX_CUSTOM_AP);
      customApInput.value = this.state.customAp;
    }
    if (maxApInput) {
      this.state.maxAp = Validator.clamp(maxApInput.value, 1, BOND_CONSTANTS.MAX_PLAYER_AP);
      maxApInput.value = this.state.maxAp;
    }
    const bondPerRun = Quest.bondPerRun(this.state, this.state.customBond);
    const apPerRun = Quest.apPerRun(this.state, this.state.customAp);

    if (bondPerRun <= 0) {
      alert("Please select a quest or enter bond points per run.");
      return;
    }

    /* Grand Duel lets only the chosen class into the party. The picker filters to it, but a restored save
       or a class switched after the picks can leave a servant who does not belong — say so instead of
       pricing a party the game would not allow. */
    if (this.state.questMain === "gd" && Quest.classIds(this.state.questClass)) {
      const group = GRAND_CLASSES.find((c) => c.key === this.state.questClass);
      for (let i = 0; i < this.state.slots.length; i++) {
        const slot = this.state.slots[i];
        if (!slot.servantId) continue;
        const servant = ServantData.getServant(slot.servantId);
        if (!servant || Quest.matchesClass(servant.traits, this.state.questClass)) continue;
        alert(`${servant.name} cannot join a Grand Duel ${group.name} party.`);
        return;
      }
    }

    // Read all slot inputs
    const count = this.state.slots.length;
    for (let i = 0; i < count; i++) {
      const input = this.elements[`slotBond_${i}`];
      if (input) {
        this.state.slots[i].bondNeeded = Validator.clamp(input.value, 0, BOND_CONSTANTS.MAX_BOND_NEEDED);
      }
    }

    // Collect max bond / bond >= 15 servants for +25% bonus
    const maxBondServants = [];
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      if (slot.servantId && (slot.bond15 || (slot.type || "normal") === "maxbond")) {
        const servant = ServantData.getServant(slot.servantId);
        const mbAsc = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
        maxBondServants.push({
          servantId: slot.servantId,
          name: servant ? ServantData.getAscensionName(slot.servantId, mbAsc) : slot.servantId,
          image: servant ? ServantData.getImageForAscension(slot.servantId, mbAsc) : null,
        });
      }
    }
    const maxBondBonus = maxBondServants.length * BOND_CONSTANTS.MAX_BOND_BONUS_PCT;

    // Collect frontline support servants for +4% bonus
    const frontlineSupports = [];
    for (let i = 0; i < Math.min(count, BOND_CONSTANTS.FRONTLINE_SIZE); i++) {
      const slot = this.state.slots[i];
      if (slot.servantId && (slot.type || "normal") === "support") {
        const servant = ServantData.getServant(slot.servantId);
        const supAsc = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
        frontlineSupports.push({
          servantId: slot.servantId,
          name: servant ? ServantData.getAscensionName(slot.servantId, supAsc) : slot.servantId,
          image: servant ? ServantData.getImageForAscension(slot.servantId, supAsc) : null,
        });
      }
    }

    // Check for normal servants with missing bond value
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      const slotType = slot.type || "normal";
      if (slotType !== "normal") continue;
      if (!slot.servantId) continue;
      if (slot.maxBond) continue;
      const bondNeeded = slot.bondNeeded || 0;
      if (bondNeeded <= 0) {
        const servant = ServantData.getServant(slot.servantId);
        const asc = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
        const name = servant ? ServantData.getAscensionName(slot.servantId, asc) : "";
        alert(`Please enter bond required for ${name || "servant in slot " + (i + 1)}.`);
        return;
      }
    }

    // Stargazer's Teapot: one spent per run, and a run pays every servant in the party.
    const teapotStock = this.state.teapotOn ? Math.floor(this.state.teapotCount || 0) : 0;
    const boosted = teapotStock > 0;

    // Calculate for normal servants only
    const slotResults = [];
    for (let i = 0; i < count; i++) {
      const slot = this.state.slots[i];
      const slotType = slot.type || "normal";
      if (slotType !== "normal") continue;
      if (!slot.servantId) continue;
      if (slot.maxBond) continue;

      const bondNeeded = slot.bondNeeded || 0;
      if (bondNeeded <= 0) continue;

      const servantId = slot.servantId;
      const servant = ServantData.getServant(servantId);

      // Frontline bonus: first 3 slots get +20% (applied separately)
      const isFrontline = i < BOND_CONSTANTS.FRONTLINE_SIZE;

      // Sum percentage bonuses (CEs + max bond, NOT frontline or support)
      let ceBonusPercent = maxBondBonus;
      const appliedCEs = [];
      if (isFrontline) {
        appliedCEs.push({
          id: "frontline",
          name: "Frontline",
          bonus: BOND_CONSTANTS.FRONTLINE_BONUS_PCT,
          image: "icons/bond_icon.webp",
        });
      }
      frontlineSupports.forEach((fs) => {
        appliedCEs.push({ id: "support_" + fs.servantId, name: fs.name, bonus: 4, image: fs.image, isSupport: true });
      });
      maxBondServants.forEach((mb) => {
        appliedCEs.push({ id: "maxbond_" + mb.servantId, name: mb.name, bonus: 25, image: mb.image, isMaxBond: true });
      });

      // CE trait matching + flat bonus
      const ascension = ServantData.getDefaultAscension(slot.servantId, slot.ascension);
      const servantTraits = servant ? ServantData.getTraitsForAscension(servantId, ascension) : [];
      const traitSet = new Set(servantTraits);
      let flatBonus = 0;
      SlotCEs.partyPool(this.state.slots).forEach((pooled) => {
        const ceEntry = pooled.entry;
        // Resolve CE from entry (string or group object)
        let ceId, optionId;
        if (typeof ceEntry === "object" && ceEntry.groupId) {
          ceId = ceEntry.groupId;
          optionId = ceEntry.optionId;
        } else {
          ceId = ceEntry;
          optionId = null;
        }

        const ce = CEById.get(ceId);
        if (!ce) return;

        const rate = SlotCEs.rate(ce, pooled.isSupport);

        if (ce.isGroup) {
          // Grouped CE: universal bonus (percentage or flat)
          const option = ce.options ? ce.options.find((o) => o.id === optionId) : null;
          if (option) {
            if (ce.flatBonus > 0) {
              flatBonus += ce.flatBonus;
              appliedCEs.push({
                id: option.id,
                name: option.name,
                flatBonus: ce.flatBonus,
                image: option.image,
                thumbImage: option.thumbImage,
                isFlatBonus: true,
              });
            } else if (rate > 0) {
              ceBonusPercent += rate;
              appliedCEs.push({
                id: option.id,
                name: option.name,
                bonus: rate,
                image: option.image,
                thumbImage: option.thumbImage,
              });
            }
          }
        } else {
          // Normal CE: trait matching
          const matched = TraitMatcher.matches(traitSet, ce);

          if (matched) {
            ceBonusPercent += rate;
            appliedCEs.push({ ...ce, bonus: rate });
          }
        }
      });

      // Step 1: bonus = base * bonus% rounded down (just the bonus part)
      let totalBonus = Math.floor((bondPerRun * ceBonusPercent) / 100);
      // Step 2: apply frontline (+0.2) and support (+0.04 each) to multiplier and flat
      const supportMult = (frontlineSupports.length * BOND_CONSTANTS.SUPPORT_BONUS_PCT) / 100;
      const multiplier = 1 + (isFrontline ? BOND_CONSTANTS.FRONTLINE_BONUS_PCT / 100 : 0) + supportMult;
      if (multiplier > 1) {
        totalBonus = Math.floor(totalBonus * multiplier);
      }
      if (isFrontline) {
        totalBonus += Math.floor(bondPerRun * BOND_CONSTANTS.FRONTLINE_BONUS_FRACTION);
      }
      if (frontlineSupports.length > 0) {
        totalBonus += Math.floor((bondPerRun * frontlineSupports.length * BOND_CONSTANTS.SUPPORT_BONUS_PCT) / 100);
      }
      // Step 3: add flat bonus
      totalBonus += flatBonus;
      // Step 4: effectiveBond = base + totalBonus
      const effectiveBond = bondPerRun + totalBonus;
      // Step 5: a teapot-powered run pays that whole amount again, until the stock is gone.
      const perRun = boosted ? effectiveBond * BOND_CONSTANTS.TEAPOT_MULTIPLIER : effectiveBond;
      // The typed figure prices the level the player stands on; the table prices every one above it.
      const teapot = Teapot.plan({
        growth: ServantData.getBondGrowth(servantId),
        current: slot.bondLevel || 0,
        target: slot.targetLevel || 0,
        onPerRun: perRun,
        offPerRun: effectiveBond,
        typedCost: bondNeeded,
        stock: teapotStock,
      });
      const bondPlan = teapot.on;
      // What the stock left unpaid, the ordinary rate finishes.
      const offPlan = teapot.off;
      const teapotOut = teapot.out;
      const runs = teapot.runs;
      slotResults.push({
        index: i,
        servantId,
        name: servant ? ServantData.getAscensionName(servantId, ascension) : servantId,
        image: servant ? ServantData.getImageForAscension(servantId, ascension) : null,
        bondNeeded,
        effectiveBond,
        totalBonus,
        runs,
        bondPlan,
        teapotRuns: boosted ? runs : 0,
        teapotOffRuns: offPlan ? offPlan.total : 0,
        teapotBonus: boosted ? effectiveBond : 0,
        teapotOut,
        offPlan,
        ceBonus: ceBonusPercent,
        appliedCEs,
        isFrontline,
      });
    }

    if (slotResults.length === 0) {
      alert("Please select servants and enter bond required.");
      return;
    }

    this.saveState();

    // Show results
    const container = document.getElementById("bondResultContent");

    /* One servant's result card. A teapot plan the stock cannot finish is drawn twice: the boosted
       stretch first, then what the ordinary rate still owes once the teapots are gone. */
    const buildCard = (sr, afterTeapot = false) => {
      const runs = afterTeapot ? sr.teapotOffRuns : sr.teapotOut ? sr.teapotRuns : sr.runs;
      const bonus = afterTeapot ? sr.totalBonus : sr.totalBonus + sr.teapotBonus;
      const card = DOMFactory.el("div", "bond-result-servant-card");

      // Portrait
      if (sr.image) {
        const img = DOMFactory.createLazyImg(sr.image, "servant-slot-portrait", {
          alt: sr.name,
        });
        card.appendChild(img);
      } else {
        const fb = DOMFactory.el("div", "servant-slot-portrait-fallback");
        fb.textContent = sr.servantId;
        card.appendChild(fb);
      }

      // Name
      const nameEl = DOMFactory.el("div", "servant-slot-name");
      nameEl.textContent = sr.name;
      card.appendChild(nameEl);

      // Applied CE images grid, with the teapot last while it still pays for this servant's runs
      if (sr.appliedCEs.length > 0 || (!afterTeapot && sr.teapotRuns > 0)) {
        const ceImgGrid = DOMFactory.el("div", ["ce-badges", "grid-micro"]);
        sr.appliedCEs.forEach((ce) => {
          if (ce.isMaxBond) {
            // Max bond: servant portrait with bond icon overlay
            const wrap = DOMFactory.el("div", "bond-result-ce-maxbond-wrap");
            const servantImg = DOMFactory.createLazyImg(ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`,
            });
            DOMFactory.addSimpleFallback(servantImg, "bond-result-ce-fallback", `+${ce.bonus}%`);
            wrap.appendChild(servantImg);
            const icon = DOMFactory.el("img", "bond-result-ce-maxbond-icon", {
              src: "icons/bond_icon.webp",
              alt: "Bond \u226515",
              title: "Bond \u226515 (+25%)",
            });
            icon.onerror = () => {
              icon.style.display = "none";
            };
            wrap.appendChild(icon);
            ceImgGrid.appendChild(wrap);
          } else if (ce.isSupport) {
            // Frontline support: servant portrait with FP icon overlay
            const wrap = DOMFactory.el("div", "bond-result-ce-maxbond-wrap");
            const servantImg = DOMFactory.createLazyImg(ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`,
            });
            DOMFactory.addSimpleFallback(servantImg, "bond-result-ce-fallback", `+${ce.bonus}%`);
            wrap.appendChild(servantImg);
            const icon = DOMFactory.el("img", "bond-result-ce-maxbond-icon", {
              src: "icons/fp_icon.webp",
              alt: "Frontline Support",
              title: "Frontline Support",
            });
            icon.onerror = () => {
              icon.style.display = "none";
            };
            wrap.appendChild(icon);
            ceImgGrid.appendChild(wrap);
          } else if (ce.isFlatBonus) {
            const ceImg = DOMFactory.createLazyImg(ce.thumbImage, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.flatBonus} pts`,
            });
            DOMFactory.addSimpleFallback(ceImg, "bond-result-ce-fallback", `+${ce.flatBonus} pts`);
            ceImgGrid.appendChild(ceImg);
          } else {
            const ceImg = DOMFactory.createLazyImg(ce.thumbImage || ce.image, "bond-result-ce-img", {
              alt: ce.name,
              title: `${ce.name} +${ce.bonus}%`,
            });
            DOMFactory.addSimpleFallback(ceImg, "bond-result-ce-fallback", `+${ce.bonus}%`);
            ceImgGrid.appendChild(ceImg);
          }
        });
        if (!afterTeapot && sr.teapotRuns > 0) {
          const paid = `${sr.teapotRuns} ${sr.teapotRuns === 1 ? "run" : "runs"}`;
          const teapotTitle = sr.teapotOut
            ? `Stargazer's Teapot: ×2 bond for ${paid}, then the ordinary rate`
            : "Stargazer's Teapot: ×2 bond";
          const teapotImg = DOMFactory.createLazyImg("icons/teapot.webp", "bond-result-ce-img", {
            alt: "Stargazer's Teapot",
            title: teapotTitle,
          });
          DOMFactory.addSimpleFallback(teapotImg, "bond-result-ce-fallback", "×2");
          ceImgGrid.appendChild(teapotImg);
        }
        card.appendChild(ceImgGrid);
      }

      // Bond breakdown: base(+total bonus)
      const bondInfo = DOMFactory.el("div", "bond-result-bond-info");
      bondInfo.textContent =
        bonus > 0 ? `${bondPerRun.toLocaleString()}(+${bonus.toLocaleString()})` : `${bondPerRun.toLocaleString()}`;
      card.appendChild(bondInfo);

      // Runs count — the plain number, or one line per stretch of bond levels when the plan crosses more than one
      const runsEl = DOMFactory.el("div", "bond-result-runs");
      runsEl.textContent = `${runs} ${runs === 1 ? "run" : "runs"}`;
      card.appendChild(runsEl);

      /* Each block names only the levels its own runs actually cleared. Runs that died inside a level
         — the last teapot spent on a stretch it never finished — belong to no row here: the servant is
         still on that level, and the continuation block below owns it. A split plan prints its rows even
         for one cleared level; an unsplit one keeps the old rule of naming the stretch only when it
         crosses more than one level. */
      const phasePlan = afterTeapot ? sr.offPlan : sr.bondPlan;
      const phaseRows = phasePlan.rows;
      if (phaseRows.length > 0 && (sr.teapotOut || phasePlan.spansLevels)) {
        const levelList = DOMFactory.el("div", "bond-result-levels");
        phaseRows.forEach((row) => {
          const label = DOMFactory.el("div", "bond-result-level-label");
          label.textContent = `Bond Lv.${row.from}->${row.to}`;
          const rowRuns = DOMFactory.el("div", "bond-result-level-runs");
          rowRuns.textContent = `${row.runs} ${row.runs === 1 ? "run" : "runs"}`;
          levelList.appendChild(label);
          levelList.appendChild(rowRuns);
        });
        card.appendChild(levelList);
      }

      return card;
    };

    /* The status chip that sits between the two blocks once the teapots run out. */
    const buildTeapotExhaust = () => {
      const row = DOMFactory.el("div", "bond-teapot-exhaust");
      const badge = DOMFactory.el("div", "bond-teapot-badge");
      const label = DOMFactory.el("span", null);
      label.textContent = "Out of Stargazer's Teapot";
      // The name is already in the label, so the picture is decoration and stays out of the chip's name.
      const img = DOMFactory.el("img", null, {
        src: "icons/teapot.webp",
        alt: "",
        width: "142",
        height: "155",
      });
      img.onerror = () => {
        img.style.display = "none";
      };
      badge.append(label, img);
      row.appendChild(badge);
      return row;
    };

    const buildTotalApBadge = (totalAp, totalRuns, maxAp) => {
      const row = DOMFactory.el("div", "bond-total-ap");
      const badge = DOMFactory.el("div", "bond-ap-badge");

      const apLine = DOMFactory.el("div", "bond-ap-line");
      apLine.textContent = `Total AP: ${totalAp.toLocaleString()} AP (${totalRuns.toLocaleString()} ${totalRuns === 1 ? "run" : "runs"})`;
      badge.appendChild(apLine);

      if (maxAp > 0 && totalAp > 0) {
        const fruitCount = Quest.goldenFruit(totalAp, maxAp);
        const fruitLine = DOMFactory.el("div", "bond-ap-fruit-line");
        const fruitText = DOMFactory.el("span", null);
        fruitText.textContent = `Use ${fruitCount.toLocaleString()} Golden Fruit`;
        const fruitImg = DOMFactory.el("img", "bond-ap-fruit-img", {
          src: "icons/100_bordered.webp",
          alt: "Golden Fruit",
          width: "142",
          height: "155",
        });
        fruitImg.onerror = () => {
          fruitImg.style.display = "none";
        };
        fruitLine.append(fruitText, fruitImg);
        badge.appendChild(fruitLine);
      }

      row.appendChild(badge);
      return row;
    };

    const boostedGrid = DOMFactory.el("div", "bond-result-servant-grid");
    slotResults.forEach((sr) => boostedGrid.appendChild(buildCard(sr)));
    const frag = document.createDocumentFragment();
    frag.appendChild(boostedGrid);

    if (slotResults.some((sr) => sr.teapotOut)) {
      frag.appendChild(buildTeapotExhaust());
      const rest = slotResults.filter((sr) => sr.teapotOffRuns > 0);
      if (rest.length > 0) {
        const plainGrid = DOMFactory.el("div", "bond-result-servant-grid");
        rest.forEach((sr) => plainGrid.appendChild(buildCard(sr, true)));
        frag.appendChild(plainGrid);
      }
    }

    const maxRuns = Math.max(
      ...slotResults.map((sr) => (sr.teapotOut ? sr.teapotRuns + sr.teapotOffRuns : sr.runs)),
      0,
    );
    const totalAp = maxRuns * apPerRun;
    if (maxRuns > 0) {
      frag.appendChild(buildTotalApBadge(totalAp, maxRuns, this.state.maxAp));
    }

    container.replaceChildren(frag);

    const results = document.getElementById("bondResults");
    results.classList.add("visible");

    setTimeout(() => {
      results.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  },

  saveState() {
    try {
      localStorage.setItem(BOND_STORAGE_KEY, JSON.stringify(this.state));
    } catch (_e) {
      /* ignore */
    }
  },

  loadState() {
    try {
      const raw = localStorage.getItem(BOND_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return null;

      /* Levels are rounded and re-clamped here because a saved slot could carry anything: an old
         save without the fields, or a level past what the servant's table covers. */
      const level = (value, max) => Math.round(Validator.clamp(value, 0, max));
      /* `grandOn` is the rule the card already shows: only a Grand Duel rack can widen to two essences, so
         a party filed outside Grand Duel is stripped of the flag on load — and `SlotCEs.sanitize` then
         trims it to one, which is the fallback an old save (ticked under Free Quest, before this rule)
         needs, or it would keep a second chip nothing can untick. */
      const sanitize = (s, grandOn) => {
        const bondLevel = level(s.bondLevel || 0, BOND_CONSTANTS.MAX_BOND_LEVEL - 1);
        return defaultSlot({
          servantId: s.servantId || null,
          bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, BOND_CONSTANTS.MAX_BOND_NEEDED),
          bondLevel,
          targetLevel: Math.min(
            Math.max(level(s.targetLevel || 0, BOND_CONSTANTS.MAX_BOND_LEVEL), bondLevel + 1),
            BOND_CONSTANTS.MAX_BOND_LEVEL,
          ),
          type: s.type === "support" ? "support" : "normal",
          maxBond: s.type === "maxbond" ? true : Boolean(s.maxBond),
          bond15: s.type === "maxbond" ? true : Boolean(s.bond15),
          ascension: typeof s.ascension === "string" && s.ascension ? s.ascension : null,
          ...SlotCEs.sanitize(s.ces, grandOn && s.grand),
        });
      };

      // A party is a full rack of six slots, padded and sanitized whoever wrote it.
      const partyOf = (raw, grandOn) => {
        const list = Array.isArray(raw) ? raw.map((s) => sanitize(s, grandOn)) : [];
        // The one save shape older than slots[]: a single bond figure.
        if (list.length === 0 && !Array.isArray(raw) && data.bondNeeded) {
          list.push(defaultSlot({ bondNeeded: Validator.clamp(data.bondNeeded, 0, BOND_CONSTANTS.MAX_BOND_NEEDED) }));
        }
        while (list.length < SERVANT_MAX_SLOTS) {
          list.push(defaultSlot());
        }
        return list;
      };

      /* Quest choices are keys into the constant tables, so a save naming a quest that no longer exists
         falls back to nothing rather than to a stale figure. */
      const oneOf = (value, keys) => (keys.includes(value) ? value : "");
      let questMain = oneOf(
        data.questMain,
        QUEST_FAMILIES.map((f) => f.key),
      );
      let questSub = oneOf(data.questSub, [...FREE_QUESTS.map((q) => q.key), "custom"]);
      let questClass = oneOf(
        data.questClass,
        GRAND_CLASSES.map((c) => c.key),
      );
      let questDiff = oneOf(
        data.questDiff,
        GRAND_DIFFICULTIES.map((d) => d.key),
      );

      // A save from before the family selects spelled the whole quest as one key; land it in the new fields.
      if (!questMain) {
        const legacy = data.selectedQuest;
        if (legacy === "custom") {
          questMain = "fq";
          questSub = "custom";
        } else if (
          oneOf(
            legacy,
            FREE_QUESTS.map((q) => q.key),
          )
        ) {
          questMain = "fq";
          questSub = legacy;
        } else if (legacy === "gd100") {
          questMain = "gd";
          questClass = "all";
          questDiff = GRAND_DIFFICULTIES[GRAND_DIFFICULTIES.length - 1].key;
        }
      }

      /* A Grand Duel choice owns its party; `""` is the shared party Free Quest and an empty quest use.
         The party on screen is stored as `slots`, so its own key is read from `parties` only when it is
         parked, and a save that never had `parties` leaves every class starting empty. */
      const liveKey = questMain === "gd" ? questClass || "all" : "";
      const stored = data.parties && typeof data.parties === "object" ? data.parties : {};
      const parties = {};
      ["", ...GRAND_CLASSES.map((c) => c.key)].forEach((key) => {
        // Any other key a tampered save carries is dropped, not bloated into storage.
        if (Array.isArray(stored[key])) parties[key] = partyOf(stored[key], Boolean(key));
      });
      const slots = parties[liveKey] || partyOf(data.slots, liveKey !== "");
      delete parties[liveKey];

      return {
        slots,
        parties,
        questMain,
        questSub,
        questClass,
        questDiff,
        customBond: Validator.clamp(data.customBond || 0, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND),
        customAp: Validator.clamp(
          data.customAp !== undefined ? data.customAp : BOND_CONSTANTS.DEFAULT_CUSTOM_AP,
          0,
          BOND_CONSTANTS.MAX_CUSTOM_AP,
        ),
        maxAp: Validator.clamp(
          data.maxAp !== undefined ? data.maxAp : BOND_CONSTANTS.DEFAULT_MAX_AP,
          1,
          BOND_CONSTANTS.MAX_PLAYER_AP,
        ),
        // Teapots are counted in whole items; a save that never had them simply starts empty.
        teapotCount: Math.floor(Validator.clamp(data.teapotCount || 0, 0, BOND_CONSTANTS.MAX_TEAPOT_COUNT)),
        teapotOn: Boolean(data.teapotOn),
      };
    } catch (_e) {
      return null;
    }
  },
};
