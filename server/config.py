from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "config.yaml"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    cfg_path = Path(path) if path else Path(os.environ.get("XY_CONFIG", DEFAULT_CONFIG))
    data: dict[str, Any] = {}
    if cfg_path.is_file():
        with cfg_path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    db = data.get("db") or {}
    # Env overrides for tests / local
    if os.environ.get("XY_DB_HOST"):
        db["host"] = os.environ["XY_DB_HOST"]
    if os.environ.get("XY_DB_PORT"):
        db["port"] = int(os.environ["XY_DB_PORT"])
    if os.environ.get("XY_DB_USER"):
        db["user"] = os.environ["XY_DB_USER"]
    if os.environ.get("XY_DB_PASSWORD") is not None:
        db["password"] = os.environ["XY_DB_PASSWORD"]
    if os.environ.get("XY_DB_NAME"):
        db["database"] = os.environ["XY_DB_NAME"]
    data["db"] = {
        "host": db.get("host", "127.0.0.1"),
        "port": int(db.get("port", 3306)),
        "user": db.get("user", "root"),
        "password": db.get("password", ""),
        "database": db.get("database", "xy_game"),
    }
    # Redis（PvP 匹配/对局状态用）。与 db 同样支持 XY_REDIS_* 环境变量覆盖，
    # 便于测试/本地/运维灰度切换。注意 password 用 is not None 判定，允许显式设为空串。
    r = data.get("redis") or {}
    if os.environ.get("XY_REDIS_HOST"):
        r["host"] = os.environ["XY_REDIS_HOST"]
    if os.environ.get("XY_REDIS_PORT"):
        r["port"] = int(os.environ["XY_REDIS_PORT"])
    if os.environ.get("XY_REDIS_DB"):
        r["db"] = int(os.environ["XY_REDIS_DB"])
    if os.environ.get("XY_REDIS_PASSWORD") is not None:
        r["password"] = os.environ["XY_REDIS_PASSWORD"]
    data["redis"] = {
        "host": r.get("host", "127.0.0.1"),
        "port": int(r.get("port", 6379)),
        "db": int(r.get("db", 0)),
        "password": r.get("password", ""),
    }
    data.setdefault("addr", "0.0.0.0:8082")
    data.setdefault("static_dir", str(ROOT.parent / "web" / "dist"))
    data.setdefault("timezone", "Asia/Shanghai")
    admin = data.get("admin") or {}
    data["admin"] = {
        "username": admin.get("username", "admin"),
        "password": admin.get("password", "admin123"),
    }
    # 微信小游戏登录凭据：appid/secret。secret 仅服务端持有，绝不下发到客户端。
    wechat = data.get("wechat") or {}
    data["wechat"] = {
        "appid": wechat.get("appid", ""),
        "secret": wechat.get("secret", ""),
    }
    # 会话鉴权配置：strict 控制是否强制校验 token（灰度开关），session_days 为会话有效天数。
    auth = data.get("auth") or {}
    strict = auth.get("strict", False)
    # 环境变量优先（运维灰度切换用），接受 true/1/yes 等常见真值写法。
    env_strict = os.environ.get("XY_AUTH_STRICT")
    if env_strict is not None:
        strict = env_strict.strip().lower() in ("1", "true", "yes", "on")
    data["auth"] = {
        "strict": bool(strict),
        "session_days": int(auth.get("session_days", 30)),
    }
    data.setdefault("tos", data.get("tos") or {})
    return data


def dsn_kwargs(cfg: dict[str, Any]) -> dict[str, Any]:
    db = cfg["db"]
    return {
        "host": db["host"],
        "port": db["port"],
        "user": db["user"],
        "password": db["password"],
        "database": db["database"],
        "charset": "utf8mb4",
        "autocommit": True,
    }


def redis_kwargs(cfg: dict[str, Any]) -> dict[str, Any]:
    # 构造 redis.Redis(**kwargs) 参数。decode_responses=True 让读写都用 str（省去手动 .decode）。
    # 仅在配置了非空 password 时才传，避免给无密码的本地 Redis 发 AUTH 报错。
    r = cfg["redis"]
    kw = {"host": r["host"], "port": r["port"], "db": r["db"], "decode_responses": True}
    if r.get("password"):
        kw["password"] = r["password"]
    return kw
