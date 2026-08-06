// web/tests/autoplace-defer.test.ts
// 验证「挖格后等开格动画播完再落子」的延迟落子机制（玩家侧 autoPlaceApply + updatePendingPlace）。
import { describe, it, expect } from 'vitest';
import { Battle, DIG_DUR } from '../src/battle';

describe('挖格后延迟落子（玩家侧）', () => {
  it('目标格开格动画未完 → 预占延迟；动画(DIG_DUR)结束后由 step/updateFx 真正落下', () => {
    const b = new Battle(1) as any;
    const cell = b.unlockedCells()[0];
    b.digFx.push({ c: cell.c, r: cell.r, t: 0 }); // 模拟该格刚挖开、动画进行中
    b.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
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
    b.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
    const ok = b.autoPlaceApply(0, cell);
    expect(ok).toBe(true);
    expect(b.units.has(`${cell.c},${cell.r}`)).toBe(true);
    expect(b.pendingPlace.length).toBe(0);
  });
});
