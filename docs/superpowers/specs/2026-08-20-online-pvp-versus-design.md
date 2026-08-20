# 在线真人对战（PvP Versus）设计

日期：2026-08-20
状态：待用户过目 → 进实现计划
分支/worktree：`online-pvp-versus`（基于 `b0bc6df`）

## 一、目标

在现有「合成 + 对称塔防」单人对局（下半场玩家 vs 上半场本地 AI 对手）之上，增加**在线真人 1v1 对战**：

1. **首页两个入口**：`真人对战`（随机/同级匹配）、`邀请好友`（分享链接私房对战）。
2. **真人对局**：把上半场的本地 AI 对手**替换成远端真人**；本方仍在下、对方在上。
3. **服务端权威调度**：下发随机种子 + 武器掉落表 + 各波开始时间；客户端凭「种子 + 掉落表 + 服务端时间」在本地推进自己半场，算自己的攻击与怪物伤害。
4. **反作弊**：服务端比对双方每 2s 上报的棋盘数据做启发式异常检测；当天有 ≥3 个**不同对手**的对局判定该用户异常 → 通知本人并**当天禁止真人匹配**。
5. **心跳与断线**：2s 心跳；对手断开 >6s 或认输，本方可判赢，并看到胜负原因（对手唐僧被吃 / 断线超时 / 认输）。
6. **等待与失败**：随机匹配或等好友都有 **2 分钟倒计时**，超时无人连上 → 提示失败 → 确认回首页。

复用现有 Python 静态站同进程 `/api`（`server/`），前端复用现有 Canvas 渲染与战斗引擎，仅做**最小侵入**改造。

## 二、核心决策（已与用户确认）

| 议题 | 决策 |
|------|------|
| 反作弊判定 | **服务端自动检测**（比对双方 2s 上报数据的启发式上界/一致性校验）；按**不同对手 uid 去重**计数，当天 ≥3 → 通知 + 当天禁匹配 |
| 配装 | **各自带自己的养成配装**（装备/神兵/功德加成/主被动道具），与现有开局一致 |
| 体力 | 入口需 **≥5** 才能进匹配 / 发起好友对战；**两人都连上真正开打才扣**，匹配失败 / 超时不扣 |
| 结算 / 奖励 | **独立 PvP 战绩**（胜/负记录），**不动**现有境界阶梯与功德，避免污染单人平衡（有 ai-balance 门禁） |
| 每波怪物血量 | **各算各的**：两人各用现有单人逻辑、按**各自实际战力**算自己这一波总血量（波次给下限），互不影响；**不缩放** |
| 下一波开始时间 | 由**先清波次的一方**触发，服务端下发给双方（见 §5.3） |
| 布局 | 本方在下、对手在上（沿用现有布局，仅把上半场数据源从本地 AI 换成网络快照） |
| 暂停区 | 匹配中 → **退出匹配**；对局中 → **认输** |
| 传输 | **HTTP 轮询**（2s 双向 tick + 匹配轮询），**不引入 WebSocket**（见 §3.2） |
| 同步模型 | **各端对自己半场权威 + 服务端调度/裁决 + 启发式反作弊**，**不做**逐帧确定性锁步 / 服务端重放（见 §3.1） |
| 平台 | **只做 Web**；微信端沿用既有二期延后策略 |

### 待过目确认的默认（可调）

- **地图**：一局双方同图。随机匹配 → 服务端随机选图；邀请 → 用**发起方**当前选的图。（写在 match-start 下发）
- **体力消耗量**：沿用普通开局 **5 点**，开打时双方各扣。
- **同时阵亡**：极少见；服务端按终局事件到达先后裁决，真正同刻 → **平局**（结算显示"平局"）。

## 三、架构

