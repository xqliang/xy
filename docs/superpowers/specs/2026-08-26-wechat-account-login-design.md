# 微信账号系统接入（openid 登录 + 会话令牌）设计

日期：2026-08-26  
状态：已确认，待写实现计划  
前置：本设计是 `2026-08-12-player-cloud-sync-admin-design.md` 里明确推迟的「第二期：openid 登录」。

## 一、背景与目标

### 现状（问题）

当前身份是**设备本地的匿名数字 UID**：

- 前端 `web/src/user-id.ts` 的 `ensureUserId()` 随机生成一个 16 位数字，存本地 `dasheng.uid`。
- `web/src/api/client.ts` 的 `apiFetch` 把它当 `X-Uid` 头发出。
- 服务端 `server/httputil.py` 的 `require_uid()` 只认 `X-Uid` 头 / body 里的 `uid`，正则 `^\d{8,20}$`，**完全不做校验**——客户端声称自己是谁就是谁。
- 玩家档 / 云存档 / 日榜 / PvP / 头像解锁**全部以这个数字 uid 为主键**（`players` 等 8 张表）。

两大痛点：

1. **丢档**：uid 是设备本地随机生成，重装 / 清缓存 / 换手机即换号，进度全丢，无跨设备继续。
2. **可伪造**：`X-Uid` 头可随意伪造，排行榜 / PvP 战绩没有可信身份支撑。

### 目标

在**微信小游戏**平台接入标准登录（`wx.login` → `code` → 服务端 `code2session` 换 `openid`），把 openid 作为稳定账号身份，并叠加**服务端会话令牌**，使：

- 微信端跨设备 / 重装不丢档；身份由微信校验，不可伪造。
- 老玩家首次微信登录时，**本机现有匿名进度平滑继承**到微信账号。
- Web 端（无 `wx`）继续可用，行为对用户无感。
- 两条构建 / 发布线（`./start.sh deploy` Web、`./start.sh wx` 小游戏）互不影响。

## 二、核心决策（已与用户确认）

| 议题 | 决策 | 理由 |
|------|------|------|
| openid 落地方式 | **映射表（方案 A）**：openid 单独存表映射到现有数字 uid，uid 体系全不动 | 改动集中在「登录+鉴权」，8 张表零迁移；保住匿名→openid 的干净迁移路径 |
| 验证强度 | **会话令牌（Bearer token）**：登录换 token，各接口校验 token | 用户选「一步到位」；X-Uid 签发后不可伪造 |
| 老玩家进度 | **继承本机匿名进度**：首次微信登录把本机 uid 绑定到 openid | 对现有玩家最友好，不丢档 |
| 昵称 / 头像 | **保持游戏内自设**，登录不拉微信头像昵称 | 微信已把 `getUserInfo` 匿名化，拉到多是「微信用户」+灰头像，收益低且多一次授权弹窗 |
| 上线策略 | **`AUTH_STRICT` 灰度回退**：先「有 token 用 token、无 token 认 X-Uid」，前端全量带 token 后再关回退 | 零停机，对齐 `deploy-zero-downtime` 与 wechat-adaptation 的渐进哲学 |
| Web 端安全 | **接受固有边界**：web 无账号体系，token 只防签发后伪造，不防登录冒领 | 彻底防需给 web 加真账号（手机号/三方），超出本次范围 |

### 为什么不直接用 openid 当 uid（方案 B 已否决）

微信 openid 是 28 位字母数字串（如 `oGZUI0egBJY1zhBYw2KhdUfwVJJE`），与现有 `uid` 的 `^\d{8,20}$`（纯数字、`VARCHAR(20)`）不兼容。直接用 openid 当 uid 需要改 `UID_RE`、所有 `VARCHAR(20)` 列（8 张表要 schema 迁移）、`randomUid()`、`maskUid()` 等一大片，且失去「本机匿名 uid 直接绑到 openid」的迁移便利。映射表把冲击面限制在登录与鉴权两处。

## 三、架构

