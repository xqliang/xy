# 玩家云同步 · 头像 · 日榜 · 运营后台 设计

日期：2026-08-12  
状态：已确认，待写实现计划

## 一、目标

在现有纯客户端存档之上，增加：

1. **Web 匿名 UID** 与服务端数据关联（玩法备份 + 资料）。
2. **每日境界排行榜**，对接首页排行榜模块（头像 + 昵称/脱敏 UID）。
3. **首页头像设置**：选系统头像、可选昵称；部分头像需通关/境界解锁。
4. **运营后台**（对齐 dubbing `/admin`）：用户查询、DAU、局数/波次、英雄/道具/广告/经济统计、排行榜查看。
5. 服务部署在现有 ECS，对外 `http://<ip>:8082/api/...` 与 `:8082/admin`。

## 二、核心决策（已与用户确认）

| 议题 | 决策 |
|------|------|
| 权威模型 | **混合**：玩法进度客户端权威；日榜分数、头像装备、解锁、可选昵称走服务端校验；玩法整包**备份**到服务端，冲突取 `save_updated_at` 较新方 |
| 排行榜维度 | **境界等级**（`rank.level`）**日榜** |
| 展示名 | 头像 + **可选昵称**；无昵称时脱敏 UID（如 `***4821`） |
| 微信 | **第一期不做**授权；第二期再做 openid / 微信头像昵称。微信端暂用本地 UID，API 可共用 |
| 头像解锁 | **一批默认解锁** + **少量稀有**：境界阈值 / 通关次数解锁 |
| 服务形态 | **扩展现有 Python 静态站**同进程挂 `/api` 与 `/admin`（方案 1） |
| 存储 | **MySQL/MariaDB** 新建库（不用 SQLite）；参考 `../dubbing` 建库账号与每日备份 |
| 昵称 | 需要（可选），不是必填 |

## 三、架构

```
浏览器 (Web)
  ├─ localStorage：玩法权威（体力/功德/境界/装备/设置/无尽…）
  ├─ dasheng.uid：匿名 UID（首次自动生成并持久化）
  └─ fetch → http://<ecs>:8082/api/...
                │
ECS :8082 同一 Python 进程（仓库 `server/`）
  ├─ 静态站（根目录 = `/opt/xy/html`，保留 assets immutable 缓存策略）
  ├─ /api/*   玩家与埋点
  └─ /admin/* 运营后台（HTML）
         └─ MariaDB 库 `xy_game`
              ├─ players / player_avatars / daily_leaderboard
              └─ events / daily_stats

备份：systemd timer → mysqldump | gzip
      （对齐 dubbing；TOS 私有上传可选，与 dubbing 脚本模式一致）
```

### 权威划分

| 数据 | 权威 | 服务端角色 |
|------|------|------------|
| 体力 / 功德 / 境界进度 / 当日兑换与装备 / 武器袋 / 设置 / 无尽开关与 bestWave | 客户端 | `save_json` 备份；合并取较新 `save_updated_at` |
| 日榜分数（境界等级） | 服务端 | 结算上报后写入当日榜 |
| 头像装备、已解锁头像、可选昵称 | 服务端 | 校验解锁后再写入 |
| IP、上次登录 | 服务端 | 请求时更新 |
| 运营统计 | 服务端 | 事件入库 + 定时聚合 |

第一期**不**做服务端权威校验体力/功德（防刷不是本阶段目标）。

## 四、数据模型（MySQL）

**库：** `xy_game`  
**账号：** `xy_game@localhost`，密码首次部署写入服务目录 `.db_password`，重部署不覆盖。  
**字符集：** `utf8mb4` / `utf8mb4_unicode_ci`。

### 4.1 `players`

| 列 | 类型 | 说明 |
|----|------|------|
| `uid` | VARCHAR(20) PK | 客户端匿名 UID，`^\d{8,20}$` |
| `nickname` | VARCHAR(32) NULL | 可选；空则客户端显示脱敏 UID |
| `avatar_id` | VARCHAR(64) NOT NULL | 当前装备头像 |
| `rank_level` | INT NOT NULL DEFAULT 0 | 最近上报境界，便于后台筛选 |
| `save_json` | MEDIUMTEXT NULL | 玩法备份整包 |
| `save_updated_at` | BIGINT NULL | 客户端存档毫秒时间戳，合并用 |
| `last_login_at` | DATETIME NULL | |
| `last_ip` | VARCHAR(64) NULL | |
| `created_at` / `updated_at` | DATETIME | |

### 4.2 头像 catalog（第一期不建 `avatar_defs` 表）

客户端与服务端**各持同一份静态常量**（TS + Python，字段对齐）：`id` / 中文名 / `unlock_type`（`default`|`rank`|`clear`）/ `unlock_value` / CDN URL。  
数量目标约 **12 默认 + 8 条件**。后台只读该常量展示，不提供运营改表。

累计通关次数 `clearCount`：客户端在 `save_json`（及本地 key，如 `dasheng.clearCount`）中持久化；`POST /api/avatar/unlock` 时上报，服务端**不单独建计数表**（第一期信任客户端，与混合权威一致）。

### 4.3 `player_avatars`

