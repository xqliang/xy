import { describe, it, expect } from 'vitest';
import { getUnitStat } from '@core';
import { MAPS, entranceDistance, pathTotalLen, placeableByProximity, posAtDistance } from '../src/board';
import {
  estimateOptimalBoardPower,
  planWavePressure,
  planSpawnInterval,
  spawnBatchCap,
  pressureRatioForWave,
  PRESSURE_RATIO,
  PRESSURE_RATIO_MID,
  PRESSURE_RATIO_MID_WAVE,
  PRESSURE_RATIO_STEP_AFTER,
  PRESSURE_WINDOW_SEC,
  PRESSURE_FROM_WAVE,
  SPAWN_INTERVAL_MIN,
  SPAWN_BATCH_CAP_MAX,
  MONSTER_HP_FROM_WAVE,
  MONSTER_HP_KILL_SEC,
  monsterHpFromBoardPower,
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
      { type: 'dao' as const, tier: 2 },
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
    const m = getUnitStat('dao', 2);
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

  it('武将 skillFocusDps（如二郎暴击）计入 pathDamage/Boss 压力，但不计入 optimalDps 清怪预算', () => {
    const p = posAtDistance(map, entranceDist);
    const general = { atk: 3.8, frq: 1.5, rge: 3, targets: 1.5, ax: p.c, ay: p.r };
    const noSkill = estimateOptimalBoardPower({
      map, entranceDist, pathLen, units: [], freeCells, nearestPathDist,
      generals: [general],
      atkMul: 1, frqMul: 1,
    });
    const skillFocusDps = 28.5 / 9; // 二郎：atk×5×CRIT_MULT / skillCd
    const withSkill = estimateOptimalBoardPower({
      map, entranceDist, pathLen, units: [], freeCells, nearestPathDist,
      generals: [{ ...general, skillFocusDps }],
      atkMul: 1, frqMul: 1,
    });
    // 清怪预算（对多目标 AOE 清场）不含大招专注伤害
    expect(withSkill.optimalDps).toBeCloseTo(noSkill.optimalDps, 5);
    // Boss 压力估算（集火单体）应按覆盖时长把大招秒伤折算进去
    const spd = 0.5;
    const cov = noSkill.coverageTotal;
    expect(cov).toBeGreaterThan(0);
    expect(withSkill.pathDamage(spd)).toBeCloseTo(
      noSkill.pathDamage(spd) + skillFocusDps * (cov / spd),
      5,
    );
  });
});

describe('pressureRatioForWave', () => {
  it('6→20 线性 0.60→0.75，其后每波 +0.02', () => {
    expect(pressureRatioForWave(1)).toBeCloseTo(PRESSURE_RATIO, 5);
    expect(pressureRatioForWave(PRESSURE_FROM_WAVE)).toBeCloseTo(PRESSURE_RATIO, 5);
    expect(pressureRatioForWave(PRESSURE_RATIO_MID_WAVE)).toBeCloseTo(PRESSURE_RATIO_MID, 5);
    expect(pressureRatioForWave(21)).toBeCloseTo(
      PRESSURE_RATIO_MID + PRESSURE_RATIO_STEP_AFTER,
      5,
    );
    expect(pressureRatioForWave(25)).toBeCloseTo(
      PRESSURE_RATIO_MID + 5 * PRESSURE_RATIO_STEP_AFTER,
      5,
    );
    const mid = PRESSURE_FROM_WAVE + (PRESSURE_RATIO_MID_WAVE - PRESSURE_FROM_WAVE) / 2;
    expect(pressureRatioForWave(mid)).toBeCloseTo((PRESSURE_RATIO + PRESSURE_RATIO_MID) / 2, 5);
    expect(pressureRatioForWave(PRESSURE_FROM_WAVE + 1))
      .toBeGreaterThan(pressureRatioForWave(PRESSURE_FROM_WAVE));
  });
});

