# 五行相克战斗系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给武将/怪物/地图加五行相克（克制 ×1.25 / 被克 ×0.75），新增第 5 张土图「黄风岭」，含全套徽章/飘字表现，覆盖 PvE 与 PvP。

**Architecture:** 克制表与倍率是 `@core` 纯函数（`elementMul`），数据层给武将/怪物挂 `element` 字段（怪物按地图统一继承），倍率在 `hurtMonster`/`hurtAiMonster` 统一落点注入（其余调用点用默认参数 `null` = 不吃克制），`estimateOptimalPower` 计入均值修正保 ai-balance。PvP 服务端只转发快照，零改动。

**Tech Stack:** TypeScript + Vite + Vitest + Canvas 2D。规格文档：`docs/superpowers/specs/2026-08-24-wuxing-elements-design.md`。

**关键约束（来自项目记忆/惯例）：**
- vitest 必须在 `web/` 目录跑（game-core 侧在自己的目录跑）
- web 的 tsc 基线有 ~28 处既有报错，验收标准是「不新增」
- 改 `battle.ts`/TUNING 必过 `web/tests/ai-balance.test.ts` 门禁
- TUNING 加键必须进 `web/src/devtools/bags.ts` 的分组 Set
- 测试只能放 `web/tests/`（vitest include 只收 `tests/**`）

---

### Task 1: `@core` wuxing 纯函数模块

**Files:**
- Create: `game-core/src/config/wuxing.ts`
- Modify: `game-core/src/index.ts`
- Test: `game-core/tests/wuxing.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `game-core/tests/wuxing.test.ts`（对齐 `game-core/tests/combat.test.ts` 的风格）：

```ts
// 五行相克纯函数：克制环 5×5 全表 + 空属性回退。
import { describe, it, expect } from 'vitest';
import { elementMul, ELEMENTS, ELEMENT_ZH, ELEMENT_COLOR, type Element } from '../src/config/wuxing';

describe('elementMul（五行相克倍率）', () => {
  // 期望的克制环：金→木→土→水→火→金
  const ADV: [Element, Element][] = [
    ['metal', 'wood'], ['wood', 'earth'], ['earth', 'water'], ['water', 'fire'], ['fire', 'metal'],
  ];

  it('克制方 ×advMul（默认 1.25）', () => {
    for (const [atk, def] of ADV) expect(elementMul(atk, def)).toBe(1.25);
  });

  it('被克方 ×disMul（默认 0.75）', () => {
    for (const [atk, def] of ADV) expect(elementMul(def, atk)).toBe(0.75);
  });

  it('无关系 ×1.0（含自身）', () => {
    const all: Element[] = ELEMENTS.map((e) => e.id);
    for (const a of all) for (const d of all) {
      if (a === d) continue;
      if (ADV.some(([x, y]) => (x === a && y === d) || (x === d && y === a))) continue;
      expect(elementMul(a, d)).toBe(1.0);
    }
    for (const a of all) expect(elementMul(a, a)).toBe(1.0);
  });

  it('任一方为 null → ×1.0（兵种/无属性图不参与克制）', () => {
    for (const e of ELEMENTS.map((x) => x.id)) {
      expect(elementMul(e, null)).toBe(1.0);
      expect(elementMul(null, e)).toBe(1.0);
    }
    expect(elementMul(null, null)).toBe(1.0);
  });

  it('倍率可由调用方传入（TUNING 热改）', () => {
    expect(elementMul('water', 'fire', 1.4, 0.6)).toBe(1.4);
    expect(elementMul('fire', 'water', 1.4, 0.6)).toBe(0.6);
  });
});

