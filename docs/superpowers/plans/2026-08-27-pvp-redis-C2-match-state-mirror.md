# PvP Milestone C2 — 对局态镜像 Redis + 懒认领/接管 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把活跃对局的完整运行时状态镜像到 Redis（owner 实例节流写），并让 `ws_hello` 在本实例缺该局时从 Redis 懒加载重建（跨实例接管），彻底取代 B-core 的 MariaDB `pvp_active_match` flush/load。

**Architecture:** 沿用 C 设计 §6「方1a」。每个 server 实例只 flush 自己 `self.matches`（即它 own 的局）到 `xy:pvp:mstate:{mid}`；不做跨实例的 `DELETE NOT IN` 对账（那会误删别实例的活跃局）——清理改由「终局同步删 mstate」+ 每次写带 `PEXPIRE MATCH_REAP_MS` 兜底。`ws_hello` 命中本实例内存 → 老路径；未命中 → 从 Redis `mstate` 懒重建并接管 owner。复用现成的模块级纯函数 `_serialize_match`/`_deserialize_match`（只换存储介质，不改语义）。

**Tech Stack:** Python 3（stdlib ThreadingHTTPServer）、redis-py 同步客户端（`rediskv.k`/`make_client`）、`json`、pytest + `fakeredis`（`FakeServer` 共享后端模拟「同一 Redis、两个 server 实例」）、真 MariaDB（XY_DB_PORT=3308，仅 `pvp_results`/`db` 夹具用）。

**关键前提与边界（实现者必读）：**
- 所有 Redis key 必须走 `rediskv.k(...)`（`xy:pvp:` 前缀）——该 Redis 与其它项目共享，严禁裸 key。
- 两个 Redis key 各司其职、生命周期不同，**都保留**：
  - `match:{mid}`（C1，HASH `{seed,map,start_at_ms,uid_a,uid_b}`）：成局时写、任意实例的 `poll`/`_match_start_payload` 读、`PEXPIRE MATCH_REAP_MS`。**本计划不动它。**
  - `mstate:{mid}`（C2，STRING = `json.dumps({state, ticket_a, ticket_b})`）：owner 节流写、`ws_hello` 懒认领读、`PEXPIRE MATCH_REAP_MS`、终局同步删。**本计划新增。**
- `_serialize_match`/`_deserialize_match` 是 `server/api_versus.py` 模块级函数（非方法），可原样复用。`_deserialize_match` 已负责：`int()` 键、`ws_send=None`、`gone_ms=now`、`created_ms=now`、`last_tick_ms=now`、`connected_ever` 恢复持久化值（不覆盖）。
- 已接受的边界（写进 C spec §6，不在本计划兜）：owner 建局后在首次 flush（默认间隔 5s）之前即崩溃 → 另一实例上无 `mstate` → 重连方 `ws_hello` 得 `bad_hello` → 客户端重新匹配。此窗口 ≤ 一个 flush 周期且多半仍在 `START_DELAY` 内，可接受。真·故障接管/再均衡是 C4。
- server 端并发纪律不变：`_flush_lock` 串行化整个 flush；`self.lock` 内做内存快照 + `json.dumps`；**Redis 写在 `self.lock` 之外**。终局路径（`_set_result`/`_set_draw`）本就在 `self.lock` 内做 `_persist_result`（MariaDB 写），故其中新增一次 Redis `DEL` 与既有纪律一致（低频、每局一次）。

---

## File Structure

- **`server/api_versus.py`**（修改）
  - 重写 `flush_active_matches`（MariaDB → Redis `mstate`，去掉跨表对账 `DELETE NOT IN`）。
  - 新增 `_load_match_from_redis(mid, now)`（懒认领：从 `mstate` 重建整局 + 恢复 `ticket_match`）。
  - `ws_hello` 未命中分支挂懒加载。
  - 新增 `_forget_match_state(mid)`（终局/回收同步删 `mstate`）；在 `_set_result`/`_set_draw`/`_reap` 调它。
  - 删除 `load_active_matches`（Task 2）。
  - C1 遗留 nit（Task 2）：`cancel` 补 `_require_redis()`；`_reap` 删死 rooms 分支。
