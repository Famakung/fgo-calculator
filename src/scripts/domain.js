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
  shopRequire: { min: 0, max: 999999, default: 0 },
  ceOwned: { min: 0, max: 99, default: 0 },
  ceEquipLimit: { min: 1, max: 6, default: 6 },
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
     zero-padded numeric id strings (servant ids are "001"-style, CE ids "9400970"-style, so 3 digits or
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

    const exact = solveLegacyRuns(deficits, dropRates, runs);
    if (exact) return { runs: exact };
    if (iterations >= MAX_ITERATIONS) {
      return { runs, warning: "Calculation limit reached" };
    }
    return { runs };
  },
};

function legacyRate(dropRates, questTier, dropTier) {
  const quest = dropRates && dropRates[questTier];
  if (!quest) return 0;
  let rate = 0;
  if (quest.primary && quest.primary.tier === dropTier) rate += quest.primary.rate;
  if (quest.secondary && quest.secondary.tier === dropTier) rate += quest.secondary.rate;
  return rate;
}

function solveLegacyRuns(deficits, dropRates, fallback) {
  const pb = legacyRate(dropRates, "bronze", "bronze");
  const ps = legacyRate(dropRates, "silver", "silver");
  const pg = legacyRate(dropRates, "gold", "gold");
  if (pb <= 0 || ps <= 0 || pg <= 0) return null;
  const gb = legacyRate(dropRates, "gold", "bronze");
  const sb = legacyRate(dropRates, "silver", "bronze");
  const bs = legacyRate(dropRates, "bronze", "silver");
  const gs = legacyRate(dropRates, "gold", "silver");
  const bg = legacyRate(dropRates, "bronze", "gold");
  const sg = legacyRate(dropRates, "silver", "gold");
  if (sb > 0) return null;
  const db = Math.max(0, deficits.bronze || 0);
  const ds = Math.max(0, deficits.silver || 0);
  const dg = Math.max(0, deficits.gold || 0);
  const maxG = Math.min(MAX_ITERATIONS, Math.ceil(dg / pg));
  let best = fallback && fallback.bronze + fallback.silver + fallback.gold < MAX_ITERATIONS ? fallback : null;
  let bestTotal = best ? best.bronze + best.silver + best.gold : Infinity;
  for (let g = 0; g <= maxG; g++) {
    const b = Math.max(0, Math.ceil((db - g * gb - EPSILON) / pb));
    const s = Math.max(0, Math.ceil((ds - b * bs - g * gs - EPSILON) / ps));
    const gFinal = Math.max(g, Math.ceil((dg - b * bg - s * sg - EPSILON) / pg));
    const total = b + s + gFinal;
    if (total < bestTotal) {
      bestTotal = total;
      best = { bronze: b, silver: s, gold: gFinal };
    }
  }
  return best;
}

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

/* ===...=== Event Shop Planner (domain) ===...=== */
/* Require counts for one event-shop snapshot. Keys are String(item.id); values are purchases the
   player plans to make. Unlimited (limitNum 0) items cap at Schema.shopRequire.max, matching the
   in-game shop's behavior of never gating a repeatable purchase. */
export const EventShop = {
  maxRequire(item) {
    return item.limitNum > 0 ? item.limitNum : Schema.shopRequire.max;
  },

  clampRequire(item, value) {
    return Math.floor(Validator.clamp(value, Schema.shopRequire.min, this.maxRequire(item)));
  },

  clampCeOwned(value) {
    return clampSchemaInteger(value, Schema.ceOwned);
  },

  clampCeEquipLimit(value) {
    return clampSchemaInteger(value, Schema.ceEquipLimit);
  },

  rowCost(item, require) {
    return require * item.cost.amount;
  },

  /* Per-currency spend across the whole plan: { [String(currencyId)]: total }. Every currency that
     appears in `items` gets a key even at 0, so the summary chips never vanish mid-typing. */
  totals(items, requires) {
    const totals = {};
    for (const item of items) {
      const key = String(item.cost.itemId);
      const require = requires[String(item.id)] || 0;
      totals[key] = (totals[key] || 0) + this.rowCost(item, require);
    }
    return totals;
  },

  /* The "clear" plan from the in-game shop: buy out every limited item, leave unlimited items at 0. */
  clearRequires(items) {
    const requires = {};
    for (const item of items) {
      requires[String(item.id)] = item.limitNum > 0 ? item.limitNum : 0;
    }
    return requires;
  },

  /* Tier ("gold"/"silver"/"bronze") → the shop currency whose background carries it, for the
     event-native tier cards. First match wins; null means the shop has nothing for that tier and
     the card keeps its legacy generic look. Pure: a non-array currencies argument is simply "none". */
  currencyForTier(currencies, tier) {
    if (!Array.isArray(currencies)) return null;
    for (const currency of currencies) {
      if (currency && currency.background === tier) return currency;
    }
    return null;
  },

  /* Storage blob { eventId, requires } → usable plan. A different event's saved counts are dead
     data (item ids collide across events' number ranges), so any mismatch starts from empty. */
  sanitizeRequires(saved, items, currentEventId) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    if (saved.eventId !== currentEventId) return {};
    const raw = saved.requires;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const byId = itemIndex(items);
    const requires = {};
    for (const [itemId, value] of Object.entries(raw)) {
      const item = byId.get(itemId);
      if (!item) continue;
      requires[itemId] = this.clampRequire(item, value);
    }
    return requires;
  },

  /* Draft merge for the modal's Done commit: only ids the shop actually sells survive, and every
     surviving value goes through clampRequire. Current and partial are both { [String(item.id)]: n }. */
  mergeRequires(current, partial, items) {
    const merged = { ...current };
    const byId = itemIndex(items);
    for (const [itemId, value] of Object.entries(partial || {})) {
      const item = byId.get(itemId);
      if (item) merged[String(item.id)] = this.clampRequire(item, value);
    }
    return merged;
  },

  /* Items per run of ONE drop line: dropExpected (stacks/run) × (num + bonus), where the bonus is
     that LINE's currency, not the card's. The farm optimizer and the farm cards share this one
     multiply, so a card can never print a figure its own results disagree with. A null drop pays 0. */
  dropPerRun(drop, bonus) {
    if (!drop) return 0;
    return count(drop.dropExpected) * (count(drop.num) + Validator.validate(bonus, Schema.tier.Bonus));
  },

  /* Trade-aware minimum-play farm plan (Amendment L5). Inputs are all keyed by String(currencyId):
     totals come from EventShop.totals, held/bonus from the plan (Amendment H currency keys), farm
     from the snapshot ({ quests, best }) and trades from the snapshot ([{ fromId, toId, costAmount,
     getNum }]); priorityQuestId is the plan's farmQuest and currencyQuest the per-currency card
     picks ({ [currencyId]: questId }, Amendment M6): a shortfall's top-up farms with that currency's
     SELECTED quest whenever it can, falling back to the best rate only when the selection is the
     priority quest itself or unusable. Amendment N2 makes every top-up CANDIDATE non-all-covering —
     a quest dropping all of the shop's currencyIds (the event's list; the deficit keys when the
     caller sends none) is card 4's quest and never a top-up, so the cards 1-to-3 dropdowns and the
     search share one exclusion. With the default picks (each currency's best non-all-covering
     quest) the search is
     exactly the one Amendment L pinned. The plan minimises total quest RUNS: with
     a priority quest it scans that quest's run count and top-ups greedily beside it (largest
     remaining shortfall first, whole runs), crediting every quest's FULL
     drop vector so secondary drops pay into other currencies' deficits; without one a bounded exact
     search walks the total play count upward and prices every farming mix the quest candidates
     allow (Amendment Q2), so the answer is that input's true minimum, never more than the greedy
     no-base walk. Surplus low-rarity currency then cascades up the
     trade chain in integer, free, unlimited conversions (bronze→silver→gold) to cover what farming
     leaves short — that full cascade is what the SEARCH prices coverage with, while the trades the plan
     reports are the minimum that cover each shortfall (Amendment R22): a currency gives up only what
     downstream still needs, not every spare unit. All coverage pricing runs in whole micro-units of the
     1e-4 figure grid — exact
     integer arithmetic, no float slack — and every played quest comes from the dominance search
     pool, so an accepted plan always covers when its drops are replayed as exact integer stacks
     (Amendment Q correctness fix: the oracle's contract). Tie-breaks: least total surplus, then
     least AP. Deterministic and bounded: the
     scan stops as soon as its run count alone can no longer beat the best plan found.
     Output { plays: [{ questId, questName, recommendLv, runs, mainDropId, isAllDrop }],
              trades: [{ fromId, toId, count }], yields: { [cid] }, farmed: { [cid] },
              surplus: { [cid] }, totalPlays } — totalPlays is null only when nothing can cover
              the deficit. farmed is the plan's runs' raw quest drops, bonus-priced and BEFORE
              any trade — report-only, the figure the Item Receive card prints. trades, yields and
              surplus are the minimum-cover result (Amendment R22, minCoverTrades): the fewest whole
              trades that leave every currency at or above its deficit, the stacks left after executing
              exactly those trades, and the surplus sitting in the bag with them. */
  farmPlan({
    totals = {},
    held = {},
    bonus = {},
    farm = {},
    trades = [],
    priorityQuestId = null,
    currencyQuest = {},
    currencyIds = null,
    bonusCes = [],
    ceOwned = {},
    ceEquipLimit = Schema.ceEquipLimit.default,
  } = {}) {
    const deficits = planDeficits(totals, held, farm);
    const keys = Object.keys(deficits);
    if (!keys.length || allCovered(deficits)) return emptyFarmPlan(keys);
    const quests = planQuests(farm, bonus);
    if (!quests.length) return infeasibleFarmPlan();
    const selection = currencyQuest && typeof currencyQuest === "object" ? currencyQuest : {};
    const coveringIds = new Set(
      this.allCoveringQuests(farm, currencyIds === null ? keys : currencyIds).map((quest) => String(quest.questId)),
    );
    const chain = tradeChain(trades);
    const defaultAllDropId = this.defaultFarmQuest(farm, currencyIds === null ? keys : currencyIds);
    const equipLimit = this.clampCeEquipLimit(ceEquipLimit);
    const normalizedCes = normalizeBonusCes(bonusCes, ceOwned, equipLimit);
    const table = {
      deficits,
      keys,
      bonus: bonus && typeof bonus === "object" ? bonus : {},
      chain,
      order: cascadeOrder(keys, chain),
      quests,
      selection,
      defaultAllDropId,
      topUps: quests.filter((quest) => !coveringIds.has(String(quest.meta.questId))),
      coveringIds,
    };
    const plan = normalizedCes.length
      ? bestCeFarmPlan(table, priorityQuestId, normalizedCes, equipLimit)
      : bestFarmPlan(table, priorityQuestId);
    return plan || infeasibleFarmPlan();
  },

  /* The quests the 3-in-1 farm card can offer (Amendment L3): those dropping EVERY shop currency
     of the event. currencyIds are the snapshot's currency ids in any order; an empty list has no
     all-covering quest by definition. */
  allCoveringQuests(farm, currencyIds) {
    const keys = (Array.isArray(currencyIds) ? currencyIds : []).map(String);
    if (!keys.length) return [];
    const quests = farm && Array.isArray(farm.quests) ? farm.quests : [];
    return quests.filter((quest) => quest && quest.drops && keys.every((key) => Object.hasOwn(quest.drops, key)));
  },

  /* The farmQuest default (Amendment L4): the all-covering quest with the highest total
     dropExpected×num (plain data figures, before bonuses), ties to the lower quest id. null when
     the event ships no all-covering quest — then per-currency planning runs with no shared base. */
  defaultFarmQuest(farm, currencyIds) {
    const covering = this.allCoveringQuests(farm, currencyIds);
    if (!covering.length) return null;
    const ranked = [...covering].sort((a, b) => questBaseTotal(b) - questBaseTotal(a) || a.questId - b.questId);
    return ranked[0].questId;
  },

  /* The default quest of a per-currency card (Amendment N2): the best-rate quest that drops this
     currency among the ones that do NOT cover every shop currency — an all-covering quest is card
     4's quest and never a card's own pick. Plain data figures (dropExpected×num, bonus-free like
     the dropdown sort), ties to the lower quest id. null when no non-all-covering quest drops the
     currency at all — the card then shows its best dropper with no dropdown. */
  defaultCurrencyQuest(farm, currencyIds, currencyKey) {
    const key = String(currencyKey);
    const covering = new Set(this.allCoveringQuests(farm, currencyIds).map((quest) => quest.questId));
    const quests = farm && Array.isArray(farm.quests) ? farm.quests : [];
    const droppers = quests.filter((quest) => quest && (quest.drops || {})[key] && !covering.has(quest.questId));
    const best = droppers.reduce((top, quest) => {
      if (!top) return quest;
      const amount = dropAmount(quest.drops[key]);
      const topAmount = dropAmount(top.drops[key]);
      return amount > topAmount || (amount === topAmount && quest.questId < top.questId) ? quest : top;
    }, null);
    return best ? best.questId : null;
  },

  /* A per-currency card's quest pick (Amendment M4, N2): the saved quest survives only when this
     event's farm list carries it, it drops this currency AND it is not all-covering — a card cannot
     show a quest its dropdown excludes. Anything else re-defaults through defaultCurrencyQuest, the
     same rule the card's default and the dropdown writer use. null only when the currency has no
     non-all-covering dropper at all. */
  sanitizedCurrencyQuest({ farm = {}, currencyIds = [], currencyKey, saved } = {}) {
    const key = String(currencyKey);
    const covering = new Set(this.allCoveringQuests(farm, currencyIds).map((quest) => quest.questId));
    const quests = Array.isArray(farm.quests) ? farm.quests : [];
    const id = Number(saved);
    const kept = quests.some((quest) => quest.questId === id && (quest.drops || {})[key] && !covering.has(id));
    return kept ? id : this.defaultCurrencyQuest(farm, currencyIds, key);
  },

  /* Multi-event storage blob (Amendment G) → { selectedEventId, plans }. The old single-event
     { eventId, requires } shape migrates into plans[eventId]; a plan whose event is not in the
     snapshot list is dropped, and every surviving plan is sanitized against that event's own
     items, currency list and farm quest set. */
  sanitizePlans(saved, events) {
    const snapshots = Array.isArray(events) ? events.filter((snap) => snap && snap.event) : [];
    const blob = migratePlanBlob(saved);
    const plans = {};
    for (const snap of snapshots) {
      plans[String(snap.event.id)] = sanitizeEventPlan(blob.plans[String(snap.event.id)], snap);
    }
    return { selectedEventId: pickSelectedEventId(blob.selectedEventId, snapshots), plans };
  },
};

