# 本地续玩存档（AI 对战 / 无尽 · 波次检查点）

**日期：** 2026-08-23
**状态：** 已批准（对话确认）
**分支：** `worktree-battle-resume-save`
**范围：** 单机本地对局（本地 AI 对战 `endless===false`、无尽 `endless===true`）刷新/关闭页面后自动续玩；**不含在线 PvP**（服务端/WS 权威，无法本地恢复）。

## 问题

对局是纯内存 `Battle` 对象，刷新即丢。玩家在一局对战/无尽打到一半刷新或误关，只能从头再来。需要让"刷新页面、下次重进"能**从上次离开时的状态继续**。

## 目标

- 本地 AI 对战 / 无尽局，刷新后**自动直接续玩**（跳过首页，不重复扣体力）。
- 恢复精度 = **波次检查点**：仅在两波之间的"准备"间歇（`status==='ready'`，场上无怪、无飞行物）落档。刷新丢失的最多是"正在进行中的那一波"，回到该波开头重打。
- 存档**仅本地**（localStorage / 微信 KV，复用 `storage.ts`），**不进云同步**。

## 非目标

- 不做精确续帧（不保存路上的怪/飞行中的炸弹/技能/瞬时特效）。
- 不支持在线 PvP 续玩（`battle.isPvp === true` 一律不落档、不恢复）。
- 不做跨设备续玩（云端只同步 rank/loadout 等元数据，对局态是设备本地实时状态）。
- 不改任何战斗数值 / AI 决策 / 波次生成逻辑。

## 现状（基线 `e41f032` 核对结论）

- **模式区分**：同一 `battle` 界面上有三种对局：
  - 本地 AI 对战：`newGame()`（`main.ts:1157`）构造，`endless=false`，**不传 `pvpInit`** → `isPvp=false`；本地 AI 对手 + 隐藏橡皮筋。
  - 无尽：同 `newGame()`，`endlessOn=true`；AI 对手被 `if (this.isPvp) return` 无关、无尽下 AI 逻辑本就短路。
  - 在线 PvP：走 `enterPvpMatching`/`onPvpMatched`，构造传 `pvpInit={enabled:true}` → `isPvp=true`，对手半场由 WS 快照重建。**排除在外**。
  - 判定信号：公开 getter `battle.isPvp`（`battle.ts:2248`）。
- **无现成存档**：`snapshot()` 只是数值/HUD 摘要（集合退化成 `.size/.length`），不可反序列化。`pvpOwnSnapshot()` 是**有损渲染插值快照**（fx 老化、怪 dist 插值），也不是全量存档——但其 units/monsters/words 的 JSON 化与镜像规则可作 `serialize()` 的**实现参考**（见 `pvp-snap.ts`）。
- **RNG**：`rng.ts` 的 `RNG` 是 mulberry32，唯一内部状态是私有字段 `s`。`Battle` 现持有 **4 条独立流**（构造 `battle.ts:2274` 起）：
  - `rng`、`aiRng`、`aiSpawnRng`（对手侧怪物独立流，**基线新增**）、`bossScheduleRng`。
  - 均由构造 `seed` 派生，为实例私有成员，**当前无 getter/setter**。
- **确定性重放不可行**：`step(dt)` 实时浮点、每帧交错抽取 4 条流，无法靠"种子+操作日志"重放。→ 走**全量核心状态快照**。
- **无对象循环引用**：怪物用数字 id（`nextMonsterId` 计数），单位/字牌/桃树放在 `"c,r"` 键的 Map 里，只带基元字段与 `cell`；跨引用（bite 目标等）都在可丢弃的特效字段里。Map/Set 转数组后 `JSON.stringify` 即可。
- **构造时"烘焙"**：`meta` 加成直接累加进 `peach/tangsengHP/mods/…`；`passives` 逐个 `applyItem` 改 `mods/peach/gardenOn`；`aiSkill` 经 `effectiveAiSkill(aiSkill, versusBand)` 缩放存 `this.aiSkill`；`aiWeaponBonuses` 由 `weaponBonuses` 缩放。→ **恢复时构造传中性参数，避免二次叠加，再用 core 覆盖**。
- **存储前缀**仍为 `dasheng.*`（改名「悟空救我」仅文案）。新键用 `dasheng.battleSave`。

## 方案总览

1. **`rng.ts`**：给 `RNG` 加读写内部状态的访问器（`get state()/set state(n)` 或 `getState()/setState()`）——唯一的引擎源码改动，只增只读能力、不改算法。
2. **`battle.ts`**：
   - `serialize(): BattleCoreState` —— 读全部核心可变字段（私有可访问），Map/Set 转数组，读 4 条 RNG 的 `s`；跳过特效/瞬时字段与 PvP 专用字段。
   - `applyCoreState(core: BattleCoreState): void` —— 逆向覆盖：数组还原 Map/Set、回填 4 条 RNG `s`、覆盖 `aiSkill/versusBand/aiWeaponBonuses/weaponBonuses`；特效数组留空。
