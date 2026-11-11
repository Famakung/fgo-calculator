# Plan: fixed-slot Atlas data-poll schedule

Slug: atlas-cron-slots · Date: 2026-11-11 · Branch: develop · Path: FULL (CI script change, triage rule)
Working copy: `/tmp/opencode/atlas-cron-slots.plan.md` (this file is the repo plan-of-record; /tmp may vanish on reboot)

## Goal

Replace throttled `*/10 * * * *` cron in `.github/workflows/deploy.yml` with four fixed UTC slots aligned to JP/NA maintenance ends. Owner approved set (ICT): 16:10 / 18:10 / 22:10 / 02:10. No 02:10→11:10 swap (13:10 JST = maintenance start, dead slot; 02:10 ICT covers NA anniversary end 12:00 PDT).

Evidence: `gh run list --workflow=deploy.yml --event=schedule --limit 30` (Nov 4–11 2026) = 3–5 runs/day, gaps 3.2–10.4h, avg 5.8h. GitHub throttles frequent cron; configured 144/day never happened. Fixed slots cost the same, land when data changes.

## Trace (scrutinize)

on.schedule → build job: checkout → cache restore → `check_data_version.py` (~230-byte /info, JP+NA hash compare) → DO_WORK gate (schedule: work only if CHECK != UNCHANGED) → sync/build/deploy only on change. Nothing in path depends on cron frequency. self-test job `if: github.event_name != 'schedule'` unchanged. concurrency group `pages` unchanged. `scripts/test_deploy_workflow.py` pins 9 gate scenarios, NOT the cron string — change breaks no existing pin.

Simpler alternatives rejected: do-nothing (random fires), hourly (same throttle), external poller + repository_dispatch (only guaranteed path; owner deferred — new infra + PAT).

## Contracts (frozen)

### C1 — deploy.yml cron + header comment (lines 6–11)

OLD:
```yaml
  schedule:
    # Poll every 10 min: a ~230-byte /info version check stops the run when
    # both JP and NA hashes are unchanged; otherwise the Atlas API is
    # ETag-revalidated (304 = ~0 bytes) and the build is skipped when no data
    # changed, so idle runs are near-free.
    - cron: '*/10 * * * *'
```
NEW:
```yaml
  schedule:
    # Four fixed polls at JP/NA maintenance ends, not */10: GitHub throttled
    # the 10-min cron to ~4 random fires/day (avg gap 5.8h, measured Nov 2026),
    # so fixed slots cost the same and land when data actually changes.
    # UTC -> ICT/JST: 09:10 = 16:10/18:10 (JP end 18:00 JST), 11:10 =
    # 18:10/20:10 (JP extension; NA end 04:00 PT), 15:10 = 22:10/00:10 (late
    # extensions), 19:10 = 02:10/04:10 (NA anniversary end 12:00 PT). PT is
    # PDT Mar-Nov; in PST months NA ends +1h UTC later and the next slot
    # catches it. :10 dodges top-of-hour load. A ~230-byte /info version
    # check stops the run when both JP and NA hashes are unchanged; otherwise
    # the Atlas API is ETag-revalidated (304 = ~0 bytes) and the build is
    # skipped when no data changed, so idle runs are near-free. Best-effort:
    # slots may be delayed or dropped under load.
    - cron: '10 9,11,15,19 * * *'
```

### C2 — deploy.yml stale comment fragments (minimal substring swaps)

- Line ~183: `runs on a 10-minute schedule, so a flaky fetch` → `runs on the data-poll schedule, so a flaky fetch`
- Line ~232: `the idle 10-min schedule so polls stay near-free` → `idle schedule polls so they stay near-free`

### C3 — invariants (must NOT change)

`on.push.branches: [main]`; `workflow_dispatch.inputs.force_sync` (boolean, default false); permissions; concurrency; every job/step/if; self-test suite list. Only cron line + comments change in deploy.yml.

