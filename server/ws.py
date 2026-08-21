# -*- coding: utf-8 -*-
"""RFC6455 WebSocket 握手与帧编解码 —— 纯函数版（Task 1）。

设计要点（对应 spec §6「服务端设计」）：
- 服务端沿用 stdlib http.server.ThreadingHTTPServer，不引第三方框架，
  WebSocket 协议自己实现 —— 本模块只做「无状态纯函数」：
  哈希握手 key、拼 101 响应、编/解帧字节流，**不碰任何 socket I/O**
  （socket 读写、连接线程占用、发送锁都在 Task 2 的连接层处理）。
- 帧格式速记（RFC6455 §5.2，单位：bit）：

      0                   1                   2                   3
      0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
     +-+-+-+-+-------+-+-------------+-------------------------------+
     |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
     |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
     |N|V|V|V|       |S|             |   (if payload len==126/127)   |
     +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
     |     Extended payload length continued, if payload len == 127  |
     + - - - - - - - - - - - - - - - +-------------------------------+
     |                               |Masking-key, if MASK set to 1  |
     +-------------------------------+-------------------------------+
     | Masking-key (continued)       |          Payload Data         |
     +-------------------------------- - - - - - - - - - - - - - - - +

  - RSV1-3 本项目未用扩展，恒 0（编码时不置位；解码时忽略）。
  - MASK：**客户端发给服务端的帧必须掩码**（RFC 硬性要求），**服务端发给
    客户端的帧必须不掩码**。所以 encode_frame 永不置 mask 位，
    decode_frame 按客户端帧预期处理掩码（遇到不掩码的帧也宽容解析，
    见 decode_frame 注释）。
  - Payload len 三分支：<126 直接放 7 位；==126 后跟 2 字节大端 u16；
    ==127 后跟 8 字节大端 u64。
  - 掩码算法：payload[i] ^= mask_key[i % 4]，编/解对称（异或）。

只用 stdlib（hashlib/base64），零新依赖。
"""
from __future__ import annotations

import base64
import hashlib

# RFC6455 §1.3 规定的固定 GUID：握手 Accept 计算“盐”，所有实现共用这一个魔串。
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# ---- opcode 常量（RFC6455 §5.2）----
OP_TEXT = 0x1     # 文本帧（payload 为 UTF-8）
OP_BINARY = 0x2   # 二进制帧
OP_CLOSE = 0x8    # 关闭帧（控制帧）
OP_PING = 0x9     # 心跳探测（控制帧）
OP_PONG = 0xA     # 心跳应答（控制帧）


def ws_accept_key(key: str) -> str:
    """由客户端握手中的 Sec-WebSocket-Key 算出 Sec-WebSocket-Accept。

    算法（RFC6455 §4.2.2 第 5 步）：
        accept = base64( sha1( key + WS_GUID ) )
    key 是 24 字符 base64（含 ==）的字符串；返回值放回 101 响应头，
    客户端用同样算法校验，防止“顺手的代理/老服务器”误升级连接。
    """
    digest = hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def handshake_response(sec_ws_key: str) -> str:
    """拼出完整的 HTTP 101 Switching Protocols 响应文本（CRLF 行结尾）。

    调用方（Task 2 的连接层）拿到后按 ASCII 一次性写出 socket 即完成握手。
    四行头一个都不能少，顺序按 RFC 示例，最后空行 (\r\n\r\n) 表示头结束。
    """
    return (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {ws_accept_key(sec_ws_key)}\r\n"
        "\r\n"
    )


def encode_frame(opcode: int, payload: bytes) -> bytes:
    """编码一个**服务端**帧（FIN=1、不掩码）。

    本项目不需要分片（消息都是小 JSON 快照），所以 FIN 恒置 1；
    服务端帧按 RFC 必须不带 mask，客户端解到 MASK=0 就直接读 payload。

    长度三分支：
        len < 126      -> 1 字节长度（放 b2 低 7 位）
        len < 65536    -> b2=126，后跟 2 字节大端 u16
        否则           -> b2=127，后跟 8 字节大端 u64
    """
    b1 = 0x80 | opcode  # 0x80 = FIN 位
    n = len(payload)
    if n < 126:
        head = bytes([b1, n])
    elif n < 65536:
        head = bytes([b1, 126]) + n.to_bytes(2, "big")
    else:
        head = bytes([b1, 127]) + n.to_bytes(8, "big")
    return head + payload


