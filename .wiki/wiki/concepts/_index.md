# Wiki Concepts Index

> Compiled concept articles explaining core mechanisms and invariants.

Last updated: 2026-11-24

## Contents

| File | Summary | Tags | Updated |
|------|---------|------|---------|
| [architecture-and-bundling.md](architecture-and-bundling.md) | Defines FGO Calculator's 3-layer vanilla JS architecture, Astro 7 / Vite 8 Rolldown chunk splitting, lazy tab loading, single inline CSS strategy, and wide-screen magnification layout. Also documents the native btrfs vs ntfs3 build environment constraint and code-only branch shipping. | architecture, astro-7, vite-rolldown, bundling, lazy-loading, css-layout | 2026-11-24 |
| [security-and-dom-safety.md](security-and-dom-safety.md) | Establishes FGO Calculator's non-negotiable DOM construction rules, inline Trusted Types passthrough policy, and zero-external-resource posture. Explains how client-side enforcement compensates for GitHub Pages' lack of custom security headers and the removal of the legacy Service Worker. | security, trusted-types, dom-safety, xss-prevention, github-pages | 2026-11-24 |
| [zero-commit-data-pipeline.md](zero-commit-data-pipeline.md) | Explains FGO Calculator's zero-commit data and image architecture, where generated JS modules and WebP assets stay gitignored and are rebuilt or restored from actions/cache at build time. Covers JP+NA /info version gating, ETag revalidation, run-scoped .ci-baselines/ persistence, fixed UTC cron slots, and build/data validation gates. | zero-commit, atlas-academy, github-actions, etag-caching, ci-pipeline, webp | 2026-11-24 |

## Categories

- **architecture**: architecture-and-bundling.md
- **astro-7**: architecture-and-bundling.md
- **atlas-academy**: zero-commit-data-pipeline.md
- **bundling**: architecture-and-bundling.md
- **ci-pipeline**: zero-commit-data-pipeline.md
- **css-layout**: architecture-and-bundling.md
- **dom-safety**: security-and-dom-safety.md
- **etag-caching**: zero-commit-data-pipeline.md
- **github-actions**: zero-commit-data-pipeline.md
- **github-pages**: security-and-dom-safety.md
- **lazy-loading**: architecture-and-bundling.md
- **security**: security-and-dom-safety.md
- **trusted-types**: security-and-dom-safety.md
- **vite-rolldown**: architecture-and-bundling.md
- **webp**: zero-commit-data-pipeline.md
- **xss-prevention**: security-and-dom-safety.md
- **zero-commit**: zero-commit-data-pipeline.md

## Recent Changes

- 2026-11-24: Compiled 3 core concept articles (architecture-and-bundling, security-and-dom-safety, zero-commit-data-pipeline)
