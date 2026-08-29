# PvP/PvE 全状态续玩：刷新恢复到最新 + 对手断线续打 + 断线负不扣段位 —— 设计

日期：2026-08-29
分支：`worktree-pvp-refresh-recovery`
关联：`2026-08-26-pvp-disconnect-resilience-design.md`（A1 降级「解冻续打」）、`2026-08-21-online-pvp-ws-state-sync-design.md`（Model C 本方权威半场）、`2026-08-23-battle-resume-save-design.md`（既有单人续玩）

## 1. 目标与非目标

### 目标
**统一一套「全状态序列化 + 节流持久化 + 刷新恢复」机制，PvP 与 PvE（单人闯关/无尽）共用**，刷新后恢复到最新状态：
1. **PvE 刷新恢复**（离线，更简单）：刷新后恢复本方战斗到最新序列化状态，直接继续（无需网络/快进，墙钟不走）。
2. **PvP 刷新恢复**：刷新后重连，若对局仍在，恢复本方半场并「快进」追上服务端当前进度，继续对局；对局已结束则直接回首页（不进战斗页）。
3. **对手断线续打**：对手断线期间本方不再冻结，继续战斗（对手半场以最后快照定格）；对手重连则恢复同步，超时未回则本方判胜。
4. **断线负不扣段位**：因**对手断线**导致本方唐僧死亡而负的，不扣段位；因**本方刷新/断线**导致本方唐僧死亡而负的，照常扣段位（防刷新逃判负）。

### 非目标（YAGNI）
- 不做「种子 + 输入逐帧重放」式完美确定性恢复（成本高、长对局重放慢、非确定性风险大）。改用全状态序列化快照 +（PvP）快进。
- **解除既有单人续玩的 ready-only 保守限制**：`battle-save.ts` 现状只在 `status==='ready'`（两波之间）存档、刷新丢 ready 窗内布置；本设计把它升级为「全状态 + 输入触发 + 节流」，PvE 恢复到最新一帧。这是对既有功能的增强（含回归面，见 §7）。
- 不解决「跨实例水平扩展后 match 运行时在别的实例」——`ws_hello` 已支持跨实例 `_load_match_from_redis` 懒认领；刷新重连仍走同一 matchId，若该局已 reaped 或 uid 不属于则 hello 失败 → 回首页（安全兜底）。

## 2. 背景与关键约束

- **Model C**：本方半场在本地权威推进（`drainFixedSteps` 按 `PVP_SIM_DT=1/30` 固定步长，`localSimTick` 为时钟）；对手半场不本地跑，由对方 100ms WS 快照作「木偶」渲染。波次由服务端绝对纪元 `startAtServerMs` 权威排程，两端同值；`pvpWaveStartTick(startAtServerMs, pvpMatchStartMs)` 把波起始纪元转成本方 tick。
- **连接层**：`PvpSocket` 非手动断开时自动重连（300ms 快试 + 1s→5s 退避），open 后发 `hello{type,matchId,uid}`，服务端 `ws_hello` 返回 `{serverMs}`（经 `welcome` 下行到 `onWelcome`）。整页刷新会清空内存，这条「会话内重连」路径不覆盖刷新。
- **现状（刷新=这局对刷新方结束）**：matchId 不持久化；`saveResumeCheckpoint` 有 `isPvp` 守卫跳过 PvP；启动只 `tryResumeLocalBattle` 单人续玩。对手侧：本方 WS 断开→服务端推 `oppGone`→对手 `shouldStepSim` 冻结（`pvpOppGone` 入参）→倒计时→超时判 `DisconnectTimeout`。
- **全状态序列化已存在**：`Battle.serialize()` 返回 `{config, core}`（core 含 monsters/units/status/waveActive/4 个 RNG state 等飞行实体），`applyCoreState(core)` 可恢复。单人 `readBattleSave` 限定 `status==='ready'` 是**保守选择**（丢弃 ready 窗内临时布置），非技术限制——PvP 快进续跑需恢复任意 status，故独立一套持久化，不复用单人 `SAVE_KEY`。

