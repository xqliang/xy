// web/tests/ai-opponent.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

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
