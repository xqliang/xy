#!/usr/bin/env python3
"""xy game HTTP server: static files + /api + /admin."""
from __future__ import annotations

import logging
import os
import signal
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
    handle_auth_login,
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
    handle_versus_ws,
)
from config import load_config  # noqa: E402
from db import DB  # noqa: E402
from httputil import send_empty, send_json  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # 开持久连接：1s 轮询复用连接，免频繁 TCP 建连（响应均带 Content-Length，边界完整）
    timeout = 5                     # keep-alive 空闲超时(秒)：>1s 轮询间隔留足余量；由 StreamRequestHandler.setup() 经 settimeout 施加到连接 socket，空闲 5s 后 handle_one_request 的 readline 抛 socket.timeout→close_connection=True→线程退出，防客户端异常离开(切后台/断网/崩溃不发 FIN)时线程无界泄漏。活跃 1s 轮询与处理中请求不受影响（读 body 紧随请求行，远不到 5s）
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
        # —— WebSocket 升级（Task 2）：/api/versus/ws 必须在 /api 通用路由**之前**拦截，
        # 因为它要把连接升级成 WS 并长期占用本线程读帧，绝不能走普通 JSON handler。——
        if path == "/api/versus/ws":
            handle_versus_ws(self, self.versus)
            return
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
            ("POST", "/api/auth/login"): handle_auth_login,
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
        }
        fn = routes.get((method, path))
        if not fn:
            # keep-alive 下必须读掉未消费的 body，否则残留 body 会串进同连接的下一请求
            # 仅按 Content-Length 排空；当前所有客户端都发 Content-Length（不使用 chunked 请求体）
            raw_len = self.headers.get("Content-Length") or "0"
            n = int(raw_len) if raw_len.isdigit() else 0   # 畸形 Content-Length(如 "abc")容错：isdigit 守卫，int() 不抛 ValueError
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
    BoundHandler.versus = VersusHub(db)   # 进程内 PvP 单例：匹配/私房/波次/终局/反作弊（WS 快照模型，HTTP tick 已退役）
    hub = BoundHandler.versus
    restored = hub.load_active_matches()          # 启动回放：把上次未终局对局读回内存
    print(f"pvp active matches restored: {restored}", flush=True)

    # 周期 flush：镜像 start_aggregator 的守护线程形态（daemon、swallow-and-log、sleep 循环）
    import threading, time as _time
    def _pvp_flush_loop():
        interval = float(os.environ.get("XY_PVP_FLUSH_INTERVAL", "5"))
        while True:
            _time.sleep(interval)
            try:
                hub.flush_active_matches()
            except Exception:
                logging.exception("pvp flush loop 异常（继续）")
    threading.Thread(target=_pvp_flush_loop, name="pvp-flush", daemon=True).start()

    handler = partial(BoundHandler, directory=static_dir)
    with ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"serving static={static_dir} api+admin on {host}:{port}", flush=True)
        def _graceful(signum, _frame):
            print(f"signal {signum} → flushing pvp active matches then shutting down", flush=True)
            try:
                hub.flush_active_matches()        # 关机前刷一次，发版不丢活跃对局（_flush_lock 保证与周期 flush 不交错）
            except Exception:
                logging.exception("关机 flush 失败")
            # shutdown() 必须在 serve_forever 所在的主线程之外调用，否则与主线程死锁；故起一个短命线程调它。
            threading.Thread(target=httpd.shutdown, name="pvp-shutdown", daemon=True).start()
        signal.signal(signal.SIGTERM, _graceful)
        signal.signal(signal.SIGINT, _graceful)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
