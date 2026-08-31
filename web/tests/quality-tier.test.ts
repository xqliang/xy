import { describe, it, expect } from 'vitest';
import {
  QUALITY_TIERS,
  type QualityTier,
  pickInitialTier,
  qualityScalar,
  updateQualityTier,
  qualityFlags,
} from '../src/quality';

describe('画质档位常量', () => {
  it('三档标量：high>mid>low，且 low 不低于现有 clamp 下限 0.3', () => {
    expect(QUALITY_TIERS.high).toBe(1);
    expect(QUALITY_TIERS.mid).toBeGreaterThan(QUALITY_TIERS.low);
    expect(QUALITY_TIERS.low).toBeGreaterThanOrEqual(0.3); // 与 render.setFxQuality clamp 下限一致
  });
  it('qualityScalar 返回档位对应标量', () => {
    expect(qualityScalar('high')).toBe(QUALITY_TIERS.high);
    expect(qualityScalar('low')).toBe(QUALITY_TIERS.low);
  });
});

describe('开机设备分级 pickInitialTier', () => {
  it('拿不到 benchmarkLevel（null）→ 高档（不误伤中高端/浏览器）', () => {
    expect(pickInitialTier(null)).toBe('high');
  });
  it('benchmarkLevel 很低 → 低档', () => {
    expect(pickInitialTier(1)).toBe('low');
    expect(pickInitialTier(5)).toBe('low');
  });
  it('benchmarkLevel 中等 → 中档', () => {
    expect(pickInitialTier(15)).toBe('mid');
    expect(pickInitialTier(20)).toBe('mid');
  });
  it('benchmarkLevel 很高 → 高档', () => {
    expect(pickInitialTier(28)).toBe('high');
    expect(pickInitialTier(40)).toBe('high');
  });
});

describe('EMA 迟滞升降档 updateQualityTier', () => {
  it('帧时正常（~16ms）保持高档', () => {
    expect(updateQualityTier('high', 16)).toBe('high');
  });
  it('高档持续过慢（>26ms）→ 降中档', () => {
    expect(updateQualityTier('high', 30)).toBe('mid');
  });
  it('中档持续过慢 → 降低档', () => {
    expect(updateQualityTier('mid', 30)).toBe('low');
  });
  it('低档已到底，不会继续降', () => {
    expect(updateQualityTier('low', 40)).toBe('low');
  });
  it('恢复阈值严于降档：高档刚过 20ms 不升（仍中档），防抖', () => {
    // 降档阈值 26ms，恢复要更稳（<17ms 才回 high）；20ms 处应保持中档不跳回。
    expect(updateQualityTier('mid', 20)).toBe('mid');
  });
  it('中档帧时很稳（<17ms）→ 回升高档', () => {
    expect(updateQualityTier('mid', 14)).toBe('high');
  });
  it('低档帧时够稳（<21ms）→ 升回中档', () => {
    expect(updateQualityTier('low', 18)).toBe('mid');
  });
});

describe('档位降载开关 qualityFlags', () => {
  it('高档：全关（无降载）', () => {
    expect(qualityFlags('high')).toEqual({ basicReduce: false, reduceBursts: false, disableGlow: false, disableBlur: false });
  });
  it('中档：基础降载 + 减爆点 + 关发光，不开 blur 关', () => {
    const f = qualityFlags('mid');
    expect(f.basicReduce).toBe(true);
    expect(f.reduceBursts).toBe(true);
    expect(f.disableGlow).toBe(true);
    expect(f.disableBlur).toBe(false);
  });
  it('低档：全部降载（基础降载+减爆点+关发光+关 blur）', () => {
    const f = qualityFlags('low');
    expect(f.basicReduce).toBe(true);
    expect(f.reduceBursts).toBe(true);
    expect(f.disableGlow).toBe(true);
    expect(f.disableBlur).toBe(true);
  });
});
