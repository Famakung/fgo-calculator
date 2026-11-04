# JP+NA Version Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the CI data-version gate from JP.hash to JP.hash AND NA.hash, so idle 10-minute polls also stop when only NA data is unchanged, and fix the red `test_deploy_workflow.py` self-check that the DO_WORK refactor broke.

**Architecture:** `check_data_version.py` fetches `/info` (already contains all locale hashes) and compares two hashes stored in a two-line `.cache/atlas/data_version.txt`. `CHECK` contract stays identical (`UNCHANGED|CHANGED|UNKNOWN`), so `deploy.yml` is untouched. The ETag layer and the generated-data hash gate already exist and are unchanged.

**Tech Stack:** Python 3 stdlib (urllib, json), GitHub Actions, plain-assert self-check scripts (no pytest in CI).

**Spec:** In-chat decision, 2026-10-20 — keep all three layers (gate + ETag + data-hash); gate scope becomes JP+NA. Rationale: the app consumes JP data plus NA CE names and NA CE bond-bonus traits; JP.hash alone misses NA-only updates.

## Global Constraints

- Python: stdlib only, no new dependencies.
- `CHECK` values must stay exactly `UNCHANGED`, `CHANGED`, `UNKNOWN` (workflow gates and tests string-compare them).
- `GITHUB_OUTPUT` still receives exactly one line: `CHECK=<status>`.
- Any fetch/parse failure in EITHER locale must fail open: `CHECK=UNKNOWN`, no version file write, exit 0.
- `data_version.txt` format: two lines, `JP <hash>\nNA <hash>\n` (locale name, space, hash per line).
- `data:sync` (`sync_atlas_data.py --clean-cache`) wipes `.cache/atlas/` — version file is not preserved there; acceptable (local dev only, CI has its own cache blob).
- Commit messages end with: `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- Tests run with: `python3 scripts/test_check_data_version.py` and `python3 scripts/test_deploy_workflow.py` (each prints `N tests passed`).

## Review Focus

- `/info` response missing the `NA` key (future API change): expect `CHECK=UNKNOWN`, file untouched — pinned in Task 2 test "NA key missing".
- `NA.hash` changed while `JP.hash` unchanged: expect `CHECK=CHANGED` and both lines rewritten — pinned in Task 2 test "NA-only change".
- Existing single-line `data_version.txt` (first run after this change): any parse mismatch means stored != latest, expect `CHECK=CHANGED`, self-heals by rewriting the two-line file.
- `--force` flag: still forces `CHANGED` even when both hashes match (used by `force_sync`) — pinned in Task 2 decide() table.
- `workflow_dispatch` without `force_sync` when both hashes match: entire build/deploy skips (existing behavior, pinned by Task 1 scenario 1).

---

### Task 1: Fix `scripts/test_deploy_workflow.py` (currently RED)

The DO_WORK/DEPLOY refactor (commit `afcd803`) replaced the "Stop if data unchanged" marker step with "Decide whether to do work" and re-gated every step. The self-check still models the old design and fails on assertion 1. It pins gate behavior, so it must pass again before merge.

**Files:**
- Modify: `scripts/test_deploy_workflow.py`

**Interfaces:**
- Consumes: `.github/workflows/deploy.yml` build-job steps. After the "Check Atlas data version" step, every real-work step has `if: steps.do_work.outputs.DO_WORK == 'true'` or `if: steps.data_change.outputs.DEPLOY == 'true'`; "Decide whether to do work" has no `if`. The decide step's bash computes `DO_WORK = (github.event_name == "push") OR (CHECK != "UNCHANGED")`; the data-change step computes `DEPLOY = (push) OR (force_sync == "true") OR (DIRTY == "true")`, and only runs when DO_WORK.
- Produces: a green `test_deploy_workflow.py` (prints `3 tests passed`).

- [ ] **Step 1: Write the failing state**

Run: `python3 scripts/test_deploy_workflow.py`
Expected: FAIL, `AssertionError: step 'Decide whether to do work' would run on an idle schedule run`

- [ ] **Step 2: Update the model in `scripts/test_deploy_workflow.py`**

Replace `VARS` so the condition evaluator understands the new gate expressions:

```python
VARS = {
    "steps.do_work.outputs.DO_WORK": "W",
    "steps.data_change.outputs.DEPLOY": "P",
    "steps.data_change.outputs.DATA_DIRTY": "D",
    "steps.data_version.outputs.CHECK": "C",
    "github.event_name": "G",
}

