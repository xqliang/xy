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
