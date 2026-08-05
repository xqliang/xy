import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

describe('Battle.summon tray rules', () => {
  it('clears leftover tray tokens before writing the new hand', () => {
    const b = new Battle(42);
    b.grantPeach(1000);
    expect(b.summon()).toBe(true);
    const first = b.tray.map((t) => JSON.stringify(t));
    expect(b.tray).toHaveLength(TUNING.summonDraws);
    // 人为塞入「历史」token（模拟未清空时的叠留）
    b.tray.push({ kind: 'shovel' }, { kind: 'shovel' });
    expect(b.summon()).toBe(true);
    expect(b.tray).toHaveLength(TUNING.summonDraws);
    // 新手数不得大于 draws（证明没有 append 历史）
    expect(b.tray.length).toBe(5);
    // 内容应来自新抽取（允许与 first 相同种子巧合，但长度与无额外铲叠留即可）
    const shovels = b.tray.filter((t) => t.kind === 'shovel').length;
    expect(shovels).toBeLessThanOrEqual(3);
    void first;
  });

  it('first summon has >= 4 units', () => {
    const b = new Battle(7);
    b.grantPeach(100);
    b.summon();
    expect(b.tray.filter((t) => t.kind === 'unit').length).toBeGreaterThanOrEqual(4);
  });
});
