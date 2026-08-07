// 战场最优输出估算：按当前地图把已上场兵种重排到可达格，
// 综合攻速/范围/伤害/目标数（含被动乘区）得到最优 DPS，
// 并据此按约 70% 压力推算 Boss 血量与第 4 波起的出怪数。
import { getUnitStat, type UnitType } from '@core';
import { posAtDistance, type Cell, type GameMap } from './board';

/** 目标压力：怪物总血量 ≈ 武器最优输出的该比例 */
export const PRESSURE_RATIO = 0.7;
/** 压力窗口（秒）：用窗口内产出血量 vs 武器输出比来调数量 */
export const PRESSURE_WINDOW_SEC = 10;
/** 第几波起按最优输出抬高出怪数 / 加快出怪频率（此前只用基准） */
export const PRESSURE_FROM_WAVE = 4;
/** 门口路段长度（格）：用于判断会不会在出怪口被秒 */
export const ENTRANCE_ZONE_LEN = 2.5;
/** 第 PRESSURE_FROM_WAVE 波起，每波出怪间隔再 × 该系数（逐渐加快） */
export const SPAWN_INTERVAL_WAVE_DECAY = 0.88;
/** 出怪间隔下限（秒） */
export const SPAWN_INTERVAL_MIN = 0.35;
/** 门口段集火伤害超过怪血该比例时，视为会门口灭队 → 加快叠怪 */
export const GATE_WIPE_HP_RATIO = 0.85;

const PATH_SAMPLE_STEP = 0.25;
const DEFAULT_RANGE_TOL = 0.5;

export interface PowerUnit {
  type: UnitType;
  tier: number;
}

export interface PowerGeneral {
  atk: number;
  frq: number;
  rge: number;
  targets: number;
  ax: number;
  ay: number;
}

export interface BoardPowerInput {
  map: GameMap;
  entranceDist: number;
  pathLen: number;
  units: PowerUnit[];
  /** 可供兵种重排的空位（已解锁、无字牌占用） */
  freeCells: Cell[];
  nearestPathDist: (cell: Cell) => number;
  generals: PowerGeneral[];
  atkMul: number;
  frqMul: number;
  rangeTolerance?: number;
}

export interface BoardPowerResult {
  /** 饱和清场 DPS（ATK×FRQ×目标数，仅计入重排后能打到路径的兵/将） */
  optimalDps: number;
  /** 单只怪沿全路走完时，最优布阵对其造成的总伤害（集火、目标数按 min(1,targets)） */
  pathDamage: (spd: number) => number;
  /** 门口路段平均集火 DPS（用于避免出怪口被秒） */
  entranceDps: number;
  /** 重排后各攻击者覆盖的路径长度（格） */
  coverageTotal: number;
}

interface PlacedAttacker {
  atk: number;
  frq: number;
  rge: number;
  targets: number;
  ax: number;
  ay: number;
}

function inRange(
  ax: number,
  ay: number,
  rge: number,
  p: { c: number; r: number },
  tol: number,
): boolean {
  const mc = Math.round(p.c);
  const mr = Math.round(p.r);
  const nx = Math.min(mc + 0.5, Math.max(mc - 0.5, ax));
  const ny = Math.min(mr + 0.5, Math.max(mr - 0.5, ay));
  return Math.hypot(ax - nx, ay - ny) < rge + tol;
}

/** 攻击圆覆盖的路径长度（从出怪口到终点） */
export function pathCoverageLen(
  map: GameMap,
  entranceDist: number,
  pathLen: number,
  ax: number,
  ay: number,
  rge: number,
  tol = DEFAULT_RANGE_TOL,
): number {
  if (pathLen <= entranceDist) return 0;
  let covered = 0;
  for (let d = entranceDist; d < pathLen; d += PATH_SAMPLE_STEP) {
    const p = posAtDistance(map, d);
    if (inRange(ax, ay, rge, p, tol)) covered += PATH_SAMPLE_STEP;
  }
  return covered;
}

/**
 * 短射程优先 → 放到「可达且离路最远」的空格（与一键布阵同思路），
 * 武将保持原位；返回最优布阵下的 DPS / 路径伤害。
 */
