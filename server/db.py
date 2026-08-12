from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator
from zoneinfo import ZoneInfo

import pymysql
from pymysql.cursors import DictCursor

from config import dsn_kwargs

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS players (
      uid VARCHAR(20) NOT NULL PRIMARY KEY,
      nickname VARCHAR(32) NULL,
      avatar_id VARCHAR(64) NOT NULL DEFAULT 'wukong',
      rank_level INT NOT NULL DEFAULT 0,
      save_json MEDIUMTEXT NULL,
      save_updated_at BIGINT NULL,
      last_login_at DATETIME NULL,
      last_ip VARCHAR(64) NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS player_avatars (
      uid VARCHAR(20) NOT NULL,
      avatar_id VARCHAR(64) NOT NULL,
      unlocked_at DATETIME NOT NULL,
      PRIMARY KEY (uid, avatar_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_leaderboard (
      day CHAR(10) NOT NULL,
      uid VARCHAR(20) NOT NULL,
      rank_level INT NOT NULL,
      avatar_id VARCHAR(64) NOT NULL,
      nickname VARCHAR(32) NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (day, uid),
      KEY idx_day_rank (day, rank_level, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS events (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uid VARCHAR(20) NOT NULL,
      day CHAR(10) NOT NULL,
      type VARCHAR(32) NOT NULL,
      payload_json MEDIUMTEXT NULL,
      created_at DATETIME NOT NULL,
      ip VARCHAR(64) NULL,
      KEY idx_day_type (day, type),
      KEY idx_uid_created (uid, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_stats (
      day CHAR(10) NOT NULL PRIMARY KEY,
      dau INT NOT NULL DEFAULT 0,
      games_started INT NOT NULL DEFAULT 0,
      games_ended INT NOT NULL DEFAULT 0,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      wave_sum BIGINT NOT NULL DEFAULT 0,
      wave_n INT NOT NULL DEFAULT 0,
      stamina_spent BIGINT NOT NULL DEFAULT 0,
      merit_spent BIGINT NOT NULL DEFAULT 0,
      ad_clicks INT NOT NULL DEFAULT 0,
      ad_rewards INT NOT NULL DEFAULT 0,
      heroes_json MEDIUMTEXT NULL,
      items_json MEDIUMTEXT NULL,
      fragments_json MEDIUMTEXT NULL,
      updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


class DB:
    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.tz = ZoneInfo(cfg.get("timezone") or "Asia/Shanghai")

    def connect(self) -> pymysql.connections.Connection:
        kw = dsn_kwargs(self.cfg)
        kw["cursorclass"] = DictCursor
        return pymysql.connect(**kw)

    @contextmanager
    def cursor(self) -> Iterator[DictCursor]:
        conn = self.connect()
        try:
            with conn.cursor() as cur:
                yield cur
            conn.commit()
        finally:
            conn.close()

    def migrate(self) -> None:
        with self.cursor() as cur:
            for sql in SCHEMA:
                cur.execute(sql)

    def today(self) -> str:
        return datetime.now(self.tz).strftime("%Y-%m-%d")

    def now(self) -> datetime:
        return datetime.now(self.tz).replace(tzinfo=None)

    def day_offsets(self, n: int = 2) -> list[str]:
        from datetime import timedelta

        base = datetime.now(self.tz).date()
        return [(base - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]
