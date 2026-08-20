# 在线真人对战（PvP Versus）设计

日期：2026-08-20
状态：已与用户确认核心决策 → 进实现计划
分支/worktree：`online-pvp-versus`（基于 `b0bc6df`）

## 一、目标

在现有「合成 + 对称塔防」单人对局（下半场玩家 vs 上半场本地 AI 对手）之上，增加**在线真人 1v1 对战**：

1. **首页两个入口**：`真人对战`（随机/同级匹配）、`邀请好友`（分享链接私房对战）。
2. **真人对局**：把上半场的本地 AI 对手**替换成远端真人**；本方仍在下、对方在上。
3. **确定性输入回放**：服务端下发随机种子 + 各波开始时间 + 转发双方的**放置动作（武器/英雄落到哪个格）**；两端凭「种子 + 放置动作 + 服务端时间」在本地**确定性地模拟出自己与对手两侧**，算出各自的攻击与怪物伤害。
4. **反作弊**：服务端校验放置动作合法性 + 比对双方每 1s 上报的棋盘摘要（各端用确定性重放交叉核对）；当天有 ≥3 个**不同对手**判定该用户异常 → 通知本人并**当天禁止真人匹配**。
5. **心跳与断线**：1s 心跳（放置动作即时补发）；对手断开 >6s 或认输，本方可判赢，并看到胜负原因（对手唐僧被吃 / 断线超时 / 认输）。
6. **等待与失败**：随机匹配或等好友都有 **2 分钟倒计时**，超时无人连上 → 提示失败 → 确认回首页。

复用现有 Python 静态站同进程 `/api`（`server/`），前端复用现有 Canvas 渲染与战斗引擎，做**受控**改造（新增 PvP 固定步长循环与输入回放）。

## 二、核心决策（已与用户确认）

| 议题 | 决策 |
|------|------|
| 同步模型 | **输入回放（Model B）**：服务端转发双方"放置动作"，两端**固定步长确定性模拟**双方半场；对手半场是本地重放（**延迟<1s**，画面顺滑）；1s 棋盘摘要用于反作弊交叉核对 |
| 权威耦合 | **波次开始时间、终局胜负全走服务端实时消息**，与"展示用的延迟重放"解耦——重放漂移只影响观感、不影响胜负 |
| 反作弊 | **服务端自动检测**：校验放置动作合法性(经济/格子/时机) + 端上重放对手与其自报摘要容差比对；按**不同对手 uid 去重**计数，当天 ≥3 → 通知 + 当天禁匹配 |
| 配装 | **各自带自己的养成配装**（装备/神兵/功德加成/主被动道具），与现有开局一致 |
| 体力 | 入口需 **≥5**；**两人都连上真正开打才扣**（各扣 **5**），匹配失败/超时不扣 |
| 结算/奖励 | **独立 PvP 战绩**（胜/负记录），**不动**现有境界与功德（避免污染单人平衡，有 ai-balance 门禁） |
| 每波怪物血量 | **各算各的**：两人各按**各自实际战力**用现有单人逻辑算自己这一波总血量（波次给下限），互不影响；**不缩放**（重放对手侧时用对手的战力，天然成立） |
| 下一波开始时间 | 由**先清波次的一方**触发（真实清波时刻走服务端），服务端下发给双方 |
| 布局 | 本方在下、对手在上（沿用现布局，把上半场从"本地 AI 决策"换成"重放对手放置动作"） |
| 暂停区 | 匹配中 → **退出匹配**；对局中 → **认输** |
| 传输 | **HTTP 轮询**（**1s** 双向 tick + 放置动作即时补发 + 匹配轮询），**不引入 WebSocket** |
| 平台 | **只做 Web**；微信端沿用既有二期延后策略 |
| 地图 | 一局双方同图：随机匹配→服务端随机选图；邀请→发起方当前选的图 |
| 同时阵亡 | 极少见；服务端按终局事件到达先后裁决，真正同刻→**平局** |

