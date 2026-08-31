# server/tests/test_versus_persist.py
# 里程碑 B-core：活跃对局持久化 + 回放。用一次性 MariaDB（本机跑用 XY_DB_PORT=3308 覆盖）。
import os, sys
from pathlib import Path

import fakeredis
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
                  pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
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
    srv = fakeredis.FakeServer()                      # C2：同一后端，供 _reopen 起「第二个 server 实例」
    h = VersusHub(db, now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds), gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(server=srv, decode_responses=True))
    h._clock = clock
    h._redis_server = srv                             # reload 测试用它起共享数据的新 hub
    return h


def _reopen(db, srv, start_ms):
    # 模拟「同一 Redis、新 server 进程」：共享 srv，但内存 self.matches 为空（懒加载从 Redis 重建）。
    from api_versus import VersusHub
    clock = {"ms": start_ms}
    h = VersusHub(db, now_ms=lambda: clock["ms"],
                  redis_client=fakeredis.FakeStrictRedis(server=srv, decode_responses=True))
    h._clock = clock
    return h

def _mk(hub, ua, ub):
    return hub._make_match({"uid": ua, "rank": 3, "ticket": "t_" + ua},
                           {"uid": ub, "rank": 3, "ticket": "t_" + ub}, hub._now())

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


def test_reload_lazy_preserves_connected_ever(rhub):
    from api_versus import MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    mid = _mk(rhub, "R1", "R2")
    rhub.ws_hello("R1", mid, lambda t: True)
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 5_000_000)
    h2.ws_hello("R2", mid, lambda t: True)
    assert h2.matches[mid]["a"]["connected_ever"] is True
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    h2.poll("bogus")
    assert mid in h2.matches


def test_opponent_never_connects_no_contest_rematch():
    # C5：一侧到场、对手从未连接 → 该局作废(no-contest)，不判胜、不写战绩，推 noShow 给在场方重匹配。
    from api_versus import MATCH_CONNECT_GRACE_MS
    import json
    hub = _fake_hub()
    e1 = {"uid": "A1", "rank": 3, "ticket": "tA"}
    e2 = {"uid": "B1", "rank": 3, "ticket": "tB"}
    mid = hub._make_match(e1, e2, hub._now())
    sent_a = []
    hub.ws_hello("A1", mid, lambda t: (sent_a.append(t), True)[1])   # A 连上；B 从未连接
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    hub.ws_snap("A1", mid, {"type": "snap", "t": 1, "s": base})
    assert hub.matches[mid].get("ended") is not True                 # 未过撮合宽限：不判定
    hub._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    hub.ws_snap("A1", mid, {"type": "snap", "t": 2, "s": base})
    m = hub.matches[mid]
    assert m["ended"] is True
    assert m.get("result") is None
    assert m.get("no_contest") is True
    types = [json.loads(t).get("type") for t in sent_a]
    assert "noShow" in types
    assert "result" not in types

def test_both_never_connect_not_resolved_as_win_still_reaped():
    # 双方都没连：不判胜（无在场方），仍由 _reap 的 20s 分支回收（B4 行为不变）
    from api_versus import MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    hub = _fake_hub()
    mid = hub._make_match({"uid":"N1","rank":3,"ticket":"tN1"}, {"uid":"N2","rank":3,"ticket":"tN2"}, hub._now())
    hub._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    hub.poll("bogus")
    assert mid not in hub.matches   # 被 reap 删除，而非判胜


def test_reload_lazy_opponent_no_show_no_contest(rhub):
    # C5：回放恢复的对局上，一侧打空气同样 no-contest（不判胜、不写 pvp_results、推 noShow）。
    from api_versus import MATCH_CONNECT_GRACE_MS
    import json
    mid = _mk(rhub, "PW1", "PW2")
    rhub.ws_hello("PW1", mid, lambda t: True)   # PW1 连过；PW2 从未连接
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 9_000_000)
    sent = []
    h2.ws_hello("PW1", mid, lambda t: (sent.append(t), True)[1])   # 懒加载重建
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    h2.ws_snap("PW1", mid, {"type": "snap", "t": 1, "s": base})
    m = h2.matches[mid]
    assert m["ended"] is True
    assert m.get("result") is None
    assert m.get("no_contest") is True
    assert "noShow" in [json.loads(t).get("type") for t in sent]
    with rhub.db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM pvp_results WHERE match_id=%s", (mid,))
        assert cur.fetchone()["c"] == 0


def test_reloaded_never_connected_side_no_contest_after_disconnect_grace(rhub):
    # 分支1 守卫回归：C2 回放把两侧 gone_ms=now；从未连接侧过 DISCONNECT_GRACE_MS(45s)
    # 也不得经分支1 误判胜，必须走分支2 no-contest。
    from api_versus import DISCONNECT_GRACE_MS
    import json
    mid = _mk(rhub, "N1", "N2")
    rhub.ws_hello("N1", mid, lambda t: True)   # N1 连过；N2 从未连接
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 20_000_000)
    sent = []
    h2.ws_hello("N1", mid, lambda t: (sent.append(t), True)[1])
    h2._clock["ms"] += DISCONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    h2.ws_snap("N1", mid, {"type": "snap", "t": 1, "s": base})
    m = h2.matches[mid]
    assert m.get("result") is None
    assert m.get("no_contest") is True
    assert "result" not in [json.loads(t).get("type") for t in sent]


