# 自适应 AI 对手（真玩家化）+ 智能自动布阵 —— 设计规格

日期：2026-08-06

## 背景

`xy` 是"伪竞技"塔防：玩家与镜像 AI 对手各守一侧唐僧，面对同步镜像的怪物波次；胜负 = 哪侧唐僧先阵亡
（或玩家清完最后一波即胜）。当前两处待优化：

1. **AI 对手是"抽象镜像"而非真玩家**：它不吃桃、不征兵、不用铲、无字牌武将；只是每波按
   `aiDeployBase+wave·per` 直接凭空铺 N 个兵到镜像格，靠一个"清场爆发"（`aiHeroEnergy`）兜底。强度固定、
   与玩家玩法不对称，胜率随玩家成长漂移。
2. **自动布阵粗糙**（`autoPlaceTray`）：无理想位即**丢弃**兵/铲/字牌；铲子只挖第一格；兵放"第一个空格"
   而**无视攻击范围**（棍猴 rge1 与神箭手 rge3 一视同仁）。

## 目标

- **AI 真玩家化**：AI 拥有与玩家**同构**的经济与操作——相同初始桃、够桃才能征兵、相同征兵生成策略
  （仅 RNG 结果不同）、必须放到空槽、非空槽须先用铲、相同武将能力、相同升级/合成要求。
- **胜率调控**：长期玩家胜率收敛到约 70%，调控手段 = **AI 征兵速度** + **排兵最优解/次优解**；
  且**弱化 AI 时克制、不露痕迹**。
- **智能自动布阵**（玩家一键 & AI 共用最优策略）：不丢弃、优先用铲挖最优位、合成升级、按射程铺满、
  格子不足/够不着时改为升级。

## 决策（已与用户确认）

- **胜率控制**：仅跨局调节（局内 AI 强度固定，开局前依历史胜负微调）。
- **调控杠杆**：AI 征兵速度 + 排兵最优/次优解。
- **架构**：并行 AI 状态 + 共享纯函数；AI 策略入新 `web/src/ai-opponent.ts`（保留玩家侧现有路径，
  抽取战斗/布阵/合成等纯逻辑供两侧调用，接受少量重复以降风险）。
- **AI 经济**：基础经济——相同初始桃 + 相同击杀产桃，**无**玩家的摸金/杀敌加成/蟠桃园等 meta/道具加成。
- **移除** AI 旧的清场爆发（玩家无此机制 → 真对称）。
- **"合成英雄"**：同型同阶兵合成升阶 + 武将字牌按连读顺序摆放激活武将，两者都做。
- 追加约束：**打压 AI 不过头、不明显**。

---

## Part 1 —— AI 真玩家化

### 1.1 AI 平行状态（镜像玩家字段，去除 perks）

在 `Battle` 内新增 AI 侧状态（与玩家字段一一对应）：

| 玩家侧 | AI 侧 | 初值/说明 |
|---|---|---|
| `peach` | `aiPeach` | `INITIAL_PEACH`（无 meta `bonusPeach`） |
| `summonCost` | `aiSummonCost` | 同基值 + `summonCostStep` 曲线（无 `summonCostDelta` 道具） |
| `shovels` | `aiShovels` | `initialShovels`（2） |
| `tray` | `aiTray` | 各自 rng 抽取 |
| `words` | `aiWords` | 同激活规则 |
| `units` | `aiUnits` | 已存在 |
| `unlocked` | `aiUnlocked` | 初始镜像玩家 6 格；**仅经铲子扩展**（移除"部署即占格"） |
| `summonsSinceShovel` | `aiSummonsSinceShovel` | 铲子保底 |
| `summonCount` | `aiSummonCount` | 首次征兵保底 |

AI 用**独立随机源** `aiRng`（与玩家 seed 派生但不同流），保证"生成策略相同、结果不同"。

### 1.2 AI 经济（基础，仅初始桃 + 击杀桃）

- AI 击杀 `aiMonsters` 时按**基础** `PEACH_PER_KILL / PEACH_PER_BOSS / PEACH_PER_ELITE` 产桃入
  `aiPeach`（无 `mods.killBonus` 等玩家加成）。若玩家侧 `PEACH_PER_BLEED`（撞唐僧补偿）为基础机制则同样镜像，
  若为道具（舍身饲魔）则不镜像——实现时以"是否 meta/道具"为准。
- 无蟠桃园（玩家 passive）、无摸金（`shovelPeach`）。

