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
import { loadRank, recordWin, recordLose, rankName, type RankState, type RankChange } from './rank';
import { drawSettle, isSettleAnimDone, SETTLE_ANIM_MS } from './settle';
import { loadStamina, addStamina, spendStamina, type Stamina } from './stamina';
import { drawMenu, menuButtonAt } from './menu';
import { loadMerit, metaBonuses, meritReward, addMerit, buyUpgrade, type MeritState } from './merit';
import { loadLoadout, buyActive, buyPassive, type LoadoutState } from './loadout';
import { drawShop, shopHitAt, SHOP_MAX_SCROLL } from './shop';
import { drawCodex, codexHitBack } from './codex';
import { drawLeaderboard, leaderboardHitBack } from './leaderboard';
import { drawBag, bagHitAt } from './bag';
import { loadBag, addWeapon, toggleEquip, weaponBonuses, weaponById, type BagState } from './weapons';
import { initAudio, playSfx, startAmbient, stopAmbient, isMuted, toggleMute, isMusicOn, toggleMusic } from './sfx';
import { showRewardedAd } from './ads';
import { getGameCanvas, onAppHide, onAppShow } from './platform';

const canvas = getGameCanvas();
const ctx = canvas.getContext('2d')!;

// 切后台暂停背景音（对齐"看广告/切后台暂停"；Web 下 onAppHide 为 no-op，行为不变）
onAppHide(() => { try { stopAmbient(); } catch { /* ignore */ } });
onAppShow(() => { /* 恢复由游戏循环自然继续 */ });

// 异步加载 Seedream 立绘（加载完成后游戏循环自动用上，未完成时用色块底座兜底）
void loadAssets();

const params = new URLSearchParams(location.search);
// ?seed= 固定种子(可复现/自测)；否则每局随机种子，保证征兵等每局都不同
const fixedSeed = params.get('seed');
const seed = Number(fixedSeed ?? '1') || 1;
function nextSeed(): number {
  return fixedSeed != null ? seed : (Math.floor(Math.random() * 0x7fffffff) || 1);
}

type Screen = 'menu' | 'battle' | 'shop' | 'codex' | 'rank' | 'bag' | 'settle';
let screen: Screen = 'menu';
let rank: RankState = loadRank();
let stamina: Stamina = loadStamina();
let merit: MeritState = loadMerit();
let loadout: LoadoutState = loadLoadout(); // 主动技能每日装备（跨天重置，需重新购买）
let bag: BagState = loadBag();
let bagToast = '';
let menuToast = '';
let shopToast = '';
// 商城竖向滚动状态 + 拖拽跟踪（拖动=滚动，轻点=购买）
let shopScrollY = 0;
let shopPointerActive = false;
let shopDownX = 0, shopDownY = 0, shopDownScroll = 0, shopDragged = false;
let currentMap = params.get('map') ? mapById(params.get('map')!) : pickDailyMap();
let battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives);
let endHandled = false; // 本局胜负是否已结算入境界
let settleChange: RankChange | null = null; // 结算页要播放的段位变化
let settleStart = 0; // 进入结算页的时间戳（performance.now）
const ui: UiState = { dragFrom: null, dragTrayIndex: null, dragPos: null, selected: null, passivePopup: null };

function newGame() {
  // 使用当前(可在首页切换的)地图；每局随机种子(除非 ?seed= 固定)
  battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives);
  endHandled = false;
}