## 三、架构

```
玩家A 浏览器 (Web)                         玩家B 浏览器 (Web)
  ├─ 固定步长(1/30)确定性模拟「A 半场」(实时) ├─ 固定步长确定性模拟「B 半场」(实时)
  ├─ 重放「B 半场」= 喂 B 转发来的放置动作     ├─ 重放「A 半场」= 喂 A 转发来的放置动作
  │   (确定性、延迟<1s，仅供展示与反作弊)      │
  └─ 每1s(放置动作即时补发) POST /api/versus/tick ─┐ ┌─ 每1s POST /api/versus/tick
        · 上报我方放置动作(带 simTick)+棋盘摘要 ▼ ▼   · 同左
        · 收对手放置动作 + 下一波开始 + 终局      │
                    ECS :8082 同一 Python 进程 (server/)
                    ├─ 进程内匹配/房间/对局状态（加锁，重启即丢）
                    ├─ 权威调度：种子 / 各波开始时间 / 终局裁决
                    ├─ 转发：把各方"放置动作"转给对手
                    ├─ 反作弊：校验放置动作合法性 + 摘要交叉核对 → 异常入库
                    └─ MariaDB 库 `xy_game`： pvp_results / pvp_anomaly
```

### 3.1 为什么可做确定性输入回放（关键论证）

引擎排查（`web/src/battle.ts` / `autoplace.ts` / `rng.ts`）：

- 战斗 sim 只通过 3 个种子 RNG 消费随机（`this.rng` `battle.ts:1799`、`this.aiRng` `:1800`、`this.bossScheduleRng` `:1804`，mulberry32 纯算术），**无** `Math.random`/`Date.now`/`new Date`；怪物移动/目标/攻击全确定（`battle.ts:6485` 等）。遍历有序（Map 按插入序、目标按距离排序）。
- 引擎**已支持固定步长**：headless versus-agent 用 `battle.step(1/30)` 固定物理子步（`versus-user-agent.ts:137-178`）。
- 现存两个非确定性源都可规避：① 浏览器主循环用**可变 dt**（`main.ts:1825-1835`）→ PvP 改用**固定步长累加器**（累计真实时间，按 1/30 切片 step，渲染插值）；② autoplace 用 `performance.now()` 卡时限（`autoplace.ts:1298-1301`）→ **放置动作以显式落格位置转发**（一键布阵也转发其结果落格，而非重跑 autoplace），重放端不跑 autoplace，故此不确定源不进入。
- JS 双精度 IEEE-754，同一构建同序运算跨机一致；相同种子 + 相同 tick 序施加相同输入 → 两端结果一致。

**分层保证**：`A 半场`由 A 实时权威模拟；`B 在 A 机上的重放`只吃 B 的放置动作、跑在**延迟时间线**（缓冲输入、落后实时**<1s**），仅供展示与反作弊；**波次开始/胜负这类权威耦合全走服务端实时消息**，不依赖重放。→ 即便重放有残余漂移，最坏只是对手观感略偏，胜负与节奏不受影响；反作弊比对用**容差**（比对单位数/战力/唐僧血/波次等粗粒度不变量，非逐像素）。

### 3.2 传输与延迟

- 服务端标准库 `http.server`（同步、无长连接）。用 **1s 双向 tick** 承担心跳 + 摘要上报 + 下发（对手动作/下一波/终局）；**放置动作即时补发**（有新动作时短去抖 ~300ms 内 flush，不等整秒）→ 对手重放延迟压到 **<1s**（通常几百 ms）。
- 对手重放跑在 **落后 <1s** 的时间线上——不是逐帧锁步（帧锁步在 HTTP 轮询下不可行），而是"低延迟确定性重放"。
- 权威耦合（下一波开始、终局）走服务端，天然容忍传播延迟（波次间有间隔缓冲）。

