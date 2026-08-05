# 无尽模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 10 波通关玩法外，新增可在首页勾选的无尽模式：波数不限、每 10 波一圈阶梗式提升难度、关闭 AI 对手、上半场改为信息面板，结束只记录历史最高波数而不涨降境界。

**Architecture:** 复用现有 `Battle` 引擎，构造函数加 `endless` 布尔标记；难度经由新方法 `effectiveDifficulty(wave)` 统一注入怪物侧数值（正常模式恒等于 `difficultyMul`，行为零变化）；无尽下跳过 AI 对手逻辑与通关封顶，唯一结束路径是失守。持久化走现有 `storeGet/storeSet`。UI 层在菜单加勾选框、在上半场用信息面板替换 `drawAiSide`、加无尽专属结算屏。

**Tech Stack:** TypeScript + Vite，canvas 手绘渲染，vitest 单测，puppeteer-core headless 冒烟（`web/tools/*.mjs`）。所有命令在 `web/` 目录下执行。

---

## 文件结构

| 文件 | 职责 | 动作 |
|------|------|------|
| `web/src/endless.ts` | 无尽模式持久化：开关 + 历史最高波数 | 新建 |
| `web/src/battle.ts` | 引擎：`endless` 标记、`effectiveDifficulty`、关对手、不封顶 | 修改 |
| `web/src/menu.ts` | 首页勾选框按钮 + 绘制；`MenuInfo.endlessOn` | 修改 |
| `web/src/render.ts` | 无尽上半场信息面板（替换 `drawAiSide`）+ 提示文案常量 | 修改 |
| `web/src/settle.ts` | 无尽结算屏 `drawEndlessSettle` | 修改 |
| `web/src/main.ts` | 读勾选/传参、结算分支、hook.restart 加 endless | 修改 |
| `web/tests/endless.test.ts` | `endless.ts` 与 `battle` 无尽行为单测 | 新建 |
| `web/tools/endlesscheck.mjs` | headless 冒烟：勾选→多波递增→失守→无尽结算 | 新建 |

---

## Task 1: 无尽模式持久化模块

**Files:**
- Create: `web/src/endless.ts`
- Test: `web/tests/endless.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/tests/endless.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { loadEndlessEnabled, setEndlessEnabled, getBestWave, recordBestWave } from '../src/endless';

// vitest 默认 node 环境无 localStorage；storage.ts 在无 wx 时走 localStorage。
// 注入内存版 stub（不引入 jsdom 依赖），使 storeGet/storeSet 可往返。
beforeEach(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
});

describe('endless persistence', () => {
  it('开关默认关闭，可开启并持久化', () => {
    expect(loadEndlessEnabled()).toBe(false);
    setEndlessEnabled(true);
    expect(loadEndlessEnabled()).toBe(true);
    setEndlessEnabled(false);
    expect(loadEndlessEnabled()).toBe(false);
  });

  it('最高波数默认 0', () => {
    expect(getBestWave()).toBe(0);
  });

  it('recordBestWave 仅在更高时更新并返回是否破纪录', () => {
    expect(recordBestWave(5)).toBe(true);
    expect(getBestWave()).toBe(5);
    expect(recordBestWave(3)).toBe(false); // 更低不更新
    expect(getBestWave()).toBe(5);
    expect(recordBestWave(9)).toBe(true);
    expect(getBestWave()).toBe(9);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- endless`
Expected: FAIL —「Cannot find module '../src/endless'」

- [ ] **Step 3: 实现 endless.ts**

创建 `web/src/endless.ts`：

