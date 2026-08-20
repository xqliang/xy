from __future__ import annotations
# PvP 在线对战：进程内匹配/房间/对局状态机 + 转发 + 反作弊。
# 单进程 ThreadingHTTPServer 下用一把大锁保护；重启即丢活跃对局（临时对局可接受）。
import json
import logging
import secrets
import threading
import time
from typing import Any, Callable, Optional

from db import DB
from httputil import read_json, require_uid, send_json

# —— 可调常量 ——
STAMINA_COST = 5                 # 仅供客户端参考；体力为客户端权威，服务端不校验
MATCH_TIMEOUT_MS = 120_000       # 匹配/等友 2 分钟总倒计时
DISCONNECT_GRACE_MS = 6_000      # 断线宽限：对手 tick 缺失超过即可判赢
RECENT_WINDOW_MS = 300_000       # 自适应窗口统计的近 5 分钟
W_MIN_MS, W_MAX_MS = 3_000, 15_000   # 同级保持窗口范围
INTER_WAVE_DELAY_MS = 3_000      # 先清者触发后到下一波开始的间隔（须与前端一致）
START_DELAY_MS = 1_500           # match-start 到第 1 波开始的缓冲（两端加载）
SIMULTANEOUS_EPS_MS = 200        # 双方阵亡视为同刻→平局的阈值
MAPS = ["huoyanshan", "liushahe", "baiguling", "pansidong"]


def _adaptive_window_ms(n: int) -> int:
    # W = clamp(3 + 12*min(n,5)/5, 3s, 15s)：同级越冷清窗口越短
    w = 3000 + 12000 * (min(n, 5) / 5)
    return int(max(W_MIN_MS, min(W_MAX_MS, w)))


def _mask(uid: str) -> str:
    # 对外输出时脱敏 uid，仅留尾 4 位
    return "***" + uid[-4:] if uid and len(uid) >= 4 else "***"