### 3.3 权威划分

| 数据 | 权威 | 说明 |
|------|------|------|
| 本方半场（攻击/伤害/唐僧血/经济） | **客户端（本方）** | 固定步长本地权威模拟 |
| 随机种子 / 各波开始时间 / 地图 | **服务端** | match-start 下发 + tick 下发下一波 |
| 放置动作流（双方） | **服务端转发** | 客户端上报、服务端校验并中转给对手 |
| 终局与原因 | **服务端裁决** | 避免双方各自判赢 |
| 反作弊异常 / 当日禁赛 | **服务端** | 动作合法性 + 摘要核对 + 计数 |
| PvP 战绩 | **服务端** | 独立记录，不影响境界 |

## 四、匹配、邀请与倒计时

### 4.1 随机/同级匹配（自适应窗口）

段位 = `rank_level`（复用现有境界 `web/src/rank.ts` / 服务端 `players.rank_level`）。

1. 入队先看**当前是否已有同级玩家在等** → 有则**立即**配对。
2. 无同级在等时，算**同级保持窗口 W**：统计**最近 5 分钟**在该 `rank_level` 入过队的**不同玩家数 N**（进程内 5min 滚动窗口，按段位分桶）。`W = clamp(3 + 12 × min(N,5)/5, 3s, 15s)`（N=0→3s、N≈2→~7.8s、N≥5→15s；常量可调）。
3. W 内只配同级；期间有同级进来立即配。
4. **W 到点仍无同级 → 放宽到任意段位**（即"否则随机"）。
5. 全程受 **2 分钟总倒计时**兜底；真的全场无人 → 超时失败 → 确认回首页。

### 4.2 邀请好友（私房）

1. 点`邀请好友` → `POST /api/versus/room/create {map}` → 返回 `{code, link}`。
2. 分享链接 `<站点>/xy/?versus=<code>`（复用 `user-id.ts` 剪贴板逻辑复制）。
3. 好友打开带 `?versus=` 的链接 → 客户端识别 → `POST /api/versus/room/join {code}` → 有效且未满 → 成局。
4. 发起方等待页显示链接 + 2 分钟倒计时；好友连上即开打（双方各扣体力）；超时→失败→回首页。
5. 邀请对局**不做段位匹配**；波次仍**各算各的**。

### 4.3 匹配/等待界面（新 screen `pvpMatching`）

- 搜索动画 + **2 分钟倒计时环** + `退出匹配` 按钮。
- 邀请模式额外显示可复制的分享链接 + `已复制` 反馈。
- 配对成功 → 「已匹配到对手·头像昵称」提示 → 切 `battle`（PvP 标记）。
- 超时：提示「未匹配到对手」+ `确认`（回首页，不扣体力）。

## 五、对局同步模型

### 5.1 match-start 下发（配对成功时）

```jsonc
{
  "matchId": "…",
  "seed": 123456,                   // 随机种子（两端本方 RNG 用同一颗）
  "map": "huoyanshan",              // 双方同图
  "startAtServerMs": 1690000000000, // 第 1 波 / tick0 的服务端时刻
  "opponent": { "uid": "***4821", "nickname": "…", "avatarId": "wukong", "rankLevel": 3 }
}
```

- 客户端开局注入自己的养成配装（`metaBonuses`/`weaponBonuses(bag)`/`loadout.equipped`/`loadout.passives`，同 `newGame()` `main.ts:790`），**seed 用服务端的**（不再 `nextSeed()` 走 `Math.random`），**关掉本地 AI 决策**（`updateAi` 不做本地征兵/布阵），**关掉 ai-skill/rubber-band**。
- **tick0 基准**：两端约定 `simTick = floor((serverNow − startAtServerMs) / (1000/30))`，放置动作按 simTick 施加，保证同序。

### 5.2 tick 协议（`POST /api/versus/tick`，心跳 1s + 放置动作即时补发）

