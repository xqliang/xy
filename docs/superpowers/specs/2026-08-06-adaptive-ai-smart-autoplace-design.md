# 自适应 AI 对手 + 智能自动布阵 —— 设计规格

日期：2026-08-06

## 背景

`xy` 是一款"伪竞技"塔防：玩家与镜像 AI 对手各守一侧唐僧，面对同步镜像的怪物波次。胜负 =
哪一侧唐僧先阵亡（或玩家清完最后一波即胜）。当前存在两处待优化：

1. **AI 对手强度固定**：由 `TUNING.aiDeployBase/PerWave`、`aiFrqMul`、清场爆发等常量 × 境界
   `difficultyMul` 决定，无法依据玩家实际水平调整，胜率随玩家成长漂移。
2. **自动布阵粗糙**（`battle.ts` `autoPlaceTray`）：无理想位即**丢弃**兵/铲/字牌；铲子只挖第一格；
   兵放进"第一个空格"而**无视攻击范围**（棍猴 rge1 与神箭手 rge3 一视同仁），导致远格放近战兵浪费、
   近战兵够不着路。

## 目标

- **跨局自适应 AI**：长期玩家胜率收敛到约 70%，且**弱化 AI 时克制、不露痕迹**（下限收紧、变化平滑）。
- **智能布阵**：尽量不丢弃、优先用铲挖最优位、合成升级、按射程铺满格子、格子不足时改为升级。

## 决策（已与用户确认）

- 胜率控制机制：**仅跨局调节**（局内 AI 强度固定，开局前依据历史胜负微调）。
- 调整杠杆：**部署数量/合成速度** + **攻速倍率**（不动清场爆发、不动漏怪扣血）。
- "合成英雄"：**两者都做**——同型同阶兵合成升阶 + 武将字牌按连读顺序摆放激活武将。
- 追加约束：**打压 AI 不过头、不明显**。

---

## Part 1 —— 跨局自适应 AI

### 状态：持久化标量 `aiSkill`

- 语义：叠加在境界 `difficultyMul` 之上的**相对强度修正**，默认 `1.0`。
- 全局一份（非分境界）：反馈驱动会自纠，跨境界自动适应，无需分桶。
- 持久化：localStorage，键 `dasheng.aiskill`，经 `storage.ts` 的 `storeGet/storeSet`。
- **范围 clamp `[0.72, 1.8]`**：下限刻意收紧到 0.72（而非更低），保证 AI 再弱也维持基本防线、
  不出现"对面一波就崩"的离谱观感（满足"打压不过头/不明显"）。上限 1.8 留强化空间。

### 更新规则（随机逼近，收敛到 p\*=0.7）

钩在 `main.ts` 胜负结算处（`main.ts:426` 附近，`const won = ...` 之后），**仅非无尽局**触发一次：

- 玩家**胜** → `aiSkill += k·(1 - p*)` = `+0.3k`（调强 AI）
- 玩家**负** → `aiSkill -= k·p*` = `-0.7k`（调弱 AI）

均衡分析：期望零漂移 `p·(0.3k) = (1-p)·(0.7k)` 在 `p=0.7` 成立 → 长期胜率锁定 70%。

- 步长 `k = 0.06`：胜 `+0.018`、负 `-0.042`，约 15–25 局收敛，单局变化极小（"不明显"）。
- 每局 clamp 到 `[0.72, 1.8]`。

### 作用到两个杠杆

在 `Battle` 开局注入 `aiSkill`（构造参数，默认 1.0，便于单测显式传值）。

1. **部署量 / 合成节奏**（`queueAiDeploy` / `tickAiDeploy`）：
   - 本波目标格数 `target = round((aiDeployBase + wave·aiDeployPerWave) · difficultyMul · aiSkill)`。
   - 逐个落子间隔 `aiDeployInterval / aiSkill`（skill 高→落子快→合成快；skill 低→慢，但因下限 0.72，
     最慢约为原速的 1.39 倍，仍在合理"手速"内，不显眼）。
2. **攻速**（`updateAiUnits`）：
   - 新增独立因子 `aiSkillFrq = 1 + (aiSkill - 1)·0.5`（**衰减 50%**，避免攻速视觉突兀）。
   - `cooldown = 1 / (stat.frq · this.aiFrqMul · aiSkillFrq)`——**乘法叠加**，不覆盖疾风咒对
     `aiFrqMul` 的既有作用。