```
玩家A 浏览器 (Web)                         玩家B 浏览器 (Web)
  ├─ 本地权威模拟「自己」半场                  ├─ 本地权威模拟「自己」半场
  │   (现有 Battle 下半场逻辑不变)              │
  ├─ 对手半场 = 服务端转发的 2s 快照(展示层)     ├─ 对手半场 = A 的 2s 快照(展示层)
  └─ 每2s POST /api/versus/tick ──┐    ┌── 每2s POST /api/versus/tick
                                  ▼    ▼
                    ECS :8082 同一 Python 进程 (server/)
                    ├─ 进程内匹配/房间/对局状态（加锁，重启即丢）
                    │    · 匹配队列(按段位分桶) + 5min 滚动入队窗口
                    │    · 邀请房间(code→room) · 活跃对局(matchId→state)
                    ├─ 权威调度：种子 / 武器掉落表 / 各波开始时间 / 终局裁决
                    ├─ 转发：把各方棋盘快照转给对手
                    └─ 反作弊：对 2s 快照做启发式校验 → 异常入库
                         └─ MariaDB 库 `xy_game`
                              ├─ pvp_results   (独立战绩，持久)
                              └─ pvp_anomaly   (异常记录 → 当日禁赛计算)
```

### 3.1 为什么不做「确定性锁步 / 服务端重放」

引擎排查结论（`web/src/battle.ts` / `autoplace.ts` / `rng.ts`）：

- 战斗 sim 本身**确定**：仅通过 3 个种子 RNG 消费随机（`this.rng` `battle.ts:1799`、`this.aiRng` `:1800`、`this.bossScheduleRng` `:1804`，均 mulberry32），**无** `Math.random`/`Date.now`/`new Date`。
- **但**两点破坏跨端逐帧一致：① 步进用**可变 dt**（跟帧率走，`main.ts:1825-1835`，clamp 0.05）；② `planAutoPlaceSteps` 布阵用 `performance.now()` 卡时限（`autoplace.ts:1298-1301`、`battle.ts:5267/6974`），布阵步数随机器速度变。
- 且**服务端是 Python，跑不了这套 TS 引擎**，无法服务端重放校验。

→ 因此采用：**每端只权威模拟自己半场**（可变 dt / autoplace 时限只影响本方自己的棋盘，无公平性问题）；对手半场是**展示层**（2s 快照）；服务端做**启发式**反作弊（上界/一致性，不重放）。这也正是已确认的「各算各的 + 服务端调度」模型。

### 3.2 为什么用 HTTP 轮询而非 WebSocket

现有服务端是标准库 `http.server`（`server.py:118` `ThreadingHTTPServer`，同步、线程/请求、无长连接）。本模型不需要低延迟（对手半场 2s 展示即可、波次间有天然间隔），且用户要求 2s 心跳 → **一个 2s 的双向 tick 同时承担心跳 + 上报 + 拉取**最自然，避免给部署引入 WS 进程/依赖。事件（清波/认输/断线/终局）允许**即时补发 tick**降低耦合延迟。

### 3.3 权威划分

| 数据 | 权威 | 说明 |
|------|------|------|
| 本方棋盘（兵/武将/怪物/唐僧血/经济/攻击/伤害） | **客户端（本方）** | 现有逻辑本地推进，服务端不重放 |
| 随机种子 / 武器掉落表 / 各波开始时间 | **服务端** | match-start 下发 + tick 下发下一波 |
| 对手半场展示数据 | **服务端转发** | 对手上报，服务端中转，本地仅渲染 |
| 终局与原因（谁赢/为何） | **服务端裁决** | 避免双方各自判赢 |
| 反作弊异常 / 当日禁赛 | **服务端** | 启发式检测 + 入库 + 计数 |
| PvP 战绩 | **服务端** | 独立记录，不影响境界 |

## 四、匹配、邀请与倒计时

### 4.1 随机 / 同级匹配（自适应窗口）

段位 = `rank_level`（复用现有境界，见 `web/src/rank.ts` 与服务端 `players.rank_level`）。

