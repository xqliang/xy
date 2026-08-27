# PvP Redis 键前缀助手 + 客户端工厂。所有 key 统一 xy:pvp: 前缀（该 Redis 与其它项目共用，前缀防冲突）。
from typing import Any

PREFIX = "xy:pvp:"


def k(*parts: str) -> str:
    return PREFIX + ":".join(parts)


def make_client(cfg: dict[str, Any]):
    import redis
    from config import redis_kwargs
    return redis.Redis(**redis_kwargs(cfg))
