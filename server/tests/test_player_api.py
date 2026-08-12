from __future__ import annotations

import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Require docker MariaDB on 3307
DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),
    "XY_DB_USER": os.environ.get("XY_DB_USER", "root"),
    "XY_DB_PASSWORD": os.environ.get("XY_DB_PASSWORD", ""),
    "XY_DB_NAME": os.environ.get("XY_DB_NAME", "xy_game_test"),
    "XY_AGG_INTERVAL": "3600",
}


def _reset_db():
    import pymysql

    conn = pymysql.connect(
        host=DSN_ENV["XY_DB_HOST"],
        port=int(DSN_ENV["XY_DB_PORT"]),
        user=DSN_ENV["XY_DB_USER"],
        password=DSN_ENV["XY_DB_PASSWORD"],
        charset="utf8mb4",
        autocommit=True,
    )
    with conn.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{DSN_ENV['XY_DB_NAME']}` CHARACTER SET utf8mb4")
        cur.execute(f"USE `{DSN_ENV['XY_DB_NAME']}`")
        for t in ("events", "daily_stats", "daily_leaderboard", "player_avatars", "players"):
            cur.execute(f"DROP TABLE IF EXISTS {t}")
    conn.close()


@pytest.fixture(scope="module")
def server_base():
    for k, v in DSN_ENV.items():
        os.environ[k] = v
    _reset_db()

    from config import load_config
    from db import DB
    from server import Handler

    cfg = load_config()
    cfg["static_dir"] = str(ROOT)
    cfg["admin"] = {"username": "admin", "password": "testpass"}
    db = DB(cfg)
    db.migrate()

    class H(Handler):
        pass

    H.db = db
    H.cfg = cfg

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), lambda *a, **k: H(*a, directory=str(ROOT), **k))
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()


def _req(base: str, method: str, path: str, body: dict | None = None, uid: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if uid:
        headers["X-Uid"] = uid
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def test_login_sync_profile_unlock(server_base):
    uid = "12345678"
    st, body = _req(server_base, "POST", "/api/player/login", {}, uid)
    assert st == 200
    assert body["uid"] == uid
    assert "wukong" in body["unlockedAvatars"]
    assert body["avatarId"] == "wukong"

    st, body = _req(
        server_base,
        "POST",
        "/api/player/sync",
        {"saveJson": '{"merit":1}', "saveUpdatedAt": 100},
        uid,
    )
    assert st == 200
    assert body["status"] == "ok"

    st, body = _req(
        server_base,
        "POST",
        "/api/player/sync",
        {"saveJson": '{"merit":2}', "saveUpdatedAt": 50},
        uid,
    )
    assert st == 200
    assert body["status"] == "server_newer"
    assert body["saveUpdatedAt"] == 100

    st, body = _req(server_base, "POST", "/api/player/profile", {"avatarId": "pipa"}, uid)
    assert st == 403

    st, body = _req(
        server_base,
        "POST",
        "/api/avatar/unlock",
        {"rankLevel": 2, "clearCount": 0},
        uid,
    )
    assert st == 200
    assert "pipa" in body["newlyUnlocked"]

    st, body = _req(
        server_base,
        "POST",
        "/api/player/profile",
        {"avatarId": "pipa", "nickname": "测试侠"},
        uid,
    )
    assert st == 200
    assert body["avatarId"] == "pipa"
    assert body["nickname"] == "测试侠"


def test_leaderboard_and_events(server_base):
    uid = "87654321"
    _req(server_base, "POST", "/api/player/login", {}, uid)
    st, body = _req(server_base, "POST", "/api/leaderboard/submit", {"rankLevel": 3}, uid)
    assert st == 200
    st, body = _req(server_base, "POST", "/api/leaderboard/submit", {"rankLevel": 2}, uid)
    assert st == 200
    st, body = _req(server_base, "GET", "/api/leaderboard/daily", uid=uid)
    assert st == 200
    assert body["me"]["rankLevel"] == 3
    assert body["entries"][0]["rankLevel"] >= 3

    st, body = _req(
        server_base,
        "POST",
        "/api/events",
        {
            "events": [
                {"type": "login", "payload": {}},
                {"type": "game_start", "payload": {"endless": False}},
                {"type": "game_end", "payload": {"win": True, "wave": 10, "heroes": ["wukong"], "items": ["a1"]}},
                {"type": "ad_click", "payload": {"scene": "stamina"}},
                {"type": "stamina", "payload": {"delta": -5, "remain": 45}},
            ]
        },
        uid,
    )
    assert st == 200
    assert body["inserted"] == 5

    from api_events import recompute_days
    from config import load_config
    from db import DB

    db = DB(load_config())
    recompute_days(db, [db.today()])
    with db.cursor() as cur:
        cur.execute("SELECT * FROM daily_stats WHERE day=%s", (db.today(),))
        row = cur.fetchone()
    assert row["games_started"] >= 1
    assert row["wins"] >= 1
    assert row["ad_clicks"] >= 1
    assert row["stamina_spent"] >= 5