### C4 — new test pin (QA owns): scenario 10 in scripts/test_deploy_workflow.py

- PyYAML gotcha: bare `on:` parses as boolean key `True`. Use `spec.get("on", spec.get(True))`.
- Assert schedule cron list == `["10 9,11,15,19 * * *"]`.
- Assert push branches == `["main"]`; force_sync input present, type boolean, default false.
- Mapping assert: minute == 10; UTC hours {9,11,15,19} → ICT {(h+7)%24} = {16,18,22,2}, JST {(h+9)%24} = {18,20,0,4}; pairs {(16,18),(18,20),(22,0),(2,4)}.
- Update module docstring scenario list (nine → ten).
- Anchor: `python3 scripts/test_deploy_workflow.py` → `10 tests passed`, exit 0. Full trio also green: `test_check_data_version.py`, `test_drift.py`.

### C5 — doc edits (exact text)

- `AGENTS.md:60`: `| .github/workflows/ | Pages deploy, 10-min ETag-gated data schedule |` → `| .github/workflows/ | Pages deploy, fixed-slot ETag-gated data schedule (4 polls/day at JP/NA maintenance ends) |`
- `.claude/CLAUDE.md:104`: substring `needs Chromium download on 10-minute schedule` → `needs Chromium download on the data-poll schedule`
- `.claude/CLAUDE.md:218`: substring `push to \`main\`, 10-minute schedule, \`workflow_dispatch\`` → `push to \`main\`, four fixed daily schedule slots (09:10/11:10/15:10/19:10 UTC), \`workflow_dispatch\``
- `.claude/CLAUDE.md:224`: `- Every-10-min schedule (version-gated; syncs + revalidates via ETag; build skipped when no data changed)` → `- Fixed-slot schedule, 4 polls/day at 09:10/11:10/15:10/19:10 UTC (JP/NA maintenance ends; version-gated; syncs + revalidates via ETag; build skipped when no data changed)`
- `.claude/docs/fetch-data-guideline.md:5`: substring `(hourly cron, and on \`git push\` to \`main\`)` → `(four fixed daily cron slots at 09:10/11:10/15:10/19:10 UTC — JP/NA maintenance ends — and on \`git push\` to \`main\`)` (was already stale: said hourly, reality was */10)
- `.claude/docs/progress.md`: APPEND entry (text in working copy / repo copy below). Never rewrite history lines 346/417. Archive docs untouched.

Progress entry (verbatim):
```markdown
## 2026-11-11 — Fixed-slot data-poll schedule (replaces */10 cron)

- **Change:** `.github/workflows/deploy.yml` cron `*/10 * * * *` → `10 9,11,15,19 * * *` (UTC). Four daily polls aligned to JP/NA maintenance ends: 09:10 UTC = 16:10 ICT / 18:10 JST (JP typical end), 11:10 = 18:10 ICT / 20:10 JST (JP extension; NA typical end 04:00 PT), 15:10 = 22:10 ICT / 00:10 JST (late extensions), 19:10 = 02:10 ICT / 04:10 JST (NA anniversary end 12:00 PT).
- **Why:** `gh run list --event=schedule` (Nov 4–11 2026) showed GitHub throttled the */10 cron to 3–5 runs/day at random times (gaps 3.2–10.4h, avg 5.8h) — configured 144/day never happened. Fixed slots cost the same and land when Atlas data actually changes. Atlas has no outbound webhook; raw data lives on git.atlasacademy.io (not GitHub), so push-triggered sync is impossible without an external poller + repository_dispatch (considered, deferred).
- **Gate logic unchanged:** /info hash check, DO_WORK/DEPLOY gates, self-test skip-on-schedule all untouched. `scripts/test_deploy_workflow.py` gains scenario 10 pinning the cron string, trigger set, and UTC→ICT/JST mapping.
- **Known limit:** GitHub schedule is best-effort — a slot may be delayed or dropped under load; worst-case staleness ~14h (overnight gap 19:10→09:10 UTC). Hourly cron rejected: same throttling, no freshness guarantee. NA ends follow US Pacific time: in PST months (Nov–Mar) they land +1h UTC later than the PDT-based slot math, and the next slot catches them (NA typical ~3h, NA anniversary ~13h).
- **Docs synced:** AGENTS.md layout row, .claude/CLAUDE.md (browser-gate note, branch-flow trigger list, schedule bullet), fetch-data-guideline.md intro (was stale "hourly cron").
```