1. 入队即先看**当前是否已有同级玩家在等** → 有则**立即**配对。
2. 无同级在等时，算**同级保持窗口 W**：统计**最近 5 分钟**在该 `rank_level` 入过队的**不同玩家数 N**（进程内 5min 滚动窗口，按段位分桶）。
   - `W = clamp(3 + 12 × min(N,5)/5, 3s, 15s)`（N=0→3s、N≈2→~7.8s、N≥5→15s；常量可调）。
3. W 内只配同级；期间有同级进来立即配。
4. **W 到点仍无同级 → 放宽到任意段位**（即"否则随机"）。
5. 全程受 **2 分钟总倒计时**兜底：真的全场无人 → 超时失败 → 确认回首页。

### 4.2 邀请好友（私房）

1. `真人对战`旁点`邀请好友` → `POST /api/versus/room/create {map}` → 返回 `{code, link}`。
2. 分享链接 `<站点>/xy/?versus=<code>`（复用 `user-id.ts` 的剪贴板逻辑复制）。
3. 好友打开带 `?versus=` 的链接 → 客户端识别 → `POST /api/versus/room/join {code}` → 房间有效且未满 → 双方成局。
4. 发起方在等待页显示链接 + 2 分钟倒计时；好友连上即开打（双方各扣体力）；超时 → 失败 → 回首页。
5. 邀请对局**不做段位匹配**（好友随意约），波次仍**各算各的**。

### 4.3 匹配 / 等待界面（新 screen `pvpMatching`）

- 搜索动画（悟空/旋转）+ **2 分钟倒计时环** + `退出匹配` 按钮。
- 邀请模式额外显示：可复制的分享链接 + `已复制` 反馈。
- 配对成功 → 简短「已匹配到对手 · 头像昵称」提示 → 切 `battle`（PvP 标记）。
- 超时：提示「未匹配到对手」+ `确认`（回首页，不扣体力）。

## 五、对局同步模型

### 5.1 match-start 下发（配对成功时）

```jsonc
{
  "matchId": "…",
  "seed": 123456,                 // 随机种子（客户端本方 RNG 用）
  "map": "huoyanshan",            // 双方同图（见 §2 默认）
  "startAtServerMs": 1690000000000, // 第 1 波开始的服务端时刻
  "weaponDropSchedule": [         // 武器落子：按波次 key，服务端由 seed 派生
    { "wave": 3, "weaponId": "…", "cell": "r2c4" }, …
  ],
  "opponent": { "uid": "***4821", "nickname": "…", "avatarId": "wukong", "rankLevel": 3 }
}
```

- 「随机种子 + 武器落子的位置 + 开始时间」= `seed` + `weaponDropSchedule` + `startAtServerMs`，对应用户原话。
- 客户端本方开局注入自己的养成配装（`metaBonuses`/`weaponBonuses(bag)`/`loadout.equipped`/`loadout.passives`，同 `newGame()` `main.ts:790`），但 **seed 用服务端的**（不再 `nextSeed()` 走 `Math.random`），**关掉本地 AI**（`updateAi` no-op），**关掉 rubber-band / ai-skill**（PvP 无 AI）。

### 5.2 2s tick 协议（`POST /api/versus/tick`）

请求（每 2s，或清波/认输/阵亡等事件即时补发）：

```jsonc
{
  "matchId": "…", "clientMs": …,   // clientMs 用于时钟对齐
  "wave": 7, "power": 812, "kills": 143, "tangsengHP": 3, "peach": 22,
  "waveClearedAt": { "wave": 7 } | null,   // 本方刚清完某波
  "status": "playing" | "tangsengDead" | "surrender",
  "board": { /* 供对手渲染的本方快照，见 §5.4 */ }
}
```

响应：