- **`server/server.py`**（修改，Task 2）：删启动时的全量回放 `load_active_matches()`（改懒加载）；保留周期 flush 守护线程与 SIGTERM 优雅 flush（内部已切 Redis）。
- **`server/db.py`**（修改，Task 2）：从 `SCHEMA` 删除 `pvp_active_match` 建表串。
- **`server/tests/test_versus_persist.py`**（修改）：`rhub` 夹具改用共享 `FakeServer`；加 `_reopen` 助手；新增 C2 单测；把 3 个「回放」测试从 `load_active_matches` 改成懒 `ws_hello`；删 MariaDB 专属的 `test_flush_reconciles_deletes_ended_and_absent` 与 `test_migrate_creates_pvp_active_match`（Task 2）。

---

## Task 1: Redis 对局态镜像 + 懒认领接管（介质切换）

一次原子完成「flush 写 Redis + ws_hello 懒加载 + 终局删态」，并把所有依赖旧 MariaDB 往返的测试改到懒模型。完成后服务端不再向 `pvp_active_match` 写入，重连恢复全走 Redis。

**Files:**
- Modify: `server/api_versus.py`（`flush_active_matches` ~838-889；新增 `_load_match_from_redis`；`ws_hello` ~662-682；新增 `_forget_match_state`；`_set_result` ~509-521；`_set_draw` ~523-528；`_reap` 的 pop 循环 ~295-298）
- Test: `server/tests/test_versus_persist.py`（`rhub` 夹具 ~107-117；新增助手/测试；改 ~123-138、~167-181、~219-244；删 ~140-147）

- [ ] **Step 1: 改 `rhub` 夹具为共享 `FakeServer` 并加 `_reopen` 助手（先落测试基建）**

把 `server/tests/test_versus_persist.py` 里现有的 `rhub` 夹具（约 107-117 行）替换为下面版本，并在其后紧接着加入 `_reopen` 助手（`_mk` 助手保持不变）：

```python
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
```

- [ ] **Step 2: 写失败测试——flush 写 mstate + 带 TTL + 跳过终局**

在 `server/tests/test_versus_persist.py` 末尾追加：

```python
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
    assert "ws_send" not in blob["state"]["a"]        # 序列化剔 ws_send
    assert blob["ticket_a"] == "t_F1" and blob["ticket_b"] == "t_F2"


def test_mstate_has_ttl(rhub):
    from rediskv import k
    mid = _mk(rhub, "T1", "T2")
    rhub.flush_active_matches()
    assert rhub.r.pttl(k("mstate", mid)) > 0          # PEXPIRE 兜底：owner 崩了自动过期


def test_flush_skips_ended_match(rhub):
    from rediskv import k
    mid = _mk(rhub, "S1", "S2")
    rhub.ws_status("S1", mid, "surrender")            # 终局
    rhub.flush_active_matches()                        # 不得把已终局的 mstate 写回
    assert not rhub.r.exists(k("mstate", mid))
```

