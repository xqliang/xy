from __future__ import annotations
# PvP 在线对战：进程内匹配/房间/对局状态机 + 转发 + 反作弊。
# 单进程 ThreadingHTTPServer 下用一把大锁保护；重启即丢活跃对局（临时对局可接受）。
import json
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
