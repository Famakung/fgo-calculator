import { TIERS, TIER_FIELDS, STORAGE_KEY } from "./constants.js";
import { Schema, Validator } from "./domain.js";

export const StateManager = {
  createInitial() {
    const tiers = {};
    TIERS.forEach((tier) => {
      tiers[tier] = { need: 0, have: 0, bonus: 0 };
    });
    return {
      tiers,
      baseDrop: Schema.baseDrop.default,
      primaryMultiplier: Schema.primaryMultiplier.default,
      secondaryMultiplier: Schema.secondaryMultiplier.default,
      results: null,
    };
  },

  updateTier(state, tier, field, value) {
    return {
      ...state,
      tiers: {
        ...state.tiers,
        [tier]: {
          ...state.tiers[tier],
          [field]: value,
        },
      },
    };
  },

  updateSetting(state, key, value) {
    return { ...state, [key]: value };
  },
};

export const Persistence = {
  save(state) {
    try {
      const data = {
        ...TIERS.flatMap((tier) =>
          TIER_FIELDS.map((field) => ({
            [`${tier}${field}`]: state.tiers[tier][field.toLowerCase()],
          })),
        ).reduce((a, b) => ({ ...a, ...b }), {}),
        baseDrop: state.baseDrop,
        primaryMultiplier: state.primaryMultiplier,
        secondaryMultiplier: state.secondaryMultiplier,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("Failed to save:", e);
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const data = JSON.parse(raw);
      const sanitized = Validator.validateStorageData(data);
      if (!sanitized) return null;

      const state = StateManager.createInitial();

      TIERS.forEach((tier) => {
        TIER_FIELDS.forEach((field) => {
          const key = `${tier}${field}`;
          if (key in sanitized) {
            state.tiers[tier][field.toLowerCase()] = Validator.validate(sanitized[key], Schema.tier[field]);
          }
        });
      });

      if ("baseDrop" in sanitized) {
        state.baseDrop = Validator.validate(sanitized.baseDrop, Schema.baseDrop);
      }
      if ("primaryMultiplier" in sanitized) {
        state.primaryMultiplier = Validator.validate(sanitized.primaryMultiplier, Schema.primaryMultiplier);
      }
      if ("secondaryMultiplier" in sanitized) {
        state.secondaryMultiplier = Validator.validate(sanitized.secondaryMultiplier, Schema.secondaryMultiplier);
      }

      return state;
    } catch (e) {
      console.warn("Failed to load:", e);
      return null;
    }
  },
};
