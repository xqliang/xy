# 怪物技能参考

日期：2026-08-17  
代码来源：`web/src/battle.ts`（`SKILL_META`、`MAP_SKILL`、`MINI_BOSS_META`、`rollMonsterSkill`、`updateMonsterSkills`、`castMiniBossSkill`、`applyDebuff`、`applyUnitStatus`）

本文档梳理**怪物对我方兵器的控制/减益**与**小 Boss 光环**两套独立系统，并回答「让兵器倒下（击倒）技能好像没释放」的排查结论。

---

## 0. 结论速览（击倒排查）

- **不是 bug。** 「倒下 / 击倒（knockdown）」逻辑完整且已被测试覆盖：`tests/mini-boss.test.ts › quake mini-boss can knock down nearby weapons` 通过，`castMiniBossSkill('quake') → applyUnitStatus(u,'knockdown')` 正确置 `knockdownT`，渲染也有「横躺压扁」表现（`render.ts` `fallen`）。
- **看不到的真正原因是触发面太窄。** 击倒**只**由 `quake`（撼地妖）这一种小 Boss 提供，而小 Boss：第 5 波起才出现、非 BOSS 波 50% 概率、种类 5 选 1 均匀随机。综合命中率 ≈ `0.5 × 1/5 = 10%`（第 5 波起的非 BOSS 波），作用半径 2 格。
- **对比：其余 4 个控制（定身/迟滞/弱身/缠丝）是「地图专属精英技」**，该图每个精英/妖王都带、频繁释放，所以玩家常看到；击倒被塞在稀有随机小 Boss 里，自然显得「没出现」。这是**结构性稀有**，非功能缺陷。

> 若想让击倒更常见（属于**平衡调整**，本次未改）：提高 `quake` 权重（改成非均匀抽取）、提高小 Boss 概率/半径、或把「倒下」也做成某张地图的精英主题技。

---

## 1. 系统一：地图专属精英 / 妖王减益（对兵器）

- 技能类型：`MonsterSkill = stun | slow | weaken | webbind`（`battle.ts:349`），**不含击倒**。
- 分配（`rollMonsterSkill`）：技能**按地图主题固定**，不是随机三选一。
  - **妖王（Boss）必带**该图技能。
  - **精英**：第 `eliteFromWave=4` 波起，`eliteChance=0.28` 概率带同一技能，且两次精英间至少隔 `eliteMinGap=2` 只普通妖（防连控）。
- 释放（`updateMonsterSkills`）：入场后 `skillFirstDelay=2.5s` 首次，之后每 `skillInterval=4.5s` 一次；每次在 `skillRadius=2` 格内按距离取最近 `1~3` 把兵器（`skillTargetMin=1`、`skillTargetMax=3`）。
- 同种免疫：命中后该兵器对**同一种** debuff 免疫 `debuffImmuneDur=4.5s`（含效果持续期）。

| 地图 | 技能（`MAP_SKILL`） | 名称 | 对兵器效果 | 时长 | 幅度 |
|------|------|------|-----------|------|------|
| 白骨岭 baiguling | `stun` | 定身 | 无法出手 | `stunDur=1.4s` | 完全停手 |
| 流沙河 liushahe | `slow` | 迟滞 | 攻击间隔拉长 | `slowDur=3s` | 冷却 ×`slowCooldownMul=1.6`（≈攻速×0.63） |
| 火焰山 huoyanshan | `weaken` | 弱身 | 攻击力削弱 | `weakenDur=3s` | 伤害 ×`weakenAtkMul=0.65` |
| 盘丝洞 pansidong | `webbind` | 缠丝 | 有效射程削减 | `webbindDur=3.5s` | 射程 −`webbindRangeCut=0.5` 格（最低 0.5） |

> 未配置 `MAP_SKILL` 的地图回退为 `stun`。

---

## 2. 系统二：跨地图小 Boss 光环（`MiniBossKind`）

- 种类：`frost | blight | quake | gale | blood`（`battle.ts:358`），与地图精英技能**独立**。
- 出现：第 `miniBossFromWave=5` 波起、**非 BOSS 波** `miniBossChance=0.5` 概率刷 1 只（顶替 1 只普通怪）；**种类 5 选 1 均匀随机**（`waveMiniBoss = MINI_BOSS_KINDS[rng.int(5)]`）。血量 ×`3.5`、移速 ×`0.82`。
- 释放（`castMiniBossSkill`）：入场后 `miniBossFirstDelay=2.0s` 首次，之后每 `miniBossInterval=4.0s` 一次。
- 作用半径：`frost/blight/quake` 用 `skillRadius=2`（对兵器，取最近 1~3 把）；`gale/blood` 用 `miniBossRadius=2.8`（对周围妖怪）。

| 种类 | 妖名 / 技能 | 作用对象 | 效果 | 关键数值 |
|------|------------|---------|------|---------|
| `frost` | 霜魄妖 / 霜缚 | 我方兵器 | 上「迟滞」= 减速 | 同上 slow：`slowDur=3s`、冷却×1.6 |
| `blight` | 蚀甲妖 / 蚀甲 | 我方兵器 | 上「弱身」= 降攻 | 同上 weaken：`weakenDur=3s`、伤害×0.65 |
| **`quake`** | **撼地妖 / 震地** | **我方兵器** | **上「倒下 / 击倒」= 无法攻击、立绘横躺** | **`knockdownDur=2.0s`、免疫 4.5s** |
| `gale` | 疾风妖 / 疾风 | 周围妖怪 | 加速（haste） | `hasteDur=3.0s` |
| `blood` | 血泉妖 / 血泉 | 周围妖怪 | 回血 | 每次回目标 `maxHp×healPct(=0.08)` |

---

## 3. 触发频率对照（为何击倒最少见）

| 控制类型 | 来源 | 起始波 | 触发面 | 直观频率 |
|---------|------|-------|--------|---------|
| 定身/迟滞/弱身/缠丝（4 选 1 按图固定） | 地图精英 + 妖王 | 第 4 波（妖王更早） | 该图**每个**精英/妖王都带 | **高**，稳定常见 |
| 迟滞 / 弱身（小 Boss 版） | `frost` / `blight` 小 Boss | 第 5 波 | 各 ≈10% 的合格波 | 中低 |
| **倒下 / 击倒** | **仅 `quake` 小 Boss** | **第 5 波** | **≈10% 的合格波，半径 2 格、命中 1~3 把** | 中低 |
| 妖怪加速 / 回血 | `gale` / `blood` 小 Boss | 第 5 波 | 各 ≈10% 的合格波（作用于怪，非兵器） | 中低 |

---

## 4. 相关状态在兵器侧的消费点（便于验证）

- 停手：`updateUnits` 中 `if (u.stunT > 0 || u.knockdownT > 0) continue;`（眩晕/倒下本帧不攻击、冷却不推进）。
- 减速：攻击冷却 `× slowCooldownMul`（`u.slowT > 0`）。
- 降攻：伤害 `× weakenAtkMul`（`u.weakenT > 0`）。
- 缠丝：有效射程 `stat.rge − webbindRangeCut`（`u.rangeCutT > 0`）。
- 渲染：`render.ts` 按 `UNIT_STATUS_META` 取色/图标；倒下额外「横躺 + 压扁」（`fallen = u.knockdownT > 0`）。
