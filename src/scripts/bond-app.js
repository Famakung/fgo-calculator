import { BOND_CONSTANTS, SERVANT_MAX_SLOTS, BOND_QUESTS, BOND_STORAGE_KEY } from "./constants.js";
import { Validator, TraitMatcher, BondLevelCalculator, SlotCEs } from "./domain.js";
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
            this._refs.ServantSelector.open(backIdx, false, this._createServantCallbacks(backIdx));
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
      selectedQuest: "",
      customBond: 0,
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

    // Build servant slots (each card renders its own essences)
    this.buildServantSlots();

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
    this.state.slots[index] = defaultSlot();
    this.saveState();
    this.buildServantSlots();
  },

  /* The bonus line the old CE card printed under each portrait. It now only feeds the chip's title and
     alt text, since the card keeps the essence to a portrait. */
  _ceBonusText(ce, ceEntry) {
    if (typeof ceEntry === "object" && ceEntry.groupId) {
      return ce.flatBonus > 0 ? `+${ce.flatBonus} pts All` : `+${ce.bonus}% All`;
    }
    if (ce.traitGroups.length > 0) {
      const groups = ce.traitGroups.map((group) => group.map((t) => TraitNames[t] || t).join(" or ")).join(" and ");
      return `+${ce.bonus}% ${groups}`;
    }
    if (ce.traits.length === 0) return `+${ce.bonus}% All`;
    const traitNames = ce.traits.map((t) => TraitNames[t] || t);
    const joiner = ce.matchAll ? " and " : " or ";
    return `+${ce.bonus}% ${traitNames.join(joiner)}`;
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
    chip.title = ce ? `${ceName} \u00b7 ${this._ceBonusText(ce, ceEntry)}` : ceName;
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
     tick and one chip per position the slot can wear. */
  _buildSlotCEs(slotData, slotIndex) {
    const block = DOMFactory.el("div", "slot-ce-block");

    const label = DOMFactory.el("label", "bond-input-box-label", { for: `slotGrand_${slotIndex}` });
    label.textContent = "Craft Essence";
    block.appendChild(label);

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

        /* Bond level selects, then the point box the player reads off the in-game bond screen.
           All three hide together for support and Max Bond slots, as the point box always did. */
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

        const levelBox = (refKey, labelText, id, values, selected, onChange) => {
          const box = DOMFactory.el("div", isBondHidden ? "bond-input-box bond-input-box--hidden" : "bond-input-box");
          const label = DOMFactory.el("label", "bond-input-box-label", { for: id });
          label.textContent = labelText;
          const select = DOMFactory.el("select", "bond-input-box-field bond-level-select", { id });
          if (isBondHidden) {
            select.disabled = true;
            select.tabIndex = -1;
          }
          values.forEach((value) => {
            const opt = DOMFactory.el("option", null, { value: String(value) });
            opt.textContent = String(value);
            if (value === selected) opt.selected = true;
            select.appendChild(opt);
          });
          select.addEventListener("change", () => onChange(select.value));
          if (!isBondHidden) this.elements[refKey] = select;
          box.appendChild(label);
          box.appendChild(select);
          return box;
        };

        const levelValues = (from, to) => {
          const out = [];
          for (let v = from; v <= to; v++) out.push(v);
          return out;
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

        // Bond input box with border label (always created to preserve height, hidden if max bond or support)
        const inputBoxClass = isBondHidden ? "bond-input-box bond-input-box--hidden" : "bond-input-box";
        const inputBox = DOMFactory.el("div", inputBoxClass);
        const inputLabel = DOMFactory.el("label", "bond-input-box-label", { for: `slotBond_${i}` });
        inputLabel.textContent = "Next Lv. Required";
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

        // The essences belong to this card, so they follow the point box it just made.
        info.appendChild(this._buildSlotCEs(slotData, i));

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

        const addInfo = DOMFactory.el("div");
        const addLabel = DOMFactory.el("div", "servant-slot-name");
        addLabel.textContent = "Add Servant";
        addInfo.appendChild(addLabel);
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
      SlotCEs.partyPool(this.state.slots).forEach((ceEntry) => {
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
      // The typed figure prices the level the player stands on; the table prices every one above it.
      const bondPlan = BondLevelCalculator.plan({
        growth: ServantData.getBondGrowth(servantId),
        current: slot.bondLevel || 0,
        target: slot.targetLevel || 0,
        bondPerRun: effectiveBond,
        typedCost: bondNeeded,
      });
      slotResults.push({
        index: i,
        servantId,
        name: servant ? ServantData.getAscensionName(servantId, ascension) : servantId,
        image: servant ? ServantData.getImageForAscension(servantId, ascension) : null,
        bondNeeded,
        effectiveBond,
        totalBonus,
        runs: bondPlan.spansLevels ? bondPlan.total : effectiveBond > 0 ? Math.ceil(bondNeeded / effectiveBond) : 0,
        bondPlan,
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

      // Runs count — the plain number, or one line per stretch of bond levels when the plan crosses more than one
      const runsEl = DOMFactory.el("div", "bond-result-runs");
      runsEl.textContent = `${sr.runs} ${sr.runs === 1 ? "run" : "runs"}`;
      card.appendChild(runsEl);

      if (sr.bondPlan.spansLevels) {
        const levelList = DOMFactory.el("div", "bond-result-levels");
        sr.bondPlan.rows.forEach((row) => {
          const label = DOMFactory.el("div", "bond-result-level-label");
          label.textContent = `Bond Lv.${row.from}->${row.to}`;
          const rowRuns = DOMFactory.el("div", "bond-result-level-runs");
          rowRuns.textContent = `${row.runs} ${row.runs === 1 ? "run" : "runs"}`;
          levelList.appendChild(label);
          levelList.appendChild(rowRuns);
        });
        card.appendChild(levelList);
      }

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
      /* Levels are rounded and re-clamped here because a saved slot could carry anything: an old
         save without the fields, or a level past what the servant's table covers. */
      const level = (value, max) => Math.round(Validator.clamp(value, 0, max));
      const sanitize = (s) => {
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
          ...SlotCEs.sanitize(s.ces, s.grand),
        });
      };

      if (data.slots && Array.isArray(data.slots)) {
        slots = data.slots.map(sanitize);
      } else {
        slots = [];
        if (data.bondNeeded) {
          slots.push(defaultSlot({ bondNeeded: Validator.clamp(data.bondNeeded, 0, BOND_CONSTANTS.MAX_BOND_NEEDED) }));
        }
      }

      // Pad to SERVANT_MAX_SLOTS
      while (slots.length < SERVANT_MAX_SLOTS) {
        slots.push(defaultSlot());
      }

      return {
        slots: slots.map(sanitize),
        selectedQuest: typeof data.selectedQuest === "string" ? data.selectedQuest : "",
        customBond: Validator.clamp(data.customBond || 0, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND),
      };
    } catch (_e) {
      return null;
    }
  },
};
