# PvP Milestone C1 — 匹配层上 Redis（含轻量对局记录）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PvP 匹配协调层（`queue`/`rooms`/`recent`/`ticket_match` + 轻量对局记录）从进程内字典迁到 Redis（`xy:` 前缀），使任意实例都能撮合/查询同一队列；对局运行时（`matches[mid]` + `ws_*`）仍在进程内，跨实例 owner 加载留给 C2。**单实例行为与现状等价**。

**Architecture:** `VersusHub` 注入一个 Redis 客户端（可注入 fakeredis 供测试）。`enqueue/poll/cancel/room_create/room_join` 改读写 Redis 共享结构；撮合用 **WATCH/MULTI/EXEC 乐观事务**（不用重 Lua——venv 是 py3.14，fakeredis 的 EVAL/lupa 可能没轮子；WATCH/MULTI fakeredis 支持好）。队列/私房用原生 `EXPIRE` 做 TTL。撮合成局写一条**轻量对局记录** `xy:pvp:match:{mid}`（seed/map/start_at_ms/uid_a/uid_b），让 `poll` 在任意实例组 `matchStart`。运行时 `matches[mid]`（全 side/ws_send）仍由撮合实例就地建（单实例 = owner）。

**Tech Stack:** Python 3.14、redis-py（`redis.Redis`）、fakeredis（测试）、pytest。服务端终局归档仍用 3308 MariaDB（不变）。

**参考规范：** `docs/superpowers/specs/2026-08-27-pvp-redis-horizontal-scale-design.md`（§2 方1a、§3 数据模型、§5 匹配、§10 C1）。

---

## 关键约束 / 契约

- **保住 6 个方法的签名与返回形（HTTP e2e 测试锁定，`test_versus.py:270-328`）**：`enqueue(uid,rank)→{"ticket"}|{"banned",..}`；`poll(ticket)→{"status":"waiting"|"timeout"}|{"status":"matched","matchStart":{..}}`；`cancel(ticket)→{"ok":True}`；`room_create(uid,rank,base_url)→{"code","link","ticket","map"}|{"banned",..}`；`room_join(code,uid,rank)→{"status":"matched","matchStart":{..}}|{"error":..}|{"banned",..}`。
- **并发安全（用户硬要求）**：跨实例原子性靠 WATCH/MULTI（`WatchError` 重试有上限）；单键写用 SET/HSET。不引入分布式锁的 Lua release 路径（fakeredis/py3.14 风险）。
- **单实例等价**：迁移后，单进程跑法（现网）行为、时序（`START_DELAY_MS` 等）、matchStart 内容与现状一致；由既有 `test_versus.py` 的匹配 + HTTP e2e 测试回归保证。
- **`matches`/`ws_*` 不动**：本里程碑不碰对局运行时与 WS 层。`_make_match` 拆成"写 Redis 撮合记录 + 建进程内 matches"两半（见 Task C1.4）。
- **`recent` 留在进程内**：它只是排队窗口自适应的启发式（非正确性关键），多实例下每实例各算可接受；C1 不迁它（减面）。

---

## Redis 键布局（全部 `xy:` 前缀）

| key | 类型 | 内容 | TTL |
|---|---|---|---|
| `xy:pvp:tk:{ticket}` | HASH | uid,rank,enqueued_ms,hold_until_ms,(room=code?) | `QUEUE_TTL_MS`(私房用`ROOM_TTL_MS`) |
| `xy:pvp:q:{rank}` | ZSET | member=ticket, score=enqueued_ms（同段位 FIFO 池；仅非私房） | 惰性清（成员随 tk 过期由 `_sweep` 删） |
| `xy:pvp:qall` | ZSET | member=ticket, score=enqueued_ms（全非私房池，供"过窗放宽"跨段位配对） | 同上 |
| `xy:pvp:room:{code}` | HASH | code,host_uid,host_rank,map,created_ms,ticket | `ROOM_TTL_MS` |
| `xy:pvp:tm:{ticket}` | STRING | `"{mid}\|{uid}"`（ticket→match 索引） | `MATCH_REAP_MS` 兜底 |
| `xy:pvp:match:{mid}` | HASH | seed,map,start_at_ms,uid_a,uid_b（轻量记录，供 poll 组 payload） | `MATCH_REAP_MS` 兜底 |

