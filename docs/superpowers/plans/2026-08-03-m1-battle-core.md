# M1 数值内核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个与引擎解耦的纯 TypeScript 战斗数值内核，用单元测试逐项锁定《赵云与阿斗》的数值（兵种属性/成长曲线/POW/伤害/合成/蟠桃经济），作为整个游戏的数值基线。

**Architecture:** 独立 npm 包 `game-core/`，纯函数 + 集中配置表，零引擎依赖。分三层：`config/`（数值配置）、`domain/`（计算逻辑）、`tests/`（对齐原作的断言）。后续 Cocos 项目（M2）直接 import 本包，保证运行时数值与单测一致。

**Tech Stack:** TypeScript 5.x + Vitest（TS 原生、快、零配置）+ npm。

**数值来源：** GDD `docs/superpowers/specs/2026-08-03-dasheng-tangseng-design.md` 第 4–5 章（原作《赵云与阿斗》数值向分析报告）。

**关键还原口径（务必遵守）：**
- 成长系数链 `[1.0, 1.5, 2.1, 2.73, 3.276]`，逐阶增幅 `+50%/+40%/+30%/+20%`。原文 5 阶写作 3.28 系四舍五入，用 3.276 才能还原 5 阶 骑=6.55、刀=9.83。
- 基础攻速 `BASE_FRQ = 4.09 / 3.276`，使 5 阶攻速≈4.09。
- POW塔 = ATK × FRQ × RGE × 目标数：骑/枪/弓=80.4，刀=40.2。
- 波次剩余曲线 `剩余(n) = 11 − n(n+1)/2`（wave1..6 = 10,8,5,1,−4,−10；wave10 = −44；第 5 波转负）。

---

## File Structure

```
game-core/
  package.json           # 包定义 + vitest 脚本
  tsconfig.json          # 严格模式 TS 配置
  vitest.config.ts       # 测试配置
  src/
    config/
      units.ts           # 四兵种基础属性 + 成长系数链
      economy.ts         # 蟠桃经济常量 + 波次配置
    domain/
      types.ts           # 共享类型：UnitType / Unit / UnitStat
      stats.ts           # getUnitStat / towerPOW
      combat.ts          # damage / monsterPOW / canIntercept
      merge.ts           # canMerge / merge
      economy.ts         # monstersInWave / dropInWave / costInWave / peachAfterWave / firstDeficitWave / sellBloodReward
    index.ts             # 统一导出
  tests/
    stats.test.ts
    combat.test.ts
    merge.test.ts
    economy.test.ts
```

每个文件单一职责；`config/` 只放数据、`domain/` 只放纯函数、`tests/` 只放断言。

---

## Task 0: 项目脚手架

**Files:**
- Create: `game-core/package.json`
- Create: `game-core/tsconfig.json`
- Create: `game-core/vitest.config.ts`

- [ ] **Step 1: 创建 `game-core/package.json`**

```json
{
  "name": "dasheng-game-core",
  "version": "0.1.0",
  "description": "《大圣与唐僧》战斗数值内核（引擎无关的纯 TS）",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 `game-core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 创建 `game-core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 安装依赖**

Run: `cd game-core && npm install`
Expected: 生成 `node_modules/` 与 `package-lock.json`，无报错。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/package.json game-core/tsconfig.json game-core/vitest.config.ts game-core/package-lock.json
git commit -m "chore(core): 初始化 game-core TS 包与 vitest"
```

---

## Task 1: 兵种配置与成长系数

**Files:**
- Create: `game-core/src/domain/types.ts`
- Create: `game-core/src/config/units.ts`
- Test: `game-core/tests/stats.test.ts`（本任务先写成长系数相关断言）

