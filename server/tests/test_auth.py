from __future__ import annotations

import os
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_ok_uid_rejects_trailing_newline():
    # \A...\Z 绝对锚定：尾随换行不再被 $ 放过（否则 "uid\n" 会绕过按精确串比较的守卫）
    from httputil import ok_uid

    assert ok_uid("12345678") is True
    assert ok_uid("12345678\n") is False
    assert ok_uid(" 12345678") is False
    assert ok_uid(None) is False


# ---- DB 夹具 ----
# 复用 test_player_api.py 的建库/建表模式，但特意换成独立库名 xy_game_authtest，
# 与 xy_game_test 隔离：鉴权相关表的建表/删表不会污染其它测试库。
# 端口默认 3307（与 test_player_api.py 保持一致），实跑请用 XY_DB_PORT=3308 覆盖。
DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),   # 实跑请用 XY_DB_PORT=3308
    "XY_DB_USER": os.environ.get("XY_DB_USER", "root"),
    "XY_DB_PASSWORD": os.environ.get("XY_DB_PASSWORD", ""),
    "XY_DB_NAME": os.environ.get("XY_DB_NAME", "xy_game_authtest"),
    "XY_AGG_INTERVAL": "3600",
}

# 迁移前要清空的全部表；新表（sessions / wx_identities）放最前面，
# 保证每个测试模块跑之前都是干净、可重复建表的库结构。
_ALL_TABLES = ("sessions", "wx_identities", "pvp_anomaly", "pvp_results",
               "events", "daily_stats", "daily_leaderboard", "player_avatars", "players")


def _fresh_db():
    """建一个干净的鉴权测试库：写好 DSN 环境变量 → 建库 → 删旧表 → 迁移出全新表结构。"""
    import pymysql

    # 把 DSN 落到进程环境，后续 load_config() 会据此连库。
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


def test_config_has_wechat_and_auth_defaults(monkeypatch):
    # 防御：若 shell/CI 预置了 XY_AUTH_STRICT，会让下面的 strict 默认值断言误挂，先清掉。
    monkeypatch.delenv("XY_AUTH_STRICT", raising=False)
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