/* ===...=== Event Shop farm optimizer helpers (domain-private, Amendment L) ===...=== */

/* A shortfall inside this is "covered": 1e-6 units of a currency no human counts. */
const SHORTFALL_EPS = 1e-6;
/* The priority scan never runs past this many base runs. Real event shops price plans in the low
   hundreds; the cap only stops pathological data (a 1-in-a-million drop) from looping for a year.
   shortcut: caps the scan at MAX_PLAN_SCAN base runs, raise it if an event ever needs more. */
const MAX_PLAN_SCAN = 10000;
/* The exact search stops after this many mix evaluations. The reachability prune keeps real events
   bounded — the worst shipped case, 80639 at the buy-all spend, finds its 453-play minimum in
   4.6e6 — and an exhausted budget falls back to the greedy incumbent, never to a worse or partial
   answer.
   shortcut: caps the exact search at MAX_EXACT_SEARCH_NODES mixes; raise it if a real event's
   optimum ever stops being found before the cap. */
const MAX_EXACT_SEARCH_NODES = 10000000;
/* Every shipped figure lands on the 1e-4 currency grid: dropExpected carries 4 decimals and runs,
   needs, trade costs and gets are integers. The optimizer therefore prices every plan in whole
   MICRO-UNITS of this grid — exact integers below 2^53, no float slack anywhere in a coverage or
   trade decision — so an accepted plan covers under the oracle's integer replay by construction,
   not by tolerance. (Amendment Q correctness fix: the old float + eps path let the priority scan
   play a quest the replay excluded and let slack hide micro-shortfalls.) */
const CURRENCY_MICRO = 10000;

/* One figure snapped to the micro grid: the oracle's Math.round(x × 10^4), the same reading of
   the same 4-decimal data. Inputs are count()-clean numbers; junk reads 0 and pays nothing. */
function micro(value) {
  return Math.round(count(value) * CURRENCY_MICRO);
}

/* Micro-units back to currency units for the plan's reported figures. */
function unitsOf(microValue) {
  return roundPlanFigure(count(microValue) / CURRENCY_MICRO);
}

/* The currencies the plan prices, in micro-units: everything the shop needs money for (totals),
   everything with a best quest, and everything any farm quest drops. Sorted by numeric id so every
   tie-break below walks the same order on every machine. Deficits are snapped to the micro grid
   (the oracle's rounding of the same figures), so every later comparison is exact integer math. */
function planDeficits(totals, held, farm) {
  const keys = new Set(Object.keys(totals || {}));
  for (const key of Object.keys((farm && farm.best) || {})) keys.add(key);
  for (const quest of (farm && farm.quests) || []) for (const key of Object.keys(quest.drops || {})) keys.add(key);
  const deficits = {};
  for (const key of [...keys].sort(numericKeys)) {
    deficits[key] = Math.max(0, micro(count(totals[key]) - count((held || {})[key])));
  }
  return deficits;
}

/* One shipped quest with its bonus-priced per-run rate in micro-units: dropExpected × (num + the
   LINE's bonus), snapped to the grid — the oracle's Math.round(dropExpected × 10^4) × (num + bonus)
   read of the same 4-decimal figure. Cards keep printing the plain dropPerRun float; the snap moves
   nothing they show (2-decimal print) and is exactly what the integer replay credits. */
function planQuests(farm, bonus) {
  return ((farm && farm.quests) || [])
    .filter((quest) => quest)
    .map((quest) => {
      const rates = {};
      for (const [key, drop] of Object.entries(quest.drops || {}))
        rates[key] = micro(EventShop.dropPerRun(drop, bonus[key]));
      return { meta: quest, rates };
    });
}

function numericKeys(a, b) {
  return Number(a) - Number(b);
}

function questBaseTotal(quest) {
  return Object.values(quest.drops || {}).reduce((sum, drop) => sum + count(drop.dropExpected) * count(drop.num), 0);
}

function allCovered(deficits) {
  return Object.values(deficits).every((value) => value <= 0);
}

function emptyFarmPlan(keys) {
  return { plays: [], trades: [], yields: zeroMap(keys), farmed: zeroMap(keys), surplus: zeroMap(keys), totalPlays: 0 };
}

function infeasibleFarmPlan() {
  return { plays: [], trades: [], yields: {}, farmed: {}, surplus: {}, totalPlays: null };
}

function zeroMap(keys) {
  const map = {};
  for (const key of keys) map[key] = 0;
  return map;
}

/* The upgrade-trade chain indexed by its SOURCE currency: { [fromKey]: [{ toKey, costMicro,
   getMicro }] }, each source's targets sorted by id. Cost and get are the oracle's × 10^4 products,
   so the cascade's floor division sees the same integers it does. Bad rows (no figures,
   self-conversion) simply never join the chain; a malformed cycle survives in cascadeOrder without
   ever double-spending. */
function tradeChain(trades) {
  const chain = {};
  for (const trade of Array.isArray(trades) ? trades : []) {
    const fromKey = tradeKey(trade && trade.fromId);
    const toKey = tradeKey(trade && trade.toId);
    if (fromKey === null || toKey === null || fromKey === toKey) continue;
    if (!(count(trade.costAmount) > 0) || !(count(trade.getNum) > 0)) continue;
    const entry = {
      toKey,
      costMicro: count(trade.costAmount) * CURRENCY_MICRO,
      getMicro: count(trade.getNum) * CURRENCY_MICRO,
    };
    (chain[fromKey] = chain[fromKey] || []).push(entry);
  }
  for (const outs of Object.values(chain)) outs.sort((a, b) => Number(a.toKey) - Number(b.toKey));
  return chain;
}

/* Trade ids arrive from event data; a non-numeric one like "__proto__" must never reach the chain
   index, where reading `chain["__proto__"]` returns Object.prototype. Anything that is not a finite
   number becomes a null key and tradeChain skips the trade. */
function tradeKey(id) {
  if (id === undefined || id === null || id === "") return null;
  return Number.isFinite(Number(id)) ? String(id) : null;
}

/* Apply the whole integer cascade to one farming outcome, in micro-units: settle currencies
   bottom-up through the chain (every source is spent before its target reads the pushed units),
   keep each currency's micro deficit, and push everything else upward as far as the ratio buys —
   the oracle's floor(max(0, free) / cost) on the same integers, so a covered mix never hinges on
   float noise landing above or below a trade boundary. Pushing ALL surplus up is the optimal play:
   each 10:1 conversion turns 10 units of slack into 1, so trading more can only ever lower the
   total surplus the tie-break counts, never hide a shortfall. Returns { final, short, trades } in
   micro-units (trades in whole counts) — short is what farming and trades together still did not
   cover, the search's signal. `table` carries { deficits, chain, keys, order } — the immutable
   inputs of one farmPlan call, all in micro-units. */
export function cascadeYields(table, yields) {
  const inUnits = {};
  const final = {};
  const short = {};
  const trades = [];
  for (const key of table.order) {
    const avail = count(yields[key]) + count(inUnits[key]);
    let free = avail - count(table.deficits[key]);
    let spent = 0;
    for (const trade of table.chain[key] || []) {
      const times = Math.floor(Math.max(0, free) / trade.costMicro);
      if (times <= 0) continue;
      free -= times * trade.costMicro;
      spent += times * trade.costMicro;
      inUnits[trade.toKey] = count(inUnits[trade.toKey]) + times * trade.getMicro;
      trades.push({ fromId: Number(key), toId: Number(trade.toKey), count: times });
    }
    final[key] = avail - spent;
    short[key] = Math.max(0, count(table.deficits[key]) - final[key]);
  }
  return { final, short, trades };
}

