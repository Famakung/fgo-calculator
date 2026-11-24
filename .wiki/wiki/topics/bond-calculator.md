---
title: "Bond Calculator"
category: topic
sources:
  - raw/notes/2026-11-24-legacy-claude-md.md
  - raw/notes/2026-11-24-legacy-data-rules.md
  - raw/notes/archive/2026-11-05-bond-slot-ce-rework-plan.md
created: 2026-11-24
updated: 2026-11-24
tags: [bond-calculator, slot-ces, teapot, grand-duel, zero-cls, servant-picker]
aliases: [Bond Calculator, Party Setup, Select Quest, SlotCEs, Stargazers Teapot]
confidence: high
volatility: warm
summary: "Documents the lazy-loaded Bond Calculator tab, covering Select Quest segmented family tabs, per-quest party racks, servant-slot integrated CEs via SlotCEs and supportBonus, BondLevelCalculator and Teapot.plan math, per-card AP/Golden Fruit overlays, zero-CLS hydration, and the shared Servant Picker modal."
---

# Bond Calculator

> The **Bond Calculator** (`#panel-bond`, lazy-loaded via `src/scripts/bond-lazy.js` and controlled by `BondApp` in `src/scripts/bond-app.js`) plans multi-level bond farming runs across up to 6 party slots. Its layout places **Select Quest** above **Party Setup**, embeds Craft Essences directly inside servant slots, supports Stargazer's Teapot split-phase planning, and achieves 0.00px Cumulative Layout Shift via pre-rendered HTML and pre-paint head hydration.

## Select Quest & Per-Quest Party Racks

The **Select Quest** card sits above **Party Setup** and uses segmented family tabs (`#bondQuestTabs`, `.bond-quest-tab-btn[data-quest-family]`, matching `.cefilter-subtabs` on `>= 760px`) controlled by `html[data-bond-quest="fq"|"rb"|"gd"]`:

- **Free Quest (`fq`)**: `#customApPerRun` (default 22, max 999), `#freeQuestRecLv`, and 7-col/4-col `#freeQuestTierPills` (`QUEST_TIERS`).
- **Raid Boss / Bleached Earth (`rb`)**: `#raidApPerRun`, `#raidRecLv`, and `#raidTierPills`.
- **Grand Duel (`gd`)**: `#bondGrandClassSelect` (`GRAND_CLASSES`) and `#bondGrandDiffPills` (`GRAND_DIFFICULTIES` `100`..`100★★★`, 3164..4748 base bond pts, 40 AP).

`Quest.bondPerRun()`, `Quest.apPerRun()`, `Quest.classIds()`, and `Quest.matchesClass()` in `src/scripts/domain.js` are the sole math and class-gate readers, summarized live in `<dl id="bondQuestSummary">`.

- **Per-Quest Party Racks (`state.parties`)**: Switching `questMain` or `questClass` calls `stashParty()` and `applyParty()`. `""` stores the shared Free Quest / Raid party, while `questClass || "all"` keys each Grand Duel class rack (11 class keys). Empty racks are omitted from `localStorage`.
- **Grand Duel Class Lock**: Choosing a specific Grand Duel class passes `{ lockClasses }` to `ServantSelector.open()`. `ServantFilters.effectiveClassIds` greys out the 14 non-matching classes in the filter modal (and disables `Class` sort) while `calculate()` blocks illegal party members (`"${name} cannot join a Grand Duel ${group} party."`).

## Party Setup, Servant Slots & Integrated CEs

`#servantGrid` holds 2 group labels (`Starting Member` slots 0–2, `Sub Member` slots 3–5) with drag-to-reorder (`ServantDrag` in `selectors.js`, ignoring inputs/selects/labels) and two slot types: **Normal** and **Support** (no calculation; legacy `"maxbond"` saves migrate on load).

- **Collapsed, Not Hidden**: `isSupport` omits the `Max Bond` / `Bond ≥15` checkbox row, and `isBondHidden` (`Support || Max Bond`) omits the level selects and `"Next Lv. Required"` point box at creation time rather than using `visibility: hidden` (cards shrink cleanly from 415px Normal to 317px Max Bond and 298px Support while preserving `bondLevel`/`targetLevel`/`bondNeeded` in state).
- **Visual Slot Badges**: Frontline slots (0–2) show `+20%` self (Normal) or `All / +4%` (Support); any slot with `Bond ≥15` checked (auto-synced two-way with `Current Lv. >= 15`) adds `All / +25%`.
- **Per-Slot Craft Essences (`SlotCEs`)**: Replaced the removed top-level `"Craft Essences Bonus"` card (`#ceGrid`). Each slot owns `ces: []` and `grand: false`. `SlotCEs` in `domain.js` enforces `capacity` (`1`, or `2` when **Grand Servant** is ticked—visible only when `questMain === "gd"`), `trim` (unticking Grand drops the 2nd CE without confirmation), `sanitize` (per-party sanitization in `loadState()` strips `grand` and 2nd CE from non-Grand racks and drops legacy top-level `data.ces`), and `partyPool(slots)` (skips pending `null` holes and collects `{ entry, isSupport }` across all slots, including Support slots).
- **64px Portrait-Only Chips**: `_buildSlotCEs()` renders `.slot-ce-block` at the bottom of `.servant-slot-info` with `--slot-ce-h: 64px` (`--slot-ce-w` = `142/155` of height, 4px gap). Name and bonus text live exclusively in `alt`/`title` and result cards. Unresolved IDs render removable `.ce-chip-fallback` tiles.
- **`supportBonus` Dual-Rate Rule**: When Atlas `followerVals` differs from `svals` (e.g., `9403520` Chaldea Teatime: `5%` self vs `15%` borrowed support), `SlotCEs.rate(ce, isSupport)` picks the active rate uniformly for `calculate()`, chip titles, and result badges.

