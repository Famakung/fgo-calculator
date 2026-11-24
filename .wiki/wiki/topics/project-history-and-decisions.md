---
title: "Project History and Decisions"
category: topic
sources:
  - raw/notes/2026-11-24-legacy-progress-log.md
  - raw/notes/2026-11-24-legacy-claude-md.md
created: 2026-11-24
updated: 2026-11-24
tags: [history, architecture-decisions, milestones, astro-migration, changelog]
aliases: [Project History, Progress Log, Architectural Decisions]
confidence: high
volatility: cold
summary: "Chronological synthesis of FGO Calculator milestones and architectural decisions from April 2026 through November 2026, tracing the Servant Info converter, Astro 7 migration, zero-commit Atlas pipeline, Bond and CE Filter reworks, Event Shop planner, and superseded/rejected designs."
---

# Project History and Decisions

> This article synthesizes the chronological engineering log of FGO Calculator across seven major eras, highlighting enduring architectural decisions alongside explicit reversals and superseded proposals.

## 1. Servant Info Pipeline Foundations (April 2026)

- **2026-04-18 to 2026-04-20 (Converter Sessions 1–24)**: Built the initial Python converter (`scripts/servant_info_converter/`) to transform Atlas Academy lore exports into human-readable Servant skill, NP, passive, and append skill descriptions. Key milestones included `attackBeforeFunction`/`attackAfterFunction` handlers, `ActSet`/`ActSetWeight` multi-option grouping, `FUNC_TYPE_NO_BUFF` refactoring, inner skill caching, Overcharge count scaling, `delayFunction`, HP threshold conditions, and `selfturnendFunction` rewrites.

## 2. Astro Migration, Bond & Event Foundations (May–September 2026)

- **2026-05-11 — Astro Static Site Migration (`f78ea36`)**: Replaced the legacy vanilla JS/esbuild + service-worker setup (`build.cjs`, `sw.js`, `index.html`, flat `src/*.js`) with an Astro static site bundled by Vite under `src/layouts/`, `src/pages/`, `src/scripts/`, and `public/`.
- **2026-09-12 to 2026-09-18 — Bond & Event Shop Controls**: Decoupled **Max Bond** and **Bond ≥15** checkboxes, added `Bond All +25%` visual slot badges, introduced left-aligned `"Bond Required"` / `"Required, Held, Bonus"` border-labeled inputs, ignored form controls during `ServantDrag`, and added Spiritron Dress trait `"2780"` support.

## 3. Bordered Assets, Worker ESM & Zero-Commit Sync (October 2026)

- **2026-10-13 to 2026-10-15 — Bordered Assets & UI Scaling**: Migrated Servant and CE portraits to Atlas `_bordered.png` WebP (`142×155`), unified CE icons into a single resolution (deleting `craft_essences/64/`), standardized `96px` portraits / `48px` CE badges / `48×48` class buttons / `48×36` rarity and count chips, added `?v=2` (`IMAGE_VERSION`) cache busting plus legacy Service Worker/CacheStorage purge (`public/sw.js` killswitch), and moved Bond Gain CE filters into `#cefilterFilterModal` with a 2-column `<580px` `.grid-sm`.
- **2026-10-14 — Vite ESM Worker Migration**: Fixed HTTP 404 on `ce-match-worker.min.js` by switching `CEFilterApp` to `new Worker(new URL("./ce-match-worker.js", import.meta.url), { type: "module" })`.
- **2026-10-18 to 2026-10-21 — Zero-Commit Data Pipeline & ETag CI**: Untracked `src/scripts/data/*.js`, `public/servants/`, and `public/craft_essences/` from git (`scripts/ensure_data.js` auto-syncs on `predev`/`prebuild`; CI restores via `actions/cache`). Added full-auto CE detection and series grouping (`Heroic Portrait`, `Heroic Spirit Encounter`, `Heroic Spirit Apex`), `export/NA/nice_trait.json` dynamic trait fetching, Beast class `"0124"` mapping, fractional `2.5%` CE bonuses, Spiritron Dress `optionLabels`/`optionNames`, ETag conditional-GET revalidation, and `.ci-baselines/` run-scoped baseline caching. Added the `fgo_build_etag` stale-tab reload banner in `BaseLayout.astro`.

## 4. Astro 7, Single CSS & Bond/Filter Reworks (Nov 2–9, 2026)

