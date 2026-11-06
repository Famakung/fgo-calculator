# Data Rules

## Exports
`src/scripts/data/*.js` export `const` — `TRAIT_DATA`, `SERVANT_DATA`, `CE_DATA`, `BOND_TABLES` + `BOND_TABLE_BY_SVT`. Imported by `src/scripts/data.js`, bundled by Astro/Vite. No `<script>` tags.

## Bond point tables (`bond_growth.js`)
- Atlas `bondGrowth` = **running total from bond 0**, not per-level cost: Altria's `[3000, 9125, 15250, …]` → Lv.0→1 costs 3,000, Lv.1→2 costs 9,125 − 3,000 = 6,125. `sync_bond_growth()` differences it, so shipped table is **per level step** — `table[i]` = cost standing at Lv.i needs to reach Lv.i+1. Never re-add totals.
- `BOND_TABLES`: `{ "tN": [16 ints] }` — 471 playable servants share only **76** distinct tables, each shape stored once
- `BOND_TABLE_BY_SVT`: `{ "002": "t1", … }` — servant key (zero-padding same as `SERVANT_DATA`) → table key
- Read via `ServantData.getBondGrowth(id)`, resolves split portraits (`"467-1"` → `"467"`); UI modules don't touch maps direct
- Levels: Current 0–15, Target 1–16 (`BOND_CONSTANTS.MIN_BOND_LEVEL` / `MAX_BOND_LEVEL`); surplus carries up to `BOND_CARRY_LIMIT` (10), discarded past bond cap. `BOND_BONUS_LEVEL` (15) pays +25% party bonus; Current Lv. select ticks "Bond ≥15" to match itself
- Written whole-file by `sync_bond_growth()` (runs with servant step, skipped by `--skip-servants`), gitignored like other generated data files, required by `scripts/ensure_data.js`, checked by `scripts/validate_data.js`: 16 positive ints per table, every key resolves, every `SERVANT_DATA` entry has a table
- `SERVANT_DATA` entries carry no bond field — maps keyed by servant id instead, so bond data changes never rewrite `servants.js`

## Trait IDs
- 4-digit zero-padded strings (`"0100"` = Saber, `"0002"` = Female)
- Longer for specials (`"2801200"` = Solomon)
- Prefixes: `0xxx`=gender, `01xx`=class, `02xx`=attribute, `03xx`=alignment, `04xx`=rarity, `26xx`/`27xx`/`28xx`=special (`"2883"` = Fate/stay night)

## SERVANT_DATA
- Keys: zero-padded ID strings (`"001"`, `"070"`, `"465"`)
- Simple: `"traits": ["0001", "0100", ...]` — flat sorted array
- Multi-ascension: `"traits": {"base": [...], "000": [...], "001": [...], "300": [...]}`
  - Standard keys: `"000"`, `"001"`, `"002"`
  - Custom keys: `"300"`, `"400"`, `"500"` (Spiritron Dresses/costumes)
  - Ascension arrays = **diff from base only** — merged at runtime
- **Sub-attribute overrides live outside `traits` in source**: Atlas stores servant's Heaven/Earth/Human/Star/Beast in `ascensionAdd.attribute.ascension` (keyed **1..4**, each stage says for itself); `sync_atlas_data.py` maps `sky/earth/human/star/beast` → `0200…0204` onto finished stage sets. 4 servants change with forms — 415 Alice human→earth, 465 Demeter heaven→star, 416 Hibiki & Chikagi earth→star, 444 U-Olga Marie star→human — their `base` (stage intersection) holds **no** `02xx`; each stage diff carries its own. Reader naming no form takes `ServantData.getAllTraits(id)` (union of every form, cached); card naming one form takes `getTraitsForAscension(id, ascension)` Individuality lists never contain attribute, and ids like `2011 skyOrEarthServant` or `2903 kuonjiAliceStage3` are skill-AI gate conditions `normalize_trait_id` drops on purpose
- `optionLabels`: display labels for non-standard ascensions (`{"300": "Piercing Bunny"}`)
  - **Two spiritron costume shapes**: (a) **stage costumes** — key in `traits` (e.g. `444` `{"300": ["0304"]}`) → Bond Gain CE renders as own stage-group label via `getAscensionLabel`; (b) **label-only costumes** — key in `optionLabels` but NOT in `traits` (e.g. `388` `{"300": "Serious Mode"}`) → surfaces only via `ServantData.getSpiritronLabel()` when spiritron CE (trait `2780`) matches base group
