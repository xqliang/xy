from __future__ import annotations

import random
from typing import Any

from auth_session import issue_token
from avatar_catalog import by_id, default_ids, unlockable
from db import DB
from httputil import client_ip, ok_uid, read_json, require_auth, send_json

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
    /api/auth/login（新的微信/统一登录）都要在确定 uid 后走这同一套落库动作。

    幂等：用单条 INSERT ... ON DUPLICATE KEY UPDATE 代替「先查再插/更」，
    消除两个并发首登同一新 uid 时第二条 INSERT 撞主键 500 的竞态；
    新行按默认值播种（昵称 NULL、悟空头像、0 段位），已存在行只刷新登录时间/IP/updated_at。
    """
    now = db.now()
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO players (uid, nickname, avatar_id, rank_level, last_login_at, last_ip, created_at, updated_at)
            VALUES (%s, NULL, 'wukong', 0, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE last_login_at=VALUES(last_login_at), last_ip=VALUES(last_ip), updated_at=VALUES(updated_at)
            """,
            (uid, now, ip, now, now),
        )
    _ensure_defaults(db, uid)


def handle_login(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_auth(handler, db, body)
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
    """openid→uid：已绑返回旧 uid；未绑则绑 local_uid（老玩家迁移）或新建。

    并发安全：openid 是主键，INSERT ... ON DUPLICATE KEY UPDATE + 回读收敛到唯一 uid。
    ⚠️ 回读正确性依赖连接 autocommit=True（每条语句独立读视图，能看到并发赢家已提交的行）；
       若日后改成显式事务/关 autocommit，回读可能读不到并发写入 → 需另行加锁，勿静默破坏此处。
    安全约束（防串号/冒领）：客户端自报的 local_uid 只有在「尚未被任何其它 openid 绑定」时才可继承。
       走到这里说明本 openid 未绑定，故任何命中的 uid 行都属于别的微信身份 → 放弃继承、改新建，
       绝不让两个 openid 指向同一 uid。
    """
    now = db.now()
    with db.cursor() as cur:
        cur.execute("SELECT uid FROM wx_identities WHERE openid=%s", (openid,))
        row = cur.fetchone()
        if row:
            return row["uid"]
        if local_uid:
            cur.execute("SELECT 1 FROM wx_identities WHERE uid=%s LIMIT 1", (local_uid,))
            if cur.fetchone():
                local_uid = None  # 已被别的 openid 占用 → 不继承
        adopted = bool(local_uid)
        uid = local_uid or _gen_uid(db)
        cur.execute(
            "INSERT INTO wx_identities (openid, unionid, uid, created_at) VALUES (%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE openid=openid",
            (openid, unionid, uid, now),
        )
        cur.execute("SELECT uid FROM wx_identities WHERE openid=%s", (openid,))
        bound = cur.fetchone()["uid"]
    if adopted:
        # 迁移审计：记录「客户端自报 uid 被某 openid 继承」，便于事后排查冒领（openid 脱敏）
        import sys
        sys.stderr.write(f"[auth] wx-migrate bind openid=***{openid[-4:]} adopt_uid={bound}\n")
    return bound


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
            if e.code == -2:  # 空 code：请求格式问题
                send_json(handler, 400, {"error": {"code": "bad_code", "msg": "empty code"}})
                return
            if e.code == -1:  # 服务端未配置 appid/secret：不回显配置状态，仅服务端留痕
                import sys
                sys.stderr.write("[auth] wx login unavailable: appid/secret not configured\n")
                send_json(handler, 503, {"error": {"code": "wx_unavailable", "msg": "wx login temporarily unavailable"}})
                return
            status = 429 if e.code == 45011 else (502 if e.code < 0 else 401)
            send_json(handler, status, {"error": {"code": "wx_auth", "msg": e.msg}})
            return
        local = body.get("uid")
        uid = _bind_openid(db, sess["openid"], sess.get("unionid"), local if ok_uid(local) else None)
    else:
        uid = body.get("uid")
        if not ok_uid(uid):
            send_json(handler, 400, {"error": {"code": "bad_uid", "msg": "invalid uid"}})
            return
        # 安全：已绑微信的 uid 不允许走 web TOFU 冒领——该账号必须用微信登录。
        # 灰度期(strict=false)前端拿不到 token 会回退 X-Uid 仍可用；strict 期该账号在纯 web 端登不进（预期）。
        with db.cursor() as cur:
            cur.execute("SELECT 1 FROM wx_identities WHERE uid=%s LIMIT 1", (uid,))
            if cur.fetchone():
                send_json(handler, 403, {"error": {"code": "wx_bound", "msg": "account bound to WeChat, use WeChat login"}})
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
    uid = require_auth(handler, db)
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
    uid = require_auth(handler, db, body)
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
    uid = require_auth(handler, db, body)
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
    uid = require_auth(handler, db, body)
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
