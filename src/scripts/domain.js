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

  /* Servant Select picks come back from localStorage as an arbitrary value. Keep only zero-padded
     numeric id strings (servant ids are "001"-style today, so 3 digits or more), deduped, in the
     order they were saved; ids gone from SERVANT_DATA are dropped by the caller. Not
     validateStorageData — that coerces every key through parseFloat. */
  validateServantPicks(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    value.forEach((id) => {
      if (typeof id === "string" && /^\d{3,}$/.test(id)) seen.add(id);
    });
    return [...seen];
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

  /* Every entry of a picked servant is its own member, so a multi-ascension servant whose
     ascension groups match different CE sets is split the way Craft Essence Select gives each
     group its own card. A row's members are the forms that can use all of the row's CEs at once.
     Returns { groups: [{ ceIds, members: [entry] }], unshared: [servantId], truncated: boolean }. */
  buildSharedCEGroups(entries, pickedIds) {
    const picked = [...new Set(pickedIds)].sort();
    const pickedSet = new Set(picked);
    const members = [];
    entries.forEach((entry) => {
      if (!pickedSet.has(entry.servant.id)) return;
      const ceIds = [...(entry.matchingCEIds || [])].sort();
      if (ceIds.length === 0) return;
      members.push({ servantId: entry.servant.id, entry, ceSet: new Set(ceIds) });
    });
    // Stable sort: rows line up by servant id, and a split servant's groups keep their entry order.
    members.sort((a, b) => (a.servantId === b.servantId ? 0 : a.servantId < b.servantId ? -1 : 1));

    // Members with the same usable list are interchangeable: one search node covers them all.
    const classes = new Map();
    members.forEach((m) => {
      const key = [...m.ceSet].sort().join(",");
      if (!classes.has(key)) classes.set(key, m.ceSet);
    });
    const classLists = [...classes.entries()].map(([key, ceSet]) => ({ key, ceIds: key.split(","), ceSet }));

    const rows = new Map();
    const servantCounts = new Map();
    let nodes = 0;
    let truncated = false;

    // J = every member whose usable list contains P, so each CE list is recorded once, with its
    // maximal group. Members are not combos unless they span two different servants.
    const record = (ceIds, key) => {
      const group = members.filter((m) => ceIds.every((ceId) => m.ceSet.has(ceId)));
      const servantIds = new Set(group.map((m) => m.servantId));
      if (servantIds.size < 2) return;
      rows.set(key, { ceIds, members: group.map((m) => m.entry) });
      servantCounts.set(key, servantIds.size);
    };

    const walk = (start, current) => {
      for (let i = start; i < classLists.length; i++) {
        if (++nodes > this.MAX_COMBO_NODES) {
          truncated = true;
          return;
        }
        const next = current.filter((ceId) => classLists[i].ceSet.has(ceId));
        if (next.length === 0) continue; // supersets stay empty, so the branch is dead
        record(next, next.join(","));
        walk(i + 1, next);
      }
    };

    classLists.forEach((cls, i) => {
      if (truncated) return;
      if (++nodes > this.MAX_COMBO_NODES) {
        truncated = true;
        return;
      }
      record(cls.ceIds, cls.key);
      walk(i + 1, cls.ceIds);
    });
    // shortcut: enumeration stops at MAX_COMBO_NODES subsets and flags `truncated`; raise the cap
    // or switch to closed-itemset enumeration only if a real pick of servants hits it.

    const groups = [...rows.entries()]
      .sort(([keyA, a], [keyB, b]) => {
        if (b.ceIds.length !== a.ceIds.length) return b.ceIds.length - a.ceIds.length;
        const countA = servantCounts.get(keyA);
        const countB = servantCounts.get(keyB);
        if (countB !== countA) return countB - countA;
        if (a.ceIds[0] !== b.ceIds[0]) return a.ceIds[0] < b.ceIds[0] ? -1 : 1;
        const firstA = a.members[0].servant.id;
        const firstB = b.members[0].servant.id;
        if (firstA !== firstB) return firstA < firstB ? -1 : 1;
        return 0;
      })
      .map(([, group]) => group);

    const covered = new Set(groups.flatMap((g) => g.members.map((entry) => entry.servant.id)));
    // A truncated run visited only part of the subset lattice, so a servant missing from the
    // returned rows may still share CEs with another — claim nothing rather than name falsely.
    const unshared = truncated ? [] : picked.filter((id) => !covered.has(id));
    return { groups, unshared, truncated };
  },
};