- ZSET 成员过期 Redis 不自动删（ZSET 无 per-member TTL），故 `_try_pair`/`_sweep` 读到 ticket 时用 `EXISTS xy:pvp:tk:{ticket}` 校验，过期 ticket 顺手 `ZREM`（惰性清理，替代旧 `_reap` 的 queue 扫描）。
- 时间：沿用注入的 `self._now()`（毫秒逻辑时钟，测试可推进）。**TTL 用 `pexpire`（毫秒）**，值取对应常量；但注意测试推进的是逻辑时钟、非真实时间，故**过期判定仍在代码里用 `_now()` 比 `enqueued_ms`**（真实 `EXPIRE` 只作兜底防泄漏，不作为测试的过期路径）——见 Task C1.6。

---

## 文件结构

- Modify `server/requirements.txt` — 加 `redis>=5`；新建 `server/requirements-dev.txt`（`fakeredis`）或在 requirements 注明。
- Modify `server/config.py` — 加 Redis 段解析（`XY_REDIS_*`）+ `redis_kwargs(cfg)`。
- Modify `server/config.example.yaml` — 加 `redis:` 段示例。
- Create `server/rediskv.py` — 轻封装：从 cfg 建 `redis.Redis`，暴露 key 前缀助手 `k(*parts)`（拼 `xy:pvp:...`）。便于单测注入 fakeredis。
- Modify `server/api_versus.py` — `VersusHub.__init__` 注入 `redis` 客户端；`enqueue/poll/cancel/room_create/room_join/_try_pair/_pair/_make_match/_sweep` 改用 Redis。
- Modify `server/tests/test_versus.py` — `hub` fixture 注入 fakeredis；改写依赖进程内 dict / 逻辑时钟 reap 的断言。
- Create `server/tests/test_versus_redis.py` — Redis 匹配的新单测（fakeredis）：原子撮合、并发不重复配对、TTL/过期惰性清、轻量记录 round-trip。

**执行约定：** 服务端 pytest 用 3308 MariaDB（终局归档不变）+ fakeredis（匹配层，无需真 Redis）。worktree 无 `server/.venv`——首个任务建 venv 并 `pip install -r requirements.txt redis fakeredis`（py3.14，先验证能装上）。

---

## Task C1.1: Redis 依赖 + 配置 + rediskv 封装 + fakeredis 冒烟

**Files:** `server/requirements.txt`, `server/requirements-dev.txt`(新), `server/config.py`, `server/config.example.yaml`, `server/rediskv.py`(新); Test `server/tests/test_versus_redis.py`(新)

- [ ] **Step 0（一次性环境）:** 在 worktree 建 venv 并装依赖，**先验证 py3.14 能装上 redis+fakeredis**：
```
cd server && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt redis fakeredis pytest
.venv/bin/python -c "import redis, fakeredis; print('redis', redis.__version__, 'fakeredis ok')"
```
若 fakeredis 在 py3.14 装不上/import 失败 → 报 BLOCKED（附错误），别硬凑。

- [ ] **Step 1: 写失败测试**（`server/tests/test_versus_redis.py`）
```python
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pytest

def test_rediskv_prefix_and_config():
    from rediskv import k
    assert k("q", "3") == "xy:pvp:q:3"
    assert k("match", "abc") == "xy:pvp:match:abc"

def test_redis_kwargs_from_env(monkeypatch):
    monkeypatch.setenv("XY_REDIS_HOST", "1.2.3.4")
    monkeypatch.setenv("XY_REDIS_PORT", "6380")
    monkeypatch.setenv("XY_REDIS_DB", "7")
    from config import load_config, redis_kwargs
    cfg = load_config()
    kw = redis_kwargs(cfg)
    assert kw["host"] == "1.2.3.4" and kw["port"] == 6380 and kw["db"] == 7
    assert kw["decode_responses"] is True
```

- [ ] **Step 2: 运行确认失败** — `cd server && .venv/bin/python -m pytest tests/test_versus_redis.py -q`（ImportError: rediskv / redis_kwargs 不存在）。