| 列 | 说明 |
|----|------|
| `uid` + `avatar_id` | 复合主键 |
| `unlocked_at` | |

默认头像在 `login` 时**落库**写入 `player_avatars`（不采用虚拟解锁）。

### 4.4 `daily_leaderboard`

| 列 | 说明 |
|----|------|
| `day` + `uid` | 复合主键；`day` = `Asia/Shanghai` 自然日 `YYYY-MM-DD` |
| `rank_level` | 当日最高上报值 |
| `avatar_id` / `nickname` | 展示快照 |
| `updated_at` | |

索引：`(day, rank_level DESC, updated_at ASC)` 供 Top N。

### 4.5 `events`（埋点原始）

| 列 | 说明 |
|----|------|
| `id` | BIGINT AI PK |
| `uid` | |
| `day` | 冗余自然日，便于按日扫 |
| `type` | 见第六节 |
| `payload_json` | |
| `created_at` | |
| `ip` | 可选 |

索引：`(day, type)`、`(uid, created_at)`。保留策略：先只写入，清理策略后续加（YAGNI）。

### 4.6 `daily_stats`（聚合宽表）

按日一行（或按日+维度多行，实现时选一种；推荐**按日一行 + JSON 明细列**简化第一期）：

| 列 | 说明 |
|----|------|
| `day` PK | |
| `dau` | 当日有 `login` 或任意事件的独立 uid 数 |
| `games_started` / `games_ended` | |
| `wins` / `losses` | |
| `wave_sum` / `wave_n` | 用于平均波次 |
| `stamina_spent` / `merit_spent` | 消耗合计 |
| `ad_clicks` / `ad_rewards` | |
| `heroes_json` | `{ heroId: count }` |
| `items_json` | `{ itemId: count }` |
| `fragments_json` | `{ weaponId: gained }` |
| `updated_at` | |

聚合：进程内每 5 分钟跑一次；**按日重算最近 2 个自然日**的 `events` 写入 `daily_stats`（实现简单、天然幂等；第一期**不依赖 Redis**）。事件量大再改增量 cursor。

## 五、玩家 API

