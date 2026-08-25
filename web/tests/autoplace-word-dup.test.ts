/**
 * 布阵回放：placeWord 不得在 tray 令牌已消耗后用克隆再落一份（表现为点一次多一个相同字）。
 */
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

const cellKey = (c: number, r: number) => `${c},${r}`;

type DragFx = Battle['autoPlaceDragFx'][number];

describe('布阵字牌不复制', () => {
  it('同一 drag 不可提交两次；未在队列中的 commit 不得落字', () => {
    const b = new Battle(1, 1, mapById('pansidong'));
    b.status = 'ready';
    const cells = b.unlockedCells();
    expect(cells.length).toBeGreaterThanOrEqual(2);
    const a = cells[0]!;
    const dup = cells[1]!;

    b.tray = [{ kind: 'word', char: '太', general: 'taibai', tier: 1 }];
    const token = { kind: 'word' as const, char: '太', general: 'taibai', tier: 1 };
    const ok = (b as unknown as {
      queueAutoPlaceDrag: (
        i: number,
        cell: { c: number; r: number },
        token: typeof token,
        commit: 'placeWord',
        sfx: 'general',
      ) => boolean;
    }).queueAutoPlaceDrag(0, a, token, 'placeWord', 'general');
    expect(ok).toBe(true);
    expect(b.tray[0]).toBeUndefined();
    expect(b.autoPlaceDragFx).toHaveLength(1);

    const queued = b.autoPlaceDragFx[0]!;
    (b as unknown as { commitAutoPlaceDrag: (d: DragFx) => void }).commitAutoPlaceDrag(queued);
    b.autoPlaceDragFx = [];
    expect(b.words.get(cellKey(a.c, a.r))?.char).toBe('太');

    const stale = { ...queued, c: dup.c, r: dup.r };
    (b as unknown as { commitAutoPlaceDrag: (d: DragFx) => void }).commitAutoPlaceDrag(stale);
    expect([...b.words.values()].filter((w) => w.char === '太')).toHaveLength(1);
    expect(b.words.has(cellKey(dup.c, dup.r))).toBe(false);
  });

  it('棋盘已有同字时，反复点布阵不得再铺第二张冗余白', () => {
    const b = new Battle(2, 1, mapById('pansidong'));
    b.status = 'playing';
    for (const c of b.lockedCells()) {
      (b as unknown as { unlocked: Set<string> }).unlocked.add(cellKey(c.c, c.r));
    }
    const onBoard = b.unlockedCells()[0]!;
    b.words.set(cellKey(onBoard.c, onBoard.r), {
      char: '太', general: 'taibai', tier: 1, cell: { ...onBoard },
    });
    b.tray = [{ kind: 'word', char: '太', general: 'taibai', tier: 1 }];

    const countBai = () => [...b.words.values()].filter((w) => w.char === '太').length;
    expect(countBai()).toBe(1);

    for (let i = 0; i < 3; i++) {
      b.autoPlaceTray();
      (b as unknown as { flushAutoPlacePlaybackForTest: () => void }).flushAutoPlacePlaybackForTest();
    }
    expect(countBai()).toBe(1);
    expect(b.tray.some((t) => t?.kind === 'word' && t.char === '太')).toBe(true);
  });
});
