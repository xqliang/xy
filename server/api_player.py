from __future__ import annotations

import random
from typing import Any

from auth_session import issue_token
from avatar_catalog import by_id, default_ids, unlockable
from db import DB
from httputil import client_ip, ok_uid, read_json, require_uid, send_json

NICKNAME_MAX_WEIGHT = 20


def _char_nickname_weight(ch: str) -> int:
    code = ord(ch)
    if (
        0x4E00 <= code <= 0x9FFF
        or 0x3400 <= code <= 0x4DBF
        or 0xF900 <= code <= 0xFAFF
        or 0x3000 <= code <= 0x303F
        or 0xFF00 <= code <= 0xFFEF
    ):
        return 2
    return 1


def _nickname_weight(s: str) -> int:
    return sum(_char_nickname_weight(ch) for ch in s)


def _nickname_ok(s: str) -> bool:
    return _nickname_weight(s.strip()) <= NICKNAME_MAX_WEIGHT


def _player_row(db: DB, uid: str) -> dict[str, Any] | None:
    with db.cursor() as cur:
        cur.execute("SELECT * FROM players WHERE uid=%s", (uid,))
        return cur.fetchone()


def _unlocked(db: DB, uid: str) -> list[str]:
    with db.cursor() as cur:
        cur.execute("SELECT avatar_id FROM player_avatars WHERE uid=%s", (uid,))
        return [r["avatar_id"] for r in cur.fetchall()]


def _ensure_defaults(db: DB, uid: str) -> None:
    now = db.now()
    with db.cursor() as cur:
        for aid in default_ids():
            cur.execute(
                "INSERT IGNORE INTO player_avatars (uid, avatar_id, unlocked_at) VALUES (%s,%s,%s)",
                (uid, aid, now),
            )


def _public_player(row: dict[str, Any], unlocked: list[str]) -> dict[str, Any]:
    return {
        "uid": row["uid"],
        "nickname": row["nickname"],
        "avatarId": row["avatar_id"],
        "rankLevel": int(row["rank_level"] or 0),
        "unlockedAvatars": unlocked,
        "saveUpdatedAt": row["save_updated_at"],
        "hasSave": bool(row["save_json"]),
    }


def _login_upsert(db: DB, uid: str, ip: str) -> None:
    """登录时对 players 行做「有则更新、无则插入」，并补齐默认头像。

    从 handle_login 抽出的公共逻辑：/api/player/login（老/web 路径）与
    /api/auth/login（新的微信/统一登录）都要在确定 uid 后走这同一套落库动作，
    抽成一个函数避免两处各写一遍、行为漂移。
    """
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


def handle_login(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_uid(handler, body)
    if not uid:
        return
    ip = client_ip(handler)
    _login_upsert(db, uid, ip)
    row = _player_row(db, uid)
    assert row
    unlocked = _unlocked(db, uid)
    out = _public_player(row, unlocked)
    out["saveJson"] = row["save_json"]
    send_json(handler, 200, out)


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


def handle_me(handler, db: DB) -> None:
    uid = require_uid(handler)
    if not uid:
        return
    row = _player_row(db, uid)
    if not row:
        send_json(handler, 404, {"error": {"code": "not_found", "msg": "player not found"}})
        return
    unlocked = _unlocked(db, uid)
    out = _public_player(row, unlocked)
    out["saveJson"] = row["save_json"]
    send_json(handler, 200, out)


def handle_sync(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_uid(handler, body)
    if not uid:
        return
    save_json = body.get("saveJson") or body.get("save_json")
    ts = body.get("saveUpdatedAt")
    if ts is None:
        ts = body.get("save_updated_at")
    if save_json is None or ts is None:
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "saveJson and saveUpdatedAt required"}})
        return
    try:
        ts_i = int(ts)
    except (TypeError, ValueError):
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "saveUpdatedAt must be int"}})
        return
    if not isinstance(save_json, str):
        # allow object → stringify
        import json

        save_json = json.dumps(save_json, ensure_ascii=False)
    row = _player_row(db, uid)
    if not row:
        send_json(handler, 404, {"error": {"code": "not_found", "msg": "login first"}})
        return
    cloud_ts = row["save_updated_at"]
    if cloud_ts is not None and int(cloud_ts) > ts_i:
        send_json(
            handler,
            200,
            {
                "status": "server_newer",
                "saveJson": row["save_json"],
                "saveUpdatedAt": cloud_ts,
            },
        )
        return
    now = db.now()
    with db.cursor() as cur:
        cur.execute(
            "UPDATE players SET save_json=%s, save_updated_at=%s, updated_at=%s WHERE uid=%s",
            (save_json, ts_i, now, uid),
        )
    send_json(handler, 200, {"status": "ok", "saveUpdatedAt": ts_i})


