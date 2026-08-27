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