- [ ] **Step 3: 运行确认失败**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_flush_writes_mstate_to_redis tests/test_versus_persist.py::test_mstate_has_ttl -v`
Expected: FAIL（`get(k("mstate",...))` 为 None——旧 flush 只写 MariaDB）

- [ ] **Step 4: 重写 `flush_active_matches`（MariaDB → Redis mstate）**

用下面整段替换 `server/api_versus.py` 现有的 `flush_active_matches`（约 838-889 行，即到 `load_active_matches` 定义之前为止；`load_active_matches` 本任务保留、Task 2 再删）：

```python
    def flush_active_matches(self) -> None:
        """把本实例持有的未终局对局镜像进 Redis mstate:{mid}（懒认领/接管的数据源）。
        C2：取代 B-core 的 MariaDB pvp_active_match。多实例下每实例只 flush 自己 self.matches
        （即它 own 的局），故**不做**跨实例的「DELETE NOT IN」对账（会误删别实例的活跃局）；
        清理靠「终局同步删 mstate（_forget_match_state）」+ 每次写带 PEXPIRE MATCH_REAP_MS 兜底
        （owner 崩溃则状态到点自动过期，与 match:{mid} 轻量记录同寿）。
        并发纪律沿用 B-core：_flush_lock 串行化整个 flush（与周期 flush / SIGTERM flush 互斥）、
        self.lock 内做内存快照 + json.dumps、Redis 写在锁外。self.r 为 None（纯内存 ws 测试 hub）直接跳过。"""
        if self.r is None:
            return
        with self._flush_lock:
            with self.lock:
                snap = []
                for mid, m in self.matches.items():
                    if m.get("ended"):
                        continue
                    # 逐局 try/except：单局序列化抛错只跳过该局，不中断整轮 flush。
                    try:
                        tks = {u: t for t, (mm, u) in self.ticket_match.items() if mm == mid}
                        blob = json.dumps({
                            "state": _serialize_match(m),
                            "ticket_a": tks.get(m["a"]["uid"]),
                            "ticket_b": tks.get(m["b"]["uid"]),
                        }, ensure_ascii=False)
                        snap.append((mid, blob))
                    except Exception:
                        logging.exception("pvp mstate 单局快照失败 match_id=%s，跳过", mid)
            # 锁外做 Redis 写（pipeline 批量 SET + PEXPIRE）；失败仅记日志，下轮 flush 自愈。
            try:
                pipe = self.r.pipeline(transaction=False)
                for mid, blob in snap:
                    pipe.set(k("mstate", mid), blob)
                    pipe.pexpire(k("mstate", mid), MATCH_REAP_MS)
                pipe.execute()
            except Exception:
                logging.exception("pvp mstate flush 失败（不影响对局，下轮重试）")
```

- [ ] **Step 5: 运行确认 Step 2 的三个测试通过（skips_ended 依赖 Step 8 的删态，先只验前两个）**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_flush_writes_mstate_to_redis tests/test_versus_persist.py::test_mstate_has_ttl -v`
Expected: PASS（`test_flush_skips_ended_match` 会在 Step 8 删态实现后才全绿——现在它可能因 mstate 残留而失败，属预期，下面步骤补齐）

- [ ] **Step 6: 写失败测试——ws_hello 懒加载重建 + 恢复 ticket + 无态回 bad_hello**

在测试文件末尾追加：

```python
def test_flush_then_lazy_load_restores_match_and_tickets(rhub):
    from rediskv import k
    mid = _mk(rhub, "P1", "P2")
    rhub.flush_active_matches()
    assert rhub.r.exists(k("mstate", mid))
    h2 = _reopen(rhub.db, rhub._redis_server, 2_000_000)
    assert mid not in h2.matches                       # 懒模式：ws_hello 前本实例无此局
    sent = []
    res = h2.ws_hello("P1", mid, lambda t: (sent.append(t), True)[1])
    assert "error" not in res
    assert mid in h2.matches                           # ws_hello 触发从 Redis 重建
    assert h2.matches[mid]["a"]["uid"] == "P1" and h2.matches[mid]["b"]["uid"] == "P2"
    assert h2.ticket_match.get("t_P1") == (mid, "P1")  # ticket 一并恢复
    assert h2.ticket_match.get("t_P2") == (mid, "P2")
    assert h2.matches[mid]["a"]["ws_send"] is not None
    assert h2.matches[mid]["a"]["gone_ms"] == 0


def test_ws_hello_bad_hello_when_no_redis_state(rhub):
    # 本实例无该局、Redis 也无 mstate（如 owner 首 flush 前即崩）→ bad_hello，客户端重新匹配。
    res = rhub.ws_hello("Z1", "deadbeefdeadbeef", lambda t: True)
    assert res.get("error") == "bad_hello"
```

