from __future__ import annotations
import json
import os, sys
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path

import fakeredis
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 注（Task 6 退役）：RELAY_RETAIN_MS / DISCONNECT_GRACE_MS / SIMULTANEOUS_EPS_MS 已不再被本文件用例引用
# （tick 转发/保留窗口/按 tick 的断线与平局用例随 HTTP tick 退役而删除，其 WS 等价覆盖迁至 test_versus_ws.py）。
from api_versus import (MATCH_TIMEOUT_MS, MATCH_REAP_MS, REAP_INTERVAL_MS,
                        QUEUE_TTL_MS)

DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),
    "XY_DB_USER": os.environ.get("XY_DB_USER", "root"),
    "XY_DB_PASSWORD": os.environ.get("XY_DB_PASSWORD", ""),
    "XY_DB_NAME": os.environ.get("XY_DB_NAME", "xy_game_test"),
    "XY_AGG_INTERVAL": "3600",
}

def _apply_env():
    for k, v in DSN_ENV.items():
        os.environ[k] = v

@pytest.fixture(scope="module")
def db():
    _apply_env()
    from config import load_config
    from db import DB
    d = DB(load_config())
    d.migrate()
    return d

def test_migrate_creates_pvp_tables(db):
    with db.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'pvp_results'")
        assert cur.fetchone() is not None
        cur.execute("SHOW TABLES LIKE 'pvp_anomaly'")
        assert cur.fetchone() is not None


@pytest.fixture
def hub(db):
    from api_versus import VersusHub
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(db, now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds),
                  gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
    h._clock = clock  # 测试里推进时钟用
    return h

def test_not_banned_by_default(hub):
    assert hub.is_banned("12345678") is False


def _mk_player(db, uid, rank=1, nickname=None, avatar="wukong"):
    # 测试辅助：写一条干净的对局玩家档
    now = db.now()
    with db.cursor() as cur:
        cur.execute("DELETE FROM players WHERE uid=%s", (uid,))
        cur.execute(
            "INSERT INTO players (uid,nickname,avatar_id,rank_level,last_login_at,last_ip,created_at,updated_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (uid, nickname, avatar, rank, now, "1.1.1.1", now, now),
        )


def p1_seed(hub, r1):
    return hub.poll(r1["ticket"])["matchStart"]["seed"]


def test_same_rank_matches_immediately(hub, db):
    hub.reset()
    _mk_player(db, "10000001", rank=3, nickname="甲")
    _mk_player(db, "10000002", rank=3, nickname="乙")
    r1 = hub.enqueue("10000001", 3)
    assert hub.poll(r1["ticket"])["status"] == "waiting"
    r2 = hub.enqueue("10000002", 3)
    p2 = hub.poll(r2["ticket"])
    assert p2["status"] == "matched"
    assert p2["matchStart"]["opponent"]["nickname"] == "甲"
    assert p2["matchStart"]["seed"] == p1_seed(hub, r1)
    p1 = hub.poll(r1["ticket"])
    assert p1["status"] == "matched"
    assert p1["matchStart"]["matchId"] == p2["matchStart"]["matchId"]


def test_widen_to_any_after_window(hub, db):
    hub.reset()
    _mk_player(db, "10000010", rank=2); _mk_player(db, "10000011", rank=9)
    r_lo = hub.enqueue("10000010", 2)
    r_hi = hub.enqueue("10000011", 9)
    assert hub.poll(r_lo["ticket"])["status"] == "waiting"
    hub._clock["ms"] += 3_001
    p = hub.poll(r_lo["ticket"])
    assert p["status"] == "matched"


def test_timeout(hub, db):
    hub.reset()
    _mk_player(db, "10000020", rank=5)
    r = hub.enqueue("10000020", 5)
    hub._clock["ms"] += MATCH_TIMEOUT_MS + 1
    assert hub.poll(r["ticket"])["status"] == "timeout"


def test_banned_enqueue_rejected(hub, db):
    hub.reset()
    _mk_player(db, "10000030", rank=1)
    day = db.today(); now = db.now()
    with db.cursor() as cur:
        # 先清当日旧记录，保证重复跑不撞唯一键
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "10000030"))
        for opp in ("20000001", "20000002", "20000003"):
            cur.execute(
                "INSERT INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                " VALUES (%s,%s,%s,%s,%s,%s)",
                (day, "10000030", opp, "m", "{}", now),
            )
    r = hub.enqueue("10000030", 1)
    assert r.get("banned") is True