```jsonc
{
  "serverMs": …,                              // 时钟对齐
  "nextWave": { "wave": 8, "startAtServerMs": … } | null,  // 先清者触发（§5.3）
  "opponent": { "board": {…}, "wave": 6, "power": 640, "tangsengHP": 3 } | null,
  "opponentStatus": "playing" | "disconnected" | "surrendered" | "tangsengDead",
  "result": null | { "outcome": "win"|"lose"|"draw",
                     "reason": "opponentTangsengDead"|"opponentSurrender"|"opponentDisconnectTimeout"
                             | "selfTangsengDead"|"selfSurrender"|"draw" },
  "cheatNotice": null | { "banned": true, "msg": "检测到异常，今日暂停真人匹配" }
}
```

### 5.3 波次开始时间（"先清者定节奏"）

- 客户端本方清空当前波怪物（现有判定只看本方怪物 `battle.ts:6700-6706`）→ 下个 tick 带 `waveClearedAt {wave:N}`（清波即时补发 tick，降低延迟）。
- 服务端记录该 match 下 wave N 的**首个清波者**时刻 `firstClearMs`，令 `nextWave = { wave:N+1, startAtServerMs: firstClearMs + INTER_WAVE_DELAY_MS }`，在两端 tick 响应中下发。
- 两端在本地时钟（对齐服务端）到达 `startAtServerMs` 时 spawn 第 N+1 波。**若本方还没清完第 N 波**，新波叠加（落后即被压制——即用户要的节奏机制）。
- `INTER_WAVE_DELAY_MS` 给出的缓冲天然吸收 1–2s 上报延迟。

### 5.4 供渲染的对手快照 `board`

紧凑编码（约 1–2KB，2s 一次可接受）：

- `units`: `[{cell, type, tier}]`（棋盘格上静态，2s 足够）
- `words` / `activeGenerals`: 激活武将展示
- `monsters`: `[{dist, hpFrac, type}]`（沿路径进度，客户端插值渲染）
- `tangsengHP`、`pickedItems`（对手道具，供 `drawAiItemsHud` 展示）
- `nickname`/`avatarId`/`rankLevel`（对手信息条）

客户端把这些填进现有 `ai*` 字段（`aiUnits`/`aiWords`/`aiMonsters`/`aiTangsengHP`/`aiPickedItems` 等，`battle.ts:1656-1720`），**`drawAiSide()`（`render.ts:9072-9116`）与 `drawAiItemsHud()`（`render.ts:9435`）几乎不用改**——只是数据源从本地 AI 换成网络快照，两 tick 间对怪物做位置插值。

### 5.5 时钟对齐

客户端用 tick 的 `clientMs`/`serverMs` + RTT 估算 offset（`serverOffset ≈ serverMs − (sendMs + rtt/2)`），把服务端时刻换成本地时刻用于 spawn 波次。波次是**墙钟目标时刻**，与 sim 的可变 dt 步进解耦。

## 六、战斗引擎改动（`web/src/battle.ts`，最小侵入）

单 Battle 实例双棋盘不变，仅在 **PvP 模式**下切换对手侧的驱动与耦合来源。

| 位置 | 现状 | PvP 改动 |
|------|------|---------|
| 构造 `battle.ts:1775-1824` | 生成本地 AI（`aiRng`/`mirrorPath`/`rollAiLoadout`/rubber-band） | 新增 `pvp?: {opponent, applyStartPayload}`；PvP 时**跳过** AI loadout/技能生成，seed 用服务端下发 |
| `updateAi(dt)` `battle.ts:5241-5347` | 本地 AI 征兵/布阵/战斗/推怪 | PvP 时 **no-op**；改由 `applyOpponentSnapshot(board)` 填充 `ai*` 展示字段 |
| 波次推进 `battle.ts:6633-6706` / `startNextWave` | 本方清波 → 本地 `nextWaveTimer` 倒计时自动开下一波 | PvP 时下一波 spawn 时刻改由**服务端 `nextWave.startAtServerMs`**（本地时钟对齐）触发；清波上报服务端 |
| 波次血量 `computeWavePressure`/`estimateOptimalPower` `battle.ts:4891-4954` | 只按本方战力算 | **不变**（正好=各算各的） |
| 武器掉落（局内神兵） | 本地 rng 掉落 | PvP 时按 `weaponDropSchedule`（按波次）落子，服务端权威 |
| 胜负 `checkOpponentDefeated` `battle.ts:5350-5360` | 看本地 `aiDefeated` | PvP 时 `aiDefeated`/终局由**服务端 `result`** 置位；本方 `tangsengHP→0` 仍本地判负并上报 |

