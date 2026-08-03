// 棋盘与多地图。7×10 网格；每张地图有不同的取经路、色系、唐僧位置。
export const COLS = 8;
export const ROWS = 10;
export const FENCE_ROW = 5; // 玩家半场 = 行 5..9；AI 半场 = 行 0..4；两者间栅栏

export interface Cell {
  c: number;
  r: number;
}

// 地图配色主题
export interface MapTheme {
  bg0: string;
  bg1: string;
  cellUnlocked: string;
  cellLocked: string;
  path: string;
  hud: string;
}

export interface GameMap {
  id: string;
  name: string;
  theme: MapTheme;
  path: Cell[]; // 首点为入场(可在网格外)，末点为唐僧格；须位于玩家半场(行>=FENCE_ROW)
  tangseng: Cell;
  initialBlock?: Cell[]; // 开局解锁的 6 格；缺省则用贴路最近的 6 格
  fenceGaps: number[]; // 中间栅栏的开口列（每张地图不同）
}

export function isPathCell(map: GameMap, c: number, r: number): boolean {
  return map.path.some((p) => p.c === c && p.r === r);
}

export function pathSegments(map: GameMap): { from: Cell; to: Cell; len: number }[] {
  return segmentsOf(map.path);
}

function segmentsOf(path: Cell[]): { from: Cell; to: Cell; len: number }[] {
  const segs: { from: Cell; to: Cell; len: number }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    segs.push({ from: a, to: b, len: Math.hypot(b.c - a.c, b.r - a.r) });
  }
  return segs;
}

export function lenOf(path: Cell[]): number {
  return segmentsOf(path).reduce((s, x) => s + x.len, 0);
}

// 沿任意路径 path 的进度 dist（格）→ 连续网格坐标
export function posAlong(path: Cell[], dist: number): { c: number; r: number } {
  if (dist <= 0) return { c: path[0]!.c, r: path[0]!.r };
  let remain = dist;
  for (const seg of segmentsOf(path)) {
    if (remain <= seg.len) {
      const t = seg.len === 0 ? 0 : remain / seg.len;
      return { c: seg.from.c + (seg.to.c - seg.from.c) * t, r: seg.from.r + (seg.to.r - seg.from.r) * t };
    }
    remain -= seg.len;
  }
  const last = path[path.length - 1]!;
  return { c: last.c, r: last.r };
}

// 点对称镜像（用于生成 AI 对手的上半场：绕棋盘中心 180°）
export function mirrorCell(cell: Cell): Cell {
  return { c: COLS - 1 - cell.c, r: ROWS - 1 - cell.r };
}
export function mirrorPath(path: Cell[]): Cell[] {
  return path.map(mirrorCell);
}

export function pathTotalLen(map: GameMap): number {
  return lenOf(map.path);
}

// 沿路进度 dist（格）→ 连续网格坐标
export function posAtDistance(map: GameMap, dist: number): { c: number; r: number } {
  return posAlong(map.path, dist);
}

export function placeableCells(map: GameMap): Cell[] {
  const cells: Cell[] = [];
  for (let r = FENCE_ROW; r < ROWS; r++) { // 仅玩家半场（下 5 行）
    for (let c = 0; c < COLS; c++) {
      if (!isPathCell(map, c, r)) cells.push({ c, r });
    }
  }
  return cells;
}

export function placeableByProximity(map: GameMap): Cell[] {
  const nearest = (cell: Cell): number => {
    let min = Infinity;
    for (const p of map.path) {
      if (p.r < 0 || p.r >= ROWS) continue;
      const d = Math.hypot(p.c - cell.c, p.r - cell.r);
      if (d < min) min = d;
    }
    return min;
  };
  return placeableCells(map)
    .map((cell) => ({ cell, d: nearest(cell) }))
    .sort((a, b) => a.d - b.d || a.cell.r - b.cell.r || a.cell.c - b.cell.c)
    .map((x) => x.cell);
}

// 阵位解锁顺序：初始 6 格（initialBlock 或贴路最近 6）在前，其余按贴路距离
export function slotUnlockOrder(map: GameMap): Cell[] {
  const prox = placeableByProximity(map);
  const block = (map.initialBlock ?? prox.slice(0, 6)).filter((c) => !isPathCell(map, c.c, c.r));
  const inBlock = (c: Cell) => block.some((b) => b.c === c.c && b.r === c.r);
  const rest = prox.filter((c) => !inBlock(c));
  return [...block, ...rest];
}

