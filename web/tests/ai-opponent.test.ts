// web/tests/ai-opponent.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { PEACH_PER_KILL } from '@core';

describe('AI 落子与激活', () => {
  it('aiPlaceFromTray：铲子只挖锁定 AI 格并解锁', () => {
    const b = new Battle(1);
    const locked = b.aiLockedCells();
    expect(locked.length).toBeGreaterThan(0);
    b.aiTray = [{ kind: 'shovel' }];
    const ok = b.aiPlaceFromTray(0, locked[0]!);
    expect(ok).toBe(true);
    expect(b.aiUnlocked.has(`${locked[0]!.c},${locked[0]!.r}`)).toBe(true);
  });

  it('aiPlaceFromTray：同型同阶兵合成升阶', () => {
    const b = new Battle(1);
    const cell = b.aiUnlockedCells()[0]!;
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    b.aiPlaceFromTray(0, cell);
    b.aiTray = [{ kind: 'unit', type: 'spear', tier: 1 }];
    b.aiPlaceFromTray(0, cell); // 落到同格 → 合成
    const u = b.aiUnits.find((x) => x.cell.c === cell.c && x.cell.r === cell.r)!;
    expect(u.tier).toBe(2);
  });

  it('aiActiveGenerals：同将两字连读相邻则激活', () => {
    const b = new Battle(1);
    const cells = b.aiUnlockedCells();
    let left: { c: number; r: number } | undefined, right: { c: number; r: number } | undefined;
    for (const l of cells) {
      const r = cells.find((c) => c.r === l.r && c.c === l.c + 1);
      if (r) { left = l; right = r; break; }
    }
    expect(left && right).toBeTruthy(); // seed-1 地图应存在左右相邻对
    b.aiWords.set(`${left!.c},${left!.r}`, { char: '悟', general: 'wukong', tier: 1, cell: left! });
    b.aiWords.set(`${right!.c},${right!.r}`, { char: '空', general: 'wukong', tier: 1, cell: right! });
    const gens = b.aiActiveGenerals();
    expect(gens.length).toBe(1);
    expect(gens[0]!.def.id).toBe('wukong');
  });
});

describe('AI 经济与征兵', () => {
  it('AI 够桃才征兵；征后扣桃、涨价', () => {
    const b = new Battle(3);
    (b as any).aiPeach = 999;
    const beforePeach = b.aiPeach;
    const beforeCost = (b as any).aiSummonCost;
    const ok = (b as any).aiSummon();
    expect(ok).toBe(true);
    expect(b.aiPeach).toBeLessThan(beforePeach);
    expect((b as any).aiSummonCost).toBeGreaterThan(beforeCost);
    expect(b.aiTray.length).toBeGreaterThan(0);
  });

  it('桃不足时 aiSummon 不产候选', () => {
    const b = new Battle(3);
    (b as any).aiPeach = 0;
    const ok = (b as any).aiSummon();
    expect(ok).toBe(false);
    expect(b.aiTray.length).toBe(0);
  });

  it('AI 击杀普通怪产基础桃 PEACH_PER_KILL（无玩家加成）', () => {
    const b = new Battle(3);
    const before = b.aiPeach;
    (b as any).creditAiKill(false, false);
    expect(b.aiPeach - before).toBe(PEACH_PER_KILL);
  });
});

describe('updateAi 真玩家循环', () => {
  it('推进若干秒后，AI 会征兵→布阵→出现 aiUnits（无凭空铺兵、无清场字段）', () => {
    const b = new Battle(7);
    (b as any).aiPeach = 999;
    for (let t = 0; t < 200; t++) (b as any).updateAi(0.1); // 20s
    expect(b.aiUnits.length).toBeGreaterThan(0);
    for (const u of b.aiUnits) expect(b.aiUnlocked.has(`${u.cell.c},${u.cell.r}`)).toBe(true);
  });

  it('无尽模式不驱动 AI', () => {
    const b = new Battle(7, 1, undefined, undefined, undefined, undefined, undefined, true);
    for (let t = 0; t < 100; t++) (b as any).updateAi(0.1);
    expect(b.aiUnits.length).toBe(0);
  });
});
