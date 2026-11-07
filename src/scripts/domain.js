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

  /* Build map from CE ID to its 0-based bit index in cePool. */
  _createIndexMap(cePool) {
    const map = new Map();
    for (let i = 0; i < cePool.length; i++) map.set(cePool[i], i);
    return map;
  },

  /* Build bitset context containing cePool, wordCount, ceIndexMap, and optional sharedCESet. */
  _createBitsetContext(cePool, sharedCESet = null) {
    const wordCount = Math.ceil(cePool.length / 32) || 1;
    const ceIndexMap = this._createIndexMap(cePool);
    return { cePool, wordCount, ceIndexMap, sharedCESet };
  },

  /* Create Uint32Array bitmask with bits set for each CE in ceIndexMap. */
  _createMask(ceIds, ceIndexMap, wordCount) {
    const mask = new Uint32Array(wordCount);
    if (!ceIds) return mask;
    const add = (id) => {
      const idx = ceIndexMap.get(id);
      if (idx !== undefined) mask[idx >>> 5] |= 1 << (idx & 31);
    };
    if (Array.isArray(ceIds) || ceIds instanceof Set) ceIds.forEach(add);
    return mask;
  },

  /* Bitwise intersection of two masks; returns new Uint32Array or null if empty. */
  _intersectMasks(maskA, maskB) {
    const len = maskA.length;
    const out = new Uint32Array(len);
    let hasBits = false;
    for (let w = 0; w < len; w++) {
      const val = maskA[w] & maskB[w];
      out[w] = val;
      if (val !== 0) hasBits = true;
    }
    return hasBits ? out : null;
  },

  /* True iff subMask is a bitwise subset of superMask. */
  _isSubsetMask(subMask, superMask) {
    for (let w = 0; w < subMask.length; w++) {
      if ((subMask[w] & ~superMask[w]) !== 0) return false;
    }
    return true;
  },

  /* Fast canonical string key for memoization. */
  _maskKey(mask) {
    return mask.length === 1 ? String(mask[0]) : mask.join(",");
  },

  /* True iff mask has at least one bit set. */
  _hasAnyBit(mask) {
    for (let w = 0; w < mask.length; w++) {
      if (mask[w] !== 0) return true;
    }
    return false;
  },

  /* Decode Uint32Array bitmask back to sorted CE ID array in cePool order. */
  _decodeMask(mask, cePool) {
    const ceIds = [];
    for (let w = 0; w < mask.length; w++) {
      let word = mask[w];
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        const idx = (w << 5) + bit;
        if (idx < cePool.length) ceIds.push(cePool[idx]);
        word &= word - 1;
      }
    }
    return ceIds;
  },

  /* Map each CE ID to the set of picked servant IDs that can use it. */
  _mapCEServants(entries, pickedSet) {
    const ceServants = new Map();
    (entries || []).forEach((entry) => {
      const id = entry?.servant?.id;
      if (!id || !pickedSet.has(id) || !entry.matchingCEIds) return;
      new Set(entry.matchingCEIds).forEach((ceId) => {
        const set = ceServants.get(ceId) || new Set();
        set.add(id);
        ceServants.set(ceId, set);
      });
    });
    return ceServants;
  },

  /* Extract CEs shared by at least two distinct picked servants. */
  _filterSharedCESet(entries, pickedSet) {
    const sharedCESet = new Set();
    this._mapCEServants(entries, pickedSet).forEach((servants, ceId) => {
      if (servants.size >= 2) sharedCESet.add(ceId);
    });
    return sharedCESet;
  },

  /* Collect candidate member entries, filtering CEs to only shared CEs. */
  _collectMembers(entries, pickedSet, bitsetCtx) {
    const { sharedCESet, ceIndexMap, wordCount } = bitsetCtx;
    const members = [];
    (entries || []).forEach((entry) => {
      const servantId = entry?.servant?.id;
      if (!servantId || !pickedSet.has(servantId)) return;
      const rawCeIds = entry.matchingCEIds || [];
      const ceIds = [...new Set(rawCeIds)].filter((id) => sharedCESet.has(id)).sort();
      if (ceIds.length === 0) return;
      members.push({ servantId, entry, ceIds, mask: this._createMask(ceIds, ceIndexMap, wordCount) });
    });
    return members.sort((a, b) => (a.servantId === b.servantId ? 0 : a.servantId < b.servantId ? -1 : 1));
  },

  /* Group members with identical CE lists into equivalence classes. */
  _buildEquivalenceClasses(members) {
    const classMap = new Map();
    members.forEach((m) => {
      const key = this._maskKey(m.mask);
      if (!classMap.has(key)) {
        classMap.set(key, { key, mask: m.mask, ceIds: m.ceIds });
      }
    });
    return [...classMap.values()];
  },

  /* Collect matching member indices and distinct servant count for candidate mask. */
  _collectMatched(mask, members) {
    const indices = [];
    const servantIds = new Set();
    for (let i = 0; i < members.length; i++) {
      if (this._isSubsetMask(mask, members[i].mask)) {
        indices.push(i);
        servantIds.add(members[i].servantId);
      }
    }
    return { indices, servantCount: servantIds.size };
  },

  /* Evaluate whether candidate CE mask matches >= 2 distinct servants. */
  _evaluateCandidateGroup(mask, members, cePool) {
    const { indices, servantCount } = this._collectMatched(mask, members);
    if (servantCount < 2) return null;
    return {
      memberKey: indices.join(","),
      ceIds: this._decodeMask(mask, cePool),
      members: indices.map((idx) => members[idx].entry),
      servantCount,
    };
  },

  /* Deterministic tie-breaker for candidate CE IDs of equal length. */
  _isBetterCEIds(candidateIds, existingIds) {
    for (let i = 0; i < candidateIds.length; i++) {
      if (candidateIds[i] !== existingIds[i]) {
        return candidateIds[i] < existingIds[i];
      }
    }
    return false;
  },

  /* Same-member pruning: keep maximal CE set for identical member group. */
  _recordCandidateGroup(groupsByMembers, candidate) {
    const existing = groupsByMembers.get(candidate.memberKey);
    if (!existing) {
      groupsByMembers.set(candidate.memberKey, candidate);
      return;
    }
    const isLarger = candidate.ceIds.length > existing.ceIds.length;
    const isSameLengthBetter =
      candidate.ceIds.length === existing.ceIds.length && this._isBetterCEIds(candidate.ceIds, existing.ceIds);
    if (isLarger || isSameLengthBetter) {
      groupsByMembers.set(candidate.memberKey, candidate);
    }
  },

  /* Recursive helper for intersection walk across equivalence classes. */
  _walkCombinations(ctx, start, currentMask) {
    for (let i = start; i < ctx.classLists.length; i++) {
      if (++ctx.nodes > ctx.maxNodes) return (ctx.truncated = true);
      const nextMask = this._intersectMasks(currentMask, ctx.classLists[i].mask);
      if (!nextMask) continue;
      const key = this._maskKey(nextMask);
      if (!ctx.seen.has(key)) {
        ctx.seen.add(key);
        ctx.onVisit(nextMask);
        this._walkCombinations(ctx, i + 1, nextMask);
        if (ctx.truncated) return;
      }
    }
  },

  /* Closed intersection walk with seen-key memoization and node budget. */
  _exploreCombinations(classLists, onVisit) {
    const ctx = { classLists, onVisit, seen: new Set(), nodes: 0, truncated: false, maxNodes: this.MAX_COMBO_NODES };
    for (let i = 0; i < classLists.length; i++) {
      if (ctx.truncated) break;
      if (++ctx.nodes > ctx.maxNodes) return { truncated: true };
      const cls = classLists[i];
      if (!ctx.seen.has(cls.key)) {
        ctx.seen.add(cls.key);
        onVisit(cls.mask);
      }
      this._walkCombinations(ctx, i + 1, cls.mask);
    }
    return { truncated: ctx.truncated };
  },

  /* Sort combo groups by CE count desc, servant count desc, first CE, first servant. */
  _sortGroups(groups) {
    return groups.sort((a, b) => {
      if (b.ceIds.length !== a.ceIds.length) return b.ceIds.length - a.ceIds.length;
      if (b.servantCount !== a.servantCount) return b.servantCount - a.servantCount;
      if (a.ceIds[0] !== b.ceIds[0]) return a.ceIds[0] < b.ceIds[0] ? -1 : 1;
      const firstA = a.members[0]?.servant?.id || "";
      const firstB = b.members[0]?.servant?.id || "";
      if (firstA !== firstB) return firstA < firstB ? -1 : 1;
      return 0;
    });
  },

  /* Format and sort final groups from member group map. */
  _formatGroups(groupsByMembers) {
    return this._sortGroups([...groupsByMembers.values()]).map(({ ceIds, members: m }) => ({ ceIds, members: m }));
  },

  /* Resolve unshared picked servants based on coverage and truncation flag. */
  _resolveUnshared(picked, groups, truncated) {
    if (truncated) return [];
    const covered = new Set(groups.flatMap((g) => g.members.map((e) => e.servant.id)));
    return picked.filter((id) => !covered.has(id));
  },

  /* Every entry of a picked servant is its own member, so a multi-ascension servant whose
     ascension groups match different CE sets is split the way Craft Essence Select gives each
     group its own card. A row's members are the forms that can use all of the row's CEs at once.
     Returns { groups: [{ ceIds, members: [entry] }], unshared: [servantId], truncated: boolean }. */
  buildSharedCEGroups(entries, pickedIds) {
    const picked = [...new Set(pickedIds || [])].sort();
    const sharedCESet = this._filterSharedCESet(entries, new Set(picked));
    const cePool = [...sharedCESet].sort();
    const bitsetCtx = this._createBitsetContext(cePool, sharedCESet);
    const members = this._collectMembers(entries, new Set(picked), bitsetCtx);
    const classLists = this._buildEquivalenceClasses(members);
    const groupsByMembers = new Map();

    const { truncated } = this._exploreCombinations(classLists, (mask) => {
      const candidate = this._evaluateCandidateGroup(mask, members, cePool);
      if (candidate) this._recordCandidateGroup(groupsByMembers, candidate);
    });

    const groups = this._formatGroups(groupsByMembers);
    return { groups, unshared: this._resolveUnshared(picked, groups, truncated), truncated };
  },

  /* Extract unique CE IDs matched by clickedEntry. */
  _extractClickedCEs(clickedEntry) {
    if (!clickedEntry?.servant) return [];
    const seen = new Set();
    const list = [];
    const add = (id) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        list.push(id);
      }
    };
    (clickedEntry.matchingCEs || []).forEach((c) => add(typeof c === "string" ? c : c?.id));
    if (list.length === 0 && clickedEntry.matchingCEIds) clickedEntry.matchingCEIds.forEach(add);
    return list.sort();
  },

  /* Collect other servant matches having at least one CE bit in ceIndexMap. */
  _collectOverlapMatches(allMatches, clickedId, bitsetCtx) {
    const { ceIndexMap, wordCount } = bitsetCtx;
    const matches = [];
    (allMatches || []).forEach((m) => {
      if (!m?.servant || m.servant.id === clickedId) return;
      const ids = m.matchingCEIds || (m.matchingCEs || []).map((c) => (typeof c === "string" ? c : c?.id));
      if (!ids) return;
      const mask = this._createMask(ids, ceIndexMap, wordCount);
      if (this._hasAnyBit(mask)) matches.push({ entry: m, mask });
    });
    return matches;
  },

  /* Group other servant matches by identical mask into equivalence classes. */
  _collectOverlapClasses(otherMatches) {
    const classMap = new Map();
    otherMatches.forEach((m) => {
      const key = this._maskKey(m.mask);
      if (!classMap.has(key)) classMap.set(key, { key, mask: m.mask });
    });
    return [...classMap.values()];
  },

  /* Record overlap group for visited mask with maximal CE tie-breaking. */
  _recordOverlapGroup(mask, overlapCtx) {
    const { groups, otherMatches, cePool } = overlapCtx;
    const members = [];
    for (let i = 0; i < otherMatches.length; i++) {
      if (this._isSubsetMask(mask, otherMatches[i].mask)) members.push(otherMatches[i].entry);
    }
    if (members.length === 0) return;
    const servantKey = [...new Set(members.map((m) => m.servant.id))].sort().join(",");
    const ceIds = this._decodeMask(mask, cePool);
    const existing = groups.get(servantKey);
    const isLarger = !existing || ceIds.length > existing.ceIds.length;
    const isSameBetter =
      existing && ceIds.length === existing.ceIds.length && this._isBetterCEIds(ceIds, existing.ceIds);
    if (isLarger || isSameBetter) {
      members.sort((a, b) => (a.servant.id === b.servant.id ? 0 : a.servant.id < b.servant.id ? -1 : 1));
      groups.set(servantKey, { ceIds, otherMembers: members });
    }
  },

  /* Sort overlap groups by CE count desc, member count desc, first CE, first servant. */
  _sortOverlapGroups(groups) {
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

  /* Build shared CE combination groups for a single clicked servant against all other servants.
     Collects non-empty CE intersections from other servants, closes them under pairwise intersection,
     groups by identical other-servant list (keeping maximal CEs), and sorts maximal combinations. */
  buildServantOverlapGroups(allMatches, clickedEntry) {
    const cePool = this._extractClickedCEs(clickedEntry);
    if (cePool.length === 0) return [];
    const bitsetCtx = this._createBitsetContext(cePool);
    const otherMatches = this._collectOverlapMatches(allMatches, clickedEntry.servant.id, bitsetCtx);
    if (otherMatches.length === 0) return [];
    const classLists = this._collectOverlapClasses(otherMatches);
    const overlapCtx = { groups: new Map(), otherMatches, cePool };
    this._exploreCombinations(classLists, (mask) => this._recordOverlapGroup(mask, overlapCtx));
    return this._sortOverlapGroups(overlapCtx.groups);
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
  sorted(
    rows,
    sortBy = "id",
    order = "asc",
    idOf = (row) => (row && (row.collectionNo || (row.servant && row.servant.collectionNo))) || (row && row.id),
    traitsOf = (row) => row.traits,
  ) {
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
