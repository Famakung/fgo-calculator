# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and AI coding assistants when working with code in this repository.

## ⚠️ Pre-Implementation Requirement (Project Memory)

**ALWAYS read the relevant documentation in `.claude/docs/` before implementing anything!**
The first four bullets are the mandatory read (~25 KB together). `fetch-data-guideline.md` and `progress.md` are 62 KB and 163 KB — grep them for your feature instead of loading either whole. `AGENTS.md` and `GEMINI.md` at the repo root carry the same contract for non-Claude agents (Antigravity, Codex, Copilot); all four files are tracked, keep them in step.
- **`code-style.md`** — Coding conventions, strict DOM safety rules (NEVER use `innerHTML`, use `createElement()` + `textContent` + `setAttribute()`, or `DocumentFragment` with `replaceChildren()`), naming standards, state management, and performance patterns.
- **`structure.md`** — Project architecture, 3-layer pattern (Domain, Application, Presentation), module responsibilities, Vite manual chunk splitting, and script loading order.
- **`data-rules.md`** — Trait ID conventions (4-digit zero-padded strings), `SERVANT_DATA` and `CE_DATA` schemas, trait match modes, and public asset paths (`public/servants/`, `public/craft_essences/`).
- **`security.md`** — Security rules, inline Trusted Types policy enforcement, and safe DOM manipulation.
On demand only (large):
- **`fetch-data-guideline.md`** — Guidelines for fetching and processing game data from Atlas Academy API.
- **`progress.md`** — Current implementation status, testing checklists, and project roadmap.

## Project

FGO Calculator — Astro static site deployed to GitHub Pages. Three tools:
- **Event Shop Calculator**: Optimal quest runs for event materials
- **Bond Calculator**: Bond farming planner with servant slots, CE trait matching, quest presets
- **Bond Gain CE**: Reverse lookup — pick CEs → see matching servants

**Live:** https://famakung.github.io/fgo-calculator/
**Repo:** Famakung/fgo-calculator

### Key Features

**Event Shop Calculator:**
- Input boxes with border labels for Required, Held, and Bonus amounts per material tier (Bronze, Silver, Gold)
- Base drops and primary/secondary drop multipliers configuration
- Optimal quest runs calculation based on material deficits
- LocalStorage state persistence

**Bond Calculator:**
- Up to 6 servant slots with drag-to-reorder, class icon multi-select filter (15 classes)
- 2 servant types: Normal (with Max Bond & Bond ≥15 checkboxes), Support (no calculation)
- Visual slot badges: Starting member slots display frontline bonus badges (+20% self for Normal, +4% All for Support); checking "Bond ≥15" displays "Bond All +25%" badge in any slot (stacked below +self 20% when in starting member)
- Multi-ascension support — per-ascension traits merged at runtime
- Frontline bonus: ×1.2 multiplier + flat 20% of base (first 3 slots); frontline support bonus: +4% (all slots)
- Quest presets: Free Quest Lv.83/84, Grand Duel Lv.100, or custom bond per run
- Bond level planning: per slot **Current Lv.** (`slotBondLv_${i}`, 0–15) and **Target Lv.** (`slotBondTgt_${i}`, Current+1–16) sit **above** the point box, which `buildServantSlots()` labels "Next Lv. Required". Current Lv. always re-prices that box from the servant's own table (`bondGrowth[current]`), including over a typed figure; changing the servant through `setServant()` re-prices it the same way. A restored or freshly opened slot with an empty box gets the current level's cost too — nothing else overwrites a typed number
- Current Lv. ≥ `BOND_CONSTANTS.BOND_BONUS_LEVEL` (15) ticks "Bond ≥15", a lower level unticks it — that level is what pays the +25% party bonus, so the checkbox follows the select both ways
- Runs per level stretch: `BondLevelCalculator.plan({ growth, current, target, bondPerRun, typedCost })` (`domain.js`) returns `{ rows: [{from, to, runs}], total, spansLevels }`; `rows` group consecutive levels a single batch of runs clears (`Bond Lv.0->2` / `1 run`), surplus carries up to `BOND_CARRY_LIMIT` (10) and is discarded above the bond cap, so Lv.11+ rounds alone. `spansLevels` is the only trigger for printing rows: a one-level plan keeps the old single `X runs` line, and `runs` then still comes from `Math.ceil(bondNeeded / effectiveBond)`
- Slot state gained `bondLevel` / `targetLevel`, clamped in `loadState()`'s `sanitize()`; every slot literal now comes from `defaultSlot()` in `bond-app.js` instead of eight hand-copied objects

