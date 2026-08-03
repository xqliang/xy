// 引导 + 游戏循环 + 指针交互 + 自测钩子（window.__game）。
import { Battle, TUNING } from './battle';
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
import { pickDailyMap, mapById, MAPS } from './board';
import { loadAssets } from './assets';
import { loadRank, recordWin, recordLose, rankName, type RankState } from './rank';
import { loadStamina, addStamina, spendStamina, type Stamina } from './stamina';
import { drawMenu, menuButtonAt } from './menu';
import { loadMerit, metaBonuses, meritReward, addMerit, buyUpgrade, type MeritState } from './merit';
import { drawShop, shopHitAt } from './shop';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

// 异步加载 Seedream 立绘（加载完成后游戏循环自动用上，未完成时用色块底座兜底）
void loadAssets();

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? '1') || 1;

type Screen = 'menu' | 'battle' | 'shop';
let screen: Screen = 'menu';
let rank: RankState = loadRank();
let stamina: Stamina = loadStamina();
let merit: MeritState = loadMerit();
let menuToast = '';
let shopToast = '';
let currentMap = params.get('map') ? mapById(params.get('map')!) : pickDailyMap();
let battle = new Battle(seed, rank.difficulty, currentMap, metaBonuses(merit));
let endHandled = false; // 本局胜负是否已结算入境界
const ui: UiState = { dragFrom: null, dragTrayIndex: null, dragPos: null, selected: null };

function newGame() {
  // 使用当前(可在首页切换的)地图；不再每次重置为每日轮换
  battle = new Battle(seed, rank.difficulty, currentMap, metaBonuses(merit));
  endHandled = false;
}

function handleMenu(x: number, y: number) {
  const id = menuButtonAt(x, y);
  if (!id) return;
  if (id === 'start') {
    const r = spendStamina(stamina);
    if (!r.ok) {
      menuToast = '体力不足！看广告或分享补充';
      return;
    }
    stamina = r.state;
    newGame();
    screen = 'battle';
  } else if (id === 'ad') {
    stamina = addStamina(stamina, 10);
    menuToast = '体力 +10';
  } else if (id === 'share') {
    stamina = addStamina(stamina, 5);
    menuToast = '体力 +5';
  } else if (id === 'shop') {
    shopToast = '';
    screen = 'shop';
  } else if (id === 'mapPrev' || id === 'mapNext') {
    const idx = MAPS.findIndex((m) => m.id === currentMap.id);
    const n = MAPS.length;
    const next = id === 'mapNext' ? (idx + 1) % n : (idx - 1 + n) % n;
    currentMap = MAPS[next]!;
    menuToast = `地图：${currentMap.name}`;
  } else {
    menuToast = '该功能开发中…';
  }
}

function handleShop(x: number, y: number) {
  const hit = shopHitAt(x, y);
  if (!hit) return;
  if (hit.kind === 'back') {
    screen = 'menu';
    return;
  }
  if (hit.kind === 'buy' && hit.id) {
    const r = buyUpgrade(merit, hit.id);
    merit = r.state;
    shopToast = r.ok ? '购买成功！' : r.reason ?? '无法购买';
  }
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
      else if (btn.id === 'ult') battle.castUltimate();
      else if (btn.id.startsWith('item')) battle.chooseItem(Number(btn.id.slice(4)));
      else if (btn.id === 'restart') screen = 'menu'; // 结束后返回主菜单（看更新的境界/体力）
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (screen === 'menu') {
    handleMenu(x, y);
    return;
  }
  if (screen === 'shop') {
    handleShop(x, y);
    return;
  }
  if (handleButton(x, y)) { ui.selected = null; return; }
  // 候选区令牌拖拽
  const ti = trayIndexAt(x, y);
  if (ti !== null && battle.tray[ti]) {
    ui.selected = null;
    ui.dragTrayIndex = ti;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  // 棋盘单位拖拽（重新布阵/合成）或点击选中查看信息
  const cell = pxToCell(x, y);
  if (cell && battle.units.has(`${cell.c},${cell.r}`)) {
    ui.dragFrom = cell;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
  } else {
    ui.selected = null; // 点击空白处取消选中
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
      if (target.c === ui.dragFrom.c && target.r === ui.dragFrom.r) {
        // 未移动 = 点击：切换选中（显示/隐藏该单位信息面板与攻击范围）
        const same = ui.selected && ui.selected.c === target.c && ui.selected.r === target.r;
        ui.selected = same ? null : { c: target.c, r: target.r };
      } else {
        battle.dragUnit(ui.dragFrom, target);
        ui.selected = null;
      }
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
  if (screen === 'menu') {
    drawMenu(ctx, {
      rankLevel: rank.level,
      rankName: rankName(rank.level),
      stamina: stamina.value,
      mapName: currentMap.name,
      toast: menuToast,
    });
    requestAnimationFrame(frame);
    return;
  }
  if (screen === 'shop') {
    drawShop(ctx, merit, shopToast);
    requestAnimationFrame(frame);
    return;
  }
  battle.step(dt);
  // 胜负结算入境界 + 功德（仅一次）
  if (!endHandled && (battle.status === 'won' || battle.status === 'lost')) {
    endHandled = true;
    const won = battle.status === 'won';
    rank = won ? recordWin(rank) : recordLose(rank);
    const gain = meritReward(won, battle.wave);
    merit = addMerit(merit, gain);
    battle.message = `${battle.message}（功德 +${gain}）`;
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
  ult: () => boolean;
  chooseItem: (i: number) => boolean;
  drag: (from: Cell, to: Cell) => boolean;
  autoPlace: () => void;
  select: (cell: Cell | null) => void;
  enterBattle: () => void;
  openShop: () => void;
  grantMerit: (n: number) => void;
  tuning: typeof TUNING;
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
  ult: () => battle.castUltimate(),
  chooseItem: (i: number) => battle.chooseItem(i),
  drag: (from, to) => battle.dragUnit(from, to),
  autoPlace: () => battle.autoPlaceTray(),
  select: (cell: Cell | null) => { ui.selected = cell; draw(ctx, battle, ui); },
  enterBattle: () => { screen = 'battle'; },
  openShop: () => { screen = 'shop'; },
  grantMerit: (n: number) => { merit = addMerit(merit, n); },
  tuning: TUNING,
  restart: (s?: number, diff?: number, mapId?: string) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap);
    endHandled = false;
    screen = 'battle';
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
