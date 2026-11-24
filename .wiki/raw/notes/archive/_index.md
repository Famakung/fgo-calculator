# Raw Archive Index

> Historical designs, implementation plans, and decision ledgers ingested from .claude/docs/archive/.

Last updated: 2026-11-24

## Contents

| File | Summary | Tags | Updated |
|------|---------|------|---------|
| [2026-10-20-atlas-version-gate.md](2026-10-20-atlas-version-gate.md) | Historical plan introducing scripts/check_data_version.py using Python stdlib to poll Atlas Academy /info (~230 bytes) before running full data syncs. Designed to short-circuit idle hourly CI runs when upstream hashes are unchanged. | archive, plan, atlas-academy, ci-version-gate, python-stdlib | 2026-11-24 |
| [2026-10-20-ci-drift-path-and-comments.md](2026-10-20-ci-drift-path-and-comments.md) | Historical triage plan to fix stale JP-only version-gate comments in deploy.yml and evaluate activating a data-file drift detection path. Keeps workflow gate behavior intact while aligning documentation and YAML self-checks. | archive, plan, github-actions, ci-comments, cache-drift | 2026-11-24 |
| [2026-10-20-jp-na-version-gate.md](2026-10-20-jp-na-version-gate.md) | Historical plan extending scripts/check_data_version.py from checking only JP.hash to checking both JP.hash and NA.hash. Ensures idle CI polls skip syncs even when NA updates independently of JP. | archive, plan, atlas-academy, ci-version-gate, jp-na-hashes | 2026-11-24 |
| [2026-10-21-atlas-baseline-cache-fix.md](2026-10-21-atlas-baseline-cache-fix.md) | Historical root-cause analysis and fix plan for CI runs #58-#61 where the /info gate always reported CHECK=CHANGED. Rewires .github/workflows/deploy.yml cache restoration so the baseline hash persists across scheduled and dispatched runs. | archive, plan, github-actions, cache-fix, ci-version-gate | 2026-11-24 |
| [2026-11-02-astro-7-migration.md](2026-11-02-astro-7-migration.md) | Historical migration plan upgrading FGO Calculator from Astro 5.18.1 to Astro 7.4.5 with Vite 8 (Rolldown). Defines static chunk baseline verification (scripts/check_build_output.js) and Puppeteer render equivalence checks. | archive, plan, astro-7, vite-rolldown, build-verification | 2026-11-24 |
| [2026-11-03-astro7-migration-ledger.md](2026-11-03-astro7-migration-ledger.md) | Historical decision ledger recording environment rulings made during the Astro 7 migration worktree execution. Documents Node v22.23.4 parallel installation and worktree visibility of tracked .claude/ files. | archive, decision-ledger, astro-7, worktree, node-version | 2026-11-24 |
| [2026-11-03-ce-filter-servant-select-plan.md](2026-11-03-ce-filter-servant-select-plan.md) | Historical plan adding the Servant Select sub-tab to Bond Gain CE to invert CE-to-servant filtering. Computes common CE groups for two or more selected servants using a pure domain function over CEFilterApp match cache. | archive, plan, bond-gain-ce, servant-select, domain-logic | 2026-11-24 |
| [2026-11-04-fluid-desktop-layout-design.md](2026-11-04-fluid-desktop-layout-design.md) | Historical design proposal for a 1600px fluid desktop layout that was never built and superseded by html zoom magnification. Notes the deletion of src/styles/global.css and critical.css in favor of BaseLayout.astro inline CSS. | archive, design, rejected-proposal, desktop-layout, css | 2026-11-24 |
| [2026-11-04-fluid-desktop-layout-plan.md](2026-11-04-fluid-desktop-layout-plan.md) | Historical implementation plan for the rejected fluid desktop layout design, explicitly marked do-not-start. Superseded by html zoom magnification and the consolidation of all CSS into BaseLayout.astro. | archive, plan, rejected-proposal, desktop-layout, css | 2026-11-24 |
| [2026-11-05-bond-slot-ce-rework-plan.md](2026-11-05-bond-slot-ce-rework-plan.md) | Historical executed plan moving Bond Calculator craft essence pickers directly into each servant slot with portrait-only 64px chips. Preserves party-wide CE bonus math via SlotCEs.partyPool() while enforcing slot capacity and storage sanitization. | archive, plan, bond-calculator, slot-ces, ui-rework | 2026-11-24 |
| [2026-11-05-filter-settings-rework-design.md](2026-11-05-filter-settings-rework-design.md) | Approved design reshaping the Bond Gain CE and servant picker Filter Settings modals into seven centred, divided sections (rarity, class, class group, both alignment axes, sub-attribute, CE match count). Reuses existing servant trait data with a shared row builder. | archive, design, bond-gain-ce, filter-modal, servant-traits | 2026-11-24 |
| [2026-11-05-filter-settings-rework-plan.md](2026-11-05-filter-settings-rework-plan.md) | Implementation plan executing the 7-section Filter Settings rework across domain.js (ServantFilters), shared filter-sections.js, CEFilterApp, ServantSelector, and BaseLayout.astro inline CSS. Enforces chip size floors and page-scoped filter state. | archive, plan, bond-gain-ce, filter-modal, shared-builder | 2026-11-24 |

## Categories