def test_room_create_join(hub, db):
    hub.reset()
    _mk_player(db, "10000101", rank=4, nickname="房主")
    _mk_player(db, "10000102", rank=7, nickname="客人")
    rc = hub.room_create("10000101", 4)
    assert rc["code"] == "ROOM01"
    assert "?versus=ROOM01" in rc["link"]
    assert hub.poll(rc["ticket"])["status"] == "waiting"
    rj = hub.room_join("ROOM01", "10000102", 7)
    assert rj["status"] == "matched"
    ph = hub.poll(rc["ticket"])
    assert ph["status"] == "matched"
    assert ph["matchStart"]["matchId"] == rj["matchStart"]["matchId"]
    assert ph["matchStart"]["opponent"]["nickname"] == "客人"


def test_room_join_bad_code(hub, db):
    hub.reset()
    _mk_player(db, "10000103", rank=1)
    assert hub.room_join("NOPE", "10000103", 1).get("error") == "room_not_found"


def test_room_host_not_pulled_into_random(hub, db):
    hub.reset()
    _mk_player(db, "10000111", rank=3, nickname="房主")
    _mk_player(db, "10000112", rank=3, nickname="路人")
    _mk_player(db, "10000113", rank=3, nickname="好友")
    rc = hub.room_create("10000111", 3)                 # 房主 rank3 建私房
    r_stranger = hub.enqueue("10000112", 3)             # 同段位路人进随机池
    # 房主不应被路人配走：房主仍 waiting，路人也 waiting（池里只有他自己）
    assert hub.poll(rc["ticket"])["status"] == "waiting"
    assert hub.poll(r_stranger["ticket"])["status"] == "waiting"
    # 只有真正 room_join 才能与房主成局，且对手是好友
    rj = hub.room_join(rc["code"], "10000113", 3)
    assert rj["status"] == "matched"
    ph = hub.poll(rc["ticket"])
    assert ph["status"] == "matched"
    assert ph["matchStart"]["opponent"]["nickname"] == "好友"


def test_room_banned_rejected(hub, db):
    hub.reset()
    _mk_player(db, "10000121", rank=1)
    day = db.today(); now = db.now()
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE uid=%s", ("10000121",))
        for opp in ("21000001", "21000002", "21000003"):
            cur.execute("INSERT INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s)", (day, "10000121", opp, "m", "{}", now))
    assert hub.room_create("10000121", 1).get("banned") is True
    assert hub.room_join("ANY", "10000121", 1).get("banned") is True


def _match_two(hub, db, ua="10000201", ub="10000202", rank=3):
    _mk_player(db, ua, rank=rank, nickname="甲"); _mk_player(db, ub, rank=rank, nickname="乙")
    r1 = hub.enqueue(ua, rank); hub.enqueue(ub, rank)
    mid = hub.poll(r1["ticket"])["matchStart"]["matchId"]
    return mid


class _FakeDB:
    """内存 DB 桩：撞码硬化测试完全不触库，cursor() 不抛即可（_profile 查无此人回默认档）。"""
    def today(self):
        return "2026-01-01"
    def now(self):
        return 1_000_000
    @contextmanager
    def cursor(self):
        class _Cur:
            def execute(self, *a, **k):
                pass
            def fetchone(self):
                return None
        yield _Cur()


def _fake_hub():
    # 构造一个不依赖真实 DB 的 VersusHub：时钟可控（hub._clock["ms"]），seed/code/map 固定。
    from api_versus import VersusHub
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(_FakeDB(), now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds), gen_code=lambda: "ROOM01", pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
    h._clock = clock
    return h


def _fake_match(hub, ua="A1", ub="B1", rank=3):
    # 直接用 _make_match 成局（跳过 enqueue/poll 的 DB 读 player profile），返回 match_id。
    e1 = {"uid": ua, "rank": rank, "ticket": "tA"}
    e2 = {"uid": ub, "rank": rank, "ticket": "tB"}
    return hub._make_match(e1, e2, hub._now())