- [ ] **Step 7: 运行确认失败**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_flush_then_lazy_load_restores_match_and_tickets -v`
Expected: FAIL（`mid not in h2.matches` 后 `ws_hello` 返回 `bad_hello`——懒加载尚未实现）

- [ ] **Step 8: 实现 `_load_match_from_redis` + `ws_hello` 挂钩 + `_forget_match_state` + 终局/回收删态**

**(a)** 在 `server/api_versus.py` 里 `_deserialize_match` 已可用的前提下，于 `flush_active_matches` 附近新增两个方法：

```python
    def _load_match_from_redis(self, mid: str, now: int) -> Optional[dict]:
        """懒认领：本实例 self.matches 无此局时，从 Redis mstate:{mid} 重建整局运行时并接管 owner。
        C2/C3：反代按 matchId 一致性哈希把两端路由到同一实例，owner 崩溃/发版后重连会落到接管实例，
        此处从 Redis 恢复运行时（ws_send=None、gone_ms=now，等重连方在 ws_hello 里挂 send/清零）。
        无记录/解析失败/已终局 → None（ws_hello 据此回 bad_hello）。self.r 为 None 直接 None。"""
        if self.r is None:
            return None
        raw = self.r.get(k("mstate", mid))
        if not raw:
            return None
        try:
            blob = json.loads(raw)
            m = _deserialize_match(blob["state"], now)
        except Exception:
            logging.exception("pvp mstate 解析失败 match_id=%s", mid)
            return None
        if m.get("ended"):
            self.r.delete(k("mstate", mid))            # 终局残留（正常应已删/过期）：清掉，不复活
            return None
        self.matches[mid] = m
        ta, tb = blob.get("ticket_a"), blob.get("ticket_b")
        if ta:
            self.ticket_match[ta] = (mid, m["a"]["uid"])
        if tb:
            self.ticket_match[tb] = (mid, m["b"]["uid"])
        return m

    def _forget_match_state(self, mid: str) -> None:
        """终局/回收时同步删 Redis mstate，避免终局后 TTL 窗口内被重连「复活」成活跃局。
        幂等；失败仅记日志（不影响终局落库）。self.r 为 None 直接返回。"""
        if self.r is None:
            return
        try:
            self.r.delete(k("mstate", mid))
        except Exception:
            logging.exception("pvp mstate 删除失败 match_id=%s", mid)
```

**(b)** 修改 `ws_hello`（约 662-682 行）：把「取本实例内存 match」那两三行改成下面（其余方法体不变）：

```python
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if m is None:                              # C2：本实例没有 → 尝试从 Redis 懒认领接管
                m = self._load_match_from_redis(match_id, now)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return {"error": "bad_hello"}
            me, opp = self._sides(m, uid)
            self._ws_check_gone_locked(m, now)         # 顺便惰性检查对手宽限超时
            me["ws_send"] = send
            me["gone_ms"] = 0                          # 重连清零，恢复在线
            me["connected_ever"] = True                # 标记该侧至少连过一次（撮合退队据此豁免）
            me["last_tick_ms"] = now                   # 刷 liveness，防 IDLE_REAP 中途回收
            me["last_next_wave"] = None                # 清零去重标记，重连后首快照重新宣告 nextWave
            return {"serverMs": now}
```

**(c)** 在 `_set_result`（约 509-521 行）末尾、`self._persist_result(m, now)` 之后加一行：

```python
        self._persist_result(m, now)
        self._forget_match_state(m["match_id"])        # C2：终局同步删 Redis mstate，防 TTL 窗口内被复活
```

**(d)** 在 `_set_draw`（约 523-528 行）末尾、`self._persist_result(m, now)` 之后加一行：

```python
        self._persist_result(m, now)
        self._forget_match_state(m["match_id"])        # C2：同 _set_result
```

**(e)** 在 `_reap`（约 295-298 行）的 pop 循环里，把状态删除接上：

```python
        for mid in dead:
            self.matches.pop(mid, None)
            self._forget_match_state(mid)              # C2：连带清 Redis mstate（终局残留/废弃局）
            for tk in [t for t, (mm, _u) in list(self.ticket_match.items()) if mm == mid]:
                self.ticket_match.pop(tk, None)
```

- [ ] **Step 9: 写失败测试——终局同步删 mstate**

在测试文件末尾追加：

```python
def test_end_deletes_redis_mstate(rhub):
    from rediskv import k
    mid = _mk(rhub, "E1", "E2")
    rhub.flush_active_matches()
    assert rhub.r.exists(k("mstate", mid))
    rhub.ws_status("E1", mid, "surrender")             # 终局 → _set_result → _forget_match_state
    assert not rhub.r.exists(k("mstate", mid))
