// web/tests/autoplace-defer.test.ts
// 验证「挖格后等开格动画播完再落子」的延迟落子机制（玩家侧 autoPlaceApply + updatePendingPlace）。
import { describe, it, expect } from 'vitest';
import { Battle, DIG_DUR, PLACE_TIMING } from '../src/battle';

describe('挖格后延迟落子（玩家侧）', () => {
  it('目标格开格动画未完 → 预占延迟；动画(DIG_DUR)结束后由 step/updateFx 真正落下', () => {
    const b = new Battle(1) as any;
    const cell = b.unlockedCells()[0];
    b.digFx.push({ c: cell.c, r: cell.r, t: 0 }); // 模拟该格刚挖开、动画进行中
    b.tray = [{ kind: 'unit', type: 'dao', tier: 1 }];
    const ok = b.autoPlaceApply(0, cell);
    expect(ok).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(false); // 尚未落下
    expect(b.pendingPlace.length).toBe(1);
    expect(b.cellFree(cell.c, cell.r)).toBe(false); // 预占格视为占用，别的兵不会来抢
    b.step(DIG_DUR + 0.1); // 推进过动画时长
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(true); // 动画结束 → 落下
    expect(b.pendingPlace.length).toBe(0);
  });

  it('目标格无开格动画 → 即时落子（不延迟）', () => {
    const b = new Battle(1) as any;
    const cell = b.unlockedCells()[0];
    b.tray = [{ kind: 'unit', type: 'dao', tier: 1 }];
    const ok = b.autoPlaceApply(0, cell);
    expect(ok).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(true);
    expect(b.pendingPlace.length).toBe(0);
  });

  it('挖坑动画进行中可并行落其他格；新坑等挖完再落', () => {
    const b = new Battle(1) as any;
    const digCell = b.lockedCells().find((c: { c: number; r: number }) => !b.trees.has(`${c.c},${c.r}`))!;
    const other = b.unlockedCells()[0]!;
    b.tray = [
      { kind: 'shovel' },
      { kind: 'unit', type: 'dao', tier: 1 },
      { kind: 'unit', type: 'gun', tier: 1 },
    ];
    // 先挖 → 立刻排新坑落子（应预占）→ 再落其他格（挖坑中可并行）
    b.autoPlacePlayback = [
      { kind: 'place', trayIndex: 0, cell: { c: digCell.c, r: digCell.r }, token: { kind: 'shovel' } },
      { kind: 'place', trayIndex: 2, cell: { c: digCell.c, r: digCell.r }, token: { kind: 'unit', type: 'gun', tier: 1 } },
      { kind: 'place', trayIndex: 1, cell: { c: other.c, r: other.r }, token: { kind: 'unit', type: 'dao', tier: 1 } },
    ];
    b.autoPlacePlaying = true;
    b.placeDropAnimDepth = 1;
    b.tickAutoPlacePlayback(0);

    let sawOtherWhileDigging = false;
    let sawDigPending = false;
    const horizon = PLACE_TIMING.dragDur * 3 + PLACE_TIMING.staggerMax * 2 + DIG_DUR + 0.5;
    for (let t = 0; t < horizon; t += 0.02) {
      b.step(0.02);
      const digging = b.digFx.some((d: { c: number; r: number }) => d.c === digCell.c && d.r === digCell.r);
      const otherBusy =
        b.units.has(`${other.c},${other.r}`)
        || b.autoPlaceDragFx.some((d: { c: number; r: number }) => d.c === other.c && d.r === other.r);
      if (digging && otherBusy) sawOtherWhileDigging = true;
      if (digging && b.pendingPlace.some((p: { c: number; r: number }) => p.c === digCell.c && p.r === digCell.r)) {
        sawDigPending = true;
      }
    }
    expect(sawDigPending).toBe(true);
    expect(sawOtherWhileDigging).toBe(true);
    expect(b.units.has(`${digCell.c},${digCell.r}`)).toBe(true);
    expect(b.units.get(`${digCell.c},${digCell.r}`)?.type).toBe('gun');
    expect(b.units.has(`${other.c},${other.r}`)).toBe(true);
  });
});

describe('挖格后延迟落子（AI 侧，对称）', () => {
  it('AI 刚挖开的格延迟落子，开格动画结束后由 updateFx 落下', () => {
    const b = new Battle(1) as any;
    const cell = b.aiUnlockedCells()[0];
    b.aiDigFx.push({ c: cell.c, r: cell.r, t: 0 });
    b.aiTray = [{ kind: 'unit', type: 'dao', tier: 1 }];
    const ok = b.aiAutoPlaceApply(0, cell);
    expect(ok).toBe(true);
    expect(b.aiUnits.some((u: any) => u.cell.c === cell.c && u.cell.r === cell.r)).toBe(false);
    expect(b.aiPendingPlace.length).toBe(1);
    expect(b.aiCellFree(cell.c, cell.r)).toBe(false);
    b.step(DIG_DUR + 0.1);
    expect(b.aiUnits.some((u: any) => u.cell.c === cell.c && u.cell.r === cell.r)).toBe(true);
    expect(b.aiPendingPlace.length).toBe(0);
  });
});
