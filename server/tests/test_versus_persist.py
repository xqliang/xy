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


@pytest.fixture
def rhub(db):
    from api_versus import VersusHub
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(db, now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds), gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan")
    h._clock = clock
    return h

def _mk(hub, ua, ub):
    return hub._make_match({"uid": ua, "rank": 3, "ticket": "t_" + ua},
                           {"uid": ub, "rank": 3, "ticket": "t_" + ub}, hub._now())

def test_flush_then_load_restores_match_and_tickets(rhub, db):
    mid1 = _mk(rhub, "P1", "P2")
    mid2 = _mk(rhub, "P3", "P4")
    rhub.flush_active_matches()
    from api_versus import VersusHub
    h2 = VersusHub(db, now_ms=lambda: 2_000_000)
    h2.load_active_matches()
    assert mid1 in h2.matches and mid2 in h2.matches
    assert h2.matches[mid1]["a"]["uid"] == "P1" and h2.matches[mid1]["b"]["uid"] == "P2"
    assert h2.ticket_match.get("t_P1") == (mid1, "P1")
    assert h2.ticket_match.get("t_P2") == (mid1, "P2")
    sent = []
    res = h2.ws_hello("P1", mid1, lambda t: (sent.append(t), True)[1])
    assert "error" not in res
    assert h2.matches[mid1]["a"]["ws_send"] is not None
    assert h2.matches[mid1]["a"]["gone_ms"] == 0

def test_flush_reconciles_deletes_ended_and_absent(rhub, db):
    mid = _mk(rhub, "Q1", "Q2")
    rhub.flush_active_matches()
    rhub.ws_status("Q1", mid, "surrender")   # 终局 → ended=True
    rhub.flush_active_matches()              # 对账：活跃集不含 mid → 删行
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM pvp_active_match WHERE match_id=%s", (mid,))
        assert cur.fetchone()["c"] == 0


def test_reap_removes_never_connected_match(rhub, db):
    from api_versus import MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    mid = _mk(rhub, "N1", "N2")           # 撮合成局，但双方都没 ws_hello
    rhub._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    rhub.poll("bogus")                    # 触发 in-lock _reap
    assert mid not in rhub.matches
    assert all(v[0] != mid for v in rhub.ticket_match.values())

def test_reap_keeps_match_if_one_side_connected(rhub, db):
    from api_versus import MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    mid = _mk(rhub, "C1", "C2")
    rhub.ws_hello("C1", mid, lambda t: True)   # 一方连上 → connected_ever
    rhub._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    rhub.poll("bogus")
    assert mid in rhub.matches            # 连过的不按"从未连接"退队


def test_reload_preserves_connected_ever_so_resumed_match_not_reaped_at_connect_grace(rhub, db):
    from api_versus import VersusHub, MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    mid = _mk(rhub, "R1", "R2")
    rhub.ws_hello("R1", mid, lambda t: True)   # 一侧连过 → connected_ever=True
    rhub.flush_active_matches()
    h2 = VersusHub(db, now_ms=lambda: 5_000_000)
    h2.load_active_matches()
    # 回放后 R1 侧 connected_ever 应被保留为 True（而非被覆盖成 False）
    assert h2.matches[mid]["a"]["connected_ever"] is True
    # 因此即便双方都没再 hello，也不会被 20s「从未连接」分支秒删（改由 IDLE_REAP/DISCONNECT_GRACE 治理）
    h2._clock = {"ms": 5_000_000}
    h2._now = lambda: h2._clock["ms"]
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    h2.poll("bogus")
    assert mid in h2.matches


def test_opponent_never_connects_present_side_wins():
    from api_versus import MATCH_CONNECT_GRACE_MS
    import json
    hub = _fake_hub()
    e1 = {"uid": "A1", "rank": 3, "ticket": "tA"}
    e2 = {"uid": "B1", "rank": 3, "ticket": "tB"}
    mid = hub._make_match(e1, e2, hub._now())
    sent_a = []
    hub.ws_hello("A1", mid, lambda t: (sent_a.append(t), True)[1])   # A connects; B never does
    # 未过撮合宽限：A 发快照不应判定
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    hub.ws_snap("A1", mid, {"type": "snap", "t": 1, "s": base})
    assert hub.matches[mid].get("ended") is not True
    # 过了撮合宽限：A 再发快照 → 对手 B 从未露面 → A 判胜
    hub._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    hub.ws_snap("A1", mid, {"type": "snap", "t": 2, "s": base})
    m = hub.matches[mid]
    assert m["ended"] is True
    assert m["result"]["a"]["outcome"] == "win"
    assert m["result"]["a"]["reason"] == "opponentDisconnectTimeout"
    assert m["result"]["b"]["reason"] == "selfDisconnect"
    # A 收到 result 推送
    types = [json.loads(t).get("type") for t in sent_a]
    assert "result" in types

def test_both_never_connect_not_resolved_as_win_still_reaped():
    # 双方都没连：不判胜（无在场方），仍由 _reap 的 20s 分支回收（B4 行为不变）
    from api_versus import MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    hub = _fake_hub()
    mid = hub._make_match({"uid":"N1","rank":3,"ticket":"tN1"}, {"uid":"N2","rank":3,"ticket":"tN2"}, hub._now())
    hub._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")
    assert mid not in hub.matches   # 被 reap 删除，而非判胜


def test_reload_opponent_no_show_present_side_wins(rhub, db):
    # I1 路径回归：打空气判胜在"回放恢复的对局"上也成立（最微妙的一环——
    # 回放把两侧 gone_ms 置 now、connected_ever 按持久化值恢复；在场方重连后过 20s 宽限即判胜）。
    from api_versus import VersusHub, MATCH_CONNECT_GRACE_MS
    import json
    mid = _mk(rhub, "PW1", "PW2")
    rhub.ws_hello("PW1", mid, lambda t: True)   # PW1 连过(connected_ever=True)；PW2 从未连接
    rhub.flush_active_matches()
    # 模拟重启：新 hub 从库回放
    h2 = VersusHub(db, now_ms=lambda: 9_000_000)
    h2._clock = {"ms": 9_000_000}; h2._now = lambda: h2._clock["ms"]
    h2.load_active_matches()
    # 回放后 PW1 的 connected_ever 应保留 True、PW2 仍 False
    assert h2.matches[mid]["a"]["connected_ever"] is True
    assert h2.matches[mid]["b"]["connected_ever"] is False
    # PW1 重连并在过撮合宽限后发快照 → 对手 PW2 从未露面 → PW1 判胜
    sent = []
    h2.ws_hello("PW1", mid, lambda t: (sent.append(t), True)[1])
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    h2.ws_snap("PW1", mid, {"type": "snap", "t": 1, "s": base})
    m = h2.matches[mid]
    assert m["ended"] is True
    assert m["result"]["a"]["outcome"] == "win"
    assert m["result"]["a"]["reason"] == "opponentDisconnectTimeout"
    assert "result" in [json.loads(t).get("type") for t in sent]
