# Refresh Protocol

Refresh checks whether compiled articles still match their sources without
silently changing evidence or claiming human verification. It is assessment
first, write second.

## Invariants

1. **Raw stays immutable.** A changed upstream source becomes a new raw revision;
   never overwrite the prior raw body or its original metadata.
2. **`verified` means human-confirmed.** Compilation, fetching, due scans, lint,
   and automatic checks never set it. Only an explicit `verify` decision after
   review may write today's date.
3. **No automatic recompilation.** Present the source comparison and proposed
   article changes before any write.
4. **Archived topics stay quiet.** Skip them unless the user explicitly includes
   one; keep all writes inside that archived topic.
5. **Failed fetches are evidence gaps.** Do not treat an unreachable source as
   changed or retract it without approval.

## Target selection

Refresh operates on one topic/local wiki at a time. At a hub, ask the user to
pick a registered topic; `--wiki all` may iterate active registered topics.
`--include-archived` is required for archived targets.

- An article path checks that article.
- `--due` lists articles below the configured freshness threshold and asks which
  to inspect.
- With neither, list articles from most overdue to least and ask which to check.

Use `volatility`, `verified`, `updated`, source ingestion dates, and source-chain
integrity for prioritization. A missing `verified` value means **never
human-verified**; never substitute `updated` for it.

## Source check

For each selected article:

1. Resolve every `sources:` entry with the Source Reference Resolution protocol.
2. Read each raw record's `source:` provenance.
3. For fetchable URLs, retrieve the current source. For local sources, read the
   current file only when its path is authorized and available.
4. Compare 5-10 material claims, figures, conclusions, and scope boundaries with
   the stored raw revision.
5. Classify the result as `unchanged`, `updated`, `contradicted`, or
   `unreachable`.
6. Classify impact as `cosmetic`, `additive`, or `contradictory`.

Do not write while checking. Record fetch limitations in the report.

## Decision report

Present one numbered decision per source:

```text
1. Source title — unchanged
   → skip | verify
2. Source title — updated (additive)
   What changed: ...
   → skip | update | update-and-verify | flag
3. Source title — unreachable
   → skip | flag | retract
```

- **skip**: no files change and `verified` is untouched.
- **verify**: after the user reviews the unchanged evidence and article, set the
  article's `verified` date to today.
- **update**: capture a new immutable raw revision, recompile the affected claims,
  and update `updated`; do not set `verified`.
- **update-and-verify**: perform `update`, show the final article diff, then set
  `verified` only after the user explicitly confirms that final diff.
- **flag**: lower confidence one step
  (`high→medium-high→medium→medium-low→low`) and add a visible source-change
  warning. Do not set `verified`.
- **retract**: route through the explicit retraction workflow. An HTTP failure by
  itself is not proof that evidence should be deleted.

## Immutable raw revision write

For `update`:

1. Create a new raw file in the same raw type and optional namespace as the old
   record. Use today's date in the filename and `-2`, `-3`, ... on collision.
2. Preserve the provenance fields that still apply, set `ingested`/`fetched` to
   today, and add `supersedes: <wiki-root-relative-old-raw-path>`.
3. Put the newly fetched body only in the new file. Do not edit the old file.
4. Add the new raw path to the article `sources:`. Retain the old raw path so the
   article preserves the evidence lineage used by earlier revisions.
5. Recompile only the affected claims and update the article's `updated` date.
6. Rebuild affected raw/wiki indexes.

If the new capture is byte-identical to the stored revision, do not create a
new file; report it as unchanged.

## Due mode

`--due` is read-only until the user selects article actions. It may fetch and
compare sources, but it never updates `verified` merely because a check ran.
Present score components so the user can distinguish stale evidence from a
never-verified article.

## Inventory and logging

Offer a durable inventory record only for meaningful follow-up: inaccessible
sources, recurring monitoring, replacement evidence, or blocked review.

After approved actions, append:

```text
## [YYYY-MM-DD] refresh | N articles checked, M new raw revisions, K updated, J verified, F flagged, R retracted
```

Append to the topic log and hub log when available. A check with no approved
writes may log counts, but must not imply verification.