/* Bottom-up chain order via Kahn's algorithm, ids ascending at every choice point. A cyclic trade
   graph (invalid data the validator rejects) leaves its cycle nodes for last, where inbound units
   are simply lost — an uncovered shortfall, never a wrongly counted surplus. */
function cascadeOrder(keys, chain) {
  const indegree = {};
  const nodes = new Set(keys);
  for (const [fromKey, outs] of Object.entries(chain)) {
    nodes.add(fromKey);
    for (const out of outs) {
      nodes.add(out.toKey);
      indegree[out.toKey] = count(indegree[out.toKey]) + 1;
    }
  }
  const all = [...nodes].sort(numericKeys);
  const queue = all.filter((key) => !indegree[key]);
  const queued = new Set(queue);
  const order = [];
  while (queue.length) {
    const key = queue.shift();
    order.push(key);
    for (const out of chain[key] || []) {
      indegree[out.toKey] -= 1;
      if (!queued.has(out.toKey) && indegree[out.toKey] <= 0) {
        queued.add(out.toKey);
        queue.push(out.toKey);
        queue.sort(numericKeys);
      }
    }
  }
  for (const key of all) if (!order.includes(key)) order.push(key);
  return order;
}

/* ===...=== Minimum-cover trades (Amendment R22) ===...=== */

/* What the plan REPORTS as trades: the minimum whole trades that leave every currency at or above its
   deficit — the owner's "only minimum trades to cover", not the cascade's full sweep of the surplus.
   The search keeps pricing coverage with the whole cascade (trading all surplus up is what makes a play
   count provably minimal); only the finished plan is trimmed, so plays, totalPlays and the minimum-play
   guarantee are exactly what the oracle audits.
   Algorithm: seed the chain's rows with that full cascade (every caller reaches this only after the
   cascade left nothing short), then walk the rows from the TOP of the chain down and drop from each row
   the trades its destination can spare. Dropping x trades on one row hands x×costMicro back to its
   source and takes x×getMicro off its destination alone — no other currency's stack moves — so the
   removable number is floor(slack / getMicro) with slack = destination stack − deficit. Coverage
   survives every step (the destination is never taken below its deficit, the source only gains) and on a
   chain the top row lands on exactly ceil(need / get): pie 195.2456 short of 5000 → 196 donut→pie
   trades, not the 202 the cascade makes, and the donut that frees then empties cookie→donut. Whole
   micro-units throughout, no float slack; stale or invalid rows never join the chain (tradeChain).
   shortcut: one property this does not chase — a branching chain (several sources into one currency) is
   trimmed row by row, so its trade count can sit above the true global minimum. Shipped events are
   linear bronze→silver→gold chains, where each row lands on its own exact minimum. */
function minCoverTrades(rawYieldsMicro, deficitsMicro, chain, order) {
  const rows = tradeRows(chain, order);
  if (!rows.length) return { trades: [], final: rawYieldsMicro };
  spendSurplusUpChain(rawYieldsMicro, deficitsMicro, rows);
  if (rows.every((row) => row.count <= 0)) return { trades: [], final: rawYieldsMicro };
  const final = stacksAfter(rows, rawYieldsMicro, order);
  for (let index = rows.length - 1; index >= 0; index--) trimRowToCover(rows[index], final, deficitsMicro);
  return { trades: keptTrades(rows), final };
}

/* Every trade row the chain offers, in the order cascadeYields spends them: sources bottom-up, each
   source's targets id ascending. Working copies — the minimum-cover pass counts trades on them, so a
   shop that lists one pair twice still prices each row on its own figures. */
function tradeRows(chain, order) {
  const rows = [];
  for (const key of order) for (const entry of chain[key] || []) rows.push({ ...entry, fromKey: key, count: 0 });
  return rows;
}

/* Seed each row with the full cascade: every unit above a deficit pushed up the chain, the same
   floor(max(0, free) / costMicro) walk cascadeYields applies and the search's cascadeArrays already
   twins. A plan reaches the trim only after that cascade covered, so these rows are a covering set. */
export function spendSurplusUpChain(rawYieldsMicro, deficitsMicro, rows) {
  const free = {};
  const pushed = {};
  for (const row of rows) {
    if (free[row.fromKey] === undefined)
      free[row.fromKey] =
        count(rawYieldsMicro[row.fromKey]) + count(pushed[row.fromKey]) - count(deficitsMicro[row.fromKey]);
    row.count = Math.floor(Math.max(0, free[row.fromKey]) / row.costMicro);
    free[row.fromKey] -= row.count * row.costMicro;
    pushed[row.toKey] = count(pushed[row.toKey]) + row.count * row.getMicro;
  }
}

/* Execute the rows: every node ends with what it dropped plus everything that arrived, minus what its
   own trades cost — all in micro units, so the figure is the sum of one trade list, never a re-run of
   the cascade. Rows run bottom-up, so a node's arrivals come from rows that trade before its own spend,
   and a covered node (stack ≥ deficit ≥ 0) has the items to pay for the trades it makes. */
function stacksAfter(rows, rawYieldsMicro, order) {
  const stacks = {};
  for (const key of order) stacks[key] = count(rawYieldsMicro[key]);
  for (const row of rows) stacks[row.toKey] = count(stacks[row.toKey]) + row.count * row.getMicro;
  for (const row of rows) stacks[row.fromKey] -= row.count * row.costMicro;
  return stacks;
}

/* Drop the trades the destination can spare: its own surplus above the deficit, in whole trades. The
   freed cost returns to the source's stack, so the surplus the cascade sent up stays in the bag. */
function trimRowToCover(row, final, deficitsMicro) {
  const slack = count(final[row.toKey]) - count(deficitsMicro[row.toKey]);
  const removable = Math.min(row.count, Math.floor(Math.max(0, slack) / row.getMicro));
  if (removable <= 0) return;
  row.count -= removable;
  final[row.toKey] -= removable * row.getMicro;
  final[row.fromKey] = count(final[row.fromKey]) + removable * row.costMicro;
}

/* The rows the trim left with trades, in the cascade's order, in the shape the results card resolves
   against the shop's ratios: { fromId, toId, count }. */
function keptTrades(rows) {
  return rows
    .filter((row) => row.count > 0)
    .map((row) => ({ fromId: Number(row.fromKey), toId: Number(row.toKey), count: row.count }));
}

/* One full greedy walk over the selected quest pool: repeatedly farm the widest remaining
   post-cascade shortfall with that currency's selected quest (or best dropper in the pool) until
   nothing is short. */
function greedyFarmPlan(table, pool, ceCombosByQuestId = null) {
  const seed = greedyCandidate(table, pool);
  return seed ? finishFarmPlan(table, seed.runs, seed.state, seed.rawYields, ceCombosByQuestId) : null;
}

function greedyCandidate(table, pool) {
  return greedyFromStart(table, pool, { runs: {}, rawYields: {}, totalPlays: 0, apTotal: 0 });
}

function greedyFromStart(table, pool, start) {
  const runs = { ...start.runs };
  const rawYields = { ...start.rawYields };
  let totalPlays = start.totalPlays;
  let apTotal = start.apTotal;
  for (let guard = table.keys.length + 1; guard > 0; guard--) {
    const state = cascadeYields(table, rawYields);
    if (!hasShortfall(state.short)) {
      const cascadeSurplus = roundSurplus(state.final, table.deficits, table.keys);
      return { runs, state, rawYields, totalPlays, cascadeSurplus, apTotal };
    }
    const target = widestShortfall(state.short, table.keys);
    const options = pool.filter((quest) => count(quest.rates[target]) > 0);
    if (!options.length) return null;
    const pick = topUpQuest(options, target, table.selection[target]);
    const id = String(pick.meta.questId);
    const added = Math.max(1, Math.ceil(state.short[target] / pick.rates[target]));
    runs[id] = count(runs[id]) + added;
    addQuestYields(rawYields, pick, added);
    totalPlays += added;
    apTotal += added * count(pick.meta.ap);
  }
  return null;
}

function addQuestYields(yields, quest, runsOfQuest) {
  for (const [key, rate] of Object.entries(quest.rates)) {
    yields[key] = count(yields[key]) + runsOfQuest * rate;
  }
}

/* Shortfalls are micro integers: any positive one is real — there is no float noise left for an
   epsilon to hide. */
function hasShortfall(short) {
  return Object.values(short).some((value) => value > 0);
}

/* The widest shortfall is the currency the next runs should chase — the plan's "largest remaining
   deficit first". Ties go to the lower currency id so the walk is deterministic. */
function widestShortfall(short, keys) {
  let best = null;
  for (const key of keys) {
    const value = count(short[key]);
    if (value <= 0) continue;
    if (best === null) {
      best = key;
      continue;
    }
    const current = count(short[best]);
    const smallerId = Number(key) < Number(best);
    if (value > current || (value === current && smallerId)) best = key;
  }
  return best;
}

function bestRateQuest(options, target, rateOf = defaultRateOf) {
  return options.reduce((a, b) => {
    const rateA = rateOf(a, target);
    const rateB = rateOf(b, target);
    if (rateA !== rateB) return rateA > rateB ? a : b;
    return a.meta.questId <= b.meta.questId ? a : b;
  });
}

function defaultRateOf(quest, key) {
  return count(quest.rates[key]);
}

/* The quest a currency's shortfall farms with (Amendment M6): that currency's selected quest while
   the usable candidates still carry it, else the best rate among them. Neither the priority quest
   nor an all-covering quest is ever a candidate — the scan prices every use of the priority quest
   through its run count, and card-4 quests are excluded from top-ups altogether (Amendment N2), so
   a selection naming one of them falls back exactly as an absent one does. */
function topUpQuest(options, target, selectedId, rateOf = defaultRateOf) {
  const chosen =
    selectedId === null || selectedId === undefined
      ? null
      : options.find((quest) => String(quest.meta.questId) === String(selectedId));
  return chosen || bestRateQuest(options, target, rateOf);
}

function sumYields(runs, quests) {
  const yields = {};
  for (const quest of quests) {
    const runsOfQuest = count(runs[String(quest.meta.questId)]);
    if (runsOfQuest <= 0) continue;
    for (const [key, rate] of Object.entries(quest.rates)) yields[key] = count(yields[key]) + runsOfQuest * rate;
  }
  return yields;
}

/* Assemble one feasible plan. Internal figures are micro-units; the reported yields, farmed and
   surplus convert back to currency units. `state` is the FULL cascade the search priced coverage with;
   the reported trades, yields and surplus come from minCoverTrades over the same raw drops, so the card
   lists the minimum trades that cover each shortfall (Amendment R22) while `farmed` stays the raw drops.
   Two search-only figures ride along NON-ENUMERABLE so the tie-breaks keep pricing the plan exactly as
   the full cascade did — AP, and the cascade's own surplus (plan.surplus is what the player is shown,
   and must not steer which equal-run plan wins) — neither shows up in deepEqual, JSON, or the frozen
   output shape. */