- [ ] **Step 3: 实现**
`server/config.py` 加（镜像 db 段的 env-override 模式；`XY_REDIS_PASSWORD` 用 `is not None`）：
```python
    r = data.get("redis") or {}
    if os.environ.get("XY_REDIS_HOST"): r["host"] = os.environ["XY_REDIS_HOST"]
    if os.environ.get("XY_REDIS_PORT"): r["port"] = int(os.environ["XY_REDIS_PORT"])
    if os.environ.get("XY_REDIS_DB"):   r["db"] = int(os.environ["XY_REDIS_DB"])
    if os.environ.get("XY_REDIS_PASSWORD") is not None: r["password"] = os.environ["XY_REDIS_PASSWORD"]
    data["redis"] = {
        "host": r.get("host", "127.0.0.1"),
        "port": int(r.get("port", 6379)),
        "db": int(r.get("db", 0)),
        "password": r.get("password", ""),
    }
```
并加：
```python
def redis_kwargs(cfg: dict[str, Any]) -> dict[str, Any]:
    r = cfg["redis"]
    kw = {"host": r["host"], "port": r["port"], "db": r["db"], "decode_responses": True}
    if r.get("password"): kw["password"] = r["password"]
    return kw
```
`server/rediskv.py`（新）：
```python
# PvP Redis 键前缀助手 + 客户端工厂。所有 key 统一 xy:pvp: 前缀（该 Redis 与其它项目共用）。
from typing import Any
PREFIX = "xy:pvp:"
def k(*parts: str) -> str:
    return PREFIX + ":".join(parts)
def make_client(cfg: dict[str, Any]):
    import redis
    from config import redis_kwargs
    return redis.Redis(**redis_kwargs(cfg))
```
`server/requirements.txt` 加 `redis>=5`；新建 `server/requirements-dev.txt` 写 `fakeredis>=2`。`config.example.yaml` 加：
```yaml
redis:
  host: 127.0.0.1
  port: 6379
  db: 0
  password: ""
```

- [ ] **Step 4: 运行确认通过** — `cd server && .venv/bin/python -m pytest tests/test_versus_redis.py -q` → pass。

- [ ] **Step 5: 提交** — `git add server/requirements.txt server/requirements-dev.txt server/config.py server/config.example.yaml server/rediskv.py server/tests/test_versus_redis.py && git commit -m "feat(pvp-redis): C1.1 Redis依赖/配置(XY_REDIS_*,xy:前缀)+rediskv封装+fakeredis冒烟"`

---

## Task C1.2: `VersusHub` 注入 redis 客户端 + fixture 改造

**Files:** `server/api_versus.py`(`__init__`), `server/tests/test_versus.py`(fixtures), `server/tests/test_versus_ws.py`/`test_versus_persist.py`(fake_hub 注入)

- [ ] **Step 1: 写失败测试**（在 `test_versus_redis.py`）
```python
def _redis_hub():
    import fakeredis
    from api_versus import VersusHub
    from tests.test_versus import _FakeDB  # 复用内存 DB 桩
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
    h.r.set("xy:pvp:probe", "1"); assert h.r.get("xy:pvp:probe") == "1"
```
（`_FakeDB` 若不在 test_versus 顶层可导入，则在本文件内联一份同款桩。）

- [ ] **Step 2: 确认失败** — `VersusHub` 不接受 `redis_client`。

- [ ] **Step 3: 实现** — `VersusHub.__init__` 增参 `redis_client=None`，存 `self.r = redis_client`（None 时不建连，便于纯逻辑构造；生产在 `server.py` 注入 `make_client(cfg)`）。**本任务不改行为**，只加注入点 + 存字段。`reset()` 里加 `if self.r: self.r.flushdb()`（测试清理；生产 reset 只测试用）。

- [ ] **Step 4: 确认通过 + 无回归** — `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_redis.py tests/test_versus.py -q`。

- [ ] **Step 5: 提交** — `git add -A && git commit -m "feat(pvp-redis): C1.2 VersusHub 注入 redis 客户端（生产 make_client、测试 fakeredis）"`

---

## Task C1.3: `enqueue`/`cancel`/`poll(waiting/timeout)` 上 Redis

（把排队写入/取消/等待与超时判定改用 Redis；**撮合成局路径**留到 C1.4/C1.5。）

**Files:** `server/api_versus.py`, `server/tests/test_versus_redis.py`

