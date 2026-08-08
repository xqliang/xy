// web/src/autoplace.ts
// 射程感知的自动布阵策略：玩家「一键布阵」与 AI 对手共用。
// 原则：绝不丢弃令牌（无处可放者留在 tray）；铲挖最优位；合成升级；按射程铺满；够不着则升级。
// 满槽时：tray 内先合再上棋盘合；或棋盘同阶合（保留 pathCover+近出口加权更高者）腾位再落子。
// 武将：单字远离路径、靠唐僧；配对激活后按路径覆盖选位（不追贴出口），可挪开普通武器。
// 满盘凑对：优先伴侣已在位的邻格；占位可顶回候选或与 tray 字直接交换（place）。
// 未激活孤儿字不占前线：与兵器换高覆盖座，或迁到远离路径/靠唐僧的空位。
// 字牌回收：配对优先最高阶孤儿；同字高阶可换上棋盘；重复同字只留最高阶，低阶用 tray 异字换回。
// 纯逻辑：只通过 AutoPlaceView 读写宿主状态，rng 注入以便确定性测试。
import { canMerge, getUnitStat, type UnitType } from '@core';
import { posAlong } from './board';
import { matchGeneral } from './generals';

export interface Cell { c: number; r: number; }

export type PlaceToken =
  | { kind: 'shovel' }
  | { kind: 'unit'; type: UnitType; tier: number }
  | { kind: 'word'; char: string; general: string; tier: number };

export interface PlacedUnitLite { type: UnitType; tier: number; cell: Cell; }
export interface PlacedWordLite { char: string; general: string; cell: Cell; tier?: number }

export interface AutoPlaceView {
  tray(): PlaceToken[];                     // 当前候选（随 place 变化，每步重读）
  freeCells(): Cell[];                      // 已解锁且空闲，按贴路近→远
  diggableCells(): Cell[];                  // 未解锁可开挖（无桃树）
  placedUnits(): PlacedUnitLite[];
  placedWords(): PlacedWordLite[];
  nearestPathDist(cell: Cell): number;      // 格到怪路的最近距（格）
  /** 格与怪物路径正交贴合的边数（0–4：一边/两边/三边…） */
  pathTouchSides(cell: Cell): number;
  /** 格到怪物出口（路径首个在网格内的点）的距离 */
  exitDist(cell: Cell): number;
  /** 格到唐僧的距离 */
  tangsengDist(cell: Cell): number;
  /** 该格兵种攻击圆覆盖的怪物路径长度（越大越好） */
  pathCover(cell: Cell, type: UnitType, tier: number): number;
  /** 任意攻击圆心 + 射程的路径覆盖（武将用双格中点） */
  pathCoverAt(ax: number, ay: number, rge: number): number;
  /** 武将有效射程（含神兵等） */
  generalRge(general: string, tier: number): number;
  wordChars(general: string): readonly [string, string] | undefined; // 连读顺序 [左,右]
  place(trayIndex: number, cell: Cell): boolean; // 执行落子（挖/放/合成/激活由宿主完成）
  moveUnit(from: Cell, to: Cell): boolean;  // 把已上场单位从 from 挪到空 to
  /** 交换两格已上场单位位置（用于高阶抢占低阶更好座位） */
  swapUnits(a: Cell, b: Cell): boolean;
  /** 兵与未激活孤儿字换位（字牌让出前线攻位） */
  swapUnitWord(unitCell: Cell, wordCell: Cell): boolean;
  /** 把已上场字牌挪到空 to（不与其他字/兵重叠） */
  moveWord(from: Cell, to: Cell): boolean;
  /**
   * 满槽腾位：把该格普通武器或未激活孤儿顶回候选区（候选未满时）。
   * 已激活武将格必须失败。空格视为成功。
   */
  displaceToTray(cell: Cell): boolean;
  /** 该格是否属于已激活武将（禁止拆散） */
  isActiveHeroCell(cell: Cell): boolean;
  /** 危险提示：怪物逼近唐僧，布阵/调位优先往唐僧方向靠拢 */
  dangerNear(): boolean;
  /** 格对「怪物即将路过」路段的贴近分（越高越好；无怪时为 0） */
  imminentPathScore(cell: Cell): number;
  /** 候选区内两枚同型同阶兵合成（升阶留在 to 下标；from 被移除） */
  mergeTray(from: number, to: number): boolean;
  /** 棋盘两兵合成：from 并入 to（保留 to 格，升阶） */
  mergeBoard(from: Cell, to: Cell): boolean;
}

export interface AutoPlaceOpts {
  rng: () => number;       // [0,1)
  pSubOptimal?: number;    // 次优概率，默认 0（恒最优）
  rangeTolerance?: number; // 默认 0.5，与战斗判定一致
  /** AI 对手：每次挖铲在 [DIG_EXIT_WEIGHT_AI_MIN, MAX] 随机出口权重，增加挖格随机性 */
  randomDigExitWeight?: boolean;
  /** 至多执行几步；默认不限（一键布阵） */
  maxSteps?: number;
}

/** AI 战中调位：普通兵器 1.5–4s；待补英雄配对字 0.5–1s */
export const AI_WEAPON_ADJUST_INTERVAL_MIN = 1.5;
export const AI_WEAPON_ADJUST_INTERVAL_MAX = 4;
export const AI_PARTNER_ADJUST_INTERVAL_MIN = 0.5;
export const AI_PARTNER_ADJUST_INTERVAL_MAX = 1;

export function rollAiAdjustInterval(partnerPending: boolean, rng: () => number): number {
  const r = rng();
  return partnerPending
    ? AI_PARTNER_ADJUST_INTERVAL_MIN + r * (AI_PARTNER_ADJUST_INTERVAL_MAX - AI_PARTNER_ADJUST_INTERVAL_MIN)
    : AI_WEAPON_ADJUST_INTERVAL_MIN + r * (AI_WEAPON_ADJUST_INTERVAL_MAX - AI_WEAPON_ADJUST_INTERVAL_MIN);
}

/**
 * 洛阳铲挖格优先级（分越低越优先），服务「就近部署持续输出」：
 * 1) 离路距离：约 1 格最优；0 格与 2 格接近；更远惩罚递增（远距三边也不压过近距一边）
 * 2) 同距离档内：贴路边数越多越好（弱权重）
 * 3) 靠近出怪口加分（权重高于贴边，可压过小幅贴边差）
 */
export const DIG_DIST_WEIGHT = 10;
export const DIG_TOUCH_WEIGHT = 1;
/** 离出口每远 1 格的惩罚；高于贴边权重，使近出口更优先（玩家默认） */
export const DIG_EXIT_WEIGHT = 3;
/** AI 挖铲出口权重随机区间 */
export const DIG_EXIT_WEIGHT_AI_MIN = 1;
export const DIG_EXIT_WEIGHT_AI_MAX = 3;

