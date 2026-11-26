import { CLASS_FILTERS, CLASS_GROUPS, ALIGNMENT_GBE_FILTERS } from "./constants.js";

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
    const { rarityFilters, aliFilters, subAliFilters, subAttrFilters, genderFilters, npTypeFilters, npEffectFilters } =
      filters;
    const classIds = this.effectiveClassIds(filters);

    const hasClass = classIds && classIds.length > 0;
    const hasRarity = rarityFilters && rarityFilters.length > 0;
    const hasAli = aliFilters && aliFilters.length > 0;
    const hasSubAli = subAliFilters && subAliFilters.length > 0;
    const hasSubAttr = subAttrFilters && subAttrFilters.length > 0;
    const hasGender = genderFilters && genderFilters.length > 0;
    const hasNpType = npTypeFilters && npTypeFilters.length > 0;
    const hasNpEffect = npEffectFilters && npEffectFilters.length > 0;

    if (!hasClass && !hasRarity && !hasAli && !hasSubAli && !hasSubAttr && !hasGender && !hasNpType && !hasNpEffect) {
      return () => true;
    }

    const classSet = hasClass ? new Set(classIds) : null;
    const raritySet = hasRarity ? new Set(rarityFilters) : null;
    const aliSet = hasAli ? new Set(aliFilters) : null;
    const subAliOther = hasSubAli && subAliFilters.includes(this.SUB_ALI_OTHER);
    const subAliSet = hasSubAli ? new Set(subAliFilters.filter((id) => id !== this.SUB_ALI_OTHER)) : null;
    const subAttrSet = hasSubAttr ? new Set(subAttrFilters) : null;
    const genderSet = hasGender ? new Set(genderFilters) : null;
    const npTypeSet = hasNpType ? new Set(npTypeFilters) : null;
    const npEffectSet = hasNpEffect ? new Set(npEffectFilters) : null;
    const gbeList = this.GBE;

    /* Intersection test against any collection (Set or Array); a missing collection never matches. */
    const hasAnyIn = (col, set) => {
      if (!col) return false;
      if (col instanceof Set) {
        for (const t of set) {
          if (col.has(t)) return true;
        }
        return false;
      }
      for (let i = 0; i < col.length; i++) {
        if (set.has(col[i])) return true;
      }
      return false;
    };

    return (traits, npTags) => {
      if (!traits) return false;
      const hasAny = (set) => !set || hasAnyIn(traits, set);

      if (classSet && !hasAny(classSet)) return false;
      if (raritySet && !hasAny(raritySet)) return false;
      if (aliSet && !hasAny(aliSet)) return false;
      if (subAttrSet && !hasAny(subAttrSet)) return false;
      if (genderSet && !hasAny(genderSet)) return false;
      // NP rows must be checked before the sub-alignment row: a matching Other chip returns true early.
      if (npTypeSet && !hasAnyIn(npTags, npTypeSet)) return false;
      if (npEffectSet && !hasAnyIn(npTags, npEffectSet)) return false;
      if (hasSubAli) {
        const isSet = traits instanceof Set;
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

  match(traits, filters = {}, npTags = null) {
    return this.compile(filters)(traits, npTags);
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
