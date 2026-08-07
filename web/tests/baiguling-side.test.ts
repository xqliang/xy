import { describe, it, expect } from 'vitest';
import { mapById, isPlayerCell, isPathCell, slotUnlockOrder, mirrorCell, mirrorPath, isAiHalfCell, aiHalfSafeRows } from '../src/board';

describe('baiguling side', () => {
  const m = mapById('baiguling');

  it('我方左下角出怪，AI 右上角出怪', () => {
    const enter = m.path.find((p) => p.c >= 0 && p.c < 8 && p.r >= 0 && p.r < 10)!;
    expect(enter).toEqual({ c: 0, r: 9 }); // 左下角
    const aiEnter = mirrorPath(m.path).find((p) => p.c >= 0 && p.c < 8 && p.r >= 0 && p.r < 10)!;
    expect(aiEnter).toEqual({ c: 7, r: 0 }); // 右上角
  });

  it('path hugs fence on player side (不穿栅栏)', () => {
    // 左下出怪 + 左缘
    expect(isPathCell(m, 0, 9)).toBe(true);
    expect(isPathCell(m, 0, 6)).toBe(true);
    // 贴左段栅栏（r=6），不走 r=5（栅栏另一侧）
    expect(isPathCell(m, 2, 6)).toBe(true);
    expect(isPathCell(m, 2, 5)).toBe(false);
    // 贴竖段外侧 (c=4)
    expect(isPathCell(m, 4, 5)).toBe(true);
    expect(isPathCell(m, 3, 4)).toBe(false);
    // 贴右段栅栏（r=4），不走 r=3
    expect(isPathCell(m, 5, 4)).toBe(true);
    expect(isPathCell(m, 5, 3)).toBe(false);
    // 右缘至唐僧
    expect(isPathCell(m, 7, 9)).toBe(true);
  });

  it('left cols: player below path (镜像路除外)', () => {
    expect(isPlayerCell(m, 0, 6)).toBe(false); // 左缘通路
    expect(isPlayerCell(m, 1, 7)).toBe(true);
    expect(isPlayerCell(m, 0, 4)).toBe(false);
  });

  it('right cols: player below path (镜像路除外)', () => {
    expect(isPlayerCell(m, 5, 4)).toBe(false); // 通路
    expect(isPlayerCell(m, 5, 5)).toBe(true);
    expect(isPlayerCell(m, 5, 2)).toBe(false);
  });

  it('AI 半场为台阶形；安全行数=右侧 4 行', () => {
    expect(isAiHalfCell(m, 0, 5)).toBe(true);
    expect(isAiHalfCell(m, 0, 6)).toBe(false);
    expect(isAiHalfCell(m, 5, 3)).toBe(true);
    expect(isAiHalfCell(m, 5, 4)).toBe(false);
    expect(aiHalfSafeRows(m)).toBe(4);
  });

  it('path not player', () => {
    expect(isPathCell(m, 0, 6)).toBe(true);
    expect(isPlayerCell(m, 0, 6)).toBe(false);
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