MARKER = "Decide whether to do work"
```

Change `would_run` to take and evaluate `W` and `P` instead of only `D` (same eval mechanism, five vars). Keep its docstring updated to say it evaluates step `if` conditions for a scenario.

- [ ] **Step 3: Rewrite the three scenarios**

For each step after the version check, compute `W` first: `W = "true" if (G == "push" or C != "UNCHANGED") else "false"`. Then `P` (only meaningful when `W == "true"`): `P = "true" if (G == "push" or F == "true" or D == "true") else "false"`, with `F` the `force_sync` value.

Scenarios (name, G, C, F, D, expected):
1. Idle schedule: `G="schedule", C="UNCHANGED", F="false", D=""` — only `MARKER` may run; every other step after the check must NOT run.
2. Schedule, data changed, data dirty: `G="schedule", C="CHANGED", F="false", D="true"` — "Sync latest game data from Atlas Academy", "Check if generated data changed", "Validate data integrity", "Build", "Verify build outputs", "Upload Pages artifact" must all run.
3. Schedule, data changed, data clean (the hash-gate skip): `G="schedule", C="CHANGED", F="false", D="false"` — Sync and "Check if generated data changed" run; "Build" and "Upload Pages artifact" must NOT run.
4. Push, worst case: `G="push", C="UNCHANGED", F="false", D="false"` — nothing after the check may be blocked.
5. Manual dispatch, no force, unchanged (the 2026-10-20 fix): `G="workflow_dispatch", C="UNCHANGED", F="false", D=""` — only `MARKER` may run.
6. Manual dispatch with force: `G="workflow_dispatch", C="UNCHANGED", F="true", D="false"` — everything after the check must run. (Note: the decide step's bash passes `--force` into the check script, so real CI yields `C="CHANGED"` here; modeling `C="UNCHANGED" + F="true"` is the conservative case — if it passes, the force case does too.)

Print `6 tests passed` (one `n += 1` per scenario).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 scripts/test_deploy_workflow.py`
Expected: `6 tests passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/test_deploy_workflow.py
git commit -m "test(ci): update deploy workflow self-check for DO_WORK/DEPLOY gates

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Extend `check_data_version.py` to JP + NA

**Files:**
- Modify: `scripts/check_data_version.py`
- Test: `scripts/test_check_data_version.py`

**Interfaces:**
- Consumes: `GET {ATLAS_INFO_URL}` returning JSON with per-locale objects, e.g. `{"JP": {"hash": "ee73b6", "timestamp": 1}, "NA": {"hash": "93ef86", "timestamp": 2}, ...}`.
- Produces (module-level, used by the test):
  - `fetch_latest(url) -> (str | None, str | None)` — `(jp_hash, na_hash)`; `None` for the whole tuple on failure (keep the existing 2-attempt/3s-retry behavior; the tuple is `None` values, decided by one failed fetch of the single `/info` response).
  - `decide(latest, stored, force) -> str` — `latest` is now the 2-tuple; `stored` is the 2-tuple read from the two-line file (each element `None` if that line is missing/unparseable). Returns `"UNKNOWN"` if `force` is not set AND either latest element is `None`; `"CHANGED"` if `force`, or either stored element is `None`, or either pair differs; else `"UNCHANGED"`.
  - Version file format: `JP <hash>\nNA <hash>\n`, written only on `CHANGED`.
  - CLI stdout: `DATA_VERSION=JP:<jp>|NA:<na>` (dashes for failures) then `CHECK=<status>`; `GITHUB_OUTPUT` still gets only `CHECK=<status>`.
- Workflow impact: none. `deploy.yml` reads only `CHECK`. Cache key already hashes `check_data_version.py`, so the format change invalidates the actions cache on first run and re-saves the two-line file.

- [ ] **Step 1: Write the failing tests in `scripts/test_check_data_version.py`**

Add to the existing `decide()` truth-table section (before the server tests):

```python
assert m.decide(("a", "b"), ("a", "b"), False) == "UNCHANGED"
assert m.decide(("b", "b"), ("a", "b"), False) == "CHANGED"   # JP-only change
assert m.decide(("a", "c"), ("a", "b"), False) == "CHANGED"   # NA-only change
assert m.decide(("a", None), ("a", "b"), False) == "UNKNOWN"  # NA fetch failed
assert m.decide(("a", "b"), (None, None), False) == "CHANGED" # first run / legacy file
assert m.decide(("a", "b"), ("a", "b"), True) == "CHANGED"    # force
assert m.decide((None, None), (None, None), True) == "UNKNOWN"
```

These fail first because `decide` still takes a single string.

Add a legacy-file case (its own counter block, right after the "missing file is changed + created" block): pre-write the old single-line format `"abc123\n"` to a fresh file, run the CLI, expect `CHECK=CHANGED` and the file rewritten to the two-line `"JP abc123\nNA def456\n"` (old format self-heals, never crashes).

Update the mock server body to include both locales:

```python
body = b'{"JP": {"hash": "abc123"}, "NA": {"hash": "def456"}}'
```

Update the file-format assertions: the "changed" and "missing file" cases now expect the file content `"JP abc123\nNA def456\n"`; the "unchanged keeps file" case must pre-write that same two-line content; the `DATA_VERSION` assertion becomes `assert "DATA_VERSION=JP:abc123|NA:def456" in out`. Add two server-body cases to the malformed section: `{"JP": {"hash": "abc123"}}` (NA missing) and `{"NA": {"hash": "x"}}` (JP missing) — both must yield `CHECK=UNKNOWN` and no file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 scripts/test_check_data_version.py`
Expected: FAIL (assertion errors from the new tuple-based `decide` calls).

