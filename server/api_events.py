from __future__ import annotations

import json
import threading
import time
from collections import defaultdict
from typing import Any

from db import DB
from httputil import client_ip, read_json, require_uid, send_json

ALLOWED = {
    "login",
    "game_start",
    "game_end",
    "shop_buy",
    "equip",
    "ad_click",
    "ad_reward",
    "stamina",
    "merit",
    "fragment",
}


def handle_events(handler, db: DB) -> None:
    try:
        body = read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return
    uid = require_uid(handler, body)
    if not uid:
        return
    events = body.get("events")
    if not isinstance(events, list) or not events:
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "events required"}})
        return
    ip = client_ip(handler)
    now = db.now()
    day = db.today()
    inserted = 0
    with db.cursor() as cur:
        for ev in events[:200]:
            if not isinstance(ev, dict):
                continue
            typ = ev.get("type")
            if typ not in ALLOWED:
                continue
            payload = ev.get("payload")
            payload_s = json.dumps(payload, ensure_ascii=False) if payload is not None else None
            cur.execute(
                """
                INSERT INTO events (uid, day, type, payload_json, created_at, ip)
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                (uid, day, typ, payload_s, now, ip),
            )
            inserted += 1
    send_json(handler, 200, {"ok": True, "inserted": inserted})


def _merge_count(acc: dict[str, int], key: str, n: int = 1) -> None:
    acc[key] = acc.get(key, 0) + n


def recompute_days(db: DB, days: list[str]) -> None:
    for day in days:
        with db.cursor() as cur:
            cur.execute("SELECT uid, type, payload_json FROM events WHERE day=%s", (day,))
            rows = cur.fetchall()
        uids: set[str] = set()
        games_started = games_ended = wins = losses = 0
        wave_sum = wave_n = 0
        stamina_spent = merit_spent = 0
        ad_clicks = ad_rewards = 0
        heroes: dict[str, int] = defaultdict(int)
        items: dict[str, int] = defaultdict(int)
        fragments: dict[str, int] = defaultdict(int)
        for r in rows:
            uids.add(r["uid"])
            typ = r["type"]
            payload: dict[str, Any] = {}
            if r["payload_json"]:
                try:
                    payload = json.loads(r["payload_json"]) or {}
                except json.JSONDecodeError:
                    payload = {}
            if typ == "game_start":
                games_started += 1
            elif typ == "game_end":
                games_ended += 1
                if payload.get("win"):
                    wins += 1
                else:
                    losses += 1
                wave = payload.get("wave")
                if isinstance(wave, (int, float)):
                    wave_sum += int(wave)
                    wave_n += 1
                for h in payload.get("heroes") or []:
                    if isinstance(h, str):
                        heroes[h] += 1
                for it in payload.get("items") or []:
                    if isinstance(it, str):
                        items[it] += 1
            elif typ == "shop_buy":
                item_id = payload.get("itemId") or payload.get("item_id")
                if isinstance(item_id, str):
                    items[item_id] += 1
                cost = payload.get("costMerit") or payload.get("cost_merit") or 0
                try:
                    merit_spent += max(0, int(cost))
                except (TypeError, ValueError):
                    pass
            elif typ == "equip":
                item_id = payload.get("itemId") or payload.get("item_id")
                if isinstance(item_id, str):
                    items[item_id] += 1
            elif typ == "ad_click":
                ad_clicks += 1
            elif typ == "ad_reward":
                ad_rewards += 1
            elif typ == "stamina":
                try:
                    d = int(payload.get("delta") or 0)
                except (TypeError, ValueError):
                    d = 0
                if d < 0:
                    stamina_spent += -d
            elif typ == "merit":
                try:
                    d = int(payload.get("delta") or 0)
                except (TypeError, ValueError):
                    d = 0
                if d < 0:
                    merit_spent += -d
            elif typ == "fragment":
                wid = payload.get("weaponId") or payload.get("weapon_id")
                try:
                    d = int(payload.get("delta") or 0)
                except (TypeError, ValueError):
                    d = 0
                if isinstance(wid, str) and d > 0:
                    fragments[wid] += d
        now = db.now()
        with db.cursor() as cur:
            cur.execute(
                """
                INSERT INTO daily_stats (
                  day, dau, games_started, games_ended, wins, losses,
                  wave_sum, wave_n, stamina_spent, merit_spent, ad_clicks, ad_rewards,
                  heroes_json, items_json, fragments_json, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                  dau=VALUES(dau), games_started=VALUES(games_started), games_ended=VALUES(games_ended),
                  wins=VALUES(wins), losses=VALUES(losses), wave_sum=VALUES(wave_sum), wave_n=VALUES(wave_n),
                  stamina_spent=VALUES(stamina_spent), merit_spent=VALUES(merit_spent),
                  ad_clicks=VALUES(ad_clicks), ad_rewards=VALUES(ad_rewards),
                  heroes_json=VALUES(heroes_json), items_json=VALUES(items_json),
                  fragments_json=VALUES(fragments_json), updated_at=VALUES(updated_at)
                """,
                (
                    day,
                    len(uids),
                    games_started,
                    games_ended,
                    wins,
                    losses,
                    wave_sum,
                    wave_n,
                    stamina_spent,
                    merit_spent,
                    ad_clicks,
                    ad_rewards,
                    json.dumps(dict(heroes), ensure_ascii=False),
                    json.dumps(dict(items), ensure_ascii=False),
                    json.dumps(dict(fragments), ensure_ascii=False),
                    now,
                ),
            )


def start_aggregator(db: DB, interval_sec: float = 300.0) -> threading.Thread:
    def loop() -> None:
        while True:
            try:
                recompute_days(db, db.day_offsets(2))
            except Exception as e:  # noqa: BLE001 — background never dies
                print(f"[aggregator] error: {e}", flush=True)
            time.sleep(interval_sec)

    t = threading.Thread(target=loop, name="stats-aggregator", daemon=True)
    t.start()
    return t