function finishFarmPlan(table, runs, state, rawYields = sumYields(runs, table.quests), ceCombosByQuestId = null) {
  const cover = minCoverTrades(rawYields, table.deficits, table.chain, table.order);
  const plan = {
    plays: playsFromRuns(runs, table.quests, table.keys, ceCombosByQuestId),
    trades: cover.trades,
    yields: roundMap(cover.final, table.keys),
    farmed: roundMap(rawYields, table.keys),
    surplus: roundSurplus(cover.final, table.deficits, table.keys),
    totalPlays: Object.values(runs).reduce((sum, value) => sum + count(value), 0),
  };
  Object.defineProperty(plan, "apTotal", { value: runsAp(runs, table.quests), enumerable: false });
  const cascadeSurplus = roundSurplus(state.final, table.deficits, table.keys);
  Object.defineProperty(plan, "cascadeSurplus", { value: cascadeSurplus, enumerable: false });
  return plan;
}

function roundMap(finalMicro, keys) {
  const yields = {};
  for (const key of keys) yields[key] = unitsOf(finalMicro[key]);
  return yields;
}

/* surplus = final − deficit per currency, in whole micro-units until the print conversion — an
   exact integer gap can be negative on paper only when the mix genuinely is short. */
function roundSurplus(finalMicro, deficitsMicro, keys) {
  const surplus = {};
  for (const key of keys) surplus[key] = Math.max(0, unitsOf(count(finalMicro[key]) - count(deficitsMicro[key])));
  return surplus;
}

/* Plan figures are shown to two decimals; keeping raw search floats would only let 1e-12 noise flip
   a tie-break. */
function roundPlanFigure(value) {
  return Math.round(value * 1e6) / 1e6;
}

function runsAp(runs, quests) {
  return quests.reduce((sum, quest) => sum + count(runs[String(quest.meta.questId)]) * count(quest.meta.ap), 0);
}

/* "Quests to Play": most-ridden first, ties by quest id, each row carrying what the results card
   needs — the quest's own data-module figures, its run count, its main-drop currency (highest
   dropExpected×num on the plain figures, ties to the lower id) and whether it drops every shop
   currency (three icons, not one). */
function playsFromRuns(runs, quests, keys, ceCombosByQuestId = null) {
  return quests
    .filter((quest) => count(runs[String(quest.meta.questId)]) > 0)
    .map((quest) => ({
      questId: quest.meta.questId,
      questName: quest.meta.questName,
      recommendLv: quest.meta.recommendLv,
      runs: count(runs[String(quest.meta.questId)]),
      mainDropId: mainDropCurrencyId(quest),
      isAllDrop: keys.every((key) => Object.hasOwn(quest.rates, key)),
      ceCombo: (ceCombosByQuestId && ceCombosByQuestId.get(String(quest.meta.questId))) || [],
    }))
    .sort((a, b) => b.runs - a.runs || a.questId - b.questId);
}

function mainDropCurrencyId(quest) {
  const drops = quest.meta.drops || {};
  const keys = Object.keys(drops);
  if (!keys.length) return null;
  const top = keys.reduce((a, b) => (dropAmount(drops[a]) >= dropAmount(drops[b]) ? a : b));
  return Number(top);
}

function dropAmount(drop) {
  return count(drop.dropExpected) * count(drop.num);
}

/* Best farm plan over the user's selected quests across the currency cards and optional all-drop
   card: compute the greedy incumbent over that selected pool, then run exact search bounded by it. */
function bestFarmPlan(table, priorityQuestId) {
  const pool = nondominatedQuests(selectedPool(table, priorityQuestId));
  return bestFarmPlanForPool(table, pool);
}

function bestFarmPlanForPool(table, pool, ceCombosByQuestId = null) {
  if (!pool.length) return null;
  const greedy = greedyFarmPlan(table, pool, ceCombosByQuestId);
  return betterPlan(greedy, exactFarmPlan(table, pool, greedy, ceCombosByQuestId));
}

function selectedPool(table, priorityQuestId) {
  const picked = new Set();
  for (const key of table.keys) {
    if (table.deficits[key] <= 0) continue;
    const quest = selectedCurrencyQuest(table, key);
    if (quest) picked.add(quest);
  }
  const allDrop = selectedAllDropQuest(table, priorityQuestId);
  if (allDrop) picked.add(allDrop);
  return table.quests.filter((quest) => picked.has(quest));
}

function selectedCurrencyQuest(table, key) {
  const topUpOptions = table.topUps.filter((quest) => count(quest.rates[key]) > 0);
  const options = topUpOptions.length ? topUpOptions : table.quests.filter((quest) => count(quest.rates[key]) > 0);
  return options.length ? topUpQuest(options, key, table.selection[key]) : null;
}

function selectedAllDropQuest(table, priorityQuestId) {
  const id = priorityQuestId !== null && priorityQuestId !== undefined ? priorityQuestId : table.defaultAllDropId;
  if (id === null || id === undefined) return null;
  return table.quests.find((quest) => String(quest.meta.questId) === String(id)) || null;
}

/* Exact minimum-play search over the user-selected quest pool, tie-broken by least surplus then least AP. */
function exactFarmPlan(table, pool, incumbent, ceCombosByQuestId = null) {
  const kernel = buildExactKernel(table, pool);
  const bound = incumbent && incumbent.totalPlays !== null ? incumbent.totalPlays : MAX_PLAN_SCAN;
  const minTotal = minExactTotal(kernel, bound);
  const budget = { nodes: MAX_EXACT_SEARCH_NODES };
  for (let total = minTotal; total <= bound; total++) {
    if (!hopelessMix(kernel, 0, total, kernel.zeroYields, null)) {
      const best = searchExactTotal(kernel, total, budget);
      if (best) return finishExactPlan(table, pool, best, ceCombosByQuestId);
    }
    if (budget.nodes <= 0) return null;
  }
  return null;
}

function minExactTotal(kernel, bound) {
  let lo = 0;
  const cBest = kernel.cSuffixBest[0];
  for (let c = 0; c < kernel.cTargets.length; c++) {
    const rate = cBest[c];
    if (rate <= 0) return bound + 1;
    lo = Math.max(lo, Math.ceil(kernel.cTargets[c] / rate));
  }
  return lo;
}

/* A quest fully replayed by another (one at no more AP paying at least as much for everything the
   other pays, and more for at least one line) can never lower the minimum play count: every run of
   it swappable for a run of the replacer, and the cascade is monotone in yields. Same rule and
   order as the oracle's pool filter, so the searched space and its tie-broken winner match. */
function nondominatedQuests(pool) {
  return pool.filter((b) => positiveRateKeys(b).length > 0 && !pool.some((a) => a !== b && dominatesQuest(a, b)));
}

function dominatesQuest(a, b) {
  if (count(a.meta.ap) > count(b.meta.ap)) return false;
  const keysB = positiveRateKeys(b);
  if (!keysB.every((key) => count(a.rates[key]) >= b.rates[key])) return false;
  return keysB.some((key) => count(a.rates[key]) > b.rates[key]) || positiveRateKeys(a).length > keysB.length;
}

function positiveRateKeys(quest) {
  return Object.keys(quest.rates).filter((key) => count(quest.rates[key]) > 0);
}

/* One priced total: every composition of `total` runs across the pool, the front rows counted down
   and the last row absorbing the rest — the oracle's walk order — keeping the least-surplus,
   then least-AP covering mix. Each evaluated mix costs one budget node. */
function searchExactTotal(kernel, total, budget, baseState = null) {
  const rowCount = kernel.rates.length;
  const yields = baseState ? baseState.yields.slice() : kernel.zeroYields.slice();
  const cYields = baseState ? baseState.cYields.slice() : kernel.cTargets.map(() => 0);
  const runs = baseState ? baseState.runs.slice() : kernel.rates.map(() => 0);
  const offset = baseState ? 1 : 0;
  const remainingTotal = baseState ? total - baseState.fixedCount : total;
  if (remainingTotal < 0) return null;
  const walk = (row, left) => {
    if (row === rowCount - 1) return leafMix(kernel, yields, runs, row, left, budget, offset);
    const [lo, hi] = rowValueBounds(kernel, cYields, row, left);
    let winner = null;
    for (let value = hi; value >= lo && budget.nodes > 0; value--) {
      runs[row] = offset + value;
      applyRow(kernel, yields, cYields, row, value, 1);
      if (!hopelessMix(kernel, row + 1, left - value, yields, cYields))
        winner = betterMix(winner, walk(row + 1, left - value));
      applyRow(kernel, yields, cYields, row, value, -1);
      runs[row] = offset;
    }
    return winner;
  };
  return walk(0, remainingTotal);
}

function rowValueBounds(kernel, cYields, row, left) {
  let lo = 0;
  let hi = left;
  const rateA = kernel.cRates[row];
  const rateB = kernel.cSuffixBest[row + 1];
  const targets = kernel.cTargets;
  for (let c = 0; c < targets.length && lo <= hi; c++) {
    const need = targets[c] - cYields[c] - left * rateB[c];
    const diff = rateA[c] - rateB[c];
    if (diff > 0) {
      if (need > 0) lo = Math.max(lo, Math.ceil(need / diff));
    } else if (diff < 0) {
      if (need > 0) return [1, 0];
      hi = Math.min(hi, Math.floor(-need / -diff));
    } else if (need > 0) {
      return [1, 0];
    }
  }
  return [lo, hi];
}

function leafMix(kernel, yields, runs, row, left, budget, offset = 0) {
  runs[row] = offset + left;
  const base = kernel.rates[row];
  for (let position = 0; position < yields.length; position++) yields[position] += left * base[position];
  budget.nodes -= 1;
  const surplus = cascadeArrays(kernel, yields);
  const mix = surplus === null ? null : { runs: runs.slice(), surplus, ap: sumRunsAp(kernel, runs) };
  for (let position = 0; position < yields.length; position++) yields[position] -= left * base[position];
  runs[row] = offset;
  return mix;
}

function applyRow(kernel, yields, cYields, row, value, sign) {
  const delta = sign * value;
  const base = kernel.rates[row];
  for (let position = 0; position < yields.length; position++) yields[position] += delta * base[position];
  const cBase = kernel.cRates[row];
  for (let c = 0; c < cYields.length; c++) cYields[c] += delta * cBase[c];
}

/* Is a partial mix hopeless? Either a dual-cone trade-ratio inequality cannot be reached with the
   best remaining rates, or some currency deficit exceeds what reachable upstream sources can deliver. */
function hopelessMix(kernel, row, remaining, yields, cYields) {
  const cBest = kernel.cSuffixBest[row];
  const targets = kernel.cTargets;
  for (let c = 0; c < targets.length; c++) {
    const cur = cYields ? cYields[c] : 0;
    if (cur + remaining * cBest[c] < targets[c]) return true;
  }
  const best = kernel.suffixBest[row];
  for (let position = 0; position < kernel.deficits.length; position++) {
    const deficit = kernel.deficits[position];
    if (deficit <= 0) continue;
    let reachable = 0;
    const sources = kernel.upstream[position];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      reachable += yields[source] + remaining * best[source];
    }
    if (reachable < deficit) return true;
  }
  return false;
}

/* Same contract tie-break as betterPlan at one fixed total: least surplus first (micro integers —
   exact, so the oracle's ±0.5-micro noise window is a plain strict <), least AP next, and the mix
   reached first keeps its tie — exactly how the oracle keeps its walk's winner. */