- [ ] **Step 1: 写失败测试** — enqueue 后 `xy:pvp:tk:{ticket}` 与 `xy:pvp:q:{rank}`/`qall` 有该 ticket；poll 未成局返回 `waiting`；超过 `MATCH_TIMEOUT_MS`（推逻辑时钟）返回 `timeout` 且 ticket 从 ZSET/hash 清除；cancel 后不在队列。用 `_redis_hub()`。
```python
def test_enqueue_poll_waiting_timeout_redis():
    from api_versus import MATCH_TIMEOUT_MS
    h = _redis_hub()
    t = h.enqueue("u1", 3)["ticket"]
    assert h.poll(t)["status"] == "waiting"
    assert h.r.hget(f"xy:pvp:tk:{t}", "uid") == "u1"
    assert h.r.zscore(f"xy:pvp:q:3", t) is not None
    h._clock["ms"] += MATCH_TIMEOUT_MS + 1
    assert h.poll(t)["status"] == "timeout"
    assert h.r.exists(f"xy:pvp:tk:{t}") == 0
```

- [ ] **Step 2: 确认失败**（当前 enqueue 写进程内 dict，Redis 里没有）。

- [ ] **Step 3: 实现**（要点，实现者按 verbatim 现有逻辑逐条对应到 Redis）：
  - `enqueue`：`is_banned` 不变（MySQL，锁外）。生成 ticket → `HSET xy:pvp:tk:{ticket} {uid,rank,enqueued_ms,hold_until_ms}` + `PEXPIRE QUEUE_TTL_MS` + `ZADD xy:pvp:q:{rank}` + `ZADD xy:pvp:qall`（score=enqueued_ms）→ 调 `_try_pair(now)`（C1.4）。`recent`/`_adaptive_window_ms` 仍进程内算 `hold_until_ms`。
  - `cancel`：`_drop_ticket(ticket)` = `DEL tk` + `ZREM q:{rank}` + `ZREM qall`（需先读 rank；或对所有 rank ZREM——读 tk 的 rank 更省）。返回 `{"ok":True}`。
  - `poll` 未成局分支：`tm = GET xy:pvp:tm:{ticket}`；无 → 读 tk hash：不存在→`timeout`；`now - enqueued_ms >= MATCH_TIMEOUT_MS`→`_drop_ticket`+`timeout`；否则 `_try_pair(now)` 再查 tm，仍无→`waiting`。
  - `self.lock`（进程内）仍保留用于**本实例内**的临界区；跨实例原子性由 C1.4 的 WATCH/MULTI 提供。
  - 加私有 `_drop_ticket(ticket)`（读 rank、DEL tk、ZREM 两个 ZSET）。

- [ ] **Step 4: 通过 + 无回归** — `pytest tests/test_versus_redis.py tests/test_versus.py -q`（注意：`test_versus.py` 里断言 `hub.queue`/进程内 dict 的用例这一步会红——本任务同步把这些断言改成查 Redis，或标记待 C1.5 统一改；**推荐本任务就把 enqueue/poll/cancel 相关的 dict 断言改成 Redis 断言**）。

- [ ] **Step 5: 提交** — `git commit -m "feat(pvp-redis): C1.3 enqueue/cancel/poll 等待与超时上 Redis（tk hash + q/qall ZSET）"`

---

## Task C1.4: 原子撮合 `_try_pair`/`_pair`/`_make_match`（WATCH/MULTI）+ 轻量对局记录

**这是 C1 最难的一块**——用 WATCH/MULTI/EXEC 复现现有两趟算法（同段位 FIFO；过 `hold_until_ms` 后跨段位放宽），跨实例并发不重复配对。

**Files:** `server/api_versus.py`, `server/tests/test_versus_redis.py`

- [ ] **Step 1: 写失败测试**
```python
def test_same_rank_pairs_and_poll_matched_redis():
    h = _redis_hub()
    t1 = h.enqueue("u1", 3)["ticket"]; assert h.poll(t1)["status"] == "waiting"
    t2 = h.enqueue("u2", 3)["ticket"]
    p2 = h.poll(t2)
    assert p2["status"] == "matched"
    ms = p2["matchStart"]; assert ms["seed"] and ms["map"] == "huoyanshan" and ms["opponent"]["uid"]
    p1 = h.poll(t1); assert p1["status"] == "matched"
    assert p1["matchStart"]["matchId"] == ms["matchId"]

def test_widen_after_hold_window_redis():
    from api_versus import _adaptive_window_ms
    h = _redis_hub()
    t1 = h.enqueue("u1", 2)["ticket"]; h.poll(t1)
    t2 = h.enqueue("u2", 9)["ticket"]
    h._clock["ms"] += 3_001  # 过 hold 窗
    assert h.poll(t2)["status"] == "matched"  # 跨段位放宽配对

def test_no_double_pairing_under_concurrency_redis():
    # 三人入队，反复 _try_pair 不应把同一 ticket 配进两局（WATCH/MULTI 原子）
    h = _redis_hub()
    ts = [h.enqueue(f"u{i}", 3)["ticket"] for i in range(3)]
    for t in ts: h.poll(t)
    matched = [t for t in ts if h.r.get(f"xy:pvp:tm:{t}")]
    assert len(matched) == 2  # 恰一对成局，第三个仍等待
```

