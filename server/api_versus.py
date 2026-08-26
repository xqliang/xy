from __future__ import annotations

# PvP 在线对战：进程内匹配/房间/对局状态机 + 反作弊（WS 快照模型）。
# HTTP tick 心跳转发与 loadout 下发已在 Task 6 退役（快照模型无消费方），对局同步走 /api/versus/ws。
# 单进程 ThreadingHTTPServer 下用一把大锁保护；重启即丢活跃对局（临时对局可接受）。
import contextlib
import json
import logging
import secrets
import socket
import threading
import time
from typing import Any, Callable, Optional

from db import DB
from httputil import read_json, require_auth, send_json, _strict_enabled
from ws import (  # RFC6455 握手/帧编解码纯函数（Task 1），被 WebSocket 连接层复用
    OP_CLOSE, OP_PING, OP_PONG, OP_TEXT,
    decode_frame, encode_frame, encode_text, handshake_response,
)

# —— 可调常量 ——
STAMINA_COST = 5                 # 仅供客户端参考；体力为客户端权威，服务端不校验
MATCH_TIMEOUT_MS = 120_000       # 匹配/等友 2 分钟总倒计时
DISCONNECT_GRACE_MS = 10_000     # 断线宽限：对手 tick 缺失超过即可判赢（与客户端倒计时对齐）
RECENT_WINDOW_MS = 300_000       # 自适应窗口统计的近 5 分钟
W_MIN_MS, W_MAX_MS = 3_000, 15_000   # 同级保持窗口范围
INTER_WAVE_DELAY_MS = 3_000      # 先清者触发后到下一波开始的间隔（须与前端一致）
START_DELAY_MS = 7_500           # match-start 到第 1 波开始的缓冲。需覆盖唐僧归位入场(intro 6s)+两端加载余量，
                                 # 否则玩家武器还没布好就出怪。前端到点仍由 introDone 闸门二次把关（确保归位完才开波）。
SIMULTANEOUS_EPS_MS = 200        # 双方阵亡视为同刻→平局的阈值
KILLS_PER_POWER_PER_SEC = 0.5   # 每点战力每秒可击杀数上界（留大余量，可调）
KILLS_ABS_FLOOR = 30            # 低战力区的击杀绝对下限余量（避免早期误报）
_MIN_DT_S = 0.001               # 摘要间隔下限秒：防止 now 未前进/回退致 dt≤0 把击杀上界压到过小而误报
BAN_DISTINCT_OPPONENTS = 3      # 当天被这么多个不同对手判异常即禁赛
MAPS = ["huoyanshan", "liushahe", "baiguling", "pansidong"]