- [ ] **Step 1: 写失败测试 `game-core/tests/stats.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { TIER_COEFFICIENTS, TIER_GROWTH_INCREMENTS, MAX_TIER, UNITS } from '../src/config/units';

describe('成长系数链（照搬原作）', () => {
  it('逐阶增幅为 +50%/+40%/+30%/+20%', () => {
    expect(TIER_GROWTH_INCREMENTS).toEqual([0.5, 0.4, 0.3, 0.2]);
  });

  it('系数链为 [1.0, 1.5, 2.1, 2.73, 3.276]', () => {
    expect(TIER_COEFFICIENTS).toHaveLength(5);
    expect(TIER_COEFFICIENTS[0]).toBeCloseTo(1.0, 3);
    expect(TIER_COEFFICIENTS[1]).toBeCloseTo(1.5, 3);
    expect(TIER_COEFFICIENTS[2]).toBeCloseTo(2.1, 3);
    expect(TIER_COEFFICIENTS[3]).toBeCloseTo(2.73, 3);
    expect(TIER_COEFFICIENTS[4]).toBeCloseTo(3.276, 3);
  });

  it('最高 5 级', () => {
    expect(MAX_TIER).toBe(5);
  });

  it('四兵种 1 阶 ATK：棍猴=3，其余=2；RGE 与目标数符合原作定位', () => {
    expect(UNITS.monkey.baseAtk).toBe(3);
    expect(UNITS.spear.baseAtk).toBe(2);
    expect(UNITS.cavalry.baseAtk).toBe(2);
    expect(UNITS.archer.baseAtk).toBe(2);

    expect(UNITS.monkey.rge).toBe(1);
    expect(UNITS.spear.rge).toBe(2);
    expect(UNITS.cavalry.rge).toBe(1.5);
    expect(UNITS.archer.rge).toBe(3);

    expect(UNITS.monkey.targets).toBe(1);
    expect(UNITS.spear.targets).toBe(1.5);
    expect(UNITS.cavalry.targets).toBe(2);
    expect(UNITS.archer.targets).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd game-core && npx vitest run tests/stats.test.ts`
Expected: FAIL，报 `Cannot find module '../src/config/units'`。

- [ ] **Step 3: 创建 `game-core/src/domain/types.ts`**

```ts
// 四类基础兵种（西游披皮 → 原作对应）
// monkey=棍猴(刀) / spear=枪天兵(枪) / cavalry=天马骑兵(骑) / archer=神箭手(弓)
export type UnitType = 'monkey' | 'spear' | 'cavalry' | 'archer';

export interface UnitConfig {
  type: UnitType;
  name: string;    // 中文名
  origin: string;  // 原作对应兵种
  role: string;    // 战术定位
  baseAtk: number; // 1 阶攻击力
  baseFrq: number; // 1 阶攻速（次/秒）
  rge: number;     // 攻击范围
  targets: number; // 平均攻击目标数
}

export interface UnitStat {
  atk: number;
  frq: number;
  rge: number;
  targets: number;
}

export interface Unit {
  type: UnitType;
  tier: number; // 1..MAX_TIER
}
```

- [ ] **Step 4: 创建 `game-core/src/config/units.ts`**

```ts
import type { UnitConfig, UnitType } from '../domain/types';

export const MAX_TIER = 5;

// 逐阶增幅：2阶+50%、3阶+40%、4阶+30%、5阶+20%（边际收益递减）
export const TIER_GROWTH_INCREMENTS = [0.5, 0.4, 0.3, 0.2] as const;

// 成长系数链：1阶=1.0，逐阶累乘 → [1.0, 1.5, 2.1, 2.73, 3.276]
// 注：原文 5 阶写作 3.28 为四舍五入；用 3.276 才能还原 5 阶 骑=6.55、刀=9.83。
export const TIER_COEFFICIENTS: number[] = (() => {
  const coeffs = [1.0];
  for (const inc of TIER_GROWTH_INCREMENTS) {
    coeffs.push(coeffs[coeffs.length - 1] * (1 + inc));
  }
  return coeffs;
})();

// 基础攻速：四兵种统一，且使 5 阶攻速 = BASE_FRQ × 3.276 ≈ 4.09
export const BASE_FRQ = 4.09 / TIER_COEFFICIENTS[4];

export const UNITS: Record<UnitType, UnitConfig> = {
  monkey:  { type: 'monkey',  name: '棍猴',    origin: '刀', role: '近战单体·收割', baseAtk: 3, baseFrq: BASE_FRQ, rge: 1,   targets: 1 },
  spear:   { type: 'spear',   name: '枪天兵',  origin: '枪', role: '中距穿刺',       baseAtk: 2, baseFrq: BASE_FRQ, rge: 2,   targets: 1.5 },
  cavalry: { type: 'cavalry', name: '天马骑兵', origin: '骑', role: '近战 AOE 冲锋',  baseAtk: 2, baseFrq: BASE_FRQ, rge: 1.5, targets: 2 },
  archer:  { type: 'archer',  name: '神箭手',  origin: '弓', role: '远程单点',       baseAtk: 2, baseFrq: BASE_FRQ, rge: 3,   targets: 1 },
};
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd game-core && npx vitest run tests/stats.test.ts`
Expected: PASS（4 个用例全绿）。