- [ ] **Step 2: 确认失败**（撮合仍进程内）。

- [ ] **Step 3: 实现** — 拆 `_make_match` 为两半 + WATCH/MULTI 撮合：
  - `_make_match(e1,e2,now,map_id)`（改）：`mid=token_hex(8)`；**写 Redis 轻量记录**：`HSET xy:pvp:match:{mid} seed/map/start_at_ms/uid_a/uid_b` + `PEXPIRE MATCH_REAP_MS`；写 `SET xy:pvp:tm:{e1.ticket} "{mid}|{uid1}"`（+e2）+ PEXPIRE。**同时保留进程内** `self.matches[mid] = {...(全 side/ws_send，沿用现有结构)...}`（单实例 owner 即本实例）。返回 mid。
  - `_pair(a,b,now)`：`_drop_ticket(a)` + `_drop_ticket(b)`（DEL tk + ZREM）→ `_make_match(a,b,now)`。
  - `_try_pair(now)`：用 **WATCH/MULTI** 复现两趟。建议实现（伪码，实现者落成 redis-py `pipeline(transaction=True)` + `watch`）：
    ```
    重试上限 N=8:
      pass1: 对每个 rank，读 q:{rank} 最老两个 ticket（ZRANGE 0 1 withscores）；
             校验两 tk 都 EXISTS 且非 room；WATCH q:{rank}+两个 tk；
             MULTI: ZREM 两 ticket(q & qall) + 写 tm + 写 match 记录; EXEC；
             WatchError→重试。
      pass2: 读 qall 最老者 a，若 now>=a.hold_until 且存在另一非 room b；
             WATCH qall+两 tk；MULTI 同上；EXEC；WatchError→重试。
    ```
    过期 ticket（`EXISTS tk`=0 但仍在 ZSET）顺手 `ZREM`（惰性清）。**进程内 `matches` 的建仍在 `_make_match` 里（同事务成功后）**——单实例下与现状一致。
  - `poll` 成局分支：`tm=GET xy:pvp:tm:{ticket}` → `(mid,uid)` → `_match_start_payload(mid,uid)`：**从 `xy:pvp:match:{mid}` 读 seed/map/start_at_ms/对手 uid**（不再依赖进程内 matches），`opponent=_profile(opp_uid)`（MySQL，锁外，不变）。记录被回收→返回 None→poll 返回 timeout（保持现契约）。

- [ ] **Step 4: 通过 + 无回归** — `pytest tests/test_versus_redis.py tests/test_versus.py -q`（含既有同段位/放宽/超时匹配用例——它们现在跑在 Redis 上应仍绿；HTTP e2e 保证契约）。

- [ ] **Step 5: 提交** — `git commit -m "feat(pvp-redis): C1.4 WATCH/MULTI 原子撮合 + 轻量对局记录；poll 从 Redis 组 matchStart"`

---

## Task C1.5: `room_create`/`room_join` 上 Redis

**Files:** `server/api_versus.py`, `server/tests/test_versus_redis.py`

- [ ] **Step 1: 写失败测试** — room_create 后 `xy:pvp:room:{code}` 存在、host ticket 在 tk（带 `room` 标记、不进 q/qall 池）；room_join 成局返回 matchStart 且删房、host ticket 出队；不存在的 code→`room_not_found`；host 过期→`room_expired`。

- [ ] **Step 2: 确认失败。**

- [ ] **Step 3: 实现** — 镜像现有逻辑到 Redis：
  - `room_create`：撞码检查改 `EXISTS xy:pvp:room:{code}`；`HSET room:{code} ...`+PEXPIRE(ROOM_TTL_MS)；host ticket 写 `tk`（带 `room=code`，**不 ZADD 到 q/qall**——私房不进随机池，等价现有 `_try_pair` 跳过 `room` 标记）+PEXPIRE。返回不变。
  - `room_join`：`HGETALL room:{code}`→无则 `room_not_found`；host tk `EXISTS`→无则 `room_expired`；建一次性 joiner（不入队）；`DEL` host tk + `DEL room:{code}`；`_make_match(host_entry, joiner, now, map_id=room["map"])`；返回 `{"status":"matched","matchStart":_match_start_payload(mid, uid)}`。