3. **`battle-save.ts`（新）**：带版本号的存档结构 + localStorage 编排（复用 `storage.ts`）：
   - `writeBattleSave(battle, cfg)`、`readBattleSave(): BattleSaveV1 | null`（版本/schema/解析校验，失败返回 null）、`clearBattleSave()`、`hasResumableSave(): boolean`。
4. **`main.ts` 接线（三处）**：
   - **存**：主循环检测 `status` 进入 `ready` 落档（去重）。
   - **清**：胜负结算 / 放弃退出 / 开新局时 `clearBattleSave()`。
   - **取**：启动时若有有效存档 → 重建 battle 直接进 `battle` 界面。

## 存档数据结构（versioned）

```ts
const SAVE_KEY = 'dasheng.battleSave';
const SAVE_VERSION = 1;

interface BattleSaveV1 {
  v: 1;                 // schema 版本；不等即丢弃
  gameVersion: string;  // version.ts；跨版本更新丢弃旧档
  savedAt: number;
  mode: 'versus' | 'endless';
  config: {             // 仅用于重建地图几何/派生缓存与构造骨架
    mapId: string;
    difficultyMul: number;
    endless: boolean;
    aiAdjustIntervalScale: number;
  };
  core: BattleCoreState; // 全量可变状态（见下）
}
```

`BattleCoreState`（核心可变字段，按类分组；权威清单在实现时对照 `battle.ts` 字段区最终敲定）：

- **血量/波数/状态**：`tangsengHP/tangsengMaxHP/aiTangsengHP`、`aiDefeated`、各 `*HurtImmuneT`、`healUsedThisWave/aiHealUsedThisWave`、`wave`、`status`、`waveActive`、`introT/introDone`、`nextWaveTimer`。
- **经济**：`peach/aiPeach`、`shovels/aiShovels`、`summonCost/aiSummonCost`、`summonCount/aiSummonCount`、各 `summonsSince*` 与 `earlySummon*` 计数（两侧）、`wordCharCounts/aiWordCharCounts`、`aiSummonTimer`、`shovelTimer/aiShovelTimer`、`plantTimer/plantBank`、`gardenOn`。
- **棋盘/怪物**：`units`、`words`、`trees`、`unlocked`、`generalStates`、`aiUnits`、`aiWords`、`aiUnlocked`、`aiGeneralStates`、`lastActivePairKeys/lastAiActivePairKeys`、`tray/aiTray`、`monsters/aiMonsters`（`ready` 时应为空）、`nextMonsterId`、`bombs/aiBombs`。
- **波次调度**：`spawnRemaining/spawnTimer`、`waveMonsterCount`、`sinceLastElite`、`cavalryWave/cavalryWaveRatio`、`waveMiniBoss/miniBossSpawnIdx`、`wavePressure`、`heroBossTimer/heroBossSpawnsThisWave`、`bossWaves`、`bossScheduleThrough`。
- **buff/技能/道具**：`mods/aiMods`、`aiFrqMul`、`activeSlots/aiActiveSlots`、`aiOffensiveDelay`、`meteorPending/aiMeteorPending`、`pickedItems/aiPickedItems`、`passivesFlashedAtStart`。
- **掉落/配对/AI 簿记**：`pendingWeaponPickups`、`battleFragmentDropId/battleFragmentDropped`、`matchedHeroIdsThisGame/aiMatchedHeroIdsThisGame`、`heroMatchWaves/aiHeroMatchWaves`、`forceMatchThisGame/aiForceMatchThisGame`、`recentMatchedHeroIds`、`aiRepositionTimer/aiLastRepositionPair`、`wasDangerNear`。
- **强度快照（直接存已解析值，覆盖用）**：`aiSkill`、`versusBand`、`weaponBonuses`、`aiWeaponBonuses`。
- **RNG 活状态（4 条）**：`rng.s`、`aiRng.s`、`aiSpawnRng.s`、`bossScheduleRng.s`。

**不保存**（恢复后 `step()` 自然重建或重挂）：

- 全部特效/瞬时字段：`fx/bursts/heroUltFx/bombFx/peachFloats/damageFloats/digFx/aiDigFx/placeDropFx/*PushFx/*SkillFx/erlangDogFx`、各 `*Flash`、`summonAnimT`、`sfxEvents`、一键布阵回放机（`autoPlace*Recorder/Recording/Playback/…`）、`message`、`pendingPlace/aiPendingPlace` 等。
- 地图派生几何/距离缓存（构造重建）：`map`(存 `mapId`)/`pathLen`/`slotOrder`/`aiPath/aiPathLen/aiCells/aiTangseng`/`entranceDist`/各 `*ByCell` 缓存/`difficultyMul`/`endless`。
- PvP 专用字段（本地局恒为默认）：`pvpOppTongxinBonusApplied` 等。
- 注入型函数字段 `weaponPickupVisible`（恢复后由 `main.ts` 重挂）。

## 恢复流程

