// 小 Boss 按种类本体移速（DevTools 可调）：霜魄/撼地慢、疾风快、其余默认
import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

describe('小 Boss 本体移速按种类', () => {
  it('霜魄/撼地用慢速倍率', () => {
    expect(Battle.miniBossSpawnSpdMul('frost', TUNING)).toBe(TUNING.miniBossSpdMulSlow);
    expect(Battle.miniBossSpawnSpdMul('quake', TUNING)).toBe(TUNING.miniBossSpdMulSlow);
  });
  it('疾风用快速倍率', () => {
    expect(Battle.miniBossSpawnSpdMul('gale', TUNING)).toBe(TUNING.miniBossSpdMulFast);
  });
  it('蚀甲/血泉用默认倍率', () => {
    expect(Battle.miniBossSpawnSpdMul('blight', TUNING)).toBe(TUNING.miniBossSpdMul);
    expect(Battle.miniBossSpawnSpdMul('blood', TUNING)).toBe(TUNING.miniBossSpdMul);
  });
  it('倍率方向：疾风 > 默认 > 霜/震', () => {
    expect(TUNING.miniBossSpdMulFast).toBeGreaterThan(TUNING.miniBossSpdMul);
    expect(TUNING.miniBossSpdMul).toBeGreaterThan(TUNING.miniBossSpdMulSlow);
  });
});