describe('spawnBatchCap', () => {
  it('压力波前为 1，之后随波次升高至封顶（无尽可到 10）', () => {
    expect(spawnBatchCap(1)).toBe(1);
    expect(spawnBatchCap(PRESSURE_FROM_WAVE - 1)).toBe(1);
    expect(spawnBatchCap(6)).toBe(2);
    expect(spawnBatchCap(7)).toBe(2);
    expect(spawnBatchCap(8)).toBe(3);
    expect(spawnBatchCap(14)).toBe(6); // 正常通关波仍未封顶
    expect(spawnBatchCap(22)).toBe(SPAWN_BATCH_CAP_MAX);
    expect(spawnBatchCap(99)).toBe(SPAWN_BATCH_CAP_MAX);
  });
});

describe('planSpawnInterval', () => {
  const base = 1.25;

  it('无门口秒杀时保持基础间隔（仅难度加速），不再每波衰减', () => {
    const itv3 = planSpawnInterval({
      wave: 3,
      baseInterval: base,
      monsterSpd: 0.6,
      normalHp: 80,
      entranceDps: 0,
    });
    const itv8 = planSpawnInterval({
      wave: 8,
      baseInterval: base,
      monsterSpd: 0.6,
      normalHp: 200,
      entranceDps: 0,
    });
    expect(itv3).toBeCloseTo(base, 5);
    expect(itv8).toBeCloseTo(base, 5);
  });

  it('门口 DPS 能秒杀时进一步压间隔，且不低于下限', () => {
    const spd = 0.6;
    const itv = planSpawnInterval({
      wave: 4,
      baseInterval: base,
      monsterSpd: spd,
      normalHp: 50,
      entranceDps: 200,
    });
    const timeInZone = ENTRANCE_ZONE_LEN / spd;
    expect(itv).toBeLessThan(base);
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
    monsterSpd: 0.6,
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
    expect(p.bossHp).toBeCloseTo(power.pathDamage(0.4) * pressureRatioForWave(PRESSURE_FROM_WAVE - 1), 5);
    expect(p.spawnInterval).toBeCloseTo(1.25, 5);
  });

  it(`第 ${PRESSURE_FROM_WAVE} 波起按 10s×压力比预算抬高数量，且不低于保底`, () => {
    const ratio = pressureRatioForWave(PRESSURE_FROM_WAVE);
    const p = planWavePressure({
      wave: PRESSURE_FROM_WAVE,
      baselineCount: 5,
      normalHp: 50,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      ...spawnOpts,
    });
    const budget = 100 * PRESSURE_WINDOW_SEC * ratio;
    expect(p.count).toBe(Math.max(5, Math.ceil(budget / 50)));
  });

  it('小 Boss 顶替 1 只普通怪出场：多出的血量占预算，避免实际压力超出规划比例', () => {
    const normalHp = 50;
    const noMini = planWavePressure({
      wave: PRESSURE_FROM_WAVE,
      baselineCount: 1,
      normalHp,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      ...spawnOpts,
    });
    const withMini = planWavePressure({
      wave: PRESSURE_FROM_WAVE,
      baselineCount: 1,
      normalHp,
      isBossWave: false,
      bossSpd: 0.4,
      power,
      miniBossExtraHp: normalHp * (TUNING.miniBossHpMul - 1),
      ...spawnOpts,
    });
    // 扣除小 Boss 多出的血量后，预算与由此推出的数量应相应下降
    expect(withMini.trashBudget).toBeLessThan(noMini.trashBudget);
    expect(withMini.count).toBeLessThanOrEqual(noMini.count);
    // 换算成「怪血总量」应大致对齐（不再因为小 Boss 而超出规划预算太多）
    const noMiniTotalHp = noMini.count * normalHp;
    const withMiniTotalHp = (withMini.count - 1) * normalHp + normalHp * TUNING.miniBossHpMul;
    expect(withMiniTotalHp).toBeLessThanOrEqual(noMiniTotalHp + normalHp);
  });

  it('Boss 血量 ≈ 全路集火伤害 × 当波压力比，且数量综合 Boss 抗伤后仍 ≥ 保底', () => {
    const bossSpd = 0.4;
    const wave = PRESSURE_FROM_WAVE;
    const p = planWavePressure({
      wave,
      baselineCount: 14,
      normalHp: 104,
      isBossWave: true,
      bossSpd,
      power,
      ...spawnOpts,
    });
    expect(p.bossHp).toBeCloseTo(power.pathDamage(bossSpd) * pressureRatioForWave(wave), 5);
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

  it('无门口秒杀时后期与前期出怪间隔一致（叠怪靠批次）', () => {
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
    expect(late.spawnInterval).toBeCloseTo(early.spawnInterval, 5);
  });
});

describe('monsterHpFromBoardPower', () => {
  it('波 < MONSTER_HP_FROM_WAVE 或 DPS=0 时返回 0', () => {
    expect(monsterHpFromBoardPower(1, 100)).toBe(0);
    expect(monsterHpFromBoardPower(MONSTER_HP_FROM_WAVE, 0)).toBe(0);
  });

  it('波 ≥2 时 HP = optimalDps × 击杀时长 × 压力比', () => {
    const dps = 50;
    const wave = MONSTER_HP_FROM_WAVE;
    const ratio = pressureRatioForWave(wave);
    expect(monsterHpFromBoardPower(wave, dps)).toBeCloseTo(dps * MONSTER_HP_KILL_SEC * ratio, 5);
  });
});

describe('Battle 接入压力规划', () => {
  const fixedHp = (b: Battle, wave: number) => {
    const w = Math.max(1, Math.floor(wave));
    const early = TUNING.monsterHpEarlyFixed[w - 1];
    const base = early ?? TUNING.monsterHpBase + TUNING.monsterHpStep * w;
    return base;
  };
  const rampFrom = () => TUNING.monsterHpNoDiffTo + 1;
  const maxRamp = (wave: number) => {
    const cycle = Math.floor((Math.max(1, wave) - 1) / TUNING.endlessWavesPerCycle);
    const mul = TUNING.monsterHpRampMulByCycle[Math.min(cycle, TUNING.monsterHpRampMulByCycle.length - 1)]!;
    return TUNING.monsterHpStep * mul + (wave - rampFrom());
  };
  const targetHp = (b: Battle, wave: number, optimalDps = 0) => {
    const diff = b.effectiveDifficulty(wave);
    const staticHp = (TUNING.monsterHpBase + TUNING.monsterHpStep * wave) * diff;
    if (wave < MONSTER_HP_FROM_WAVE || optimalDps <= 0) return staticHp;
    const powerHp =
      monsterHpFromBoardPower(wave, optimalDps, pressureRatioForWave(wave)) * diff;
    return Math.max(staticHp, powerHp);
  };
  const expectedHp = (b: Battle, wave: number, optimalDps = 0) => {
    if (wave <= TUNING.monsterHpNoDiffTo) return fixedHp(b, wave);
    let hp = fixedHp(b, TUNING.monsterHpNoDiffTo);
    for (let i = TUNING.monsterHpNoDiffTo + 1; i <= wave; i++) {
      hp = Math.min(targetHp(b, i, optimalDps), hp + maxRamp(i));
    }
    return hp;
  };

  it('第 1 波血量仅用固定公式', () => {
    const b = new Battle(1);
    const hp = (b as unknown as { normalMonsterHp(w: number): number }).normalMonsterHp(1);
    expect(hp).toBeCloseTo(fixedHp(b, 1), 5);
  });

  it('前 3 波 EarlyFixed，第 4 波起按 step×mul+(波−起始波) 爬向目标', () => {
    const b = new Battle(1, 1.5);
    expect(b.effectiveDifficulty(1)).toBeCloseTo(1.5, 5);
    expect(rampFrom()).toBe(4);
    const hp = (w: number) =>
      (b as unknown as { normalMonsterHp(w: number): number }).normalMonsterHp(w);
    expect(TUNING.monsterHpEarlyFixed).toEqual([20, 40, 65]);
    expect(hp(1)).toBeCloseTo(20, 5);
    expect(hp(2)).toBeCloseTo(40, 5);
    expect(hp(3)).toBeCloseTo(65, 5);
    // target4 = 62×1.5 = 93；maxStep = 13×2+(4−4)=26 → min(93, 65+26)=91
    expect(maxRamp(4)).toBe(26);
    expect(maxRamp(5)).toBe(27);
    expect(hp(4)).toBeCloseTo(91, 5);
    expect(hp(4)).toBeCloseTo(expectedHp(b, 4), 5);
    expect(hp(5)).toBeCloseTo(expectedHp(b, 5), 5);
    expect(hp(8)).toBeCloseTo(expectedHp(b, 8), 5);
  });

  it('第 2 波空板仍用 EarlyFixed', () => {
    const b = new Battle(2);
    const hp = (b as unknown as { normalMonsterHp(w: number): number }).normalMonsterHp(2);
    expect(hp).toBeCloseTo(fixedHp(b, 2), 5);
    expect(b.estimateOptimalPower().optimalDps).toBe(0);
  });

  it('前 3 波强阵也不抬血；第 4 波起朝 DPS 目标爬坡', () => {
    const b = new Battle(3, 1, MAPS[0]!, undefined, {}, [], ['fenghuolun', 'xiandan']);
    const cells = b.unlockedCells();
    for (let i = 0; i < cells.length; i++) {
      b.tray = [{ kind: 'unit', type: 'archer', tier: 5 }];
      b.placeFromTray(0, cells[i]!);
    }
    const power = b.estimateOptimalPower();
    expect(power.optimalDps).toBeGreaterThan(50);
    const nm = (w: number) =>
      (b as unknown as { normalMonsterHp(w: number): number }).normalMonsterHp(w);
    expect(nm(MONSTER_HP_FROM_WAVE)).toBeCloseTo(fixedHp(b, MONSTER_HP_FROM_WAVE), 5);
    const wave = 4;
    const target = targetHp(b, wave, power.optimalDps);
    expect(target).toBeGreaterThan(fixedHp(b, TUNING.monsterHpNoDiffTo) + maxRamp(wave));
    expect(nm(wave)).toBeCloseTo(expectedHp(b, wave, power.optimalDps), 5);
    expect(nm(wave)).toBeLessThan(target);
  });

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
    const normalHp = fixedHp(b, 1);
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
    const baseline = 10 + 4 - 1; // wave4=13
    // 强阵预算可能抬升
    expect(b.snapshot().waveCount).toBeGreaterThanOrEqual(baseline);
    expect(b.snapshot().optimalDps).toBeGreaterThan(0);
    expect(b.snapshot().spawnInterval!).toBeLessThanOrEqual(TUNING.spawnInterval);
    expect(b.snapshot().spawnInterval!).toBeGreaterThanOrEqual(TUNING.spawnIntervalMin);
  });

  it('压力波起单次可叠多只，多出怪在门口后方半格内', () => {
    const b = new Battle(11);
    (b as unknown as { wave: number }).wave = 7;
    (b as unknown as { waveActive: boolean }).waveActive = false;
    (b as unknown as { status: string }).status = 'ready';
    (b as unknown as { introDone: boolean }).introDone = true;
    expect(b.startNextWave()).toBe(true);
    expect(b.wave).toBe(8);
    expect(spawnBatchCap(8)).toBeGreaterThan(1);
    const entrance = (b as unknown as { entranceDist: number }).entranceDist;
    (b as unknown as { spawnTimer: number }).spawnTimer = 0;
    const dt = 1 / 240;
    b.step(dt);
    expect(b.monsters.length).toBeGreaterThanOrEqual(1);
    expect(b.monsters.length).toBeLessThanOrEqual(spawnBatchCap(8));
    // 同帧会前进 spd*dt，故允许略超出口；多出怪起点应在 [入口-0.5, 入口]
    const maxAhead = TUNING.monsterSpd * 1.5 * dt + 1e-6;
    for (const m of b.monsters) {
      expect(m.dist).toBeLessThanOrEqual(entrance + maxAhead);
      expect(m.dist).toBeGreaterThanOrEqual(entrance - 0.5 - 1e-9);
    }
    if (b.monsters.length > 1) {
      const spreads = b.monsters.map((m) => m.dist);
      expect(Math.max(...spreads) - Math.min(...spreads)).toBeLessThanOrEqual(0.5 + maxAhead);
    }
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
