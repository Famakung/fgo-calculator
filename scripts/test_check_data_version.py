"""Self-checks for check_data_version.py. Run: python3 scripts/test_check_data_version.py"""

import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_data_version as m  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    body = b'{"JP": {"hash": "abc123"}, "NA": {"hash": "def456"}}'
    quest_drops = [{"objectId": 94164000, "num": 3, "dropExpected": 1.5, "runs": 100}]
    quest_etag = '"q-v1"'

    def do_GET(self):
        if self.path.startswith("/nice/JP/quest/"):
            inm = self.headers.get("If-None-Match")
            if inm and self.quest_etag and inm == self.quest_etag:
                self.send_response(304)
                self.end_headers()
                return
            payload = json.dumps({"drops": self.quest_drops}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            if self.quest_etag:
                self.send_header("ETag", self.quest_etag)
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(self.body)))
        self.end_headers()
        self.wfile.write(self.body)

    def log_message(self, *args):
        pass


def start_server():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    return server, f"{base}/info", base


def run_cli(url, version_file, force=False, check_shop=False, shop_probe_file=None, api_base=None):
    """Run main() in-process, capture stdout, return (returncode, stdout)."""
    env = dict(os.environ)
    env["ATLAS_INFO_URL"] = url
    if api_base:
        env["ATLAS_API_BASE"] = api_base
    env.pop("GITHUB_OUTPUT", None)
    argv = ["--version-file", version_file]
    if force:
        argv.append("--force")
    if check_shop:
        argv.append("--check-shop")
    if shop_probe_file:
        argv.extend(["--shop-probe-file", shop_probe_file])
    real_environ, real_stdout = os.environ, sys.stdout
    import io
    captured = io.StringIO()
    try:
        os.environ.clear()
        os.environ.update(env)
        sys.stdout = captured
        rc = m.main(argv)
    finally:
        sys.stdout = real_stdout
        os.environ.clear()
        os.environ.update(real_environ)
    return rc, captured.getvalue()