```
微信小游戏客户端                         Web 浏览器客户端
  wx.login() → code                        (无 wx)
      │                                       │
      └── POST /api/auth/login               └── POST /api/auth/login
          { platform:'wx', code,                 { platform:'web',
            uid: 本机匿名(用于迁移) }                 uid: 本机匿名 }
                     │                                   │
                     ▼                                   ▼
        ┌─────────────────────────── ECS :8082 同一 Python 进程 ───────────────────────────┐
        │  /api/auth/login                                                                  │
        │    wx:  wechat_auth.code2session(appid,secret,code) → openid                      │
        │         wx_identities 查/建映射 → uid（未绑则绑本机匿名 uid 或新建）              │
        │    web: TOFU，直接以自报 uid 建/取账号                                            │
        │    → 复用 handle_login 建档 → 签发 sessions.token → 返回 { token, expiresAt, 档案 }│
        │                                                                                   │
        │  其余 /api/*、WS /api/versus/ws                                                    │
        │    require_auth: Authorization: Bearer <token>（WS 走 ?token=）→ sessions 查 uid  │
        │    （AUTH_STRICT=false 时：无 token 回退认 X-Uid，兼容灰度期）                    │
        │                                                                                   │
        │  MariaDB 库 xy_game                                                               │
        │    既有：players / player_avatars / daily_leaderboard / events / daily_stats /    │
        │          pvp_results / pvp_anomaly                                                │
        │    新增：wx_identities（openid→uid）、sessions（token→uid）                       │
        └───────────────────────────────────────────────────────────────────────────────┘

AppSecret 只在服务端 config.yaml；AppID 填 wechat/project.config.json。
```

## 四、服务端设计

### 4.1 配置（`config.py` / `config.yaml`）

`config.yaml` 新增：

```yaml
wechat:
  appid: "wx..."      # 小游戏 AppID
  secret: "..."       # AppSecret —— 仅服务端持有，绝不进客户端包
auth:
  strict: false       # 灰度开关：false=无 token 回退认 X-Uid；全量后置 true
  session_days: 30    # token 滑动过期天数
```

`config.py` 的 `load_config()` 读入 `data["wechat"]={appid,secret}`、`data["auth"]={strict,session_days}`，均带缺省（`wechat` 空表示未启用微信登录；`auth.strict` 默认 `false`）。支持 `XY_AUTH_STRICT` 环境变量覆盖，便于运维灰度切换。

### 4.2 微信换取 openid（新增 `server/wechat_auth.py`）

- `code2session(cfg, code) -> dict`：用 **stdlib `urllib.request` + `json`**（不引第三方；微信官方 REST 即成熟方案）请求
  `https://api.weixin.qq.com/sns/jscode2session?appid=&secret=&js_code=&grant_type=authorization_code`。
- 返回 `{ openid, session_key, unionid? }`；对错误 `errcode` 抛带码异常：`40029` 无效 code、`45011` 频率限制、`40163` code 已用等，交由 login handler 转成 4xx。
- 网络异常、超时（设 5s）统一转可识别异常。
- 单测通过 monkeypatch 打桩，不打真实微信。

### 4.3 表结构（`db.py` SCHEMA 追加）

```sql
CREATE TABLE IF NOT EXISTS wx_identities (
  openid  VARCHAR(64) NOT NULL PRIMARY KEY,
  unionid VARCHAR(64) NULL,
  uid     VARCHAR(20) NOT NULL,          -- 绑定到内部数字账号
  created_at DATETIME NOT NULL,
  KEY idx_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token   CHAR(64) NOT NULL PRIMARY KEY, -- secrets.token_hex(32)
  uid     VARCHAR(20) NOT NULL,
  platform VARCHAR(8) NOT NULL,          -- 'wx' | 'web'
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,          -- 滑动过期
  KEY idx_uid (uid),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**并发安全**：`wx_identities.openid` 为主键，绑定用 `INSERT ... ON DUPLICATE KEY UPDATE`，保证同一 openid 并发登录只会绑定到一个 uid（不会重复建号）。绑定流程在单事务内完成读-判-写。

### 4.4 登录端点 `POST /api/auth/login`（`api_player.py` 新增 `handle_auth_login`）

body：`{ platform: 'wx'|'web', code?: string, uid?: string }`

流程：

1. `platform=='wx'`：
   - `code2session` → openid（失败 → 401/429，前端回退匿名）。
   - 查 `wx_identities[openid]`：
     - **已绑** → 取其 `uid`。
     - **未绑** → 若 body 带合法本机匿名 uid（老玩家迁移）→ 绑定该 uid；否则生成新 uid（复用 `user-id` 风格的数字 uid 生成，服务端侧实现）。写 `wx_identities`（`ON DUPLICATE KEY` 兜底并发）。
   - 复用现有 `handle_login` 的建档 / 发默认头像逻辑（抽出内部函数 `_login_upsert(db, uid, ip)` 供两处调用，避免重写）。
2. `platform=='web'`：无 code，TOFU——直接以自报 uid（合法性走 `ok_uid`）建 / 取账号。
3. 签发 `sessions` 一行（`token`、`expires_at=now+session_days`），返回：
   `{ token, expiresAt, uid, nickname, avatarId, rankLevel, unlockedAvatars, saveJson, saveUpdatedAt, hasSave }`
   （档案字段与现有 `handle_login` 输出保持一致，前端沿用 `applyServerProfile`）。

### 4.5 鉴权改造（`httputil.py` 新增 `require_auth`）

```
require_auth(handler, body=None) -> uid | None
  1. 取 Authorization: Bearer <token>（WS 场景由调用方传入 query 的 token）
  2. token 命中未过期 sessions → 滑动续期(可选：距上次续期>1天才写) → 返回 uid
  3. token 缺失/失效：
       - AUTH_STRICT=false → 回退调用旧 require_uid（认 X-Uid / body uid），保证灰度期不炸
       - AUTH_STRICT=true  → 401 unauthorized