def test_migrate_creates_wx_and_session_tables(db):
    # migrate() 后应能直接往两张新表写入并读回，验证建表语句真的生效。
    now = db.now()
    with db.cursor() as cur:
        cur.execute("INSERT INTO wx_identities (openid, unionid, uid, created_at) VALUES (%s,%s,%s,%s)",
                    ("openid_x", None, "1000000000000001", now))
        cur.execute("INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                    ("t" * 64, "1000000000000001", "wx", now, now))
        cur.execute("SELECT uid FROM wx_identities WHERE openid=%s", ("openid_x",))
        assert cur.fetchone()["uid"] == "1000000000000001"
        cur.execute("SELECT uid FROM sessions WHERE token=%s", ("t" * 64,))
        assert cur.fetchone()["uid"] == "1000000000000001"


# ---- wechat_auth.code2session（换 openid）----
# 这些用例 monkeypatch 掉 urllib.request.urlopen，不打真实微信接口，也不依赖数据库。
def _fake_urlopen(payload: bytes):
    """构造一个假的 urlopen：无论传什么 url，都返回预设的 payload 字节。

    urlopen 本身是上下文管理器（with ... as resp），所以这里用 contextmanager
    包一层，yield 出一个带 read() 的假响应对象来模拟真实响应。
    """
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

    with pytest.raises(wechat_auth.WxAuthError) as ei:
        wechat_auth.code2session({"wechat": {"appid": "", "secret": ""}}, "x")
    assert ei.value.code == -1


def test_code2session_non_dict_body_raises(monkeypatch):
    import json as _json
    import urllib.request

    import wechat_auth

    monkeypatch.setattr(urllib.request, "urlopen", _fake_urlopen(_json.dumps([1, 2, 3]).encode()))
    with pytest.raises(wechat_auth.WxAuthError) as ei:
        wechat_auth.code2session({"wechat": {"appid": "a", "secret": "s"}}, "c")
    assert ei.value.code == -4


# ---- auth_session.issue_token / resolve_token（会话令牌签发与校验）----
# 这些用例依赖数据库（sessions 表），跑之前请确保 XY_DB_PORT=3308。
def test_issue_and_resolve_token(db):
    import auth_session

    # 签发一条 30 天有效的令牌：token 必须是 64 位 hex，且立刻能反查回同一个 uid。
    token, expires = auth_session.issue_token(db, "1000000000000009", "web", days=30)
    assert len(token) == 64
    assert auth_session.resolve_token(db, token) == "1000000000000009"


def test_resolve_unknown_and_expired_token(db):
    from datetime import timedelta

    import auth_session

    # 空串 / 不存在的 token 都应判为无效（返回 None），不能抛异常。
    assert auth_session.resolve_token(db, "") is None
    assert auth_session.resolve_token(db, "z" * 64) is None
    # 手插一条已过期 session（created_at 两天前、expires_at 一天前），resolve 必须拒绝。
    now = db.now()
    with db.cursor() as cur:
        cur.execute("INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                    ("e" * 64, "1000000000000010", "web", now - timedelta(days=2), now - timedelta(days=1)))
    assert auth_session.resolve_token(db, "e" * 64) is None


def test_resolve_token_sliding_renewal_throttled(db):
    from datetime import timedelta

    import auth_session

    now = db.now()
    # 新鲜 token（剩余≈满窗口）：resolve 不应改写 expires_at（节流跳过）
    with db.cursor() as cur:
        cur.execute("INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                    ("f" * 64, "1000000000000011", "web", now, now + timedelta(days=30)))
        cur.execute("SELECT expires_at FROM sessions WHERE token=%s", ("f" * 64,))
        exp0 = cur.fetchone()["expires_at"]
    assert auth_session.resolve_token(db, "f" * 64, renew_days=30) == "1000000000000011"
    with db.cursor() as cur:
        cur.execute("SELECT expires_at FROM sessions WHERE token=%s", ("f" * 64,))
        assert cur.fetchone()["expires_at"] == exp0  # 未被改写（节流生效）

    # 临近过期 token（剩余 < 满窗口 - 1天）：resolve 应把 expires_at 向前滑动
    with db.cursor() as cur:
        cur.execute("INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                    ("g" * 64, "1000000000000012", "web", now, now + timedelta(hours=1)))
        cur.execute("SELECT expires_at FROM sessions WHERE token=%s", ("g" * 64,))
        near0 = cur.fetchone()["expires_at"]
    assert auth_session.resolve_token(db, "g" * 64, renew_days=30) == "1000000000000012"
    with db.cursor() as cur:
        cur.execute("SELECT expires_at FROM sessions WHERE token=%s", ("g" * 64,))
        assert cur.fetchone()["expires_at"] > near0  # 已滑动前移


# ---- httputil.require_auth（Bearer token + strict 灰度回退 X-Uid）----
# 用一个最小假 handler 直接单测 require_auth，不用起真 HTTP 服务：
# 它只提供 require_auth / send_json 需要的 headers、cfg，并把 send_json 的状态码记下来核对。
class _CIHeaders(dict):
    """大小写不敏感的 headers 桩，贴近真实 HTTPMessage 行为。"""
    def get(self, key, default=None):
        for k, v in self.items():
            if k.lower() == key.lower():
                return v
        return default


class _FakeHandler:
    """最小假 handler：只提供 require_auth 需要的 headers/cfg，并捕获 send_json 的状态码。"""

    def __init__(self, headers, cfg):
        self.headers = _CIHeaders(headers)   # 大小写不敏感，贴近真实 HTTPMessage
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


def test_require_auth_fail_closed_when_cfg_missing(db):
    import httputil
    # handler 无可用 cfg（异常/非标准调用方）→ 安全门禁 fail-closed，不得回退信任 X-Uid
    h = _FakeHandler({"X-Uid": "1000000000000032"}, None)
    assert httputil.require_auth(h, db) is None
    assert h.sent_status == 401


def test_require_auth_fail_closed_when_auth_not_dict(db):
    import httputil
    # auth 段类型异常（非 dict）→ 不崩溃，按 fail-closed 处理
    h = _FakeHandler({"X-Uid": "1000000000000032"}, {"auth": "oops"})
    assert httputil.require_auth(h, db) is None
    assert h.sent_status == 401


# ---- /api/auth/login 端到端（Task 6）----
# 起一个真 HTTP 服务，走完整路由 → handle_auth_login，覆盖：微信 openid 绑定/迁移/新建、
# web 平台首次信任（TOFU）、微信 code 失败映射为 4xx。code2session 用 monkeypatch 打桩，不打真实微信。
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
    # Task 8：versus HTTP 端点走 _hub(handler)=handler.versus；main() 外的测试 server 需自行挂 hub，
    # 否则 enqueue 通过鉴权后取 handler.versus 会 AttributeError→500。
    from api_versus import VersusHub
    H.versus = VersusHub(H_db)

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
    st, body = _req(base, "POST", "/api/auth/login",
                    {"platform": "wx", "code": "c1", "uid": "1000000000000100"})
    assert st == 200
    assert body["uid"] == "1000000000000100"
    assert len(body["token"]) == 64
    st, body2 = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "c2"})
    assert st == 200 and body2["uid"] == "1000000000000100"


def test_auth_login_web_tofu(server_base):
    base, db_handle, _cfg = server_base
    st, body = _req(base, "POST", "/api/auth/login", {"platform": "web", "uid": "1000000000000200"})
    assert st == 200
    assert body["uid"] == "1000000000000200"
    assert len(body["token"]) == 64
    # CORRECTION vs plan: /api/player/me still uses require_uid until Task 7, so we verify the
    # issued token resolves to the uid DIRECTLY (independent of Task 7's handler swap):
    from auth_session import resolve_token
    assert resolve_token(db_handle, body["token"]) == "1000000000000200"


def test_auth_login_web_refuses_wx_bound_uid(server_base, monkeypatch):
    base, _db, _cfg = server_base
    import wechat_auth
    # 先用微信把 uid 绑上 openid
    monkeypatch.setattr(wechat_auth, "code2session",
                        lambda cfg, code: {"openid": "openid_wb", "session_key": "s", "unionid": None})
    st, b = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "c", "uid": "1000000000000700"})
    assert st == 200 and b["uid"] == "1000000000000700"
    # 再用 web TOFU 冒领同一个已绑 uid → 必须拒绝，不发 token
    st, b2 = _req(base, "POST", "/api/auth/login", {"platform": "web", "uid": "1000000000000700"})
    assert st == 403
    assert b2 is None or "token" not in (b2 or {})