// —— 四张西游地图（每日轮换）——
export const MAPS: GameMap[] = [
  {
    id: 'huoyanshan',
    name: '火焰山',
    theme: { bg0: '#f2dcc0', bg1: '#e8c49a', cellUnlocked: '#f0c88a', cellLocked: '#d9c4a6', path: '#c98a5a', hud: '#e6bd86' },
    path: [
      { c: -1, r: 5 }, { c: 0, r: 5 }, { c: 1, r: 5 }, { c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 }, { c: 6, r: 5 }, { c: 7, r: 5 },
      { c: 7, r: 6 }, { c: 7, r: 7 }, { c: 7, r: 8 }, { c: 7, r: 9 },
      { c: 6, r: 9 }, { c: 5, r: 9 }, { c: 4, r: 9 }, { c: 3, r: 9 }, { c: 2, r: 9 }, { c: 1, r: 9 }, { c: 0, r: 9 },
    ],
    tangseng: { c: 0, r: 9 },
    initialBlock: [{ c: 1, r: 6 }, { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 1, r: 7 }, { c: 2, r: 7 }, { c: 3, r: 7 }],
    fenceGaps: [3, 4],
  },
  {
    id: 'liushahe',
    name: '流沙河',
    theme: { bg0: '#e9e2cc', bg1: '#dcd2b2', cellUnlocked: '#e4dca0', cellLocked: '#d2ceb4', path: '#cbb47a', hud: '#ddd2a8' },
    path: [
      { c: 8, r: 5 }, { c: 7, r: 5 }, { c: 6, r: 5 }, { c: 5, r: 5 }, { c: 4, r: 5 }, { c: 3, r: 5 }, { c: 2, r: 5 }, { c: 1, r: 5 }, { c: 0, r: 5 },
      { c: 0, r: 6 }, { c: 0, r: 7 }, { c: 0, r: 8 }, { c: 0, r: 9 },
      { c: 1, r: 9 }, { c: 2, r: 9 }, { c: 3, r: 9 }, { c: 4, r: 9 }, { c: 5, r: 9 }, { c: 6, r: 9 }, { c: 7, r: 9 },
    ],
    tangseng: { c: 7, r: 9 },
    initialBlock: [{ c: 4, r: 6 }, { c: 5, r: 6 }, { c: 6, r: 6 }, { c: 4, r: 7 }, { c: 5, r: 7 }, { c: 6, r: 7 }],
    fenceGaps: [3, 4],
  },
  {
    id: 'baiguling',
    name: '白骨岭',
    theme: { bg0: '#e7e7e0', bg1: '#d2d3c8', cellUnlocked: '#cdd6c2', cellLocked: '#cfd0c8', path: '#b3b0a2', hud: '#d2d2c6' },
    path: [
      { c: -1, r: 6 }, { c: 0, r: 6 }, { c: 0, r: 7 }, { c: 1, r: 7 }, { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 }, { c: 5, r: 7 }, { c: 6, r: 7 }, { c: 7, r: 7 },
      { c: 7, r: 8 }, { c: 7, r: 9 }, { c: 6, r: 9 }, { c: 5, r: 9 }, { c: 4, r: 9 }, { c: 3, r: 9 }, { c: 2, r: 9 }, { c: 1, r: 9 }, { c: 0, r: 9 },
    ],
    tangseng: { c: 0, r: 9 },
    initialBlock: [{ c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }, { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }],
    fenceGaps: [0, 1],
  },
  {
    id: 'pansidong',
    name: '盘丝洞',
    theme: { bg0: '#e8dae0', bg1: '#d8c2cf', cellUnlocked: '#dcb7cb', cellLocked: '#d3c2cc', path: '#b892a6', hud: '#d8bece' },
    path: [
      { c: 8, r: 6 }, { c: 7, r: 6 }, { c: 7, r: 7 }, { c: 6, r: 7 }, { c: 5, r: 7 }, { c: 4, r: 7 }, { c: 3, r: 7 }, { c: 2, r: 7 }, { c: 1, r: 7 }, { c: 0, r: 7 },
      { c: 0, r: 8 }, { c: 0, r: 9 }, { c: 1, r: 9 }, { c: 2, r: 9 }, { c: 3, r: 9 }, { c: 4, r: 9 }, { c: 5, r: 9 }, { c: 6, r: 9 }, { c: 7, r: 9 },
    ],
    tangseng: { c: 7, r: 9 },
    initialBlock: [{ c: 3, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 }, { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 }],
    fenceGaps: [6, 7],
  },
];

export function mapById(id: string): GameMap {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]!;
}

// 每日轮换：按日期序号选一张
export function pickDailyMap(date = new Date()): GameMap {
  const dayIndex = Math.floor(date.getTime() / 86400000);
  return MAPS[((dayIndex % MAPS.length) + MAPS.length) % MAPS.length]!;
}
