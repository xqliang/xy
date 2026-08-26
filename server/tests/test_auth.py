from __future__ import annotations

import os
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


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
