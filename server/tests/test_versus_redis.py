import contextlib
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def test_rediskv_prefix_and_config():
    from rediskv import k
    assert k("q", "3") == "xy:pvp:q:3"
    assert k("match", "abc") == "xy:pvp:match:abc"
    assert k("q", 3) == "xy:pvp:q:3"   # int 部件（rank 常是 int）也应可用，不 TypeError

def test_fakeredis_roundtrip_smoke():
    # 锁住 C1.1 的 de-risk：fakeredis 在 py3.14 上 str/zset 往返可用（匹配层依赖）
    import fakeredis
    r = fakeredis.FakeStrictRedis(decode_responses=True)
    r.set("xy:pvp:probe", "1")
    assert r.get("xy:pvp:probe") == "1"
    r.zadd("xy:pvp:q:3", {"tkA": 1000.0})
    assert r.zrange("xy:pvp:q:3", 0, -1) == ["tkA"]
    assert r.zscore("xy:pvp:q:3", "tkA") == 1000.0

def test_redis_kwargs_from_env(monkeypatch):
    monkeypatch.setenv("XY_REDIS_HOST", "1.2.3.4")
    monkeypatch.setenv("XY_REDIS_PORT", "6380")
    monkeypatch.setenv("XY_REDIS_DB", "7")
    from config import load_config, redis_kwargs
    cfg = load_config()
    kw = redis_kwargs(cfg)
    assert kw["host"] == "1.2.3.4" and kw["port"] == 6380 and kw["db"] == 7
    assert kw["decode_responses"] is True


# ---------------------------------------------------------------- redis 注入 hub ----
class _FakeDB:
    """内存 DB 桩：redis 注入测试不触库，cursor() no-op（_profile 查无此人回默认档）。"""
    def today(self): return "2026-01-01"
    def now(self): return 1_000_000
    @contextlib.contextmanager
    def cursor(self):
        class _Cur:
            def execute(self, *a, **k): pass
            def fetchone(self): return None
        yield _Cur()


def _redis_hub():
    # 与其它测试 hub-builder 同款：可控时钟 + 固定 seed/code/map，但额外注入 fakeredis 客户端。
    import fakeredis
    from api_versus import VersusHub
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(_FakeDB(), now_ms=lambda: clock["ms"], gen_seed=lambda: next(seeds),
                  gen_code=lambda: "ROOM01", pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
    h._clock = clock
    return h


def test_hub_accepts_redis_client():
    h = _redis_hub()
    assert h.r is not None
    h.r.set("xy:pvp:probe", "1")
    assert h.r.get("xy:pvp:probe") == "1"
    h.reset()                       # reset 应清库（flushdb）而不报错
    assert h.r.get("xy:pvp:probe") is None


# ---------------------------------------------------------------- C1.3 队列/等待/超时 ----
def test_enqueue_poll_waiting_timeout_redis():
    # enqueue 写 tk hash + q/qall ZSET；poll 未成局=waiting；超 MATCH_TIMEOUT_MS 推逻辑时钟=timeout 并清票。
    from api_versus import MATCH_TIMEOUT_MS
    from rediskv import k
    h = _redis_hub()
    t = h.enqueue("u1", 3)["ticket"]
    assert h.poll(t)["status"] == "waiting"
    assert h.r.hget(k("tk", t), "uid") == "u1"
    assert h.r.hget(k("tk", t), "rank") == "3"
    assert h.r.zscore(k("q", 3), t) is not None
    assert h.r.zscore(k("qall"), t) is not None
    h._clock["ms"] += MATCH_TIMEOUT_MS + 1
    assert h.poll(t)["status"] == "timeout"
    assert h.r.exists(k("tk", t)) == 0
    assert h.r.zscore(k("q", 3), t) is None
    assert h.r.zscore(k("qall"), t) is None


def test_cancel_drops_ticket_from_redis():
    # cancel → _drop_ticket：DEL tk + ZREM q/qall；容忍不存在（幂等）。
    from rediskv import k
    h = _redis_hub()
    t = h.enqueue("u1", 4)["ticket"]
    assert h.cancel(t) == {"ok": True}
    assert h.r.exists(k("tk", t)) == 0
    assert h.r.zscore(k("q", 4), t) is None
    assert h.r.zscore(k("qall"), t) is None
    assert h.cancel("nonexistent") == {"ok": True}   # 幂等，不抛


# ---------------------------------------------------------------- C1.4 原子撮合 + 轻量记录 ----
def test_same_rank_pairs_and_poll_matched_redis():
    from rediskv import k
    h = _redis_hub()
    t1 = h.enqueue("u1", 3)["ticket"]; assert h.poll(t1)["status"] == "waiting"
    t2 = h.enqueue("u2", 3)["ticket"]
    p2 = h.poll(t2)
    assert p2["status"] == "matched"
    ms = p2["matchStart"]
    assert ms["seed"] and ms["map"] == "huoyanshan" and ms["opponent"]["uid"]
    p1 = h.poll(t1); assert p1["status"] == "matched"
    assert p1["matchStart"]["matchId"] == ms["matchId"]
    # 轻量记录 round-trip：match:{mid} 存双方 uid；两 tm 指向同一 mid；两票已出 qall
    mid = ms["matchId"]
    assert h.r.hget(k("match", mid), "uid_a") in ("u1", "u2")
    assert h.r.get(k("tm", t1)).split("|")[0] == mid
    assert h.r.get(k("tm", t2)).split("|")[0] == mid
    assert h.r.zscore(k("qall"), t1) is None and h.r.zscore(k("qall"), t2) is None
    # 单实例 owner：进程内运行时也建了（供 ws_*）
    assert mid in h.matches


def test_widen_after_hold_window_redis():
    h = _redis_hub()
    t1 = h.enqueue("u1", 2)["ticket"]; h.poll(t1)
    t2 = h.enqueue("u2", 9)["ticket"]
    assert h.poll(t2)["status"] == "waiting"    # 未过 hold 窗、异段位 → 不撮
    h._clock["ms"] += 3_001                      # 过保持窗口（冷清 adaptive=3s）
    assert h.poll(t2)["status"] == "matched"     # 跨段位放宽配对
    assert h.poll(t1)["status"] == "matched"


def test_no_double_pairing_under_concurrency_redis():
    # 三人入队反复 _try_pair 不应把同一 ticket 配进两局（WATCH/MULTI 原子）：恰一对成局，第三个仍等待。
    from rediskv import k
    h = _redis_hub()
    ts = [h.enqueue(f"u{i}", 3)["ticket"] for i in range(3)]
    for t in ts:
        h.poll(t)
    matched = [t for t in ts if h.r.get(k("tm", t))]
    assert len(matched) == 2
    third = next(t for t in ts if t not in matched)
    assert h.poll(third)["status"] == "waiting"
    assert h.r.zscore(k("qall"), third) is not None