function handleMenu(x: number, y: number) {
  const id = menuButtonAt(x, y);
  if (!id) return;
  playSfx('click');
  if (id === 'mute') {
    const m = toggleMute();
    menuToast = m ? '已静音（全部）' : '已开启声音';
    return;
  }
  if (id === 'music') {
    const on = toggleMusic();
    menuToast = on ? '背景音乐：开' : '背景音乐：关';
    return;
  }
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
    // 通过 IAA 广告抽象层：微信下拉激励视频、看完才发奖；Web/未配置广告位下即时模拟发奖（体验不变）
    menuToast = '正在加载广告…';
    void showRewardedAd('stamina').then((ok) => {
      if (ok) { stamina = addStamina(stamina, 10); menuToast = '体力 +10'; }
      else menuToast = '未看完广告，未发放体力';
    });
  } else if (id === 'share') {
    stamina = addStamina(stamina, 5);
    menuToast = '体力 +5';
  } else if (id === 'shop') {
    shopToast = '';
    shopScrollY = 0;
    screen = 'shop';
  } else if (id === 'codex') {
    screen = 'codex';
  } else if (id === 'rank') {
    screen = 'rank';
  } else if (id === 'bag') {
    bagToast = '';
    screen = 'bag';
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
  const hit = shopHitAt(x, y, shopScrollY);
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
  if (hit.kind === 'buyActive' && hit.id) {
    const r = buyActive(loadout, merit, hit.id);
    loadout = r.loadout;
    merit = r.merit;
    shopToast = r.ok ? '已装备（今日有效）' : r.reason ?? '无法购买';
  }
  if (hit.kind === 'buyPassive' && hit.id) {
    const r = buyPassive(loadout, merit, hit.id);
    loadout = r.loadout;
    merit = r.merit;
    shopToast = r.ok ? '已装备（今日有效）' : r.reason ?? '无法购买';
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
      else if (btn.id === 'act0') battle.triggerActive(0);
      else if (btn.id === 'act1') battle.triggerActive(1);
      else if (btn.id.startsWith('pas')) ui.passivePopup = Number(btn.id.slice(3)); // 点击被动图标看详情
      else if (btn.id === 'restart') screen = 'menu'; // 结束后返回主菜单（看更新的境界/体力）
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  initAudio(); // 首个用户手势后启用音频（浏览器自动播放策略）
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (screen === 'menu') {
    handleMenu(x, y);
    return;
  }
  if (screen === 'shop') {
    // 按下只记录起点；购买延迟到 pointerup 且未拖动时（拖动=滚动）
    shopPointerActive = true;
    shopDragged = false;
    shopDownX = x; shopDownY = y; shopDownScroll = shopScrollY;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (screen === 'codex') {
    if (codexHitBack(x, y)) screen = 'menu';
    return;
  }
  if (screen === 'rank') {
    if (leaderboardHitBack(x, y)) screen = 'menu';
    return;
  }
  if (screen === 'bag') {
    const hit = bagHitAt(x, y);
    if (hit?.kind === 'back') screen = 'menu';
    else if (hit?.kind === 'toggle') {
      const r = toggleEquip(bag, hit.id);
      bag = r.state;
      bagToast = r.ok ? '' : r.reason ?? '';
    }
    return;
  }
  if (screen === 'settle') {
    if (isSettleAnimDone(performance.now() - settleStart)) {
      settleChange = null;
      screen = 'menu'; // 结算看完回主菜单（刷新段位/体力展示）
    } else {
      settleStart = performance.now() - SETTLE_ANIM_MS; // 点击跳过：直接到终态
    }
    return;
  }
  // 被动详情弹窗打开时：任意点击先关闭弹窗（消费本次点击）
  if (ui.passivePopup !== null) { ui.passivePopup = null; return; }
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
  // 棋盘拖拽（兵/武将字牌/桃树：重新布阵、合成、移动）或点击选中查看信息
  const cell = pxToCell(x, y);
  if (cell && (battle.units.has(`${cell.c},${cell.r}`) || battle.words.has(`${cell.c},${cell.r}`) || battle.trees.has(`${cell.c},${cell.r}`))) {
    ui.dragFrom = cell;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
  } else {
    ui.selected = null; // 点击空白处取消选中
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (screen === 'shop') {
    if (!shopPointerActive) return;
    const { y } = toLogical(e.clientX, e.clientY);
    const dy = y - shopDownY;
    if (Math.abs(dy) > 6) shopDragged = true;
    shopScrollY = Math.max(0, Math.min(SHOP_MAX_SCROLL(), shopDownScroll - dy));
    return;
  }
  if (!ui.dragFrom && ui.dragTrayIndex === null) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', () => {
  if (screen === 'shop') {
    // 轻点(未拖动)才触发购买；拖动只滚动
    if (shopPointerActive && !shopDragged) handleShop(shopDownX, shopDownY);
    shopPointerActive = false;
    return;
  }
  if (ui.dragPos) {
    const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
    const trayTarget = trayIndexAt(ui.dragPos.x, ui.dragPos.y);
    if (ui.dragTrayIndex !== null) {
      // 托盘→棋盘优先，避免落点被候选区命中抢先导致「拖到武将格不交换」
      if (target) {
        battle.placeFromTray(ui.dragTrayIndex, target);
      } else if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
      }
    } else if (ui.dragFrom && target) {
      if (target.c === ui.dragFrom.c && target.r === ui.dragFrom.r) {
        // 未移动 = 点击：切换选中（显示/隐藏该单位信息面板与攻击范围）
        const same = ui.selected && ui.selected.c === target.c && ui.selected.r === target.r;
        ui.selected = same ? null : { c: target.c, r: target.r };
      } else {
        battle.dragBoard(ui.dragFrom, target);
        ui.selected = null;
      }
    }
  }
  ui.dragFrom = null;
  ui.dragTrayIndex = null;
  ui.dragPos = null;
});

// 桌面端滚轮滚动商城
canvas.addEventListener('wheel', (e) => {
  if (screen !== 'shop') return;
  e.preventDefault();
  shopScrollY = Math.max(0, Math.min(SHOP_MAX_SCROLL(), shopScrollY + e.deltaY));
}, { passive: false });

// —— 游戏循环 —— //
let last = performance.now();
function frame(now: number) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // 防卡顿跳步
  // 非对战界面停掉地图氛围音
  if (screen !== 'battle') stopAmbient();
  if (screen === 'menu') {
    drawMenu(ctx, {
      rankLevel: rank.level,
      rankName: rankName(rank.level),
      stamina: stamina.value,
      mapName: currentMap.name,
      toast: menuToast,
      muted: isMuted(),
      musicOn: isMusicOn(),
    });
    requestAnimationFrame(frame);
    return;
  }
  if (screen === 'shop') {
    drawShop(ctx, merit, loadout, shopToast, shopScrollY);
    requestAnimationFrame(frame);
    return;
  }
  if (screen === 'codex') {
    drawCodex(ctx);
    requestAnimationFrame(frame);
    return;
  }
  if (screen === 'rank') {
    drawLeaderboard(ctx, rank.level);
    requestAnimationFrame(frame);
    return;
  }
  if (screen === 'bag') {
    drawBag(ctx, bag, bagToast);
    requestAnimationFrame(frame);
    return;
  }
  if (screen === 'settle') {
    if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
    requestAnimationFrame(frame);
    return;
  }
  battle.step(dt);
  startAmbient(currentMap.id); // 进入对战启动该地图氛围音（幂等）
  // 播放引擎发出的音效事件
  if (battle.sfxEvents.length) {
    for (const ev of battle.sfxEvents) playSfx(ev);
    battle.sfxEvents.length = 0;
  }
  // 胜负结算入境界 + 功德（仅一次），随后进入结算页播放星级动画
  if (!endHandled && (battle.status === 'won' || battle.status === 'lost')) {
    endHandled = true;
    const won = battle.status === 'won';
    const change = won ? recordWin(rank) : recordLose(rank);
    rank = change.state;
    const gain = meritReward(won, battle.wave);
    merit = addMerit(merit, gain);
    // 本局掉落的神兵入背包（重复则升品质）
    const names: string[] = [];
    for (const wid of battle.droppedWeapons) {
      const r = addWeapon(bag, wid);
      bag = r.state;
      names.push(`${weaponById(wid)?.name ?? wid}${r.upgraded ? '↑' : ''}`);
    }
    battle.droppedWeapons = [];
    const dropMsg = names.length ? `，神兵：${names.join('、')}` : '';
    battle.message = `${battle.message}（功德 +${gain}${dropMsg}）`;
    // 切到结算页，播放加/减星动画
    settleChange = change;
    settleStart = performance.now();
    screen = 'settle';
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
  ult: () => boolean; // 兼容垫片：绝招已移除，恒返回 false（旧工具不报错）
  triggerActive: (i: number) => boolean;
  equipActives: (ids: string[]) => void;
  equipPassives: (ids: string[]) => void;
  drag: (from: Cell, to: Cell) => boolean;
  placeFromTray: (index: number, to: Cell) => boolean;
  autoPlace: () => void;
  select: (cell: Cell | null) => void;
  enterBattle: () => void;
  openShop: () => void;
  openCodex: () => void;
  openRank: () => void;
  openBag: () => void;
  grantWeapon: (id: string) => void;
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
  ult: () => false, // 绝招已移除，保留空实现兼容旧脚本
  triggerActive: (i: number) => battle.triggerActive(i),
  equipActives: (ids: string[]) => { loadout = { ...loadout, equipped: ids.slice(0, 2) }; newGame(); },
  equipPassives: (ids: string[]) => { loadout = { ...loadout, passives: ids.slice(0, 6) }; newGame(); },
  drag: (from, to) => battle.dragUnit(from, to),
  placeFromTray: (index, to) => battle.placeFromTray(index, to),
  autoPlace: () => battle.autoPlaceTray(),
  select: (cell: Cell | null) => { ui.selected = cell; draw(ctx, battle, ui); },
  enterBattle: () => { screen = 'battle'; },
  openShop: () => { shopScrollY = 0; screen = 'shop'; },
  openCodex: () => { screen = 'codex'; },
  openRank: () => { screen = 'rank'; },
  openBag: () => { screen = 'bag'; },
  grantWeapon: (id: string) => { bag = addWeapon(bag, id).state; },
  grantMerit: (n: number) => { merit = addMerit(merit, n); },
  tuning: TUNING,
  restart: (s?: number, diff?: number, mapId?: string) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives);
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