def main():
    n = 0

    # the baseline lives outside .cache/atlas so it can persist across asset-cache hits
    assert m.DEFAULT_VERSION_FILE == os.path.join(".ci-baselines", "data_version.txt")
    n += 1

    # --- decide() truth table (jp, na) pair semantics ---
    assert m.decide(("a", "b"), ("a", "b"), False) == "UNCHANGED"
    assert m.decide(("b", "b"), ("a", "b"), False) == "CHANGED"   # JP-only change
    assert m.decide(("a", "c"), ("a", "b"), False) == "CHANGED"   # NA-only change
    assert m.decide(("a", None), ("a", "b"), False) == "UNKNOWN"  # NA fetch failed
    assert m.decide(("a", "b"), (None, None), False) == "CHANGED" # first run / legacy file
    assert m.decide(("a", "b"), ("a", "b"), True) == "CHANGED"    # force
    assert m.decide((None, None), (None, None), True) == "UNKNOWN"
    n += 1

    server, url, api_base = start_server()
    tmpdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tmp_version_tests")
    os.makedirs(tmpdir, exist_ok=True)

    try:
        # --- unchanged keeps file ---
        vf = os.path.join(tmpdir, "unchanged.txt")
        with open(vf, "w") as f:
            f.write("JP abc123\nNA def456\n")
        before = open(vf, "rb").read()
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=UNCHANGED" in out, out
        assert open(vf, "rb").read() == before, "file must stay byte-identical"
        n += 1

        # --- changed updates file ---
        vf = os.path.join(tmpdir, "changed.txt")
        with open(vf, "w") as f:
            f.write("JP old999\nNA old888\n")
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=CHANGED" in out, out
        assert "DATA_VERSION=JP:abc123|NA:def456" in out, out
        assert open(vf).read() == "JP abc123\nNA def456\n", out
        n += 1

        # --- missing file is changed + created ---
        vf = os.path.join(tmpdir, "missing.txt")
        if os.path.exists(vf):
            os.remove(vf)
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=CHANGED" in out, out
        assert open(vf).read() == "JP abc123\nNA def456\n", out
        n += 1

        # --- legacy single-line file self-heals ---
        vf = os.path.join(tmpdir, "legacy.txt")
        with open(vf, "w") as f:
            f.write("abc123\n")
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=CHANGED" in out, out
        assert open(vf).read() == "JP abc123\nNA def456\n", out
        n += 1

        # --- malformed body / missing JP or NA key ---
        Handler.body = b"not json"
        vf = os.path.join(tmpdir, "malformed.txt")
        if os.path.exists(vf):
            os.remove(vf)
        rc, out = run_cli(url, vf)
        assert rc == 0 and "CHECK=UNKNOWN" in out, out
        assert not os.path.exists(vf), "no file on UNKNOWN"
        Handler.body = b'{"NA": {"hash": "x"}}'
        rc, out = run_cli(url, vf)
        assert rc == 0 and "CHECK=UNKNOWN" in out, out
        assert not os.path.exists(vf), "no file on UNKNOWN"
        Handler.body = b'{"JP": {"hash": "abc123"}}'
        rc, out = run_cli(url, vf)
        assert rc == 0 and "CHECK=UNKNOWN" in out, out
        assert not os.path.exists(vf), "no file on UNKNOWN"
        Handler.body = b'{"JP": {"hash": "abc123"}, "NA": {"hash": "def456"}}'
        n += 1

        # --- network error is unknown, no file ---
        vf = os.path.join(tmpdir, "neterr.txt")
        if os.path.exists(vf):
            os.remove(vf)
        rc, out = run_cli("http://127.0.0.1:9/info", vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=UNKNOWN" in out, out
        assert not os.path.exists(vf), "no file on UNKNOWN"
        n += 1

        # --- shop probe (--check-shop) ---
        vf = os.path.join(tmpdir, "shop_version.txt")
        with open(vf, "w") as f:
            f.write("JP abc123\nNA def456\n")
        probe_file = os.path.join(tmpdir, "shop_probe.json")

        # 1) Missing probe -> CHANGED
        if os.path.exists(probe_file):
            os.remove(probe_file)
        rc, out = run_cli(url, vf, check_shop=True, shop_probe_file=probe_file, api_base=api_base)
        assert rc == 0 and "CHECK=CHANGED" in out, out

        # 2) nextTransitionAt elapsed -> CHANGED
        with open(probe_file, "w") as f:
            json.dump({"openIds": [80639], "nextTransitionAt": 1000, "activeQuests": []}, f)
        assert m.check_shop_probe(probe_file, api_base=api_base, now=1000) == "CHANGED"

        # 3) 304 Not Modified -> UNCHANGED
        drops_hash = m._drops_digest(Handler.quest_drops)
        with open(probe_file, "w") as f:
            json.dump({
                "openIds": [80639],
                "nextTransitionAt": 9999999999,
                "activeQuests": [{"id": 94164100, "phase": 1, "etag": '"q-v1"', "dropsHash": drops_hash}],
            }, f)
        rc, out = run_cli(url, vf, check_shop=True, shop_probe_file=probe_file, api_base=api_base)
        assert rc == 0 and "CHECK=UNCHANGED" in out, out

        # 4) 200 OK with same dropsHash -> UNCHANGED
        with open(probe_file, "w") as f:
            json.dump({
                "openIds": [80639],
                "nextTransitionAt": 9999999999,
                "activeQuests": [{"id": 94164100, "phase": 1, "etag": '"stale"', "dropsHash": drops_hash}],
            }, f)
        rc, out = run_cli(url, vf, check_shop=True, shop_probe_file=probe_file, api_base=api_base)
        assert rc == 0 and "CHECK=UNCHANGED" in out, out

        # 5) 200 OK with changed dropExpected/runs only (same objectId/num) -> UNCHANGED
        Handler.quest_drops = [{"objectId": 94164000, "num": 3, "dropExpected": 2.25, "runs": 150}]
        rc, out = run_cli(url, vf, check_shop=True, shop_probe_file=probe_file, api_base=api_base)
        assert rc == 0 and "CHECK=UNCHANGED" in out, out

        # 6) 200 OK with added drop currency -> CHANGED
        Handler.quest_drops = [
            {"objectId": 94164000, "num": 3, "dropExpected": 2.25, "runs": 150},
            {"objectId": 94164001, "num": 3, "dropExpected": 1.0, "runs": 10},
        ]
        rc, out = run_cli(url, vf, check_shop=True, shop_probe_file=probe_file, api_base=api_base)
        assert rc == 0 and "CHECK=CHANGED" in out, out

        # 7) Quest fetch error -> UNKNOWN
        assert m.check_shop_probe(probe_file, api_base="http://127.0.0.1:9", now=500) == "UNKNOWN"
        n += 1

        # --- compute_data_hash & --data-hash CLI ---
        data_dir = os.path.join(tmpdir, "data")
        svt_dir = os.path.join(tmpdir, "servant_info")
        os.makedirs(data_dir, exist_ok=True)
        os.makedirs(svt_dir, exist_ok=True)
        base_js = {
            "servants.js": "export const SERVANTS = [1];\n",
            "craft_essences.js": "export const CES = [1];\n",
            "traits.js": "export const TRAITS = [1];\n",
            "bond_growth.js": "export const BOND = [1];\n",
        }
        for name, content in base_js.items():
            with open(os.path.join(data_dir, name), "w", encoding="utf-8") as f:
                f.write(content)
        with open(os.path.join(svt_dir, "100100.json"), "w", encoding="utf-8") as f:
            f.write('{"id":100100}\n')

        def write_shop(sample_runs, drop_expected, extra_drop=None, raid_runs=50, raid_expected=1.2, extra_quest=False):
            q_drops = {"94164000": {"dropExpected": drop_expected, "num": 3}}
            if extra_drop:
                q_drops["94164001"] = extra_drop
            quests = [
                {"questId": 94164100, "sampleRuns": sample_runs, "drops": q_drops},
                {"questId": 94164101, "sampleRuns": 0, "drops": {}},
            ]
            if extra_quest:
                quests.append({"questId": 94164102, "sampleRuns": 0, "drops": {}})
            payload = {
                "events": [{
                    "event": {"id": 80639},
                    "items": [{"id": 80639001}],
                    "farm": {
                        "quests": quests,
                        "raids": [{
                            "quests": [{
                                "questId": 94164200,
                                "sampleRuns": raid_runs,
                                "drops": {"94164002": {"dropExpected": raid_expected, "num": 3}},
                            }],
                        }],
                    },
                }],
            }
            with open(os.path.join(data_dir, "event_shop.js"), "w", encoding="utf-8") as f:
                f.write("export const EVENT_SHOP_DATA = " + json.dumps(payload, indent=2) + ";\n")

        write_shop(sample_runs=476, drop_expected=10.9433)
        h_base, parts_base = m.compute_data_hash(data_dir, svt_dir)
        assert len(h_base) == 64 and all(len(v) == 12 for v in parts_base.values())

        # Volatile sampleRuns / dropExpected changes in quests and raids keep hash identical
        write_shop(sample_runs=520, drop_expected=11.0123, raid_runs=88, raid_expected=1.4567)
        h_jitter, _ = m.compute_data_hash(data_dir, svt_dir)
        assert h_jitter == h_base, "sampleRuns/dropExpected jitter must not change data hash"

        # CLI --data-hash prints 64-hex hash on stdout
        import io
        real_stdout, real_stderr = sys.stdout, sys.stderr
        cap_out, cap_err = io.StringIO(), io.StringIO()
        try:
            sys.stdout, sys.stderr = cap_out, cap_err
            rc = m.main(["--data-hash", "--data-dir", data_dir, "--servant-info-dir", svt_dir])
        finally:
            sys.stdout, sys.stderr = real_stdout, real_stderr
        assert rc == 0 and cap_out.getvalue().strip() == h_base, cap_out.getvalue()
        assert "data-hash parts:" in cap_err.getvalue() and "event_shop.js=" in cap_err.getvalue()

        # Real changes alter hash: new drop currency, new quest, each JS file, and servant_info JSON
        write_shop(sample_runs=520, drop_expected=11.0123, extra_drop={"dropExpected": 2.0, "num": 3})
        assert m.compute_data_hash(data_dir, svt_dir)[0] != h_base

        write_shop(sample_runs=520, drop_expected=11.0123, extra_quest=True)
        assert m.compute_data_hash(data_dir, svt_dir)[0] != h_base

        write_shop(sample_runs=476, drop_expected=10.9433)
        for name, content in base_js.items():
            p = os.path.join(data_dir, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content + "// changed\n")
            assert m.compute_data_hash(data_dir, svt_dir)[0] != h_base, f"change in {name} must change hash"
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)

        with open(os.path.join(svt_dir, "100100.json"), "w", encoding="utf-8") as f:
            f.write('{"id":100100,"v":2}\n')
        assert m.compute_data_hash(data_dir, svt_dir)[0] != h_base
        n += 1
    finally:
        server.shutdown()
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
