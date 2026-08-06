import { describe, it, expect } from 'vitest';
import {
  PEACH_FLOAT_FALL,
  PEACH_FLOAT_GRAVITY,
  PEACH_FLOAT_HEAD_Y,
  PEACH_FLOAT_RISE,
  peachFloatInitialVy,
  type PeachFloat,
} from '../src/battle';

describe('peach float ballistic', () => {
  it('初速满足 v² = 2gh（理论升空 PEACH_FLOAT_RISE）', () => {
    const vy = peachFloatInitialVy();
    expect(vy).toBeLessThan(0);
    expect(vy * vy).toBeCloseTo(2 * PEACH_FLOAT_GRAVITY * PEACH_FLOAT_RISE, 5);
  });

  it('积分后峰值升幅接近半格，过顶下落超 FALL 后可移除', () => {
    const p: PeachFloat = {
      c: 0,
      r: 0,
      amount: 1,
      y: PEACH_FLOAT_HEAD_Y,
      vy: peachFloatInitialVy(),
      peakY: PEACH_FLOAT_HEAD_Y,
    };
    const dt = 1 / 60;
    for (let i = 0; i < 180; i++) {
      p.vy += PEACH_FLOAT_GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y < p.peakY) p.peakY = p.y;
      if (p.y >= p.peakY + PEACH_FLOAT_FALL && p.vy > 0) break;
    }
    const rise = PEACH_FLOAT_HEAD_Y - p.peakY;
    expect(rise).toBeGreaterThan(PEACH_FLOAT_RISE * 0.85);
    expect(rise).toBeLessThan(PEACH_FLOAT_RISE * 1.15);
    expect(p.y).toBeGreaterThanOrEqual(p.peakY + PEACH_FLOAT_FALL * 0.95);
  });
});
