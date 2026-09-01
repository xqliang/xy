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

from redis.exceptions import WatchError  # 撮合乐观事务：EXEC 时被 WATCH 的键被改过则抛此异常 → 重试

from db import DB
from httputil import read_json, require_auth, send_json, _strict_enabled
from rediskv import k  # PvP Redis 键前缀助手（xy:pvp:...），匹配层所有 key 经它拼装
from ws import (  # RFC6455 握手/帧编解码纯函数（Task 1），被 WebSocket 连接层复用
    OP_CLOSE, OP_PING, OP_PONG, OP_TEXT,
    decode_frame, encode_frame, encode_text, handshake_response,
)

# —— 可调常量 ——
STAMINA_COST = 5                 # 仅供客户端参考；体力为客户端权威，服务端不校验
MATCH_TIMEOUT_MS = 120_000       # 匹配/等友 2 分钟总倒计时
DISCONNECT_GRACE_MS = 15_000     # 断线宽限（45s→15s，用户拍板：45s 判胜太久）：覆盖切后台/弱网闪断的重连窗；与客户端倒计时对齐
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
MATCH_CONNECT_GRACE_MS = 20_000  # 撮合成局后，双方都从未 WS 连接超过此时长 → 退队回收（防僵尸局/打空气）
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
                 pick_map: Callable[[], str] | None = None,
                 redis_client=None,
                 instance_id: str | None = None):
        self.db = db
        self._now = now_ms or (lambda: int(time.time() * 1000))
        self._gen_seed = gen_seed or (lambda: secrets.randbelow(2**31))
        self._gen_code = gen_code or (lambda: secrets.token_hex(3).upper())
        self._pick_map = pick_map or (lambda: secrets.choice(MAPS))
        # C1.2：注入 Redis 客户端（当前代码尚未使用，C1.3+ 匹配层迁移到 Redis 时经 self.r 读写）。
        # None 表示未接 Redis（进程内模式/部分单测），使用方须自行判空。
        self.r = redis_client
        # C4-fencing：本进程唯一身份，作每局 owner:{mid} 令牌值；多实例下用于判"我是否仍持有该局"。
        # 默认随机（每进程一个，server.py 无需传）；测试可传定值。
        self.instance_id = instance_id or secrets.token_hex(8)
        self.lock = threading.Lock()
        self._flush_lock = threading.Lock()  # 串行化 flush（周期线程 vs SIGTERM），防重入；实际互斥由 flush 内 self.lock 保证
        self.queue: dict[str, dict] = {}          # 【已弃用·留空】随机队列(C1.3)+私房(C1.5)均迁 Redis；留空字段仅为 reset() 兼容，无写入方
        self.recent: dict[int, list[tuple[str, int]]] = {}  # rank -> [(uid, ms)]
        self.rooms: dict[str, dict] = {}          # 【已弃用·留空】私房记录 C1.5 迁 Redis(room:{code})；留空字段仅为 reset() 兼容，无写入方（C2 删了 _reap 的 rooms 分支）
        self.matches: dict[str, dict] = {}        # match_id -> Match
        self.ticket_match: dict[str, tuple[str, str]] = {}  # ticket -> (match_id, uid)
        self._last_reap_ms = 0                    # 上次惰性回收时刻（时间闸门，0 保证冷启动首个 reap 即跑）

    def reset(self) -> None:  # 测试用
        with self.lock:
            self.queue.clear(); self.recent.clear(); self.rooms.clear()
            self.matches.clear(); self.ticket_match.clear()
            self._last_reap_ms = 0                 # 归零闸门，保证测试后首个 reap 立即触发
        if self.r is not None:
            self.r.flushdb()                       # 测试清理：清空注入的 Redis（None 客户端安全跳过）

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
                "ws_send": None, "gone_ms": 0,
                "connected_ever": False}   # 里程碑 B：是否曾有过 ws_hello（撮合退队用）

    # —— 撮合成局：拆成「进程内运行时」+「Redis 轻量记录」两半 ——
    # C1.4：_make_match 原来只建进程内 matches；现拆为
    #   _store_match_inproc：建全 side/ws_send 运行时（单实例 owner=本实例，ws_* 读它，不变）；
    #   _queue_match_record：把轻量记录(match:{mid})+ticket→match 索引(tm)写进给定 pipe
    #                        （standalone 时自带 pipe；撮合时并进 WATCH/MULTI 同一事务，保证原子）。
    # seed/map/start 只生成一次，同时喂给进程内与 Redis，保证两者一致（poll 从 Redis 读 matchStart）。
    def _store_match_inproc(self, mid: str, seed: int, mp: str, start: int,
                            e1: dict, e2: dict, now: int) -> dict:
        # 建进程内 Match 运行时 + ticket->match 索引（与旧 _make_match 主体逐字等价，仅参数化 seed/map/start）
        m = {
            "match_id": mid, "seed": seed, "map": mp,
            "start_at_ms": start,
            "a": self._new_side(e1["uid"], e1["rank"], now),
            "b": self._new_side(e2["uid"], e2["rank"], now),
            "wave_schedule": {1: start}, "first_clear": {},
            "result": None, "created_ms": now, "ended": False,
        }
        self.matches[mid] = m
        self.ticket_match[e1["ticket"]] = (mid, e1["uid"])
        self.ticket_match[e2["ticket"]] = (mid, e2["uid"])
        return m

    def _queue_match_record(self, pipe, mid: str, seed: int, mp: str, start: int,
                            uid_a: str, uid_b: str, tk_a: str, tk_b: str) -> None:
        # 往 pipe 上排入：轻量对局记录 match:{mid} + tm 索引（供任意实例的 poll 组 matchStart）。
        # PEXPIRE 作真实时间兜底防泄漏；逻辑时钟下的回收由进程内 _reap（matches 分支）负责。
        pipe.hset(k("match", mid), mapping={
            "seed": seed, "map": mp, "start_at_ms": start, "uid_a": uid_a, "uid_b": uid_b})
        pipe.pexpire(k("match", mid), MATCH_REAP_MS)
        pipe.set(k("tm", tk_a), f"{mid}|{uid_a}"); pipe.pexpire(k("tm", tk_a), MATCH_REAP_MS)
        pipe.set(k("tm", tk_b), f"{mid}|{uid_b}"); pipe.pexpire(k("tm", tk_b), MATCH_REAP_MS)
        # C4-fencing：建局即认领 owner（与轻量记录同 pipe/事务原子写）。撮合(_pair_once)与直连(_make_match)共用本方法。
        pipe.set(k("owner", mid), self.instance_id); pipe.pexpire(k("owner", mid), MATCH_REAP_MS)

    def _make_match(self, e1: dict, e2: dict, now: int, map_id: str | None = None) -> str:
        # 独立成局入口（room_join / 直连测试用）：进程内运行时 + Redis 轻量记录（各自一次写）。
        # 撮合路径（_try_pair）不走这里——它把 Redis 写并进 WATCH/MULTI 事务后再单独 _store_match_inproc。
        mid = secrets.token_hex(8)
        seed = self._gen_seed(); mp = map_id or self._pick_map(); start = now + START_DELAY_MS
        self._store_match_inproc(mid, seed, mp, start, e1, e2, now)
        if self.r is not None:      # self.r=None（纯进程内运行时测试，如 ws _real_hub）跳过 Redis 写
            pipe = self.r.pipeline(transaction=False)
            self._queue_match_record(pipe, mid, seed, mp, start,
                                     e1["uid"], e2["uid"], e1["ticket"], e2["ticket"])
            pipe.execute()
        return mid

    def _live_waiters(self) -> list[dict]:
        # 读 qall（按 score=enqueued_ms 升序=FIFO），逐 ticket 校验 tk 存活，组装等待者列表。
        # 惰性清理：tk 已过期(PEXPIRE)但 ZSET 成员残留 → 顺手 ZREM（替代旧 _reap 的 queue 扫描）。
        # 私房房主 tk 带 room 标记且从不 ZADD qall，此处 room 跳过为冗余防护（双保险）。
        out: list[dict] = []
        for t in self.r.zrange(k("qall"), 0, -1):
            h = self.r.hgetall(k("tk", t))
            if not h:
                self.r.zrem(k("qall"), t)      # 孤儿 ZSET 成员，惰性清
                continue
            if h.get("room"):
                continue
            out.append({"ticket": t, "rank": int(h["rank"]), "uid": h["uid"],
                        "enqueued_ms": int(h["enqueued_ms"]), "hold_until_ms": int(h["hold_until_ms"])})
        return out

    def _choose_pair(self, live: list[dict], now: int):
        # 纯计算：复现现有两趟算法，返回本轮该成局的 (a, b, watch_key) 或 None。
        # live 已按 enqueued_ms 升序。第一趟同段位 FIFO；第二趟过 hold 窗后跨段位放宽。
        # 关键：两侧必须是不同 uid——同一玩家可能因「匹配中刷新/连点/重试」在队列里留下多张 ticket，
        #       不排除就会把他配给自己（自己打自己）。故各趟选搭档时都跳过同 uid。
        by_rank: dict[int, list[dict]] = {}
        for w in live:
            by_rank.setdefault(w["rank"], []).append(w)
        # 第一轮：同段位内最老者 a，配「首个 uid 不同」的 b；同段位若全是同一 uid 则本段位无对，继续看下段位。
        for rank, lst in by_rank.items():
            if len(lst) >= 2:
                a = lst[0]
                b = next((w for w in lst[1:] if w["uid"] != a["uid"]), None)
                if b is not None:
                    # 返回 k("q",rank) 作 pass-1 的 WATCH 目标：q:{rank} ZSET 仅用于把乐观锁冲突面收窄到本段位
                    # （避免任意入队都撞 WATCH）；等待者成员读取一律走 qall（两者 score 同为 enqueued_ms，分组等价）。
                    return (a, b, k("q", rank))
        # 第二轮：过保持窗口者 a（按 FIFO 逐个试），与 qall 中最老的「uid 不同」者 b 跨段位放宽配对。
        for a in (w for w in live if now >= w["hold_until_ms"]):
            b = next((w for w in live if w["uid"] != a["uid"]), None)  # uid 不同即保证 b≠a
            if b is not None:
                return (a, b, k("qall"))
        return None

    def _pair_once(self, now: int) -> bool:
        # 撮合一局：WATCH/MULTI 乐观事务，跨实例并发不重复配对。返回是否成局（True→外层继续撮下一局）。
        live = self._live_waiters()
        target = self._choose_pair(live, now)
        if target is None:
            return False
        a, b, watch_key = target
        for _ in range(8):          # WatchError 重试上限（到顶本轮放弃，下次 poll/enqueue 再撮）
            pipe = self.r.pipeline()   # transaction=True：watch → 立即读 → multi → 缓冲写 → execute
            try:
                pipe.watch(watch_key, k("tk", a["ticket"]), k("tk", b["ticket"]))
                # WATCH 后立即重校验两 tk 仍在（防 live 是陈旧读、其一已被别处摘走）
                if not (pipe.exists(k("tk", a["ticket"])) and pipe.exists(k("tk", b["ticket"]))):
                    pipe.unwatch()
                    return False    # 一方已被摘走：本轮结束
                mid = secrets.token_hex(8)
                seed = self._gen_seed(); mp = self._pick_map(); start = now + START_DELAY_MS
                pipe.multi()
                # 原子摘除双方（q:{rank} 与 qall）+ 删 tk + 写轻量记录/tm，同一事务 EXEC
                pipe.zrem(k("q", a["rank"]), a["ticket"]); pipe.zrem(k("qall"), a["ticket"]); pipe.delete(k("tk", a["ticket"]))
                pipe.zrem(k("q", b["rank"]), b["ticket"]); pipe.zrem(k("qall"), b["ticket"]); pipe.delete(k("tk", b["ticket"]))
                self._queue_match_record(pipe, mid, seed, mp, start,
                                         a["uid"], b["uid"], a["ticket"], b["ticket"])
                pipe.execute()
            except WatchError:
                continue            # 被并发改动（另一实例撮走/新入队改了 qall）→ 重试
            finally:
                pipe.reset()        # 释放 WATCH，归还连接
            # EXEC 成功：本实例即该局 owner，建进程内运行时（ws_* 读它）
            self._store_match_inproc(mid, seed, mp, start, a, b, now)
            return True
        return False

    def _try_pair(self, now: int) -> None:
        # 反复撮合直到无可成局（复现旧版一轮 _try_pair 尽量排空队列的语义）；每局一个独立事务。
        if self.r is None:          # 无 Redis（纯进程内运行时测试）不参与随机撮合
            return
        while self._pair_once(now):
            pass

    def _drop_ticket(self, ticket: str) -> None:
        # 从 Redis 移除一张等待 ticket：DEL tk + ZREM q:{rank} + ZREM qall。容忍已不存在（幂等）。
        if self.r is None:
            return
        rank = self.r.hget(k("tk", ticket), "rank")   # 先读 rank 定位 q 桶（tk 已亡则 None）
        pipe = self.r.pipeline(transaction=False)
        pipe.delete(k("tk", ticket))
        if rank is not None:
            pipe.zrem(k("q", rank), ticket)
        pipe.zrem(k("qall"), ticket)
        pipe.execute()

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
            elif (not m["a"].get("connected_ever") and not m["b"].get("connected_ever")
                  and now - m["created_ms"] > MATCH_CONNECT_GRACE_MS):
                dead.append(mid)   # 里程碑 B：撮合成局后双方都从未连接 → 退队（防打空气）
            elif now - max(m["a"]["last_tick_ms"], m["b"]["last_tick_ms"]) > IDLE_REAP_MS:
                dead.append(mid)
        for mid in dead:
            self.matches.pop(mid, None)
            self._forget_match_state(mid)              # C2：连带清 Redis mstate（终局残留/废弃局）
            for tk in [t for t, (mm, _u) in list(self.ticket_match.items()) if mm == mid]:
                self.ticket_match.pop(tk, None)
        # 2) 孤儿/超时等待者（Redis）：委托 _sweep（EXISTS 孤儿清 + 逻辑超时清，含 q:{rank} 孤儿）。
        #    C1.6：queue 惰性清从"仅扫 qall"升级为 clock-independent 的 EXISTS 校验 + SCAN q:* 双 ZSET 清。
        self._sweep(now)

    def _sweep(self, now: int) -> None:
        # C1.6：Redis 队列惰性清——clock-independent 的 EXISTS 孤儿清 + 逻辑时钟超时清。
        # 由 _reap 在 REAP_INTERVAL_MS 时间闸门后调用（enqueue/poll 锁内），不引后台线程。
        # 两类清理：
        #   (a) 孤儿成员：backing tk 已 PEXPIRE 过期/被删（EXISTS==0）但 ZSET 成员残留 → ZREM。
        #       qall 与 q:{rank} 都要扫：qall 分支拿不到 rank（tk 已亡）无法定位 q 桶，故 q:{rank}
        #       另走 SCAN 单独清（修复 M3：旧 _drop_ticket 读不到 rank → q:{rank} 孤儿永久残留）。
        #   (b) 逻辑超时：tk 仍在（PEXPIRE 是真实时间，测试推进逻辑时钟不触发它）但入队超
        #       QUEUE_TTL_MS → _drop_ticket（删 tk + 两个 ZSET，此时能从 tk 读到 rank）。
        # rooms 不做逻辑 sweep：房间记录 + 房主 tk 在 room_create 时同设 PEXPIRE(ROOM_TTL_MS)，
        #   真实时间到点一起过期，无需逻辑时钟兜底；加 SCAN room:* 只为测试确定性、收益低于复杂度，故略。
        if self.r is None:
            return
        # (a1) qall：孤儿 → ZREM qall；(b) 超时 → _drop_ticket（清 tk + 双 ZSET）。
        #      score 即 enqueued_ms（zadd 时同值写入），用它判超时省一次 hget。
        for ticket, score in self.r.zrange(k("qall"), 0, -1, withscores=True):
            if not self.r.exists(k("tk", ticket)):
                self.r.zrem(k("qall"), ticket)          # 孤儿：tk 没了，清 qall 成员
            elif now - int(score) > QUEUE_TTL_MS:
                self._drop_ticket(ticket)               # 超时：tk 还在，_drop_ticket 能读 rank 清两 ZSET
        # (a2) q:{rank} 孤儿：SCAN 前缀限定 k("q","*")=xy:pvp:q:*（冒号消歧，不误匹配 qall），
        #      ZREM backing tk 已亡的成员。单独扫是必需的——(a1) 的 qall 孤儿路径拿不到 rank。
        #      SCAN 前缀受 xy:pvp: 约束，绝不触碰共享 Redis 上其它项目的键。
        for qkey in self.r.scan_iter(match=k("q", "*")):
            for ticket in self.r.zrange(qkey, 0, -1):
                if not self.r.exists(k("tk", ticket)):
                    self.r.zrem(qkey, ticket)

    # —— 对外匹配 API ——
    def _require_redis(self) -> None:
        # fail-fast：匹配层（enqueue/poll/撮合）硬依赖 Redis；漏注入时明确报错，而非到 self.r.pipeline/get 才裸 NoneType。
        # 生产 server.py 已注入 make_client(cfg)；ws-only 测试 hub 不调 enqueue/poll，不受影响。
        if self.r is None:
            raise RuntimeError("PvP matchmaking requires a Redis client (VersusHub(redis_client=...))")

    def enqueue(self, uid: str, rank: int) -> dict:
        self._require_redis()
        # 禁赛拦截（MySQL，锁外）
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            self._prune_recent(now)
            self._reap(now)                    # 惰性回收终局/孤儿状态，防无界增长
            # 去重：先移除该 uid 已在随机池里的旧 ticket（匹配中刷新/连点/重试会残留多张）。
            # 否则同 uid 多票会被 _choose_pair 配到一起（自匹配），或陈旧票与真人成局后对方「打空气」。
            # _live_waiters 只含随机池 ticket（私房 host 带 room 标记已跳过），故不误伤私房。
            for w in self._live_waiters():
                if w["uid"] == uid:
                    self._drop_ticket(w["ticket"])
            # recent/自适应窗口仍进程内算（启发式，非正确性关键，多实例各算可接受）
            self.recent.setdefault(rank, []).append((uid, now))
            n = self._recent_distinct(rank, uid, now)
            ticket = secrets.token_hex(8)
            hold_until = now + _adaptive_window_ms(n)
            # 写 Redis：tk hash（+PEXPIRE 兜底）+ 同段位池 q:{rank} + 全池 qall（score=enqueued_ms，FIFO）
            pipe = self.r.pipeline(transaction=False)
            pipe.hset(k("tk", ticket), mapping={
                "uid": uid, "rank": rank, "enqueued_ms": now, "hold_until_ms": hold_until})
            pipe.pexpire(k("tk", ticket), QUEUE_TTL_MS)
            pipe.zadd(k("q", rank), {ticket: now})
            pipe.zadd(k("qall"), {ticket: now})
            pipe.execute()
            self._try_pair(now)
            return {"ticket": ticket}

    def poll(self, ticket: str) -> dict:
        self._require_redis()
        with self.lock:
            now = self._now()
            self._reap(now)                    # 惰性回收（最高频入口之一），先清理再处理本请求
            # 已成局 → 捕获 (mid,uid) 待锁外组 payload；未成局 → 判超时/等待，必要时再撮一次
            tm = self.r.get(k("tm", ticket))
            if tm is None:
                if not self.r.exists(k("tk", ticket)):
                    return {"status": "timeout"}          # 既不在对局也不在队列：超时或已清理
                enq = self.r.hget(k("tk", ticket), "enqueued_ms")
                if enq is None:
                    return {"status": "timeout"}          # exists 与 hget 之间 tk 恰好过期
                if now - int(enq) >= MATCH_TIMEOUT_MS:
                    self._drop_ticket(ticket)
                    return {"status": "timeout"}          # 排队超时 → 摘除
                self._try_pair(now)                       # 仍等待：再尝试一次配对（放宽窗口可能已过）
                tm = self.r.get(k("tm", ticket))
                if tm is None:
                    return {"status": "waiting"}
        # 锁外组 payload：_profile 的 DB 查询不占全局锁，避免热路径串在 DB 延迟上。
        # 期间 match 记录可能被并发回收（仅废弃局）→ _match_start_payload 返回 None，视为 timeout，避免 500。
        mid, uid = tm.split("|", 1)
        payload = self._match_start_payload(mid, uid)
        if payload is None:
            return {"status": "timeout"}
        return {"status": "matched", "matchStart": payload}

    def cancel(self, ticket: str) -> dict:
        self._require_redis()
        with self.lock:
            self._drop_ticket(ticket)
            return {"ok": True}

    # —— 私房（邀请对战）：房主建房间占 ticket 挂起，客人凭码加入直接成局 ——
    def room_create(self, uid: str, rank: int, base_url: str = "") -> dict:
        self._require_redis()
        # 禁赛拦截：与匹配一致，异常玩家当日不得开私房
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            code = self._gen_code()
            # 撞码检查（C1.5：改查 Redis EXISTS room:{code}）：token_hex(3) 空间 16^6≈1670万，
            # 碰撞极罕见但非零；碰撞会静默覆盖既有房间 → 重试换新码，绝不覆盖。
            for _ in range(8):
                if not self.r.exists(k("room", code)):
                    break
                code = self._gen_code()
            ticket = secrets.token_hex(8)
            mp = self._pick_map()
            # 房间记录进 Redis：code -> 房间元信息（含房主 ticket，便于 room_join 定位房主）+PEXPIRE 兜底防泄漏
            self.r.hset(k("room", code), mapping={
                "code": code, "host_uid": uid, "host_rank": rank,
                "map": mp, "created_ms": now, "ticket": ticket})
            self.r.pexpire(k("room", code), ROOM_TTL_MS)
            # 房主也占一张 ticket（写 tk，带 room 标记 → poll 见之仍 waiting；PEXPIRE ROOM_TTL_MS）。
            # **不 ZADD q/qall** —— 私房不进随机池（等价旧 _try_pair 跳过 room 标记）。
            # 注（Task 6 退役）：旧模型曾把房主 loadout 挂在这张 ticket 上透传，WS 快照模型无消费方，已删除。
            self.r.hset(k("tk", ticket), mapping={
                "uid": uid, "rank": rank, "enqueued_ms": now,
                "hold_until_ms": now + MATCH_TIMEOUT_MS, "room": code})
            self.r.pexpire(k("tk", ticket), ROOM_TTL_MS)
            link = f"{base_url}/?versus={code}"
            return {"code": code, "link": link, "ticket": ticket, "map": mp}

    def room_join(self, code: str, uid: str, rank: int) -> dict:
        self._require_redis()
        # 禁赛拦截
        if self.is_banned(uid):
            return {"banned": True, "msg": "检测到异常，今日暂停真人匹配"}
        with self.lock:
            now = self._now()
            room = self.r.hgetall(k("room", code))
            if not room:
                # 无此码：可能输错或已过期/已被占用
                return {"error": "room_not_found"}
            host_ticket = room["ticket"]
            host_tk = self.r.hgetall(k("tk", host_ticket))
            if not host_tk:
                # 房已存在但房主 ticket 已不在（超时/被清理）
                return {"error": "room_expired"}
            # 从房主 tk 组 host_entry（_make_match 只用 uid/rank/ticket；rank 在 Redis 是字符串，还原为 int）。
            host_entry = {"ticket": host_ticket, "uid": host_tk["uid"], "rank": int(host_tk["rank"])}
            # 客人这边只组一次性 entry 参与成局，不入队（避免污染随机池）。
            # 注（Task 6 退役）：旧模型曾携带客人 loadout 透传给客人 side，WS 快照模型无消费方，已删除。
            joiner = {"ticket": secrets.token_hex(8), "uid": uid, "rank": rank}
            # 成局即销毁房间与房主挂起态，保证一码一局、不能重复加入。
            # C1.5：DEL host tk（不再靠 PEXPIRE 兜底放任泄漏）+ DEL room:{code}。房主从不进 q/qall，无需 ZREM。
            self.r.delete(k("tk", host_ticket))
            self.r.delete(k("room", code))
            mid = self._make_match(host_entry, joiner, now, map_id=room["map"])
            # 注意：_match_start_payload 在锁内调用（含 DB 读档）。
            # 私房加入是一次性低频操作，可接受；不改动 Task 3 的 poll 热路径。
            return {"status": "matched", "matchStart": self._match_start_payload(mid, uid)}

    def _match_start_payload(self, mid: str, uid: str) -> Optional[dict]:
        # 组 match-start：matchId/seed/map/startAt/对手档案。C1.4 起从 Redis 轻量记录 match:{mid} 读
        # （seed/map/start_at_ms/uid_a/uid_b 成局后不变，无撕裂读），使任意实例的 poll 都能组包。
        # 记录被回收（reaped/过期）→ 返回 None，poll 据此兜底为 timeout（避免 500）。
        # 注：poll 在锁外调用本方法（_profile 的 DB 读不占锁）；room_join 在锁内调用（低频，可接受）。
        if self.r is not None:
            rec = self.r.hgetall(k("match", mid))
            if not rec:
                return None
            uid_a = rec.get("uid_a"); uid_b = rec.get("uid_b")
            opp_uid = uid_b if uid_a == uid else uid_a
            # seed/start_at_ms 存 Redis 为字符串（decode_responses），还原为 int 保持既有 payload 形（数字）
            return {"matchId": mid, "seed": int(rec["seed"]), "map": rec["map"],
                    "startAtServerMs": int(rec["start_at_ms"]), "opponent": self._profile(opp_uid)}
        # self.r=None（纯进程内运行时测试，如直连 _make_match 的 ws 用例）：退回进程内 matches。
        m = self.matches.get(mid)
        if m is None:
            return None
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
    # 另有一个派生负方 reason「selfTangsengDeadOppGone」不在此表：由 _set_result 在 TangsengDead
    # 且胜方不在场（断线/未连）时改写得到，前端据此免扣段位（见 pvp-settle.ts noPenalty）。
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
        # Task 4（反滥用）：唐僧被吃判负时，若「胜方」此刻并不在场——即已断线未恢复(gone_ms 已置)
        # 或全程从未连接(connected_ever=False，如撮合后跑路)——则本次失败给负方改用 selfTangsengDeadOppGone，
        # 前端据此跳过 recordLose、不扣段位（对手跑路不该偷走我的段位）；胜方 reason 不变(opponentTangsengDead)。
        # 反之（胜方在线，即我方自己刷新/掉线致唐僧死）仍是 selfTangsengDead → 正常扣减，杜绝「刷新逃负」。
        # 时序（spec §6，防御性）：在 m 仍权威（本方法持 self.lock、终局态刚定）时读 m[winner] 的
        # gone_ms/connected_ever。_forget_match_state 当前只清 Redis mstate、不动内存 side 态，故顺序上
        # 并无强依赖；但仍把读取放在它之前，避免日后 _forget_match_state 若扩展为清 side 态时被动踩坑。
        if reason_kind == "TangsengDead" and (m[winner].get("gone_ms") or not m[winner].get("connected_ever")):
            lose_reason = "selfTangsengDeadOppGone"
        m["result"] = {
            winner: {"outcome": "win", "reason": win_reason},
            loser_side_key: {"outcome": "lose", "reason": lose_reason},
        }
        m["ended"] = True
        m["ended_ms"] = now
        self._persist_result(m, now)
        self._forget_match_state(m["match_id"])        # C2：终局同步删 Redis mstate，防 TTL 窗口内被复活

    def _set_no_contest(self, m, now: int) -> None:
        """C5：打空气作废——对手全程从未连接时该局不判胜、不写战绩(不调 _persist_result)。
        仅置终局标志 + no_contest 供 _reap 回收;删 Redis mstate(C2)。幂等。"""
        if m.get("ended"):
            return
        m["ended"] = True
        m["ended_ms"] = now
        m["no_contest"] = True
        self._forget_match_state(m["match_id"])

    def forfeit(self, mid: str, uid: str) -> bool:
        """matched 动画期一方主动退出：作废已成形的对局，避免对手干等一个永不 hello 的玩家。
        按 matchId 找对局（本实例 or 跨实例 _load_match_from_redis 懒认领，与 ws_hello 同）；
        校验 uid 属于该局。分流（幂等，已终局返回 False）：
          - 对手已在对局中(connected_ever) → 判对手胜（我方逃跑），并推 result 给在线对手。
          - 对手也未连接(双方都还在动画屏) → _set_no_contest 作废（不判胜/不写战绩）。
        返回是否执行了作废/判负（供端点回 200/ignored）。时钟用 self._now()（与 enqueue/cancel 一致）。"""
        with self.lock:
            now = self._now()
            m = self.matches.get(mid) or self._load_match_from_redis(mid, now)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return False
            if m.get("ended"):
                return False
            me, opp = self._sides(m, uid)
            me_key = "a" if me is m["a"] else "b"      # 我（放弃方）的 side key
            opp_key = "b" if me_key == "a" else "a"     # 对手 side key
            if opp.get("connected_ever"):
                # 对手在场 → 我方(me)判负(Surrender 语义：matched 后逃跑)，对手胜，推 result 给在线对手
                self._set_result(m, me_key, "Surrender", now)
                if opp.get("ws_send"):
                    self._ws_push_locked(opp, me, m, {"type": "result", **m["result"][opp_key]}, cascade=False)
            else:
                # 双方都未入场 → 作废，不计战绩
                self._set_no_contest(m, now)
            return True

    def _set_draw(self, m, now: int) -> None:
        # 双方 EPS 内阵亡 → 平局（可覆盖先到阵亡者已判的胜负）
        m["result"] = {"a": {"outcome": "draw", "reason": "draw"},
                       "b": {"outcome": "draw", "reason": "draw"}}
        m["ended"] = True; m["ended_ms"] = now
        self._persist_result(m, now)
        self._forget_match_state(m["match_id"])        # C2：同 _set_result

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
            other = m[other_key]
            # 分支1：连过又掉线超时 → 判负(DisconnectTimeout)，推 result 给存活侧。
            # C5：加 connected_ever 守卫——「从未连接」侧即便被 C2 回放置了 gone_ms，也不算掉线，
            # 只能走下面分支2(no-contest)，绝不经此判胜；连过又掉线仍照旧判胜。
            if (side.get("connected_ever") and side.get("gone_ms")
                    and now - side["gone_ms"] > DISCONNECT_GRACE_MS):
                self._set_result(m, key, "DisconnectTimeout", now)
                if other.get("ws_send"):
                    self._ws_push_locked(other, side, m,
                                         {"type": "result", **m["result"][other_key]})
                return
            # 分支2（C5 打空气作废）：对手从未连接（撮合后一方到场、另一方一直没 hello）→ 过撮合宽限
            # 即把该局作废(no-contest)、不判胜不计战绩，推 noShow 给在场方触发自动重匹配。
            # 仅当"恰好一方缺席"命中：双方都没连由 _reap 的 20s 分支静默删除。
            if (not side.get("connected_ever") and other.get("connected_ever")
                    and now - m["created_ms"] > MATCH_CONNECT_GRACE_MS):
                self._set_no_contest(m, now)
                if other.get("ws_send"):
                    self._ws_push_locked(other, side, m, {"type": "noShow"})
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
            if m is None:                              # C2：本实例没有 → 尝试从 Redis 懒认领接管
                m = self._load_match_from_redis(match_id, now)
            if not m or (m["a"]["uid"] != uid and m["b"]["uid"] != uid):
                return {"error": "bad_hello"}
            me, opp = self._sides(m, uid)
            self._ws_check_gone_locked(m, now)      # 顺便惰性检查对手宽限超时
            # 终局守卫（Task 7）：对局已 ended（典型：本侧掉线超宽限被判负、或对局期间已被判终局）
            # 时，重连方不再恢复对战——把终局 result 直接推给重连方（客户端 onResult → 结算画面 →
            # 回首页），杜绝「对局已判我方负、重连却还能继续打」的幽灵续打。
            # 时序：必须在 _ws_check_gone_locked 之后（它可能刚把本侧判负，且 result 只推给了
            # 在线对手——本连接此刻才到、收不到）；ws_send 先登记才能推送（_ws_push_locked
            # 从 side["ws_send"] 取发送器）。恢复字段（gone_ms 清零等）不再执行——已终局的
            # 对局没有「恢复在线」语义；连接关闭时 _mark_gone 照常经陈旧连接保护清理。
            if m.get("ended"):
                my_key = "a" if m["a"] is me else "b"
                my_result = (m.get("result") or {}).get(my_key) or {"outcome": "lose", "reason": "ended"}
                me["ws_send"] = send
                self._ws_push_locked(me, opp, m, {"type": "result", **my_result}, cascade=False)
                return {"serverMs": now, "ended": True}
            me["ws_send"] = send
            me["gone_ms"] = 0                        # 重连清零，恢复在线
            me["connected_ever"] = True              # 标记该侧至少连过一次（撮合退队据此豁免）
            me["last_tick_ms"] = now                 # 刷 liveness，防 IDLE_REAP 中途回收
            me["last_next_wave"] = None              # 清零去重标记，重连后首快照重新宣告 nextWave
            # 反作弊 delta 基线重置（Task 5）：重连（含刷新恢复路径——客户端会本地快进 sim）后，首条快照
            # 相对断线前可能击杀数跳变、唐僧血因重建而变化。若仍与断线前的陈旧 prev_digest 做 delta，会误报
            # kills_over_ceiling / tangsengHP_increased（仅这两项 delta 检查读 prev_digest）。置 None →
            # _anticheat 的 `if prev is not None`(见其正文) 跳过首次 delta 校验、改以本条重连后快照为新基线。
            # 注意只重置 delta 基线 prev_digest，不动 last_digest（那是终局摘要存储，非 delta 基线）；
            # wave_ahead 是无状态校验（比 snapshot wave 与 m["wave_schedule"]，不读 prev_digest）故无需重置。
            me["prev_digest"] = None
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
        """把本实例持有的未终局对局镜像进 Redis mstate:{mid}（懒认领/接管的数据源）。
        C2：取代 B-core 的 MariaDB pvp_active_match。多实例下每实例只 flush 自己 self.matches
        （即它 own 的局），故**不做**跨实例的「DELETE NOT IN」对账（会误删别实例的活跃局）；
        清理靠「终局同步删 mstate（_forget_match_state）」+ 每次写带 PEXPIRE MATCH_REAP_MS 兜底
        （owner 崩溃则状态到点自动过期，与 match:{mid} 轻量记录同寿）。
        并发纪律：_flush_lock 串行化整个 flush（与周期 flush / SIGTERM flush 互斥）。
        **SET/PEXPIRE 与快照同持 self.lock**（不同于 B-core「写在锁外」）——因存在与「终局删 mstate」
        （_set_result/_set_draw→_forget_match_state 在 self.lock 内 DEL）的复活竞态：若快照在锁内取到
        未终局的 X、释放锁后另一线程终局 X 并 DEL mstate:X、flush 再在锁外 SET 回活态 blob，则残留
        ended=False 的僵尸态，TTL 窗口内被别实例 ws_hello 懒加载复活。把 SET/PEXPIRE 移进 self.lock 后，
        「快照+写」与「终局删」在 self.lock 上互斥（终局先→flush 跳过 X 且 DEL 生效；flush 先→随后终局 DEL 掉 X）。
        payload 为小 digest（服务端每局只存小摘要，不含 units/大快照），锁内单次 pipeline 往返成本可忽略，
        与 _sweep 已在锁内做更重 Redis IO 的模式一致。self.r 为 None（纯内存 ws 测试 hub）直接跳过。"""
        if self.r is None:
            return
        with self._flush_lock:
            with self.lock:
                snap = []
                for mid, m in self.matches.items():
                    if m.get("ended"):
                        continue
                    try:
                        tks = {u: t for t, (mm, u) in self.ticket_match.items() if mm == mid}
                        blob = json.dumps({
                            "state": _serialize_match(m),
                            "ticket_a": tks.get(m["a"]["uid"]),
                            "ticket_b": tks.get(m["b"]["uid"]),
                        }, ensure_ascii=False)
                        snap.append((mid, blob))
                    except Exception:
                        logging.exception("pvp mstate 单局快照失败 match_id=%s，跳过", mid)
                # C4-fencing：逐局 WATCH/MULTI，只有仍持 owner:{mid} 的实例能写 mstate，
                # 挡住失去归属的旧 owner 覆盖新 owner 活态（照搬 _pair_once 的事务 idiom）。
                # 逐局 try：单局异常只跳过该局，不中断整轮 flush（对齐快照循环的容错）。
                for mid, blob in snap:
                    try:
                        for _ in range(3):                       # WatchError 重试上限
                            pipe = self.r.pipeline()             # transaction=True
                            try:
                                pipe.watch(k("owner", mid))
                                if pipe.get(k("owner", mid)) != self.instance_id:
                                    pipe.unwatch()
                                    break                        # 已不是我 → 跳过，不覆盖新 owner
                                pipe.multi()
                                pipe.set(k("mstate", mid), blob)
                                pipe.pexpire(k("mstate", mid), MATCH_REAP_MS)
                                pipe.pexpire(k("owner", mid), MATCH_REAP_MS)   # 续期 owner，与 mstate 同寿
                                pipe.execute()
                                break
                            except WatchError:
                                continue                         # owner 在事务窗内被改 → 重试（下轮 GET 会跳过）
                            finally:
                                pipe.reset()
                    except Exception:
                        logging.exception("pvp mstate fenced flush 单局失败 match_id=%s，跳过", mid)

    def _load_match_from_redis(self, mid: str, now: int) -> Optional[dict]:
        """懒认领：本实例 self.matches 无此局时，从 Redis mstate:{mid} 重建整局运行时并接管 owner。
        C2/C3：反代按 matchId 一致性哈希把两端路由到同一实例，owner 崩溃/发版后重连会落到接管实例，
        此处从 Redis 恢复运行时（ws_send=None、gone_ms=now，等重连方在 ws_hello 里挂 send/清零）。
        无记录/解析失败/已终局 → None（ws_hello 据此回 bad_hello）。self.r 为 None 直接 None。"""
        if self.r is None:
            return None
        raw = self.r.get(k("mstate", mid))
        if not raw:
            return None
        try:
            blob = json.loads(raw)
            m = _deserialize_match(blob["state"], now)
        except Exception:
            logging.exception("pvp mstate 解析失败 match_id=%s", mid)
            return None
        if m.get("ended"):
            self.r.delete(k("mstate", mid))
            return None
        self.matches[mid] = m
        ta, tb = blob.get("ticket_a"), blob.get("ticket_b")
        if ta:
            self.ticket_match[ta] = (mid, m["a"]["uid"])
        if tb:
            self.ticket_match[tb] = (mid, m["b"]["uid"])
        # C4-fencing：懒认领即抢占 owner（blind SET，last claim wins）。ws_hello/forfeit 都经此接管。
        self.r.set(k("owner", mid), self.instance_id)
        self.r.pexpire(k("owner", mid), MATCH_REAP_MS)
        return m

    def _forget_match_state(self, mid: str) -> None:
        """终局/回收时删 Redis mstate + owner；避免终局后 TTL 窗口内被重连「复活」。
        C4-fencing：加 owner 守卫——owner:{mid} 属别的实例时不删（失去归属的旧 owner 的
        _reap/forfeit 不得删掉新 owner 的活态）；owner 无主或属我 → 删 mstate + owner。
        简单 GET-then-DEL（非事务）：最坏极小窗内多删一次，真 owner 下轮 flush(≤5s)重写 mstate 自愈。
        幂等；失败仅记日志。self.r 为 None 直接返回。"""
        if self.r is None:
            return
        try:
            owner = self.r.get(k("owner", mid))
            if owner is not None and owner != self.instance_id:
                return
            self.r.delete(k("mstate", mid))
            self.r.delete(k("owner", mid))
        except Exception:
            logging.exception("pvp mstate 删除失败 match_id=%s", mid)


