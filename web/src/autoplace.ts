// web/src/autoplace.ts
// 射程感知的自动布阵策略：玩家「一键布阵」与 AI 对手共用。
// 原则：绝不丢弃令牌（无处可放者留在 tray）；铲挖最优位；合成升级；按射程铺满；够不着则升级。
// 纯逻辑：只通过 AutoPlaceView 读写宿主状态，rng 注入以便确定性测试。
import { getUnitStat, type UnitType } from '@core';

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
  diggableCells(): Cell[];                  // 未解锁可开挖（无桃树），按贴路近→远
  placedUnits(): PlacedUnitLite[];
  placedWords(): PlacedWordLite[];
  nearestPathDist(cell: Cell): number;      // 格到怪路的最近距（格）
  wordChars(general: string): readonly [string, string] | undefined; // 连读顺序 [左,右]
  place(trayIndex: number, cell: Cell): boolean; // 执行落子（挖/放/合成/激活由宿主完成）
}

export interface AutoPlaceOpts {
  rng: () => number;       // [0,1)
  pSubOptimal?: number;    // 次优概率，默认 0（恒最优）
  rangeTolerance?: number; // 默认 0.5，与战斗判定一致
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
    // 1) 铲子：挖最优(最近)锁定格；次优时挖较后一格
    for (let i = 0; i < tray.length; i++) {
      if (tray[i]!.kind !== 'shovel') continue;
      const digs = view.diggableCells();
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
    return false; // 无可推进动作
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