- **2026-11-02 to 2026-11-03 — Astro 7 / Vite 8 & Servant Select**: Upgraded to Astro 7 + Vite 8 (Rolldown `codeSplitting.groups`), requiring Node `>= 22.23.4` and establishing `/home/famakung/dev/fgo-calculator` (btrfs) as the canonical checkout after hitting an `ntfs3` Vite dev-toolbar build failure on `/mnt/storage`. Added the **Servant Select** sub-tab (`ce-servant-select.js`, `ServantComboCalculator`)—initially unioning ascensions, then immediately superseded to split per-ascension groups with portrait-only badges, `Clear all (N)`, and unified `CEFilterStore` persistence.
- **2026-11-03 — Permanent `traitAdd` Fix**: Merged `condType: "none"`, `eventId: 0`, `id > 1000` `traitAdd` entries in `sync_atlas_data.py`, fixing `"2821"` (Beast Servants) across 22 Servants while keeping Mash's class-form rarities isolated.
- **2026-11-04 — Single CSS Home, Doc Reachability & Layout Decisions**:
  - Deleted stale `src/styles/global.css`, `src/styles/critical.css`, `.stylelintrc.json`, and broken `npm run lighthouse` script; collapsed all CSS into the single `<style is:inline>` in `BaseLayout.astro`.
  - Negated `.claude/CLAUDE.md` and `.claude/docs/` in `.gitignore` while keeping `develop` local-only.
  - **Superseded Decision**: Adopted JS `zoom` magnification above `1280px` (then `1400px`) and rejected `2026-11-04-fluid-desktop-layout-*`. Later (2026-11-09), removed the JS resize-listener zoom hack and replaced it with pure CSS `@media (min-width: 1400px) { html { zoom: min(2, calc(100vw / 1400px)); } }` and `100dvh`-calibrated `--screen-h`.
- **2026-11-05 to 2026-11-08 — Bond & Filter Reworks**:
  - Added per-level `bond_growth.js` (76 deduplicated step-cost tables), `BondLevelCalculator`, `SlotCEs` (moving CEs into servant slots and deleting `#ceGrid`, collapsing hidden fields instead of reserving height via `visibility: hidden`), `supportBonus` (`5%` vs `15%` Teatime), and `Teapot.plan` + Total AP/Golden Fruit.
  - Refactored `#servantModal` to mirror Bond Gain CE, expanded Filter Settings to 8 sections via `FilterSections` (`ServantFilters`, `ServantSort`, `createAvailPredicates`, `_pruneActiveFilters`), disabled backdrop click-outside dismissal across all 9 modals, converted Ascension/CE Group modals into layered `z-index: 1050` sub-modals, and added draft action footers (**Default** / **Select All** / **Cancel** / **OK**).
  - Upgraded `ServantComboCalculator` to a 32-bit `Uint32Array` bitset closed-intersection engine with 0-pick all-Servant evaluation and 5-row pagination.
  - Migrated Servant keys (`"100100"`) and CE keys (`"9400970"`) to Atlas IDs with `collectionNo` ordering and `localStorage` migration, unified Servant 467 (`François` / `Francesca Prélat`) with an 8s CSS cross-fade swap, switched Atlas icons to lossless WebP, eliminated Bond tab CLS (`0.00px`), and hardened `merge_code_only.sh` to drop `develop`-only docs/tests (`tests/`, `scripts/verify_render.js`, `scripts/test_*.js`) and enforce descriptive commit messages.

## 5. Event Shop Overhaul, Bond UX & Dark Mode (Nov 10–18, 2026)

- **2026-11-10 — Bond Card AP & Uniform 8px Cards**: Replaced the aggregate Total AP badge with per-card AP + Golden Fruit overlays (`bond-app.js`), and normalized servant/CE card padding to `8px` with equal-height rows.
- **2026-11-11 — Fixed-Slot CI Cron**: Replaced `*/10` cron with 4 daily UTC slots (`10 9,11,15,19 * * *`) aligned to JP/NA maintenance windows because GitHub throttled `*/10` to 3–5 unpredictable runs/day.
- **2026-11-12 to 2026-11-14 — Event Shop Planner & Results Overhaul (Amendments A–K, R1–R30)**: Shipped live Atlas shop/quest/bonus-CE sync, removed the standalone planner card in favor of `#eventShopModal` (Amendment B), added real-data Drop Rates cards and farm-event pruning (I+J), aligned UI chrome (K), reordered `Best Farm Runs` (Quests to Play → Item Receive → Shop Trades, R1–R28b), implemented `minCoverTrades` (R22) and continuous sliding marquee names with `ResizeObserver` reveal (R25–R29), fixed the dominated-pick over-farm regression (R30), added pre-rendered zero-CLS `.farm-card--pre` skeletons, and added the `bestCeFarmPlan()` Bonus CE branch-and-bound optimizer.
- **2026-11-15 — Bond Select Quest Redesign**: Replaced the 13-row dropdown stack with segmented family tabs (`fq` / `rb` / `gd`), tier pills, `<dl id="bondQuestSummary">`, per-quest party racks, and `0.00px` pre-paint restoration.
- **2026-11-18 — Dark Mode Toggle**: Added `#themeToggle` (`fgo_theme` in `localStorage`) and `html[data-theme="dark"]` Zinc palette tokens in `BaseLayout.astro`.

