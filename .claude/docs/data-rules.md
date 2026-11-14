# Data Rules

## Exports
`src/scripts/data/*.js` export `const` — `TRAIT_DATA`, `SERVANT_DATA`, `CE_DATA`, `BOND_TABLES` + `BOND_TABLE_BY_SVT`, `EVENT_SHOP_DATA`. Imported by `src/scripts/data.js` (event shop: by the lazy event modules directly), bundled by Astro/Vite. No `<script>` tags.

## Bond point tables (`bond_growth.js`)
- Atlas `bondGrowth` = **running total from bond 0**, not per-level cost: Altria's `[3000, 9125, 15250, …]` → Lv.0→1 costs 3,000, Lv.1→2 costs 9,125 − 3,000 = 6,125. `sync_bond_growth()` differences it, so shipped table is **per level step** — `table[i]` = cost standing at Lv.i needs to reach Lv.i+1. Never re-add totals.
- `BOND_TABLES`: `{ "tN": [16 ints] }` — 471 playable servants share only **76** distinct tables, each shape stored once
- `BOND_TABLE_BY_SVT`: `{ "100100": "t1", … }` — servant key (Atlas svt ID string, same as `SERVANT_DATA`) → table key
- Read via `ServantData.getBondGrowth(id)`; UI modules don't touch maps direct
- Levels: Current 0–15, Target 1–16 (`BOND_CONSTANTS.MIN_BOND_LEVEL` / `MAX_BOND_LEVEL`); surplus carries up to `BOND_CARRY_LIMIT` (10), discarded past bond cap. `BOND_BONUS_LEVEL` (15) pays +25% party bonus; Current Lv. select ticks "Bond ≥15" to match itself
- Written whole-file by `sync_bond_growth()` (runs with servant step, skipped by `--skip-servants`), gitignored like other generated data files, required by `scripts/ensure_data.js`, checked by `scripts/validate_data.js`: 16 positive ints per table, every key resolves, every `SERVANT_DATA` entry has a table
- `SERVANT_DATA` entries carry no bond field — maps keyed by servant id instead, so bond data changes never rewrite `servants.js`

## Trait IDs
- 4-digit zero-padded strings (`"0100"` = Saber, `"0002"` = Female)
- Longer for specials (`"2801200"` = Solomon)
- Prefixes: `0xxx`=gender, `01xx`=class, `02xx`=attribute, `03xx`=alignment, `04xx`=rarity, `26xx`/`27xx`/`28xx`=special (`"2883"` = Fate/stay night)

## SERVANT_DATA
- Keys: Atlas svt ID strings (`"800100"`, `"100100"`, `"505600"`)
- `collectionNo: <int>`: in-game collection number (e.g. 1 for Mash, 467 for François)
- Simple: `"traits": ["0001", "0100", ...]` — flat sorted array
- Multi-ascension: `"traits": {"base": [...], "000": [...], "001": [...], "300": [...]}`
  - Standard keys: `"000"`, `"001"`, `"002"`
  - Custom keys: `"300"`, `"400"`, `"500"` (Spiritron Dresses/costumes)
  - Ascension arrays = **diff from base only** — merged at runtime
- **Sub-attribute overrides live outside `traits` in source**: Atlas stores servant's Heaven/Earth/Human/Star/Beast in `ascensionAdd.attribute.ascension` (keyed **1..4**, each stage says for itself); `sync_atlas_data.py` maps `sky/earth/human/star/beast` → `0200…0204` onto finished stage sets. 4 servants change with forms — 415 Alice human→earth, 465 Demeter heaven→star, 416 Hibiki & Chikagi earth→star, 444 U-Olga Marie star→human — their `base` (stage intersection) holds **no** `02xx`; each stage diff carries its own. Reader naming no form takes `ServantData.getAllTraits(id)` (union of every form, cached); card naming one form takes `getTraitsForAscension(id, ascension)` Individuality lists never contain attribute, and ids like `2011 skyOrEarthServant` or `2903 kuonjiAliceStage3` are skill-AI gate conditions `normalize_trait_id` drops on purpose
- `optionLabels`: display labels for non-standard ascensions (`{"300": "Piercing Bunny"}`)
  - **Two spiritron costume shapes**: (a) **stage costumes** — key in `traits` (e.g. `444` `{"300": ["0304"]}`) → Bond Gain CE renders as own stage-group label via `getAscensionLabel`; (b) **label-only costumes** — key in `optionLabels` but NOT in `traits` (e.g. `388` `{"300": "Serious Mode"}`) → surfaces only via `ServantData.getSpiritronLabel()` when spiritron CE (trait `2780`) matches base group
- `optionNames`: alternate names (`{"001": "Francesca Prélat"}`)
- Dual-persona servants (Servant 467 François / Francesca Prélat): single unified entry "505600" with `collectionNo: 467`, `altId: "505700"`, and swap portrait `505700/000.webp` alongside `505600/000.webp`, rendered via DOMFactory.createSwapImg and DOMFactory.fillSwapName (8s CSS keyframe cross-fade, respects prefers-reduced-motion)