export function estimateOptimalBoardPower(input: BoardPowerInput): BoardPowerResult {
  const tol = input.rangeTolerance ?? DEFAULT_RANGE_TOL;
  const placed = planOptimalUnitPlacement(input, tol);
  for (const g of input.generals) {
    placed.push({
      atk: g.atk,
      frq: g.frq,
      rge: g.rge,
      targets: g.targets,
      ax: g.ax,
      ay: g.ay,
    });
  }

  let optimalDps = 0;
  let coverageTotal = 0;
  const coverages: number[] = [];
  for (const a of placed) {
    const cov = pathCoverageLen(
      input.map,
      input.entranceDist,
      input.pathLen,
      a.ax,
      a.ay,
      a.rge,
      tol,
    );
    coverages.push(cov);
    coverageTotal += cov;
    if (cov > 0) optimalDps += a.atk * a.frq * a.targets;
  }

  const pathDamage = (spd: number): number => {
    if (spd <= 0) return Number.POSITIVE_INFINITY;
    let dmg = 0;
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      const cov = coverages[i]!;
      if (cov <= 0) continue;
      // 集火单体：目标数超过 1 的溢出对 Boss 无额外收益
      const focusTargets = Math.min(1, a.targets);
      dmg += a.atk * a.frq * focusTargets * (cov / spd);
    }
    return dmg;
  };

  const entranceEnd = Math.min(input.pathLen, input.entranceDist + ENTRANCE_ZONE_LEN);
  const entranceDps = zoneAverageFocusDps(
    placed,
    input.map,
    input.entranceDist,
    entranceEnd,
    tol,
  );

  return { optimalDps, pathDamage, entranceDps, coverageTotal };
}

