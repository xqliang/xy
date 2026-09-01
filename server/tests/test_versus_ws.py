# -*- coding: utf-8 -*-
"""Task 2：`/api/versus/ws` 端点真 socket 集成测试（server/api_versus.py + server.py）。

与 test_ws.py（纯函数）不同，这里起**真 ThreadingHTTPServer** 于临时端口，用真 socket
完成 HTTP 升级 → 101 握手 → 收发 WS 帧，跑完整链路：hello→welcome、snap 转发、waveCleared
首清排程、status 终局、断线宽限/重连恢复、digest 派生、畸形 JSON 容错。

设计取舍（对应 plan Task 2 Step1 逐条）：
- 复用 _FakeDB + 可控时钟 `_fake_hub`（与 test_versus.py 同款），对局进程内、无 3308 依赖。
- 客户端侧手搓带掩码的帧编码器 `client_encode`（镜像 test_ws.py 的 encode 加 mask）——
  decode 侧用服务端同一 `decode_frame`，保证编/解两侧严格对称。
- 每条 WS 连接一个 WsClient 实例，自带缓冲 + recv(timeout)：反复 decode 直到凑齐一整帧，
  顺带应答服务端 ping（保活），close 帧回 close 并返回 None。
- 服务端用真实 `server.Handler`（含新增的 /api/versus/ws 分流），验证路由→handle_versus_ws
  →VersusHub 全链路；daemon_threads=True 保证测试结束线程退出。
"""
from __future__ import annotations

import base64
import contextlib
import json
import os
import secrets
import socket
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

import fakeredis
import pytest

ROOT = Path(__file__).resolve().parents[1]

# server/ 目录加入 path（供 `import server` / `import api_versus` / `import ws`）
import sys
sys.path.insert(0, str(ROOT))

from ws import (  # noqa: E402
    OP_TEXT, OP_PING, OP_CLOSE,
    ws_accept_key, decode_frame, encode_frame,
)
from api_versus import (  # noqa: E402
    DISCONNECT_GRACE_MS, INTER_WAVE_DELAY_MS, SIMULTANEOUS_EPS_MS, VersusHub,
)


# ---------------------------------------------------------------- 真实 DB 支撑反作弊落库 ----
# WS 快照模型下的反作弊接线（Task 6）：_anticheat 现由 ws_snap 调用，命中会写 pvp_anomaly。
# 载 socket 全链路用 _FakeDB（no-op），但反作弊断言需真实落库，故补一个 module 级真实 db fixture。
DSN_ENV = {
    "XY_DB_HOST": os.environ.get("XY_DB_HOST", "127.0.0.1"),
    "XY_DB_PORT": os.environ.get("XY_DB_PORT", "3307"),
    "XY_DB_USER": os.environ.get("XY_DB_USER", "root"),
    "XY_DB_PASSWORD": os.environ.get("XY_DB_PASSWORD", ""),
    "XY_DB_NAME": os.environ.get("XY_DB_NAME", "xy_game_test"),
    "XY_AGG_INTERVAL": "3600",
}

def _apply_env():
    for k, v in DSN_ENV.items():
        os.environ[k] = v


@pytest.fixture(scope="module")
def db():
    _apply_env()
    from config import load_config
    from db import DB
    d = DB(load_config()); d.migrate()
    return d


def _real_hub(db):
    # 真实 DB + 可控时钟的 VersusHub：反作弊命中需落库，不能用 _FakeDB。
    clock = {"ms": 1_000_000}
    seeds = iter(range(9000, 9999))
    h = VersusHub(db, now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds), gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan")
    h._clock = clock
    return h


# ---------------------------------------------------------------- 客户端帧编码 ----
def client_encode(opcode: int, payload: bytes, mask_key: bytes = b"\x01\x02\x03\x04") -> bytes:
    """手搓「客户端帧」编码器：与 ws.encode_frame 分支一致，但 FIN=1 且**必带 mask**（RFC 要求）。

    客户端→服务端帧必须掩码；服务端 decode_frame 按掩码帧解析。这里镜像三档长度分支，
    供测试构造喂给真 socket 的字节。mask_key 固定（测试可复现），不影响正确性。"""
    b1 = 0x80 | opcode
    n = len(payload)
    if n < 126:
        head = bytes([b1, 0x80 | n])
    elif n < 65536:
        head = bytes([b1, 0x80 | 126]) + n.to_bytes(2, "big")
    else:
        head = bytes([b1, 0x80 | 127]) + n.to_bytes(8, "big")
    masked = bytes(payload[i] ^ mask_key[i % 4] for i in range(n))
    return head + mask_key + masked


