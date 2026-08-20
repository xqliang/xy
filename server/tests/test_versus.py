from __future__ import annotations
import json
import os, sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api_versus import (MATCH_TIMEOUT_MS, DISCONNECT_GRACE_MS, SIMULTANEOUS_EPS_MS,
                        MATCH_REAP_MS, REAP_INTERVAL_MS, ROOM_TTL_MS, QUEUE_TTL_MS)

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
                  pick_map=lambda: "huoyanshan")
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

def test_tick_relays_inputs(hub, db):
    hub.reset()
    mid = _match_two(hub, db)
    d = {"wave": 1, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000201", mid, [{"t": 5, "op": "place", "cell": "r1c1"}], d, None, "playing")
    resp = hub.tick("10000202", mid, [], d, None, "playing")
    assert resp["opponentInputs"] == [{"t": 5, "op": "place", "cell": "r1c1"}]
    resp2 = hub.tick("10000202", mid, [], d, None, "playing")
    assert resp2["opponentInputs"] == []

def test_first_clear_schedules_next_wave(hub, db):
    hub.reset()
    mid = _match_two(hub, db)
    d = {"wave": 1, "power": 10, "kills": 5, "tangsengHP": 3, "peach": 20, "units": 3}
    resp = hub.tick("10000201", mid, [], d, {"wave": 1, "t": 900}, "playing")
    assert resp["nextWave"]["wave"] == 2
    start2 = resp["nextWave"]["startAtServerMs"]
    resp_b = hub.tick("10000202", mid, [], d, {"wave": 1, "t": 950}, "playing")
    assert resp_b["nextWave"]["startAtServerMs"] == start2


def _dig(w=1): return {"wave": w, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1}

def test_surrender_opponent_wins(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000301", "10000302")
    hub.tick("10000301", mid, [], _dig(), None, "surrender")
    rb = hub.tick("10000302", mid, [], _dig(), None, "playing")
    assert rb["result"]["outcome"] == "win"
    assert rb["result"]["reason"] == "opponentSurrender"
    ra = hub.tick("10000301", mid, [], _dig(), None, "surrender")
    assert ra["result"]["outcome"] == "lose"
    assert ra["result"]["reason"] == "selfSurrender"   # 败方原因也要对
    with db.cursor() as cur:
        cur.execute("SELECT outcome,reason FROM pvp_results WHERE match_id=%s AND uid=%s", (mid, "10000302"))
        win_row = cur.fetchone()
        assert win_row["outcome"] == "win" and win_row["reason"] == "opponentSurrender"
        cur.execute("SELECT outcome,reason FROM pvp_results WHERE match_id=%s AND uid=%s", (mid, "10000301"))
        lose_row = cur.fetchone()
        assert lose_row["outcome"] == "lose" and lose_row["reason"] == "selfSurrender"

def test_tangseng_dead(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000311", "10000312")
    hub.tick("10000311", mid, [], _dig(), None, "tangsengDead")
    rb = hub.tick("10000312", mid, [], _dig(), None, "playing")
    assert rb["result"]["reason"] == "opponentTangsengDead"

def test_disconnect_timeout(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000321", "10000322")
    hub.tick("10000321", mid, [], _dig(), None, "playing")
    hub.tick("10000322", mid, [], _dig(), None, "playing")
    hub._clock["ms"] += DISCONNECT_GRACE_MS + 500
    ra = hub.tick("10000321", mid, [], _dig(), None, "playing")
    assert ra["opponentStatus"] == "disconnected"
    assert ra["result"]["outcome"] == "win"
    assert ra["result"]["reason"] == "opponentDisconnectTimeout"

def test_simultaneous_draw(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000331", "10000332")
    hub.tick("10000331", mid, [], _dig(), None, "tangsengDead")
    hub._clock["ms"] += 100
    rb = hub.tick("10000332", mid, [], _dig(), None, "tangsengDead")
    assert rb["result"]["outcome"] == "draw"

def test_non_simultaneous_not_draw(hub, db):
    # A 先阵亡（B 判赢），B 在 EPS 之外才阵亡 → 不得改判平局，仍是 B 赢
    hub.reset()
    mid = _match_two(hub, db, "10000341", "10000342")
    hub.tick("10000341", mid, [], _dig(), None, "tangsengDead")   # A 先死
    rb = hub.tick("10000342", mid, [], _dig(), None, "playing")   # B 报 playing → B 判赢
    assert rb["result"]["outcome"] == "win"
    assert rb["result"]["reason"] == "opponentTangsengDead"
    hub._clock["ms"] += SIMULTANEOUS_EPS_MS + 50                  # 拉开到 EPS 之外
    ra = hub.tick("10000341", mid, [], _dig(), None, "tangsengDead")  # A 再报死
    assert ra["result"]["outcome"] == "lose"                     # A 仍判负（非平局）
    rb2 = hub.tick("10000342", mid, [], _dig(), None, "playing")
    assert rb2["result"]["outcome"] == "win"                     # B 仍判赢，未被改判平局
    # DB 落库也应是 win/lose 两行，无 draw
    with db.cursor() as cur:
        cur.execute("SELECT outcome FROM pvp_results WHERE match_id=%s ORDER BY outcome", (mid,))
        outs = sorted(r["outcome"] for r in cur.fetchall())
    assert outs == ["lose", "win"]


def test_anomaly_recorded_and_dedup(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000401", "10000402")
    # 先清当日旧记录，保证重复跑不撞唯一键、不串味
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (db.today(), "10000401"))
    # 击杀暴涨且远超战力可能：kills 从 0 跳到 9999，power 极低
    bad = {"wave": 1, "power": 1, "kills": 9999, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000401", mid, [], bad, None, "playing")
    hub.tick("10000401", mid, [], {**bad, "kills": 19999}, None, "playing")  # 同对手当天只记 1
    day = db.today()
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) c FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "10000401"))
        assert cur.fetchone()["c"] == 1


def test_three_opponents_trigger_ban(hub, db):
    hub.reset()
    day = db.today(); now = db.now()
    with db.cursor() as cur:
        # 先清当日旧记录，保证重复跑时只有本测试插入的行
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "10000411"))
        for opp in ("30000001", "30000002"):
            cur.execute("INSERT INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s)", (day, "10000411", opp, "m", "{}", now))
    assert hub.is_banned("10000411") is False   # 只有 2 个不同对手
    _mk_player(db, "10000411", 3); _mk_player(db, "10000412", 3)
    mid = _match_two(hub, db, "10000411", "10000412")
    bad = {"wave": 1, "power": 1, "kills": 9999, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000411", mid, [], bad, None, "playing")   # 第 1 tick 建基线
    hub.tick("10000411", mid, [], {**bad, "kills": 19999}, None, "playing")  # 第 2 tick 增量暴涨才触发→第 3 个不同对手
    assert hub.is_banned("10000411") is True

def test_anticheat_tangseng_hp_increase(hub, db):
    # 唐僧血单调不增：基线 HP=3，下一 tick 涨到 5 → 记 tangsengHP_increased
    hub.reset()
    mid = _match_two(hub, db, "10000421", "10000422")
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (db.today(), "10000421"))
    base = {"wave": 1, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000421", mid, [], base, None, "playing")                       # 建基线
    hub.tick("10000421", mid, [], {**base, "tangsengHP": 5}, None, "playing")  # HP 上涨→异常
    with db.cursor() as cur:
        cur.execute("SELECT reasons_json FROM pvp_anomaly WHERE day=%s AND uid=%s", (db.today(), "10000421"))
        row = cur.fetchone()
    assert row is not None and "tangsengHP_increased" in row["reasons_json"]

def test_anticheat_wave_ahead(hub, db):
    # 波次超前：wave_schedule 初始只有 {1}，上报 wave=5 远超 max+1=2 → wave_ahead（首 tick 即触发，无需基线）
    hub.reset()
    mid = _match_two(hub, db, "10000431", "10000432")
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (db.today(), "10000431"))
    hub.tick("10000431", mid, [], {"wave": 5, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1}, None, "playing")
    with db.cursor() as cur:
        cur.execute("SELECT reasons_json FROM pvp_anomaly WHERE day=%s AND uid=%s", (db.today(), "10000431"))
        row = cur.fetchone()
    assert row is not None and "wave_ahead" in row["reasons_json"]

def test_anticheat_db_failure_does_not_500(hub, db):
    # DB 抖动时 _record_anomaly / is_banned 都不得把 tick 打成 500，降级为不通知
    hub.reset()
    mid = _match_two(hub, db, "10000441", "10000442")
    bad = {"wave": 1, "power": 1, "kills": 9999, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000441", mid, [], bad, None, "playing")  # 建基线（真实库）
    orig = hub.db.cursor
    def boom(*a, **k):
        raise RuntimeError("db down")
    hub.db.cursor = boom            # 之后所有 DB 访问抛错
    try:
        resp = hub.tick("10000441", mid, [], {**bad, "kills": 99999}, None, "playing")
    finally:
        hub.db.cursor = orig        # 务必恢复，db fixture 是 module 级共享
    assert isinstance(resp, dict)
    assert resp.get("cheatNotice") is None


# —— HTTP 端到端冒烟：起真 ThreadingHTTPServer，跑 /api/versus/* 路由 ——
# 抽样 enqueue/poll 全链路，其余路由见 test_http_room_create_join_tick_cancel 与 hub 单测。
@pytest.fixture(scope="module")
def http_base(db):
    # 复用 module 级 db，在其上挂真实 HTTP server，验证路由→handler→Hub 全链路。
    from server import Handler
    from api_versus import VersusHub
    from config import load_config
    cfg = load_config(); cfg["static_dir"] = str(ROOT)
    class H(Handler): pass
    H.db = db; H.cfg = cfg; H.versus = VersusHub(db)
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

def test_http_room_create_join_tick_cancel(http_base, db):
    # HTTP 打通其余路由：room/create → room/join 成局 → tick → cancel
    _mk_player(db, "10000511", 4, "房主"); _mk_player(db, "10000512", 4, "客人")
    st, rc = _post(http_base, "/api/versus/room/create", {"rank": 4}, "10000511")
    assert st == 200 and "code" in rc
    st, rj = _post(http_base, "/api/versus/room/join", {"code": rc["code"]}, "10000512")
    assert st == 200 and rj["status"] == "matched"
    mid = rj["matchStart"]["matchId"]
    st, tk = _post(http_base, "/api/versus/tick",
                   {"matchId": mid, "inputs": [],
                    "digest": {"wave": 1, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1},
                    "status": "playing"}, "10000511")
    assert st == 200 and "serverMs" in tk
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


# === Task 10：进程内状态惰性回收(_reap) + 终局后停止转发 + 并发 ===
def test_reap_removes_ended_match(hub, db):
    # 终局超回收窗后，match 及其 ticket_match 索引应被清
    hub.reset()
    mid = _match_two(hub, db, "10000361", "10000362")
    hub.tick("10000361", mid, [], _dig(), None, "surrender")
    hub.tick("10000362", mid, [], _dig(), None, "playing")
    assert mid in hub.matches
    hub._clock["ms"] += MATCH_REAP_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")  # 任意 poll 触发锁内 _reap
    assert mid not in hub.matches
    assert all(v[0] != mid for v in hub.ticket_match.values())

def test_reap_removes_orphan_room(hub, db):
    # 房主建房后蒸发：超 ROOM_TTL_MS 的孤儿房应被清
    hub.reset()
    _mk_player(db, "10000371", 3)
    rc = hub.room_create("10000371", 3)
    assert rc["code"] in hub.rooms
    hub._clock["ms"] += ROOM_TTL_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")
    assert rc["code"] not in hub.rooms

def test_reap_removes_stale_queue(hub, db):
    # 入队后从不 poll/cancel 的孤儿等待者：超 QUEUE_TTL_MS 应被清
    hub.reset()
    _mk_player(db, "10000381", 5)
    r = hub.enqueue("10000381", 5)
    assert r["ticket"] in hub.queue
    hub._clock["ms"] += QUEUE_TTL_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")
    assert r["ticket"] not in hub.queue

def test_relay_stops_after_ended(hub, db):
    # I2：终局后一方仍发动作，不应再被转发给对手
    hub.reset()
    mid = _match_two(hub, db, "10000351", "10000352")
    hub.tick("10000351", mid, [], _dig(), None, "surrender")   # A 认输→终局
    hub.tick("10000352", mid, [], _dig(), None, "playing")
    hub.tick("10000351", mid, [{"t": 9, "op": "place", "cell": "r1c1"}], _dig(), None, "surrender")
    rb = hub.tick("10000352", mid, [], _dig(), None, "playing")
    assert rb["opponentInputs"] == []

def test_concurrent_tick_no_crash(hub, db):
    # 两线程同时 tick 同一局：大锁串行化，应无异常、result 不撕裂、无 KeyError
    import threading
    hub.reset()
    mid = _match_two(hub, db, "10000391", "10000392")
    errors = []
    def spam(uid):
        try:
            for _ in range(15):
                hub.tick(uid, mid, [{"t": 1, "op": "place", "cell": "r1c1"}], _dig(), None, "playing")
        except Exception as e:  # noqa: BLE001
            errors.append(e)
    ta = threading.Thread(target=spam, args=("10000391",))
    tb = threading.Thread(target=spam, args=("10000392",))
    ta.start(); tb.start(); ta.join(5); tb.join(5)
    assert not errors
    assert mid in hub.matches


def test_reap_keeps_active_match(hub, db):
    # 回收器最该防的：最近有心跳的活跃对局，reap 后必须仍在
    hub.reset()
    mid = _match_two(hub, db, "10000461", "10000462")
    hub.tick("10000461", mid, [], _dig(), None, "playing")  # 刷新 last_tick_ms
    hub.tick("10000462", mid, [], _dig(), None, "playing")
    hub._clock["ms"] += 10_000   # 越过 REAP 闸门(>=10s)，但 now-last_tick=10s << IDLE_REAP(300s)
    hub.poll("bogus")            # 触发锁内 _reap
    assert mid in hub.matches    # 活跃对局未被误删
