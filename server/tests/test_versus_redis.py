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


# ---------------------------------------------------------------- C1.5 私房 room_create/room_join ----
def test_room_create_writes_redis_and_host_waiting():
    # room_create 把房间记录 + 房主 tk 写 Redis；房主 tk 带 room 标记、不进 q/qall 随机池；房主 poll 仍 waiting。
    from rediskv import k
    h = _redis_hub()
    rc = h.room_create("host0001", 4)
    code = rc["code"]
    assert code == "ROOM01" and rc["map"] == "huoyanshan" and rc["ticket"]
    assert f"?versus={code}" in rc["link"]
    # 房间记录进 Redis（含 host_uid/ticket/map），并设了 PEXPIRE 兜底（pttl>0）
    room = h.r.hgetall(k("room", code))
    assert room["host_uid"] == "host0001" and room["ticket"] == rc["ticket"] and room["map"] == "huoyanshan"
    assert h.r.pttl(k("room", code)) > 0
    # 房主 tk 进 Redis（带 room 标记），但不 ZADD q/qall（私房不进随机池）
    assert h.r.hget(k("tk", rc["ticket"]), "room") == code
    assert h.r.zscore(k("qall"), rc["ticket"]) is None
    assert h.r.zscore(k("q", 4), rc["ticket"]) is None
    # 房主 poll 仍等待（私房挂起，poll 见 tk 无 tm → waiting）
    assert h.poll(rc["ticket"])["status"] == "waiting"
    # C1.5：不再落进程内 self.rooms/self.queue（房间态全在 Redis）
    assert h.rooms == {} and h.queue == {}


def test_room_join_matches_and_cleans_redis():
    # room_join 读 Redis 房间 + 房主 tk 成局；成局后 DEL 房间记录 + DEL 房主 tk（无泄漏）；房主 poll 同 mid matched。
    from rediskv import k
    h = _redis_hub()
    rc = h.room_create("host0001", 4)
    code = rc["code"]; host_ticket = rc["ticket"]
    rj = h.room_join(code, "guest001", 7)
    assert rj["status"] == "matched"
    payload = rj["matchStart"]
    assert payload["map"] == "huoyanshan" and payload["seed"] and "opponent" in payload
    mid = payload["matchId"]
    # 成局后：房间记录 + 房主 tk 都从 Redis 删除（不再靠 PEXPIRE 兜底放任泄漏）
    assert h.r.exists(k("room", code)) == 0
    assert h.r.exists(k("tk", host_ticket)) == 0
    # 轻量对局记录写入 Redis；房主 poll（用房主 ticket）也 matched，且同一 mid
    assert h.r.exists(k("match", mid)) == 1
    ph = h.poll(host_ticket)
    assert ph["status"] == "matched" and ph["matchStart"]["matchId"] == mid
    # 单实例 owner：进程内运行时也建了（供 ws_*）
    assert mid in h.matches


def test_room_join_unknown_code_returns_room_not_found():
    # Redis 无 room:{code} → room_not_found
    h = _redis_hub()
    assert h.room_join("NOSUCH", "guest001", 3).get("error") == "room_not_found"


def test_room_join_expired_host_ticket_returns_room_expired():
    # 房间记录尚在但房主 tk 已过期（被清）→ room_expired
    from rediskv import k
    h = _redis_hub()
    rc = h.room_create("host0001", 4)
    h.r.delete(k("tk", rc["ticket"]))            # 模拟房主 tk 过期/被清
    assert h.room_join(rc["code"], "guest001", 7).get("error") == "room_expired"


