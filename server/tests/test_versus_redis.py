import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pytest

def test_rediskv_prefix_and_config():
    from rediskv import k
    assert k("q", "3") == "xy:pvp:q:3"
    assert k("match", "abc") == "xy:pvp:match:abc"

def test_redis_kwargs_from_env(monkeypatch):
    monkeypatch.setenv("XY_REDIS_HOST", "1.2.3.4")
    monkeypatch.setenv("XY_REDIS_PORT", "6380")
    monkeypatch.setenv("XY_REDIS_DB", "7")
    from config import load_config, redis_kwargs
    cfg = load_config()
    kw = redis_kwargs(cfg)
    assert kw["host"] == "1.2.3.4" and kw["port"] == 6380 and kw["db"] == 7
    assert kw["decode_responses"] is True
