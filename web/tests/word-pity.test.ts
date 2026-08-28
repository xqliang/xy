import { describe, it, expect, afterEach } from 'vitest';
import { Battle, TUNING } from '../src/battle';

describe('字牌征兵保底', () => {
  const origWord = TUNING.wordDrawChance;
  const origPity = TUNING.wordPityAfter;
  afterEach(() => {
    TUNING.wordDrawChance = origWord;
    TUNING.wordPityAfter = origPity;
  });

  it('连续 wordPityAfter 次无字后，下一次强制至少 1 字', () => {
    TUNING.wordDrawChance = 0;
    TUNING.wordPityAfter = 10;
    const b = new Battle(99);
    b.grantPeach(10_000, true);
    expect(b.summon()).toBe(true); // 首次：无字、不触发保底
    expect(b.tray.some((t) => t.kind === 'word')).toBe(false);
    for (let i = 0; i < 10; i++) {
      expect(b.summon()).toBe(true);
      expect(b.tray.some((t) => t.kind === 'word')).toBe(false);
    }
    expect(b.summon()).toBe(true);
    expect(b.tray.some((t) => t.kind === 'word')).toBe(true);
  });

  it('强制转字只改 unit 槽，不把 shovel 换成字；强制铲不覆盖字保底', () => {
    TUNING.wordDrawChance = 0;
    TUNING.wordPityAfter = 1; // 第二次非首次即可强制（先召唤一次垫高计数）
    const b = new Battle(3);
    b.grantPeach(10_000, true);
    // 耗尽首次
    b.summon();
    // 人为：已连续无字达到保底阈值
    b.forceWordPityForTest();
    // 同时逼出铲子保底
    b.forceShovelPityForTest();
    expect(b.summon()).toBe(true);
    const words = b.tray.filter((t) => t.kind === 'word');
    const shovels = b.tray.filter((t) => t.kind === 'shovel');
    expect(words.length).toBeGreaterThanOrEqual(1);
    expect(shovels.length).toBeGreaterThanOrEqual(1);
    expect(b.tray).toHaveLength(TUNING.traySize);
  });

  it('shovelPityAfter 为 4', () => {
    expect(TUNING.shovelPityAfter).toBe(4);
  });
});
