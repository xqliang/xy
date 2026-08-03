// 引导 + 游戏循环 + 指针交互 + 自测钩子（window.__game）。
import { Battle } from './battle';
import {
  draw,
  getButtons,
  pxToCell,
  VIEW_W,
  VIEW_H,
  type UiState,
} from './render';
import type { Cell } from './board';
import { loadAssets } from './assets';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// 异步加载 Seedream 立绘（加载完成后游戏循环自动用上，未完成时用色块底座兜底）
void loadAssets();

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? '1') || 1;

let battle = new Battle(seed);
const ui: UiState = { dragFrom: null, dragPos: null };

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
      else if (btn.id === 'open') battle.openNewSlot();
      else if (btn.id === 'wave') battle.startNextWave();
      else if (btn.id === 'restart') battle = new Battle(seed);
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (handleButton(x, y)) return;
  const cell = pxToCell(x, y);
  if (cell && battle.units.has(`${cell.c},${cell.r}`)) {
    ui.dragFrom = cell;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!ui.dragFrom) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', (e) => {
  if (ui.dragFrom && ui.dragPos) {
    const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
    if (target) battle.dragUnit(ui.dragFrom, target);
  }
  ui.dragFrom = null;
  ui.dragPos = null;
});

// —— 游戏循环 —— //
let last = performance.now();
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // 防卡顿跳步
  battle.step(dt);
  draw(ctx, battle, ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// —— 自测钩子：供 headless Chrome 确定性驱动与快照 —— //
interface GameHook {
  battle: Battle;
  summon: () => boolean;
  open: () => boolean;
  wave: () => boolean;
  drag: (from: Cell, to: Cell) => boolean;
  restart: (s?: number) => void;
  step: (dt: number) => void;
  fastForward: (seconds: number, dt?: number) => void;
  autoSetup: (summons?: number, slots?: number) => void;
  grantPeach: (n: number) => void;
  buildDefense: (slots?: number, peach?: number) => void;
  snapshot: () => ReturnType<Battle['snapshot']>;
}
const hook: GameHook = {
  get battle() {
    return battle;
  },
  summon: () => battle.summon(),
  open: () => battle.openNewSlot(),
  wave: () => battle.startNextWave(),
  drag: (from, to) => battle.dragUnit(from, to),
  restart: (s?: number) => {
    battle = new Battle(s ?? seed);
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
  autoSetup: (summons = 8, slots = 2) => {
    for (let i = 0; i < slots; i++) battle.openNewSlot();
    for (let i = 0; i < summons; i++) battle.summon();
    draw(ctx, battle, ui);
  },
  grantPeach: (n: number) => battle.grantPeach(n),
  // 建立一条真实防线：给足蟠桃、开阵位、填满、反复合成，供自测验证击杀→产桃→胜负
  buildDefense: (slots = 8, peach = 1000) => {
    battle.grantPeach(peach);
    for (let i = 0; i < slots; i++) battle.openNewSlot();
    // 填满所有已解锁空阵位
    for (let guard = 0; guard < 200; guard++) {
      if (!battle.summon()) break;
    }
    // 反复合成同型同级，直到没有可合成的对子
    for (let pass = 0; pass < 20; pass++) {
      const arr = [...battle.units.values()];
      let merged = false;
      for (let i = 0; i < arr.length && !merged; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i]!;
          const b = arr[j]!;
          if (a.type === b.type && a.tier === b.tier) {
            if (battle.dragUnit(a.cell, b.cell)) {
              merged = true;
              break;
            }
          }
        }
      }
      // 合成腾出空位后继续补召唤
      for (let guard = 0; guard < 50; guard++) {
        if (!battle.summon()) break;
      }
      if (!merged) break;
    }
    draw(ctx, battle, ui);
  },
  snapshot: () => battle.snapshot(),
};
(window as unknown as { __game: GameHook }).__game = hook;