## 3. 设计总览

PvP/PvE **共用**底层「全状态序列化 + 输入触发 + 节流写入 + `applyCoreState` 恢复」，仅**恢复流程分叉**（PvE 直接恢复；PvP 多「ws_hello 确认 + 快进对齐服务端 tick」）。

```
[战斗中：PvP 或 PvE]                 [刷新 / 关页]
  帧尾：dirty + 过间隔 → 写            ↓
  localStorage 续玩快照            页面重载
  {kind:pvp|pve, …, core}             ↓
                                   [启动] 发现续玩快照
                                     ├─ kind=pve（离线）
                                     │    → restoreBattle(save) + screen='battle'，直接继续
                                     │    （无需网络/快进；墙钟不走，状态即最新）
                                     └─ kind=pvp
                                          → 直连 WS + ws_hello(matchId,uid)
                                             ├─ 对局存在(返回 serverMs)
                                             │    → 恢复本方 battle + 快进到目标 tick
                                             │    → 我方唐僧快进中死 → 负·扣段位(我方刷新导致)
                                             │    → 否则 → 进战斗页，正常对战
                                             └─ 对局不存在(onWelcome 未到就 onclose)
                                                  → 清快照 → 回首页(不进战斗)
```

## 4. 详细设计

### 4.1 统一续玩快照持久化（PvP/PvE 共用）

**新文件 `web/src/pvp-save.ts`**（取代并增强 `battle-save.ts` 的续玩职责；单键 `dasheng.session`，`kind` 字段区分 pvp/pve）。

- 数据结构 `SessionSaveV1`：
  - `v: 1`、`gameVersion`、`savedAt`
  - `kind: 'pvp' | 'pve'`
  - PvP 专有：`matchId`、`uid`、`side: 'a'|'b'`、`startAtServerMs`（= `pvpMatchStartMs`）、`localSimTick`
  - 共用：`seed`、`mapId`、`config: BattleSaveConfig`、`core: BattleCoreState`（直接取自 `battle.serialize()`）
- **写入门槛**（帧尾调用 `sessionSaveCheckpoint(battle, kind)`）：
  - `status` ∈ {`playing`,`ready`}（终局 won/lost 不写；快照生命周期=「对局进行中」）。**这解除了既有 ready-only 限制**——PvE 进行中（playing）也存，刷新恢复到最新一帧。
  - **输入触发 + 时间节流**：我方任一有效输入（征兵/部署/合并/铲地/主动技/大招）置 `dirty`；帧尾若 `dirty` 且距上次写入 ≥ `SESSION_SAVE_MIN_INTERVAL_MS`(建议 500ms) 落盘，或距上次写入 ≥ `SESSION_SAVE_MAX_INTERVAL_MS`(建议 2000ms) 无条件落盘。节流依据见 §4.6 性能基准。
  - `storeSet` 吞错 best-effort。
- **清除时机**：对局正常终局（PvP 收 `result`/`leaveSettleToMenu`；PvE won/lost 结算）、`endPvpSession()`、刷新恢复时回首页分支。`clearSessionSave()`。
- **读取校验** `readSession()`：`JSON.parse` 容错、`v`/`gameVersion` 校验、字段齐全、`core` 非空；无效返回 null。
- **恢复构造** `restoreBattle(save)`：`new Battle(save.seed, 1, mapById(save.mapId), /*meta*/undefined, /*weapons*/undefined, /*equipped*/undefined, /*passives*/undefined, save.config.endless, /*aiSkill*/undefined, 1, /*heroMatch*/undefined, /*pvpInit*/save.kind==='pvp'?{enabled:true}:undefined)` → `applyCoreState(save.core)`。PvP 不用 meta/weapons/passives/heroMatch（全由 core 覆盖，见 §6.1）；PvE 的这几个也由 core 覆盖，构造传中性值。seed 用存档原值。
- **既有单人续玩的处置**：`battle-save.ts`（ready-only、`dasheng.battle.save` 旧键）**退役**——其续玩职责由本机制接管；`migrateCoreGeneralIds` 等迁移逻辑并入新 `readSession`。保留旧键读取做一次性迁移可选（实现时定，倾向直接作废旧档，因版本校验 `gameVersion` 变更即失效）。

