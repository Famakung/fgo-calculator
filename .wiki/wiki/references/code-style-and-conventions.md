---
title: "Code Style and Conventions"
category: reference
sources:
  - raw/notes/2026-11-24-legacy-code-style.md
  - raw/notes/2026-11-24-legacy-structure.md
  - raw/notes/2026-11-24-legacy-claude-md.md
created: 2026-11-24
updated: 2026-11-24
tags: [code-style, eslint, prettier, css-conventions, state-patterns, git-workflow]
aliases: [Coding Conventions, CSS Tokens and Breakpoints, Merge Code Only]
confidence: high
volatility: warm
summary: "Reference for FGO Calculator's JavaScript formatting, ESLint/Prettier configuration, naming conventions, immutable state and UI patterns, single-home CSS tokens and responsive breakpoints, Astro directives, and code-only git merge rules."
---

# Code Style and Conventions

> FGO Calculator uses vanilla ES modules with 2-space indentation, double quotes, and strict DOM safety, paired with a single inline stylesheet in `BaseLayout.astro` and a denylist-based merge script keeping `develop`-only docs and tests out of `main`.

## JavaScript, Linting, and Formatting

- **Runtime**: Vanilla JS ES modules (`src/scripts/*.js`), zero frameworks, zero runtime transpilation; `tsconfig.json` extends `astro/tsconfigs/strict` for editor/tooling checks.
- **Prettier (`.prettierrc`)**: `singleQuote: false` (double quotes), `trailingComma: "all"`, `printWidth: 120`, `endOfLine: "lf"`, 2-space indent (`npm run format` / `npm run format:check` cover `src/scripts`, `tests`, and `*.mjs`; `scripts/` is formatted manually).
- **ESLint (`eslint.config.js`)**: `semi: ["error", "always"]`, `no-unused-vars: ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]`, `prefer-const: "warn"`, `no-var: "error"` (`npm run lint` covers `src/scripts/`; there is no CSS linter).
- **Naming**: `UPPER_SNAKE_CASE` constants (`SERVANT_MAX_SLOTS`), `PascalCase` objects/modules (`Schema`, `DOMFactory`, `TraitMatcher`), `camelCase` functions/methods, `kebab-case` filenames and CSS classes with BEM `--` modifiers (`servant-slot--frontline`), and 44-character section banners (`/* ===...=== Name ===...=== */`).

## State, Persistence, and UI Patterns

- **Immutable state & bounds**: Plain objects updated with immutable spreads, persisted to `localStorage` on meaningful changes, sanitized via allowlists (`Validator.validateStorageData` or `Validator.validatePicks`), and clamped with `Validator.clamp()`.
- **Debouncing & guards**: `DEBOUNCE_MS = 100` for numeric/text inputs, `50ms` for filter renders, `MAX_ITERATIONS = 10000` loop guard.
- **Pending slot pattern**: Adding a servant or CE pushes `null` into the state array before opening the picker modal; canceling splices out the `null` entry.
- **Single slot shape (`bond-app.js`)**: `defaultSlot(overrides)` is the sole definition of a Bond slot's fields (used by init, `removeSlot`, `onPendingRemove`, build fallback, and `loadState` sanitization). `Next Lv. Required` stays data-owned until manually typed, re-pricing only on `Current Lv.` or servant change.
- **Store isolation**:
  - `CEFilterStore.write(patch)` (`ce-servant-select.js`) performs read-modify-write on `CEFILTER_STORAGE_KEY` (`fgo_ce_filter_data`) so the `ce` and `servant` sub-tabs never overwrite each other's picks.
  - `EventPlanner.applyRequires(partial)` (`event-planner.js`) is the sole mutation path for `EVENT_SHOP_STORAGE_KEY` (`fgo_event_shop_data`), isolating per-event plans (`plans[eventId]`) and delegating modal edits to `EventShopModal` drafts.
- **Filtering & sorting**:
  - `FilterSections.renderRow(container, chips, selected, onToggle, opts)` (`filter-sections.js`) rebuilds every filter chip row from state (never patches individual chips), orchestrated by `FilterModalController`.
  - `ServantFilters.match(traits, filters)` evaluates union inside a row and AND across rows (`effectiveClassIds` for class locks). Filtering reads `getTraitsForAscension(id, ascension)` when a card/slot names an ascension, and `ServantData.getAllTraits(id)` (cached union) when no stage is specified—never `servant.traits` directly, which holds only the stage intersection.
  - `ServantSort.sorted(rows, sortBy, order, idOf, traitsOf)` (`domain.js`) is the single comparator for both the Servant Picker and `CEFilterApp` result cards (ID tie-break inherits sort direction).
- **Computation & lazy init**: `CEFilterApp` populates `_allCEMatchesCache` in `ce-match-worker.js` after a double-`rAF` yield; `DOMContentLoaded` in `main.js` wraps initial boot in `requestAnimationFrame`; Servant Info, Bond, and Event tabs initialize lazily via `import()`.
- **Modal stacking**: Base `.servant-modal` uses `z-index: 1000`; nested filter sub-modals (`#servantFilterModal`, `#ceOverlapFilterModal`) use `z-index: 1050` and appear after their parent modal in `src/pages/index.astro`.