# —— 进程内状态惰性回收（防字典无界增长；无后台线程，挂在最高频的 enqueue/poll 锁内）——
REAP_INTERVAL_MS = 10_000                 # 回收时间闸门：最多每 10s 扫一次，避免每 poll 都 O(N) 扫描占锁
MATCH_REAP_MS = 120_000                   # 终局后多久回收该 match（给客户端重连/看结果留余量）
IDLE_REAP_MS = 300_000                    # 建局后双方都久未心跳(废弃局)多久回收
ROOM_TTL_MS = MATCH_TIMEOUT_MS            # 孤儿私房存活上限（与匹配总超时一致）
QUEUE_TTL_MS = MATCH_TIMEOUT_MS + 30_000  # 孤儿等待者存活上限（略长于匹配总超时）


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
        self._last_reap_ms = 0                    # 上次惰性回收时刻（时间闸门，0 保证冷启动首个 reap 即跑）

    def reset(self) -> None:  # 测试用
        with self.lock:
            self.queue.clear(); self.recent.clear(); self.rooms.clear()
            self.matches.clear(); self.ticket_match.clear()
            self._last_reap_ms = 0                 # 归零闸门，保证测试后首个 reap 立即触发

    def is_banned(self, uid: str) -> bool:
        # 当天有 ≥3 个不同对手判定异常 → 禁赛
        day = self.db.today()
        with self.db.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT opponent_uid) AS c FROM pvp_anomaly WHERE day=%s AND uid=%s",
                (day, uid),
            )
            row = cur.fetchone()
        return bool(row and int(row["c"]) >= BAN_DISTINCT_OPPONENTS)

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
        # 新建对局一方的实时状态壳。
        # 注（Task 6 退役）：旧 HTTP tick 模型曾在此携带 relay_buffer/sent_seqs/loadout——
        # 转发去重（中继重发+seq 去重）与配装下发（opponentLoadout）均服务于「确定性重放」，
        # WS 快照模型下服务端只转发快照、对手侧本地插值重建，无消费方，故一并删除。
        return {"uid": uid, "rank": rank, "last_tick_ms": now,
                "last_digest": None, "wave": 1, "prev_digest": None, "anomaly_recorded": False,
                "status": "playing",
                # last_next_wave：本侧最近一次被告知的「下一波」波次号（快照路径的 nextWave 去重标记）。
                # 防止 10Hz 快照每帧都重复推同一 nextWave；hello 时清零以便重连带新重新宣告。
                "last_next_wave": None,
                # —— WebSocket 会话态（Task 2）——
                # ws_send：该侧 WS 连接的「发送闭包」Callable[[str], bool]，把 JSON 文本帧写回其 socket；
                #          返回 False 表示发送失败（socket 已坏），hub 据此把该侧判为断线。
                #          None 表示当前无 WS 连接（尚未握手 / 已断开 / 未走 WS 的纯 HTTP tick 客户端）。
                # gone_ms：0 表示在线；非 0 为该侧 WS 断开的服务器时刻(ms)。宽限 DISCONNECT_GRACE_MS 内
                #          同 uid 重连 hello 会清零恢复；超时则惰性判定为 DisconnectTimeout 终局。
                "ws_send": None, "gone_ms": 0}

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

    def _reap(self, now: int) -> None:
        # 惰性回收进程内字典，防无界增长（无后台线程，挂在最高频的 enqueue/poll 锁内）。
        # 时间闸门：最多每 REAP_INTERVAL_MS 扫一次，避免每 poll 都做 O(N) 扫描并占锁。
        if now - self._last_reap_ms < REAP_INTERVAL_MS:
            return
        self._last_reap_ms = now
        # 1) 活跃对局：终局超 MATCH_REAP_MS，或非终局但双方久未心跳超 IDLE_REAP_MS（废弃局）→ 删，连带清 ticket_match
        dead = []
        for mid, m in list(self.matches.items()):
            if m.get("ended"):
                if now - m.get("ended_ms", m["created_ms"]) > MATCH_REAP_MS:
                    dead.append(mid)
            elif now - max(m["a"]["last_tick_ms"], m["b"]["last_tick_ms"]) > IDLE_REAP_MS:
                dead.append(mid)
        for mid in dead:
            self.matches.pop(mid, None)
            for tk in [t for t, (mm, _u) in list(self.ticket_match.items()) if mm == mid]:
                self.ticket_match.pop(tk, None)
        # 2) 孤儿等待者：入队超 QUEUE_TTL_MS 仍在队列（从不 poll/cancel）
        for tk in [t for t, e in list(self.queue.items()) if now - e["enqueued_ms"] > QUEUE_TTL_MS]:
            self.queue.pop(tk, None)
        # 3) 孤儿私房：建房超 ROOM_TTL_MS 无人加入
        for code in [c for c, r in list(self.rooms.items()) if now - r["created_ms"] > ROOM_TTL_MS]:
            self.rooms.pop(code, None)

    # —— 对外匹配 API ——
    def enqueue(self, uid: str, rank: int) -> dict:
        # 禁赛拦截
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            self._prune_recent(now)
            self._reap(now)                    # 惰性回收终局/孤儿状态，防字典无界增长
            # 记录本次入队用于自适应窗口统计，再算去重人数决定窗口
            self.recent.setdefault(rank, []).append((uid, now))
            n = self._recent_distinct(rank, uid, now)
            ticket = secrets.token_hex(8)
            # 注（Task 6 退役）：旧模型曾把本方 loadout 挂在入队条目上透传给 side 再下发对手；
            # WS 快照模型无消费方，入队条目只留匹配必需字段。
            self.queue[ticket] = {"ticket": ticket, "uid": uid, "rank": rank,
                                  "enqueued_ms": now, "hold_until_ms": now + _adaptive_window_ms(n)}
            self._try_pair(now)
            return {"ticket": ticket}

    def poll(self, ticket: str) -> dict:
        with self.lock:
            now = self._now()
            self._reap(now)                    # 惰性回收（最高频入口之一），先清理再处理本请求
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
        # 注意：锁外此时 match 可能被并发 _reap 回收（仅当该局已可回收＝废弃局），
        # 直接 self.matches[mid] 会抛 KeyError 导致 poll 500，故 _match_start_payload 用 .get() 兜底。
        mid, uid = matched
        payload = self._match_start_payload(mid, uid)
        if payload is None:                    # 期间被并发 _reap 回收（仅废弃局）→ 视为超时，避免 KeyError 500
            return {"status": "timeout"}
        return {"status": "matched", "matchStart": payload}

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
            # 撞码检查：token_hex(3) 空间 16^6≈1670万，碰撞极罕见但非零；碰撞会静默覆盖既有房间→重试换新码。
            for _ in range(8):
                if code not in self.rooms:
                    break
                code = self._gen_code()
            ticket = secrets.token_hex(8)
            # 房间记录：code -> 房间元信息（含房主 ticket，便于加入时定位房主）
            self.rooms[code] = {"code": code, "host_uid": uid, "host_rank": rank,
                                "map": self._pick_map(), "created_ms": now, "ticket": ticket}
            # 房主也占一张 ticket，复用同一张 queue 表；标记 room 表示私房挂起（poll 见之仍等待）。
            # 注（Task 6 退役）：旧模型曾把房主 loadout 挂在这张 ticket 上透传，WS 快照模型无消费方，已删除。
            self.queue[ticket] = {"ticket": ticket, "uid": uid, "rank": rank,
                                  "enqueued_ms": now, "hold_until_ms": now + MATCH_TIMEOUT_MS,
                                  "room": code}
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
            # 客人这边只组一次性 entry 参与成局，不入 queue（避免污染匹配）。
            # 注（Task 6 退役）：旧模型曾携带客人 loadout 透传给客人 side，WS 快照模型无消费方，已删除。
            joiner = {"ticket": secrets.token_hex(8), "uid": uid, "rank": rank,
                      "enqueued_ms": now}
            # 成局即销毁房间与房主挂起态，保证一码一局、不能重复加入
            self.queue.pop(host_ticket, None)
            self.rooms.pop(code, None)
            mid = self._make_match(host_entry, joiner, now, map_id=room["map"])
            # 注意：_match_start_payload 在锁内调用（含 DB 读档）。
            # 私房加入是一次性低频操作，可接受；不改动 Task 3 的 poll 热路径。
            return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}

    def _match_start_payload(self, mid: str, uid: str) -> Optional[dict]:
        # 注意：poll 在锁外调用本方法（DB 读档不占锁）；对局可能已被并发 _reap 回收 → 返回 None 由调用方兜底。
        # 锁外只读 match 的不可变字段（seed/map/start_at_ms/双方 uid，成局后不再变），无撕裂读。
        m = self.matches.get(mid)
        if m is None:
            return None
        # 组 match-start：matchId/seed/map/startAt/对手档案。
        # 注（Task 6 退役）：旧模型曾在此追加对方上交的 loadout 作 opponentLoadout（供对手侧确定性重放）；
        # WS 快照模型对手侧从快照本地插值重建，无消费方，已删除。
        opp_uid = m["b"]["uid"] if m["a"]["uid"] == uid else m["a"]["uid"]
        return {"matchId": mid, "seed": m["seed"], "map": m["map"],
                "startAtServerMs": m["start_at_ms"], "opponent": self._profile(opp_uid)}

    # —— 内部工具：按 uid 定位自己是 a/b 侧，返回 (我, 对手) ——
    # 供 ws_* 系列（WS 快照模型）与终局/波次逻辑复用；HTTP tick 转发已在 Task 6 退役。
    def _sides(self, m: dict, uid: str) -> tuple[dict, dict]:
        # 根据 uid 判断自己是 a 还是 b，返回 (我, 对手)
        return (m["a"], m["b"]) if m["a"]["uid"] == uid else (m["b"], m["a"])

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
        # 关键：落库失败绝不向上抛——否则终局处理直接 500，客户端连胜负都拿不到；
        # 且内存已 ended=True 会让后续快照/心跳短路（_set_result/_set_draw 见 result 即返回）、永不重试 → pvp_results 永久缺该局。
        # 这里只记日志并把 persisted 置 False；后续快照处理会幂等重试。
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
            # 记录完整堆栈；不重新抛出，保证终局处理仍能把 result 返回给客户端
            logging.exception("pvp_results 落库失败，将在后续处理重试 match_id=%s", m.get("match_id"))
            m["persisted"] = False

    def _resolve_terminal(self, m, me, opp, status, now):
        if status not in ("tangsengDead", "surrender"):
            return
        me_key = "a" if m["a"]["uid"] == me["uid"] else "b"
        # 记录我方终局时刻（幂等，只记第一次）
        if me.get("dead_ms") is None:
            # 记 dead_ms：对手侧宽限判定(_ws_check_gone_locked)与平局 EPS 判定都会读它。
            # status 字段旧由已退役的 _opp_status（Task 6）读取，当前暂无消费方，保留以备终局态查询。
            me["status"] = status
            me["dead_ms"] = now
        # 双方在 EPS 内阵亡 → 平局（即便对手已先判赢，也改判为平局）
        if opp.get("dead_ms") is not None and abs(me["dead_ms"] - opp["dead_ms"]) <= SIMULTANEOUS_EPS_MS:
            self._set_draw(m, now)
            return
        # 首个终局者判负（对手判赢）；若已 ended 则不重复
        if not m.get("ended"):
            self._set_result(m, me_key, self.LOSE_STATUS[status], now)

    def _result_for(self, m, uid) -> Optional[dict]:
        # Task 6 填充：终局后按 side 返回该玩家的结果
        if not m.get("result"):
            return None
        side = "a" if m["a"]["uid"] == uid else "b"
        return m["result"][side]

    # ========================================================================
    # WebSocket 会话（Task 2）：连接层把帧解析成消息后调这些方法。
    # 全部在 self.lock 内操作 match 态；发送失败一律走 _ws_push_locked →
    # _ws_side_gone_locked，与该侧真正 ws_gone 同一条路径。
    #
    # 锁的可重入性：self.lock 是普通 threading.Lock（不可重入）。因此凡「发送失败→
    # 判该侧断线」这种需要再次进入判断的路径，**绝不**回调公开的 ws_gone（会二次取锁死锁），
    # 而是调用内部 _ws_*_locked 系列（调用方已持锁）。公开 ws_* 方法只取一次锁。
    # ========================================================================

    def _ws_push_locked(self, target: dict, other: dict, m: dict, msg: dict,
                        cascade: bool = True) -> bool:
        """给 target 侧 WS 推一条 JSON 消息（持锁调用）。

        成功返回 True；发送异常/返回 False 且 cascade=True 时，视该侧断线，走
        _ws_side_gone_locked 判负并通知对手 other。cascade=False 用于「通知对手它对手断了」
        这类 Secondary 推送——避免对手也恰好发送失败时再次级联判负造成递归。"""
        send = target.get("ws_send")
        if not send:
            return False
        try:
            ok = bool(send(json.dumps(msg, separators=(",", ":"), ensure_ascii=False)))
        except Exception:
            ok = False
        if not ok and cascade:
            self._ws_side_gone_locked(m, target, other, send)
        return ok

    def _ws_side_gone_locked(self, m: dict, side: dict, other: dict, send) -> None:
        """把 side 侧判为断线（持锁）：清 ws_send、记 gone_ms、通知对手 oppGone。

        **陈旧连接保护**：若 side 当前 ws_send 已不是本连接持有的 send（说明期间已被
        新连接覆盖=重连），则静默返回——绝不用一条迟到的旧连接清理顶掉重连后的新连接。"""
        if send is not None and side.get("ws_send") is not send:
            return                      # 已被重连覆盖：本连接已陈旧，忽略
        if side.get("ws_send") is not None:
            side["ws_send"] = None
        side["gone_ms"] = self._now()
        if other.get("ws_send"):
            # 通知对手「你的对手断了」（cascade=False：对手若也坏不再级联）
            self._ws_push_locked(other, side, m, {"type": "oppGone"}, cascade=False)

    def _ws_check_gone_locked(self, m: dict, now: int) -> None:
        """惰性宽限超时判定（持锁）：任一侧 gone_ms 已设且越过宽限、对局未终局 →
        该侧判负(DisconnectTimeout)，把 result 推给存活侧。

        挂在每个 ws_* 入口顶部，避免额外后台线程；对手/自身下一次任意消息即触发。"""
        if m.get("ended"):
            return
        for key, other_key in (("a", "b"), ("b", "a")):
            side = m[key]
            if side.get("gone_ms") and now - side["gone_ms"] > DISCONNECT_GRACE_MS:
                self._set_result(m, key, "DisconnectTimeout", now)
                other = m[other_key]
                if other.get("ws_send"):
                    self._ws_push_locked(other, side, m,
                                         {"type": "result", **m["result"][other_key]})
                return

    def _ws_push_result_locked(self, m: dict) -> None:
        """把权威 result 推给两侧 WS（持锁）；每侧各带自己的 outcome/reason。"""
        if not m.get("result"):
            return
        for key in ("a", "b"):
            side = m[key]
            other = m["b"] if key == "a" else m["a"]
            if side.get("ws_send"):
                self._ws_push_locked(side, other, m, {"type": "result", **m["result"][key]})

    def ws_hello(self, uid: str, match_id: str, send: Callable[[str], bool]) -> dict:
        """WS 首条 hello：校验 match 存在 + uid 属于该局；登记 ws_send、清 gone_ms、刷 liveness。

        重连场景：同 uid 新连接覆盖旧 ws_send、清零 gone_ms，即刻恢复。返回 {serverMs} 供连接层回 welcome；
        校验失败返回 {"error": ...}，连接层据此关闭连接。

        波次重宣告（Task 6 修）：清零 last_next_wave，使重连后首条快照重新推一次 nextWave，
        保证客户端（其波次态跨重连保留）能重新同步当前「下一波」开始时刻。"""
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return {"error": "bad_hello"}
            me, opp = self._sides(m, uid)
            self._ws_check_gone_locked(m, now)      # 顺便惰性检查对手宽限超时
            me["ws_send"] = send
            me["gone_ms"] = 0                        # 重连清零，恢复在线
            me["last_tick_ms"] = now                 # 刷 liveness，防 IDLE_REAP 中途回收
            me["last_next_wave"] = None              # 清零去重标记，重连后首快照重新宣告 nextWave
            return {"serverMs": now}

    def ws_snap(self, uid: str, match_id: str, msg: dict) -> None:
        """收到本方 snap：派生小 digest 存 last_digest/wave（供终局），接 _anticheat 做反作弊启发式，
        再把快照**原样**转发给对手的 ws_send。服务端不解析大字段，只取四个小字段。

        反作弊接线（Task 6）：HTTP tick 退役后，_anticheat 原只在 tick 内调用会失活，故迁到此处。
        快照模型无「动作(inputs)」概念（客户端不再逐 tick 上报命令），故传空列表 inputs=[]；
        _anticheat 当前未引用 inputs（放置经济校验留 Plan C 接口），空列表不使任何既有检查失活。
        注意：WS digest 不含 power（快照无该字段、客户端亦不再自报 digest），击杀上界 ceil 退化为
        KILLS_ABS_FLOOR=30 的扁平上界（不再随战力缩放），但仍能触发 kills_over_ceiling。"""
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return
            self._ws_check_gone_locked(m, now)
            me, opp = self._sides(m, uid)
            me["last_tick_ms"] = now
            s = msg.get("s") if isinstance(msg, dict) else None
            if not isinstance(s, dict):
                return                              # 缺 s 的快照忽略（容错）
            units = s.get("units")
            # 只派生四个小字段做 digest；客户端无需再自报 digest（HTTP tick 已在 Task 6 退役）。
            # wave 必须保留 0（开局第一波前的真实值：客户端 battle.wave=0）。原先的
            # `int(...) or 1` 会把 0 吞成 1 → _next_wave_for 永远算出未排程的波 2 →
            # 首波 nextWave 永不宣告 → 客户端永不开波（实测「连接正常但不出怪」的第二层根因）。
            # 缺省/非法值回退本侧已记录的 wave（容错，不因坏快照抛错杀连接）。
            try:
                wave_val = int(s["wave"]) if s.get("wave") is not None else int(me.get("wave", 1))
            except (TypeError, ValueError):
                wave_val = int(me.get("wave", 1))
            digest = {
                "wave": wave_val,
                "tangsengHP": s.get("tangsengHP", 0),
                "kills": s.get("kills", 0),
                "units": len(units) if isinstance(units, list) else 0,
            }
            me["last_digest"] = digest
            me["wave"] = digest["wave"]
            # Task 6：反作弊接线——退役 HTTP tick 后迁到此处。快照模型无动作概念，传空 inputs=[]。
            # _anticheat 用 digest 的 delta（唐僧血单调不增/击杀上界/波次不超前）做启发式，空 inputs 不影响。
            self._anticheat(m, me, opp, [], digest, now)
            # 波次排程宣告（Task 6 修 bug）：沿用 HTTP tick「每响应都带 nextWave」语义——按本侧 wave
            # 算下一波，变化时才推（last_next_wave 防 10Hz 快照刷屏）。开局首波靠此触达客户端：
            # 客户端首快照 wave=0 → 宣告 nextWave{wave:1}，否则客户端永不被告知波 1 开始时刻、
            # maybeOpenPvpWave 永不开波（实测「连接正常但不出怪」即此因）。
            nxt = self._next_wave_for(m, me)
            if nxt and nxt.get("wave") != me.get("last_next_wave"):
                me["last_next_wave"] = nxt["wave"]
                self._ws_push_locked(me, opp, m, {"type": "nextWave", **nxt})
            if opp.get("ws_send"):
                self._ws_push_locked(opp, me, m, {"type": "oppSnap", "s": s})

    def ws_wave_cleared(self, uid: str, match_id: str, wave) -> None:
        """本方清波：沿用 HTTP tick 的「先清者定下一波」排程，再给**两侧**各推 nextWave
        （每侧按自己当前波次视角算下一波开始时刻）。"""
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return
            self._ws_check_gone_locked(m, now)
            me, opp = self._sides(m, uid)
            me["last_tick_ms"] = now
            w = int(wave or 0)
            if w and (w + 1) not in m["wave_schedule"]:
                m["wave_schedule"][w + 1] = now + INTER_WAVE_DELAY_MS
                m["first_clear"][w] = uid
            # 清波者的 wave 视图提升到至少已清波号：清波上报可能先于「wave 已推进」的快照到达
            #（me["wave"] 取自最近快照，100ms 节流下有滞后）。不提升的话 _next_wave_for 会按旧
            # wave 算出更早的波 → 给清波者重推已宣告过的旧波，而真正刚排程的 w+1 反而不推。
            me["wave"] = max(int(me.get("wave", 0) or 0), w)
            # 两侧各自按自己的当前波次视角下发 nextWave（沿用 _next_wave_for）。
            # 同时把该侧 last_next_wave 记到宣告的波次，避免 ws_snap 路径因去重标记未同步而重复宣告同一 nextWave。
            nxt_me = self._next_wave_for(m, me)
            nxt_opp = self._next_wave_for(m, opp)
            if nxt_me:
                me["last_next_wave"] = nxt_me["wave"]
                self._ws_push_locked(me, opp, m, {"type": "nextWave", **nxt_me})
            if nxt_opp:
                opp["last_next_wave"] = nxt_opp["wave"]
                self._ws_push_locked(opp, me, m, {"type": "nextWave", **nxt_opp})

    def ws_status(self, uid: str, match_id: str, v: str) -> None:
        """本方上报终局态（surrender/tangsengDead）：走既有 _resolve_terminal，再给两侧推 result。"""
        with self.lock:
            now = self._now()
            m = self.matches.get(match_id)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return
            self._ws_check_gone_locked(m, now)
            me, opp = self._sides(m, uid)
            me["last_tick_ms"] = now
            self._resolve_terminal(m, me, opp, v, now)   # 只对 surrender/tangsengDead 生效
            self._ws_push_result_locked(m)

    def ws_gone(self, uid: str, match_id: str, send=None) -> None:
        """公开入口：连接层在读循环退出后调用，标记该侧 WS 断开并通知对手。"""
        with self.lock:
            self._ws_gone_locked(uid, match_id, send)

    def _ws_gone_locked(self, uid: str, match_id: str, send) -> None:
        """持锁版 ws_gone：定位 (me, opp) 后交给 _ws_side_gone_locked 处理（含陈旧保护）。"""
        now = self._now()
        m = self.matches.get(match_id)
        if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
            return
        me, opp = self._sides(m, uid)
        self._ws_side_gone_locked(m, me, opp, send)

    def _anticheat(self, m, me, opp, inputs, digest, now):
        # 从每秒摘要 digest 做启发式异常检测；终局或无摘要时跳过。
        # 注意：本方法在 self.lock 内调用（HTTP tick 退役后改由 ws_snap 在锁内调用），
        # 命中异常才写库（低频），可接受。inputs 为旧转发模型的动作列表，快照模型无动作概念故传 []，
        # 当前实现未引用 inputs（放置经济校验留 Plan C 接口）。
        if m.get("ended") or not digest:
            return
        reasons = []
        # 1) 唐僧血单调不增；击杀增量不超过 f(战力)×时长 的上界
        prev = me.get("prev_digest")
        if prev is not None:
            if digest.get("tangsengHP", 0) > prev.get("tangsengHP", 0):
                reasons.append("tangsengHP_increased")
            # _ms 是该摘要的服务端采样时刻；_MIN_DT_S 下限无除法，仅用于时钟不前进/回退时钉住击杀上界窗口、防误报
            dt_s = max(_MIN_DT_S, (now - prev["_ms"]) / 1000)
            dkills = digest.get("kills", 0) - prev.get("kills", 0)
            ceil = KILLS_ABS_FLOOR + KILLS_PER_POWER_PER_SEC * max(0, digest.get("power", 0)) * dt_s
            if dkills > ceil:
                reasons.append("kills_over_ceiling")
        # 2) 波次进度不能超前于服务端调度（最多领先 1 波）
        if digest.get("wave", 1) > max(m["wave_schedule"].keys() or [1]) + 1:
            reasons.append("wave_ahead")
        # 3) 放置动作经济合法性（粗校验）留接口，本期只记明显越界；精校验待 Plan C 客户端动作字段定型后回填
        me["prev_digest"] = {**digest, "_ms": now}
        if reasons and not me.get("anomaly_recorded"):
            # 同对手当天内存内只成功写一次，真正兑现「低频」；写库失败(返回 False)则后续快照处理重试。重启即丢，与临时对局定位一致。
            if self._record_anomaly(m, me["uid"], opp["uid"], reasons, now):
                me["anomaly_recorded"] = True

    def _record_anomaly(self, m, uid, opp_uid, reasons, now) -> bool:
        # INSERT IGNORE + 唯一键 (day,uid,opponent_uid) → 同对手当天只记 1 条。
        # 与 _persist_result 一致：写库失败不向上抛（否则本次反作弊处理直接 500）。
        # 返回是否成功落库（INSERT IGNORE 命中唯一键的 no-op 也算成功）；失败记日志，交调用方后续处理重试。
        day = self.db.today(); dt = self.db.now()
        try:
            with self.db.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                    " VALUES (%s,%s,%s,%s,%s,%s)",
                    (day, uid, opp_uid, m["match_id"], json.dumps(reasons, ensure_ascii=False), dt))
            return True
        except Exception:
            logging.exception("pvp_anomaly 记录失败 uid=%s opp=%s match_id=%s", uid, opp_uid, m.get("match_id"))
            return False

    def flush_active_matches(self) -> None:
        """定期/关机时把所有未终局对局镜像进 pvp_active_match（锁内快照、锁外写库、对账删非活跃行）。
        写库失败只记日志不抛（对齐 _persist_result）。"""
        with self.lock:
            snap = []
            for mid, m in self.matches.items():
                if m.get("ended"):
                    continue
                tks = {u: t for t, (mm, u) in self.ticket_match.items() if mm == mid}
                snap.append({
                    "match_id": mid, "uid_a": m["a"]["uid"], "uid_b": m["b"]["uid"],
                    "ticket_a": tks.get(m["a"]["uid"]), "ticket_b": tks.get(m["b"]["uid"]),
                    "blob": _serialize_match(m),
                })
            active_ids = [s["match_id"] for s in snap]
        dt = self.db.now()
        try:
            with self.db.cursor() as cur:
                for s in snap:
                    cur.execute(
                        "INSERT INTO pvp_active_match"
                        " (match_id,uid_a,uid_b,ticket_a,ticket_b,state_json,updated_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s)"
                        " ON DUPLICATE KEY UPDATE uid_a=VALUES(uid_a),uid_b=VALUES(uid_b),"
                        " ticket_a=VALUES(ticket_a),ticket_b=VALUES(ticket_b),"
                        " state_json=VALUES(state_json),updated_at=VALUES(updated_at)",
                        (s["match_id"], s["uid_a"], s["uid_b"], s["ticket_a"], s["ticket_b"],
                         json.dumps(s["blob"], ensure_ascii=False), dt))
                if active_ids:
                    ph = ",".join(["%s"] * len(active_ids))
                    cur.execute(f"DELETE FROM pvp_active_match WHERE match_id NOT IN ({ph})", active_ids)
                else:
                    cur.execute("DELETE FROM pvp_active_match")
        except Exception:
            logging.exception("pvp_active_match flush 失败（不影响对局，下轮重试）")

    def load_active_matches(self) -> int:
        """进程启动时回放未终局对局到内存（在 serve_forever 之前调用，无并发）。返回回放条数。"""
        now = self._now()
        try:
            with self.db.cursor() as cur:
                cur.execute("SELECT match_id,uid_a,uid_b,ticket_a,ticket_b,state_json FROM pvp_active_match")
                rows = cur.fetchall()
        except Exception:
            logging.exception("pvp_active_match 回放读取失败，跳过（活跃对局丢失，客户端将重新匹配）")
            return 0
        n = 0
        for row in rows:
            try:
                blob = json.loads(row["state_json"])
                m = _deserialize_match(blob, now)
                if m.get("ended"):
                    continue
                self.matches[m["match_id"]] = m
                if row.get("ticket_a"):
                    self.ticket_match[row["ticket_a"]] = (m["match_id"], row["uid_a"])
                if row.get("ticket_b"):
                    self.ticket_match[row["ticket_b"]] = (m["match_id"], row["uid_b"])
                n += 1
            except Exception:
                logging.exception("pvp_active_match 单行回放失败 match_id=%s，跳过", row.get("match_id"))
        if n:
            logging.info("pvp_active_match 回放 %d 局活跃对局", n)
        return n