/** 离路距离惩罚：~1 格=0；~0 与 ~2 格同档；更远线性加重 */
export function digPathDistPenalty(pathDist: number): number {
  const d = Math.max(0, pathDist);
  if (d > 0.5 && d <= 1.5) return 0; // 约 1 格：贴路外侧，近战/中距最好开火位
  if (d <= 0.5) return 1;             // 约 0 格
  if (d <= 2.5) return 1;             // 约 2 格（与 0 格同权）
  return 1 + (d - 2.5);               // 更远
}

export function digPriorityScore(
  touchSides: number,
  pathDist: number,
  exitDist: number,
  exitWeight: number = DIG_EXIT_WEIGHT,
  opts?: { danger?: boolean; imminentScore?: number; tangsengDist?: number },
): number {
  const sides = Math.max(0, Math.min(4, Math.floor(touchSides)));
  // 贴边越多分越低；权重远小于距离档，避免「远端三边」压过「近端一边」
  const touchPart = DIG_TOUCH_WEIGHT * (4 - sides);
  const pathPart = DIG_DIST_WEIGHT * digPathDistPenalty(pathDist);
  if (opts?.danger) {
    const imm = opts.imminentScore ?? 0;
    if (imm > 0) return pathPart + touchPart - IMMINENT_DIG_WEIGHT * imm;
    // 无怪时回退：沿路径靠唐僧
    return pathPart + touchPart - dangerSeatBonus(exitDist, opts.tangsengDist ?? 0);
  }
  return pathPart + touchPart + Math.max(0, exitWeight) * Math.max(0, exitDist);
}

/**
 * 落位/保留格评分：pathCover 为主，并按「射程 + 离出怪口 + 离路」综合。
 * 短射程更看重近出口、贴路；长射程相对更吃覆盖。
 */
export const MERGE_EXIT_WEIGHT = 1;

/** 出口权重随射程放大：刀(rge1) > 枪(2) > 弓(3) */
export function placeExitWeight(rge: number): number {
  return MERGE_EXIT_WEIGHT * (1 + 0.6 * Math.max(0, 3 - rge));
}

/**
 * 座位综合分（越高越优先）。
 * @param pathDist 离路距离：短兵略偏好更近（仍须在射程内才可选）
 */
export function seatScore(
  pathCover: number,
  exitDist: number,
  pathDist: number,
  rge: number,
): number {
  const exitW = placeExitWeight(rge);
  const pathW = 0.4 * Math.max(0.4, 3.5 - rge);
  return pathCover - exitW * Math.max(0, exitDist) - pathW * Math.max(0, pathDist);
}

/** 棋盘合保留：不计离路细项时的简化分（兼容旧口径） */
export function mergeKeepScore(pathCover: number, exitDist: number, rge = 2): number {
  return seatScore(pathCover, exitDist, 0, rge);
}

/** 落位评分：默认 rge=2；传入 pathDist/rge 时与 seatScore 同口径 */
export function placeCellScore(
  pathCover: number,
  exitDist: number,
  rge = 2,
  pathDist = 0,
): number {
  return seatScore(pathCover, exitDist, pathDist, rge);
}

/** 单字落位：远离路径、靠近唐僧（分越高越好）；不追贴出口 */
export const SINGLE_WORD_PATH_WEIGHT = 1;
export const SINGLE_WORD_TANG_WEIGHT = 1.25;

export function singleWordScore(pathDist: number, tangDist: number): number {
  return SINGLE_WORD_PATH_WEIGHT * pathDist - SINGLE_WORD_TANG_WEIGHT * Math.max(0, tangDist);
}

/**
 * 激活武将双格座位分：以路径覆盖为主（射程内能打到路即可），
 * 不奖励贴出怪口——贴口留给普通兵，避免武将堵在闸门旁。
 */
export function heroSeatScore(pathCover: number, pathDist = 0): number {
  return pathCover - 0.05 * Math.max(0, pathDist);
}

/** 危险时座位加分：沿路径更靠唐僧(exitDist↑) + 欧氏更贴唐僧(tangsengDist↓) */
export const DANGER_EXIT_WEIGHT = 2;
export const DANGER_TANG_WEIGHT = 1.5;

export function dangerSeatBonus(exitDist: number, tangsengDist: number): number {
  return DANGER_EXIT_WEIGHT * Math.max(0, exitDist) - DANGER_TANG_WEIGHT * Math.max(0, tangsengDist);
}

/** 怪物即将路过路段：从最靠前怪起向前 lookahead、略向后 lookback（格） */
export const IMMINENT_LOOKAHEAD = 4;
export const IMMINENT_LOOKBACK = 1;
export const IMMINENT_DIG_WEIGHT = 8;
export const IMMINENT_PLACE_WEIGHT = 3;

/**
 * 格对 imminent 路段的贴近分（越高越好）。
 * 采样最靠前怪附近路径点，欧氏越近、越靠近怪头分越高。
 */
export function imminentPathScore(
  path: { c: number; r: number }[],
  pathLen: number,
  entranceDist: number,
  monsterDists: number[],
  cell: Cell,
  opts?: { lookahead?: number; lookback?: number },
): number {
  if (monsterDists.length === 0 || pathLen <= entranceDist) return 0;
  const front = Math.max(...monsterDists);
  const lookAhead = opts?.lookahead ?? IMMINENT_LOOKAHEAD;
  const lookBack = opts?.lookback ?? IMMINENT_LOOKBACK;
  const zoneStart = Math.max(entranceDist, front - lookBack);
  const zoneEnd = Math.min(pathLen, front + lookAhead);
  const span = Math.max(0.01, zoneEnd - zoneStart);
  const step = 0.25;
  let best = 0;
  for (let d = zoneStart; d <= zoneEnd; d += step) {
    const p = posAlong(path, d);
    const euclid = Math.hypot(cell.c - p.c, cell.r - p.r);
    const alongBias = 1 + 0.2 * (1 - Math.abs(d - front) / span);
    const prox = alongBias / (1 + euclid);
    if (prox > best) best = prox;
  }
  return best;
}

/** 危险布阵/调位加分：有怪时用 imminent 路段，否则回退靠唐僧启发 */
export function dangerPlacementBonus(
  imminentScore: number,
  exitDist: number,
  tangsengDist: number,
): number {
  if (imminentScore > 0) return IMMINENT_PLACE_WEIGHT * imminentScore;
  return dangerSeatBonus(exitDist, tangsengDist);
}

function cellKey(c: Cell): string { return `${c.c},${c.r}`; }
function sameCell(a: Cell, b: Cell): boolean { return a.c === b.c && a.r === b.r; }

/** 两字能否按序组成武将（与 activeGenerals 的 matchGeneral 口径一致） */
function pairDefForChars(a: string, b: string) {
  return matchGeneral(a, b) ?? matchGeneral(b, a);
}

/** 解析可激活字对：优先 matchGeneral，否则回退 token 上的 general（测试/同将 hint） */
function resolveHeroPair(
  charA: string,
  charB: string,
  view: AutoPlaceView,
  generalHint?: string,
): { chars: readonly [string, string]; general: string } | undefined {
  const def = pairDefForChars(charA, charB);
  if (def) return { chars: def.chars, general: def.id };
  if (generalHint) {
    const chars = view.wordChars(generalHint);
    if (chars && chars.includes(charA) && chars.includes(charB) && charA !== charB) {
      return { chars, general: generalHint };
    }
  }
  return undefined;
}