```typescript
// 无尽模式的本地持久化：开局前的勾选开关 + 历史最高波数。
// 复用 storage.ts 跨平台键值层（Web=localStorage，微信=wx storage），行为一致。
import { storeGet, storeSet } from './storage';

const KEY_ENABLED = 'endless.enabled';
const KEY_BEST = 'endless.bestWave';

// 读取开局前的无尽勾选状态（默认关闭）。
export function loadEndlessEnabled(): boolean {
  return storeGet(KEY_ENABLED) === '1';
}

// 写入无尽勾选状态。
export function setEndlessEnabled(on: boolean): void {
  storeSet(KEY_ENABLED, on ? '1' : '0');
}

// 读取历史最高波数（默认 0）。
export function getBestWave(): number {
  const v = Number(storeGet(KEY_BEST) ?? '0');
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// 若本局波数超过历史最高则更新；返回是否破纪录。
export function recordBestWave(wave: number): boolean {
  if (wave > getBestWave()) {
    storeSet(KEY_BEST, String(Math.floor(wave)));
    return true;
  }
  return false;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- endless`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add web/src/endless.ts web/tests/endless.test.ts
git commit -m "feat(web): 无尽模式持久化——开关 + 历史最高波数"
```

---

## Task 2: 引擎加 endless 标记与分圈难度曲线

**Files:**
- Modify: `web/src/battle.ts`（TUNING 常量区、`readonly difficultyMul` 附近 line 362、constructor line 365-369、meteor line 1000、spawnMonster line 1055/1060、spawnTimer line 1657）
- Test: `web/tests/endless.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `web/tests/endless.test.ts` 末尾追加（顶部 import 增加 `Battle, TUNING`）：

```typescript
import { Battle, TUNING } from '../src/battle';

describe('endless difficulty curve', () => {
  it('effectiveDifficulty 分圈阶梗：每 10 波一圈 ×STEP', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    const S = TUNING.endlessCycleStep;
    expect(b.effectiveDifficulty(1)).toBeCloseTo(1, 5);      // 圈0
    expect(b.effectiveDifficulty(10)).toBeCloseTo(1, 5);     // 圈0
    expect(b.effectiveDifficulty(11)).toBeCloseTo(S, 5);     // 圈1
    expect(b.effectiveDifficulty(20)).toBeCloseTo(S, 5);     // 圈1
    expect(b.effectiveDifficulty(21)).toBeCloseTo(S * S, 5); // 圈2
  });

  it('正常模式 effectiveDifficulty 恒等于 difficultyMul（不受波数影响）', () => {
    const b = new Battle(1, 1.5, undefined, undefined, {}, [], [], false);
    expect(b.effectiveDifficulty(1)).toBeCloseTo(1.5, 5);
    expect(b.effectiveDifficulty(30)).toBeCloseTo(1.5, 5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- endless`
Expected: FAIL —「Expected 8 arguments, but got ...」或 `b.effectiveDifficulty is not a function`

- [ ] **Step 3a: TUNING 增加圈系数常量**

在 `web/src/battle.ts` 的 `TUNING` 对象内，`winWave: 10,`（line 76）下一行加：

```typescript
  // —— 无尽模式：每 10 波为一圈，每进一圈怪物强度阶梗式 ×endlessCycleStep ——
  endlessWavesPerCycle: 10,
  endlessCycleStep: 1.3,
```

- [ ] **Step 3b: 字段与构造函数加 endless**

将 line 362 的字段声明改为（在其后新增一行）：

```typescript
  readonly difficultyMul: number; // 由境界决定的怪物强度系数
  readonly endless: boolean; // 无尽模式：波数不限、关对手、只记录最高波数
```

将构造函数签名（line 365）末尾追加参数：

```typescript
  constructor(seed = 1, difficultyMul = 1, map: GameMap = MAPS[0]!, meta: MetaBonuses = NO_META, weapons: WeaponBonuses = {}, actives: string[] = [], passives: string[] = [], endless = false) {
```

在 line 369 `this.difficultyMul = difficultyMul;` 下一行加：

```typescript
    this.endless = endless;
```

- [ ] **Step 3c: 新增 effectiveDifficulty 方法**

在 `waveSpawnCount`（line 1031）方法**前**插入：

```typescript
  // 有效怪物强度系数：正常模式=境界系数；无尽模式=境界系数 × 分圈阶梗系数。
  // 圈系数 = endlessCycleStep ^ floor((wave-1)/endlessWavesPerCycle)：波1-10 ×1，波11-20 ×STEP…
  effectiveDifficulty(wave: number = this.wave): number {
    if (!this.endless) return this.difficultyMul;
    const cycle = Math.floor((Math.max(1, wave) - 1) / TUNING.endlessWavesPerCycle);
    return this.difficultyMul * TUNING.endlessCycleStep ** cycle;
  }
```

