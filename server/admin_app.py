from __future__ import annotations

import hmac
import json
import secrets
from http.cookies import SimpleCookie
from typing import Any
from urllib.parse import parse_qs, urlparse

from db import DB
from httputil import send_json

SESSIONS: dict[str, str] = {}


def _token() -> str:
    return secrets.token_hex(16)


def _check_login(handler, cfg: dict[str, Any]) -> bool:
    cookie = SimpleCookie()
    if "Cookie" in handler.headers:
        cookie.load(handler.headers["Cookie"])
    morsel = cookie.get("xy_admin")
    if not morsel:
        return False
    return SESSIONS.get(morsel.value) == cfg["admin"]["username"]


def _layout(title: str, body: str, active: str = "") -> bytes:
    menus = [
        ("overview", "数据概览", "/admin/overview"),
        ("users", "用户", "/admin/users"),
        ("heroes", "英雄", "/admin/heroes"),
        ("items", "道具", "/admin/items"),
        ("ads", "广告", "/admin/ads"),
        ("economy", "经济", "/admin/economy"),
        ("leaderboard", "排行榜", "/admin/leaderboard"),
    ]
    nav = "".join(
        f'<a class="{"on" if k == active else ""}" href="{href}">{label}</a>' for k, label, href in menus
    )
    html = f"""<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · xy admin</title>
<style>
body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f4f1ea;color:#222}}
.side{{position:fixed;left:0;top:0;bottom:0;width:200px;background:#2c2416;padding:20px 12px;box-sizing:border-box}}
.side h1{{color:#f0d78c;font-size:18px;margin:0 0 16px;padding:0 8px}}
.side a{{display:block;color:#ddd;text-decoration:none;padding:10px 12px;border-radius:8px;margin-bottom:4px}}
.side a.on,.side a:hover{{background:#4a3b22;color:#fff}}
.main{{margin-left:200px;padding:24px}}
.card{{background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);margin-bottom:16px}}
table{{width:100%;border-collapse:collapse}}
th,td{{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;font-size:14px}}
th{{color:#666;font-weight:600}}
input,button,select{{padding:8px 12px;border-radius:8px;border:1px solid #ccc;font:inherit}}
button{{background:#8b5a2b;color:#fff;border:0;cursor:pointer}}
.bar{{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}}
.login{{max-width:360px;margin:80px auto;background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)}}
.login h1{{margin-top:0}}
.err{{color:#b91c1c;margin:8px 0}}
</style></head><body>
<div class="side"><h1>大圣 Admin</h1>{nav}<a href="/admin/logout">退出</a></div>
<div class="main"><div class="card"><h2 style="margin-top:0">{title}</h2>{body}</div></div>
</body></html>"""
    return html.encode("utf-8")


def _send_html(handler, status: int, html: bytes) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(html)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(html)