## Acceptance criteria

- AC1: Given deploy.yml parsed as YAML, then schedule == `[{cron: "10 9,11,15,19 * * *"}]`, push branches `[main]`, force_sync intact (C3).
- AC2: Given cron hours, then ICT/JST mapping == C4 pairs (maintenance-end alignment).
- AC3: Given idle schedule scenario, then DO_WORK=false, no sync/build/deploy (existing scenarios 1–9 still green).
- AC4: Given self-check trio, when run, then all exit 0; test_deploy_workflow prints `10 tests passed`.
- AC5: Given live docs, then no live doc claims 10-min/hourly schedule; history/archive untouched.

## File plan & routing

| File | Owner |
|---|---|
| .github/workflows/deploy.yml (C1+C2) | clean-code-builder |
| AGENTS.md, .claude/CLAUDE.md, .claude/docs/fetch-data-guideline.md, .claude/docs/progress.md (C5) | clean-code-builder (5 files total → clean-code-builder, rule 2) |
| scripts/test_deploy_workflow.py (C4) | software-qa |
| .claude/docs/plans/2026-11-11-atlas-cron-slots.plan.md | lead (plan-of-record, repo copy) |

Not stale: README.md, GEMINI.md, structure.md, code-style.md, data-rules.md, security.md, check_data_version.py, archive/*.

## QA anchor (lead re-runs personally before PASS accepted)

```
python3 scripts/test_deploy_workflow.py && python3 scripts/test_check_data_version.py && python3 scripts/test_drift.py
```
Expect: `10 tests passed` + trio exit 0.

## Round tracker

- Builder round 1: PASS (5 files, C1/C2/C5 verbatim, C3 intact)
- QA round 1: PASS (scenario 10 added, 11/11 mutations caught, trio green, npm 199/199; lead anchor re-run matched, exit 0)
- Reviewer round 1: REJECT — 2 🔵 nits: (a) test_deploy_workflow.py:70 trigger pin subset not equality; (b) deploy.yml comment PDT-only math, NA on PST Nov–Mar (+1h UTC, next slot catches)
- Fix pass 1: builder amends C1 comment + progress entry (PDT→PT + winter note); QA tightens trigger pin to equality. C1/C5 amended above.
- Fix pass 1 result: builder PASS (verbatim), QA PASS (equality pin; pre-fix pull_request mutation SLIPPED → post-fix CAUGHT; lead anchor re-run exit 0 matched)
- Reviewer round 2: PASS — 0 findings; both nits resolved, C3 byte-clean, comment math truthful year-round
- Environmental note: subagent session continuation unavailable (sessionID truncated at "ses" by harness); fix pass + reviewer round 2 ran in fresh sessions with frozen plan context. No format failures — all verdict tokens emitted.
- Final verification (lead, fresh): trio exit 0 (10/8/10 tests), npm run test 199 pass 0 fail exit 0
- Reviewer-driven fix budget: 1/3
- Status: SHIPPED — main ccac161 (merge_code_only, code only, zero develop-only leaks), push run 43004514062 build+deploy success (gh run watch --exit-status, exit 0). Next slot: 11:10 UTC / 18:10 ICT.

## Risks

- GitHub best-effort: slot delay/drop → worst ~14h stale (owner accepted).
- Schedule only fires from default branch: change inert until shipped to main via scripts/merge_code_only.sh + push (owner confirm before push — public deploy).
