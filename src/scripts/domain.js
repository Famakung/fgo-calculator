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

/* ============================================
   SERVANT COMBO CALCULATOR (Servant Select sub-tab)
   ============================================ */
export const ServantComboCalculator = {
  MAX_COMBO_NODES: 50000,

  /* A servant's usable list is the union of matchingCEIds over every entry with its id, so a
     multi-ascension servant with one entry per ascension group is still one servant.
     Returns { groups: [{ ceIds, servantIds }], unshared: [servantId], truncated: boolean }. */
  buildSharedCEGroups(entries, pickedIds) {
    const picked = [...new Set(pickedIds)].sort();
    const usable = new Map(picked.map((id) => [id, new Set()]));
    entries.forEach((entry) => {
      const list = usable.get(entry.servant.id);
      if (list) entry.matchingCEIds.forEach((ceId) => list.add(ceId));
    });

    // Servants with the same usable list are interchangeable: one search node covers them all.
    const classes = new Map();
    picked.forEach((id) => {
      const ceIds = [...usable.get(id)].sort();
      if (ceIds.length === 0) return;
      const key = ceIds.join(",");
      if (!classes.has(key)) classes.set(key, ceIds);
    });
    const classLists = [...classes.values()].map((ceIds) => ({ ceIds, ceSet: new Set(ceIds) }));

    const rows = new Map();
    let nodes = 0;
    let truncated = false;

    // J = every picked servant whose usable list contains P, so each CE list is recorded once,
    // with its maximal servant group. Groups of one servant are not combos.
    const record = (ceIds) => {
      const key = ceIds.join(",");
      const servantIds = picked.filter((id) => ceIds.every((ceId) => usable.get(id).has(ceId)));
      if (servantIds.length >= 2) rows.set(key, { ceIds, servantIds });
    };

    const walk = (start, current) => {
      for (let i = start; i < classLists.length; i++) {
        if (++nodes > this.MAX_COMBO_NODES) {
          truncated = true;
          return;
        }
        const next = current.filter((ceId) => classLists[i].ceSet.has(ceId));
        if (next.length === 0) continue; // supersets stay empty, so the branch is dead
        record(next);
        walk(i + 1, next);
      }
    };

    classLists.forEach((cls, i) => {
      if (truncated) return;
      if (++nodes > this.MAX_COMBO_NODES) {
        truncated = true;
        return;
      }
      record(cls.ceIds);
      walk(i + 1, cls.ceIds);
    });
    // shortcut: enumeration stops at MAX_COMBO_NODES subsets and flags `truncated`; raise the cap
    // or switch to closed-itemset enumeration only if a real pick of servants hits it.

    const groups = [...rows.values()].sort((a, b) => {
      if (b.ceIds.length !== a.ceIds.length) return b.ceIds.length - a.ceIds.length;
      if (b.servantIds.length !== a.servantIds.length) return b.servantIds.length - a.servantIds.length;
      if (a.ceIds[0] !== b.ceIds[0]) return a.ceIds[0] < b.ceIds[0] ? -1 : 1;
      if (a.servantIds[0] !== b.servantIds[0]) return a.servantIds[0] < b.servantIds[0] ? -1 : 1;
      return 0;
    });

    const covered = new Set(groups.flatMap((g) => g.servantIds));
    return { groups, unshared: picked.filter((id) => !covered.has(id)), truncated };
  },
};
