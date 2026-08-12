// 战场最优输出估算：按当前地图把已上场兵种重排到可达格，
// 综合攻速/范围/伤害/目标数（含被动乘区）得到最优 DPS，
// 并据此按随波次升高的压力比（6→20：0.6→0.75，其后每波+0.02）推算 Boss 血量与第 6 波起的出怪数 / 叠怪批次。
import { getUnitStat, type UnitType } from '@core';
import { exitDistToPath, posAlong, posAtDistance, type Cell, type GameMap } from './board';
import { placeCellScore } from './autoplace';

/** 承压 / 出怪批次等可调参数（DevTools 可改；函数内读此对象） */
export const BOARD_POWER = {
  /** 压力比起点（第 fromWave 波） */
  PRESSURE_RATIO: 0.60,
  /** 线性段终点压力比（第 midWave 波） */
  PRESSURE_RATIO_MID: 0.75,
  /** 线性爬升结束波（fromWave → midWave：RATIO → RATIO_MID） */
  PRESSURE_RATIO_MID_WAVE: 20,
  /** midWave 之后每波叠加 */
  PRESSURE_RATIO_STEP_AFTER: 0.02,
  /** 压力窗口（秒） */
  PRESSURE_WINDOW_SEC: 10,
  /** 第几波起按最优输出抬高出怪数 */
  PRESSURE_FROM_WAVE: 6,
  /** 门口路段长度（格） */
  ENTRANCE_ZONE_LEN: 2.5,
  /** 出怪间隔下限（秒） */
  SPAWN_INTERVAL_MIN: 0.35,
  /** 门口秒杀判定血量比例 */
  GATE_WIPE_HP_RATIO: 0.85,
  /** 同批多出怪沿路后退抖动（格） */
  SPAWN_DIST_JITTER: 0.5,
  /** 单次出怪批次上限封顶 */
  SPAWN_BATCH_CAP_MAX: 10,
  /** 第几波起小怪血量按战场最优 DPS（武器攻击×攻速×目标）缩放 */
  MONSTER_HP_FROM_WAVE: 2,
  /** 单怪参考击杀时长（秒）：HP ≈ optimalDps × 该值 × 压力比 */
  MONSTER_HP_KILL_SEC: 3,
};

/** @deprecated 快照；运行时请读 BOARD_POWER.* */
export const PRESSURE_RATIO = BOARD_POWER.PRESSURE_RATIO;
export const PRESSURE_RATIO_MID = BOARD_POWER.PRESSURE_RATIO_MID;
export const PRESSURE_RATIO_MID_WAVE = BOARD_POWER.PRESSURE_RATIO_MID_WAVE;
export const PRESSURE_RATIO_STEP_AFTER = BOARD_POWER.PRESSURE_RATIO_STEP_AFTER;
export const PRESSURE_WINDOW_SEC = BOARD_POWER.PRESSURE_WINDOW_SEC;
export const PRESSURE_FROM_WAVE = BOARD_POWER.PRESSURE_FROM_WAVE;
export const ENTRANCE_ZONE_LEN = BOARD_POWER.ENTRANCE_ZONE_LEN;
export const SPAWN_INTERVAL_MIN = BOARD_POWER.SPAWN_INTERVAL_MIN;
export const GATE_WIPE_HP_RATIO = BOARD_POWER.GATE_WIPE_HP_RATIO;
export const SPAWN_DIST_JITTER = BOARD_POWER.SPAWN_DIST_JITTER;
export const SPAWN_BATCH_CAP_MAX = BOARD_POWER.SPAWN_BATCH_CAP_MAX;
export const MONSTER_HP_FROM_WAVE = BOARD_POWER.MONSTER_HP_FROM_WAVE;
export const MONSTER_HP_KILL_SEC = BOARD_POWER.MONSTER_HP_KILL_SEC;

/**
 * 第 MONSTER_HP_FROM_WAVE 波起：按战场最优 DPS × 参考击杀时长 × 压力比估算单怪 HP。
 * 空板或弱阵时由调用方与静态公式取 max。
 */
