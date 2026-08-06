import { describe, it, expect } from 'vitest';
import {
  mapById,
  isPathCell,
  isPlayerCell,
  slotUnlockOrder,
  mirrorCell,
  mirrorPath,
  COLS,
  ROWS,
} from '../src/board';

describe('pansidong (云梦泽)', () => {
  const m = mapById('pansidong');

  it('唐僧右下，AI 镜像左上', () => {
    expect(m.tangseng).toEqual({ c: 7, r: 9 });
    expect(mirrorCell(m.tangseng)).toEqual({ c: 0, r: 0 });
  });

  it('我方左下出怪，AI 右上出怪', () => {
    const enter = m.path.find((p) => p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS)!;
    expect(enter).toEqual({ c: 0, r: 9 });
    const aiEnter = mirrorPath(m.path).find((p) => p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS)!;
    expect(aiEnter).toEqual({ c: 7, r: 0 });
  });

  it('路径贴中线栅栏两侧，不穿越（我方 r=5/6）', () => {
    // 左缘止于 r=6，不上到 AI 半场
    expect(isPathCell(m, 0, 6)).toBe(true);
    expect(isPathCell(m, 0, 5)).toBe(false);
    // 第6行向右至台阶
    expect(isPathCell(m, 1, 6)).toBe(true);
    expect(isPathCell(m, 4, 6)).toBe(true);
    // 上台阶仍在我方
    expect(isPathCell(m, 4, 5)).toBe(true);
    expect(isPathCell(m, 4, 4)).toBe(false);
    // 第5行向右（贴栅栏）
    expect(isPathCell(m, 5, 5)).toBe(true);
    expect(isPathCell(m, 7, 5)).toBe(true);
    // 右缘至唐僧
    expect(isPathCell(m, 7, 9)).toBe(true);
    // 整条我方路径都在 r>=5
    for (const p of m.path) {
      if (p.c < 0 || p.c >= COLS || p.r < 0 || p.r >= ROWS) continue;
      expect(p.r).toBeGreaterThanOrEqual(5);
    }
    // AI 镜像整条在 r<=4，对应截图上半箭头
    const ai = mirrorPath(m.path);
    for (const p of ai) {
      if (p.c < 0 || p.c >= COLS || p.r < 0 || p.r >= ROWS) continue;
      expect(p.r).toBeLessThanOrEqual(4);
    }
    expect(ai.some((p) => p.c === 7 && p.r === 0)).toBe(true);
    expect(ai.some((p) => p.c === 3 && p.r === 3)).toBe(true);
    expect(ai.some((p) => p.c === 3 && p.r === 4)).toBe(true);
    expect(ai.some((p) => p.c === 0 && p.r === 4)).toBe(true);
    expect(ai.some((p) => p.c === 0 && p.r === 0)).toBe(true);
  });

  it('初始 6 槽镜像后对应竞品上方 4,2–6,3（1起算）', () => {
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
    const ai = block.map(mirrorCell);
    expect(ai).toEqual(
      expect.arrayContaining([
        { c: 3, r: 1 },
        { c: 4, r: 1 },
        { c: 5, r: 1 },
        { c: 3, r: 2 },
        { c: 4, r: 2 },
        { c: 5, r: 2 },
      ]),
    );
  });

  it('路径格不可放置', () => {
    expect(isPlayerCell(m, 0, 6)).toBe(false);
    expect(isPlayerCell(m, 4, 5)).toBe(false);
    expect(isPlayerCell(m, 3, 7)).toBe(true);
  });
});
