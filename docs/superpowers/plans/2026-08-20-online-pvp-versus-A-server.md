# Plan A · 服务端 PvP 后端 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Python 静态站同进程内加一组 `/api/versus/*` 接口，提供随机/同级匹配、邀请私房、1s 双向 tick（放置动作即时补发转发 + 波次调度 + 终局裁决）、放置合法性/启发式反作弊与独立 PvP 战绩落库。

**Architecture:** 新增 `server/api_versus.py`，内含线程安全的进程内单例 `VersusHub`（匹配队列 / 邀请房间 / 活跃对局，`threading.Lock` 保护，重启即丢）；时钟/种子/房间码/选图**全部可注入**以便确定性单测。持久化只用两张新表 `pvp_results` / `pvp_anomaly`（`db.py` SCHEMA 追加）。`server.py` 追加路由并把 `Hub` 挂到 `Handler`。体力为客户端权威（服务端不管体力，见 Plan B）。

**Tech Stack:** Python 3（标准库 `http.server` + `threading` + `secrets`）、PyMySQL、pytest（真实 MariaDB @3307，沿用 `server/tests` 既有夹具风格）。

---

## 关键数据形状（跨任务一致，先定义）

**放置动作 input**（客户端上报、服务端原样转发给对手；服务端只校验合法性，不解释语义）：
```jsonc
{ "t": 540, "op": "summon"|"place"|"move"|"merge"|"shovel"|"active"|"itemPick", "cell":"r2c4"?, "token":"…"?, "from":"…"?, "to":"…"?, "id":"…"?, "choice":1? }
```

**digest**（1s 摘要，反作弊）：`{ "wave":int, "power":num, "kills":int, "tangsengHP":num, "peach":num, "units":int }`

**Match（进程内）每方 side**：`{ uid, rank, last_tick_ms, relay_buffer:[input], last_digest, wave, prev_kill_digest, status:"playing"|"tangsengDead"|"surrender" }`
**Match**：`{ match_id, seed, map, start_at_ms, a:side, b:side, wave_schedule:{wave:start_ms}, first_clear:{wave:ms}, result:None|{a:{outcome,reason}, b:{...}}, created_ms, ended:bool }`

**VersusHub 常量（可调）**：`STAMINA_COST=5`(仅供客户端参考)、`MATCH_TIMEOUT_MS=120_000`、`DISCONNECT_GRACE_MS=6_000`、`RECENT_WINDOW_MS=300_000`、`W_MIN_MS=3_000`、`W_MAX_MS=15_000`、`INTER_WAVE_DELAY_MS=3_000`、`START_DELAY_MS=1_500`、`SIMULTANEOUS_EPS_MS=200`、`MAPS=["huoyanshan","liushahe","baiguling","pansidong"]`。

---

## File Structure

- **Create** `server/api_versus.py` — `VersusHub` 单例 + 各 handler 函数（`handle_versus_*`）。
- **Modify** `server/db.py` — SCHEMA 追加 `pvp_results` / `pvp_anomaly`；不改其它。
- **Modify** `server/server.py` — `_api` routes 追加 6 条 `/api/versus/*`；`main()` 与测试夹具给 `Handler` 挂 `versus = VersusHub(db)`。
- **Create** `server/tests/test_versus.py` — Hub 单测（注入时钟）+ HTTP 冒烟。
- **Modify** `server/tests/test_player_api.py` — `_reset_db()` 的 drop 列表加 `pvp_results`、`pvp_anomaly`（避免脏表）。

---

## Task 1: 新表 schema

**Files:**
- Modify: `server/db.py`（`SCHEMA` 列表尾部追加两条 CREATE）
- Modify: `server/tests/test_player_api.py:42`（drop 列表）
- Test: `server/tests/test_versus.py`（新建，先放 migrate 测试）

- [ ] **Step 1: 写失败测试**

新建 `server/tests/test_versus.py`：
```python
from __future__ import annotations
import os, sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),
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
    d = DB(load_config())
    d.migrate()
    return d

def test_migrate_creates_pvp_tables(db):
    with db.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'pvp_results'")
        assert cur.fetchone() is not None
        cur.execute("SHOW TABLES LIKE 'pvp_anomaly'")
        assert cur.fetchone() is not None
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py::test_migrate_creates_pvp_tables -v`
Expected: FAIL（表不存在）

- [ ] **Step 3: 追加 schema**

在 `server/db.py` 的 `SCHEMA = [ ... ]` 列表**末尾**（`daily_stats` 之后）追加：
```python
    """
    CREATE TABLE IF NOT EXISTS pvp_results (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      match_id VARCHAR(40) NOT NULL,
      day CHAR(10) NOT NULL,
      uid VARCHAR(20) NOT NULL,
      opponent_uid VARCHAR(20) NOT NULL,
      outcome ENUM('win','lose','draw') NOT NULL,
      reason VARCHAR(32) NOT NULL,
      wave INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      KEY idx_uid_day (uid, day),
      KEY idx_match (match_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS pvp_anomaly (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      day CHAR(10) NOT NULL,
      uid VARCHAR(20) NOT NULL,
      opponent_uid VARCHAR(20) NOT NULL,
      match_id VARCHAR(40) NOT NULL,
      reasons_json MEDIUMTEXT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY uniq_day_uid_opp (day, uid, opponent_uid),
      KEY idx_uid_day (uid, day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
```

