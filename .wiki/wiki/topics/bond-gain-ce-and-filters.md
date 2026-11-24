---
title: "Bond Gain CE and Servant Filters"
category: topic
sources:
  - raw/notes/2026-11-24-legacy-claude-md.md
  - raw/notes/2026-11-24-legacy-structure.md
  - raw/notes/2026-11-24-legacy-data-rules.md
  - raw/notes/archive/2026-11-03-ce-filter-servant-select-plan.md
  - raw/notes/archive/2026-11-05-filter-settings-rework-design.md
  - raw/notes/archive/2026-11-05-filter-settings-rework-plan.md
created: 2026-11-24
updated: 2026-11-24
tags: [bond-gain-ce, servant-select, filter-modal, web-worker, trait-matching]
aliases: [Bond Gain CE, CE Filter, Servant Select, Filter Settings]
confidence: high
volatility: warm
summary: "Covers the default Bond Gain CE tab, including Craft Essence Select and Servant Select sub-tabs, off-thread Web Worker trait matching and caching, the 8-section Filter Settings modal with availability pruning, and dual-mode localStorage persistence."
---

# Bond Gain CE and Servant Filters

> **Bond Gain CE** (`#panel-cefilter`) is the default landing tab of FGO Calculator. It provides two complementary sub-tabs—**Craft Essence Select** (reverse-lookup from CEs to matching Servants) and **Servant Select** (forward-lookup from picked Servants to shared CE groups)—powered by an off-thread Web Worker match cache, an 8-section Filter Settings modal, and unified `CEFilterStore` persistence.

## Sub-Tab Architecture & Pre-Paint Hydration

Bond Gain CE introduced the application's first nested tab level (`#cefilterSubtabs`, `.cefilter-subtab-btn[data-subtab]`):

- **Craft Essence Select** (`.cefilter-subpanel[data-subpanel="ce"]`, default): Select one or more bond CEs to list every matching Servant and ascension form, with match modes **All** (AND), **Any** (OR), and **Custom Match** (exact CE match count).
- **Servant Select** (`.cefilter-subpanel[data-subpanel="servant"]`): Select any number of Servants (or leave empty to evaluate the entire roster) to compute maximal groups sharing usable CEs.

To eliminate first-paint flicker on refresh when `subTab: "servant"` is saved, an inline `<script>` in `BaseLayout.astro` `<head>` parses `fgo_ce_filter_data` synchronously and sets `data-subtab="servant"` on `<html>`. A rule in the inline stylesheet (`html[data-subtab="servant"] .cefilter-subpanel[data-subpanel="ce"] { display: none; }`) overrides `.cefilter-subpanel[hidden]` (specificity 0-3-0 vs 0-2-0) before first paint, while a tiny inline script immediately after `#cefilterSubtabs` updates `.active` and `aria-pressed` on the buttons. `CEFilterApp._switchSubTab()` synchronizes `document.documentElement.dataset.subtab`, panel `hidden` attributes, and storage.

## Servant/CE Matching, Web Worker & Cache

Trait matching runs off the main thread on initial filter demand via a Vite ESM Web Worker (`src/scripts/ce-match-worker.js`, spawned as `new Worker(new URL("./ce-match-worker.js", import.meta.url), { type: "module" })`), which inlines `TraitMatcher` from `src/scripts/domain.js`.