- [ ] **Step 3d: 怪物侧数值接入 effectiveDifficulty**

替换以下 4 处（均为怪物侧，正常模式行为不变，因 endless=false 时该方法恒等于 difficultyMul）：

line 1000（陨石伤害）——把 `* this.difficultyMul *` 改为 `* this.effectiveDifficulty() *`：

```typescript
    const dmg = (TUNING.monsterHpBase + TUNING.monsterHpStep * this.wave) * this.effectiveDifficulty() * 3;
```

line 1055（怪血）：

```typescript
    hp *= this.effectiveDifficulty(); // 境界越高妖怪越强；无尽模式再叠分圈系数
```

line 1060（怪速）：

```typescript
    const diffSpd = 1 + 0.1 * (this.effectiveDifficulty() - 1); // 高难度妖怪更快
```

line 1657（出怪节奏）：

```typescript
        this.spawnTimer = Math.max(0.3, TUNING.spawnInterval / (1 + 0.07 * (this.effectiveDifficulty() - 1)));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- endless`
Expected: PASS（新增 2 个用例通过；原有用例仍通过）

- [ ] **Step 5: 提交**

```bash
git add web/src/battle.ts web/tests/endless.test.ts
git commit -m "feat(web): 引擎加 endless 标记与分圈阶梗难度曲线"
```

---

## Task 3: 无尽模式关闭 AI 对手 + 取消通关封顶

**Files:**
- Modify: `web/src/battle.ts`（startNextWave line 805、spawnMonster 镜像出怪 line 1077-、updateAi line 1178、checkOpponentDefeated line 1215、清波判定 line 1673）
- Test: `web/tests/endless.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `web/tests/endless.test.ts` 末尾追加：

```typescript
describe('endless disables opponent and win-cap', () => {
  it('无尽模式不生成 AI 对手怪、不触发击败对手=胜', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    b.startNextWave();
    // 步进若干帧让首批怪出现
    for (let i = 0; i < 120; i++) b.step(1 / 60);
    expect(b.aiMonsters.length).toBe(0); // 上半场无敌方单位
    expect(b.status).not.toBe('won');    // 永不因对手判负而胜
  });

  it('无尽模式清空第 10 波后继续（进入 ready），不判通关', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    // 直接把波数推到 10 并清场：手动开波后清空怪物
    for (let w = 0; w < 10; w++) {
      b.startNextWave();
      b.forceClearWaveForTest(); // 见 Step 3e 新增的测试辅助
    }
    expect(b.wave).toBe(10);
    expect(b.status).not.toBe('won'); // 不封顶
  });

  it('正常模式清空第 10 波判通关（回归保护）', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], false);
    for (let w = 0; w < 10; w++) {
      b.startNextWave();
      b.forceClearWaveForTest();
    }
    expect(b.status).toBe('won');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- endless`
Expected: FAIL —`b.forceClearWaveForTest is not a function`（辅助方法未加）及断言失败

- [ ] **Step 3a: startNextWave 跳过 AI 部署**

line 805 `this.aiDeploy();` 改为：

```typescript
    if (!this.endless) this.aiDeploy(); // 无尽模式无 AI 对手