export function monsterHpFromBoardPower(
  wave: number,
  optimalDps: number,
  pressureRatio?: number,
): number {
  if (wave < BOARD_POWER.MONSTER_HP_FROM_WAVE || optimalDps <= 0) return 0;
  const ratio = pressureRatio ?? pressureRatioForWave(wave);
  return optimalDps * BOARD_POWER.MONSTER_HP_KILL_SEC * ratio;
}

/**
 * 随波次升高的压力比：
 * - 波 ≤ fromWave：PRESSURE_RATIO（0.60）
 * - 波 fromWave→midWave（6→20）：线性至 PRESSURE_RATIO_MID（0.75）
 * - 波 > midWave：每波 + PRESSURE_RATIO_STEP_AFTER（0.02）
 */
export function pressureRatioForWave(wave: number): number {
  const w = Math.max(1, Math.floor(wave));
  const {
    PRESSURE_RATIO: lo,
    PRESSURE_RATIO_MID: mid,
    PRESSURE_RATIO_MID_WAVE: midWave,
    PRESSURE_RATIO_STEP_AFTER: step,
    PRESSURE_FROM_WAVE: from,
  } = BOARD_POWER;
  if (w <= from) return lo;
  if (w <= midWave) {
    const span = Math.max(1, midWave - from);
    return lo + ((w - from) / span) * (mid - lo);
  }
  return mid + (w - midWave) * step;
}

/**
 * 单次出怪批次上限 N（实际出 1..N 随机）：前期 1，第 PRESSURE_FROM_WAVE 波起随波次升高。
 * 波 6–7 → 2，8–9 → 3，…，约波 22 起封顶 10。
 */
export function spawnBatchCap(wave: number): number {
  const { PRESSURE_FROM_WAVE: from, SPAWN_BATCH_CAP_MAX: cap } = BOARD_POWER;
  if (wave < from) return 1;
  return Math.min(cap, 2 + Math.floor((wave - from) / 2));
}

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
  /**
   * 大招对单体(专注火力)的平均秒伤，例如二郎「天眼诛邪」= atk×5×CRIT_MULT / skillCd。
   * 大招命中往往落在集火目标(含 Boss)上，若不计入会让 Boss 压力估算游离于实际输出账本外。
   */
  skillFocusDps?: number;
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
  skillFocusDps?: number;
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

/** 沿 Cell[] 路径（AI 半场镜像路）采样覆盖长度 */
export function pathCoverageLenAlong(
  path: Cell[],
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
    const p = posAlong(path, d);
    if (inRange(ax, ay, rge, p, tol)) covered += PATH_SAMPLE_STEP;
  }
  return covered;
}

/** 沿 Cell[] 路径：出怪口段加权覆盖 */
export function pathCoverageLenEntranceWeightedAlong(
  path: Cell[],
  entranceDist: number,
  pathLen: number,
  ax: number,
  ay: number,
  rge: number,
  tol = DEFAULT_RANGE_TOL,
): number {
  if (pathLen <= entranceDist) return 0;
  const span = Math.max(PATH_SAMPLE_STEP, pathLen - entranceDist);
  let covered = 0;
  for (let d = entranceDist; d < pathLen; d += PATH_SAMPLE_STEP) {
    const p = posAlong(path, d);
    if (inRange(ax, ay, rge, p, tol)) {
      const w = 1 + (pathLen - d) / span;
      covered += PATH_SAMPLE_STEP * w;
    }
  }
  return covered;
}

/** 沿 Cell[] 路径：首次接战沿路距离 */
export function pathFirstEngageDistAlong(
  path: Cell[],
  entranceDist: number,
  pathLen: number,
  ax: number,
  ay: number,
  rge: number,
  tol = DEFAULT_RANGE_TOL,
): number {
  if (pathLen <= entranceDist) return pathLen;
  for (let d = entranceDist; d < pathLen; d += PATH_SAMPLE_STEP) {
    const p = posAlong(path, d);
    if (inRange(ax, ay, rge, p, tol)) return d;
  }
  return pathLen;
}