- [ ] **Step 4: 通过 + 无回归** — `pytest tests/test_versus_redis.py tests/test_versus.py -q`（含既有私房用例）。

- [ ] **Step 5: 提交** — `git commit -m "feat(pvp-redis): C1.5 私房 room_create/room_join 上 Redis"`

---

## Task C1.6: reap→惰性清理（TTL + 过期校验）+ 重写受影响测试

**Files:** `server/api_versus.py`(`_reap`→`_sweep`), `server/tests/test_versus.py`（reap 断言改写）

- [ ] **Step 1: 改造测试** — 旧的"推逻辑时钟 + `poll("bogus")` + 断言 `hub.queue`/`hub.rooms` 不含"要改成：推逻辑时钟越过 TTL → poll 触发 `_sweep` → 断言 Redis 里 `tk`/`room` 被清（`EXISTS`=0）。（`matches`/`ticket_match` 的 reap 属对局运行时，C1 不改那部分——保留现有进程内 `matches` reap 分支不动。）

- [ ] **Step 2: 确认失败/现状。**

- [ ] **Step 3: 实现** — `_reap` 拆：**queue/rooms 部分改为 Redis 惰性清 `_sweep`**（`poll`/`enqueue` 锁内、`REAP_INTERVAL_MS` 时间闸门）：扫 `qall` 里 `EXISTS tk`=0 或 `now-enqueued>QUEUE_TTL_MS` 的成员 `ZREM`+`DEL`；扫 `room:*`（用一个 `xy:pvp:rooms` SET 索引或 SCAN）过 `ROOM_TTL_MS` 的删。**`matches` 的 reap 分支保持进程内不变**（对局运行时，C2 再议）。原生 `PEXPIRE` 作兜底防泄漏（真实时间），逻辑时钟越界作为测试/主动清路径。

- [ ] **Step 4: 通过 + 全量无回归** — `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest -q`（全绿；匹配相关跑在 Redis/fakeredis，对局运行时/终局/WS 不变）。

- [ ] **Step 5: 提交** — `git commit -m "feat(pvp-redis): C1.6 queue/room 惰性清理上 Redis（TTL+过期校验），保留 matches 进程内 reap"`

---

## Task C1.7: C1 收尾——server.py 注入生产 redis + 全量门禁

**Files:** `server/server.py`; 验收

- [ ] **Step 1:** `server.py` `main()` 里构造 hub 时注入 Redis：`BoundHandler.versus = VersusHub(db, redis_client=make_client(cfg))`（`from rediskv import make_client`）。生产连 ECS Redis（config/env）。import 冒烟 `.venv/bin/python -c "import server"`。
- [ ] **Step 2:** 全量服务端 `XY_DB_PORT=3308 .venv/bin/python -m pytest -q`（需 fakeredis 已装；真 Redis 不需要——匹配测试用 fakeredis，生产注入真 Redis 但测试不连）。
- [ ] **Step 3:** 人工/部署验收记录：单实例连 ECS Redis 起服务，跑一遍匹配→成局→对战（对局运行时仍进程内，等价现状）。
- [ ] **Step 4:** C1 完成。C2（对局态镜像到 Redis + 懒认领/接管，取代 B-core MariaDB flush/load）另起计划。按 `superpowers:finishing-a-development-branch` 决定合并（先看 main 分叉→rebase→ff）。

---

## 备注 / 风险
- **fakeredis + py3.14**：Task C1.1 Step 0 是硬门；装不上就 BLOCKED 上报（可能要 pin fakeredis 版本或换真 Redis 起个测试实例）。
- **WATCH/MULTI 重试**：并发下 WatchError 重试上限 8；到顶不成局这轮返回 waiting（下次 poll 再试），不阻塞。
- **单实例等价是本里程碑的验收基准**：既有 `test_versus.py` 匹配用例 + HTTP e2e 全绿 = 契约未破。多实例真跑要等 C3（反代一致性哈希）。
- **`matches` 仍进程内**：C1 后，撮合实例建 `matches[mid]`；跨实例 owner 加载（poll 在 A、owner 在 B）留给 C2，C1 不声称多实例对战可用。