### 4.2 启动恢复（boot，PvE/PvP 分叉）

- 位置：`main.ts` 启动 IIFE 内，`bootstrapAuth` 之后（优先续玩恢复，因为对局有时效性；其次才是原有首页/单人逻辑）。
- 流程：
  1. `save = readSession()`；无则跳过（走原有首页逻辑）。
  2. 按 `save.kind` 分叉：
     - **`kind='pve'`（离线，直接恢复）**：`battle = restoreBattle(save)`、`screen='battle'`，按现有单人进战斗的初始化（`endHandled=false` 等）。**无需网络、无需快进**——离线战斗墙钟不走，序列化状态即最新，`applyCoreState` 后直接接 `frame()` 继续。若 `core.status` 已是 won/lost（续玩前一刻终局）→ 走正常结算而非进战斗。
     - **`kind='pvp'`**：直连 PvP WS（新路径 `resumePvpSession(save)`，不走 `enterPvpMatching`）：建 `PvpSocket(matchId, uid)` + `onWelcome` + `onHelloFail`（§6.4）。
  3. PvP 的 `onWelcome(serverMs)`：
     - **快进恢复**：`restoreBattle(save)` 建 battle，`screen='battle'`；目标 tick `targetTick = pvpWaveStartTick(serverMs, save.startAtServerMs)`（用存档的 `startAtServerMs`，不用实时 `pvpMatchStartMs` 以免零点漂移）；若 `targetTick > save.localSimTick`，`battle` 以 `PVP_SIM_DT` 步进 `targetTick - save.localSimTick` 步（**无新输入**，防御自动战斗=我方不在时的自然演进），每步 `maybeOpenPvpWave(battle, tick)`。设 `localSimTick = targetTick`、`pvpMatchStartMs = save.startAtServerMs`、`pvpAcc=0`。随后恢复正常 `frame()` 对战循环。
     - **快进中我方唐僧死**（`battle.status==='lost'`）：走 PvP 负结算 `pvpSettle('lose', rank, wave)` → **扣段位**（我方刷新导致，规则 §4.4），弹结算屏。
     - **对局不存在**（`onHelloFail`，即连上后未收 `onWelcome` 就 `onclose`，§6.4）：`clearSessionSave()` → `screen='menu'`（首页），**不进战斗页**。对局已正常结束/被 reaper 回收都走此兜底。
  4. 加载态：恢复期间 `screen` 保持 loading 或新中间态，避免闪战斗页；PvP 的 `pvpSock`/`pvpController`/`pvpOpponent` 等按现有 `onPvpMatched` 等价初始化。
- **与旧单人续玩的衔接**：本机制**取代** `battle-save.ts` 的续玩职责（同键 `dasheng.session`，PvE 也走它）；`tryResumeLocalBattle`/旧 `SAVE_KEY` 退役（§4.1）。刷新恢复统一走 `readSession()`。

### 4.3 对手断线续打（去掉冻结）

- `pvp-pause.ts` 的 `shouldStepSim` 入参去掉 `pvpOppGone`（或该入参恒 false），使 `pvpOppGone` 不再冻结本方仿真。
- 保留 `oppGone` 的**UI 表现**：对手半场定格在最后快照；顶部仍可提示「对方已断线，等待重连…」，但不影响本方 step。
- 对手重连：`oppView` 收到新快照自然续上（`PvpOppView` 有断流外推/棘轮追赶，重连后从新快照继续）。
- 对手超时未回：现有 `DisconnectTimeout` 路径不变，本方判胜（`pvpResult={outcome:'win',reason:'opponentDisconnectTimeout'}`）。
- `netDead`（我方连不上服务器）仍冻结本方——这是「我方网络断」，与「对手断」区分，不动。