请求（每 1s 心跳，或放置/清波/认输/阵亡时即时补发）：

```jsonc
{
  "matchId":"…", "clientMs":…,
  "inputs": [                              // 自上次 tick 起的放置动作（带 simTick）
    { "t": 512, "op":"summon" },
    { "t": 540, "op":"place", "token":"…", "cell":"r2c4" },
    { "t": 555, "op":"move",  "from":"r2c4","to":"r3c4" },
    { "t": 600, "op":"active","id":"…" },
    { "t": 610, "op":"itemPick","choice":1 }, …
  ],
  "digest": { "wave":7,"power":812,"kills":143,"tangsengHP":3,"peach":22,"units":18 }, // 摘要，反作弊
  "waveClearedAt": { "wave":7, "t":1234 } | null,  // 本方真实清波(simTick)
  "status": "playing" | "tangsengDead" | "surrender"
}
```

响应：

```jsonc
{
  "serverMs": …,
  "opponentInputs": [ { "t":…, "op":… }, … ],   // 对手放置动作(转发)
  "opponentDigest": { … } | null,               // 对手自报摘要(供端上重放核对)
  "nextWave": { "wave":8, "startAtServerMs":… } | null,  // 先清者触发
  "opponentStatus": "playing"|"disconnected"|"surrendered"|"tangsengDead",
  "result": null | { "outcome":"win"|"lose"|"draw",
                     "reason":"opponentTangsengDead"|"opponentSurrender"|"opponentDisconnectTimeout"
                            |"selfTangsengDead"|"selfSurrender"|"draw" },
  "cheatNotice": null | { "banned":true, "msg":"检测到异常，今日暂停真人匹配" }
}
```

### 5.3 波次开始时间（"先清者定节奏"）

- 客户端本方清空当前波怪物（现判定只看本方怪物 `battle.ts:6700-6706`）→ 即时补发 tick 带 `waveClearedAt`。
- 服务端记录该 match 下 wave N 的**首个清波者**，令 `nextWave = {wave:N+1, startAtServerMs: firstClear + INTER_WAVE_DELAY_MS}`，两端下发。
- 两端在本地时钟（对齐服务端）到达该时刻 spawn 第 N+1 波；**落后方新波叠加**（即节奏压制）。
- 注意：清波耦合用**真实清波时刻**（走服务端），与"对手展示重放的延迟时间线"是两条线，互不影响。

### 5.4 放置动作流 & 摘要

- **动作流**（供对手重放）：`summon`（征兵，结果由种子确定）/`place`/`move`/`merge`（若非自动）/`shovel`/`active`（主动道具/绝招）/`itemPick`（波间三选一）等，均带 `simTick`。一键布阵转发其**结果落格清单**（非 autoplace 指令）。
- **摘要**（供反作弊）：`{wave,power,kills,tangsengHP,peach,units}`，1s 一次（放置动作即时补发）。
- 端上把对手动作喂给"对手侧"（现有 `ai*` 字段与 `aiRng`/`updateAiUnits` 等战斗机器复用），在延迟时间线推进重放；`drawAiSide()`（`render.ts:9072-9116`）与 `drawAiItemsHud()`（`render.ts:9435`）渲染基本不变，仅数据来自重放。

### 5.5 时钟对齐

用 tick 的 `clientMs`/`serverMs` + RTT 估 offset；`startAtServerMs`、`nextWave.startAtServerMs` 换成本地时刻用于 spawn，并据此推 `simTick`。

## 六、战斗引擎改动（`web/src/battle.ts` + 新 `pvp-battle.ts`，受控侵入）

单 Battle 实例双棋盘保留；PvP 模式改对手侧驱动与循环步进。