均 JSON。身份：请求头 `X-Uid`（或 body `uid`，二者一致时以 header 为准）。非法 UID → 400。

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/api/player/login` | 注册或登录；更新 IP/登录时间；确保默认头像解锁；返回资料 + 解锁列表 + 云端 `save_*`（若有） |
| `POST` | `/api/player/sync` | body: `save_json`, `save_updated_at`。若客户端更新 → 覆盖云端；若云端更新 → 返回云端包供合并；相等 → 204/空成功 |
| `GET` | `/api/player/me` | 资料、装备头像、解锁、可选云存档摘要 |
| `POST` | `/api/player/profile` | `nickname?`（可空字符串清空）、`avatar_id?`（须已解锁） |
| `POST` | `/api/avatar/unlock` | body: `rankLevel`, `clearCount`（累计通关，客户端上报）；服务端按 catalog 发解锁并返回新增 |
| `POST` | `/api/leaderboard/submit` | body: `rankLevel`；更新当日榜与展示快照 |
| `GET` | `/api/leaderboard/daily` | query: `limit`（默认 50）；返回 Top N + 当前 uid 的名次/条目（若有） |
| `POST` | `/api/events` | body: `{ events: [{ type, payload, ts? }] }` 批量埋点 |

**失败降级：** API 不可用时游戏离线可玩；排行榜提示「暂不可用」，**不**回退假 NPC。

**CORS：** 生产同源；本地 Vite 需允许配置的 `VITE_API_BASE` 来源或走 proxy。

## 六、埋点事件

`POST /api/events`，可批量；失败客户端短队列重试（上限条数，满则丢最旧）。

| `type` | 何时 | payload 要点 |
|--------|------|----------------|
| `login` | 进首页 / login 成功 | —（计 DAU） |
| `game_start` | 开局 | `endless`, `mapId` |
| `game_end` | 结算 | `win`, `wave`, `rankLevel`, `heroes[]`, `items[]` |
| `shop_buy` | 商店购买 | `kind`, `itemId`, `costMerit` |
| `equip` | 装备变更 | `slot`, `itemId` |
| `ad_click` / `ad_reward` | 广告 | `scene`（如 `stamina`） |
| `stamina` | 消耗/回复 | `delta`, `remain` |
| `merit` | 消耗/获得 | `delta`, `remain` |
| `fragment` | 碎片变动 | `weaponId`, `delta`, `remain` |

## 七、运营后台（`/admin`）

形态对齐 dubbing：Form/Session 登录、侧栏、日期区间、表格 + Chart.js。

**账号：** config 内 `admin.username` / `admin.password`（部署生成，不进 git）。

**菜单**

| 菜单 | 内容 |
|------|------|
| 用户 | 按 UID 查：昵称/头像/IP/登录/境界/`save_json` 摘要/解锁头像 |
| 数据概览 | 区间：DAU、开局数、结束数、胜负、平均波次、平均/分布境界 |
| 英雄 | 出场次数 / 选用率 |
| 道具 | 购买与装备次数（主动/被动/武器） |
| 广告 | 展示点击与发奖（按 `scene`） |
| 经济 | 体力消耗与剩余（事件均值/合计）、功德消耗与剩余、碎片获取 |
| 排行榜 | 选日查看 Top N（读 `daily_leaderboard`） |

隐私：仅运营账号；IP 仅后台可见。

## 八、客户端行为

### 8.1 UID

- 扩展现有 `user-id.ts`：**缺失时自动生成**合法 8–20 位数字 UID 并 `saveUserId`。
- 设置页仍可展示/复制。

### 8.2 首页头像弹层

- 左上角头像可点 →「设置头像」弹层（横向卷轴选头像 + 确认；可选昵称输入）。
- 锁定：灰显 + 锁标 + 解锁条件文案。
- 确认 → `POST /api/player/profile`。

### 8.3 排行榜

- 替换 `leaderboard.ts` 假数据为 `GET /api/leaderboard/daily`。
- 行：头像 + 昵称或脱敏 UID + 境界；自己高亮。

### 8.4 同步时机

| 时机 | 动作 |
|------|------|
| 首次启动 | 生成 UID → `login` |
| 进首页 | `login` + 拉 `me`；云存档更新则合并进 localStorage |
| 本地存档变更 | 节流 ~30s → `sync` |
| 结算后 | `leaderboard/submit` + `avatar/unlock` + `events` + `sync` |
| 改头像/昵称 | `profile` |
| 广告/商店/体力功德/碎片 | 对应 `events` |

### 8.5 API Base

- 生产：同源 `/api`。
- 本地：`VITE_API_BASE`（可空=同源；或指向 ECS）。

### 8.6 存档合并

- `save_json` 为现有各 key 的结构化快照（至少：stamina、merit、rank、loadout、bag、settings、map、endless、tutorial 相关），带统一 `save_updated_at`。
- 合并策略：整包替换为较新一方（第一期不做字段级 merge，避免半旧半新）。

## 九、头像资源

- 用 Seedream 生成像素风系统头像（文人/武将/妖怪/神仙等），上传 TOS（现有 `tos-upload` 流程）。
- catalog：`id` / 中文名 / `unlock_type`+`value` / CDN URL。
- 排行榜与首页共用同一套 sprite/URL。

## 十、部署与备份

- **服务端源码真源：** 仓库根目录 `server/`（Python）。由该进程同时：
  - 托管静态根目录（ECS 上指向现有 `/opt/xy/html` symlink）；
  - 处理 `/api/*` 与 `/admin/*`。
- 现有 `web/public/server.py` **退役**：避免 API 包被 Vite 打进 `dist` 后可被静态下载；`start.sh deploy` 改为「上传 dist → 同步 `server/` → 重启 systemd」。
- 依赖：**PyMySQL** + 标准库；`server/requirements.txt` + 远端 venv。
- 配置：`server/config.example.yaml`（DSN、admin、静态目录、TOS 备份可选）；ECS 实文件不进 git。
- 数据库初始化：幂等建库建用户建表（参考 dubbing `deploy.sh`）；库名 `xy_game`。
- 每日备份：`mysqldump --single-transaction` → gzip；systemd timer；上传 TOS 私有路径 `backup/mysql/xy_game/YYYY-MM-DD.sql.gz`；保留策略对齐 dubbing（最近 30 天 + 每月 1 号）。

## 十一、明确不做（第一期）

- 微信 `wx.login` / openid 绑定 / 微信头像昵称授权。
- 服务端权威防刷体力、功德、境界。
- Redis / HyperLogLog。
- 多环境 stage/prod 拆分（可先单库 `xy_game`；若需与 dubbing 一样拆 stage，实现计划里再加 `xy_game_stage`）。

## 十二、测试要点

- UID 生成与持久化；login 幂等。
- sync 双向：本地新覆盖云；云新拉回本地。
- profile：未解锁头像拒绝；昵称长度与清空。
- 日榜：同日多次 submit 取最高 `rank_level`；跨日新行。
- events 批量写入与 daily_stats 聚合后后台数字合理。
- API 宕机时开局/结算不阻塞。
- 后台未登录不可访问统计页。

## 十三、文件落点（实现时预期）

| 区域 | 路径（预期） |
|------|----------------|
| HTTP 入口与 API/Admin | `server/`（替代 `web/public/server.py`） |
| 配置 / requirements | `server/config.example.yaml`, `server/requirements.txt` |
| 部署 / 备份 | `server/deploy/`（建库、systemd、backup timer） |
| 头像 catalog（服务端） | `server/avatar_catalog.py` |
| 客户端 API | `web/src/api/` |
| UID / 同步 / 通关计数 | `web/src/user-id.ts`, `web/src/cloud-sync.ts` |
| 头像 catalog（客户端） | `web/src/avatar-catalog.ts`（与服务端字段对齐） |
| 头像 UI | `web/src/menu.ts` / `menu-popups.ts` |
| 排行榜 | `web/src/leaderboard.ts` |
| 头像资源 | TOS + manifest / catalog URL |
| 设计本文 | `docs/superpowers/specs/2026-08-12-player-cloud-sync-admin-design.md` |