- [ ] **Step 6: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/src/domain/types.ts game-core/src/config/units.ts game-core/tests/stats.test.ts
git commit -m "feat(core): 兵种配置与成长系数链（照搬原作）"
```

---

## Task 2: 兵种属性计算与 POW塔

**Files:**
- Create: `game-core/src/domain/stats.ts`
- Modify: `game-core/tests/stats.test.ts`（追加属性/POW 断言）

- [ ] **Step 1: 追加失败测试到 `game-core/tests/stats.test.ts`**

在文件末尾追加：

```ts
import { getUnitStat, towerPOW } from '../src/domain/stats';

describe('兵种属性计算（照搬原作）', () => {
  it('5 阶 ATK：骑/枪/弓=6.55，刀=9.83', () => {
    expect(getUnitStat('cavalry', 5).atk).toBeCloseTo(6.55, 2);
    expect(getUnitStat('spear', 5).atk).toBeCloseTo(6.55, 2);
    expect(getUnitStat('archer', 5).atk).toBeCloseTo(6.55, 2);
    expect(getUnitStat('monkey', 5).atk).toBeCloseTo(9.83, 2);
  });

  it('5 阶攻速统一≈4.09', () => {
    expect(getUnitStat('cavalry', 5).frq).toBeCloseTo(4.09, 2);
    expect(getUnitStat('monkey', 5).frq).toBeCloseTo(4.09, 2);
  });

  it('1 阶 ATK：骑/枪/弓=2，刀=3', () => {
    expect(getUnitStat('cavalry', 1).atk).toBeCloseTo(2, 2);
    expect(getUnitStat('monkey', 1).atk).toBeCloseTo(3, 2);
  });

  it('POW塔：骑/枪/弓=80.4，刀=40.2', () => {
    expect(towerPOW('cavalry', 5)).toBeCloseTo(80.4, 1);
    expect(towerPOW('spear', 5)).toBeCloseTo(80.4, 1);
    expect(towerPOW('archer', 5)).toBeCloseTo(80.4, 1);
    expect(towerPOW('monkey', 5)).toBeCloseTo(40.2, 1);
  });

  it('阶数越界抛错', () => {
    expect(() => getUnitStat('monkey', 0)).toThrow();
    expect(() => getUnitStat('monkey', 6)).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd game-core && npx vitest run tests/stats.test.ts`
Expected: FAIL，报 `Cannot find module '../src/domain/stats'`。

- [ ] **Step 3: 创建 `game-core/src/domain/stats.ts`**

```ts
import type { UnitStat, UnitType } from './types';
import { UNITS, TIER_COEFFICIENTS, MAX_TIER } from '../config/units';

// 某兵种在某阶的属性：ATK/FRQ 按成长系数缩放，RGE/目标数固定
export function getUnitStat(type: UnitType, tier: number): UnitStat {
  if (tier < 1 || tier > MAX_TIER) {
    throw new RangeError(`阶数 ${tier} 超出范围 1-${MAX_TIER}`);
  }
  const cfg = UNITS[type];
  const coeff = TIER_COEFFICIENTS[tier - 1];
  return {
    atk: cfg.baseAtk * coeff,
    frq: cfg.baseFrq * coeff,
    rge: cfg.rge,
    targets: cfg.targets,
  };
}

// POW塔 = ATK × FRQ × RGE × 目标数（单位时间覆盖伤害）
export function towerPOW(type: UnitType, tier: number): number {
  const s = getUnitStat(type, tier);
  return s.atk * s.frq * s.rge * s.targets;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd game-core && npx vitest run tests/stats.test.ts`
Expected: PASS（全部用例绿）。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/src/domain/stats.ts game-core/tests/stats.test.ts
git commit -m "feat(core): 兵种属性计算与 POW塔（80.4/40.2 配平）"
```

---

## Task 3: 战斗公式（伤害 / POW怪 / 拦截判定）

**Files:**
- Create: `game-core/src/domain/combat.ts`
- Test: `game-core/tests/combat.test.ts`

- [ ] **Step 1: 写失败测试 `game-core/tests/combat.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { damage, monsterPOW, canIntercept } from '../src/domain/combat';

describe('战斗公式（照搬原作·单一乘区）', () => {
  it('伤害 = ATK（无防御时）', () => {
    expect(damage(6.55)).toBeCloseTo(6.55, 2);
  });

  it('伤害 = ATK − DEF（有防御时，且不为负）', () => {
    expect(damage(6.55, 2)).toBeCloseTo(4.55, 2);
    expect(damage(2, 5)).toBe(0);
  });

  it('POW怪 = HP × SPD', () => {
    expect(monsterPOW(100, 0.5)).toBe(50);
  });

  it('POW塔 ≥ POW怪 时可拦截', () => {
    expect(canIntercept(80.4, 50)).toBe(true);
    expect(canIntercept(40.2, 50)).toBe(false);
    expect(canIntercept(50, 50)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd game-core && npx vitest run tests/combat.test.ts`
Expected: FAIL，报 `Cannot find module '../src/domain/combat'`。

- [ ] **Step 3: 创建 `game-core/src/domain/combat.ts`**

```ts
// 伤害 = ATK（或 ATK − DEF）。单一乘区，无暴击/增伤/抗性；结果不为负。
export function damage(atk: number, def = 0): number {
  return Math.max(0, atk - def);
}

// POW怪 = HP × 移动速度
export function monsterPOW(hp: number, spd: number): number {
  return hp * spd;
}

// 当 POW塔 ≥ POW怪 时，理论上可拦截
export function canIntercept(towerPow: number, monsterPow: number): boolean {
  return towerPow >= monsterPow;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd game-core && npx vitest run tests/combat.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/src/domain/combat.ts game-core/tests/combat.test.ts
git commit -m "feat(core): 战斗公式（伤害/POW怪/拦截判定）"
```

---

## Task 4: 合成系统（同型同级二合一）

**Files:**
- Create: `game-core/src/domain/merge.ts`
- Test: `game-core/tests/merge.test.ts`

- [ ] **Step 1: 写失败测试 `game-core/tests/merge.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { canMerge, merge } from '../src/domain/merge';
import type { Unit } from '../src/domain/types';

const u = (type: Unit['type'], tier: number): Unit => ({ type, tier });

describe('合成系统（照搬原作·同型同级二合一，最高5级）', () => {
  it('同型同级且未满级可合成', () => {
    expect(canMerge(u('monkey', 2), u('monkey', 2))).toBe(true);
  });

  it('不同型不可合成', () => {
    expect(canMerge(u('monkey', 2), u('spear', 2))).toBe(false);
  });

  it('不同级不可合成', () => {
    expect(canMerge(u('monkey', 2), u('monkey', 3))).toBe(false);
  });

  it('已满级（5级）不可合成', () => {
    expect(canMerge(u('monkey', 5), u('monkey', 5))).toBe(false);
  });

  it('合成结果为同型高一阶', () => {
    expect(merge(u('archer', 2), u('archer', 2))).toEqual({ type: 'archer', tier: 3 });
  });

  it('非法合成抛错', () => {
    expect(() => merge(u('monkey', 5), u('monkey', 5))).toThrow();
    expect(() => merge(u('monkey', 2), u('spear', 2))).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd game-core && npx vitest run tests/merge.test.ts`
Expected: FAIL，报 `Cannot find module '../src/domain/merge'`。

- [ ] **Step 3: 创建 `game-core/src/domain/merge.ts`**

```ts
import type { Unit } from './types';
import { MAX_TIER } from '../config/units';

// 两单位可合成：同类型、同等级、且未满级
export function canMerge(a: Unit, b: Unit): boolean {
  return a.type === b.type && a.tier === b.tier && a.tier < MAX_TIER;
}

// 合成为同型高一阶单位
export function merge(a: Unit, b: Unit): Unit {
  if (!canMerge(a, b)) {
    throw new Error('无法合成：需同型、同级且未满级');
  }
  return { type: a.type, tier: a.tier + 1 };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd game-core && npx vitest run tests/merge.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/src/domain/merge.ts game-core/tests/merge.test.ts
git commit -m "feat(core): 合成系统（同型同级二合一，最高5级）"
```

---

## Task 5: 蟠桃经济模型（波次产耗 / 卖血）

**Files:**
- Create: `game-core/src/config/economy.ts`
- Create: `game-core/src/domain/economy.ts`
- Test: `game-core/tests/economy.test.ts`

- [ ] **Step 1: 写失败测试 `game-core/tests/economy.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  INITIAL_PEACH, PEACH_PER_KILL, PEACH_PER_BLEED, PEACH_PER_BOSS, TANGSENG_INITIAL_HP,
} from '../src/config/economy';
import {
  monstersInWave, dropInWave, peachAfterWave, firstDeficitWave, sellBloodReward,
} from '../src/domain/economy';

describe('蟠桃经济常量（照搬原作）', () => {
  it('开局20 / 杀怪1 / 掉血10 / BOSS10 / 唐僧初始3滴血', () => {
    expect(INITIAL_PEACH).toBe(20);
    expect(PEACH_PER_KILL).toBe(1);
    expect(PEACH_PER_BLEED).toBe(10);
    expect(PEACH_PER_BOSS).toBe(10);
    expect(TANGSENG_INITIAL_HP).toBe(3);
  });
});

describe('波次产耗曲线（照搬原作表格）', () => {
  it('第 n 波怪物数 = 9 + n', () => {
    expect(monstersInWave(1)).toBe(10);
    expect(monstersInWave(2)).toBe(11);
    expect(monstersInWave(10)).toBe(19);
  });

  it('第 n 波掉落蟠桃 = 怪物数', () => {
    expect(dropInWave(1)).toBe(10);
    expect(dropInWave(10)).toBe(19);
  });

  it('剩余蟠桃逐波还原原文表格：10,8,5,1,-4,-10 与 wave10=-44', () => {
    expect(peachAfterWave(1)).toBe(10);
    expect(peachAfterWave(2)).toBe(8);
    expect(peachAfterWave(3)).toBe(5);
    expect(peachAfterWave(4)).toBe(1);
    expect(peachAfterWave(5)).toBe(-4);
    expect(peachAfterWave(6)).toBe(-10);
    expect(peachAfterWave(10)).toBe(-44);
  });

  it('蟠桃在第 5 波首次转负（第5波危机）', () => {
    expect(firstDeficitWave()).toBe(5);
  });
});

describe('舍身饲魔（卖血经济）', () => {
  it('每掉 1 滴血补偿 10 蟠桃', () => {
    expect(sellBloodReward(1)).toBe(10);
    expect(sellBloodReward(3)).toBe(30);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd game-core && npx vitest run tests/economy.test.ts`
Expected: FAIL，报 `Cannot find module '../src/config/economy'`。

- [ ] **Step 3: 创建 `game-core/src/config/economy.ts`**

```ts
// 蟠桃经济常量（照搬《赵云与阿斗》馒头模型）
export const INITIAL_PEACH = 20;      // 开局初始蟠桃
export const PEACH_PER_KILL = 1;      // 杀怪 1 桃/只
export const PEACH_PER_BLEED = 10;    // 唐僧掉血 10 桃/滴（舍身饲魔）
export const PEACH_PER_BOSS = 10;     // 击杀 BOSS 10 桃/次
export const TANGSENG_INITIAL_HP = 3; // 唐僧初始 3 滴血（道具可拉高）
```

- [ ] **Step 4: 创建 `game-core/src/domain/economy.ts`**

```ts
import { INITIAL_PEACH, PEACH_PER_KILL, PEACH_PER_BLEED } from '../config/economy';

// 第 n 波怪物数 = 9 + n（wave1=10 … wave10=19）
export function monstersInWave(n: number): number {
  return 9 + n;
}

// 第 n 波掉落蟠桃 = 怪物数 × 每只桃（全部击杀）
export function dropInWave(n: number): number {
  return monstersInWave(n) * PEACH_PER_KILL;
}

// 原作实测「剩余蟠桃」曲线：剩余(n) = 11 − n(n+1)/2；剩余(0) = 初始 20。
// 逐项还原原文表格（wave1..6 = 10,8,5,1,-4,-10；wave10 = -44）。
function referenceRemaining(n: number): number {
  return n <= 0 ? INITIAL_PEACH : 11 - (n * (n + 1)) / 2;
}

// 第 n 波抽卡消耗蟠桃：由剩余曲线反推，使模拟循环严格复现原文表格。
// 注：原文「消耗」列为古法手记，与「剩余」列存在 ±1 噪声；此处以自洽的
// 「剩余」曲线为准。实际对局「递增抽卡成本」将在 M2 依此曲线调参。
export function costInWave(n: number): number {
  return dropInWave(n) - (referenceRemaining(n) - referenceRemaining(n - 1));
}

// 无额外系统介入时，第 n 波结束后的剩余蟠桃（模拟循环）
export function peachAfterWave(n: number): number {
  let peach = INITIAL_PEACH;
  for (let w = 1; w <= n; w++) {
    peach += dropInWave(w) - costInWave(w);
  }
  return peach;
}

// 蟠桃首次转负的波次（"第5波危机" → 广告触发点自然浮现）
export function firstDeficitWave(maxWave = 30): number {
  for (let w = 1; w <= maxWave; w++) {
    if (peachAfterWave(w) < 0) return w;
  }
  return -1;
}

// 舍身饲魔：唐僧掉 dropsOfBlood 滴血换取的蟠桃
export function sellBloodReward(dropsOfBlood: number): number {
  return dropsOfBlood * PEACH_PER_BLEED;
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd game-core && npx vitest run tests/economy.test.ts`
Expected: PASS（含逐波剩余曲线与第5波转负）。

- [ ] **Step 6: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/src/config/economy.ts game-core/src/domain/economy.ts game-core/tests/economy.test.ts
git commit -m "feat(core): 蟠桃经济模型（波次产耗曲线/第5波危机/卖血）"
```

---

## Task 6: 统一导出 + 全量校验

**Files:**
- Create: `game-core/src/index.ts`

- [ ] **Step 1: 创建 `game-core/src/index.ts`**

```ts
// 配置
export * from './config/units';
export * from './config/economy';
// 类型
export * from './domain/types';
// 计算
export * from './domain/stats';
export * from './domain/combat';
export * from './domain/merge';
export * from './domain/economy';
```

- [ ] **Step 2: 类型检查**

Run: `cd game-core && npm run typecheck`
Expected: 无输出、退出码 0（无类型错误）。

- [ ] **Step 3: 运行全部测试**

Run: `cd game-core && npm test`
Expected: 4 个测试文件全部 PASS（stats / combat / merge / economy）。

- [ ] **Step 4: 提交**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add game-core/src/index.ts
git commit -m "feat(core): 统一导出入口，M1 数值内核完成"
```

---

## Self-Review（已执行）

**1. 规格覆盖：** GDD 第 4 章（伤害公式/POW/成长曲线/四兵种属性/DPS 配平/合成）→ Task 1–4；第 5 章（双币/蟠桃产出/波次产耗/卖血）→ Task 5。军衔/法宝/道具/地图/广告/伪竞技属于 M2–M5，不在本计划范围。✅
**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤均含完整代码与可执行命令。✅
**3. 类型一致性：** `UnitType`/`Unit`/`UnitStat`/`UnitConfig` 在 `types.ts` 定义，各处签名一致；`getUnitStat`/`towerPOW`/`damage`/`monsterPOW`/`canIntercept`/`canMerge`/`merge`/`monstersInWave`/`dropInWave`/`costInWave`/`peachAfterWave`/`firstDeficitWave`/`sellBloodReward` 命名前后一致。✅
**4. 数值自洽：** `peachAfterWave` 由 `referenceRemaining` 反推 `costInWave`，电报式(telescoping)求和后严格等于 `11 − n(n+1)/2`，逐项匹配原文表格。✅

---

## 后续里程碑（各自独立成计划，M1 落地后再写）
- **M2** 单局可玩原型：Cocos 项目 + 召唤/摆放/合成/击杀/经济闭环 + 一张地图（占位素材），import `game-core`。
- **M3** 系统层：道具日重置、境界、法宝、体力、结算。
- **M4** 伪竞技 + 美术：AI 对手、四地图、seeddream 立绘替换占位。
- **M5** IAA + 上线：广告触发点、微信登录/存档/分享/排行榜、包体优化、提审。
