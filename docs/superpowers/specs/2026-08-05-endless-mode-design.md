# 无尽模式设计

日期：2026-08-05
状态：已确认，待写实现计划

## 一、目标

在现有「10 波通关」玩法之外，新增一个可选的**无尽模式**：

- 进游戏前在首页勾选启用。
- 波数不限，一直打到守不住为止。
- 难度随波数逐渐增加。
- 与正常局共用完整 8×10 地图布局，玩家半场（下 5 行 × 8 列）渲染与正常局完全一致。
- 上半场（原 AI 对手区）改为信息面板，展示历史统计与玩法提示。

## 二、核心决策（已与用户确认）

| 议题 | 决策 |
|------|------|
| 结算与境界衔接 | **独立不涨降星**，只记录历史最高波数 |
| 难度递增方式 | **分圈阶梗式跳升**：每 10 波一圈，每进一圈怪物强度阶梗跳升 |
| 起始难度基准 | **固定 `difficultyMul = 1`**，不受玩家境界影响（保证排行榜可比） |
| 开局入口 | 首页「开始游戏」按钮**上方加勾选框** `☐ 无尽模式` |
| AI 对手唐僧 | **关掉对手战斗逻辑**（不部署 / 不镜像出怪 / 不清场 / 禁用"击败对手=胜"） |
| 上半场空间 | 上半场网格/路径**照常绘制作背景**，其上叠半透明信息面板（布局取向 A） |

## 三、难度曲线

- **一圈 = 10 波**。第 1 圈（波 1–10）= 现有手感，`difficultyMul` 固定为 1。
- **圈系数**：`cycleMul(wave) = ENDLESS_CYCLE_STEP ^ floor((wave - 1) / 10)`，`ENDLESS_CYCLE_STEP = 1.3`。
  - 波 1–10：×1.0
  - 波 11–20：×1.3
  - 波 21–30：×1.69
  - 波 31–40：×2.197 …
- **有效难度**：定义 `effectiveDifficulty(wave) = this.difficultyMul * cycleMul(wave)`。
  - 无尽模式：`difficultyMul = 1`，故有效难度就是圈系数。
  - 正常模式：不受影响（无尽关闭时 `cycleMul` 恒为 1 或不参与，见实现约束）。
- 圈系数作用于**怪物侧**：怪物血量、移速、单波出怪量、陨石伤害。**不作用于** AI 对手侧（无尽下对手已关闭）。
- 现有机制**无限延续**：每 5 波出 Boss、第 6 波起骑兵波、后期堆量（`lateWaveExtraPerWave`）等公式照常按 `wave` 递增，不再受 `winWave` 封顶。

## 四、开局入口（menu.ts）

- 在 `menuButtons()` 中，于 `start`（y=612）上方新增按钮 `{ id: 'endless', ... }`，位置约 y=566 一带（注意与地图切换箭头 mapPrev/mapNext 的 y=566 错开，可将勾选框放在开始键与地图行之间，或调整整体纵向排布）。
- 勾选框视觉：方框 + 勾（选中态填色打勾），右侧文案「无尽模式」。
- `MenuInfo` 增加 `endlessOn: boolean` 字段，`drawMenu` 据此渲染勾选态。
- 点击 `endless` 切换本地持久化开关（见状态管理），不立即开局。
- 点击 `start` 时读取该开关，决定 `newGame()` 构造的是无尽局还是正常局。

## 五、状态管理与持久化（storage.ts 复用）

- 新增本地键：
  - `endless.enabled`（`"1"`/`"0"`）：开局前勾选状态，跨会话保留。
  - `endless.bestWave`（数字字符串）：历史最高波数。
- 读写走现有 `storeGet` / `storeSet`（Web=localStorage，微信=wx storage，行为一致）。
- 建议新增薄封装 `loadEndless()` / `setEndlessEnabled(b)` / `getBestWave()` / `recordBestWave(wave)`，与 `rank.ts`/`stamina.ts` 的模块风格一致。

## 六、战斗引擎改造（battle.ts）

### 6.1 模式标记
- `Battle` 构造函数新增第 8 个参数 `endless = false`（沿用现有位置参数风格），存为 `readonly endless: boolean`。
- `main.ts` 的 `newGame()` 依据勾选开关传入。

### 6.2 难度接入
- 新增私有方法 `effectiveDifficulty(wave = this.wave): number`，返回 `this.difficultyMul * (this.endless ? ENDLESS_CYCLE_STEP ** Math.floor((wave - 1) / 10) : 1)`。
- 将下列**怪物侧**用到 `this.difficultyMul` 的地方替换为 `this.effectiveDifficulty()`：
  - 怪物血量（约 line 1054–1055 `hp *= this.difficultyMul`）
  - 怪物移速（约 line 1060 `diffSpd`）
  - 陨石伤害（约 line 1000）
  - 出怪节奏 `spawnTimer`（约 line 1657，若希望后期更密可接入，否则保持）
- **不改** AI 对手侧（`aiDeploy`、AI 清场）——无尽下这些逻辑被关闭。