**Bond Gain CE:**
- Two sub-tabs (`#cefilterSubtabs`, `.cefilter-subtab-btn[data-subtab]`, first nested tab level in the app): **Craft Essence Select** (`.cefilter-subpanel[data-subpanel="ce"]`, the original CEs → servants UI, default) and **Servant Select** (`.cefilter-subpanel[data-subpanel="servant"]`, servants → shared-CE groups) — panels carry no `id`; `#cefilterSubCE`/`#cefilterSubServant` never existed, the two cards swap on `data-subpanel`. Both sub-tabs persist their picks under `CEFILTER_STORAGE_KEY` (`fgo_ce_filter_data`) as `{ servantPicks: [...], cePicks: [...], ceMode: "all", subTab: "ce" | "servant" }`, always written through `CEFilterStore` (exported by `ce-servant-select.js`, read-modify-write — a blind single-field `setItem` would erase the other sub-tab's field). Servant side: `ServantSelect._savePicks()`/`_loadPicks()`. CE side: `CEFilterApp._saveState()`, called from `render()` because that is the one point every pick mutation reaches (the picker's `onApply` in `main.js` and the card-badge clicks mutate `selectedCEs` directly), and `CEFilterApp._loadPicks()` at the top of `init()`, sanitized by `Validator.validatePicks` then `CEById.has`. The match mode survives together with the picks — `renderResults` forces it back to `all` below 2 selected CEs. `matchCustomCounts`, class/rarity filters, search and page still reset on refresh. So does nothing else on the sub-tab axis: `_switchSubTab()` is the one point every sub-tab change reaches (the `#cefilterSubtabs` click handler and `selectCEFromCombo`), it writes `subTab` there, `_loadPicks()` restores it (anything but `"servant"` becomes `"ce"`), and the last line of `init()` is `_switchSubTab(this.state.subTab)` instead of a bare `render()` — the markup ships with the `ce` panels visible, so the restore is what un-hides `servant`, and `ce` still renders through it.
  - No swap may be visible on refresh, and **Chrome paints while it parses**, so a body script cannot win: an `is:inline` script placed after the sub-tab buttons still ran at t=920 ms against first-paint 780 / FCP 848 under 20× CPU throttling with chunks delayed 1500 ms. The pre-paint mechanism is CSS plus one head attribute. The existing `is:inline` LCP/`data-tab` script (`src/layouts/BaseLayout.astro`) also parses `fgo_ce_filter_data` and sets `data-subtab="servant"` on `<html>` (nothing in the repo uses partial-match `[data-tab*=]` selectors, so the two attributes cannot collide), and two rules — kept in the site's only stylesheet, the `<style is:inline>` in `BaseLayout.astro`, right after `.cefilter-subpanel[hidden]` — hide the `ce` panel and un-hide `servant` under `html[data-subtab="servant"]`. Specificity 0-3-0 beats `.cefilter-subpanel[hidden]` (0-2-0), so it wins from the first paint; measured proof is that the `ce` panel's computed `display` is `none` the instant it enters the DOM. `hidden` itself does work here (the shipped CSS declares no other `.cefilter-subpanel` rule) — it just cannot act before any script runs
  - `_switchSubTab()` sets `document.documentElement.dataset.subtab = sub` alongside the panels' `hidden`, so CSS and JS cannot disagree: `"ce"` leaves the override rules unmatched and `hidden` governs, `"servant"` matches them and they say the same thing. Markup default stays `<div class="cefilter-subpanel" data-subpanel="servant" hidden>` (no-JS users get Craft Essence Select, the documented default) and must stay in sync with `_loadPicks()`'s `"ce"` fallback. The **buttons** are the one part still JS-only — `.active` is a class carrying the pill styling, and reproducing it from `html[data-subtab]` would mean duplicating the `.tab-btn` rule set under a second selector — so a small `is:inline` script immediately after `#cefilterSubtabs` (`src/pages/index.astro`) reads the head attribute and flips `.active`/`aria-pressed`, the earliest point the buttons exist — sampled every `requestAnimationFrame` (rAF runs before that frame paints) at 20× CPU throttling with chunks delayed 1500 ms: 517 frames, none showed the wrong highlight, so the row appears already correct