| 位置 | 现状 | PvP 改动 |
|------|------|---------|
| 主循环 `main.ts:1825-1890` | 可变 dt，每帧一次 `battle.step(dt)` | PvP 用**固定步长累加器**：累计真实时间，按 1/30 切片多次 `step`，渲染插值 |
| 构造 `battle.ts:1775-1824` | 生成本地 AI（`aiRng`/`mirrorPath`/`rollAiLoadout`/rubber-band） | 新增 `pvp` 选项；跳过 AI loadout/技能生成，seed 用服务端；对手侧初始为空、待输入回放 |
| `updateAi(dt)` `battle.ts:5241-5347` | 本地 AI 决策(征兵/布阵/调整) + 对手侧战斗/推怪 | PvP 时**去掉决策部分**，改为按 simTick **施加对手转发来的放置动作**；**保留**战斗/推怪/怪物生成（确定性重放）；跑在延迟时间线 |
| 本方输入 | 玩家点击直接改本地状态 | PvP 时玩家操作**同时**记为带 simTick 的动作上报（供对手重放 + 反作弊） |
| 波次血量 `computeWavePressure`/`estimateOptimalPower` `battle.ts:4891-4954` | 只按本方战力算 | **不变**（各算各的；重放对手侧时按对手侧战力算） |
| 波次推进 `battle.ts:6633-6706`/`startNextWave` | 本地 `nextWaveTimer` | 下一波 spawn 时刻改由**服务端 `nextWave`**（本地时钟对齐）触发；清波上报 |
| 胜负 `checkOpponentDefeated` `battle.ts:5350-5360` | 看本地 `aiDefeated` | `aiDefeated`/终局由**服务端 `result`** 置位；本方 `tangsengHP→0` 仍本地判负并上报 |

> 新增 `web/src/pvp-battle.ts`：持有输入缓冲、simTick 记账、对手延迟重放推进、与 tick 网络桥接，避免把网络塞进 7000 行的 `battle.ts`。

## 七、反作弊（服务端）

三层：

1. **放置动作合法性**（服务端纯算术校验，无需跑 TS 引擎）：经济够不够（桃 = 击杀 + 波次奖励为上界，`summon`/`itemPick` 花费不超）、落格是否已解锁/合法、动作频率/时机是否越界。
2. **端上重放交叉核对**：每端确定性重放对手动作流，与对手 1s 自报 `digest` 做**容差比对**（单位数/战力/唐僧血/波次），偏离阈值 → 端上向服务端上报"对手摘要不符"信号（两诚实端会一致；作弊端自报与诚实端重放不符 → 暴露）。
3. **服务端启发式上界**（backstop）：唐僧血单调不增、击杀增量 ≤ f(战力)×时长、战力增长受经济约束、波次进度与调度一致。

判定与计数：某 match 中该用户触发硬阈值 → 记一条 `pvp_anomaly`（`day,uid,opponent_uid,match_id,reasons_json`），**同对手当天去重**（唯一键）。当日禁赛（实时查，同 `events` 聚合风格）：`COUNT(DISTINCT opponent_uid) WHERE day=今日 AND uid=U ≥ 3` → 拒绝 `enqueue`/`room/create`/`room/join` 并回 `banned` + 文案；经 tick `cheatNotice` 或 `/api/player/me` 通知本人。

## 八、心跳、断线与重连

- **心跳 = 1s tick**（放置动作即时补发）。服务端记录每方 `lastTickAt`。
- 某方 tick 缺失 **>6s** → 标记 `disconnected`，对手 tick 响应 `opponentStatus:"disconnected"`（UI 提示"对手连接中断…"）。
- 断开超 **6s 宽限**仍未恢复 → 裁决对手 `win / opponentDisconnectTimeout`；断线方回来收到 `lose`（或客户端本地检测裂口显示"断线判负"）。
- 断线方 **<6s 回来**：本地 sim 一直在跑，补心跳 + 补发这段的动作即续。
- **切后台**：Web 隐藏标签被节流、rAF 暂停 → sim 暂停且心跳中断，超 6s 按断线判负（离开即判负，合理）；用 `visibilitychange`（`main.ts:1981-1986`）尽力续跳并提示。

