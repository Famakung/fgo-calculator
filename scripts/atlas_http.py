"""Shared HTTP fetch helper for Atlas Academy data and asset sync scripts."""

import gzip
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Optional, Tuple

DEFAULT_WORKERS = 8


class PoliteRateLimiter:
    """Enforces minimum interval between consecutive network requests to prevent rate-limiting."""

    def __init__(self, delay_seconds: float = 0.0):
        self.delay = delay_seconds
        self.last_request_time = 0.0
        self._lock = threading.Lock()

    def wait(self):
        if self.delay <= 0:
            return
        with self._lock:
            now = time.time()
            target = max(now, self.last_request_time + self.delay)
            self.last_request_time = target
        sleep_for = target - time.time()
        if sleep_for > 0:
            time.sleep(sleep_for)


rate_limiter = PoliteRateLimiter(delay_seconds=0.0)
request_semaphore = threading.Semaphore(DEFAULT_WORKERS)


def fetch_url(
    url: str,
    timeout: int = 15,
    retries: int = 4,
    if_none_match: Optional[str] = None,
) -> Tuple[Optional[bytes], Optional[str]]:
    """Fetch URL with bounded concurrency, optional delay, retries, gzip, and HTTP 429 backoff.

    Returns (data, etag). On 304 (resource unchanged since if_none_match) returns (None, None).
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; FGOCalculatorDataSync/1.0)",
        "Accept-Encoding": "gzip",
    }
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    req = urllib.request.Request(url, headers=headers)
    last_err = None

    for attempt in range(retries):
        rate_limiter.wait()
        try:
            with request_semaphore:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = resp.read()
                    if resp.headers.get("Content-Encoding") == "gzip":
                        data = gzip.decompress(data)
                    return data, resp.headers.get("ETag")
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return None, None
            last_err = e
            if e.code == 429:
                retry_after = e.headers.get("Retry-After")
                backoff = float(retry_after) + 1.0 if retry_after and retry_after.isdigit() else (5.0 * (attempt + 1))
                print(
                    f"  [RATE-LIMIT] HTTP 429 encountered for {url}. Waiting {backoff:.1f}s before retry...",
                    file=sys.stderr,
                )
                time.sleep(backoff)
                continue
            if 400 <= e.code < 500:
                break
            time.sleep(1.0 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(1.0 * (attempt + 1))

    raise RuntimeError(f"Failed to fetch {url} after {retries} retries: {last_err}")