- `_switchSubTab()` writes `subTab` to `CEFilterStore` **only when the value changed**, because `init()` calls it with the saved value and a plain write would touch localStorage on every page load. A first-ever visit therefore leaves the key without a `subTab` field at all — `_loadPicks()` treats that as `"ce"`
- Two guards keep this from rotting silently, since `.astro` is linted by nothing and the mechanism is spread over four files: `scripts/check_build_output.js` pins the exact set of `.cefilter-subpanel` display rules in both stylesheet texts (`dist/index.html`, `BaseLayout.astro`) as an *assertion* — `--write` refuses to absorb it — and `scripts/verify_render.js` reloads with `subTab: "servant"` stored and fails if any panel's computed `display` is wrong at the instant it is first parsed, if `<html data-subtab>` is missing afterwards, or if a `.cefilter-subtab-btn` has `.active` and `aria-pressed` disagreeing
- **Servant Select**: unlimited picked servants (chips, not slots). Every match-cache entry of a picked servant is its own member, so a multi-ascension servant whose ascension groups match different CE sets is split into one badge per group, portraited like that group's Craft Essence Select card but **image only** — no blue `.cefilter-ascension-label` text under the badge, the ascension and spiritron names stay in `title`/`alt`; picking still needs no ascension choice (`ServantSelector.open(..., { skipAscension: true })`). Output = one row per distinct CE list, each carrying the maximal member group that shares it (a servant split across forms can appear twice in one row), rows needing ≥2 servants, sorted CE count desc then servants desc; sections with no rows never print; below two picks `#cefilterComboEmpty` gives instructions instead of a result (`ServantSelect._paintNotes`, the same element as the no-rows message) — "Add two or more servants…" at zero, "Add one more servant…" at one, so the card never sits blank under its own title — and `#cefilterComboUnshared` stays hidden there, because naming a loner as sharing nothing needs two to compare; a servant in no row is named in `#cefilterComboUnshared`; enumeration stops at `ServantComboCalculator.MAX_COMBO_NODES` and shows `#cefilterComboTruncated`. Clicking a CE hands over to Craft Essence Select with it selected (`CEFilterApp.selectCEFromCombo`). `Clear all (N)` (`#cefilterServantClearBtn`, `.cefilter-add-btn--clear`) sits beside Add Servant and hides at zero picks; `ServantSelect.render()` resets `visibleCards` on every pick change and on sub-tab entry (`_paintResults`, which "Show N more" calls, does not); restored ids are filtered by `Validator.validatePicks` (`/^\d{3,}$/`, deduped) then `ServantData.getServant()`
- **Craft Essence Select** chips (`#cefilterChips`) are portrait only like the Servant Select ones — no name `span`, the CE name stays in `img alt` and the remove button's `aria-label`; `Clear all (N)` (`#cefilterClearBtn`, `CEFilterApp.clearAllCEs()`) sits beside Add Craft Essence, hides at zero picks and resets `currentPage`. CE picks and the match mode survive a refresh (`cePicks`/`ceMode`), class/rarity filters, match-count selection, search and paging still reset
- `src/scripts/domain.js` exports `ServantComboCalculator.buildSharedCEGroups(entries, pickedIds)` → `{ groups, unshared, truncated }`; `src/scripts/ce-servant-select.js` (in `ce-filter-chunk`) is its only view
- Match modes: All (AND), Any (OR), Custom Match (exact CE match count)
- Dedicated "Filter Settings" popup modal (`#cefilterFilterModal`) with 48×48px class buttons, 48×36px rarity buttons (`.rarity-btn`, 5★–0★), and CE match count buttons (`.ce-count-btn`, 0–5 CE)
- Direct servant search bar positioned statically above controls row (`#cefilterSearchInput`)
- Direct search bar in "Add Craft Essence" modal (`#ceFilterPickerSearch`)
- Mobile 2-per-row grid layout on screens <580px (`.grid-sm`: `repeat(2, minmax(0, 140px))`)
- Grayscale indicator for CEs with no ascension-level overlap
- Class/rarity filters auto-hide when no matching servant exists
- Clickable CE badges, overlap modal (click servant portrait → other servants sharing same CEs)
- Paginated results, page state persists on refresh
- Spiritron costume labels: stage costumes with a trait diff (e.g. 444 "Earth President") label their own stage group via `getAscensionLabel`; label-only costumes (e.g. 388 "Serious Mode", no `300` in `traits`) are appended by `ServantData.getSpiritronLabel()` when a spiritron CE (trait `2780`) matches the base group — combined as "1st Ascension / 2nd Ascension / Serious Mode"