## CE_DATA
- Keys: Atlas equip ID strings (`"9400970"`, `"9401970"`, `"9403520"`, `"9408990"`)
- `collectionNo: <int>`: in-game collection number (e.g. 99 for Heroic Portrait, 330 for Chaldea Lunchtime)
- Face icon WebP images named by Atlas equip ID at `public/craft_essences/{atlasId}.webp`
- Synced full from Atlas Academy API (`nice_equip_lang_en.json`) via `npm run data:sync`
- Simple CE: `{ "name": "...", "collectionNo": N, "bonus": N, "traits": [...] }`
- `"supportBonus": N` — only when Atlas `followerVals` differs from `svals`: % essence pays when **borrowed support servant** wears it (9403520 Chaldea Teatime: `bonus: 5`, `supportBonus: 15`). `SlotCEs.rate(ce, isSupport)` (`domain.js`) only place picking between the two; 9403520 currently only bond CE carrying it
- Match modes:
  - Default (OR): servant needs ANY trait in `traits`
  - `"matchAll": true` (AND): servant needs ALL traits
  - `"traitGroups": [[...],[...]]` (AND-of-ORs): each group OR-matched, all groups required
  - `"alsoMatch": [...]`: instant match if servant has any listed trait; checked first
- Grouped CE (`isGroup: true`):
  - Auto-detected for campaign series variants sharing identical effect signatures (e.g. Heroic Portrait, Heroic Spirit Encounter, Heroic Spirit Apex)
  - `"collectionNo": N` (first variant's collectionNo)
  - `"flatBonus": N` or `"bonus": N`
  - `"folder": "XXXXXXX-YYYYYYY"`, `"groupImage": "XXXXXXX"`
  - `"options": { "id": { "name": "...", "collectionNo": N } }`

## EVENT_SHOP_DATA (`event_shop.js`)
- Generated whole-file by `sync_event_shop()` in `sync_atlas_data.py` (step 3, `--skip-event-shop` / `--event-id N` flags), gitignored, required by `ensure_data.js`, checked by `validate_data.js`
- Shape: `{ events: [ { event: { id, name, shortName, startedAt, endedAt }, currencies: [{ id, name, background, icon }], items: [{ id, name, purchaseType, cost: { itemId, amount }, limitNum, setNum, priority, icon }], farm: { quests: [{ questId, questName, recommendLv, ap, sampleRuns, drops: { [currencyId]: { dropExpected, num } } }], best: { [currencyId]: questId } }, trades: [{ fromId, toId, costAmount, getNum }], bonusCes: [{ id, name, rarity, icon, bonuses: { [currencyId]: { nonLimitBreak, limitBreak } } }] } ] }` — ALL active event shops (type eventQuest, startedAt ≤ now < finishedAt, shop non-empty), sorted startedAt desc; `--event-id` narrows to one; stub `{ events: [] }`
- Event selection (Amendment J): a **farm event** is one whose shop has rows AND ≥1 repeatable quest (afterClear repeatLast|repeat) in its wars reports community drops for ≥1 of its shop currencies. The active pass keeps ALL open farm events (campaign exchange shops without wars and memorial battles without drop submissions are pruned); with zero active farm events a fallback scan takes eventQuest entries newest-startedAt-first (cap 30) and the FIRST farm event found ships alone — ended events qualify, Atlas keeps their historical drop data. Nothing passes → stub `{ events: [] }`; `--event-id` bypasses every filter including the farm test; the farm test's event/war/quest reads are shared with the snapshot's farm collection (once per run)
- `background` is Atlas-owned vocabulary (gold/silver/bronze/zero…); CSS `:where()` fallback absorbs unknown tiers; `limitNum` 0 = unlimited; `setNum` = units per purchase; icons site-relative `event_shop/{kind}_{id}.webp` or null
- Names: NA server → Atlas JP-EN translation → JP original (`resolve_item_name`); equip targets NA-equip → per-id lang=en → entry name; costumeRelease/unknown → entry name
- Farm, bonus CEs & trades: event warIds → nice war → repeatable quests (`afterClear` `repeatLast`|`repeat`) → nice `quest/{id}/{maxPhase}.drops` (community submissions: `dropExpected` stacks/run × `num` stack amount) → `farm.quests[]` (Shop currencies only — event points and QP are not shop currencies, so they never qualify); `farm.best[currencyId]` names the max-amount `questId` per currency (tie → lower `questId`); `trades[]` records shop currency upgrade exchanges (`{ fromId, toId, costAmount, getNum }`); `_collect_bonus_ces()` / `_equip_event_bonuses()` scan event equip `eventDropUp` functions (`AddCount` normal vs LB) into `bonusCes[]` (sorted rarity asc, CE icons downloaded as `event_shop/equip_{id}.webp`). On per-currency cards, `buildSecondaryDropLine()` selects at render time the chosen quest's next-best shop-currency drop (best plain `dropExpected × num`, tie → lower `currencyId`, omitted when the quest drops only the card's own currency). Plan math: `perRun = dropExpected × (num + flatBonus + ceBonus)`, jointly optimizing quests, per-quest owned CE combos (bounded by `ceEquipLimit`), and minimum trades via `EventShop.farmPlan()` / `bestCeFarmPlan()`
- Drop Rates per Run & Shop Requirements cards: Drop Rates per Run renders header (centered 64px `.farm-card-icon`, no currency name and no modal opener), quest `<select>` dropdown (`REC Lv` order), sliding quest name, `REC Lv. {recommendLv}` when truthy, up to two drop lines (`32px` `.drop-line .mini-icon` with `.drop-icon-count` base stack overlay + bonus-free `perRun / run (pct%)` — secondary line omitted when none, `"—"` only if own drop missing), conditional 4th combo card (`.farm-card--combo`) for all-covering quests, and a `Held` box on any currency no tier card owns (legacy `Bonus` inputs removed from currency cards). Shop Requirements holds tier `Required` / `Held` boxes, `#bonusCeGrid` (`3★/4★/5★` column-aligned CE cards with `Limit Break (+N)` / `Non-Limit Break (+N)` inputs), and `#ceBonusEquipInput` (`1–6`). Pre-rendered `.farm-card--pre` skeleton sits in `#farmGrid` (`index.astro`) with `data-event-combo` resolved in `<head>` for zero CLS; empty snapshot restores legacy mode via `showLegacyCard()`. Required displays live only in tier cards (`#materialsGrid`). Results card renders **Best Farm Runs** (`Quests to Play` with per-quest `.farm-res-ce-list` `LB ×N`/`NLB ×N` chips, `Item Receive`, `Shop Trades`); `ap` and `sampleRuns` stay in the data and never print
- Costume icons: costumeRelease target → servantId = target//100 → nice servant costumeMaterials keys (1 key → detailId; multiple → lore export profile.costume entry id == target%100; lore fetched only when absent AND needed) → face `JP/Faces/f_{detailId}0.png`; unresolved → base face + WARN
- Icon downloads try `{base}_bordered.png` FIRST, plain only on genuine 404 (`"HTTP Error 404"` phrase gate — bare "404" collides with ids); non-404 re-raises, writes nothing, next sync retries
- Outage policy: per-event failure skips that event; all-failed keeps the previous file; fresh clone with total failure writes the stub so builds never die
- Plan state: `fgo_event_shop_data` = `{ selectedEventId, plans: { [eventId]: { requires, held, bonus, farmQuest, currencyQuest, ceOwned, ceEquipLimit } } }`; `ceEquipLimit` defaults to `6` (`1–6`); old `{eventId, requires}` blobs migrate; per-event isolation; selection falls back to the latest event, never blank; the config modal is the sole requires mutation surface (`EventPlanner.applyRequires`)

