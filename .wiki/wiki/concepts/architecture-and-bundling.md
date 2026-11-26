---
title: "Architecture and Bundling"
category: concept
sources:
  - raw/notes/2026-11-24-legacy-claude-md.md
  - raw/notes/2026-11-24-legacy-structure.md
  - raw/notes/archive/2026-11-02-astro-7-migration.md
  - raw/notes/archive/2026-11-03-astro7-migration-ledger.md
  - raw/notes/archive/2026-11-04-fluid-desktop-layout-design.md
  - raw/notes/archive/2026-11-04-fluid-desktop-layout-plan.md
created: 2026-11-24
updated: 2026-11-24
tags: [architecture, astro-7, vite-rolldown, bundling, lazy-loading, css-layout]
aliases: [3-Layer Architecture, Astro 7 Bundling, Rolldown Code Splitting]
confidence: high
volatility: warm
summary: "Defines FGO Calculator's 3-layer vanilla JS architecture, Astro 7 / Vite 8 Rolldown chunk splitting, lazy tab loading, single inline CSS strategy, and wide-screen magnification layout. Also documents the native btrfs vs ntfs3 build environment constraint and code-only branch shipping."
---

# Architecture and Bundling

> FGO Calculator is a static Astro 7 site deployed to GitHub Pages using vanilla ES modules, zero runtime frameworks, and a strict 3-layer separation across four calculator tabs. All styles ship in a single inline `<style>` block, heavy tabs load lazily via dynamic `import()`, and trait computation runs off the main thread in an ES-module Web Worker.

## Three-Layer Module Architecture

Source modules under `src/scripts/` follow a strict three-layer dependency boundary:

| Layer | Key Modules | Responsibility |
|-------|-------------|----------------|
| **Domain** | `domain.js` (`Schema`, `Validator`, `Calculator`, `BondLevelCalculator`, `TraitMatcher`, `ServantComboCalculator`, `SlotCEs`, `Teapot`, `Quest`, `ServantFilters`, `ServantSort`, `EventShop`, `cascadeYields`, `spendSurplusUpChain`) | Pure calculation, validation, filtering, and sorting logic; never touches `document` |
| **Application** | `state.js`, `bond-app.js`, `ce-filter-app.js`, `ce-servant-select.js`, `servant-info-app.js`, `event-shop*.js`, `event-planner*.js` | State coordination, `localStorage` persistence, and tab lifecycle; circular dependencies broken via callback injection in `main.js` |
| **Presentation** | `presentation.js` (`DOMFactory`, `CollapsibleFactory`, `ComboCardRenderer`), `selectors.js`, `filter-sections.js`, `tab-navigator.js` | DOM creation, event binding, and modal pickers receiving callbacks (`onSelect(slotIndex, id, ascensionOrOptionId)`) at `open()`/`init()` |

## Astro 7, Vite 8 / Rolldown Chunking, and Lazy Loading

Upgrading from Astro 5.18 to Astro 7.4.5 (requiring Node `>= 22.23.4` pinned in `.nvmrc`, `package.json` `engines`, and CI) moved bundling from Rollup to Vite 8 / Rolldown. Because Rolldown removed `build.rollupOptions` and deprecated `output.manualChunks` (which silently dropped 4 of 6 named chunks in Astro 7), `astro.config.mjs` defines `vite.build.rolldownOptions.output.codeSplitting.groups` using path-anchored regexes (`/\/name\.js$/`) and descending `priority` values for first-match-wins resolution:

- **Eager chunks**: `constants-chunk`, `data-chunk` (shared datasets without swallowing nested `src/scripts/data/*.js` unintendedly), `shared-ui-chunk` (`servant-filters.js` extracted from `domain.js` + `filter-sections.js` + `presentation.js`, keeping `selectors-chunk` off `servantinfo`), `selectors-chunk`, `tab-navigator-chunk`, `ce-filter-chunk`, and `main-entry` (the anchored regex also fixed an earlier `includes("main.js")` bug that accidentally pulled `domain.js` into `main-entry`).
- **Lazy tab entry points & modulepreload**: `main.js` keeps only `constants.js`, `data.js`, and `tab-navigator.js` static, detects `activeTab` at module top-level, and starts memoized dynamic `import()` loaders immediately for the active tab (`ce-filter-app.js` + `selectors.js`, `servant-info-lazy.js`, `bond-lazy.js`, or `event-lazy.js`). `TabNavigator.init()` also triggers those loaders on `pointerover`/`focusin` over `.tab-btn` and `.navbar-dropdown-item`. `astro.config.mjs`'s `astro:build:done` integration injects `<link rel="modulepreload">` for boot chunks plus active-tab lazy chunk(s) into `dist/index.html` to flatten the JS waterfall.
- **Web Worker bundling**: `vite.worker.format: "es"` emits `ce-match-worker.js` as a standalone ES-module chunk with `TraitMatcher` inlined, spawned by `CEFilterApp` after a double-`rAF` yield to populate `_allCEMatchesCache` off the main thread.

## Head Script Order and Single Inline Stylesheet

`src/layouts/BaseLayout.astro` controls the exact `<head>` execution order verified by `npm run check:build`:

