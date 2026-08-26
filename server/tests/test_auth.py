from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_config_has_wechat_and_auth_defaults():
    from config import load_config

    cfg = load_config()
    assert "wechat" in cfg and set(cfg["wechat"]) >= {"appid", "secret"}
    assert cfg["auth"]["strict"] is False          # 默认灰度：不强制 token
    assert int(cfg["auth"]["session_days"]) == 30


def test_auth_strict_env_override(monkeypatch):
    monkeypatch.setenv("XY_AUTH_STRICT", "true")
    from config import load_config

    cfg = load_config()
    assert cfg["auth"]["strict"] is True