def test_room_create_avoids_code_collision():
    # Bug2 撞码硬化：gen_code 先吐一个已占用的码，room_create 应重试换新码，绝不静默覆盖既有房间。
    # C1.5：撞码检查改走 Redis EXISTS room:{code}，房间记录也断言在 Redis 上。
    from api_versus import VersusHub
    from rediskv import k
    clock = {"ms": 1_000_000}
    codes = iter(["DUP001", "DUP001", "NEW002"])  # 首建用 DUP001；次建 gen 先撞 DUP001 再换 NEW002
    h = VersusHub(_FakeDB(), now_ms=lambda: clock["ms"],
                  gen_seed=lambda: 1234, gen_code=lambda: next(codes), pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
    r1 = h.room_create("A1", 3)
    assert r1["code"] == "DUP001"
    r2 = h.room_create("B1", 3)
    assert r2["code"] == "NEW002"                          # 撞 DUP001 后重试拿到 NEW002
    assert h.r.hget(k("room", "DUP001"), "host_uid") == "A1"   # 原房间未被覆盖（撞码没顶掉 A1）


# —— HTTP 端到端冒烟：起真 ThreadingHTTPServer，跑 /api/versus/* 路由 ——
# 抽样 enqueue/poll/room/cancel 全链路（tick 路由已退役，心跳走 WS）。
@pytest.fixture(scope="module")
def http_base(db):
    # 复用 module 级 db，在其上挂真实 HTTP server，验证路由→handler→Hub 全链路。
    from server import Handler
    from api_versus import VersusHub
    from config import load_config
    cfg = load_config(); cfg["static_dir"] = str(ROOT)
    class H(Handler): pass
    # http_base 的 hub 也须注入 fakeredis：匹配层已迁 Redis（enqueue/poll/_try_pair 读写 self.r），
    # 否则 self.r=None 时匹配相关 e2e（enqueue/poll/room）会 AttributeError。
    H.db = db; H.cfg = cfg
    H.versus = VersusHub(db, redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **k: H(*a, directory=str(ROOT), **k))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()

def _post(base, path, body, uid):
    # 统一 POST 封装：带 X-Uid 头，区分 2xx 与 HTTPError 两条返回路径
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Uid": uid}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None)

def test_http_enqueue_poll_match(http_base, db):
    # 两人同段位入队：第一家拿到 ticket，第二家入队即与之成局；
    # 第一家 poll 应见 matched 且对手昵称为「乙」。
    _mk_player(db, "10000501", 3, "甲"); _mk_player(db, "10000502", 3, "乙")
    st, b1 = _post(http_base, "/api/versus/enqueue", {"rank": 3}, "10000501")
    assert st == 200 and "ticket" in b1
    _post(http_base, "/api/versus/enqueue", {"rank": 3}, "10000502")
    st, p = _post(http_base, "/api/versus/poll", {"ticket": b1["ticket"]}, "10000501")
    assert st == 200 and p["status"] == "matched"
    assert p["matchStart"]["opponent"]["nickname"] == "乙"

def test_http_room_create_join_cancel(http_base, db):
    # HTTP 打通其余路由：room/create → room/join 成局 → cancel（tick 路由已退役）。
    _mk_player(db, "10000511", 4, "房主"); _mk_player(db, "10000512", 4, "客人")
    st, rc = _post(http_base, "/api/versus/room/create", {"rank": 4}, "10000511")
    assert st == 200 and "code" in rc
    st, rj = _post(http_base, "/api/versus/room/join", {"code": rc["code"]}, "10000512")
    assert st == 200 and rj["status"] == "matched"
    st, cc = _post(http_base, "/api/versus/cancel", {"ticket": "nope"}, "10000511")
    assert st == 200

def test_http_bad_json_returns_400(http_base):
    # I1 回归：畸形 body 回 400 bad_json，不是 500
    import urllib.request as _u, urllib.error as _ue
    req = _u.Request(http_base + "/api/versus/enqueue", data=b"not-json",
                     headers={"Content-Type": "application/json", "X-Uid": "10000599"}, method="POST")
    try:
        with _u.urlopen(req, timeout=5) as r:
            status = r.status
    except _ue.HTTPError as e:
        status = e.code
    assert status == 400

def test_http_bad_rank_returns_400(http_base, db):
    # I2 回归：rank 非数字回 400 bad_body，不是 500
    _mk_player(db, "10000598", 1)
    st, b = _post(http_base, "/api/versus/enqueue", {"rank": "abc"}, "10000598")
    assert st == 400

def test_keepalive_reuses_connection(http_base, db):
    # HTTP/1.1 keep-alive：同一条 TCP 连接连发 3 个请求应全部拿到响应，
    # 且服务端不关闭连接（conn.sock 仍存在）。若仍是 HTTP/1.0（默认关连接），
    # 第 2 次 getresponse 会抛 RemoteDisconnected。
    import http.client, json as _json
    from urllib.parse import urlparse
    u = urlparse(http_base)
    _mk_player(db, "10000601", 3)
    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=5)
    # 同一条连接连发 3 个请求，全部应拿到响应（keep-alive 生效）
    for _ in range(3):
        conn.request("POST", "/api/versus/enqueue",
                     body=_json.dumps({"rank": 3}),
                     headers={"Content-Type": "application/json", "X-Uid": "10000601"})
        resp = conn.getresponse()
        assert resp.status == 200
        resp.read()  # 读干净，供下一请求复用连接
        assert resp.getheader("Content-Length") is not None
    assert conn.sock is not None  # 连接未被服务端关闭
    conn.close()