1. **`<style is:inline>`**: The site's sole stylesheet (CSS tokens, reset, responsive rules, and every component selector). `src/styles/global.css` and `critical.css` were deleted on 2026-11-04 after stylesheet drift caused live regressions; `dist/` emits zero `.css` files. Native system font stacks (`system-ui`, `ui-monospace`) eliminate web font downloads and FOUT/FOIT shifts.
2. **Inline `<script>` guards** (see [[security-and-dom-safety|Security and DOM Safety]] ([Security and DOM Safety](../concepts/security-and-dom-safety.md))): Trusted Types `'default'` passthrough policy, legacy Service Worker / `CacheStorage` cleanup, and the `fgo_build_etag` stale-tab poller (every 30s and on `focus`, skipping `localhost`).
3. **Pre-paint tab & LCP script**: Reads `localStorage` to set `data-theme`, `data-tab` (defaulting to `servantinfo` when unset/invalid across `index.astro`, `BaseLayout.astro`, `astro.config.mjs`, `main.js`, and `tab-navigator.js`), `data-subtab`, `data-bond-quest`, `data-bond-custom`, and `data-event-combo` on `<html>` before first paint, and injects `<link rel="preload">` tags for only the first visible row of `servantinfo` or plain `cefilter` (capping preloads prevents image requests from starving JS chunks).
4. **Shared progressive image paint**: `createProgressiveLoader(6)` and `DOMFactory.createDeferredImg` / `createDeferredSwapImg` in `src/scripts/presentation.js` pump deferred `<img>` `src` assignments at concurrency 6 with generation cancellation across Servant Info, Bond Gain CE (`cefilter` + `ServantSelect`), Bond Calculator slots/results, and Event Shop bonus CEs/modal rows, while `img:not([src]) { opacity: 0; }` prevents pre-load outline flashes.

## Desktop Scaling: Rejected Fluid Layout vs Shipped CSS Zoom

> **Status note (`supersedes`):** The 2026-11-04 fluid 1600px layout proposal (`archive/2026-11-04-fluid-desktop-layout-design.md` and `-plan.md`) — which proposed `repeat(auto-fill, minmax(160px, 220px))`, a 12px font floor, stepped root `font-size`, and a `GridColumns` domain helper — was **rejected** by the owner and never built.

Instead, the shipped site retains the 1120px content rail and scales wide desktop viewports via pure CSS zoom in `BaseLayout.astro`:

- Under `@media (min-width: 1400px)`, `html` applies `zoom: min(2, calc(100vw / 1400px))` (scaling fluidly from `1.0×` at 1400px up to a `2.0×` cap at 2800px+).
- `:root` sets `--screen-h: calc(100dvh / min(2, calc(100vw / 1400px)))` so fixed modals stay within `80vh` of physical screen height without JS resize listeners.

## Checkout, Environment, and Branch Shipping

- **Filesystem constraint**: Building and running dev/preview servers must happen in the native btrfs clone at `/home/famakung/dev/fgo-calculator`. Under `/mnt/storage` (`ntfs3`), Vite's client-environment dependency optimizer fails during `astro build` on `[MISSING_EXPORT] "loadDevToolbarApps"` and emits duplicate `__vite__injectQuery` console errors in dev.
- **Detached daemons**: Astro 7 runs `astro dev` and `astro preview` as detached background daemons (`stop|status|logs`); `npm run preview` binds port 3000, while `node tools/verify_render.js` targets `npx astro preview --port 4173`.
- **Branch shipping**: `develop` is local-only; `main` deploys to GitHub Pages via GitHub Actions. Because `.claude/`, `.wiki/`, `AGENTS.md`, `GEMINI.md`, `tools/`, and `tests/` belong only on `develop`, changes ship to `main` via `tools/merge_code_only.sh` (or cherry-pick) rather than a plain `git merge develop`.

## Key Config & Gate Files

- `astro.config.mjs` — Rolldown `codeSplitting.groups` and `vite.worker.format: "es"`
- `src/layouts/BaseLayout.astro` — inline `<style is:inline>`, Trusted Types, pre-paint `<head>` scripts, CSS `zoom`
- `src/scripts/main.js` — `DOMContentLoaded` default-tab boot and dynamic `import()` tab loaders
- `scripts/check_build_output.js` & `scripts/build_baseline.json` — `npm run check:build` bundle/HTML assertions
- `tools/verify_render.js` — local Chromium render gate; `tools/merge_code_only.sh` & `tests/merge-code-only.test.js` — `main` shipping gate

## See Also

- [[security-and-dom-safety|Security and DOM Safety]] ([Security and DOM Safety](../concepts/security-and-dom-safety.md)) — Trusted Types policy and head inline script invariants
- [[zero-commit-data-pipeline|Zero-Commit Data Pipeline]] ([Zero-Commit Data Pipeline](../concepts/zero-commit-data-pipeline.md)) — `check_build_output.js` baseline gate and CI deploy flow
- [[code-style-and-conventions|Code Style and Conventions]] ([Code Style and Conventions](../references/code-style-and-conventions.md)) — CSS tokens, breakpoints, and merge workflow details
- [[project-history-and-decisions|Project History and Decisions]] ([Project History and Decisions](../topics/project-history-and-decisions.md)) — chronological migration and architecture decisions

## Sources

- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — tech stack, architecture summary, checkout rules, and branch shipping
- [Project Architecture and Module Structure](../../raw/notes/2026-11-24-legacy-structure.md) — 3-layer breakdown, script load order, and Rolldown chunk list
- [Archive Plan: Astro 5 to 7 Migration](../../raw/notes/archive/2026-11-02-astro-7-migration.md) — Astro 7 / Vite 8 Rolldown migration plan and verification gates
- [Archive Ledger: Astro 7 Migration SDD Decisions](../../raw/notes/archive/2026-11-03-astro7-migration-ledger.md) — chunk shrinkage findings, ntfs3 mount root cause, and btrfs clone decision
- [Archive Design (Rejected): Fluid Desktop Layout](../../raw/notes/archive/2026-11-04-fluid-desktop-layout-design.md) — rejected 1600px fluid layout design superseded by CSS zoom
- [Archive Plan (Rejected): Fluid Desktop Layout](../../raw/notes/archive/2026-11-04-fluid-desktop-layout-plan.md) — rejected fluid implementation plan and CSS deletion notes