## Single-Home CSS, Tokens, and Breakpoints

All visual CSS lives in the single `<style is:inline>` block in `src/layouts/BaseLayout.astro` (`src/styles/` was deleted on 2026-11-04; Astro emits zero `.css` files):

- **Core sizing tokens**: `--servant-portrait-h: 96px` (`aspect-ratio: 142 / 155`, ~88px wide), `--ce-badge-h: 48px` (`--ce-badge-w: calc(var(--ce-badge-h) * 142 / 155)`), `--slot-ce-h: 64px`, `--portrait-lg: 96px`, `.class-btn` (`48×48px`, img `40×40px`), `.rarity-btn` / `.ce-count-btn` (`48×36px`), `.servant-slot-badge-item` (`24×24px`), `.f-skill-icon` (`32×32px`), `.f-sg-img` (`max-height: 512px`), `.material-icon` (`96px` height, `aspect-ratio: 112 / 120`), `.farm-card-icon` / `.mini-icon` (`64px` height, overridden to `32px` inside `.farm-card .drop-line .mini-icon`).
- **CLS & off-screen rendering**: `.cefilter-servant-card` uses `content-visibility: auto; contain-intrinsic-size: auto 208px` (without `min-height: 208px`); `.drop-value` uses `min-width: 4ch; font-variant-numeric: tabular-nums`; `.farm-card--pre` skeletons and `<html data-*>` attributes prevent first-paint shifts.
- **Responsive breakpoints**: `580 / 760 / 940 / 1120` px:
  - `.container` max-width: `400 / 580 / 760 / 940 / 1120` px (above 1400px, `html` scales via CSS `zoom`).
  - `.card-inner` margin: `6.4 / 12.4 / 18.4 / 24.4 / 30.4` px.
  - `.servant-modal-content` max-width: `360 / 480 / 540 / 720 / 900` px (filter and 4-item sub-modals capped at `540px` at `>=940px`).
  - `.grid-sm`: `repeat(2, minmax(0, 140px))` under `580px`, `repeat(auto-fit, minmax(130px, 140px))` centered at `>=580px`.
  - Pagination (`CEFilterApp._getPageSize()`): `2 / 3 / 4 / 5 / 6` columns `× 5` rows across the same breakpoints.
- **Interaction states**: `:hover` must sit inside `@media (hover: hover)`, with `:active` placed after for touch devices; small tap targets extend hit areas via `::before`.

## Astro Directives and Git Shipping Rules

- **Astro conventions**: Use `import.meta.env.BASE_URL` for root-relative `<link>`/`manifest` paths; pass `IMAGE_VERSION` from `constants.js` into head preload scripts via `define:vars={{ v: IMAGE_VERSION }}` (never shadow `var v` locally); use `<script is:inline>` only for synchronous pre-paint tasks. Astro 7 runs `astro dev` and `astro preview` as detached daemons (`stop|status|logs`).
- **Code-only merge to `main`**: `develop` is local-only. Never run plain `git merge develop` or `git pull origin develop` into `main`. Always ship via `tools/merge_code_only.sh [source] "<commit_message>"` (which runs `git merge --no-ff --no-commit`, removes `.claude`, `.wiki`, `AGENTS.md`, `GEMINI.md`, `tools`, and `tests` from the merge index, preserves `main`'s `.gitignore`, and commits with an explicit message) or by cherry-picking code commits. Keep `.gitignore` partial negations (`.claude/*` + `!.claude/CLAUDE.md`) intact on `develop`.

## Key Config & Gate Files

- `.prettierrc`, `eslint.config.js`, `tsconfig.json` — formatting (`npm run format:check`), linting (`npm run lint`), and strict JS/Astro editor checks
- `tools/merge_code_only.sh` & `tests/merge-code-only.test.js` — code-only `main` shipping script and regression test

## See Also

- [[architecture-and-bundling|Architecture and Bundling]] ([Architecture and Bundling](../concepts/architecture-and-bundling.md)) — 3-layer architecture, Rolldown chunking, and CSS zoom scaling
- [[security-and-dom-safety|Security and DOM Safety]] ([Security and DOM Safety](../concepts/security-and-dom-safety.md)) — DOM safety sinks, Trusted Types, and input sanitization
- [[servant-info-system|Servant Info System]] ([Servant Info System](../topics/servant-info-system.md)) — `#servantInfoModal` DOM and option-parser contracts

## Sources

- [Code Style and DOM Conventions](../../raw/notes/2026-11-24-legacy-code-style.md) — JS formatting, state patterns, CSS tokens, and breakpoints
- [Project Architecture and Module Structure](../../raw/notes/2026-11-24-legacy-structure.md) — layer boundaries, file layout, and responsive CSS metrics
- [CLAUDE.md Project Guide](../../raw/notes/2026-11-24-legacy-claude-md.md) — ESLint/Prettier config, daemon controls, and `merge_code_only.sh` rules
