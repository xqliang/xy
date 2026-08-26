from __future__ import annotations

from typing import Any

from db import DB
from httputil import query_params, read_json, require_auth, send_json


def _display_name(nickname: str | None, uid: str) -> str:
    if nickname:
        return nickname
    if len(uid) <= 4:
        return "***" + uid
    return "***" + uid[-4:]


def handle_submit(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_auth(handler, db, body)
    if not uid:
        return
    try:
        rank_level = int(body.get("rankLevel") if body.get("rankLevel") is not None else body.get("rank_level"))
    except (TypeError, ValueError):
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "rankLevel required"}})
        return
    with db.cursor() as cur:
        cur.execute("SELECT nickname, avatar_id FROM players WHERE uid=%s", (uid,))
        row = cur.fetchone()
    if not row:
        send_json(handler, 404, {"error": {"code": "not_found", "msg": "login first"}})
        return
    day = db.today()
    now = db.now()
    with db.cursor() as cur:
        cur.execute(
            "SELECT rank_level FROM daily_leaderboard WHERE day=%s AND uid=%s",
            (day, uid),
        )
        existing = cur.fetchone()
        if existing and int(existing["rank_level"]) >= rank_level:
            # keep higher; still refresh snapshot nickname/avatar
            cur.execute(
                """
                UPDATE daily_leaderboard
                SET avatar_id=%s, nickname=%s, updated_at=%s
                WHERE day=%s AND uid=%s
                """,
                (row["avatar_id"], row["nickname"], now, day, uid),
            )
        else:
            cur.execute(
                """
                INSERT INTO daily_leaderboard (day, uid, rank_level, avatar_id, nickname, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                  rank_level=VALUES(rank_level),
                  avatar_id=VALUES(avatar_id),
                  nickname=VALUES(nickname),
                  updated_at=VALUES(updated_at)
                """,
                (day, uid, rank_level, row["avatar_id"], row["nickname"], now),
            )
        cur.execute(
            "UPDATE players SET rank_level=%s, updated_at=%s WHERE uid=%s",
            (max(rank_level, 0), now, uid),
        )
    send_json(handler, 200, {"ok": True, "day": day, "rankLevel": rank_level})


def handle_daily(handler, db: DB) -> None:
    uid = require_auth(handler, db)
    if not uid:
        return
    qs = query_params(handler)
    try:
        limit = int((qs.get("limit") or ["50"])[0])
    except ValueError:
        limit = 50
    limit = max(1, min(100, limit))
    day = (qs.get("day") or [db.today()])[0]
    with db.cursor() as cur:
        cur.execute(
            """
            SELECT uid, rank_level, avatar_id, nickname
            FROM daily_leaderboard
            WHERE day=%s
            ORDER BY rank_level DESC, updated_at ASC
            LIMIT %s
            """,
            (day, limit),
        )
        rows = cur.fetchall()
        cur.execute(
            "SELECT uid, rank_level, avatar_id, nickname FROM daily_leaderboard WHERE day=%s AND uid=%s",
            (day, uid),
        )
        me_row = cur.fetchone()
        my_rank = None
        if me_row:
            cur.execute(
                """
                SELECT COUNT(*) AS c FROM daily_leaderboard
                WHERE day=%s AND rank_level > %s
                """,
                (day, me_row["rank_level"]),
            )
            better = int(cur.fetchone()["c"])
            cur.execute(
                """
                SELECT COUNT(*) AS c FROM daily_leaderboard
                WHERE day=%s AND rank_level=%s AND updated_at < (
                  SELECT updated_at FROM daily_leaderboard WHERE day=%s AND uid=%s
                )
                """,
                (day, me_row["rank_level"], day, uid),
            )
            earlier = int(cur.fetchone()["c"])
            my_rank = better + earlier + 1

    def map_row(r: dict[str, Any], me: bool = False) -> dict[str, Any]:
        return {
            "name": _display_name(r["nickname"], r["uid"]),
            "rankLevel": int(r["rank_level"]),
            "avatarId": r["avatar_id"],
            "me": me or r["uid"] == uid,
        }

    entries = [map_row(r) for r in rows]
    me = map_row(me_row, True) if me_row else None
    if me:
        me["place"] = my_rank
    send_json(handler, 200, {"day": day, "entries": entries, "me": me})
