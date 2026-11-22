"""Self-check for the /info gate wiring in .github/workflows/deploy.yml.

Run: python3 scripts/test_deploy_workflow.py
Pins scenarios of the build job (DO_WORK/DEPLOY gates):
  1. idle dispatch, no force (CHECK=UNCHANGED)      -> only the decide step may run after the version check
  2. dispatch, no force, CHECK=CHANGED, data dirty  -> sync through upload all run
  3. dispatch, no force, CHECK=CHANGED, data clean  -> sync + hash check run, build/upload skip
  4. push (any CHECK)                               -> no step after the check may be blocked
  5. workflow_dispatch, force_sync (CHECK=CHANGED)  -> every step after the check runs
  6. generated data dir is cached and not wiped; asset-cache key hashes sync_atlas_data.py (structural)
  7. self-test job runs all suites unconditionally (structural)
  8. baselines persist across asset-cache hits via a run-scoped
     cache/restore + cache/save pair (structural)
  9. trigger pin (structural): triggers are push [main] and workflow_dispatch
     (no schedule), with force_sync boolean-default-false intact
"""

import os
import unittest

import yaml

WF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "workflows", "deploy.yml")

VARS = {
    "steps.do_work.outputs.DO_WORK": "W",
    "steps.data_change.outputs.DEPLOY": "P",
    "steps.data_change.outputs.DATA_DIRTY": "D",
    "steps.data_version.outputs.CHECK": "C",
    "github.event_name": "G",
}

MARKER = "Decide whether to do work"


def would_run(cond, G, C, D, W, P):
    """Evaluate a step's `if` (or 'true' when absent) for a scenario. Conditions only use ==/!=, &&, ||, literals."""
    if not cond:
        return True
    expr = cond
    for key, var in sorted(VARS.items(), key=len, reverse=True):
        expr = expr.replace(key, var)
    expr = expr.replace("&&", " and ").replace("||", " or ")
    return bool(eval(expr, {"__builtins__": {}}, {"G": G, "C": C, "D": D, "W": W, "P": P}))


def steps_after_check():
    spec = yaml.safe_load(open(os.path.normpath(WF), encoding="utf-8"))
    steps = spec["jobs"]["build"]["steps"]
    idx = next(i for i, s in enumerate(steps) if s.get("name") == "Check Atlas data version")
    return [(s.get("name") or s.get("uses", "?"), s.get("if")) for s in steps[idx + 1 :]]


def scenario_values(G, C, F, D):
    """Derive W (DO_WORK) and P (DEPLOY) exactly as the workflow's bash computes them."""
    W = "true" if (G == "push" or C != "UNCHANGED") else "false"
    P = "true" if (G == "push" or F == "true" or D == "true") else "false"
    return W, P


def trigger_pin(spec):
    """Pin the trigger set on a parsed workflow spec (push + workflow_dispatch, no schedule).

    Takes the spec as an argument so a mutation harness can feed a doctored copy.
    """
    # PyYAML gotcha: bare `on:` parses as boolean key True, not the string "on".
    on = spec.get("on", spec.get(True))
    assert on is not None and "schedule" not in on and set(on) == {"push", "workflow_dispatch"}, (
        f"trigger set drifted: {sorted(map(str, on or {}))}"
    )
    assert on["push"]["branches"] == ["main"], f"push branches drifted: {on['push']['branches']!r}"
    force = on["workflow_dispatch"].get("inputs", {}).get("force_sync")
    assert force is not None, "force_sync input removed"
    assert force.get("type") == "boolean", f"force_sync type drifted: {force!r}"
    assert force.get("default") is False, f"force_sync default drifted: {force!r}"