def handle_profile(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_uid(handler, body)
    if not uid:
        return
    row = _player_row(db, uid)
    if not row:
        send_json(handler, 404, {"error": {"code": "not_found", "msg": "login first"}})
        return
    nickname = body.get("nickname")
    avatar_id = body.get("avatarId") or body.get("avatar_id")
    updates: list[str] = []
    args: list[Any] = []
    if "nickname" in body:
        if nickname is None or nickname == "":
            updates.append("nickname=NULL")
        else:
            if not isinstance(nickname, str) or not _nickname_ok(nickname):
                send_json(handler, 400, {"error": {"code": "bad_nickname", "msg": "nickname too long"}})
                return
            updates.append("nickname=%s")
            args.append(nickname.strip())
    if avatar_id is not None:
        if not isinstance(avatar_id, str) or not by_id(avatar_id):
            send_json(handler, 400, {"error": {"code": "bad_avatar", "msg": "unknown avatar"}})
            return
        unlocked = _unlocked(db, uid)
        if avatar_id not in unlocked:
            send_json(handler, 403, {"error": {"code": "locked", "msg": "avatar locked"}})
            return
        updates.append("avatar_id=%s")
        args.append(avatar_id)
    if not updates:
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "nothing to update"}})
        return
    now = db.now()
    updates.append("updated_at=%s")
    args.append(now)
    args.append(uid)
    with db.cursor() as cur:
        cur.execute(f"UPDATE players SET {', '.join(updates)} WHERE uid=%s", args)
    row = _player_row(db, uid)
    assert row
    # 榜单昵称/头像是 daily_leaderboard 快照：改资料后立刻同步今日行，避免改名后仍显示旧名。
    # 不碰 updated_at，避免同段位因改名挤到更好并列位次。
    if "nickname" in body or avatar_id is not None:
        with db.cursor() as cur:
            cur.execute(
                """
                UPDATE daily_leaderboard
                SET nickname=%s, avatar_id=%s
                WHERE day=%s AND uid=%s
                """,
                (row["nickname"], row["avatar_id"], db.today(), uid),
            )
    send_json(handler, 200, _public_player(row, _unlocked(db, uid)))


def handle_unlock(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_uid(handler, body)
    if not uid:
        return
    row = _player_row(db, uid)
    if not row:
        send_json(handler, 404, {"error": {"code": "not_found", "msg": "login first"}})
        return
    try:
        rank_level = int(body.get("rankLevel") if body.get("rankLevel") is not None else body.get("rank_level") or 0)
        clear_count = int(body.get("clearCount") if body.get("clearCount") is not None else body.get("clear_count") or 0)
    except (TypeError, ValueError):
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "rankLevel/clearCount int"}})
        return
    _ensure_defaults(db, uid)
    have = set(_unlocked(db, uid))
    new: list[str] = []
    now = db.now()
    from avatar_catalog import catalog

    with db.cursor() as cur:
        cur.execute("UPDATE players SET rank_level=%s, updated_at=%s WHERE uid=%s", (rank_level, now, uid))
        for a in catalog():
            aid = a["id"]
            if aid in have:
                continue
            if unlockable(aid, rank_level, clear_count):
                cur.execute(
                    "INSERT IGNORE INTO player_avatars (uid, avatar_id, unlocked_at) VALUES (%s,%s,%s)",
                    (uid, aid, now),
                )
                new.append(aid)
    send_json(handler, 200, {"newlyUnlocked": new, "unlockedAvatars": _unlocked(db, uid)})