```

- [ ] **Step 10: 运行确认 Task 1 新增测试全绿**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_flush_writes_mstate_to_redis tests/test_versus_persist.py::test_mstate_has_ttl tests/test_versus_persist.py::test_flush_skips_ended_match tests/test_versus_persist.py::test_flush_then_lazy_load_restores_match_and_tickets tests/test_versus_persist.py::test_ws_hello_bad_hello_when_no_redis_state tests/test_versus_persist.py::test_end_deletes_redis_mstate -v`
Expected: PASS（全部 6 个）

- [ ] **Step 11: 改造 3 个旧「回放」测试到懒模型（替换 MariaDB `load_active_matches` 往返）**

**(a)** 把 `test_flush_then_load_restores_match_and_tickets`（约 123-138 行）**整段删除**（已被 Step 6 的 `test_flush_then_lazy_load_restores_match_and_tickets` 取代）。

**(b)** 把 `test_reload_preserves_connected_ever_so_resumed_match_not_reaped_at_connect_grace`（约 167-181 行）整段替换为：

```python
def test_reload_lazy_preserves_connected_ever(rhub):
    from api_versus import MATCH_CONNECT_GRACE_MS, REAP_INTERVAL_MS
    mid = _mk(rhub, "R1", "R2")
    rhub.ws_hello("R1", mid, lambda t: True)           # 仅 R1(side a) 连过 → connected_ever=True
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 5_000_000)
    h2.ws_hello("R2", mid, lambda t: True)             # side b 触发懒加载（不碰 side a）
    # side a 从未在 h2 上 hello，其 connected_ever=True 必须经 flush→reload 存活
    assert h2.matches[mid]["a"]["connected_ever"] is True
    # 因此即便再过撮合宽限也不被 20s「从未连接」分支秒删
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + REAP_INTERVAL_MS + 1
    h2.poll("bogus")                                    # 触发 _reap
    assert mid in h2.matches
```

**(c)** 把 `test_reload_opponent_no_show_present_side_wins`（约 219-244 行）整段替换为：

```python
def test_reload_lazy_opponent_no_show_present_side_wins(rhub):
    # I1 路径回归：打空气判胜在「懒加载恢复的对局」上也成立（在场方重连后过撮合宽限即判胜）。
    from api_versus import MATCH_CONNECT_GRACE_MS
    import json
    mid = _mk(rhub, "PW1", "PW2")
    rhub.ws_hello("PW1", mid, lambda t: True)          # PW1 连过(connected_ever=True)；PW2 从未连接
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 9_000_000)
    sent = []
    res = h2.ws_hello("PW1", mid, lambda t: (sent.append(t), True)[1])  # 懒加载重建
    assert "error" not in res
    assert h2.matches[mid]["a"]["connected_ever"] is True   # 经 flush→lazy 保留
    assert h2.matches[mid]["b"]["connected_ever"] is False  # 对手从未连接
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    h2.ws_snap("PW1", mid, {"type": "snap", "t": 1, "s": base})
    m = h2.matches[mid]
    assert m["ended"] is True
    assert m["result"]["a"]["outcome"] == "win"
    assert m["result"]["a"]["reason"] == "opponentDisconnectTimeout"
    assert "result" in [json.loads(t).get("type") for t in sent]
```

- [ ] **Step 12: 删除 MariaDB 专属的对账测试**

把 `test_flush_reconciles_deletes_ended_and_absent`（约 140-147 行）**整段删除**——它断言的是 `pvp_active_match` 行删除，语义已由 Step 9 的 `test_end_deletes_redis_mstate`（终局同步删 Redis mstate）取代。
（`test_migrate_creates_pvp_active_match` 留到 Task 2 随建表删除一起删。）

- [ ] **Step 13: 跑整份持久化测试确认全绿**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py -v`
Expected: PASS（`test_migrate_creates_pvp_active_match` 仍在且通过——表尚未删；其余全绿）

- [ ] **Step 14: 跑服务端全量测试确认无回归**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest -q`
Expected: PASS（全绿；对照 C1 基线 131 绿，本任务净增/改若干持久化用例）