### 4.4 断线负不扣段位（服务端发信号）

**语义（用户确认）**：对手断线导致我方输 → 不扣段位；我方刷新/断线导致我方输 → 扣段位。

- **服务端 `server/api_versus.py`**：`_set_result` 判定 `TangsengDead` 负方时，检查**胜方侧是否当前处于断线态**（`gone_ms>0` 且未因 `connected_ever` 豁免，即胜方「连过又掉线」或「从未连接但在场」——取「负方死时，胜方没有在正常发快照」）。若是，给负方 result 加 `"noPenalty": true`，或给 lose reason 用区分值（如 `selfTangsengDeadOppGone`）。采用 **reason 区分值**更省事（前端已按 reason 分支展示文案）：`REASON` 表新增键或在 `_set_result` 内对 `TangsengDead` 特判。
  - 具体判定点：`_set_result(m, loser_side_key, 'TangsengDead')` 时，`winner = 'b' if loser=='a' else 'a'`；若 `not m[winner].get('connected_ever')` 或 `m[winner].get('gone_ms')`（胜方断线中）→ 负方 reason = `selfTangsengDeadOppGone`（不扣）。注意：这里「对手断线」=胜方 side 掉线；结合 §4.3 对手断线我方继续打，我方（负方）在胜方掉线期间死 → 命中。
  - **我方刷新导致的负**：刷新方是负方，其 result reason 仍是普通 `selfTangsengDead`（胜方一直正常发快照、`connected_ever=True` 且无 `gone_ms`）→ 扣段位。符合「我方刷新导致的负要扣」。
- **客户端 `main.ts`**：`pvpSettleResult` 结算时，若 `pvpResult.reason === 'selfTangsengDeadOppGone'`，`pvpSettle` 仍返回 outcome=lose 但 `rankChange=null`（不调 `recordLose`），结算屏展示「失败（对方断线，不计段位）」。`pvpSettle` 签名增 `noPenalty?: boolean` 或按 reason 内部分流。
- **持久化/战绩**：`_persist_result` 照常写 `pvp_results`（outcome=lose, reason=selfTangsengDeadOppGone），段位不变——战绩可查「这局因对手断线负」。`is_banned`/反作弊不受影响。

### 4.5 反作弊：重连基线重置

- `ws_hello` 已重置 `last_next_wave`。新增：重置本侧 `last_digest`/`wave` 反作弊基线（`me["last_digest"]=None`、相关 wave 水位），使重连后首条快照（快进后的新状态）不与断线前 digest 做 delta（否则快进跨越多波可能误判 `wave_ahead`/`kills_over_ceiling`）。
- 快进是「无输入追赶」，`_anticheat` 的击杀上界/唐僧血单调/波次不超前对「自然演进到 serverMs」应成立（快进严格按服务端波次纪元 `maybeOpenPvpWave` + `PVP_SIM_DT` 步进，不超前），故重置基线后安全。

## 5. 数据流与关键不变量

- **快进目标 tick**：`targetTick = pvpWaveStartTick(serverMs, save.startAtServerMs)`。因 `pvpMatchStartMs = save.startAtServerMs`（同一局零点不变），与在线 `onNextWave` 的 tick 基准一致，快进后波次时钟与服务端对齐。
- **快进无输入**：追赶步只 `battle.step(PVP_SIM_DT)` + `maybeOpenPvpWave`，不施加任何放置/技能——等同「我方挂机」，怪潮/经济按确定性自然演进。
- **RNG 一致**：`applyCoreState` 恢复 4 个 RNG state（`rngS/aiRngS/aiSpawnRngS/bossScheduleRngS`），快进续跑与「未断线的确定性演进」逐位一致（前提：快进步数与 `targetTick - save.localSimTick` 精确相等）。
- **tick 只增不减**：`localSimTick` 存档值 ≤ 目标；恢复后取其大者续跑，不倒拨。

