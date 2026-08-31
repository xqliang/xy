# PvP C4-fencing 实现计划:每局 owner 令牌,防瞬时双 owner 双写/误删 mstate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每局加 `xy:pvp:owner:{mid}` 令牌(= 实例 instance_id);只有当前持令牌的实例能写(flush)/删(`_forget_match_state`)该局 mstate,挡住失去归属的旧 owner 覆盖/误删新 owner 活态。单实例零行为变化。

**Architecture:** 建局(`_queue_match_record`)与懒认领接管(`_load_match_from_redis`)时 SET owner=instance_id;`flush_active_matches` 改逐局 WATCH/MULTI(照搬 `_pair_once`),owner≠我则跳过写;`_forget_match_state` 加 owner GET 守卫,属别人则不删。

**Tech Stack:** Python stdlib(`server/api_versus.py`);pytest + fakeredis + 真 MariaDB(`XY_DB_PORT=3308`)。

**分支:** `worktree-pvp-c4-fencing`(worktree,基于 main f7397b6)。仓库根 `/Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing`。**不 push**。

**现状锚点(探查确认,`server/api_versus.py`):**
- `__init__`(62-83):`self.r`/`self.matches`/`self.lock`,无 instance_id;`secrets` 已导入。
- `_queue_match_record`(167-176):建局往 pipe 写 `match:{mid}`/`tm`,`_make_match`+`_pair_once` 共用。
- `_load_match_from_redis`(943-968):懒认领接管点(`ws_hello`/`forfeit` 都经它),`self.r` 非 None 才进。
- `flush_active_matches`(902-941):写循环当前 `pipeline(transaction=False)` 一把批量,在 `self.lock`+`_flush_lock` 内。
- `_forget_match_state`(970-978):所有 mstate DEL 唯一 choke point。
- WATCH/MULTI idiom:`_pair_once`(230-261);`from redis.exceptions import WatchError`(15);`pipe=self.r.pipeline()`→`watch`→`get`→`unwatch`/`multi`→`execute`,`except WatchError: continue`,`finally: pipe.reset()`。
- `MATCH_REAP_MS = 120_000`(owner key 复用为 TTL)。
- 测试:`rhub`(存 `_redis_server`=FakeServer)、`_reopen(db, srv, start_ms)`、`_mk(hub, ua, ub)` 已存在于 `test_versus_persist.py`。

---

## Task 1:instance_id + 认领 owner + fence `_forget_match_state`

先落"归属"管道与删守卫。此后 owner key 在建局/接管时写入,删受守卫;flush 暂不 fence(Task 2)。

**Files:**
- Modify: `server/api_versus.py`(`__init__` ~62-83;`_queue_match_record` ~167-176;`_load_match_from_redis` ~943-968;`_forget_match_state` ~970-978)
- Test: `server/tests/test_versus_persist.py`(新增 4 个)

- [ ] **Step 1: 写失败测试——建局 claim + 接管改 owner + forget 被 fence + 终局删 owner**

在 `server/tests/test_versus_persist.py` 末尾追加:

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_create_claims_owner -v`
Expected: FAIL(`rhub.instance_id` 不存在 / owner key 未写)

- [ ] **Step 3: `__init__` 加 instance_id**

在 `server/api_versus.py` `__init__` 签名加参数(放在 `redis_client=None` 之后):
```python
                 redis_client=None,
                 instance_id: str | None = None):
```
方法体里 `self.r = redis_client` 之后加:
```python
        # C4-fencing：本进程唯一身份，作每局 owner:{mid} 令牌值；多实例下用于判"我是否仍持有该局"。
        # 默认随机（每进程一个，server.py 无需传）；测试可传定值。
        self.instance_id = instance_id or secrets.token_hex(8)
```

- [ ] **Step 4: `_queue_match_record` 建局 claim owner**

在 `_queue_match_record` 方法体末尾(现有 `pipe.set(k("tm", tk_b), ...)` 那行之后)追加:
```python
        # C4-fencing：建局即认领 owner（与轻量记录同 pipe/事务原子写）。撮合(_pair_once)与直连(_make_match)共用本方法。
        pipe.set(k("owner", mid), self.instance_id); pipe.pexpire(k("owner", mid), MATCH_REAP_MS)