function betterMix(current, next) {
  if (!next) return current;
  if (!current) return next;
  if (next.surplus !== current.surplus) return next.surplus < current.surplus ? next : current;
  return next.ap < current.ap ? next : current;
}

function sumRunsAp(kernel, runs) {
  return runs.reduce((sum, value, row) => sum + value * kernel.ap[row], 0);
}

/* Assemble the winning mix through the SHARED machinery (cascadeYields, finishFarmPlan) — the
   search's array twin only decides which mix wins, never what the plan reports. If the shared
   cascade sees a shortfall the twin somehow missed, the mix does not ship: greedy stays the
   answer rather than an unproven plan. */
function finishExactPlan(table, pool, best, ceCombosByQuestId = null) {
  const runs = {};
  pool.forEach((quest, row) => {
    if (best.runs[row] > 0) runs[String(quest.meta.questId)] = best.runs[row];
  });
  const rawYields = sumYields(runs, pool);
  const state = cascadeYields(table, rawYields);
  if (hasShortfall(state.short)) return null;
  return finishFarmPlan(table, runs, state, rawYields, ceCombosByQuestId);
}

/* The search kernel: the table's cascade expressed over indexed arrays in the shared node order.
   Same per-node math as cascadeYields (micro floor division, spend-up-the-chain), minus the object
   churn, because one mix is evaluated per node. */
function buildExactKernel(table, pool) {
  const nodes = table.order;
  const indexOf = new Map(nodes.map((key, position) => [key, position]));
  const edges = nodes.map((key) =>
    (table.chain[key] || []).map((trade) => ({
      to: indexOf.get(trade.toKey),
      cost: trade.costMicro,
      get: trade.getMicro,
    })),
  );
  const rates = pool.map((quest) => nodes.map((key) => count(quest.rates[key])));
  const deficits = nodes.map((key) => count(table.deficits[key]));
  const { cTargets, cRates, cSuffixBest } = buildLinearConstraints(nodes, edges, deficits, rates);
  return {
    nodes,
    zeroYields: nodes.map(() => 0),
    deficits,
    inflow: nodes.map(() => 0),
    final: nodes.map(() => 0),
    edges,
    rates,
    ap: pool.map((quest) => count(quest.meta.ap)),
    suffixBest: buildSuffixBest(rates, nodes.length),
    upstream: buildUpstream(nodes, edges),
    cTargets,
    cRates,
    cSuffixBest,
    surplusPositions: table.keys.map((key) => indexOf.get(key)).filter((position) => position !== undefined),
  };
}

const CONSTRAINT_SCALE = 1000;
const MAX_CONSTRAINT_NODES = 6;
const SAFE_TARGET_LIMIT = Math.floor(Number.MAX_SAFE_INTEGER / 8);

function gcdPair(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function buildLinearConstraints(nodes, edges, deficits, rates) {
  const n = nodes.length;
  const limit = 1 << Math.min(n, MAX_CONSTRAINT_NODES);
  const seen = new Set();
  const weightsList = [];
  const cTargets = [];
  for (let mask = 1; mask < limit; mask++) {
    const w = new Array(n).fill(0);
    for (let i = 0; i < n && i < MAX_CONSTRAINT_NODES; i++) {
      if (mask & (1 << i)) w[i] = CONSTRAINT_SCALE;
    }
    for (let u = n - 1; u >= 0; u--) {
      for (const edge of edges[u]) {
        if (edge.to > u && w[edge.to] > 0) {
          const req = Math.ceil((w[edge.to] * edge.get) / edge.cost);
          if (req > w[u]) w[u] = req;
        }
      }
    }
    const g = w.reduce((acc, val) => (val > 0 ? gcdPair(acc, val) : acc), 0);
    if (g <= 0) continue;
    for (let i = 0; i < n; i++) w[i] = Math.round(w[i] / g);
    const sig = w.join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    let target = 0;
    for (let i = 0; i < n; i++) target += w[i] * deficits[i];
    if (target <= 0 || target > SAFE_TARGET_LIMIT) continue;
    weightsList.push(w);
    cTargets.push(target);
  }
  const cRates = rates.map((rowRates) => weightsList.map((w) => rowRates.reduce((sum, r, i) => sum + w[i] * r, 0)));
  return {
    cTargets,
    cRates,
    cSuffixBest: buildSuffixBest(cRates, cTargets.length),
  };
}

/* suffixBest[row] = the best per-run rate per currency among pool rows row..end — the spare-run
   bound hopelessMix spends. */
function buildSuffixBest(rates, nodeCount) {
  const suffix = Array.from({ length: rates.length + 1 }, () => new Array(nodeCount).fill(0));
  for (let row = rates.length - 1; row >= 0; row--) {
    suffix[row] = suffix[row + 1].map((best, position) => Math.max(best, rates[row][position]));
  }
  return suffix;
}

/* Everything that can end up AT a currency through the trade chain, itself included — the
   upstream set the reachability bound converts at full value. */
function buildUpstream(nodes, edges) {
  return nodes.map((_, position) => {
    const set = new Set([position]);
    let grew = true;
    while (grew) {
      grew = false;
      edges.forEach((list, source) => {
        if (set.has(source)) return;
        for (const edge of list) {
          if (set.has(edge.to)) {
            set.add(source);
            grew = true;
            break;
          }
        }
      });
    }
    return [...set];
  });
}

/* The twin cascade over the yields vector, all in micro integers: settle nodes in table order,
   trading every unit above the deficit up the chain. Returns the summed surplus of the table's own
   currencies, or null when any node is left short — an exact integer gap, no tolerance, so a mix
   this accepts is a mix the oracle's integer replay covers. */
function cascadeArrays(kernel, yields) {
  cascadeIntoArrays(kernel, yields);
  const { deficits, final } = kernel;
  for (let position = 0; position < deficits.length; position++) {
    if (final[position] < deficits[position]) return null;
  }
  return kernel.surplusPositions.reduce((sum, position) => sum + Math.max(0, final[position] - deficits[position]), 0);
}

function cascadeIntoArrays(kernel, yields) {
  const inflow = kernel.inflow.fill(0);
  for (let position = 0; position < kernel.nodes.length; position++) {
    const avail = yields[position] + inflow[position];
    let free = avail - kernel.deficits[position];
    let spent = 0;
    for (const edge of kernel.edges[position]) {
      const times = Math.floor(Math.max(0, free) / edge.cost);
      if (times <= 0) continue;
      free -= times * edge.cost;
      spent += times * edge.cost;
      inflow[edge.to] += times * edge.get;
    }
    kernel.final[position] = avail - spent;
  }
}

/* The winner among equal-cost plans: fewer total plays first, then less total surplus, then less AP.
   A candidate that failed to cover anything never displaces a plan that did. The surplus compared is the
   FULL cascade's (Amendment R22 moved the reported plan.surplus to the minimum-cover figures; the search
   tie-break stays the cascade's, or equal-run plans would re-rank and every pinned play vector could
   move). */
function betterPlan(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.totalPlays !== current.totalPlays)
    return candidate.totalPlays < current.totalPlays ? candidate : current;
  const surplusDiff = surplusSum(tieBreakSurplus(candidate)) - surplusSum(tieBreakSurplus(current));
  if (Math.abs(surplusDiff) > SHORTFALL_EPS) return surplusDiff < 0 ? candidate : current;
  return (candidate.apTotal || 0) < (current.apTotal || 0) ? candidate : current;
}

/* The figure betterPlan ranks on: the search's own cascade surplus, falling back to the reported one for
   any plan the optimizer assembled without it (empty and infeasible plans never enter the ranking). */
function tieBreakSurplus(plan) {
  return plan.cascadeSurplus || plan.surplus;
}

function surplusSum(surplus) {
  return Object.values(surplus).reduce((sum, value) => sum + Math.max(0, value), 0);
}

function itemIndex(items) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id), item]));
}

/* A stored figure that is not a usable number is 0 — the same reading Validator gives an empty box. */
function count(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : 0;
}

function migratePlanBlob(saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { selectedEventId: null, plans: {} };
  if (saved.plans || !saved.eventId)
    return { selectedEventId: saved.selectedEventId ?? null, plans: saved.plans || {} };
  return { selectedEventId: saved.eventId, plans: { [String(saved.eventId)]: { requires: saved.requires } } };
}

function sanitizeEventPlan(plan, snapshot) {
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const eventId = snapshot.event.id;
  return {
    requires: EventShop.sanitizeRequires({ eventId, requires: (plan || {}).requires }, items, eventId),
    held: sanitizeCurrencyValues((plan || {}).held, snapshot.currencies, Schema.tier.Have),
    bonus: sanitizeCurrencyValues((plan || {}).bonus, snapshot.currencies, Schema.tier.Bonus),
    farmQuest: sanitizeFarmQuest((plan || {}).farmQuest, snapshot),
    currencyQuest: sanitizeCurrencyQuests((plan || {}).currencyQuest, snapshot),
    ceOwned: sanitizeCeOwned((plan || {}).ceOwned, snapshot.bonusCes),
    ceEquipLimit: EventShop.clampCeEquipLimit((plan || {}).ceEquipLimit),
  };
}

/* The 3-in-1 card's quest pick (Amendment L4): a saved id survives only if that event's farm list
   still carries the quest — ids from another event's snapshot are dead data. Anything else,
   including a saved null, re-defaults to the best all-covering quest, and an event with no
   all-covering quest has no plan pick at all (null → per-currency best everywhere). */
function sanitizeFarmQuest(saved, snapshot) {
  const quests = (snapshot.farm || {}).quests || [];
  const id = Number(saved);
  if (saved !== null && saved !== undefined && Number.isInteger(id) && quests.some((quest) => quest.questId === id)) {
    return id;
  }
  const currencyIds = (Array.isArray(snapshot.currencies) ? snapshot.currencies : []).map((currency) => currency.id);
  return EventShop.defaultFarmQuest(snapshot.farm || {}, currencyIds);
}

/* The cards 1-to-3 quest picks (Amendment M4, N2): a saved map keeps only entries keyed by one of
   this event's currencies, each run through the same drop-this-currency-and-not-all-covering rule
   the dropdown writer uses — a stale or all-covering pick re-defaults to that currency's best
   non-all-covering quest. A plan written before Amendment M carries no map at all: {} — and every
   card and the optimizer then read each currency's own default, exactly what the dropdown shows
   selected. */
function sanitizeCurrencyQuests(saved, snapshot) {
  const raw = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const currencies = Array.isArray(snapshot.currencies) ? snapshot.currencies : [];
  const currencyIds = currencies.map((currency) => currency.id);
  const keys = new Set(currencyIds.map((id) => String(id)));
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!keys.has(key)) continue;
    const choice = EventShop.sanitizedCurrencyQuest({
      farm: snapshot.farm || {},
      currencyIds,
      currencyKey: key,
      saved: value,
    });
    if (choice !== null) clean[key] = choice;
  }
  return clean;
}