## Bond, Teapot, AP & Golden Fruit Calculations

- **Level Planning (`BondLevelCalculator.plan`)**: Reads per-step costs from `ServantData.getBondGrowth(id)` (derived by differencing Atlas running-total `bondGrowth` into 76 deduplicated tables in `bond_growth.js`). **Current Lv.** (0–15) and **Target Lv.** (Current+1–16) re-price `"Next Lv. Required"` on level or servant change. Surplus carries up to `BOND_CARRY_LIMIT` (10) and is discarded past Lv.10 so Lv.11+ rounds per level. Output `{ rows, total, spansLevels }` groups consecutive levels cleared by a single run batch (`Bond Lv.0->2`).
- **Stargazer's Teapot (`Teapot.plan`)**: `.bond-card-actions` bottom-right hosts `#teapotCountInput` (max 9999) + `#teapotToggle` (`.bond-teapot-switch`) left of `#bondCalculateBtn` (`width: auto` scoped to `.bond-card-actions`). Edits only persist; `#bondCalculateBtn` is the sole calculation trigger. Teapot doubles total per-run bond (`TEAPOT_MULTIPLIER = 2`). If stock runs out mid-plan (`Teapot.plan` splits at `stopLevel` / `stopRuns` / `stopOwed`), results render the boosted grid (with teapot badge last in `.ce-badges`), a centred static `.bond-teapot-badge` (`"Out of Stargazer's Teapot"` + 48px `icons/teapot.webp`), and a second continuation grid below.
- **Per-Card AP & Golden Fruit Overlay**: `.bond-card-actions` bottom-left holds `#maxApInput` (default 152, max 999, `icons/100_bordered.webp`). Each result card prices its own runs (`cardAp = runs * Quest.apPerRun(...)`, `Quest.goldenFruit(cardAp, maxAp)`), rendering `<ap> AP` and a 48px Golden Fruit icon with `x<n>` inset (`margin-right: 3px; margin-bottom: 7px`) inside the bordered art. The aggregate Total AP badge was removed because party members farm in parallel.

## Zero Layout Shift & Servant Picker Modal

- **0.00px CLS Pre-Paint**: `BaseLayout.astro` `<head>` sets `data-bond-quest` and `data-bond-custom` from `fgo_bond_calculator_data`; `index.astro` pre-renders `#freeQuestTierPills`, `#raidTierPills`, `#bondGrandClassSelect`, `#bondGrandDiffPills`, the 6 empty `.servant-add-slot` cards in `#servantGrid`, and an inline `<script is:inline>` right after `#bondQuestSummary` that restores inputs, active pills, and summary values synchronously before first paint (tested at 0.00px CLS in `scripts/test_bond_layout_shift.js`).
- **Servant Picker Modal (`#servantModal`)**: Mirrors Bond Gain CE's layout—search bar (`#servantPickerSearch`, bounded to `MAX_SEARCH = 40`), `#servantPickerFilterBtn` opening nested `#servantFilterModal` (`z-index: 1050`, placed after `#servantModal` in DOM; 7 sections built by `FilterSections`, reading `ServantData.getAllTraits(id)`), `#servantPickerSortBy` (ID/Rarity/Class via `ServantSort`), and `#servantPickerSortOrder`. Picker filters/sort persist for the page session only. Escape unwinds modals LIFO (filter sub-modal → ascension sub-modal → servant picker), and backdrop clicks do not close modals.

## See Also

- [[bond-gain-ce-and-filters|Bond Gain CE and Servant Filters]] ([Bond Gain CE and Servant Filters](../topics/bond-gain-ce-and-filters.md)) — shared `FilterSections`, `ServantFilters`, `ServantSort`, and `#servantModal`
- [[data-schemas-and-traits|Data Schemas and Traits]] ([Data Schemas and Traits](../references/data-schemas-and-traits.md)) — `BOND_TABLES`, `BOND_TABLE_BY_SVT`, and `supportBonus` schema
- [[architecture-and-bundling|Architecture and Bundling]] ([Architecture and Bundling](../concepts/architecture-and-bundling.md)) — `bond-lazy` chunking, head scripts, and single inline CSS

## Sources

- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — Bond Calculator quest tabs, per-quest racks, `SlotCEs`, `Teapot`, AP/Fruit, and picker rules
- [Data Schemas and Trait Rules](../../raw/notes/2026-11-24-legacy-data-rules.md) — `bond_growth.js` running-total differencing and `supportBonus` schema
- [Archive Plan: Bond Slot Craft Essence Rework](../../raw/notes/archive/2026-11-05-bond-slot-ce-rework-plan.md) — `SlotCEs` design, field collapse, and card reordering plan
