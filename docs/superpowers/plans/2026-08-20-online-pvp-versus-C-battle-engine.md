# 在线 PvP 对战 · Plan C（对局引擎）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal：** 匹配成功后两名真人真正开打；对手半场为**全保真**确定性重放（对手怪血按对手战力、延迟平滑）。

**Architecture（双 Battle 实例 / 已定）：** 本机跑两个 `Battle` 实例——`battle`（本方，实时权威，玩家输入直接作用其上）与 `oppBattle`（对手，同 `MatchStart.seed`、`{pvp:true}`，喂对手转发来的动作，按**延迟时钟**步进）。因 `oppBattle` 跑同一确定性引擎 + 同 seed + 同序动作，它是对手真实半场的忠实（时移）复现：对手怪血按其自身 `wavePressure`（战力）算 → **D2 自动**；抽字/出怪/时序同 seed 同序 → **自动一致**；确定性由同引擎构造保证。**波次开始时间、终局胜负走服务端**（Plan A 已实现服务端 tick）。渲染复用现有 `drawAiSide`：每帧把 `oppBattle` 的本方侧状态**桥接**进 `battle.ai*`（单位/字牌格镜像 `mirrorCell`、怪物 `dist` 直接沿用因 `aiPath=mirrorPath`）。反作弊（Plan D）交叉核对天然干净：`oppBattle.snapshot()` vs 对手自报 digest。

**为何弃「单 Battle 拆对手侧」**：`spawnMonster()`（battle.ts:5088）把同一只怪同 push 到 `this.monsters`+`this.aiMonsters`、血量同为本方 `wavePressure`、时序同为本方时钟。要全保真须在此紧耦合热路径外科拆分独立出怪状态/血量/时钟 → 侵入 sim、易破坏确定性与 `ai-balance`。双 Battle 把保真交给「同引擎跑对手输入」自动达成，风险从**高风险 sim 手术**移到**低风险、可冒烟验证的渲染桥**。

**Tech Stack：** TS + Canvas + Vite；vitest（测试放 `web/tests/`）；确定性 mulberry32；`apiFetch`；服务端 Python 已就绪。

---

## 关键设计决策