# ---------------------------------------------------------------- C1.6 惰性清理 _sweep ----
def test_sweep_removes_orphan_ticket_from_both_zsets():
    # M3 修复：tk PEXPIRE 过期/被删后，qall 与 q:{rank} 里残留的 ZSET 成员都应被惰性清
    # （EXISTS tk==0 → 双 ZSET ZREM）。旧 _reap 只扫 qall + _drop_ticket 读不到 rank → q:{rank} 孤儿残留。
    from api_versus import REAP_INTERVAL_MS
    from rediskv import k
    h = _redis_hub()
    t = h.enqueue("u1", 3)["ticket"]
    assert h.r.zscore(k("qall"), t) is not None
    assert h.r.zscore(k("q", 3), t) is not None
    h.r.delete(k("tk", t))                       # 模拟 tk PEXPIRE 过期：ZSET 成员成孤儿
    h._clock["ms"] += REAP_INTERVAL_MS + 1       # 越过 reap 闸门
    h.poll("bogus")                              # 任意 poll 触发锁内 _reap → _sweep
    assert h.r.zscore(k("qall"), t) is None      # qall 孤儿已清
    assert h.r.zscore(k("q", 3), t) is None      # q:{rank} 孤儿也清（M3 gap 修复点）


def test_sweep_removes_timed_out_ticket():
    # 逻辑超时清：tk 仍在（PEXPIRE 是真实时间，逻辑时钟推进不触发它），但入队超 QUEUE_TTL_MS
    # → _drop_ticket 删 tk + 两个 ZSET。clock-independent 判定，不依赖真实过期。
    from api_versus import QUEUE_TTL_MS, REAP_INTERVAL_MS
    from rediskv import k
    h = _redis_hub()
    t = h.enqueue("u1", 5)["ticket"]
    assert h.r.exists(k("tk", t)) == 1
    h._clock["ms"] += QUEUE_TTL_MS + REAP_INTERVAL_MS + 1
    h.poll("bogus")                              # 触发锁内 _reap → _sweep 逻辑超时分支
    assert h.r.exists(k("tk", t)) == 0
    assert h.r.zscore(k("qall"), t) is None
    assert h.r.zscore(k("q", 5), t) is None


# ---------------------------------------------------------------- 自匹配防护（同 uid 不成对） ----
def test_choose_pair_excludes_same_uid():
    # _choose_pair 纯计算：两侧必须不同 uid。同一玩家多张 ticket（匹配中刷新/连点残留）绝不能配到一起。
    h = _redis_hub()
    now = 1_000_000
    def w(tk, uid, rank, past_hold=True):
        return {"ticket": tk, "uid": uid, "rank": rank,
                "enqueued_ms": now, "hold_until_ms": now - 1 if past_hold else now + 10_000}
    # 同 uid 两张、同段位 → 第一趟无跨 uid 搭档，第二趟也被 uid 守卫挡下 → None
    assert h._choose_pair([w("t1", "u1", 3), w("t2", "u1", 3)], now) is None
    # 同 uid 两张、跨段位且过 hold → 第二趟放宽仍不成对 → None
    assert h._choose_pair([w("t1", "u1", 3), w("t2", "u1", 9)], now) is None
    # 混合：u1 两张 + u2 一张（同段位）→ 选到 (u1, u2)，绝不选 (u1, u1)
    pair = h._choose_pair([w("t1", "u1", 3), w("t2", "u1", 3), w("t3", "u2", 3)], now)
    assert pair is not None
    a, b, _ = pair
    assert {a["uid"], b["uid"]} == {"u1", "u2"}


def test_same_uid_reenqueue_dedups_no_self_match():
    # 同一 uid 因「匹配中刷新/连点」二次入队：enqueue 先丢弃其旧 ticket，队列只剩一张 → 不会自匹配。
    from rediskv import k
    h = _redis_hub()
    t1 = h.enqueue("u1", 3)["ticket"]
    assert h.poll(t1)["status"] == "waiting"
    t2 = h.enqueue("u1", 3)["ticket"]            # 同 uid 再入队（模拟刷新后重新匹配）
    assert t2 != t1
    assert h.r.exists(k("tk", t1)) == 0          # 旧票已被去重丢弃
    assert h.poll(t1)["status"] == "timeout"     # 旧票查不到
    assert h.poll(t2)["status"] == "waiting"     # 新票仍在等待——没有把自己配给自己
    # 另一个真实玩家进来才成局，且是 u1 对 u2（不同 uid）
    t3 = h.enqueue("u2", 3)["ticket"]
    p3 = h.poll(t3)
    assert p3["status"] == "matched"
    p2 = h.poll(t2)
    assert p2["status"] == "matched"
    assert p2["matchStart"]["matchId"] == p3["matchStart"]["matchId"]  # 同一局：u1 vs u2


