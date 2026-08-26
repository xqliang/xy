# 微信账号系统接入（openid 登录 + 会话令牌）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给微信小游戏接入 `wx.login`→`code2session`→openid 登录，叠加服务端会话令牌鉴权，老玩家匿名进度平滑迁移，Web 端与旧客户端在灰度期不受影响。

**Architecture:** openid 存映射表指向现有数字 uid（8 张业务表零迁移）。登录端点签发 `sessions.token`，`require_auth` 校验 Bearer token；`auth.strict=false` 时无 token 回退认 X-Uid（灰度）。前端启动先 `bootstrapAuth()` 拿 token，再走原有 `cloudLogin()`。

**Tech Stack:** 服务端 Python（stdlib http.server + pymysql + urllib，无新依赖）；前端 TS（Vite + vitest）；测试 pytest（MariaDB）+ vitest（node）。

**设计依据:** `docs/superpowers/specs/2026-08-26-wechat-account-login-design.md`

---

## 关键环境约束（executing engineer 必读）

- **服务端测试 DB 端口是 3308**，不是文件里默认的 3307（3307 被外部项目占用）。所有 pytest 命令必须带 `XY_DB_PORT=3308`。
- **vitest 必须在 `web/` 目录跑**（`vitest.config.ts` 的 include 只收 `web/tests/**`）。
- **web typecheck 基线不干净**：`main` 上 `tsc` 已有约 28 处既有报错。验收标准是「不新增」，不是全绿。
- 改了 PvP 相关（WS 握手 / main.ts PvP 接线）→ 收尾必须跑 **ai-balance** 门禁。
- 真机 `code2session` 需真实 AppID+AppSecret，本环境无法自动化，属人工验证（见 Task 12）。
- 每个 Task 末尾提交；提交信息沿用仓库风格（`feat(server):` / `feat(web):` / `test(...)`）。

## 文件结构

**新增**
- `server/wechat_auth.py` —— `code2session(cfg, code)` 调微信 REST 换 openid。
- `server/auth_session.py` —— `issue_token` / `resolve_token`，token 的签发与校验（DB）。
- `server/tests/test_auth.py` —— 登录/绑定/迁移/token/灰度/并发 集成 + 单元测试。
- `web/src/auth-token.ts` —— token 的本地读写（`getToken`/`saveToken`/`clearToken`）。**单独成文件是为打破 `api/client.ts` ↔ `auth.ts` 的循环依赖**（client 只依赖它，不依赖 auth.ts）。
- `web/src/auth.ts` —— `loginRequestBody`（纯）/`applyLoginResponse`/`bootstrapAuth`。
- `web/tests/auth.test.ts` —— 前端认证单测。

**修改**
- 服务端：`config.py`、`config.yaml`、`db.py`、`httputil.py`、`server.py`、`api_player.py`、`api_versus.py`、`api_events.py`、`api_leaderboard.py`。
- 前端：`platform.ts`、`api/client.ts`、`pvp-ws.ts`、`main.ts`。

---

## Task 1: 服务端配置（wechat + auth 段）

**Files:**
- Modify: `server/config.py`（`load_config` 末尾，`data.setdefault("tos", ...)` 之前）
- Modify: `server/config.yaml`
- Test: `server/tests/test_auth.py`（新建，先放纯配置测试，无需 DB）

- [ ] **Step 1: 写失败测试**

新建 `server/tests/test_auth.py`：

```python
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_config_has_wechat_and_auth_defaults():
    from config import load_config

    cfg = load_config()
    assert "wechat" in cfg and set(cfg["wechat"]) >= {"appid", "secret"}
    assert cfg["auth"]["strict"] is False          # 默认灰度：不强制 token
    assert int(cfg["auth"]["session_days"]) == 30


def test_auth_strict_env_override(monkeypatch):
    monkeypatch.setenv("XY_AUTH_STRICT", "true")
    from config import load_config

    cfg = load_config()
    assert cfg["auth"]["strict"] is True
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -v`
Expected: FAIL（`KeyError: 'wechat'` 或 `'auth'`）。

- [ ] **Step 3: 实现 config.py**

在 `server/config.py` 的 `load_config()` 里，`admin` 块之后、`data.setdefault("tos", ...)` 之前插入：

```python
    wechat = data.get("wechat") or {}
    data["wechat"] = {
        "appid": wechat.get("appid", ""),
        "secret": wechat.get("secret", ""),
    }
    auth = data.get("auth") or {}
    strict = auth.get("strict", False)
    # 环境变量优先（运维灰度切换用），接受 true/1/yes
    env_strict = os.environ.get("XY_AUTH_STRICT")
    if env_strict is not None:
        strict = env_strict.strip().lower() in ("1", "true", "yes", "on")
    data["auth"] = {
        "strict": bool(strict),
        "session_days": int(auth.get("session_days", 30)),
    }
```

- [ ] **Step 4: 更新 config.yaml**

在 `server/config.yaml` 末尾追加（真实 AppID/Secret 上线前由人工填）：

```yaml
wechat:
  appid: ""      # 小游戏 AppID
  secret: ""     # AppSecret —— 仅服务端持有，绝不进客户端包
auth:
  strict: false  # 灰度：false=无 token 回退认 X-Uid；前端全量带 token 后置 true
  session_days: 30
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -v`
Expected: PASS（2 passed）。

- [ ] **Step 6: 提交**

```bash
git add server/config.py server/config.yaml server/tests/test_auth.py
git commit -m "feat(server): config 增加 wechat(appid/secret) 与 auth(strict/session_days) 段"
```

---

## Task 2: DB schema —— wx_identities + sessions 两张表

**Files:**
- Modify: `server/db.py`（`SCHEMA` 列表末尾追加两条 CREATE TABLE）
- Test: `server/tests/test_auth.py`

- [ ] **Step 1: 写失败测试**

