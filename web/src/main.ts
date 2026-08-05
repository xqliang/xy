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
import { drawShop, shopHitAt } from './shop';
import { drawCodex, codexHitBack } from './codex';
import { drawLeaderboard, leaderboardHitBack } from './leaderboard';
import { drawBag, bagHitAt } from './bag';
import { loadBag, addWeapon, toggleEquip, weaponBonuses, weaponById, type BagState } from './weapons';
import { initAudio, playSfx, startAmbient, stopAmbient, isMuted, toggleMute, isMusicOn, toggleMusic } from './sfx';
import { showRewardedAd } from './ads';
import { getGameCanvas, onAppHide, onAppShow } from './platform';

const canvas = getGameCanvas();
const ctx = canvas.getContext('2d')!;

// 切后台暂停：停 rAF 循环与背景音，回前台再唤醒（pauseLoop/resumeLoop 见游戏循环处，函数声明已提升）。
// 微信小游戏走 onAppHide/onAppShow；Web 端这两者为 no-op，改由下方 visibilitychange 处理，二者不重叠。
onAppHide(() => pauseLoop());
onAppShow(() => resumeLoop());

// 异步加载 Seedream 立绘（加载完成后重绘一帧用上新立绘；静态界面此时循环可能已停，需主动唤醒）
void loadAssets().then(() => scheduleFrame());

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
      scheduleFrame(); // 广告异步返回后菜单循环可能已停，主动重绘更新提示/体力
    });
  } else if (id === 'share') {
    stamina = addStamina(stamina, 5);
    menuToast = '体力 +5';
  } else if (id === 'shop') {
    shopToast = '';
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
  // DPR 上限 2：3 倍屏按 3×3=9 倍像素填充，手游里 2 倍肉眼几乎无差别，却能砍掉最费电的像素填充量。
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  cssScale = fit;
  canvas.width = Math.round(VIEW_W * dpr);
  canvas.height = Math.round(VIEW_H * dpr);
  canvas.style.width = `${Math.round(VIEW_W * fit)}px`;
  canvas.style.height = `${Math.round(VIEW_H * fit)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleFrame(); // 重置画布会清空内容，静态界面需重绘一帧
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
      else if (btn.id === 'palm') battle.usePalm();
      else if (btn.id === 'act0') battle.triggerActive(0);
      else if (btn.id === 'act1') battle.triggerActive(1);
      else if (btn.id.startsWith('pas')) ui.passivePopup = Number(btn.id.slice(3)); // 点击被动图标看详情
      else if (btn.id.startsWith('item')) battle.chooseItem(Number(btn.id.slice(4)));
      else if (btn.id === 'restart') screen = 'menu'; // 结束后返回主菜单（看更新的境界/体力）
      return true;
    }
  }
  return false;
}

function onPointerDown(e: PointerEvent) {
  e.preventDefault();
  initAudio(); // 首个用户手势后启用音频（浏览器自动播放策略）
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (screen === 'menu') {
    handleMenu(x, y);
    return;
  }
  if (screen === 'shop') {
    handleShop(x, y);
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
}
canvas.addEventListener('pointerdown', (e) => { onPointerDown(e); scheduleFrame(); });
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', () => { onPointerUp(); scheduleFrame(); });
function onPointerMove(e: PointerEvent) {
  if (!ui.dragFrom && ui.dragTrayIndex === null) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
  scheduleFrame(); // 拖拽中持续重绘（战斗界面本就连续；此处保证拖影跟手）
}
function onPointerUp() {
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
}

// —— 游戏循环（按需重绘） —— //
// 静态界面（菜单/商店/图鉴/排行/背包，以及结算星级动画播完后）只在状态变化时画一帧，画完即停掉
// rAF，不再持续满帧空转；只有战斗、结算动画进行中才连续循环。待机时 CPU/GPU 几乎不工作，显著降功耗。
let last = performance.now();
let rafId: number | null = null; // 当前排队中的 rAF id；null 表示循环已停
// 连续动画限速到 ~60fps：120Hz+ 屏隔帧处理，功耗近乎减半。-4ms 余量容忍 60Hz 抖动，避免误降到 30fps。
const MIN_FRAME_MS = 1000 / 60 - 4;

// 请求下一帧：若已有帧在排队则合并为一次（幂等），避免输入风暴导致重复调度。
function scheduleFrame(): void {
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

// 当前界面是否需要连续动画：战斗一直跑；结算仅在星级动画播放期间跑；其余静态界面画完即停。
function needsContinuousLoop(): boolean {
  if (screen === 'battle') return true;
  if (screen === 'settle') return !isSettleAnimDone(performance.now() - settleStart);
  return false;
}

function frame(now: number): void {
  rafId = null;
  const elapsed = now - last;
  // 连续动画(战斗/结算)限速到 ~60fps；按需唤醒的单帧走 needsContinuousLoop()=false 分支，不受限、立即重绘。
  if (needsContinuousLoop() && elapsed < MIN_FRAME_MS) {
    scheduleFrame(); // 距上一帧太近，跳过本帧的 step/draw，仅重新排帧
    return;
  }
  let dt = elapsed / 1000;
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
  } else if (screen === 'shop') {
    drawShop(ctx, merit, loadout, shopToast);
  } else if (screen === 'codex') {
    drawCodex(ctx);
  } else if (screen === 'rank') {
    drawLeaderboard(ctx, rank.level);
  } else if (screen === 'bag') {
    drawBag(ctx, bag, bagToast);
  } else if (screen === 'settle') {
    if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
  } else {
    // —— 战斗 —— //
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
  }
  // 仅在需要动画时排下一帧；静态界面画完即停，等待输入唤醒。
  if (needsContinuousLoop()) scheduleFrame();
}
scheduleFrame();

// —— 切后台/锁屏暂停 —— //
// 页面不可见时停掉 rAF 与音频，回前台再唤醒；避免后台白白空耗电量与音频。
function pauseLoop(): void {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  try { stopAmbient(); } catch { /* ignore */ }
}
function resumeLoop(): void {
  last = performance.now(); // 重置计时，避免回前台瞬间 dt 过大导致跳步
  scheduleFrame();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseLoop();
    else resumeLoop();
  });
}

// —— 自测钩子：供 headless Chrome 确定性驱动与快照 —— //
interface GameHook {
  battle: Battle;
  summon: () => boolean;
  wave: () => boolean;
  palm: () => boolean;
  ult: () => boolean; // 兼容垫片：绝招已移除，恒返回 false（旧工具不报错）
  triggerActive: (i: number) => boolean;
  equipActives: (ids: string[]) => void;
  equipPassives: (ids: string[]) => void;
  chooseItem: (i: number) => boolean;
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
  palm: () => battle.usePalm(),
  ult: () => false, // 绝招已移除，保留空实现兼容旧脚本
  triggerActive: (i: number) => battle.triggerActive(i),
  equipActives: (ids: string[]) => { loadout = { ...loadout, equipped: ids.slice(0, 2) }; newGame(); },
  equipPassives: (ids: string[]) => { loadout = { ...loadout, passives: ids.slice(0, 2) }; newGame(); },
  chooseItem: (i: number) => battle.chooseItem(i),
  drag: (from, to) => battle.dragUnit(from, to),
  placeFromTray: (index, to) => battle.placeFromTray(index, to),
  autoPlace: () => battle.autoPlaceTray(),
  select: (cell: Cell | null) => { ui.selected = cell; draw(ctx, battle, ui); },
  enterBattle: () => { screen = 'battle'; scheduleFrame(); },
  openShop: () => { screen = 'shop'; scheduleFrame(); },
  openCodex: () => { screen = 'codex'; scheduleFrame(); },
  openRank: () => { screen = 'rank'; scheduleFrame(); },
  openBag: () => { screen = 'bag'; scheduleFrame(); },
  grantWeapon: (id: string) => { bag = addWeapon(bag, id).state; },
  grantMerit: (n: number) => { merit = addMerit(merit, n); },
  tuning: TUNING,
  restart: (s?: number, diff?: number, mapId?: string) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives);
    endHandled = false;
    screen = 'battle';
    scheduleFrame();
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