# ---------------------------------------------------------------- FakeDB / hub ----
class _FakeDB:
    """内存 DB 桩：WS 全链路不触库（仅 _persist_result 经 cursor 写，no-op 即可）。"""
    def today(self): return "2026-01-01"
    def now(self): return 1_000_000

    @contextlib.contextmanager
    def cursor(self):
        class _Cur:
            def execute(self, *a, **k): pass
            def fetchone(self): return {"c": 0}
            def fetchall(self): return []
        yield _Cur()


def _fake_hub():
    # 可控时钟（hub._clock["ms"]）+ 固定 seed/code/map；无真实 DB。
    clock = {"ms": 1_000_000}
    seeds = iter(range(1000, 9999))
    h = VersusHub(_FakeDB(), now_ms=lambda: clock["ms"],
                  gen_seed=lambda: next(seeds), gen_code=lambda: "ROOM01",
                  pick_map=lambda: "huoyanshan",
                  redis_client=fakeredis.FakeStrictRedis(decode_responses=True))
    h._clock = clock
    return h


def _fake_match(hub, ua="A1", ub="B1", rank=3):
    # 直接成局（跳过 enqueue/poll 的 DB 读档），返回 match_id。
    e1 = {"uid": ua, "rank": rank, "ticket": "tA"}
    e2 = {"uid": ub, "rank": rank, "ticket": "tB"}
    return hub._make_match(e1, e2, hub._now())


# ---------------------------------------------------------------- 真 HTTP 服务器 ----
@contextlib.contextmanager
def _ws_server(hub):
    """起真 ThreadingHTTPServer（用真实 server.Handler + 给定 hub），返回端口。

    daemon_threads=True：测试结束即使有线程未退也不阻塞进程退出。"""
    from server import Handler
    static_dir = str(ROOT)

    class H(Handler):
        pass

    H.db = _FakeDB()
    # Task 8：WS 握手鉴权 fail-closed 读 cfg["auth"]["strict"]（缺 auth 段即按 strict 处理）。
    # 生产 load_config() 恒带 auth 段（默认 strict=False），此处补上以对齐生产配置——
    # 是让夹具贴近现实，而非放松门禁；否则本文件 ?uid= 连接会被 401。
    H.cfg = {"static_dir": static_dir, "auth": {"strict": False}}
    H.versus = hub
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        lambda *a, **k: H(*a, directory=static_dir, **k),
    )
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    th = threading.Thread(target=httpd.serve_forever, daemon=True)
    th.start()
    try:
        yield port
    finally:
        httpd.shutdown()
        httpd.server_close()


