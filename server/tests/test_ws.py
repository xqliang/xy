# -*- coding: utf-8 -*-
"""Task 1：RFC6455 握手 + 帧编解码纯函数（server/ws.py）单元测试。

纯函数测试，不依赖 DB / socket：
- ws_accept_key：RFC6455 §1.3 官方样例（key -> accept 一一对应）。
- handshake_response：101 响应行序、Sec-WebSocket-Accept 正确。
- encode_frame / decode_frame 往返：小(<126)/中(>=126)/大(>=65536) 三种长度分支，
  客户端帧按 RFC 必带 mask —— 测试内手搓 client_encode()（带掩码版编码器）再喂 decode_frame。
- 半截帧（分片到达）：在每个边界截断都应返回 consumed == 0（等更多数据）。
- 控制帧 ping/pong/close 与 text 走同一条解析路径。
- 粘包：一个 buffer 里两帧拼接，第一次 decode 恰好消费帧 1，按 consumed 切片后得到帧 2。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pytest

from ws import (
    WS_GUID,
    OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG,
    ws_accept_key, encode_frame, encode_text, decode_frame, handshake_response,
)


# ---------------------------------------------------------------- 测试辅助 ----
def client_encode(opcode: int, payload: bytes, mask_key: bytes = b"\x01\x02\x03\x04") -> bytes:
    """手搓「客户端帧」编码器：与 encode_frame 分支一致，但 FIN=1 且必带 mask（RFC 要求客户端帧必须掩码）。
    用于构造 decode_frame 的输入 —— decode 侧是服务端视角，只解带掩码的客户端帧。"""
    b1 = 0x80 | opcode                       # FIN=1 + opcode
    n = len(payload)
    if n < 126:                              # 长度直接放 b2 低 7 位
        head = bytes([b1, 0x80 | n])
    elif n < 65536:                          # 126 + 2 字节大端 u16
        head = bytes([b1, 0x80 | 126]) + n.to_bytes(2, "big")
    else:                                    # 127 + 8 字节大端 u64
        head = bytes([b1, 0x80 | 127]) + n.to_bytes(8, "big")
    masked = bytes(payload[i] ^ mask_key[i % 4] for i in range(n))  # 掩码：payload[i] ^= key[i%4]
    return head + mask_key + masked


# ---------------------------------------------------------------- 握手 ----
def test_ws_accept_key_rfc_sample():
    # RFC6455 §1.3 官方样例：这把 key 必须算出这个 accept，错一个字符都不行
    assert ws_accept_key("dGhlIHNhbXBsZSBub25jZQ==") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="


def test_ws_accept_key_uses_guid():
    # Accept = b64(sha1(key + GUID))：换一把 key 结果应随之变化（证明 GUID 参与了运算）
    a = ws_accept_key("dGhlIHNhbXBsZSBub25jZQ==")
    b = ws_accept_key("another-key")
    assert a != b
    # 与手算 b64(sha1(key+GUID)) 一致（不信任实现、独立复算）
    import base64, hashlib
    expect = base64.b64encode(hashlib.sha1(("another-key" + WS_GUID).encode()).digest()).decode()
    assert b == expect


def test_handshake_response():
    # 完整 101 响应文本：首行、Upgrade/Connection 头、Accept 值、空行结尾（CRLF）
    key = "dGhlIHNhbXBsZSBub25jZQ=="
    resp = handshake_response(key)
    assert resp.startswith("HTTP/1.1 101 Switching Protocols\r\n")
    assert "Upgrade: websocket\r\n" in resp
    assert "Connection: Upgrade\r\n" in resp
    assert "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n" in resp
    assert resp.endswith("\r\n\r\n")


# ---------------------------------------------------------------- 服务端编码 ----
def test_encode_frame_small_no_mask():
    # <126 字节：b1=0x80|opcode，b2=长度（高位 mask 位为 0 = 服务端不掩码），后跟原文
    f = encode_frame(OP_TEXT, b"hello")
    assert f == bytes([0x81, 5]) + b"hello"


def test_encode_frame_medium_uses_16bit_length():
    # >=126 字节：b2=126 + 2 字节大端长度
    payload = b"x" * 300
    f = encode_frame(OP_BINARY, payload)
    assert f[0] == 0x80 | OP_BINARY
    assert f[1] == 126
    assert int.from_bytes(f[2:4], "big") == 300
    assert f[4:] == payload


def test_encode_frame_large_uses_64bit_length():
    # >=65536 字节：b2=127 + 8 字节大端长度
    payload = b"y" * 70000
    f = encode_frame(OP_TEXT, payload)
    assert f[1] == 127
    assert int.from_bytes(f[2:10], "big") == 70000
    assert len(f) == 10 + 70000


def test_encode_text_utf8():
    # 便捷函数：UTF-8 编码 + OP_TEXT
    f = encode_text("你好")
    assert f == bytes([0x81, 6]) + "你好".encode("utf-8")


def test_encode_frame_empty_payload():
    # 空载荷：b2=0，后面什么都不跟（合法：ping/close 常见）
    assert encode_frame(OP_PING, b"") == bytes([0x80 | OP_PING, 0])


# ---------------------------------------------------------------- 客户端帧解码 ----
@pytest.mark.parametrize("payload_len", [0, 5, 125, 126, 300, 1000, 65535, 65536, 70000])
def test_decode_roundtrip_all_length_branches(payload_len):
    # 三档长度分支全覆盖：客户端编码（带 mask）→ decode → 还原 opcode/payload，consumed 精确等于帧长
    payload = bytes((i * 7 + 13) % 256 for i in range(payload_len))  # 非平凡字节，掩码错了立刻露馅
    frame = client_encode(OP_TEXT, payload)
    r = decode_frame(frame)
    assert r["opcode"] == OP_TEXT
    assert r["payload"] == payload          # 掩码已解开
    assert r["consumed"] == len(frame)
    assert r["fin"] is True


@pytest.mark.parametrize("opcode", [OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG])
def test_decode_control_frames_same_path(opcode):
    # ping(0x9)/pong(0xA)/close(0x8) 与 text(0x1) 走同一条解析路径
    payload = b"ctrl"
    r = decode_frame(client_encode(opcode, payload))
    assert r["opcode"] == opcode
    assert r["payload"] == payload


def test_decode_unmasked_lenient():
    # 协议要求客户端帧必带 mask，但遇到不带 mask 的帧也应宽容解析（payload 直接跟在头部后面）
    payload = b"plain"
    frame = bytes([0x81, len(payload)]) + payload
    r = decode_frame(frame)
    assert r["opcode"] == OP_TEXT
    assert r["payload"] == payload
    assert r["consumed"] == len(frame)


# ---------------------------------------------------------------- 半截帧（分片到达） ----
def test_decode_empty_buffer():
    # 空缓冲 / 只有 1 字节：连 b1/b2 都凑不齐 → consumed=0（等更多数据）
    assert decode_frame(b"")["consumed"] == 0
    assert decode_frame(b"\x81")["consumed"] == 0


def test_decode_truncated_at_every_boundary_medium():
    # 中等帧（len=126 分支，头 4 字节 + mask 4 字节 + 载荷）在每个边界截断：
    # 1 字节 / 2 字节（齐 b2 但缺扩展长度）/ 头 4 字节齐但缺 mask / mask 半截 / 载荷半截
    payload = b"m" * 300
    frame = client_encode(OP_TEXT, payload, b"\xaa\xbb\xcc\xdd")
    for cut in (1, 2, 3, 4, 5, 6, 7, 8, 100, len(frame) - 1):
        r = decode_frame(frame[:cut])
        assert r["consumed"] == 0, f"截断到 {cut} 字节不应算作完整帧"
        assert r["payload"] == b""


def test_decode_truncated_at_every_boundary_large():
    # 大帧（len=127 分支，头 10 字节）：头半截 / 头齐缺 mask / mask 半截 / 载荷半截
    payload = b"L" * 70000
    frame = client_encode(OP_BINARY, payload)
    for cut in (1, 5, 9, 10, 11, 12, 13, 14, 5000, len(frame) - 1):
        assert decode_frame(frame[:cut])["consumed"] == 0, f"截断到 {cut} 字节不应算作完整帧"


def test_decode_truncated_small():
    # 小帧：载荷半截
    frame = client_encode(OP_TEXT, b"hello")
    assert decode_frame(frame[:-1])["consumed"] == 0


def test_decode_partial_then_complete():
    # 模拟真实读循环：先到半截（consumed=0 别动缓冲），补齐后一次解出整帧
    payload = b"z" * 200
    frame = client_encode(OP_TEXT, payload)
    half = decode_frame(frame[:50])
    assert half["consumed"] == 0                       # 半截不动缓冲
    full = decode_frame(frame)
    assert full["consumed"] == len(frame) and full["payload"] == payload


# ---------------------------------------------------------------- 粘包 ----
def test_two_frames_concatenated():
    # 一个 buffer 里两帧拼接：第一次 decode 恰好消费帧 1，切片后第二次得到帧 2
    p1, p2 = b"first-frame", b"second" * 30          # 一小一中，覆盖不同长度分支
    buf = client_encode(OP_TEXT, p1) + client_encode(OP_BINARY, p2, b"\x10\x20\x30\x40")
    r1 = decode_frame(buf)
    assert r1["opcode"] == OP_TEXT and r1["payload"] == p1
    assert r1["consumed"] == len(client_encode(OP_TEXT, p1))
    r2 = decode_frame(buf[r1["consumed"]:])
    assert r2["opcode"] == OP_BINARY and r2["payload"] == p2
    assert r2["consumed"] == len(client_encode(OP_BINARY, p2, b"\x10\x20\x30\x40"))


# ---------------------------------------------------------------- 常量 ----
def test_opcode_constants():
    # RFC6455 §5.2 opcode 取值
    assert (WS_GUID, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG) == \
        ("258EAFA5-E914-47DA-95CA-C5AB0DC85B11", 0x1, 0x2, 0x8, 0x9, 0xA)