def main():
    n = 0

    # 1. idle dispatch, no force: nothing after the check runs except the marker
    W, P = scenario_values("workflow_dispatch", "UNCHANGED", "false", "")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert not would_run(cond, "workflow_dispatch", "UNCHANGED", "", W, P), f"step {name!r} would run on an idle dispatch run: if={cond!r}"
    n += 1

    # 2. dispatch, no force, data changed, data dirty: sync through upload must all run
    W, P = scenario_values("workflow_dispatch", "CHANGED", "false", "true")
    for name in (
        "Sync latest game data from Atlas Academy",
        "Check if generated data changed",
        "Validate data integrity",
        "Build",
        "Check build output",
        "Verify build outputs",
        "Upload Pages artifact",
    ):
        cond = next(c for nm, c in steps_after_check() if nm == name)
        assert would_run(cond, "workflow_dispatch", "CHANGED", "true", W, P), f"step {name!r} is blocked when data changed and dirty"
    n += 1

    # 3. dispatch, no force, data changed, data clean: sync + hash check run, node setup/install/build/upload skip
    W, P = scenario_values("workflow_dispatch", "CHANGED", "false", "false")
    for name, cond in steps_after_check():
        if name in (
            "Set up Node.js",
            "Install Node dependencies",
            "Validate data integrity",
            "Build",
            "Check build output",
            "Verify build outputs",
            "Upload Pages artifact",
        ):
            assert not would_run(cond, "workflow_dispatch", "CHANGED", "false", W, P), f"step {name!r} should skip when generated data is clean: if={cond!r}"
        else:
            assert would_run(cond, "workflow_dispatch", "CHANGED", "false", W, P), f"step {name!r} should run when data changed (clean): if={cond!r}"
    n += 1

    # 4. push, worst case (data clean, CHECK stale): nothing after the check is blocked
    W, P = scenario_values("push", "UNCHANGED", "false", "false")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert would_run(cond, "push", "UNCHANGED", "false", W, P), f"step {name!r} is blocked on a push: if={cond!r}"
    n += 1

    # 5. manual dispatch with force_sync: the check step passes --force, so real
    #    CI yields CHECK=CHANGED even when both hashes match — model that; every
    #    step after the check must run
    W, P = scenario_values("workflow_dispatch", "CHANGED", "true", "false")
    for name, cond in steps_after_check():
        if name == MARKER:
            continue
        assert would_run(cond, "workflow_dispatch", "CHANGED", "false", W, P), f"step {name!r} is blocked on a forced dispatch: if={cond!r}"
    n += 1

    # 7. generated data dir is cached and NOT wiped, so the targeted drift path
    #    (revalidate_servant_traits) runs in CI instead of a full regen; asset cache
    #    runs only when DO_WORK is true, hashes both sync scripts + version baseline,
    #    data_version checks active shop state (--check-shop), and data-hash covers all 5 data files
    spec = yaml.safe_load(open(os.path.normpath(WF), encoding="utf-8"))
    steps = spec["jobs"]["build"]["steps"]
    cache_step = next(s for s in steps if s.get("name") == "Restore Atlas Data & Asset Cache")
    cache_path = cache_step["with"]["path"]
    cache_key = cache_step["with"]["key"]
    sync_run = next(s for s in steps if s.get("name") == "Sync latest game data from Atlas Academy")["run"]
    assert "src/scripts/data/" in cache_path, "data dir not in cache path"
    assert ".cache/atlas/" not in cache_path, ".cache/atlas/ must not share the script-hashed cache"
    for static_img_dir in ("public/servants/", "public/craft_essences/", "public/skill_icons/", "public/event_shop/"):
        assert static_img_dir not in cache_path, f"{static_img_dir} must not share the script-hashed cache"
    raw_cache_step = next(s for s in steps if s.get("name") == "Restore Atlas Raw API Cache")
    raw_cache_path = raw_cache_step["with"]["path"]
    raw_cache_key = raw_cache_step["with"]["key"]
    assert ".cache/atlas/" in raw_cache_path, ".cache/atlas/ missing from raw API cache"
    assert raw_cache_step.get("if") == "steps.do_work.outputs.DO_WORK == 'true'", "raw API cache restore must skip on idle runs"
    assert "data_version.txt" in raw_cache_key, "raw API cache key must hash .ci-baselines/data_version.txt"
    assert "sync_atlas_data.py" not in raw_cache_key, "raw API cache key must not hash sync_atlas_data.py"
    assert "fetch_bordered_ces.py" not in raw_cache_key, "raw API cache key must not hash fetch_bordered_ces.py"
    img_cache_step = next(s for s in steps if s.get("name") == "Restore Static Image Cache")
    img_cache_path = img_cache_step["with"]["path"]
    img_cache_key = img_cache_step["with"]["key"]
    img_restore_keys = img_cache_step["with"].get("restore-keys") or ""
    for static_img_dir in ("public/servants/", "public/craft_essences/", "public/skill_icons/", "public/event_shop/"):
        assert static_img_dir in img_cache_path, f"{static_img_dir} missing from static image cache"
    assert img_cache_step.get("if") == "steps.do_work.outputs.DO_WORK == 'true'", "static image cache restore must skip on idle runs"
    assert img_cache_key.startswith("fgo-static-images-v2-"), "static image cache key must use v2 prefix"
    assert "data_version.txt" in img_cache_key, "static image cache key must hash .ci-baselines/data_version.txt"
    assert "sync_atlas_data.py" not in img_cache_key, "static image cache key must not hash sync_atlas_data.py"
    assert "fetch_bordered_ces.py" not in img_cache_key, "static image cache key must not hash fetch_bordered_ces.py"
    assert "fgo-static-images-v2-${{ runner.os }}-" in img_restore_keys, "static image restore-keys must include v2 prefix"
    assert "fgo-static-images-v1-" not in img_restore_keys, "v1 restore-key cannot match v2 path-version hash"
    sg_cache_step = next(s for s in steps if s.get("name") == "Restore Saint Graph Cache")
    assert cache_step.get("id") == "atlas_cache", "Restore Atlas Data & Asset Cache must set id: atlas_cache"
    assert img_cache_step.get("id") == "static_img_cache", "Restore Static Image Cache must set id: static_img_cache"
    assert sg_cache_step.get("id") == "saint_graph_cache", "Restore Saint Graph Cache must set id: saint_graph_cache"
    for guard in (
        "steps.data_version.outputs.CHECK",
        "steps.atlas_cache.outputs.cache-hit",
        "steps.static_img_cache.outputs.cache-hit",
        "steps.saint_graph_cache.outputs.cache-hit",
    ):
        assert guard in sync_run, f"sync skip guard missing {guard}"
    assert "rm -f" not in sync_run, "sync still wipes generated data"
    assert cache_step.get("if") == "steps.do_work.outputs.DO_WORK == 'true'", "asset cache restore must skip on idle runs"
    assert "sync_atlas_data.py" in cache_key, "cache key must hash sync_atlas_data.py"
    assert "fetch_bordered_ces.py" in cache_key, "cache key must hash fetch_bordered_ces.py"
    assert "data_version.txt" in cache_key, "cache key must hash .ci-baselines/data_version.txt"
    check_run = next(s for s in steps if s.get("name") == "Check Atlas data version")["run"]
    assert "--check-shop" in check_run, "Check Atlas data version must pass --check-shop"
    cat_run = next(s for s in steps if s.get("name") == "Check if generated data changed")["run"]
    for data_file in ("servants.js", "craft_essences.js", "traits.js", "bond_growth.js", "event_shop.js"):
        assert data_file in cat_run, f"{data_file} missing from the data-hash cat"
    n += 1

    # 7. self-test job runs all suites unconditionally
    assert "self-test" in spec["jobs"], "self-test job missing from deploy.yml"
    st = spec["jobs"]["self-test"]
    assert not st.get("if"), f"self-test should not be gated by if: {st.get('if')!r}"
    st_runs = " ".join(s["run"] for s in st["steps"] if s.get("run"))
    assert "Pillow" in st_runs, "self-test job must install Pillow"
    for script in (
        "test_check_data_version.py",
        "test_deploy_workflow.py",
        "test_drift.py",
        "test_sync_event_shop.py",
        "test_sync_event_shop_adversarial.py",
        "test_image_webp_lossless.py",
        "test_repro_action_versions.py",
    ):
        assert script in st_runs, f"self-test job does not run {script}"
    n += 1

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

    # 9. trigger pin: push [main] and workflow_dispatch (no schedule), force_sync intact
    trigger_pin(spec)
    n += 1

    print(f"{n} tests passed")


class DeployWorkflowTests(unittest.TestCase):
    def test_deploy_workflow(self):
        main()


if __name__ == "__main__":
    main()
