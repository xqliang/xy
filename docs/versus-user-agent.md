# 对战用户代理 · 批量模拟

Headless 模拟真实玩家操作（征兵 → 布阵 → 主动技能），连续跑多局对战，统计胜率、波次与 AI skill 漂移。用于验证：

- 跨局 AI skill ±1 随机轮换是否顺畅
- 隐藏 rubber-band（连胜加压 / 连败减压）是否生效
- 玩家长期胜率是否略高于 AI（目标约 70%）

**不消耗体力**，**不需要浏览器**，纯 `Battle` 引擎 + vitest。

---

## 一键运行（推荐）

在项目根目录：

```bash
./start.sh versus-agent
```

默认 **20 局**、种子 **42000**、**10×** 游戏时钟快放（单局 sim 约 50–120 秒，20 局 wall clock 约半分钟）。

### 自定义局数与种子

```bash
./start.sh versus-agent 20 42000   # 20 局，seed 42000
./start.sh versus-agent 50 1000    # 50 局，seed 1000
```

---

## 等价命令（在 web 目录）

```bash
cd web
npm run versus-agent

# 或指定环境变量
VERSUS_AGENT_GAMES=20 VERSUS_AGENT_SEED=42000 npm run versus-agent
```

CLI 包装：

```bash
node web/tools/versus-agent.mjs 20 42000
```

---

## 模拟的用户行为

每 tick（`dt = (1/30) × 10` 秒游戏时间）：

| 步骤 | 对应 UI | 代码 |
|------|---------|------|
| 波间/入场 | 点「开战」 | `battle.startNextWave()` |
| 够桃 | 点「征兵」 | `battle.summon()` |
| 候选区有牌 | 点「布阵」 | `battle.autoPlaceTray()` |
| 技能就绪 | 点主动技能 | `battle.triggerActive(i)` |

局结束后（等同关闭神秘商人、开下一局的前置逻辑）：

- `recordVersusOutcome(won)` — 更新连胜/连败
- `nextAiSkill(skill, won)` — 跨局 AI 强度控制器
- 下一局 `rollMatchAiSkill(skill ±1)` 随机本局 AI

---

## 输出示例（20 局，seed 42000）

```
── 对战用户代理 · 批量结果 ──
局数: 20  胜: 11  负: 9  超时: 0
玩家胜率: 55.0%  (目标长期 ~70%)
AI skill: 1.000 → 0.820  [0.802, 1.024]
平衡判定: 通过

逐局:
  #1 seed=42000 胜 波=4 AI=0.94 ...
  #2 seed=42001 负 波=4 AI=1.00 ...
  ...
平均波次: 4.05  分布: 3波×1, 4波×17, 5波×1, 6波×1
```

### 波次说明

对战模式**不是「清 N 波就赢」**，而是**打掉对方唐僧 HP** 才分胜负。因此：

- 多数对局在 **第 3–6 波** 内结束（上表以 **第 4 波** 为主，占 17/20 局）
- 「胜」= 在该波次击杀 AI 唐僧；「负」= 在该波次己方唐僧被破
- 最长一局约第 6 波（sim ~124s）；最快约第 3 波（sim ~48s）

---

## 相关源码

| 文件 | 说明 |
|------|------|
| `web/src/versus-user-agent.ts` | 用户代理与 `runVersusSession()` |
| `web/tests/versus-user-agent.test.ts` | vitest 入口 + 断言 |
| `web/src/ai-skill.ts` | AI skill 控制器、rubber-band |
| `web/tests/ai-balance.test.ts` | 更早的 16 局宏观平衡测试 |

### 可调参数

在 `versus-user-agent.ts`：

- `DEFAULT_SPEED_MUL = 10` — 快放倍率
- `DEFAULT_FRAME_CAP = 60 * 30` — 单局最大 tick（防 hang）

在 `ai-skill.ts`：

- `AI_TARGET_WINRATE = 0.7` — 长期目标胜率
- `STEP_K = 0.06` — skill 调节步长

---

## 与浏览器自测的区别

| 方式 | 命令 | 场景 |
|------|------|------|
| **Headless 代理** | `./start.sh versus-agent` | 批量平衡、胜率/波次统计 |
| **浏览器钩子** | `./start.sh dev` + `window.__game` | 截图回归、UI 交互 |
| **Puppeteer 工具** | `web/tools/multiseed.mjs` | 需先 `dev`，多 seed 胜率 |

Headless 代理**不打开神秘商人 UI**，但局间 streak / AI skill 与真实结算一致。