function isCharPartner(charA: string, charB: string, view: AutoPlaceView, generalHint?: string): boolean {
  return !!resolveHeroPair(charA, charB, view, generalHint);
}

/** 下一步调整是否为「补英雄另一半字」：tray↔棋盘配对、棋盘两字合对、tray 内成对 */
export function aiHeroPartnerAdjustPending(view: AutoPlaceView): boolean {
  const orphans = view.placedWords().filter((w) => !view.isActiveHeroCell(w.cell));
  const tray = view.tray();

  for (const w of orphans) {
    for (const t of tray) {
      if (t.kind !== 'word') continue;
      if (resolveHeroPair(w.char, t.char, view, w.general === t.general ? w.general : undefined)) return true;
    }
  }

  for (let i = 0; i < orphans.length; i++) {
    for (let j = i + 1; j < orphans.length; j++) {
      const def = pairDefForChars(orphans[i]!.char, orphans[j]!.char);
      if (!def) continue;
      const left =
        orphans[i]!.char === def.chars[0] ? orphans[i]!
        : orphans[j]!.char === def.chars[0] ? orphans[j]!
        : null;
      const right =
        orphans[i]!.char === def.chars[1] ? orphans[i]!
        : orphans[j]!.char === def.chars[1] ? orphans[j]!
        : null;
      if (!left || !right) continue;
      if (!sameCell(right.cell, { c: left.cell.c + 1, r: left.cell.r })) return true;
    }
  }

  for (let i = 0; i < tray.length; i++) {
    const a = tray[i]!;
    if (a.kind !== 'word') continue;
    for (let j = i + 1; j < tray.length; j++) {
      const b = tray[j]!;
      if (b.kind !== 'word') continue;
      if (resolveHeroPair(a.char, b.char, view, a.general === b.general ? a.general : undefined)) return true;
    }
  }

  return false;
}

export function planAutoPlace(view: AutoPlaceView, opts: AutoPlaceOpts): void {
  planAutoPlaceSteps(view, opts);
}

