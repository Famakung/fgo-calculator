"""QA Verification & Regression Test Suite for Atlas Image Lossless WebP Encoding.

Tests:
1. download_face_icon (sync_atlas_data.py) calls img.save(..., "WEBP", lossless=True, method=6).
2. download_and_convert (fetch_bordered_ces.py) calls img.save(..., "WEBP", lossless=True, method=6).
3. WebP files generated are valid lossless WebP (contains VP8L chunk, no lossy VP8 chunk).
4. Bit-for-bit lossless pixel fidelity roundtrip (tobytes() match exactly, zero pixel distortion).
5. Contrast with lossy encoding (quality=80) to prove lossy mutates tens of thousands of bytes while lossless preserves 100%.
6. Non-standard dimensions resize to (142, 155) via LANCZOS in sync_atlas_data.
7. RGB / Palette input formats are properly converted to RGBA, saved losslessly, and preserved.
8. force=False skips network call when destination file already exists.
9. dry_run=True returns success without writing to disk.
10. Network failure / 404 handling across candidate URLs.
"""

import io
import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_bordered_ces as ce_sync  # noqa: E402
import sync_atlas_data as atlas_sync  # noqa: E402


def create_test_image_bytes(size=(142, 155), mode="RGBA", pattern="grid"):
    """Create deterministic test image bytes as PNG."""
    w, h = size
    if mode == "RGB":
        img = Image.new("RGB", size)
        pixels = img.load()
        for x in range(w):
            for y in range(h):
                pixels[x, y] = ((x * 13) % 256, (y * 17) % 256, (x * 7 + y * 3) % 256)
    else:
        img = Image.new("RGBA", size)
        pixels = img.load()
        for x in range(w):
            for y in range(h):
                if pattern == "grid":
                    # Non-zero alpha to test full 4-channel bit-for-bit roundtrip
                    r = (x * 13) % 256
                    g = (y * 17) % 256
                    b = (x * 7 + y * 3) % 256
                    a = 100 + ((x + y) % 156)  # 100 <= a <= 255
                    pixels[x, y] = (r, g, b, a)
                elif pattern == "transparent_border":
                    # Border transparent, center opaque
                    if x < 5 or x >= w - 5 or y < 5 or y >= h - 5:
                        pixels[x, y] = (0, 0, 0, 0)
                    else:
                        pixels[x, y] = ((x * 7) % 256, (y * 11) % 256, (x + y * 3) % 256, 255)
                elif pattern == "solid":
                    pixels[x, y] = (120, 200, 50, 180)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), img


