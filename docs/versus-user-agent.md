# 对战用户代理 · 批量模拟与平衡口径

Headless 模拟真实玩家操作（征兵 → 布阵 → 主动技能），连续跑多局对战，统计胜率、波次与 AI skill 漂移。用于验证：

- 跨局 AI skill ±1 随机轮换是否顺畅
- 隐藏 rubber-band（连胜加压 / 连败减压）是否生效
- 玩家长期胜率是否略高于 AI（目标约 **60%**）
- 分胜负波次是否落在目标档位附近

**不消耗体力**，**不需要浏览器**，纯 `Battle` 引擎 + vitest。

---

## 一键运行

```bash
./start.sh versus-agent           # 默认 20 局，seed 42000
./start.sh versus-agent 50 1000   # 50 局，seed 1000
```

默认 **10×** 快放：每 tick = `speedMul` 个 `1/30s` **物理子步**（禁止一次喂大 `dt`，否则同帧多漏怪、少开火，平均约 4 波就假结束）。空 loadout 代理征兵/布阵间隔默认 **0.75s**（贴近人手）。

等价：

```bash
cd web && VERSUS_AGENT_GAMES=20 VERSUS_AGENT_SEED=42000 npm run versus-agent
# 或
node web/tools/versus-agent.mjs 20 42000
```

---

## 波次目标（真人手感）

对战**不是「清 N 波就赢」**，而是打掉对方唐僧 HP。「胜/负」落在该波次。

| 玩家档 | 期望分胜负波次 |
|--------|----------------|
| 初级（空/弱配） | 6–8 |
| 普通 | 8–10 |
| 中级搭配 | 11–15 |
| 高级 | 15+ |

Headless 代理 = 空 loadout + 节流自动布阵，接近「初级～普通」。修子步进与早期压力后，典型平均约 **7–8 波**（分布约 6–11），不再是旧文档的 ~4 波。中高段仍主要靠真人配装拉长对局。

---

## 对战平衡参数（影响真人对局）

下列常量会改浏览器内实际体验，不只是测试脚本。

### 唐僧与前期

| 参数 | 值 | 说明 |
|------|-----|------|
| `TANGSENG_INITIAL_HP` | **3** | 唐僧初始血量（道具可再加） |
| `eliteFromWave` | **4** | 第 4 波起可能刷精英 |

怪物血量、骑兵波、分圈难度等完整常量见 [`hero-combat-reference.md` §9](./hero-combat-reference.md#9-波次压力怪物血量与移速tuning--board-powerts2026-08-12)。

### 压力比（恒定）

出怪数量预算与 Boss 血参考均用 `pressureRatioForWave(wave)`（`web/src/board-power.ts`），现返回**恒定** `PRESSURE_RATIO`：

| 参数 | 值 |
|------|-----|
| 压力比（全波次一致） | **60%** |

「随波变难」已完全交给 `effectiveDifficulty` 分圈曲线（见 [`hero-combat-reference.md` §9.5](./hero-combat-reference.md)），压力比不再按波爬升——避免「按波加压」在两个旋钮上重复。

相关常量：

- `PRESSURE_FROM_WAVE = 6` — 第几波起按最优 DPS 抬量 / 允许叠怪批次
- `PRESSURE_RATIO = 0.60` — 承压比（恒定，全波次一致，DevTools 可调）

### AI 节奏

| 参数 | 值 | 说明 |
|------|-----|------|
| AI 兵器调位 | **1–2.5s**（正常对局） | 战中动态换位节流 |
| AI 配对字调位 | **0.3–0.5s** | 待补英雄字时更快；`AI_TIMING.partnerAdjustMin/Max` |
| AI 调位快放缩放 | **×0.1** | 仅 versus-agent（10× 子步进） |
| AI 征兵基准间隔 | **1.2s**（skill=1） | `skillToKnobs`；skill 越高越快，下限 0.6s |
| 自动部署播放期间 | 暂停征兵 | `aiAutoPlacePlaying` 为真时跳过 `aiSummon`，避免播放中的落子被新一轮快照覆盖 |
| 布阵 steps / guard | **150 / 300** | 与玩家一键布阵相同（`AI_PLACE_MAX_*` = `PLAYER_PLACE_MAX_*`） |
| 孤儿单字上限 | **4** | `AI_MAX_ORPHAN_WORDS`；玩家一键布阵同样启用 |

征兵侧与玩家对齐的规则（字/铲/半对保底、英雄匹配保底、音系软压、近局降重等）见权威文档 [`docs/hero-combat-reference.md`](./hero-combat-reference.md) §8。

### 胜率控制器

| 参数 | 值 |
|------|-----|
| `AI_TARGET_WINRATE` | **0.6** |
| `STEP_K` | 0.06（胜 +0.4k / 负 −0.6k） |
| 空 loadout `aiItemBonus` | 生效，但道具数仍封顶 `EMPTY_PLAYER_ITEM_CAP=2` |

---

## 仅影响代理（不影响真人 UI）

| 参数 | 值 | 说明 |
|------|-----|------|
| `DEFAULT_SPEED_MUL` | 10 | 外层 tick 内物理子步数 |
| `actionInterval` | 0.75s | 代理征兵/布阵/放技能节流 |
| `DEFAULT_FRAME_CAP` | 60×30 | 单局最大外层 tick |

每外层 tick：

| 步骤 | 代码 |
|------|------|
| 开战（立即） | `startNextWave()` |
| 征兵/布阵/技能（节流） | `summon` / `autoPlaceTray` / `triggerActive` |
| 物理 | `battle.step(1/30)` × `speedMul` |

局间：`recordVersusOutcome` → `nextAiSkill` → 下局 `rollMatchAiSkill(±1)`。

---

## 相关源码

| 文件 | 说明 |
|------|------|
| `web/src/versus-user-agent.ts` | 用户代理与 `runVersusSession()` |
| `web/tests/versus-user-agent.test.ts` | vitest 入口 |
| `web/src/ai-skill.ts` | AI skill、rubber-band、目标胜率 |
| `web/src/board-power.ts` | `pressureRatioForWave`、出怪压力、`MONSTER_HP_*` |
| `web/src/battle.ts` | 怪物 HP/移速、骑兵波、分圈 `endlessCycleStep`、精英波 |
| `web/src/autoplace.ts` | 布阵预算、孤儿上限 |
| `docs/hero-combat-reference.md` §8 | 玩家/AI 征兵与布阵对称规则（权威） |

---

## 与浏览器自测的区别

| 方式 | 命令 | 场景 |
|------|------|------|
| **Headless 代理** | `./start.sh versus-agent` | 批量平衡、胜率/波次 |
| **浏览器** | `./start.sh dev` + `window.__game` | 截图 / UI |
| **Puppeteer** | `web/tools/multiseed.mjs` | 需先 `dev` |

Headless **不打开神秘商人 UI**，但局间 streak / AI skill 与真实结算一致。