```

- [ ] **Step 5: `_load_match_from_redis` 接管 claim owner**

在 `_load_match_from_redis` 里,恢复 `ticket_match`(`if tb: self.ticket_match[tb] = ...`)之后、`return m` 之前追加:
```python
        # C4-fencing：懒认领即抢占 owner（blind SET，last claim wins）。ws_hello/forfeit 都经此接管。
        self.r.set(k("owner", mid), self.instance_id)
        self.r.pexpire(k("owner", mid), MATCH_REAP_MS)
```

- [ ] **Step 6: `_forget_match_state` 加 owner 守卫 + 删 owner key**

把 `_forget_match_state` 整段替换为:
```python
    def _forget_match_state(self, mid: str) -> None:
        """终局/回收时删 Redis mstate + owner；避免终局后 TTL 窗口内被重连「复活」。
        C4-fencing：加 owner 守卫——owner:{mid} 属别的实例时不删（失去归属的旧 owner 的
        _reap/forfeit 不得删掉新 owner 的活态）；owner 无主或属我 → 删 mstate + owner。
        简单 GET-then-DEL（非事务）：最坏极小窗内多删一次，真 owner 下轮 flush(≤5s)重写 mstate 自愈。
        幂等；失败仅记日志。self.r 为 None 直接返回。"""
        if self.r is None:
            return
        try:
            owner = self.r.get(k("owner", mid))
            if owner is not None and owner != self.instance_id:
                return
            self.r.delete(k("mstate", mid))
            self.r.delete(k("owner", mid))
        except Exception:
            logging.exception("pvp mstate 删除失败 match_id=%s", mid)
```

- [ ] **Step 7: 运行 Task 1 的 4 个测试 + 全量**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_create_claims_owner tests/test_versus_persist.py::test_lazy_load_takes_over_owner tests/test_versus_persist.py::test_stale_owner_forget_is_fenced tests/test_versus_persist.py::test_owner_terminal_deletes_owner_key -v && XY_DB_PORT=3308 python -m pytest -q`
Expected: 4 个新测试 + 全量全绿(现有 C2/C5 测试不受影响:单实例 owner==自己,删照常)。

- [ ] **Step 8: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(server): PvP C4-fencing 加 instance_id + owner 令牌认领 + _forget_match_state owner 守卫"
```

---

## Task 2:fence flush 写(逐局 WATCH/MULTI)

依赖 Task 1 的 owner key 已在建局/接管时写入。把 flush 的批量写改为逐局事务,owner≠我则跳过。

**Files:**
- Modify: `server/api_versus.py`(`flush_active_matches` 写循环 ~934-941)
- Test: `server/tests/test_versus_persist.py`(新增 2 个)

- [ ] **Step 1: 写失败测试——旧 owner flush 被 fence + 单实例照写**

追加:
```python
def test_stale_owner_flush_is_fenced(rhub):
    from rediskv import k
    import json
    mid = _mk(rhub, "S1", "S2")
    rhub.ws_hello("S1", mid, lambda t: True)         # 仅 S1 在旧 owner 上连过
    rhub.flush_active_matches()                      # owner=旧(rhub)
    h2 = _reopen(rhub.db, rhub._redis_server, 2_000_000)
    h2.ws_hello("S2", mid, lambda t: True)           # 新接管 → owner=h2；S2 connected_ever=True
    h2.flush_active_matches()                        # 新写入：b(S2) connected_ever=True
    rhub.flush_active_matches()                      # 旧再 flush → 应被 fence，不得覆盖
    blob = json.loads(rhub.r.get(k("mstate", mid)))
    assert blob["state"]["b"]["connected_ever"] is True   # 新 owner 的版本，未被旧(其 b 从未连)覆盖
    assert rhub.r.get(k("owner", mid)) == h2.instance_id


