"""微信登录：用小程序前端拿到的临时登录凭证 code 去换 openid。

小程序登录流程简介（新人向）：
1) 前端调用 wx.login() 拿到一个一次性 code；
2) 把 code 发给我们的服务端；
3) 服务端拿 code + appid + secret 去请求微信的 jscode2session 接口，
   换回该用户的 openid（用户在本小程序下的唯一标识）等信息。

本模块只负责第 3 步：调微信 REST 接口换 openid，纯 stdlib（urllib），不引第三方依赖。
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

# 微信官方「登录凭证校验」接口地址（小程序）。
WX_CODE2SESSION = "https://api.weixin.qq.com/sns/jscode2session"


class WxAuthError(Exception):
    """微信换取 openid 失败。code>0 为微信 errcode；code<0 为本地错误（未配置/网络/解析）。"""

    def __init__(self, code: int, msg: str):
        super().__init__(f"wx auth error {code}: {msg}")
        self.code = code
        self.msg = msg


def code2session(cfg: dict[str, Any], code: str) -> dict[str, Any]:
    """用临时 code 换取 openid。

    参数：
        cfg  —— 全局配置字典，需含 cfg["wechat"]["appid"] 和 ["secret"]。
        code —— 前端 wx.login() 得到的一次性登录凭证。
    返回：
        {"openid": ..., "session_key": ..., "unionid": ...}
    失败时抛 WxAuthError（见类文档说明 code 的正负含义）。
    """
    # 取出微信配置；缺失时给空串，交给下面的校验统一报错。
    wx = cfg.get("wechat") or {}
    appid = wx.get("appid") or ""
    secret = wx.get("secret") or ""
    if not appid or not secret:
        # 未配置 appid/secret：属于本地配置问题，用 -1 标记。
        raise WxAuthError(-1, "wechat appid/secret not configured")
    if not code:
        # 前端没传 code：本地参数问题，用 -2 标记。
        raise WxAuthError(-2, "empty code")

    # 拼接查询串。grant_type 固定为 authorization_code（微信要求）。
    qs = urllib.parse.urlencode({
        "appid": appid, "secret": secret,
        "js_code": code, "grant_type": "authorization_code",
    })
    url = f"{WX_CODE2SESSION}?{qs}"

    # 发起 HTTP 请求。设 5 秒超时，避免微信侧抖动时长时间卡住。
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read()
    except OSError as e:  # 网络/超时（含 URLError/timeout，都是 OSError 子类）
        raise WxAuthError(-3, f"network error: {e}") from e

    # 解析微信返回的 JSON。返回体异常（非 UTF-8 / 非合法 JSON）时报 -4。
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise WxAuthError(-4, f"bad response: {e}") from e

    # 微信约定：成功时通常不带 errcode，或 errcode=0；非 0 即业务错误。
    errcode = int(data.get("errcode") or 0)
    if errcode != 0:
        # 把微信原始 errcode 透传出去（>0），方便上层区分「code 失效」等具体原因。
        raise WxAuthError(errcode, str(data.get("errmsg") or "wx error"))

    # 兜底：errcode=0 但没拿到 openid 也视为失败。
    openid = data.get("openid")
    if not openid:
        raise WxAuthError(-5, "no openid in response")

    # 只回传上层真正需要的三项；unionid 仅在绑定了开放平台时才有，可能为 None。
    return {"openid": openid, "session_key": data.get("session_key"), "unionid": data.get("unionid")}
