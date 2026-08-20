from __future__ import annotations
import os, sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

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
    d = DB(load_config())
    d.migrate()
    return d

def test_migrate_creates_pvp_tables(db):
    with db.cursor() as cur:
        cur.execute("SHOW TABLES LIKE 'pvp_results'")
        assert cur.fetchone() is not None
        cur.execute("SHOW TABLES LIKE 'pvp_anomaly'")
        assert cur.fetchone() is not None
