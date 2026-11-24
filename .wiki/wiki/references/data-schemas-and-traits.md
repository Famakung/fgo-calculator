---
title: "Data Schemas and Traits"
category: reference
sources:
  - raw/notes/2026-11-24-legacy-data-rules.md
  - raw/notes/2026-11-24-legacy-fetch-data-guideline.md
created: 2026-11-24
updated: 2026-11-24
tags: [data-schemas, trait-ids, servant-data, ce-data, bond-growth, event-shop, asset-paths]
aliases: [SERVANT_DATA Schema, CE_DATA Schema, Trait ID Conventions]
confidence: high
volatility: warm
summary: "Reference specification for FGO Calculator's generated datasets (TRAIT_DATA, SERVANT_DATA, CE_DATA, BOND_TABLES, EVENT_SHOP_DATA), 4-digit zero-padded trait IDs, ascension/costume diff encoding, Craft Essence match modes, and local WebP asset paths."
---

# Data Schemas and Traits

> Generated modules in `src/scripts/data/*.js` export immutable `const` datasets bundled directly by Vite/Rolldown and read through `src/scripts/data.js` (or `event-lazy` modules for `EVENT_SHOP_DATA`).

## Trait ID Conventions (`TRAIT_DATA`)

Trait IDs are **4-digit zero-padded strings** sorted ascending in arrays (longer digit strings exist for special IDs such as `"2801200"` for Solomon):

| Prefix | Meaning | Notes |
|--------|---------|-------|
| `0xxx` | Gender | e.g., `"0002"` Female |
| `01xx` | Class | e.g., `"0100"` Saber |
| `02xx` | Sub-attribute | `"0200"` (`Heaven Attribute`, preserved per official NA screen) through `"0204"` (`sky`/`earth`/`human`/`star`/`beast`) |
| `03xx` | Alignment | Lawful/Neutral/Chaotic & Good/Balanced/Evil |
| `04xx` | Rarity | `0400`–`0405` (★0–★5) |
| `26xx`–`28xx` | Special traits | Series/event/lore tags (e.g., `"2883"` Fate/stay night, `"2821"` Beast Servants) |

Display names come from Atlas `export/NA/nice_trait.json` plus bracketed trait text extracted from NA CE skill descriptions.

## `SERVANT_DATA` (`servants.js`)

Keyed by Atlas servant ID strings (e.g., `"800100"`, `"100100"`, `"505600"`), carrying `collectionNo` (in-game short ID) and handled via `ServantData.load()` in `src/scripts/data.js`:

- **Flat vs multi-ascension `traits`**:
  - Simple servants store a flat sorted array (`"traits": ["0001", "0100", ...]`).
  - Multi-ascension servants store `{"base": [...], "000": [...], "001": [...], "002": [...], "300": [...]}` where `base` is the stage intersection and stage keys (`000`/`001`/`002`, plus costumes `300`/`400`/`500`) store **only diffs from `base`**, merged at runtime.
- **Sub-attribute overrides (`ascensionAdd.attribute.ascension`)**: Atlas stores stage-varying attributes outside `traits` (keyed `1..4`). `sync_atlas_data.py` maps these onto finished stage sets (`0200`–`0204`). Four servants change attribute by stage (`415` Alice, `416` Hibiki & Chikagi, `444` U-Olga Marie, `465` Demeter), so their `base` holds no `02xx` entry. `normalize_trait_id` intentionally drops skill-AI gate IDs such as `2011` (`skyOrEarthServant`) and `2903` (`kuonjiAliceStage3`).
- **Permanent `traitAdd` merges**: `extract_servant_traits()` merges always-on entries (`condType == "none"`, `eventId == 0`, `id > 1000`) into `base` and all stage sets. Requiring `id > 1000` excludes Mash's per-class-form rarity entries (`idx` = classId). This delivers `"2821"` (`Beast Servants`) to 22 servants including `314`/`334` Koyanskaya and `238` Kingprotea.
- **Spiritron dresses (`optionLabels`)**:
  - *Stage costumes* have a key in `traits` (e.g., `444` `{"300": ["0304"]}`) and render as their own stage group via `getAscensionLabel`.
  - *Label-only costumes* appear in `optionLabels` without a `traits` key (e.g., `388` `{"300": "Serious Mode"}`) and surface via `ServantData.getSpiritronLabel()` when a Spiritron CE (trait `2780`) matches the base group.
- **Alternate names & dual-persona servants**: `optionNames` maps stage keys to alternate names (`{"001": "Francesca Prélat"}`). Servant `467` merges into unified entry `"505600"` (`collectionNo: 467`, `altId: "505700"`) with swap portrait `505700/000.webp` rendered via `DOMFactory.createSwapImg` and `DOMFactory.fillSwapName`.

## `CE_DATA` (`craft_essences.js`)

Keyed by Atlas equip ID strings (e.g., `"9400970"`, `"9403520"`), filtered at load time by the **`CEList` field whitelist IIFE** in `src/scripts/data.js` (any new field added to `craft_essences.js` must be whitelisted there or it is silently stripped):

