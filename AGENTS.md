# FGO Calculator — rules for AI coding agents

Read this first, then the docs listed under **Before you write code**. Every file path in this repo is relative to the project root; there is no `d:/` path here.

FGO Calculator: Astro static site (Astro 7 + Vite 8/Rolldown), deployed to GitHub Pages, vanilla JS ES modules, no framework, no TypeScript at runtime. Three tools: Event Shop Calculator, Bond Calculator, Bond Gain CE. Live at https://famakung.github.io/fgo-calculator/, repo `Famakung/fgo-calculator`.

## Before you write code

Mandatory — read the ones that cover your change (25 KB total):

- [.claude/docs/code-style.md](.claude/docs/code-style.md) — coding conventions, DOM safety, naming, state management, performance patterns
- [.claude/docs/structure.md](.claude/docs/structure.md) — 3-layer architecture, module responsibilities, Vite chunk splitting, script loading order
- [.claude/docs/data-rules.md](.claude/docs/data-rules.md) — trait ID conventions, `SERVANT_DATA` / `CE_DATA` schemas, trait match modes, asset paths
- [.claude/docs/security.md](.claude/docs/security.md) — Trusted Types policy, safe DOM sinks

On demand, do **not** load them by default (they are big):

- [.claude/CLAUDE.md](.claude/CLAUDE.md) (33 KB) — full architecture, build/deploy pipeline, Known Issues. Read the section matching your task; it is the deepest source of truth.
- [.claude/docs/progress.md](.claude/docs/progress.md) (163 KB) — implementation log, per-feature status, testing checklists. Read the tail and grep for your feature, not the whole file.
- [.claude/docs/fetch-data-guideline.md](.claude/docs/fetch-data-guideline.md) (62 KB) — only for Atlas Academy data-sync work.

## The rules that break the site if ignored

- **Never `innerHTML`, never `insertAdjacentHTML`.** `createElement()` + `textContent` + `setAttribute()`; heavy renders build a `DocumentFragment` then one `replaceChildren()`. A `<head>` inline Trusted Types policy makes unsanitized sinks throw at runtime.
- **No `100vh` / `80vh` lengths.** The layout applies `zoom` on `<html>` above 1400 CSS px, so viewport units overshoot; use the `--screen-h` variable. Any new viewport-unit length must go through it.
- **All visual CSS is the single inline `<style>` in `src/layouts/BaseLayout.astro`** — that block is the only stylesheet the site has. There is no `src/styles/` directory: `global.css` and `critical.css` sat there unread by any build step and were deleted, after the duplicate had already drifted (a rule kept only there never shipped).
- **JS style**: ES modules, 2-space indent, semicolons, **double quotes** (Prettier `printWidth: 120`, `trailingComma: "all"`). Files kebab-case.
- **Trait IDs are 4-digit zero-padded strings** (`"0100"`, `"0002"`), sorted ascending in arrays.
- **Generated data is gitignored**: `src/scripts/data/*.js`, `public/servants/`, `public/craft_essences/`. Fresh clone → `npm run data:sync` before anything builds (`predev`/`prebuild` call `scripts/ensure_data.js`).

## Build & verify

```bash
npm run dev          # Astro dev server, localhost:3000
npm run build        # production build → dist/
npm run lint         # ESLint (src/scripts/) — no CSS linter, nothing ships a .css file
npm run format       # Prettier + Stylelint --fix
npm run test         # pure-domain unit tests (node --test), no browser
npm run check:build  # assert dist/ against scripts/build_baseline.json
npm run data:validate
node --version       # must be >= 22.23.4 (.nvmrc); npm only WARNS on EBADENGINE
```

Browser gate (local only, needs Chromium): `npx astro preview`, then `node scripts/verify_render.js`.

**`astro build` fails on this repo's `/mnt/storage` (ntfs3) mount** — Vite bundles Astro's dev-toolbar entrypoint and dies on `[MISSING_EXPORT] "loadDevToolbarApps"`. See "Which folder to work in". That copy's `node_modules` holds Astro 5.18.2 installed with `--no-save`, which is why it shows a `__vite__injectQuery` console error.

## Layout map

| Path | Role |
|------|------|
| `src/layouts/BaseLayout.astro` | HTML shell, the shipped inline CSS, font preloads, Trusted Types, zoom + tab/LCP head scripts |
| `src/pages/index.astro` | page structure, sub-tab markup, imports JS |
| `src/scripts/main.js` | entry, `DOMContentLoaded` → lazy `import()` per tab |
| `src/scripts/domain.js` | Domain layer: validators, calculators, trait matcher, `ServantComboCalculator` |
| `src/scripts/bond-app.js`, `ce-filter-app.js`, `ce-servant-select.js`, `event-shop.js` | Application controllers per tab |
| `src/scripts/data.js` + `src/scripts/data/*.js` | data access and generated datasets |
| `scripts/` | data sync (`sync_atlas_data.py`), build/render gates, tests |
| `.github/workflows/` | Pages deploy, 10-min ETag-gated data schedule |

`develop` is a local-only branch; `origin` carries `main`, and `main` is what GitHub Pages deploys. Commit to a `feat/*` branch or `develop`. **Never plain-merge `develop` into `main`** (`git pull origin develop` is the same merge) — these docs (`.claude/**`, `AGENTS.md`, `GEMINI.md`), the browser gate `scripts/verify_render.js` (CI never runs it) and that script itself are deliberately `develop`-only and must not become public; every other file under `scripts/` stays public because CI or `npm run build` needs it; ship code to `main` with `scripts/merge_code_only.sh` (merges the code, drops those paths — itself included — from the merge commit, keeps `main`'s `.gitignore`, pushes nothing) or by cherry-picking the code commits.

## Which folder to work in

**`/home/famakung/dev/fgo-calculator` is the main checkout.** Work, build, test and commit here — never anywhere under `/mnt/storage`.

A stale second copy exists at `/mnt/storage/Dev/Projects/fgo-calculator`: separate git dir, behind on commits, old docs, and `astro build` fails on its ntfs3 mount. Treat it as read-never. An agent that runs a command without `cd` into this folder lands there and starts reporting bugs that do not exist in this code — recorded in [.claude/docs/progress.md](.claude/docs/progress.md).