def test_auth_login_wx_bad_code_4xx(server_base, monkeypatch):
    base, _db, _cfg = server_base
    import wechat_auth

    def _boom(cfg, code):
        raise wechat_auth.WxAuthError(40029, "invalid code")
    monkeypatch.setattr(wechat_auth, "code2session", _boom)
    st, body = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "bad"})
    assert st == 401


def test_auth_login_wx_collision_guard_gets_fresh_uid(server_base, monkeypatch):
    # 已有 (O1 -> uidX)；O2 带同一 local_uid 登录 → 不得继承，必须拿到不同的新 uid
    base, db_handle, _cfg = server_base
    import wechat_auth
    monkeypatch.setattr(wechat_auth, "code2session",
                        lambda cfg, code: {"openid": "openid_c1", "session_key": "s", "unionid": None})
    st, b1 = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "x", "uid": "1000000000000500"})
    assert st == 200 and b1["uid"] == "1000000000000500"
    monkeypatch.setattr(wechat_auth, "code2session",
                        lambda cfg, code: {"openid": "openid_c2", "session_key": "s", "unionid": None})
    st, b2 = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "y", "uid": "1000000000000500"})
    assert st == 200
    assert b2["uid"] != "1000000000000500"  # 未继承他人已绑 uid


def test_auth_login_empty_code_400(server_base, monkeypatch):
    base, _db, _cfg = server_base
    import wechat_auth
    def _empty(cfg, code):
        raise wechat_auth.WxAuthError(-2, "empty code")
    monkeypatch.setattr(wechat_auth, "code2session", _empty)
    st, _ = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": ""})
    assert st == 400