- **双 Battle**（见上）：`oppBattle` 只用其本方侧（`this.*`）；它的 `ai*` 空置不用。两实例状态独立（RNG 每实例独立；pvp 构造已绕开 `loadPlayerWinStreak`/`performance.now` 规划器/`DEV_FORCE_WAVE_HERO` 等）。
- **延迟重放（D1）**：`oppBattle` 步进落后本方 `DELAY_TICKS=15`（0.5s@30Hz）；对手动作按其 `t`(simTick) 在 oppBattle 的延迟时钟到点施加。迟到动作即时补应用。渲染插值使双方顺滑（可选增强，见 T8）。
- **各算各的（D2）**：`oppBattle` 用自身 `wavePressure` 算对手怪血 → 自动精确，无需拆 `spawnMonster`。
- **权威**：seed/各波开始/终局走服务端；本方半场本机权威；`battle.status`（本方）判本方唐僧死，`oppBattle`/服务端 `result` 判对手死（服务端终局为准）。
- **确定性红线**：两实例均 pvp 构造（无 `Math.random`/`Date.now`；规划器 `performance.now` deadline 在 pvp 跳过的 A/B 块内）。**对手动作施加到 oppBattle 必须严格按 t 升序**，否则 oppBattle 的 this.rng 与对手机脱序。
- **反作弊 digest（本计划产/传）**：`battle.snapshot()`→`{wave,power=towerPow,kills,tangsengHP,peach,units}`（`kills` 需在 battle.ts 补计数）。端上交叉核对留 Plan D。

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `web/src/api/pvp-client.ts` | `versusTick`+类型 | ✅ 已完成(T1) |
| `web/src/pvp-battle.ts` | `PvpSync`：simTick/延迟/缓冲/tick 组装 | ✅ 已完成(T2)，T6/7 可加辅助 |
| `web/src/pvp-fixedstep.ts` | `drainFixedSteps`/`PVP_SIM_DT`/`DELAY_TICKS` | ✅ 已完成(T4) |
| `web/src/pvp-record.ts` | `toPvpAction` 输入→动作映射 | 创建(T5) |
| `web/src/pvp-bridge.ts` | 渲染桥：`oppBattle.this*`→`battle.ai*`（镜像） | 创建(T8) |
| `web/src/battle.ts` | 构造 `pvp` 选项✅(T3)；`snapshot` 补 `kills`(T6)；可能加 `applyOpponentInput`/公开必要 getter | 修改 |
| `web/src/main.ts` | frame 固定步长✅(T4)；输入打点(T5)；`onPvpMatched` 建双 Battle+tick 循环(T6)；oppBattle 延迟步进+动作应用(T7)；桥+插值(T8)；波次(T9)；终局(T10) | 修改 |
| `web/src/pause-popup.ts` | `context:'match'`→认输 | 修改(T10) |
| `web/src/settle.ts` | PvP 结算分支 | 修改(T11) |
| `web/tests/**/*.test.ts` | 各任务 vitest（**放 web/tests/**，import `../src/...`） | 创建 |

---

## 里程碑与任务

- **C-α 骨架**（T1-4）✅ 已完成：tick 客户端 / PvpSync / pvp 构造 / 固定步长累加器。
- **C-β 双 Battle 对打**（T5-8）：本方输入打点 → 建双 Battle+tick循环 → oppBattle 延迟步进+动作应用 → 渲染桥+插值。
- **C-γ 服务端耦合与终局**（T9-11）：先清者定波次 → 断线/认输/权威终局 → PvP 结算。
- **C-δ 护栏**（T12-13）：确定性单测 + 单人零回归/全门禁/浏览器冒烟。

---

## Task 5：本方输入打点（`toPvpAction` + main.ts 各输入点 record）

**Files:** Create `web/src/pvp-record.ts`；Modify `web/src/main.ts`（输入点：summon `:1356`/autoPlaceTray `:1357`/placeFromTray `:1804`/dragBoard `:1822`/recallToTray `:1813`/mergeTrayTokens `:1807`/triggerActive `:1362`/applyPillActive+placeBomb `:1787-1788`/startNextWave `:2103`/claimWeaponPickup `:1207`）；Test `web/tests/pvp-record.test.ts`

`toPvpAction(kind, payload, result?)` 纯映射（不含 t，t 由 `PvpSync.record` 补）。各输入点**操作成功后**（返回 true/确有变更）`pvpSync?.record(toPvpAction(...))`。`summon`/`autoPlaceTray` 带**结果**（抽到的字 / 落格清单）——虽双 Battle 同 seed 理论上可省，但带上更稳且供反作弊。

- [ ] Step1 失败测试（映射 place/autoplace/summon）；Step2 FAIL；Step3 实现 pvp-record.ts + main.ts 各点接入；Step4 `npx vitest run tests/pvp-record.test.ts` PASS + typecheck 无新错；Step5 全量回归；Step6 commit `feat(pvp-web): 本方输入点打点为 PvpAction`。
- 注：此时 `pvpSync` 仍为 null（T6 才赋值），故 `pvpSync?.record` 休眠，不影响单人。

---

## Task 6：`onPvpMatched` 建双 Battle + tick 循环 + digest(补 kills)

**Files:** Modify `web/src/main.ts`（`onPvpMatched` `:284`，新增 `startPvpBattle`/`pumpPvpTick`）、`web/src/battle.ts`（`snapshot` 补 `kills`）；验收=浏览器冒烟

`onPvpMatched(ms)`：注入本方配装（同 `newGame`）建 `battle = new Battle(ms.seed, …, { enabled:true, delayTicks:DELAY_TICKS })`；建 `oppBattle = new Battle(ms.seed, …, { enabled:true })`（对手侧；配装暂用对称占位，若 MatchStart 未带对手 loadout 见下注）；`pvpSync = new PvpSync({...startAtServerMs, delayTicks, now: performance.now})`；`spendStamina(STAMINA_COST)`（开打才扣）；`screen='battle'`；启 tick 轮询（1s + 出站非空 ~300ms 去抖 flush）。`pumpPvpTick`：组 digest（`battle.snapshot()`→`{wave,power:towerPow,kills,tangsengHP,peach,units}`）→ `versusTick(pvpSync.buildTick(...))` → `pvpSync.applyResponse` + 存 `nextWave`(T9)/`result`(T10)/`opponentStatus`/`cheatNotice`。

- **battle.ts `snapshot` 补 `kills`**：加一个累计击杀计数器（`creditKill`/`creditAiKill` 处自增 `this.kills`），`snapshot` 暴露 `kills`。仅加字段，不改既有行为。
- **对手 loadout 注入**：`MatchStart`（服务端 `_match_start_payload`）目前只带 opponent 档案(uid/昵称/头像/段位)，**未带对手配装/功德/神兵**。全保真需要它们（否则 oppBattle 战力不等于对手真实战力）。→ **本任务先用对称占位（oppBattle 用本方同款 loadout）跑通对打**；真实对手 loadout 的传输作为 **T6 的 DONE_WITH_CONCERNS 记录**，在 T9 或专门小任务里扩 `_match_start_payload` + `pvp-client` 类型（服务端已是我们的代码，加字段即可）。

- [ ] Step1 `snapshot` 补 kills（+测试断言 kills 随击杀增长）；Step2 `startPvpBattle`+`pumpPvpTick`（tick 轮询/去抖/失败计数>6s 提示）；Step3 typecheck+build；Step4 浏览器冒烟（mock tick 返回对手一条 place → 见「验收」，断言进 battle、体力扣5、0 pageerror；此时对手动作应用在 T7，本任务先验证建局+tick 往返不崩）；Step5 commit。
- **DONE_WITH_CONCERNS 预期**：对手 loadout 未传输（用占位），记录待 T9/小任务补。

---

## Task 7：oppBattle 延迟步进 + 对手动作应用

**Files:** Modify `web/src/main.ts`（`onPvpSimTick` 填实现；`frame()` 固定步长循环里加 oppBattle 延迟步进）、`web/src/battle.ts`（3 处 pvp 微门 + `applyPvpInput`）；Test `web/tests/battle.pvp-input.test.ts`

- **`battle.ts` 三处 pvp 微门（关键：双 Battle 模型下两实例都不用自己的 `ai*` 侧）**——均 `if(this.pvp)` 门控、单人零影响：
  1. `updateAi(dt)` 首行加 `if (this.pvp) return;`——pvp 时整段跳过（本方 `ai*` 由渲染桥从 oppBattle 覆盖；oppBattle 的 `ai*` 不用）。同时避免本地 AI 规划器的 `performance.now()` deadline（:5346，非确定源）进入。
  2. `spawnMonster` 的对手侧 push（`this.aiMonsters.push(...)`，约 :5192/:5210）门控为 `if (!this.endless && !this.pvp)`——pvp 不往不用的 `ai*` 侧出怪（对手怪来自 oppBattle 自己的 `this.monsters`）。
  3. `checkOpponentDefeated()` 首行加 `if (this.pvp) return false;`——pvp 终局由**服务端 result** 裁决（本方 `status='lost'` 唐僧死仍本地触发并上报，但「胜」不由本地 `aiDefeated` 决定）。
- **`battle.ts applyPvpInput(a)`**：把 `PvpAction` 映射到**本实例本方侧**的既有输入方法：`summon→this.summon()`、`place→this.placeFromTray(index,cell)`、`move→this.dragBoard(from,to)`、`merge→this.mergeTrayTokens`、`recall→this.recallToTray`、`shovel→this.useShovelOn`、`active→this.triggerActive/applyPillActive/placeBomb`、`autoplace→this.autoPlaceTray()`（或逐格 place 落格清单）、`startWave→this.startNextWave()`、`claimDrop→this.claimWeaponPickup`。用于把对手动作施加到 `oppBattle`（其本方侧=对手）。**严格按 t 升序调用**。
- **main.ts `onPvpSimTick`**（每本方固定子步后）：推进 oppBattle 的延迟时钟——当 `battle` 已步进到 simTick T，oppBattle 应步进到 `T-DELAY_TICKS`；即维护 `oppBattle` 的步数落后 DELAY_TICKS。用 `pvpSync.aiSimTick()` 作目标：`while (oppSimTick < pvpSync.aiSimTick()) { for (const a of pvpSync.takeReady(oppSimTick)) oppBattle.applyPvpInput(a); oppBattle.step(PVP_SIM_DT); oppSimTick++; }`。（takeReady 已按 t 升序。）

- [ ] Step1 失败测试：对 pvp `Battle` 调 `applyPvpInput({op:'summon',tray:[...]})`+`{op:'place',...}` → 其本方侧 `units` 出现该单位。Step2 FAIL。Step3 实现 `applyPvpInput` + `onPvpSimTick` 延迟步进。Step4 测试 PASS + 全量回归（单人不受影响）。Step5 浏览器冒烟：mock tick 喂对手 place → 经 DELAY 后对手侧（桥接后，见 T8）或 oppBattle 本方侧 units 出现。Step6 commit。
- 注：本任务 oppBattle 已在跑并被喂动作，但**尚未渲染到对手侧**（T8 桥）；本任务可先断言 `oppBattle.snapshot()` 反映对手动作。

---

## Task 8：渲染桥（oppBattle.this* → battle.ai*）+ 插值

**Files:** Create `web/src/pvp-bridge.ts`；Modify `web/src/main.ts`（frame 渲染前调桥）、必要时 `web/src/battle.ts`（暴露只读 getter）；Test `web/tests/pvp-bridge.test.ts`

`bridgeOpponent(battle, oppBattle)`：每帧把 oppBattle 本方侧映射进 battle.ai* 供 `drawAiSide` 渲染：
- 怪物：`battle.aiMonsters = oppBattle.monsters`（dist 沿 map.path，`battle.aiMonsterPos` 用 `aiPath=mirrorPath` 自动镜像到上半场——直接沿用，无需改 dist）。
- 单位：`battle.aiUnits = [...oppBattle.units.values()].map(u => ({ ...u, cell: mirrorCell(u.cell) }))`（fireDir 若需上下翻转则 `+π`）。
- 字牌：`battle.aiWords` 由 oppBattle.words 映射（cell 镜像）。
- 槽/道具：`battle.aiActiveSlots`/`aiPickedItems` = oppBattle 对应（供 `drawAiItemsHud`）。
- 唐僧：`battle.aiTangsengHP = oppBattle.tangsengHP`；`battle.aiDefeated = oppBattle.status==='lost'`。
- 落子动画：`battle.placeDropStagger.ai` 可从 oppBattle.player 侧桥接或接受轻微视觉差。

插值（可选增强）：存双方 prev/cur 位置，render 按 `pvpAcc/PVP_SIM_DT` 线性插值使固定步长下顺滑（纯函数 `lerpPos` 单测；PvP 门，不改单人）。

- [ ] Step1 失败测试：给 oppBattle 放一个单位 → `bridgeOpponent` 后 `battle.aiUnits[0].cell` == `mirrorCell(该单位格)`；oppBattle 一只怪 → `battle.aiMonsters` 含之。Step2 FAIL。Step3 实现 pvp-bridge.ts + frame 渲染前调用（仅 pvpSync 非空时）。Step4 测试 PASS + typecheck。Step5 **浏览器冒烟**：mock tick 喂对手 summon+place → 对手侧（上半场）确实画出对手单位/怪物；截图核对；0 pageerror。Step6 commit。

---

## Task 9：先清者定波次（服务端 nextWave 驱动两实例）

**Files:** Modify `web/src/battle.ts`（波间 `:6746-6754` 自动开波加 `if(!this.pvp)`）、`web/src/main.ts`（`pumpPvpTick` 处理 `nextWave` + 上报本方 `waveClearedAt`；到点对 `battle` 与 `oppBattle` 分别 `startNextWave`）；Test `web/tests/battle.pvp-wave.test.ts`

PvP 时两实例**都不本地自动开波**；由服务端 `nextWave.startAtServerMs`（对齐本地时钟）触发：`battle` 在其实时到点开波、`oppBattle` 在其延迟时钟到点开波。本方清波（`battle` 的 `monsters.length===0 && spawnRemaining===0`）→ 置 `waveClearedAt={wave,t:simTick}` 上报。

- [ ] Step1-2 失败测试（pvp 清波后 status='ready' 不自增 wave）。Step3 `step` 波间自动开波加 `if(!this.pvp)`；暴露 `consumeWaveCleared()`。Step4 main.ts：nextWave 换本地时刻、到点开两实例的波；上报清波。Step5 测试+回归。Step6 commit。
- （若做对手 loadout 传输：可在此扩 `_match_start_payload` + 类型，让 oppBattle 用真实对手配装。）

---

## Task 10：断线 / 认输 / 权威终局

**Files:** Modify `web/src/pause-popup.ts`（`context:'match'|'battle'`）、`web/src/main.ts`（暂停 `:1434`、终局入口 `:1981`、`pumpPvpTick` 的 `result`/`opponentStatus`）；Test `web/tests/pause-popup.test.ts`

- 暂停区 PvP `context:'match'`→「认输」；确认→`pvpSync` status=`surrender`、flush、等服务端 `result`。
- 本方唐僧血→0：`battle.status='lost'`，上报 `status:tangsengDead`，等服务端 `result`。
- 服务端 `result` 终局权威（reason ∈ `opponentTangsengDead/opponentSurrender/opponentDisconnectTimeout/selfTangsengDead/selfSurrender/selfDisconnect/draw`——注意含 `selfDisconnect`）→ 终局 + 进结算(T11)。PvP 时**用服务端 result 而非本地 `battle.status` 驱动结算**（复用 `endHandled` 门禁）。
- `opponentStatus:'disconnected'`→提示；本方 >6s 无成功 tick→提示「网络中断，可能判负」。

- [ ] Step1 pause context 失败测试+实现；Step2 认输 flush；Step3 result 驱动终局；Step4 断线 UI；Step5 测试+typecheck；Step6 commit。

---

## Task 11：PvP 结算分支

**Files:** Modify `web/src/settle.ts`、`web/src/main.ts`（结算入口后）；Test `web/tests/settle.pvp.test.ts`

胜/负/平 + 原因文案（含 `selfDisconnect`）+ 对手头像昵称（`avatarById`）；**不加减星/不触商人/不动境界功德**；返回首页清 `pvpSync`/`oppBattle`/`battle`、`screen='menu'`。

- [ ] Step1-2 失败测试（`drawPvpSettle`/`pvpSettleHitAt`）；Step3 实现；Step4 测试+浏览器冒烟（result:win→「胜利·对手唐僧被吃」→返回首页）；Step5 commit。

---

## Task 12：确定性单测

**Files:** Test `web/tests/pvp-determinism.test.ts`

- [ ] Step1 测试：①同 seed + 同动作流喂两独立 pvp `Battle` 实例，逐检查点 `wave/tangsengHP/units/towerPow` 一致（=双 Battle 保真的核心保证）；②固定步长 `1/60` vs `1/20` 切法同 seed 结果一致（`drainFixedSteps`）；③（若做插值）`lerpPos` 边界。Step2 PASS（不过=有非确定源潜入）。Step3 commit。

---

## Task 13：单人零回归 + 全门禁 + 浏览器冒烟

**Files:** 复用既有 + 断言 pvp=false 时 `updateAi`/主循环/`spawnMonster` 未变

- [ ] Step1 断言 PvP 关时行为不变（单人仍走本地 AI 决策、主循环可变 dt、spawnMonster 双推）。Step2 全门禁：`cd web && npx vitest run`（含 `ai-balance`/`versus-user-agent`）全过；`npm run typecheck 2>&1 | grep -E 'pvp|main\.ts|battle\.ts'` 无新错（battle.ts 报错数 == 基线 15）；`npm run build` 成功。Step3 浏览器冒烟真机路径：匹配→双 Battle 开打→对手动作延迟互见→(mock)先清定波→(mock)result 胜负→结算回首页；0 pageerror。Step4 commit。

---

## 验收：浏览器冒烟脚本（贯穿 T6/8/11/13）

puppeteer-core + 本机 Chrome + `window.__game.curScreen()`。dev server 独立端口（`npx vite --port 5185 --strictPort`，**勿** `./start.sh bg` 会杀 5180 主检出）。`page.evaluateOnNewDocument` mock `window.fetch` 的 `/api/versus/*`：enqueue→ticket、poll→matched(带 MatchStart)、**tick→对手动作(summon/place)/nextWave/result**。断言进 `battle`、对手侧经 DELAY 后画出对手单位/怪、体力扣5、result→结算、0 pageerror（过滤跨域 CDN/BGM 噪声）。画布跨域污染→不用 `getImageData`，用 `page.screenshot`+`curScreen()`。临时脚本用后即删（`web/tools/_pvp-*.mjs`）。

---

## 自检

- **spec 覆盖**：§5 同步（T1/2/5/7）、§5.3 先清定波（T9）、§6 引擎（构造 T3/主循环 T4/双Battle 对打 T5-8/波次 T9/胜负 T10）、§3.1 全保真延迟重放（双 Battle+桥 T7/8）、§30 各算各的（双 Battle 自动 D2）、§8 断线（T10）、结算（T11）、§13 测试（T12-13）。§7 端上交叉核对→Plan D（oppBattle 即现成重放）。
- **已知取舍/待补**：对手真实 loadout 未随 `MatchStart` 下发（T6 先对称占位，T9 或小任务扩服务端 `_match_start_payload`）——影响 oppBattle 对手战力精度，记录在案。
- **类型一致**：`PvpAction`/`Tick*`(T1)、`PvpSync`(T2)、`drainFixedSteps`/`DELAY_TICKS`(T4)、`toPvpAction`(T5)、`applyPvpInput`(T7)、`bridgeOpponent`(T8)。
- **风险**：渲染桥（T8，广度）与 oppBattle 延迟步进（T7）为主要新风险，均 `pvpSync` 门控隔离单人 + `ai-balance`/确定性门禁兜底；桥为显示层，冒烟可验。