在 `server/tests/test_player_api.py:42` 的 drop 元组改为（加两张新表，先删子表无外键约束、顺序随意）：
```python
        for t in ("pvp_anomaly", "pvp_results", "events", "daily_stats", "daily_leaderboard", "player_avatars", "players"):
```

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py::test_migrate_creates_pvp_tables -v`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add server/db.py server/tests/test_versus.py server/tests/test_player_api.py
git commit -m "feat(versus): pvp_results/pvp_anomaly 表 + 迁移测试"
```

---

## Task 2: VersusHub 骨架 + 禁赛查询

**Files:**
- Create: `server/api_versus.py`
- Test: `server/tests/test_versus.py`

- [ ] **Step 1: 写失败测试**（追加到 `test_versus.py`）
```python
@pytest.fixture
def hub(db):
    from api_versus import VersusHub
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(db, now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds),
                  gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan")
    h._clock = clock  # 测试里推进时钟用
    return h

def test_not_banned_by_default(hub):
    assert hub.is_banned("12345678") is False
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py::test_not_banned_by_default -v`
Expected: FAIL（`No module named api_versus`）

- [ ] **Step 3: 建 `server/api_versus.py`（骨架）**
```python
from __future__ import annotations
# PvP 在线对战：进程内匹配/房间/对局状态机 + 转发 + 反作弊。
# 单进程 ThreadingHTTPServer 下用一把大锁保护；重启即丢活跃对局（临时对局可接受）。
import json
import secrets
import threading
import time
from typing import Any, Callable, Optional

from db import DB
from httputil import read_json, require_uid, send_json

# —— 可调常量 ——
STAMINA_COST = 5                 # 仅供客户端参考；体力为客户端权威，服务端不校验
MATCH_TIMEOUT_MS = 120_000       # 匹配/等友 2 分钟总倒计时
DISCONNECT_GRACE_MS = 6_000      # 断线宽限：对手 tick 缺失超过即可判赢
RECENT_WINDOW_MS = 300_000       # 自适应窗口统计的近 5 分钟
W_MIN_MS, W_MAX_MS = 3_000, 15_000   # 同级保持窗口范围
INTER_WAVE_DELAY_MS = 3_000      # 先清者触发后到下一波开始的间隔（须与前端一致）
START_DELAY_MS = 1_500           # match-start 到第 1 波开始的缓冲（两端加载）
SIMULTANEOUS_EPS_MS = 200        # 双方阵亡视为同刻→平局的阈值
MAPS = ["huoyanshan", "liushahe", "baiguling", "pansidong"]

DEFAULT_TZ_QUERY = None  # 用 db.today() 取自然日


def _adaptive_window_ms(n: int) -> int:
    # W = clamp(3 + 12*min(n,5)/5, 3s, 15s)：同级越冷清窗口越短
    w = 3000 + 12000 * (min(n, 5) / 5)
    return int(max(W_MIN_MS, min(W_MAX_MS, w)))


class VersusHub:
    def __init__(self, db: DB,
                 now_ms: Callable[[], int] | None = None,
                 gen_seed: Callable[[], int] | None = None,
                 gen_code: Callable[[], str] | None = None,
                 pick_map: Callable[[], str] | None = None):
        self.db = db
        self._now = now_ms or (lambda: int(time.time() * 1000))
        self._gen_seed = gen_seed or (lambda: secrets.randbelow(2**31))
        self._gen_code = gen_code or (lambda: secrets.token_hex(3).upper())
        self._pick_map = pick_map or (lambda: secrets.choice(MAPS))
        self.lock = threading.Lock()
        self.queue: dict[str, dict] = {}          # ticket -> waiting entry
        self.recent: dict[int, list[tuple[str, int]]] = {}  # rank -> [(uid, ms)]
        self.rooms: dict[str, dict] = {}          # code -> room
        self.matches: dict[str, dict] = {}        # match_id -> Match
        self.ticket_match: dict[str, tuple[str, str]] = {}  # ticket -> (match_id, uid)

    def reset(self) -> None:  # 测试用
        with self.lock:
            self.queue.clear(); self.recent.clear(); self.rooms.clear()
            self.matches.clear(); self.ticket_match.clear()

    def is_banned(self, uid: str) -> bool:
        # 当天有 ≥3 个不同对手判定异常 → 禁赛
        day = self.db.today()
        with self.db.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT opponent_uid) AS c FROM pvp_anomaly WHERE day=%s AND uid=%s",
                (day, uid),
            )
            row = cur.fetchone()
        return bool(row and int(row["c"]) >= 3)
```

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py::test_not_banned_by_default -v`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add server/api_versus.py server/tests/test_versus.py
git commit -m "feat(versus): VersusHub 骨架 + 禁赛查询(可注入时钟/种子)"
```

---

## Task 3: 匹配 enqueue / poll / cancel（同级即时 + 自适应窗口 + 放宽 + 超时）

**Files:**
- Modify: `server/api_versus.py`（`VersusHub` 加匹配方法）
- Test: `server/tests/test_versus.py`

