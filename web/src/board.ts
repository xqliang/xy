// 棋盘与多地图。7×10 网格；每张地图有不同的取经路、色系、唐僧位置。
export const COLS = 8;
export const ROWS = 10;
export const FENCE_ROW = 5; // 玩家半场 = 行 5..9；AI 半场 = 行 0..4；两者间栅栏

export interface Cell {
  c: number;
  r: number;
}

// 地图配色主题（同一色系协调：背景/格子/路径/按钮统一）
export interface MapTheme {
  bg0: string; // 背景渐变上
  bg1: string; // 背景渐变下
  cellUnlocked: string; // 可放置格（近白）
  cellLocked: string; // 不可放置格（深色，同色系）
  path: string; // 怪物路径格
  hud: string; // HUD 条底色
  accent: string; // 主按钮/进度强调色
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

// 玩家路径或其 180° 镜像（AI 路径）上的格子——两方都不可放置
export function isEitherPathCell(map: GameMap, c: number, r: number): boolean {
  if (isPathCell(map, c, r)) return true;
  const m = mirrorCell({ c, r });
  return isPathCell(map, m.c, m.r);
}

// 白骨岭台阶栅栏：左 4 列在 r=5|6，右 4 列在 r=3|4（返回该列「栅栏上沿」行号）。
export function baigulingFenceRow(c: number): number {
  return c <= 3 ? 5 : 3;
}

// 该格是否属于玩家可放置半场（非任一侧路径）。默认下半场 r>=FENCE_ROW；白骨岭为台阶分界。
export function isPlayerCell(map: GameMap, c: number, r: number): boolean {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  if (isEitherPathCell(map, c, r)) return false;
  if (map.id === 'baiguling') {
    return r > baigulingFenceRow(c);
  }
  return r >= FENCE_ROW;
}

/** 该格是否在 AI 半场（栅栏对手一侧，含路径格）。无尽蒙层按此形状裁切。 */
export function isAiHalfCell(map: GameMap, c: number, r: number): boolean {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  if (map.id === 'baiguling') return r <= baigulingFenceRow(c);
  return r < FENCE_ROW;
}

/** AI 半场各列共有的行数（无尽波次弹窗垂直居中用，避免白骨岭右侧溢出）。 */
export function aiHalfSafeRows(map: GameMap): number {
  if (map.id === 'baiguling') return baigulingFenceRow(COLS - 1) + 1; // 右列 r<=3 → 4 行
  return FENCE_ROW;
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

// 沿路到达"首个在网格内的路径点"的累计距离（怪物从这里—出怪口—冒出，而非从网格外平移进来）
export function entranceDistance(path: Cell[]): number {
  let d = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) return d;
    if (i < path.length - 1) {
      const n = path[i + 1]!;
      d += Math.hypot(n.c - p.c, n.r - p.r);
    }
  }
  return 0;
}

/** 路径出怪口：首个在网格内的点（用于朝向/距离） */
export function pathEntranceCell(path: Cell[]): Cell {
  for (const p of path) {
    if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) return p;
  }
  return path[0] ?? { c: 0, r: 0 };
}

/** 最大射程够得着路径的阈值（神箭手 rge=3 + 容差 0.5） */
export const EXIT_PATH_REACH = 3.5;

/**
 * 格到出怪口距离：够得着怪路（pathDist ≤ EXIT_PATH_REACH）用欧氏；
 * 否则用出怪口沿路径到最近点的下标差（路径末尾更大，避免几何近出口却够不着路的假近）。
 */
export function exitDistToPath(path: Cell[], cell: Cell): number {
  const gate = pathEntranceCell(path);
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.r < 0 || p.r >= ROWS) continue;
    const d = Math.hypot(p.c - cell.c, p.r - cell.r);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (bestI < 0 || bestD <= EXIT_PATH_REACH) {
    return Math.hypot(cell.c - gate.c, cell.r - gate.r);
  }
  let gateI = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) {
      gateI = i;
      break;
    }
  }
  return Math.abs(bestI - gateI);
}

/** 从 from 朝向 to 的朝向角（格坐标系，atan2） */
export function faceDirToward(from: Cell, to: Cell): number {
  return Math.atan2(to.r - from.r, to.c - from.c);
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
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isPlayerCell(map, c, r)) cells.push({ c, r });
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