在 `test_auth.py` 顶部补 DB 夹具（复用 `test_player_api.py` 模式，但用**独立库名** `xy_game_authtest` 隔离）：

```python
import threading
from http.server import ThreadingHTTPServer

import pytest

DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),   # 实跑请用 XY_DB_PORT=3308
    "XY_DB_USER": os.environ.get("XY_DB_USER", "root"),
    "XY_DB_PASSWORD": os.environ.get("XY_DB_PASSWORD", ""),
    "XY_DB_NAME": os.environ.get("XY_DB_NAME", "xy_game_authtest"),
    "XY_AGG_INTERVAL": "3600",
}

_ALL_TABLES = ("sessions", "wx_identities", "pvp_anomaly", "pvp_results",
               "events", "daily_stats", "daily_leaderboard", "player_avatars", "players")


def _fresh_db():
    import pymysql

    for k, v in DSN_ENV.items():
        os.environ[k] = v
    conn = pymysql.connect(host=DSN_ENV["XY_DB_HOST"], port=int(DSN_ENV["XY_DB_PORT"]),
                           user=DSN_ENV["XY_DB_USER"], password=DSN_ENV["XY_DB_PASSWORD"],
                           charset="utf8mb4", autocommit=True)
    with conn.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DSN_ENV['XY_DB_NAME']}` CHARACTER SET utf8mb4")
        cur.execute(f"USE `{DSN_ENV['XY_DB_NAME']}`")
        for t in _ALL_TABLES:
            cur.execute(f"DROP TABLE IF EXISTS {t}")
    conn.close()

    from config import load_config
    from db import DB

    db = DB(load_config())
    db.migrate()
    return db


@pytest.fixture(scope="module")
def db():
    return _fresh_db()


