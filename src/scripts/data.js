import { TRAIT_DATA } from "./data/traits.js";
import { SERVANT_DATA } from "./data/servants.js";
import { CE_DATA } from "./data/craft_essences.js";
import { BOND_TABLES, BOND_TABLE_BY_SVT } from "./data/bond_growth.js";
import { IMAGE_VERSION } from "./constants.js";

/* Trait names lookup */
export const TraitNames = TRAIT_DATA || {};

/* CE data parsed from CE_DATA */
export const CEList = (() => {
  const map = CE_DATA || {};
  return Object.entries(map)
    .map(([id, data]) => {
      const isGroup = !!data.isGroup;
      const img = `craft_essences/${id}.webp?v=${IMAGE_VERSION}`;
      const name = data.name || `CE ${id}`;
      const base = {
        id,
        name,
        bonus: data.bonus || 0,
        supportBonus: data.supportBonus || 0,
        traits: Array.isArray(data.traits) ? data.traits : [],
        matchAll: !!data.matchAll,
        traitGroups: Array.isArray(data.traitGroups) ? data.traitGroups : [],
        alsoMatch: Array.isArray(data.alsoMatch) ? data.alsoMatch : [],
        isGroup,
        flatBonus: isGroup ? data.flatBonus || 0 : 0,
        image: img,
        thumbImage: img,
        _search: `${id}\n${name}`.toLowerCase(),
      };
      if (isGroup && data.options) {
        base.options = Object.entries(data.options).map(([optId, opt]) => {
          const optImg = `craft_essences/${optId}.webp?v=${IMAGE_VERSION}`;
          const optName = opt.name || `CE ${optId}`;
          return {
            id: optId,
            name: optName,
            image: optImg,
            thumbImage: optImg,
            _search: `${optId}\n${optName}`.toLowerCase(),
          };
        });
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
          image: `servants/${id}/000.webp?v=${IMAGE_VERSION}`,
          _search: `${id}\n${allNames.join("\n")}`.toLowerCase(),
        };

        if (id === "467" && optionNames && optionNames["001"]) {
          servant.altImage = `servants/${id}/001.webp?v=${IMAGE_VERSION}`;
          servant.altName = optionNames["001"];
        }

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
    return this.byId.get(id) || this.byId.get(String(id).split("-")[0]) || null;
  },

  /* Bond point cost per level: index i is the cost of Lv.i -> Lv.i+1 for this servant.
     Merged/split portraits ("467-1") share the base collection's table. Null when the data has none. */
  getBondGrowth(id) {
    const key = BOND_TABLE_BY_SVT[id] || BOND_TABLE_BY_SVT[String(id).split("-")[0]];
    return (key && BOND_TABLES[key]) || null;
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

  getTraitSetForAscension(id, ascension) {
    const servant = this.byId.get(id);
    if (!servant) return new Set();
    if (!servant.hasAscensions) return servant.traitSet;
    if (servant._ascTraitSets) {
      if (!ascension || !servant._ascTraitSets[ascension]) return servant.traitSet;
      return servant._ascTraitSets[ascension];
    }
    return new Set(this.getTraitsForAscension(id, ascension));
  },

  /* The traits of every form a servant has, in one list. A filter that does not choose an ascension — the
     party picker, which prices whichever form the player later puts in the slot — must read this and not
     `traits`: `traits` is the intersection of the stages, and four servants (415, 416, 444, 465) hold their
     sub-attribute only in a stage diff, so the base list names them no attribute at all. A card that does
     show one form still reads getTraitsForAscension, which says that form and nothing else. */
  getAllTraits(id) {
    const servant = this.byId.get(id);
    if (!servant) return [];
    if (!servant.hasAscensions) return servant.traits;
    if (!servant._allTraits) {
      const sets = servant._ascTraits ? Object.values(servant._ascTraits) : [];
      servant._allTraits = [...new Set([...servant.traits, ...sets.flat()])];
    }
    return servant._allTraits;
  },

  getAllTraitSet(id) {
    const servant = this.byId.get(id);
    if (!servant) return new Set();
    if (!servant.hasAscensions) return servant.traitSet;
    if (!servant._allTraitSet) {
      servant._allTraitSet = new Set(this.getAllTraits(id));
    }
    return servant._allTraitSet;
  },

  getEntryTraitSet(entry) {
    if (!entry) return new Set();
    const servantId = entry.servant ? entry.servant.id : entry.id;
    return entry.primaryAscension
      ? this.getTraitSetForAscension(servantId, entry.primaryAscension)
      : this.getAllTraitSet(servantId);
  },

  getEntryTraits(entry) {
    if (!entry) return [];
    const servantId = entry.servant ? entry.servant.id : entry.id;
    return entry.primaryAscension
      ? this.getTraitsForAscension(servantId, entry.primaryAscension)
      : this.getAllTraits(servantId);
  },

  resolveEntryDisplay(entry, rowCEs) {
    const servant = entry.servant;
    const matchedAscensions = entry.matchedAscensions || [];
    const imgAsc =
      !entry.baseMatchesAll && matchedAscensions.length > 0 ? entry.primaryAscension || matchedAscensions[0] : null;
    const imgSrc = imgAsc ? this.getImageForAscension(servant.id, imgAsc) : servant.image;
    const altImgSrc = !imgAsc && servant.altImage ? servant.altImage : null;
    const labelParts = matchedAscensions.map((key) => this.getAscensionLabel(servant.id, key));
    const spiritronLabel = this.getSpiritronLabel(servant.id, rowCEs, matchedAscensions, entry.baseMatchesAll);
    if (spiritronLabel) labelParts.push(spiritronLabel);
    const displayName = imgAsc ? this.getAscensionName(servant.id, imgAsc) || servant.name : servant.name;
    const altDisplayName = !imgAsc && servant.altName ? servant.altName : null;
    const fullName = labelParts.length > 0 ? `${displayName} (${labelParts.join(", ")})` : displayName;
    return { imgAsc, imgSrc, altImgSrc, displayName, altDisplayName, labelParts, fullName };
  },

  getImageForAscension(id, ascension) {
    return `servants/${id}/${ascension || "000"}.webp?v=${IMAGE_VERSION}`;
  },

  getAscensionOptions(id) {
    const servant = this.byId.get(id);
    if (!servant || !servant.hasAscensions) return [];
    const raw = servant.rawTraits;
    const standard = ["000", "001", "002"];
    const custom = Object.keys(raw).filter((k) => k !== "base" && !standard.includes(k));
    if (servant.optionLabels) {
      Object.keys(servant.optionLabels).forEach((k) => {
        if (!standard.includes(k) && k !== "000" && !custom.includes(k)) custom.push(k);
      });
    }
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

  /* A spiritron CE (trait 2780) sits in the base trait set, so it matches every
     standard ascension uniformly and never surfaces via a matched-ascension label.
     Append the spiritron costume name to the base group, but ONLY for costumes that
     are not already a trait-diff stage — those (444 "Earth President", 091 bunnies)
     render via their own stage group, so surfacing them again would duplicate.
     388 "Serious Mode" is label-only (no trait diff), so it needs this. */
  getSpiritronLabel(id, matchingCEs, matchedAscensions, baseMatchesAll) {
    const servant = this.byId.get(id);
    if (!servant || !servant.optionLabels) return "";
    const hasSpiritronCE = (matchingCEs || []).some(
      (ce) => (ce.traits || []).includes("2780") || (ce.traitGroups || []).some((group) => group.includes("2780")),
    );
    if (!hasSpiritronCE) return "";
    const ascKeys = matchedAscensions || [];
    if (!(baseMatchesAll || ascKeys.includes("000"))) return "";
    const stages = servant.rawTraits || {};
    return Object.entries(servant.optionLabels)
      .filter(([key]) => !stages[key])
      .map(([, name]) => name)
      .join("\n");
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
