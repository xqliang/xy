// 棋盘与多地图。7×10 网格；每张地图有不同的取经路、色系、唐僧位置。
export const COLS = 7;
export const ROWS = 10;

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
  path: Cell[]; // 首点为入场(可在网格外)，末点为唐僧格
  tangseng: Cell;
  initialBlock?: Cell[]; // 开局解锁的 6 格；缺省则用贴路最近的 6 格
}

const key = (c: number, r: number) => `${c},${r}`;

export function isPathCell(map: GameMap, c: number, r: number): boolean {
  return map.path.some((p) => p.c === c && p.r === r);
}

export function pathSegments(map: GameMap): { from: Cell; to: Cell; len: number }[] {
  const segs: { from: Cell; to: Cell; len: number }[] = [];
  for (let i = 0; i < map.path.length - 1; i++) {
    const a = map.path[i]!;
    const b = map.path[i + 1]!;
    segs.push({ from: a, to: b, len: Math.hypot(b.c - a.c, b.r - a.r) });
  }
  return segs;
}

export function pathTotalLen(map: GameMap): number {
  return pathSegments(map).reduce((s, x) => s + x.len, 0);
}

// 沿路进度 dist（格）→ 连续网格坐标
export function posAtDistance(map: GameMap, dist: number): { c: number; r: number } {
  if (dist <= 0) return { c: map.path[0]!.c, r: map.path[0]!.r };
  let remain = dist;
  for (const seg of pathSegments(map)) {
    if (remain <= seg.len) {
      const t = seg.len === 0 ? 0 : remain / seg.len;
      return { c: seg.from.c + (seg.to.c - seg.from.c) * t, r: seg.from.r + (seg.to.r - seg.from.r) * t };
    }
    remain -= seg.len;
  }
  return { c: map.tangseng.c, r: map.tangseng.r };
}

export function placeableCells(map: GameMap): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < ROWS; r++) {
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
    theme: { bg0: '#f2dcc0', bg1: '#e8c49a', cellUnlocked: '#f0c88a', cellLocked: '#d9c4a6', path: '#b5623a', hud: '#e6bd86' },
    path: [
      { c: 1, r: -1 }, { c: 1, r: 0 }, { c: 1, r: 1 }, { c: 1, r: 2 },
      { c: 2, r: 2 }, { c: 3, r: 2 }, { c: 4, r: 2 }, { c: 5, r: 2 },
      { c: 5, r: 3 }, { c: 5, r: 4 }, { c: 4, r: 4 }, { c: 3, r: 4 }, { c: 2, r: 4 }, { c: 1, r: 4 },
      { c: 1, r: 5 }, { c: 1, r: 6 }, { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 },
      { c: 5, r: 7 }, { c: 5, r: 8 }, { c: 6, r: 8 }, { c: 6, r: 9 },
    ],
    tangseng: { c: 6, r: 9 },
    initialBlock: [
      { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
      { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
    ],
  },
  {
    id: 'liushahe',
    name: '流沙河',
    theme: { bg0: '#e9e2cc', bg1: '#dcd2b2', cellUnlocked: '#e4dca0', cellLocked: '#d2ceb4', path: '#c2a86a', hud: '#ddd2a8' },
    path: [
      { c: 5, r: -1 }, { c: 5, r: 0 }, { c: 5, r: 1 }, { c: 5, r: 2 },
      { c: 4, r: 2 }, { c: 3, r: 2 }, { c: 2, r: 2 }, { c: 1, r: 2 },
      { c: 1, r: 3 }, { c: 1, r: 4 }, { c: 2, r: 4 }, { c: 3, r: 4 }, { c: 4, r: 4 }, { c: 5, r: 4 },
      { c: 5, r: 5 }, { c: 5, r: 6 }, { c: 4, r: 6 }, { c: 3, r: 6 }, { c: 2, r: 6 }, { c: 1, r: 6 },
      { c: 1, r: 7 }, { c: 1, r: 8 }, { c: 0, r: 8 }, { c: 0, r: 9 },
    ],
    tangseng: { c: 0, r: 9 },
    initialBlock: [
      { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
      { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
    ],
  },
  {
    id: 'baiguling',
    name: '白骨岭',
    theme: { bg0: '#e7e7e0', bg1: '#d2d3c8', cellUnlocked: '#cdd6c2', cellLocked: '#cfd0c8', path: '#9f9c8e', hud: '#d2d2c6' },
    path: [
      { c: 0, r: -1 }, { c: 0, r: 0 }, { c: 0, r: 1 }, { c: 0, r: 2 },
      { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 3, r: 2 }, { c: 3, r: 3 }, { c: 3, r: 4 },
      { c: 2, r: 4 }, { c: 1, r: 4 }, { c: 1, r: 5 }, { c: 1, r: 6 },
      { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 }, { c: 5, r: 7 }, { c: 5, r: 8 },
      { c: 4, r: 8 }, { c: 3, r: 8 }, { c: 3, r: 9 },
    ],
    tangseng: { c: 3, r: 9 },
  },
  {
    id: 'pansidong',
    name: '盘丝洞',
    theme: { bg0: '#e8dae0', bg1: '#d8c2cf', cellUnlocked: '#dcb7cb', cellLocked: '#d3c2cc', path: '#a06a84', hud: '#d8bece' },
    path: [
      { c: 3, r: -1 }, { c: 3, r: 0 }, { c: 4, r: 0 }, { c: 5, r: 0 }, { c: 5, r: 1 }, { c: 5, r: 2 },
      { c: 4, r: 2 }, { c: 3, r: 2 }, { c: 2, r: 2 }, { c: 2, r: 3 }, { c: 2, r: 4 }, { c: 3, r: 4 }, { c: 4, r: 4 }, { c: 5, r: 4 },
      { c: 5, r: 5 }, { c: 5, r: 6 }, { c: 4, r: 6 }, { c: 3, r: 6 }, { c: 2, r: 6 }, { c: 1, r: 6 },
      { c: 1, r: 7 }, { c: 1, r: 8 }, { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 3, r: 9 },
    ],
    tangseng: { c: 3, r: 9 },
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