# === 进程内状态惰性回收(_reap)：终局/孤儿房/孤儿队列回收，活跃对局不误删 ===
def test_reap_removes_ended_match(hub, db):
    # 终局超回收窗后，match 及其 ticket_match 索引应被清。
    # 注（Task 6 退役）：旧用 tick 的 surrender 终局；WS 模型改走 ws_status（终局权威入口）。
    hub.reset()
    mid = _match_two(hub, db, "10000361", "10000362")
    hub.ws_status("10000361", mid, "surrender")   # A 认输→终局
    assert mid in hub.matches
    assert hub.matches[mid]["ended"] is True
    hub._clock["ms"] += MATCH_REAP_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")  # 任意 poll 触发锁内 _reap
    assert mid not in hub.matches
    assert all(v[0] != mid for v in hub.ticket_match.values())

def test_room_create_no_inproc_leak(hub, db):
    # C1.5：room_create 把房间记录写 Redis（room:{code}，带 PEXPIRE 兜底），不再落进程内 self.rooms/self.queue。
    # 旧的「推逻辑时钟越 ROOM_TTL_MS → _reap 清 self.rooms」语义随房间迁 Redis 失效：
    # 孤儿房靠 PEXPIRE(ROOM_TTL_MS) 真实时间兜底，逻辑时钟惰性清（_sweep）留 C1.6。
    from rediskv import k
    hub.reset()
    _mk_player(db, "10000371", 3)
    rc = hub.room_create("10000371", 3)
    assert hub.r.exists(k("room", rc["code"])) == 1     # 房间记录在 Redis
    assert hub.r.pttl(k("room", rc["code"])) > 0        # 设了 PEXPIRE 兜底
    assert hub.rooms == {} and hub.queue == {}          # 不再有进程内房间镜像（无泄漏）

def test_reap_removes_stale_queue(hub, db):
    # 入队后从不 poll/cancel 的孤儿等待者：超 QUEUE_TTL_MS 应被惰性清（C1.3 起队列在 Redis）。
    from rediskv import k
    hub.reset()
    _mk_player(db, "10000381", 5)
    r = hub.enqueue("10000381", 5)
    assert hub.r.exists(k("tk", r["ticket"])) == 1
    assert hub.r.zscore(k("q", 5), r["ticket"]) is not None
    hub._clock["ms"] += QUEUE_TTL_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")  # 任意 poll 触发锁内 _reap → Redis 队列惰性清
    assert hub.r.exists(k("tk", r["ticket"])) == 0
    assert hub.r.zscore(k("q", 5), r["ticket"]) is None
    assert hub.r.zscore(k("qall"), r["ticket"]) is None

def test_reap_keeps_active_match(hub, db):
    # 回收器最该防的：最近有心跳的活跃对局，reap 后必须仍在。
    # 注（Task 6 退役）：旧用 tick 刷新 last_tick_ms；WS 模型改走 ws_snap（每 100ms 发快照）。
    hub.reset()
    mid = _match_two(hub, db, "10000461", "10000462")
    snap = {"wave": 1, "tangsengHP": 3, "kills": 0, "units": [{"cell": {"c": 0, "r": 0}, "type": 1}]}
    hub.ws_snap("10000461", mid, {"type": "snap", "t": 1, "s": snap})  # 刷新 last_tick_ms
    hub.ws_snap("10000462", mid, {"type": "snap", "t": 2, "s": snap})
    hub._clock["ms"] += 10_000   # 越过 REAP 闸门(>=10s)，但 now-last_tick=10s << IDLE_REAP(300s)
    hub.poll("bogus")            # 触发锁内 _reap
    assert mid in hub.matches    # 活跃对局未被误删