# ---- 里程碑 B：活跃对局序列化（持久化用）----
# ws_send 是运行时闭包（不可 JSON 化），序列化一律剔除；重连时 ws_hello 会重挂。
# wave_schedule / first_clear 是 int 键 dict，JSON 会把键转成 str，反序列化时 int() 回来。

def _serialize_match(m: dict) -> dict:
    """把内存 match dict 转成可 JSON 化的快照（剔除每侧 ws_send）。
    注意：这是 shallow-copy——返回的 out["wave_schedule"]/out["first_clear"]/out["result"]
    与活跃 match 仍是同一对象（未深拷）。flush_active_matches 在锁内完成
    `json.dumps(_serialize_match(m))`（快照与序列化都持锁），故浅拷贝的嵌套别名是安全的；
    任何新调用方也必须在持锁期间 dumps，切勿把浅拷贝 blob 带到锁外再序列化，
    否则可能读到被其它请求并发改动的中间态（撕裂快照，甚至 dict changed size 异常）。"""
    def side(s: dict) -> dict:
        return {k: v for k, v in s.items() if k != "ws_send"}
    out = {k: v for k, v in m.items() if k not in ("a", "b")}
    out["a"] = side(m["a"])
    out["b"] = side(m["b"])
    return out


def _deserialize_match(blob: dict, now: int) -> dict:
    """把 JSON 快照还原成内存 match dict：int() 键、ws_send=None、gone_ms=now（视为断线待重连）、
    created_ms=now（关键：给回放局新鲜的重连窗，否则旧 created_ms 会让它一 _reap 就被“从未连接”清掉）、
    last_tick_ms=now（同理：视为刚活跃，否则长停机后旧 last_tick 会被 _reap 的 IDLE 分支立即清掉）。
    connected_ever 恢复持久化值（不覆盖）：曾连过的恢复局豁免 20s「从未连接」退队，改由 15s 断线宽限 /
    300s IDLE 治理其重连窗；真·从未连接的撮合僵尸局仍为 False → 仍 20s 回收。"""
    m = dict(blob)
    m["wave_schedule"] = {int(k): v for k, v in (blob.get("wave_schedule") or {}).items()}
    m["first_clear"] = {int(k): v for k, v in (blob.get("first_clear") or {}).items()}
    m["created_ms"] = now
    for key in ("a", "b"):
        s = dict(blob[key])
        s["ws_send"] = None
        s["gone_ms"] = now
        s["last_tick_ms"] = now   # 回放视为刚活跃，避免长停机后旧 last_tick 让回放局被 IDLE_REAP 立即清掉
        s["connected_ever"] = bool(blob[key].get("connected_ever", False))  # 恢复持久化值：曾连接过的恢复局豁免20s退队，走15s宽限/300s IDLE；真·从未连接的撮合僵尸局(False)仍20s回收
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


def handle_versus_forfeit(handler, db: DB) -> None:
    # matched 动画期主动退出：作废已成形的对局（cancel 只清队列 ticket、对已建对局无效）。
    # 收 matchId（客户端 pvpPendingMatch.matchId），服务端按 uid 校验后作废/判对手胜。
    body = _read_body(handler)
    if body is None: return
    uid = require_auth(handler, db, body)
    if not uid: return
    ok = _hub(handler).forfeit(str(body.get("matchId") or ""), uid)
    send_json(handler, 200, {"ok": ok})

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
                    if res.get("ended"):
                        # Task 7 终局重连：result 已在 ws_hello 内推送给本连接；不置 hello_ok、
                        # 不发 welcome——后续业务消息（snap/waveCleared/status）全部被下方
                        # 「hello 前忽略一切」挡住，杜绝判负后的幽灵续打；连接保持至客户端结算后自关。
                        return
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