def _login_page(err: str = "") -> bytes:
    e = f'<p class="err">{err}</p>' if err else ""
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>登录</title>
<style>body{{background:#f4f1ea;font-family:sans-serif}}.login{{max-width:360px;margin:80px auto;background:#fff;padding:28px;border-radius:12px}}
input,button{{width:100%;padding:10px;margin:6px 0;box-sizing:border-box}}button{{background:#8b5a2b;color:#fff;border:0}}
.err{{color:#b91c1c}}</style></head><body><form class="login" method="POST" action="/admin/login">
<h1>xy 运营后台</h1>{e}
<input name="username" placeholder="用户名" autocomplete="username">
<input name="password" type="password" placeholder="密码" autocomplete="current-password">
<button type="submit">登录</button></form></body></html>""".encode("utf-8")


def handle_admin(handler, db: DB, cfg: dict[str, Any], method: str) -> bool:
    path = urlparse(handler.path).path
    if not path.startswith("/admin"):
        return False

    if path == "/admin/login" and method == "GET":
        _send_html(handler, 200, _login_page())
        return True

    if path == "/admin/login" and method == "POST":
        length = int(handler.headers.get("Content-Length") or 0)
        raw = handler.rfile.read(length).decode("utf-8", errors="ignore")
        form = parse_qs(raw)
        user = (form.get("username") or [""])[0]
        pw = (form.get("password") or [""])[0]
        au = cfg["admin"]["username"]
        ap = cfg["admin"]["password"]
        if hmac.compare_digest(user, au) and hmac.compare_digest(pw, ap):
            tok = _token()
            SESSIONS[tok] = au
            handler.send_response(302)
            handler.send_header("Set-Cookie", f"xy_admin={tok}; Path=/admin; HttpOnly; SameSite=Lax")
            handler.send_header("Location", "/admin/overview")
            handler.end_headers()
        else:
            _send_html(handler, 401, _login_page("账号或密码错误"))
        return True

    if path == "/admin/logout":
        cookie = SimpleCookie()
        if "Cookie" in handler.headers:
            cookie.load(handler.headers["Cookie"])
        morsel = cookie.get("xy_admin")
        if morsel and morsel.value in SESSIONS:
            del SESSIONS[morsel.value]
        handler.send_response(302)
        handler.send_header("Set-Cookie", "xy_admin=; Path=/admin; Max-Age=0")
        handler.send_header("Location", "/admin/login")
        handler.end_headers()
        return True

    if path in ("/admin", "/admin/"):
        handler.send_response(302)
        handler.send_header("Location", "/admin/overview")
        handler.end_headers()
        return True

    if not _check_login(handler, cfg):
        handler.send_response(302)
        handler.send_header("Location", "/admin/login")
        handler.end_headers()
        return True

    qs = parse_qs(urlparse(handler.path).query)

    if path == "/admin/overview":
        with db.cursor() as cur:
            cur.execute("SELECT * FROM daily_stats ORDER BY day DESC LIMIT 30")
            rows = cur.fetchall()
        # Ensure fresh-ish numbers
        from api_events import recompute_days

        recompute_days(db, db.day_offsets(2))
        with db.cursor() as cur:
            cur.execute("SELECT * FROM daily_stats ORDER BY day DESC LIMIT 30")
            rows = cur.fetchall()
        def avg_wave(r: dict[str, Any]) -> str:
            n = int(r["wave_n"] or 0)
            if n <= 0:
                return "0"
            return f"{int(r['wave_sum']) / n:.1f}"

        tr = "".join(
            f"<tr><td>{r['day']}</td><td>{r['dau']}</td><td>{r['games_started']}</td>"
            f"<td>{r['games_ended']}</td><td>{r['wins']}</td><td>{r['losses']}</td>"
            f"<td>{avg_wave(r)}</td>"
            f"<td>{r['ad_clicks']}</td><td>{r['ad_rewards']}</td></tr>"
            for r in rows
        )
        body = f"""<table><tr><th>日期</th><th>DAU</th><th>开局</th><th>结束</th><th>胜</th><th>负</th><th>平均波次</th><th>广告点击</th><th>广告发奖</th></tr>{tr or '<tr><td colspan=9>暂无数据</td></tr>'}</table>"""
        _send_html(handler, 200, _layout("数据概览", body, "overview"))
        return True

    if path == "/admin/users":
        uid = (qs.get("uid") or [""])[0].strip()
        form = f"""<form class="bar" method="get"><input name="uid" value="{uid}" placeholder="UID"><button>查询</button></form>"""
        detail = ""
        if uid:
            with db.cursor() as cur:
                cur.execute("SELECT * FROM players WHERE uid=%s", (uid,))
                p = cur.fetchone()
                cur.execute("SELECT avatar_id, unlocked_at FROM player_avatars WHERE uid=%s", (uid,))
                avs = cur.fetchall()
            if not p:
                detail = "<p>未找到用户</p>"
            else:
                unlocks = ", ".join(a["avatar_id"] for a in avs)
                save_len = len(p["save_json"] or "")
                detail = f"""<pre>UID: {p['uid']}
昵称: {p['nickname'] or '(空)'}
头像: {p['avatar_id']}
境界: {p['rank_level']}
IP: {p['last_ip']}
上次登录: {p['last_login_at']}
存档字节: {save_len}
解锁头像: {unlocks}
</pre>"""
        _send_html(handler, 200, _layout("用户", form + detail, "users"))
        return True

    if path in ("/admin/heroes", "/admin/items", "/admin/ads", "/admin/economy"):
        from api_events import recompute_days

        recompute_days(db, db.day_offsets(7))
        with db.cursor() as cur:
            cur.execute("SELECT * FROM daily_stats ORDER BY day DESC LIMIT 14")
            rows = cur.fetchall()
        if path == "/admin/heroes":
            body = _json_breakdown(rows, "heroes_json", "英雄")
            _send_html(handler, 200, _layout("英雄统计", body, "heroes"))
        elif path == "/admin/items":
            body = _json_breakdown(rows, "items_json", "道具")
            _send_html(handler, 200, _layout("道具统计", body, "items"))
        elif path == "/admin/ads":
            tr = "".join(
                f"<tr><td>{r['day']}</td><td>{r['ad_clicks']}</td><td>{r['ad_rewards']}</td></tr>" for r in rows
            )
            body = f"<table><tr><th>日期</th><th>点击</th><th>发奖</th></tr>{tr}</table>"
            _send_html(handler, 200, _layout("广告", body, "ads"))
        else:
            tr = "".join(
                f"<tr><td>{r['day']}</td><td>{r['stamina_spent']}</td><td>{r['merit_spent']}</td>"
                f"<td>{r['fragments_json'] or '{}'}</td></tr>"
                for r in rows
            )
            body = f"<table><tr><th>日期</th><th>体力消耗</th><th>功德消耗</th><th>碎片获取</th></tr>{tr}</table>"
            _send_html(handler, 200, _layout("经济", body, "economy"))
        return True

    if path == "/admin/leaderboard":
        day = (qs.get("day") or [db.today()])[0]
        form = f"""<form class="bar" method="get"><input name="day" value="{day}" placeholder="YYYY-MM-DD"><button>查询</button></form>"""
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT uid, rank_level, avatar_id, nickname FROM daily_leaderboard
                WHERE day=%s ORDER BY rank_level DESC, updated_at ASC LIMIT 100
                """,
                (day,),
            )
            rows = cur.fetchall()
        tr = "".join(
            f"<tr><td>{i+1}</td><td>{r['uid']}</td><td>{r['nickname'] or ''}</td>"
            f"<td>{r['avatar_id']}</td><td>{r['rank_level']}</td></tr>"
            for i, r in enumerate(rows)
        )
        body = form + f"<table><tr><th>#</th><th>UID</th><th>昵称</th><th>头像</th><th>境界</th></tr>{tr}</table>"
        _send_html(handler, 200, _layout("排行榜", body, "leaderboard"))
        return True

    send_json(handler, 404, {"error": "not found"})
    return True


def _json_breakdown(rows: list[dict[str, Any]], field: str, label: str) -> str:
    totals: dict[str, int] = {}
    for r in rows:
        raw = r.get(field)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            for k, v in data.items():
                try:
                    totals[k] = totals.get(k, 0) + int(v)
                except (TypeError, ValueError):
                    pass
    items = sorted(totals.items(), key=lambda x: -x[1])
    tr = "".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in items)
    return f"<p>近两周合计 · {label}</p><table><tr><th>ID</th><th>次数</th></tr>{tr or '<tr><td colspan=2>暂无</td></tr>'}</table>"
