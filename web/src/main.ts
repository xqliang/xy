// 引导 + 游戏循环 + 指针交互 + 自测钩子（window.__game）。
import { Battle } from './battle';
import {
  draw,
  getButtons,
  pxToCell,
  trayIndexAt,
  setHudRank,
  VIEW_W,
  VIEW_H,
  type UiState,
} from './render';
import type { Cell } from './board';
import { pickDailyMap, mapById } from './board';
import { loadAssets } from './assets';
import { loadRank, recordWin, recordLose, rankName, type RankState } from './rank';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// 异步加载 Seedream 立绘（加载完成后游戏循环自动用上，未完成时用色块底座兜底）
void loadAssets();

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? '1') || 1;

let rank: RankState = loadRank();
let currentMap = params.get('map') ? mapById(params.get('map')!) : pickDailyMap();
let battle = new Battle(seed, rank.difficulty, currentMap);
let endHandled = false; // 本局胜负是否已结算入境界
const ui: UiState = { dragFrom: null, dragTrayIndex: null, dragPos: null };

function newGame() {
  battle = new Battle(seed, rank.difficulty, currentMap);
  endHandled = false;
}

// —— 画布尺寸 / DPR —— //
let cssScale = 1;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const fit = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  cssScale = fit;
  canvas.width = Math.round(VIEW_W * dpr);
  canvas.height = Math.round(VIEW_H * dpr);
  canvas.style.width = `${Math.round(VIEW_W * fit)}px`;
  canvas.style.height = `${Math.round(VIEW_H * fit)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// —— 指针坐标 → 逻辑坐标 —— //
function toLogical(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / cssScale,
    y: (clientY - rect.top) / cssScale,
  };
}

function handleButton(x: number, y: number): boolean {
  for (const btn of getButtons(battle)) {
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      if (!btn.enabled) return true;
      if (btn.id === 'summon') battle.summon();
      else if (btn.id === 'autoplace') battle.autoPlaceTray();
      else if (btn.id === 'wave') battle.startNextWave();
      else if (btn.id === 'palm') battle.usePalm();
      else if (btn.id.startsWith('item')) battle.chooseItem(Number(btn.id.slice(4)));
      else if (btn.id === 'restart') newGame();
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (handleButton(x, y)) return;
  // 候选区令牌拖拽
  const ti = trayIndexAt(x, y);
  if (ti !== null && battle.tray[ti]) {
    ui.dragTrayIndex = ti;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  // 棋盘单位拖拽（重新布阵/合成）
  const cell = pxToCell(x, y);
  if (cell && battle.units.has(`${cell.c},${cell.r}`)) {
    ui.dragFrom = cell;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!ui.dragFrom && ui.dragTrayIndex === null) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', () => {
  if (ui.dragPos) {
    const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
    const trayTarget = trayIndexAt(ui.dragPos.x, ui.dragPos.y);
    if (ui.dragTrayIndex !== null) {
      // 候选区令牌：拖到另一候选槽→合并；拖到棋盘→落位
      if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
      } else if (target) {
        battle.placeFromTray(ui.dragTrayIndex, target);
      }
    } else if (ui.dragFrom && target) {
      battle.dragUnit(ui.dragFrom, target);
    }
  }
  ui.dragFrom = null;
  ui.dragTrayIndex = null;
  ui.dragPos = null;
});

// —— 游戏循环 —— //
let last = performance.now();
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // 防卡顿跳步
  battle.step(dt);
  // 胜负结算入境界（仅一次）
  if (!endHandled && (battle.status === 'won' || battle.status === 'lost')) {
    endHandled = true;
    rank = battle.status === 'won' ? recordWin(rank) : recordLose(rank);
  }
  setHudRank(rankName(rank.level));
  draw(ctx, battle, ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// —— 自测钩子：供 headless Chrome 确定性驱动与快照 —— //
interface GameHook {
  battle: Battle;
  summon: () => boolean;
  wave: () => boolean;
  palm: () => boolean;
  chooseItem: (i: number) => boolean;
  drag: (from: Cell, to: Cell) => boolean;
  autoPlace: () => void;
  restart: (s?: number, diff?: number, mapId?: string) => void;
  step: (dt: number) => void;
  fastForward: (seconds: number, dt?: number) => void;
  grantPeach: (n: number) => void;
  buildDefense: (peach?: number) => void;
  snapshot: () => ReturnType<Battle['snapshot']>;
}
const hook: GameHook = {
  get battle() {
    return battle;
  },
  summon: () => battle.summon(),
  wave: () => battle.startNextWave(),
  palm: () => battle.usePalm(),
  chooseItem: (i: number) => battle.chooseItem(i),
  drag: (from, to) => battle.dragUnit(from, to),
  autoPlace: () => battle.autoPlaceTray(),
  restart: (s?: number, diff?: number, mapId?: string) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap);
    endHandled = false;
  },
  step: (dt: number) => battle.step(dt),
  fastForward: (seconds: number, dt = 1 / 60) => {
    let t = 0;
    while (t < seconds) {
      battle.step(dt);
      t += dt;
    }
    draw(ctx, battle, ui);
  },
  grantPeach: (n: number) => battle.grantPeach(n),
  // 建立防线：给足蟠桃，反复「征兵→一键布阵」直到无法再征兵/无空位，供自测验证击杀→产桃→胜负
  buildDefense: (peach = 2000) => {
    battle.grantPeach(peach);
    for (let round = 0; round < 40; round++) {
      const before = battle.units.size;
      if (!battle.summon()) {
        // 候选区可能有残留，先布阵
        battle.autoPlaceTray();
        if (!battle.summon()) break;
      }
      battle.autoPlaceTray();
      // 若单位数不再增长（无空位可放），停止
      if (battle.units.size === before && battle.tray.length === 0 && battle.lockedCells().length === 0) break;
    }
    draw(ctx, battle, ui);
  },
  snapshot: () => battle.snapshot(),
};
(window as unknown as { __game: GameHook }).__game = hook;
