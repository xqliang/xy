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