- **archive**: 2026-10-20-atlas-version-gate.md, 2026-10-20-ci-drift-path-and-comments.md, 2026-10-20-jp-na-version-gate.md, 2026-10-21-atlas-baseline-cache-fix.md, 2026-11-02-astro-7-migration.md, 2026-11-03-astro7-migration-ledger.md, 2026-11-03-ce-filter-servant-select-plan.md, 2026-11-04-fluid-desktop-layout-design.md, 2026-11-04-fluid-desktop-layout-plan.md, 2026-11-05-bond-slot-ce-rework-plan.md, 2026-11-05-filter-settings-rework-design.md, 2026-11-05-filter-settings-rework-plan.md
- **astro-7**: 2026-11-02-astro-7-migration.md, 2026-11-03-astro7-migration-ledger.md
- **atlas-academy**: 2026-10-20-atlas-version-gate.md, 2026-10-20-jp-na-version-gate.md
- **bond-calculator**: 2026-11-05-bond-slot-ce-rework-plan.md
- **bond-gain-ce**: 2026-11-03-ce-filter-servant-select-plan.md, 2026-11-05-filter-settings-rework-design.md, 2026-11-05-filter-settings-rework-plan.md
- **build-verification**: 2026-11-02-astro-7-migration.md
- **cache-drift**: 2026-10-20-ci-drift-path-and-comments.md
- **cache-fix**: 2026-10-21-atlas-baseline-cache-fix.md
- **ci-comments**: 2026-10-20-ci-drift-path-and-comments.md
- **ci-version-gate**: 2026-10-20-atlas-version-gate.md, 2026-10-20-jp-na-version-gate.md, 2026-10-21-atlas-baseline-cache-fix.md
- **css**: 2026-11-04-fluid-desktop-layout-design.md, 2026-11-04-fluid-desktop-layout-plan.md
- **decision-ledger**: 2026-11-03-astro7-migration-ledger.md
- **design**: 2026-11-04-fluid-desktop-layout-design.md, 2026-11-05-filter-settings-rework-design.md
- **desktop-layout**: 2026-11-04-fluid-desktop-layout-design.md, 2026-11-04-fluid-desktop-layout-plan.md
- **domain-logic**: 2026-11-03-ce-filter-servant-select-plan.md
- **filter-modal**: 2026-11-05-filter-settings-rework-design.md, 2026-11-05-filter-settings-rework-plan.md
- **github-actions**: 2026-10-20-ci-drift-path-and-comments.md, 2026-10-21-atlas-baseline-cache-fix.md
- **jp-na-hashes**: 2026-10-20-jp-na-version-gate.md
- **node-version**: 2026-11-03-astro7-migration-ledger.md
- **plan**: 2026-10-20-atlas-version-gate.md, 2026-10-20-ci-drift-path-and-comments.md, 2026-10-20-jp-na-version-gate.md, 2026-10-21-atlas-baseline-cache-fix.md, 2026-11-02-astro-7-migration.md, 2026-11-03-ce-filter-servant-select-plan.md, 2026-11-04-fluid-desktop-layout-plan.md, 2026-11-05-bond-slot-ce-rework-plan.md, 2026-11-05-filter-settings-rework-plan.md
- **python-stdlib**: 2026-10-20-atlas-version-gate.md
- **rejected-proposal**: 2026-11-04-fluid-desktop-layout-design.md, 2026-11-04-fluid-desktop-layout-plan.md
- **servant-select**: 2026-11-03-ce-filter-servant-select-plan.md
- **servant-traits**: 2026-11-05-filter-settings-rework-design.md
- **shared-builder**: 2026-11-05-filter-settings-rework-plan.md
- **slot-ces**: 2026-11-05-bond-slot-ce-rework-plan.md
- **ui-rework**: 2026-11-05-bond-slot-ce-rework-plan.md
- **vite-rolldown**: 2026-11-02-astro-7-migration.md
- **worktree**: 2026-11-03-astro7-migration-ledger.md

## Recent Changes

- 2026-11-24: Ingested 2026-10-20-atlas-version-gate.md from .claude/docs/archive/2026-10-20-atlas-version-gate.md
- 2026-11-24: Ingested 2026-10-20-ci-drift-path-and-comments.md from .claude/docs/archive/2026-10-20-ci-drift-path-and-comments.md
- 2026-11-24: Ingested 2026-10-20-jp-na-version-gate.md from .claude/docs/archive/2026-10-20-jp-na-version-gate.md
- 2026-11-24: Ingested 2026-10-21-atlas-baseline-cache-fix.md from .claude/docs/archive/2026-10-21-atlas-baseline-cache-fix.md
- 2026-11-24: Ingested 2026-11-02-astro-7-migration.md from .claude/docs/archive/2026-11-02-astro-7-migration.md
- 2026-11-24: Ingested 2026-11-03-astro7-migration-ledger.md from .claude/docs/archive/2026-11-03-astro7-migration-ledger.md
- 2026-11-24: Ingested 2026-11-03-ce-filter-servant-select-plan.md from .claude/docs/archive/2026-11-03-ce-filter-servant-select-plan.md
- 2026-11-24: Ingested 2026-11-04-fluid-desktop-layout-design.md from .claude/docs/archive/2026-11-04-fluid-desktop-layout-design.md
- 2026-11-24: Ingested 2026-11-04-fluid-desktop-layout-plan.md from .claude/docs/archive/2026-11-04-fluid-desktop-layout-plan.md
- 2026-11-24: Ingested 2026-11-05-bond-slot-ce-rework-plan.md from .claude/docs/archive/2026-11-05-bond-slot-ce-rework-plan.md
- 2026-11-24: Ingested 2026-11-05-filter-settings-rework-design.md from .claude/docs/archive/2026-11-05-filter-settings-rework-design.md
- 2026-11-24: Ingested 2026-11-05-filter-settings-rework-plan.md from .claude/docs/archive/2026-11-05-filter-settings-rework-plan.md