/** 执行至多 maxSteps 步布阵；返回实际步数 */
export function planAutoPlaceSteps(view: AutoPlaceView, opts: AutoPlaceOpts): number {
  const tol = opts.rangeTolerance ?? 0.5;
  const pSub = opts.pSubOptimal ?? 0;
  const subopt = () => pSub > 0 && opts.rng() < pSub;
  const maxSteps = opts.maxSteps ?? Infinity;
  let guard = 0;
  let steps = 0;
  while (guard++ < 500 && steps < maxSteps) {
    if (!step()) break;
    steps++;
  }

  /** 某兵种在某格的座位分：覆盖 + 近出口(按射程) + 离路；危险时追加靠唐僧加权 */
  function scoreCell(cell: Cell, type: UnitType, tier: number): number {
    const rge = getUnitStat(type, tier).rge;
    let s = seatScore(
      view.pathCover(cell, type, tier),
      view.exitDist(cell),
      view.nearestPathDist(cell),
      rge,
    );
    if (view.dangerNear()) {
      s += dangerPlacementBonus(
        view.imminentPathScore(cell),
        view.exitDist(cell),
        view.tangsengDist(cell),
      );
    }
    return s;
  }

  /** 可达格中选座位分最高者（短兵先占位，避免远程抢近路甜区） */
  function pickReachCell(reach: Cell[], type: UnitType, tier: number): Cell {
    return reach.reduce((best, c) => (scoreCell(c, type, tier) > scoreCell(best, type, tier) ? c : best), reach[0]!);
  }

  function step(): boolean {
    const tray = view.tray();
    // 1) 铲子：平时挖贴路+近出口；危险时优先挖靠近唐僧的格
    for (let i = 0; i < tray.length; i++) {
      if (tray[i]!.kind !== 'shovel') continue;
      const exitW = view.dangerNear()
        ? 0
        : opts.randomDigExitWeight
          ? DIG_EXIT_WEIGHT_AI_MIN + opts.rng() * (DIG_EXIT_WEIGHT_AI_MAX - DIG_EXIT_WEIGHT_AI_MIN)
          : DIG_EXIT_WEIGHT;
      const digs = sortedDigTargets(exitW);
      if (digs.length === 0) continue; // 无处可挖：保留，扫下一个
      const cell = subopt() && digs.length > 1 ? digs[1 + Math.floor(opts.rng() * (digs.length - 1))]! : digs[0]!;
      if (view.place(i, cell)) return true;
    }
    // 2a0) 同字高阶上板：tray 更高阶与棋盘低阶孤儿互换
    if (!subopt() && tryPromoteHigherTierWords()) return true;
    // 2a) 棋盘孤儿字：两字已在场但未相邻 → 优先迁到最优对位激活（如「梵+音」「大+蟒」）
    if (!subopt() && tryPairBoardOrphans()) return true;
    // 2b) 字牌激活：能配对则按武将座位分选双格（可挪武器）；先不单放，留给回收步骤用 tray
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'word') continue;
      if (tryActivateTrayWord(i, t)) return true;
    }
    // 2c) 重复孤儿只留最高阶：低阶用 tray 异字换回候选区
    if (!subopt() && tryEjectLowerDuplicateOrphans()) return true;
    // 2d) 单字落位：远离路径、靠近唐僧（棋盘已有同字则留 tray）
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'word') continue;
      if (view.placedWords().some((w) => w.char === t.char)) continue;
      if (placeSingleWord(i)) return true;
    }
    // 3) 兵种合成：同型同阶 → 合成升阶（"合成英雄"/升级武器）
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'unit') continue;
      const mate = view.placedUnits().find((u) => u.type === t.type && u.tier === t.tier);
      if (mate && !subopt()) { if (view.place(i, mate.cell)) return true; }
    }
    // 4) 射程感知铺格：短射程先占位；各自在可达格中选 pathCover（+近出口）最大的格。
    const free = view.freeCells();
    const unitIdx = tray
      .map((t, i) => ({ t, i }))
      .filter((x): x is { t: Extract<PlaceToken, { kind: 'unit' }>; i: number } => x.t.kind === 'unit')
      .sort((a, b) => getUnitStat(a.t.type, a.t.tier).rge - getUnitStat(b.t.type, b.t.tier).rge);
    for (const { t, i } of unitIdx) {
      const rge = getUnitStat(t.type, t.tier).rge;
      const reach = free.filter((c) => view.nearestPathDist(c) <= rge + tol);
      if (reach.length === 0) continue;
      const cell = subopt()
        ? reach[Math.floor(opts.rng() * reach.length)]!
        : pickReachCell(reach, t.type, t.tier);
      if (view.place(i, cell)) return true;
    }
    // 5) 救援式重排（保守）：某短兵无可达空格，而有射程≥它的已上场兵占着它可达的近格，
    //    且该占位兵能挪到更远的可达空格 → 挪走占位兵、腾出近格给短兵。尽量少扰动现有布局。
    for (const { t, i } of unitIdx) {
      const rge = getUnitStat(t.type, t.tier).rge;
      if (free.some((c) => view.nearestPathDist(c) <= rge + tol)) continue; // 该短兵本有位（理论上步4已放），跳过
      for (const occ of view.placedUnits()) {
        if (view.nearestPathDist(occ.cell) > rge + tol) continue; // 占位兵不在短兵可达格，挪它无益
        const occRge = getUnitStat(occ.type, occ.tier).rge;
        if (occRge < rge) continue; // 只把射程≥的兵往外挪（更适合远格）
        let dest: Cell | undefined;
        let destScore = -Infinity;
        for (const c of free) {
          if (view.nearestPathDist(c) > occRge + tol) continue; // 占位兵够不着
          if (view.nearestPathDist(c) <= rge + tol) continue;   // 别又占短兵能用的近格
          const sc = scoreCell(c, occ.type, occ.tier);
          if (!dest || sc > destScore) { dest = c; destScore = sc; }
        }
        if (dest && view.moveUnit(occ.cell, dest)) {
          view.place(i, occ.cell); // 腾出的近格放短兵
          return true;
        }
      }
    }
    // 5b) 高阶同型抢座：若低阶同类占着 placeCellScore 更高的格，与高阶交换
    if (!subopt() && trySwapHigherTierToBetterSeats()) return true;
    // 5c) 空位更优则迁座：新挖出的近出口/高覆盖空格，把已上场兵迁过去（如枪迁到贴口空位）
    if (!subopt() && tryRelocateToBetterFreeSeats()) return true;
    // 5d) 未激活孤儿字让出高覆盖攻位给兵器（红/沙/骨不占前线）
    if (!subopt() && tryYieldOrphanSeatsToUnits()) return true;
    // 5e) 孤儿字迁到更远离路径/靠唐僧的空位
    if (!subopt() && tryRelocateOrphansToRear()) return true;
    // 6–7) 地图槽位已满：先 tray 内合再上棋盘合；否则棋盘同阶合腾位再落子
    if (view.freeCells().length === 0) {
      if (tryTrayMergeOntoBoard()) return true;
      if (tryBoardMergeThenPlace()) return true;
    }
    return false; // 无可推进动作
  }

  /**
   * 同型异阶：高阶单位若当前格评分低于某低阶同类所在格（按高阶自身 pathCover 计），则交换。
   * 合成升阶后让高阶占输出更好的座位。
   */
  function trySwapHigherTierToBetterSeats(): boolean {
    const units = view.placedUnits();
    let best: { hi: PlacedUnitLite; lo: PlacedUnitLite; gain: number } | null = null;
    for (let i = 0; i < units.length; i++) {
      const hi = units[i]!;
      for (let j = 0; j < units.length; j++) {
        if (i === j) continue;
        const lo = units[j]!;
        if (hi.type !== lo.type || hi.tier <= lo.tier) continue;
        const rge = getUnitStat(hi.type, hi.tier).rge;
        // 互换后双方仍须够得着路（同型射程通常相同，仍做校验）
        if (view.nearestPathDist(lo.cell) > rge + tol) continue;
        if (view.nearestPathDist(hi.cell) > getUnitStat(lo.type, lo.tier).rge + tol) continue;
        const scoreNow = scoreCell(hi.cell, hi.type, hi.tier);
        const scoreBetter = scoreCell(lo.cell, hi.type, hi.tier);
        const gain = scoreBetter - scoreNow;
        if (gain <= 0) continue;
        if (!best || gain > best.gain) best = { hi, lo, gain };
      }
    }
    if (!best) return false;
    return view.swapUnits(best.hi.cell, best.lo.cell);
  }

  /**
   * 已上场单位迁到座位分更高的空位（结合射程、离出怪口、离路）。
   * 只往更好处迁；同收益优先短射程。
   */
  function tryRelocateToBetterFreeSeats(): boolean {
    const free = view.freeCells();
    if (free.length === 0) return false;
    let best: { from: Cell; to: Cell; gain: number; rge: number } | null = null;
    for (const u of view.placedUnits()) {
      const rge = getUnitStat(u.type, u.tier).rge;
      const scoreNow = scoreCell(u.cell, u.type, u.tier);
      for (const c of free) {
        if (view.nearestPathDist(c) > rge + tol) continue;
        const score = scoreCell(c, u.type, u.tier);
        const gain = score - scoreNow;
        if (gain <= 0.05) continue;
        if (
          !best ||
          gain > best.gain + 1e-9 ||
          (Math.abs(gain - best.gain) <= 1e-9 && rge < best.rge)
        ) {
          best = { from: u.cell, to: c, gain, rge };
        }
      }
    }
    if (!best) return false;
    return view.moveUnit(best.from, best.to);
  }

  /**
   * 未激活孤儿字占着兵器更高座位分的格 → 与该兵交换。
   * 字牌本身不输出，不应堵在贴路/高覆盖前线（如「红」「沙」「骨」）。
   */
  function tryYieldOrphanSeatsToUnits(): boolean {
    let best: { unit: PlacedUnitLite; orphan: PlacedWordLite; gain: number } | null = null;
    for (const orphan of orphanWords()) {
      for (const u of view.placedUnits()) {
        if (view.isActiveHeroCell(u.cell)) continue;
        const rge = getUnitStat(u.type, u.tier).rge;
        if (view.nearestPathDist(orphan.cell) > rge + tol) continue;
        const gain = scoreCell(orphan.cell, u.type, u.tier) - scoreCell(u.cell, u.type, u.tier);
        if (gain <= 0.15) continue;
        if (!best || gain > best.gain) best = { unit: u, orphan, gain };
      }
    }
    if (!best) return false;
    return view.swapUnitWord(best.unit.cell, best.orphan.cell);
  }

  /** 孤儿字迁到 singleWordScore 更高的空位（远离路径、靠唐僧） */
  function tryRelocateOrphansToRear(): boolean {
    const free = view.freeCells();
    if (free.length === 0) return false;
    let best: { from: Cell; to: Cell; gain: number } | null = null;
    for (const w of orphanWords()) {
      const cur = singleWordScore(view.nearestPathDist(w.cell), view.tangsengDist(w.cell));
      for (const c of free) {
        const sc = singleWordScore(view.nearestPathDist(c), view.tangsengDist(c));
        const gain = sc - cur;
        if (gain <= 0.15) continue;
        if (!best || gain > best.gain) best = { from: w.cell, to: c, gain };
      }
    }
    if (!best) return false;
    return view.moveWord(best.from, best.to);
  }

  /** 可挖格：离路~1格优先，贴边数弱加权；平时叠加近出口，危险时改优先靠近唐僧 */
  function sortedDigTargets(exitWeight: number = DIG_EXIT_WEIGHT): Cell[] {
    const danger = view.dangerNear();
    return view.diggableCells().slice().sort((a, b) => {
      const sa = digPriorityScore(
        view.pathTouchSides(a),
        view.nearestPathDist(a),
        view.exitDist(a),
        exitWeight,
        danger ? { danger: true, imminentScore: view.imminentPathScore(a), tangsengDist: view.tangsengDist(a) } : undefined,
      );
      const sb = digPriorityScore(
        view.pathTouchSides(b),
        view.nearestPathDist(b),
        view.exitDist(b),
        exitWeight,
        danger ? { danger: true, imminentScore: view.imminentPathScore(b), tangsengDist: view.tangsengDist(b) } : undefined,
      );
      return sa - sb || a.r - b.r || a.c - b.c;
    });
  }

  function unlockedCells(): Cell[] {
    const m = new Map<string, Cell>();
    for (const c of view.freeCells()) m.set(cellKey(c), c);
    for (const u of view.placedUnits()) m.set(cellKey(u.cell), u.cell);
    for (const w of view.placedWords()) m.set(cellKey(w.cell), w.cell);
    return [...m.values()];
  }

  function heroPairScore(left: Cell, right: Cell, general: string, tier: number): number {
    const ax = (left.c + right.c) / 2;
    const ay = (left.r + right.r) / 2;
    const rge = view.generalRge(general, tier);
    const cover = view.pathCoverAt(ax, ay, rge);
    const pathD = (view.nearestPathDist(left) + view.nearestPathDist(right)) / 2;
    return heroSeatScore(cover, pathD);
  }

  /** 枚举已解锁的左右相邻格对，按武将输出分降序 */
  function rankedHeroPairs(general: string, tier: number): { left: Cell; right: Cell; score: number }[] {
    const cells = unlockedCells();
    const byKey = new Map(cells.map((c) => [cellKey(c), c]));
    const out: { left: Cell; right: Cell; score: number }[] = [];
    for (const left of cells) {
      const right = byKey.get(`${left.c + 1},${left.r}`);
      if (!right) continue;
      out.push({ left, right, score: heroPairScore(left, right, general, tier) });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /**
   * 把 cell 上的普通武器挪到 reserved 之外的空格（优先可达且 placeCellScore 高）。
   * extraFree：额外可用落点（例如伴侣即将腾出的旧格）。
   */
  function clearUnitFrom(cell: Cell, reserved: Set<string>, extraFree: Cell[] = []): boolean {
    if (view.placedWords().some((w) => sameCell(w.cell, cell))) return false;
    const u = view.placedUnits().find((x) => sameCell(x.cell, cell));
    if (!u) return true;
    const free = [
      ...view.freeCells().filter((c) => !reserved.has(cellKey(c)) && !sameCell(c, cell)),
      ...extraFree.filter((c) => !reserved.has(cellKey(c)) && !sameCell(c, cell)),
    ];
    // 去重
    const seen = new Set<string>();
    const uniq = free.filter((c) => {
      const k = cellKey(c);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const rge = getUnitStat(u.type, u.tier).rge;
    const inRange = uniq.filter((c) => view.nearestPathDist(c) <= rge + tol);
    const pool = inRange.length > 0 ? inRange : uniq;
    if (pool.length === 0) return false;
    const dest = pickReachCell(pool, u.type, u.tier);
    return view.moveUnit(u.cell, dest);
  }

  /** 挪开孤儿字（不拆已激活武将）；落点按单字偏好 */
  function clearOrphanWordFrom(cell: Cell, reserved: Set<string>, extraFree: Cell[] = []): boolean {
    const w = wordAt(cell);
    if (!w) return true;
    if (view.isActiveHeroCell(cell)) return false;
    const free = [
      ...view.freeCells().filter((c) => !reserved.has(cellKey(c)) && !sameCell(c, cell)),
      ...extraFree.filter((c) => !reserved.has(cellKey(c)) && !sameCell(c, cell)),
    ];
    const seen = new Set<string>();
    const uniq = free.filter((c) => {
      const k = cellKey(c);
      if (seen.has(k)) return false;
      seen.add(k);
      return !wordAt(c) && !view.placedUnits().some((u) => sameCell(u.cell, c));
    });
    if (uniq.length === 0) return false;
    const dest = uniq.reduce((best, c) => {
      const s = singleWordScore(view.nearestPathDist(c), view.tangsengDist(c));
      const bs = singleWordScore(view.nearestPathDist(best), view.tangsengDist(best));
      return s > bs ? c : best;
    }, uniq[0]!);
    return view.moveWord(w.cell, dest);
  }

  /**
   * 为激活武将腾格：空→成功；武器/孤儿→优先挪到空位，满盘则顶回候选区；已激活英雄格→失败。
   * allowMate：该格上的伴侣字可保留（即将迁走或已在位）。
   */
  function clearForHero(
    cell: Cell,
    reserved: Set<string>,
    allowMate: PlacedWordLite | null,
    extraFree: Cell[] = [],
  ): boolean {
    const w = wordAt(cell);
    if (w) {
      // 仅当目标格上就是指定伴侣实例时保留（避免重复同字误判）
      if (allowMate && sameCell(cell, allowMate.cell)) return true;
      if (view.isActiveHeroCell(cell)) return false;
      if (clearOrphanWordFrom(cell, reserved, extraFree)) return true;
      return view.displaceToTray(cell);
    }
    if (clearUnitFrom(cell, reserved, extraFree)) return true;
    // 有兵但无处可挪：顶回候选区
    if (view.placedUnits().some((u) => sameCell(u.cell, cell))) return view.displaceToTray(cell);
    return true;
  }

  function wordAt(cell: Cell): PlacedWordLite | undefined {
    return view.placedWords().find((w) => sameCell(w.cell, cell));
  }

  function wordTier(w: { tier?: number }): number {
    return w.tier ?? 1;
  }

  function orphanWords(): PlacedWordLite[] {
    return view.placedWords().filter((w) => !view.isActiveHeroCell(w.cell));
  }

  /** 未激活孤儿中可与 char 配对者，优先最高阶 */
  function pickBestBoardMate(char: string, generalHint?: string): PlacedWordLite | null {
    let best: PlacedWordLite | null = null;
    for (const w of orphanWords()) {
      if (!isCharPartner(char, w.char, view, generalHint && w.general === generalHint ? generalHint : undefined)) continue;
      if (!best || wordTier(w) > wordTier(best)) best = w;
    }
    return best;
  }

  /** tray 更高阶同字 ↔ 棋盘更低阶孤儿（不碰已激活武将格） */
  function tryPromoteHigherTierWords(): boolean {
    const tray = view.tray();
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!;
      if (t.kind !== 'word') continue;
      let target: PlacedWordLite | null = null;
      for (const w of orphanWords()) {
        if (w.char !== t.char) continue;
        if (wordTier(w) >= t.tier) continue;
        if (view.isActiveHeroCell(w.cell)) continue;
        if (!target || wordTier(w) < wordTier(target)) target = w;
      }
      if (target && !view.isActiveHeroCell(target.cell) && view.place(i, target.cell)) return true;
    }
    return false;
  }

  /**
   * 棋盘同字只留最高阶：统计时含已激活格上的字（用于识别重复），
   * 但换下目标只能是未激活孤儿——绝不拆散已激活武将。
   */
  function tryEjectLowerDuplicateOrphans(): boolean {
    const byChar = new Map<string, PlacedWordLite[]>();
    for (const w of view.placedWords()) {
      const list = byChar.get(w.char) ?? [];
      list.push(w);
      byChar.set(w.char, list);
    }
    const expendable: PlacedWordLite[] = [];
    for (const list of byChar.values()) {
      if (list.length < 2) continue;
      // 保留：最高阶；同阶优先已激活
      list.sort((a, b) => {
        const td = wordTier(b) - wordTier(a);
        if (td !== 0) return td;
        return (view.isActiveHeroCell(b.cell) ? 1 : 0) - (view.isActiveHeroCell(a.cell) ? 1 : 0);
      });
      for (let k = 1; k < list.length; k++) {
        const w = list[k]!;
        // 已激活武将任一格都不可作为回收目标
        if (view.isActiveHeroCell(w.cell)) continue;
        expendable.push(w);
      }
    }
    if (expendable.length === 0) return false;
    expendable.sort((a, b) => wordTier(a) - wordTier(b));

    for (const junk of expendable) {
      // 双重守卫：place 前再确认目标仍非激活格
      if (view.isActiveHeroCell(junk.cell)) continue;
      const tray = view.tray();
      let bestIdx = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < tray.length; i++) {
        const t = tray[i]!;
        if (t.kind !== 'word') continue;
        if (t.char === junk.char) continue;
        let score = t.tier;
        const hasBoardMate = orphanWords().some(
          (w) =>
            !sameCell(w.cell, junk.cell) &&
            isCharPartner(t.char, w.char, view, t.general === w.general ? t.general : undefined),
        );
        const hasTrayMate = tray.some(
          (x, j) =>
            j !== i &&
            x.kind === 'word' &&
            isCharPartner(t.char, x.char, view, t.general === x.general ? t.general : undefined),
        );
        if (hasBoardMate || hasTrayMate) score += 10;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) continue;
      if (view.isActiveHeroCell(junk.cell)) continue;
      if (view.place(bestIdx, junk.cell)) return true;
    }
    return false;
  }

  /** 仅尝试激活（tray 配对或最高阶棋盘伴侣）；单放见 step 2d */
  function tryActivateTrayWord(i: number, t: Extract<PlaceToken, { kind: 'word' }>): boolean {
    if (subopt()) return false;

    const tray = view.tray();
    let partnerJ = -1;
    let partnerChar: string | undefined;
    let partnerGeneral: string | undefined;
    for (let j = 0; j < tray.length; j++) {
      if (j === i) continue;
      const x = tray[j]!;
      if (x.kind === 'word' && isCharPartner(t.char, x.char, view, t.general === x.general ? t.general : undefined)) {
        partnerJ = j;
        partnerChar = x.char;
        partnerGeneral = x.general;
        break;
      }
    }
    const boardMate = pickBestBoardMate(t.char, t.general);

    const pair = boardMate
      ? resolveHeroPair(t.char, boardMate.char, view, t.general === boardMate.general ? t.general : undefined)
      : partnerChar
        ? resolveHeroPair(t.char, partnerChar, view, t.general === partnerGeneral ? t.general : undefined)
        : undefined;
    if (pair && (boardMate || partnerJ >= 0)) {
      return tryActivateHero(i, t, pair.chars, pair.general, boardMate, partnerJ);
    }
    return false;
  }

  /** 棋盘上已有可配对两字但未相邻 → 迁到 pathCover 最高的左右邻格对（同覆盖偏好更高阶） */
  function tryPairBoardOrphans(): boolean {
    const orphans = orphanWords();
    type Cand = { left: PlacedWordLite; right: PlacedWordLite; general: string; score: number; tierSum: number };
    let best: Cand | null = null;

    for (let i = 0; i < orphans.length; i++) {
      for (let j = i + 1; j < orphans.length; j++) {
        const a = orphans[i]!;
        const b = orphans[j]!;
        const def = pairDefForChars(a.char, b.char);
        if (!def) continue;
        const left = a.char === def.chars[0] ? a : b.char === def.chars[0] ? b : null;
        const right = a.char === def.chars[1] ? a : b.char === def.chars[1] ? b : null;
        if (!left || !right) continue;
        if (sameCell(right.cell, { c: left.cell.c + 1, r: left.cell.r })) continue;

        const tier = Math.max(wordTier(left), wordTier(right));
        const pairs = rankedHeroPairs(def.id, tier);
        if (pairs.length === 0) continue;
        const score = pairs[0]!.score;
        const tierSum = wordTier(left) + wordTier(right);
        if (!best || score > best.score || (score === best.score && tierSum > best.tierSum)) {
          best = { left, right, general: def.id, score, tierSum };
        }
      }
    }
    if (!best) return false;
    return moveBoardPairToActivate(best.left, best.right, best.general);
  }

  /** 按原格定位；若已挪走则取同字最高阶实例 */
  function resolveTrackedWord(ref: PlacedWordLite): PlacedWordLite | undefined {
    const at = wordAt(ref.cell);
    if (at && at.char === ref.char) return at;
    let best: PlacedWordLite | undefined;
    for (const w of view.placedWords()) {
      if (w.char !== ref.char) continue;
      if (!best || wordTier(w) > wordTier(best)) best = w;
    }
    return best;
  }

  function moveBoardPairToActivate(leftW: PlacedWordLite, rightW: PlacedWordLite, general: string): boolean {
    const tier = Math.max(wordTier(leftW), wordTier(rightW));
    for (const { left, right } of rankedHeroPairs(general, tier)) {
      if (view.isActiveHeroCell(left) || view.isActiveHeroCell(right)) continue;
      const reserved = new Set([cellKey(left), cellKey(right)]);

      const lw0 = resolveTrackedWord(leftW);
      const rw0 = resolveTrackedWord(rightW);
      if (!lw0 || !rw0) return false;
      if (!clearForHero(left, reserved, sameCell(lw0.cell, left) ? lw0 : null)) continue;
      if (!clearForHero(right, reserved, sameCell(rw0.cell, right) ? rw0 : null)) continue;

      const lw = resolveTrackedWord(leftW);
      const rw = resolveTrackedWord(rightW);
      if (!lw || !rw) continue;
      if (!sameCell(lw.cell, left) && !view.moveWord(lw.cell, left)) continue;
      const rw2 = resolveTrackedWord(rightW);
      if (!rw2) continue;
      if (!sameCell(rw2.cell, right) && !view.moveWord(rw2.cell, right)) continue;
      return true;
    }
    return false;
  }

  /** 单字：远离路径 + 靠近唐僧 */
  function placeSingleWord(i: number): boolean {
    const free = view.freeCells();
    if (free.length === 0) return false;
    const cell = free.reduce((best, c) => {
      const s = singleWordScore(view.nearestPathDist(c), view.tangsengDist(c));
      const bs = singleWordScore(view.nearestPathDist(best), view.tangsengDist(best));
      return s > bs ? c : best;
    }, free[0]!);
    return view.place(i, cell);
  }

  /**
   * 激活武将：按 placeCellScore 选最优左右邻格；
   * 可挪普通武器与孤儿字腾位，但绝不拆散其他已激活英雄。
   */
  function tryActivateHero(
    _trayI: number,
    t: Extract<PlaceToken, { kind: 'word' }>,
    chars: readonly [string, string],
    general: string,
    boardMate: PlacedWordLite | null,
    partnerJ: number,
  ): boolean {
    const tier = Math.max(t.tier, boardMate?.tier ?? t.tier);
    const pairs = rankedHeroPairs(general, tier);
    // 棋盘伴侣已在正确左/右位时优先原地凑对（少迁座、满盘也能换）
    if (boardMate) {
      const mateIsLeftChar = boardMate.char === chars[0];
      pairs.sort((a, b) => {
        const fit = (p: { left: Cell; right: Cell }) =>
          sameCell(boardMate.cell, mateIsLeftChar ? p.left : p.right) ? 1 : 0;
        const d = fit(b) - fit(a);
        return d !== 0 ? d : b.score - a.score;
      });
    }

    for (const { left, right } of pairs) {
      // —— 候选区已有配对字：两字一起落到最优对 ——
      if (!boardMate && partnerJ >= 0) {
        const reserved = new Set([cellKey(left), cellKey(right)]);
        if (view.isActiveHeroCell(left) || view.isActiveHeroCell(right)) continue;
        clearForHero(left, reserved, null);
        clearForHero(right, reserved, null);
        const leftChar = chars[0];
        const rightChar = chars[1];
        const trayNow = view.tray();
        const leftIdx = trayNow.findIndex((x) => x.kind === 'word' && x.char === leftChar);
        const rightIdx0 = trayNow.findIndex((x) => x.kind === 'word' && x.char === rightChar);
        if (leftIdx < 0 || rightIdx0 < 0) continue;
        if (!view.place(leftIdx, left)) continue;
        const trayAfter = view.tray();
        const rightIdx = trayAfter.findIndex((x) => x.kind === 'word' && x.char === rightChar);
        if (rightIdx < 0) return true;
        if (view.place(rightIdx, right)) return true;
        return true;
      }

      // —— 棋盘已有伴侣：迁到评分最高的对位（不拆其他英雄），再落 tray 字 ——
      if (boardMate) {
        const mateIsLeftChar = boardMate.char === chars[0];
        if (mateIsLeftChar && t.char !== chars[1]) continue;
        if (!mateIsLeftChar && t.char !== chars[0]) continue;
        const needMate = mateIsLeftChar ? left : right;
        const needTray = mateIsLeftChar ? right : left;

        // 目标对占用其他已激活英雄 → 跳过
        if (view.isActiveHeroCell(needMate) && !sameCell(boardMate.cell, needMate)) continue;
        if (view.isActiveHeroCell(needTray)) continue;

        const reserved = new Set([cellKey(needMate), cellKey(needTray)]);
        const mateOld = { ...boardMate.cell };
        const mateAlreadySeated = sameCell(boardMate.cell, needMate);

        // 1) 腾伴侣目标格并迁座（已在位则跳过）
        if (!mateAlreadySeated) {
          if (!clearForHero(needMate, reserved, null)) continue;
          const mateNow = resolveTrackedWord(boardMate);
          if (!mateNow) continue;
          if (!view.moveWord(mateNow.cell, needMate)) continue;
        }
        // 2) 落 tray 字：优先挪开占位，满盘挪不开时直接 place（与孤儿/兵交换）
        clearForHero(needTray, reserved, null, [mateOld]);
        const idx = view.tray().findIndex(
          (x) => x.kind === 'word' && x.char === t.char && x.tier === t.tier,
        );
        if (idx < 0) continue;
        if (view.place(idx, needTray)) return true;
      }
    }
    return false;
  }

  /**
   * 满槽：tray 内有同型同阶可合，且合后（升一阶）能在棋盘上找到同型同阶再合 →
   * 先 tray 合成，再落到棋盘合。
   */
  function tryTrayMergeOntoBoard(): boolean {
    if (subopt()) return false;
    const tray = view.tray();
    for (let i = 0; i < tray.length; i++) {
      const a = tray[i]!;
      if (a.kind !== 'unit') continue;
      for (let j = i + 1; j < tray.length; j++) {
        const b = tray[j]!;
        if (b.kind !== 'unit') continue;
        if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) continue;
        const upTier = a.tier + 1;
        const mate = view.placedUnits().find((u) => u.type === a.type && u.tier === upTier);
        if (!mate) continue;
        // 合到棋盘还要求升阶后未满级（canMerge 同阶 < MAX）
        if (!canMerge({ type: a.type, tier: upTier }, { type: mate.type, tier: mate.tier })) continue;
        // mergeTray 会 splice 掉 from；to 在 from 之后时下标前移 1
        if (!view.mergeTray(i, j)) continue;
        const upIdx = i < j ? j - 1 : j;
        if (view.place(upIdx, mate.cell)) return true;
        return true; // tray 已合，即使 place 失败也算推进（避免死循环重合）
      }
    }
    return false;
  }

  /**
   * 满槽且 tray 无「合后再上棋盘」：在棋盘找同型同阶合，
   * 保留格按 pathCover + 近出口加权（mergeKeepScore）取高；腾出另一格后从 tray 放武器。
   */
  function tryBoardMergeThenPlace(): boolean {
    if (subopt()) return false;
    const placed = view.placedUnits();
    let best: { drop: Cell; keep: Cell; keepScore: number } | null = null;
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i]!;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j]!;
        if (!canMerge({ type: a.type, tier: a.tier }, { type: b.type, tier: b.tier })) continue;
        const scoreA = mergeKeepScore(
          view.pathCover(a.cell, a.type, a.tier),
          view.exitDist(a.cell),
          getUnitStat(a.type, a.tier).rge,
        );
        const scoreB = mergeKeepScore(
          view.pathCover(b.cell, b.type, b.tier),
          view.exitDist(b.cell),
          getUnitStat(b.type, b.tier).rge,
        );
        const keep = scoreA >= scoreB ? a : b;
        const drop = keep === a ? b : a;
        const keepScore = Math.max(scoreA, scoreB);
        if (!best || keepScore > best.keepScore) {
          best = { drop: drop.cell, keep: keep.cell, keepScore };
        }
      }
    }
    if (!best) return false;
    if (!view.mergeBoard(best.drop, best.keep)) return false;
    // 腾出的格：优先放「能打到路」的最短射程兵
    const freed = best.drop;
    const tray = view.tray();
    const candidates = tray
      .map((t, i) => ({ t, i }))
      .filter((x): x is { t: Extract<PlaceToken, { kind: 'unit' }>; i: number } => x.t.kind === 'unit')
      .filter(({ t }) => view.nearestPathDist(freed) <= getUnitStat(t.type, t.tier).rge + tol)
      .sort((a, b) => getUnitStat(a.t.type, a.t.tier).rge - getUnitStat(b.t.type, b.t.tier).rge);
    if (candidates.length > 0) {
      view.place(candidates[0]!.i, freed);
    }
    return true; // 棋盘已合（腾位），即使 tray 暂无可放也算推进
  }

  return steps;
}