## 九、客户端改动

- **网络层** `web/src/api/pvp-client.ts`（新）：复用 `apiFetch`，封装 enqueue/poll/cancel/room/tick + 轮询定时器/超时/时钟对齐/断线检测。
- **PvP 状态机/桥接** `web/src/pvp-match.ts`、`web/src/pvp-battle.ts`（新）：`idle→queuing/inviting→matched→inBattle→settled`；2min 倒计时；输入缓冲与 simTick；对手延迟重放。
- **首页入口** `menu.ts:126-139` `menuButtons()` 加 `pvpMatch`/`pvpInvite`（复用 `drawInkActionButton`），`drawMenu()` 循环追加绘制，`handleMenu()`（`main.ts:852-911`）加分支（体力 <5 → `menuToast('体力不足')`；禁赛 → 提示；否则进 `pvpMatching`）。
- **匹配/等待界面**：新 screen `'pvpMatching'`（§4.3）。
- **对局 UI**：沿用布局；对手信息条复用 `profile-popup` `drawAvatarCell` / `leaderboard` `drawEntryRow` 视觉；对手道具复用 `drawAiItemsHud`。
- **暂停弹窗** `pause-popup.ts` 加 `context:'match'|'battle'`：匹配中→`退出匹配`；对局中→`认输`（确认后上报 surrender 判负）。`main.ts:1434-1462` 分支相应处理。
- **结算** `settle.ts`+`main.ts:1904-1956` PvP 分支：不加减星、不触发神秘商人；展示 胜/负/平局 + 原因文案 + 对手头像昵称；上报 `pvp_result`；`返回首页`。

## 十、服务端改动（`server/`）

