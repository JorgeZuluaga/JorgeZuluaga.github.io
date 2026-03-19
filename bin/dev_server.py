#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import io
import os
import posixpath
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


RELOAD_SNIPPET = r"""
<script>
(() => {
  const es = new EventSource("/__events");
  es.onmessage = (e) => {
    if (e.data === "reload") location.reload();
  };
  es.onerror = () => {
    // silence noisy console when server restarts
  };
})();
</script>
""".strip()


def should_watch_file(name: str) -> bool:
    lower = name.lower()
    return lower.endswith(
        (
            ".html",
            ".css",
            ".js",
            ".json",
            ".txt",
            ".md",
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".svg",
            ".gif",
        )
    )


class ChangeBus:
    def __init__(self) -> None:
        self._version = 0
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)

    def bump(self) -> None:
        with self._cond:
            self._version += 1
            self._cond.notify_all()

    def wait_for_change(self, last_seen: int, timeout: float) -> int:
        with self._cond:
            if self._version == last_seen:
                self._cond.wait(timeout=timeout)
            return self._version


class Watcher(threading.Thread):
    def __init__(self, root: str, bus: ChangeBus, interval: float = 0.5) -> None:
        super().__init__(daemon=True)
        self.root = os.path.abspath(root)
        self.bus = bus
        self.interval = interval
        self._stop = threading.Event()
        self._last = 0.0

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            newest = self._scan_newest_mtime()
            if newest > self._last:
                self._last = newest
                self.bus.bump()
            time.sleep(self.interval)

    def _scan_newest_mtime(self) -> float:
        newest = 0.0
        for dirpath, dirnames, filenames in os.walk(self.root):
            # Skip heavy/irrelevant dirs
            dirnames[:] = [
                d
                for d in dirnames
                if d not in (".git", "__pycache__", "node_modules")
                and not d.startswith(".")
            ]
            for fn in filenames:
                if fn.startswith("."):
                    continue
                if not should_watch_file(fn):
                    continue
                path = os.path.join(dirpath, fn)
                try:
                    m = os.path.getmtime(path)
                except OSError:
                    continue
                if m > newest:
                    newest = m
        return newest


class Handler(SimpleHTTPRequestHandler):
    server_version = "CVHotReload/1.0"

    def do_GET(self) -> None:
        if self.path.startswith("/__events"):
            self._handle_events()
            return
        return super().do_GET()

    def _handle_events(self) -> None:
        bus: ChangeBus = self.server.bus  # type: ignore[attr-defined]
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        last_seen = -1
        try:
            while True:
                last_seen = bus.wait_for_change(last_seen, timeout=15.0)
                data = "reload"
                payload = f"data: {data}\n\n".encode("utf-8")
                self.wfile.write(payload)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def end_headers(self) -> None:
        # Avoid caching while developing
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # Intercept HTML to inject reload snippet
        path = self.translate_path(self.path)
        parsed = urllib.parse.urlparse(self.path)
        req_path = parsed.path
        if req_path.endswith("/") or req_path == "":
            path = os.path.join(path, "index.html")

        if os.path.isfile(path) and path.lower().endswith(".html"):
            try:
                with open(path, "rb") as f:
                    raw = f.read()
            except OSError:
                self.send_error(HTTPStatus.NOT_FOUND, "File not found")
                return None

            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", errors="replace")

            injected = self._inject_reload(text)
            encoded = injected.encode("utf-8")

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            return io.BytesIO(encoded)

        return super().send_head()

    def _inject_reload(self, html_text: str) -> str:
        if "/__events" in html_text or "EventSource(\"/__events\")" in html_text:
            return html_text
        lower = html_text.lower()
        idx = lower.rfind("</body>")
        if idx != -1:
            return html_text[:idx] + RELOAD_SNIPPET + "\n" + html_text[idx:]
        return html_text + "\n" + RELOAD_SNIPPET + "\n"

    # Quieter logs
    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--root", default=".")
    args = parser.parse_args()

    os.chdir(args.root)
    bus = ChangeBus()
    watcher = Watcher(args.root, bus)
    watcher.start()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.bus = bus  # type: ignore[attr-defined]

    print(f"Hot-reload server on http://{args.host}:{args.port} (watching {os.path.abspath(args.root)})")
    try:
        httpd.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        watcher.stop()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