def test_migrate_creates_wx_and_session_tables(db):
    now = db.now()
    with db.cursor() as cur:
        cur.execute("INSERT INTO wx_identities (openid, unionid, uid, created_at) VALUES (%s,%s,%s,%s)",
                    ("openid_x", None, "1000000000000001", now))
        cur.execute("INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                    ("t" * 64, "1000000000000001", "wx", now, now))
        cur.execute("SELECT uid FROM wx_identities WHERE openid=%s", ("openid_x",))
        assert cur.fetchone()["uid"] == "1000000000000001"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py::test_migrate_creates_wx_and_session_tables -v`
Expected: FAIL（`Table 'xy_game_authtest.wx_identities' doesn't exist`）。

- [ ] **Step 3: 实现 db.py**

在 `server/db.py` 的 `SCHEMA` 列表末尾（最后一条 `pvp_anomaly` 之后）追加：

```python
    # 微信身份映射：openid → 内部数字 uid。openid 主键 + 绑定用 ON DUPLICATE KEY，保证并发只绑一次。
    """
    CREATE TABLE IF NOT EXISTS wx_identities (
      openid  VARCHAR(64) NOT NULL PRIMARY KEY,
      unionid VARCHAR(64) NULL,
      uid     VARCHAR(20) NOT NULL,
      created_at DATETIME NOT NULL,
      KEY idx_uid (uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    # 会话令牌：token → uid，滑动过期。expires_at 索引便于将来清理过期行。
    """
    CREATE TABLE IF NOT EXISTS sessions (
      token   CHAR(64) NOT NULL PRIMARY KEY,
      uid     VARCHAR(20) NOT NULL,
      platform VARCHAR(8) NOT NULL,
      created_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      KEY idx_uid (uid),
      KEY idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -v`
Expected: PASS（含 Task 1 的 3 个）。

- [ ] **Step 5: 提交**

```bash
git add server/db.py server/tests/test_auth.py
git commit -m "feat(server): 新增 wx_identities / sessions 表（openid 映射 + 会话令牌）"
```

---

## Task 3: wechat_auth.code2session（换 openid）

**Files:**
- Create: `server/wechat_auth.py`
- Test: `server/tests/test_auth.py`

- [ ] **Step 1: 写失败测试**

在 `test_auth.py` 追加（monkeypatch `urllib.request.urlopen`，不打真实微信）：

```python
def _fake_urlopen(payload: bytes):
    import contextlib

    @contextlib.contextmanager
    def _cm(url, timeout=5):
        class _R:
            def read(self_inner):
                return payload
        yield _R()
    return _cm


def test_code2session_success(monkeypatch):
    import json as _json
    import urllib.request

    import wechat_auth

    monkeypatch.setattr(urllib.request, "urlopen",
                        _fake_urlopen(_json.dumps({"openid": "oABC123", "session_key": "sk", "unionid": "u1"}).encode()))
    cfg = {"wechat": {"appid": "wxappid", "secret": "sec"}}
    out = wechat_auth.code2session(cfg, "somecode")
    assert out["openid"] == "oABC123"
    assert out["unionid"] == "u1"


def test_code2session_errcode_raises(monkeypatch):
    import json as _json
    import urllib.request

    import wechat_auth

    monkeypatch.setattr(urllib.request, "urlopen",
                        _fake_urlopen(_json.dumps({"errcode": 40029, "errmsg": "invalid code"}).encode()))
    cfg = {"wechat": {"appid": "wxappid", "secret": "sec"}}
    with pytest.raises(wechat_auth.WxAuthError) as ei:
        wechat_auth.code2session(cfg, "badcode")
    assert ei.value.code == 40029


def test_code2session_not_configured_raises():
    import wechat_auth

    with pytest.raises(wechat_auth.WxAuthError):
        wechat_auth.code2session({"wechat": {"appid": "", "secret": ""}}, "x")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k code2session -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'wechat_auth'`）。

- [ ] **Step 3: 实现 wechat_auth.py**

```python
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

WX_CODE2SESSION = "https://api.weixin.qq.com/sns/jscode2session"


class WxAuthError(Exception):
    """微信换取 openid 失败。code>0 为微信 errcode；code<0 为本地错误（未配置/网络/解析）。"""

    def __init__(self, code: int, msg: str):
        super().__init__(f"wx auth error {code}: {msg}")
        self.code = code
        self.msg = msg


def code2session(cfg: dict[str, Any], code: str) -> dict[str, Any]:
    wx = cfg.get("wechat") or {}
    appid = wx.get("appid") or ""
    secret = wx.get("secret") or ""
    if not appid or not secret:
        raise WxAuthError(-1, "wechat appid/secret not configured")
    if not code:
        raise WxAuthError(-2, "empty code")
    qs = urllib.parse.urlencode({
        "appid": appid, "secret": secret,
        "js_code": code, "grant_type": "authorization_code",
    })
    url = f"{WX_CODE2SESSION}?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read()
    except OSError as e:  # 网络/超时
        raise WxAuthError(-3, f"network error: {e}") from e
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise WxAuthError(-4, f"bad response: {e}") from e
    errcode = int(data.get("errcode") or 0)
    if errcode != 0:
        raise WxAuthError(errcode, str(data.get("errmsg") or "wx error"))
    openid = data.get("openid")
    if not openid:
        raise WxAuthError(-5, "no openid in response")
    return {"openid": openid, "session_key": data.get("session_key"), "unionid": data.get("unionid")}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k code2session -v`
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add server/wechat_auth.py server/tests/test_auth.py
git commit -m "feat(server): wechat_auth.code2session 调微信 REST 换 openid（stdlib urllib）"
```

---

## Task 4: auth_session —— token 签发与校验

**Files:**
- Create: `server/auth_session.py`
- Test: `server/tests/test_auth.py`

- [ ] **Step 1: 写失败测试**

```python
def test_issue_and_resolve_token(db):
    import auth_session

    token, expires = auth_session.issue_token(db, "1000000000000009", "web", days=30)
    assert len(token) == 64
    assert auth_session.resolve_token(db, token) == "1000000000000009"


def test_resolve_unknown_and_expired_token(db):
    from datetime import timedelta

    import auth_session

    assert auth_session.resolve_token(db, "") is None
    assert auth_session.resolve_token(db, "z" * 64) is None
    # 手插一条已过期 session
    now = db.now()
    with db.cursor() as cur:
        cur.execute("INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                    ("e" * 64, "1000000000000010", "web", now - timedelta(days=2), now - timedelta(days=1)))
    assert auth_session.resolve_token(db, "e" * 64) is None
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k token -v`
Expected: FAIL（`No module named 'auth_session'`）。

- [ ] **Step 3: 实现 auth_session.py**

```python
from __future__ import annotations

import secrets
from datetime import timedelta

from db import DB


def issue_token(db: DB, uid: str, platform: str, days: int = 30) -> tuple[str, str]:
    """签发一条会话令牌，返回 (token, expires_at 字符串)。"""
    token = secrets.token_hex(32)  # 64 hex chars
    now = db.now()
    expires = now + timedelta(days=days)
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
            (token, uid, platform, now, expires),
        )
    return token, expires.strftime("%Y-%m-%d %H:%M:%S")


def resolve_token(db: DB, token: str, renew_days: int = 30) -> str | None:
    """校验 token：命中且未过期返回 uid 并滑动续期；否则 None。"""
    if not token:
        return None
    now = db.now()
    with db.cursor() as cur:
        cur.execute("SELECT uid, expires_at FROM sessions WHERE token=%s", (token,))
        row = cur.fetchone()
        if not row:
            return None
        if row["expires_at"] is not None and row["expires_at"] < now:
            return None
        cur.execute("UPDATE sessions SET expires_at=%s WHERE token=%s", (now + timedelta(days=renew_days), token))
        return row["uid"]
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k token -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/auth_session.py server/tests/test_auth.py
git commit -m "feat(server): auth_session 签发/校验会话令牌（滑动过期）"
```

---

## Task 5: httputil —— bearer_token + require_auth（带灰度回退）

**Files:**
- Modify: `server/httputil.py`（新增两函数，`require_uid` 保留不动）
- Test: `server/tests/test_auth.py`（用轻量 FakeHandler 直接单测）

- [ ] **Step 1: 写失败测试**

```python
class _FakeHandler:
    """最小假 handler：只提供 require_auth 需要的 headers/cfg，并捕获 send_json 的状态码。"""

    def __init__(self, headers, cfg):
        self.headers = headers          # dict：.get() 兼容
        self.cfg = cfg
        self.sent_status = None
        self.sent_body = None

    # httputil.send_json 会调用这些；此处仅记录，不真发
    def send_response(self, status): self.sent_status = status
    def send_header(self, *a, **k): pass
    def end_headers(self): pass
    class _W:
        def write(self, b): pass
    wfile = _W()


def test_require_auth_token_ok(db):
    import auth_session
    import httputil

    token, _ = auth_session.issue_token(db, "1000000000000021", "wx")
    h = _FakeHandler({"Authorization": f"Bearer {token}"}, {"auth": {"strict": True}})
    assert httputil.require_auth(h, db) == "1000000000000021"


def test_require_auth_strict_no_token_401(db):
    import httputil

    h = _FakeHandler({}, {"auth": {"strict": True}})
    assert httputil.require_auth(h, db) is None
    assert h.sent_status == 401


def test_require_auth_fallback_xuid_when_not_strict(db):
    import httputil

    h = _FakeHandler({"X-Uid": "1000000000000022"}, {"auth": {"strict": False}})
    assert httputil.require_auth(h, db) == "1000000000000022"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k require_auth -v`
Expected: FAIL（`AttributeError: module 'httputil' has no attribute 'require_auth'`）。

- [ ] **Step 3: 实现 httputil.py**

在 `server/httputil.py` 末尾追加：

```python
def bearer_token(handler: BaseHTTPRequestHandler) -> str:
    auth = handler.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def require_auth(handler: BaseHTTPRequestHandler, db, body: dict[str, Any] | None = None) -> str | None:
    """统一鉴权：优先 Bearer token；token 缺失/失效时，strict=True→401，否则回退认 X-Uid（灰度）。"""
    from auth_session import resolve_token  # 局部导入避免模块级循环

    token = bearer_token(handler)
    if token:
        uid = resolve_token(db, token)
        if uid:
            return uid
    strict = bool(((getattr(handler, "cfg", None) or {}).get("auth") or {}).get("strict", False))
    if strict:
        send_json(handler, 401, {"error": {"code": "unauthorized", "msg": "login required"}})
        return None
    return require_uid(handler, body)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k require_auth -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/httputil.py server/tests/test_auth.py
git commit -m "feat(server): httputil.require_auth（Bearer token + strict 灰度回退 X-Uid）"
```

---

## Task 6: /api/auth/login 端点（绑定 + 迁移 + 签发 token）

**Files:**
- Modify: `server/api_player.py`（抽 `_login_upsert`；新增 `_gen_uid`/`_bind_openid`/`handle_auth_login`）
- Modify: `server/server.py`（import + 路由）
- Test: `server/tests/test_auth.py`

- [ ] **Step 1: 写失败测试**

需要起真实 HTTP server（复用 `test_player_api.py` 的 `server_base` 模式，但 monkeypatch code2session）。追加：

```python
def _req(base, method, path, body=None, token=None, headers=None):
    import json as _json
    import urllib.error
    import urllib.request

    data = None if body is None else _json.dumps(body).encode()
    hdr = {"Content-Type": "application/json"}
    if token:
        hdr["Authorization"] = f"Bearer {token}"
    if headers:
        hdr.update(headers)
    req = urllib.request.Request(base + path, data=data, headers=hdr, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read()
            return resp.status, (_json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (_json.loads(raw) if raw else None)


@pytest.fixture(scope="module")
def server_base():
    db = _fresh_db()
    from config import load_config
    from server import Handler

    cfg = load_config()
    cfg["static_dir"] = str(ROOT)
    from db import DB
    H_db = DB(cfg)

    class H(Handler):
        pass
    H.db = H_db
    H.cfg = cfg

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **k: H(*a, directory=str(ROOT), **k))
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}", H_db, cfg
    httpd.shutdown()


def test_auth_login_wx_binds_local_uid_and_issues_token(server_base, monkeypatch):
    base, _db, _cfg = server_base
    import wechat_auth

    monkeypatch.setattr(wechat_auth, "code2session",
                        lambda cfg, code: {"openid": "openid_new", "session_key": "sk", "unionid": None})
    # 老玩家：带本机匿名 uid → 迁移绑定
    st, body = _req(base, "POST", "/api/auth/login",
                    {"platform": "wx", "code": "c1", "uid": "1000000000000100"})
    assert st == 200
    assert body["uid"] == "1000000000000100"    # 继承本机 uid
    assert len(body["token"]) == 64
    # 同 openid 再登录（不带本机 uid）→ 命中既有绑定，返回同一 uid
    st, body2 = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "c2"})
    assert st == 200 and body2["uid"] == "1000000000000100"