/** 战中动态调位视图：依据当前存活怪群评估座位，每次至多执行一次 move/swap */
export interface BattleRepositionView {
  placedUnits(): PlacedUnitLite[];
  /** 未激活孤儿字（已激活武将格不要列入） */
  orphanWords(): PlacedWordLite[];
  freeCells(): Cell[];
  moveUnit(from: Cell, to: Cell): boolean;
  swapUnits(a: Cell, b: Cell): boolean;
  /** 兵与孤儿字换位 */
  swapUnitWord(unitCell: Cell, wordCell: Cell): boolean;
  isActiveHeroCell(cell: Cell): boolean;
  canEngage(cell: Cell, type: UnitType, tier: number): boolean;
  engageScore(cell: Cell, type: UnitType, tier: number): number;
  /** 静态座位分（pathCover/近出怪口）；无怪或字牌让位时用 */
  seatScore(cell: Cell, type: UnitType, tier: number): number;
  dangerNear(): boolean;
  exitDist(cell: Cell): number;
  tangsengDist(cell: Cell): number;
  imminentPathScore(cell: Cell): number;
}

export interface BattleRepositionOpts {
  /** 禁止对同一对格子再次 swap/move（仅挡紧邻一次，防 AI 来回抖） */
  blockedPair?: { a: Cell; b: Cell };
}

