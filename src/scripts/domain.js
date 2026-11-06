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

export { TraitMatcher, computeCEMatchMatrix } from "./ce-matcher.js";

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

  /* Build shared CE combination groups for a single clicked servant against all other servants.
     Collects non-empty CE intersections from other servants, closes them under pairwise intersection,
     groups by identical other-servant list (keeping maximal CEs), and sorts maximal combinations. */
  buildServantOverlapGroups(allMatches, clickedEntry) {
    if (!clickedEntry || !clickedEntry.servant) return [];
    const clickedId = clickedEntry.servant.id;
    const clickedCEs = [];
    const seenCEs = new Set();
    (clickedEntry.matchingCEs || []).forEach((c) => {
      const id = typeof c === "string" ? c : c?.id;
      if (id && !seenCEs.has(id)) {
        seenCEs.add(id);
        clickedCEs.push(id);
      }
    });
    if (clickedCEs.length === 0 && clickedEntry.matchingCEIds) {
      clickedEntry.matchingCEIds.forEach((id) => {
        if (!seenCEs.has(id)) {
          seenCEs.add(id);
          clickedCEs.push(id);
        }
      });
    }

    if (clickedCEs.length === 0) return [];

    const otherMatches = [];
    (allMatches || []).forEach((m) => {
      if (!m.servant || m.servant.id === clickedId) return;
      const ceSet = m.matchingCEIds;
      if (!ceSet) return;
      const hasCE = ceSet instanceof Set ? (id) => ceSet.has(id) : (id) => ceSet.includes(id);
      const shared = clickedCEs.filter(hasCE);
      if (shared.length > 0) {
        otherMatches.push({ entry: m, shared, sharedSet: new Set(shared) });
      }
    });

    if (otherMatches.length === 0) return [];

    const classMap = new Map();
    otherMatches.forEach((m) => {
      const key = m.shared.join(",");
      if (!classMap.has(key)) classMap.set(key, { ceIds: m.shared, ceSet: m.sharedSet });
    });
    const classLists = [...classMap.values()];

    const uniqueIntersections = new Map();
    classLists.forEach((cls) => uniqueIntersections.set(cls.ceIds.join(","), cls.ceIds));

    let nodes = 0;
    const walk = (start, current) => {
      for (let i = start; i < classLists.length; i++) {
        if (++nodes > this.MAX_COMBO_NODES) return;
        const next = current.filter((id) => classLists[i].ceSet.has(id));
        if (next.length === 0) continue;
        const key = next.join(",");
        if (!uniqueIntersections.has(key)) {
          uniqueIntersections.set(key, next);
          walk(i + 1, next);
        }
      }
    };

    for (let i = 0; i < classLists.length; i++) {
      walk(i + 1, classLists[i].ceIds);
    }

    const groups = new Map();
    uniqueIntersections.forEach((subIds) => {
      const members = otherMatches.filter((m) => subIds.every((id) => m.sharedSet.has(id))).map((m) => m.entry);
      if (members.length === 0) return;

      const servantKey = [...new Set(members.map((m) => m.servant.id))].sort().join(",");
      const existing = groups.get(servantKey);

      if (!existing || subIds.length > existing.ceIds.length) {
        members.sort((a, b) => (a.servant.id === b.servant.id ? 0 : a.servant.id < b.servant.id ? -1 : 1));
        groups.set(servantKey, {
          ceIds: subIds,
          otherMembers: members,
        });
      }
    });

    return [...groups.values()].sort((a, b) => {
      if (b.ceIds.length !== a.ceIds.length) return b.ceIds.length - a.ceIds.length;
      if (b.otherMembers.length !== a.otherMembers.length) return b.otherMembers.length - a.otherMembers.length;
      if (a.ceIds[0] !== b.ceIds[0]) return a.ceIds[0] < b.ceIds[0] ? -1 : 1;
      const firstA = a.otherMembers[0]?.servant?.id || "";
      const firstB = b.otherMembers[0]?.servant?.id || "";
      if (firstA !== firstB) return firstA < firstB ? -1 : 1;
      return 0;
    });
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

  compile(filters = {}) {
    const { rarityFilters, aliFilters, subAliFilters, subAttrFilters, genderFilters } = filters;
    const classIds = this.effectiveClassIds(filters);

    const hasClass = classIds && classIds.length > 0;
    const hasRarity = rarityFilters && rarityFilters.length > 0;
    const hasAli = aliFilters && aliFilters.length > 0;
    const hasSubAli = subAliFilters && subAliFilters.length > 0;
    const hasSubAttr = subAttrFilters && subAttrFilters.length > 0;
    const hasGender = genderFilters && genderFilters.length > 0;

    if (!hasClass && !hasRarity && !hasAli && !hasSubAli && !hasSubAttr && !hasGender) {
      return () => true;
    }

    const classSet = hasClass ? new Set(classIds) : null;
    const raritySet = hasRarity ? new Set(rarityFilters) : null;
    const aliSet = hasAli ? new Set(aliFilters) : null;
    const subAliOther = hasSubAli && subAliFilters.includes(this.SUB_ALI_OTHER);
    const subAliSet = hasSubAli ? new Set(subAliFilters.filter((id) => id !== this.SUB_ALI_OTHER)) : null;
    const subAttrSet = hasSubAttr ? new Set(subAttrFilters) : null;
    const genderSet = hasGender ? new Set(genderFilters) : null;
    const gbeList = this.GBE;

    return (traits) => {
      if (!traits) return false;
      const isSet = traits instanceof Set;
      const hasAny = (set) => {
        if (!set) return true;
        if (isSet) {
          for (const t of set) {
            if (traits.has(t)) return true;
          }
          return false;
        }
        for (let i = 0; i < traits.length; i++) {
          if (set.has(traits[i])) return true;
        }
        return false;
      };

      if (classSet && !hasAny(classSet)) return false;
      if (raritySet && !hasAny(raritySet)) return false;
      if (aliSet && !hasAny(aliSet)) return false;
      if (subAttrSet && !hasAny(subAttrSet)) return false;
      if (genderSet && !hasAny(genderSet)) return false;
      if (hasSubAli) {
        if (subAliOther) {
          const hasGBE = isSet ? gbeList.some((t) => traits.has(t)) : traits.some((t) => gbeList.includes(t));
          if (!hasGBE) return true;
        }
        if (subAliSet && subAliSet.size > 0 && hasAny(subAliSet)) return true;
        return false;
      }
      return true;
    };
  },

  match(traits, filters = {}) {
    return this.compile(filters)(traits);
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
    const len = rows.length;
    if (len <= 1) return [...rows];

    const decorated = new Array(len);
    for (let i = 0; i < len; i++) {
      const row = rows[i];
      const rawId = idOf(row);
      const numId = parseInt(rawId, 10) || 0;
      let val = 0;
      if (key === "rarity") {
        val = this.rarity(traitsOf(row));
      } else if (key === "class") {
        val = this.classIndex(traitsOf(row));
      }
      decorated[i] = { row, val, numId, strId: String(rawId) };
    }

    decorated.sort((a, b) => {
      if (key !== "id") {
        const cmp = a.val - b.val;
        if (cmp !== 0) return cmp * dir;
      }
      const idCmp = a.numId !== b.numId ? a.numId - b.numId : a.strId.localeCompare(b.strId);
      return idCmp * dir;
    });

    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = decorated[i].row;
    }
    return out;
  },
};
