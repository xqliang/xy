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
    const a = b.aiUnlockedCells()[0]!;
    const right = b.aiUnlockedCells().find((c) => c.r === a.r && c.c === a.c + 1);
    if (!right) return; // 该地图无横向相邻已解锁格则跳过（不算失败）
    b.aiWords.set(`${a.c},${a.r}`, { char: '悟', general: 'wukong', tier: 1, cell: a });
    b.aiWords.set(`${right.c},${right.r}`, { char: '空', general: 'wukong', tier: 1, cell: right });
    expect(b.aiActiveGenerals().length).toBe(1);
    expect(b.aiActiveGenerals()[0]!.def.id).toBe('wukong');
  });
});