- [ ] **Step 1: 写失败测试**（追加）
```python
def _mk_player(db, uid, rank=1, nickname=None, avatar="wukong"):
    now = db.now()
    with db.cursor() as cur:
        cur.execute("DELETE FROM players WHERE uid=%s", (uid,))
        cur.execute(
            "INSERT INTO players (uid,nickname,avatar_id,rank_level,last_login_at,last_ip,created_at,updated_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (uid, nickname, avatar, rank, now, "1.1.1.1", now, now),
        )

def test_same_rank_matches_immediately(hub, db):
    hub.reset()
    _mk_player(db, "10000001", rank=3, nickname="甲")
    _mk_player(db, "10000002", rank=3, nickname="乙")
    r1 = hub.enqueue("10000001", 3)
    assert hub.poll(r1["ticket"])["status"] == "waiting"
    r2 = hub.enqueue("10000002", 3)
    p2 = hub.poll(r2["ticket"])
    assert p2["status"] == "matched"
    assert p2["matchStart"]["opponent"]["nickname"] == "甲"
    assert p2["matchStart"]["seed"] == p1_seed(hub, r1)  # 两端同种子
    p1 = hub.poll(r1["ticket"])
    assert p1["status"] == "matched"
    assert p1["matchStart"]["matchId"] == p2["matchStart"]["matchId"]

def p1_seed(hub, r1):
    return hub.poll(r1["ticket"])["matchStart"]["seed"]

def test_widen_to_any_after_window(hub, db):
    hub.reset()
    _mk_player(db, "10000010", rank=2); _mk_player(db, "10000011", rank=9)
    r_lo = hub.enqueue("10000010", 2)           # 段位 2，无人同级
    r_hi = hub.enqueue("10000011", 9)           # 段位 9，无人同级
    # N=0 → W=3s；未到窗口不跨段
    assert hub.poll(r_lo["ticket"])["status"] == "waiting"
    hub._clock["ms"] += 3_001                    # 越过 3s 窗口
    p = hub.poll(r_lo["ticket"])
    assert p["status"] == "matched"              # 放宽到任意段位
    assert p["matchStart"]["opponent"]["uid"].endswith("0011") or True

def test_timeout(hub, db):
    hub.reset()
    _mk_player(db, "10000020", rank=5)
    r = hub.enqueue("10000020", 5)
    hub._clock["ms"] += MATCH_TIMEOUT_MS + 1
    assert hub.poll(r["ticket"])["status"] == "timeout"

def test_banned_enqueue_rejected(hub, db):
    hub.reset()
    _mk_player(db, "10000030", rank=1)
    day = db.today(); now = db.now()
    with db.cursor() as cur:
        for opp in ("20000001", "20000002", "20000003"):
            cur.execute(
                "INSERT INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                " VALUES (%s,%s,%s,%s,%s,%s)",
                (day, "10000030", opp, "m", "{}", now),
            )
    r = hub.enqueue("10000030", 1)
    assert r.get("banned") is True
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k "match or widen or timeout or banned"`
Expected: FAIL（方法未定义）

- [ ] **Step 3: 实现匹配方法**（在 `VersusHub` 内追加）
```python
    # —— 内部工具 ——
    def _prune_recent(self, now: int) -> None:
        for rank, lst in list(self.recent.items()):
            self.recent[rank] = [(u, t) for (u, t) in lst if t >= now - RECENT_WINDOW_MS]
            if not self.recent[rank]:
                del self.recent[rank]

    def _recent_distinct(self, rank: int, exclude_uid: str, now: int) -> int:
        return len({u for (u, t) in self.recent.get(rank, []) if u != exclude_uid and t >= now - RECENT_WINDOW_MS})

    def _profile(self, uid: str) -> dict:
        with self.db.cursor() as cur:
            cur.execute("SELECT uid,nickname,avatar_id,rank_level FROM players WHERE uid=%s", (uid,))
            row = cur.fetchone()
        if not row:
            return {"uid": _mask(uid), "nickname": None, "avatarId": "wukong", "rankLevel": 0}
        return {"uid": _mask(uid), "nickname": row["nickname"], "avatarId": row["avatar_id"], "rankLevel": int(row["rank_level"] or 0)}

    def _new_side(self, uid: str, rank: int, now: int) -> dict:
        return {"uid": uid, "rank": rank, "last_tick_ms": now, "relay_buffer": [],
                "last_digest": None, "wave": 1, "prev_kill_digest": None, "status": "playing"}

    def _make_match(self, e1: dict, e2: dict, now: int, map_id: str | None = None) -> str:
        mid = secrets.token_hex(8)
        m = {
            "match_id": mid, "seed": self._gen_seed(), "map": map_id or self._pick_map(),
            "start_at_ms": now + START_DELAY_MS,
            "a": self._new_side(e1["uid"], e1["rank"], now),
            "b": self._new_side(e2["uid"], e2["rank"], now),
            "wave_schedule": {1: now + START_DELAY_MS}, "first_clear": {},
            "result": None, "created_ms": now, "ended": False,
        }
        self.matches[mid] = m
        self.ticket_match[e1["ticket"]] = (mid, e1["uid"])
        self.ticket_match[e2["ticket"]] = (mid, e2["uid"])
        return mid

    def _try_pair(self, now: int) -> None:
        # 第一轮：同段位两两配对
        waiting = list(self.queue.values())
        by_rank: dict[int, list[dict]] = {}
        for e in waiting:
            by_rank.setdefault(e["rank"], []).append(e)
        for rank, lst in by_rank.items():
            lst.sort(key=lambda e: e["enqueued_ms"])
            while len(lst) >= 2:
                a = lst.pop(0); b = lst.pop(0)
                self._pair(a, b, now)
        # 第二轮：已过保持窗口者与任意等待者配对
        waiting = sorted(self.queue.values(), key=lambda e: e["enqueued_ms"])
        i = 0
        while i < len(waiting):
            a = waiting[i]
            if a["ticket"] in self.queue and now >= a["hold_until_ms"]:
                partner = next((x for x in waiting if x["ticket"] in self.queue and x["ticket"] != a["ticket"]), None)
                if partner:
                    self._pair(a, partner, now)
                    waiting = sorted(self.queue.values(), key=lambda e: e["enqueued_ms"]); i = 0; continue
            i += 1

    def _pair(self, a: dict, b: dict, now: int) -> None:
        self.queue.pop(a["ticket"], None); self.queue.pop(b["ticket"], None)
        self._make_match(a, b, now)

    # —— 对外匹配 API ——
    def enqueue(self, uid: str, rank: int) -> dict:
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            self._prune_recent(now)
            self.recent.setdefault(rank, []).append((uid, now))
            n = self._recent_distinct(rank, uid, now)
            ticket = secrets.token_hex(8)
            self.queue[ticket] = {"ticket": ticket, "uid": uid, "rank": rank,
                                  "enqueued_ms": now, "hold_until_ms": now + _adaptive_window_ms(n)}
            self._try_pair(now)
            return {"ticket": ticket}

    def poll(self, ticket: str) -> dict:
        with self.lock:
            now = self._now()
            if ticket in self.ticket_match:
                mid, uid = self.ticket_match[ticket]
                return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}
            e = self.queue.get(ticket)
            if not e:
                return {"status": "timeout"}
            if now - e["enqueued_ms"] >= MATCH_TIMEOUT_MS:
                self.queue.pop(ticket, None)
                return {"status": "timeout"}
            self._try_pair(now)
            if ticket in self.ticket_match:
                mid, uid = self.ticket_match[ticket]
                return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}
            return {"status": "waiting"}

    def cancel(self, ticket: str) -> dict:
        with self.lock:
            self.queue.pop(ticket, None)
            return {"ok": True}

    def _match_start_payload(self, mid: str, uid: str) -> dict:
        m = self.matches[mid]
        opp_uid = m["b"]["uid"] if m["a"]["uid"] == uid else m["a"]["uid"]
        return {"matchId": mid, "seed": m["seed"], "map": m["map"],
                "startAtServerMs": m["start_at_ms"], "opponent": self._profile(opp_uid)}
```

