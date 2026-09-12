import { BOND_CONSTANTS, SERVANT_MAX_SLOTS, BOND_QUESTS, BOND_STORAGE_KEY } from "./constants.js";
import { Validator, TraitMatcher } from "./domain.js";
import { ServantData, CEById, TraitNames } from "./data.js";
import { DOMFactory } from "./presentation.js";

export const BondApp = {
  state: null,
  elements: {},
  _refs: null,

  configure(refs) {
    // refs = { ServantSelector, AscensionSelector, CESelector, CESubSelector, ServantDrag }
    this._refs = refs;
  },

  _createServantCallbacks(slotIndex) {
    return {
      onSelect: (_slotIdx, servantId, ascension) => this.setServant(slotIndex, servantId, ascension),
      onPendingRemove: () => {
        this.state.slots[slotIndex] = {
          servantId: null,
          bondNeeded: 0,
          type: "normal",
          maxBond: false,
          bond15: false,
          ascension: null,
        };
        this.saveState();
        this.buildServantSlots();
      },
      onOpenAscension: (servant, idx) => {
        this._refs.AscensionSelector.open(servant, idx, {
          onSelect: (_si, servantId, asc) => this.setServant(idx, servantId, asc),
          onBack: (backIdx) => {
            this._refs.ServantSelector.open(backIdx, false, this._createServantCallbacks(backIdx));
          },
        });
      },
    };
  },

  _createCECallbacks(slotIndex) {
    return {
      onSelect: (_slotIdx, ceId, optionId) => this.setCE(slotIndex, ceId, optionId),
      onPendingRemove: () => {
        this.state.ces.splice(slotIndex, 1);
        this.saveState();
        this.buildCESlots();
      },
      onOpenSubSelector: (groupCE, idx) => {
        this._refs.CESubSelector.open(groupCE, idx, {
          onSelect: (_si, ceId, optionId) => this.setCE(idx, ceId, optionId),
          onPendingRemove: () => {
            this.state.ces.splice(idx, 1);
            this.saveState();
            this.buildCESlots();
          },
        });
      },
    };
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;
    const saved = this.loadState();
    this.state = saved || {
      slots: Array.from({ length: SERVANT_MAX_SLOTS }, () => ({
        servantId: null,
        bondNeeded: 0,
        type: "normal",
        maxBond: false,
        bond15: false,
        ascension: null,
      })),
      selectedQuest: "",
      customBond: 0,
      ces: [],
    };

    const select = document.getElementById("bondQuestSelect");
    const customInput = document.getElementById("customBondPerRun");
    const customSection = document.getElementById("customQuestSection");

    // Populate presets
    BOND_QUESTS.forEach((q) => {
      const opt = DOMFactory.el("option", null, { value: q.key });
      opt.textContent = `${q.name} (${q.bond} pts)`;
      select.appendChild(opt);
    });

    // Custom option
    const customOpt = DOMFactory.el("option", null, { value: "custom" });
    customOpt.textContent = "-- Custom --";
    select.appendChild(customOpt);

    // Build servant slots
    this.buildServantSlots();

    // Build CE slots
    this.buildCESlots();

    // Restore quest state
    select.value = this.state.selectedQuest;
    if (this.state.selectedQuest === "custom") {
      customInput.disabled = false;
      customInput.value = this.state.customBond;
      customSection.style.display = "block";
    } else if (this.state.selectedQuest) {
      customInput.disabled = true;
      customSection.style.display = "none";
    } else {
      customSection.style.display = "none";
    }

    // Quest select handler
    select.addEventListener("change", () => {
      const val = select.value;
      if (val === "custom") {
        customInput.disabled = false;
        customSection.style.display = "block";
      } else {
        customInput.disabled = true;
        customSection.style.display = "none";
      }
    });

    // Calculate button
    const calcBtn = document.getElementById("bondCalculateBtn");
    if (calcBtn) {
      calcBtn.addEventListener("click", () => this.calculate());
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

  removeSlot(index) {
    this.flushInputsToState();
    this.state.slots[index] = {
      servantId: null,
      bondNeeded: 0,
      type: "normal",
      maxBond: false,
      bond15: false,
      ascension: null,
    };
    this.saveState();
    this.buildServantSlots();
  },

  buildCESlots() {
    const grid = document.getElementById("ceGrid");
    if (!grid) return;
    grid.replaceChildren();

    const count = this.state.ces.length;

    for (let i = 0; i < count; i++) {
      const ceEntry = this.state.ces[i];
      if (!ceEntry) continue; // skip pending null slots

      // Resolve CE entry (string or group object)
      let ce, ceName, ceImage, ceBonusText;
      if (typeof ceEntry === "object" && ceEntry.groupId) {
        ce = CEById.get(ceEntry.groupId);
        const selectedOption = ce && ce.options ? ce.options.find((o) => o.id === ceEntry.optionId) : null;
        ceName = selectedOption ? selectedOption.name : ce ? ce.name : ceEntry.groupId;
        ceImage = selectedOption ? selectedOption.image : ce ? ce.image : null;
        ceBonusText = ce ? (ce.flatBonus > 0 ? `+${ce.flatBonus} pts All` : `+${ce.bonus}% All`) : "";
      } else {
        ce = CEById.get(ceEntry);
        ceName = ce ? ce.name : ceEntry;
        ceImage = ce ? ce.image : null;
        ceBonusText = null;
      }

      const slot = DOMFactory.el("div", "ce-slot");
      slot.dataset.slotIndex = i;

      // Portrait
      const portraitArea = DOMFactory.el("div");
      if (ceImage) {
        const img = DOMFactory.createLazyImg(ceImage, "ce-portrait", { alt: ceName });
        DOMFactory.addSimpleFallback(
          img,
          "ce-portrait-fallback",
          typeof ceEntry === "object" ? ceEntry.groupId : ceEntry,
        );
        portraitArea.appendChild(img);
      } else {
        const fb = DOMFactory.el("div", "ce-portrait-fallback");
        fb.textContent = typeof ceEntry === "object" ? ceEntry.groupId : ceEntry;
        portraitArea.appendChild(fb);
      }
      slot.appendChild(portraitArea);

      // Name + bonus
      const info = DOMFactory.el("div");
      if (ce) {
        const nameEl = DOMFactory.el("div", "ce-slot-name");
        nameEl.textContent = ceName;
        info.appendChild(nameEl);
        const bonusEl = DOMFactory.el("div", "ce-slot-bonus");
        if (ceBonusText !== null) {
          // Grouped CE (pre-computed bonus text)
          bonusEl.textContent = ceBonusText;
        } else if (ce.traitGroups.length > 0) {
          const groups = ce.traitGroups.map((group) => group.map((t) => TraitNames[t] || t).join(" or ")).join(" and ");
          bonusEl.textContent = `+${ce.bonus}% ${groups}`;
        } else if (ce.traits.length === 0) {
          bonusEl.textContent = `+${ce.bonus}% All`;
        } else {
          const traitNames = ce.traits.map((t) => TraitNames[t] || t);
          const joiner = ce.matchAll ? " and " : " or ";
          bonusEl.textContent = `+${ce.bonus}% ${traitNames.join(joiner)}`;
        }
        info.appendChild(bonusEl);
      }
      slot.appendChild(info);

      // Click slot to re-select
      const ceSlotIndex = i;
      slot.style.cursor = "pointer";
      slot.addEventListener("click", () => {
        if (ce && ce.isGroup) {
          this._refs.CESubSelector.open(ce, ceSlotIndex, {
            onSelect: (_si, ceId, optionId) => this.setCE(ceSlotIndex, ceId, optionId),
            onPendingRemove: () => {
              this.state.ces.splice(ceSlotIndex, 1);
              this.saveState();
              this.buildCESlots();
            },
          });
        } else {
          this._refs.CESelector.open(ceSlotIndex, false, this._createCECallbacks(ceSlotIndex));
        }
      });

      // Remove button
      const removeBtn = DOMFactory.el("button", "servant-remove-btn", { type: "button" });
      removeBtn.textContent = "\u2715";
      removeBtn.title = "Remove CE";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.removeCE(ceSlotIndex);
      });
      slot.appendChild(removeBtn);

      grid.appendChild(slot);
    }

    // Add button
    const addSlot = DOMFactory.el("div", ["ce-slot", "ce-add-slot"]);
    const addPortrait = DOMFactory.el("div", "ce-portrait-fallback");
    addPortrait.textContent = "+";
    addSlot.appendChild(addPortrait);
    const addInfo = DOMFactory.el("div");
    const addLabel = DOMFactory.el("div", "ce-slot-name");
    addLabel.textContent = "Add Craft Essence";
    addInfo.appendChild(addLabel);
    addSlot.appendChild(addInfo);
    addSlot.addEventListener("click", () => {
      this.state.ces.push(null);
      this.buildCESlots();
      const idx = this.state.ces.length - 1;
      this._refs.CESelector.open(idx, true, this._createCECallbacks(idx));
    });
    grid.appendChild(addSlot);
  },

  setCE(slotIndex, ceId, optionId) {
    if (slotIndex < 0 || slotIndex >= this.state.ces.length) return;
    if (optionId) {
      this.state.ces[slotIndex] = { groupId: ceId, optionId: optionId };
    } else {
      this.state.ces[slotIndex] = ceId;
    }
    this.saveState();
    this.buildCESlots();
  },

  removeCE(index) {
    this.state.ces.splice(index, 1);
    this.saveState();
    this.buildCESlots();
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
      const slotData = this.state.slots[i] || {
        servantId: null,
        bondNeeded: 0,
        type: "normal",
        maxBond: false,
        bond15: false,
        ascension: null,
      };

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

        // Badges: Frontline bonus and/or Bond >= 15 bonus
        const slotType = slotData.type || "normal";
        const hasFrontlineBadge = isFrontline;
        const hasBond15Badge = slotType === "normal" && !!slotData.bond15;

        if (hasFrontlineBadge || hasBond15Badge) {
          const badgeContainer = DOMFactory.el("div", "servant-slot-frontline-badge");

          // 1. Frontline bonus badge (Starting Member: +20% self for normal, +4% All for support)
          if (hasFrontlineBadge) {
            const item = DOMFactory.el("div", "servant-slot-badge-item");
            const badgeImg = DOMFactory.el("img", "", {
              src: "icons/bond_icon.webp",
              alt: slotType === "support" ? "Support (+4% All)" : "Frontline (+20%)",
              title:
                slotType === "support"
                  ? "Starting member support: +4% Bond (All)"
                  : "Starting member: +20% Bond (Self)",
              draggable: "false",
            });
            if (slotType === "support") {
              const imgWrap = DOMFactory.el("div", "servant-slot-frontline-img");
              imgWrap.appendChild(badgeImg);
              const badgeOverlay = DOMFactory.el("span", "servant-slot-frontline-overlay");
              badgeOverlay.textContent = "All";
              imgWrap.appendChild(badgeOverlay);
              item.appendChild(imgWrap);
            } else {
              item.appendChild(badgeImg);
            }
            const badgeText = DOMFactory.el("span", "servant-slot-badge-text");
            badgeText.textContent = slotType === "support" ? "+4%" : "+20%";
            item.appendChild(badgeText);
            badgeContainer.appendChild(item);
          }

          // 2. Bond >= 15 bonus badge (+25% All)
          // Always present in any slot if Bond >= 15 is checked; displayed below +self 20% when in starting member
          if (hasBond15Badge) {
            const item = DOMFactory.el("div", "servant-slot-badge-item");
            const badgeImg = DOMFactory.el("img", "", {
              src: "icons/bond_icon.webp",
              alt: "Bond \u226515 (+25% All)",
              title: "Bond \u226515: +25% Bond (All)",
              draggable: "false",
            });
            const imgWrap = DOMFactory.el("div", "servant-slot-frontline-img");
            imgWrap.appendChild(badgeImg);
            const badgeOverlay = DOMFactory.el("span", "servant-slot-frontline-overlay");
            badgeOverlay.textContent = "All";
            imgWrap.appendChild(badgeOverlay);
            item.appendChild(imgWrap);

            const badgeText = DOMFactory.el("span", "servant-slot-badge-text");
            badgeText.textContent = "+25%";
            item.appendChild(badgeText);
            badgeContainer.appendChild(item);
          }

          slot.appendChild(badgeContainer);
        }

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
                  this._refs.ServantSelector.open(backIdx, false, this._createServantCallbacks(backIdx));
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
            this._refs.ServantSelector.open(selectorSlotIndex, false, this._createServantCallbacks(selectorSlotIndex));
          });
          portraitArea.style.cursor = "pointer";
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

        // Checkboxes row: "Max Bond" and "Bond >=15"
        const checkboxRowClass = isSupport ? "bond-checkbox-row bond-checkbox-row--hidden" : "bond-checkbox-row";
        const checkboxRow = DOMFactory.el("div", checkboxRowClass);

        // Max Bond checkbox
        const maxBondLabel = DOMFactory.el("label", "bond-checkbox-label");
        const maxBondAttrs = {
          type: "checkbox",
          id: `slotMaxBond_${i}`,
        };
        if (isSupport) {
          maxBondAttrs.disabled = true;
          maxBondAttrs.tabIndex = -1;
        }
        const maxBondCheckbox = DOMFactory.el("input", "bond-checkbox", maxBondAttrs);
        if (slotData.maxBond) maxBondCheckbox.checked = true;
        const maxBondText = DOMFactory.el("span");
        maxBondText.textContent = "Max Bond";
        maxBondLabel.appendChild(maxBondCheckbox);
        maxBondLabel.appendChild(maxBondText);
        checkboxRow.appendChild(maxBondLabel);

        // Bond >=15 checkbox
        const bond15Label = DOMFactory.el("label", "bond-checkbox-label");
        const bond15Attrs = {
          type: "checkbox",
          id: `slotBond15_${i}`,
        };
        if (isSupport) {
          bond15Attrs.disabled = true;
          bond15Attrs.tabIndex = -1;
        }
        const bond15Checkbox = DOMFactory.el("input", "bond-checkbox", bond15Attrs);
        if (slotData.bond15) bond15Checkbox.checked = true;
        const bond15Text = DOMFactory.el("span");
        bond15Text.textContent = "Bond \u226515";
        bond15Label.appendChild(bond15Checkbox);
        bond15Label.appendChild(bond15Text);
        checkboxRow.appendChild(bond15Label);

        info.appendChild(checkboxRow);

        if (!isSupport) {
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

        // Bond input box with border label (always created to preserve height, hidden if max bond or support)
        const inputBoxClass = isBondHidden ? "bond-input-box bond-input-box--hidden" : "bond-input-box";
        const inputBox = DOMFactory.el("div", inputBoxClass);
        const inputLabel = DOMFactory.el("label", "bond-input-box-label", { for: `slotBond_${i}` });
        inputLabel.textContent = "Bond Required";
        const inputAttrs = {
          type: "number",
          id: `slotBond_${i}`,
          min: "0",
          max: String(BOND_CONSTANTS.MAX_BOND_NEEDED),
          value: String(slotData.bondNeeded || 0),
        };
        if (isBondHidden) {
          inputAttrs.disabled = true;
          inputAttrs.tabIndex = -1;
        }
        const input = DOMFactory.el("input", "bond-input-box-field", inputAttrs);
        inputBox.appendChild(inputLabel);
        inputBox.appendChild(input);
        info.appendChild(inputBox);

        if (!isBondHidden) {
          this.elements[`slotBond_${i}`] = input;
        }

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

        const addInfo = DOMFactory.el("div", "servant-slot-info");
        const addLabel = DOMFactory.el("div", "servant-slot-placeholder");
        addLabel.textContent = "Add Servant";
        addInfo.appendChild(addLabel);

        // Dummy hidden controls so empty slots maintain the exact same height as filled slots
        const dummyTypeRow = DOMFactory.el("div", "input-row bond-checkbox-row--hidden");
        const dummySelect = DOMFactory.el("select", "select-field", { disabled: true, tabIndex: -1 });
        dummyTypeRow.appendChild(dummySelect);
        addInfo.appendChild(dummyTypeRow);

        const dummyCheckboxRow = DOMFactory.el("div", "bond-checkbox-row bond-checkbox-row--hidden");
        const dummyCheckboxLabel = DOMFactory.el("label", "bond-checkbox-label");
        dummyCheckboxLabel.textContent = "\u00a0";
        dummyCheckboxRow.appendChild(dummyCheckboxLabel);
        addInfo.appendChild(dummyCheckboxRow);

        const dummyInputBox = DOMFactory.el("div", "bond-input-box bond-input-box--hidden");
        const dummyInputLabel = DOMFactory.el("label", "bond-input-box-label");
        dummyInputLabel.textContent = "Bond Required";
        const dummyInput = DOMFactory.el("input", "bond-input-box-field", { disabled: true, tabIndex: -1 });
        dummyInputBox.appendChild(dummyInputLabel);
        dummyInputBox.appendChild(dummyInput);
        addInfo.appendChild(dummyInputBox);

        slot.appendChild(addInfo);

        const selectorSlotIndex = i;
        slot.addEventListener("click", () => {
          this._refs.ServantSelector.open(selectorSlotIndex, true, this._createServantCallbacks(selectorSlotIndex));
        });
      }

      frag.appendChild(slot);
    }

    grid.replaceChildren(frag);
  },

  setServant(slotIndex, servantId, ascension) {
    if (slotIndex < 0 || slotIndex >= this.state.slots.length) return;
    this.flushInputsToState();
    this.state.slots[slotIndex].servantId = servantId;
    this.state.slots[slotIndex].ascension = ascension || null;
    this.saveState();
    this.buildServantSlots();
  },

  calculate() {
    // Determine quest bond/run
    const select = document.getElementById("bondQuestSelect");
    const questKey = select.value;
    let bondPerRun = 0;

    if (questKey && questKey !== "custom") {
      const preset = BOND_QUESTS.find((q) => q.key === questKey);
      if (preset) {
        bondPerRun = preset.bond;
      }
    } else if (questKey === "custom") {
      bondPerRun = Validator.clamp(
        document.getElementById("customBondPerRun").value,
        0,
        BOND_CONSTANTS.MAX_CUSTOM_BOND,
      );
    }

    if (bondPerRun <= 0) {
      alert("Please select a quest or enter bond points per run.");
      return;
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
      this.state.ces.forEach((ceEntry) => {
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
            } else if (ce.bonus > 0) {
              ceBonusPercent += ce.bonus;
              appliedCEs.push({
                id: option.id,
                name: option.name,
                bonus: ce.bonus,
                image: option.image,
                thumbImage: option.thumbImage,
              });
            }
          }
        } else {
          // Normal CE: trait matching
          const matched = TraitMatcher.matches(traitSet, ce);

          if (matched) {
            ceBonusPercent += ce.bonus;
            appliedCEs.push(ce);
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
      slotResults.push({
        index: i,
        servantId,
        name: servant ? ServantData.getAscensionName(servantId, ascension) : servantId,
        image: servant ? ServantData.getImageForAscension(servantId, ascension) : null,
        bondNeeded,
        effectiveBond,
        totalBonus,
        runs: effectiveBond > 0 ? Math.ceil(bondNeeded / effectiveBond) : 0,
        ceBonus: ceBonusPercent,
        appliedCEs,
        isFrontline,
      });
    }

    if (slotResults.length === 0) {
      alert("Please select servants and enter bond required.");
      return;
    }

    this.state.selectedQuest = questKey;
    this.state.customBond = questKey === "custom" ? bondPerRun : 0;
    this.saveState();

    // Show results
    const container = document.getElementById("bondResultContent");

    // Per-servant results grid
    const resultGrid = DOMFactory.el("div", "bond-result-servant-grid");
    slotResults.forEach((sr) => {
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

      // Applied CE images grid
      if (sr.appliedCEs.length > 0) {
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
        card.appendChild(ceImgGrid);
      }

      // Bond breakdown: base(+total bonus)
      const bondInfo = DOMFactory.el("div", "bond-result-bond-info");
      bondInfo.textContent =
        sr.totalBonus > 0
          ? `${bondPerRun.toLocaleString()}(+${sr.totalBonus.toLocaleString()})`
          : `${bondPerRun.toLocaleString()}`;
      card.appendChild(bondInfo);

      // Runs count
      const runsEl = DOMFactory.el("div", "bond-result-runs");
      runsEl.textContent = `${sr.runs} ${sr.runs === 1 ? "run" : "runs"}`;
      card.appendChild(runsEl);

      resultGrid.appendChild(card);
    });
    container.replaceChildren(resultGrid);

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

      // Migrate old format (single bondNeeded) to new slots format
      let slots;
      if (data.slots && Array.isArray(data.slots)) {
        slots = data.slots.map((s) => ({
          servantId: s.servantId || null,
          bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, BOND_CONSTANTS.MAX_BOND_NEEDED),
          type: s.type === "support" ? "support" : "normal",
          maxBond: s.type === "maxbond" ? true : Boolean(s.maxBond),
          bond15: s.type === "maxbond" ? true : Boolean(s.bond15),
          ascension: typeof s.ascension === "string" && s.ascension ? s.ascension : null,
        }));
      } else {
        slots = [];
        if (data.bondNeeded) {
          slots.push({
            servantId: null,
            bondNeeded: Validator.clamp(data.bondNeeded, 0, BOND_CONSTANTS.MAX_BOND_NEEDED),
            type: "normal",
            maxBond: false,
            bond15: false,
            ascension: null,
          });
        }
      }

      // Pad to SERVANT_MAX_SLOTS
      while (slots.length < SERVANT_MAX_SLOTS) {
        slots.push({
          servantId: null,
          bondNeeded: 0,
          type: "normal",
          maxBond: false,
          bond15: false,
          ascension: null,
        });
      }

      return {
        slots: slots.map((s) => ({
          servantId: s.servantId || null,
          bondNeeded: Validator.clamp(s.bondNeeded || 0, 0, BOND_CONSTANTS.MAX_BOND_NEEDED),
          type: s.type === "support" ? "support" : "normal",
          maxBond: Boolean(s.maxBond),
          bond15: Boolean(s.bond15),
          ascension: typeof s.ascension === "string" && s.ascension ? s.ascension : null,
        })),
        selectedQuest: typeof data.selectedQuest === "string" ? data.selectedQuest : "",
        customBond: Validator.clamp(data.customBond || 0, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND),
        ces: Array.isArray(data.ces)
          ? data.ces.filter((entry) => {
              if (typeof entry === "string" && entry) return true;
              if (entry && typeof entry === "object" && entry.groupId && entry.optionId) return true;
              return false;
            })
          : [],
      };
    } catch (_e) {
      return null;
    }
  },
};