// 阵位解锁顺序：初始 6 格（initialBlock 或贴路最近 6）在前；其余（额外阵位加成才会开）
// 按「到初始阵位块的距离」由近及远——开垦从起始区域向外生长，而非跳到贴路的远角空格。
export function slotUnlockOrder(map: GameMap): Cell[] {
  const prox = placeableByProximity(map);
  const block = (map.initialBlock ?? prox.slice(0, 6)).filter((c) => !isPathCell(map, c.c, c.r));
  const inBlock = (c: Cell) => block.some((b) => b.c === c.c && b.r === c.r);
  const distToBlock = (c: Cell) =>
    Math.min(...block.map((b) => Math.hypot(b.c - c.c, b.r - c.r)));
  // prox 已按贴路距离排序；再按到初始块的距离稳定排序，使扩展格紧贴已开垦区域。
  const rest = prox
    .filter((c) => !inBlock(c))
    .sort((a, b) => distToBlock(a) - distToBlock(b));
  return [...block, ...rest];
}

// —— 四张西游地图（每日轮换）——
export const MAPS: GameMap[] = [
  {
    id: 'huoyanshan',
    name: '火焰山',
    theme: { bg0: '#f2e0cc', bg1: '#e6c39a', cellUnlocked: '#f7f1e6', cellLocked: '#bda284', path: '#cf8a55', hud: '#e8c39a', accent: '#c8792b' },
    // 虎牢关截图为上半场：AI 唐僧(1,5)、出口(8,5)（1起算）→ 代码 AI (0,4)/(7,4)
    // AI：右缘↑含第3行第8列 → 第2行第6–8列左行 → 蛇形至唐僧；第3行第5–7列为可放格
    // 我方为 180° 镜像
    path: [
      { c: -1, r: 5 }, { c: 0, r: 5 },
      { c: 0, r: 6 }, { c: 0, r: 7 }, { c: 0, r: 8 }, // 左缘下行（镜像右缘上行）
      { c: 1, r: 8 }, { c: 2, r: 8 }, { c: 3, r: 8 }, // 右行（镜像 AI 第2行第6–8列路径）
      { c: 3, r: 9 }, { c: 4, r: 9 }, { c: 5, r: 9 }, // 底边
      { c: 5, r: 8 }, { c: 6, r: 8 }, { c: 7, r: 8 }, // 右行
      { c: 7, r: 7 }, { c: 7, r: 6 }, { c: 7, r: 5 }, // 右缘上行至唐僧
    ],
    tangseng: { c: 7, r: 5 },
    // 竞品初始槽 4,3–6,4；含 AI 第3行第5–6列（镜像为 c=2..3,r=7）
    initialBlock: [
      { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 },
      { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
    ],
    fenceGaps: [], // 半场内蛇形，不穿中线栅栏
  },
  {
    id: 'liushahe',
    name: '流沙河',
    theme: { bg0: '#efe8cf', bg1: '#dccf9e', cellUnlocked: '#f8f4e8', cellLocked: '#c2b184', path: '#c9b06a', hud: '#ddcf9e', accent: '#bb9c38' },
    // 唐僧（1 起算）：我方第 8 列第 6 行、AI 第 1 列第 5 行（180° 镜像）。
    // 玩家路径：入场(0,5) → 唐僧(7,5)；AI = mirrorPath。
    path: [
      { c: 0, r: 5 }, { c: 0, r: 6 }, { c: 0, r: 7 }, { c: 0, r: 8 }, { c: 0, r: 9 }, // 左缘下行
      { c: 1, r: 9 }, { c: 2, r: 9 }, // 底边右行
      { c: 2, r: 8 }, { c: 2, r: 7 }, { c: 2, r: 6 }, // 上行（左谷内壁）
      { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 }, // 第6行右行——绕中央初始块上方联通两谷
      { c: 5, r: 7 }, { c: 5, r: 8 }, { c: 5, r: 9 }, // 下行（右谷内壁）
      { c: 6, r: 9 }, { c: 7, r: 9 }, // 底边右行
      { c: 7, r: 8 }, { c: 7, r: 7 }, { c: 7, r: 6 }, { c: 7, r: 5 }, // 右缘上行至唐僧
    ],
    tangseng: { c: 7, r: 5 }, // 1起算：第8列第6行；镜像 AI 为 (0,4)=第1列第5行
    // 竞品初始槽 (1,4)–(3,5) 在上方；我方写镜像底侧 cols3-4 × rows7-9
    initialBlock: [{ c: 3, r: 7 }, { c: 4, r: 7 }, { c: 3, r: 8 }, { c: 4, r: 8 }, { c: 3, r: 9 }, { c: 4, r: 9 }],
    fenceGaps: [], // 河水栅栏全宽严格隔断上下半场，不给出怪口留缺口
  },
  {
    id: 'baiguling',
    name: '白骨岭',
    theme: { bg0: '#e2e5dc', bg1: '#c6cabd', cellUnlocked: '#f4f6ee', cellLocked: '#a6b199', path: '#98a08a', hud: '#c8ccbf', accent: '#6d7c5b' },
    // 巨鹿式：路径贴着台阶白骨栅栏的我方外侧走（不穿栅栏）
    // 栅栏线：左 r=5|6、竖 c=3|4、右 r=3|4；我方走 r=6 / c=4 / r=4
    path: [
      { c: -1, r: 9 }, { c: 0, r: 9 }, { c: 0, r: 8 }, { c: 0, r: 7 }, { c: 0, r: 6 }, // 左下角出怪，沿左缘上行至栅栏下
      { c: 1, r: 6 }, { c: 2, r: 6 }, { c: 3, r: 6 }, // 贴左段栅栏（我方侧）
      { c: 4, r: 6 }, { c: 4, r: 5 }, { c: 4, r: 4 }, // 拐角外侧上行，贴竖段栅栏（我方侧）
      { c: 5, r: 4 }, { c: 6, r: 4 }, { c: 7, r: 4 }, // 贴右段栅栏（我方侧）
      { c: 7, r: 5 }, { c: 7, r: 6 }, { c: 7, r: 7 }, { c: 7, r: 8 }, { c: 7, r: 9 }, // 右缘下行至唐僧
    ],
    tangseng: { c: 7, r: 9 },
    initialBlock: [
      { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
      { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
    ],
    fenceGaps: [], // 台阶白骨堆栅栏无开口
  },
  {
    id: 'pansidong',
    name: '盘丝洞',
    theme: { bg0: '#ecd8e2', bg1: '#d3b0c4', cellUnlocked: '#f8f0f4', cellLocked: '#c2a2b4', path: '#bd8ca6', hud: '#d6b3c6', accent: '#a85a86' },
    // 云梦泽式（对齐截图箭头；路径贴中线栅栏两侧，不穿越）：
    // 我方：左下出怪 → 左缘↑ → 第6行右行 → 上一步 → 第5行右行 → 右缘↓ → 右下唐僧
    // AI：右上出怪 → 右缘↓ → 第3行左行 → 下一步 → 第4行左行 → 左缘↑ → 左上唐僧
    // 栅栏在 r=4|5；我方走 r>=5，AI 走 r<=4
    path: [
      { c: -1, r: 9 }, { c: 0, r: 9 }, { c: 0, r: 8 }, { c: 0, r: 7 }, { c: 0, r: 6 }, // 左下出怪，左缘上行至第6行
      { c: 1, r: 6 }, { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }, // 第6行向右（栅栏我方外侧）
      { c: 4, r: 5 }, // 上台阶（仍在我方半场）
      { c: 5, r: 5 }, { c: 6, r: 5 }, { c: 7, r: 5 }, // 第5行向右（贴栅栏我方侧）
      { c: 7, r: 6 }, { c: 7, r: 7 }, { c: 7, r: 8 }, { c: 7, r: 9 }, // 右缘下行至唐僧
    ],
    tangseng: { c: 7, r: 9 },
    // 竞品初始槽 1起算 (4,2)-(6,3) 在上方；我方写镜像底侧
    initialBlock: [
      { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
      { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
    ],
    fenceGaps: [], // 中带连续分隔，无开口
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
