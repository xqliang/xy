import { describe, it, expect } from 'vitest';
import { mapById, isPathCell, isPlayerCell, slotUnlockOrder, mirrorCell, mirrorPath, COLS, ROWS } from '../src/board';

describe('huoyanshan (虎牢关)', () => {
  const m = mapById('huoyanshan');
  const aiPath = mirrorPath(m.path);
  const aiOn = (c: number, r: number) => aiPath.some((p) => p.c === c && p.r === r);

  it('AI 唐僧第1列第5行，出口第8列第5行（1起算）', () => {
    expect(mirrorCell(m.tangseng)).toEqual({ c: 0, r: 4 });
    const enter = m.path.find((p) => p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS)!;
    expect(enter).toEqual({ c: 0, r: 5 });
    expect(mirrorCell(enter)).toEqual({ c: 7, r: 4 });
  });

  it('AI 第2行第6–8列是路径；第3行第5–7列是格子', () => {
    // 1起算 → 0起算
    expect(aiOn(5, 1)).toBe(true);
    expect(aiOn(6, 1)).toBe(true);
    expect(aiOn(7, 1)).toBe(true);
    expect(aiOn(4, 2)).toBe(false);
    expect(aiOn(5, 2)).toBe(false);
    expect(aiOn(6, 2)).toBe(false);
  });

  it('AI 第3行第5–6列是默认槽位（镜像后在我方 initialBlock）', () => {
    // AI (4,2)(5,2) → 我方 (3,7)(2,7)
    const block = slotUnlockOrder(m).slice(0, 6);
    expect(block).toEqual(
      expect.arrayContaining([
        { c: 2, r: 7 },
        { c: 3, r: 7 },
      ]),
    );
    expect(mirrorCell({ c: 3, r: 7 })).toEqual({ c: 4, r: 2 });
    expect(mirrorCell({ c: 2, r: 7 })).toEqual({ c: 5, r: 2 });
  });

  it('初始槽避开通路且在我方半场', () => {
    const block = slotUnlockOrder(m).slice(0, 6);
    expect(block).toHaveLength(6);
    expect(block).toEqual(
      expect.arrayContaining([
        { c: 2, r: 6 },
        { c: 3, r: 6 },
        { c: 4, r: 6 },
        { c: 2, r: 7 },
        { c: 3, r: 7 },
        { c: 4, r: 7 },
      ]),
    );
    for (const c of block) {
      expect(isPlayerCell(m, c.c, c.r)).toBe(true);
      expect(isPathCell(m, c.c, c.r)).toBe(false);
    }
  });

  it('不穿中线栅栏', () => {
    expect(m.fenceGaps).toEqual([]);
    for (const p of m.path) {
      if (p.c < 0 || p.c >= COLS || p.r < 0 || p.r >= ROWS) continue;
      expect(p.r).toBeGreaterThanOrEqual(5);
    }
  });
});
