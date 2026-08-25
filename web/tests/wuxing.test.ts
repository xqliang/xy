// 五行相克：数据层校验（武将 element 字段 / MAP_ELEMENT / 注入）。
// 各段由对应任务追加；本文件随功能分阶段成长。
import { describe, it, expect } from 'vitest';
import { GENERALS } from '../src/generals';
import { ELEMENTS } from '@core';
import { Battle } from '../src/battle';
import { MAP_ELEMENT } from '../src/battle';
import { mapById, MAPS, pickDailyMap } from '../src/board';
import { setWuxingEnabled } from '../src/dev-flags';

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

describe('MAP_ELEMENT（地图五行）', () => {
  it('现有五图各配一行，与 MAP_SKILL 同范式', () => {
    expect(MAP_ELEMENT.huoyanshan).toBe('fire');
    expect(MAP_ELEMENT.liushahe).toBe('water');
    expect(MAP_ELEMENT.baiguling).toBe('metal');
    expect(MAP_ELEMENT.pansidong).toBe('wood');
    expect(MAP_ELEMENT.huangfengling).toBe('earth'); // 黄风岭（土）——Task 7
  });
});

describe('怪物 element（按地图统一继承）', () => {
  it('火焰山开波后小怪 element 为 fire（boss/护卫走同一 makeOne，由对称性覆盖）', () => {
    const b = new Battle(1, 1, mapById('huoyanshan'));
    b.startNextWave();
    const monsters = () => (b as unknown as { monsters: { element: string | null }[] }).monsters;
    for (let i = 0; i < 300 && monsters().length === 0; i++) b.step(1 / 30);
    expect(monsters().length).toBeGreaterThan(0);
    for (const m of monsters()) expect(m.element).toBe('fire');
  });

  // T4 审查遗留：未登记 MAP_ELEMENT 的图 id → makeOne 出的怪 element 为 null（表层面语义）
  it('未登记 MAP_ELEMENT 的图 id → 该图怪 element 回退 null', () => {
    expect(MAP_ELEMENT['no-such-map']).toBeUndefined();
  });
});

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

  it('火焰山（火）：水克火 ×1.25、金被火克 ×0.75、同行 ×1.0、无属性 ×1.0，均取整', () => {
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

describe('黄风岭（土）新图', () => {
  it('MAPS 共 5 张，黄风岭在册且 element=earth', () => {
    expect(MAPS).toHaveLength(5);
    expect(MAPS.find((m) => m.id === 'huangfengling')!.name).toBe('黄风岭');
    expect(MAP_ELEMENT.huangfengling).toBe('earth');
  });

  it('所有地图路径合法：相邻步正交连续、末点=唐僧、initialBlock 不压路径', () => {
    for (const map of MAPS) {
      const pathKeys = new Set(map.path.slice(1).map((p) => `${p.c},${p.r}`));
      expect(map.path[0]!.c, `${map.id} 入场点应在左缘或界外（c<=0）`).toBeLessThanOrEqual(0);
      expect(map.path[map.path.length - 1]!, `${map.id} 末点应=唐僧`).toEqual(map.tangseng);
      for (let i = 1; i < map.path.length; i++) {
        const a = map.path[i - 1]!;
        const b = map.path[i]!;
        const d = Math.abs(a.c - b.c) + Math.abs(b.r - a.r);
        expect(d, `${map.id} 路径第${i}步不连续`).toBe(1);
      }
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

describe('五行总开关（DevTools）', () => {
  // 开关是 localStorage 级（dev-flags），用例内开关、finally 里务必还原，避免污染其他用例
  it('关闭后 hurtMonster 不吃克制/被克，飘字无「克」标记；重开恢复正常倍率', () => {
    setWuxingEnabled(false);
    try {
      const b = new Battle(1, 1, mapById('pansidong')); // 木图：金系攻击方应克制
      b.startNextWave();
      const monsters = () => (b as unknown as { monsters: { hp: number; element: string | null }[] }).monsters;
      for (let i = 0; i < 300 && monsters().length === 0; i++) b.step(1 / 30);
      expect(monsters().length).toBeGreaterThan(0);
      const m = monsters()[0]!;
      m.hp = 1000;
      const hurt = (b as unknown as {
        hurtMonster: (m: { hp: number }, dmg: number, pos: { c: number; r: number }, hf: number, crit: boolean, el: string) => void;
      }).hurtMonster.bind(b);
      const floats = () => (b as unknown as { damageFloats: { wuxing?: string }[] }).damageFloats;

      hurt(m, 100, { c: 0, r: 0 }, 0.12, false, 'metal');
      expect(m.hp).toBe(900); // 关闭：金克木不生效，按原伤害
      expect(floats()[floats().length - 1]!.wuxing).toBeUndefined();

      setWuxingEnabled(true);
      hurt(m, 100, { c: 0, r: 0 }, 0.12, false, 'metal');
      expect(m.hp).toBe(775); // 重开：克 ×1.25 → 125
      expect(floats()[floats().length - 1]!.wuxing).toBe('adv');
    } finally {
      setWuxingEnabled(true);
    }
  });
});