## 6. Servant Info Tab & CI Hardening (Nov 21–22, 2026)

- **2026-11-21 — Servant Info Launch**: Shipped the 4th tab (`#tab-servantinfo`), static `public/servant_info/*.json` payloads, lossless `public/saint_graphs/*.webp` (`fgo-saint-graphs-v1`), `32px` `public/skill_icons/*.webp` (`fgo-static-images-v2`), `.cache/atlas/inner_skills.json`, special handling for Mash/Mélusine/467/transform partners, and `python3 -u` unbuffered CI logging.
- **2026-11-22 — Polish & Fast-Path CI**: Added CI fast-path cache skip when `CHECK=UNCHANGED` and all 3 caches hit, settled ended-event disk caching (`7`-day grace), duplicate-effect NP/skill choice deduplication, stage-driven NP/skill name switching, 2-layer `[Nth Time]` / `[XX% Chance]` option UI, special unremovable sleep formatting (`JP_BUFF_NAME_MAP`), and `fmt_trigger_function` inner-skill enemy-side filtering.

## 7. LLM Wiki, CI Trigger Shift & Servant Info Filters (Nov 24, 2026)

- **Local `.wiki/` & `tools/` Split (`f468d6e`, `43a6097`)**: Replaced legacy `.claude/docs/` with `.wiki/`, moved `develop`-only verification/merge scripts out of `scripts/` into `tools/`, added offline SQLite lookup `tools/query_effect.py` (`.cache/atlas/effects.db`), and switched agent routing to direct article reads.
- **CI Dispatch & Hash Normalization (`4d53a67`, `a788e30`, `fb534f6`)**: Removed GitHub Actions `schedule` triggers in favor of external `workflow_dispatch` with `run_label`, and normalized `sampleRuns` / `dropExpected` out of `compute_data_hash()` and `_drops_digest()` to stop volatile community drop-count deploys.
- **Servant Info & Perf (`dd1c01a`, `f5eef6d`, `641b40e`, `68f7573`, `537da5b`, `75687bb`, `7a3d86d`)**: Stripped duplicate formatted arrays from `public/servant_info/*.json`, deferred `event-lazy` load to tab click, added tier-colored Rank Up markers, fixed Spiritron Dress ascension button sync, and added NP Type (`quick`/`arts`/`buster`) and NP Effect (`aoe`/`st`/`support`) filters.

## See Also

- [[architecture-and-bundling|Architecture and Bundling]] ([Architecture and Bundling](../concepts/architecture-and-bundling.md)) — current Astro 7 + Rolldown and single-CSS architecture
- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — current CI gates, caches, and `merge_code_only.sh` workflow
- [[bond-gain-ce-and-filters|Bond Gain CE and Servant Filters]] ([Bond Gain CE and Servant Filters](../topics/bond-gain-ce-and-filters.md)) — current Bond Gain CE feature state
- [[bond-calculator|Bond Calculator]] ([Bond Calculator](../topics/bond-calculator.md)) — current Bond Calculator feature state
- [[servant-info-system|Servant Info System]] ([Servant Info System](../topics/servant-info-system.md)) — current Servant Info system state
- [[event-shop-calculator|Event Shop Calculator]] ([Event Shop Calculator](../topics/event-shop-calculator.md)) — current Event Shop feature state

## Sources

- [Historical Implementation Progress Log](../../raw/notes/2026-11-24-legacy-progress-log.md) — full chronological record of implementations, bug diagnoses, and verification runs
- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — consolidated current-state rules and known environment notes
