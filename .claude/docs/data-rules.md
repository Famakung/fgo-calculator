# Data Rules

## Exports
`src/scripts/data/*.js` export `const` — `TRAIT_DATA`, `SERVANT_DATA`, `CE_DATA`, `BOND_TABLES` + `BOND_TABLE_BY_SVT`. Imported by `src/scripts/data.js`, bundled by Astro/Vite. No `<script>` tags.

## Bond point tables (`bond_growth.js`)
- Atlas `bondGrowth` is a **running total from bond 0**, not a per-level cost: Altria's `[3000, 9125, 15250, …]` means Lv.0→1 costs 3,000 and Lv.1→2 costs 9,125 − 3,000 = 6,125. `sync_bond_growth()` differences it, so the shipped table is **per level step** — `table[i]` is what standing at Lv.i asks for to reach Lv.i+1. Never re-add the totals.
- `BOND_TABLES`: `{ "tN": [16 ints] }` — 471 playable servants share only **76** distinct tables, so each shape is stored once
- `BOND_TABLE_BY_SVT`: `{ "002": "t1", … }` — servant key (same zero-padding as `SERVANT_DATA`) → table key
- Read it through `ServantData.getBondGrowth(id)`, which resolves split portraits (`"467-1"` → `"467"`); UI modules do not touch the maps directly
- Levels: Current 0–15, Target 1–16 (`BOND_CONSTANTS.MIN_BOND_LEVEL` / `MAX_BOND_LEVEL`); surplus carries up to `BOND_CARRY_LIMIT` (10) and is discarded past the bond cap. `BOND_BONUS_LEVEL` (15) is the level that pays the +25% party bonus, and the Current Lv. select ticks "Bond ≥15" to match itself
- Written whole-file by `sync_bond_growth()` (runs with the servant step, skipped by `--skip-servants`), gitignored like every other generated data file, required by `scripts/ensure_data.js`, and checked by `scripts/validate_data.js`: 16 positive integers per table, every key resolves, every `SERVANT_DATA` entry has a table
- `SERVANT_DATA` entries carry no bond field — the maps are keyed by servant id instead, so changing bond data never rewrites `servants.js`

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
- `optionLabels`: display labels for non-standard ascensions (`{"300": "Piercing Bunny"}`)
  - **Two spiritron costume shapes**: (a) **stage costumes** — key appears in `traits` (e.g. `444` `{"300": ["0304"]}`) → Bond Gain CE renders it as its own stage-group label via `getAscensionLabel`; (b) **label-only costumes** — key appears in `optionLabels` but NOT in `traits` (e.g. `388` `{"300": "Serious Mode"}`) → surfaces only via `ServantData.getSpiritronLabel()` when a spiritron CE (trait `2780`) matches the base group
- `optionNames`: alternate names (`{"002": "Miyu Sakatsuki"}`)

## CE_DATA
- Keys: zero-padded CE ID strings (`"0330"`, `"1973"`, `"2509"`)
- Fully synchronized from Atlas Academy API (`nice_equip_lang_en.json`) via `npm run data:sync`
- Simple CE: `{ "name": "...", "bonus": N, "traits": [...] }`
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
- Traits and display names are automatically fetched and generated from the Atlas Academy API (`export/NA/nice_trait.json` and NA CE skill brackets) via `npm run data:sync`
- Trait `0200` is officially designated and preserved as `"Heaven Attribute"` (matching official in-game NA status screen)
- New CE field → whitelist in `CEList` IIFE `src/scripts/data.js` (silently stripped otherwise)
- New servant field → handle in `ServantData.load()` `src/scripts/data.js`
- Images: `public/servants/{ID}/{ascension}.webp`, `public/craft_essences/...`

## Zero-Commit Architecture
- Both game images (`public/servants/`, `public/craft_essences/`) and generated data (`src/scripts/data/*.js`) follow a **Zero-Commit Architecture**:
  - Fully ignored in `.gitignore`, with directory structures preserved via `.gitkeep`.
  - In CI (`.github/workflows/deploy.yml`): Restored in seconds via `actions/cache@v4`.
  - In local development: `scripts/ensure_data.js` (`predev` / `prebuild` npm hooks) auto-generates missing data files on a fresh clone.
  - The git repository remains 100% pure source code with zero asset bloat and zero data diff noise.

## Image Paths
- Servants: `public/servants/{ID}/{ascension}.webp` (142×155 WebP, bordered in-game card frame, e.g. `public/servants/001/000.webp`)
- CEs: `public/craft_essences/{ID}.webp` (142×155 bordered WebP, unified for all display sizes)
- Icons: `public/icons/*.webp`, `public/icons/{category}/*.webp`
- Astro copies `public/` to `dist/` preserving paths — all servant and CE image references use relative URLs with `IMAGE_VERSION` cache busting query parameter (e.g. `servants/001/000.webp?v=2`)