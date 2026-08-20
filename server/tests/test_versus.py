from __future__ import annotations
import os, sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api_versus import MATCH_TIMEOUT_MS, DISCONNECT_GRACE_MS, SIMULTANEOUS_EPS_MS

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
