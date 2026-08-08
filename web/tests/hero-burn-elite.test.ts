import { describe, it, expect } from 'vitest';
import { Battle, TUNING } from '../src/battle';

/** 生成一只怪：eliteChance=1 时强制精英、=0 时强制普通（wave=1 排除 Boss/小 Boss 干扰） */
function spawnOneMonsterHp(eliteChance: number): number {
  const b = new Battle(3);
  const orig = {
    eliteChance: TUNING.eliteChance,
    eliteFromWave: TUNING.eliteFromWave,
    eliteMinGap: TUNING.eliteMinGap,
  };
  (TUNING as { eliteChance: number }).eliteChance = eliteChance;
  (TUNING as { eliteFromWave: number }).eliteFromWave = 1;
  (TUNING as { eliteMinGap: number }).eliteMinGap = 0;
  try {
    b.startNextWave();
    expect(b.isBossWave(1)).toBe(false);
    (b as unknown as { spawnRemaining: number }).spawnRemaining = 1;
    (b as unknown as { spawnTimer: number }).spawnTimer = 0;
    b.step(0.05);
    const m = b.monsters[0]!;
    expect(m.isBoss).toBe(false);
    expect(m.isMiniBoss).toBe(false);
    expect(m.skill !== null).toBe(eliteChance === 1);
    return m.maxHp;
  } finally {
    (TUNING as { eliteChance: number }).eliteChance = orig.eliteChance;
    (TUNING as { eliteFromWave: number }).eliteFromWave = orig.eliteFromWave;
    (TUNING as { eliteMinGap: number }).eliteMinGap = orig.eliteMinGap;
  }
}

describe('精英血量倍数（精英掉落是普通妖 5 倍蟠桃，血量需相应提高）', () => {
  it('精英血量 = 普通血量 × TUNING.eliteHpMul', () => {
    const normalHp = spawnOneMonsterHp(0);
    const eliteHp = spawnOneMonsterHp(1);
    expect(TUNING.eliteHpMul).toBeGreaterThan(1);
    expect(eliteHp).toBeCloseTo(normalHp * TUNING.eliteHpMul, 4);
  });
});

describe('灼烧 DoT 状态（红孩/红袍大招：命中轻伤 + 持续掉血）', () => {
  it('每帧按 burnDps 掉血，直至耗尽后自动停止', () => {
    const b = new Battle(1);
    b.monsters.push({
      id: 1, dist: 0, hp: 100, maxHp: 100, spd: 0,
      isBoss: false, isMiniBoss: false, miniBossKind: null, isCavalry: false,
      hitFlash: 0, skill: null, skillCd: 99, castFlash: 0, spawnT: 1,
      stunT: 0, slowT: 0, hasteT: 0, healFlash: 0,
      burnT: 2, burnDps: 10,
    });
    (b as unknown as { status: string }).status = 'playing';

    b.step(0.5);
    let m = b.monsters.find((x) => x.id === 1)!;
    expect(m.hp).toBeCloseTo(95, 4); // 100 - 10×0.5
    expect(m.burnT).toBeCloseTo(1.5, 4);

    b.step(1.5); // 灼烧耗尽（累计 2s）
    m = b.monsters.find((x) => x.id === 1)!;
    expect(m.hp).toBeCloseTo(80, 4); // 100 - 10×2
    expect(m.burnT).toBe(0);
    expect(m.burnDps).toBe(0);

    b.step(1); // 灼烧结束后不再掉血
    m = b.monsters.find((x) => x.id === 1)!;
    expect(m.hp).toBeCloseTo(80, 4);
  });
});