- **Match Cache (`CEFilterApp._allCEMatchesCache`)**: Populated on first computation via `_processWorkerResults(e.data)`. Each entry represents a Servant or a distinct ascension/costume trait group (`primaryAscension`, merged traits, `matchingCEIds` `Set`).
- **Ascension & Spiritron Costume Grouping**: Multi-ascension Servants whose stages match different CE sets split into separate result entries. **Stage costumes** (trait diff key present in `traits`, e.g., Servant 444 U-Olga Marie `"300": ["0304"]` Earth President) render their own group label via `getAscensionLabel()`, whereas **label-only costumes** (present in `optionLabels` without a trait diff, e.g., Servant 388 Chloe `"300": "Serious Mode"`) append via `ServantData.getSpiritronLabel()` when a spiritron CE (trait `"2780"`) matches the base group.
- **Trait Match Modes (`CE_DATA`)**: Supports default OR (`traits`), AND (`matchAll: true`), AND-of-ORs (`traitGroups`), and instant override (`alsoMatch`). See [[data-schemas-and-traits|Data Schemas and Traits]] ([Data Schemas and Traits](../references/data-schemas-and-traits.md)).
- **CE Chips & Pagination**: Active CE chips (`#cefilterChips`) render portrait-only (48px `--ce-badge-h`) with `alt` and `aria-label` carrying the CE name, alongside a `Clear all (N)` button (`#cefilterClearBtn`). CEs without ascension-level overlap display in grayscale; clicking a Servant portrait opens `#ceOverlapModal` (`CEServantOverlap` in `selectors.js`, 50ms debounce) to inspect other Servants sharing the same CEs. Results paginate at `cols * 5` (5 rows per page; mobile `.grid-sm` uses 2 columns below 580px).

## Servant Select Sub-Tab & Bitset Engine

Implemented in `src/scripts/ce-servant-select.js` (`ServantSelect`, bundled in `ce-filter-chunk`) and backed by `ServantComboCalculator.buildSharedCEGroups(entries, pickedIds)` in `src/scripts/domain.js`:

1. **All-Servant Default & Multi-Select**: When `pickedIds` is empty (0 picks), evaluates the full roster (`ServantData.servants.map(s => s.id)`). With 1 pick, prompts `"Add one more servant..."`. Clicking **Add Servant** opens `#servantModal` in `multi: true` staged mode (`skipAscension: true`, `#servantModalFooter` with Default, Select All, Cancel, OK).
2. **Bitset Closed-Intersection Engine**: Pre-filters CEs usable by ≥2 distinct picked Servants, groups equivalent members using 32-bit `Uint32Array` bitsets (`_buildBitsetClasses`, `_intersectBitsets`, `_isSubsetMask`), memoizes visited intersections (`seen`), and prunes non-maximal sets while respecting `MAX_COMBO_NODES = 50000` (setting `truncated: true` if hit).
3. **Ascension Splitting & Card Display**: Multi-ascension Servants remain separate member entries (a single Servant split across two forms never forms a combo alone; rows require ≥2 distinct Servants). Member badges render portrait-only (no blue `.cefilter-ascension-label` underneath; stage/costume names live in `title`/`alt`). Clicking any CE chip invokes `CEFilterApp.selectCEFromCombo(ceId)` to switch to Craft Essence Select with that CE selected. Results paginate at `cols * 5` (`#cefilterComboPaginationTop` / `#cefilterComboPaginationBottom`).

## Filter Settings 8-Section Modal & Pruning

Refactored from 3 legacy rows into **eight labelled, 2px-bordered sections** in one scrolling column (`#cefilterFilterModal`), shared with `#servantFilterModal` (7 sections, omitting CE Bonus) and `#ceOverlapFilterModal` via `FilterSections` and `FilterModalController` (`src/scripts/filter-sections.js`):

| # | Section | State Key | Notes |
|---|---|---|---|
| 1 | Rarity | `rarityFilters` | `★0`–`★5` (`0400`–`0405`), 48×36 `.rarity-btn` |
| 2 | Class | `classFilters` | 3×5 grid (`repeat(5, 48px)`) of 48×48 `.class-btn` icons |
| 3 | Class (Group) | `groupClassFilters` | Three Knights, Four Cavalries, Extra I, Extra II (`CLASS_GROUPS`) |
| 4 | Alignment (L/N/C) | `aliFilters` | Lawful (`0300`), Neutral (`0302`), Chaotic (`0301`) |
| 5 | Alignment (G/B/E/Other) | `subAliFilters` | Good (`0303`), Balanced (`0305`), Evil (`0304`), `Other` (`SUB_ALI_OTHER` complement covering Madness `0306` & Summer `0308`) |
| 6 | Sub-Attribute | `subAttrFilters` | Heaven (`0200`) through Beast (`0204`) |
| 7 | Gender | `genderFilters` | Male (`0001`), Female (`0002`), Unknown (`0003`) |
| 8 | CE Bonus | `matchCounts` | Dynamic CE count buttons (48×36 `.ce-count-btn`); Bond Gain CE only |

