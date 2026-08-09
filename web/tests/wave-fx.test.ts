import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';

describe('wave combat fx cleanup', () => {
  it('清波后立刻清空弹道/爆点/飘字/AOE 残留', () => {
    const b = new Battle(1);
    b.startNextWave();
    b.fx.push({ from: { c: 0, r: 0 }, to: { c: 1, r: 0 }, ttl: 1, maxTtl: 1, color: '#fff' });
    b.bursts.push({ kind: 'hit', c: 0, r: 0, ttl: 1, maxTtl: 1, big: false, color: '#fff' });
    b.heroUltFx.push({ heroId: 'nezha', c: 0, r: 0, ttl: 1, maxTtl: 1, tier: 1, rge: 2, crit: true });
    b.damageFloats.push({
      c: 0, r: 0, amount: 10, x: 0, vx: 0, y: 0, vy: 0, peakY: 0, age: 0, crit: false,
    });
    b.peachFloats.push({ c: 0, r: 0, amount: 1, y: 0, vy: 0, peakY: 0 });
    b.ultFlash = 0.5;
    b.ultCenter = { c: 0, r: 0 };

    b.forceClearWaveForTest();

    expect(b.fx).toHaveLength(0);
    expect(b.bursts).toHaveLength(0);
    expect(b.heroUltFx).toHaveLength(0);
    expect(b.damageFloats).toHaveLength(0);
    expect(b.peachFloats).toHaveLength(0);
    expect(b.ultFlash).toBe(0);
    expect(b.ultCenter).toBeNull();
    expect(b.status).toBe('ready');
  });
});