/** 攻击圆覆盖的路径长度，出怪口段权重更高（武将优先更早打到怪） */
export function pathCoverageLenEntranceWeighted(
  map: GameMap,
  entranceDist: number,
  pathLen: number,
  ax: number,
  ay: number,
  rge: number,
  tol = DEFAULT_RANGE_TOL,
): number {
  if (pathLen <= entranceDist) return 0;
  const span = Math.max(PATH_SAMPLE_STEP, pathLen - entranceDist);
  let covered = 0;
  for (let d = entranceDist; d < pathLen; d += PATH_SAMPLE_STEP) {
    const p = posAtDistance(map, d);
    if (inRange(ax, ay, rge, p, tol)) {
      const w = 1 + (pathLen - d) / span;
      covered += PATH_SAMPLE_STEP * w;
    }
  }
  return covered;
}

/** 攻击圆首次覆盖路径的沿路距离（越小越早打到怪；打不到则 pathLen） */
export function pathFirstEngageDist(
  map: GameMap,
  entranceDist: number,
  pathLen: number,
  ax: number,
  ay: number,
  rge: number,
  tol = DEFAULT_RANGE_TOL,
): number {
  if (pathLen <= entranceDist) return pathLen;
  for (let d = entranceDist; d < pathLen; d += PATH_SAMPLE_STEP) {
    const p = posAtDistance(map, d);
    if (inRange(ax, ay, rge, p, tol)) return d;
  }
  return pathLen;
}

/**
 * 短射程优先 → 可达格中取 pathCover+近出口加权最高（与一键布阵 placeCellScore 同口径），
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
      skillFocusDps: g.skillFocusDps,
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
      // 大招专注秒伤（如二郎暴击）按覆盖时长同口径折算，避免游离于 Boss 压力账本外
      if (a.skillFocusDps) dmg += a.skillFocusDps * (cov / spd);
    }
    return dmg;
  };

  const entranceEnd = Math.min(input.pathLen, input.entranceDist + BOARD_POWER.ENTRANCE_ZONE_LEN);
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
    const cell = reach.reduce((best, c) => {
      const cov = pathCoverageLen(
        input.map, input.entranceDist, input.pathLen, c.c, c.r, stat.rge, tol,
      );
      const bestCov = pathCoverageLen(
        input.map, input.entranceDist, input.pathLen, best.c, best.r, stat.rge, tol,
      );
      const s = placeCellScore(cov, exitDistToPath(input.map.path, c), stat.rge, input.nearestPathDist(c));
      const bs = placeCellScore(bestCov, exitDistToPath(input.map.path, best), stat.rge, input.nearestPathDist(best));
      return s > bs ? c : best;
    }, reach[0]!);
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
  /** 境界等带来的出怪加速系数（已弃用：出怪间隔不再随难度缩短，密度靠怪量与同批叠怪） */
  difficultySpawnFactor?: number;
  power: BoardPowerResult;
  pressureRatio?: number;
  windowSec?: number;
  fromWave?: number;
  minSpawnInterval?: number;
  /**
   * 本波若预定刷 1 只小 Boss，其相对普通怪多出的血量（miniBossHp − normalHp）。
   * 小 Boss 是从原定怪量中「顶替」1 只普通怪出场（不额外加量），若不占预算，
   * 会导致本波实际的怪血总量超出压力比规划值 —— 与正式 Boss 波扣 bossTank 同一账本口径。
   */
  miniBossExtraHp?: number;
}

export interface PressurePlan {
  count: number;
  /** 妖王/双雄召唤 Boss 血量参考（始终有值） */
  bossHp: number;
  optimalDps: number;
  trashBudget: number;
  /** 本波出怪间隔（秒）；基础节奏 + 门口防秒压间隔（叠怪密度见 spawnBatchCap） */
  spawnInterval: number;
}

/**
 * 出怪间隔：保持基础节奏（不再每波 ×0.85）；若门口段集火能秒杀单怪，
 * 再按叠怪需要压间隔，避免一出门就被清光。后期密度改由随机 1..N 批出承担。
 */
