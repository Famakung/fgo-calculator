import { TRAIT_DATA } from "./data/traits.js";
import { SERVANT_DATA } from "./data/servants.js";
import { CE_DATA } from "./data/craft_essences.js";

/* Trait names lookup */
export const TraitNames = TRAIT_DATA || {};

/* CE data parsed from CE_DATA */
export const CEList = (() => {
  const map = CE_DATA || {};
  return Object.entries(map)
    .map(([id, data]) => {
      const isGroup = !!data.isGroup;
      const base = {
        id,
        name: data.name || `CE ${id}`,
        bonus: data.bonus || 0,
        traits: Array.isArray(data.traits) ? data.traits : [],
        matchAll: !!data.matchAll,
        traitGroups: Array.isArray(data.traitGroups) ? data.traitGroups : [],
        alsoMatch: Array.isArray(data.alsoMatch) ? data.alsoMatch : [],
        isGroup,
        flatBonus: isGroup ? data.flatBonus || 0 : 0,
        image: `craft_essences/128/${id}.webp`,
        thumbImage: `craft_essences/64/${id}.webp`,
      };
      if (isGroup && data.options) {
        base.options = Object.entries(data.options).map(([optId, opt]) => ({
          id: optId,
          name: opt.name || `CE ${optId}`,
          image: `craft_essences/128/${optId}.webp`,
          thumbImage: `craft_essences/64/${optId}.webp`,
        }));
        const groupOpt = data.groupImage
          ? base.options.find((o) => o.id === data.groupImage)
          : base.options.find((o) => o.id === id) || base.options[0];
        if (groupOpt) {
          base.image = groupOpt.image;
          base.thumbImage = groupOpt.thumbImage;
        }
      }
      return base;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
})();

/* O(1) CE lookup by ID */
export const CEById = new Map(CEList.map((ce) => [ce.id, ce]));

/* Pre-computed list of trait-bearing CEs (cached once) */
export const TraitCEs = CEList.filter((ce) => ce.traits.length > 0 || ce.traitGroups.length > 0);

/* Servant data with performance optimizations */
export const ServantData = {
  servants: [],
  byId: new Map(),

  load() {
    const map = SERVANT_DATA || {};
    this.servants = Object.entries(map)
      .map(([id, data]) => {
        const name = typeof data === "string" ? data : data.name || "";
        const rawTraits = typeof data === "object" && data.traits ? data.traits : [];
        const isArray = Array.isArray(rawTraits);
        const traits = isArray ? rawTraits : rawTraits.base || [];
        const hasAscensions =
          !isArray && typeof rawTraits === "object" && Object.keys(rawTraits).some((k) => k !== "base");
        const optionLabels = typeof data === "object" && data.optionLabels ? data.optionLabels : {};
        const optionNames = typeof data === "object" && data.optionNames ? data.optionNames : {};

        // Pre-compute allNames (C4 optimization)
        const allNames = [name || `Servant ${id}`];
        if (optionNames) {
          Object.values(optionNames).forEach((n) => {
            if (!allNames.includes(n)) allNames.push(n);
          });
        }

        // Pre-compute traitSet (C2 optimization)
        const traitSet = new Set(traits);

        const servant = {
          id,
          name: name || `Servant ${id}`,
          traits,
          traitSet,
          allNames,
          rawTraits,
          hasAscensions,
          optionLabels,
          optionNames,
          image: `servants/${id}/000.webp`,
        };

        // Pre-compute ascension trait sets (C3 optimization)
        if (hasAscensions) {
          const base = rawTraits.base || [];
          const standard = ["000", "001", "002"];
          const allKeys = Object.keys(rawTraits).filter((k) => k !== "base");
          const custom = allKeys.filter((k) => !standard.includes(k));
          const ascTraits = {};
          const ascTraitSets = {};
          standard.forEach((k) => {
            const merged = [...base, ...(rawTraits[k] || [])];
            ascTraits[k] = merged;
            ascTraitSets[k] = new Set(merged);
          });
          custom.forEach((k) => {
            const merged = [...base, ...(rawTraits[k] || [])];
            ascTraits[k] = merged;
            ascTraitSets[k] = new Set(merged);
          });
          servant._ascTraits = ascTraits;
          servant._ascTraitSets = ascTraitSets;
        }

        return servant;
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    // Build byId Map (C1 optimization)
    this.byId = new Map(this.servants.map((s) => [s.id, s]));
  },

  getServant(id) {
    return this.byId.get(id) || null;
  },

  getTraitsForAscension(id, ascension) {
    const servant = this.byId.get(id);
    if (!servant) return [];
    if (!servant.hasAscensions) return servant.traits;
    if (servant._ascTraits) {
      if (!ascension || !servant._ascTraits[ascension]) return servant.traits;
      return servant._ascTraits[ascension];
    }
    const raw = servant.rawTraits;
    const base = raw.base || [];
    if (!ascension || !raw[ascension]) return base;
    return [...base, ...raw[ascension]];
  },

  getImageForAscension(id, ascension) {
    return `servants/${id}/${ascension || "000"}.webp`;
  },

  getAscensionOptions(id) {
    const servant = this.byId.get(id);
    if (!servant || !servant.hasAscensions) return [];
    const raw = servant.rawTraits;
    const standard = ["000", "001", "002"];
    const custom = Object.keys(raw).filter((k) => k !== "base" && !standard.includes(k));
    return [...standard, ...custom];
  },

  getAscensionLabel(id, key) {
    const LABELS = { "000": "1st Ascension", "001": "2nd Ascension", "002": "3rd Ascension" };
    if (LABELS[key]) return LABELS[key];
    const servant = this.byId.get(id);
    if (servant && servant.optionLabels && servant.optionLabels[key]) {
      return servant.optionLabels[key];
    }
    return key;
  },

  getAscensionName(id, ascension) {
    const servant = this.byId.get(id);
    if (!servant) return "";
    if (ascension && servant.optionNames && servant.optionNames[ascension]) {
      return servant.optionNames[ascension];
    }
    return servant.name;
  },

  getAllNames(id) {
    const servant = this.byId.get(id);
    return servant ? servant.allNames : [];
  },

  getDefaultAscension(servantId, slotAscension) {
    if (slotAscension) return slotAscension;
    const servant = this.byId.get(servantId);
    return servant && servant.hasAscensions ? "000" : null;
  },
};
