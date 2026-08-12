#!/usr/bin/env python3
"""xy game HTTP server: static files + /api + /admin."""
from __future__ import annotations

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# Allow `python server.py` from repo root or server/
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from admin_app import handle_admin  # noqa: E402
from api_events import handle_events, start_aggregator  # noqa: E402
from api_leaderboard import handle_daily, handle_submit  # noqa: E402
from api_player import (  # noqa: E402
    handle_login,
    handle_me,
    handle_profile,
    handle_sync,
    handle_unlock,
)
from config import load_config  # noqa: E402
from db import DB  # noqa: E402
from httputil import send_empty, send_json  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    db: DB
    cfg: dict

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif not path.startswith("/api") and not path.startswith("/admin"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api"):
            send_empty(self, 204)
            return
        self.send_error(404)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/admin"):
            handle_admin(self, self.db, self.cfg, "GET")
            return
        if path.startswith("/api/"):
            self._api("GET", path)
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/admin"):
            handle_admin(self, self.db, self.cfg, "POST")
            return
        if path.startswith("/api/"):
            self._api("POST", path)
            return
        self.send_error(404)

    def _api(self, method: str, path: str) -> None:
        routes = {
            ("POST", "/api/player/login"): handle_login,
            ("GET", "/api/player/me"): handle_me,
            ("POST", "/api/player/sync"): handle_sync,
            ("POST", "/api/player/profile"): handle_profile,
            ("POST", "/api/avatar/unlock"): handle_unlock,
            ("POST", "/api/leaderboard/submit"): handle_submit,
            ("GET", "/api/leaderboard/daily"): handle_daily,
            ("POST", "/api/events"): handle_events,
        }
        fn = routes.get((method, path))
        if not fn:
            send_json(self, 404, {"error": {"code": "not_found", "msg": path}})
            return
        try:
            fn(self, self.db)
        except Exception as e:  # noqa: BLE001
            send_json(self, 500, {"error": {"code": "internal", "msg": str(e)}})


def main() -> None:
    cfg_path = os.environ.get("XY_CONFIG")
    cfg = load_config(cfg_path)
    db = DB(cfg)
    print(f"migrating db {cfg['db']['database']} …", flush=True)
    db.migrate()
    start_aggregator(db, interval_sec=float(os.environ.get("XY_AGG_INTERVAL", "300")))

    static_dir = cfg.get("static_dir") or str(ROOT.parent / "web" / "dist")
    addr = cfg.get("addr") or "0.0.0.0:8082"
    host, _, port_s = addr.rpartition(":")
    host = host or "0.0.0.0"
    port = int(port_s or 8082)

    class BoundHandler(Handler):
        pass

    BoundHandler.db = db
    BoundHandler.cfg = cfg
    handler = partial(BoundHandler, directory=static_dir)
    with ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"serving static={static_dir} api+admin on {host}:{port}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