```

- 保留 `require_uid` 原样（回退用）。
- 各 handler 把 `require_uid(...)` 换成 `require_auth(...)`：`api_player`（me/sync/profile/unlock）、`api_leaderboard`（submit/daily）、`api_events`、`api_versus`（enqueue/poll/cancel/room）。
- `server.py` 路由表新增 `("POST","/api/auth/login"): handle_auth_login`。

### 4.6 WebSocket 握手（`api_versus.py`）

- 现状 `handle_versus_ws` 从 query 取 `uid`（`api_versus.py:754`）。
- 改为优先取 `?token=` → `require_auth` 解析出 uid；`AUTH_STRICT=false` 时 `?uid=` 仍可用（灰度兼容）。
- 后续所有以该 uid 参与撮合 / 快照 / 反作弊的逻辑不变。

## 五、前端设计

### 5.1 平台层（`web/src/platform.ts`）

新增 `wxLogin(): Promise<string | null>`：微信下 `wx.login()` 拿 `code`（Promise 化）；Web / 无 wx 返回 `null`。放在既有 `isWeChat` 守卫体系内，Web 分支零副作用。

### 5.2 认证模块（新增 `web/src/auth.ts`）

- `bootstrapAuth(): Promise<void>` —— 启动时调用一次：
  - 微信：`code = await wxLogin()` → `POST /api/auth/login { platform:'wx', code, uid: loadUserId() }`。
  - Web：`POST /api/auth/login { platform:'web', uid: ensureUserId() }`。
  - 成功：`storeSet('dasheng.token', token)`；若服务端返回的 `uid` 与本机不同（微信命中既有绑定）→ `saveUserId(uid)` 切换本机 uid。
  - 失败（微信 `wx.login` 或网络异常）：记录并**回退匿名**，不阻塞进游戏。
- `getToken(): string | null` —— 供 `apiFetch` / WS 读取。
- `clearToken()` —— 401 时清除（触发下次重登）。

### 5.3 API 客户端（`web/src/api/client.ts`）

`apiFetch` 附加 `Authorization: Bearer <token>`（`getToken()` 有值时）；**保留 `X-Uid`** 作为灰度期回退，与服务端 `AUTH_STRICT` 对应。收到 401 时 `clearToken()`。

### 5.4 PvP WebSocket（`web/src/pvp-ws.ts`）

WS URL（`pvp-ws.ts:316`）追加 `&token=<token>`；`uid` 参数灰度期保留兼容。

### 5.5 启动接线（`web/src/main.ts`）

在现有 `cloudLogin()` 之前 `await bootstrapAuth()`，确保后续云同步 / 提交 / PvP 都带上 token。整体不改变现有启动屏 / 加载流程顺序。

## 六、平台共存

| | Web（ecs:8082） | 微信小游戏 |
|---|---|---|
| 登录入参 | `{platform:'web', uid}` | `{platform:'wx', code, uid}` |
| 身份可信度 | TOFU 匿名 | openid 微信校验 |
| token | 有（防签发后伪造） | 有（绑真身份） |
| 构建 / 发布 | `./start.sh deploy` | `./start.sh wx` + 工具上传 |
| 配置 | 无需 wechat 段 | AppID→project.config.json；AppSecret→服务端 |

## 七、安全边界（诚实说明）

- **微信端**：openid 由微信服务器校验，token 绑定真实身份 → 排行榜 / PvP 反作弊**有实际意义**。
- **Web 端**：浏览器无账号体系，`/api/auth/login` 时 uid 仍是**客户端自报**，token 只能防**签发之后**的 header 伪造，**不能防登录时冒领他人 uid**。这是 web 平台固有边界；要彻底防需引入真账号（手机号 / 第三方登录），**本次不做**。
- **AppSecret**：仅存服务端 `config.yaml`，绝不进任何客户端包（微信构建 `vite.wx.config.ts` 不注入）。

## 八、测试与门禁

- `server/tests/test_auth.py`（3308 一次性 MariaDB，见内存 `versus-server-test-db`）：
  - monkeypatch `code2session`：成功返回 openid / 各 `errcode` 分支。
  - 首次绑定继承本机 uid；已绑 openid 复用旧 uid。
  - **并发**同 openid 登录只绑一个 uid（`ON DUPLICATE KEY` 验证）。
  - token 校验 / 过期 / 滑动续期。
  - `AUTH_STRICT` true/false 两态：无 token 时分别 401 / 回退 X-Uid。
- `web/tests/auth.test.ts`（放 `web/tests/`，见内存 `web-vitest-test-location`）：
  - `bootstrapAuth` 的 wx / web 分支；`wx.login` 失败回退匿名。
  - token 存取；迁移时 `saveUserId` 切换；`apiFetch` 带 `Authorization` 头。
- **门禁**：改了 PvP WS 握手 → 提交前跑 **ai-balance**（内存 `ai-balance-gate-for-gameplay`）；`web` typecheck 看「不新增」既有报错（内存 `web-typecheck-baseline-dirty`）；`vitest` 在 `web/` 跑。
- **人工**：真机 `code2session` 需真实 AppID + AppSecret，本环境无法自动化（对齐 `wechat-adaptation.md`）——在微信开发者工具「不校验合法域名」下联调，上线用 https 备案域名。

## 九、改动文件清单

**新增**
- `server/wechat_auth.py` —— code2session。
- `server/tests/test_auth.py`
- `web/src/auth.ts` —— bootstrapAuth / getToken。
- `web/tests/auth.test.ts`

**修改**
- 服务端：`config.py`、`config.yaml`、`db.py`（两表）、`httputil.py`（`require_auth`）、`server.py`（路由 + 各 handler 换鉴权）、`api_player.py`（抽 `_login_upsert` + `handle_auth_login`）、`api_versus.py`（WS token）、`api_events.py`、`api_leaderboard.py`。
- 前端：`platform.ts`（`wxLogin`）、`api/client.ts`（Authorization）、`pvp-ws.ts`（`&token=`）、`main.ts`（`bootstrapAuth` 接线）。

## 十、落地顺序（每步保持两端可跑，可灰度）

1. 服务端：`config`+`wechat_auth`+两表 schema+`require_auth`（`AUTH_STRICT=false`）+`/api/auth/login`+各 handler 换鉴权+WS token。旧客户端因回退不受影响。
2. 服务端单测（含并发 / 灰度两态）通过。
3. 前端：`wxLogin`+`auth.ts`+`apiFetch`/WS 带 token+`main.ts` 接线；前端单测通过；typecheck 不新增。
4. ai-balance 门禁通过 → 部署 Web、构建小游戏。
5. 人工：填真实 AppID/Secret，微信开发者工具联调 `wx.login` 全链路。
6. 前端全量带 token 稳定后，运维把 `AUTH_STRICT` 置 `true`，关闭 X-Uid 回退。

## 十一、风险与边界

- 真机 `code2session` / 微信登录无法在本仓库 CI 自动验证，需人工（第 5 步）。
- Web 端匿名冒领边界见第七节，已接受。
- `session_key` 本期仅用于换取 openid，不做 `wx.getUserInfo` 解密（不拉昵称头像）；如未来要拉，再在 `wx_identities` 扩列。
- 老玩家迁移是「本机匿名 uid → openid」一次性绑定；若用户先在 A 机登录微信（绑了 A 的匿名档），再到 B 机登录，B 机会命中既有绑定、切到 A 的账号（B 本地匿名档不自动并档——符合「以微信账号为准」的直觉，且第七节云存档冲突取较新方兜底）。
