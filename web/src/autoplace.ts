// web/src/autoplace.ts
// 射程感知的自动布阵策略：玩家「一键布阵」与 AI 对手共用。
// 原则：绝不丢弃令牌（无处可放者留在 tray）；铲挖最优位；合成升级；按射程铺满；够不着则升级。
// 满槽时：tray 内先合再上棋盘合；或棋盘同阶合（保留 pathCover+近出口加权更高者）腾位再落子。
// 纯逻辑：只通过 AutoPlaceView 读写宿主状态，rng 注入以便确定性测试。
import { canMerge, getUnitStat, type UnitType } from '@core';

export interface Cell { c: number; r: number; }

export type PlaceToken =
  | { kind: 'shovel' }
  | { kind: 'unit'; type: UnitType; tier: number }
  | { kind: 'word'; char: string; general: string; tier: number };

export interface PlacedUnitLite { type: UnitType; tier: number; cell: Cell; }
export interface PlacedWordLite { char: string; general: string; cell: Cell; }

export interface AutoPlaceView {
  tray(): PlaceToken[];                     // 当前候选（随 place 变化，每步重读）
  freeCells(): Cell[];                      // 已解锁且空闲，按贴路近→远
  diggableCells(): Cell[];                  // 未解锁可开挖（无桃树）
  placedUnits(): PlacedUnitLite[];
  placedWords(): PlacedWordLite[];
  nearestPathDist(cell: Cell): number;      // 格到怪路的最近距（格）
  /** 格到怪物出口（路径首个在网格内的点）的距离 */
  exitDist(cell: Cell): number;
  /** 该格兵种攻击圆覆盖的怪物路径长度（越大越好） */
  pathCover(cell: Cell, type: UnitType, tier: number): number;
  wordChars(general: string): readonly [string, string] | undefined; // 连读顺序 [左,右]
  place(trayIndex: number, cell: Cell): boolean; // 执行落子（挖/放/合成/激活由宿主完成）
  moveUnit(from: Cell, to: Cell): boolean;  // 把已上场单位从 from 挪到空 to
  /** 候选区内两枚同型同阶兵合成（升阶留在 to 下标；from 被移除） */
  mergeTray(from: number, to: number): boolean;
  /** 棋盘两兵合成：from 并入 to（保留 to 格，升阶） */
  mergeBoard(from: Cell, to: Cell): boolean;
}

export interface AutoPlaceOpts {
  rng: () => number;       // [0,1)
  pSubOptimal?: number;    // 次优概率，默认 0（恒最优）
  rangeTolerance?: number; // 默认 0.5，与战斗判定一致
}

/** 洛阳铲挖格加权：贴路 + 靠近出怪口（分越低越优先） */
export const DIG_PATH_WEIGHT = 1;
export const DIG_EXIT_WEIGHT = 1.25;

export function digPriorityScore(pathDist: number, exitDist: number): number {
  return DIG_PATH_WEIGHT * pathDist + DIG_EXIT_WEIGHT * exitDist;
}

/**
 * 棋盘同阶合并保留格评分：pathCover 为主，靠近出怪口加权加分（分越高越优先保留）。
 * 出口加成上限 = MERGE_EXIT_WEIGHT（贴口时满分），随 exitDist 衰减。
 */
export const MERGE_EXIT_WEIGHT = 1.5;

export function mergeKeepScore(pathCover: number, exitDist: number): number {
  return pathCover + MERGE_EXIT_WEIGHT / (1 + Math.max(0, exitDist));
}

export function planAutoPlace(view: AutoPlaceView, opts: AutoPlaceOpts): void {
  const tol = opts.rangeTolerance ?? 0.5;
  const pSub = opts.pSubOptimal ?? 0;
  const subopt = () => pSub > 0 && opts.rng() < pSub;
  let guard = 0;
  while (guard++ < 500) {
    if (!step()) break; // 一整轮找不到可执行动作 → 停（剩余令牌保留在 tray）
  }

  function step(): boolean {
    const tray = view.tray();
    // 1) 铲子：挖「贴路 + 近出口」加权最优格；次优时挖较后一格
    for (let i = 0; i < tray.length; i++) {
      if (tray[i]!.kind !== 'shovel') continue;
      const digs = sortedDigTargets();
      if (digs.length === 0) continue; // 无处可挖：保留，扫下一个
      const cell = subopt() && digs.length > 1 ? digs[1 + Math.floor(opts.rng() * (digs.length - 1))]! : digs[0]!;
      if (view.place(i, cell)) return true;
    }
    // 2) 字牌：优先放到能与同将另一字连读相邻的格以激活；否则任意空格
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'word') continue;
      const cell = planWordCell(t);
      if (cell && view.place(i, cell)) return true;
    }
    // 3) 兵种合成：同型同阶 → 合成升阶（"合成英雄"/升级武器）
    for (let i = 0; i < tray.length; i++) {
      const t = tray[i]!; if (t.kind !== 'unit') continue;
      const mate = view.placedUnits().find((u) => u.type === t.type && u.tier === t.tier);
      if (mate && !subopt()) { if (view.place(i, mate.cell)) return true; }
    }
    // 4) 射程感知铺格：短射程兵优先，放进"可达且最远"的空格
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
        : reach.reduce((best, c) => (view.nearestPathDist(c) > view.nearestPathDist(best) ? c : best), reach[0]!);
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
        let dest: Cell | undefined; // 占位兵能去的、最远的空格；且不再占用短兵可达的近格
        for (const c of free) {
          if (view.nearestPathDist(c) > occRge + tol) continue; // 占位兵够不着
          if (view.nearestPathDist(c) <= rge + tol) continue;   // 别又占短兵能用的近格
          if (!dest || view.nearestPathDist(c) > view.nearestPathDist(dest)) dest = c;
        }
        if (dest && view.moveUnit(occ.cell, dest)) {
          view.place(i, occ.cell); // 腾出的近格放短兵
          return true;
        }
      }
    }
    // 6–7) 地图槽位已满：先 tray 内合再上棋盘合；否则棋盘同阶合腾位再落子
    if (view.freeCells().length === 0) {
      if (tryTrayMergeOntoBoard()) return true;
      if (tryBoardMergeThenPlace()) return true;
    }
    return false; // 无可推进动作
  }

  /** 可挖格按「贴路 + 近出口」加权排序（低分优先） */
  function sortedDigTargets(): Cell[] {
    return view.diggableCells().slice().sort((a, b) => {
      const sa = digPriorityScore(view.nearestPathDist(a), view.exitDist(a));
      const sb = digPriorityScore(view.nearestPathDist(b), view.exitDist(b));
      return sa - sb || a.r - b.r || a.c - b.c;
    });
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
        const scoreA = mergeKeepScore(view.pathCover(a.cell, a.type, a.tier), view.exitDist(a.cell));
        const scoreB = mergeKeepScore(view.pathCover(b.cell, b.type, b.tier), view.exitDist(b.cell));
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

  function planWordCell(t: Extract<PlaceToken, { kind: 'word' }>): Cell | undefined {
    const chars = view.wordChars(t.general);
    const free = view.freeCells();
    const mates = view.placedWords().filter((w) => w.general === t.general && w.char !== t.char);
    if (chars && mates.length && !subopt()) {
      const mate = mates[0]!;
      const tokenIsLeft = t.char === chars[0];
      const wantC = tokenIsLeft ? mate.cell.c - 1 : mate.cell.c + 1;
      const hit = free.find((c) => c.r === mate.cell.r && c.c === wantC);
      if (hit) return hit;
    }
    return free[0]; // 退化：任意空格（不丢弃）
  }
}
