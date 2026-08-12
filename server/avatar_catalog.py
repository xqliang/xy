"""Static avatar catalog — keep in sync with web/src/avatar-catalog.ts."""
from __future__ import annotations

from typing import Any, Literal

UnlockType = Literal["default", "rank", "clear"]


def catalog() -> list[dict[str, Any]]:
    return [
        {"id": "wukong", "name": "齐天大圣", "unlock_type": "default", "unlock_value": 0, "art": "hero-wukong"},
        {"id": "tangseng", "name": "唐僧", "unlock_type": "default", "unlock_value": 0, "art": "hero-tangseng-hero"},
        {"id": "bajie", "name": "猪八戒", "unlock_type": "default", "unlock_value": 0, "art": "hero-bajie"},
        {"id": "wujing", "name": "沙悟净", "unlock_type": "default", "unlock_value": 0, "art": "hero-shaseng"},
        {"id": "neza", "name": "哪吒", "unlock_type": "default", "unlock_value": 0, "art": "hero-nezha"},
        {"id": "erlang", "name": "二郎神", "unlock_type": "default", "unlock_value": 0, "art": "hero-erlang"},
        {"id": "guanyin", "name": "观音", "unlock_type": "default", "unlock_value": 0, "art": "hero-guanyin"},
        {"id": "laojun", "name": "太上老君", "unlock_type": "default", "unlock_value": 0, "art": "hero-laojun"},
        {"id": "wenshu", "name": "文殊", "unlock_type": "default", "unlock_value": 0, "art": "hero-wenshu"},
        {"id": "tianbing", "name": "天兵", "unlock_type": "default", "unlock_value": 0, "art": "hero-jinzha"},
        {"id": "poet", "name": "布衣诗人", "unlock_type": "default", "unlock_value": 0, "art": "hero-niulang"},
        {"id": "lantern", "name": "提灯老头", "unlock_type": "default", "unlock_value": 0, "art": "hero-mile"},
        {"id": "pipa", "name": "琵琶女", "unlock_type": "rank", "unlock_value": 2, "art": "hero-fanyin"},
        {"id": "general", "name": "将军", "unlock_type": "rank", "unlock_value": 3, "art": "hero-hongpao"},
        {"id": "yaoguai", "name": "小妖", "unlock_type": "rank", "unlock_value": 4, "art": "monster-minion"},
        {"id": "longwang", "name": "龙王", "unlock_type": "rank", "unlock_value": 5, "art": "hero-bailong"},
        {"id": "clear_1", "name": "初通行者", "unlock_type": "clear", "unlock_value": 1, "art": "hero-liusha"},
        {"id": "clear_3", "name": "三通行者", "unlock_type": "clear", "unlock_value": 3, "art": "hero-laojun"},
        {"id": "clear_5", "name": "五通行者", "unlock_type": "clear", "unlock_value": 5, "art": "hero-wenshu"},
        {"id": "clear_10", "name": "十通行者", "unlock_type": "clear", "unlock_value": 10, "art": "hero-niumowang"},
    ]


def by_id(avatar_id: str) -> dict[str, Any] | None:
    for a in catalog():
        if a["id"] == avatar_id:
            return a
    return None


def default_ids() -> list[str]:
    return [a["id"] for a in catalog() if a["unlock_type"] == "default"]


def unlockable(avatar_id: str, rank_level: int, clear_count: int) -> bool:
    a = by_id(avatar_id)
    if not a:
        return False
    t = a["unlock_type"]
    v = int(a["unlock_value"])
    if t == "default":
        return True
    if t == "rank":
        return rank_level >= v
    if t == "clear":
        return clear_count >= v
    return False
