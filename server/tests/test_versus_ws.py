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
    DISCONNECT_GRACE_MS, INTER_WAVE_DELAY_MS, VersusHub,
)


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
                  pick_map=lambda: "huoyanshan")
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
    H.cfg = {"static_dir": static_dir}
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

        hub._clock["ms"] += 500         # 仍远小于宽限(6s)
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