**不改动**：AI 清场爆发（`aiClear*`）、漏怪扣血权重、怪物数值、玩家侧任何逻辑。

---

## Part 2 —— 智能自动布阵 `autoPlaceTray()` 重写

### 原则

绝不因"暂时无位"而丢弃兵/字牌；只有真正无意义时（如无锁定格的铲子）才保留在 tray 等待下次。

### 处理流程（遍历整盘 tray，直到无可推进）

按下述优先级消费 tray token；无法推进的 token **保留在 tray 并跳过**（防死循环，绝不 splice 丢弃）：

1. **铲子** → 挖 `lockedCells()[0]`（`slotOrder` 已按贴路最近排序，即"最优位"；跳过有桃树的格）。
   无可挖锁定格 → 保留在 tray（不丢）。
2. **字牌（激活英雄）** → 维持现逻辑：按武将 `chars` 连读顺序放到能与同将另一字左右相邻的格以激活；
   否则任意空格；无空格 → 保留在 tray（改为不丢弃）。
3. **兵种合成（升级武器）** → 若存在同型同阶已放置兵，合成升阶。
4. **射程感知铺格** → 将剩余待放兵按 **射程升序**排序（monkey rge1 → cavalry rge1.5 → spear rge2 →
   archer rge3）。逐个放入其"**可达且最远**"的空格：
   - 空格可达判定：该格贴路最近距 `nearestPathDist(cell) ≤ getUnitStat(type,tier).rge + rangeTolerance`
     （`rangeTolerance = 0.5`，与战斗判定一致）。`nearestPathDist` 复用 `placeableByProximity` 中
     `nearest(cell)=min over map.path of hypot` 的算法。
   - "最远可达"策略：把贴路近格留给短射程兵，远格分给远程兵 → 最大化铺满 + 有效覆盖。
5. **格子不够 / 够不着** → 该兵无任何可达空格时：
   - 先尝试合成到**同型已放置兵**（升级，提升 DPS）。
   - 仍不行 → **保留在 tray**（绝不丢弃），跳过。

> 注：兵种射程随阶固定不变（tier 只提 atk/frq），故"够不着"只能靠合成提 DPS，不会靠升阶扩程——
> 与"格子不够时尝试升级武器"一致。

### 需要的小工具

- `nearestPathDist(cell)`：Battle 内私有方法或复用 board 导出（读 `this.map.path`）。
- 空格集合：`unlockedCells().filter(cellFree)`（`unlockedCells` 已按贴路排序）。

---

## 代码改动范围

- **新增** `web/src/ai-skill.ts`：`loadAiSkill()`、`saveAiSkill()`、纯函数
  `nextAiSkill(cur, won, {k, target, min, max})`（可单测收敛与 clamp）、常量默认值。
- **`web/src/battle.ts`**：
  - 构造函数新增 `aiSkill` 参数（默认 1.0）并存字段。
  - `queueAiDeploy` / `tickAiDeploy`：目标数 × `aiSkill`，间隔 ÷ `aiSkill`。
  - `updateAiUnits`：`cooldown` 乘 `aiSkillFrq`。
  - 重写 `autoPlaceTray`：射程感知 + 不丢弃 + 合成兜底；新增 `nearestPathDist` 辅助。
- **`web/src/main.ts`**：开局用 `loadAiSkill()` 注入 `Battle`；结算钩子调用 `nextAiSkill` 并 `saveAiSkill`
  （仅非无尽局）。

## 测试与验收

- **单测**（game-core/vitest 或 web 侧 vitest）：
  - `nextAiSkill`：连胜使其上升、连负下降；长期模拟（伯努利 p=0.7 输入）均值稳定于 70% 附近；clamp 生效。
  - `autoPlaceTray`：构造 tray + 有限格，断言——不丢弃（tray 仅保留真正无位者）；短兵占近格、弓箭手占远格；
    满格后多余同型兵触发合成升阶；铲子挖最近锁定格。
- **浏览器冒烟**（遵循项目 [[verify-web-in-browser]] / [[web-smoke-test-harness]]）：
  - 用 `window.__game` 钩子跑若干局，观察 AI 强度平滑、无"离谱崩盘"；一键布阵后格子铺满合理、无控制台报错。
- 类型检查 + 现有测试全绿。

## 非目标（YAGNI）

- 局内实时橡皮筋（用户明确仅要跨局）。
- 分境界/分地图独立 aiSkill。
- 改神兵背包、兵种射程成长、清场爆发、漏怪扣血。