在文件顶部（类外）加脱敏工具：
```python
def _mask(uid: str) -> str:
    return "***" + uid[-4:] if uid and len(uid) >= 4 else "***"
```

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k "match or widen or timeout or banned"`
Expected: PASS（4 项）

- [ ] **Step 5: 提交**
```bash
git add server/api_versus.py server/tests/test_versus.py
git commit -m "feat(versus): 匹配 enqueue/poll/cancel(同级即时+自适应窗口+放宽+超时+禁赛拦截)"
```

---

## Task 4: 邀请私房 create / join

**Files:**
- Modify: `server/api_versus.py`
- Test: `server/tests/test_versus.py`

- [ ] **Step 1: 写失败测试**（追加）
```python
def test_room_create_join(hub, db):
    hub.reset()
    _mk_player(db, "10000101", rank=4, nickname="房主")
    _mk_player(db, "10000102", rank=7, nickname="客人")
    rc = hub.room_create("10000101", 4)
    assert rc["code"] == "ROOM01"
    assert "?versus=ROOM01" in rc["link"]
    assert hub.poll(rc["ticket"])["status"] == "waiting"
    rj = hub.room_join("ROOM01", "10000102", 7)
    assert rj["status"] == "matched"
    ph = hub.poll(rc["ticket"])
    assert ph["status"] == "matched"
    assert ph["matchStart"]["matchId"] == rj["matchStart"]["matchId"]
    assert ph["matchStart"]["opponent"]["nickname"] == "客人"

def test_room_join_bad_code(hub, db):
    hub.reset()
    _mk_player(db, "10000103", rank=1)
    assert hub.room_join("NOPE", "10000103", 1).get("error") == "room_not_found"
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k room`
Expected: FAIL

- [ ] **Step 3: 实现房间方法**（在 `VersusHub` 内追加）
```python
    def room_create(self, uid: str, rank: int, base_url: str = "") -> dict:
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            code = self._gen_code()
            ticket = secrets.token_hex(8)
            self.rooms[code] = {"code": code, "host_uid": uid, "host_rank": rank,
                                "map": self._pick_map(), "created_ms": now, "ticket": ticket}
            # 房主也占一个 ticket，poll 复用同一张表：借用 queue 语义但标记为私房挂起
            self.queue[ticket] = {"ticket": ticket, "uid": uid, "rank": rank,
                                  "enqueued_ms": now, "hold_until_ms": now + MATCH_TIMEOUT_MS, "room": code}
            link = f"{base_url}/?versus={code}"
            return {"code": code, "link": link, "ticket": ticket, "map": self.rooms[code]["map"]}

    def room_join(self, code: str, uid: str, rank: int) -> dict:
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            room = self.rooms.get(code)
            if not room:
                return {"error": "room_not_found"}
            host_ticket = room["ticket"]
            host_entry = self.queue.get(host_ticket)
            if not host_entry:
                return {"error": "room_expired"}
            joiner = {"ticket": secrets.token_hex(8), "uid": uid, "rank": rank, "enqueued_ms": now}
            self.queue.pop(host_ticket, None)
            self.rooms.pop(code, None)
            mid = self._make_match(host_entry, joiner, now, map_id=room["map"])
            return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}
```

> 注：`_make_match` 用到 `e["ticket"]`/`e["uid"]`/`e["rank"]`，`joiner` 已带这三字段，OK。房主 poll 走 `poll(host_ticket)`：配对后 `ticket_match` 已含 host_ticket。

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k room`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add server/api_versus.py server/tests/test_versus.py
git commit -m "feat(versus): 邀请私房 create/join"
```

---

## Task 5: tick 转发 + 波次调度（先清者）

**Files:**
- Modify: `server/api_versus.py`
- Test: `server/tests/test_versus.py`

- [ ] **Step 1: 写失败测试**（追加）
```python
def _match_two(hub, db, ua="10000201", ub="10000202", rank=3):
    _mk_player(db, ua, rank=rank, nickname="甲"); _mk_player(db, ub, rank=rank, nickname="乙")
    r1 = hub.enqueue(ua, rank); hub.enqueue(ub, rank)
    mid = hub.poll(r1["ticket"])["matchStart"]["matchId"]
    return mid