### 6.3 关闭 AI 对手（仅无尽）
- `startNextWave()` 里 `this.aiDeploy()`：无尽时跳过。
- `updateAi(dt)`（AI 部署/清场/镜像推进）：无尽时整体跳过或提前 return。
- 镜像出怪（约 line 1077 AI 对手同波出怪）：无尽时不生成上半场敌方单位。
- `checkOpponentDefeated()`：无尽时恒返回 false（禁用"击败对手=胜"）。
- 结果：无尽局唯一结束路径是**怪物突破打到我方唐僧 → `status='lost'`**（约 line 1587）。

### 6.4 波次结束判定
- 清空一波后（约 line 1671–1684）：无尽时**不触发** `winWave` 分支，永远走「清波→ready→5 秒后自动开下一波」。
- `winWave` 常量在无尽模式下不参与判定。

## 七、上半场信息面板（render.ts，布局取向 A）

- 无尽局：上半场（行 0–4）网格/路径**照常绘制**作为背景底纹（保持与正常局一致的观感），但**没有敌方单位**在其上活动。
- 在上半场区域叠加一块**半透明信息面板**（宣纸半透 + 圆角），分两块内容：
  1. **历史统计**：
     - 本模式历史最高波数（`endless.bestWave`）
     - 本局当前波数（`battle.wave`）
     - 本局累计击杀 / 已存活时长（若引擎已有计数则复用，无则新增轻量计数）
  2. **玩法提示 / 最佳实践**：3–5 条文案轮播（每数秒切换一条），例如：
     - 「骑兵波移速翻倍——优先合成高阶弓兵远程拦截」
     - 「每 5 波出 Boss，攒好如来神掌应急」
     - 「后期怪成堆，靠范围技/陨石清场」
     - 「越往后每 10 波一个难度台阶，提前囤高阶兵」
- `render.ts` 的绘制入口需要感知 `battle.endless`：为 true 时走信息面板绘制分支，替代 AI 对手单位的绘制；网格/路径绘制保持不变。
- 提示文案集中放在一个常量数组（便于后续增改），轮播索引由 `performance.now()` 或帧计时驱动。

## 八、结算衔接（main.ts + settle.ts）

- 当前逻辑（约 line 357–378）：胜/败一律 `recordWin/recordLose` 改境界 + 进星级动画结算页。
- 无尽局分支：
  - **不调用** `recordWin` / `recordLose`（境界星级不变）。
  - 仍处理**神兵掉落入背包**（复用现有 `droppedWeapons` 流程）。
  - 仍发放**功德**（`meritReward`，按 `battle.wave` 计），作为软性奖励（与境界星级解耦，不影响无尽的"独立"定位）。
  - 更新历史最高波数：`recordBestWave(battle.wave)`。
  - 结算展示：**不播星级动画**，改为无尽结算画面——「本局抵达第 N 波」，若破纪录则高亮「新纪录！」。可在 `settle.ts` 增一个 `drawEndlessSettle(ctx, { wave, best, isNewRecord, merit })` 分支，或在 `settleChange` 上加类型标记复用同一屏。
- 结束后点击返回主菜单，逻辑同现状。

## 九、涉及文件与改动点

| 文件 | 改动 |
|------|------|
| `src/menu.ts` | 新增 `endless` 勾选框按钮 + 绘制；`MenuInfo` 加 `endlessOn` |
| `src/main.ts` | 读勾选开关；`newGame()` 传 `endless`；结算分支区分无尽（不改境界、更新 bestWave、走无尽结算屏） |
| `src/battle.ts` | 加 `endless` 参数与 `effectiveDifficulty()`；怪物侧难度接入；无尽下关 AI 对手；波次结束不封顶 |
| `src/render.ts` | 无尽局上半场叠信息面板（历史统计 + 提示轮播）；提示文案常量 |
| `src/settle.ts` | 新增无尽结算屏（抵达第 N 波 / 新纪录 / 功德） |
| `src/storage.ts` 或新增 `src/endless.ts` | `endless.enabled` / `endless.bestWave` 读写封装 |
| `web/tests/` | 无尽冒烟测试（见下） |

## 十、测试计划

- **单测（vitest）**：
  - `cycleMul` / `effectiveDifficulty`：波 1/10/11/20/21 的圈系数取值正确。
  - 无尽模式下 `checkOpponentDefeated()` 恒 false；波次清空后不进 `won`、始终能开下一波。
  - `recordBestWave` 只在更高波数时更新。
- **冒烟（headless，参考现有 `weaponcheck`）**：
  - 开启无尽 → 进入战斗 → 快进多波 → 确认波数持续递增、上半场无敌方单位、信息面板渲染、直到失守进入无尽结算屏。
- **UI 手测**：首页勾选框可点、状态持久；正常模式不受任何影响（回归）。

## 十一、YAGNI / 非目标

- 不做无尽模式专属排行榜服务端（仅本地 `bestWave`；如需上榜后续单独立项）。
- 不做无尽专属道具/商店改动（复用现有备战与蟠桃园等系统）。
- 不做难度自定义选项（圈长度/STEP 为固定常量，后续可调参而非做成 UI）。