### 5.1 性能基准（实测，2026-08-29）

用 `vite-node` 跑真实 `Battle.serialize()` 测（进行中战斗、激活武将、出若干波怪）：

| 指标 | 实测值 | 说明 |
|---|---|---|
| `serialize()` 本身 | ~0.002 ms | 近乎零开销（纯字段收集） |
| `JSON.stringify(serialize())` | **~0.016 ms**（约 7.7 KB 状态） | 主线程同步开销的**唯一实质项** |
| 内存 `localStorage.set` | ~0.0002 ms | 可忽略（wx `setStorageSync` 同步写小数据亦 negligible） |

**结论**：单次全状态序列化的主线程成本极低（<0.1ms，即使实体数放大数倍仍远低于 16.7ms 帧预算）。**瓶颈不在单次快慢，而在写入频率**——故节流策略（输入触发 + `SESSION_SAVE_MIN_INTERVAL_MS=500ms` / `MAX=2000ms`）是为避免输入风暴时反复 stringify，而非单次延迟。这把既有「ready-only + 每窗一次」升级为「全状态 + 节流」是安全的。注：本基准实体规模受 `summon` 经济门限未拉满，但量级与趋势对频率策略已具决定性。

## 6. 风险与已确认事实（实现前已核实）

1. ~~`Battle` 构造的 `pvpInit`~~ **已确认**：`PvpInit = { enabled: boolean }`（battle.ts:1016），只一个布尔，无需 matchId/side。`restoreBattle` 对 pvp 用 `pvpInit={enabled:true}`。PvP battle 既有构造（main.ts:331 `onPvpMatched`）为 `new Battle(ms.seed, 1, map, meta, wb, equipped, passives, /*endless*/false, /*aiSkill*/undefined, 1, /*heroMatch*/undefined, {enabled:true})`——**PvP 不用 meta/weapons/passives/heroMatch，全部由 `applyCoreState(core)` 覆盖**，故恢复时这些构造参数传中性值即可。
2. **非 ready 状态恢复**：`serialize` 存了 `status`/`waveActive`/飞行实体，`applyCoreState` 全量覆盖；单人限 ready 是保守策略（丢弃 ready 窗内临时布置）。PvP 快进恢复 `playing` 态：特效字段（fx/damageFloats/bursts）`applyCoreState` 留空由 `step()` 重建（现有注释），实现时首帧自测无残留/不崩。
3. **对手重连 puppet 接续**：对手断线期间我方继续 step，我方半场持续发快照；对手重连后其 `oppView` 从新快照接续——`PvpOppView` 的棘轮/外推对「长时间断流后接新快照」需验证不跳变。
4. **hello 失败的客户端判定（重要）**：`ws_hello`（api_versus.py:669）已支持**跨实例 `_load_match_from_redis` 懒认领**，仅当该局真不存在（未认领到 + uid 不属于）才返回 `{"error":"bad_hello"}` 并由服务端关连接。但 `hello` 是 `PvpSocket` **send-only**，客户端**无显式 error 回调**——bad_hello 表现为「连接被服务端关闭」→ `onclose` 触发，而成功的 hello 会先收到 `welcome{serverMs}`。故恢复流程的「对局不存在」判定 = **连上后未收到 `onWelcome` 就 `onclose`（且非我方主动 close）** → `clearSessionSave()` + 回首页。需给 `PvpSocket` 增一个可选的 `onHelloFail?: () => void`（在 `handleClose` 里若 `!this.gotWelcome && !this.closed` 时回调），恢复路径据此兜底。
5. **段位扣除的终局时刻依赖**：「对手断线我方输不扣」要求 `_set_result` 在**终局时刻**读胜方 side 的 `gone_ms`/`connected_ever`。`_set_result` 在持锁内同步执行、`_forget_match_state` 在其后，故判定时刻这些 side 字段仍有效——实现时加测试锁死该时序。
6. **`serverMs` 与快进 tick 精度**：`onWelcome(serverMs)` = 服务端 `self._now()`（毫秒墙钟）。`targetTick = pvpWaveStartTick(serverMs, save.startAtServerMs)`。因双方 `startAtServerMs` 同值（match 级共享），且本机按 `PVP_SIM_DT=1/30` 推进，`(serverMs - startAtServerMs) * 30 / 1000` 即服务端认为当前应在的 tick。两端各跑各的半场，无需逐帧一致，只需**我方波次时钟不偏离服务端纪元**（`maybeOpenPvpWave` 用 `pvpWaveStartTick` 校准）。