# ---------------------------------------------------------------- Task 4：断线致败免扣段位 ----
# _set_result 在 TangsengDead 判负时，若「胜方」不在场（已断线未恢复/全程未连），把负方 reason 改成
# selfTangsengDeadOppGone（前端据此免扣段位，反滥用：对手跑路不该偷段位）。胜方在线则仍 selfTangsengDead。
def _mk_match(h, ua="A1", ub="B1", rank=3):
    # 直连成局（跳过 enqueue/poll 的 DB 读），返回 (mid, match_dict)。a=负方、b=胜方 供下列断言取用。
    e1 = {"uid": ua, "rank": rank, "ticket": "tA"}
    e2 = {"uid": ub, "rank": rank, "ticket": "tB"}
    mid = h._make_match(e1, e2, h._now())
    return mid, h.matches[mid]


def test_tangsengdead_winner_disconnected_is_penalty_free():
    # 胜方(b)刚断线(gone_ms 已置、曾连过)，此刻负方(a)唐僧被吃 → 负方 reason=selfTangsengDeadOppGone（免扣）。
    h = _redis_hub()
    _mid, m = _mk_match(h)
    m["b"]["connected_ever"] = True
    m["b"]["gone_ms"] = h._now()                 # 胜方处于断线宽限中（未恢复）
    h._set_result(m, "a", "TangsengDead", h._now())
    assert m["result"]["a"] == {"outcome": "lose", "reason": "selfTangsengDeadOppGone"}
    assert m["result"]["b"] == {"outcome": "win", "reason": "opponentTangsengDead"}  # 胜方 reason 不变


def test_tangsengdead_winner_never_connected_is_penalty_free():
    # 胜方(b)全程未连接(connected_ever=False，撮合后跑路) → 同样免扣（selfTangsengDeadOppGone）。
    h = _redis_hub()
    _mid, m = _mk_match(h)
    m["a"]["connected_ever"] = True              # 负方在场
    # m["b"]["connected_ever"] 保持建局默认 False、gone_ms=0
    h._set_result(m, "a", "TangsengDead", h._now())
    assert m["result"]["a"]["reason"] == "selfTangsengDeadOppGone"


def test_tangsengdead_winner_connected_deducts_normally():
    # 对照：胜方(b)在线（曾连过、当前 gone_ms=0）→ 负方 reason 仍 selfTangsengDead（正常扣减，堵刷新逃负）。
    h = _redis_hub()
    _mid, m = _mk_match(h)
    m["b"]["connected_ever"] = True
    m["b"]["gone_ms"] = 0                         # 在线
    h._set_result(m, "a", "TangsengDead", h._now())
    assert m["result"]["a"]["reason"] == "selfTangsengDead"
    assert m["result"]["b"]["reason"] == "opponentTangsengDead"


def test_surrender_winner_disconnected_unaffected():
    # 守卫：免扣只作用于 TangsengDead。认输(Surrender)即便胜方断线，负方 reason 仍 selfSurrender（不改写）。
    h = _redis_hub()
    _mid, m = _mk_match(h)
    m["b"]["connected_ever"] = True
    m["b"]["gone_ms"] = h._now()                 # 胜方断线
    h._set_result(m, "a", "Surrender", h._now())
    assert m["result"]["a"]["reason"] == "selfSurrender"
