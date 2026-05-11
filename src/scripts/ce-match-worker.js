/* Worker-side TraitMatcher (inlined, no imports) */
const TraitMatcher = {
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

let _servants = null;
let _traitCEs = null;
let _traitNames = null;

self.onmessage = function (e) {
  const { type } = e.data;

  if (type === "init") {
    _servants = e.data.servants;
    _traitCEs = e.data.traitCEs;
    _traitNames = e.data.traitNames;
    return;
  }

  if (type === "compute") {
    const { results, ceMatchEntriesIndex } = computeAllCEMatches();
    self.postMessage({ type: "result", results, index: ceMatchEntriesIndex });
  }
};

function computeAllCEMatches() {
  const traitCEs = _traitCEs;
  const relevantTraitIds = new Set();
  traitCEs.forEach((ce) => {
    ce.traits.forEach((t) => relevantTraitIds.add(t));
    ce.traitGroups.forEach((group) => group.forEach((t) => relevantTraitIds.add(t)));
  });

  const results = [];

  _servants.forEach((servant) => {
    const traitSets = TraitMatcher.getAllTraitSets(servant);

    if (!servant.hasAscensions) {
      const matchingCEs = traitCEs.filter((ce) => TraitMatcher.matches(servant.traitSet, ce));

      const relevantTraits = servant.traits.filter((t) => relevantTraitIds.has(t)).map((t) => _traitNames[t] || t);

      results.push({
        servant,
        matchingCEs,
        allTraitNames: relevantTraits,
        matchedAscensions: [],
        baseMatchesAll: true,
        matchingCEIds: [...matchingCEs.map((c) => c.id)],
      });
    } else {
      const ascResults = traitSets.map((set) => ({
        key: set.key,
        traits: set.traits,
        matchingCEs: traitCEs.filter((ce) => TraitMatcher.matches(set.traitSet, ce)),
      }));

      const groups = new Map();
      ascResults.forEach((ar) => {
        const key = ar.matchingCEs
          .map((c) => c.id)
          .sort()
          .join(",");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ar);
      });

      const nonEmptyGroups = [...groups.entries()].filter(([_, entries]) => entries[0].matchingCEs.length > 0);
      if (nonEmptyGroups.length === 0) {
        results.push({
          servant,
          matchingCEs: [],
          allTraitNames: [],
          matchedAscensions: [],
          baseMatchesAll: true,
          matchingCEIds: [],
        });
        return;
      }

      if (nonEmptyGroups.length === 1) {
        const entries = nonEmptyGroups[0][1];
        const matchingCEs = entries[0].matchingCEs;
        const mergedTraits = [...new Set(entries.flatMap((e) => e.traits))];
        const relevantTraits = mergedTraits.filter((t) => relevantTraitIds.has(t)).map((t) => _traitNames[t] || t);

        results.push({
          servant,
          matchingCEs,
          allTraitNames: relevantTraits,
          matchedAscensions: [],
          baseMatchesAll: true,
          matchingCEIds: [...matchingCEs.map((c) => c.id)],
        });
      } else {
        nonEmptyGroups.forEach(([_, entries]) => {
          const matchingCEs = entries[0].matchingCEs;
          const ascKeys = entries.map((e) => e.key);
          const mergedTraits = [...new Set(entries.flatMap((e) => e.traits))];
          const relevantTraits = mergedTraits.filter((t) => relevantTraitIds.has(t)).map((t) => _traitNames[t] || t);

          results.push({
            servant,
            matchingCEs,
            allTraitNames: relevantTraits,
            matchedAscensions: ascKeys,
            baseMatchesAll: false,
            primaryAscension: ascKeys[0],
            matchingCEIds: [...matchingCEs.map((c) => c.id)],
          });
        });
      }
    }
  });

  /* Build CE->entry index */
  const ceMatchEntriesIndex = {};
  results.forEach((entry, idx) => {
    entry.matchingCEs.forEach((ce) => {
      if (!ceMatchEntriesIndex[ce.id]) ceMatchEntriesIndex[ce.id] = [];
      ceMatchEntriesIndex[ce.id].push(idx);
    });
  });

  return { results, ceMatchEntriesIndex };
}
