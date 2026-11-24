---
title: "FGO Calculator Knowledge Base Topic Guide"
schema_state: advisory
created: 2026-11-24
updated: 2026-11-24
summary: "Human-owned advisory topic guide defining entity types, relationship verbs, source conventions, and compile guidance for the FGO Calculator wiki."
---

# FGO Calculator Knowledge Base Topic Guide

> This is not a database schema and it does not make existing wiki content invalid.

## State

- `schema_state`: `advisory`

## Entity Types

| Type | Meaning |
|------|---------|
| `concept` | Bounded domain idea, game mechanic, or cross-cutting invariant (e.g., trait matching, Trusted Types DOM safety, bond growth tables). |
| `subsystem` | Distinct application module, calculator tab, or UI/build component (e.g., Servant Info, Bond Calculator, Bond Gain CE, Event Shop, BaseLayout inline CSS). |
| `rule` | Mandatory engineering constraint, coding convention, formatting contract, or branch/deployment policy. |
| `pipeline` | Automated build, data-sync, conversion, verification, or release workflow (e.g., Atlas Academy sync, Servant Info converter, `merge_code_only.sh`). |
| `decision` | Recorded architectural choice, rejected alternative, or approved design/plan milestone. |

## Relationship Verbs

- `cites`
- `supports`
- `contradicts`
- `supersedes`
- `depends-on`
- `implements`

## Source Conventions

- Raw sources in `raw/notes/` preserve legacy `.claude/` documentation, implementation plans (`raw/notes/plans/`), and historical archive plans/designs (`raw/notes/archive/`) verbatim after YAML frontmatter.
- Every raw source file declares `title`, `source` (original repo-relative path), `type: notes`, `ingested: YYYY-MM-DD`, lowercase-hyphenated `tags`, and a 2-3 sentence `summary`.
- Historical or superseded documents (such as `raw/notes/archive/` designs/plans that were rejected or already shipped) retain their historical context; compiled articles must distinguish active rules from superseded or rejected proposals using `supersedes` / `contradicts`.
- Never treat `raw/` as mutable; when source docs change, ingest a new dated raw snapshot rather than editing historical raw files.

## Compile Guidance

- Keep global wiki categories fixed (`concept`, `topic`, `reference`, plus `wiki/theses/` for thesis investigations) and compile into `wiki/concepts/`, `wiki/topics/`, and `wiki/references/`.
- Consolidate overlapping rules and architectural decisions across `CLAUDE.md`, `.claude/docs/*.md`, `plans/`, and `archive/` into single authoritative living articles per subsystem, rule set, or pipeline rather than creating 1-to-1 mirrors of raw files.
- Keep separate articles for each major calculator tab (`servant-info`, `bond-gain-ce`, `bond-calculator`, `event-shop`), core cross-cutting invariants (`dom-security-and-trusted-types`, `inline-css-and-layout`, `data-schemas-and-traits`, `atlas-sync-and-ci-pipeline`, `branching-and-release-workflow`), and major architectural migrations (`astro-7-migration`).
- When compiling from `raw/notes/archive/` or `raw/notes/2026-11-24-legacy-progress-log.md`, verify current-state claims against the active docs and note superseded plans explicitly (e.g., `2026-11-04-fluid-desktop-layout-*` was rejected in favor of `<html>` zoom magnification).