describe('ELEMENTS 元数据', () => {
  it('五元素齐全，中文/色值一一对应', () => {
    expect(ELEMENTS.map((e) => e.id)).toEqual(['metal', 'wood', 'water', 'fire', 'earth']);
    expect(ELEMENTS.map((e) => e.zh)).toEqual(['金', '木', '水', '火', '土']);
    for (const e of ELEMENTS) {
      expect(ELEMENT_ZH[e.id]).toBe(e.zh);
      expect(ELEMENT_COLOR[e.id]).toBe(e.color);
      expect(e.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd game-core && npx vitest run tests/wuxing.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现模块**

创建 `game-core/src/config/wuxing.ts`：

```ts
// 五行相克：金→木→土→水→火→金（箭头=克制方）。
// 倍率由调用方传入（web 侧来自 TUNING，可 DevTools 热改），core 不持有游戏态。
export type Element = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

export interface ElementMeta {
  id: Element;
  zh: string;   // 中文名（徽章/帮助文案用）
  color: string; // 主题色（徽章底色/克制飘字用）
}

/** 五元素顺序元数据（金木水火土），表现层统一取这里的中文与色值 */
export const ELEMENTS: ElementMeta[] = [
  { id: 'metal', zh: '金', color: '#e8b423' },
  { id: 'wood', zh: '木', color: '#4caf50' },
  { id: 'water', zh: '水', color: '#3d8bff' },
  { id: 'fire', zh: '火', color: '#f4511e' },
  { id: 'earth', zh: '土', color: '#a1743c' },
];

export const ELEMENT_ZH: Record<Element, string> = Object.fromEntries(ELEMENTS.map((e) => [e.id, e.zh])) as Record<Element, string>;
export const ELEMENT_COLOR: Record<Element, string> = Object.fromEntries(ELEMENTS.map((e) => [e.id, e.color])) as Record<Element, string>;

/** 克制环：key 克 value（金克木、木克土、土克水、水克火、火克金） */
const OVERCOMES: Record<Element, Element> = {
  metal: 'wood',
  wood: 'earth',
  earth: 'water',
  water: 'fire',
  fire: 'metal',
};

/**
 * 克制倍率：atk 克 def → advMul；atk 被克 → disMul；其余（含同行/任一方 null）→ 1。
 * 兵种（无属性）与无属性目标一律不吃克制。
 */
export function elementMul(atk: Element | null, def: Element | null, advMul = 1.25, disMul = 0.75): number {
  if (!atk || !def) return 1;
  if (OVERCOMES[atk] === def) return advMul;
  if (OVERCOMES[def] === atk) return disMul;
  return 1;
}
```

修改 `game-core/src/index.ts`，在 `export * from './config/economy';` 之后加一行：

```ts
export * from './config/wuxing';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd game-core && npx vitest run tests/wuxing.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: game-core 全量回归**

Run: `cd game-core && npx vitest run`
Expected: 全 PASS（既有 merge/combat/economy/stats 不受影响）

- [ ] **Step 6: Commit**

```bash
git add game-core/src/config/wuxing.ts game-core/src/index.ts game-core/tests/wuxing.test.ts
git commit -m "feat(core): 五行相克纯函数 elementMul + 元素元数据（金木水火土）"
```

---

### Task 2: 24 武将挂 `element` 字段

**Files:**
- Modify: `web/src/generals.ts`（`GeneralDef` 接口 `:24-45` + `GENERALS` 表 `:59-155`）
- Test: `web/tests/wuxing.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `web/tests/wuxing.test.ts`：

```ts
// 五行相克：数据层校验（武将 element 字段 / MAP_ELEMENT / 注入）。
// 各段由对应任务追加；本文件随功能分阶段成长。
import { describe, it, expect } from 'vitest';
import { GENERALS } from '../src/generals';
import { ELEMENTS, type Element } from '@core';

describe('GENERALS.element（武将五行）', () => {
  const VALID = new Set(ELEMENTS.map((e) => e.id));

  it('24 将 element 全部合法', () => {
    expect(GENERALS).toHaveLength(24);
    for (const g of GENERALS) expect(VALID.has(g.element)).toBe(true);
  });

  it('分布均衡：金5 木5 水5 火5 土4', () => {
    const count: Record<string, number> = {};
    for (const g of GENERALS) count[g.element] = (count[g.element] ?? 0) + 1;
    expect(count).toEqual({ metal: 5, wood: 5, water: 5, fire: 5, earth: 4 });
  });

  it('每行至少 1 个非「过渡」武将（克图阵容可用）', () => {
    for (const el of ELEMENTS.map((e) => e.id)) {
      const main = GENERALS.filter((g) => g.element === el && g.role !== '过渡');
      expect(main.length, `${el} 行缺少主力`).toBeGreaterThanOrEqual(1);
    }
  });

  it('火克金（白骨岭对策）与水克火（火焰山对策）的核心将在对应行', () => {
    // 火焰山=火，需水系：八戒/白龙应在水行
    expect(GENERALS.find((g) => g.id === 'bajie')!.element).toBe('water');
    // 白骨岭=金，需火系：哪吒应在火行
    expect(GENERALS.find((g) => g.id === 'nezha')!.element).toBe('fire');
    // 盘丝洞=木，需金系：大圣应在金行
    expect(GENERALS.find((g) => g.id === 'dasheng')!.element).toBe('metal');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: FAIL（`GeneralDef` 无 `element` 字段，tsc 层面测试文件即编译错——vitest 会报属性不存在或 undefined 断言失败）

- [ ] **Step 3: 加字段与数据**

`web/src/generals.ts` 顶部 import 区（已有 `@core` 引入的话就近合并；没有则新增）：

```ts
import type { Element } from '@core';
```

`GeneralDef` 接口（`:24-45`）`family: string;` 之后加：

```ts
  element: Element; // 五行：对克制地图怪 ×advMul / 被克 ×disMul（兵种无属性不参与）
```

然后按下表给 `GENERALS` 里 24 条数据各加一个 `element` 字段（加在 `family: 'X' }` 前、同一行对象内任意位置，建议紧跟 `family`）。id → element 完整映射：

| element | id 列表 |
|---|---|
| `'metal'` | `dasheng` `erlang` `jinzha` `baigujing` `wenshu` |
| `'wood'` | `tieshan` `qingniu` `damang` `huishu` `fanyin` |
| `'water'` | `bajie` `bailong` `shaseng` `guanyin` `baxian` |
| `'fire'` | `nezha` `honghaier` `hongpao` `laojun` `danjun` |
| `'earth'` | `niumowang` `tiebei` `liusha` `niulang` |

示例（大圣条目改后）：

```ts
  { id: 'dasheng', name: '大圣', chars: ['大', '圣'], role: '输出', rank: 'T0', skill: 'burst',
    skillName: '七十二变·横扫', skillDesc: '直线贯穿爆发，命中约3×攻', atk: 4.22, frq: 1.6, rge: 2.5, targets: 2, skillCd: 8, weight: 1, asset: 'hero-wukong',
    maxTier: 5, atkStyle: '快攻贯穿', family: '大', element: 'metal' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: PASS

- [ ] **Step 5: 相关回归（武将数据被多处消费）**

Run: `cd web && npx vitest run tests/general-family.test.ts tests/general-panel-layout.test.ts tests/hero-skill-focus-dps.test.ts`
Expected: PASS（加字段不改数值，理论上无影响；若有面板布局测试断言字段数需同步，按其断言更新）

- [ ] **Step 6: Commit**

```bash
git add web/src/generals.ts web/tests/wuxing.test.ts
git commit -m "feat(web): 24 武将挂五行 element 字段（金5木5水5火5土4）"
```

---

### Task 3: TUNING 克制常量 + DevTools 分组

**Files:**
- Modify: `web/src/battle.ts`（`TUNING` 对象 `:111-290`）
- Modify: `web/src/devtools/bags.ts`（`TUNING_SKILL_KEYS` `:148-165`）

- [ ] **Step 1: TUNING 加键**

在 `web/src/battle.ts` 的 `TUNING` 对象里、`weakenAtkMul` 同区域（「怪物技能与对兵器控制」数值附近）加：

```ts
  wuxingAdvMul: 1.25, // 五行克制方伤害倍率（克 ×1.25）
  wuxingDisMul: 0.75, // 五行被克方伤害倍率（被克 ×0.75）
```

- [ ] **Step 2: DevTools 分组登记**

`web/src/devtools/bags.ts` 的 `TUNING_SKILL_KEYS`（英雄技能 Tab）Set 内加两键（这是伤害乘区类键的既有归属组，`atkBuffMul` 等同侧）：

```ts
  'wuxingAdvMul', 'wuxingDisMul',
```

- [ ] **Step 3: DevTools 测试回归**

Run: `cd web && npx vitest run tests/devtools.test.ts tests/devtools-sim.test.ts tests/bag.test.ts`
Expected: PASS（若 devtools 测试断言「每键必属一组」之类清单，按断言补齐后重跑）

- [ ] **Step 4: Commit**

```bash
git add web/src/battle.ts web/src/devtools/bags.ts
git commit -m "feat(web): TUNING 新增五行克制倍率键并登记 DevTools 技能分组"
```

---

### Task 4: `MAP_ELEMENT` + 怪物按图继承五行

**Files:**
- Modify: `web/src/battle.ts`（`MAP_SKILL` 旁 `:428-433`、`Monster` 接口 `:678-701`、`makeOne` `:5810`）
- Test: `web/tests/wuxing.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

`web/tests/wuxing.test.ts` 追加（import 区补 `import { Battle } from '../src/battle'; import { MAP_ELEMENT } from '../src/battle'; import { mapById } from '../src/board';`）：

```ts
describe('MAP_ELEMENT（地图五行）', () => {
  it('现有四图各配一行，与 MAP_SKILL 同范式', () => {
    expect(MAP_ELEMENT.huoyanshan).toBe('fire');
    expect(MAP_ELEMENT.liushahe).toBe('water');
    expect(MAP_ELEMENT.baiguling).toBe('metal');
    expect(MAP_ELEMENT.pansidong).toBe('wood');
    // 黄风岭在 Task 7 补齐后此断言放开为 earth
  });
});

describe('怪物 element（按地图统一继承）', () => {
  it('火焰山开波后怪物 element 为 fire（小怪/妖王同图统一）', () => {
    const b = new Battle(1, 1, mapById('huoyanshan'));
    b.startNextWave();
    const monsters = () => (b as unknown as { monsters: { element: string | null }[] }).monsters;
    for (let i = 0; i < 300 && monsters().length === 0; i++) b.step(1 / 30);
    expect(monsters().length).toBeGreaterThan(0);
    for (const m of monsters()) expect(m.element).toBe('fire');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: FAIL（`MAP_ELEMENT` 未导出）

- [ ] **Step 3: 实现**

`web/src/battle.ts`：

1. `@core` import（`:6` 附近已有的 `damage` 引入行）合并引入：

```ts
import { elementMul, type Element } from '@core';
```

（若该行已有多个 `@core` 具名导入，直接并入同一对花括号。）

2. `MAP_SKILL` 常量（`:428-433`）之后紧挨着加（对齐同范式）：

```ts
/** 地图五行：该图全部妖怪（小怪/精英/骑兵/小Boss/妖王）统一继承此属性 */
export const MAP_ELEMENT: Record<string, Element> = {
  huoyanshan: 'fire', // 火焰山：烈焰
  liushahe: 'water', // 流沙河：流沙
  baiguling: 'metal', // 白骨岭：白骨肃杀
  pansidong: 'wood', // 盘丝洞：蛛网藤蔓
};
```

3. `Monster` 接口（`:678-701`）末尾（`miniBossCasted` 之后）加：

```ts
  element: Element | null; // 五行：makeOne 按地图统一赋值（MAP_ELEMENT），未知图回退 null
```

4. `makeOne`（`:5810`）返回对象里加一行（在 `miniBossCasted` 同级）：

```ts
      element: MAP_ELEMENT[this.map.id] ?? null,
```

注意：`MonsterSpec` 类型**不加**字段——element 完全由 `makeOne` 内部按地图决定，调用方无需传（比规格书 §4.2 的写法少改一处，语义相同）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: PASS

- [ ] **Step 5: 战斗序列化回归（Monster 字段进了存档/快照的话需兼容）**

Run: `cd web && npx vitest run tests/battle-resume-serialize.test.ts tests/pvp-snap.test.ts tests/pvp-bridge-snap.test.ts tests/battle-save.test.ts`
Expected: PASS（若序列化做字段白名单，新字段自然忽略；若有 exhaustive 断言，按断言把 `element` 加进序列化并保持回档兼容：旧档缺字段读回时回退 `?? null`）

- [ ] **Step 6: Commit**

```bash
git add web/src/battle.ts web/tests/wuxing.test.ts
git commit -m "feat(web): MAP_ELEMENT 地图五行表，怪物按图统一继承 element"
```

---

### Task 5: `hurtMonster`/`hurtAiMonster` 统一注入克制倍率

**Files:**
- Modify: `web/src/battle.ts`（`:4102`、`:4109`、`:4115`、`:5989`、`:6545`、`:6568-6569`）
- Test: `web/tests/wuxing.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

`web/tests/wuxing.test.ts` 追加：

```ts
describe('hurtMonster 五行注入（统一落点）', () => {
  function firstMonster(mapId: string) {
    const b = new Battle(1, 1, mapById(mapId));
    b.startNextWave();
    const get = () => (b as unknown as { monsters: { hp: number; element: string | null }[] }).monsters;
    for (let i = 0; i < 300 && get().length === 0; i++) b.step(1 / 30);
    const m = get()[0]!;
    m.hp = 100000; // 防止被打死干扰扣血断言
    const hurt = (el: string | null) => {
      const before = m.hp;
      (b as unknown as { hurtMonster: (m2: unknown, dmg: number, p: { c: number; r: number }, f: number, c2: boolean, el2: string | null) => void })
        .hurtMonster(m, 100, { c: 0, r: 5 }, 0.12, false, el);
      return before - m.hp;
    };
    return { hurt };
  }

  it('火焰山（火）：水克火 ×1.25、火被水克方向、金被火克 ×0.75、无属性 ×1.0，均取整', () => {
    const { hurt } = firstMonster('huoyanshan');
    expect(hurt('water')).toBe(125); // 水克火
    expect(hurt('metal')).toBe(75); // 火克金 → 攻击方金被克
    expect(hurt('fire')).toBe(100); // 同行
    expect(hurt(null)).toBe(100); // 兵种/环境伤害不吃克制
  });

  it('白骨岭（金）：火克金 ×1.25', () => {
    const { hurt } = firstMonster('baiguling');
    expect(hurt('fire')).toBe(125);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: FAIL（`hurtMonster` 尚无第 6 参，倍率恒 1 → 125 的断言得 100）

- [ ] **Step 3: 实现注入**

`web/src/battle.ts`：

1. `hurtMonster`（`:4102`）改为：

```ts
  private hurtMonster(
    m: Monster,
    dmg: number,
    pos: { c: number; r: number },
    hitFlash = 0.12,
    crit = false,
    atkEl: Element | null = null, // 攻击方五行：武将传 def.element；兵种/环境伤害不传（null=不吃克制）
  ): void {
    const mul = elementMul(atkEl, m.element, TUNING.wuxingAdvMul, TUNING.wuxingDisMul);
    const final = Math.round(dmg * mul);
    m.hp -= final;
    m.hitFlash = hitFlash;
    this.spawnDamageFloat(pos.c, pos.r, final, crit, mul > 1 ? 'adv' : mul < 1 ? 'dis' : undefined);
  }
```

2. `hurtAiMonster`（`:4109`）同样改法（AI 半场英雄对等吃克制）：

```ts
  private hurtAiMonster(
    m: Monster,
    dmg: number,
    pos: { c: number; r: number },
    hitFlash = 0.12,
    crit = false,
    atkEl: Element | null = null,
  ): void {
    const mul = elementMul(atkEl, m.element, TUNING.wuxingAdvMul, TUNING.wuxingDisMul);
    const final = Math.round(dmg * mul);
    m.hp -= final;
    m.hitFlash = hitFlash;
    this.spawnDamageFloat(pos.c, pos.r, final, crit, mul > 1 ? 'adv' : mul < 1 ? 'dis' : undefined);
  }
```

3. `DamageFloat` 接口（`:790`）`crit: boolean;` 后加：

```ts
  wuxing?: 'adv' | 'dis'; // 五行克制标记：adv=克制（金色放大）dis=被克（灰色弱化）；undefined=普通
```

4. `spawnDamageFloat`（`:4115`）签名加参并写入对象：

```ts
  private spawnDamageFloat(c: number, r: number, amount: number, crit = false, wuxing?: 'adv' | 'dis'): void {
    if (!getSettings().showDamageNumbers || amount <= 0) return;
    // ……原逻辑不动，push 的对象字面量末尾补一行：
    //   wuxing,
  }
```

5. 只需改 4 处调用点传 `element`（其余调用点吃默认 `null`，不用动）：

- AI 武将普攻（`:5989`）：`this.hurtAiMonster(t.m, dmg, t.p, 0.12, false, g.def.element);`
- 我方武将普攻（`:6545`）：`this.hurtMonster(t.m, dmg, t.p, 0.12, false, g.def.element);`
- 武将大招 `castGeneralSkill` 内的 `hurt` 闭包（`:6567-6570`）：

```ts
    const hurt = (m: Monster, dmg: number, p: { c: number; r: number }, flash: number, crit = false) => {
      if (ai) this.hurtAiMonster(m, dmg, p, flash, crit, g.def.element);
      else this.hurtMonster(m, dmg, p, flash, crit, g.def.element);
    };
```

环境/兵种伤害调用点**保持不动**（默认 null）：陨石 `:5338`、炸药 `:5469`、兵种普攻 `:6239`、紧箍咒 `:7420`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: PASS

- [ ] **Step 5: 战斗链路回归**

Run: `cd web && npx vitest run tests/battle.kills.test.ts tests/hero-burn-elite.test.ts tests/hero-ult.test.ts tests/mini-boss.test.ts`
Expected: PASS（±25% 只影响武将对妖怪伤害；若既有测试对伤害数值做精确断言且阵容含克制关系，按新倍率更新期望值）

- [ ] **Step 6: Commit**

```bash
git add web/src/battle.ts web/tests/wuxing.test.ts
git commit -m "feat(web): hurtMonster/hurtAiMonster 统一注入五行克制倍率（±25% 取整）"
```

---

### Task 6: `estimateOptimalPower` 校准 + ai-balance 门禁

**Files:**
- Modify: `web/src/battle.ts`（`estimateOptimalPower` `:5632-5666`）

- [ ] **Step 1: 修改估算器**

`estimateOptimalPower` 里 `generals` 映射（`:5640-5653`）的 `atk` 与 `skillFocusDps` 计入克制均值（阵容对当前图属性的逐将倍率，加权即均值）。改后：

```ts
    const mapEl = MAP_ELEMENT[this.map.id] ?? null; // 本图五行（Boss 血量预算需感知克制）
    const generals = this.activeGenerals().map((g) => {
      const base = generalStat(g.def, g.tier);
      const wb = this.weaponBonuses[g.def.id];
      // 五行：该将对本图怪的克制倍率（克 1.25 / 被克 0.75 / 其他 1）
      const wmul = elementMul(g.def.element, mapEl, TUNING.wuxingAdvMul, TUNING.wuxingDisMul);
      const atk = base.atk * (1 + (wb?.atk ?? 0)) * atkMul * wmul;
      return {
        atk,
        frq: base.frq * (1 + (wb?.frq ?? 0)) * frqMul,
        rge: base.rge + (wb?.rge ?? 0),
        targets: base.targets,
        ax: (g.cells[0].c + g.cells[1].c) / 2,
        ay: (g.cells[0].r + g.cells[1].r) / 2,
        skillFocusDps: heroSkillFocusDps(g.def, atk),
      };
    });
```

- [ ] **Step 2: 估算器回归**

Run: `cd web && npx vitest run tests/board-power.test.ts tests/hero-skill-focus-dps.test.ts tests/autoplace.test.ts`
Expected: PASS（autoplace 用估算器排序，克制感知后排序可能变化——若相关快照/优先级断言失败，先确认新排序语义正确再更新断言）

- [ ] **Step 3: ai-balance 门禁（本任务核心验收）**

Run: `cd web && npx vitest run tests/ai-balance.test.ts`
Expected: PASS（AI skill 收敛仍在 [0.72, 1.8]）。若漂移：优先微调 `TUNING.wuxingAdvMul/wuxingDisMul`（如 1.2/0.8）而不是关卡数值；调后回跑 Task 5 的注入测试同步期望值。

- [ ] **Step 4: Commit**

```bash
git add web/src/battle.ts
git commit -m "feat(web): estimateOptimalPower 计入五行克制均值，保 Boss 血量预算与 ai-balance"
```

---

### Task 7: 新图「黄风岭」（土）

**Files:**
- Modify: `web/src/board.ts`（`MAPS` 末尾 `:290-311` 后追加）
- Modify: `web/src/battle.ts`（`MAP_SKILL` `:428-433`、`MAP_ELEMENT` Task 4 所加）
- Modify: `web/src/codex.ts`（`MAP_MINIBOSS_REP` `:556-561`）
- Test: `web/tests/wuxing.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

`web/tests/wuxing.test.ts` 追加（import 区补 `import { MAPS, pickDailyMap } from '../src/board';`）：

```ts
describe('黄风岭（土）新图', () => {
  it('MAPS 共 5 张，黄风岭在册且 element=earth', () => {
    expect(MAPS).toHaveLength(5);
    expect(MAPS.find((m) => m.id === 'huangfengling')!.name).toBe('黄风岭');
    expect(MAP_ELEMENT.huangfengling).toBe('earth');
  });

  it('所有地图路径合法：相邻步正交连续、末点=唐僧、initialBlock 不压路径', () => {
    for (const map of MAPS) {
      const cells = map.path.slice(1); // 首点可出界入场
      expect(map.path[0]!.c, `${map.id} 入场点应在界外`).toBe(-1);
      expect(map.path[map.path.length - 1]!, `${map.id} 末点应=唐僧`).toEqual(map.tangseng);
      for (let i = 1; i < map.path.length; i++) {
        const a = map.path[i - 1]!;
        const b = map.path[i]!;
        const d = Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
        expect(d, `${map.id} 路径第${i}步不连续`).toBe(1);
      }
      const pathKeys = new Set(map.path.slice(1).map((p) => `${p.c},${p.r}`));
      for (const c of map.initialBlock ?? []) {
        expect(pathKeys.has(`${c.c},${c.r}`), `${map.id} 初始块(${c.c},${c.r})压住路径`).toBe(false);
      }
    }
  });

  it('pickDailyMap 轮换覆盖全部 5 图', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 10; d++) {
      const date = new Date(2026, 0, 1 + d);
      seen.add(pickDailyMap(date).id);
    }
    expect(seen.size).toBe(5);
  });

  it('黄风岭可开局出怪并产生击杀（脚本玩家速通冒烟）', () => {
    const b = new Battle(1, 1, mapById('huangfengling'));
    const CAP = 120 * 30;
    let t = 0;
    while (b.status !== 'won' && b.status !== 'lost' && t < CAP && b.wave < 12) {
      if (b.status === 'ready') b.startNextWave();
      if (b.peach >= b.snapshot().summonCost) { b.summon(); b.autoPlaceTray(); }
      b.step(1 / 30);
      t++;
      if (b.snapshot().kills > 0) break;
    }
    expect(b.snapshot().kills).toBeGreaterThan(0);
  });
});
```

同时把 Task 4 里 `MAP_ELEMENT` 测试中的注释行替换为实断言：

```ts
    expect(MAP_ELEMENT.huangfengling).toBe('earth');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: FAIL（`MAPS.length` 为 4）

- [ ] **Step 3: 实现新图**

1. `web/src/board.ts` `MAPS` 数组末尾（盘丝洞条目后）追加：

```ts
  {
    id: 'huangfengling',
    name: '黄风岭',
    theme: { bg0: '#eee4c8', bg1: '#d8c294', cellUnlocked: '#f8f2df', cellLocked: '#bda37a', path: '#c2a15c', hud: '#dcc99a', accent: '#9a7b32' },
    // 黄风岭（土）：左缘 r7 入场 → 上行至第5行 → 沿栅栏南侧长直行（火力走廊）→ 右缘下行至唐僧
    path: [
      { c: -1, r: 7 }, { c: 0, r: 7 }, // 左缘入场（出界首点）
      { c: 0, r: 6 }, { c: 0, r: 5 }, // 左缘上行
      { c: 1, r: 5 }, { c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 }, { c: 6, r: 5 }, { c: 7, r: 5 }, // 第5行长直行（贴中线栅栏我方侧）
      { c: 7, r: 6 }, { c: 7, r: 7 }, { c: 7, r: 8 }, { c: 7, r: 9 }, // 右缘下行至唐僧
    ],
    tangseng: { c: 7, r: 9 },
    initialBlock: [
      { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 },
      { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
    ],
    fenceGaps: [], // 中线连续栅栏，无开口
  },
```

2. `web/src/battle.ts` `MAP_SKILL` 加：

```ts
  huangfengling: 'slow', // 黄风岭：三昧神风裹足，出手变慢（复用流沙河技能类型，不新增）
```

3. `MAP_ELEMENT` 加：

```ts
  huangfengling: 'earth', // 黄风岭：黄沙
```

4. `web/src/codex.ts` `MAP_MINIBOSS_REP` 加（图鉴各地图行的小 Boss 代表立绘）：

```ts
  huangfengling: 'quake', // 黄风岭：撼地（土系）
```

注：v1 素材走现有回退——`monsterSprite`/`cavalrySprite` 缺该图专属图自动回退通用立绘；`sfx.ts` 的 `MAP_BGM` 查不到 key 时静默跳过文件 BGM（已确认 `if (bgmKey && ...)` 守卫），均无 404/崩溃。专属立绘与 bgm 属 v1.5 素材管线，不在本计划。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/wuxing.test.ts`
Expected: PASS

- [ ] **Step 5: 地图相关回归（布局/自动布阵按 MAPS 驱动）**

Run: `cd web && npx vitest run tests/autoplace.test.ts tests/autoplace-fuzz.test.ts tests/baiguling-side.test.ts tests/liushahe-tangseng.test.ts tests/loading-assets.test.ts`
Expected: PASS（若 autoplace 对每张图跑用例，黄风岭自动纳入；fuzz 若超时按其既有上限放宽）

- [ ] **Step 6: Commit**

```bash
git add web/src/board.ts web/src/battle.ts web/src/codex.ts web/tests/wuxing.test.ts
git commit -m "feat(web): 新增第五张地图黄风岭（土）——五行齐装，每日轮换自动纳入"
```

---

### Task 8: 表现层——徽章 + 克制飘字

**Files:**
- Create: `web/src/wuxing-ui.ts`
- Modify: `web/src/render.ts`（`drawMonsters` `:2899`、`drawActiveGeneralGroup` `:8573`、`drawDamageFloats` `:4006`）
- Modify: `web/src/codex.ts`（`drawHeroCard` `:843`、`drawMapMonsterRow` `:699`）

- [ ] **Step 1: 徽章绘制工具**

创建 `web/src/wuxing-ui.ts`（全仓唯一的徽章画法，各处调用收口）：

```ts
// 五行徽章：圆形色底 + 汉字（金/木/水/火/土）。纯 canvas 绘制，不依赖图片素材。
import { ELEMENT_ZH, ELEMENT_COLOR, type Element } from '@core';

/** 在 (cx,cy) 画半径 r 的五行徽章；el 为 null 不画（兵种/未知） */
export function drawElementBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, el: Element | null): void {
  if (!el) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = ELEMENT_COLOR[el];
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * 1.15)}px "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ELEMENT_ZH[el], cx, cy + r * 0.06);
  ctx.restore();
}
```

- [ ] **Step 2: 怪物头顶徽章 + 棋盘武将徽章**

`web/src/render.ts`：

1. import 区加 `import { drawElementBadge } from './wuxing-ui';`
2. `drawMonsters`（`:2899`）循环内 `drawMonsterAt(...)` 之后加：

```ts
    drawElementBadge(ctx, x + rad0 * 0.95, y - rad0 * 0.95, Math.max(6, CELL * 0.15), m.element);
```

3. `drawActiveGeneralGroup`（`:8573`）函数体末尾（`ctx.restore()` 恢复坐标系之后、函数返回前）加（`a`/`z` 是两格中心，徽章挂头右上）：

```ts
  drawElementBadge(ctx, z.x + CELL * 0.3, z.y - CELL * 0.36, CELL * 0.17, g.def.element);
```

- [ ] **Step 3: 克制飘字**

`web/src/render.ts` `drawDamageFloats`（`:4006`）内，改三处：

```ts
    const popScale = 1 + (1 - popT) * (d.crit ? 0.32 : d.wuxing === 'adv' ? 0.28 : 0.22);
    const text = d.crit ? `暴击! ${Math.round(d.amount)}` : `${d.wuxing === 'adv' ? '克 ' : ''}${Math.round(d.amount)}`;
    const basePx = d.crit ? 17 : d.wuxing === 'adv' ? 16 : 14;
```

以及 `fillStyle` 行改为：

```ts
    ctx.fillStyle = d.crit ? '#ff5a3c' : d.wuxing === 'adv' ? '#ffd84d' : d.wuxing === 'dis' ? '#9aa0a6' : '#fff8e8';
```

（克制=金色放大带「克」前缀；被克=灰色；普通=原样。）

- [ ] **Step 4: 图鉴徽章**

`web/src/codex.ts`：

1. import 区加 `import { drawElementBadge } from './wuxing-ui';` 并从 `'./battle'` 的既有导入里并入 `MAP_ELEMENT`、从 `'@core'` 并入 `type Element`（如尚未引入）。
2. `drawHeroCard`（`:843`）在立绘 `drawImage` 块之后加：

```ts
  drawElementBadge(ctx, x + 16, y + 16, 8, g.element);
```

（`GeneralDef` 在 Task 2 已带 `element`。）

3. `drawMapMonsterRow`（`:699`，签名含 `mapId`）在写地图名的 `fillText` 之后加：

```ts
  drawElementBadge(ctx, x + 12, y + 12, 8, MAP_ELEMENT[mapId] ?? null);
```

（坐标若与该行既有元素重叠，在该函数内就近微调 ±10px，以浏览器目测不重叠为准。）

- [ ] **Step 5: 回归 + 目测**

Run: `cd web && npx vitest run tests/wuxing.test.ts tests/codex-skill-equip.test.ts`
Expected: PASS

再浏览器冒烟（项目 puppeteer 钩子，见 `web/tests/fixtures` 与既有冒烟脚本惯例；无现成脚本则 `npm run dev` 后人工核）：武将卡/怪物头顶/图鉴有徽章、克制飘字金色带「克」。

- [ ] **Step 6: Commit**

```bash
git add web/src/wuxing-ui.ts web/src/render.ts web/src/codex.ts
git commit -m "feat(web): 五行徽章（武将/怪物/图鉴）+ 克制金色飘字表现"
```

---

### Task 9: 帮助「五行相克」一节

**Files:**
- Modify: `web/src/menu-help.ts`（`HELP_BLOCKS`，在 `:207`「真人对战」前插入）
- Test: `web/tests/menu-help.test.ts`（`:15-30` 标题清单断言）

- [ ] **Step 1: 更新测试（先红）**

`web/tests/menu-help.test.ts` 的「包含新手必需的分区标题」断言数组中、`'真人对战'` 之前插入 `'五行相克'`：

```ts
      '局外成长',
      '五行相克',
      '真人对战',
```

Run: `cd web && npx vitest run tests/menu-help.test.ts`
Expected: FAIL（标题清单不含「五行相克」）

- [ ] **Step 2: 加帮助内容**

`web/src/menu-help.ts` `HELP_BLOCKS` 里 `{ kind: 'title', text: '真人对战' }`（`:207`）之前插入：

```ts
  { kind: 'title', text: '五行相克' },
  { kind: 'body', text: '武将与各地图妖怪各属五行：金克木、木克土、土克水、水克火、火克金。' },
  { kind: 'body', text: '克制时伤害×1.25（金色「克」字飘字），被克×0.75。看地图属性选将：如火焰山属火，宜多带水系武将（八戒、白龙、观音等）。' },
  { kind: 'body', text: '基础兵种（刀/枪/骑/弓）无五行，不受克制影响。' },
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd web && npx vitest run tests/menu-help.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/menu-help.ts web/tests/menu-help.test.ts
git commit -m "docs(web): 帮助新增「五行相克」一节（克制环/倍率/选将示例）"
```

---

### Task 10: 全量验证、收尾合并

**Files:**
- Modify: `CHANGELOG.md`（追加一条）

- [ ] **Step 1: web 全量 vitest**

Run: `cd web && npx vitest run`
Expected: 全 PASS（个别既有 flaky 用例重跑一次确认）

- [ ] **Step 2: ai-balance 门禁（单独再跑一次，明确验收）**

Run: `cd web && npx vitest run tests/ai-balance.test.ts`
Expected: PASS

- [ ] **Step 3: game-core 全量**

Run: `cd game-core && npx vitest run`
Expected: 全 PASS

- [ ] **Step 4: tsc 基线不新增**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 数值 ≤ 基线（main 上先跑一次记录基线数，两者相等为过）
Run: `cd game-core && npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 5: 浏览器真机冒烟（记忆规矩：改渲染/战斗必须浏览器验证）**

`./start.sh` 或 `cd web && npm run dev`，浏览器核对：
1. 主线任一老图开局：武将头顶/怪物头顶有五行徽章
2. 上阵水系武将打火焰山：出现金色「克」飘字
3. 地图轮换到黄风岭：能进图、能出怪、能通图（土徽章在图鉴该行显示）
4. 真人对战入口可开局（快照木偶不报错）

- [ ] **Step 6: CHANGELOG + Commit**

`CHANGELOG.md` 顶部追加一行（按该文件既有格式）：

```
- 五行相克：武将/地图妖怪各属金木水火土，克制×1.25、被克×0.75；新增第五张地图「黄风岭」（土）；帮助新增五行相克说明
```

```bash
git add CHANGELOG.md
git commit -m "changelog: 五行相克系统与黄风岭新图"
```

- [ ] **Step 7: rebase main 后合并（多 worktree 惯例）**

```bash
git fetch origin && git rebase main   # 有冲突逐个解（battle.ts 大概率冲突，以本分支语义为准手解）
cd web && npx vitest run tests/ai-balance.test.ts   # rebase 后再过一次门禁
git checkout main && git merge --ff-only worktree-five-elements
```

（若 main 有未合并的并行分支改动冲突过大，停在 rebase 完成态向用户汇报再定。）