export function planSpawnInterval(input: {
  wave: number; // 保留供调用方传入；间隔不再随波次衰减
  baseInterval: number;
  monsterSpd: number;
  normalHp: number;
  entranceDps: number;
  difficultySpawnFactor?: number;
  minInterval?: number;
  entranceZoneLen?: number;
}): number {
  void input.wave;
  const minItv = input.minInterval ?? BOARD_POWER.SPAWN_INTERVAL_MIN;
  const zoneLen = input.entranceZoneLen ?? BOARD_POWER.ENTRANCE_ZONE_LEN;
  const diffFactor = Math.max(1, input.difficultySpawnFactor ?? 1);

  let itv = input.baseInterval / diffFactor;

  // 门口不灭：门口段走完时间内的集火伤害若接近/超过怪血，则加快出怪叠压
  const spd = Math.max(0.05, input.monsterSpd);
  const timeInZone = zoneLen / spd;
  const dmgInZone = input.entranceDps * timeInZone;
  const hp = Math.max(1, input.normalHp);
  if (input.entranceDps > 0 && dmgInZone > hp * BOARD_POWER.GATE_WIPE_HP_RATIO) {
    const needStack = Math.min(6, Math.max(2, Math.ceil(dmgInZone / hp)));
    itv = Math.min(itv, timeInZone / needStack);
  }

  return Math.max(minItv, Math.min(input.baseInterval, itv));
}

/**
 * 按最优输出 × 压力比规划本波出怪数、Boss 血量与出怪间隔。
 * - Boss 血参考 ≈ 全路集火伤害 × pressure（正式妖王波与双雄召唤共用）
 * - 第 fromWave 波起：窗口内总血预算 = dps × window × pressure；
 *   正式 Boss 波先扣 Boss 血，剩余预算给小怪；数量不低于 baseline。
 * - 出怪间隔：基础节奏 + 门口 DPS 防灭队；同批随机 1..N 叠怪见 spawnBatchCap。
 */
export function planWavePressure(input: PressurePlanInput): PressurePlan {
  const ratio = input.pressureRatio ?? pressureRatioForWave(input.wave);
  const window = input.windowSec ?? BOARD_POWER.PRESSURE_WINDOW_SEC;
  const fromWave = input.fromWave ?? BOARD_POWER.PRESSURE_FROM_WAVE;

  const { power, normalHp, baselineCount, isBossWave } = input;
  const optimalDps = power.optimalDps;

  const spawnInterval = planSpawnInterval({
    wave: input.wave,
    baseInterval: input.baseSpawnInterval,
    monsterSpd: input.monsterSpd,
    normalHp,
    entranceDps: power.entranceDps,
    difficultySpawnFactor: input.difficultySpawnFactor,
    minInterval: input.minSpawnInterval,
  });

  // 始终给出 Boss 血量参考，供正式妖王波与双雄召唤共用（消灭静态×8~14 双轨）
  const pathDmg = power.pathDamage(input.bossSpd);
  const bossHp = Math.max(normalHp, pathDmg * ratio);

  if (input.wave < fromWave) {
    return { count: baselineCount, bossHp, optimalDps, trashBudget: 0, spawnInterval };
  }

  const budget = optimalDps * window * ratio;
  let trashBudget = budget;
  if (isBossWave) {
    // Boss 占用预算：窗口内它能抗的输出上限为 dps×window，实际按血量扣
    const bossTank = Math.min(bossHp, optimalDps * window);
    trashBudget = Math.max(0, budget - bossTank);
  } else if (input.miniBossExtraHp && input.miniBossExtraHp > 0) {
    // 小 Boss 顶替 1 只普通怪出场，多出的血量同样先从预算扣，
    // 否则「怪量不变但血量更高」会让本波实际压力悄悄超出规划比例
    const miniTank = Math.min(input.miniBossExtraHp, optimalDps * window);
    trashBudget = Math.max(0, budget - miniTank);
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