- [ ] **Step 15: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(server): PvP C2 对局态镜像 Redis mstate + ws_hello 懒认领接管，取代 MariaDB flush/load"
```

---

## Task 2: 退役 B-core MariaDB 持久化路径 + C1 遗留 nit 清理

Task 1 后服务端已不再写/读 `pvp_active_match`。本任务删掉死代码（方法、建表、启动全量回放）、把 server.py 启动切到懒模型，并顺手清 C1 评审遗留的两个小 nit。

**Files:**
- Modify: `server/api_versus.py`（删 `load_active_matches` ~890-915；`cancel` ~396-399 补守卫；`_reap` 死 rooms 分支 ~302-306）
- Modify: `server/server.py`（启动全量回放 ~151-154）
- Modify: `server/db.py`（`pvp_active_match` 建表 ~113-126）
- Test: `server/tests/test_versus_persist.py`（删 `test_migrate_creates_pvp_active_match` ~33-36）

- [ ] **Step 1: 删 `load_active_matches` 方法**

在 `server/api_versus.py` 删除整段 `load_active_matches`（约 890-915 行，即 Task 1 重写后的 `flush_active_matches` 之后那段 MariaDB 回放方法）。删除后确认文件内已无 `pvp_active_match` 字样。

- [ ] **Step 2: server.py 启动切懒模型（删全量回放）**

把 `server/server.py` 约 151-154 行：

```python
    BoundHandler.versus = VersusHub(db, redis_client=make_client(cfg))   # 进程内 PvP 单例：匹配/私房/波次/终局/反作弊（WS 快照模型，HTTP tick 已退役）。匹配层共享态经注入的 Redis（enqueue/poll/撮合硬依赖 self.r）
    hub = BoundHandler.versus
    restored = hub.load_active_matches()          # 启动回放：把上次未终局对局读回内存
    print(f"pvp active matches restored: {restored}", flush=True)
```

改为：

```python
    BoundHandler.versus = VersusHub(db, redis_client=make_client(cfg))   # 进程内 PvP 单例：匹配/私房/波次/终局/反作弊（WS 快照模型，HTTP tick 已退役）。匹配层共享态经注入的 Redis（enqueue/poll/撮合硬依赖 self.r）
    hub = BoundHandler.versus
    # C2：对局态懒认领——不再启动时全量回放；重连经 ws_hello 按需从 Redis mstate 重建（跨实例接管）。
    # 周期 flush 守护线程 + SIGTERM 优雅 flush（下方）把本实例 own 的活跃局节流镜像进 Redis。
```

（周期 flush 线程与 `_graceful` 保持不变：它们仍调 `hub.flush_active_matches()`，其内部 Task 1 已切 Redis。）

- [ ] **Step 3: db.py 删 `pvp_active_match` 建表**

在 `server/db.py` 的 `SCHEMA` 列表里删除 `pvp_active_match` 那一条（约 113-126 行：包含其上方 113-116 的注释与 117-126 的 `CREATE TABLE ... pvp_active_match ...` 字符串整条）。保留相邻的 `pvp_results`、`pvp_anomaly`。

- [ ] **Step 4: 删 migrate 测试**

在 `server/tests/test_versus_persist.py` 删除 `test_migrate_creates_pvp_active_match`（约 33-36 行，`SHOW TABLES`/断言 `pvp_active_match` 存在的那个）。

- [ ] **Step 5: C1 nit①——`cancel` 补 `_require_redis()` 守卫**

把 `server/api_versus.py` 的 `cancel`（约 396-399 行）：

```python
    def cancel(self, ticket: str) -> dict:
        with self.lock:
            self._drop_ticket(ticket)
            return {"ok": True}
```

改为（与 `enqueue`/`poll` 一致，漏注入 Redis 时 fail-fast 而非裸 NoneType）：

```python
    def cancel(self, ticket: str) -> dict:
        self._require_redis()
        with self.lock:
            self._drop_ticket(ticket)
            return {"ok": True}