/** 路径区段 [fromDist, toDist) 上的平均集火 DPS */
function zoneAverageFocusDps(
  attackers: PlacedAttacker[],
  map: GameMap,
  fromDist: number,
  toDist: number,
  tol = DEFAULT_RANGE_TOL,
): number {
  if (toDist <= fromDist) return 0;
  let sum = 0;
  let n = 0;
  for (let d = fromDist; d < toDist; d += PATH_SAMPLE_STEP) {
    const p = posAtDistance(map, d);
    let tick = 0;
    for (const a of attackers) {
      if (inRange(a.ax, a.ay, a.rge, p, tol)) {
        tick += a.atk * a.frq * Math.min(1, a.targets);
      }
    }
    sum += tick;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function planOptimalUnitPlacement(input: BoardPowerInput, tol: number): PlacedAttacker[] {
  const cells = input.freeCells.map((c) => ({ ...c }));
  const sorted = [...input.units].sort(
    (a, b) => getUnitStat(a.type, a.tier).rge - getUnitStat(b.type, b.tier).rge,
  );
  const out: PlacedAttacker[] = [];
  for (const u of sorted) {
    const stat = getUnitStat(u.type, u.tier);
    const reach = cells.filter((c) => input.nearestPathDist(c) <= stat.rge + tol);
    if (reach.length === 0) continue;
    const cell = reach.reduce(
      (best, c) => (input.nearestPathDist(c) > input.nearestPathDist(best) ? c : best),
      reach[0]!,
    );
    const idx = cells.findIndex((c) => c.c === cell.c && c.r === cell.r);
    if (idx >= 0) cells.splice(idx, 1);
    out.push({
      atk: stat.atk * input.atkMul,
      frq: stat.frq * input.frqMul,
      rge: stat.rge,
      targets: stat.targets,
      ax: cell.c,
      ay: cell.r,
    });
  }
  return out;
}

export interface PressurePlanInput {
  wave: number;
  baselineCount: number;
  normalHp: number;
  isBossWave: boolean;
  bossSpd: number;
  /** 普通怪移速（含被动减速），用于门口叠怪节奏 */
  monsterSpd: number;
  /** 基础出怪间隔（秒） */
  baseSpawnInterval: number;
  /** 境界等带来的出怪加速系数（与 battle 原公式一致：1+0.07*(diff-1)） */
  difficultySpawnFactor?: number;
  power: BoardPowerResult;
  pressureRatio?: number;
  windowSec?: number;
  fromWave?: number;
  minSpawnInterval?: number;
}

export interface PressurePlan {
  count: number;
  bossHp: number | null;
  optimalDps: number;
  trashBudget: number;
  /** 本波出怪间隔（秒）；第 4 波起逐渐加快，并保证门口叠得过集火 */
  spawnInterval: number;
}

/**
 * 第 fromWave 波起逐渐缩短间隔；若门口段集火能秒杀单怪，再按叠怪需要压间隔，
 * 避免一出门就被清光。
 */
export function planSpawnInterval(input: {
  wave: number;
  baseInterval: number;
  monsterSpd: number;
  normalHp: number;
  entranceDps: number;
  difficultySpawnFactor?: number;
  fromWave?: number;
  minInterval?: number;
  waveDecay?: number;
  entranceZoneLen?: number;
}): number {
  const fromWave = input.fromWave ?? PRESSURE_FROM_WAVE;
  const minItv = input.minInterval ?? SPAWN_INTERVAL_MIN;
  const decay = input.waveDecay ?? SPAWN_INTERVAL_WAVE_DECAY;
  const zoneLen = input.entranceZoneLen ?? ENTRANCE_ZONE_LEN;
  const diffFactor = Math.max(1, input.difficultySpawnFactor ?? 1);

  let itv = input.baseInterval / diffFactor;
  if (input.wave >= fromWave) {
    itv *= Math.pow(decay, input.wave - fromWave);
  }

  // 门口不灭：门口段走完时间内的集火伤害若接近/超过怪血，则加快出怪叠压
  const spd = Math.max(0.05, input.monsterSpd);
  const timeInZone = zoneLen / spd;
  const dmgInZone = input.entranceDps * timeInZone;
  const hp = Math.max(1, input.normalHp);
  if (input.entranceDps > 0 && dmgInZone > hp * GATE_WIPE_HP_RATIO) {
    const needStack = Math.min(6, Math.max(2, Math.ceil(dmgInZone / hp)));
    itv = Math.min(itv, timeInZone / needStack);
  }

  return Math.max(minItv, Math.min(input.baseInterval, itv));
}

/**
 * 按最优输出 × 压力比规划本波出怪数、Boss 血量与出怪间隔。
 * - Boss 血 ≈ 全路集火伤害 × pressure（走完路约 70% 血量压力）
 * - 第 fromWave 波起：窗口内总血预算 = dps × window × pressure；
 *   有 Boss 时先扣 Boss 血，剩余预算给小怪；数量不低于 baseline。
 * - 出怪间隔：同波次起逐渐加快，并按门口 DPS 防止门口灭队。
 */
export function planWavePressure(input: PressurePlanInput): PressurePlan {
  const ratio = input.pressureRatio ?? PRESSURE_RATIO;
  const window = input.windowSec ?? PRESSURE_WINDOW_SEC;
  const fromWave = input.fromWave ?? PRESSURE_FROM_WAVE;

  const { power, normalHp, baselineCount, isBossWave } = input;
  const optimalDps = power.optimalDps;

  const spawnInterval = planSpawnInterval({
    wave: input.wave,
    baseInterval: input.baseSpawnInterval,
    monsterSpd: input.monsterSpd,
    normalHp,
    entranceDps: power.entranceDps,
    difficultySpawnFactor: input.difficultySpawnFactor,
    fromWave,
    minInterval: input.minSpawnInterval,
  });

  let bossHp: number | null = null;
  if (isBossWave) {
    const pathDmg = power.pathDamage(input.bossSpd);
    bossHp = Math.max(normalHp, pathDmg * ratio);
  }

  if (input.wave < fromWave) {
    return { count: baselineCount, bossHp, optimalDps, trashBudget: 0, spawnInterval };
  }

  const budget = optimalDps * window * ratio;
  let trashBudget = budget;
  if (bossHp != null) {
    // Boss 占用预算：窗口内它能抗的输出上限为 dps×window，实际按血量扣
    const bossTank = Math.min(bossHp, optimalDps * window);
    trashBudget = Math.max(0, budget - bossTank);
  }

  const hp = Math.max(1, normalHp);
  const trashCount = Math.ceil(trashBudget / hp);
  const desired = isBossWave ? trashCount + 1 : trashCount;
  return {
    count: Math.max(baselineCount, desired),
    bossHp,
    optimalDps,
    trashBudget,
    spawnInterval,
  };
}