- **Matching Rules (`ServantFilters.match`)**: Union within a row, AND across rows; empty row = no filter. On Bond Gain CE result cards, reads the resolved ascension's merged traits (`_traitsOf(entry)`), whereas form-agnostic pickers read `ServantData.getAllTraits(id)` so attribute-changing Servants (415, 416, 444, 465) match all their forms.
- **Availability Predicates & Active Filter Pruning**: `createAvailPredicates(avail)` in `filter-sections.js` unifies disabled-chip detection across `renderStandardRows` and `selectAll` (`ServantFilters.rowScope` greys out-of-group classes without deleting existing picks). When CE selection changes, `CEFilterApp._pruneActiveFilters(avail)` removes active filter values that become unavailable, and unavailable `matchCounts` disable via `.ce-count-btn--disabled` instead of disappearing.
- **Draft Modal Footer**: `.cefilter-modal-footer` holds **Default** / **Select All** (left) and **Cancel** / **OK** (right); changes stage in `draftFilters` (or `tempSelected` in `#ceFilterModal`) and commit only on **OK**. Backdrop click-outside dismissal is disabled across all modals.

## Persistence & Sorting

- **`CEFilterStore` (`ce-servant-select.js`)**: Sole Bond Gain CE module touching `localStorage` (`CEFILTER_STORAGE_KEY` = `"fgo_ce_filter_data"`). Uses read-modify-write merging (`read()`, `write(patch)`) for `{ servantPicks, cePicks, ceMode, subTab }`. Restored IDs run through `Validator.validatePicks` (`/^\d{3,}$/`) and `CEData.migrateId()` / `ServantData.getServant()`.
- **Page-Scoped Ephemeral State**: Filter modal selections, `matchCustomCounts`, search query (clamped to `MAX_SEARCH = 40`), and `currentPage` reset on page reload.
- **Unified Comparator**: `CEFilterApp._sortEntries` delegates to `ServantSort.sorted()` (`src/scripts/domain.js`) so the tab grid and `#servantModal` share identical ID/Rarity/Class ordering.

## See Also

- [[bond-calculator|Bond Calculator]] ([Bond Calculator](../topics/bond-calculator.md)) — shares `#servantModal`, `FilterSections`, `ServantFilters`, and `ServantSort`
- [[data-schemas-and-traits|Data Schemas and Traits]] ([Data Schemas and Traits](../references/data-schemas-and-traits.md)) — trait ID conventions, `CE_DATA` match modes, and per-stage sub-attributes
- [[architecture-and-bundling|Architecture and Bundling]] ([Architecture and Bundling](../concepts/architecture-and-bundling.md)) — 3-layer split, `ce-filter-chunk`, and Web Worker bundling
- [[code-style-and-conventions|Code Style and Conventions]] ([Code Style and Conventions](../references/code-style-and-conventions.md)) — modal patterns and double-rAF DOM batching

## Sources

- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — Bond Gain CE sub-tabs, bitset engine, Filter Settings, and Worker config
- [Project Architecture and Module Structure](../../raw/notes/2026-11-24-legacy-structure.md) — file layout, chunking, and Bond Gain CE UI layout
- [Data Schemas and Trait Rules](../../raw/notes/2026-11-24-legacy-data-rules.md) — `SERVANT_DATA`, `CE_DATA`, and costume/sub-attribute schemas
- [Archive Plan: CE Filter Servant Select Sub-Tab](../../raw/notes/archive/2026-11-03-ce-filter-servant-select-plan.md) — original Servant Select design and review invariants
- [Archive Design: Filter Settings Rework](../../raw/notes/archive/2026-11-05-filter-settings-rework-design.md) — 8-section modal design, alignment `Other`, and `CLASS_GROUPS`
- [Archive Plan: Filter Settings Rework](../../raw/notes/archive/2026-11-05-filter-settings-rework-plan.md) — implementation plan for `ServantFilters` and `filter-sections.js`
