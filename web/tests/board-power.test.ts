import { describe, it, expect } from 'vitest';
import { getUnitStat } from '@core';
import { MAPS, entranceDistance, pathTotalLen, placeableByProximity } from '../src/board';
import {
  estimateOptimalBoardPower,
  planWavePressure,
  planSpawnInterval,
  PRESSURE_RATIO,
  PRESSURE_WINDOW_SEC,
  PRESSURE_FROM_WAVE,
  SPAWN_INTERVAL_WAVE_DECAY,
  SPAWN_INTERVAL_MIN,
  ENTRANCE_ZONE_LEN,
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
    expect(r.entranceDps).toBe(0);
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
    expect(r.entranceDps).toBeGreaterThan(0);
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

describe('planSpawnInterval', () => {
  it('第 4 波前保持基础间隔（仅难度加速）', () => {
    const itv = planSpawnInterval({
      wave: 3,
      baseInterval: 1.25,
      monsterSpd: 0.68,
      normalHp: 80,
      entranceDps: 0,
    });
    expect(itv).toBeCloseTo(1.25, 5);
  });

  it('第 4 波起随波次逐渐缩短间隔', () => {
    const w4 = planSpawnInterval({
      wave: 4,
      baseInterval: 1.25,
      monsterSpd: 0.68,
      normalHp: 200,
      entranceDps: 0,
    });
    const w8 = planSpawnInterval({
      wave: 8,
      baseInterval: 1.25,
      monsterSpd: 0.68,
      normalHp: 200,
      entranceDps: 0,
    });
    expect(w4).toBeCloseTo(1.25, 5);
    expect(w8).toBeCloseTo(1.25 * Math.pow(SPAWN_INTERVAL_WAVE_DECAY, 4), 5);
    expect(w8).toBeLessThan(w4);
  });

  it('门口 DPS 能秒杀时进一步压间隔，且不低于下限', () => {
    const spd = 0.68;
    // 门口 2.5 格走完约 3.7s；DPS 很大 → 必须叠怪
    const itv = planSpawnInterval({
      wave: 4,
      baseInterval: 1.25,
      monsterSpd: spd,
      normalHp: 50,
      entranceDps: 200,
    });
    const timeInZone = ENTRANCE_ZONE_LEN / spd;
    expect(itv).toBeLessThan(1.25);
    expect(itv).toBeGreaterThanOrEqual(SPAWN_INTERVAL_MIN);
    expect(itv).toBeLessThanOrEqual(timeInZone / 2);
  });
});

describe('planWavePressure', () => {
  const power = {
    optimalDps: 100,
    pathDamage: (spd: number) => (spd <= 0 ? Infinity : 100 * (20 / spd)),
    entranceDps: 10,
    coverageTotal: 20,
  };
  const spawnOpts = {
    monsterSpd: 0.68,
    baseSpawnInterval: 1.25,
  };

  it(`第 ${PRESSURE_FROM_WAVE - 1} 波以前只用保底数量`, () => {
    const p = planWavePressure({
      wave: PRESSURE_FROM_WAVE - 1,
      baselineCount: 12,
      normalHp: 50,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      ...spawnOpts,
    });
    expect(p.count).toBe(12);
    expect(p.bossHp).toBeNull();
    expect(p.spawnInterval).toBeCloseTo(1.25, 5);
  });

  it('第 4 波起按 10s×70% 预算抬高数量，且不低于保底', () => {
    const p = planWavePressure({
      wave: 4,
      baselineCount: 5,
      normalHp: 50,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      ...spawnOpts,
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
      ...spawnOpts,
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
      power: { optimalDps: 1, pathDamage: () => 1, entranceDps: 0, coverageTotal: 0 },
      ...spawnOpts,
    });
    expect(p.count).toBe(20);
  });

  it('后期波次出怪间隔短于前期', () => {
    const early = planWavePressure({
      wave: 4,
      baselineCount: 13,
      normalHp: 88,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      ...spawnOpts,
    });
    const late = planWavePressure({
      wave: 10,
      baselineCount: 30,
      normalHp: 184,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      ...spawnOpts,
    });
    expect(late.spawnInterval).toBeLessThan(early.spawnInterval);
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

  it('强阵 + 被动攻速后，第 4 波出怪数可高于保底，间隔不超过基础值', () => {
    const b = new Battle(7, 1, MAPS[0]!, undefined, {}, [], ['fenghuolun', 'xiandan']);
    const cells = b.unlockedCells();
    for (let i = 0; i < cells.length; i++) {
      b.tray = [{ kind: 'unit', type: 'archer', tier: 5 }];
      b.placeFromTray(0, cells[i]!);
    }
    const power = b.estimateOptimalPower();
    expect(power.optimalDps).toBeGreaterThan(50);
    expect(power.entranceDps).toBeGreaterThan(0);
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
    expect(b.snapshot().spawnInterval!).toBeLessThanOrEqual(TUNING.spawnInterval);
    expect(b.snapshot().spawnInterval!).toBeGreaterThanOrEqual(TUNING.spawnIntervalMin);
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