### 1.3 AI 征兵（同生成策略，够桃才征）

- 复用 `drawSummonTray`（`aiRng` + 与玩家相同参数：`traySize`、`shovelChance`、`maxPerKey`、
  `firstSummon`、`forceShovel`（由 `aiSummonsSinceShovel`）、`allOpen`），以及相同的字牌转化
  （`wordDrawChance`，无 `wordRateBonus` 道具加成）。
- **仅当 `aiPeach >= aiSummonCost`** 才征；征后 `aiPeach -= cost`、`aiSummonCost += summonCostStep`。
- **征兵速度 = 难度杠杆之一**：两次征兵间存在冷却 `aiSummonInterval`（见 1.6），并非"够桃立刻征"。
  受下限约束，弱 AI 也保持可信的"人手速"。

### 1.4 AI 布阵（共用最优策略 + 最优/次优杠杆）

AI 每次征兵后运行**共享布阵策略**（Part 2）处理 `aiTray`：挖最优锁定格、合成升阶、按射程铺满、
字牌按连读激活武将、无位则改升级、绝不丢弃（留在 `aiTray`）。

- **排兵最优/次优 = 难度杠杆之二**：策略接收 `pSubOptimal`。`skill` 高 → 最优解；`skill` 低 → 以概率
  `pSubOptimal` 注入一次"次优动作"（放进非理想的可达格 / 偶尔跳过一次可行合成 / 偶尔挖较差格 /
  字牌顺序放错致本轮未激活）。`pSubOptimal` 有上限（见 1.6），保证**始终连贯、不露痕迹**。

### 1.5 AI 战斗（复用共享战斗逻辑）

- **单位攻击**：把 `updateUnits` 的纯攻击核心抽为 `tickUnitsAttack(units, monsters, path, {statProvider, rng, fx})`，
  玩家传入神兵/道具修正 + 特效，AI 传基础属性（现有 `updateAiUnits` 的行为）。
- **武将攻击/技能**：把 `updateGenerals` / `castGeneralSkill` 抽为按目标怪列表 + path + 属性提供者运行的共享逻辑；
  玩家折算神兵加成，AI 用基础值。武将技能本就是 CD 自动释放（无玩家输入），故 AI 天然获得同等武将能力。
- **移除** `aiHeroEnergy` 清场爆发及其在 `updateAi` 的分支。

### 1.6 跨局自适应控制器（收敛 70%）

- 持久化标量 `aiSkill`（默认 `1.0`，全局一份），localStorage 键 `dasheng.aiskill`。
- 更新（钩在 `main.ts` 结算处，仅非无尽局）——随机逼近，目标 `p*=0.7`：
  - 胜 → `aiSkill += 0.3k`；负 → `aiSkill -= 0.7k`；均衡在 `p=0.7`。`k=0.06`，每局变化极小；
    clamp `[0.72, 1.8]`（下限刻意收紧 → "打压不过头/不明显"）。
- `aiSkill` → 两个杠杆：
  - **征兵速度**：`aiSummonInterval = baseSummonInterval / aiSkill`，clamp 到 `[minItv, maxItv]`
    （最慢仍在可信人手速内）。
  - **排兵优度**：`pSubOptimal = clamp((1 - aiSkill) · slope, 0, pMax)`，`pMax≈0.35`（次优上限，保连贯）。
- 移除旧的 `aiSkill→部署数量/攻速` 映射（被真实经济 + 策略取代）。

### 1.7 移除项

- `queueAiDeploy` / `tickAiDeploy`（凭空按波配额铺兵）→ 由经济驱动的征兵+布阵取代。
- `aiHeroEnergy` 清场爆发。
- "部署即占格"（改为仅铲子解锁 `aiUnlocked`）。

---

## Part 2 —— 智能自动布阵（玩家一键 & AI 共用）

抽为**共享纯策略** `planAutoPlace(view, opts)`，`view` 暴露：`tray`、`unlockedCells()`、`lockedCells()`、
`cellFree(c,r)`、`units`、`words`、`trees`、`nearestPathDist(cell)`、`getUnitStat`、放置/挖掘/合成的 apply 回调。
两侧各自实例化 `view`。`opts = { rng, pSubOptimal }`（玩家 `pSubOptimal=0`＝恒最优）。

### 处理流程（遍历整盘 tray，无法推进者**保留**、绝不丢弃）

