# CLAUDE.md

Guidance for Claude Code and AI coding assistants working in `/home/famakung/dev/fgo-calculator` (Astro 7 + Vite 8/Rolldown static site, live at https://famakung.github.io/fgo-calculator/, repo `Famakung/fgo-calculator`). `AGENTS.md` and `GEMINI.md` at repo root carry the same contract.

## Knowledge Base Navigation (Read Before Editing)

Navigate `.wiki/` via **3-hop navigation** instead of loading large raw docs:

1. Start at [.wiki/_index.md](../.wiki/_index.md).
2. Open the relevant category index: `.wiki/wiki/concepts/_index.md`, `.wiki/wiki/topics/_index.md`, or `.wiki/wiki/references/_index.md`.
3. Read only the matched articles:
   - **Concepts**: `architecture-and-bundling.md`, `security-and-dom-safety.md`, `zero-commit-data-pipeline.md`
   - **References**: `code-style-and-conventions.md`, `data-schemas-and-traits.md`, `atlas-academy-fetch-reference.md`
   - **Topics**: `bond-gain-ce-and-filters.md`, `bond-calculator.md`, `servant-info-system.md`, `event-shop-calculator.md`, `project-history-and-decisions.md`

See [.wiki/schema.md](../.wiki/schema.md) for wiki conventions; run `llm-wiki lint --local` after `.wiki/` edits.

## Non-Negotiable Rules

- **Never `innerHTML` or `insertAdjacentHTML`**: use `createElement()` + `textContent` + `setAttribute()`, or `DocumentFragment` + `replaceChildren()`. An inline Trusted Types policy in `<head>` throws on unsanitized sinks.
- **All CSS lives in `src/layouts/BaseLayout.astro`**: the single inline `<style>` is the only shipped stylesheet (no `src/styles/` directory).
- **JS style**: ES modules, 2-space indent, semicolons, double quotes (Prettier `printWidth: 120`, `trailingComma: "all"`), kebab-case filenames.
- **Trait IDs**: 4-digit zero-padded strings (`"0100"`, `"0002"`), sorted ascending.
- **Generated data is gitignored**: `src/scripts/data/*.js`, `public/servants/`, `public/servant_info/`, `public/saint_graphs/`, `public/skill_icons/`, `public/craft_essences/`, `public/event_shop/` (`npm run data:sync` on a fresh clone).
- **Main checkout only**: work and build in `/home/famakung/dev/fgo-calculator`, never under `/mnt/storage` (ntfs3 breaks `astro build`).

## Build & Verify

```bash
npm run dev          # Astro dev server, localhost:3000
npm run build        # production build -> dist/
npm run lint         # ESLint (src/scripts/)
npm run format       # Prettier
npm run test         # pure-domain unit tests (node --test)
npm run check:build  # assert dist/ against scripts/build_baseline.json
npm run data:validate
```

Requires Node `>= 22.23.4` (`.nvmrc`). Browser gate: `npx astro preview`, then `node scripts/verify_render.js`.

## Branch & Merge Rule

`develop` is local-only; `origin/main` is deployed to GitHub Pages. **Never plain-merge `develop` into `main`** — `.claude/**`, `.wiki/**`, `AGENTS.md`, `GEMINI.md`, `scripts/verify_render.js`, `scripts/test_*.js`, `tests/`, and `scripts/merge_code_only.sh` are `develop`-only. Ship code to `main` via:

```bash
scripts/merge_code_only.sh [source] "<commit_message>"
```