```

- [ ] **Step 6: C1 nit②——删 `_reap` 死 rooms 分支**

C1.5 起房间记录已迁 Redis（`room:{code}`），`self.rooms` 恒空，`_reap` 尾部的 rooms 清扫分支是 no-op。删除 `server/api_versus.py` 约 302-306 行（302-304 的解释注释 + 305-306 的 `for code in [...]: self.rooms.pop(...)` 循环）。删后 `_reap` 以 `self._sweep(now)` 结束。

- [ ] **Step 7: 跑服务端全量测试**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && XY_DB_PORT=3308 python -m pytest -q`
Expected: PASS（`test_migrate_creates_pvp_active_match` 已删；其余全绿）

- [ ] **Step 8: 冒烟——确认服务端能 import & 启动构造无误**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2/server && python -c "import server, api_versus, db; print('import ok')"`
Expected: 打印 `import ok`（无 `NameError`/`AttributeError`——确认删 `load_active_matches`/rooms 分支后无悬空引用）

- [ ] **Step 9: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-redis-c2
git add server/api_versus.py server/server.py server/db.py server/tests/test_versus_persist.py
git commit -m "chore(server): 退役 PvP MariaDB pvp_active_match 持久化（改 Redis 懒加载）+ 清 C1 遗留 nit"
```

---

## Self-Review（写完计划的自查）

**1. Spec 覆盖（对照 C spec §6 与遗留缺口）：**
- 「owner 节流镜像整局态到 Redis」→ Task 1 Step 4（`flush_active_matches` 写 `mstate` + PEXPIRE）。✅
- 「ws_hello 懒认领重建 runtime」→ Task 1 Step 8（`_load_match_from_redis` + ws_hello 挂钩）。✅
- 「取代 B-core MariaDB flush/load」→ Task 1（flush 改 Redis）+ Task 2（删 load/建表/启动回放）。✅
- 「多实例 ws_hello 缺口：poll 在别实例返回 matched → WS 落非 owner → bad_hello」→ 本计划让非 owner 实例能从 Redis 懒重建接管（Step 8）；真正把两端路由到同一实例是 C3 反代一致性哈希（不在本计划）。✅（缺口的服务端侧补齐；路由侧留 C3）
- 「终局清态」→ Task 1 Step 8(c)(d)(e)（`_forget_match_state`）。✅
- C1 遗留 nit（cancel 守卫、_reap 死 rooms 分支）→ Task 2 Step 5/6。✅

**2. Placeholder 扫描：** 每个改代码步骤均给出完整可粘贴代码与确切命令/期望；无 TBD/TODO/「类似上文」。✅

**3. 类型/命名一致性：**
- Redis key：`k("mstate", mid)` 全程一致（flush 写、load 读、forget 删、TTL）。`k("match", mid)`（C1 轻量记录）本计划不触碰。✅
- 新方法名：`_load_match_from_redis`、`_forget_match_state` 前后一致；测试助手 `_reopen`、夹具属性 `_redis_server`/`_clock` 一致。✅
- `mstate` blob 形状 `{"state","ticket_a","ticket_b"}`：flush 写、load 读、`test_flush_writes_mstate_to_redis` 断言三处一致。✅
- 复用 `_serialize_match`/`_deserialize_match`（模块级函数，已在 `flush`/`load` 作用域内可调）；`Optional` 已被 `_match_start_payload` 使用即已 import。✅
- 常量：`MATCH_REAP_MS`（TTL，已存在）、`MATCH_CONNECT_GRACE_MS`/`REAP_INTERVAL_MS`（测试用，已存在）。✅

**4. 绿灯连续性：** Task 1 结束把所有旧回放测试改到懒模型且不再引用 `load_active_matches`（该方法留到 Task 2 删，其间无测试引用、server.py 启动虽仍调用但读空 MariaDB 返回 0，无害）；Task 2 结束删净死代码，全量测试绿。每个 Task 独立可提交、可运行。✅

---

## Execution Handoff

计划已存至 `docs/superpowers/plans/2026-08-27-pvp-redis-C2-match-state-mirror.md`。两种执行方式：

1. **子代理逐任务（推荐）**——每任务派新子代理 + 双阶段评审（先规范符合、再代码质量），任务间我审查、快速迭代。
2. **本会话内联执行**——用 executing-plans，分批执行、检查点审查。

选哪种？
