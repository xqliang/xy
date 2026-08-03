// 棋盘与取经路几何。COLS×ROWS 网格；妖怪沿 PATH 折线从顶部推进到唐僧。

export const COLS = 7;
export const ROWS = 10;

export interface Cell {
  c: number;
  r: number;
}

// 取经路：从顶部 spawn（c3,r-1）蜿蜒到唐僧（c3,r9）。妖怪在相邻路点间线性插值移动。
export const PATH: Cell[] = [
  { c: 3, r: -1 },
  { c: 3, r: 0 }, { c: 3, r: 1 }, { c: 3, r: 2 },
  { c: 4, r: 2 }, { c: 5, r: 2 },
  { c: 5, r: 3 }, { c: 5, r: 4 },
  { c: 4, r: 4 }, { c: 3, r: 4 }, { c: 2, r: 4 }, { c: 1, r: 4 },
  { c: 1, r: 5 }, { c: 1, r: 6 },
  { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 },
  { c: 5, r: 7 }, { c: 5, r: 8 },
  { c: 4, r: 8 }, { c: 3, r: 8 },
  { c: 3, r: 9 }, // 唐僧
];

export const TANGSENG_CELL: Cell = { c: 3, r: 9 };

const pathKey = (c: number, r: number) => `${c},${r}`;
const PATH_SET = new Set(PATH.map((p) => pathKey(p.c, p.r)));

export function isPathCell(c: number, r: number): boolean {
  return PATH_SET.has(pathKey(c, r));
}

// 可摆放格：网格内、非路径格。按扫描序返回，供"开辟阵位"逐个解锁。
export function placeableCells(): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isPathCell(c, r)) cells.push({ c, r });
    }
  }
  return cells;
}

// 可摆放格按"到取经路的最近距离"升序排列：初始阵位贴着路，单位一开局就够得到妖怪。
// 同距离时按 行→列 稳定排序。
export function placeableCellsByPathProximity(): Cell[] {
  const nearestPathDist = (cell: Cell): number => {
    let min = Infinity;
    for (const p of PATH) {
      if (p.r < 0 || p.r >= ROWS) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
  };
  return placeableCells()
    .map((cell) => ({ cell, d: nearestPathDist(cell) }))
    .sort((a, b) => a.d - b.d || a.cell.r - b.cell.r || a.cell.c - b.cell.c)
    .map((x) => x.cell);
}

// 路径总长度（格），用于按 SPD（格/秒）推进。
export function pathSegments(): { from: Cell; to: Cell; len: number }[] {
  const segs: { from: Cell; to: Cell; len: number }[] = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i]!;
    const b = PATH[i + 1]!;
    const len = Math.hypot(b.c - a.c, b.r - a.r);
    segs.push({ from: a, to: b, len });
  }
  return segs;
}

export const PATH_TOTAL_LEN = pathSegments().reduce((s, x) => s + x.len, 0);

// 给定沿路进度 dist（格），返回所处的连续网格坐标 {c,r}。超过总长则停在唐僧格。
export function posAtDistance(dist: number): { c: number; r: number } {
  if (dist <= 0) return { c: PATH[0]!.c, r: PATH[0]!.r };
  let remain = dist;
  for (const seg of pathSegments()) {
    if (remain <= seg.len) {
      const t = seg.len === 0 ? 0 : remain / seg.len;
      return {
        c: seg.from.c + (seg.to.c - seg.from.c) * t,
        r: seg.from.r + (seg.to.r - seg.from.r) * t,
      };
    }
    remain -= seg.len;
  }
  return { c: TANGSENG_CELL.c, r: TANGSENG_CELL.r };
}
