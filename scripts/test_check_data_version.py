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
    body = b'{"JP": {"hash": "abc123"}}'

    def do_GET(self):
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
    return server, f"http://127.0.0.1:{server.server_address[1]}/info"


def run_cli(url, version_file, force=False):
    """Run main() in-process, capture stdout, return (returncode, stdout)."""
    env = dict(os.environ)
    env["ATLAS_INFO_URL"] = url
    env.pop("GITHUB_OUTPUT", None)
    argv = ["--version-file", version_file] + (["--force"] if force else [])
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

    # --- decide() truth table ---
    assert m.decide(None, "x", False) == "UNKNOWN"
    assert m.decide("a", "a", False) == "UNCHANGED"
    assert m.decide("b", "a", False) == "CHANGED"
    assert m.decide("a", None, False) == "CHANGED"
    assert m.decide("a", "a", True) == "CHANGED"
    assert m.decide(None, None, True) == "UNKNOWN"
    n += 1

    server, url = start_server()
    tmpdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tmp_version_tests")
    os.makedirs(tmpdir, exist_ok=True)

    try:
        # --- unchanged keeps file ---
        vf = os.path.join(tmpdir, "unchanged.txt")
        with open(vf, "w") as f:
            f.write("abc123\n")
        before = open(vf, "rb").read()
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=UNCHANGED" in out, out
        assert open(vf, "rb").read() == before, "file must stay byte-identical"
        n += 1

        # --- changed updates file ---
        vf = os.path.join(tmpdir, "changed.txt")
        with open(vf, "w") as f:
            f.write("old999\n")
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=CHANGED" in out, out
        assert "DATA_VERSION=abc123" in out, out
        assert open(vf).read() == "abc123\n", out
        n += 1

        # --- missing file is changed + created ---
        vf = os.path.join(tmpdir, "missing.txt")
        if os.path.exists(vf):
            os.remove(vf)
        rc, out = run_cli(url, vf)
        assert rc == 0, f"rc={rc}"
        assert "CHECK=CHANGED" in out, out
        assert open(vf).read() == "abc123\n", out
        n += 1

        # --- malformed body / missing JP key ---
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
    finally:
        server.shutdown()
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(f"{n} tests passed")


if __name__ == "__main__":
    main()