/* Held and Bonus are keyed by CURRENCY id (Amendment H), so an event with two golds gives each one
   its own figures. A plan seeded before that amendment carries tier keys instead: those migrate
   through the same first-match rule the tier card applies (EventShop.currencyForTier), so a stored
   "gold" lands on the currency the tier card actually shows. Keys that are neither one of the
   event's currencies nor a migrating tier are dropped. Bounds come from the schema the box uses. */
function sanitizeCurrencyValues(value, currencies, schema) {
  const list = Array.isArray(currencies) ? currencies : [];
  const values = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const clean = {};
  for (const currency of list) {
    if (!currency) continue;
    const key = String(currency.id);
    clean[key] = Math.floor(Validator.validate(storedFigure(values, currency, list), schema));
  }
  return clean;
}

/* The currency's own key wins over a tier key that would migrate onto it, and a tier key only
   counts when currencyForTier resolves that tier to exactly this currency — a background that is
   not a tier ("zero" is QP) never had a stored figure, so only TIERS keys migrate. */
function storedFigure(values, currency, list) {
  const direct = values[String(currency.id)];
  if (direct !== undefined) return direct;
  if (!TIERS.includes(currency.background)) return undefined;
  const tierFigure = values[currency.background];
  if (tierFigure === undefined) return undefined;
  return EventShop.currencyForTier(list, currency.background) === currency ? tierFigure : undefined;
}

function pickSelectedEventId(savedId, snapshots) {
  const known = snapshots.some((snap) => snap.event.id === savedId);
  if (known) return savedId;
  return snapshots.length > 0 ? snapshots[0].event.id : null;
}

/* ===...=== Event Shop Bonus CE Combo Optimizer (domain-private) ===...=== */

const MAX_CE_BNB_NODES = 8000;
const MAX_CE_LEAF_EVALS = 1000;

function clampSchemaInteger(value, schema) {
  if (typeof value !== "number" && typeof value !== "string") return schema.default;
  if (typeof value === "string" && value.trim() === "") return schema.default;
  const num = Number(value);
  if (!Number.isFinite(num)) return schema.default;
  return Math.min(schema.max, Math.max(schema.min, Math.floor(num)));
}

function sanitizeCeOwned(saved, bonusCes) {
  const list = Array.isArray(bonusCes) ? bonusCes : [];
  const raw = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const clean = {};
  for (const ce of list) {
    if (!ce || ce.id === undefined || ce.id === null) continue;
    const key = String(ce.id);
    const entry = Object.hasOwn(raw, key) ? raw[key] : null;
    const obj = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    clean[key] = {
      limitBreak: EventShop.clampCeOwned(obj.limitBreak),
      nonLimitBreak: EventShop.clampCeOwned(obj.nonLimitBreak),
    };
  }
  return clean;
}

function normalizeBonusCes(bonusCes, ceOwned, equipLimit) {
  const ownedMap = ceOwned && typeof ceOwned === "object" && !Array.isArray(ceOwned) ? ceOwned : {};
  const normalized = [];
  for (const ce of Array.isArray(bonusCes) ? bonusCes : []) {
    if (!ce || ce.id === null || ce.id === undefined) continue;
    if (!ce.bonuses || typeof ce.bonuses !== "object" || Array.isArray(ce.bonuses)) continue;
    const key = String(ce.id);
    const entry = Object.hasOwn(ownedMap, key) ? ownedMap[key] : null;
    const obj = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const maxLB = Math.min(equipLimit, EventShop.clampCeOwned(obj.limitBreak));
    const maxNLB = Math.min(equipLimit, EventShop.clampCeOwned(obj.nonLimitBreak));
    if (maxLB <= 0 && maxNLB <= 0) continue;
    const bonuses = {};
    let hasBoost = false;
    for (const [cid, spec] of Object.entries(ce.bonuses)) {
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
      const lb = Math.max(0, count(spec.limitBreak));
      const nlb = Math.max(0, count(spec.nonLimitBreak));
      if (lb <= 0 && nlb <= 0) continue;
      bonuses[String(cid)] = { limitBreak: lb, nonLimitBreak: nlb };
      hasBoost = true;
    }
    if (hasBoost) normalized.push({ id: ce.id, maxLB, maxNLB, bonuses });
  }
  return normalized;
}

function microRateWithCe(drop, flatBonusRaw, ceBonus) {
  if (!drop) return 0;
  if (ceBonus <= 0) return micro(EventShop.dropPerRun(drop, flatBonusRaw));
  const flatBonus = Validator.validate(flatBonusRaw, Schema.tier.Bonus);
  return micro(count(drop.dropExpected) * (count(drop.num) + flatBonus + ceBonus));
}

function bestCeFarmPlan(table, priorityQuestId, normalizedCes, equipLimit) {
  const maxRatesByQuestId = buildMaxRatesByQuest(table.quests, table.bonus, normalizedCes, equipLimit);
  const selected = selectCePool(table, priorityQuestId, maxRatesByQuestId);
  if (!selected.length) return null;
  const usefulSet = usefulCurrencySet(table);
  const combosByQuest = selected.map((quest) =>
    buildQuestParetoCombos(quest, table.bonus, normalizedCes, equipLimit, usefulSet),
  );
  if (combosByQuest.every((list) => list.length <= 1)) {
    const fixedPool = selected.map((quest, index) => ({
      meta: quest.meta,
      rates: combosByQuest[index][0].rates,
    }));
    const ceCombos = new Map(
      selected.map((quest, index) => [String(quest.meta.questId), combosByQuest[index][0].ceCombo]),
    );
    return bestFarmPlanForPool(table, nondominatedQuests(fixedPool), ceCombos);
  }
  return solveCeBranchAndBound(table, selected, combosByQuest);
}

/* Currencies that can reach at least one positive deficit via the trade DAG; CEs boosting only
   non-useful currencies never shorten runs and must not win tie-breaks by inflating surplus. */
function usefulCurrencySet(table) {
  const nodes = table.order;
  const indexOf = new Map(nodes.map((key, pos) => [key, pos]));
  const edges = nodes.map((key) =>
    (table.chain[key] || [])
      .map((trade) => ({ to: indexOf.get(trade.toKey), cost: trade.costMicro, get: trade.getMicro }))
      .filter((edge) => edge.to !== undefined),
  );
  const upstream = buildUpstream(nodes, edges);
  const useful = new Set();
  for (let pos = 0; pos < nodes.length; pos++) {
    if (count(table.deficits[nodes[pos]]) <= 0) continue;
    for (const src of upstream[pos]) useful.add(nodes[src]);
  }
  return useful;
}

function buildMaxRatesByQuest(quests, bonus, normalizedCes, equipLimit) {
  const map = new Map();
  for (const quest of quests) {
    const maxRates = {};
    for (const key of Object.keys(quest.meta.drops || {})) {
      maxRates[key] = maxQuestCurrencyRate(quest, key, bonus[key], normalizedCes, equipLimit);
    }
    map.set(String(quest.meta.questId), maxRates);
  }
  return map;
}

function maxQuestCurrencyRate(quest, key, flatBonusRaw, normalizedCes, equipLimit) {
  const drop = quest.meta.drops ? quest.meta.drops[key] : null;
  if (!drop || !(count(drop.dropExpected) > 0)) return 0;
  const slots = [];
  for (const ce of normalizedCes) {
    const spec = ce.bonuses[key];
    if (!spec) continue;
    if (ce.maxLB > 0 && spec.limitBreak > 0) slots.push({ boost: spec.limitBreak, count: ce.maxLB });
    if (ce.maxNLB > 0 && spec.nonLimitBreak > 0) slots.push({ boost: spec.nonLimitBreak, count: ce.maxNLB });
  }
  slots.sort((a, b) => b.boost - a.boost);
  let ceBonus = 0;
  let left = equipLimit;
  for (const slot of slots) {
    if (left <= 0) break;
    const take = Math.min(left, slot.count);
    ceBonus += take * slot.boost;
    left -= take;
  }
  return microRateWithCe(drop, flatBonusRaw, ceBonus);
}

function selectCePool(table, priorityQuestId, maxRatesByQuestId) {
  const picked = new Set();
  const maxRateOf = (quest, key) => {
    const entry = maxRatesByQuestId.get(String(quest.meta.questId));
    return entry ? count(entry[key]) : 0;
  };
  for (const key of table.keys) {
    if (table.deficits[key] <= 0) continue;
    const topUpOptions = table.topUps.filter((quest) => maxRateOf(quest, key) > 0);
    const options = topUpOptions.length ? topUpOptions : table.quests.filter((quest) => maxRateOf(quest, key) > 0);
    if (options.length) picked.add(topUpQuest(options, key, table.selection[key], maxRateOf));
  }
  const allDrop = selectedAllDropQuest(table, priorityQuestId);
  if (allDrop) picked.add(allDrop);
  return table.quests.filter((quest) => picked.has(quest));
}

function buildQuestParetoCombos(quest, bonus, normalizedCes, equipLimit, usefulSet) {
  const drops = quest.meta.drops || {};
  const dropKeys = Object.keys(drops).filter((key) => drops[key] && count(drops[key].dropExpected) > 0);
  const usefulKeys = dropKeys.filter((key) => usefulSet.has(key));
  const relevant = [];
  for (const ce of normalizedCes) {
    const nlbVec = usefulKeys.map((key) => (ce.bonuses[key] ? ce.bonuses[key].nonLimitBreak : 0));
    const lbVec = usefulKeys.map((key) => (ce.bonuses[key] ? ce.bonuses[key].limitBreak : 0));
    if (nlbVec.some((value) => value > 0) || lbVec.some((value) => value > 0)) {
      relevant.push({ ce, nlbVec, lbVec });
    }
  }
  if (!relevant.length) return [{ rates: { ...quest.rates }, ceCombo: [] }];
  let states = [{ slots: 0, vec: usefulKeys.map(() => 0), vecSum: 0, lbTotal: 0, counts: relevant.map(() => [0, 0]) }];
  for (let i = 0; i < relevant.length; i++) {
    states = expandParetoStep(states, relevant[i], i, usefulKeys.length, equipLimit);
  }
  states.sort(compareParetoState);
  const pareto = [];
  for (const candidate of states) {
    if (!pareto.some((kept) => dominatesVec(kept.vec, candidate.vec))) pareto.push(candidate);
  }
  return pareto.map((state) => finalizeQuestCombo(drops, dropKeys, bonus, relevant, state));
}