def test_connected_then_dropped_still_wins(rhub):
    # 分支1 不变回归：一方连过(connected_ever=True)后掉线超 45s → 仍判对方胜 + 写 pvp_results。
    from api_versus import DISCONNECT_GRACE_MS
    mid = _mk(rhub, "D1", "D2")
    rhub.ws_hello("D1", mid, lambda t: True)
    rhub.ws_hello("D2", mid, lambda t: True)
    rhub.matches[mid]["b"]["gone_ms"] = rhub._now()          # 模拟 D2 socket 掉线（连过又断）
    rhub._clock["ms"] += DISCONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    rhub.ws_snap("D1", mid, {"type": "snap", "t": 1, "s": base})
    m = rhub.matches[mid]
    assert m["ended"] is True
    assert m.get("no_contest") is not True
    assert m["result"]["a"]["outcome"] == "win"
    assert m["result"]["a"]["reason"] == "opponentDisconnectTimeout"
    with rhub.db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM pvp_results WHERE match_id=%s", (mid,))
        assert cur.fetchone()["c"] == 2


def test_flush_writes_mstate_to_redis(rhub):
    from rediskv import k
    import json
    mid = _mk(rhub, "F1", "F2")
    rhub.flush_active_matches()
    raw = rhub.r.get(k("mstate", mid))
    assert raw is not None
    blob = json.loads(raw)
    assert blob["state"]["a"]["uid"] == "F1"
    assert blob["state"]["b"]["uid"] == "F2"
    assert "ws_send" not in blob["state"]["a"]
    assert blob["ticket_a"] == "t_F1" and blob["ticket_b"] == "t_F2"


def test_mstate_has_ttl(rhub):
    from rediskv import k
    mid = _mk(rhub, "T1", "T2")
    rhub.flush_active_matches()
    assert rhub.r.pttl(k("mstate", mid)) > 0


def test_flush_skips_ended_match(rhub):
    from rediskv import k
    mid = _mk(rhub, "S1", "S2")
    rhub.ws_status("S1", mid, "surrender")
    rhub.flush_active_matches()
    assert not rhub.r.exists(k("mstate", mid))


def test_flush_then_lazy_load_restores_match_and_tickets(rhub):
    from rediskv import k
    mid = _mk(rhub, "P1", "P2")
    rhub.flush_active_matches()
    assert rhub.r.exists(k("mstate", mid))
    h2 = _reopen(rhub.db, rhub._redis_server, 2_000_000)
    assert mid not in h2.matches
    sent = []
    res = h2.ws_hello("P1", mid, lambda t: (sent.append(t), True)[1])
    assert "error" not in res
    assert mid in h2.matches
    assert h2.matches[mid]["a"]["uid"] == "P1" and h2.matches[mid]["b"]["uid"] == "P2"
    assert h2.ticket_match.get("t_P1") == (mid, "P1")
    assert h2.ticket_match.get("t_P2") == (mid, "P2")
    assert h2.matches[mid]["a"]["ws_send"] is not None
    assert h2.matches[mid]["a"]["gone_ms"] == 0


def test_ws_hello_bad_hello_when_no_redis_state(rhub):
    res = rhub.ws_hello("Z1", "deadbeefdeadbeef", lambda t: True)
    assert res.get("error") == "bad_hello"


def test_end_deletes_redis_mstate(rhub):
    from rediskv import k
    mid = _mk(rhub, "E1", "E2")
    rhub.flush_active_matches()
    assert rhub.r.exists(k("mstate", mid))
    rhub.ws_status("E1", mid, "surrender")
    assert not rhub.r.exists(k("mstate", mid))


def test_create_claims_owner(rhub):
    from rediskv import k
    mid = _mk(rhub, "A1", "A2")
    assert rhub.r.get(k("owner", mid)) == rhub.instance_id


def test_lazy_load_takes_over_owner(rhub):
    from rediskv import k
    mid = _mk(rhub, "B1", "B2")
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 2_000_000)
    assert h2.instance_id != rhub.instance_id
    h2.ws_hello("B1", mid, lambda t: True)          # 触发懒认领接管
    assert rhub.r.get(k("owner", mid)) == h2.instance_id


def test_stale_owner_forget_is_fenced(rhub):
    from rediskv import k
    mid = _mk(rhub, "F1", "F2")
    rhub.ws_hello("F1", mid, lambda t: True)
    rhub.flush_active_matches()                      # owner=旧(rhub)，mstate 写入
    h2 = _reopen(rhub.db, rhub._redis_server, 2_000_000)
    h2.ws_hello("F1", mid, lambda t: True)           # 新接管 → owner=h2
    rhub._forget_match_state(mid)                    # 旧（失去归属）尝试删 → 应被 fence
    assert rhub.r.get(k("mstate", mid)) is not None  # 未被旧删
    assert rhub.r.get(k("owner", mid)) == h2.instance_id


def test_owner_terminal_deletes_owner_key(rhub):
    from rediskv import k
    mid = _mk(rhub, "T1", "T2")
    rhub.flush_active_matches()
    assert rhub.r.get(k("owner", mid)) is not None
    rhub.ws_status("T1", mid, "surrender")           # 终局 → _set_result → _forget_match_state
    assert rhub.r.get(k("mstate", mid)) is None
    assert rhub.r.get(k("owner", mid)) is None
