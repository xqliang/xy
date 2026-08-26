# server/tests/test_versus_persist.py
# 里程碑 B-core：活跃对局持久化 + 回放。用一次性 MariaDB（本机跑用 XY_DB_PORT=3308 覆盖）。
import os, sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))   # 让 config/db/api_versus 可导入（与 test_versus.py 一致，脱离 python -m 也能跑）

DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),  # 本机跑用 XY_DB_PORT=3308 覆盖
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
    d = DB(load_config()); d.migrate()
    return d

def test_migrate_creates_pvp_active_match(db):
    with db.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'pvp_active_match'")
        assert cur.fetchone() is not None


def _fake_hub():
    from api_versus import VersusHub
    import contextlib
    class _FakeDB:
        def today(self): return "2026-01-01"
        def now(self): return 1_000_000
        @contextlib.contextmanager
        def cursor(self):
            class _Cur:
                def execute(self, *a, **k): pass
                def executemany(self, *a, **k): pass
                def fetchone(self): return None
                def fetchall(self): return []
            yield _Cur()
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(_FakeDB(), now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds), gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan")
    h._clock = clock
    return h

def test_serialize_drops_ws_send_and_roundtrips():
    from api_versus import _serialize_match, _deserialize_match
    import json, copy
    hub = _fake_hub()
    e1 = {"uid": "A1", "rank": 3, "ticket": "tA"}
    e2 = {"uid": "B1", "rank": 3, "ticket": "tB"}
    mid = hub._make_match(e1, e2, hub._now())
    m = hub.matches[mid]
    m["a"]["ws_send"] = lambda t: True          # 装一个闭包，序列化必须丢掉
    m["wave_schedule"][2] = hub._now() + 5000    # int 键
    m["first_clear"][1] = "A1"
    # 塞入带 _ms 的 digest（B3 flush/load 依赖它原样 round-trip）+ 几个非默认 per-side 字段
    m["a"]["last_digest"] = {"tangsengHP": 3, "kills": 5, "_ms": 123}
    m["a"]["status"] = "dead"
    m["a"]["wave"] = 4
    m["a"]["last_next_wave"] = 3

    blob = _serialize_match(m)
    text = json.dumps(blob)                      # 必须能 JSON 化（无闭包）
    assert "ws_send" not in text

    parsed = json.loads(text)
    parsed_before = copy.deepcopy(parsed)        # 反序列化必须是纯函数：不得就地改动入参 blob
    restored = _deserialize_match(parsed, now=2_000_000)
    assert parsed == parsed_before               # 入参未被 _deserialize_match 修改

    assert restored["match_id"] == mid
    assert restored["a"]["uid"] == "A1" and restored["b"]["uid"] == "B1"
    assert restored["seed"] == m["seed"] and restored["map"] == m["map"]
    assert 2 in restored["wave_schedule"] and restored["wave_schedule"][2] == m["wave_schedule"][2]
    assert 1 in restored["first_clear"] and restored["first_clear"][1] == "A1"
    # 带 _ms 的 digest 原样 round-trip
    assert restored["a"]["last_digest"] == {"tangsengHP": 3, "kills": 5, "_ms": 123}
    # 其它 per-side 字段也 round-trip
    assert restored["a"]["status"] == "dead"
    assert restored["a"]["wave"] == 4
    assert restored["a"]["last_next_wave"] == 3
    # 连接态复位：ws_send=None、gone_ms=now、last_tick_ms=now、created_ms=now、connected_ever=False
    assert restored["a"]["ws_send"] is None and restored["b"]["ws_send"] is None
    assert restored["a"]["gone_ms"] == 2_000_000 and restored["b"]["gone_ms"] == 2_000_000
    assert restored["a"]["last_tick_ms"] == 2_000_000 and restored["b"]["last_tick_ms"] == 2_000_000
    assert restored["created_ms"] == 2_000_000
    assert restored["a"]["connected_ever"] is False and restored["b"]["connected_ever"] is False