1. **铲子** → 挖 `lockedCells()[0]`（`slotOrder` 已按贴路最近排序＝最优位；跳过桃树格）。无锁定格 → 保留。
2. **字牌（激活英雄）** → 按武将 `chars` 连读顺序放到能与同将另一字左右相邻的格以激活；否则任意空格；
   无空格 → 保留（不丢弃）。
3. **兵种合成（升级武器）** → 同型同阶已放置兵 → 合成升阶。
4. **射程感知铺格** → 剩余兵按**射程升序**（monkey1→cavalry1.5→spear2→archer3），逐个放入其
   "**可达且最远**"的空格：可达判定 `nearestPathDist(cell) ≤ getUnitStat(type,tier).rge + rangeTolerance`
   （`rangeTolerance=0.5`，与战斗一致；`nearestPathDist` 复用 `placeableByProximity` 的 `nearest` 算法）。
   把近格留给短兵、远格给远程兵，最大化铺满 + 覆盖。
5. **格子不够/够不着** → 兵无可达空格：先合成到同型已放置兵（升级提 DPS）；仍不行 → **保留在 tray**，跳过。

> 兵种射程随阶固定（tier 仅提 atk/frq），故"够不着"只能靠合成提 DPS，与"格子不够时尝试升级"一致。
> `pSubOptimal>0` 时以该概率把某步替换为次优（非理想可达格/跳过合成/挖较差格/字牌错序），其余步仍走最优。

---

## 代码改动范围

- **新增** `web/src/ai-opponent.ts`：AI 侧经济/征兵/布阵**策略**（决定何时征兵、调用共享布阵、
  应用最优/次优）。纯逻辑、可单测。
- **新增** `web/src/ai-skill.ts`：`loadAiSkill/saveAiSkill` + 纯函数
  `nextAiSkill(cur, won, {k,target,min,max})` + `skillToKnobs(skill) → {summonInterval, pSubOptimal}`。
- **新增/抽取** 共享纯逻辑（放 `web/src/` 或 `game-core`）：`planAutoPlace`、`tickUnitsAttack`、
  `tickGenerals`（含技能）、单位合成、武将激活扫描、`nearestPathDist`。
- **`web/src/battle.ts`**：
  - 新增 AI 平行状态字段与 `aiRng`；构造注入 `aiSkill`（默认 1.0）。
  - `updateAi` 重写：AI 经济结算（击杀产桃）→ 依 `aiSummonInterval` 决定征兵 → `planAutoPlace(aiView)` →
    共享战斗 tick；移除清场爆发与旧部署配额。
  - `updateUnits`/`updateGenerals` 改为调用抽取出的共享 tick（玩家侧行为不变）。
  - 玩家 `autoPlaceTray()` 改为调用共享 `planAutoPlace(playerView, {pSubOptimal:0})`。
- **`web/src/main.ts`**：开局 `loadAiSkill()` 注入；结算钩子 `nextAiSkill`+`saveAiSkill`（仅非无尽局）。

## 测试与验收

- **单测**（vitest）：
  - `nextAiSkill`：连胜升/连负降；以伯努利 `p=0.7` 输入长期模拟，均值稳定 ~70%；clamp 生效。
  - `planAutoPlace`：不丢弃（仅真正无位者留 tray）；短兵占近格、弓箭手占远格；满格后多余同型触发合成；
    铲子挖最近锁定格；`pSubOptimal=0` 恒最优、`>0` 时次优比例受 `pMax` 约束。
  - AI 经济：够桃才征、征后扣桃/涨价、击杀产桃入 `aiPeach`（无玩家加成）。
  - 共享战斗 tick：玩家侧数值与重构前一致（回归）。
- **对局平衡 sim**（headless `Battle`，无渲染）：`skill=1` 下跑 N 局测胜率量级；对一个固定强度的脚本玩家，
  验证 `nextAiSkill` 把胜率驱动到 ~70%；观察弱 AI 不出现"离谱崩盘"。
- **浏览器冒烟**（遵循 [[verify-web-in-browser]] / [[web-smoke-test-harness]]）：`window.__game` 钩子跑数局，
  确认 AI 会征兵/挖格/合成/出武将、强度平滑、一键布阵铺满合理、无控制台报错。
- 类型检查 + 现有测试全绿（重构不改玩家侧数值）。

## 非目标（YAGNI）

- 局内实时橡皮筋（仅跨局）。
- 分境界/分地图独立 aiSkill。
- AI 享玩家道具/主动技/神兵/meta 加成（保持玩家单向优势）。
- 改兵种射程随阶成长、改神兵背包系统。