# ---- 里程碑 B：活跃对局序列化（持久化用）----
# ws_send 是运行时闭包（不可 JSON 化），序列化一律剔除；重连时 ws_hello 会重挂。
# wave_schedule / first_clear 是 int 键 dict，JSON 会把键转成 str，反序列化时 int() 回来。

def _serialize_match(m: dict) -> dict:
    """把内存 match dict 转成可 JSON 化的快照（剔除每侧 ws_send）。
    注意：这是 shallow-copy——返回的 out["wave_schedule"]/out["first_clear"]/out["result"]
    与活跃 match 仍是同一对象（未深拷）。仅因 B3 在锁内快照后立即 json.dumps 才安全；
    调用方切勿把返回的 blob 暂存到锁外再序列化，否则可能读到被其它请求并发改动的中间态。"""
    def side(s: dict) -> dict:
        return {k: v for k, v in s.items() if k != "ws_send"}
    out = {k: v for k, v in m.items() if k not in ("a", "b")}
    out["a"] = side(m["a"])
    out["b"] = side(m["b"])
    return out


def _deserialize_match(blob: dict, now: int) -> dict:
    """把 JSON 快照还原成内存 match dict：int() 键、ws_send=None、gone_ms=now（视为断线待重连）、
    created_ms=now（关键：给回放局新鲜的重连窗，否则旧 created_ms 会让它一 _reap 就被“从未连接”清掉）、
    last_tick_ms=now（同理：视为刚活跃，否则长停机后旧 last_tick 会被 _reap 的 IDLE 分支立即清掉）、
    connected_ever=False（回放后需重新 ws_hello 才算“连过”）。"""
    m = dict(blob)
    m["wave_schedule"] = {int(k): v for k, v in (blob.get("wave_schedule") or {}).items()}
    m["first_clear"] = {int(k): v for k, v in (blob.get("first_clear") or {}).items()}
    m["created_ms"] = now
    for key in ("a", "b"):
        s = dict(blob[key])
        s["ws_send"] = None
        s["gone_ms"] = now
        s["last_tick_ms"] = now   # 回放视为刚活跃，避免长停机后旧 last_tick 让回放局被 IDLE_REAP 立即清掉
        s["connected_ever"] = False   # 回放后需重新 ws_hello 才算“连过”（B4 撮合退队分支据此）
        m[key] = s
    return m


