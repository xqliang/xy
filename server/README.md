# xy 游戏服务端（静态站 + API + Admin）

同进程提供：

- 静态前端（`static_dir`，ECS 上一般为 `/opt/xy/html`）
- `/api/*` 玩家登录、存档备份、日榜、埋点
- `/admin` 运营后台（用户 / DAU / 英雄道具广告经济 / 排行榜）

设计见 `docs/superpowers/specs/2026-08-12-player-cloud-sync-admin-design.md`。

## 本地开发

```bash
# MariaDB（示例：docker 3307）
docker run -d --name xy-mysql-test \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=1 \
  -e MYSQL_DATABASE=xy_game_test \
  -p 3307:3306 mariadb:11

cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp config.example.yaml config.yaml   # 按需改 DSN
.venv/bin/python server.py           # 默认 :8082

.venv/bin/python -m pytest tests/ -v
```

前端 Vite 已把 `/api`、`/admin` 代理到 `127.0.0.1:8082`。

## ECS 部署

`./start.sh deploy` 会：

1. 构建并原子切换静态 `dist`
2. rsync `server/` 到 `/opt/xy/server`（保留远端 `config.yaml` / `.db_password`）
3. 创建 venv、装依赖、安装 `xy-web.service` + 每日备份 timer，并重启服务

首次在机器上需 MariaDB；可用 `server/deploy/init-db.sh` 建库 `xy_game`。

后台：`http://<ip>:8082/admin`（账号见远端 `config.yaml` 的 `admin`）。

## 备份

`xy-backup.timer` 每天跑 `deploy/backup-mysql.sh`，dump 到 `/opt/xy/backups/`，保留约 30 天（每月 1 号永久保留）。
