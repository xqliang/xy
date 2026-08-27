# PvP Redis 键前缀助手 + 客户端工厂。所有 key 统一 xy:pvp: 前缀（该 Redis 与其它项目共用，前缀防冲突）。
from typing import Any

PREFIX = "xy:pvp:"


def k(*parts: object) -> str:
    # 接受 int（如 rank）等：统一转 str 再拼，避免 ":".join 对非 str 抛 TypeError（匹配层 xy:pvp:q:{rank} 常传 int）
    return PREFIX + ":".join(map(str, parts))


def make_client(cfg: dict[str, Any]):
    import redis
    from config import redis_kwargs
    return redis.Redis(**redis_kwargs(cfg))