# ============================================================================
# HTTP handler 封装（Task 8）：把 VersusHub 方法包成 fn(handler, db)，供 server.py
# 路由字典 dispatch。风格与 api_player.py 一致——不自己 try/except，统一由
# Handler._api 把异常转 500。
# ============================================================================

def _hub(handler):
    # 从 Handler 类属性取进程内 VersusHub 单例（main() 里 BoundHandler.versus 注入）
    return handler.versus

def _read_body(handler):
    # 输入解析容错：坏/空 JSON 回 400 bad_json，返回 None 让调用方终止（对齐 handle_login 等）
    try:
        return read_json(handler)
    except ValueError as e:
        send_json(handler, 400, {"error": {"code": "bad_json", "msg": str(e)}})
        return None

def _parse_rank(handler, body):
    # rank 非数字回 400 bad_body（对齐 handle_unlock 对 rankLevel 的处理）；合法时返回 int（含 0），出错返回 None 让调用方终止
    try:
        return int(body.get("rank") or 0)
    except (TypeError, ValueError):
        send_json(handler, 400, {"error": {"code": "bad_body", "msg": "rank must be int"}})
        return None

def handle_versus_enqueue(handler, db: DB) -> None:
    # 随机匹配入队：返回 ticket，客户端凭此 poll 拿配对结果。
    # 注（Task 6 退役）：旧模型曾接收并透传 loadout，WS 快照模型无消费方，已删除。
    body = _read_body(handler)
    if body is None: return
    uid = require_auth(handler, db, body)
    if not uid: return
    rank = _parse_rank(handler, body)
    if rank is None: return
    send_json(handler, 200, _hub(handler).enqueue(uid, rank))