def test_auth_login_web_tofu(server_base):
    base, _db, _cfg = server_base
    st, body = _req(base, "POST", "/api/auth/login", {"platform": "web", "uid": "1000000000000200"})
    assert st == 200
    assert body["uid"] == "1000000000000200"
    assert len(body["token"]) == 64
    # 拿 token 访问受保护接口
    st, me = _req(base, "GET", "/api/player/me", token=body["token"])
    assert st == 200 and me["uid"] == "1000000000000200"


def test_auth_login_wx_bad_code_4xx(server_base, monkeypatch):
    base, _db, _cfg = server_base
    import wechat_auth

    def _boom(cfg, code):
        raise wechat_auth.WxAuthError(40029, "invalid code")
    monkeypatch.setattr(wechat_auth, "code2session", _boom)
    st, body = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "bad"})
    assert st == 401
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k auth_login -v`
Expected: FAIL（404 not_found：路由尚未注册）。

- [ ] **Step 3: 重构 api_player.handle_login 抽出 _login_upsert**

把 `handle_login` 里建/更新 players 行 + `_ensure_defaults` 的逻辑抽成函数，`handle_login` 改为调用它（行为不变）：

```python
def _login_upsert(db: DB, uid: str, ip: str) -> None:
    now = db.now()
    row = _player_row(db, uid)
    if not row:
        with db.cursor() as cur:
            cur.execute(
                """
                INSERT INTO players (uid, nickname, avatar_id, rank_level, last_login_at, last_ip, created_at, updated_at)
                VALUES (%s, NULL, 'wukong', 0, %s, %s, %s, %s)
                """,
                (uid, now, ip, now, now),
            )
    else:
        with db.cursor() as cur:
            cur.execute(
                "UPDATE players SET last_login_at=%s, last_ip=%s, updated_at=%s WHERE uid=%s",
                (now, ip, now, uid),
            )
    _ensure_defaults(db, uid)
```

`handle_login` 中把原来的 upsert+`_ensure_defaults` 段替换为 `_login_upsert(db, uid, ip)`（其余不变）。

- [ ] **Step 4: 新增 _gen_uid / _bind_openid / handle_auth_login**

`api_player.py` 顶部 import 补充：

```python
import random

from auth_session import issue_token
from httputil import client_ip, ok_uid, read_json, require_uid, send_json  # 补 ok_uid
```

新增：

```python
def _gen_uid(db: DB) -> str:
    """服务端生成 16 位数字 uid（与前端 randomUid 同格式），避开已存在的行。"""
    for _ in range(10):
        uid = str(random.randint(10 ** 15, 10 ** 16 - 1))
        if not _player_row(db, uid):
            return uid
    return str(random.randint(10 ** 15, 10 ** 16 - 1))


