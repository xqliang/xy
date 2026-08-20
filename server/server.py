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
from api_versus import (  # noqa: E402
    VersusHub,
    handle_versus_cancel,
    handle_versus_enqueue,
    handle_versus_poll,
    handle_versus_room_create,
    handle_versus_room_join,
    handle_versus_tick,
)
from config import load_config  # noqa: E402
from db import DB  # noqa: E402
from httputil import send_empty, send_json  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # 开持久连接：1s 轮询复用连接，免频繁 TCP 建连（响应均带 Content-Length，边界完整）
    db: DB
    cfg: dict
    versus: "VersusHub"

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
            # —— PvP 在线对战（/api/versus/*）——
            ("POST", "/api/versus/enqueue"): handle_versus_enqueue,
            ("POST", "/api/versus/poll"): handle_versus_poll,
            ("POST", "/api/versus/cancel"): handle_versus_cancel,
            ("POST", "/api/versus/room/create"): handle_versus_room_create,
            ("POST", "/api/versus/room/join"): handle_versus_room_join,
            ("POST", "/api/versus/tick"): handle_versus_tick,
        }
        fn = routes.get((method, path))
        if not fn:
            # keep-alive 下必须读掉未消费的 body，否则残留 body 会串进同连接的下一请求
            n = int(self.headers.get("Content-Length") or 0)
            if n > 0:
                self.rfile.read(n)
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
    BoundHandler.versus = VersusHub(db)   # 进程内 PvP 单例：匹配/私房/tick 转发/波次/终局/反作弊
    handler = partial(BoundHandler, directory=static_dir)
    with ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"serving static={static_dir} api+admin on {host}:{port}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