```

- [ ] **Step 3b: spawnMonster 跳过镜像出怪**

spawnMonster 中 `this.aiMonsters.push({`（line 1078）整段镜像出怪用 endless 守卫。将该 push 语句块包起来：

```typescript
    // AI 对手同波同步出怪（镜像路）。无尽模式无对手，跳过。
    if (!this.endless) {
      this.aiMonsters.push({
        id: this.nextMonsterId++,
        dist: this.aiEntranceDist, // 从 AI 出怪口冒出
        // …保留原有其余字段不动…
      });
    }
```

> 注意：只在现有 `this.aiMonsters.push({ ... });` 外层包 `if (!this.endless) { ... }`，push 内部字段原样保留。

- [ ] **Step 3c: updateAi 无尽直接返回**

在 `private updateAi(dt: number): void {`（line 1178）方法体**第一行**加：

```typescript
    if (this.endless) return; // 无尽模式无 AI 对手，跳过其部署/清场/推进
```

- [ ] **Step 3d: checkOpponentDefeated 无尽恒 false**

在 `private checkOpponentDefeated(): boolean {`（line 1215）方法体**第一行**加：

```typescript
    if (this.endless) return false; // 无尽模式禁用「击败对手=胜」
```

- [ ] **Step 3e: 清波判定取消封顶 + 加测试辅助方法**

line 1673 `if (this.wave >= TUNING.winWave) {` 改为：

```typescript
      if (!this.endless && this.wave >= TUNING.winWave) {
```

并在 `grantPeach`（line 1687 附近的调试辅助区）旁新增测试辅助方法：

```typescript
  // 测试辅助：立即清空当前波（清怪 + 触发清波判定）。仅供单测确定性驱动。
  forceClearWaveForTest(): void {
    this.monsters = [];
    this.spawnRemaining = 0;
    this.step(1 / 60); // 触发清波判定分支
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- endless`
Expected: PASS（新增 3 个用例通过；回归用例正常模式通关仍成立）

- [ ] **Step 5: 全量回归**

Run: `npm test`
Expected: 全部通过（原 27 + 新增 endless 用例）

- [ ] **Step 6: 提交**

```bash
git add web/src/battle.ts web/tests/endless.test.ts
git commit -m "feat(web): 无尽模式关闭 AI 对手并取消通关封顶"
```

---

## Task 4: 主流程接线（构造传参 + hook + 结算分支）

**Files:**
- Modify: `web/src/main.ts`（import line 16-17、模块状态 line 51-64、newGame line 66-70、handleMenu、settle 绘制 line 345-346、结束结算块 line 357-378、hook.restart line 458-463、GameHook 接口 line 427）

- [ ] **Step 1: 引入 endless 模块与状态**

`web/src/main.ts` 顶部 import 区（line 17 之后）加：

```typescript
import { drawEndlessSettle, type EndlessResult } from './settle';
import { loadEndlessEnabled, setEndlessEnabled, recordBestWave, getBestWave } from './endless';
```

> `drawEndlessSettle` / `EndlessResult` 在 Task 5 实现；本任务先接线，Task 5 完成后整体可编译通过。若按顺序执行，可先只 import `endless.ts` 的四个函数，`settle` 相关 import 在 Task 5 开始时补。

模块状态区（line 64 `const ui...` 之前）加：

```typescript
let endlessOn = loadEndlessEnabled(); // 开局前无尽勾选（持久化）
let endlessResult: EndlessResult | null = null; // 无尽局结束展示数据
```

- [ ] **Step 2: newGame 传入 endless**

`newGame()`（line 68）构造改为：

```typescript
  battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endlessOn);
```

- [ ] **Step 3: handleMenu 处理勾选点击**

在 `handleMenu` 中 `if (id === 'start') {`（line 86）**之前**加：

```typescript
  if (id === 'endless') {
    endlessOn = !endlessOn;
    setEndlessEnabled(endlessOn);
    menuToast = endlessOn ? '无尽模式：开（波数不限，难度渐增）' : '无尽模式：关';
    return;
  }
```

- [ ] **Step 4: MenuInfo 传 endlessOn**

`drawMenu(ctx, {...})` 调用处（约 line 326-336 的对象字面量）加一行：

```typescript
      endlessOn,
```

- [ ] **Step 5: 结束结算分区（无尽不涨星）**

将 line 357-378 的结束处理块改为：

```typescript
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost')) {
      endHandled = true;
      // 神兵掉落入背包（两种模式通用）
      const names: string[] = [];
      for (const wid of battle.droppedWeapons) {
        const r = addWeapon(bag, wid);
        bag = r.state;
        names.push(`${weaponById(wid)?.name ?? wid}${r.upgraded ? '↑' : ''}`);
      }
      battle.droppedWeapons = [];
      const dropMsg = names.length ? `，神兵：${names.join('、')}` : '';

      if (battle.endless) {
        // 无尽：不涨降境界，只记录最高波数；仍发放功德（软奖励，与星级解耦）
        const gain = meritReward(false, battle.wave);
        merit = addMerit(merit, gain);
        const isRecord = recordBestWave(battle.wave);
        endlessResult = { wave: battle.wave, best: getBestWave(), isNewRecord: isRecord, merit: gain };
        settleChange = null;
        battle.message = `抵达第 ${battle.wave} 波（功德 +${gain}${dropMsg}）`;
        settleStart = performance.now();
        screen = 'settle';
      } else {
        const won = battle.status === 'won';
        const change = won ? recordWin(rank) : recordLose(rank);
        rank = change.state;
        const gain = meritReward(won, battle.wave);
        merit = addMerit(merit, gain);
        battle.message = `${battle.message}（功德 +${gain}${dropMsg}）`;
        endlessResult = null;
        settleChange = change;
        settleStart = performance.now();
        screen = 'settle';
      }
    }
```

- [ ] **Step 6: settle 绘制分区**

line 345-346 改为：

```typescript
  } else if (screen === 'settle') {
    if (battle.endless && endlessResult) drawEndlessSettle(ctx, endlessResult, now - settleStart);
    else if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
```

- [ ] **Step 7: settle 点击返回（无尽即时可返回）**

line 228-235 的 settle 点击块改为：

```typescript
  if (screen === 'settle') {
    if (endlessResult || isSettleAnimDone(performance.now() - settleStart)) {
      settleChange = null;
      endlessResult = null;
      screen = 'menu'; // 无尽结算为静态屏，点击即回；星级结算需动画放完
    } else {
      settleStart = performance.now() - SETTLE_ANIM_MS;
    }
    return;
  }
```

- [ ] **Step 8: hook.restart 支持 endless（供冒烟脚本驱动）**

`GameHook` 接口 line 427 改：

```typescript
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => void;
```

实现 line 458-463 改：

```typescript
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endless ?? false);
    endHandled = false;
    endlessResult = null;
    screen = 'battle';
    scheduleFrame();
  },
```

- [ ] **Step 9: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过（若 Task 5 尚未实现 `drawEndlessSettle`/`EndlessResult` 会报错——按序执行时本任务与 Task 5 合并提交，或先做 Task 5 的 settle 导出）。

> 执行顺序建议：先做本任务 Step 1-4、8（不依赖 settle 新导出），Step 5-7 依赖 `drawEndlessSettle`；可与 Task 5 交叉，最后统一 `tsc` 通过再提交。

- [ ] **Step 10: 提交**

```bash
git add web/src/main.ts
git commit -m "feat(web): 主流程接线无尽模式——构造传参/结算分支/hook"
```

---

## Task 5: 无尽结算屏

**Files:**
- Modify: `web/src/settle.ts`（新增导出 `EndlessResult` 类型与 `drawEndlessSettle`）

- [ ] **Step 1: 定义结果类型与结算屏**

在 `web/src/settle.ts` 末尾追加：

```typescript
// 无尽局结束展示数据（无星级变化，只展示波数/纪录/功德）。
export interface EndlessResult {
  wave: number;       // 本局抵达波数
  best: number;       // 历史最高波数（含本局）
  isNewRecord: boolean; // 本局是否破纪录
  merit: number;      // 本局获得功德
}

// 无尽结算屏：静态展示（不做加减星动画）。点击任意处即返回主菜单（由 main.ts 处理）。
export function drawEndlessSettle(ctx: CanvasRenderingContext2D, r: EndlessResult, _tMs: number): void {
  // 半透明遮罩
  ctx.fillStyle = 'rgba(20,14,8,0.78)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const cx = VIEW_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 标题
  ctx.fillStyle = '#ffd873';
  ctx.font = 'bold 40px "PingFang SC", sans-serif';
  ctx.fillText('无尽 · 试炼结束', cx, VIEW_H * 0.30);

  // 本局波数（大字）
  ctx.fillStyle = '#fff4e0';
  ctx.font = 'bold 72px "PingFang SC", sans-serif';
  ctx.fillText(`第 ${r.wave} 波`, cx, VIEW_H * 0.44);

  // 破纪录高亮 / 历史最高
  if (r.isNewRecord) {
    ctx.fillStyle = '#ff6f3c';
    ctx.font = 'bold 30px "PingFang SC", sans-serif';
    ctx.fillText('★ 新纪录！★', cx, VIEW_H * 0.54);
  } else {
    ctx.fillStyle = '#c9b98f';
    ctx.font = '24px "PingFang SC", sans-serif';
    ctx.fillText(`历史最高：第 ${r.best} 波`, cx, VIEW_H * 0.54);
  }

  // 功德奖励
  ctx.fillStyle = '#e0a020';
  ctx.font = '22px "PingFang SC", sans-serif';
  ctx.fillText(`功德 +${r.merit}`, cx, VIEW_H * 0.62);

  // 返回提示
  ctx.fillStyle = '#b0a88f';
  ctx.font = '18px "PingFang SC", sans-serif';
  ctx.fillText('点击任意处返回', cx, VIEW_H * 0.72);
}
```

> `VIEW_W`/`VIEW_H` 已在 settle.ts 顶部 `import { VIEW_W, VIEW_H } from './render';`（现有），无需重复导入。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过（配合 Task 4 的 import）。

- [ ] **Step 3: 提交**

```bash
git add web/src/settle.ts
git commit -m "feat(web): 无尽结算屏——抵达波数/破纪录/功德"
```

---

## Task 6: 首页无尽勾选框

**Files:**
- Modify: `web/src/menu.ts`（`MenuInfo` line 14-22、`menuButtons` line 34-49、`drawMenu` 按钮循环 line 101-160）

- [ ] **Step 1: MenuInfo 加字段**

`MenuInfo` 接口（line 21 `musicOn: boolean;` 后）加：

```typescript
  endlessOn: boolean;
```

- [ ] **Step 2: 新增勾选框按钮**

`menuButtons()` 返回数组（line 37 `{ id: 'start', ... }` 之前）加：

```typescript
    { id: 'endless', x: cx - 150, y: 520, w: 300, h: 34 },
```

> 位于主角立绘（约 y≤510）与地图切换行（y=566）之间的空隙，视觉在开始按钮上方。

- [ ] **Step 3: drawMenu 渲染勾选框**

在按钮循环内、`if (b.id === 'mapPrev' || b.id === 'mapNext') {`（line 128）**之前**加一个分支：

```typescript
    if (b.id === 'endless') {
      // 勾选框：左侧方框（选中态填色打勾）+ 右侧文案
      const boxSize = 24;
      const boxX = b.x + 40;
      const boxY = b.y + (b.h - boxSize) / 2;
      roundRect(ctx, boxX, boxY, boxSize, boxSize, 6);
      ctx.fillStyle = info.endlessOn ? '#b5391f' : 'rgba(255,244,224,0.65)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#7a3b12';
      ctx.stroke();
      if (info.endlessOn) {
        // 打勾
        ctx.strokeStyle = '#fff4e0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(boxX + 5, boxY + 12);
        ctx.lineTo(boxX + 10, boxY + 18);
        ctx.lineTo(boxX + 19, boxY + 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#5a3a12';
      ctx.font = 'bold 20px "PingFang SC", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('无尽模式', boxX + boxSize + 12, b.y + b.h / 2);
      continue;
    }
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add web/src/menu.ts
git commit -m "feat(web): 首页无尽模式勾选框"
```

---

## Task 7: 无尽上半场信息面板

**Files:**
- Modify: `web/src/render.ts`（`draw` line 324 的 `drawAiSide` 调用；新增提示常量与 `drawEndlessPanel`；import `getBestWave`）

- [ ] **Step 1: 引入 endless 读取与提示常量**

`web/src/render.ts` 顶部 import 区加：

```typescript
import { getBestWave } from './endless';
```

在文件内 `drawAiSide` 函数（line 1657）**之前**加提示文案常量：

```typescript
// 无尽模式上半场提示文案（轮播，每数秒切换一条）。
const ENDLESS_TIPS: string[] = [
  '骑兵波移速翻倍——优先合成高阶弓兵远程拦截',
  '每 5 波出 BOSS，攒好如来神掌应急',
  '后期怪成堆，靠范围技/陨石清场',
  '每 10 波一个难度台阶，提前囤高阶兵',
];
```

- [ ] **Step 2: 实现 drawEndlessPanel**

在 `drawAiSide` 函数**之后**加：

```typescript
// 无尽模式上半场信息面板：网格/路径已由 drawBoard 照常绘制作背景，
// 此处在上半场（行 0..FENCE_ROW）叠一层半透明面板，展示历史统计 + 玩法提示轮播。
function drawEndlessPanel(ctx: CanvasRenderingContext2D, b: Battle): void {
  // 上半场像素区域：从棋盘顶到栅栏行
  const top = cellCenterPx(0, 0).y - CELL / 2;
  const bottom = cellCenterPx(0, FENCE_ROW).y - CELL / 2;
  const panelX = BOARD_X + CELL * 0.4;
  const panelW = COLS * CELL - CELL * 0.8;
  const panelY = top + CELL * 0.3;
  const panelH = (bottom - top) - CELL * 0.6;

  ctx.save();
  // 半透明宣纸面板
  roundRect(ctx, panelX, panelY, panelW, panelH, 14);
  ctx.fillStyle = 'rgba(244,233,220,0.82)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(122,59,18,0.5)';
  ctx.stroke();

  const cx = panelX + panelW / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 标题
  ctx.fillStyle = '#b5391f';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText('无尽 · 试炼', cx, panelY + 26);

  // 历史统计：当前波 + 历史最高
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText(`第 ${b.wave} 波`, cx, panelY + 62);
  ctx.fillStyle = '#8a5a2b';
  ctx.font = '16px "PingFang SC", sans-serif';
  ctx.fillText(`历史最高：第 ${getBestWave()} 波`, cx, panelY + 90);

  // 玩法提示轮播（每 4 秒切一条）
  const tip = ENDLESS_TIPS[Math.floor(performance.now() / 4000) % ENDLESS_TIPS.length]!;
  ctx.fillStyle = '#7a3b12';
  ctx.font = '15px "PingFang SC", sans-serif';
  ctx.fillText('💡 ' + tip, cx, panelY + panelH - 22);

  ctx.restore();
}
```

> 依赖的 `BOARD_X`、`CELL`、`COLS`、`FENCE_ROW`、`cellCenterPx`、`roundRect` 均已在 render.ts 现有作用域内（`drawAiSide`/`drawDanger` 已在用）。`COLS`/`FENCE_ROW` 若未在 render.ts 顶部导入，则在现有 `import ... from './board'` 中补上（现有 board 导入已含 `CELL` 相关；确认后按需追加 `COLS, FENCE_ROW`）。

- [ ] **Step 3: draw 主流程按模式切换**

line 324 `drawAiSide(ctx, b);` 改为：

```typescript
  if (b.endless) drawEndlessPanel(ctx, b);
  else drawAiSide(ctx, b);
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过（如报 `COLS`/`FENCE_ROW` 未定义，则在 `./board` import 中补上后重试）。

- [ ] **Step 5: 提交**

```bash
git add web/src/render.ts
git commit -m "feat(web): 无尽上半场信息面板——历史统计 + 玩法提示轮播"
```

---

## Task 8: headless 冒烟脚本

**Files:**
- Create: `web/tools/endlesscheck.mjs`

- [ ] **Step 1: 写冒烟脚本**

创建 `web/tools/endlesscheck.mjs`（镜像 `weaponcheck.mjs` 的启动/驱动风格）：

```javascript
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const result = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, undefined, true); // endless=true
  g.enterBattle();
  const b = g.battle;
  // 布防：多次征兵+一键布阵，喂满经济
  g.grantPeach(800);
  for (let k = 0; k < 30; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  const waves = [];
  // 连打多波：每波开波后步进，直到清空或失守
  for (let w = 0; w < 12 && b.status !== 'lost'; w++) {
    g.wave();
    for (let i = 0; i < 2000; i++) {
      g.step(1 / 60);
      if (b.status === 'lost') break;
      if (b.status === 'ready') break; // 本波已清
    }
    waves.push({ wave: b.wave, status: b.status, aiMonsters: b.aiMonsters.length });
    if (b.status === 'lost') break;
    g.grantPeach(300);
    for (let k = 0; k < 12; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  }
  return {
    reachedWave: b.wave,
    endless: b.endless,
    everWon: waves.some((x) => x.status === 'won'),
    aiMonstersMax: Math.max(...waves.map((x) => x.aiMonsters)),
    finalStatus: b.status,
  };
});
await new Promise((r) => setTimeout(r, 30));
await page.screenshot({ path: path.join(OUT, 'endless.png') });

const ok = result.endless === true && result.everWon === false && result.aiMonstersMax === 0 && result.reachedWave >= 5;
console.log('[endlesscheck]', JSON.stringify(result), 'PASS=' + ok);
if (logs.length) console.log(logs.join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: 启动 dev server 并运行冒烟**

Run:
```bash
(npm run dev >/tmp/vite-endless.log 2>&1 &) ; sleep 3
node tools/endlesscheck.mjs
```
Expected: 输出含 `PASS=true`；`reachedWave >= 5`、`everWon=false`、`aiMonstersMax=0`。截图 `web/shots/endless.png` 生成。

> 若本机 Chrome 路径不同或无 puppeteer-core，跳过自动运行、改为 Task 9 手测；在报告中注明未能自动冒烟的原因。

- [ ] **Step 3: 提交**

```bash
git add web/tools/endlesscheck.mjs
git commit -m "test(web): 无尽模式冒烟——多波递增/无对手/不通关"
```

---

## Task 9: 手动验证（UI golden path + 回归）

**Files:** 无（人工验证）

- [ ] **Step 1: 启动**

Run: `npm run dev`（若未运行），浏览器打开 `http://127.0.0.1:5180/`。

- [ ] **Step 2: 无尽 golden path**

验证：
1. 首页开始按钮上方出现「☐ 无尽模式」勾选框；点击可切换勾/不勾，刷新页面后状态保留（持久化）。
2. 勾选后点开始 → 进入战斗；上半场显示信息面板（无尽·试炼 / 第 N 波 / 历史最高 / 提示轮播），**无敌方唐僧与敌方单位**。
3. 连打多波：波数持续递增超过 10，不出现「通关」；难度肉眼渐增（怪更硬更快/更密）。
4. 失守后进入无尽结算屏（第 N 波 / 破纪录或历史最高 / 功德）；点击返回主菜单。
5. 再次进入首页，历史最高波数已更新；境界星级**未变化**。

- [ ] **Step 3: 正常模式回归**

取消勾选 → 开始：确认仍是 10 波通关、上半场有 AI 对手唐僧、通关/失守走原星级结算动画、境界正常涨降。

- [ ] **Step 4: 汇报**

记录验证结果（含 UI 是否符合预期、任何未能自动化的部分）。若发现问题，回到对应 Task 修复。

---

## Self-Review 结论

- **Spec 覆盖**：入口勾选(Task 6)、分圈难度(Task 2)、固定基准 difficultyMul=1(默认参数)、关对手(Task 3)、不封顶(Task 3)、上半场信息面板(Task 7)、独立结算只记最高波(Task 4+5)、持久化(Task 1)、测试(Task 2/3/8/9) 均有对应任务。
- **功德**：按 spec「无尽仍发放功德」实现（Task 4 Step 5，`meritReward(false, wave)`），与境界星级解耦。
- **类型一致性**：`effectiveDifficulty`、`endless`、`EndlessResult`、`drawEndlessSettle`、`drawEndlessPanel`、`recordBestWave/getBestWave/loadEndlessEnabled/setEndlessEnabled` 全流程命名一致。
- **回归保护**：正常模式 `effectiveDifficulty===difficultyMul`、通关判定保留（Task 2/3 含回归用例），UI 手测含正常模式回归（Task 9 Step 3）。