- **Simple CE**: `{ name, collectionNo, bonus, traits, ... }` (or `flatBonus`).
- **`supportBonus`**: Present only when Atlas `followerVals` differs from `svals` (e.g., `"9403520"` Chaldea Teatime: `bonus: 5`, `supportBonus: 15`). `SlotCEs.rate(ce, isSupport)` in `domain.js` selects between them for borrowed support slots.
- **Trait match modes**:
  - Default (OR): servant has any trait in `traits`.
  - `matchAll: true` (AND): servant must hold all listed traits.
  - `traitGroups: [[...], [...]]` (AND-of-ORs): each inner group is OR-matched; all groups required.
  - `alsoMatch: [...]`: instant match shortcut checked before standard modes.
- **Grouped series CEs (`isGroup: true`)**: Auto-detected for commemorative series sharing identical effect signatures (e.g., Heroic Portrait, Heroic Spirit Encounter, Heroic Spirit Apex), storing `collectionNo` (first variant), `bonus` or `flatBonus`, `folder`, `groupImage`, and `options: { [id]: { name, collectionNo } }`.

## `bond_growth.js` and `EVENT_SHOP_DATA` (`event_shop.js`)

- **`bond_growth.js`**: Exports `BOND_TABLES` (`{ "tN": [16 ints] }`) and `BOND_TABLE_BY_SVT` (`{ "100100": "t1", ... }`), read solely via `ServantData.getBondGrowth(id)`. Atlas `bondGrowth` is a **running total from bond 0**; `sync_bond_growth()` differences consecutive values so `table[i]` is the per-step cost from Lv.`i` to Lv.`i+1` (collapsing 471 playable servants into 76 shared tables, ~18 KB vs ~56 KB). `SERVANT_DATA` carries no bond field so bond updates never rewrite `servants.js`. Validated for 16 positive integers per table and complete servant coverage (`0–15` current, `1–16` target, `BOND_CARRY_LIMIT = 10`, `BOND_BONUS_LEVEL = 15`).
- **`EVENT_SHOP_DATA` (`event_shop.js`)**: `{ events: [{ event: { id, name, shortName, startedAt, endedAt }, currencies: [{ id, name, background, icon }], items: [{ id, name, purchaseType, cost: { itemId, amount }, limitNum, setNum, priority, icon }], farm: { quests: [{ questId, questName, recommendLv, ap, sampleRuns, drops: { [currencyId]: { dropExpected, num } } }], best: { [currencyId]: questId } }, trades: [{ fromId, toId, costAmount, getNum }], bonusCes: [{ id, name, rarity, icon, bonuses: { [currencyId]: { nonLimitBreak, limitBreak } } }] }] }`. `limitNum: 0` means unlimited; `background` uses Atlas tier strings (`gold`/`silver`/`bronze`/`zero`...) with CSS `:where()` fallback; empty snapshots emit `{ events: [] }`.

## Local Asset Paths and Cache-Busting

Servant and CE images append `?v=${IMAGE_VERSION}` from `constants.js` (also injected into `BaseLayout.astro` head preloads via `define:vars={{ v: IMAGE_VERSION }}`):

| Asset Type | Path Pattern (under `public/`) | Format & Sizing |
|------------|-------------------------------|-----------------|
| Servant faces | `servants/{atlasId}/{stage}.webp`, `c_{costume_key}.webp` | `142×155` bordered WebP (`quality=90, method=6`) |
| Saint Graphs | `saint_graphs/{file}.webp` | `512×724` lossless WebP (`lossless=True, method=6`) |
| Skill icons | `skill_icons/skill_{id}.webp` | Lossless WebP (`32×32px` display) |
| Craft Essences | `craft_essences/{atlasId}.webp` | `142×155` bordered WebP (unified across portraits and badges) |
| Event shop icons | `event_shop/{kind}_{id}.webp` | `kind`: `item` (`≤160px` native), `equip` (`142×155`), `costume` (`142×155`), lossless WebP |
| Servant Info JSON | `servant_info/{atlasId}.json` | Static per-servant JSON (`_FORBIDDEN_KEYS` stripped) |
| Static UI icons | `icons/*.webp`, `icons/{category}/*.webp` | Tracked WebP icons (`bond_icon`, `teapot`, `100_bordered`, `classes/`) |

## See Also

- [[atlas-academy-fetch-reference|Atlas Academy Fetch Reference]] ([Atlas Academy Fetch Reference](../references/atlas-academy-fetch-reference.md)) — API endpoints, `sync_atlas_data.py` CLI, and converter rules
- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — gitignore, `ensure_data.js`, `validate_data.js`, and CI caching
- [[bond-gain-ce-and-filters|Bond Gain CE and Filters]] ([Bond Gain CE and Filters](../topics/bond-gain-ce-and-filters.md)) — how trait match modes and ascension traits drive filtering
- [[bond-calculator|Bond Calculator]] ([Bond Calculator](../topics/bond-calculator.md)) — `SlotCEs` and `BondLevelCalculator` consumption of `bond_growth.js`
- [[event-shop-calculator|Event Shop Calculator]] ([Event Shop Calculator](../topics/event-shop-calculator.md)) — consumption of `EVENT_SHOP_DATA`

## Sources

- [Data Schemas and Trait Rules](../../raw/notes/2026-11-24-legacy-data-rules.md) — complete schemas for traits, servants, CEs, bond tables, event shops, and asset paths
- [Atlas Academy Data Fetch and Sync Guideline](../../raw/notes/2026-11-24-legacy-fetch-data-guideline.md) — `traitAdd` extraction rules, `bondGrowth` differencing, and event shop data generation