### 10.1 新增路由（`server.py:78-87` routes 追加）

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/versus/enqueue` | 入队（校验体力≥5、非禁赛）；返回 ticket |
| POST | `/api/versus/poll` | 轮询：waiting / matched(+match-start) / timeout |
| POST | `/api/versus/cancel` | 退出匹配队列 |
| POST | `/api/versus/room/create` | 建私房，返回 code + link |
| POST | `/api/versus/room/join` | 用 code 加入私房 → 成局 |
| POST | `/api/versus/tick` | 1s 双向：上报动作/摘要/心跳 → 返回对手动作/下一波/终局/禁赛通知 |

新文件：`server/api_versus.py`（匹配/房间/对局状态机 + 转发 + 反作弊），进程内单例（加锁）。

### 10.2 进程内状态（单进程、`threading.Lock`，重启即丢）

- 匹配队列：按 `rank_level` 分桶的等待项 `{uid,rank,enqueuedAt,mapPref,ticket}`。
- 5min 滚动入队日志：按段位存时间戳（算自适应 W 的 N）。
- 邀请房间：`code→{hostUid,hostRank,map,createdAt,joinerUid?}`。
- 活跃对局：`matchId→{a,b,seed,map,startAt, 每方{lastTickAt,inbox(待转发动作),lastDigest,wave,clears,status}, waveSchedule}`。

### 10.3 数据模型（MariaDB `xy_game`，`db.py` SCHEMA 追加）

```sql
CREATE TABLE IF NOT EXISTS pvp_results (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  match_id VARCHAR(40) NOT NULL, day CHAR(10) NOT NULL,
  uid VARCHAR(20) NOT NULL, opponent_uid VARCHAR(20) NOT NULL,
  outcome ENUM('win','lose','draw') NOT NULL, reason VARCHAR(32) NOT NULL,
  wave INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL,
  KEY idx_uid_day (uid, day), KEY idx_match (match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pvp_anomaly (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  day CHAR(10) NOT NULL, uid VARCHAR(20) NOT NULL,
  opponent_uid VARCHAR(20) NOT NULL, match_id VARCHAR(40) NOT NULL,
  reasons_json MEDIUMTEXT NULL, created_at DATETIME NOT NULL,
  UNIQUE KEY uniq_day_uid_opp (day, uid, opponent_uid),  -- 同对手当天最多计1
  KEY idx_uid_day (uid, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- PvP 战绩 W/L 从 `pvp_results` 聚合；当日禁赛实时 `COUNT(DISTINCT opponent_uid)`（不建单独禁赛表）。

## 十一、部署与运维

- 复用现有 `xy-web.service` 单进程；PvP 状态**进程内**（重启即丢活跃对局，可接受）；`pvp_results`/`pvp_anomaly` 持久。
- **无新依赖**（PyMySQL + 标准库）；`db.migrate()` 幂等建新表。
- 生产同源 `/api`；本地 Vite 已代理（`vite.config.ts:17-19`）。
- 邀请链接走反代 `peiyin.seealso.cn/xy`，客户端读 `?versus=`（同既有 `?seed=`/`?map=`，`main.ts:190`）。

## 十二、明确不做（本期 YAGNI）

- WebSocket/SSE/长连接（1s 轮询足够）；帧锁步（用延迟重放替代）。
- 微信端 PvP（二期）。
- PvP 独立段位/天梯/赛季/MMR（本期只胜负记录 + 段位分桶匹配）。
- 手动举报作弊（本期只服务端自动检测）。
- 观战/回放存档/多人(>2)。
- 跨进程/多实例匹配（现单进程；将来水平扩展再引 Redis/共享态）。

## 十三、测试要点

- **确定性**：给定 seed + 同一放置动作流，两端（及重跑）本方模拟逐 tick 一致；固定步长累加器在不同帧率下结果一致。
- **匹配**：同级即时；无同级时 W 随 N(5min 窗口)在 3–15s 变；W 到点放宽任意；2min 超时失败且不扣体力。
- **邀请**：create→link→join 成局；超时失败回首页；非法/已满 code 拒绝。
- **体力**：<5 无法进入；开打才扣；失败/超时不扣。
- **同步**：先清者触发的 `nextWave` 两端一致 spawn；对手重放延迟 <1s 且顺滑；时钟对齐误差容忍。
- **心跳/断线**：>6s 断→对手判赢(断线超时)；<6s 回来续；认输→对手判赢(认输)；唐僧被吃→对手判赢；同刻→平局。
- **反作弊**：非法放置(经济不足/非法格)被拒并记异常；重放核对不符触发信号；同对手当天去重；≥3 不同对手→禁赛+通知；禁赛期入口被拒。
- **降级**：`/api/versus/*` 不可用时匹配失败有提示、不卡死单人玩法。
- **回归**：单人对局（打本地 AI）完全不受影响（PvP 为独立分支/标记）；`ai-balance` 门禁与既有 vitest 全过。

## 十四、文件落点（预期）

| 区域 | 路径 |
|------|------|
| 服务端匹配/房间/对局/转发/反作弊 | `server/api_versus.py`（新） |
| 路由注册 | `server/server.py`（追加 routes） |
| 新表 | `server/db.py`（SCHEMA 追加） |
| 客户端 PvP 网络 | `web/src/api/pvp-client.ts`（新） |
| PvP 状态机/桥接/回放 | `web/src/pvp-match.ts`、`web/src/pvp-battle.ts`（新） |
| 战斗引擎 PvP 分支 + 固定步长 | `web/src/battle.ts`、`web/src/main.ts`（主循环） |
| 首页入口 | `web/src/menu.ts`、`web/src/main.ts` |
| 匹配/等待界面 | `web/src/main.ts`（新 screen）+ 渲染 |
| 暂停弹窗 | `web/src/pause-popup.ts` |
| 结算 PvP 分支 | `web/src/settle.ts`、`web/src/main.ts` |
| 设计本文 | `docs/superpowers/specs/2026-08-20-online-pvp-versus-design.md` |