> 新增薄封装 `web/src/pvp-battle.ts` 持有网络状态机与「Battle ↔ tick」桥接，避免把网络逻辑塞进 7000 行的 `battle.ts`。

## 七、反作弊（服务端启发式）

对每个 tick、每用户、每 match 校验（阈值留余量、可调）：

- **唐僧血**单调不增；总掉血与"漏怪"上报一致。
- **击杀增量**上界：区间击杀数 ≤ f(上报战力) × 时长 × 余量（防"秒清"）。
- **战力增长**上界：战力跃升需经济支撑（桃 = 击杀 + 波次奖励为上界），无来由暴涨 → 异常。
- **波次进度**与服务端下发的波次调度一致（不能服务端还在第 5 波、客户端已第 20 波）。
- **心跳节律**：tick 缺失单独归到断线（§8），非作弊。

判定与计数：

- 某 match 中该用户触发任一硬阈值 → 记一条 `pvp_anomaly`（`day, uid, opponent_uid, match_id, reasons_json`）。同一 match/对手当天去重（一个对手最多贡献 1 次）。
- **当日禁赛计算**（同 `events` 聚合风格，按需实时查）：`SELECT COUNT(DISTINCT opponent_uid) FROM pvp_anomaly WHERE day=今日 AND uid=U` ≥ 3 → 该用户当天：
  - `enqueue`/`room/create`/`room/join` 一律拒绝（返回 `banned` + 文案）；
  - 通过 tick 的 `cheatNotice` 或 `/api/player/me` 字段**通知本人**。

## 八、心跳、断线与重连

- **心跳 = 2s tick**。服务端记录每方 `lastTickAt`。
- 某方 tick 缺失 **>6s** → 服务端标记 `disconnected`，对手 tick 响应 `opponentStatus:"disconnected"`（UI 提示"对手连接中断…"）。
- 持续断开超过 **6s 宽限**仍未恢复 → 服务端裁决对手 `result: win / opponentDisconnectTimeout`；断线方回来后收到 `lose / self... `（或客户端本地检测到裂口显示"断线判负"）。
- 断线方 **<6s 回来**：本地 sim 一直在跑，仅补上心跳即续。
- **切后台**：Web 隐藏标签会被浏览器节流、rAF 暂停 → sim 暂停且心跳中断，超 6s 按断线判负（离开即判负，合理）。用 `visibilitychange`（`main.ts:1981-1986`）尽力续跳并提示。

## 九、客户端改动

### 9.1 网络层 / 状态机（新增）

- `web/src/api/pvp-client.ts`：复用 `apiFetch`（`api/client.ts`）封装 enqueue/poll/room/tick，含**轮询定时器、超时、时钟对齐、断线检测**。
- `web/src/pvp-match.ts`：状态机 `idle → queuing/inviting → matched → inBattle → settled`，管理 2 分钟倒计时、退出匹配、把 tick 数据桥接给 Battle。

### 9.2 首页入口（`menu.ts` / `main.ts`）

- `menuButtons()`（`menu.ts:126-139`）加 `pvpMatch` / `pvpInvite` 两个按钮（复用 `drawInkActionButton` accent/secondary，置于 START/无尽附近）。
- `drawMenu()` 按钮循环（`menu.ts:329-345`）追加绘制。
- `handleMenu()`（`main.ts:852-911`）加分支：体力 <5 → `menuToast('体力不足')` 不进入；被禁赛 → 提示今日暂停；否则进 `pvpMatching`。

