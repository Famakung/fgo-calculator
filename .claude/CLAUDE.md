# CLAUDE.md

Guidance for Claude Code and AI coding assistants working in `/home/famakung/dev/fgo-calculator` (Astro 7 + Vite 8/Rolldown static site, live at https://famakung.github.io/fgo-calculator/, repo `Famakung/fgo-calculator`). `AGENTS.md` and `GEMINI.md` at repo root carry the same contract.

## Knowledge Base Navigation (Read Before Editing)

Read only the matched [.wiki/wiki/](../.wiki/wiki/_index.md) article directly before editing (open [.wiki/_index.md](../.wiki/_index.md) only if unsure):

- **Concepts**: `architecture-and-bundling.md`, `security-and-dom-safety.md`, `zero-commit-data-pipeline.md`
- **References**: `code-style-and-conventions.md`, `data-schemas-and-traits.md`, `atlas-academy-fetch-reference.md`
- **Topics**: `bond-gain-ce-and-filters.md`, `bond-calculator.md`, `servant-info-system.md`, `event-shop-calculator.md`, `project-history-and-decisions.md`

## Non-Negotiable Rules

- **Never `innerHTML` or `insertAdjacentHTML`**: use `createElement()` + `textContent` + `setAttribute()`, or `DocumentFragment` + `replaceChildren()`. An inline Trusted Types policy in `<head>` throws on unsanitized sinks.
- **All CSS lives in `src/layouts/BaseLayout.astro`**: the single inline `<style>` is the only shipped stylesheet (no `src/styles/` directory).
- **JS style**: ES modules, 2-space indent, semicolons, double quotes (Prettier `printWidth: 120`, `trailingComma: "all"`), kebab-case filenames.
- **Trait IDs**: 4-digit zero-padded strings (`"0100"`, `"0002"`), sorted ascending.
- **Generated data is gitignored**: `src/scripts/data/*.js`, `public/servants/`, `public/servant_info/`, `public/saint_graphs/`, `public/skill_icons/`, `public/craft_essences/`, `public/event_shop/` (`npm run data:sync` on a fresh clone).
- **Main checkout only**: work and build in `/home/famakung/dev/fgo-calculator`, never under `/mnt/storage` (ntfs3 breaks `astro build`).
- **Skill/NP effect lookup (token-saving, offline)**: Never fetch Atlas Academy API or read `.cache/atlas/nice_servant_lore_lang_en.json` (100 MB) directly, and never run plain `rg` content mode on `public/servant_info/` (minified single-line JSON). Search displayed text via `python3 tools/query_effect.py --text "<query>"` (or `rg -l`); inspect raw Atlas effects locally via `python3 tools/query_effect.py` (`--svt`, `--name`, `--skill`, `--func`, `--buff`, `--kind`, `--fmt`).

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

Requires Node `>= 22.23.4` (`.nvmrc`). Browser gate: `npx astro preview`, then `node tools/verify_render.js`.

**Finish gate (before commit/final reply):** if `src/`, `scripts/`, or `.github/` changed, update the matching `.wiki/wiki/` article (1–3 bullets, schema in [.wiki/schema.md](../.wiki/schema.md)) and run `llm-wiki lint --local` (`tools/merge_code_only.sh` blocks unsynced code unless `--no-wiki` is passed).

## Branch & Merge Rule

`develop` is local-only; `origin/main` is deployed to GitHub Pages. **Never plain-merge `develop` into `main`** — `.claude/**`, `.wiki/**`, `AGENTS.md`, `GEMINI.md`, `tools/`, and `tests/` are `develop`-only (`scripts/` is 100% public). Ship code to `main` via:

```bash
tools/merge_code_only.sh [source] "<commit_message>"
```