def test_bind_openid_concurrent_same_openid_one_uid(server_base, monkeypatch):
    # 兑现设计 §8「并发同 openid 只绑一个 uid」：两线程同时首登同一 openid → 同一 uid，且只有一行
    base, db_handle, _cfg = server_base
    import threading
    import wechat_auth
    monkeypatch.setattr(wechat_auth, "code2session",
                        lambda cfg, code: {"openid": "openid_race", "session_key": "s", "unionid": None})
    results = {}
    barrier = threading.Barrier(2)
    def _go(idx):
        barrier.wait()
        st, b = _req(base, "POST", "/api/auth/login", {"platform": "wx", "code": "z"})
        results[idx] = (st, b["uid"] if b else None)
    ts = [threading.Thread(target=_go, args=(i,)) for i in range(2)]
    for t in ts: t.start()
    for t in ts: t.join()
    assert results[0][0] == 200 and results[1][0] == 200
    assert results[0][1] == results[1][1]  # 同一 uid
    with db_handle.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM wx_identities WHERE openid=%s", ("openid_race",))
        assert cur.fetchone()["c"] == 1  # 只绑一行


# ---- 各受保护 handler 切到 require_auth（Task 7）----
# 登录拿到 token 后，应能凭 Bearer token 访问受保护接口；strict 灰度关掉回退时，
# 无 token 必须被 401 拒绝（不再静默信任 X-Uid）。
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


def test_strict_mode_login_rejects_only_xuid(server_base):
    # 回归（安全）：/api/player/login 也切到 require_auth 后，strict 下只带 X-Uid（无 token）
    # 必须被 401 拒绝——否则任何人拿别人的 uid 就能冒领登录、读回其云存档。
    base, _db, cfg = server_base
    cfg["auth"]["strict"] = True         # 运行时切 strict，模拟灰度关回退
    try:
        st, _ = _req(base, "POST", "/api/player/login", headers={"X-Uid": "1000000000000300"})
        assert st == 401
    finally:
        cfg["auth"]["strict"] = False    # 复位，勿污染同 module 其它用例


# ---- PvP WS 握手 + versus HTTP 端点切到 require_auth（Task 8）----
# WS 握手鉴权：优先 ?token=；非 strict 时回退 ?uid=（不做数字格式校验，兼容旧客户端/测试）。
def test_ws_authenticate_token_and_fallback(db):
    import api_versus
    import auth_session

    token, _ = auth_session.issue_token(db, "1000000000000401", "wx")
    assert api_versus._ws_authenticate({"token": [token]}, db, strict=True) == "1000000000000401"
    # 非 strict：回退 ?uid=，且不做数字格式校验（兼容既有 uid=A1 测试）
    assert api_versus._ws_authenticate({"uid": ["A1"]}, db, strict=False) == "A1"
    # strict：无 token → None
    assert api_versus._ws_authenticate({"uid": ["A1"]}, db, strict=True) is None


def test_versus_enqueue_accepts_token_and_strict_rejects(server_base):
    base, _db, cfg = server_base
    _st, body = _req(base, "POST", "/api/auth/login", {"platform": "web", "uid": "1000000000000600"})
    token = body["token"]
    st, _ = _req(base, "POST", "/api/versus/enqueue", {"rank": 0}, token=token)
    assert st == 200                        # token 通过
    cfg["auth"]["strict"] = True
    try:
        st, _ = _req(base, "POST", "/api/versus/enqueue", {"rank": 0}, headers={"X-Uid": "1000000000000600"})
        assert st == 401                    # strict 下无 token 被拒
    finally:
        cfg["auth"]["strict"] = False