### 9.3 对局 UI

- 新 screen `'pvpMatching'`（§4.3 等待/倒计时/退出/分享链接）。
- 战场沿用现布局；对手信息条复用 `profile-popup` 的 `drawAvatarCell` / `leaderboard` 的 `drawEntryRow` 视觉；对手道具复用 `drawAiItemsHud`。
- **暂停弹窗**（`pause-popup.ts`）加 `context: 'match'|'battle'`：匹配中→`退出匹配`/`确认退出匹配`；对局中→`认输`/`确认认输`。命中类型复用 `continue/quit/confirmQuit/cancelQuit`，仅换文案与语义（`main.ts:1434-1462` 分支相应处理：退出匹配=取消排队回首页；认输=上报 surrender 判负）。
- **结算**（`settle.ts` + `main.ts:1904-1956`）PvP 分支：不加减星、不触发神秘商人；展示`胜/负/平局` + 原因文案（对手唐僧被吃/对手认输/对手断线超时/我方唐僧被吃/我方认输/平局）+ 对手头像昵称；上报 `pvp_result`；按钮`返回首页`。

## 十、服务端改动（`server/`）

### 10.1 新增路由（`server.py:78-87` routes 追加）

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/versus/enqueue` | 入队随机/同级匹配（校验体力≥5、非禁赛）；返回 ticket |
| POST | `/api/versus/poll` | 轮询匹配状态：waiting / matched(+match-start) / timeout |
| POST | `/api/versus/cancel` | 退出匹配队列 |
| POST | `/api/versus/room/create` | 建私房，返回 code + link |
| POST | `/api/versus/room/join` | 用 code 加入私房 → 成局 |
| POST | `/api/versus/tick` | 2s 双向：上报快照/心跳 → 返回对手快照/下一波/终局/禁赛通知 |
| POST | `/api/versus/result` | （可选，或并入 tick 终局）落 `pvp_results` |

新文件建议：`server/api_versus.py`（匹配/房间/对局状态机 + 反作弊），进程内单例状态（加锁）。

### 10.2 进程内状态（单进程、`threading.Lock`，重启即丢）

- 匹配队列：按 `rank_level` 分桶的等待项 `{uid, rank, enqueuedAt, mapPref, ticket}`。
- 5min 滚动入队日志：按段位存时间戳列表（算自适应 W 的 N）。
- 邀请房间：`code → {hostUid, hostRank, map, createdAt, joinerUid?}`。
- 活跃对局：`matchId → {a, b, seed, map, startAt, weaponSchedule, 每方{lastTickAt,lastSnapshot,wave,clears,status}, waveSchedule}`。
- 匹配线程/惰性撮合：enqueue/poll 时尝试配对（同级即时 → 自适应窗口 → 放宽）。

### 10.3 数据模型（MariaDB `xy_game`，`db.py` SCHEMA 追加）

```sql
CREATE TABLE IF NOT EXISTS pvp_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  match_id VARCHAR(40) NOT NULL,
  day CHAR(10) NOT NULL,
  uid VARCHAR(20) NOT NULL,
  opponent_uid VARCHAR(20) NOT NULL,
  outcome ENUM('win','lose','draw') NOT NULL,
  reason VARCHAR(32) NOT NULL,
  wave INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  KEY idx_uid_day (uid, day), KEY idx_match (match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pvp_anomaly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  day CHAR(10) NOT NULL,
  uid VARCHAR(20) NOT NULL,
  opponent_uid VARCHAR(20) NOT NULL,
  match_id VARCHAR(40) NOT NULL,
  reasons_json MEDIUMTEXT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uniq_day_uid_opp (day, uid, opponent_uid),  -- 一个对手当天最多计 1
  KEY idx_uid_day (uid, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- PvP 战绩 W/L 从 `pvp_results` 聚合（后台/个人页可展示，本期先落库）。
- 当日禁赛：实时 `COUNT(DISTINCT opponent_uid)` ≥ 3（不建单独禁赛表）。

## 十一、部署与运维

- 复用现有 `xy-web.service` 单进程；PvP 状态**进程内**（重启即丢活跃对局，可接受——临时对局）；`pvp_results`/`pvp_anomaly` 持久。
- **无新依赖**（仍 PyMySQL + 标准库）；`db.migrate()` 幂等建新表。
- 生产同源 `/api`；本地 Vite 已代理（`vite.config.ts:17-19`）。
- 邀请链接前缀走反代 `peiyin.seealso.cn/xy`，客户端读 `?versus=`（与既有 `?seed=`/`?map=` 同机制，`main.ts:190`）。

## 十二、明确不做（本期 YAGNI）

- WebSocket / SSE / 长连接（2s 轮询足够）。
- 逐帧确定性锁步 / 服务端重放校验（引擎不满足、Python 跑不了 TS）。
- 微信端 PvP（沿用二期延后）。
- PvP 独立段位/天梯/赛季/匹配 MMR（本期只做胜负记录 + 段位分桶匹配）。
- 手动举报作弊按钮（本期只服务端自动检测）。
- 观战 / 回放 / 多人（>2）。
- 跨进程/多实例的匹配（现单进程；将来水平扩展再引入 Redis/共享态）。

## 十三、测试要点

- **匹配**：同级即时配；无同级时 W 随 N（5min 窗口）在 3–15s 间变化；W 到点放宽任意；2min 超时失败且不扣体力。
- **邀请**：create→link→join 成局；超时失败回首页；非法/已满 code 拒绝。
- **体力**：<5 无法进入；开打才扣；失败/超时不扣。
- **同步**：seed/武器表/开始时间下发后两端本地推进；先清者触发的 `nextWave` 两端一致 spawn；时钟对齐误差容忍。
- **心跳/断线**：>6s 断开 → 对手判赢(断线超时)；<6s 回来续；认输 → 对手判赢(认输)；唐僧被吃 → 对手判赢(唐僧被吃)；同刻 → 平局。
- **反作弊**：构造超上界击杀/战力暴涨/波次穿越 → 记 `pvp_anomaly`；同对手当天去重；≥3 不同对手 → 禁赛 + 通知；禁赛期 enqueue/room 被拒。
- **降级**：`/api/versus/*` 不可用时匹配失败有提示、不卡死单人玩法。
- **回归**：单人对局（打本地 AI）完全不受影响（PvP 为独立分支/标记）；`ai-balance` 门禁与既有 vitest 全过。

## 十四、文件落点（预期）

| 区域 | 路径 |
|------|------|
| 服务端匹配/房间/对局/反作弊 | `server/api_versus.py`（新） |
| 路由注册 | `server/server.py`（追加 routes） |
| 新表 | `server/db.py`（SCHEMA 追加 `pvp_results`/`pvp_anomaly`） |
| 客户端 PvP 网络 | `web/src/api/pvp-client.ts`（新） |
| 客户端 PvP 状态机/桥接 | `web/src/pvp-match.ts`、`web/src/pvp-battle.ts`（新） |
| 战斗引擎 PvP 分支 | `web/src/battle.ts`（构造/`updateAi`/波次推进/胜负/武器掉落 加 PvP 分支） |
| 首页入口 | `web/src/menu.ts`、`web/src/main.ts`（`handleMenu`） |
| 匹配/等待界面 | `web/src/main.ts`（新 screen `pvpMatching`）+ 渲染 |
| 暂停弹窗 | `web/src/pause-popup.ts`（加 `context`） |
| 结算 PvP 分支 | `web/src/settle.ts`、`web/src/main.ts` |
| 对手信息展示 | 复用 `profile-popup.ts`/`leaderboard.ts` 视觉、`render.ts` `drawAiSide`/`drawAiItemsHud` |
| 设计本文 | `docs/superpowers/specs/2026-08-20-online-pvp-versus-design.md` |
