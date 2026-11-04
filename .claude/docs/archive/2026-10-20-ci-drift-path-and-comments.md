# CI Comments Fix + (Optional) Data-File Drift Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stale "JP-only" gate comments in `deploy.yml` (definitely), and document a decision on activating the targeted drift path by caching the generated data dir (recommended: NO — see below).

**Architecture:** `deploy.yml` comments now misdescribe the version gate as JP-only; the gate covers JP + NA (added `fa4c00b`). That's a doc-only fix. Separately, CI currently `rm -f src/scripts/data/*.js` before sync, forcing a full regen each run. The targeted incremental path (`revalidate_servant_traits` drift diff + append) exists but is dead in CI because the file is wiped first. Caching the data dir + dropping the `rm -f` would activate it — but the benefit is ~1–2s of saved CPU per run and it adds a drift-persistence failure mode. **Recommendation: do Task 1 only; do NOT do Task 2.**

**Tech Stack:** YAML workflow comments; `actions/cache@v4`; existing `scripts/test_deploy_workflow.py` YAML-parsing self-test.

**Spec:** This conversation's "all current concern" triage — concern #1 (stale comments) and concern #2 (dead drift path).

## Global Constraints

- `deploy.yml` behavior (step gates, `DO_WORK`/`DEPLOY`, cache key, triggers) must NOT change in Task 1 — comments only.
- The self-test `python3 scripts/test_deploy_workflow.py` must stay green after any `deploy.yml` edit (it `yaml.safe_load`s the file).
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- 2-space indent, LF line endings.

## Review Focus

- Comment edits must not accidentally change YAML structure (a misplaced `#` or indent could drop a step). The self-test + `yaml.safe_load` pin this.
- If Task 2 is ever executed, dropping `rm -f` means CI carries generated state forward — the cache key MUST keep hashing `scripts/sync_atlas_data.py` so any format change invalidates the data cache (it already does). Do not remove that hashFile.

---

### Task 1: Fix stale JP-only gate comments in deploy.yml

**Files:**
- Modify: `.github/workflows/deploy.yml:7,57,69` (comments only — no code, no `if`, no `key:`)

**Interfaces:**
- Consumes: nothing.
- Produces: corrected prose; no code contract.

The three comment blocks still describe the gate as checking a single `JP.hash`. The gate now compares `JP` and `NA` (and the dispatch line understates that a no-force dispatch also works when the version changed).

- [ ] **Step 1: Confirm baseline is green and capture current lines**

Run: `python3 scripts/test_deploy_workflow.py` → Expected: `6 tests passed`
Run: `sed -n '5,9p;56,59p;64,73p' .github/workflows/deploy.yml` → confirm the three targets match the strings below.

- [ ] **Step 2: Edit the schedule comment (line 7 area)**

Replace:
```
    # Poll every 10 min: a ~230-byte /info version check stops the run when
    # JP.hash is unchanged; otherwise the Atlas API is ETag-revalidated
    # (304 = ~0 bytes) and the build is skipped when no data changed, so idle
    # runs are near-free.
```
with:
```
    # Poll every 10 min: a ~230-byte /info version check stops the run when
    # both JP and NA hashes are unchanged; otherwise the Atlas API is
    # ETag-revalidated (304 = ~0 bytes) and the build is skipped when no data
    # changed, so idle runs are near-free.
```

- [ ] **Step 3: Edit the check-step comment (line 57)**

Replace:
```
      # ~230-byte GET /info vs cached JP.hash; idle schedule runs stop on UNCHANGED.
```
with:
```
      # ~230-byte GET /info vs cached JP + NA hashes; idle schedule/dispatch runs stop on UNCHANGED.
```

- [ ] **Step 4: Edit the do-work dispatch comment (line 69)**

Replace:
```
      #   - workflow_dispatch: only if force_sync is on (CHECK already reflects it)
```
with:
```
      #   - workflow_dispatch: only if force_sync is on, or the version changed (CHECK != UNCHANGED)
```

- [ ] **Step 5: Verify YAML still parses and the self-test is green**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml ok')"` → Expected: `yaml ok`
Run: `python3 scripts/test_deploy_workflow.py` → Expected: `6 tests passed`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
docs(ci): correct stale JP-only version-gate comments

The gate checks JP and NA since fa4c00b; comments still said JP-only.
Also fix the dispatch line: a no-force dispatch does work when the
version changed, not only under force_sync.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: (NOT RECOMMENDED) Cache generated data dir to activate the targeted drift path