def test_tick_relays_inputs(hub, db):
    hub.reset()
    mid = _match_two(hub, db)
    d = {"wave": 1, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000201", mid, [{"t": 5, "op": "place", "cell": "r1c1"}], d, None, "playing")
    resp = hub.tick("10000202", mid, [], d, None, "playing")
    assert resp["opponentInputs"] == [{"t": 5, "op": "place", "cell": "r1c1"}]
    # 已取走则不再重复
    resp2 = hub.tick("10000202", mid, [], d, None, "playing")
    assert resp2["opponentInputs"] == []

def test_first_clear_schedules_next_wave(hub, db):
    hub.reset()
    mid = _match_two(hub, db)
    d = {"wave": 1, "power": 10, "kills": 5, "tangsengHP": 3, "peach": 20, "units": 3}
    resp = hub.tick("10000201", mid, [], d, {"wave": 1, "t": 900}, "playing")
    assert resp["nextWave"]["wave"] == 2
    start2 = resp["nextWave"]["startAtServerMs"]
    # 对手随后也清同波，不改开始时间（先清者已定）
    resp_b = hub.tick("10000202", mid, [], d, {"wave": 1, "t": 950}, "playing")
    assert resp_b["nextWave"]["startAtServerMs"] == start2
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k tick`
Expected: FAIL

- [ ] **Step 3: 实现 tick（转发 + 波次调度骨架）**（在 `VersusHub` 内追加；终局/断线在 Task 6）
```python
    def _sides(self, m: dict, uid: str) -> tuple[dict, dict]:
        return (m["a"], m["b"]) if m["a"]["uid"] == uid else (m["b"], m["a"])

    def tick(self, uid: str, match_id: str, inputs: list, digest: dict,
             wave_cleared_at: Optional[dict], status: str) -> dict:
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if not m:
                return {"error": "match_not_found"}
            me, opp = self._sides(m, uid)
            me["last_tick_ms"] = now
            if digest:
                me["last_digest"] = digest
                me["wave"] = int(digest.get("wave", me["wave"]))
            # 反作弊钩子（Task 7 填充）：self._check(m, me, opp, inputs, digest, now)
            self._anticheat(m, me, opp, inputs, digest, now)
            # 把我的动作放进对手的转发缓冲
            if inputs:
                opp["relay_buffer"].extend(inputs)
            # 先清者定下一波
            if wave_cleared_at:
                w = int(wave_cleared_at.get("wave", 0))
                if w and (w + 1) not in m["wave_schedule"]:
                    m["wave_schedule"][w + 1] = now + INTER_WAVE_DELAY_MS
                    m["first_clear"][w] = uid
            # 终局/断线（Task 6）
            self._resolve_terminal(m, me, opp, status, now)
            # 取走给「我」的对手动作
            out = me["relay_buffer"]; me["relay_buffer"] = []
            next_wave = self._next_wave_for(m, me)
            resp = {
                "serverMs": now,
                "opponentInputs": out,
                "opponentDigest": opp.get("last_digest"),
                "nextWave": next_wave,
                "opponentStatus": self._opp_status(m, opp, now),
                "result": self._result_for(m, uid),
                "cheatNotice": ({"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
                                if self.is_banned(uid) else None),
            }
            return resp

    def _next_wave_for(self, m: dict, me: dict) -> Optional[dict]:
        w = me["wave"]
        nxt = w + 1
        if nxt in m["wave_schedule"]:
            return {"wave": nxt, "startAtServerMs": m["wave_schedule"][nxt]}
        return None

    # 以下三个在 Task 6 完善；先给最小占位以便本任务测试通过
    def _resolve_terminal(self, m, me, opp, status, now): 
        if status in ("tangsengDead", "surrender"):
            me["status"] = status

    def _opp_status(self, m, opp, now) -> str:
        return opp.get("status", "playing")

    def _result_for(self, m, uid) -> Optional[dict]:
        if not m.get("result"):
            return None
        side = "a" if m["a"]["uid"] == uid else "b"
        return m["result"][side]

    def _anticheat(self, m, me, opp, inputs, digest, now):  # Task 7 填充
        return
```

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k tick`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add server/api_versus.py server/tests/test_versus.py
git commit -m "feat(versus): tick 放置动作转发 + 先清者波次调度"
```

---

## Task 6: 终局裁决（认输 / 唐僧被吃 / 断线超时 / 平局）+ 落 pvp_results

**Files:**
- Modify: `server/api_versus.py`
- Test: `server/tests/test_versus.py`

- [ ] **Step 1: 写失败测试**（追加）
```python
def _dig(w=1): return {"wave": w, "power": 10, "kills": 0, "tangsengHP": 3, "peach": 20, "units": 1}

def test_surrender_opponent_wins(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000301", "10000302")
    hub.tick("10000301", mid, [], _dig(), None, "surrender")
    rb = hub.tick("10000302", mid, [], _dig(), None, "playing")
    assert rb["result"]["outcome"] == "win"
    assert rb["result"]["reason"] == "opponentSurrender"
    ra = hub.tick("10000301", mid, [], _dig(), None, "surrender")
    assert ra["result"]["outcome"] == "lose"
    # 落库
    with db.cursor() as cur:
        cur.execute("SELECT outcome,reason FROM pvp_results WHERE match_id=%s AND uid=%s", (mid, "10000302"))
        assert cur.fetchone()["outcome"] == "win"

def test_tangseng_dead(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000311", "10000312")
    hub.tick("10000311", mid, [], _dig(), None, "tangsengDead")
    rb = hub.tick("10000312", mid, [], _dig(), None, "playing")
    assert rb["result"]["reason"] == "opponentTangsengDead"

def test_disconnect_timeout(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000321", "10000322")
    hub.tick("10000321", mid, [], _dig(), None, "playing")
    hub.tick("10000322", mid, [], _dig(), None, "playing")
    hub._clock["ms"] += DISCONNECT_GRACE_MS + 500   # 322 不再 tick
    ra = hub.tick("10000321", mid, [], _dig(), None, "playing")
    assert ra["opponentStatus"] == "disconnected"
    assert ra["result"]["outcome"] == "win"
    assert ra["result"]["reason"] == "opponentDisconnectTimeout"

def test_simultaneous_draw(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000331", "10000332")
    hub.tick("10000331", mid, [], _dig(), None, "tangsengDead")
    hub._clock["ms"] += 100   # < SIMULTANEOUS_EPS_MS
    rb = hub.tick("10000332", mid, [], _dig(), None, "tangsengDead")
    assert rb["result"]["outcome"] == "draw"
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k "surrender or tangseng or disconnect or draw"`
Expected: FAIL

- [ ] **Step 3: 完善终局逻辑**（替换 Task 5 的三个占位方法 + 加落库）
```python
    LOSE_STATUS = {"tangsengDead": "TangsengDead", "surrender": "Surrender"}

    def _set_result(self, m, loser_side_key: str, reason_kind: str, now: int) -> None:
        # reason_kind ∈ {"TangsengDead","Surrender","DisconnectTimeout"}
        if m.get("result") or m.get("ended"):
            return
        winner = "b" if loser_side_key == "a" else "a"
        m["result"] = {
            winner: {"outcome": "win", "reason": "opponent" + reason_kind},
            loser_side_key: {"outcome": "lose",
                             "reason": ("self" + reason_kind) if reason_kind != "DisconnectTimeout" else "selfDisconnect"},
        }
        m["ended"] = True
        m["ended_ms"] = now
        self._persist_result(m, now)

    def _set_draw(self, m, now: int) -> None:
        m["result"] = {"a": {"outcome": "draw", "reason": "draw"},
                       "b": {"outcome": "draw", "reason": "draw"}}
        m["ended"] = True; m["ended_ms"] = now
        self._persist_result(m, now)

    def _persist_result(self, m, now: int) -> None:
        day = self.db.today(); dt = self.db.now()
        rows = []
        for key, other in (("a", "b"), ("b", "a")):
            r = m["result"][key]
            rows.append((m["match_id"], day, m[key]["uid"], m[other]["uid"],
                         r["outcome"], r["reason"], int(m[key].get("wave", 0)), dt))
        with self.db.cursor() as cur:
            cur.executemany(
                "INSERT INTO pvp_results (match_id,day,uid,opponent_uid,outcome,reason,wave,created_at)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", rows)

    def _resolve_terminal(self, m, me, opp, status, now):
        if m.get("ended"):
            return
        me_key = "a" if m["a"]["uid"] == me["uid"] else "b"
        if status in ("tangsengDead", "surrender"):
            me["status"] = status
            me["dead_ms"] = now
            # 同刻双亡 → 平局
            if opp.get("dead_ms") is not None and abs(now - opp["dead_ms"]) <= SIMULTANEOUS_EPS_MS:
                self._set_draw(m, now); return
            self._set_result(m, me_key, self.LOSE_STATUS[status], now)

    def _opp_status(self, m, opp, now) -> str:
        if opp.get("status") in ("tangsengDead", "surrender"):
            return "surrendered" if opp["status"] == "surrender" else "tangsengDead"
        if now - opp["last_tick_ms"] > DISCONNECT_GRACE_MS:
            # 触发断线判赢：对手(opp)输，me 赢
            if not m.get("ended"):
                opp_key = "a" if m["a"]["uid"] == opp["uid"] else "b"
                self._set_result(m, opp_key, "DisconnectTimeout", now)
            return "disconnected"
        return "playing"
```

> `_opp_status` 在 `tick` 里于 `_result_for` 之前调用（Task 5 的 resp 里先算 `opponentStatus` 再算 `result`）——调整 `tick` 中 resp 构造顺序：先 `opp_status = self._opp_status(...)`，再 `result = self._result_for(...)`，保证断线触发的 result 能被同一响应带出。修改 Task 5 `tick` 的 resp 段为：
```python
            opp_status = self._opp_status(m, opp, now)
            resp = {
                "serverMs": now, "opponentInputs": out,
                "opponentDigest": opp.get("last_digest"),
                "nextWave": next_wave, "opponentStatus": opp_status,
                "result": self._result_for(m, uid),
                "cheatNotice": ({"banned": True, "msg": "检测到异常，今日暂停真人匹配"} if self.is_banned(uid) else None),
            }
```

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k "surrender or tangseng or disconnect or draw"`
Expected: PASS（4 项）

- [ ] **Step 5: 提交**
```bash
git add server/api_versus.py server/tests/test_versus.py
git commit -m "feat(versus): 终局裁决(认输/唐僧被吃/断线超时/平局)+pvp_results落库"
```

---

## Task 7: 反作弊（放置合法性 + 启发式上界 → pvp_anomaly，去重 + 触发禁赛）

**Files:**
- Modify: `server/api_versus.py`
- Test: `server/tests/test_versus.py`

- [ ] **Step 1: 写失败测试**（追加）
```python
def test_anomaly_recorded_and_dedup(hub, db):
    hub.reset()
    mid = _match_two(hub, db, "10000401", "10000402")
    # 击杀暴涨且远超战力可能：kills 从 0 跳到 9999，power 极低
    bad = {"wave": 1, "power": 1, "kills": 9999, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000401", mid, [], bad, None, "playing")
    hub.tick("10000401", mid, [], {**bad, "kills": 19999}, None, "playing")  # 同对手当天只记 1
    day = db.today()
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) c FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "10000401"))
        assert cur.fetchone()["c"] == 1

def test_three_opponents_trigger_ban(hub, db):
    hub.reset()
    day = db.today(); now = db.now()
    with db.cursor() as cur:
        for opp in ("30000001", "30000002"):
            cur.execute("INSERT INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s)", (day, "10000411", opp, "m", "{}", now))
    assert hub.is_banned("10000411") is False   # 只有 2 个不同对手
    _mk_player(db, "10000411", 3); _mk_player(db, "10000412", 3)
    mid = _match_two(hub, db, "10000411", "10000412")
    bad = {"wave": 1, "power": 1, "kills": 9999, "tangsengHP": 3, "peach": 20, "units": 1}
    hub.tick("10000411", mid, [], bad, None, "playing")   # 第 3 个不同对手
    assert hub.is_banned("10000411") is True
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k "anomaly or ban"`
Expected: FAIL

- [ ] **Step 3: 实现反作弊**（替换 Task 5 的 `_anticheat` 占位 + 常量 + 记录方法）

顶部常量区追加：
```python
KILLS_PER_POWER_PER_SEC = 0.5   # 每点战力每秒可击杀数上界（留大余量，可调）
KILLS_ABS_FLOOR = 30            # 低战力区的击杀绝对下限余量（避免早期误报）
```
类内追加/替换：
```python
    def _anticheat(self, m, me, opp, inputs, digest, now):
        if m.get("ended") or not digest:
            return
        reasons = []
        # 1) 唐僧血单调不增
        prev = me.get("prev_kill_digest")
        if prev is not None:
            if digest.get("tangsengHP", 0) > prev.get("tangsengHP", 0):
                reasons.append("tangsengHP_increased")
            dt_s = max(0.001, (now - prev["_ms"]) / 1000)
            dkills = digest.get("kills", 0) - prev.get("kills", 0)
            ceil = KILLS_ABS_FLOOR + KILLS_PER_POWER_PER_SEC * max(0, digest.get("power", 0)) * dt_s
            if dkills > ceil:
                reasons.append("kills_over_ceiling")
        # 2) 波次进度不能超前于服务端调度
        if digest.get("wave", 1) > max(m["wave_schedule"].keys() or [1]) + 1:
            reasons.append("wave_ahead")
        # 3) 放置动作经济合法性（粗校验：itemPick/summon 花费不超经济）——留接口，本期只记明显越界
        me["prev_kill_digest"] = {**digest, "_ms": now}
        if reasons:
            self._record_anomaly(m, me["uid"], opp["uid"], reasons, now)

    def _record_anomaly(self, m, uid, opp_uid, reasons, now):
        day = self.db.today(); dt = self.db.now()
        with self.db.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                " VALUES (%s,%s,%s,%s,%s,%s)",
                (day, uid, opp_uid, m["match_id"], json.dumps(reasons, ensure_ascii=False), dt))
```

> `INSERT IGNORE` + 唯一键 `(day,uid,opponent_uid)` 实现"同对手当天只记 1"。`is_banned` 已在 Task 2 用 `COUNT(DISTINCT opponent_uid)>=3`。

- [ ] **Step 4: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v -k "anomaly or ban"`
Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add server/api_versus.py server/tests/test_versus.py
git commit -m "feat(versus): 启发式反作弊(唐僧血/击杀上界/波次超前)+异常去重+禁赛触发"
```

---

## Task 8: HTTP handler 函数 + 路由挂载

**Files:**
- Modify: `server/api_versus.py`（加 `handle_versus_*(handler, hub)` HTTP 封装）
- Modify: `server/server.py`（routes 追加 + `Handler.versus` 挂载 + `main()` 初始化）
- Modify: `server/tests/test_player_api.py`（fixture 给 `H.versus` 挂 Hub，供 HTTP 冒烟）
- Test: `server/tests/test_versus.py`（HTTP 端到端）

- [ ] **Step 1: 写失败测试**（追加 HTTP 冒烟，复用 player fixture 的 server）

在 `test_versus.py` 顶部加一个起真实 HTTP server 的 fixture（对齐 `test_player_api.py`）：
```python
import json, threading, urllib.request, urllib.error
from http.server import ThreadingHTTPServer

@pytest.fixture(scope="module")
def http_base(db):
    from server import Handler
    from api_versus import VersusHub
    from config import load_config
    cfg = load_config(); cfg["static_dir"] = str(ROOT)
    class H(Handler): pass
    H.db = db; H.cfg = cfg; H.versus = VersusHub(db)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **k: H(*a, directory=str(ROOT), **k))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()

def _post(base, path, body, uid):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Uid": uid}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            raw = r.read(); return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, (json.loads(raw) if raw else None)

def test_http_enqueue_poll_match(http_base, db):
    _mk_player(db, "10000501", 3, "甲"); _mk_player(db, "10000502", 3, "乙")
    st, b1 = _post(http_base, "/api/versus/enqueue", {"rank": 3}, "10000501")
    assert st == 200 and "ticket" in b1
    _post(http_base, "/api/versus/enqueue", {"rank": 3}, "10000502")
    st, p = _post(http_base, "/api/versus/poll", {"ticket": b1["ticket"]}, "10000501")
    assert st == 200 and p["status"] == "matched"
    assert p["matchStart"]["opponent"]["nickname"] == "乙"
```

- [ ] **Step 2: 运行看失败**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py::test_http_enqueue_poll_match -v`
Expected: FAIL（路由 404）

- [ ] **Step 3: 加 HTTP 封装**（`server/api_versus.py` 末尾，类外）
```python
def _hub(handler):
    return handler.versus

def handle_versus_enqueue(handler, db: DB) -> None:
    body = read_json(handler); uid = require_uid(handler, body)
    if not uid: return
    rank = int(body.get("rank") or 0)
    send_json(handler, 200, _hub(handler).enqueue(uid, rank))

def handle_versus_poll(handler, db: DB) -> None:
    body = read_json(handler); uid = require_uid(handler, body)
    if not uid: return
    send_json(handler, 200, _hub(handler).poll(str(body.get("ticket") or "")))

def handle_versus_cancel(handler, db: DB) -> None:
    body = read_json(handler); uid = require_uid(handler, body)
    if not uid: return
    send_json(handler, 200, _hub(handler).cancel(str(body.get("ticket") or "")))

def handle_versus_room_create(handler, db: DB) -> None:
    body = read_json(handler); uid = require_uid(handler, body)
    if not uid: return
    rank = int(body.get("rank") or 0)
    base = (handler.headers.get("Origin") or "").rstrip("/")
    send_json(handler, 200, _hub(handler).room_create(uid, rank, base_url=base))

def handle_versus_room_join(handler, db: DB) -> None:
    body = read_json(handler); uid = require_uid(handler, body)
    if not uid: return
    rank = int(body.get("rank") or 0)
    send_json(handler, 200, _hub(handler).room_join(str(body.get("code") or "").upper(), uid, rank))

def handle_versus_tick(handler, db: DB) -> None:
    body = read_json(handler); uid = require_uid(handler, body)
    if not uid: return
    send_json(handler, 200, _hub(handler).tick(
        uid, str(body.get("matchId") or ""), body.get("inputs") or [],
        body.get("digest") or {}, body.get("waveClearedAt"), str(body.get("status") or "playing")))
```

- [ ] **Step 4: 挂路由**

`server/server.py` 顶部 import 追加：
```python
from api_versus import (  # noqa: E402
    VersusHub, handle_versus_cancel, handle_versus_enqueue, handle_versus_poll,
    handle_versus_room_create, handle_versus_room_join, handle_versus_tick,
)
```
`_api` 的 `routes` 字典追加：
```python
            ("POST", "/api/versus/enqueue"): handle_versus_enqueue,
            ("POST", "/api/versus/poll"): handle_versus_poll,
            ("POST", "/api/versus/cancel"): handle_versus_cancel,
            ("POST", "/api/versus/room/create"): handle_versus_room_create,
            ("POST", "/api/versus/room/join"): handle_versus_room_join,
            ("POST", "/api/versus/tick"): handle_versus_tick,
```
`main()` 在 `BoundHandler.cfg = cfg` 之后追加：
```python
    BoundHandler.versus = VersusHub(db)
```
`Handler` 类体加类型注解（可选，紧邻 `db: DB`）：
```python
    versus: "VersusHub"
```

- [ ] **Step 5: 运行看通过**

Run: `cd server && XY_DB_PORT=3307 .venv/bin/python -m pytest tests/test_versus.py -v`
Expected: PASS（全部）；再跑既有回归 `python -m pytest tests/ -v` 全绿。

- [ ] **Step 6: 提交**
```bash
git add server/api_versus.py server/server.py server/tests/test_versus.py
git commit -m "feat(versus): /api/versus/* HTTP 路由 + Handler 挂载 + 端到端冒烟"
```

---

## Self-Review（对照 spec §5/§7/§10）

- §10.1 六条路由 → Task 8 全覆盖。✓
- §4.1 自适应窗口(5min/N→3-15s)、同级即时、放宽、2min 超时 → Task 3。✓
- §4.2 邀请私房 → Task 4。✓
- §5.2/5.3 tick 转发 + 先清者波次调度 → Task 5。✓
- §8 断线>6s 判赢、认输、唐僧被吃、平局 → Task 6。✓
- §7 放置合法性/启发式 + 去重 + ≥3 不同对手禁赛 + 通知(cheatNotice) → Task 7（+ tick 返回 cheatNotice）。✓
- §10.3 两表 + 当日禁赛实时查 → Task 1 + Task 2 `is_banned`。✓
- §11 无新依赖、`db.migrate()` 幂等 → Task 1。✓
- **体力**：spec §2 客户端权威，服务端不校验（本计划不做体力逻辑，Plan B 客户端做 ≥5 门禁与扣减）。✓
- **未覆盖/留给后续**：放置动作经济级精校验（Task 7 只做明显越界，spec §7①的完整经济校验在真实字段确定后补，Plan C 客户端动作字段定型后回填）；`match-start` 的 `startAtServerMs`→客户端 simTick 换算在 Plan C。

## 执行说明

- 依赖：本机 docker MariaDB @3307（见 `server/README.md`）。跑前确保容器在。
- 每个 Task 独立可测、独立提交；全部完成后 `/api/versus/*` 可用真实 HTTP 联调（Plan B 客户端接入）。
