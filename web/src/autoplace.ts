// web/src/autoplace.ts
// 射程感知的自动布阵策略：玩家「一键布阵」与 AI 对手共用。
// 原则：绝不丢弃令牌（无处可放者留在 tray）；铲挖最优位；合成升级；按射程铺满；够不着则升级。
// 满槽时：tray 内先合再上棋盘合；或棋盘同阶合（保留 pathCover+近出口加权更高者）腾位再落子。
// 武将：激活落位按 placeCellScore 最大化，可挪开普通武器；单字优先远离路径、靠近唐僧。
// 纯逻辑：只通过 AutoPlaceView 读写宿主状态，rng 注入以便确定性测试。
import { canMerge, getUnitStat, type UnitType } from '@core';

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
  /** 把已上场字牌挪到空 to（不与其他字/兵重叠） */
  moveWord(from: Cell, to: Cell): boolean;
  /** 该格是否属于已激活武将（禁止拆散） */
  isActiveHeroCell(cell: Cell): boolean;
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
): number {
  const sides = Math.max(0, Math.min(4, Math.floor(touchSides)));
  // 贴边越多分越低；权重远小于距离档，避免「远端三边」压过「近端一边」
  const touchPart = DIG_TOUCH_WEIGHT * (4 - sides);
  return (
    DIG_DIST_WEIGHT * digPathDistPenalty(pathDist) +
    touchPart +
    Math.max(0, exitWeight) * Math.max(0, exitDist)
  );
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

/** 单字落位：远离路径、靠近唐僧（分越高越好） */
export const SINGLE_WORD_PATH_WEIGHT = 1;
export const SINGLE_WORD_TANG_WEIGHT = 1.25;

export function singleWordScore(pathDist: number, tangDist: number): number {
  return SINGLE_WORD_PATH_WEIGHT * pathDist - SINGLE_WORD_TANG_WEIGHT * Math.max(0, tangDist);
}

function cellKey(c: Cell): string { return `${c.c},${c.r}`; }
function sameCell(a: Cell, b: Cell): boolean { return a.c === b.c && a.r === b.r; }

export function planAutoPlace(view: AutoPlaceView, opts: AutoPlaceOpts): void {
  const tol = opts.rangeTolerance ?? 0.5;
  const pSub = opts.pSubOptimal ?? 0;
  const subopt = () => pSub > 0 && opts.rng() < pSub;
  let guard = 0;
  while (guard++ < 500) {
    if (!step()) break; // 一整轮找不到可执行动作 → 停（剩余令牌保留在 tray）
  }

  /** 某兵种在某格的座位分：覆盖 + 近出口(按射程) + 离路 */
  function scoreCell(cell: Cell, type: UnitType, tier: number): number {
    const rge = getUnitStat(type, tier).rge;
    return seatScore(
      view.pathCover(cell, type, tier),
      view.exitDist(cell),
      view.nearestPathDist(cell),
      rge,
    );
  }

  /** 可达格中选座位分最高者（短兵先占位，避免远程抢近路甜区） */
  function pickReachCell(reach: Cell[], type: UnitType, tier: number): Cell {
    return reach.reduce((best, c) => (scoreCell(c, type, tier) > scoreCell(best, type, tier) ? c : best), reach[0]!);
  }

  function step(): boolean {
    const tray = view.tray();
    // 1) 铲子：挖「贴路 + 近出口」加权最优格；次优时挖较后一格
    for (let i = 0; i < tray.length; i++) {
      if (tray[i]!.kind !== 'shovel') continue;
      const exitW = opts.randomDigExitWeight
        ? DIG_EXIT_WEIGHT_AI_MIN + opts.rng() * (DIG_EXIT_WEIGHT_AI_MAX - DIG_EXIT_WEIGHT_AI_MIN)
        : DIG_EXIT_WEIGHT;
      const digs = sortedDigTargets(exitW);
      if (digs.length === 0) continue; // 无处可挖：保留，扫下一个
      const cell = subopt() && digs.length > 1 ? digs[1 + Math.floor(opts.rng() * (digs.length - 1))]! : digs[0]!;
      if (view.place(i, cell)) return true;
    }
    // 2) 字牌：能激活则按武将 placeCellScore 选双格（可挪武器）；单字远离路径、靠近唐僧
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'word') continue;
      if (tryPlaceWord(i, t)) return true;
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

  /** 可挖格：离路~1格优先，贴边数弱加权，再叠加近出口（exitWeight 可由 AI 每次挖时随机） */
  function sortedDigTargets(exitWeight: number = DIG_EXIT_WEIGHT): Cell[] {
    return view.diggableCells().slice().sort((a, b) => {
      const sa = digPriorityScore(view.pathTouchSides(a), view.nearestPathDist(a), view.exitDist(a), exitWeight);
      const sb = digPriorityScore(view.pathTouchSides(b), view.nearestPathDist(b), view.exitDist(b), exitWeight);
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
    const cover = view.pathCoverAt(ax, ay, view.generalRge(general, tier));
    const exit = (view.exitDist(left) + view.exitDist(right)) / 2;
    const pathD = (view.nearestPathDist(left) + view.nearestPathDist(right)) / 2;
    const rge = view.generalRge(general, tier);
    return seatScore(cover, exit, pathD, rge);
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
   * 为激活武将腾格：空→成功；武器→挪走；孤儿字→挪走；已激活英雄格→失败。
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
      if (allowMate && w.char === allowMate.char && w.general === allowMate.general) return true;
      if (view.isActiveHeroCell(cell)) return false;
      return clearOrphanWordFrom(cell, reserved, extraFree);
    }
    return clearUnitFrom(cell, reserved, extraFree);
  }

  function wordAt(cell: Cell): PlacedWordLite | undefined {
    return view.placedWords().find((w) => sameCell(w.cell, cell));
  }

  function tryPlaceWord(i: number, t: Extract<PlaceToken, { kind: 'word' }>): boolean {
    const free = view.freeCells();
    if (free.length === 0 && view.placedUnits().length === 0 && view.placedWords().length === 0) return false;
    if (subopt()) {
      const cell = free[0];
      return !!(cell && view.place(i, cell));
    }
    const chars = view.wordChars(t.general);
    if (!chars) return placeSingleWord(i);

    const tray = view.tray();
    let partnerJ = -1;
    for (let j = 0; j < tray.length; j++) {
      if (j === i) continue;
      const x = tray[j]!;
      if (x.kind === 'word' && x.general === t.general && x.char !== t.char) {
        partnerJ = j;
        break;
      }
    }
    const boardMate = view.placedWords().find((w) => w.general === t.general && w.char !== t.char) ?? null;

    if (boardMate || partnerJ >= 0) {
      if (tryActivateHero(i, t, chars, boardMate, partnerJ)) return true;
    }
    return placeSingleWord(i);
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
    boardMate: PlacedWordLite | null,
    partnerJ: number,
  ): boolean {
    const tier = Math.max(t.tier, boardMate?.tier ?? t.tier);
    const pairs = rankedHeroPairs(t.general, tier);

    for (const { left, right } of pairs) {
      // —— 候选区已有配对字：两字一起落到最优对 ——
      if (!boardMate && partnerJ >= 0) {
        const reserved = new Set([cellKey(left), cellKey(right)]);
        if (view.isActiveHeroCell(left) || view.isActiveHeroCell(right)) continue;
        if (!clearForHero(left, reserved, null) || !clearForHero(right, reserved, null)) continue;
        const leftChar = chars[0];
        const rightChar = chars[1];
        const trayNow = view.tray();
        const leftIdx = trayNow.findIndex((x) => x.kind === 'word' && x.char === leftChar && x.general === t.general);
        const rightIdx0 = trayNow.findIndex((x) => x.kind === 'word' && x.char === rightChar && x.general === t.general);
        if (leftIdx < 0 || rightIdx0 < 0) continue;
        if (!view.place(leftIdx, left)) continue;
        const trayAfter = view.tray();
        const rightIdx = trayAfter.findIndex((x) => x.kind === 'word' && x.char === rightChar && x.general === t.general);
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

        // 1) 先腾伴侣目标格（允许伴侣已在位；可把占位物暂放到伴侣旧格以外）
        if (!clearForHero(needMate, reserved, boardMate)) continue;
        // 2) 迁伴侣（腾出旧格可供后续占位物落脚）
        if (!sameCell(boardMate.cell, needMate)) {
          // 刷新 mate 引用：clear 可能未动伴侣，但仍在原格
          const mateNow = view.placedWords().find(
            (w) => w.char === boardMate.char && w.general === boardMate.general,
          );
          if (!mateNow) continue;
          if (!view.moveWord(mateNow.cell, needMate)) continue;
        }
        // 3) 腾 tray 落点（伴侣旧格现已空，可作为 extraFree）
        if (!clearForHero(needTray, reserved, null, [mateOld])) continue;
        const idx = view.tray().findIndex(
          (x) => x.kind === 'word' && x.char === t.char && x.general === t.general && x.tier === t.tier,
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
}