## Adding Data
- Trait IDs: sort ascending in arrays
- Traits + display names auto-fetched and generated from Atlas Academy API (`export/NA/nice_trait.json` + NA CE skill brackets) via `npm run data:sync`
- Trait `0200` fixed and preserved as `"Heaven Attribute"` (matches official in-game NA status screen)
- New CE field → whitelist in `CEList` IIFE `src/scripts/data.js` (silently stripped otherwise)
- New servant field → handle in `ServantData.load()` `src/scripts/data.js`
- Images: `public/servants/{atlasId}/{stage}.webp`, `public/craft_essences/{atlasId}.webp`

## Zero-Commit Architecture
- Game images (`public/servants/`, `public/craft_essences/`, `public/event_shop/`) + generated data (`src/scripts/data/*.js`) follow **Zero-Commit Architecture**:
  - Ignored in `.gitignore`, dir structure kept via `.gitkeep`.
  - In CI (`.github/workflows/deploy.yml`): restored in seconds via `actions/cache@v4`.
  - Local dev: `scripts/ensure_data.js` (`predev` / `prebuild` npm hooks) auto-generates missing data files on fresh clone.
  - Git repo stays 100% pure source code, zero asset bloat, zero data diff noise.

## Image Paths
- Servants: `public/servants/{atlasId}/{stage}.webp` (142×155 WebP, bordered in-game card frame, e.g. `public/servants/100100/000.webp`)
- CEs: `public/craft_essences/{atlasId}.webp` (142×155 bordered WebP, same for all display sizes, e.g. `public/craft_essences/9400970.webp`)
- Icons: `public/icons/*.webp`, `public/icons/{category}/*.webp`
- Event shop: `public/event_shop/{kind}_{id}.webp` — kind `item` (shop items + currencies), `equip` (CE faces 142×155), `costume` (servant face 142×155); item icons native size capped 160px; lossless WebP
- Astro copies `public/` to `dist/` keeping paths — servant + CE image refs use relative URLs with `IMAGE_VERSION` cache-bust query param (e.g. `servants/100100/000.webp?v=${IMAGE_VERSION}` — never literal number, `BaseLayout.astro`'s preload reads same constant)