**Shell / Layout:**
- Wide-screen magnification: a `BaseLayout.astro` head inline script sets `zoom` on `<html>` to `max(1, min(window.innerWidth / 1400, 2))` and re-applies on `resize`. A window up to 1400 CSS px is untouched — so a 1366 laptop gets nothing; past that the layout viewport is pinned to 1400 and scaled, so the 1120px content rail (80% of the width), the 160px cards and all type grow together at the ratios a real 1400 window shows — 1920 renders at 1.371x, 2560 at 1.829x, and 2800 plus wider at the 2x cap (so an ultrawide keeps a 2240px-wide column and gains only margin). The cap exists so text stops doubling on 4K/8K panels; raise `MAX` to fill them. `W` was 1280 first, which magnified harder (1920 at 1.5x, cap reached at 2560); the owner moved it to 1400.
  - It reads `window.innerWidth`, never `documentElement.clientWidth`, because `clientWidth` is already divided by `zoom` once the factor is applied — recomputing from it on the next `resize` yields the wrong factor (`clientWidth` is only the fallback when `innerWidth` is missing).
  - Chrome multiplies viewport units by `zoom`, so a `vh`-sized box would overshoot the real screen: `--screen-h` (`innerHeight / zoom`, declared `100vh` in `:root`) replaces `100vh` on `body{min-height}`, `80vh` on `.servant-modal-content{max-height}` and `calc(80vh - 80px)` on `.cefilter-modal-body{max-height}` in the shipped `<style>`. Any future viewport-unit length must go through `--screen-h`. At zoom 1 the variable equals `100vh`.
  - Nothing else keys off width above 1120: no media query tier exists past `@media (width >= 1120px)`, and the two JavaScript `window.innerWidth` staircases (`CEFilterApp._getPageSize()` in `src/scripts/ce-filter-app.js`, the LCP preload `matchMedia("(min-width:1120px)")` in `BaseLayout.astro`) top out at 1120 as well, so every magnified window resolves the same 6-across tier and the same 30-card page. Measured at 1400 base: card 160 → 219 → 293 → 320 device px and servant name 11.2 → 15.4 → 20.5 → 22.4 device px at 1280 / 1920 / 2560 / 3840, with no horizontal overflow at any size.
  - `scripts/verify_render.js` runs its CSS-px assertions at Puppeteer's default 800x600, where this script does nothing; only its last block (the bond slot label) changes viewport, to 320 / 800 / 1120 px, and puts 800x600 back after itself.
  - This is the magnification approach that `.claude/docs/fluid-desktop-layout-design.md` and `-plan.md` argued against and left unbuilt; see the status note at the top of each.
- Stale-tab new-version prompt: `BaseLayout.astro` inline script conditional-GETs its own URL (30s interval + `focus`), caches the ETag in sessionStorage (`fgo_build_etag`), and shows a fixed-bottom "A new version is available" banner with Reload when a new build deploys. Skips localhost. (Client-side — distinct from the CI-side ETag build gate below.)

## Build & Dev

```bash
npm run dev        # Astro dev server (localhost:3000)
npm run build      # Production build → dist/
npm run preview    # Serve dist/ locally (localhost:3000)
npm run test       # node --test tests/**/*.test.js — pure-domain unit tests, no browser
npm run lint       # ESLint (src/scripts/) — no CSS linter: the site ships no .css file
npm run format     # Prettier (src/scripts, tests, *.mjs)
npm run format:check # Check formatting without writing
npm run data:sync  # Sync latest servant & CE data from Atlas Academy
npm run data:validate # Validate data schema, traits format, and image existence
npm run check:build # Assert dist/ against scripts/build_baseline.json (exit 1 on drift)
```

`predev`/`prebuild` run `scripts/ensure_data.js` — on a fresh clone it auto-runs `npm run data:sync` if generated data files are missing.

**Build-output gate** (`scripts/check_build_output.js` + `scripts/build_baseline.json`, run in CI between Build and Pages upload): asserts the chunk names the lazy tabs and the worker resolve, byte floors and 3x ceilings per chunk, `<head>` marker order (critical CSS → font preloads → inline poller scripts), and two page-text signatures — raw keeps the whitespace between adjacent inline elements, normalised collapses it, so a raw-only difference means a whitespace change. `--write` re-captures the measurements after an intentional change and refuses to run when a chunk is missing or a head marker moved.

**Browser gate** (`scripts/verify_render.js`, local only — kept out of CI because it needs a Chromium download on a 10-minute schedule, and tracked on `develop` alone, so a `main` clone cannot run it): drives the production build with Puppeteer and asserts lazy tabs actually fetch, the CE worker returns results, critical CSS paints, and the `fgo_build_etag` poller is present. Last block fills one bond slot and asserts the point box's label text (`Next Lv. Required`), that no label clips, and that the page does not scroll sideways at 320 / 800 / 1120 px; it restores the 800x600 default afterwards, so the assertions above it keep their CSS-px numbers. Serve first: `npx astro preview`, then `node scripts/verify_render.js`.

### Lighthouse Audit

