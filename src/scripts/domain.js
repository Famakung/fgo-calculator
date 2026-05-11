import { TIERS, TIER_FIELDS, MAX_ITERATIONS, EPSILON } from "./constants.js";

export const Schema = {
  tier: {
    Need: { min: 0, max: 999999, default: 0 },
    Have: { min: 0, max: 999999, default: 0 },
    Bonus: { min: 0, max: 1000, default: 0 },
  },
  baseDrop: { min: 0, max: 100, default: 3 },
  primaryMultiplier: { min: 100, max: 100000, default: 1500 },
  secondaryMultiplier: { min: 100, max: 100000, default: 225 },
};

export const Validator = {
  clamp(value, min, max) {
    const num = parseFloat(value);
    if (isNaN(num)) return min;
    return Math.min(max, Math.max(min, num));
  },

  validate(value, schema) {
    return this.clamp(value, schema.min, schema.max);
  },

  validateStorageData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }
    const allowedKeys = [
      ...TIERS.flatMap((t) => TIER_FIELDS.map((f) => `${t}${f}`)),
      "baseDrop",
      "primaryMultiplier",
      "secondaryMultiplier",
    ];
    const sanitized = {};
    for (const key of allowedKeys) {
      if (key in data) {
        const num = parseFloat(data[key]);
        if (!isNaN(num)) {
          sanitized[key] = num;
        }
      }
    }
    return sanitized;
  },
};

export const Calculator = {
  calcDropRate(base, bonus, multiplier) {
    return Math.round((base + bonus) * multiplier * 100) / 100;
  },

  calcDeficits(needs, haves) {
    const deficits = {};
    TIERS.forEach((tier) => {
      deficits[tier] = Math.max(0, needs[tier] - haves[tier]);
    });
    return deficits;
  },

  calcOptimalRuns(deficits, dropRates) {
    const runs = { bronze: 0, silver: 0, gold: 0 };
    const remaining = { ...deficits };
    let iterations = 0;

    while (TIERS.some((t) => remaining[t] > EPSILON) && iterations < MAX_ITERATIONS) {
      iterations++;
      const maxTier = TIERS.reduce((a, b) => (remaining[a] >= remaining[b] ? a : b));
      const quest = dropRates[maxTier];
      const totalRate = quest.primary.rate + quest.secondary.rate;
      if (totalRate <= 0) {
        return { runs, error: "Drop rates too low" };
      }
      remaining[quest.primary.tier] -= quest.primary.rate;
      remaining[quest.secondary.tier] -= quest.secondary.rate;
      runs[maxTier]++;
    }

    if (iterations >= MAX_ITERATIONS) {
      return { runs, warning: "Calculation limit reached" };
    }
    return { runs };
  },
};

// Optimized: accepts Set for O(1) trait lookups
export const TraitMatcher = {
  matches(servantTraitSet, ce) {
    if (ce.alsoMatch && ce.alsoMatch.some((t) => servantTraitSet.has(t))) return true;
    if (ce.traitGroups.length > 0) {
      return ce.traitGroups.every((group) => group.some((t) => servantTraitSet.has(t)));
    }
    if (ce.traits.length === 0) return true;
    if (ce.matchAll) {
      return ce.traits.every((t) => servantTraitSet.has(t));
    }
    return ce.traits.some((t) => servantTraitSet.has(t));
  },

  getAllTraitSets(servant) {
    if (!servant.hasAscensions) return [{ key: "base", traits: servant.traits, traitSet: servant.traitSet }];
    // Use cached ascension trait sets if available
    if (servant._ascTraitSets) {
      const sets = [];
      const standard = ["000", "001", "002"];
      const allKeys = Object.keys(servant._ascTraitSets);
      const custom = allKeys.filter((k) => !standard.includes(k));
      standard.forEach((k) => {
        if (servant._ascTraitSets[k]) {
          sets.push({ key: k, traits: servant._ascTraits[k], traitSet: servant._ascTraitSets[k] });
        }
      });
      custom.forEach((k) => {
        sets.push({ key: k, traits: servant._ascTraits[k], traitSet: servant._ascTraitSets[k] });
      });
      return sets;
    }
    // Fallback (should not happen with pre-computed data)
    const raw = servant.rawTraits;
    const base = raw.base || [];
    const standard = ["000", "001", "002"];
    const allKeys = Object.keys(raw).filter((k) => k !== "base");
    const custom = allKeys.filter((k) => !standard.includes(k));
    const sets = standard.map((k) => {
      const traits = [...base, ...(raw[k] || [])];
      return { key: k, traits, traitSet: new Set(traits) };
    });
    custom.forEach((k) => {
      const traits = [...base, ...(raw[k] || [])];
      sets.push({ key: k, traits, traitSet: new Set(traits) });
    });
    return sets;
  },
};