def encode_text(s: str) -> bytes:
    """便捷函数：字符串 -> UTF-8 编码的 TEXT 帧（本项目消息全是 JSON 文本）。"""
    return encode_frame(OP_TEXT, s.encode("utf-8"))


def decode_frame(buf: bytes) -> dict:
    """从 buf 开头解码**一个**客户端帧（客户端帧按 RFC 必带 mask）。

    返回 dict：
        {"opcode": int,     # 低 4 位 opcode
         "payload": bytes,  # 已解掩码的载荷（半截帧时为 b""）
         "consumed": int,   # 本帧在 buf 里占的字节数；**半截帧为 0**，
                            #   调用方应继续读 socket 补数据后原样重试
         "fin": bool}       # FIN 位（本项目编码恒 1，这里如实记录）

    半截帧（TCP 分片到达是常态）的约定：任何阶段发现缓冲不够一整帧，
    一律返回 consumed=0，让上层把缓冲留着等下一次 recv 拼齐。
    解析步骤逐字节说明见各分支内注释。
    """
    # ---- 1. 基本头 2 字节（b1: FIN/RSV/opcode；b2: MASK/len7）----
    if len(buf) < 2:
        return {"opcode": 0, "payload": b"", "consumed": 0, "fin": False}

    b1 = buf[0]
    fin = bool(b1 & 0x80)   # FIN=1 表示消息最后一片（本项目不分片，恒 1）
    opcode = b1 & 0x0F      # 低 4 位：1/2 数据帧，8/9/A 控制帧

    b2 = buf[1]
    masked = bool(b2 & 0x80)
    len7 = b2 & 0x7F

    # ---- 2. 长度解析：len7 三分支（126/127 是扩展长度的“转义码”）----
    if len7 < 126:
        length = len7
        header = 2                          # b1+b2 共 2 字节头
    elif len7 == 126:
        # 需要 2 字节大端 u16 扩展长度
        if len(buf) < 4:
            return {"opcode": 0, "payload": b"", "consumed": 0, "fin": False}
        length = int.from_bytes(buf[2:4], "big")
        header = 4                          # 2 + 2
    else:  # len7 == 127
        # 需要 8 字节大端 u64 扩展长度
        if len(buf) < 10:
            return {"opcode": 0, "payload": b"", "consumed": 0, "fin": False}
        length = int.from_bytes(buf[2:10], "big")
        header = 10                         # 2 + 8

    # ---- 3. 掩码 key（客户端帧 MASK=1 时紧跟着头）+ 整帧长度校验 ----
    masklen = 4 if masked else 0
    total = header + masklen + length       # 一整帧的完整字节数
    if len(buf) < total:
        # 半截帧：mask key 没读全 / payload 没到齐都落在这里
        return {"opcode": 0, "payload": b"", "consumed": 0, "fin": False}

    # ---- 4. 取载荷并解掩码 ----
    if masked:
        # RFC 硬性要求客户端帧掩码，正常一定走这里。
        # 掩码算法：payload[i] ^= mask_key[i % 4]（异或对称，编/解同式）
        key = buf[header:header + 4]
        raw = buf[header + 4:total]
        payload = bytes(raw[i] ^ key[i % 4] for i in range(length))
    else:
        # 不掩码的“客户端帧”是协议违规，但宽容处理：payload 直接跟在头后，
        # 不至于把连接打死（浏览器/正规客户端不会发，防御非标实现）。
        payload = buf[header:total]

    return {"opcode": opcode, "payload": payload, "consumed": total, "fin": fin}
