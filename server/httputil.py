from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import parse_qs, urlparse

UID_RE = re.compile(r"^\d{8,20}$")


def ok_uid(uid: str | None) -> bool:
    return bool(uid and UID_RE.match(uid))


def read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ValueError(f"invalid json: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("json body must be object")
    return data


def send_json(handler: BaseHTTPRequestHandler, status: int, body: Any) -> None:
    payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header("Cache-Control", "no-store")
    # Dev CORS when Vite hits remote API
    origin = handler.headers.get("Origin")
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, X-Uid")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        handler.send_header("Vary", "Origin")
    handler.end_headers()
    handler.wfile.write(payload)


def send_empty(handler: BaseHTTPRequestHandler, status: int = 204) -> None:
    handler.send_response(status)
    origin = handler.headers.get("Origin")
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, X-Uid")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()


def client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (handler.client_address[0] or "")[:64]


def require_uid(handler: BaseHTTPRequestHandler, body: dict[str, Any] | None = None) -> str | None:
    uid = handler.headers.get("X-Uid") or (body or {}).get("uid")
    if isinstance(uid, (int, float)):
        uid = str(int(uid))
    if not isinstance(uid, str) or not ok_uid(uid):
        send_json(handler, 400, {"error": {"code": "bad_uid", "msg": "invalid uid"}})
        return None
    return uid


def query_params(handler: BaseHTTPRequestHandler) -> dict[str, list[str]]:
    return parse_qs(urlparse(handler.path).query)


def bearer_token(handler: BaseHTTPRequestHandler) -> str:
    # 从 Authorization 头里取出 Bearer 令牌；没有或格式不对时返回空串。
    # 大小写不敏感（HTTP 头本就大小写不敏感），只截取 "Bearer " 之后的部分并去空白。
    auth = handler.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def _strict_enabled(handler: BaseHTTPRequestHandler) -> bool:
    """读取鉴权灰度开关 auth.strict。
    正常运行时 load_config 一定把它规范化成真正的 bool；若这里读不到
    （无 cfg / auth 段缺失或类型异常），说明配置被破坏或调用方非标准 handler ——
    对安全门禁按最保守的『严格』处理（fail-closed），绝不静默放开成 X-Uid 信任（否则等于无鉴权冒名）。"""
    cfg = getattr(handler, "cfg", None)
    if not isinstance(cfg, dict):
        return True
    auth = cfg.get("auth")
    if not isinstance(auth, dict) or "strict" not in auth:
        return True
    return bool(auth["strict"])


def require_auth(handler: BaseHTTPRequestHandler, db, body: dict[str, Any] | None = None) -> str | None:
    """统一鉴权：优先 Bearer token；token 缺失/失效时，strict=True→401，否则回退认 X-Uid（灰度）。"""
    # 局部导入：httputil 是被广泛引用的底层工具，避免其模块加载期就拉入 DB 层（auth_session→db→pymysql）。
    from auth_session import resolve_token

    token = bearer_token(handler)
    if token:
        uid = resolve_token(db, token)
        if uid:
            return uid
    strict = _strict_enabled(handler)
    if strict:
        send_json(handler, 401, {"error": {"code": "unauthorized", "msg": "login required"}})
        return None
    return require_uid(handler, body)
