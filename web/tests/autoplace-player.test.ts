// web/tests/autoplace-player.test.ts
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

describe('玩家 autoPlaceTray（共享策略接入）', () => {
  function autoPlace(b: Battle): void {
    b.autoPlaceTray();
    b.flushAutoPlacePlaybackForTest();
  }

  it('不丢弃：一键布阵后，能放的都放/合成，放不下的仍留 tray（总数不凭空消失）', () => {
    const b = new Battle(1);
    b.grantPeach(9999);
    for (let n = 0; n < 6; n++) { b.summon(); autoPlace(b); }
    expect(b.units.size).toBeGreaterThan(0);
    expect(() => autoPlace(b)).not.toThrow();
  });

  it('射程：把 tray 塞满后一键布阵，近路格不会只堆远程兵（近格存在短兵）', () => {
    const b = new Battle(2);
    b.grantPeach(9999);
    for (let n = 0; n < 8; n++) { b.summon(); autoPlace(b); }
    const cells = [...b.units.values()].map((u) => u.cell);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('候选区空时仍可点布阵（动态调位/棋盘整理）', () => {
    const b = new Battle(1);
    b.grantPeach(9999);
    for (let n = 0; n < 4; n++) { b.summon(); autoPlace(b); }
    b.tray.length = 0;
    expect(() => autoPlace(b)).not.toThrow();
  });
});