def handle_versus_poll(handler, db: DB) -> None:
    # 轮询排队/对局状态：waiting / matched / timeout
    body = _read_body(handler)
    if body is None: return
    uid = require_auth(handler, db, body)
    if not uid: return
    send_json(handler, 200, _hub(handler).poll(str(body.get("ticket") or "")))

def handle_versus_cancel(handler, db: DB) -> None:
    # 取消排队（离开队列；已成局的不受影响）
    body = _read_body(handler)
    if body is None: return
    uid = require_auth(handler, db, body)
    if not uid: return
    send_json(handler, 200, _hub(handler).cancel(str(body.get("ticket") or "")))

def handle_versus_room_create(handler, db: DB) -> None:
    # 房主建私房：返回房间码 + 邀请链接（Origin 作 base_url，供前端拼 share link）。
    # 注（Task 6 退役）：旧模型曾透传 loadout，WS 快照模型无消费方，已删除。
    body = _read_body(handler)
    if body is None: return
    uid = require_auth(handler, db, body)
    if not uid: return
    rank = _parse_rank(handler, body)
    if rank is None: return
    base = (handler.headers.get("Origin") or "").rstrip("/")
    send_json(handler, 200, _hub(handler).room_create(uid, rank, base_url=base))

def handle_versus_room_join(handler, db: DB) -> None:
    # 客人凭码加入私房：直接与房主成局。
    # 注（Task 6 退役）：旧模型曾透传 loadout，WS 快照模型无消费方，已删除。
    body = _read_body(handler)
    if body is None: return
    uid = require_auth(handler, db, body)
    if not uid: return
    rank = _parse_rank(handler, body)
    if rank is None: return
    send_json(handler, 200, _hub(handler).room_join(str(body.get("code") or "").upper(), uid, rank))


