import { describe, it, expect } from 'vitest';
import { trayTokenCacheKey } from '../src/render';
import type { TrayToken } from '../src/battle';

const unit = (over: Partial<Extract<TrayToken, { kind: 'unit' }>> = {}): TrayToken =>
  ({ kind: 'unit', type: 'dao', tier: 1, ...over });

describe('trayTokenCacheKey 令牌可视签名', () => {
  it('内容相同的 unit 令牌 → 同 key（含可选增益布尔等价）', () => {
    expect(trayTokenCacheKey(unit())).toBe(trayTokenCacheKey(unit()));
    expect(trayTokenCacheKey(unit({ pillAtk: true }))).toBe(trayTokenCacheKey(unit({ pillAtk: true })));
  });

  it('buffAtkT 剩余秒数数值不影响 key（徽标只看有无）；有/无翻转 key', () => {
    expect(trayTokenCacheKey(unit({ buffAtkT: 5 }))).toBe(trayTokenCacheKey(unit({ buffAtkT: 2.7 })));
    expect(trayTokenCacheKey(unit({ buffAtkT: 5 }))).not.toBe(trayTokenCacheKey(unit({ buffAtkT: 0 })));
    expect(trayTokenCacheKey(unit({ buffAtkT: 5 }))).not.toBe(trayTokenCacheKey(unit()));
  });

  it('可视字段变化翻转 key：type/tier/displaced/pillAtk/pillFrq', () => {
    const base = unit();
    for (const over of [
      { type: 'spear' as const }, { tier: 3 }, { displaced: true }, { pillAtk: true }, { pillFrq: true },
    ]) {
      expect(trayTokenCacheKey(unit(over))).not.toBe(trayTokenCacheKey(base));
    }
  });

  it('不影响绘制的字段不进 key：unit.buffAtkMul', () => {
    expect(trayTokenCacheKey(unit({ buffAtkT: 5, buffAtkMul: 1.4 })))
      .toBe(trayTokenCacheKey(unit({ buffAtkT: 5, buffAtkMul: 2 })));
  });

  it('word：char/tier/displaced 进 key；general/fabaofuBoosted 不进（不影响绘制）', () => {
    const w = (over: Partial<Extract<TrayToken, { kind: 'word' }>> = {}): TrayToken =>
      ({ kind: 'word', char: '大', general: 'dasheng', tier: 1, ...over });
    expect(trayTokenCacheKey(w())).toBe(trayTokenCacheKey(w()));
    expect(trayTokenCacheKey(w({ general: 'other', fabaofuBoosted: true }))).toBe(trayTokenCacheKey(w()));
    expect(trayTokenCacheKey(w({ tier: 2 }))).not.toBe(trayTokenCacheKey(w()));
    expect(trayTokenCacheKey(w({ char: '圣' }))).not.toBe(trayTokenCacheKey(w()));
    expect(trayTokenCacheKey(w({ displaced: true }))).not.toBe(trayTokenCacheKey(w()));
  });

  it('tree：level 进 key；growT（成长计时，不进绘制）不进', () => {
    expect(trayTokenCacheKey({ kind: 'tree', level: 2, growT: 0.5 })).toBe(trayTokenCacheKey({ kind: 'tree', level: 2, growT: 3 }));
    expect(trayTokenCacheKey({ kind: 'tree', level: 2, growT: 0.5 })).not.toBe(trayTokenCacheKey({ kind: 'tree', level: 3, growT: 0.5 }));
  });

  it('shovel 恒定；不同 kind 之间 key 不冲突', () => {
    expect(trayTokenCacheKey({ kind: 'shovel' })).toBe(trayTokenCacheKey({ kind: 'shovel' }));
    expect(trayTokenCacheKey({ kind: 'shovel' })).not.toBe(trayTokenCacheKey(unit()));
    expect(trayTokenCacheKey(unit())).not.toBe(trayTokenCacheKey({ kind: 'word', char: '大', general: 'x', tier: 1 }));
  });
});