No npm script and no project dependency — run it ad hoc against a served build: `npx lighthouse <url>`. The old `npm run lighthouse` invoked `lighthouse-runner.js`, which `.gitignore` lists as a temp/test file and which does not exist in either clone, so the script was broken and the `lighthouse` devDependency (1,616 lockfile lines) bought nothing; both are removed. `node_modules/lighthouse` may still be on disk until `npm prune`.

## Tech Stack

- **Astro 7** (static output, no SSR, base path `/fgo-calculator/`) — requires **Node >= 22.23.4** (`.nvmrc`, `package.json` `engines`, CI `node-version-file: .nvmrc`)
- **Vite 8** bundler, which means **Rolldown**, not Rollup — chunk layout is `vite.build.rolldownOptions.output.codeSplitting.groups`
- **Vanilla JS ES modules** (no frameworks, no TypeScript at runtime)
- **Self-hosted fonts**: DM Sans + Space Mono (woff2 in `public/fonts/`)
- **PWA**: manifest.json (standalone mode, start_url: ".")

## Architecture

3-layer architecture via ES modules:

| Layer | Modules | Role |
|-------|---------|------|
| **Domain** | Schema, Validator, Calculator, TraitMatcher, ServantComboCalculator | Pure business logic, no DOM |
| **Application** | StateManager, Persistence, BondApp, CEFilterApp, EventShop App | State coordination |
| **Presentation** | DOMFactory, selectors, modals, UIBuilder | DOM manipulation, events |

### Key Files

- `astro.config.mjs` — Vite chunk splitting config (`data-chunk`, `selectors-chunk`, `ce-filter-chunk`, etc.)
- `src/layouts/BaseLayout.astro` — HTML shell, critical CSS, font preloads, Trusted Types policy
- `src/pages/index.astro` — Main page structure, imports all JS modules
- `src/scripts/main.js` — Entry: `DOMContentLoaded` → lazy tab init via `import()`
- `src/scripts/domain.js` — Trait matching logic, calculator
- `src/scripts/data.js` — Re-exports from `data/` directory
- `src/scripts/bond-app.js` — Bond Calculator controller
- `src/scripts/ce-filter-app.js` — Bond Gain CE controller (Web Worker for matching)
- `src/scripts/ce-servant-select.js` — Servant Select sub-tab view (`ServantSelect`), the only consumer of `ServantComboCalculator`, and the home of `CEFilterStore` (`read()`/`write(patch)`), which keeps it the only Bond Gain CE module touching localStorage — `CEFilterApp` imports the store instead of using `localStorage` itself
- `src/scripts/event-shop.js` — Event Shop controller

### Lazy Loading

Bond and Event tabs load on-demand via dynamic `import()`:
- `bond-lazy.js` — Loaded on first Bond tab visit
- `event-lazy.js` — Loaded on first Event tab visit

Bond Gain CE uses Web Worker (`ce-match-worker.js`) for trait matching off main thread.

### Worker Config

- Worker format: ES modules (`vite.worker.format: "es"` in `astro.config.mjs`)
- Worker inlines `TraitMatcher` from domain.js for off-main-thread computation

### Performance Patterns

- **content-visibility: auto** — skips rendering off-screen servant/CE grids
- **Double rAF yield** — `requestAnimationFrame(() => requestAnimationFrame(() => {...}))` before heavy DOM ops
- **Font loading**: `font-display: swap` for body text, `font-display: optional` for monospace (prevents FOIT)
- **CLS prevention**: `min-width` + `tabular-nums` on numeric inputs, explicit image dimensions
- **Critical CSS**: there is no separate stylesheet at all — `src/layouts/BaseLayout.astro` holds the entire site CSS as one `<style is:inline>` line and `dist/` ships exactly one `<style>` block plus zero `.css` assets. `src/styles/` was deleted on 2026-11-04, so that block is now the only place CSS exists. See Known Issues
- **Font preloads**: `fetchpriority="high"` on woff2 files
- **Lazy tab init**: Bond/Event tabs load JS only on first visit
- **CE match cache**: `CEFilterApp._allCEMatchesCache` — populated on first filter, computed in Worker

## Code Style

- **JS**: ES modules, 2-space indent, semicolons required, **double quotes** (Prettier enforces)
- **CSS**: BEM-ish class names (`servant-slot--frontline`), CSS custom properties for theming
- **File naming**: kebab-case (`ce-filter-app.js`, `bond-lazy.js`)

### Lint & Format Config

**ESLint** (`eslint.config.js`):
- `semi: ["error", "always"]` — semicolons required
- `no-unused-vars: ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]` — prefix unused with `_`
- `prefer-const: "warn"`, `no-var: "error"`

**Prettier** (`.prettierrc`):
- `singleQuote: false` (double quotes), `trailingComma: "all"`, `printWidth: 120`, `endOfLine: "lf"`