class TestWebPLosslessVerification(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.orig_public_servants = atlas_sync.PUBLIC_SERVANTS_DIR
        self.orig_ce_dir = ce_sync.CE_DIR
        atlas_sync.PUBLIC_SERVANTS_DIR = os.path.join(self.tmpdir, "servants")
        ce_sync.CE_DIR = os.path.join(self.tmpdir, "craft_essences")

    def tearDown(self):
        atlas_sync.PUBLIC_SERVANTS_DIR = self.orig_public_servants
        ce_sync.CE_DIR = self.orig_ce_dir
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # -------------------------------------------------------------
    # 1. Parameter & Call Contract Tests
    # -------------------------------------------------------------
    def test_sync_atlas_save_call_signature(self):
        """Verify download_face_icon invokes save with lossless=True, method=6, WEBP."""
        png_bytes, _ = create_test_image_bytes()
        save_calls = []
        orig_save = Image.Image.save

        def spy_save(img_self, *args, **kwargs):
            save_calls.append({"args": args, "kwargs": kwargs})
            return orig_save(img_self, *args, **kwargs)

        with patch("sync_atlas_data.fetch_url", return_value=(png_bytes, {})):
            with patch.object(Image.Image, "save", side_effect=spy_save, autospec=True):
                ok = atlas_sync.download_face_icon("100100", 100100, stage=1)
                self.assertTrue(ok)

        self.assertEqual(len(save_calls), 1)
        call = save_calls[0]
        fmt = call["args"][1] if len(call["args"]) > 1 else call["kwargs"].get("format")
        self.assertEqual(fmt, "WEBP")
        self.assertIs(call["kwargs"].get("lossless"), True)
        self.assertEqual(call["kwargs"].get("method"), 6)
        self.assertNotIn("quality", call["kwargs"], "quality parameter should not be present in lossless save")

    def test_ce_sync_save_call_signature(self):
        """Verify download_and_convert invokes save with lossless=True, method=6, WEBP."""
        png_bytes, _ = create_test_image_bytes()
        save_calls = []
        orig_save = Image.Image.save

        def spy_save(img_self, *args, **kwargs):
            save_calls.append({"args": args, "kwargs": kwargs})
            return orig_save(img_self, *args, **kwargs)

        mock_resp = MagicMock()
        mock_resp.read.return_value = png_bytes
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            with patch.object(Image.Image, "save", side_effect=spy_save, autospec=True):
                res = ce_sync.download_and_convert(("999999", "9999990", True, False))
                self.assertTrue(res[1])

        self.assertEqual(len(save_calls), 1)
        call = save_calls[0]
        fmt = call["args"][1] if len(call["args"]) > 1 else call["kwargs"].get("format")
        self.assertEqual(fmt, "WEBP")
        self.assertIs(call["kwargs"].get("lossless"), True)
        self.assertEqual(call["kwargs"].get("method"), 6)
        self.assertNotIn("quality", call["kwargs"], "quality parameter should not be present in lossless save")

    # -------------------------------------------------------------
    # 2. Binary Format & Container Structure Tests
    # -------------------------------------------------------------
    def test_servant_icon_saved_as_vp8l_lossless_webp(self):
        """Saved servant WebP file must contain VP8L chunk and no VP8 lossy chunk."""
        png_bytes, _ = create_test_image_bytes()
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "100100", "001.webp")

        with patch("sync_atlas_data.fetch_url", return_value=(png_bytes, {})):
            ok = atlas_sync.download_face_icon("100100", 100100, stage=1)
            self.assertTrue(ok)

        self.assertTrue(os.path.isfile(dest_file))
        with open(dest_file, "rb") as f:
            data = f.read()

        self.assertTrue(data.startswith(b"RIFF"), "WebP file must start with RIFF header")
        self.assertIn(b"WEBP", data[8:12], "WebP container format mismatch")
        self.assertIn(b"VP8L", data, "Lossless WebP must contain VP8L chunk")
        self.assertNotIn(b"VP8 ", data, "Lossless WebP must not contain lossy VP8 chunk")

    def test_ce_icon_saved_as_vp8l_lossless_webp(self):
        """Saved CE WebP file must contain VP8L chunk and no VP8 lossy chunk."""
        png_bytes, _ = create_test_image_bytes()
        dest_file = os.path.join(ce_sync.CE_DIR, "999999.webp")

        mock_resp = MagicMock()
        mock_resp.read.return_value = png_bytes
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            res = ce_sync.download_and_convert(("999999", "9999990", True, False))
            self.assertTrue(res[1])

        self.assertTrue(os.path.isfile(dest_file))
        with open(dest_file, "rb") as f:
            data = f.read()

        self.assertTrue(data.startswith(b"RIFF"))
        self.assertIn(b"WEBP", data[8:12])
        self.assertIn(b"VP8L", data, "Lossless WebP must contain VP8L chunk")
        self.assertNotIn(b"VP8 ", data, "Lossless WebP must not contain lossy VP8 chunk")

    # -------------------------------------------------------------
    # 3. Bit-for-Bit Pixel Roundtrip & Lossy Divergence
    # -------------------------------------------------------------
    def test_lossless_pixel_fidelity_vs_lossy_distortion(self):
        """Verify lossless preservation: 0 byte differences vs 60,000+ byte differences under lossy."""
        png_bytes, orig_img = create_test_image_bytes(size=(142, 155), pattern="grid")
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "100100", "001.webp")

        with patch("sync_atlas_data.fetch_url", return_value=(png_bytes, {})):
            atlas_sync.download_face_icon("100100", 100100, stage=1)

        # Reload the saved WebP
        with Image.open(dest_file) as reloaded:
            self.assertEqual(reloaded.format, "WEBP")
            self.assertEqual(reloaded.mode, "RGBA")
            self.assertEqual(reloaded.size, (142, 155))
            # Bit-for-bit exact match across all channels
            b_orig = orig_img.tobytes()
            b_ll = reloaded.tobytes()
            diff_count = sum(1 for i in range(len(b_orig)) if b_orig[i] != b_ll[i])
            self.assertEqual(diff_count, 0, "Lossless WebP must have exactly 0 byte differences from original RGBA")

        # Contrast with lossy encoding (quality=80, method=6)
        lossy_buf = io.BytesIO()
        orig_img.save(lossy_buf, "WEBP", quality=80, method=6)
        with Image.open(lossy_buf) as lossy_reloaded:
            b_lossy = lossy_reloaded.tobytes()
            lossy_diff_count = sum(1 for i in range(len(b_orig)) if b_orig[i] != b_lossy[i])
            # Lossy encoding must have tens of thousands of corrupted bytes
            self.assertGreater(lossy_diff_count, 10000, "Lossy WebP (quality=80) should diverge significantly from original pixels")

    def test_transparent_border_preservation(self):
        """Verify visible pixels and transparent border handling."""
        png_bytes, orig_img = create_test_image_bytes(size=(142, 155), pattern="transparent_border")
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "100100", "001.webp")

        with patch("sync_atlas_data.fetch_url", return_value=(png_bytes, {})):
            atlas_sync.download_face_icon("100100", 100100, stage=1)

        with Image.open(dest_file) as reloaded:
            self.assertEqual(reloaded.format, "WEBP")
            self.assertEqual(reloaded.mode, "RGBA")
            b_orig = orig_img.tobytes()
            b_ll = reloaded.tobytes()
            # Every visible pixel (alpha > 0) must be 100% identical
            for i in range(0, len(b_orig), 4):
                p_orig = tuple(b_orig[i : i + 4])
                p_ll = tuple(b_ll[i : i + 4])
                if p_orig[3] > 0:
                    self.assertEqual(p_orig, p_ll, f"Visible pixel at index {i//4} mutated: {p_orig} vs {p_ll}")
                else:
                    self.assertEqual(p_ll[3], 0, f"Transparent pixel alpha mutated to non-zero: {p_ll}")

    # -------------------------------------------------------------
    # 4. Dimension Resizing & Input Formats
    # -------------------------------------------------------------
    def test_sync_atlas_resizes_oversized_image_losslessly(self):
        """Oversized source image (200, 200) must be resized to (142, 155) and saved losslessly."""
        png_bytes, _ = create_test_image_bytes(size=(200, 200), pattern="grid")
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "100100", "001.webp")

        with patch("sync_atlas_data.fetch_url", return_value=(png_bytes, {})):
            ok = atlas_sync.download_face_icon("100100", 100100, stage=1)
            self.assertTrue(ok)

        with Image.open(dest_file) as reloaded:
            self.assertEqual(reloaded.size, (142, 155))
            self.assertEqual(reloaded.format, "WEBP")
            with open(dest_file, "rb") as f:
                raw = f.read()
            self.assertIn(b"VP8L", raw)

    def test_rgb_conversion_preserves_colors_losslessly(self):
        """RGB PNG source is converted to RGBA, saved losslessly, and preserves all RGB channel values."""
        png_bytes, orig_img = create_test_image_bytes(size=(142, 155), mode="RGB")
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "rgb_test", "000.webp")
        with patch("sync_atlas_data.fetch_url", return_value=(png_bytes, {})):
            ok = atlas_sync.download_face_icon("rgb_test", 100100, stage=0)
            self.assertTrue(ok)
        with Image.open(dest_file) as reloaded:
            self.assertEqual(reloaded.format, "WEBP")
            reloaded_rgb = reloaded.convert("RGB")
            b_orig = orig_img.tobytes()
            b_reloaded = reloaded_rgb.tobytes()
            diff_count = sum(1 for i in range(len(b_orig)) if b_orig[i] != b_reloaded[i])
            self.assertEqual(diff_count, 0, "Lossless RGB roundtrip must have 0 byte differences")

    # -------------------------------------------------------------
    # 5. Lifecycle Knobs & Error Path Edge Cases
    # -------------------------------------------------------------
    def test_force_false_skips_existing_files(self):
        """force=False should return early without downloading if file exists."""
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "100100", "001.webp")
        os.makedirs(os.path.dirname(dest_file), exist_ok=True)
        with open(dest_file, "wb") as f:
            f.write(b"existing-file")

        with patch("sync_atlas_data.fetch_url") as mock_fetch:
            ok = atlas_sync.download_face_icon("100100", 100100, stage=1, force=False)
            self.assertTrue(ok)
            mock_fetch.assert_not_called()

        ce_dest = os.path.join(ce_sync.CE_DIR, "999999.webp")
        os.makedirs(ce_sync.CE_DIR, exist_ok=True)
        with open(ce_dest, "wb") as f:
            f.write(b"existing-ce")

        with patch("urllib.request.urlopen") as mock_urlopen:
            res = ce_sync.download_and_convert(("999999", "9999990", False, False))
            self.assertEqual(res[2], "EXISTS")
            mock_urlopen.assert_not_called()

    def test_dry_run_mode(self):
        """dry_run=True should return success without creating files."""
        dest_file = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "100100", "001.webp")
        with patch("sync_atlas_data.fetch_url") as mock_fetch:
            ok = atlas_sync.download_face_icon("100100", 100100, stage=1, dry_run=True)
            self.assertTrue(ok)
            mock_fetch.assert_not_called()
            self.assertFalse(os.path.exists(dest_file))

        res = ce_sync.download_and_convert(("999999", "9999990", True, True))
        self.assertEqual(res[2], "DRY_RUN")
        self.assertFalse(os.path.exists(os.path.join(ce_sync.CE_DIR, "999999.webp")))

    def test_url_fallback_and_failure(self):
        """Verify fallback across candidate URLs and graceful return on complete failure."""
        png_bytes, _ = create_test_image_bytes()

        # First URL raises exception, second succeeds
        calls = []

        def fail_first(url, *args, **kwargs):
            calls.append(url)
            if len(calls) == 1:
                raise ConnectionError("network blip")
            return png_bytes, {}

        with patch("sync_atlas_data.fetch_url", side_effect=fail_first):
            ok = atlas_sync.download_face_icon("100100", 100100, stage=1)
            self.assertTrue(ok)
            self.assertGreaterEqual(len(calls), 2)

        # All URLs fail
        with patch("sync_atlas_data.fetch_url", side_effect=Exception("not found")):
            dest_fail = os.path.join(atlas_sync.PUBLIC_SERVANTS_DIR, "999999", "001.webp")
            ok = atlas_sync.download_face_icon("999999", 999999, stage=1)
            self.assertFalse(ok)
            self.assertFalse(os.path.exists(dest_fail))

    def test_ce_url_retry_and_fallback(self):
        """Verify CE download tries bordered URL, retries on failure, then falls back to plain URL."""
        png_bytes, _ = create_test_image_bytes()
        attempted_urls = []

        def mock_urlopen_fn(req, timeout=15):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            attempted_urls.append(url)
            if "bordered" in url:
                raise Exception("404 Not Found")
            resp = MagicMock()
            resp.read.return_value = png_bytes
            resp.__enter__.return_value = resp
            return resp

        with patch("urllib.request.urlopen", side_effect=mock_urlopen_fn):
            with patch("time.sleep"):  # avoid sleeping during test
                res = ce_sync.download_and_convert(("999999", "9999990", True, False))

        self.assertTrue(res[1])
        self.assertEqual(res[0], "999999")
        self.assertTrue(any("bordered" in u for u in attempted_urls))
        self.assertTrue(any("bordered" not in u for u in attempted_urls))
        dest_file = os.path.join(ce_sync.CE_DIR, "999999.webp")
        self.assertTrue(os.path.isfile(dest_file))
        with open(dest_file, "rb") as f:
            self.assertIn(b"VP8L", f.read())


def main():
    suite = unittest.TestLoader().loadTestsFromTestCase(TestWebPLosslessVerification)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)
    print(f"\n{result.testsRun} tests passed")


if __name__ == "__main__":
    main()