export function repositionPairKey(a: Cell, b: Cell): string {
  const ka = `${a.c},${a.r}`;
  const kb = `${b.c},${b.r}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function isBlockedPair(a: Cell, b: Cell, blocked?: { a: Cell; b: Cell }): boolean {
  if (!blocked) return false;
  return repositionPairKey(a, b) === repositionPairKey(blocked.a, blocked.b);
}

/**
 * 战中调位：前排高级武器够不着怪时，与后方低阶互换或挪到空位；
 * 亦可与未激活孤儿字换位（字牌不输出，让出攻位）。
 * 危险时优先往怪物即将路过路段调度。每次调用至多成功一次 move/swap；AI 侧兵器调位 1.5–4s 随机节流。
 */
export function planBattleReposition(
  view: BattleRepositionView,
  opts?: BattleRepositionOpts,
): { ok: boolean; pair?: { a: Cell; b: Cell } } {
  const units = view.placedUnits();
  if (units.length === 0) return { ok: false };

  const danger = view.dangerNear();
  const placementBonus = (cell: Cell) =>
    danger
      ? dangerPlacementBonus(view.imminentPathScore(cell), view.exitDist(cell), view.tangsengDist(cell))
      : 0;
  const cellValue = (cell: Cell, type: UnitType, tier: number) =>
    view.engageScore(cell, type, tier) + placementBonus(cell);

  let bestGain = 0.05;
  let bestPair: { a: Cell; b: Cell } | null = null;
  let bestAction: (() => boolean) | null = null;

  // 1) 空闲/够不着 → 能打怪的空格；危险时亦考虑更贴唐僧的空格
  for (const u of units) {
    if (view.isActiveHeroCell(u.cell)) continue;
    const curVal = cellValue(u.cell, u.type, u.tier);
    const idle = !view.canEngage(u.cell, u.type, u.tier);
    if (!idle && !danger) continue;
    for (const to of view.freeCells()) {
      const canEng = view.canEngage(to, u.type, u.tier);
      if (!canEng && (!danger || placementBonus(to) <= placementBonus(u.cell) + 0.05)) continue;
      if (!idle && !canEng) continue; // 已在打怪时不挪到够不着的格
      const gain = cellValue(to, u.type, u.tier) - curVal;
      if (gain <= bestGain) continue;
      const from = u.cell;
      if (isBlockedPair(from, to, opts?.blockedPair)) continue;
      bestGain = gain;
      bestPair = { a: from, b: to };
      bestAction = () => view.moveUnit(from, to);
    }
  }

  // 2) 互换：至少一方原先够不着、换后总威胁分更高（典型：前排高阶 ↔ 后方低阶）
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!;
      const b = units[j]!;
      if (view.isActiveHeroCell(a.cell) || view.isActiveHeroCell(b.cell)) continue;
      const before = cellValue(a.cell, a.type, a.tier) + cellValue(b.cell, b.type, b.tier);
      const after = cellValue(b.cell, a.type, a.tier) + cellValue(a.cell, b.type, b.tier);
      const gain = after - before;
      if (gain <= bestGain) continue;
      const aIdle = !view.canEngage(a.cell, a.type, a.tier);
      const bIdle = !view.canEngage(b.cell, b.type, b.tier);
      const aEngagesAfter = view.canEngage(b.cell, a.type, a.tier);
      const bEngagesAfter = view.canEngage(a.cell, b.type, b.tier);
      if (!(aIdle && aEngagesAfter) && !(bIdle && bEngagesAfter) && !(danger && gain > 0.1)) continue;
      if (isBlockedPair(a.cell, b.cell, opts?.blockedPair)) continue;
      bestGain = gain;
      bestPair = { a: a.cell, b: b.cell };
      bestAction = () => view.swapUnits(a.cell, b.cell);
    }
  }

  // 3) 兵 ↔ 未激活孤儿字：字牌让出更高威胁/座位分的格
  for (const u of units) {
    if (view.isActiveHeroCell(u.cell)) continue;
    const curEngage = cellValue(u.cell, u.type, u.tier);
    const curSeat = view.seatScore(u.cell, u.type, u.tier);
    for (const w of view.orphanWords()) {
      if (view.isActiveHeroCell(w.cell)) continue;
      if (isBlockedPair(u.cell, w.cell, opts?.blockedPair)) continue;
      const engGain = cellValue(w.cell, u.type, u.tier) - curEngage;
      const seatGain = view.seatScore(w.cell, u.type, u.tier) - curSeat;
      // 威胁分提升，或静态座位明显更好（怪在入口时也能把攻位让给射手盖出口段）
      const gain = engGain > 0.05 ? engGain : seatGain > 0.35 ? seatGain * 0.5 : 0;
      if (gain <= bestGain) continue;
      bestGain = gain;
      bestPair = { a: u.cell, b: w.cell };
      bestAction = () => view.swapUnitWord(u.cell, w.cell);
    }
  }

  if (!bestAction) return { ok: false };
  if (!bestAction()) return { ok: false };
  return { ok: true, pair: bestPair ?? undefined };
}

/** 连续调位；maxSteps=1 用于 AI 随机节流，更大值用于玩家一键布阵 */
export function runBattleReposition(view: BattleRepositionView, maxSteps = 1): number {
  let steps = 0;
  while (steps < maxSteps && planBattleReposition(view).ok) steps++;
  return steps;
}