**TypeScript** (`tsconfig.json`):
- Extends `astro/tsconfigs/strict` — strict mode enabled

### DOM Safety
- **Never use `innerHTML`** — use `createElement()`, `textContent`, `setAttribute()`
- Heavy renders: `DocumentFragment` → `replaceChildren()` once
- Below-fold images: `DOMFactory.createLazyImg()` with `loading="lazy"`
- Above-fold small icons: plain `<img>` without lazy

### State Management
- Plain objects with immutable spread updates
- Persist to localStorage on meaningful changes
- Sanitize on load via key allowlists (see `Validator.validateStorageData()`)

### Debounce
- Inputs: 100ms (`DEBOUNCE_MS`)
- Filter renders: 50ms

## Data Layer

- `src/scripts/data/*.js` export `const` — bundled by Vite, not runtime fetch
- Bond point tables: `src/scripts/data/bond_growth.js` exports `BOND_TABLES` (`{ "tN": [16 ints] }`) + `BOND_TABLE_BY_SVT` (`{ "002": "t1" }`) — 471 playable servants share only 76 distinct tables, so the map is deduped instead of 16 numbers per servant (~18 KB vs ~56 KB in the eagerly loaded `data-chunk`). **Atlas `bondGrowth` is a running total from Lv.0** (Altria `3000, 9125, 15250, …`); `sync_bond_growth()` differences it, so the shipped array is per level step — `table[1]` = 6,125 = Lv.1→Lv.2. Read it only through `ServantData.getBondGrowth(id)` (resolves `"467-1"` to `"467"`); `SERVANT_DATA` entries carry no bond field, which is also why bond changes never rewrite `servants.js` or trip the trait-drift full-replacement path
- Trait IDs: 4-digit zero-padded strings (`"0100"` = Saber, `"0002"` = Female)
- Servant multi-ascension: `traits: {"base": [...], "000": [...], "001": [...]}` — diff arrays merged at runtime
- Extra individualities: Atlas keeps some always-on traits out of `traits` — `sync_atlas_data.py` merges permanent `traitAdd` entries (`condType: "none"`, `eventId: 0`, id > 1000) into base and every stage set. Event/quest-gated entries stay out; the id > 1000 filter keeps Mash's class-form entries (`idx` = classId, carrying another form's rarity) out. `"2821"` reaches 22 servants only this way (314/334 Koyanskaya among them); the old `cno == 238` hardcode is gone
- CE match modes: OR (default), AND (`matchAll: true`), AND-of-ORs (`traitGroups`), override (`alsoMatch`)
- New CE fields: whitelist in `CEList` IIFE (`src/scripts/data.js`)
- New servant fields: handle in `ServantData.load()` (`src/scripts/data.js`)

### Adding Data

1. Trait IDs: sort ascending in arrays
2. New trait: add to `TRAIT_DATA` (`src/scripts/data/traits.js`) with display name
3. Servant images: `public/servants/{ID}/{ascension}.webp`
4. CE images: `public/craft_essences/{ID}.webp` (bordered 142×155, unified for all display sizes)

## Deployment & CI/CD Pipeline

- **Branch flow**: `feat/*` → `develop` → `main`, but **`develop` is local-only** (unpublished 2026-11-03: `origin` carries `main` alone). CI never needed it — the workflow triggers are push to `main`, the 10-minute schedule, and `workflow_dispatch`. A bare `git push` on `develop` now errors with "no upstream branch", which is the guard; re-publish with `git push -u origin develop` if you ever want it on GitHub again.
- **The docs and the local-only browser gate never reach `main` (owner decision 2026-11-04; the gate joined 2026-11-05).** `.claude/CLAUDE.md`, `.claude/docs/**`, `AGENTS.md`, `GEMINI.md` and `scripts/verify_render.js` are tracked on `develop` only — `main` is the public repo GitHub Pages deploys from, those files name local paths and the two-clone workflow, and CI never runs the gate. `scripts/fetch_bordered_ces.py` stays public: `sync_atlas_data.py` imports it inside a `try` and the CI sync step runs that. Ship code with **`scripts/merge_code_only.sh [source]`** (default `develop`): `git merge --no-ff --no-commit`, then `git rm -r -f --cached .claude AGENTS.md GEMINI.md scripts/merge_code_only.sh scripts/verify_render.js` (the script hides itself too) before the commit, then an assert that `main`'s tree holds none of them. `--cached` leaves the files on disk as ignored untracked, which only works while `main`'s `.gitignore` carries a rule for every one of them (the bare `.claude` line plus `scripts/merge_code_only.sh` and `scripts/verify_render.js`) — the script restores `main`'s file instead of taking `develop`'s, checks each path with `git check-ignore --no-index`, and prints a note when the two branches disagree on `.gitignore`, since a code-relevant ignore line then needs porting by hand; `-f` also settles the `modify/delete` conflicts every merge after the first raises for a doc file `main` deleted and `develop` edited. It refuses a dirty tree, a stale local `main`, or an unresolved **code** conflict (exit 1, merge left in progress — fix and `git commit`, or `git merge --abort`), and it never pushes. A bare `git merge develop` into `main` is still forbidden: it drags the whole doc tree with it (this happened and was undone with `git reset --hard origin/main` before any push), and so does `git pull origin develop` (same merge) or `--no-ff`/`-X ours` (flags change commit shape and conflicting hunks only, never the one-sided doc additions). You cannot commit by pathspec mid-merge — `git commit -- src tests` dies with `fatal: cannot do a partial commit during a merge.` — so the drop-the-docs denylist is the only merge route. Cherry-picking code commits onto `main` stays fine.
- **Pages source**: GitHub Actions (not branch-based)
- **Zero Committed Images**: `public/servants/` and `public/craft_essences/` are gitignored. Assets are synced dynamically at build time and cached with `actions/cache@v4`.
- **Triggers**:
  - Push to `main` (always builds & deploys to Pages)
  - Every-10-min schedule (version-gated; syncs + revalidates via ETag; build is skipped when no data changed)
  - `workflow_dispatch` (manual run with optional `force_sync` input)
