from __future__ import annotations

# 会话令牌（session token）的签发与校验。
# 登录成功后给客户端发一个 64 位 hex 令牌，之后每次请求带上它换回 uid；
# 令牌采用「滑动过期」：只要还没过期，校验成功就把有效期顺延（写库有节流，见 RENEW_SLACK），活跃用户不会掉线。

import secrets
from datetime import timedelta

from db import DB

RENEW_SLACK = timedelta(days=1)  # 滑动续期节流：剩余有效期跌破(满窗口-此值)才写库，避免高频轮询每次都写


def issue_token(db: DB, uid: str, platform: str, days: int = 30) -> tuple[str, str]:
    """签发一条会话令牌，返回 (token, expires_at 字符串)。

    参数：
      db       —— 数据库句柄；
      uid      —— 令牌归属的内部数字用户 id；
      platform —— 来源平台（如 "web" / "wx"），仅作记录；
      days     —— 有效期天数，默认 30 天。

    token 用 secrets.token_hex(32) 生成 32 字节的加密随机数，转成 64 个 hex 字符，
    足够长、不可预测，避免被猜测或碰撞。
    """
    token = secrets.token_hex(32)  # 32 字节 -> 64 个 hex 字符
    now = db.now()
    expires = now + timedelta(days=days)
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (token, uid, platform, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
            (token, uid, platform, now, expires),
        )
    # expires_at 以 "YYYY-MM-DD HH:MM:SS" 字符串返回，方便直接下发给前端展示/存储。
    return token, expires.strftime("%Y-%m-%d %H:%M:%S")


def resolve_token(db: DB, token: str, renew_days: int = 30) -> str | None:
    """校验 token：命中且未过期返回 uid 并滑动续期；否则返回 None。

    校验流程：
      1) 空串直接判无效（省一次查库）；
      2) 查不到该 token —— 无效；
      3) 查到但已过期（expires_at < 当前时间）—— 无效；
      4) 有效 —— 把 expires_at 顺延 renew_days 天（滑动过期），返回 uid。
    """
    if not token:
        return None
    now = db.now()
    with db.cursor() as cur:
        cur.execute("SELECT uid, expires_at FROM sessions WHERE token=%s", (token,))
        row = cur.fetchone()
        if not row:
            return None
        exp = row["expires_at"]
        # expires_at 建表为 NOT NULL，仍防御性判空，避免脏数据触发比较异常
        if exp is not None and exp < now:
            return None
        # 滑动续期（节流）：仅当剩余有效期跌破「满窗口 - RENEW_SLACK」才写库，
        # 把高频轮询(~1s)下的写放大收敛到每 token 每天至多一次；活跃用户永不掉线。
        if exp is None or exp <= now + timedelta(days=renew_days) - RENEW_SLACK:
            cur.execute("UPDATE sessions SET expires_at=%s WHERE token=%s",
                        (now + timedelta(days=renew_days), token))
        return row["uid"]