def _ws_authenticate(qs, db, strict: bool) -> str | None:
    """WS 握手鉴权：优先 ?token=；非 strict 时回退 ?uid=（不做数字格式校验，兼容旧客户端/测试）。"""
    from auth_session import resolve_token

    token = (qs.get("token") or [""])[0]
    if token:
        uid = resolve_token(db, token)
        if uid:
            return uid
    if strict:
        return None
    return (qs.get("uid") or [""])[0] or None


# ============================================================================
# WebSocket 连接层（Task 2）：把 GET /api/versus/ws 升级为 WS，循环读帧并分发到
# VersusHub 的 ws_* 方法。占用 ThreadingHTTPServer 分配给本连接的那个线程（每条 WS 一线程）。
#
# 读：用 handler.rfile（BufferedReader）——它已持有握手后可能随请求一并到达的字节，
#     且严格比裸 socket.recv 更安全（绝不漏掉 rfile 内部缓冲里的帧）。
# 写：握手响应 + 所有帧都直接写 handler.connection（裸 socket），**不经过 wfile**
#     （wfile 会缓冲且由 http.server 管理，握手后再用它写会与它的缓冲/生命周期打架）。
# 超时：handler.timeout=5 经 StreamRequestHandler.setup() 设到连接 socket，rfile.read1
#     在空闲 5s 抛 socket.timeout → 发保活 ping；连续两轮无入站流量 → 判死退出。
# ============================================================================
def handle_versus_ws(handler, hub) -> None:
    from urllib.parse import parse_qs, urlparse

    # 1) 解析 query：matchId + 鉴权（?token= 优先，非 strict 时回退 ?uid=，与 HTTP 端点同一 fail-closed strict 读）。
    qs = parse_qs(urlparse(handler.path).query)
    match_id = (qs.get("matchId") or [""])[0]
    strict = _strict_enabled(handler)
    uid = _ws_authenticate(qs, hub.db, strict)
    if not uid:
        send_json(handler, 401, {"error": {"code": "unauthorized", "msg": "ws auth required"}})
        return

    # 2) 校验升级头：必须 Upgrade: websocket + Sec-WebSocket-Key，否则 400 不升级。
    upgrade = (handler.headers.get("Upgrade") or "").lower()
    key = handler.headers.get("Sec-WebSocket-Key") or ""
    if "websocket" not in upgrade or not key:
        send_json(handler, 400, {"error": {"code": "bad_ws",
                                           "msg": "need Upgrade: websocket + Sec-WebSocket-Key"}})
        return

    # 弱网优化①：开 TCP_NODELAY（禁 Nagle）。本连接是 100ms 级小帧双向实时同步，
    # Nagle 攒包与对端延迟 ACK 叠加可凭空多出 40~200ms 延迟。放在握手写出之前，
    # 让 101 响应本身也不被攒；平台不支持时降级（仅多潜在延迟，不影响正确性）。
    try:
        handler.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass

    # 3) 101 握手：裸字节一次性写出 socket（HTTP 部分到此结束）。
    try:
        handler.connection.sendall(handshake_response(key).encode("ascii"))
    except OSError:
        return
    # 关键：握手后 http.server 不应再在同一连接上读下一个 HTTP 请求——我们已占用该连接做 WS。
    handler.close_connection = True

    hello_ok = False          # 首条必须是 hello；之前一律忽略其他消息
    buf = b""                 # 帧缓冲（应对 TCP 分片/粘包）
    idle_timeouts = 0         # 连续读超时计数
    send_lock = threading.Lock()   # 每连接一把发送锁：hub 回调线程与读循环线程都经此写 socket

    def ws_send(text: str) -> bool:
        """该连接的发送闭包（交给 hub 存进 side['ws_send']）：带锁写一个 TEXT 帧。
        返回 False 表示 socket 已坏，hub 会据此把该侧判为断线。"""
        frame = encode_text(text)
        with send_lock:
            try:
                handler.connection.sendall(frame)
                return True
            except OSError:
                return False

    def _handle_text(payload: bytes) -> None:
        """解析一条 TEXT 帧的 JSON 并分发；畸形 JSON 静默忽略（连接保持）。"""
        nonlocal hello_ok
        try:
            msg = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return                      # 畸形 JSON → 忽略，不杀连接
        if not isinstance(msg, dict):
            return
        mtype = msg.get("type")
        if not hello_ok:
            # hello 之前：只有 hello 能放行，且 matchId/uid 必须与 query 一致
            if mtype == "hello" and str(msg.get("matchId") or "") == match_id \
                    and str(msg.get("uid") or "") == uid:
                res = hub.ws_hello(uid, match_id, ws_send)
                if res and not res.get("error"):
                    hello_ok = True
                    ws_send(json.dumps({"type": "welcome", "serverMs": res["serverMs"]},
                                       separators=(",", ":")))
            return                      # hello 前忽略一切（含非法 hello）
        # hello 后：分发业务消息
        if mtype == "snap":
            hub.ws_snap(uid, match_id, msg)
        elif mtype == "waveCleared":
            hub.ws_wave_cleared(uid, match_id, msg.get("wave"))
        elif mtype == "status":
            hub.ws_status(uid, match_id, msg.get("v"))
        elif mtype == "ping":
            # 应用层心跳回响：客户端发 {"type":"ping","t":<客户端ms>}，原样回 {"type":"pong","t":<同值>}。
            # 连接层直回（不碰 hub 锁、不改对局态），仅供客户端算 RTT（顶部延迟 HUD）。
            # t 缺省/非数字时回 None；畸形 t 不影响连接（心跳与业务解耦）。
            ws_send(json.dumps({"type": "pong", "t": msg.get("t")}, separators=(",", ":")))
        # 未知 type → 忽略

    def _mark_gone() -> None:
        """读循环退出后，把本侧标记为断线（传本连接 send 供陈旧保护比对）。"""
        if hello_ok:
            hub.ws_gone(uid, match_id, send=ws_send)

    # 4) 帧循环：读 → 解帧 → 分发；超时发 ping 保活，两轮无流量判死。
    while True:
        try:
            chunk = handler.rfile.read1(65536)
        except socket.timeout:
            chunk = b""                   # 5s 无数据 = 本轮超时
        except OSError:
            _mark_gone()
            return                        # socket 错误/EOF → 退出
        if not chunk:
            # 无数据：超时或 EOF。累计超时；连续两轮无入站 → 判死。
            idle_timeouts += 1
            if idle_timeouts >= 2:
                break
            # 单轮超时：发保活 ping（防中间层因空闲掐长连接）
            with send_lock:
                try:
                    handler.connection.sendall(encode_frame(OP_PING, b""))
                except OSError:
                    _mark_gone()
                    return
            continue
        # 有数据：重置超时计数，并入缓冲
        idle_timeouts = 0
        buf += chunk
        # 反复从缓冲解帧，直到凑不齐一整帧（consumed=0）
        while buf:
            fr = decode_frame(buf)
            consumed = fr["consumed"]
            if consumed == 0:
                break                       # 半截帧：留着等下一次读补齐
            buf = buf[consumed:]
            op = fr["opcode"]
            payload = fr["payload"]
            if op == OP_TEXT:
                _handle_text(payload)
            elif op == OP_PING:
                # 客户端 ping → 回 pong（同 payload）
                with send_lock:
                    try:
                        handler.connection.sendall(encode_frame(OP_PONG, payload))
                    except OSError:
                        _mark_gone()
                        return
            elif op == OP_CLOSE:
                # 对端关闭：回一个 close 帧，标记断线并退出
                with send_lock:
                    with contextlib.suppress(OSError):
                        handler.connection.sendall(encode_frame(OP_CLOSE, b""))
                _mark_gone()
                return
            # OP_PONG / OP_BINARY 等：忽略
    # 连续超时判死退出
    _mark_gone()