function expandParetoStep(states, item, itemIdx, vecLen, equipLimit) {
  const options = [];
  for (let lb = 0; lb <= item.ce.maxLB; lb++) {
    for (let nlb = 0; nlb <= item.ce.maxNLB && lb + nlb <= equipLimit; nlb++) {
      const vec = new Array(vecLen);
      for (let k = 0; k < vecLen; k++) vec[k] = lb * item.lbVec[k] + nlb * item.nlbVec[k];
      options.push({ slots: lb + nlb, lb, nlb, vec });
    }
  }
  const byKey = new Map();
  for (const st of states) {
    for (const opt of options) {
      const nextSlots = st.slots + opt.slots;
      if (nextSlots > equipLimit) continue;
      let vecSum = 0;
      const vec = new Array(vecLen);
      for (let k = 0; k < vecLen; k++) {
        const val = st.vec[k] + opt.vec[k];
        vec[k] = val;
        vecSum += val;
      }
      const key = `${nextSlots}|${vec.join(",")}`;
      const lbTotal = st.lbTotal + opt.lb;
      const prev = byKey.get(key);
      if (
        !prev ||
        lbTotal > prev.lbTotal ||
        (lbTotal === prev.lbTotal && betterCePrefixCounts(st.counts, itemIdx, opt.lb, opt.nlb, prev.counts))
      ) {
        const counts = st.counts.slice();
        counts[itemIdx] = [opt.lb, opt.nlb];
        byKey.set(key, { slots: nextSlots, vec, vecSum, lbTotal, counts });
      }
    }
  }
  const sorted = [...byKey.values()].sort(compareParetoState);
  const pruned = [];
  for (const candidate of sorted) {
    if (!pruned.some((kept) => kept.slots <= candidate.slots && dominatesVec(kept.vec, candidate.vec))) {
      pruned.push(candidate);
    }
  }
  return pruned;
}

function dominatesVec(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false;
  }
  return true;
}

function compareParetoState(a, b) {
  if (b.vecSum !== a.vecSum) return b.vecSum - a.vecSum;
  if (a.slots !== b.slots) return a.slots - b.slots;
  if (b.lbTotal !== a.lbTotal) return b.lbTotal - a.lbTotal;
  return compareCeCounts(a.counts, b.counts);
}

function betterCePrefixCounts(prefixCounts, idx, lb, nlb, prevCounts) {
  for (let i = 0; i < idx; i++) {
    const sa = prefixCounts[i][0] + prefixCounts[i][1];
    const sb = prevCounts[i][0] + prevCounts[i][1];
    if (sa !== sb) return sa > sb;
    if (prefixCounts[i][0] !== prevCounts[i][0]) return prefixCounts[i][0] > prevCounts[i][0];
  }
  const curSlots = lb + nlb;
  const prevSlots = prevCounts[idx][0] + prevCounts[idx][1];
  if (curSlots !== prevSlots) return curSlots > prevSlots;
  return lb > prevCounts[idx][0];
}

function compareCeCounts(a, b) {
  for (let i = 0; i < a.length; i++) {
    const sa = a[i][0] + a[i][1];
    const sb = b[i][0] + b[i][1];
    if (sa !== sb) return sb - sa;
    if (a[i][0] !== b[i][0]) return b[i][0] - a[i][0];
  }
  return 0;
}

function finalizeQuestCombo(drops, dropKeys, bonus, relevant, state) {
  const ceCombo = [];
  for (let i = 0; i < relevant.length; i++) {
    const [lb, nlb] = state.counts[i];
    if (lb > 0 || nlb > 0) ceCombo.push({ ceId: relevant[i].ce.id, limitBreak: lb, nonLimitBreak: nlb });
  }
  const ceBonusByKey = {};
  for (let i = 0; i < relevant.length; i++) {
    const [lb, nlb] = state.counts[i];
    if (lb <= 0 && nlb <= 0) continue;
    for (const [cid, spec] of Object.entries(relevant[i].ce.bonuses)) {
      ceBonusByKey[cid] = (ceBonusByKey[cid] || 0) + lb * spec.limitBreak + nlb * spec.nonLimitBreak;
    }
  }
  const rates = {};
  for (const key of dropKeys) rates[key] = microRateWithCe(drops[key], bonus[key], ceBonusByKey[key] || 0);
  return { rates, ceCombo };
}

function nondominatedCeQuests(pool, combosByQuest) {
  const positiveCombos = combosByQuest.map((list) =>
    list.filter((combo) => Object.values(combo.rates).some((rate) => rate > 0)),
  );
  const keptQuests = [];
  const keptCombos = [];
  for (let bIdx = 0; bIdx < pool.length; bIdx++) {
    if (!positiveCombos[bIdx].length) continue;
    const questB = pool[bIdx];
    const dominated = pool.some((questA, aIdx) => {
      if (aIdx === bIdx || count(questA.meta.ap) > count(questB.meta.ap)) return false;
      return positiveCombos[bIdx].every((comboB) =>
        positiveCombos[aIdx].some((comboA) => dominatesComboRates(comboA.rates, comboB.rates)),
      );
    });
    if (!dominated) {
      keptQuests.push(questB);
      keptCombos.push(positiveCombos[bIdx]);
    }
  }
  return { pool: keptQuests, combosByQuest: keptCombos };
}

function dominatesComboRates(ratesA, ratesB) {
  const keysB = Object.keys(ratesB).filter((key) => count(ratesB[key]) > 0);
  if (!keysB.every((key) => count(ratesA[key]) >= count(ratesB[key]))) return false;
  const keysA = Object.keys(ratesA).filter((key) => count(ratesA[key]) > 0);
  return keysB.some((key) => count(ratesA[key]) > count(ratesB[key])) || keysA.length > keysB.length;
}

function solveCeBranchAndBound(table, rawPool, rawCombos) {
  const { pool, combosByQuest } = nondominatedCeQuests(rawPool, rawCombos);
  if (!pool.length) return null;
  if (combosByQuest.every((list) => list.length <= 1)) {
    const fixedPool = pool.map((quest, idx) => ({ meta: quest.meta, rates: combosByQuest[idx][0].rates }));
    const ceCombos = new Map(pool.map((quest, idx) => [String(quest.meta.questId), combosByQuest[idx][0].ceCombo]));
    return bestFarmPlanForPool(table, fixedPool, ceCombos);
  }
  const ctx = buildCeLpContext(table, pool, combosByQuest);
  const root = certifiedLpBound(ctx, [], ctx.allIndices);
  if (root.lb === Infinity) return null;
  let best = seedCeIncumbent(ctx, root);
  let nodeBudget = MAX_CE_BNB_NODES;
  let leafBudget = MAX_CE_LEAF_EVALS;

  const branch = (fixedPairs, undecidedQs, precomputedLp) => {
    if (nodeBudget <= 0) return;
    nodeBudget--;
    const lp = precomputedLp || certifiedLpBound(ctx, fixedPairs, undecidedQs);
    if (lp.lb === Infinity || (best && lp.lb > best.totalPlays)) return;
    if (!undecidedQs.length) {
      if (!fixedPairs.length || leafBudget <= 0) return;
      leafBudget--;
      const activeQuests = fixedPairs.map(({ qi, ci }) => ({
        meta: ctx.pool[qi].meta,
        rates: ctx.combosByQuest[qi][ci].rates,
        ceCombo: ctx.combosByQuest[qi][ci].ceCombo,
      }));
      best = betterPlan(best, exactCeLeafPlan(ctx.table, activeQuests, lp.lb, best));
      return;
    }
    const { pickQ, maxWeight, orderedCombos } = pickBranchQuest(ctx, undecidedQs, lp);
    const rest = undecidedQs.filter((qi) => qi !== pickQ);
    if (maxWeight > 1e-6) {
      for (const { ci } of orderedCombos) branch([...fixedPairs, { qi: pickQ, ci }], rest, null);
      branch(fixedPairs, rest, null);
    } else {
      branch(fixedPairs, rest, null);
      for (const { ci } of orderedCombos) branch([...fixedPairs, { qi: pickQ, ci }], rest, null);
    }
  };

  branch([], ctx.allIndices, root);
  return best;
}

function buildCeLpContext(table, pool, combosByQuest) {
  const nodes = table.order;
  const indexOf = new Map(nodes.map((key, pos) => [key, pos]));
  const scale = 1 / CURRENCY_MICRO;
  const edges = [];
  for (let fromPos = 0; fromPos < nodes.length; fromPos++) {
    for (const trade of table.chain[nodes[fromPos]] || []) {
      const toPos = indexOf.get(trade.toKey);
      if (toPos !== undefined && toPos > fromPos) {
        edges.push({
          fromPos,
          toPos,
          costMicro: trade.costMicro,
          getMicro: trade.getMicro,
          costUnit: trade.costMicro * scale,
          getUnit: trade.getMicro * scale,
        });
      }
    }
  }
  const baseRhs = nodes.map((key) => count(table.deficits[key]) * scale);
  const lpRates = combosByQuest.map((list) =>
    list.map((combo) => Float64Array.from(nodes, (key) => count(combo.rates[key]) * scale)),
  );
  return { table, pool, combosByQuest, nodes, edges, baseRhs, lpRates, allIndices: pool.map((_, idx) => idx) };
}

function seedCeIncumbent(ctx, root) {
  const picked = new Map();
  for (let j = 0; j < root.meta.length; j++) {
    const val = root.primal[j];
    if (val <= 1e-6) continue;
    const { qi, ci } = root.meta[j];
    const prev = picked.get(qi);
    if (!prev || val > prev.val) picked.set(qi, { ci, val });
  }
  let best = null;
  if (picked.size > 0) {
    const lpQuests = [...picked.entries()].map(([qi, { ci }]) => ({
      meta: ctx.pool[qi].meta,
      rates: ctx.combosByQuest[qi][ci].rates,
      ceCombo: ctx.combosByQuest[qi][ci].ceCombo,
    }));
    best = exactCeLeafPlan(ctx.table, lpQuests, root.lb, null);
  }
  const mainTarget = widestShortfall(ctx.table.deficits, ctx.table.keys);
  const greedyPool = ctx.pool.map((quest, qi) => {
    const chosen = ctx.combosByQuest[qi].reduce((a, b) =>
      count(b.rates[mainTarget]) > count(a.rates[mainTarget]) ? b : a,
    );
    return { meta: quest.meta, rates: chosen.rates, ceCombo: chosen.ceCombo };
  });
  const ceCombos = new Map(greedyPool.map((q) => [String(q.meta.questId), q.ceCombo]));
  const greedySeed = greedyFarmPlan(ctx.table, greedyPool, ceCombos);
  return betterPlan(best, greedySeed);
}

function pickBranchQuest(ctx, undecidedQs, lp) {
  const totalW = new Map(undecidedQs.map((qi) => [qi, 0]));
  const comboScores = new Map(undecidedQs.map((qi) => [qi, ctx.combosByQuest[qi].map((_, ci) => ({ ci, w: 0 }))]));
  for (let j = 0; j < lp.meta.length; j++) {
    const { qi, ci, fixed } = lp.meta[j];
    if (fixed) continue;
    const w = lp.primal[j];
    totalW.set(qi, totalW.get(qi) + w);
    comboScores.get(qi)[ci].w = w;
  }
  let pickQ = undecidedQs[0];
  let maxWeight = -1;
  for (const qi of undecidedQs) {
    const w = totalW.get(qi);
    if (w > maxWeight) {
      maxWeight = w;
      pickQ = qi;
    }
  }
  const orderedCombos = comboScores
    .get(pickQ)
    .slice()
    .sort((a, b) => b.w - a.w || a.ci - b.ci);
  return { pickQ, maxWeight, orderedCombos };
}