def _bind_openid(db: DB, openid: str, unionid: str | None, local_uid: str | None) -> str:
    """openid→uid：已绑返回旧 uid；未绑则绑 local_uid（老玩家迁移）或新建。并发安全靠 openid 主键。"""
    now = db.now()
    with db.cursor() as cur:
        cur.execute("SELECT uid FROM wx_identities WHERE openid=%s", (openid,))
        row = cur.fetchone()
        if row:
            return row["uid"]
        uid = local_uid or _gen_uid(db)
        # 并发下同 openid 只保留首次绑定：ON DUPLICATE 做 no-op，随后回读取权威 uid
        cur.execute(
            "INSERT INTO wx_identities (openid, unionid, uid, created_at) VALUES (%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE openid=openid",
            (openid, unionid, uid, now),
        )
        cur.execute("SELECT uid FROM wx_identities WHERE openid=%s", (openid,))
        return cur.fetchone()["uid"]


def handle_auth_login(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    platform = (body.get("platform") or "web").strip()
    ip = client_ip(handler)
    if platform == "wx":
        from wechat_auth import WxAuthError, code2session

        try:
            sess = code2session(handler.cfg, body.get("code") or "")
        except WxAuthError as e:
            status = 429 if e.code == 45011 else (502 if e.code < 0 and e.code != -2 else 401)
            send_json(handler, status, {"error": {"code": "wx_auth", "msg": e.msg}})
            return
        local = body.get("uid")
        uid = _bind_openid(db, sess["openid"], sess.get("unionid"), local if ok_uid(local) else None)
    else:
        uid = body.get("uid")
        if not ok_uid(uid):
            send_json(handler, 400, {"error": {"code": "bad_uid", "msg": "invalid uid"}})
            return
    _login_upsert(db, uid, ip)
    days = int((handler.cfg.get("auth") or {}).get("session_days", 30))
    token, expires = issue_token(db, uid, platform, days=days)
    row = _player_row(db, uid)
    assert row
    out = _public_player(row, _unlocked(db, uid))
    out["saveJson"] = row["save_json"]
    out["token"] = token
    out["expiresAt"] = expires
    send_json(handler, 200, out)
```

- [ ] **Step 5: 注册路由（server.py）**

`server/server.py` import 段把 `handle_auth_login` 加入 `from api_player import (...)`；`_api` 的 `routes` 字典加一行：

```python
            ("POST", "/api/auth/login"): handle_auth_login,
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k auth_login -v`
Expected: PASS（3 passed）。

- [ ] **Step 7: 回归 —— 旧 player API 不受影响**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_player_api.py -v`
Expected: PASS（`auth.strict=false` 回退 X-Uid，旧接口原样工作）。

- [ ] **Step 8: 提交**

```bash
git add server/api_player.py server/server.py server/tests/test_auth.py
git commit -m "feat(server): /api/auth/login —— openid 绑定/迁移/新建 + 签发会话令牌"
```

---

## Task 7: 各 HTTP handler 切换到 require_auth

**Files:**
- Modify: `server/api_player.py`（`handle_me`/`handle_sync`/`handle_profile`/`handle_unlock`）
- Modify: `server/api_leaderboard.py`（`handle_submit`/`handle_daily`）
- Modify: `server/api_events.py`（`handle_events`）
- Test: `server/tests/test_auth.py`

- [ ] **Step 1: 写失败测试（token 可访问受保护接口；strict 下无 token 被拒）**

```python
def test_protected_endpoints_accept_token(server_base):
    base, _db, _cfg = server_base
    _st, body = _req(base, "POST", "/api/auth/login", {"platform": "web", "uid": "1000000000000300"})
    token = body["token"]
    for method, path, payload in [
        ("POST", "/api/player/sync", {"saveJson": "{}", "saveUpdatedAt": 5}),
        ("POST", "/api/leaderboard/submit", {"rankLevel": 1}),
        ("POST", "/api/events", {"events": [{"type": "login", "payload": {}}]}),
    ]:
        st, _ = _req(base, method, path, payload, token=token)
        assert st == 200, (path, st)


def test_strict_mode_rejects_missing_token(server_base):
    base, _db, cfg = server_base
    cfg["auth"]["strict"] = True         # 运行时切 strict，模拟灰度关回退
    try:
        st, _ = _req(base, "GET", "/api/player/me", headers={"X-Uid": "1000000000000300"})
        assert st == 401
    finally:
        cfg["auth"]["strict"] = False    # 复位，勿污染同 module 其它用例
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k "protected or strict_mode" -v`
Expected: FAIL（strict 用例返回 400/200 而非 401：handler 仍用 `require_uid`）。

- [ ] **Step 3: 替换各 handler 的鉴权调用**

机械替换（每处 `require_uid` → `require_auth`，并把 `db` 传入）：

- `api_player.py`：`handle_me` 内 `require_uid(handler)` → `require_auth(handler, db)`；`handle_sync`/`handle_profile`/`handle_unlock` 内 `require_uid(handler, body)` → `require_auth(handler, db, body)`。import 补 `require_auth`。
- `api_leaderboard.py`：`handle_submit` 内 `require_uid(handler, body)` → `require_auth(handler, db, body)`；`handle_daily` 内 `require_uid(handler)` → `require_auth(handler, db)`。import 从 `httputil` 补 `require_auth`。
- `api_events.py`：`handle_events` 内 `require_uid(handler, body)` → `require_auth(handler, db, body)`。import 补 `require_auth`。

> 注：这些 handler 签名已是 `(handler, db)`，`db` 现成可用。`require_uid` 仍被 `require_auth` 内部回退调用，不删。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -v`
Expected: PASS（全部）。

- [ ] **Step 5: 全量回归**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_player_api.py tests/test_versus.py -v`
Expected: PASS（灰度回退保证旧 X-Uid 路径不炸）。

- [ ] **Step 6: 提交**

```bash
git add server/api_player.py server/api_leaderboard.py server/api_events.py server/tests/test_auth.py
git commit -m "feat(server): player/leaderboard/events 各 handler 切到 require_auth"
```

---

## Task 8: WebSocket 握手鉴权（token 优先，灰度回退 uid）

**Files:**
- Modify: `server/api_versus.py`（新增 `_ws_authenticate`；改 `handle_versus_ws` 取 uid 处）
- Test: `server/tests/test_auth.py`

- [ ] **Step 1: 写失败测试**

```python
def test_ws_authenticate_token_and_fallback(db):
    import api_versus
    import auth_session

    token, _ = auth_session.issue_token(db, "1000000000000401", "wx")
    # token 优先
    assert api_versus._ws_authenticate({"token": [token]}, db, strict=True) == "1000000000000401"
    # 非 strict：回退 ?uid=，且不做数字格式校验（兼容既有 uid=A1 测试）
    assert api_versus._ws_authenticate({"uid": ["A1"]}, db, strict=False) == "A1"
    # strict：无 token → None
    assert api_versus._ws_authenticate({"uid": ["A1"]}, db, strict=True) is None
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k ws_authenticate -v`
Expected: FAIL（`module 'api_versus' has no attribute '_ws_authenticate'`）。

- [ ] **Step 3: 实现 _ws_authenticate 并接入 handle_versus_ws**

`api_versus.py` 新增（放在 `handle_versus_ws` 之前）：

```python
def _ws_authenticate(qs, db, strict: bool) -> str | None:
    """WS 握手鉴权：优先 ?token=；非 strict 时回退 ?uid=（不做数字格式校验，兼容旧客户端/测试）。"""
    from auth_session import resolve_token

    token = (qs.get("token") or [""])[0]
    if token:
        uid = resolve_token(db, token)
        if uid:
            return uid
    if strict:
        return None
    return (qs.get("uid") or [""])[0] or None
```

改 `handle_versus_ws`：把
```python
    uid = (qs.get("uid") or [""])[0]
```
替换为
```python
    strict = bool((handler.cfg.get("auth") or {}).get("strict", False))
    uid = _ws_authenticate(qs, hub.db, strict)
    if not uid:
        send_json(handler, 401, {"error": {"code": "unauthorized", "msg": "ws auth required"}})
        return
```

`api_versus.py` import 段（若需要）确认 `send_json` 已从 `httputil` 引入（现有已引 `require_uid, send_json`，无需改）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_auth.py -k ws_authenticate -v`
Expected: PASS。

- [ ] **Step 5: WS 全量回归（关键：uid=A1 类用例不能挂）**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest tests/test_versus_ws.py tests/test_ws.py -v`
Expected: PASS（非 strict 回退保证 `?uid=A1` 仍通）。

- [ ] **Step 6: 提交**

```bash
git add server/api_versus.py server/tests/test_auth.py
git commit -m "feat(server): PvP WS 握手鉴权 —— ?token= 优先，非 strict 回退 ?uid="
```

---

## Task 9: 前端 auth-token.ts（token 本地读写）

**Files:**
- Create: `web/src/auth-token.ts`
- Test: `web/tests/auth.test.ts`（新建，先放 token 读写用例）

- [ ] **Step 1: 写失败测试**

新建 `web/tests/auth.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getToken, saveToken, clearToken } from '../src/auth-token';

// 仿 battle-save.test.ts：node 环境装内存版 localStorage
function installMemStorage(): void {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
}

describe('auth-token 本地读写', () => {
  beforeEach(() => { installMemStorage(); });

  it('save→get 往返；clear 后为 null', () => {
    expect(getToken()).toBeNull();
    saveToken('abc123');
    expect(getToken()).toBe('abc123');
    clearToken();
    expect(getToken()).toBeNull();
  });

  it('saveToken 空串按清除处理', () => {
    saveToken('x');
    saveToken('');
    expect(getToken()).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/auth.test.ts`
Expected: FAIL（`Cannot find module '../src/auth-token'`）。

- [ ] **Step 3: 实现 auth-token.ts**

```typescript
// 会话令牌的本地读写。单独成文件：api/client.ts 只依赖它，避免与 auth.ts（依赖 apiFetch）循环。
import { storeGet, storeSet, storeRemove } from './storage';

const TOKEN_KEY = 'dasheng.token';

/** 读取会话令牌；无则 null。 */
export function getToken(): string | null {
  const t = storeGet(TOKEN_KEY);
  return t && t.length > 0 ? t : null;
}

/** 写入令牌；空串等价清除。 */
export function saveToken(token: string): void {
  if (!token) { storeRemove(TOKEN_KEY); return; }
  storeSet(TOKEN_KEY, token);
}

/** 清除令牌（401 时触发下次重登）。 */
export function clearToken(): void {
  storeRemove(TOKEN_KEY);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/auth.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add web/src/auth-token.ts web/tests/auth.test.ts
git commit -m "feat(web): auth-token 本地读写会话令牌"
```

---

## Task 10: 前端 auth.ts（登录请求体/应用响应/bootstrap）+ platform.wxLogin

**Files:**
- Modify: `web/src/platform.ts`（新增 `wxLogin`）
- Create: `web/src/auth.ts`
- Test: `web/tests/auth.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/tests/auth.test.ts` 追加：

```typescript
import { loginRequestBody, applyLoginResponse } from '../src/auth';
import { loadUserId } from '../src/user-id';

describe('auth 登录请求体（纯函数）', () => {
  it('wx 平台带 code 与本机 uid', () => {
    expect(loginRequestBody(true, 'CODE1', '1000000000000001'))
      .toEqual({ platform: 'wx', code: 'CODE1', uid: '1000000000000001' });
  });
  it('web 平台只带 uid，不带 code', () => {
    expect(loginRequestBody(false, null, '1000000000000002'))
      .toEqual({ platform: 'web', uid: '1000000000000002' });
  });
});

describe('auth 应用登录响应', () => {
  beforeEach(() => { installMemStorage(); });

  it('存 token；服务端返回不同 uid 时切换本机 uid', () => {
    applyLoginResponse({ token: 'tk1', uid: '1000000000000777', avatarId: 'wukong', unlockedAvatars: [] });
    expect(getToken()).toBe('tk1');
    expect(loadUserId()).toBe('1000000000000777');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/auth.test.ts`
Expected: FAIL（`Cannot find module '../src/auth'`）。

- [ ] **Step 3: 实现 platform.wxLogin**

`web/src/platform.ts` 追加（放在文件末尾，isWeChat 守卫内）：

```typescript
// 微信登录：wx.login 拿临时 code（换 openid 用）。Web/无 wx 返回 null。
export function wxLogin(): Promise<string | null> {
  if (!(isWeChat && typeof wx.login === 'function')) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      wx.login({
        success: (res: { code?: string }) => resolve(res?.code || null),
        fail: () => resolve(null),
      });
    } catch { resolve(null); }
  });
}
```

- [ ] **Step 4: 实现 auth.ts**

```typescript
// 平台登录编排：换取会话令牌，安置本机 uid。昵称/存档仍由随后的 cloudLogin 负责（本模块不碰）。
import { apiFetch } from './api/client';
import { getToken, saveToken, clearToken } from './auth-token';
import { wxLogin } from './platform';
import { ensureUserId, loadUserId, saveUserId } from './user-id';

export { getToken, clearToken };

export interface AuthLoginResp {
  token: string;
  expiresAt?: string;
  uid: string;
  nickname?: string | null;
  avatarId: string;
  unlockedAvatars: string[];
  saveJson?: string | null;
  saveUpdatedAt?: number | null;
}

/** 纯函数：按平台拼登录请求体。wx 带 code（可能为空，服务端会拒）；两端都带本机 uid（wx 用于迁移）。 */
export function loginRequestBody(
  isWx: boolean, code: string | null, localUid: string,
): { platform: 'wx' | 'web'; code?: string; uid: string } {
  if (isWx) return { platform: 'wx', code: code ?? '', uid: localUid };
  return { platform: 'web', uid: localUid };
}

/** 应用登录响应：存 token；若服务端返回的 uid 与本机不同（微信命中既有绑定）→ 切换本机 uid。 */
export function applyLoginResponse(resp: AuthLoginResp): void {
  if (resp.token) saveToken(resp.token);
  if (resp.uid && resp.uid !== loadUserId()) saveUserId(resp.uid);
}

/** 启动登录：微信 wx.login 拿 code→换 token；Web 用本机 uid TOFU。失败回退匿名，不阻塞进游戏。 */
export async function bootstrapAuth(): Promise<void> {
  const localUid = ensureUserId();
  let code: string | null = null;
  try { code = await wxLogin(); } catch { code = null; }
  const isWx = code !== null;   // wxLogin 仅微信下返回非 null
  const body = loginRequestBody(isWx, code, localUid);
  const res = await apiFetch<AuthLoginResp>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    uid: localUid,               // 灰度期同时带 X-Uid（apiFetch 默认行为）
  });
  if (res.ok) applyLoginResponse(res.data);
  // 失败：无 token，后续 apiFetch 回退 X-Uid（灰度期服务端允许）；strict 期由服务端 401，属预期需真机联调
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run tests/auth.test.ts`
Expected: PASS（全部）。

- [ ] **Step 6: 提交**

```bash
git add web/src/platform.ts web/src/auth.ts web/tests/auth.test.ts
git commit -m "feat(web): auth.ts 登录编排 + platform.wxLogin（wx.login 拿 code）"
```

---

## Task 11: apiFetch 带 Authorization + PvP WS URL 带 token

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/pvp-ws.ts`
- Test: `web/tests/auth.test.ts`

- [ ] **Step 1: 写失败测试**

追加（mock 全局 fetch，断言 Authorization 头；断言 WS URL 含 token）：

```typescript
import { vi } from 'vitest';
import { apiFetch } from '../src/api/client';
import { saveToken as _saveToken } from '../src/auth-token';
import { buildWsUrl } from '../src/pvp-ws';

describe('apiFetch 带 Authorization', () => {
  beforeEach(() => { installMemStorage(); });

  it('有 token 时带 Bearer 头', async () => {
    _saveToken('tok-xyz');
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = spy as unknown as typeof fetch;
    await apiFetch('/api/player/me', { method: 'GET' });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok-xyz');
  });
});

describe('buildWsUrl 带 token', () => {
  it('token 存在时追加 &token=', () => {
    const url = buildWsUrl('M1', 'A1', 'tok-1');
    expect(url).toContain('matchId=M1');
    expect(url).toContain('uid=A1');
    expect(url).toContain('token=tok-1');
  });
  it('无 token 时不追加', () => {
    expect(buildWsUrl('M1', 'A1')).not.toContain('token=');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/auth.test.ts`
Expected: FAIL（`buildWsUrl` 未导出 / Authorization 头为空）。

- [ ] **Step 3: 改 api/client.ts**

`web/src/api/client.ts`：import 补 `import { getToken } from '../auth-token';`；在 `apiFetch` 里设 X-Uid 之后追加：

```typescript
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
```

- [ ] **Step 4: 改 pvp-ws.ts**

把私有 `buildWsUrl` 改为**导出**并新增可选 `token` 参数：

```typescript
/** 由 location 推导 WS URL；有 token 追加 &token=。 */
export function buildWsUrl(matchId: string, uid: string, token?: string): string {
  let scheme: string;
  let host: string;
  if (typeof location !== 'undefined' && location) {
    scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    host = location.host;
  } else {
    scheme = 'ws://';
    host = 'localhost';
  }
  let url =
    scheme + host +
    '/api/versus/ws?matchId=' + encodeURIComponent(matchId) +
    '&uid=' + encodeURIComponent(uid);
  if (token) url += '&token=' + encodeURIComponent(token);
  return url;
}
```

找到 `PvpSocket` 内部调用 `buildWsUrl(...)` 的位置（原传 `matchId, uid`），改为传入 token：在 `PvpSocket` 的 opts 接口加可选 `token?: string`，构造 URL 时传 `this.opts.token`。若该类未存 opts.token，则在其构造/连接处 `buildWsUrl(matchId, uid, this.token)`（`this.token` 来自 opts）。

> 具体：在 `PvpSocket` 的 options 类型中加 `token?: string;`，构造函数保存 `this.token = opts.token`，连接处调用 `buildWsUrl(matchId, this.uid, this.token)`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run tests/auth.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/api/client.ts web/src/pvp-ws.ts web/tests/auth.test.ts
git commit -m "feat(web): apiFetch 带 Bearer 头；PvP WS URL 追加 &token="
```

---

## Task 12: main.ts 接线 + 全量门禁 + 灰度切换说明

**Files:**
- Modify: `web/src/main.ts`（启动接线 + PvpSocket 传 token）
- Test: 无新单测（main.ts 按仓库惯例不单测）；靠 typecheck + vitest 全量 + ai-balance + 人工浏览器/真机

- [ ] **Step 1: main.ts 引入 bootstrapAuth / getToken**

`web/src/main.ts` import 段追加：

```typescript
import { bootstrapAuth, getToken } from './auth';
```

- [ ] **Step 2: 启动时先 bootstrapAuth 再 cloudLogin**

找到启动 IIFE 里（约 `main.ts:536`）的 `ensureUserId();` 与随后的 `void cloudLogin().then(...)`。在 `ensureUserId();` 之后、`cloudLogin` 之前插入：

```typescript
    // 先换取会话令牌（微信=wx.login→code；Web=本机 uid TOFU），失败回退匿名不阻塞。
    await bootstrapAuth();
```

（该 IIFE 已是 async，`await` 合法。）

- [ ] **Step 3: PvpSocket 构造传 token**

找到 `main.ts` 里 `new PvpSocket({ matchId: ..., uid: ensureUserId(), ... })`（约 `main.ts:333`），在 opts 里加：

```typescript
    token: getToken() ?? undefined,
```

- [ ] **Step 4: typecheck（看不新增）**

Run: `cd web && npx tsc --noEmit 2>&1 | tail -40`
Expected: 仅既有基线报错（约 28 处），**无本次新增文件/改动相关的新报错**。逐条比对确认新增的 `auth.ts`/`auth-token.ts`/`platform.ts`/`client.ts`/`pvp-ws.ts`/`main.ts` 无新错。

- [ ] **Step 5: 前端全量 vitest**

Run: `cd web && npx vitest run`
Expected: PASS（新增 auth 用例 + 既有全绿）。

- [ ] **Step 6: ai-balance 门禁（改了 PvP 相关必跑）**

Run: `cd web && npx vitest run tests/ai-balance.test.ts`
Expected: PASS（胜率/平衡指标未破）。

- [ ] **Step 7: 服务端全量回归**

Run: `cd server && XY_DB_PORT=3308 .venv/bin/python -m pytest -v`
Expected: PASS（test_auth + player + versus + ws 全绿）。

- [ ] **Step 8: 提交**

```bash
git add web/src/main.ts
git commit -m "feat(web): 启动先 bootstrapAuth 换 token，PvpSocket 携带 token"
```

- [ ] **Step 9: 人工验证（本环境无法自动化）**

1. Web：`./start.sh dev`，浏览器打开首页——应无报错自动完成 `POST /api/auth/login {platform:'web'}`，Network 里后续请求带 `Authorization: Bearer`。
2. 微信小游戏：填真实 AppID→`wechat/project.config.json`、AppSecret→服务端 `config.yaml`；`WX_API_BASE=https://<域名> ./start.sh wx`；微信开发者工具打开 `wechat/`，验证 `wx.login`→`/api/auth/login {platform:'wx'}` 拿到 token、老账号迁移、PvP 对局 WS 带 token 可连。
3. 灰度切换：前端全量带 token 的版本上线并稳定后，服务端 `config.yaml` 置 `auth.strict: true`（或 `XY_AUTH_STRICT=true`）重启，关闭 X-Uid 回退。

---

## 自查（写完计划后回看 spec）

- **Spec 覆盖**：§4.1 配置→T1；§4.3 表→T2；§4.2 code2session→T3；§4.4 token→T4；§4.5 require_auth→T5/T7；§4.4 登录端点/迁移/新建→T6；§4.6 WS→T8；§5.1 wxLogin→T10；§5.2 auth.ts→T9/T10；§5.3 apiFetch→T11；§5.4 pvp-ws→T11；§5.5 main.ts→T12；§8 测试贯穿各 Task；§10 落地顺序=Task 顺序；§11 风险（真机人工）→T12 Step9。**全覆盖**。
- **占位符**：无 TBD/TODO；每个 code step 均为完整可粘贴代码。
- **命名一致**：`code2session`/`WxAuthError`/`issue_token`/`resolve_token`/`require_auth`/`bearer_token`/`_login_upsert`/`_bind_openid`/`_gen_uid`/`handle_auth_login`/`_ws_authenticate`（服务端）；`getToken`/`saveToken`/`clearToken`/`loginRequestBody`/`applyLoginResponse`/`bootstrapAuth`/`wxLogin`/`buildWsUrl`、token 键 `dasheng.token`（前端）——各 Task 引用一致。
- **对 spec 的两处细化（已在文首/文件结构标注）**：①token DB 逻辑落在新模块 `auth_session.py`，`require_auth` 仍在 `httputil`（spec §4.5 原文）；②前端 token 读写拆出 `auth-token.ts` 以破除 `client.ts`↔`auth.ts` 循环依赖。均不改变设计语义。