- **ETag revalidation + build gate**: `sync_atlas_data.py` revalidates cached JSON with conditional GETs (304 = ~0 bytes idle). CI hashes the three generated data JS files vs the previous run (`.ci-baselines/data_hash.txt`, see version-baseline cache below); the build/validate/deploy steps are skipped on a `schedule` run when the hash is unchanged. Push/dispatch always build. `force_sync` passes `--force` to bypass the cache.
- **`/info` version gate**: before any env setup or sync, one ~230-byte `GET /info` compares JP **and** NA `hash` with `.ci-baselines/data_version.txt`. Idle `schedule` runs stop green on `UNCHANGED` (~15s); push/dispatch/`force_sync` always continue. Network/parse failures report `UNKNOWN` and fall through to the full sync.
- **Version baseline cache**: the two gate baselines (`data_version.txt`, `data_hash.txt`) live in `.ci-baselines/`, round-tripped by `actions/cache/restore@v4` + `actions/cache/save@v4` keyed `fgo-version-baseline-${{ github.run_id }}-${{ github.run_attempt }}` (save step after `Upload Pages artifact`; save `if` gated on push/`CHECK==CHANGED`/`DATA_DIRTY==true`). Lesson: `actions/cache` never re-saves a blob on an exact-key hit — mutable CI state kept inside a script-keyed asset cache freezes, so every run after a real data change re-detected `CHANGED` forever (dispatch runs #60/#61, 2026-10-20). A run-unique key always misses, so save persists; `restore-keys` picks the newest entry. `run_attempt` in the key is required: `run_id` is stable across `gh run rerun` and `cache/save` hard-fails on an existing key.
- `dist/` is gitignored — CI generates it

## Known Issues

- **CSS has a single home now: the `<style is:inline>` in `BaseLayout.astro`.** `src/styles/global.css` and `src/styles/critical.css` were deleted on 2026-11-04 and the directory is gone, so there is no second copy to keep in step and no `npm run lint:css`. They were never loaded (no Astro CSS entry, `dist/` ships zero `.css` files), and their hand-maintained drift had already cost the live site: `.cefilter-sort-order-btn:active { background: var(--bg) }` existed **only** in `global.css`, so the sort-direction button had no press state — that rule is now ported into `BaseLayout.astro`. Two other measured differences were left exactly as the shipped copy has them, because the shipped copy is the correct one: `#panel-cefilter > .card:first-child .card-inner { position: relative }` stays unconditional (the dead file wrapped it in `@media (width >= 760px)`), and font `src` URLs stay `fonts/…` relative (the dead file had `/fonts/…`, which breaks under the `/fgo-calculator/` base path). Stylelint, `.stylelintrc.json` and both stylelint devDependencies went too — it was linting CSS that never reached a browser. `scripts/check_build_output.js` now pins the `.cefilter-subpanel` display rules across two texts (`dist/index.html`, `BaseLayout.astro`) instead of three. The last known difference is unmeasured: nothing checks that a rule added to `BaseLayout.astro` is the rule the site wanted, only that the sub-tab display set survives
- `.claude/` is only half ignored — `.gitignore` says `.claude/*` and negates `.claude/CLAUDE.md` and `.claude/docs/`, so the handoff docs plus the root `AGENTS.md` / `GEMINI.md` are tracked and reach CI or a fresh clone; `settings.local.json` and anything else new under `.claude/` stays local. Do **not** collapse this back to a bare `.claude` line: git cannot re-include a path under an excluded directory, so the negations would stop matching and the docs would silently un-track (`git check-ignore -v .claude/CLAUDE.md` says nothing when it is right)
- **`astro build` fails on Astro >= 6 anywhere under `/mnt/storage` (this repo's mount, `ntfs3`)**, in the working copy and in a fresh clone alike: Vite's client-environment dependency optimizer runs at build time here, bundles Astro's own `astro/runtime/client/dev-toolbar/entrypoint.js`, and dies with `[MISSING_EXPORT] "loadDevToolbarApps" is not exported by "node_modules/astro:toolbar:internal/dist/index.js"`. Identical tracked files, identical `node_modules` (424 packages, byte-identical Astro), cold caches: builds fine on tmpfs, fails here. `devToolbar: { enabled: false }` does not help — the include list that names the entrypoint is unconditional in Astro's environment config. GitHub's runners do **not** hit it: CI run 41594463380 built Astro 7.4.5 green on 2026-11-03 (`build` + the `Check build output` step, `self-test`, `deploy`), so this is a local-mount defect only, and the live site passed `node scripts/verify_render.js`.
- **`__vite__injectQuery has already been declared` in the browser console on localhost:3000 is this same mount, not the Astro version** — it reproduces on a cold `node_modules/.vite` with Astro 5.18.2 + Vite 6.4.2 and with Astro 7 + Vite 8, from an optimized-dep chunk (`node_modules/.vite/deps/`). The page still works: cards, slots and pagination all render.
- **Working arrangement (chosen 2026-11-03): build and run dev from `/home/famakung/dev/fgo-calculator`** (`cd` there first — `astro` is a project-local bin, so use `npm run dev` for the server (`package.json` passes `--port 3000`, and `astro.config.mjs` now sets `server.port`/`preview.port` to 3000, so a bare `npx astro dev` lands on 3000 too; an explicit `--port` still wins, which is what the browser gate's 4173 relies on) and `npx astro dev status|logs|stop` for the daemon controls), a clone of `develop` on btrfs whose `origin` is GitHub. Everything works there on Astro 7 — `npm run build`, `npm run check:build`, `npm run lint`, the browser gate (`npx astro preview`, then `node scripts/verify_render.js`), and `npm run dev` with zero page errors. This `/mnt/storage` checkout stays the editor-side copy: `package.json` and the lock declare `^7.4.5`, `node_modules` here holds Astro 5.18.2 installed with `--no-save` so a dev server still runs, and it is the copy that shows the `__vite__injectQuery` console error. Two clones means two git dirs: commit and push from the native one, then `git -C /mnt/storage/Dev/Projects/fgo-calculator pull` to catch the editor copy up.
- Astro 7 makes `astro dev` and `astro preview` **detached daemons**: the command returns immediately and the server keeps running. Controls are `astro dev stop|status|logs` and `astro preview stop|status|logs`. A second `astro preview --port N` prints `already running at <first port>` and exits 0 instead of serving N, so `npm run preview` no longer binds the server to your terminal.
- Generated data is gitignored, so a fresh clone needs `src/scripts/data/*.js`, `public/servants/` and `public/craft_essences/` copied in (or `npm run data:sync`) before `prebuild`'s `ensure_data.js` will stop trying to sync.
- Node: the default runtime is now **v22.23.4** — upgraded in place inside `~/.local/node` (`~/.local/bin/node` is the symlink that puts it on `PATH`), so no `PATH=` prefix is needed anywhere. The old 22.14.0 files sit in `~/.local/node-22.14.0-backup/` (`bin/node`, `lib/node_modules/{npm,corepack}`) and the tarball copy remains at `~/.local/node-v22.23.4/`. Roll back by moving those three paths back into `~/.local/node`. `npm` only *warns* on `EBADENGINE`, so always check `node --version` before trusting a build.

## Common Patterns

### Pending Slot
Add servant/CE → push `null` to state → open modal for selection → cancel removes null entry

### CE Match Cache
`CEFilterApp._allCEMatchesCache` — populated on first filter, computed in Worker

### Tab Init
Head inline `<script>` sets `data-tab` on `<html>` and preloads LCP images before DOMContentLoaded

### Trusted Types
`BaseLayout.astro` defines inline Trusted Types policy (`default`) in `<head>` before any scripts load. All DOM sinks (`innerHTML`, `insertAdjacentHTML`, etc.) require policy-wrapped values.