# ---------------------------------------------------------------- WS 客户端 ----
class WsClient:
    """最小 WS 客户端：完成 HTTP 升级握手，之后收发带掩码的文本帧。

    - 自带缓冲：recv 反复 decode_frame 直到凑齐一整帧；中途应答服务端 ping，
      close 帧回 close 并返回 None（连接已断）。
    - send(obj)：JSON 序列化 + 掩码编码 + sendall。
    """

    def __init__(self, port, match_id, uid):
        self.port = port
        self.match_id = str(match_id)
        self.uid = str(uid)
        self.buf = b""
        self.key = base64.b64encode(secrets.token_bytes(16)).decode()
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        self._handshake()

    def _handshake(self):
        # 发 HTTP 升级请求；读到 \r\n\r\n 即拿到 101 响应头，剩余字节（若有）入缓冲。
        req = (
            f"GET /api/versus/ws?matchId={self.match_id}&uid={self.uid} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {self.key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"\r\n"
        ).encode()
        self.sock.sendall(req)
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("握手阶段连接被对端关闭")
            data += chunk
        head, _, rest = data.partition(b"\r\n\r\n")
        self.resp_status = head.split(b"\r\n", 1)[0]
        # 头字段转小写字典，便于断言 Sec-WebSocket-Accept。
        self.resp_headers = {}
        for line in head.split(b"\r\n")[1:]:
            if b":" in line:
                k, _, v = line.partition(b":")
                self.resp_headers[k.strip().lower().decode()] = v.strip().decode()
        self.buf = rest

    def send(self, obj):
        # JSON 紧凑序列化 + 客户端掩码帧 → 裸字节。
        frame = client_encode(OP_TEXT, json.dumps(obj, separators=(",", ":")).encode())
        self.sock.sendall(frame)

    def send_raw(self, raw: bytes):
        # 直接写裸字节（用于发畸形文本帧等非标准输入）。
        self.sock.sendall(raw)

    def recv(self, timeout=5.0):
        """阻塞取下一条文本消息 dict；超时/连接断开返回 None。顺带应答 ping。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            # 先尝试从缓冲解帧
            while self.buf:
                fr = decode_frame(self.buf)
                if fr["consumed"] == 0:
                    break  # 半截帧：留着等更多字节
                self.buf = self.buf[fr["consumed"]:]
                op = fr["opcode"]
                if op == OP_TEXT:
                    return json.loads(fr["payload"].decode("utf-8"))
                if op == OP_PING:
                    # 服务端保活 ping → 回 pong（同 payload）
                    self.sock.sendall(encode_frame(0xA, fr["payload"]))
                    continue
                if op == OP_CLOSE:
                    # 对端关闭：回一个 close 帧，标记连接断
                    with contextlib.suppress(Exception):
                        self.sock.sendall(encode_frame(OP_CLOSE, b""))
                    return None
                # OP_PONG / OP_BINARY 等：忽略，继续解下一帧
            # 缓冲不够一整帧 → 读更多字节
            remaining = max(0.05, deadline - time.time())
            self.sock.settimeout(remaining)
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                continue
            except OSError:
                return None
            if not chunk:
                return None  # EOF
            self.buf += chunk
        return None

    def close(self):
        with contextlib.suppress(Exception):
            self.sock.close()


def _snap(wave=1, hp=3, kills=0, units=None):
    # 构造一个最小合法快照（服务器只派生 wave/tangsengHP/kills/units 四个小字段）。
    return {"wave": wave, "tangsengHP": hp, "kills": kills,
            "units": units if units is not None else [{"cell": {"c": 0, "r": 0}, "type": 1}]}


def _hello(c):
    c.send({"type": "hello", "matchId": c.match_id, "uid": c.uid})


# ============================================================================
#  用例（对齐 plan Task 2 Step1 逐条）
# ============================================================================
def test_handshake_101_and_accept():
    # 1. 握手：GET 带 Upgrade 头 → 101 + Sec-WebSocket-Accept 正确（= ws_accept_key(key)）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        c = WsClient(port, mid, "A1")
        assert c.resp_status == b"HTTP/1.1 101 Switching Protocols"
        assert c.resp_headers.get("upgrade", "").lower() == "websocket"
        assert c.resp_headers.get("sec-websocket-accept") == ws_accept_key(c.key)
        c.close()


def test_hello_returns_welcome():
    # 2. hello → welcome(serverMs)。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        _hello(a)
        w = a.recv()
        assert w is not None and w["type"] == "welcome"
        assert isinstance(w["serverMs"], int)
        a.close()


def test_ping_returns_pong_echo():
    # 2b. 应用层心跳：hello 后发 {"type":"ping","t":123} → 服务端连接层原样回 {"type":"pong","t":123}。
    #     回响不碰 hub 锁、不改对局态，仅供客户端算 RTT（顶部延迟 HUD）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        _hello(a)
        assert a.recv()["type"] == "welcome"
        a.send({"type": "ping", "t": 123})
        p = a.recv()
        assert p is not None and p["type"] == "pong"
        assert p["t"] == 123              # 原样回响客户端时间戳
        # 无 t 的 ping 也应回 pong（t=None），不杀连接。
        a.send({"type": "ping"})
        p2 = a.recv()
        assert p2 is not None and p2["type"] == "pong"
        assert p2["t"] is None
        a.close()


def test_snap_relayed_verbatim_both_directions():
    # 3. A 发 snap → B 收 oppSnap 原文一致；B 发 snap → A 收。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        sa = _snap(wave=1, units=[{"cell": {"c": 1, "r": 2}, "type": 7}])
        a.send({"type": "snap", "t": 111, "s": sa})
        ob = b.recv()
        assert ob["type"] == "oppSnap"
        assert ob["s"] == sa          # 原样转发，服务端不解析大字段

        sb = _snap(wave=1, hp=2, kills=3, units=[{"cell": {"c": 3, "r": 4}, "type": 9}])
        b.send({"type": "snap", "t": 222, "s": sb})
        oa = a.recv()
        assert oa["type"] == "oppSnap"
        assert oa["s"] == sb
        a.close(); b.close()


def test_wave_cleared_pushes_nextwave_to_both():
    # 4. A 发 waveCleared{wave:1} → 双方收 nextWave{wave:2, startAtServerMs}（首清排程）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.send({"type": "waveCleared", "wave": 1})
        na = a.recv()
        nb = b.recv()
        assert na["type"] == "nextWave"
        assert nb["type"] == "nextWave"
        # 两侧 nextWave 同纪元（首清者排程，双方共享）
        assert na["wave"] == 2 and nb["wave"] == 2
        assert na["startAtServerMs"] == nb["startAtServerMs"]
        expected = hub._now() + INTER_WAVE_DELAY_MS
        assert na["startAtServerMs"] == expected
        # 服务端排程状态确实落地
        with hub.lock:
            assert hub.matches[mid]["wave_schedule"][2] == expected
            assert hub.matches[mid]["first_clear"][1] == "A1"
        a.close(); b.close()


def test_status_surrender_pushes_result_per_side():
    # 5. A 发 status surrender → 双方收 result，outcome/reason 按 _result_for REASON 表正确。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.send({"type": "status", "v": "surrender"})
        ra = a.recv()
        rb = b.recv()
        assert ra["type"] == "result" and rb["type"] == "result"
        # A 认输：A 败(selfSurrender)、B 胜(opponentSurrender)
        assert ra["outcome"] == "lose" and ra["reason"] == "selfSurrender"
        assert rb["outcome"] == "win" and rb["reason"] == "opponentSurrender"
        a.close(); b.close()


def test_status_tangseng_dead():
    # 唐僧死：A 发 tangsengDead → B 胜(opponentTangsengDead)、A 败(selfTangsengDead)。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.send({"type": "status", "v": "tangsengDead"})
        ra = a.recv(); rb = b.recv()
        assert ra["outcome"] == "lose" and ra["reason"] == "selfTangsengDead"
        assert rb["outcome"] == "win" and rb["reason"] == "opponentTangsengDead"
        a.close(); b.close()


def test_disconnect_gives_oppgone_then_timeout_result():
    # 6a. A 裸断（不发 close 帧）→ B 收 oppGone；时钟越过宽限 + B 触发 → B 收 result(断线超时)。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        # A 裸断：直接关 socket（不协商 close 帧），模拟崩溃/切后台。
        a.close()
        gone = b.recv()
        assert gone is not None and gone["type"] == "oppGone"

        # 越过宽限
        hub._clock["ms"] += DISCONNECT_GRACE_MS + 500
        # B 发 snap 触发惰性宽限超时判定 → B 收 result（A 断线超时判负，B 胜）
        b.send({"type": "snap", "t": 1, "s": _snap()})
        res = b.recv()
        assert res is not None and res["type"] == "result"
        assert res["outcome"] == "win"
        assert res["reason"] == "opponentDisconnectTimeout"
        # 服务端对局已终局
        with hub.lock:
            assert hub.matches[mid]["ended"] is True
        b.close()


def test_reconnect_within_grace_recovers():
    # 6b. 宽限内 A 重连（新 socket + hello）→ 恢复：A 再 snap → B 收 oppSnap，无 result。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.close()                       # A 断开
        assert b.recv()["type"] == "oppGone"

        hub._clock["ms"] += 500         # 仍在 DISCONNECT_GRACE_MS 宽限内
        a2 = WsClient(port, mid, "A1")  # 重连
        _hello(a2)
        assert a2.recv()["type"] == "welcome"

        # A 再 snap → B 应收到 oppSnap（恢复转发），且绝不能收到 result
        a2.send({"type": "snap", "t": 5, "s": _snap()})
        got = b.recv()
        assert got["type"] == "oppSnap"
        # 反向也通：B snap → A2 收
        b.send({"type": "snap", "t": 6, "s": _snap(hp=2)})
        got2 = a2.recv()
        assert got2["type"] == "oppSnap"
        with hub.lock:
            assert hub.matches[mid]["ended"] is False  # 未终局
        a2.close(); b.close()


def test_reconnect_after_timeout_gets_result_not_recovery():
    # 6c.（Task 7 终局守卫）断线超时判负后重连：hello 不再恢复对战，直接收 result(lose)——
    # 修「B 重连进去还能继续对战」：判负方应被结算弹窗送回首页，且后续业务消息全部被忽略。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.close()                                     # A 断开（裸断）
        assert b.recv()["type"] == "oppGone"

        hub._clock["ms"] += DISCONNECT_GRACE_MS + 500  # 越过宽限
        b.send({"type": "snap", "t": 1, "s": _snap()})  # B 触发惰性判定 → A 断线超时判负
        res = b.recv()
        assert res["type"] == "result" and res["outcome"] == "win"
        assert res["reason"] == "opponentDisconnectTimeout"

        # A 超时判负后重连：首条推送应是终局 result（lose），而不是 welcome 恢复
        a2 = WsClient(port, mid, "A1")
        _hello(a2)
        got = a2.recv()
        assert got is not None and got["type"] == "result"
        assert got["outcome"] == "lose"
        assert got["reason"] == "selfDisconnect"

        # 判负重连方发业务消息应被整体忽略（未置 hello_ok）：B 侧绝不能再收到 A2 的 oppSnap，
        # 服务端对局保持终局态；且 A 侧 gone_ms 未被清零（终局守卫不走「恢复在线」路径）。
        a2.send({"type": "snap", "t": 2, "s": _snap()})
        with hub.lock:
            assert hub.matches[mid]["ended"] is True
            assert hub.matches[mid]["a"]["gone_ms"] > 0   # 未清零=未恢复
        a2.close(); b.close()


def test_stale_close_does_not_clobber_reconnect():
    # 陈旧连接清理不得顶掉重连后的新连接（send 身份比对）：
    # A 断 → 重连 A2 → 旧 A 线程迟到的 ws_gone 必须被忽略，A2 仍可用。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.close()                       # A 断（旧线程稍后才会跑到 ws_gone）
        assert b.recv()["type"] == "oppGone"
        a2 = WsClient(port, mid, "A1")  # 立即重连（赶在旧线程清理前）
        _hello(a2)
        assert a2.recv()["type"] == "welcome"
        # 给旧线程一点时间跑它的 ws_gone（若实现无 stale 保护，这里会把 a2 的 ws_send 清掉）
        time.sleep(0.2)

        # A2 仍能 snap 且 B 能收到（证明新连接未被陈旧清理顶掉）
        a2.send({"type": "snap", "t": 9, "s": _snap()})
        got = b.recv()
        assert got["type"] == "oppSnap"
        a2.close(); b.close()


def test_server_derives_digest_from_snap():
    # 7. 服务器从 snap 派生 digest 存 side["last_digest"]（供 _anticheat；B 收到即说明已落地）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        snap = _snap(wave=2, hp=4, kills=7, units=[{"c": 1}, {"c": 2}, {"c": 3}])
        a.send({"type": "snap", "t": 1, "s": snap})
        # B 收到 oppSnap 说明 A 的 snap 已被服务端处理（digest 已派生存储）
        assert b.recv()["type"] == "oppSnap"

        with hub.lock:
            d = hub.matches[mid]["a"]["last_digest"]
        assert d == {"wave": 2, "tangsengHP": 4, "kills": 7, "units": 3}
        a.close(); b.close()


def test_malformed_json_ignored_connection_stays_alive():
    # 畸形 JSON → 忽略，连接保持：hello 前发垃圾无妨，之后 hello 仍成功。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        # hello 之前先发一段畸形文本帧
        a.send_raw(client_encode(OP_TEXT, b"this is not json{"))
        _hello(a)
        assert a.recv()["type"] == "welcome"   # 连接未被畸形 JSON 打死
        a.close()


def test_malformed_json_mid_session_ignored():
    # hello 之后发畸形 snap → 忽略，随后合法 snap 仍被转发（连接存活）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.send_raw(client_encode(OP_TEXT, b"{bad json"))
        # 合法 snap 仍应送达 B
        a.send({"type": "snap", "t": 1, "s": _snap()})
        assert b.recv()["type"] == "oppSnap"
        a.close(); b.close()


def test_messages_before_hello_ignored():
    # hello 之前的所有消息被忽略：A 先发 snap（未 hello）→ 服务端不转发、不报错，
    # 随后 hello 成功。B 这边不会因为 A 的「未认证 snap」收到任何 oppSnap。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(b)
        assert b.recv()["type"] == "welcome"
        # A 未 hello 就先发 snap
        a.send({"type": "snap", "t": 1, "s": _snap()})
        _hello(a)
        assert a.recv()["type"] == "welcome"
        # B 此时不应收到 A 那个「未认证」的 snap（给一点时间确认没有消息到达）
        assert b.recv(timeout=0.5) is None
        a.close(); b.close()


def test_bad_upgrade_returns_400():
    # 不带 Upgrade 头的普通 GET → 400（不升级），不是 101。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        s = socket.create_connection(("127.0.0.1", port), timeout=5)
        s.sendall(f"GET /api/versus/ws?matchId={mid}&uid=A1 HTTP/1.1\r\n"
                  f"Host: 127.0.0.1:{port}\r\n\r\n".encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk
        assert b"400" in data.split(b"\r\n", 1)[0]
        s.close()


# ============================================================================
#  Task 6：反作弊接线迁至 ws_snap（退役 HTTP tick 后，_anticheat 原只在 tick 内调用会失活，
#  现改在 ws_snap 派生 digest 后调用）。以下用例用真实 db + 可控时钟直驱 ws_snap，
#  证明异常路径（击杀暴涨/唐僧血上涨/波次超前）与三对手禁赛在 WS 快照模型下仍能落库/触发。
#  注：WS digest 不含 power（快照无该字段、客户端亦不再自报 digest），击杀上界 ceil 退化为
#  KILLS_ABS_FLOOR=30 的扁平上界（不再随战力缩放），但仍远超正常增量，能稳定触发。
# ============================================================================
def test_anticheat_kills_over_ceiling_via_ws_snap(db):
    # 击杀暴涨远超上界：基线 kills=0，下一快照 kills=9999 → kills_over_ceiling 落库。
    hub = _real_hub(db)
    mid = _fake_match(hub, "90000401", "90000402")
    day = db.today()
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000401"))
    base = {"wave": 1, "tangsengHP": 3, "kills": 0, "units": [{"cell": {"c": 0, "r": 0}, "type": 1}]}
    hub.ws_snap("90000401", mid, {"type": "snap", "t": 1, "s": base})                  # 建基线
    hub._clock["ms"] += 1000                                                             # 推进时钟
    hub.ws_snap("90000401", mid, {"type": "snap", "t": 2, "s": {**base, "kills": 9999}})
    with db.cursor() as cur:
        cur.execute("SELECT reasons_json FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000401"))
        row = cur.fetchone()
    assert row is not None and "kills_over_ceiling" in row["reasons_json"]


def test_anticheat_tangseng_hp_increase_via_ws_snap(db):
    # 唐僧血单调不增：基线 HP=3，下一快照涨到 5 → tangsengHP_increased 落库。
    hub = _real_hub(db)
    mid = _fake_match(hub, "90000421", "90000422")
    day = db.today()
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000421"))
    base = {"wave": 1, "tangsengHP": 3, "kills": 0, "units": [{"cell": {"c": 0, "r": 0}, "type": 1}]}
    hub.ws_snap("90000421", mid, {"type": "snap", "t": 1, "s": base})
    hub._clock["ms"] += 1000
    hub.ws_snap("90000421", mid, {"type": "snap", "t": 2, "s": {**base, "tangsengHP": 5}})
    with db.cursor() as cur:
        cur.execute("SELECT reasons_json FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000421"))
        row = cur.fetchone()
    assert row is not None and "tangsengHP_increased" in row["reasons_json"]


def test_anticheat_wave_ahead_via_ws_snap(db):
    # 波次超前：wave_schedule 初始只有 {1}，上报 wave=5 远超 max+1=2 → wave_ahead（首快照即触发，无需基线）。
    hub = _real_hub(db)
    mid = _fake_match(hub, "90000431", "90000432")
    day = db.today()
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000431"))
    hub.ws_snap("90000431", mid, {"type": "snap", "t": 1,
                                   "s": {"wave": 5, "tangsengHP": 3, "kills": 0,
                                         "units": [{"cell": {"c": 0, "r": 0}, "type": 1}]}})
    with db.cursor() as cur:
        cur.execute("SELECT reasons_json FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000431"))
        row = cur.fetchone()
    assert row is not None and "wave_ahead" in row["reasons_json"]


def test_anticheat_three_opponents_trigger_ban_via_ws_snap(db):
    # 三个不同对手当日判异常 → 禁赛（is_banned）。前两个对手直接插 anomaly 行，第三个经 ws_snap 触发。
    day = db.today(); now = db.now()
    with db.cursor() as cur:
        cur.execute("DELETE FROM pvp_anomaly WHERE day=%s AND uid=%s", (day, "90000411"))
        for opp in ("30000001", "30000002"):
            cur.execute("INSERT INTO pvp_anomaly (day,uid,opponent_uid,match_id,reasons_json,created_at)"
                        " VALUES (%s,%s,%s,%s,%s,%s)", (day, "90000411", opp, "m", "{}", now))
    assert _real_hub(db).is_banned("90000411") is False   # 只有 2 个不同对手
    hub = _real_hub(db)
    mid = _fake_match(hub, "90000411", "90000412")
    base = {"wave": 1, "tangsengHP": 3, "kills": 0, "units": [{"cell": {"c": 0, "r": 0}, "type": 1}]}
    hub.ws_snap("90000411", mid, {"type": "snap", "t": 1, "s": base})                  # 建基线
    hub._clock["ms"] += 1000
    hub.ws_snap("90000411", mid, {"type": "snap", "t": 2, "s": {**base, "kills": 19999}})
    assert hub.is_banned("90000411") is True


def test_anticheat_db_failure_does_not_500_via_ws_snap(db):
    # DB 抖动：_record_anomaly 落库失败时，ws_snap 不得抛错（反作弊降级，快照转发照常）。
    hub = _real_hub(db)
    mid = _fake_match(hub, "90000441", "90000442")
    base = {"wave": 1, "tangsengHP": 3, "kills": 0, "units": [{"cell": {"c": 0, "r": 0}, "type": 1}]}
    hub.ws_snap("90000441", mid, {"type": "snap", "t": 1, "s": base})   # 建基线
    orig = hub.db.cursor
    def boom(*a, **k):
        raise RuntimeError("db down")
    hub.db.cursor = boom
    try:
        hub.ws_snap("90000441", mid, {"type": "snap", "t": 2, "s": {**base, "kills": 99999}})  # 不得 500
    finally:
        hub.db.cursor = orig        # 务必恢复，db fixture 是 module 级共享


# ============================================================================
#  Task 6：终局平局逻辑（原仅 tick 覆盖）迁至 ws_status，避免退役 tick 后丢失 EPS 改判覆盖。
#  _set_draw 会覆盖先到者的胜负：第二个在 EPS 内阵亡者把结果改成平局。
#  用 _fake_hub（no-op DB）：_persist_result 走空 cursor 不报错，直接读内存 result 断言。
# ============================================================================
def test_simultaneous_death_draw():
    # 双方 EPS 内先后报 tangsengDead → 平局（第二个的 _set_draw 覆盖先到者的胜负）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    hub.ws_status("A1", mid, "tangsengDead")
    hub._clock["ms"] += 100                      # SIMULTANEOUS_EPS_MS(200) 内
    hub.ws_status("B1", mid, "tangsengDead")
    with hub.lock:
        res = hub.matches[mid]["result"]
    assert res["a"]["outcome"] == "draw" and res["b"]["outcome"] == "draw"


def test_non_simultaneous_death_stays_win_lose():
    # A 先死(B 判赢)，B 在 EPS 之外才死 → 不改判平局，仍是 B 赢。
    hub = _fake_hub()
    mid = _fake_match(hub)
    hub.ws_status("A1", mid, "tangsengDead")
    hub._clock["ms"] += SIMULTANEOUS_EPS_MS + 50  # 拉到 EPS 之外
    hub.ws_status("B1", mid, "tangsengDead")
    with hub.lock:
        res = hub.matches[mid]["result"]
    assert res["a"]["outcome"] == "lose"
    assert res["b"]["outcome"] == "win"


# ============================================================================
#  波次排程宣告（修「连接正常但永不出怪」）：ws_snap 必须按本侧 wave 推送 nextWave。
#  HTTP tick 时代「每响应都带 nextWave」使开局首波（客户端 wave=0 → 服务器算出 wave 1 排程）
#  得以触达客户端；WS 模型若漏掉，客户端 pvpWaveStartTicks 永远为空 → 永不开波 → 不出怪。
#  首波宣告/去重/清波双路径防重由 test_snap_announces_wave1_and_dedups_nextwave（socket 级）覆盖；
#  这里补 hub 直调的「hello 重置去重标记（重连重新宣告）」。
# ============================================================================
def _sent(sends: list) -> list:
    """把 ws_send 闭包捕获的推送解析成 (type, wave) 列表，便于断言。"""
    return [(json.loads(t).get("type"), json.loads(t).get("wave")) for t in sends]


def test_hello_resets_next_wave_marker_for_reannounce():
    # hello 清零 last_next_wave：重连后首快照重新宣告当前 nextWave（客户端波次态跨重连保留，
    # 但重新宣告是廉价且安全的再同步——快照模型无历史回放，重新宣告保证客户端时钟/排程一致）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    sends_a: list = []
    hub.ws_hello("A1", mid, lambda t: (sends_a.append(t), True)[1])
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    hub.ws_snap("A1", mid, {"type": "snap", "t": 1, "s": base})
    hub.ws_hello("A1", mid, lambda t: (sends_a.append(t), True)[1])   # 模拟重连（新连接覆盖 ws_send）
    hub.ws_snap("A1", mid, {"type": "snap", "t": 2, "s": base})
    nxt = [x for x in _sent(sends_a) if x[0] == "nextWave"]
    assert nxt == [("nextWave", 1), ("nextWave", 1)]  # 重连后重新宣告一次


def test_hello_resets_anticheat_delta_baseline():
    # Task 5：ws_hello 重置反作弊 delta 基线（me["prev_digest"]=None）。
    # 重连（含刷新恢复的本地快进）后首条快照相对断线前可能已推进多波/击杀跳变，若仍与陈旧 prev_digest
    # 做 delta 会误报 wave_ahead / kills_over_ceiling。置 None → _anticheat 首快照跳过 delta 校验、
    # 以自身为新基线（见 api_versus._anticheat 的 `if prev is not None`）。本用例不依赖 DB。
    hub = _fake_hub()
    mid = _fake_match(hub)
    me, _opp = hub._sides(hub.matches[mid], "A1")
    hub.ws_hello("A1", mid, lambda t: True)
    # 首快照建立 delta 基线：prev 为 None 故跳过 delta 校验、不落库，仅写 prev_digest。
    hub.ws_snap("A1", mid, {"type": "snap", "t": 1, "s": {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}})
    assert me.get("prev_digest") is not None            # 快照后已建立 delta 基线
    hub.ws_hello("A1", mid, lambda t: True)              # 模拟重连
    assert me.get("prev_digest") is None                 # 重连必须清空 delta 基线


def test_wave_cleared_then_snap_no_double_announce():
    # 清波排程 wave 2（ws_wave_cleared 已直推两侧并同步 last_next_wave）→ 后续快照
    # 不因去重标记未同步而重复宣告同一 nextWave（两条推送路径共享一个标记防双推）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    sends_a: list = []
    hub.ws_hello("A1", mid, lambda t: (sends_a.append(t), True)[1])
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    hub.ws_snap("A1", mid, {"type": "snap", "t": 1, "s": base})       # 宣告波 1
    hub.ws_wave_cleared("A1", mid, 1)                                 # 排程波 2 + 直推两侧
    hub.ws_snap("A1", mid, {"type": "snap", "t": 2, "s": {**base, "wave": 1}})
    nxt = [x for x in _sent(sends_a) if x[0] == "nextWave"]
    assert nxt == [("nextWave", 1), ("nextWave", 2)]                  # 无重复


# ============================================================================
#  Task 6 修 bug：WS 快照路径须宣告首波 nextWave（否则客户端永不开波、不出怪）。
#  旧 HTTP tick 每响应都带 nextWave（开局 me.wave=0 → 宣告 wave:1）；ws_snap 原只在 waveCleared 推，
#  漏了首波。现 ws_snap 按本侧 wave 推 nextWave，变化时才推（last_next_wave 去重防 10Hz 刷屏），
#  且 ws_wave_cleared 同步记 last_next_wave，避免两条推送路径重复宣告同一波。
# ============================================================================
def test_snap_announces_wave1_and_dedups_nextwave():
    # A 首快照 wave=0（波 1 未开）→ A 收到 nextWave{wave:1}（首波宣告，客户端据此开波）。
    hub = _fake_hub()
    mid = _fake_match(hub)
    with _ws_server(hub) as port:
        a = WsClient(port, mid, "A1")
        b = WsClient(port, mid, "B1")
        _hello(a); _hello(b)
        assert a.recv()["type"] == "welcome"
        assert b.recv()["type"] == "welcome"

        a.send({"type": "snap", "t": 1, "s": _snap(wave=0)})
        nw = a.recv()
        assert nw["type"] == "nextWave" and nw["wave"] == 1
        assert nw["startAtServerMs"] == hub.matches[mid]["wave_schedule"][1]

        # A 再快照 wave 仍 0 → 不重复宣告（last_next_wave 去重）；A 不该再收到 nextWave。
        a.send({"type": "snap", "t": 2, "s": _snap(wave=0)})
        assert a.recv(timeout=0.5) is None

        # A 清波 1 → 排程波 2，A 收到 nextWave{wave:2}（ws_wave_cleared 直推，并记 last_next_wave=2）。
        a.send({"type": "waveCleared", "wave": 1})
        nw2 = a.recv()
        assert nw2["type"] == "nextWave" and nw2["wave"] == 2

        # A 再快照（wave 仍 1）→ 即使 _next_wave_for 仍算出 wave:2，last_next_wave 已=2，
        # 快照路径不得重复宣告（防与 waveCleared 直推双重宣告）。
        a.send({"type": "snap", "t": 3, "s": _snap(wave=1)})
        assert a.recv(timeout=0.5) is None
        a.close(); b.close()



# ============================================================================
#  弱网优化①：TCP_NODELAY
# ============================================================================
def test_ws_handshake_sets_tcp_nodelay():
    """WS 握手前后必须对连接 socket 开 TCP_NODELAY（禁 Nagle 攒包）。

    对局是 100ms 级小帧双向实时同步：Nagle 攒包与对端延迟 ACK 叠加可凭空多出
    40~200ms 延迟，实时性直接受损。用假 handler 直调 handle_versus_ws 全链路
    （rfile 恒空 = 两轮读超时判死，hello_ok=False → _mark_gone 空转，天然干净退出），
    断言 setsockopt 恰为 (IPPROTO_TCP, TCP_NODELAY, 1)，且 101 握手响应确已写出。
    """
    from api_versus import handle_versus_ws

    set_calls: list = []
    sent: list = []

    class _Conn:
        def setsockopt(self, *args):
            set_calls.append(args)

        def sendall(self, b):
            sent.append(b)

    class _RFile:
        def read1(self, _n):
            return b""   # 永远无数据：idle_timeouts 两轮即判死退出帧循环

    class _Handler:
        path = "/api/versus/ws?matchId=M1&uid=A1"
        headers = {"Upgrade": "websocket",
                   "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
        # Task 8：WS 握手鉴权 fail-closed 读 cfg["auth"]["strict"]；生产 cfg 恒带 auth 段（默认 strict=False），
        # 补上以对齐生产配置（否则缺 auth 段按 strict 处理 → ?uid= 走 401 而非升级）。
        cfg = {"auth": {"strict": False}}

        def __init__(self):
            self.connection = _Conn()
            self.rfile = _RFile()
            self.close_connection = False

    handle_versus_ws(_Handler(), _fake_hub())
    assert set_calls == [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]
    assert any(b"101" in b for b in sent)   # 握手响应确已写出（选项在真升级路径上设置）
