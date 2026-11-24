---
title: "FGO Calculator Knowledge Base"
description: "Project knowledge base for FGO Calculator (Astro 7 static site, vanilla JS ES modules, Atlas Academy data pipeline, Servant Info, Bond Calculator, Bond Gain CE, Event Shop)."
created: 2026-11-24
freshness_threshold: 70
---

# Wiki Configuration

## Scope

This local project wiki captures the architecture, coding standards, DOM security policies (Trusted Types, zero `innerHTML`), data schemas, Atlas Academy sync pipeline, Servant Info converter rules, UI/layout decisions, and historical implementation plans/progress for FGO Calculator (`Famakung/fgo-calculator`).

## Conventions

- All raw sources live under `raw/` with immutable original text and structured YAML frontmatter (`title`, `source`, `type`, `ingested`, `tags`, `summary`).
- Tags are lowercase and hyphenated (e.g., `astro-7`, `trusted-types`, `atlas-academy`, `bond-calculator`).
- All wiki articles use dual-link format (`[[slug|Display Text]] ([Display Text](../category/slug.md))`) and cite exact `raw/` paths in `sources:`.
