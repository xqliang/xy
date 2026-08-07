import { describe, it, expect } from 'vitest';
import { getUnitStat } from '@core';
import { MAPS, entranceDistance, pathTotalLen, placeableByProximity } from '../src/board';
import {
  estimateOptimalBoardPower,
  planWavePressure,
  PRESSURE_RATIO,
  PRESSURE_WINDOW_SEC,
  PRESSURE_FROM_WAVE,
} from '../src/board-power';
import { Battle, TUNING } from '../src/battle';

describe('estimateOptimalBoardPower', () => {
  const map = MAPS.find((m) => m.id === 'huoyanshan')!;
  const entranceDist = entranceDistance(map.path);
  const pathLen = pathTotalLen(map);
  const freeCells = placeableByProximity(map).slice(0, 6);
  const nearestPathDist = (cell: { c: number; r: number }) => {
    let min = Infinity;
    for (const p of map.path) {
      if (p.r < 0) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
  };

  it('无兵无将时最优 DPS 为 0', () => {
    const r = estimateOptimalBoardPower({
      map,
      entranceDist,
      pathLen,
      units: [],
      freeCells,
      nearestPathDist,
      generals: [],
      atkMul: 1,
      frqMul: 1,
    });
    expect(r.optimalDps).toBe(0);
    expect(r.pathDamage(1)).toBe(0);
  });

  it('重排后短射程兵也能打到路，DPS 计入被动乘区', () => {
    const units = [
      { type: 'monkey' as const, tier: 2 },
      { type: 'archer' as const, tier: 2 },
    ];
    const atkMul = 1.15;
    const frqMul = 1.2;
    const r = estimateOptimalBoardPower({
      map,
      entranceDist,
      pathLen,
      units,
      freeCells,
      nearestPathDist,
      generals: [],
      atkMul,
      frqMul,
    });
    const m = getUnitStat('monkey', 2);
    const a = getUnitStat('archer', 2);
    const expected =
      m.atk * atkMul * m.frq * frqMul * m.targets +
      a.atk * atkMul * a.frq * frqMul * a.targets;
    expect(r.optimalDps).toBeCloseTo(expected, 5);
    expect(r.coverageTotal).toBeGreaterThan(0);
    expect(r.pathDamage(0.5)).toBeGreaterThan(r.pathDamage(1));
  });

  it('攻速被动提高最优 DPS', () => {
    const base = estimateOptimalBoardPower({
      map,
      entranceDist,
      pathLen,
      units: [{ type: 'spear', tier: 3 }],
      freeCells,
      nearestPathDist,
      generals: [],
      atkMul: 1,
      frqMul: 1,
    });
    const buffed = estimateOptimalBoardPower({
      map,
      entranceDist,
      pathLen,
      units: [{ type: 'spear', tier: 3 }],
      freeCells,
      nearestPathDist,
      generals: [],
      atkMul: 1,
      frqMul: 1.5,
    });
    expect(buffed.optimalDps).toBeCloseTo(base.optimalDps * 1.5, 5);
  });
});

describe('planWavePressure', () => {
  const power = {
    optimalDps: 100,
    pathDamage: (spd: number) => (spd <= 0 ? Infinity : 100 * (20 / spd)),
    coverageTotal: 20,
  };

  it(`第 ${PRESSURE_FROM_WAVE - 1} 波以前只用保底数量`, () => {
    const p = planWavePressure({
      wave: PRESSURE_FROM_WAVE - 1,
      baselineCount: 12,
      normalHp: 50,
      isBossWave: false,
      bossSpd: 0.4,
      power,
    });
    expect(p.count).toBe(12);
    expect(p.bossHp).toBeNull();
  });

  it('第 4 波起按 10s×70% 预算抬高数量，且不低于保底', () => {
    const p = planWavePressure({
      wave: 4,
      baselineCount: 5,
      normalHp: 50,
      isBossWave: false,
      bossSpd: 0.4,
      power,
    });
    const budget = 100 * PRESSURE_WINDOW_SEC * PRESSURE_RATIO; // 700
    expect(p.count).toBe(Math.max(5, Math.ceil(budget / 50)));
  });

  it('Boss 血量 ≈ 全路集火伤害 × 70%，且数量综合 Boss 抗伤后仍 ≥ 保底', () => {
    const bossSpd = 0.4;
    const p = planWavePressure({
      wave: 5,
      baselineCount: 14,
      normalHp: 104,
      isBossWave: true,
      bossSpd,
      power,
    });
    expect(p.bossHp).toBeCloseTo(power.pathDamage(bossSpd) * PRESSURE_RATIO, 5);
    expect(p.count).toBeGreaterThanOrEqual(14);
  });

  it('输出很弱时数量不跌破保底', () => {
    const p = planWavePressure({
      wave: 6,
      baselineCount: 20,
      normalHp: 120,
      isBossWave: false,
      bossSpd: 0.4,
      power: { optimalDps: 1, pathDamage: () => 1, coverageTotal: 0 },
    });
    expect(p.count).toBe(20);
  });
});

describe('Battle 接入压力规划', () => {
  it('空板开波：数量=保底，Boss 血不低于普通怪', () => {
    const b = new Battle(42);
    (b as unknown as { bossWaves: Set<number> }).bossWaves = new Set([1]);
    expect(b.startNextWave()).toBe(true);
    const planned = b.snapshot().waveCount!;
    expect(planned).toBeGreaterThanOrEqual(TUNING.minWaveMonsters);
    let guard = 0;
    while (b.monsters.length < planned && guard++ < 400) b.step(0.5);
    const boss = b.monsters.find((m) => m.isBoss);
    expect(boss).toBeTruthy();
    const normalHp = TUNING.monsterHpBase + TUNING.monsterHpStep * 1;
    expect(boss!.maxHp).toBeGreaterThanOrEqual(normalHp);
  });

  it('强阵 + 被动攻速后，第 4 波出怪数可高于保底', () => {
    const b = new Battle(7, 1, MAPS[0]!, undefined, {}, [], ['fenghuolun', 'xiandan']);
    const cells = b.unlockedCells();
    for (let i = 0; i < cells.length; i++) {
      b.tray = [{ kind: 'unit', type: 'archer', tier: 5 }];
      b.placeFromTray(0, cells[i]!);
    }
    const power = b.estimateOptimalPower();
    expect(power.optimalDps).toBeGreaterThan(50);
    // 跳到第 3 波结束状态再开第 4 波
    (b as unknown as { wave: number }).wave = 3;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    expect(b.startNextWave()).toBe(true);
    expect(b.wave).toBe(4);
    const baseline =
      9 + 4 + 0; // monstersInWave(4)=13；波4无后期加成/前期减量 → 13
    // 强阵预算可能抬升
    expect(b.snapshot().waveCount).toBeGreaterThanOrEqual(baseline);
    expect(b.snapshot().optimalDps).toBeGreaterThan(0);
  });

  it('蛛网被动降低 Boss 移速 → 同输出全路伤害更高', () => {
    const map = MAPS[0]!;
    const weak = new Battle(3, 1, map, undefined, {}, [], []);
    const slow = new Battle(3, 1, map, undefined, {}, [], ['zhuwang']);
    for (const b of [weak, slow]) {
      const cell = b.unlockedCells()[0]!;
      b.tray = [{ kind: 'unit', type: 'archer', tier: 4 }];
      b.placeFromTray(0, cell);
    }
    expect(slow.mods.monsterSpdMul).toBeLessThan(weak.mods.monsterSpdMul);
    const spd = (b: Battle) =>
      TUNING.monsterSpd * b.mods.monsterSpdMul * TUNING.bossSpdMul;
    const dmgWeak = weak.estimateOptimalPower().pathDamage(spd(weak));
    const dmgSlow = slow.estimateOptimalPower().pathDamage(spd(slow));
    expect(dmgSlow).toBeGreaterThan(dmgWeak);
  });
});
