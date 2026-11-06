# Archived implementation plans

Finished or superseded plan documents, kept as a record of how each feature was built. **Not a to-do list — every task in here is already done.**

Read the active contract instead: `AGENTS.md` at the repo root, then `.claude/CLAUDE.md` and the four mandatory docs above it in `.claude/docs/`.

Two things in these files no longer exist, so treat references to them as historical:

- `src/styles/global.css` and `src/styles/critical.css`, and `npm run lint:css` / stylelint. Deleted 2026-11-04; all CSS is the single inline `<style>` in `src/layouts/BaseLayout.astro`.
- `npm run lighthouse` and `lighthouse-runner.js`. Removed 2026-11-04; the runner was never committed. Use `npx lighthouse <url>`.

| File | Feature | Outcome |
|---|---|---|
| `2026-10-20-atlas-version-gate.md` | `/info` hash gate at the top of the deploy workflow | shipped |
| `2026-10-20-jp-na-version-gate.md` | gate checks JP **and** NA hashes | shipped |
| `2026-10-20-ci-drift-path-and-comments.md` | drift detection paths + workflow comments | shipped |
| `2026-10-21-atlas-baseline-cache-fix.md` | run-unique cache key so the baseline actually re-saves | shipped |
| `2026-11-02-astro-7-migration.md` | Astro 5 + Vite 6 → Astro 7 + Vite 8/Rolldown | shipped |
| `2026-11-03-astro7-migration-ledger.md` | ledger of that migration's verification runs | record only |
| `2026-11-03-ce-filter-servant-select-plan.md` | Servant Select sub-tab + shared-CE groups | shipped |
| `2026-11-04-fluid-desktop-layout-design.md` | fluid 1600px content rail + root type scale | rejected — magnification shipped instead |
| `2026-11-04-fluid-desktop-layout-plan.md` | that layout's task plan | never executed |
| `2026-11-05-bond-slot-ce-rework-plan.md` | per-slot craft essences on the Bond party cards | shipped |
| `2026-11-05-filter-settings-rework-design.md` | Filter Settings as labelled divided sections, one chip builder | shipped |
| `2026-11-05-filter-settings-rework-plan.md` | that rework's task plan | shipped |