class VersusHub:
    def __init__(self, db: DB,
                 now_ms: Callable[[], int] | None = None,
                 gen_seed: Callable[[], int] | None = None,
                 gen_code: Callable[[], str] | None = None,
                 pick_map: Callable[[], str] | None = None):
        self.db = db
        self._now = now_ms or (lambda: int(time.time() * 1000))
        self._gen_seed = gen_seed or (lambda: secrets.randbelow(2**31))
        self._gen_code = gen_code or (lambda: secrets.token_hex(3).upper())
        self._pick_map = pick_map or (lambda: secrets.choice(MAPS))
        self.lock = threading.Lock()
        self.queue: dict[str, dict] = {}          # ticket -> waiting entry
        self.recent: dict[int, list[tuple[str, int]]] = {}  # rank -> [(uid, ms)]
        self.rooms: dict[str, dict] = {}          # code -> room
        self.matches: dict[str, dict] = {}        # match_id -> Match
        self.ticket_match: dict[str, tuple[str, str]] = {}  # ticket -> (match_id, uid)

    def reset(self) -> None:  # 测试用
        with self.lock:
            self.queue.clear(); self.recent.clear(); self.rooms.clear()
            self.matches.clear(); self.ticket_match.clear()

    def is_banned(self, uid: str) -> bool:
        # 当天有 ≥3 个不同对手判定异常 → 禁赛
        day = self.db.today()
        with self.db.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT opponent_uid) AS c FROM pvp_anomaly WHERE day=%s AND uid=%s",
                (day, uid),
            )
            row = cur.fetchone()
        return bool(row and int(row["c"]) >= 3)

    # —— 内部工具 ——
    def _prune_recent(self, now: int) -> None:
        # 清理 recent 中超出 RECENT_WINDOW_MS 的旧记录，空段位顺手删除
        for rank, lst in list(self.recent.items()):
            self.recent[rank] = [(u, t) for (u, t) in lst if t >= now - RECENT_WINDOW_MS]
            if not self.recent[rank]:
                del self.recent[rank]

    def _recent_distinct(self, rank: int, exclude_uid: str, now: int) -> int:
        # 近窗口内该段位去重对手数（排除自己）
        return len({u for (u, t) in self.recent.get(rank, []) if u != exclude_uid and t >= now - RECENT_WINDOW_MS})

    def _profile(self, uid: str) -> dict:
        # 读取对手展示档案；查无此人给默认档，uid 一律脱敏
        with self.db.cursor() as cur:
            cur.execute("SELECT uid,nickname,avatar_id,rank_level FROM players WHERE uid=%s", (uid,))
            row = cur.fetchone()
        if not row:
            return {"uid": _mask(uid), "nickname": None, "avatarId": "wukong", "rankLevel": 0}
        return {"uid": _mask(uid), "nickname": row["nickname"], "avatarId": row["avatar_id"], "rankLevel": int(row["rank_level"] or 0)}

    def _new_side(self, uid: str, rank: int, now: int) -> dict:
        # 新建对局一方的实时状态壳
        return {"uid": uid, "rank": rank, "last_tick_ms": now, "relay_buffer": [],
                "last_digest": None, "wave": 1, "prev_kill_digest": None, "status": "playing"}

    def _make_match(self, e1: dict, e2: dict, now: int, map_id: str | None = None) -> str:
        # 组装 Match、建 ticket->match 索引，返回 match_id
        mid = secrets.token_hex(8)
        m = {
            "match_id": mid, "seed": self._gen_seed(), "map": map_id or self._pick_map(),
            "start_at_ms": now + START_DELAY_MS,
            "a": self._new_side(e1["uid"], e1["rank"], now),
            "b": self._new_side(e2["uid"], e2["rank"], now),
            "wave_schedule": {1: now + START_DELAY_MS}, "first_clear": {},
            "result": None, "created_ms": now, "ended": False,
        }
        self.matches[mid] = m
        self.ticket_match[e1["ticket"]] = (mid, e1["uid"])
        self.ticket_match[e2["ticket"]] = (mid, e2["uid"])
        return mid

    def _try_pair(self, now: int) -> None:
        # 私房房主(带 room 标记)不参与随机匹配池，只能经 room_join 成局
        # 第一轮：同段位两两配对
        waiting = [e for e in self.queue.values() if not e.get("room")]
        by_rank: dict[int, list[dict]] = {}
        for e in waiting:
            by_rank.setdefault(e["rank"], []).append(e)
        for rank, lst in by_rank.items():
            lst.sort(key=lambda e: e["enqueued_ms"])
            while len(lst) >= 2:
                a = lst.pop(0); b = lst.pop(0)
                self._pair(a, b, now)
        # 第二轮：已过保持窗口者与任意(非私房)等待者配对
        waiting = sorted([e for e in self.queue.values() if not e.get("room")], key=lambda e: e["enqueued_ms"])
        i = 0
        while i < len(waiting):
            a = waiting[i]
            if a["ticket"] in self.queue and now >= a["hold_until_ms"]:
                partner = next((x for x in waiting if x["ticket"] in self.queue and x["ticket"] != a["ticket"]), None)
                if partner:
                    self._pair(a, partner, now)
                    waiting = sorted([e for e in self.queue.values() if not e.get("room")], key=lambda e: e["enqueued_ms"]); i = 0; continue
            i += 1

    def _pair(self, a: dict, b: dict, now: int) -> None:
        # 从队列摘除双方并成局
        self.queue.pop(a["ticket"], None); self.queue.pop(b["ticket"], None)
        self._make_match(a, b, now)

    # —— 对外匹配 API ——
    def enqueue(self, uid: str, rank: int) -> dict:
        # 禁赛拦截
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            self._prune_recent(now)
            # 记录本次入队用于自适应窗口统计，再算去重人数决定窗口
            self.recent.setdefault(rank, []).append((uid, now))
            n = self._recent_distinct(rank, uid, now)
            ticket = secrets.token_hex(8)
            self.queue[ticket] = {"ticket": ticket, "uid": uid, "rank": rank,
                                  "enqueued_ms": now, "hold_until_ms": now + _adaptive_window_ms(n)}
            self._try_pair(now)
            return {"ticket": ticket}

    def poll(self, ticket: str) -> dict:
        with self.lock:
            now = self._now()
            # 已成局 → 先判超时；未超时则捕获 (mid, uid)，锁外再组 payload
            matched = self.ticket_match.get(ticket)
            if matched is None:
                e = self.queue.get(ticket)
                if not e:
                    # 不在队列也不在对局：已超时或被清理
                    return {"status": "timeout"}
                # 排队超时 → 摘除并返回 timeout
                if now - e["enqueued_ms"] >= MATCH_TIMEOUT_MS:
                    self.queue.pop(ticket, None)
                    return {"status": "timeout"}
                # 仍等待：再尝试一次配对（可能放宽窗口已过）
                self._try_pair(now)
                matched = self.ticket_match.get(ticket)
                if matched is None:
                    return {"status": "waiting"}
        # 锁外组 payload：_profile 的 DB 查询不在全局锁内，避免热路径把匹配串在 DB 延迟上
        mid, uid = matched
        return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}

    def cancel(self, ticket: str) -> dict:
        with self.lock:
            self.queue.pop(ticket, None)
            return {"ok": True}

    # —— 私房（邀请对战）：房主建房间占 ticket 挂起，客人凭码加入直接成局 ——
    def room_create(self, uid: str, rank: int, base_url: str = "") -> dict:
        # 禁赛拦截：与匹配一致，异常玩家当日不得开私房
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            code = self._gen_code()
            ticket = secrets.token_hex(8)
            # 房间记录：code -> 房间元信息（含房主 ticket，便于加入时定位房主）
            self.rooms[code] = {"code": code, "host_uid": uid, "host_rank": rank,
                                "map": self._pick_map(), "created_ms": now, "ticket": ticket}
            # 房主也占一张 ticket，复用同一张 queue 表；标记 room 表示私房挂起（poll 见之仍等待）
            self.queue[ticket] = {"ticket": ticket, "uid": uid, "rank": rank,
                                  "enqueued_ms": now, "hold_until_ms": now + MATCH_TIMEOUT_MS, "room": code}
            link = f"{base_url}/?versus={code}"
            return {"code": code, "link": link, "ticket": ticket, "map": self.rooms[code]["map"]}

    def room_join(self, code: str, uid: str, rank: int) -> dict:
        # 禁赛拦截
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            room = self.rooms.get(code)
            if not room:
                # 无此码：可能输错或已被占用
                return {"error": "room_not_found"}
            host_ticket = room["ticket"]
            host_entry = self.queue.get(host_ticket)
            if not host_entry:
                # 房已存在但房主 ticket 已不在队列（超时/被清理）
                return {"error": "room_expired"}
            # 客人这边只组一次性 entry 参与成局，不入 queue（避免污染匹配）
            joiner = {"ticket": secrets.token_hex(8), "uid": uid, "rank": rank, "enqueued_ms": now}
            # 成局即销毁房间与房主挂起态，保证一码一局、不能重复加入
            self.queue.pop(host_ticket, None)
            self.rooms.pop(code, None)
            mid = self._make_match(host_entry, joiner, now, map_id=room["map"])
            # 注意：_match_start_payload 在锁内调用（含 DB 读档）。
            # 私房加入是一次性低频操作，可接受；不改动 Task 3 的 poll 热路径。
            return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}

    def _match_start_payload(self, mid: str, uid: str) -> dict:
        # 组 match-start：matchId/seed/map/startAt/对手档案
        m = self.matches[mid]
        opp_uid = m["b"]["uid"] if m["a"]["uid"] == uid else m["a"]["uid"]
        return {"matchId": mid, "seed": m["seed"], "map": m["map"],
                "startAtServerMs": m["start_at_ms"], "opponent": self._profile(opp_uid)}

    # —— tick 转发 + 波次调度（先清者定下一波）——
    def _sides(self, m: dict, uid: str) -> tuple[dict, dict]:
        # 根据 uid 判断自己是 a 还是 b，返回 (我, 对手)
        return (m["a"], m["b"]) if m["a"]["uid"] == uid else (m["b"], m["a"])

    def tick(self, uid: str, match_id: str, inputs: list, digest: dict,
             wave_cleared_at: Optional[dict], status: str) -> dict:
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if not m:
                return {"error": "match_not_found"}
            me, opp = self._sides(m, uid)
            me["last_tick_ms"] = now
            if digest:
                me["last_digest"] = digest
                me["wave"] = int(digest.get("wave", me["wave"]))
            self._anticheat(m, me, opp, inputs, digest, now)
            # 把我的动作放进对手的转发缓冲
            if inputs:
                opp["relay_buffer"].extend(inputs)
            # 先清者定下一波
            if wave_cleared_at:
                w = int(wave_cleared_at.get("wave", 0))
                if w and (w + 1) not in m["wave_schedule"]:
                    m["wave_schedule"][w + 1] = now + INTER_WAVE_DELAY_MS
                    m["first_clear"][w] = uid
            self._resolve_terminal(m, me, opp, status, now)
            # 取走给「我」的对手动作
            out = me["relay_buffer"]; me["relay_buffer"] = []
            next_wave = self._next_wave_for(m, me)
            opp_status = self._opp_status(m, opp, now)
            # 落库兜底重试：已判终局但上次落库失败（DB 抖动）→ 幂等重试，避免永久丢战绩
            if m.get("ended") and not m.get("persisted"):
                self._persist_result(m, now)
            resp = {
                "serverMs": now,
                "opponentInputs": out,
                "opponentDigest": opp.get("last_digest"),
                "nextWave": next_wave,
                "opponentStatus": opp_status,
                "result": self._result_for(m, uid),
                "cheatNotice": ({"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
                                if self.is_banned(uid) else None),
            }
            return resp

    def _next_wave_for(self, m: dict, me: dict) -> Optional[dict]:
        # 返回「我」当前波次的下一波开始时刻（若已排程）
        w = me["wave"]
        nxt = w + 1
        if nxt in m["wave_schedule"]:
            return {"wave": nxt, "startAtServerMs": m["wave_schedule"][nxt]}
        return None

    LOSE_STATUS = {"tangsengDead": "TangsengDead", "surrender": "Surrender"}

    # reason_kind → (胜方 reason, 负方 reason)。显式查表，避免字符串拼接 + magic 特判；
    # 这些字符串是对前端的契约，前端按值分支展示「对手认输/唐僧被吃/断线超时」等文案。
    REASON = {
        "Surrender":         ("opponentSurrender",         "selfSurrender"),
        "TangsengDead":      ("opponentTangsengDead",      "selfTangsengDead"),
        "DisconnectTimeout": ("opponentDisconnectTimeout", "selfDisconnect"),
    }

    def _set_result(self, m, loser_side_key: str, reason_kind: str, now: int) -> None:
        # reason_kind ∈ {"TangsengDead","Surrender","DisconnectTimeout"}
        if m.get("result") or m.get("ended"):
            return
        winner = "b" if loser_side_key == "a" else "a"
        win_reason, lose_reason = self.REASON[reason_kind]
        m["result"] = {
            winner: {"outcome": "win", "reason": win_reason},
            loser_side_key: {"outcome": "lose", "reason": lose_reason},
        }
        m["ended"] = True
        m["ended_ms"] = now
        self._persist_result(m, now)

    def _set_draw(self, m, now: int) -> None:
        # 双方 EPS 内阵亡 → 平局（可覆盖先到阵亡者已判的胜负）
        m["result"] = {"a": {"outcome": "draw", "reason": "draw"},
                       "b": {"outcome": "draw", "reason": "draw"}}
        m["ended"] = True; m["ended_ms"] = now
        self._persist_result(m, now)

    def _persist_result(self, m, now: int) -> None:
        # 幂等落库：先删该 match 旧行再插，允许平局改判覆盖先前的胜负行。
        # 关键：落库失败绝不向上抛——否则终局 tick 直接 500，客户端连胜负都拿不到；
        # 且内存已 ended=True 会让后续 tick 短路、永不重试 → pvp_results 永久缺该局。
        # 这里只记日志并把 persisted 置 False；tick 会在后续心跳里幂等重试。
        day = self.db.today(); dt = self.db.now()
        rows = []
        for key, other in (("a", "b"), ("b", "a")):
            r = m["result"][key]
            rows.append((m["match_id"], day, m[key]["uid"], m[other]["uid"],
                         r["outcome"], r["reason"], int(m[key].get("wave", 0)), dt))
        try:
            with self.db.cursor() as cur:
                cur.execute("DELETE FROM pvp_results WHERE match_id=%s", (m["match_id"],))
                cur.executemany(
                    "INSERT INTO pvp_results (match_id,day,uid,opponent_uid,outcome,reason,wave,created_at)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", rows)
            m["persisted"] = True
        except Exception:
            # 记录完整堆栈；不重新抛出，保证终局 tick 仍能把 result 返回给客户端
            logging.exception("pvp_results 落库失败，将在后续 tick 重试 match_id=%s", m.get("match_id"))
            m["persisted"] = False

    def _resolve_terminal(self, m, me, opp, status, now):
        if status not in ("tangsengDead", "surrender"):
            return
        me_key = "a" if m["a"]["uid"] == me["uid"] else "b"
        # 记录我方终局时刻（幂等，只记第一次）
        if me.get("dead_ms") is None:
            # 记 status：对手 tick 时 _opp_status 读 opp["status"] 派生对手的 opponentStatus，勿删
            me["status"] = status
            me["dead_ms"] = now
        # 双方在 EPS 内阵亡 → 平局（即便对手已先判赢，也改判为平局）
        if opp.get("dead_ms") is not None and abs(me["dead_ms"] - opp["dead_ms"]) <= SIMULTANEOUS_EPS_MS:
            self._set_draw(m, now)
            return
        # 首个终局者判负（对手判赢）；若已 ended 则不重复
        if not m.get("ended"):
            self._set_result(m, me_key, self.LOSE_STATUS[status], now)

    def _opp_status(self, m, opp, now) -> str:
        if opp.get("status") in ("tangsengDead", "surrender"):
            return "surrendered" if opp["status"] == "surrender" else "tangsengDead"
        if now - opp["last_tick_ms"] > DISCONNECT_GRACE_MS:
            # 对手心跳缺失超过宽限 → 我方判赢(断线超时)
            if not m.get("ended"):
                opp_key = "a" if m["a"]["uid"] == opp["uid"] else "b"
                self._set_result(m, opp_key, "DisconnectTimeout", now)
            return "disconnected"
        return "playing"

    def _result_for(self, m, uid) -> Optional[dict]:
        # Task 6 填充：终局后按 side 返回该玩家的结果
        if not m.get("result"):
            return None
        side = "a" if m["a"]["uid"] == uid else "b"
        return m["result"][side]

    def _anticheat(self, m, me, opp, inputs, digest, now):  # Task 7 填充
        # Task 7 填充：异常检测（动作频率/摘要一致性等）
        return