## 7. 测试策略

- **`web/tools/pvp-refresh-smoke.mjs`**（新，puppeteer + 真实 server/fakeredis 环境）：PvP 对局→写续玩快照→模拟刷新（重载页）→断言 `readSession` 存在→mock `ws_hello` 返回 serverMs→断言恢复进战斗 + 快进步数 = 目标 tick - 存档 tick；断言对局不存在（onWelcome 未到+onclose）→ 回首页。
- **`web/tools/pve-resume-smoke.mjs`**（新）：PvE 单人/无尽进行中→写快照→重载页→断言 `readSession().kind='pve'`→断言直接恢复进战斗、状态（wave/units/HP）与存档一致（playing 态全状态恢复）。
- **单测**：
  - `pvp-save.ts`：读写往返、`v`/版本校验、终局不写、节流门槛（假时钟）、pvp/pve 的 `kind` 分流。
  - 快进目标 tick：`pvpWaveStartTick(serverMs, startAt)` 与在线一致（扩展 `pvp-fixedstep` 测试）。
  - `pvp-pause`：去掉 `pvpOppGone` 后 `shouldStepSim` 在对手断线时返回 true（我方继续）。
  - 段位：`pvpSettle` 对 `selfTangsengDeadOppGone` 不返回 rankChange。
- **服务端 pytest**：`_set_result` 对 TangsengDead + 胜方 gone/未连接 → reason=`selfTangsengDeadOppGone`；`ws_hello` 重置 digest 基线；既有 `test_versus_ws`/`test_versus_redis` 全绿。
- **门禁**：`server/ pytest`（fakeredis 部分免 DB；DB 部分需 3308 MariaDB）、`web/ vitest`、`web/ tsc`（不看全绿看「不新增」，基线 ~26）。
- **真机**：微信开发者工具双开模拟两客户端，验证刷新重连恢复、对手断线续打、断线负不扣段位三条路径（自动化覆盖不到的时序/网络部分）。

## 8. 落地顺序（供 plan 参考）

**先 PvE 后 PvP**——PvE 恢复无网络依赖、可先验证全状态序列化正确性，给 PvP 打底。

1. `pvp-save.ts` 统一持久化 + 写入节流 + 清除（纯客户端，PvP/PvE 共用；可先单测读写/节流）。
2. **PvE 刷新恢复**（`restoreBattle` + `readSession().kind='pve'` 分支 + `screen='battle'`），退役 `battle-save.ts` 续玩职责；单测 + 浏览器冒烟验证序列化正确性（全状态、playing 态恢复）。
3. **PvP 刷新恢复**：`resumePvpSession` + 快进（`restoreBattle` + `targetTick` 追赶）+ `onHelloFail` 兜底回首页，`PvpSocket` 增 `onHelloFail`。
4. 对手断线续打（`shouldStepSim` 去 `pvpOppGone`）。
5. 断线负不扣段位（服务端 `_set_result` reason 区分 + 客户端 `pvpSettle` 分流）。
6. 反作弊重连基线重置（`ws_hello`）。
7. 冒烟 + 单测 + 门禁（server pytest / web vitest / web tsc）+ wx bundle 重建。

