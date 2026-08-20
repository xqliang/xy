#!/usr/bin/env python3
"""keep-alive 基准：/api/versus/poll(未知 ticket) 连发 N 次，比较「单连接复用」与「每次新建连接」。
自起进程内 ThreadingHTTPServer（真实 Handler，HTTP/1.1），无需外部服务。探针无 DB、无状态累积，纯测连接开销。
用法：XY_DB_PORT=3308 XY_DB_NAME=xy_game_test .venv/bin/python tools/bench_keepalive.py [N]
注：loopback 上 TCP 握手极廉价，speedup 是收益下界；真实网络(蜂窝 RTT 50–200ms)下省掉握手的收益远大于此。"""
import http.client, json, sys, threading, time
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import Handler          # noqa: E402
from api_versus import VersusHub    # noqa: E402
from config import load_config      # noqa: E402
from db import DB                   # noqa: E402

BODY = json.dumps({"ticket": "bench-nope"})
HDR = {"Content-Type": "application/json", "X-Uid": "19999999"}
PATH = "/api/versus/poll"

def _start_server():
    cfg = load_config(); cfg["static_dir"] = str(ROOT)
    db = DB(cfg); db.migrate()
    class H(Handler): pass
    H.db = db; H.cfg = cfg; H.versus = VersusHub(db)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **k: H(*a, directory=str(ROOT), **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]

def run_reuse(port, n):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10); t = time.time()
    for _ in range(n):
        c.request("POST", PATH, BODY, HDR); r = c.getresponse(); r.read()
    c.close(); return time.time() - t

def run_fresh(port, n):
    t = time.time()
    for _ in range(n):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("POST", PATH, BODY, HDR); r = c.getresponse(); r.read(); c.close()
    return time.time() - t

def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    httpd, port = _start_server()
    try:
        run_reuse(port, 20); run_fresh(port, 20)     # 预热
        reuse = run_reuse(port, n); fresh = run_fresh(port, n)
    finally:
        httpd.shutdown()
    print(f"keep-alive bench N={n}: reuse(1 conn)={reuse*1000:.0f}ms  "
          f"fresh({n} conns)={fresh*1000:.0f}ms  speedup={fresh/reuse:.2f}x")

if __name__ == "__main__":
    main()
