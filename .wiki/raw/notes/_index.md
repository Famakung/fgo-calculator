# Raw Notes Index

> Legacy project documentation, plans, and historical archives ingested from .claude/.

Last updated: 2026-11-24

## Contents

| File | Summary | Tags | Updated |
|------|---------|------|---------|
| [2026-11-24-legacy-claude-md.md](2026-11-24-legacy-claude-md.md) | Primary guidance file for AI coding assistants working in the FGO Calculator repository. Documents the Astro 7 static site tools, mandatory pre-implementation documentation, build/verification commands, git branch policy, and known environment pitfalls. | project-guide, architecture, astro-7, branching, build-commands | 2026-11-24 |
| [2026-11-24-legacy-code-style.md](2026-11-24-legacy-code-style.md) | Defines JavaScript formatting, naming conventions, immutable state management, and strict DOM construction rules for FGO Calculator. Prohibits innerHTML in favor of createElement(), textContent, setAttribute(), and batched DocumentFragment replaceChildren() updates. | code-style, vanilla-js, dom-safety, state-management, naming-conventions | 2026-11-24 |
| [2026-11-24-legacy-data-rules.md](2026-11-24-legacy-data-rules.md) | Specifies exported game dataset constants (TRAIT_DATA, SERVANT_DATA, CE_DATA, BOND_TABLES), 4-digit zero-padded trait ID conventions, and trait matching rules. Details running-total bond growth table deduplication and local asset path conventions. | data-schemas, trait-ids, bond-tables, servant-data, craft-essences | 2026-11-24 |
| [2026-11-24-legacy-fetch-data-guideline.md](2026-11-24-legacy-fetch-data-guideline.md) | Comprehensive reference for fetching and processing FGO game data and WebP assets from the Atlas Academy API. Covers automated CI scheduling, PoliteRateLimiter pacing, multi-ascension/spiritron icon handling, Craft Essence ingestion, and zero-commit generated data architecture. | atlas-academy, data-sync, github-actions, rate-limiting, asset-pipeline | 2026-11-24 |
| [2026-11-24-legacy-progress-log.md](2026-11-24-legacy-progress-log.md) | Chronological implementation log recording feature rollouts, bug fixes, Astro migration milestones, CI hardening, and verification checklists. Serves as historical context for completed changes across all calculator tabs and build scripts. | progress-log, changelog, implementation-history, testing-checklist | 2026-11-24 |
| [2026-11-24-legacy-security.md](2026-11-24-legacy-security.md) | Defines mandatory DOM security controls and the inline head Trusted Types policy enforced at runtime. Prohibits innerHTML, outerHTML, and insertAdjacentHTML across all scripts to prevent XSS. | security, trusted-types, xss-prevention, dom-safety | 2026-11-24 |
| [2026-11-24-legacy-servant-info-rules.md](2026-11-24-legacy-servant-info-rules.md) | Authoritative specification for the static Servant Info converter (scripts/servant_info_converter/) and lazy UI/modal rendering in servant-info-app.js. Covers enemy-side skill filtering, special Mash/ascension states, structured NP/skill formatting, lossless assets, and verification. | servant-info, python-converter, formatting-rules, enemy-filtering, asset-paths | 2026-11-24 |
| [2026-11-24-legacy-structure.md](2026-11-24-legacy-structure.md) | Maps the FGO Calculator file layout, 3-layer separation (Domain, Application, Presentation), Vite/Rolldown manual chunk splitting, and lazy tab initialization flow. Covers BaseLayout.astro, index.astro, main.js, and each calculator controller. | architecture, module-structure, astro-7, vite-rolldown, lazy-loading | 2026-11-24 |
| [plans/_index.md](plans/_index.md) | Subdirectory: 2 implementation plans from .claude/docs/plans/ | plan, raw-index | 2026-11-24 |
| [archive/_index.md](archive/_index.md) | Subdirectory: 12 historical archive docs from .claude/docs/archive/ | archive, raw-index | 2026-11-24 |

## Categories

- **architecture**: 2026-11-24-legacy-claude-md.md, 2026-11-24-legacy-structure.md
- **asset-paths**: 2026-11-24-legacy-servant-info-rules.md
- **asset-pipeline**: 2026-11-24-legacy-fetch-data-guideline.md
- **astro-7**: 2026-11-24-legacy-claude-md.md, 2026-11-24-legacy-structure.md
- **atlas-academy**: 2026-11-24-legacy-fetch-data-guideline.md
- **bond-tables**: 2026-11-24-legacy-data-rules.md
- **branching**: 2026-11-24-legacy-claude-md.md
- **build-commands**: 2026-11-24-legacy-claude-md.md
- **changelog**: 2026-11-24-legacy-progress-log.md
- **code-style**: 2026-11-24-legacy-code-style.md
- **craft-essences**: 2026-11-24-legacy-data-rules.md
- **data-schemas**: 2026-11-24-legacy-data-rules.md
- **data-sync**: 2026-11-24-legacy-fetch-data-guideline.md
- **dom-safety**: 2026-11-24-legacy-code-style.md, 2026-11-24-legacy-security.md
- **enemy-filtering**: 2026-11-24-legacy-servant-info-rules.md
- **formatting-rules**: 2026-11-24-legacy-servant-info-rules.md
- **github-actions**: 2026-11-24-legacy-fetch-data-guideline.md
- **implementation-history**: 2026-11-24-legacy-progress-log.md
- **lazy-loading**: 2026-11-24-legacy-structure.md
- **module-structure**: 2026-11-24-legacy-structure.md
- **naming-conventions**: 2026-11-24-legacy-code-style.md
- **progress-log**: 2026-11-24-legacy-progress-log.md
- **project-guide**: 2026-11-24-legacy-claude-md.md
- **python-converter**: 2026-11-24-legacy-servant-info-rules.md
- **rate-limiting**: 2026-11-24-legacy-fetch-data-guideline.md
- **security**: 2026-11-24-legacy-security.md
- **servant-data**: 2026-11-24-legacy-data-rules.md
- **servant-info**: 2026-11-24-legacy-servant-info-rules.md
- **state-management**: 2026-11-24-legacy-code-style.md
- **testing-checklist**: 2026-11-24-legacy-progress-log.md
- **trait-ids**: 2026-11-24-legacy-data-rules.md
- **trusted-types**: 2026-11-24-legacy-security.md
- **vanilla-js**: 2026-11-24-legacy-code-style.md
- **vite-rolldown**: 2026-11-24-legacy-structure.md
- **xss-prevention**: 2026-11-24-legacy-security.md

## Recent Changes

- 2026-11-24: Ingested 2026-11-24-legacy-claude-md.md from .claude/CLAUDE.md
- 2026-11-24: Ingested 2026-11-24-legacy-code-style.md from .claude/docs/code-style.md
- 2026-11-24: Ingested 2026-11-24-legacy-data-rules.md from .claude/docs/data-rules.md
- 2026-11-24: Ingested 2026-11-24-legacy-fetch-data-guideline.md from .claude/docs/fetch-data-guideline.md
- 2026-11-24: Ingested 2026-11-24-legacy-progress-log.md from .claude/docs/progress.md
- 2026-11-24: Ingested 2026-11-24-legacy-security.md from .claude/docs/security.md
- 2026-11-24: Ingested 2026-11-24-legacy-servant-info-rules.md from .claude/docs/servant-info-rules.md
- 2026-11-24: Ingested 2026-11-24-legacy-structure.md from .claude/docs/structure.md