def test_single_instance_flush_still_writes(rhub):
    from rediskv import k
    mid = _mk(rhub, "U1", "U2")
    rhub.flush_active_matches()
    assert rhub.r.get(k("mstate", mid)) is not None  # fence 恒过（owner==自己）
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_stale_owner_flush_is_fenced -v`
Expected: FAIL(当前 flush 未 fence,旧 owner 覆盖 → `b.connected_ever` 变 False)

- [ ] **Step 3: 改 `flush_active_matches` 写循环为逐局 WATCH/MULTI**

把 `flush_active_matches` 里 `with self.lock:` 内、构建完 `snap` 之后那段写代码(现为 `try: pipe = self.r.pipeline(transaction=False); for mid, blob in snap: pipe.set/pexpire; pipe.execute(); except: log`)整段替换为:
```python
                # C4-fencing：逐局 WATCH/MULTI，只有仍持 owner:{mid} 的实例能写 mstate，
                # 挡住失去归属的旧 owner 覆盖新 owner 活态（照搬 _pair_once 的事务 idiom）。
                # 逐局 try：单局异常只跳过该局，不中断整轮 flush（对齐快照循环的容错）。
                for mid, blob in snap:
                    try:
                        for _ in range(3):                       # WatchError 重试上限
                            pipe = self.r.pipeline()             # transaction=True
                            try:
                                pipe.watch(k("owner", mid))
                                if pipe.get(k("owner", mid)) != self.instance_id:
                                    pipe.unwatch()
                                    break                        # 已不是我 → 跳过，不覆盖新 owner
                                pipe.multi()
                                pipe.set(k("mstate", mid), blob)
                                pipe.pexpire(k("mstate", mid), MATCH_REAP_MS)
                                pipe.pexpire(k("owner", mid), MATCH_REAP_MS)   # 续期 owner，与 mstate 同寿
                                pipe.execute()
                                break
                            except WatchError:
                                continue                         # owner 在事务窗内被改 → 重试（下轮 GET 会跳过）
                            finally:
                                pipe.reset()
                    except Exception:
                        logging.exception("pvp mstate fenced flush 单局失败 match_id=%s，跳过", mid)
```
(保持 `if self.r is None: return`、`with self._flush_lock: with self.lock:`、快照构建循环均不变;仅替换写循环。)

- [ ] **Step 4: 运行 Task 2 测试 + 全量**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_stale_owner_flush_is_fenced tests/test_versus_persist.py::test_single_instance_flush_still_writes -v && XY_DB_PORT=3308 python -m pytest -q`
Expected: 全绿(尤其 C2 的 `test_flush_writes_mstate_to_redis`/`test_flush_then_lazy_load_...`/`test_reload_lazy_*` 仍过——单实例 owner==自己,fenced 写照常;`test_versus.py` 撮合、`test_versus_ws.py` 无回归)。

- [ ] **Step 5: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-c4-fencing
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(server): PvP C4-fencing flush 写 mstate 逐局 WATCH/MULTI 按 owner 令牌 fence"
```

---

## Self-Review

**1. Spec 覆盖:**
- instance_id → Task 1 Step 3。✅
- 建局 claim(`_queue_match_record`,覆盖 `_make_match`+`_pair_once`)→ Task 1 Step 4。✅
- 懒认领接管 claim(`_load_match_from_redis`,覆盖 ws_hello+forfeit)→ Task 1 Step 5。✅
- fence 删(`_forget_match_state` owner 守卫,覆盖 `_reap`+forfeit)→ Task 1 Step 6。✅
- fence 写(flush WATCH/MULTI)→ Task 2 Step 3。✅
- 6 个测试(建局/接管/forget-fence/终局删/flush-fence/单实例)→ Task 1 Step 1 + Task 2 Step 1。✅
- 单实例零行为变化 → owner==自己,`test_single_instance_flush_still_writes` + 全量 C2/C5 回归验证。✅

**2. Placeholder 扫描:** 每步给完整可粘贴代码 + 确切命令;仅"替换写循环"步骤明确指出替换范围与保留部分,非 TBD。

**3. 类型/命名一致性:** `self.instance_id`、`k("owner", mid)`、`MATCH_REAP_MS` 全程一致;WATCH/MULTI 用 `WatchError`(已 import)/`pipe.reset()` 与 `_pair_once` 一致;`decode_responses=True` → GET 返回 str 与 `self.instance_id`(str)直接比较。

**4. 绿灯连续性:** Task 1 落 claim + 删守卫(flush 未改,单实例照常)→ 独立绿;Task 2 依赖 Task 1 的 owner key 存在,再 fence flush → 绿。顺序不可颠倒(先 fence flush 而无 owner key 会让单实例 flush 全跳过)。

---

## Execution Handoff

计划已存 `docs/superpowers/plans/2026-08-31-pvp-c4-fencing.md`。两种执行:
1. **子代理逐任务(推荐)** — 每任务新子代理 + 双阶段评审(规范→质量),任务间审查。
2. **本会话内联执行** — 分批 + 检查点。

选哪种?
