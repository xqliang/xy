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
    # 在线真人对战（PvP）Plan A：单局结果归档。match_id 由撮合层分配，
    # 对同一局两名玩家各落一行（各写自己的 outcome/reason），按 (uid, day) 查询历史。
    """
    CREATE TABLE IF NOT EXISTS pvp_results (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      match_id VARCHAR(40) NOT NULL,
      day CHAR(10) NOT NULL,
      uid VARCHAR(20) NOT NULL,
      opponent_uid VARCHAR(20) NOT NULL,
      outcome ENUM('win','lose','draw') NOT NULL,
      reason VARCHAR(32) NOT NULL,
      wave INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      KEY idx_uid_day (uid, day),
      KEY idx_match (match_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    # PvP 对局异常记录（防作弊/不一致复核）。同一天同一对对手只保留一行，
    # reasons_json 为异常原因数组（如卡顿重连、战绩分歧），便于后续人工/离线核对。
    """
    CREATE TABLE IF NOT EXISTS pvp_anomaly (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      day CHAR(10) NOT NULL,
      uid VARCHAR(20) NOT NULL,
      opponent_uid VARCHAR(20) NOT NULL,
      match_id VARCHAR(40) NOT NULL,
      reasons_json MEDIUMTEXT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY uniq_day_uid_opp (day, uid, opponent_uid),
      KEY idx_uid_day (uid, day)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    # 在线真人对战（PvP）里程碑 B：正在进行的活跃对局镜像。单进程内存 matches 的持久层，
    # 供 systemctl restart/发版/崩溃后回放（重连客户端经 ws_hello 重挂 ws_send）。以 match_id 为主键，
    # 定期全量 UPSERT + 对账删除；只存未终局对局（终局入 pvp_results）。state_json 为剔除 ws_send 后的整局快照。
    """
    CREATE TABLE IF NOT EXISTS pvp_active_match (
      match_id VARCHAR(40) NOT NULL PRIMARY KEY,
      uid_a VARCHAR(20) NOT NULL,
      uid_b VARCHAR(20) NOT NULL,
      ticket_a VARCHAR(40) NULL,
      ticket_b VARCHAR(40) NULL,
      state_json MEDIUMTEXT NOT NULL,
      updated_at DATETIME NOT NULL,
      KEY idx_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    # 微信身份映射：openid → 内部数字 uid。openid 主键 + 绑定用 ON DUPLICATE KEY，保证并发只绑一次。
    # 注意：openid 大小写敏感、纯 ASCII（字母/数字/-/_）。若沿用表默认的 utf8mb4_unicode_ci（不区分大小写），
    #       只差大小写的两个 openid 会折叠成同一主键，Task 6 的 ON DUPLICATE KEY 会把用户张冠李戴；
    #       故显式给 openid 用 ascii/ascii_bin 二进制排序，既区分大小写又更省空间。
    """
    CREATE TABLE IF NOT EXISTS wx_identities (
      openid  VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      unionid VARCHAR(64) NULL,
      uid     VARCHAR(20) NOT NULL,
      created_at DATETIME NOT NULL,
      KEY idx_uid (uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    # 会话令牌：token → uid，滑动过期。expires_at 索引便于将来清理过期行。
    # token 是小写 hex（大小写敏感、纯 ASCII），主键同样用 ascii_bin 二进制排序，避免大小写折叠撞主键。
    """
    CREATE TABLE IF NOT EXISTS sessions (
      token   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      uid     VARCHAR(20) NOT NULL,
      platform VARCHAR(8) NOT NULL,
      created_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      KEY idx_uid (uid),
      KEY idx_expires (expires_at)
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
