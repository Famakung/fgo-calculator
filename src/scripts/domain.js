import {
  TIERS,
  TIER_FIELDS,
  MAX_ITERATIONS,
  EPSILON,
  BOND_CONSTANTS,
  CLASS_FILTERS,
  CLASS_GROUPS,
  ALIGNMENT_GBE_FILTERS,
  FREE_QUESTS,
  GRAND_CLASSES,
  GRAND_DIFFICULTIES,
} from "./constants.js";

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

  /* Bond Gain CE picks (either sub-tab) come back from localStorage as an arbitrary value. Keep only
     zero-padded numeric id strings (servant ids are "001"-style, CE ids "0099"-style, so 3 digits or
     more), deduped, in the order they were saved; ids gone from the data files are dropped by the
     caller. Not validateStorageData — that coerces every key through parseFloat. */
  validatePicks(value) {
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

/* ============================================
   BOND LEVEL CALCULATOR (Bond Calculator per-level run breakdown)
   ============================================ */
export const BondLevelCalculator = {
  /* Group the runs by the bond levels they actually cross, using the servant's own point table.
     growth[i] = bond points needed while standing at level i to reach level i+1.
     typedCost replaces the cost of the starting level only — that is the figure the game shows for
     the player's partial progress, while every level above it comes from the table.
     runBudget caps the runs the plan may spend (a Stargazer's Teapot stock); when it binds, the walk
     stops where the money ran out and reports that level so the caller can continue at another rate.
     Returns { rows: [{ from, to, runs }], total, spansLevels, stopLevel, stopRuns, stopOwed }. */
  plan({ growth, current, target, bondPerRun, typedCost = 0, runBudget = Infinity }) {
    const rows = [];
    const none = { rows, total: 0, spansLevels: false, stopLevel: null, stopRuns: 0, stopOwed: 0 };
    if (!Array.isArray(growth) || growth.length === 0 || !(bondPerRun > 0)) return none;

    const start = Math.round(
      Validator.clamp(current, BOND_CONSTANTS.MIN_BOND_LEVEL, BOND_CONSTANTS.MAX_BOND_LEVEL - 1),
    );
    const goal = Math.round(Validator.clamp(target, BOND_CONSTANTS.MIN_BOND_LEVEL + 1, BOND_CONSTANTS.MAX_BOND_LEVEL));
    if (goal <= start) return none;

    let level = start;
    let carry = 0;
    let budget = runBudget;
    let stopLevel = null;
    let stopRuns = 0;
    let stopOwed = 0;
    let iterations = 0;

    while (level < goal && iterations++ < MAX_ITERATIONS) {
      const rowStart = level;
      const cost = level === start && typedCost > 0 ? typedCost : growth[level];
      const runs = Math.max(0, Math.ceil((cost - carry) / bondPerRun));
      if (runs > budget) {
        // The budget dies inside this level: where it stopped, how far it got, what the level still owes.
        stopLevel = level;
        stopRuns = budget;
        stopOwed = cost - carry - budget * bondPerRun;
        break;
      }
      carry += runs * bondPerRun - cost;
      budget -= runs;
      level += 1;
      if (level >= BOND_CONSTANTS.BOND_CARRY_LIMIT) carry = 0;

      // One run can clear several levels, so keep spending the surplus on the levels above it.
      while (level < goal && level < growth.length && carry >= growth[level]) {
        carry -= growth[level];
        level += 1;
        if (level >= BOND_CONSTANTS.BOND_CARRY_LIMIT) carry = 0;
      }

      rows.push({ from: rowStart, to: level, runs });
    }

    const total = rows.reduce((sum, row) => sum + row.runs, 0);
    return {
      rows,
      total,
      spansLevels: rows.length > 1 || (rows.length === 1 && rows[0].to - rows[0].from > 1),
      stopLevel,
      stopRuns,
      stopOwed,
    };
  },
};

/* ============================================
   STARGAZER'S TEAPOT (Bond Calculator ×2 item)
   ============================================ */
/* One teapot per quest run, and a run pays every servant in the party, so the stock is counted in
   party runs and a servant who finishes early costs no extra teapots. */
export const Teapot = {
  /* Split one servant's plan across the party's stock. The boosted walk spends the teapots and reports
     the level it died on; the ordinary walk continues from that level owing what the boosted runs left
     unpaid. stock 0 means no teapot: one ordinary plan, `out` false, `off` null.
     Returns { on, off, out, runs } — two BondLevelCalculator plans, whether the stock fell short, and
     the boosted runs actually paid. `on.rows` names only the levels those runs really cleared: a
     teapot spent inside a level the stock never finished adds to `runs` but to no row, because the
     servant is still on that level when the teapots end and the continuation owns it. */
  plan({ growth, current, target, onPerRun, offPerRun, typedCost, stock }) {
    const spend = stock > 0 && offPerRun > 0;
    const on = BondLevelCalculator.plan({
      growth,
      current,
      target,
      bondPerRun: onPerRun,
      typedCost,
      runBudget: spend ? stock : Infinity,
    });
    const planRuns = on.spansLevels ? on.total : onPerRun > 0 ? Math.ceil(typedCost / onPerRun) : 0;
    if (!spend || on.stopLevel === null) return { on, off: null, out: false, runs: planRuns };

    const off = BondLevelCalculator.plan({
      growth,
      current: on.stopLevel,
      target,
      bondPerRun: offPerRun,
      typedCost: on.stopOwed,
    });
    return { on, off, out: true, runs: on.total + on.stopRuns };
  },
};

/* ============================================
   SLOT CEs (Bond Calculator per-slot craft essences)
   ============================================ */
/* Each servant slot owns its essences: one normally, two when the player ticks Grand Servant. The
   party maths does not move — every equipped essence still boosts every servant — so the bonus comes
   from the pool of every slot's list, not from a list the player keeps beside the party. */
export const SlotCEs = {
  capacity(slot) {
    return slot && slot.grand ? BOND_CONSTANTS.GRAND_MAX_CE_SLOTS : BOND_CONSTANTS.MAX_CE_SLOTS;
  },

  /* Shortens the slot's own list in place, keeping the leading entries: unticking Grand removes the
     second essence, never the first. */
  trim(slot) {
    if (slot && Array.isArray(slot.ces)) {
      slot.ces.length = Math.min(slot.ces.length, this.capacity(slot));
    }
    return slot;
  },

  /* Each pooled essence keeps the flag of the servant wearing it: a borrowed support's essence pays that
     CE's friend-side rate (`supportBonus`, e.g. 0910 Chaldea Teatime 15% instead of the self 5%), so the
     maths needs to know whose servant it sits on. */
  partyPool(slots) {
    const pool = [];
    (slots || []).forEach((slot) => {
      (slot && slot.ces ? slot.ces : []).forEach((entry) => {
        if (entry) pool.push({ entry, isSupport: slot.type === "support" }); // a pending null hole belongs to the picker, not to the party
      });
    });
    return pool;
  },

  /* What one equipped essence contributes to a party: the CE's friend-side rate when a borrowed support
     servant wears it, its own rate otherwise. */
  rate(ce, isSupport) {
    return isSupport && ce.supportBonus ? ce.supportBonus : ce.bonus;
  },

  /* The shape rule loadState() already applied to the old flat pool: a non-empty string id, or a
     group entry carrying both its groupId and the optionId picked from it. */
  isValidEntry(entry) {
    if (typeof entry === "string") return entry.length > 0;
    return !!(entry && typeof entry === "object" && entry.groupId && entry.optionId);
  },

  sanitize(rawCes, rawGrand) {
    const ces = (Array.isArray(rawCes) ? rawCes : []).filter((entry) => this.isValidEntry(entry));
    return this.trim({ ces, grand: Boolean(rawGrand) });
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

/* ============================================
   QUEST (Bond tab quest picker)
   ============================================ */
export const Quest = {
  /* What one run of the quest the player picked pays in bond points. A Grand Duel plan pays its
     difficulty's figure whatever the class is; only the Free Quest family carries a custom figure, and
     that comes from `customBond`. 0 means nothing is chosen yet. */
  bondPerRun({ questMain = "", questSub = "", questDiff = "" }, customBond = 0) {
    if (questMain === "fq") {
      if (questSub === "custom") {
        return Validator.clamp(customBond, 0, BOND_CONSTANTS.MAX_CUSTOM_BOND);
      }
      const quest = FREE_QUESTS.find((q) => q.key === questSub);
      return quest ? quest.bond : 0;
    }
    if (questMain === "gd") {
      const difficulty = GRAND_DIFFICULTIES.find((d) => d.key === questDiff);
      return difficulty ? difficulty.bond : 0;
    }
    return 0;
  },

  /* What one run of the quest costs in AP. Free Quest is 22 AP (or customAp when custom is chosen),
     Grand Duel is 40 AP. 0 means no quest family is chosen yet. */
  apPerRun({ questMain = "", questSub = "" }, customAp = BOND_CONSTANTS.DEFAULT_CUSTOM_AP) {
    if (questMain === "fq") {
      if (questSub === "custom") {
        return Validator.clamp(customAp, 0, BOND_CONSTANTS.MAX_CUSTOM_AP);
      }
      return BOND_CONSTANTS.FREE_QUEST_AP;
    }
    if (questMain === "gd") {
      return BOND_CONSTANTS.GRAND_DUEL_AP;
    }
    return 0;
  },

  /* How many Golden Fruits (restoring maxAp each) are needed to cover totalAp. */
  goldenFruit(totalAp, maxAp) {
    if (!(totalAp > 0) || !(maxAp > 0)) return 0;
    return Math.ceil(totalAp / maxAp);
  },

  /* The class trait ids a Grand Duel choice allows, or null when the party is unrestricted — "All",
     and every quest outside Grand Duel. */
  classIds(questClass = "") {
    const group = GRAND_CLASSES.find((c) => c.key === questClass);
    return group && group.classes ? group.classes : null;
  },

  /* What the servant picker actually filters on: the classes the player left selected, kept inside the
     quest's group. A selection carried over from somewhere else (the party filter persisted, then the
     quest changed) is ignored, and nothing picked inside a group means the whole group — never the
     roster. Without a group the picker's own selection rules, empty meaning no class filter at all. */
  pickedClassIds(classFilters, lockedClasses) {
    const picked = (classFilters || []).filter((id) => !lockedClasses || lockedClasses.includes(id));
    return picked.length > 0 ? picked : lockedClasses || [];
  },

  /* Does this servant's class belong to the party restriction? `traits` is the servant's own class
     trait id list (the same list the picker filters on). */
  matchesClass(traits, questClass) {
    const ids = this.classIds(questClass);
    if (!ids) return true;
    const allowed = new Set(ids);
    return (traits || []).some((t) => allowed.has(t));
  },
};

/* ============================================
   SERVANT FILTERS (Filter Settings modal rows)
   ============================================ */

/* One row is a union — any chip in it passes — and the rows are ANDed together; a row with nothing
   selected is no filter at all. `traits` is always the same merged list the class and rarity rows
   already read: the servant's own in the picker, the resolved ascension's on a result card. */
export const ServantFilters = {
  /* The Good/Balanced/Evil row's last chip is a complement, not a trait: it stands for every servant
     with none of the three, which is where Madness and Summer alignments land. */
  SUB_ALI_OTHER: "other",
  GBE: ALIGNMENT_GBE_FILTERS.filter((c) => c.id).map((c) => c.id),

  /* The Class row's bound, for display: only the group chips and a quest's party lock narrow what a
     player may select, so ticking Saber never greys Archer — the row stays a union. null is no bound. */
  rowScope(groupClassFilters, lockedClasses) {
    const keys = (groupClassFilters || []).filter((k) => CLASS_GROUPS.some((g) => g.key === k));
    const group = [...new Set(keys.flatMap((k) => CLASS_GROUPS.find((g) => g.key === k).classes))];
    const lock = lockedClasses && lockedClasses.length ? lockedClasses : null;
    if (!group.length) return lock ? [...lock] : null;
    if (!lock) return group;
    const clipped = group.filter((id) => lock.includes(id));
    return clipped.length ? clipped : [...lock];
  },

  /* What the Class row filters on: the row's bound, narrowed by a pick inside it. A pick from outside the
     bound — carried in from another group or another quest — is ignored rather than honoured, and a row
     with nothing selected is no filter at all. */
  effectiveClassIds(filters = {}) {
    const scope = this.rowScope(filters.groupClassFilters, filters.lockedClasses);
    const picked = (filters.classFilters || []).filter((id) => !scope || scope.includes(id));
    if (picked.length) return picked;
    return scope;
  },

  /* Nothing selected in a row is no filter, and an untouched row holds an empty array: no bound ever
     reaches this as [] — the impossible combination is spelled null, which means "nothing selected". */
  rowMatches(traits, selected, { other } = {}) {
    if (!selected || selected.length === 0) return true;
    /* `other` is one chip among the row's own, so it takes the same union test as the rest: it is simply
       met by a servant with none of Good, Balanced or Evil rather than by a trait it carries. */
    if (
      other &&
      selected.includes(ServantFilters.SUB_ALI_OTHER) &&
      !(traits || []).some((t) => ServantFilters.GBE.includes(t))
    ) {
      return true;
    }
    return (traits || []).some((t) => selected.includes(t));
  },

  match(traits, filters = {}) {
    const { rarityFilters, aliFilters, subAliFilters, subAttrFilters, genderFilters } = filters;
    /* The class row reads the group, the quest's lock and the player's picks together, and a pick from
       outside the bound is ignored rather than honoured. */
    const ids = this.effectiveClassIds(filters);
    return (
      this.rowMatches(traits, ids) &&
      this.rowMatches(traits, rarityFilters) &&
      this.rowMatches(traits, aliFilters) &&
      this.rowMatches(traits, subAliFilters, { other: true }) &&
      this.rowMatches(traits, subAttrFilters) &&
      this.rowMatches(traits, genderFilters)
    );
  },
};

/* ============================================
   SERVANT SORT (picker rows and result cards)
   ============================================ */

/* Class rank follows the order the filter rows show classes, built once per process. */
let _classOrder = null;
const classOrder = () => {
  if (!_classOrder) {
    _classOrder = new Map();
    [...CLASS_FILTERS.standard, ...CLASS_FILTERS.extra].forEach((cls, idx) => {
      _classOrder.set(cls.id, idx);
    });
  }
  return _classOrder;
};

/* Both keys read the trait list the class and rarity filters already read — the servant's base traits in
   the picker, and the resolved ascension's in a Bond Gain CE result card — so what a row sorts by is what
   filters it. */
export const ServantSort = {
  KEYS: ["id", "rarity", "class"],

  /* The `04xx` rarity trait as a number; a servant with none ranks 0 rather than vanishing. */
  rarity(traits) {
    const found = (traits || []).filter((t) => t.startsWith("04"));
    return found.length > 0 ? Math.max(...found.map((t) => parseInt(t.slice(2), 10))) : 0;
  },

  /* Rank in the picker's own class order. 99 keeps a class nobody lists at the end of ascending order
     instead of folding it in with Saber. */
  classIndex(traits) {
    const found = (traits || []).find((t) => t.startsWith("01"));
    const rank = classOrder().get(found);
    return rank === undefined ? 99 : rank;
  },

  /* A sorted copy. ID breaks every tie, and the direction applies to that tie-break too, so the same list
     re-sorted the other way round comes back exactly reversed.

     A Bond Gain CE result card is not a servant — it is a servant plus the ascension its traits came from —
     so the two readers say where a row's id and trait list live instead of this code guessing. */
  sorted(rows, sortBy = "id", order = "asc", idOf = (row) => row.id, traitsOf = (row) => row.traits) {
    const key = this.KEYS.includes(sortBy) ? sortBy : "id";
    const dir = order === "desc" ? -1 : 1;
    const value = (row) => {
      const traits = traitsOf(row);
      return key === "rarity" ? this.rarity(traits) : key === "class" ? this.classIndex(traits) : 0;
    };
    const numId = (row) => parseInt(idOf(row), 10) || 0;

    return [...rows].sort((a, b) => {
      if (key !== "id") {
        const cmp = value(a) - value(b);
        if (cmp !== 0) return cmp * dir;
      }
      const idCmp = numId(a) !== numId(b) ? numId(a) - numId(b) : String(idOf(a)).localeCompare(String(idOf(b)));
      return idCmp * dir;
    });
  },
};