**Why this is in the plan:** you asked to spec it so the tradeoff is concrete. **I recommend against it.** Rationale, in one block:

- Full regen (today) on a **warm** icon cache is a few seconds of local reformatting — no icon downloads, no heavy network. The 3-minute case was a **cold** cache (one-time, per cache-key rotation).
- Full regen and the incremental path produce the **same** `DATA_DIRTY` (both are content-derived), so caching the data dir saves **no** deploys.
- The only thing saved is ~1–2s of CPU per sync run (skip reformatting 471 unchanged entries).
- The risk added is real: with `rm -f` gone, a stale servant entry survives as long as `revalidate_servant_traits` fails to flag its drift. Today, full regen rebuilds every entry, so a missed drift is impossible to persist. Activating the incremental path makes the drift detector's correctness load-bearing in CI for the first time.

**Decision: skip Task 2** unless you specifically want the ~1–2s saved and accept the drift-persistence risk. If you do, the steps below are complete and TDD-ready.

**Files:**
- Modify: `.github/workflows/deploy.yml:46-49` (cache `path:`) and `:112-115` (sync `run:`)
- Test: `scripts/test_deploy_workflow.py` (add config assertions)

**Interfaces:**
- Produces: cache `path` includes `src/scripts/data/`; sync `run` has no `rm -f`.

- [ ] **Step 1: Write the failing test** — append to `scripts/test_deploy_workflow.py`, before the final `print`:

```python
    # 7. generated data dir is cached and NOT wiped, so the targeted
    #    drift path (revalidate_servant_traits) runs in CI instead of a
    #    full regen; the cache key must keep hashing sync_atlas_data.py
    spec = yaml.safe_load(open(os.path.normpath(WF), encoding="utf-8"))
    steps = spec["jobs"]["build"]["steps"]
    cache_path = next(s for s in steps if s.get("name") == "Restore Atlas Data & Asset Cache")["with"]["path"]
    sync_run = next(s for s in steps if s.get("name") == "Sync latest game data from Atlas Academy")["run"]
    assert "src/scripts/data/" in cache_path, "data dir not in cache path"
    assert "rm -f" not in sync_run, "sync still wipes generated data"
    n += 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 scripts/test_deploy_workflow.py` → Expected: FAIL on `assert "src/scripts/data/" in cache_path`

- [ ] **Step 3: Add the data dir to the cache path**

In the `Restore Atlas Data & Asset Cache` step's `path:`, after `public/craft_essences/` add:
```
            src/scripts/data/
```

- [ ] **Step 4: Remove the wipe from the sync step**

Delete this line from the sync step's `run:`:
```
          rm -f src/scripts/data/*.js
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 scripts/test_deploy_workflow.py` → Expected: `7 tests passed`

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml scripts/test_deploy_workflow.py
git commit -m "$(cat <<'EOF'
ci: cache generated data dir to run the targeted drift path in CI

Drops the pre-sync `rm -f` so revalidate_servant_traits() can detect
old-servant trait changes and update in place instead of regenerating
all entries. Cache key already hashes sync_atlas_data.py, so a format
change invalidates the data cache and falls back to full regen.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Verification (if Task 2 is executed)

Both tests green locally, then on the next `push` to main:
- First run after the change: data dir absent from cache → full regen → cache saved with the data dir.
- A subsequent idle `schedule`/dispatch that hits CHANGED: log should show "Current local dataset contains 470 servants" (not 0) and "Servant dataset is already 100% up-to-date" on a no-data-change CHANGED run — proving the incremental path ran and the drift detector found nothing to rewrite.
- Rollback is trivial: re-add the `rm -f` line + drop the cache path + revert the test.

## Self-Review

- Spec coverage: concern #1 → Task 1 (3 comment edits). Concern #2 → Task 2 (spec'd, recommended against). Both covered.
- Step scan: Task 1 steps are exact old→new string swaps with a parse check. Task 2 steps are a pinned assertion + two precise edits. No "handle edge cases" lines.
- Type consistency: N/A (no new functions; Task 2 test uses the same `yaml.safe_load` + step-name lookup as existing scenarios).
- Review Focus: YAML-integrity pinned by `yaml.safe_load` + the self-test in both tasks; cache-key-integrity called out in Global Constraints for Task 2.
- Proportion: Task 1 is 4 comment lines — below the threshold where a full SDD plan earns its keep; it is included only because the user asked to see #2 spec'd alongside it. Honest framing: Task 1 can be done as a direct edit without SDD ceremony.