```
读 BattleSaveV1 → 校验 v / gameVersion / 解析 → 失败即丢弃、进 menu

有效：
1. battle = new Battle(
     seed=任意,                         // RNG 会被 core 覆盖，seed 仅供构造不崩
     config.difficultyMul,
     mapById(config.mapId),
     NO_META,                           // 不二次叠加 meta
     {},                                // 空 weapons：aiWeaponBonuses 由 core 覆盖
     [], [],                            // 空 actives/passives：activeSlots/mods 由 core 覆盖
     config.endless,
     DEFAULT_AI_SKILL,                  // 中性占位，被 core 覆盖
     config.aiAdjustIntervalScale,
     undefined,                         // heroMatch
     undefined,                         // pvpInit → 本地局 isPvp=false
   );
2. battle.applyCoreState(core);         // 覆盖全部可变字段 + 4 条 RNG s + aiSkill/versusBand/aiWeaponBonuses
3. bindBattleWeaponPickup();            // 重挂 weaponPickupVisible 闭包（同 newGame 后）
4. endlessOn = config.endless; endHandled=false; settleChange=null; … // 复位与 newGame 一致的 UI/循环标志
5. screen = 'battle';                   // 直接进战斗，跳过 menu，不扣体力
```

> 注意：构造内非 PvP 分支会 `rollAiLoadout` 消费 `aiRng` 并写 AI 装备/技能字段——这些字段与 `aiRng.s` 都在第 2 步被 core 覆盖，故构造期的消费无影响。

## 生命周期（何时存 / 清）

- **存**（主循环，本地局）：追踪 `prevStatus`，当 `status` 由非 `ready` 变为 `ready` 时（含开局 6s intro-ready 与每次清波后）落档；用 `(mode, wave)` 去重，`ready` 窗内只写一次。守卫：`!battle.isPvp && status==='ready' && status!=='won'/'lost'`。
- **清**：
  - 胜负结算（`endHandled` 分支，胜/负各一次）→ `clearBattleSave()`。
  - 暂停→确认退出 `abortBattleToMenu()`（已含 `endPvpSession()`，同处补清）→ `clearBattleSave()`。
  - `newGame()` 开新局前 → `clearBattleSave()`（旧档立即失效，随后首个 ready 再落新档）。
- **取**（启动 IIFE，元数据加载后、原 `screen='menu'` 之前）：`hasResumableSave()` 且有效 → 走恢复流程置 `screen='battle'`；否则照旧 `screen='menu'`。

## 关键取舍与边界

- **跨版本丢档可接受**：`v`/`gameVersion` 不匹配即静默丢弃，避免旧结构反序列化崩溃。波次检查点方案下损失有限（最多丢一局在建对局）。
- **不重复扣体力**：续玩不经 `handleMenu('start')`→`spendStamina`，直接重建 battle。
- **PvP 隔离**：存/取/清所有入口都以 `!battle.isPvp` 为前提；PvP 局永不落档，PvP 存档也不会被写出。
- **仅本地**：`SAVE_KEY` 不加入 `cloud-sync.ts` 的 `KEYS`。
- **触碰 `battle.ts` 的验证义务**：虽只加只读序列化，仍按项目规矩过 `ai-balance` 门禁证明战斗/AI 行为未变。

## 测试与验收

vitest（放 `web/tests/`，在 `web/` 目录跑）：

1. **序列化往返**：构造 battle → 推进到某 `ready` 状态 → `serialize()` → `applyCoreState` 到新实例 → 断言 core 字段深度相等（HP/wave/peach/units 内容/unlocked/tray/aiUnits/generalStates/bossWaves/4×RNG.s）。
2. **恢复后确定性等价**：同 seed 两 battle，A 在某 `ready` 存档并恢复进 B；A、B 用相同输入各步进 N 帧 → 断言 HP/wave/胜负一致（证明 4 条 RNG 恢复正确）。
3. **无尽往返**：`endless=true` 同样通过。
4. **守卫**：版本不匹配 / 损坏 JSON → `readBattleSave()` 返回 null；胜负后存档被清；PvP battle（`isPvp=true`）不产生存档。
5. **门禁**：`ai-balance.test.ts` 通过；不新增 tsc 报错（基线本就有 ~28 处既有报错，看"不新增"）。

真机浏览器冒烟（puppeteer-core + 本机 Chrome + `window.__game` 钩子）：

- 开本地 AI 对战 → 清一波进入 ready → 刷新 → 确认自动续玩、波数/阵容/血量一致、体力未重复扣。
- 无尽同样验证。
- （回归）在线 PvP 局刷新 → 确认**不会**误续玩、行为同现状。

## 交付流程

worktree `worktree-battle-resume-save` 内：本 spec 提交 → 进入 writing-plans 出实现计划 → 实现 → 单测 + ai-balance 门禁 + 浏览器冒烟 → 收尾前按 `parallel-worktrees-rebase-before-finish` 看是否与 main 分叉、必要时 rebase。
