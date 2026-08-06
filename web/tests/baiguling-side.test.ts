import { describe, it, expect } from 'vitest';
import { mapById, isPlayerCell, isPathCell, slotUnlockOrder, mirrorCell } from '../src/board';

describe('baiguling side', () => {
  const m = mapById('baiguling');

  it('left cols: player below path (镜像路除外)', () => {
    // (0,6) 是右段路径 (7,3) 的镜像，算 AI 路；我方从 r>=7
    expect(isPlayerCell(m, 0, 6)).toBe(false);
    expect(isPlayerCell(m, 0, 7)).toBe(true);
    expect(isPlayerCell(m, 0, 4)).toBe(false);
  });

  it('right cols: player below path (镜像路除外)', () => {
    // (5,4) 是左段路径 (2,5) 的镜像，算 AI 路不可放
    expect(isPlayerCell(m, 5, 4)).toBe(false);
    expect(isPlayerCell(m, 5, 5)).toBe(true);
    expect(isPlayerCell(m, 5, 2)).toBe(false);
  });

  it('path not player', () => {
    expect(isPathCell(m, 0, 5)).toBe(true);
    expect(isPlayerCell(m, 0, 5)).toBe(false);
  });

  it('tangseng and initial block', () => {
    expect(m.tangseng).toEqual({ c: 7, r: 9 });
    const block = slotUnlockOrder(m).slice(0, 6);
    expect(block).toHaveLength(6);
    expect(block).toEqual(
      expect.arrayContaining([
        { c: 2, r: 7 },
        { c: 3, r: 7 },
        { c: 4, r: 7 },
        { c: 2, r: 8 },
        { c: 3, r: 8 },
        { c: 4, r: 8 },
      ]),
    );
  });

  it('player cell mirror is AI (not player)', () => {
    const p = { c: 2, r: 7 };
    expect(isPlayerCell(m, p.c, p.r)).toBe(true);
    const a = mirrorCell(p);
    expect(isPlayerCell(m, a.c, a.r)).toBe(false);
    expect(isPathCell(m, a.c, a.r)).toBe(false);
  });
});