function certifiedLpBound(ctx, fixedPairs, undecidedQs) {
  const m = ctx.nodes.length;
  const rhs = ctx.baseRhs.slice();
  const cols = [];
  const meta = [];
  for (const { qi, ci } of fixedPairs) {
    const vec = ctx.lpRates[qi][ci];
    for (let i = 0; i < m; i++) rhs[i] -= vec[i];
    cols.push(vec);
    meta.push({ qi, ci, fixed: true });
  }
  for (const qi of undecidedQs) {
    const list = ctx.lpRates[qi];
    for (let ci = 0; ci < list.length; ci++) {
      cols.push(list[ci]);
      meta.push({ qi, ci, fixed: false });
    }
  }
  const nQuestCols = cols.length;
  if (nQuestCols === 0 && !ctx.edges.length) {
    return { lb: rhs.some((val) => val > 1e-9) ? Infinity : fixedPairs.length, primal: new Float64Array(0), meta };
  }
  const totalCols = nQuestCols + ctx.edges.length;
  const costs = new Float64Array(totalCols);
  costs.fill(1, 0, nQuestCols);
  const lp = solveMinLp(m, cols, ctx.edges, rhs, costs);
  if (lp.status === "infeasible") return { lb: Infinity, primal: new Float64Array(0), meta };
  if (lp.status !== "ok") return { lb: fixedPairs.length, primal: new Float64Array(nQuestCols), meta };
  const dualDot = certifiedDualDot(m, cols, nQuestCols, ctx.edges, lp.dual, rhs);
  const slack = 1e-9 * Math.max(1, Math.abs(dualDot));
  const lb = fixedPairs.length + Math.max(0, Math.ceil(dualDot - slack));
  return { lb, primal: lp.primal, meta };
}

function certifiedDualDot(m, questCols, nQuestCols, edges, rawDual, rhs) {
  const y = rawDual.slice();
  const edgesByFrom = Array.from({ length: m }, () => []);
  for (const edge of edges) edgesByFrom[edge.fromPos].push(edge);
  for (let pos = m - 1; pos >= 0; pos--) {
    for (const edge of edgesByFrom[pos]) {
      const req = (edge.getMicro / edge.costMicro) * y[edge.toPos] * (1 + 1e-11);
      if (req > y[pos]) y[pos] = req;
    }
  }
  let maxDot = 1;
  for (let j = 0; j < nQuestCols; j++) {
    let dot = 0;
    const col = questCols[j];
    for (let i = 0; i < m; i++) dot += y[i] * col[i];
    if (dot > maxDot) maxDot = dot;
  }
  const denom = maxDot * (1 + 1e-11);
  let dualDot = 0;
  for (let i = 0; i < m; i++) dualDot += (y[i] / denom) * rhs[i];
  return dualDot;
}

/* Two-Phase Simplex for min c^T x s.t. A x >= rhs, x >= 0 over the currency DAG (<=6 rows). */
function solveMinLp(m, questCols, edges, rhs, costs) {
  const k = questCols.length + edges.length;
  if (m === 0) return { status: "ok", primal: new Float64Array(k), dual: new Float64Array(0) };
  const slackCols = new Int32Array(m);
  const artCols = new Int32Array(m);
  const rowType = new Int8Array(m);
  const basis = new Int32Array(m);
  let nCols = k;
  for (let i = 0; i < m; i++) {
    if (rhs[i] <= 0) {
      rowType[i] = 0;
      slackCols[i] = nCols;
      basis[i] = nCols++;
    } else {
      rowType[i] = 1;
      slackCols[i] = nCols++;
    }
  }
  const firstArt = nCols;
  for (let i = 0; i < m; i++) {
    if (rowType[i] === 1) {
      artCols[i] = nCols;
      basis[i] = nCols++;
    } else {
      artCols[i] = -1;
    }
  }
  const stride = nCols + 1;
  const bCol = nCols;
  const tableau = new Float64Array((m + 2) * stride);
  fillLpTableau(tableau, m, stride, bCol, questCols, edges, rhs, costs, slackCols, artCols, rowType);
  const runner = makeSimplexRunner(tableau, m, stride, bCol, firstArt, basis);
  if (firstArt < nCols) {
    if (runner.run(m + 1, m + 2, nCols, false) !== "optimal") return { status: "failed" };
    if (-tableau[(m + 1) * stride + bCol] > 1e-6) return { status: "infeasible" };
    for (let i = 0; i < m; i++) {
      if (basis[i] < firstArt) continue;
      for (let j = 0; j < firstArt; j++) {
        if (Math.abs(tableau[i * stride + j]) > 1e-9) {
          runner.pivot(i, j, m + 2);
          break;
        }
      }
    }
  }
  if (runner.run(m, m + 1, firstArt, true) !== "optimal") return { status: "failed" };
  const primal = new Float64Array(k);
  const dual = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    if (basis[i] < k) primal[basis[i]] = Math.max(0, tableau[i * stride + bCol]);
  }
  const objRow = m * stride;
  for (let i = 0; i < m; i++) dual[i] = Math.max(0, tableau[objRow + slackCols[i]]);
  return { status: "ok", primal, dual };
}

function fillLpTableau(tableau, m, stride, bCol, questCols, edges, rhs, costs, slackCols, artCols, rowType) {
  const nQuest = questCols.length;
  for (let i = 0; i < m; i++) {
    const off = i * stride;
    const sign = rowType[i] === 0 ? -1 : 1;
    for (let j = 0; j < nQuest; j++) tableau[off + j] = sign * questCols[j][i];
    for (let eIdx = 0; eIdx < edges.length; eIdx++) {
      const edge = edges[eIdx];
      let coeff = 0;
      if (edge.fromPos === i) coeff -= edge.costUnit;
      if (edge.toPos === i) coeff += edge.getUnit;
      tableau[off + nQuest + eIdx] = sign * coeff;
    }
    if (rowType[i] === 0) {
      tableau[off + slackCols[i]] = 1;
      tableau[off + bCol] = -rhs[i];
    } else {
      tableau[off + slackCols[i]] = -1;
      tableau[off + artCols[i]] = 1;
      tableau[off + bCol] = rhs[i];
    }
  }
  const objRow = m * stride;
  const p1Row = (m + 1) * stride;
  for (let j = 0; j < costs.length; j++) tableau[objRow + j] = costs[j];
  for (let i = 0; i < m; i++) {
    if (rowType[i] !== 1) continue;
    tableau[p1Row + artCols[i]] = 1;
    const off = i * stride;
    for (let j = 0; j <= bCol; j++) tableau[p1Row + j] -= tableau[off + j];
  }
}

function makeSimplexRunner(tableau, m, stride, bCol, firstArt, basis) {
  const pivot = (r, c, activeRows) => {
    const rOff = r * stride;
    const inv = 1 / tableau[rOff + c];
    for (let j = 0; j <= bCol; j++) tableau[rOff + j] *= inv;
    tableau[rOff + c] = 1;
    for (let i = 0; i < activeRows; i++) {
      if (i === r) continue;
      const iOff = i * stride;
      const factor = tableau[iOff + c];
      if (Math.abs(factor) < 1e-14) continue;
      for (let j = 0; j <= bCol; j++) tableau[iOff + j] -= factor * tableau[rOff + j];
      tableau[iOff + c] = 0;
    }
    basis[r] = c;
  };
  const run = (costIdx, activeRows, maxCol, forbidArt) => {
    for (let iter = 0; iter < 600; iter++) {
      const cOff = costIdx * stride;
      const useBland = iter >= 40;
      let enter = -1;
      let bestRc = -1e-9;
      for (let j = 0; j < maxCol; j++) {
        if (forbidArt && j >= firstArt) continue;
        const rc = tableau[cOff + j];
        if (rc < -1e-9) {
          if (useBland) {
            enter = j;
            break;
          }
          if (rc < bestRc) {
            bestRc = rc;
            enter = j;
          }
        }
      }
      if (enter === -1) return "optimal";
      let leave = -1;
      let minRatio = Infinity;
      for (let i = 0; i < m; i++) {
        const a = tableau[i * stride + enter];
        if (a <= 1e-11) continue;
        const ratio = Math.max(0, tableau[i * stride + bCol]) / a;
        if (
          leave === -1 ||
          ratio < minRatio - 1e-12 ||
          (Math.abs(ratio - minRatio) <= 1e-12 && basis[i] < basis[leave])
        ) {
          minRatio = ratio;
          leave = i;
        }
      }
      if (leave === -1) return "unbounded";
      pivot(leave, enter, activeRows);
    }
    return "timeout";
  };
  return { pivot, run };
}

function exactCeLeafPlan(table, activeQuests, minTotalHint, incumbent) {
  if (!activeQuests.length) return null;
  const ceCombos = new Map(activeQuests.map((quest) => [String(quest.meta.questId), quest.ceCombo || []]));
  const greedy = greedyCeLeafPlan(table, activeQuests, ceCombos);
  const localBest = betterPlan(incumbent, greedy);
  const bound = localBest && localBest.totalPlays !== null ? localBest.totalPlays : MAX_PLAN_SCAN;
  const kernel = buildExactKernel(table, activeQuests);
  const baseState = buildFixedBaseState(kernel);
  const minTotal = Math.max(
    baseState.fixedCount,
    minTotalHint || baseState.fixedCount,
    minExactBaseTotal(kernel, baseState, bound),
  );
  const budget = { nodes: MAX_EXACT_SEARCH_NODES };
  let winner = greedy;
  for (let total = minTotal; total <= bound; total++) {
    const remaining = total - baseState.fixedCount;
    if (!hopelessMix(kernel, 0, remaining, baseState.yields, baseState.cYields)) {
      const mix = searchExactTotal(kernel, total, budget, baseState);
      if (mix) {
        winner = betterPlan(winner, finishExactPlan(table, activeQuests, mix, ceCombos));
        break;
      }
    }
    if (budget.nodes <= 0) break;
  }
  return winner;
}

function greedyCeLeafPlan(table, activeQuests, ceCombos) {
  const runs = {};
  const rawYields = {};
  let totalPlays = 0;
  let apTotal = 0;
  for (const quest of activeQuests) {
    const id = String(quest.meta.questId);
    runs[id] = 1;
    addQuestYields(rawYields, quest, 1);
    totalPlays += 1;
    apTotal += count(quest.meta.ap);
  }
  const seed = greedyFromStart(table, activeQuests, { runs, rawYields, totalPlays, apTotal });
  return seed ? finishFarmPlan(table, seed.runs, seed.state, seed.rawYields, ceCombos) : null;
}

function buildFixedBaseState(kernel) {
  const fixedCount = kernel.rates.length;
  const yields = kernel.zeroYields.slice();
  const cYields = kernel.cTargets.map(() => 0);
  const runs = kernel.rates.map(() => 1);
  for (let row = 0; row < fixedCount; row++) applyRow(kernel, yields, cYields, row, 1, 1);
  return { fixedCount, yields, cYields, runs };
}

function minExactBaseTotal(kernel, baseState, bound) {
  let lo = baseState.fixedCount;
  const cBest = kernel.cSuffixBest[0];
  for (let c = 0; c < kernel.cTargets.length; c++) {
    const deficit = kernel.cTargets[c] - baseState.cYields[c];
    if (deficit <= 0) continue;
    if (cBest[c] <= 0) return bound + 1;
    lo = Math.max(lo, baseState.fixedCount + Math.ceil(deficit / cBest[c]));
  }
  return lo;
}
