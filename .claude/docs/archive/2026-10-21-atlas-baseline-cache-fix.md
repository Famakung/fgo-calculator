# Atlas Baseline Cache Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/info` version gate stop idle `schedule` and `workflow_dispatch` runs again by letting the comparison baselines (`data_version.txt`, `data_hash.txt`) persist across `actions/cache` hits, instead of freezing inside the asset blob.

**Architecture:** One GitHub Actions workflow (`.github/workflows/deploy.yml`) is rewired; the Python gate script keeps its logic and only changes where it reads/writes its baseline file. The two baseline files move from `.cache/atlas/` (inside the script-keyed asset blob, which `actions/cache` never re-saves on an exact-key hit) to `.ci-baselines/`, backed by their own run-scoped `actions/cache/restore@v4` + `actions/cache/save@v4` pair: the `github.run_id` key makes every run a primary-key miss (so `save` always writes) and `restore-keys` picks up the newest baseline.

**Tech Stack:** GitHub Actions YAML, Python 3.12 (stdlib + PyYAML for self-checks), no new dependencies.

**Spec:** No separate spec document — the root-cause evidence (runs #58–#61, 2026-10-20) is recorded in the Context section below; the plan argues from it.

## Context (root cause, verified from CI logs)

- Runs #60 (dispatch 10:58) and #61 (dispatch 11:00) both printed `DATA_VERSION=JP:42a639|NA:3cb951` yet `CHECK=CHANGED` → full sync each time; neither skipped.
- `.github/workflows/deploy.yml` cached `.cache/atlas/` (which holds `data_version.txt` and `data_hash.txt`) in one blob keyed `hashFiles('scripts/sync_atlas_data.py', 'scripts/check_data_version.py')`. `actions/cache` **does not re-save an exact-key hit** ("If the provided key matches an existing cache, a new cache is not created" — confirmed in the action README, and logged as `Cache hit occurred on the primary key …, not saving cache` by both runs).
- The blob key rotated at run #59 (push `c5e96e7`, which edited both hashed scripts) on a miss, saving baseline `JP:ee73b6`. The Atlas JP hash then moved to `42a639`. Every subsequent run restored the frozen `ee73b6` baseline, re-detected `CHANGED`, and its corrected baseline was discarded on the hit. The key only rotates when the scripts change — never when the game data does — so the gate is stuck in `CHANGED` forever after any real upstream update. Same class of bug hits `data_hash.txt`: a genuine data change would rebuild+redeploy every 10 minutes forever.
- `scripts/test_deploy_workflow.py` scenario 4's loop asserts every step after the version check runs on a `push` — the new save step's `if` must include a `push` clause so this invariant keeps holding without editing that loop.

## Global Constraints

- Self-check suites run with plain `python3 scripts/<name>.py` (stdlib + PyYAML only, installed by the `self-test` job via `pip install pyyaml`); each prints `N tests passed` and exits non-zero on any `AssertionError`. No pytest.
- Existing build-job step names are load-bearing — `test_deploy_workflow.py` resolves steps by exact name. Do not rename: `Restore Atlas Data & Asset Cache`, `Check Atlas data version`, `Decide whether to do work`, `Sync latest game data from Atlas Academy`, `Check if generated data changed`.
- Only `actions/cache@v4`, `actions/cache/restore@v4`, `actions/cache/save@v4` are used for caching; Pages artifact/deploy steps are untouched.
- Work on `develop`. Conventional commit prefixes (`fix(ci):`); end each commit message with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- The gate script must keep its self-healing behavior: missing/malformed baseline file ⇒ `CHECK=CHANGED` and rewrite; network failure ⇒ `CHECK=UNKNOWN` and no write (see `scripts/test_check_data_version.py` existing cases — they must stay green unchanged apart from the added path pin).

## File Structure

- Modify `scripts/check_data_version.py` — one constant: `DEFAULT_VERSION_FILE` moves from `.cache/atlas/data_version.txt` to `.ci-baselines/data_version.txt` (`_write_version` already `makedirs`-es the parent).
- Modify `.gitignore` — add `.ci-baselines/`.
- Modify `scripts/test_check_data_version.py` — pin the new default path.
- Modify `.github/workflows/deploy.yml` — new `Restore version baselines` step (after the blob restore, before the version check); new `Save version baselines` step (after `Check if generated data changed`); `HASH_FILE` path in the data-change step + `mkdir -p .ci-baselines`; asset-blob `hashFiles` drops `scripts/check_data_version.py`; blob-step comment rewritten to state the hit-never-resaves rule.
- Modify `scripts/test_deploy_workflow.py` — add structural scenario 9; update the docstring's scenario list.

---

### Task 1: Move the gate baseline out of the asset blob

**Files:**
- Modify: `scripts/check_data_version.py:16`
- Modify: `.gitignore`
- Test: `scripts/test_check_data_version.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_VERSION_FILE = os.path.join(".ci-baselines", "data_version.txt")` in `scripts/check_data_version.py`; task 2's workflow steps cache the `.ci-baselines/` directory.

- [ ] **Step 1: Write the failing test**

In `scripts/test_check_data_version.py`, inside `main()` before the `--- decide() truth table` block, add:

```python
    # the baseline lives outside .cache/atlas so it can persist across asset-cache hits
    assert m.DEFAULT_VERSION_FILE == os.path.join(".ci-baselines", "data_version.txt")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 scripts/test_check_data_version.py`
Expected: `AssertionError` (the constant is still `.cache/atlas/data_version.txt`).

- [ ] **Step 3: Change the constant and ignore the new dir**

In `scripts/check_data_version.py`, line 16 becomes:

```python
DEFAULT_VERSION_FILE = os.path.join(".ci-baselines", "data_version.txt")
```

In `.gitignore`, below the existing `.cache/` line, add:

```
.ci-baselines/
```

- [ ] **Step 4: Run all three suites to verify they pass**

Run: `python3 scripts/test_check_data_version.py && python3 scripts/test_deploy_workflow.py && python3 scripts/test_drift.py`
Expected: each prints its `N tests passed` line, exit 0. (`test_deploy_workflow.py` doesn't read the path yet — it still passes; task 2 pins it.)

- [ ] **Step 5: Commit**

```bash
git add scripts/check_data_version.py scripts/test_check_data_version.py .gitignore
git commit -m "fix(ci): read Atlas version baseline from .ci-baselines, outside the asset blob

The gate baseline shared a cache blob with the images and raw JSON; actions/cache
never re-saves that blob on an exact-key hit, so the baseline froze and every
run after a real data change re-detected CHANGED.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Round-trip the baselines through a run-scoped cache in deploy.yml

**Files:**
- Modify: `.github/workflows/deploy.yml` (blob step lines 43-61; insert restore step after it; `HASH_FILE` line 128; insert save step after the data-change step)
- Test: `scripts/test_deploy_workflow.py` (docstring scenario list; add scenario 9 after scenario 8)

**Interfaces:**
- Consumes: `.ci-baselines/data_version.txt` written by `check_data_version.py` (task 1); `HASH_FILE` variable semantics of the `Check if generated data changed` step.
- Produces: step `Restore version baselines` (`uses: actions/cache/restore@v4`, key `fgo-version-baseline-${{ github.run_id }}`, `restore-keys: fgo-version-baseline-`, `path: .ci-baselines/`) and step `Save version baselines` (`uses: actions/cache/save@v4`, same key and path, `if: github.event_name == 'push' || steps.data_version.outputs.CHECK == 'CHANGED' || steps.data_change.outputs.DATA_DIRTY == 'true'`); asset-cache key `fgo-atlas-cache-${{ runner.os }}-${{ hashFiles('scripts/sync_atlas_data.py') }}`; pinned by scenario 9 of `scripts/test_deploy_workflow.py`.

- [ ] **Step 1: Write the failing test**

In `scripts/test_deploy_workflow.py`, update the module docstring's list to include:

```
  9. baselines persist across asset-cache hits via a run-scoped
     cache/restore + cache/save pair (structural)
```

and append after scenario 8's block (before `print(f"{n} tests passed")`), reusing `steps`, `cache_path`, `cache_key` from scenario 7:

```python
    # 9. the two baseline files live in .ci-baselines/ under their own
    #    run-scoped cache: the github.run_id key makes every run a primary-key
    #    miss (so cache/save always writes the newest state — a hit on the
    #    script-keyed asset blob freezes anything inside it) and restore-keys
    #    fetches it. The asset blob must no longer carry or key off them.
    restores = [s for s in steps if str(s.get("uses", "")).startswith("actions/cache/restore")]
    saves = [s for s in steps if str(s.get("uses", "")).startswith("actions/cache/save")]
    assert len(restores) == 1, "expected exactly one actions/cache/restore step"
    assert len(saves) == 1, "expected exactly one actions/cache/save step"
    rb, sv = restores[0], saves[0]
    assert "github.run_id" in rb["with"]["key"], "baseline cache key must be run-scoped"
    assert rb["with"]["restore-keys"] == "fgo-version-baseline-", "restore-keys must point at the newest baseline"
    assert sv["with"]["key"] == rb["with"]["key"], "save must reuse the run's primary key"
    assert rb["with"]["path"] == sv["with"]["path"] == ".ci-baselines/", "baselines must live in .ci-baselines/"
    assert ".ci-baselines" not in cache_path, "asset blob must not carry the baselines"
    assert "check_data_version.py" not in cache_key, "asset cache key must not hash the gate script"
    data_change_run = next(s for s in steps if s.get("name") == "Check if generated data changed")["run"]
    assert 'HASH_FILE=".ci-baselines/data_hash.txt"' in data_change_run, "data-hash baseline moved to .ci-baselines"
    names = [s.get("name") for s in steps]
    assert names.index("Restore version baselines") < names.index("Check Atlas data version"), "baselines must restore before the gate reads them"
    assert names.index("Check if generated data changed") < names.index("Save version baselines"), "save must run after both baseline writers"
    n += 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 scripts/test_deploy_workflow.py`
Expected: `AssertionError: expected exactly one actions/cache/restore step`.

- [ ] **Step 3: Apply the workflow edits**

In `.github/workflows/deploy.yml`:

3a. Replace the `Restore Atlas Data & Asset Cache` step's comment block (lines ~51-60, the one explaining why `check_data_version.py` is hashed) and its `key:` with — the `path:` list stays byte-for-byte as today:

```yaml
          # Primary key only (no restore-keys): when the sync script changes we
          # want a fully clean rebuild, not the previous script version's blob.
          # This blob holds regenerable bytes only: downloaded images, the raw
          # API JSON + ETags under .cache/atlas/, and the generated
          # src/scripts/data/ JS (so the drift path revalidates in place). The
          # gate's comparison baselines do NOT live here: actions/cache never
          # re-saves a blob on an exact-key hit, so state that changes with the
          # game data would freeze at the value from the last miss — the
          # "CHECK=CHANGED forever" failure that made runs #60/#61 (2026-10-20)
          # redo the full sync. They live in .ci-baselines/, round-tripped by
          # the run-scoped restore/save pair below.
          key: fgo-atlas-cache-${{ runner.os }}-${{ hashFiles('scripts/sync_atlas_data.py') }}
```

3b. Insert immediately after the blob step:

```yaml
      # Baselines must persist even when the asset cache HITS, so they sit in a
      # cache keyed on github.run_id: every run misses the primary key (the
      # save below always writes) and restore-keys fetches the newest one.
      # First run on a branch: no match → files missing → gate yields CHANGED →
      # saved. Self-healing.
      - name: Restore version baselines
        uses: actions/cache/restore@v4
        with:
          path: .ci-baselines/
          key: fgo-version-baseline-${{ github.run_id }}
          restore-keys: fgo-version-baseline-
```

3c. In the `Check if generated data changed` step, change the first line of its `run` block from `HASH_FILE=".cache/atlas/data_hash.txt"` to:

```bash
mkdir -p .ci-baselines
HASH_FILE=".ci-baselines/data_hash.txt"
```

(`mkdir -p` is needed because on a first run whose gate yields `UNKNOWN`, no step creates the directory before the redirect.)

3d. Insert immediately after that data-change step:

```yaml
      # Bare-form `if` (no ${{ }} wrapper): matches every other gated step in
      # this file, and scripts/test_deploy_workflow.py's would_run() evaluates
      # the stored condition string as-is.
      - name: Save version baselines
        if: github.event_name == 'push' || steps.data_version.outputs.CHECK == 'CHANGED' || steps.data_change.outputs.DATA_DIRTY == 'true'
        uses: actions/cache/save@v4
        with:
          path: .ci-baselines/
          key: fgo-version-baseline-${{ github.run_id }}
```

The `push` clause keeps scenario 4's invariant ("on a push, nothing after the check is blocked"); the other two clauses re-persist exactly when a file was rewritten. On idle `UNCHANGED` runs `data_change` is skipped, `DATA_DIRTY` is empty, and the step saves nothing.

- [ ] **Step 4: Run all three suites to verify they pass**

Run: `python3 scripts/test_deploy_workflow.py && python3 scripts/test_check_data_version.py && python3 scripts/test_drift.py`
Expected: `9 tests passed`, then the other suites' `N tests passed` lines, exit 0. Scenario 4 must pass unmodified thanks to the `push` clause; scenarios 1/5 (idle, dispatch-unchanged) must keep `Save version baselines` false.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml scripts/test_deploy_workflow.py
git commit -m "fix(ci): round-trip Atlas baselines through a run-scoped cache so idle runs skip again

actions/cache never re-saves an exact-key hit, so data_version.txt/data_hash.txt
inside the script-keyed asset blob froze after every real data change and the
gate re-detected CHANGED forever (dispatch runs #60/#61). Baselines now live in
.ci-baselines/ with cache/restore + cache/save keyed on github.run_id.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Verify on live CI (after the change is merged to `main`)

`gh workflow run deploy.yml` executes the workflow stored on the default branch (`main`), so this cannot pass from `develop` alone. Ask the user to merge `develop` → `main` (the merge push also exercises the push path), then:

- [ ] **Step 1: First dispatch after merge (seeds the baselines)**

Run: `gh workflow run deploy.yml && sleep 5 && gh run list --workflow deploy.yml --limit 1`
Then: `gh run watch <run-id>` — Expected: this run does full work (`CHECK=CHANGED` — first miss on the new `.ci-baselines/` cache and a one-time asset-blob rebuild from the key change), ends `Data change: OK`, `Save version baselines` ran.

- [ ] **Step 2: Second dispatch (must skip)**

Run: `gh workflow run deploy.yml`
Then: `gh run view <run-id> --log | grep -aE "CHECK=|Doing work|Nothing to do|Save version baselines"`
Expected: `CHECK=UNCHANGED`, `Atlas data unchanged and no force requested (event=workflow_dispatch). Nothing to do.`, no sync/build lines, `Save version baselines` skipped. This is the bug's reproduction — #61 must now skip.

- [ ] **Step 3: Confirm the deploy job skipped, run is green**

Run: `gh run view <run-id>`
Expected: overall `✓ main Build & Deploy … workflow_dispatch` success; `deploy` job shown as skipped.

- [ ] **Step 4: Rerun probe (final-review finding #1 regression guard)**

Run: `gh run rerun <run-id-from-step-1> && gh run watch <run-id-from-step-1>`
Expected: the rerun goes green — `Save version baselines` does not fail with "already exists" (the `github.run_attempt` suffix makes attempt 2's key unique; an unattempted rerun of a run that never reached the save is also fine).

No commit for this task (observation only). If step 2 still shows `CHANGED`, return to Phase 1 of systematic-debugging — do not iterate on the fix.

(Rulings after this plan was written, see ledger: keys are `fgo-version-baseline-${{ github.run_id }}-${{ github.run_attempt }}`, and `Save version baselines` moved to after `Upload Pages artifact` — a failed build must not persist baselines and silently swallow the update.)

---

## Review Focus

Failure modes the tests don't fully exercise; each line's owning task pins what it can:

- **Idle run with a transient `/info` network error:** `CHECK=UNKNOWN` ⇒ the run does full work and must NOT fail or write a baseline (script already self-heals — `test_check_data_version.py` network-error case; task 1 keeps it green).
- **First runs on the new scheme:** the asset-blob key change forces one clean blob rebuild (re-download images once), and the missing `.ci-baselines/` seed forces one `CHANGED` run — both are expected one-time costs after the merge, not regressions (task 3 step 1 documents the observation).
- **A `push` whose gate also hits `UNKNOWN`:** no baseline file exists to save ⇒ `Save version baselines` uploads an empty cache ⇒ next run restores "empty" ⇒ one extra `CHANGED` run, self-healing. Accepted; do not add guards (shortcut: harmless, upgrade only if empty-seed runs ever go red).
- **Baseline cache eviction** under the repo's 10 GB cache limit: restores fall back to prefix-miss ⇒ one extra `CHANGED` run only; with saves gated on change, growth is ~1 small cache per real data update.
- **force_sync dispatch:** gate runs with `--force` ⇒ `CHECK=CHANGED` ⇒ always saves (duplicate tiny cache entry per forced run). Intended — a forced run is a human asking to redo work.
