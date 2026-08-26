# PvP 断线容错 · 里程碑 B-core（服务端持久化 + grace45s + 撮合退队）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让正在进行的 PvP 对局在服务端 `systemctl restart`/发版/崩溃后不再全部丢失——活跃对局定期落 MariaDB、进程启动时回放到内存、SIGTERM 优雅刷库；断线宽限从 10s 拉到 45s；撮合成局后一方久不连接则退队清理防"打空气"。

**Architecture:** 纯内存 `VersusHub.matches` 增加一层 MariaDB 镜像。**定期全量 flush**(守护线程，镜像 `api_events.start_aggregator` 的形态）：锁内快照所有未终局对局为可 JSON 化的 dict（**丢弃每侧的 `ws_send` 闭包**），锁外 UPSERT 进新表 `pvp_active_match`，并对账删除表中已不在活跃集里的行。进程启动时（`server.py` 构造 hub 后）`load_active_matches()` 把行读回 `matches` + 重建 `ticket_match`，ws_send 置 None、gone_ms 置 now（全员视为断线待重连）；客户端重连时现有 `ws_hello` 自动重挂 ws_send，无需改握手。SIGTERM 处理器同步 flush 一次再 `httpd.shutdown()`。grace 改一个常量 + 客户端倒计时常量对齐。撮合退队在 `_reap` 加一个新分支。

**Tech Stack:** Python 3、stdlib `http.server`、`pymysql`(DictCursor，每次 `cursor()` 开/提交/关一条连接)、`threading`、`signal`；pytest（一次性 MariaDB，本机跑用 `XY_DB_PORT=3308` 覆盖，见约定）。客户端一处 TS 常量。

**参考规范：** `docs/superpowers/specs/2026-08-26-pvp-disconnect-resilience-design.md` §4（B5/B6）、§5（grace 45s）。已随里程碑 A 合入 main。

---

## 并发安全（用户硬性要求，全程遵守）

- **快照在锁内、写库在锁外**：flush 先 `with self.lock:` 深拷贝出可序列化快照（含活跃 match_id 集合），释放锁后再做 DB UPSERT/DELETE——热路径不被 DB 延迟串住（沿用 `poll`/`_profile` 锁外读档哲学，见 `api_versus.py:243-245` 注释）。
- **单线程周期 flush + 启动前 load**：flush 只有一个守护线程串行执行，不会自身并发；`load_active_matches` 在 `serve_forever` 之前调用，无并发。
- **UPSERT 幂等 + 对账收敛**：表以 `match_id` 为主键，`INSERT ... ON DUPLICATE KEY UPDATE`；每轮 flush 用本轮快照的 id 集合 `DELETE FROM pvp_active_match WHERE match_id NOT IN (...)`，把已终局/已回收的行一并清掉，消除"flush 与终局竞态导致的残留行"。
- **只持久化未终局对局**：终局(`ended=True`)的不写（终局已入 `pvp_results`），故 reload 不会捞回已结束的局。
- **写库失败不外抛**：镜像 `_persist_result` 的 swallow + `logging.exception` 模式，绝不让持久化异常打断对局或关机。

---

## 文件结构

- Modify `server/db.py` — `SCHEMA` 列表追加 `pvp_active_match` 建表语句（`migrate()` 自动执行）。
- Modify `server/api_versus.py` — grace 常量 10→45；新增 `MATCH_CONNECT_GRACE_MS` 常量；`_serialize_match`/`_deserialize_match` 纯函数；`_persist_active_flush`(锁内快照)/`load_active_matches`(启动回放) hub 方法；`_reap` 加"撮合后久不连接"退队分支；`_new_side` 加 `connected_ever` 标记。
- Modify `server/server.py` — 构造 hub 后 `versus.load_active_matches()`；`main()` 注册 SIGTERM/SIGINT → flush + `httpd.shutdown()`；起周期 flush 守护线程。
- Modify `web/src/main.ts` — `DISCONNECT_COUNTDOWN_MS` 10_000→45_000（与服务端 grace 对齐）。
- Test `server/tests/test_versus_persist.py`（新建）— 建表/序列化 round-trip/flush+load 回放/终局对账删除/撮合退队。
- 既有 `server/tests/test_versus_ws.py` 的 grace 用例 import 符号自动追踪 45s（确认不被写死破坏）。

**执行约定（项目既有）：** 服务端 pytest 用一次性 MariaDB；本机 3307 常被外部项目占用，**跑测试用 `XY_DB_PORT=3308 <the pytest command>` 覆盖**（测试代码默认 3307，读该环境变量）。客户端改动跑 `web/` 的 vitest + tsc（不新增基线报错）。改了 grace/撮合属"改战斗/规则"边缘——本计划不动 autoplace/AI，无需 ai-balance 门禁；但客户端 `DISCONNECT_COUNTDOWN_MS` 改动要真机验证倒计时体感。

---

## Task B1: 新增 `pvp_active_match` 表

**Files:**
- Modify: `server/db.py`（`SCHEMA` 列表，在结束 `]`（约 `:139`）之前追加）
- Test: `server/tests/test_versus_persist.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `server/tests/test_versus_persist.py`，先放建表断言（夹具沿用 `test_versus.py` 的 `db` fixture 形态）：

```python
# server/tests/test_versus_persist.py
# 里程碑 B-core：活跃对局持久化 + 回放。用一次性 MariaDB（本机跑用 XY_DB_PORT=3308 覆盖）。
import os
import pytest

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -q`
Expected: FAIL — `SHOW TABLES LIKE 'pvp_active_match'` 返回 None（表不存在）。

- [ ] **Step 3: 追加建表语句**

在 `server/db.py` 的 `SCHEMA` 列表末尾（`pvp_anomaly` 之后、闭合 `]` 之前）追加，风格严格对齐既有表：

```python
    # 在线真人对战（PvP）里程碑 B：正在进行的活跃对局镜像。单进程内存 matches 的持久层，
    # 供 systemctl restart/发版/崩溃后回放（重连客户端经 ws_hello 重挂 ws_send）。以 match_id 为主键，
    # 定期全量 UPSERT + 对账删除；只存未终局对局（终局入 pvp_results）。state_json 为剔除 ws_send 后的整局快照。
    """
    CREATE TABLE IF NOT EXISTS pvp_active_match (
      match_id VARCHAR(40) NOT NULL PRIMARY KEY,
      uid_a VARCHAR(20) NOT NULL,
      uid_b VARCHAR(20) NOT NULL,
      ticket_a VARCHAR(40) NULL,
      ticket_b VARCHAR(40) NULL,
      state_json MEDIUMTEXT NOT NULL,
      updated_at DATETIME NOT NULL,
      KEY idx_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
```

（`uid_a/uid_b/ticket_*` 冗余出来便于回放时重建 `ticket_match` 且无需先解析 JSON；`state_json` 存整局。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -q`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/db.py server/tests/test_versus_persist.py
git commit -m "feat(pvp-server): 新增 pvp_active_match 表（活跃对局持久层）"
```

---

## Task B2: 序列化 / 反序列化纯函数

**Files:**
- Modify: `server/api_versus.py`（模块级函数，放在 `VersusHub` 类定义之前或之后的模块作用域）
- Test: `server/tests/test_versus_persist.py`

序列化必须**剔除每侧 `ws_send` 闭包**（不可 JSON 化）；反序列化必须把 `wave_schedule`/`first_clear` 的键 int() 回来（JSON 把 int 键转成了 str），并把 `ws_send=None`、`gone_ms=now`。

- [ ] **Step 1: 写失败测试**

在 `test_versus_persist.py` 追加（用 `_fake_match` 造局，无需真库）：

```python
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
    import json
    hub = _fake_hub()
    e1 = {"uid": "A1", "rank": 3, "ticket": "tA"}
    e2 = {"uid": "B1", "rank": 3, "ticket": "tB"}
    mid = hub._make_match(e1, e2, hub._now())
    m = hub.matches[mid]
    m["a"]["ws_send"] = lambda t: True          # 装一个闭包，序列化必须丢掉
    m["wave_schedule"][2] = hub._now() + 5000    # int 键
    m["first_clear"][1] = "A1"

    blob = _serialize_match(m)
    text = json.dumps(blob)                      # 必须能 JSON 化（无闭包）
    assert "ws_send" not in text

    restored = _deserialize_match(json.loads(text), now=2_000_000)
    # 结构关键字段还原
    assert restored["match_id"] == mid
    assert restored["a"]["uid"] == "A1" and restored["b"]["uid"] == "B1"
    assert restored["seed"] == m["seed"] and restored["map"] == m["map"]
    # int 键还原（不是 "2"/"1" 字符串）
    assert 2 in restored["wave_schedule"] and restored["wave_schedule"][2] == m["wave_schedule"][2]
    assert 1 in restored["first_clear"] and restored["first_clear"][1] == "A1"
    # 连接态复位：ws_send=None、gone_ms=now（全员视为断线待重连）、created_ms=now（重连窗重置）
    assert restored["a"]["ws_send"] is None and restored["b"]["ws_send"] is None
    assert restored["a"]["gone_ms"] == 2_000_000 and restored["b"]["gone_ms"] == 2_000_000
    assert restored["created_ms"] == 2_000_000
    assert restored["a"]["connected_ever"] is False and restored["b"]["connected_ever"] is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -k serialize -q`
Expected: FAIL — `_serialize_match`/`_deserialize_match` 不存在（ImportError）。

- [ ] **Step 3: 实现两个纯函数**

在 `server/api_versus.py` 模块作用域加（放在 `VersusHub` 类之后即可）：

```python
# ---- 里程碑 B：活跃对局序列化（持久化用）----
# ws_send 是运行时闭包（不可 JSON 化），序列化一律剔除；重连时 ws_hello 会重挂。
# wave_schedule / first_clear 是 int 键 dict，JSON 会把键转成 str，反序列化时 int() 回来。

def _serialize_match(m: dict) -> dict:
    """把内存 match dict 转成可 JSON 化的快照（剔除每侧 ws_send）。"""
    def side(s: dict) -> dict:
        return {k: v for k, v in s.items() if k != "ws_send"}
    out = {k: v for k, v in m.items() if k not in ("a", "b")}
    out["a"] = side(m["a"])
    out["b"] = side(m["b"])
    return out

def _deserialize_match(blob: dict, now: int) -> dict:
    """把 JSON 快照还原成内存 match dict：int() 键、ws_send=None、gone_ms=now（视为断线待重连）、
    created_ms=now（关键：给回放局一个新鲜的重连窗，否则旧 created_ms 会让它一 _reap 就被"从未连接"清掉）。"""
    m = dict(blob)
    m["wave_schedule"] = {int(k): v for k, v in (blob.get("wave_schedule") or {}).items()}
    m["first_clear"] = {int(k): v for k, v in (blob.get("first_clear") or {}).items()}
    m["created_ms"] = now    # 回放即视为"刚创建"，重连宽限从回放时刻起算（见 B4 撮合退队分支）
    for key in ("a", "b"):
        s = dict(blob[key])
        s["ws_send"] = None      # 运行时闭包不持久化，等重连 ws_hello 重挂
        s["gone_ms"] = now       # 回放后全员视为断线，靠客户端在 grace 内重连恢复
        s["connected_ever"] = False  # 回放后需重新连接才算"连过"（撮合退队分支据此）
        m[key] = s
    return m
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -k serialize -q`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(pvp-server): 活跃对局序列化/反序列化纯函数（剔除ws_send、int键还原）"
```

---

## Task B3: `flush_active_matches` + `load_active_matches`（落库 + 回放）

**Files:**
- Modify: `server/api_versus.py`（`VersusHub` 方法）
- Test: `server/tests/test_versus_persist.py`（用**真库** `db` fixture）

- [ ] **Step 1: 写失败测试**

在 `test_versus_persist.py` 追加（真库；用 `hub(db)` 形态的可控时钟 hub）：

```python
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
    # 造两局活跃对局，flush 落库
    mid1 = _mk(rhub, "P1", "P2")
    mid2 = _mk(rhub, "P3", "P4")
    rhub.flush_active_matches()
    # 新 hub（模拟进程重启）→ 从库回放
    from api_versus import VersusHub
    h2 = VersusHub(db, now_ms=lambda: 2_000_000)
    h2.load_active_matches()
    assert mid1 in h2.matches and mid2 in h2.matches
    assert h2.matches[mid1]["a"]["uid"] == "P1" and h2.matches[mid1]["b"]["uid"] == "P2"
    # ticket_match 重建
    assert h2.ticket_match.get("t_P1") == (mid1, "P1")
    assert h2.ticket_match.get("t_P2") == (mid1, "P2")
    # 回放后可直接 ws_hello 重连（找得到 match、uid 校验通过、重挂 ws_send）
    sent = []
    res = h2.ws_hello("P1", mid1, lambda t: (sent.append(t), True)[1])
    assert "error" not in res
    assert h2.matches[mid1]["a"]["ws_send"] is not None
    assert h2.matches[mid1]["a"]["gone_ms"] == 0

def test_flush_reconciles_deletes_ended_and_absent(rhub, db):
    mid = _mk(rhub, "Q1", "Q2")
    rhub.flush_active_matches()          # 行在
    rhub.ws_status("Q1", mid, "surrender")  # 终局 → ended=True
    rhub.flush_active_matches()          # 对账：未终局集合不含 mid → 删行
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM pvp_active_match WHERE match_id=%s", (mid,))
        assert cur.fetchone()["c"] == 0
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -k "flush" -q`
Expected: FAIL — `flush_active_matches`/`load_active_matches` 不存在。

- [ ] **Step 3: 实现两个 hub 方法**

在 `VersusHub` 内加（`import json` 已在 api_versus.py 顶部；确认 `_persist_result` 用到 json 即已 import）：

```python
    def flush_active_matches(self) -> None:
        """定期/关机时把所有未终局对局镜像进 pvp_active_match（锁内快照、锁外写库、对账删非活跃行）。
        写库失败只记日志不抛（对齐 _persist_result）。"""
        # 1) 锁内快照（仅未终局；剔除 ws_send 在 _serialize_match 内做）
        with self.lock:
            snap = []
            for mid, m in self.matches.items():
                if m.get("ended"):
                    continue
                # 找该 match 的两个 ticket（回放重建 ticket_match 用）
                tks = {u: t for t, (mm, u) in self.ticket_match.items() if mm == mid}
                snap.append({
                    "match_id": mid, "uid_a": m["a"]["uid"], "uid_b": m["b"]["uid"],
                    "ticket_a": tks.get(m["a"]["uid"]), "ticket_b": tks.get(m["b"]["uid"]),
                    "blob": _serialize_match(m),
                })
            active_ids = [s["match_id"] for s in snap]
        # 2) 锁外写库：UPSERT 活跃行 + 对账删非活跃行
        dt = self.db.now()
        try:
            with self.db.cursor() as cur:
                for s in snap:
                    cur.execute(
                        "INSERT INTO pvp_active_match"
                        " (match_id,uid_a,uid_b,ticket_a,ticket_b,state_json,updated_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s)"
                        " ON DUPLICATE KEY UPDATE uid_a=VALUES(uid_a),uid_b=VALUES(uid_b),"
                        " ticket_a=VALUES(ticket_a),ticket_b=VALUES(ticket_b),"
                        " state_json=VALUES(state_json),updated_at=VALUES(updated_at)",
                        (s["match_id"], s["uid_a"], s["uid_b"], s["ticket_a"], s["ticket_b"],
                         json.dumps(s["blob"], ensure_ascii=False), dt))
                # 对账：删掉库里已不在活跃集的行（终局/回收/竞态残留）
                if active_ids:
                    ph = ",".join(["%s"] * len(active_ids))
                    cur.execute(f"DELETE FROM pvp_active_match WHERE match_id NOT IN ({ph})", active_ids)
                else:
                    cur.execute("DELETE FROM pvp_active_match")
        except Exception:
            logging.exception("pvp_active_match flush 失败（不影响对局，下轮重试）")

    def load_active_matches(self) -> int:
        """进程启动时回放未终局对局到内存（在 serve_forever 之前调用，无并发）。返回回放条数。"""
        now = self._now()
        try:
            with self.db.cursor() as cur:
                cur.execute("SELECT match_id,uid_a,uid_b,ticket_a,ticket_b,state_json FROM pvp_active_match")
                rows = cur.fetchall()
        except Exception:
            logging.exception("pvp_active_match 回放读取失败，跳过（活跃对局丢失，客户端将重新匹配）")
            return 0
        n = 0
        for row in rows:
            try:
                blob = json.loads(row["state_json"])
                m = _deserialize_match(blob, now)
                if m.get("ended"):
                    continue  # 兜底：终局的不回放
                self.matches[m["match_id"]] = m
                if row.get("ticket_a"):
                    self.ticket_match[row["ticket_a"]] = (m["match_id"], row["uid_a"])
                if row.get("ticket_b"):
                    self.ticket_match[row["ticket_b"]] = (m["match_id"], row["uid_b"])
                n += 1
            except Exception:
                logging.exception("pvp_active_match 单行回放失败 match_id=%s，跳过", row.get("match_id"))
        if n:
            logging.info("pvp_active_match 回放 %d 局活跃对局", n)
        return n
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -k "flush" -q`
Expected: PASS（两个用例）。

- [ ] **Step 5: 提交**

```bash
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(pvp-server): flush_active_matches/load_active_matches——活跃对局落库+重启回放+对账"
```

---

## Task B4: 撮合后久不连接退队（`_reap` 新分支）

**Files:**
- Modify: `server/api_versus.py`（常量 + `_new_side` 加标记 + `ws_hello` 置标记 + `_reap` 新分支）
- Test: `server/tests/test_versus_persist.py`

现状：`_new_side` 把 `last_tick_ms=now`，撮合后从没人连也要等 `IDLE_REAP_MS=300s` 才回收。加一个"从未有任何一方连过"的短宽限退队。

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -k "never_connected or one_side" -q`
Expected: FAIL — `MATCH_CONNECT_GRACE_MS` 不存在 / 从未连接的局未被回收。

- [ ] **Step 3: 实现**

(a) 常量区（`api_versus.py` 约 `:40` 与其它 REAP 常量一起）加：
```python
MATCH_CONNECT_GRACE_MS = 20_000  # 撮合成局后，双方都从未 WS 连接超过此时长 → 退队回收（防僵尸局/打空气）
```

(b) `_new_side`（`:114-131`）的返回 dict 里加一个标记（放在 `"gone_ms": 0` 同级）：
```python
            "connected_ever": False,   # 里程碑 B：是否曾有过 ws_hello（撮合退队用）
```

(c) `ws_hello`（`:499` 重挂 ws_send 附近）置标记：
```python
        me["connected_ever"] = True    # 标记该侧至少连过一次（撮合退队据此豁免）
```

(d) `_reap`（`:184-190`）在"未终局 & 双方久未心跳"分支**之前**加"从未连接"分支：
```python
        for mid, m in list(self.matches.items()):
            if m.get("ended"):
                if now - m.get("ended_ms", m["created_ms"]) > MATCH_REAP_MS:
                    dead.append(mid)
            elif (not m["a"].get("connected_ever") and not m["b"].get("connected_ever")
                  and now - m["created_ms"] > MATCH_CONNECT_GRACE_MS):
                dead.append(mid)   # 里程碑 B：撮合成局后双方都从未连接 → 退队
            elif now - max(m["a"]["last_tick_ms"], m["b"]["last_tick_ms"]) > IDLE_REAP_MS:
                dead.append(mid)
```

（回放的对局：`_deserialize_match` 把 `connected_ever` 置 False 且 **`created_ms` 重置为 now**，故回放后从这一刻起算一个新鲜的 `MATCH_CONNECT_GRACE_MS`(20s) 重连窗——服务端重启后客户端通常几秒内就 backoff 重连并 `ws_hello`(置 `connected_ever=True`)从而保住对局；20s 内双方都没回连才退队。这是期望行为，也是持久化回放"给重连留窗"的关键——若不重置 created_ms，旧值会让回放局第一次 `_reap` 就被清掉。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_persist.py -k "never_connected or one_side" -q`
Expected: PASS。再跑整文件确认无回归：`... pytest tests/test_versus_persist.py -q`。

- [ ] **Step 5: 提交**

```bash
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(pvp-server): 撮合成局后双方久不连接则退队回收（_reap 新分支 + connected_ever 标记）"
```

---

## Task B5: 服务端接线——启动回放 + SIGTERM flush + 周期 flush

**Files:**
- Modify: `server/server.py`（`main()`）
- Test: 无直接单测（信号/serve_forever 难单测）；`flush`/`load` 已在 B3 覆盖。走 `python -c` import 冒烟 + 手动/部署验证。

- [ ] **Step 1: 加载 + 信号 + 周期线程接线**

在 `server/server.py` `main()` 里，`BoundHandler.versus = VersusHub(db)`（`:148`）之后、`ThreadingHTTPServer(...)`（`:150`）之前插入：

```python
    hub = BoundHandler.versus
    restored = hub.load_active_matches()          # 启动回放：把上次未终局对局读回内存
    print(f"pvp active matches restored: {restored}", flush=True)

    # 周期 flush：镜像 start_aggregator 的守护线程形态（daemon、swallow-and-log、sleep 循环）
    import threading, time as _time
    # 间隔在主线程解析：值非法回退默认 + 夹紧，别让守护线程启动即静默死掉（否则周期落库悄悄消失）
    try:
        flush_interval = max(0.5, float(os.environ.get("XY_PVP_FLUSH_INTERVAL", "5")))
    except (TypeError, ValueError):
        flush_interval = 5.0
    def _pvp_flush_loop():
        while True:
            _time.sleep(flush_interval)
            try:
                hub.flush_active_matches()
            except Exception:
                logging.exception("pvp flush loop 异常（继续）")
    threading.Thread(target=_pvp_flush_loop, name="pvp-flush", daemon=True).start()
```

然后把 `serve_forever()` 包起来，注册 SIGTERM/SIGINT 优雅关机（`main()` 顶部需 `import signal`；`logging` 已用则确认已 import）：

```python
    with ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"serving static={static_dir} api+admin on {host}:{port}", flush=True)
        def _graceful(signum, _frame):
            # 先 SIG_IGN 掉两个信号：信号处理器在主线程执行，若 flush 期间第二个信号到达会嵌套重入本函数，
            # 再进 flush 的 with self._flush_lock 会对已持有的锁阻塞获取 → 主线程自死锁。忽略重复即可。
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            print(f"signal {signum} → flushing pvp active matches then shutting down", flush=True)
            try:
                hub.flush_active_matches()        # 关机前刷一次，发版不丢活跃对局
            except Exception:
                logging.exception("关机 flush 失败")
            # shutdown() 必须在 serve_forever 所在的主线程之外调用，否则死锁（信号处理器就在主线程）；起短命线程调它
            threading.Thread(target=httpd.shutdown, name="pvp-shutdown", daemon=True).start()
        signal.signal(signal.SIGTERM, _graceful)
        signal.signal(signal.SIGINT, _graceful)
        httpd.serve_forever()
```

（`ThreadingHTTPServer` 用作上下文管理器，`serve_forever()` 阻塞在**主线程**；Python 信号处理器也在主线程执行，故 `httpd.shutdown()` **必须**从另起的线程调用，否则 serve_forever 无法推进去观察 shutdown 标志 → 死锁 → 只能等 systemd `TimeoutStopSec≈90s` 后 SIGKILL。`_graceful` 顶部 SIG_IGN 防第二个信号在 flush 期间重入造成 `_flush_lock` 自死锁。systemd `xy-web.service` 默认 `KillSignal=SIGTERM`，flush 时间充裕。）

- [ ] **Step 2: import/语法冒烟**

Run: `cd server && .venv/bin/python -c "import server; print('ok')"`
Expected: 打印 `ok`（无 import/语法错误）。

- [ ] **Step 3: 手动本地验证（记录，不阻塞单测）**

在本机起服务（需要 DB）：`XY_CONFIG=... .venv/bin/python server.py`，观察启动日志出现 `pvp active matches restored: N`；`kill -TERM <pid>` 时出现 `signal 15 → flushing …`。此步在部署前人工确认，计划里记录为验收项。

- [ ] **Step 4: 提交**

```bash
git add server/server.py
git commit -m "feat(pvp-server): 启动回放活跃对局 + 周期flush守护线程 + SIGTERM优雅刷库关机"
```

---

## Task B6: grace 10s→45s（服务端 + 客户端倒计时对齐）

**Files:**
- Modify: `server/api_versus.py:25`（`DISCONNECT_GRACE_MS`）
- Modify: `web/src/main.ts`（`DISCONNECT_COUNTDOWN_MS`）
- Test: 既有 `server/tests/test_versus_ws.py` 的断线用例 import 符号自动追踪；客户端走 tsc + 真机。

- [ ] **Step 1: 改服务端常量**

`server/api_versus.py:25`：
```python
DISCONNECT_GRACE_MS = 45_000     # 断线宽限（10s→45s）：覆盖切后台/弱网/服务端重启回放后的重连窗；与客户端倒计时对齐
```

- [ ] **Step 2: 跑既有断线用例确认仍绿（符号自动追踪新值）**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_ws.py -k "disconnect or gone or grace or reconnect" -q`
Expected: PASS（`test_disconnect_gives_oppgone_then_timeout_result` 等用 `DISCONNECT_GRACE_MS + 500` 推进时钟，导入的是符号，自动用 45_000）。若有用例把 10000 写死则改用符号——**先看输出**再定。

- [ ] **Step 3: 改客户端倒计时常量**

`web/src/main.ts` 的 `const DISCONNECT_COUNTDOWN_MS = 10_000;` 改为：
```ts
const DISCONNECT_COUNTDOWN_MS = 45_000;   // 与服务端 DISCONNECT_GRACE_MS 对齐（10s→45s）：断线倒计时/复活窗口
```

- [ ] **Step 4: 客户端 tsc 不新增**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 基线（~26）不增加。

- [ ] **Step 5: 提交**

```bash
git add server/api_versus.py web/src/main.ts
git commit -m "feat(pvp): 断线宽限 10s→45s（服务端 DISCONNECT_GRACE_MS + 客户端倒计时对齐）"
```

---

## Task B7: B-core 收尾——全量服务端测试 + 客户端门禁

**Files:** 无（验收）

- [ ] **Step 1: 服务端全量 pytest**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest -q`
Expected: 全绿（新 `test_versus_persist.py` + 既有 `test_versus*.py` 等）。若无 3308 库，先起：`docker run -d --name xy-mysql-3308 -e MYSQL_ALLOW_EMPTY_PASSWORD=1 -e MYSQL_DATABASE=xy_game_test -p 3308:3306 mariadb:11`。

- [ ] **Step 2: 客户端门禁**

Run: `cd web && npx vitest run && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: vitest 全绿；tsc 基线不增。

- [ ] **Step 3: 部署前人工验收清单**（记录，非自动）

- 起服务见 `pvp active matches restored: N`；`kill -TERM` 见关机 flush 日志。
- 真机：一局 PvP 中服务端 `systemctl restart`（发版）→ 45s 内客户端自动重连 → 对局恢复（不判负）。
- 真机：客户端断线倒计时显示 ~45s（与 A 的解冻窗口一致）。

- [ ] **Step 4: B-core 完成**

按 `superpowers:finishing-a-development-branch` 决定合并/PR（注意 main 可能又前进，先看分叉再 rebase→ff）。B7 弱网测量、B8 反代 idle 排查作为**独立后续**另起（见 spec §4 B7/B8）。

---

## 备注 / 后续
- **回放局的重连窗**：`_deserialize_match` 把 `created_ms` 与 `gone_ms` 都重置为回放时刻，故回放局从重启后重新起算 `MATCH_CONNECT_GRACE_MS`(20s，双方都没回连才退队) 与 `DISCONNECT_GRACE_MS`(45s，一方回连另一方超时判负)。客户端在服务端重启后通常几秒内 backoff 重连，够用；如需更长窗按真机观察调 `MATCH_CONNECT_GRACE_MS`。
- **flush 频率**：默认 5s（`XY_PVP_FLUSH_INTERVAL` 可调）。硬崩溃最多丢 ~5s 波次进度；`systemctl restart` 走 SIGTERM 同步 flush 无损。
- **B7 弱网测量 / B8 反代**：独立跟进，不属本 B-core 计划。