- `optionNames`: alternate names (`{"002": "Miyu Sakatsuki"}`)

## CE_DATA
- Keys: zero-padded CE ID strings (`"0330"`, `"1973"`, `"2509"`)
- Synced full from Atlas Academy API (`nice_equip_lang_en.json`) via `npm run data:sync`
- Simple CE: `{ "name": "...", "bonus": N, "traits": [...] }`
- `"supportBonus": N` — only when Atlas `followerVals` differs from `svals`: % essence pays when **borrowed support servant** wears it (0910 Chaldea Teatime: `bonus: 5`, `supportBonus: 15`). `SlotCEs.rate(ce, isSupport)` (`domain.js`) only place picking between the two; 0910 currently only bond CE carrying it
- Match modes:
  - Default (OR): servant needs ANY trait in `traits`
  - `"matchAll": true` (AND): servant needs ALL traits
  - `"traitGroups": [[...],[...]]` (AND-of-ORs): each group OR-matched, all groups required
  - `"alsoMatch": [...]`: instant match if servant has any listed trait; checked first
- Grouped CE (`isGroup: true`):
  - Auto-detected for campaign series variants sharing identical effect signatures (e.g. Heroic Portrait, Heroic Spirit Encounter, Heroic Spirit Apex)
  - `"flatBonus": N` or `"bonus": N`
  - `"folder": "XXXX-YYYY"`, `"groupImage": "XXXX"`
  - `"options": { "id": { "name": "..." } }`

## Adding Data
- Trait IDs: sort ascending in arrays
- Traits + display names auto-fetched and generated from Atlas Academy API (`export/NA/nice_trait.json` + NA CE skill brackets) via `npm run data:sync`
- Trait `0200` fixed and preserved as `"Heaven Attribute"` (matches official in-game NA status screen)
- New CE field → whitelist in `CEList` IIFE `src/scripts/data.js` (silently stripped otherwise)
- New servant field → handle in `ServantData.load()` `src/scripts/data.js`
- Images: `public/servants/{ID}/{ascension}.webp`, `public/craft_essences/...`

## Zero-Commit Architecture
- Game images (`public/servants/`, `public/craft_essences/`) + generated data (`src/scripts/data/*.js`) follow **Zero-Commit Architecture**:
  - Ignored in `.gitignore`, dir structure kept via `.gitkeep`.
  - In CI (`.github/workflows/deploy.yml`): restored in seconds via `actions/cache@v4`.
  - Local dev: `scripts/ensure_data.js` (`predev` / `prebuild` npm hooks) auto-generates missing data files on fresh clone.
  - Git repo stays 100% pure source code, zero asset bloat, zero data diff noise.

## Image Paths
- Servants: `public/servants/{ID}/{ascension}.webp` (142×155 WebP, bordered in-game card frame, e.g. `public/servants/001/000.webp`)
- CEs: `public/craft_essences/{ID}.webp` (142×155 bordered WebP, same for all display sizes)
- Icons: `public/icons/*.webp`, `public/icons/{category}/*.webp`
- Astro copies `public/` to `dist/` keeping paths — servant + CE image refs use relative URLs with `IMAGE_VERSION` cache-bust query param (e.g. `servants/001/000.webp?v=${IMAGE_VERSION}` — never literal number, `BaseLayout.astro`'s preload reads same constant)