- [ ] **Step 3: Implement the two-hash version in `scripts/check_data_version.py`**

- `fetch_latest(url)`: on success return `(data.get("JP", {}).get("hash"), data.get("NA", {}).get("hash"))`; on any exception return `(None, None)` after the existing 2 attempts.
- `_read_stored(path) -> dict`: parse lines of the form `JP <hash>` / `NA <hash>`; missing locale key or missing file becomes a dict without that key (`{}`).
- `decide(latest, stored, force)`: signature per Interfaces. Compare element-wise.
- `_write_version(path, jp, na)`: write `JP {jp}\nNA {na}\n`.
- `main()`: convert the stored dict to a tuple `(d.get("JP"), d.get("NA"))` for `decide`; print `DATA_VERSION=JP:{jp or '-'}|NA:{na or '-'}` and `CHECK={status}`; write file only on `CHANGED`; `GITHUB_OUTPUT` unchanged (`CHECK=` line only); keep `return 0`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 scripts/test_check_data_version.py`
Expected: all asserts pass, prints `7 tests passed` (existing 6 blocks + the legacy-file block; the new decide-table asserts and the two new malformed server-body cases live inside existing counter blocks). Exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/check_data_version.py scripts/test_check_data_version.py
git commit -m "feat(ci): gate on JP and NA Atlas data versions

The app consumes NA CE names and bond-bonus traits; JP.hash alone
missed NA-only updates. data_version.txt becomes two lines; cache key
already hashes this script so the new format self-heals on first run.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Verification (after both tasks)

1. Both self-checks green: `python3 scripts/test_check_data_version.py && python3 scripts/test_deploy_workflow.py`.
2. Push to main; watch the run: expect one cache MISS (new `hashFiles` value), full sync, `DATA_VERSION=JP:<h>|NA:<h>`, and `Cache saved`.
3. `gh workflow run deploy.yml` (no force): expect `CHECK=UNCHANGED`, `DO_WORK=false`, deploy job skipped.
