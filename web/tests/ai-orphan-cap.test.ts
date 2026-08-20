import { describe, it, expect } from 'vitest';
import {
  AI_MAX_ORPHAN_WORDS,
  orphanKeepScore,
  selectOrphansToKeep,
  charHeroFamily,
  charHeroRole,
  planAutoPlaceSteps,
  type AutoPlaceView,
  type Cell,
  type PlaceToken,
  type PlacedWordLite,
} from '../src/autoplace';
import { maxTierForChar } from '../src/generals';

describe('AI 孤儿单字保留', () => {
  it('AI_MAX_ORPHAN_WORDS 为 4', () => {
    expect(AI_MAX_ORPHAN_WORDS).toBe(4);
  });

  it('满5 字保留分高于满3', () => {
    expect(maxTierForChar('圣')).toBe(5);
    expect(maxTierForChar('蟒')).toBe(3);
    expect(orphanKeepScore({ char: '圣' }, [])).toBeGreaterThan(orphanKeepScore({ char: '蟒' }, []));
  });

  it('同门派第二字降权：优先留不同组', () => {
    const kept = selectOrphansToKeep(
      [
        { char: '圣', tier: 1 },
        { char: '蟒', tier: 1 },
        { char: '扇', tier: 1 },
        { char: '戒', tier: 1 },
      ],
      3,
    );
    const chars = kept.map((w) => w.char);
    expect(chars).toContain('圣');
    // 圣与蟒同属「大」门派，三者里应丢掉蟒而留扇/戒
    expect(chars).not.toContain('蟒');
    expect(charHeroFamily('圣')).toBe(charHeroFamily('蟒'));
  });

  it('尽量覆盖不同职业', () => {
    const kept = selectOrphansToKeep(
      [
        { char: '圣', tier: 1 }, // 输出
        { char: '哪', tier: 1 }, // 输出
        { char: '戒', tier: 1 }, // 控制
        { char: '音', tier: 1 }, // 辅助
        { char: '蟒', tier: 1 }, // 过渡
      ],
      3,
    );
    const roles = new Set(kept.map((w) => charHeroRole(w.char)));
    expect(roles.has('输出')).toBe(true);
    expect(roles.size).toBeGreaterThanOrEqual(2);
  });

  it('布阵：tray 满时多余孤儿留在棋盘上（绝不丢弃）', () => {
    const words = new Map<string, PlacedWordLite>();
    const put = (char: string, c: number, r: number) => {
      words.set(`${c},${r}`, { char, general: char, cell: { c, r }, tier: 1 });
    };
    // 6 个孤儿单字（超出 AI_MAX_ORPHAN_WORDS=4）
    put('圣', 0, 6);
    put('蟒', 1, 6);
    put('扇', 2, 6);
    put('戒', 3, 6);
    put('音', 4, 6);
    put('郎', 5, 6);
    const tray: (PlaceToken | undefined)[] = [];
    const free: Cell[] = [{ c: 0, r: 7 }, { c: 1, r: 7 }];
    const removed: string[] = [];
    const displaced: string[] = [];
    const view: AutoPlaceView = {
      tray: () => tray,
      freeCells: () => free.slice(),
      diggableCells: () => [],
      placedUnits: () => [],
      placedWords: () => [...words.values()],
      nearestPathDist: (cell) => cell.r,
      pathTouchSides: () => 0,
      exitDist: (cell) => cell.c,
      tangsengDist: (cell) => Math.hypot(cell.c - 6, cell.r - 5),
      pathCover: () => 1,
      pathCoverAt: () => 1,
      pathCoverEarlyAt: () => 1,
      pathFirstEngageAt: () => 1,
      generalRge: () => 2,
      wordChars: () => undefined,
      place: () => false,
      moveUnit: () => false,
      swapUnits: () => false,
      swapUnitWord: () => false,
      moveWord: () => false,
      swapWords: () => false,
      displaceToTray: () => false, // tray 满：无法顶回
      removeWord: (cell) => {
        // 新策略下不应被调用
        const k = `${cell.c},${cell.r}`;
        const w = words.get(k);
        if (!w) return false;
        words.delete(k);
        removed.push(w.char);
        return true;
      },
      isActiveHeroCell: () => false,
      dangerNear: () => false,
      imminentPathScore: () => 0,
      mergeTray: () => false,
      mergeBoard: () => false,
    };
    planAutoPlaceSteps(view, {
      rng: () => 0,
      maxOrphanWords: AI_MAX_ORPHAN_WORDS,
      maxSteps: 10,
      maxGuard: 20,
    });
    // tray 满时：孤儿留在棋盘上，不被删除
    expect(removed.length).toBe(0);
    expect(words.size).toBe(6);
  });

  it('布阵：tray 有空位时多余孤儿顶回 tray', () => {
    const words = new Map<string, PlacedWordLite>();
    const put = (char: string, c: number, r: number) => {
      words.set(`${c},${r}`, { char, general: char, cell: { c, r }, tier: 1 });
    };
    put('圣', 0, 6);
    put('蟒', 1, 6);
    put('扇', 2, 6);
    put('戒', 3, 6);
    put('音', 4, 6);
    put('郎', 5, 6);
    const tray: (PlaceToken | undefined)[] = [undefined, undefined, undefined, undefined, undefined]; // 5 个空位
    const free: Cell[] = [{ c: 0, r: 7 }, { c: 1, r: 7 }];
    const removed: string[] = [];
    const displaced: string[] = [];
    const view: AutoPlaceView = {
      tray: () => tray,
      freeCells: () => free.slice(),
      diggableCells: () => [],
      placedUnits: () => [],
      placedWords: () => [...words.values()],
      nearestPathDist: (cell) => cell.r,
      pathTouchSides: () => 0,
      exitDist: (cell) => cell.c,
      tangsengDist: (cell) => Math.hypot(cell.c - 6, cell.r - 5),
      pathCover: () => 1,
      pathCoverAt: () => 1,
      pathCoverEarlyAt: () => 1,
      pathFirstEngageAt: () => 1,
      generalRge: () => 2,
      wordChars: () => undefined,
      place: () => false,
      moveUnit: () => false,
      swapUnits: () => false,
      swapUnitWord: () => false,
      moveWord: () => false,
      swapWords: () => false,
      displaceToTray: (cell) => {
        // 有 tray 空位：顶回成功
        const slot = tray.findIndex((t) => !t);
        if (slot < 0) return false;
        const k = `${cell.c},${cell.r}`;
        const w = words.get(k);
        if (!w) return false;
        words.delete(k);
        tray[slot] = { kind: 'word', char: w.char, general: w.general, tier: w.tier ?? 1 };
        displaced.push(w.char);
        return true;
      },
      removeWord: (cell) => {
        const k = `${cell.c},${cell.r}`;
        const w = words.get(k);
        if (!w) return false;
        words.delete(k);
        removed.push(w.char);
        return true;
      },
      isActiveHeroCell: () => false,
      dangerNear: () => false,
      imminentPathScore: () => 0,
      mergeTray: () => false,
      mergeBoard: () => false,
    };
    planAutoPlaceSteps(view, {
      rng: () => 0,
      maxOrphanWords: AI_MAX_ORPHAN_WORDS,
      maxSteps: 10,
      maxGuard: 20,
    });
    // tray 有空位：多余孤儿顶回 tray，不被删除
    expect(removed.length).toBe(0);
    expect(displaced.length).toBe(2); // 6 - 4 = 2 个顶回
    expect(words.size).toBe(4);
  });
});
