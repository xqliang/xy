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
  hitPauseBtn,
  hitMonsterAt,
  isPlayerTangsengCell,
  isAiTangsengCell,
  type UiState,
} from './render';
import type { Cell } from './board';
import { pickDailyMap, mapById, MAPS } from './board';
import { loadMapSelection, saveMapSelection, resolveMap, type MapSelection } from './map-select';
import {
  drawPausePopup,
  pausePopupHitAt,
  type PausePhase,
} from './pause-popup';
import { loadRank, recordWin, recordLose, rankName, type RankState, type RankChange } from './rank';
import { drawSettle, isSettleAnimDone, SETTLE_ANIM_MS, drawEndlessSettle, type EndlessResult } from './settle';
import { loadEndlessEnabled, setEndlessEnabled, recordBestWave, getBestWave } from './endless';
import { loadStamina, addStamina, spendStamina, syncStamina, type Stamina } from './stamina';
import { drawMenu, menuButtonAt } from './menu';
import { loadMerit, metaBonuses, meritReward, addMerit, buyUpgrade, type MeritState } from './merit';
import {
  loadLoadout,
  buyActive,
  buyPassive,
  equipActive,
  equipPassive,
  unequipActive,
  unequipPassive,
  isOwnedActive,
  isOwnedPassive,
  ACTIVE_FULL_HINT,
  PASSIVE_FULL_HINT,
  type LoadoutState,
} from './loadout';
import { drawShop, shopHitAt, SHOP_MAX_SCROLL, drawShopPopup, shopPopupHitAt, type ShopPopupState } from './shop';
import { drawCodex, codexHitBack } from './codex';
import { drawLeaderboard, leaderboardHitBack } from './leaderboard';
import { drawBag, bagHitAt, drawBagPopup, bagPopupHitAt } from './bag';
import { loadBag, addWeapon, toggleEquip, weaponBonuses, weaponById, type BagState } from './weapons';
import { playSfx, startAmbient, startMenuMusic, stopAmbient, applyAudioVolumes, prefetchMenuBgm, bootstrapMenuMusic, resumeAudioAfterGesture } from './sfx';
import { showRewardedAd } from './ads';
import { getGameCanvas, onAppHide, onAppShow } from './platform';
import { loadAiSkill, saveAiSkill, nextAiSkill } from './ai-skill';
import {
  getSettings,
  setShowDamageNumbers,
  setMusicVolume,
  setSfxVolume,
  type GameSettings,
} from './settings';
import {
  drawSettingsPopup,
  drawStaminaPopup,
  drawMapPopup,
  settingsHitAt,
  staminaPopupHitAt,
  mapPopupHitAt,
  settingsMusicVolumeFromX,
  settingsSfxVolumeFromX,
} from './menu-popups';
import {
  merchantClosed,
  openMerchant,
  drawMerchant,
  merchantHitAt,
  applyMerchantHitFull,
  type MerchantUiState,
} from './merchant';

/** 选中态是否指向同一单位：同格，或同属已激活武将的左右字 */
function isSameSelection(b: Battle, selected: Cell | null, target: Cell): boolean {
  if (!selected) return false;
  if (selected.c === target.c && selected.r === target.r) return true;
  const g = b.activeGenerals().find((ag) =>
    ag.cells.some((cc) => cc.c === selected.c && cc.r === selected.r),
  );
  if (!g) return false;
  return g.cells.some((cc) => cc.c === target.c && cc.r === target.r);
}

function isSameAiSelection(b: Battle, selected: Cell | null, target: Cell): boolean {
  if (!selected) return false;
  if (selected.c === target.c && selected.r === target.r) return true;
  const g = b.aiActiveGenerals().find((ag) =>
    ag.cells.some((cc) => cc.c === selected.c && cc.r === selected.r),
  );
  if (!g) return false;
  return g.cells.some((cc) => cc.c === target.c && cc.r === target.r);
}

function aiOccupies(b: Battle, cell: Cell): boolean {
  if (b.aiUnits.some((u) => u.cell.c === cell.c && u.cell.r === cell.r)) return true;
  return b.aiWords.has(`${cell.c},${cell.r}`);
}

function isSameTangsengSelection(b: Battle, selected: Cell | null, target: Cell, side: 'player' | 'ai'): boolean {
  if (!selected) return false;
  const hit = side === 'player' ? isPlayerTangsengCell : isAiTangsengCell;
  return hit(b, selected) && hit(b, target);
}

function clearBoardSelect(): void {
  ui.selected = null;
  ui.selectedMonster = null;
  ui.selectedTrayIndex = null;
}

function selectBoardCell(cell: Cell): void {
  ui.selectedMonster = null;
  ui.selectedTrayIndex = null;
  ui.selected = { c: cell.c, r: cell.r };
}

const canvas = getGameCanvas();
const ctx = canvas.getContext('2d')!;

// 切后台暂停：停 rAF 循环与背景音，回前台再唤醒（pauseLoop/resumeLoop 见游戏循环处，函数声明已提升）。
// 微信小游戏走 onAppHide/onAppShow；Web 端这两者为 no-op，改由下方 visibilitychange 处理，二者不重叠。
onAppHide(() => pauseLoop());
onAppShow(() => resumeLoop());

// 异步加载 Seedream 立绘（加载完成后重绘一帧用上新立绘；静态界面此时循环可能已停，需主动唤醒）
void loadAssets().then(() => {
  void prefetchMenuBgm().then(() => bootstrapMenuMusic());
  scheduleFrame();
});

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
let bagPopup: string | null = null; // 打开详情 tips 的神兵 id（null=未开）
let menuToast = '';
// 首页按钮按下态：down 时显示压下视觉，up 且仍在同一按钮上才触发点击
let menuDownId: string | null = null;
let menuPressedId: string | null = null; // 手指仍压在原按钮上时 = menuDownId，滑出则 null
let menuHoverId: string | null = null;
let shopToast = '';
let shopPopup: ShopPopupState | null = null; // 商品详情/购买确认弹窗（null=未开）
// 商城竖向滚动状态 + 拖拽跟踪（拖动=滚动，轻点=购买）
let shopScrollY = 0;
let shopPointerActive = false;
let shopDownX = 0, shopDownY = 0, shopDownScroll = 0, shopDragged = false;
let mapSelection: MapSelection = loadMapSelection();
let currentMap = params.get('map') ? mapById(params.get('map')!) : resolveMap(mapSelection);
let battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, false, loadAiSkill());
let endHandled = false; // 本局胜负是否已结算入境界
let settleChange: RankChange | null = null; // 结算页要播放的段位变化
let settleStart = 0; // 进入结算页的时间戳（performance.now）
let endlessOn = loadEndlessEnabled(); // 开局前无尽勾选（持久化）
let endlessResult: EndlessResult | null = null; // 无尽局结束展示数据
let pendingMerchant = false; // 本局已结算，回首页时弹出神秘商人
let merchant: MerchantUiState = merchantClosed();
let gameSettings: GameSettings = getSettings();
applyAudioVolumes(gameSettings.musicVolume, gameSettings.sfxVolume);
type MenuPopup = 'none' | 'settings' | 'stamina' | 'map';
let menuPopup: MenuPopup = 'none';
let staminaPopupToast = '';
let menuSliderDrag: 'music' | 'sfx' | null = null;
let pausePhase: PausePhase = 'main';
const ui: UiState = { dragFrom: null, dragTrayIndex: null, dragPos: null, trayDragStart: null, selected: null, selectedTrayIndex: null, selectedMonster: null, passivePopup: null, activePopup: null, activePopupUntil: 0, paused: false };

function newGame() {
  // 使用当前(可在首页切换的)地图；每局随机种子(除非 ?seed= 固定)
  battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endlessOn, loadAiSkill());
  endHandled = false;
  endlessResult = null;
  ui.paused = false;
  pausePhase = 'main';
}

function abortBattleToMenu(): void {
  ui.paused = false;
  pausePhase = 'main';
  clearBoardSelect();
  try { stopAmbient(); } catch { /* ignore */ }
  screen = 'menu';
}

function handleMenu(id: string) {
  playSfx('click');
  if (id === 'settings') {
    menuPopup = 'settings';
    return;
  }
  if (id === 'staminaPlus') {
    staminaPopupToast = '';
    menuPopup = 'stamina';
    return;
  }
  if (id === 'mapPick') {
    menuPopup = 'map';
    return;
  }
  if (id === 'endless') {
    endlessOn = !endlessOn;
    setEndlessEnabled(endlessOn);
    menuToast = endlessOn ? '无尽模式：已开启（波数不限，难度渐增）' : '无尽模式：未开启';
    return;
  }
  if (id === 'start') {
    const r = spendStamina(stamina);
    if (!r.ok) {
      menuToast = '体力不足（需 5 点）！点 + 补充';
      return;
    }
    stamina = r.state;
    newGame();
    screen = 'battle';
  } else if (id === 'codex') {
    screen = 'codex';
  } else if (id === 'rank') {
    screen = 'rank';
  } else if (id === 'bag') {
    bagToast = '';
    bagPopup = null;
    screen = 'bag';
  } else {
    menuToast = '该功能开发中…';
  }
}

function handleMenuPopupPointer(x: number, y: number): boolean {
  if (menuPopup === 'none') return false;
  if (menuPopup === 'settings') {
    const hit = settingsHitAt(x, y, gameSettings);
    if (hit === null) return true;
    playSfx('click');
    if (hit.kind === 'close') {
      menuPopup = 'none';
      menuSliderDrag = null;
      return true;
    }
    if (hit.kind === 'toggleDamage') {
      gameSettings = setShowDamageNumbers(gameSettings, !gameSettings.showDamageNumbers);
      return true;
    }
    if (hit.kind === 'musicKnob') {
      menuSliderDrag = 'music';
      gameSettings = setMusicVolume(gameSettings, settingsMusicVolumeFromX(x));
      applyAudioVolumes(gameSettings.musicVolume, gameSettings.sfxVolume);
      if (gameSettings.musicVolume > 0) startMenuMusic();
      return true;
    }
    if (hit.kind === 'sfxKnob') {
      menuSliderDrag = 'sfx';
      gameSettings = setSfxVolume(gameSettings, settingsSfxVolumeFromX(x));
      applyAudioVolumes(gameSettings.musicVolume, gameSettings.sfxVolume);
      return true;
    }
    return true;
  }
  if (menuPopup === 'map') {
    const hit = mapPopupHitAt(x, y);
    if (hit === null) return true;
    playSfx('click');
    if (hit.kind === 'close') {
      menuPopup = 'none';
      return true;
    }
    if (hit.kind === 'daily') {
      mapSelection = saveMapSelection({ mode: 'daily' });
      currentMap = resolveMap(mapSelection);
      menuToast = `已切换：每日推荐（${pickDailyMap().name}）`;
      menuPopup = 'none';
      return true;
    }
    if (hit.kind === 'map') {
      mapSelection = saveMapSelection({ mode: 'fixed', mapId: hit.mapId });
      currentMap = resolveMap(mapSelection);
      menuToast = `已切换：${currentMap.name}`;
      menuPopup = 'none';
      return true;
    }
    return true;
  }
  const hit = staminaPopupHitAt(x, y);
  if (hit === null) return true;
  playSfx('click');
  if (hit.kind === 'close') {
    menuPopup = 'none';
    staminaPopupToast = '';
    return true;
  }
  if (hit.kind === 'ad') {
    staminaPopupToast = '正在加载广告…';
    void showRewardedAd('stamina').then((ok) => {
      if (ok) {
        stamina = addStamina(stamina, 10);
        staminaPopupToast = '体力 +10';
      } else {
        staminaPopupToast = '未看完广告，未发放体力';
      }
      scheduleFrame();
    });
    return true;
  }
  if (hit.kind === 'share') {
    stamina = addStamina(stamina, 5);
    staminaPopupToast = '体力 +5';
    return true;
  }
  return true;
}

function handleMenuPopupDrag(x: number): void {
  if (menuPopup !== 'settings' || !menuSliderDrag) return;
  const v = menuSliderDrag === 'music' ? settingsMusicVolumeFromX(x) : settingsSfxVolumeFromX(x);
  if (menuSliderDrag === 'music') {
    gameSettings = setMusicVolume(gameSettings, v);
    applyAudioVolumes(gameSettings.musicVolume, gameSettings.sfxVolume);
    if (gameSettings.musicVolume > 0) startMenuMusic();
  } else {
    gameSettings = setSfxVolume(gameSettings, v);
    applyAudioVolumes(gameSettings.musicVolume, gameSettings.sfxVolume);
  }
  scheduleFrame();
}

function handleMerchantPointer(x: number, y: number): boolean {
  if (!merchant.open) return false;
  const hit = merchantHitAt(x, y, merchant, loadout);
  if (hit === null) return true;
  playSfx('click');
  const res = applyMerchantHitFull(hit, merchant, loadout, merit);
  merchant = res.merchant;
  loadout = res.loadout;
  merit = res.merit;
  return true;
}

function leaveSettleToMenu(): void {
  settleChange = null;
  endlessResult = null;
  screen = 'menu';
  if (pendingMerchant) {
    merchant = openMerchant(loadout);
    pendingMerchant = false;
  }
}

function handleShop(x: number, y: number) {
  const hit = shopHitAt(x, y, shopScrollY);
  if (!hit) return;
  if (hit.kind === 'back') {
    screen = 'menu';
    return;
  }
  // 点击商品卡片：打开详情 tips 弹窗（购买改到弹窗内二次确认）
  if (hit.id) shopPopup = { kind: hit.kind, id: hit.id, phase: 'detail' };
}

// 处理商品弹窗：卸下/装备立即生效；未购买点「购买」→ confirm 才扣费。
function handleShopPopup(x: number, y: number) {
  if (!shopPopup) return;
  const r = shopPopupHitAt(x, y, shopPopup);
  if (r === 'close' || r === 'outside') { shopPopup = null; return; }
  if (r === 'action') {
    const { kind, id } = shopPopup;
    if (kind === 'buyActive') {
      if (loadout.equipped.includes(id)) {
        loadout = unequipActive(loadout, id);
        shopToast = '已卸下（今日仍可再装备）';
        shopPopup = null;
        return;
      }
      if (isOwnedActive(loadout, id)) {
        const res = equipActive(loadout, id);
        loadout = res.loadout;
        shopToast = res.ok ? '已装备' : res.reason ?? ACTIVE_FULL_HINT;
        shopPopup = null;
        return;
      }
    }
    if (kind === 'buyPassive') {
      if (loadout.passives.includes(id)) {
        loadout = unequipPassive(loadout, id);
        shopToast = '已卸下（今日仍可再装备）';
        shopPopup = null;
        return;
      }
      if (isOwnedPassive(loadout, id)) {
        const res = equipPassive(loadout, id);
        loadout = res.loadout;
        shopToast = res.ok ? '已装备' : res.reason ?? PASSIVE_FULL_HINT;
        shopPopup = null;
        return;
      }
    }
    shopPopup = { ...shopPopup, phase: 'confirm' };
    return;
  }
  if (r === 'cancel') { shopPopup = { ...shopPopup, phase: 'detail' }; return; }
  if (r === 'confirm') {
    const { kind, id } = shopPopup;
    if (kind === 'buy') {
      const res = buyUpgrade(merit, id);
      merit = res.state;
      shopToast = res.ok ? '购买成功！' : res.reason ?? '无法购买';
    } else if (kind === 'buyActive') {
      const res = buyActive(loadout, merit, id);
      loadout = res.loadout; merit = res.merit;
      shopToast = res.ok
        ? (loadout.equipped.includes(id) ? '已购买并装备（今日有效）' : '已购买（槽满，卸下其他后可装备）')
        : res.reason ?? '无法购买';
    } else {
      const res = buyPassive(loadout, merit, id);
      loadout = res.loadout; merit = res.merit;
      shopToast = res.ok
        ? (loadout.passives.includes(id) ? '已购买并装备（今日有效）' : '已购买（槽满，卸下其他后可装备）')
        : res.reason ?? '无法购买';
    }
    shopPopup = null;
  }
  // r === null：点在弹窗内非按钮区，吞掉本次点击（不关闭）
}

// —— 游戏循环状态 —— //
// 提前声明：resize() 在初始化时同步调用 scheduleFrame()，而 scheduleFrame 读取 rafId；
// 若这些 let/const 声明晚于 resize() 调用点，会触发 TDZ（Cannot access 'rafId' before initialization）导致黑屏。
let last = performance.now();
let rafId: number | null = null; // 当前排队中的 rAF id；null 表示循环已停
// 连续动画限速到 ~60fps：120Hz+ 屏隔帧处理，功耗近乎减半。-4ms 余量容忍 60Hz 抖动，避免误降到 30fps。
const MIN_FRAME_MS = 1000 / 60 - 4;

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
      playSfx('click');
      if (btn.id === 'summon') battle.summon();
      else if (btn.id === 'autoplace') battle.autoPlaceTray();
      else if (btn.id === 'act0') { if (battle.activeSlots[0]?.ready) battle.triggerActive(0); else { ui.activePopup = 0; ui.activePopupUntil = performance.now() + 2500; } }
      else if (btn.id === 'act1') { if (battle.activeSlots[1]?.ready) battle.triggerActive(1); else { ui.activePopup = 1; ui.activePopupUntil = performance.now() + 2500; } }
      else if (btn.id.startsWith('pas')) ui.passivePopup = Number(btn.id.slice(3)); // 点击被动图标看详情
      else if (btn.id === 'restart') screen = 'menu'; // 结束后返回主菜单（看更新的境界/体力）
      return true;
    }
  }
  return false;
}

function onPointerDown(e: PointerEvent) {
  e.preventDefault();
  resumeAudioAfterGesture(screen === 'menu' ? 'menu' : screen === 'battle' ? 'battle' : 'other', currentMap.id);
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (screen === 'menu') {
    if (handleMerchantPointer(x, y)) return;
    if (handleMenuPopupPointer(x, y)) {
      if (menuSliderDrag) canvas.setPointerCapture(e.pointerId);
      return;
    }
    menuDownId = menuButtonAt(x, y);
    menuPressedId = menuDownId;
    if (menuDownId) canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (screen === 'shop') {
    // 弹窗打开时：点击即处理弹窗按钮/关闭，不进入卡片滚动逻辑
    if (shopPopup) { handleShopPopup(x, y); return; }
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
    // 弹窗打开时：点击处理装备切换/关闭
    if (bagPopup) {
      const r = bagPopupHitAt(x, y);
      if (r === 'close' || r === 'outside') bagPopup = null;
      else if (r === 'toggle') {
        const res = toggleEquip(bag, bagPopup);
        bag = res.state;
        bagToast = res.ok ? '' : res.reason ?? '';
      }
      return;
    }
    const hit = bagHitAt(x, y);
    if (hit?.kind === 'back') screen = 'menu';
    else if (hit?.kind === 'toggle') bagPopup = hit.id; // 点击神兵行：打开详情 tips 弹窗
    return;
  }
  if (screen === 'settle') {
    if ((battle.endless && endlessResult) || isSettleAnimDone(performance.now() - settleStart)) {
      leaveSettleToMenu();
    } else {
      settleStart = performance.now() - SETTLE_ANIM_MS;
    }
    return;
  }
  // —— 局内暂停：弹窗内继续 / 终止（二次确认） —— //
  if (ui.paused) {
    const hit = pausePopupHitAt(x, y, pausePhase);
    if (hit === null) return;
    playSfx('click');
    if (hit.kind === 'continue') {
      ui.paused = false;
      pausePhase = 'main';
    } else if (hit.kind === 'quit') {
      pausePhase = 'confirmQuit';
    } else if (hit.kind === 'cancelQuit') {
      pausePhase = 'main';
    } else if (hit.kind === 'confirmQuit') {
      abortBattleToMenu();
    }
    return;
  }
  if (hitPauseBtn(x, y) && (battle.status === 'ready' || battle.status === 'playing')) {
    playSfx('click');
    ui.paused = true;
    pausePhase = 'main';
    clearBoardSelect();
    ui.dragFrom = null;
    ui.dragTrayIndex = null;
    ui.dragPos = null;
    ui.trayDragStart = null;
    return;
  }
  // 被动详情弹窗打开时：任意点击先关闭弹窗（消费本次点击）
  if (ui.passivePopup !== null) { ui.passivePopup = null; return; }
  if (handleButton(x, y)) { clearBoardSelect(); return; }
  // 候选区令牌拖拽
  const ti = trayIndexAt(x, y);
  if (ti !== null && battle.tray[ti]) {
    ui.dragTrayIndex = ti;
    ui.trayDragStart = { x, y };
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  // 双方妖怪（含妖王/小 Boss/精英/骑兵）：优先点选查看 tips
  const monHit = hitMonsterAt(battle, x, y);
  if (monHit) {
    const same = ui.selectedMonster?.side === monHit.side && ui.selectedMonster.id === monHit.id;
    ui.selected = null;
    ui.selectedTrayIndex = null;
    ui.selectedMonster = same ? null : monHit;
    return;
  }
  // AI 半场单位/字牌/唐僧：点击查看范围与 tips（不可拖拽）
  const cell = pxToCell(x, y);
  if (cell && (aiOccupies(battle, cell) || isAiTangsengCell(battle, cell))) {
    const same = isAiTangsengCell(battle, cell)
      ? isSameTangsengSelection(battle, ui.selected, cell, 'ai')
      : isSameAiSelection(battle, ui.selected, cell);
    if (same) clearBoardSelect();
    else selectBoardCell(cell);
    return;
  }
  // 我方唐僧：点击查看 tips（不可拖拽）
  if (cell && isPlayerTangsengCell(battle, cell)) {
    const same = isSameTangsengSelection(battle, ui.selected, cell, 'player');
    if (same) clearBoardSelect();
    else selectBoardCell(cell);
    return;
  }
  // 棋盘拖拽（兵/武将字牌/桃树：重新布阵、合成、移动）或点击选中查看信息
  if (cell && (battle.units.has(`${cell.c},${cell.r}`) || battle.words.has(`${cell.c},${cell.r}`) || battle.trees.has(`${cell.c},${cell.r}`))) {
    ui.dragFrom = cell;
    ui.dragPos = { x, y };
    canvas.setPointerCapture(e.pointerId);
  } else {
    clearBoardSelect(); // 点击空白处取消选中
  }
}
canvas.addEventListener('pointerdown', (e) => { onPointerDown(e); scheduleFrame(); });
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', (e) => { onPointerUp(e); scheduleFrame(); });
canvas.addEventListener('pointercancel', (e) => { onPointerUp(e, true); scheduleFrame(); });
function onPointerMove(e: PointerEvent) {
  if (screen === 'menu') {
    const { x, y } = toLogical(e.clientX, e.clientY);
    if (menuSliderDrag) {
      handleMenuPopupDrag(x);
      return;
    }
    if (menuDownId) {
      const next = menuButtonAt(x, y) === menuDownId ? menuDownId : null;
      if (next !== menuPressedId) {
        menuPressedId = next;
        scheduleFrame();
      }
      return;
    }
    if (menuPopup === 'none' && !merchant.open) {
      const nextHover = menuButtonAt(x, y);
      if (nextHover !== menuHoverId) {
        menuHoverId = nextHover;
        scheduleFrame();
      }
    } else if (menuHoverId) {
      menuHoverId = null;
      scheduleFrame();
    }
  }
  if (screen === 'shop') {
    if (!shopPointerActive) return;
    const { y } = toLogical(e.clientX, e.clientY);
    const dy = y - shopDownY;
    if (Math.abs(dy) > 6) shopDragged = true;
    shopScrollY = Math.max(0, Math.min(SHOP_MAX_SCROLL(), shopDownScroll - dy));
    scheduleFrame(); // 按需重绘：拖动滚动商城时重画
    return;
  }
  if (!ui.dragFrom && ui.dragTrayIndex === null) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
  scheduleFrame(); // 拖拽中持续重绘（战斗界面本就连续；此处保证拖影跟手）
}
function onPointerUp(e?: PointerEvent, cancelled = false) {
  if (screen === 'menu') {
    menuSliderDrag = null;
  }
  if (screen === 'menu' && menuDownId) {
    const id = menuDownId;
    let stillOn = false;
    let upX = 0;
    let upY = 0;
    if (!cancelled && e) {
      const { x, y } = toLogical(e.clientX, e.clientY);
      upX = x;
      upY = y;
      stillOn = menuButtonAt(x, y) === id;
    } else if (!cancelled) {
      stillOn = menuPressedId === id;
    }
    menuDownId = null;
    menuPressedId = null;
    if (!cancelled && e && menuPopup === 'none' && !merchant.open) {
      menuHoverId = menuButtonAt(upX, upY);
    }
    if (stillOn) handleMenu(id);
    return;
  }
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
      const token = battle.tray[ui.dragTrayIndex];
      const start = ui.trayDragStart;
      const moved = start && Math.hypot(ui.dragPos.x - start.x, ui.dragPos.y - start.y) > 8;
      if (!moved && token?.kind === 'word' && trayTarget === ui.dragTrayIndex) {
        ui.selected = null;
        ui.selectedMonster = null;
        ui.selectedTrayIndex = ui.selectedTrayIndex === ui.dragTrayIndex ? null : ui.dragTrayIndex;
      } else if (target) {
        // 托盘→棋盘优先，避免落点被候选区命中抢先导致「拖到武将格不交换」
        battle.placeFromTray(ui.dragTrayIndex, target);
        ui.selectedTrayIndex = null;
      } else if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
        ui.selectedTrayIndex = null;
      }
    } else if (ui.dragFrom && target) {
      if (target.c === ui.dragFrom.c && target.r === ui.dragFrom.r) {
        // 未移动 = 点击：切换选中（显示/隐藏该单位信息面板与攻击范围）
        // 已激活武将：点左右任一格都视为同一选中态（双字同时选中）
        const same = isSameSelection(battle, ui.selected, target);
        if (same) clearBoardSelect();
        else selectBoardCell(target);
      } else {
        battle.dragBoard(ui.dragFrom, target);
        clearBoardSelect();
      }
    }
  }
  ui.dragFrom = null;
  ui.dragTrayIndex = null;
  ui.dragPos = null;
  ui.trayDragStart = null;
}

// 桌面端滚轮滚动商城
canvas.addEventListener('wheel', (e) => {
  if (screen !== 'shop') return;
  e.preventDefault();
  shopScrollY = Math.max(0, Math.min(SHOP_MAX_SCROLL(), shopScrollY + e.deltaY));
  scheduleFrame(); // 按需重绘：滚轮滚动后重画商城
}, { passive: false });

// —— 游戏循环（按需重绘） —— //
// 静态界面（商店/图鉴/排行/背包，以及结算星级动画播完后）只在状态变化时画一帧，画完即停掉
// rAF；菜单因大圣待机动画、战斗与结算动画进行中才连续循环。
// （last / rafId / MIN_FRAME_MS 已在 resize() 之前声明，避免初始化 TDZ。）

// 请求下一帧：若已有帧在排队则合并为一次（幂等），避免输入风暴导致重复调度。
function scheduleFrame(): void {
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

// 当前界面是否需要连续动画：战斗一直跑；结算星级动画期间跑；菜单大圣待机动画需持续重绘。
function needsContinuousLoop(): boolean {
  if (screen === 'menu') return true;
  if (screen === 'battle') return !ui.paused;
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
  // 首页放首页 BGM；战斗放地图氛围音（在战斗分支内启动）；其余界面静音。均幂等。
  if (screen === 'menu') startMenuMusic();
  else if (screen !== 'battle') stopAmbient();
  if (screen === 'menu') {
    stamina = syncStamina(stamina); // 结算离线/挂机恢复后再画顶栏
    drawMenu(ctx, {
      rankStars: rank.stars,
      rankName: rankName(rank.level),
      stamina: stamina.value,
      merit: merit.merit,
      mapName: currentMap.name,
      mapDaily: mapSelection.mode === 'daily',
      toast: menuToast,
      endlessOn,
      pressedId: menuPressedId,
      hoverId: menuHoverId,
    });
    if (menuPopup === 'settings') drawSettingsPopup(ctx, gameSettings);
    else if (menuPopup === 'stamina') drawStaminaPopup(ctx, stamina.value, staminaPopupToast);
    else if (menuPopup === 'map') drawMapPopup(ctx, mapSelection, pickDailyMap().name);
    if (merchant.open) drawMerchant(ctx, merchant, loadout, merit);
  } else if (screen === 'shop') {
    drawShop(ctx, merit, loadout, shopToast, shopScrollY);
    if (shopPopup) drawShopPopup(ctx, shopPopup, merit, loadout);
  } else if (screen === 'codex') {
    drawCodex(ctx);
  } else if (screen === 'rank') {
    drawLeaderboard(ctx, rank.level);
  } else if (screen === 'bag') {
    drawBag(ctx, bag, bagToast);
    if (bagPopup) drawBagPopup(ctx, bag, bagPopup);
  } else if (screen === 'settle') {
    if (battle.endless && endlessResult) drawEndlessSettle(ctx, endlessResult, now - settleStart);
    else if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
  } else {
    // —— 战斗 —— //
    if (!ui.paused) {
      try {
        battle.step(dt);
      } catch (err) {
        console.error('[battle.step]', err);
        battle.message = '战斗逻辑异常，已跳过本帧（请刷新页面）';
      }
    }
    startAmbient(currentMap.id); // 进入对战启动该地图氛围音（幂等）
    // 播放引擎发出的音效事件
    if (battle.sfxEvents.length) {
      for (const ev of battle.sfxEvents) playSfx(ev);
      battle.sfxEvents.length = 0;
    }
    // 胜负结算入境界 + 功德（仅一次），随后进入结算页播放星级动画
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost')) {
      endHandled = true;
      pendingMerchant = true;
      // 神兵掉落入背包（两种模式通用）
      const names: string[] = [];
      for (const wid of battle.droppedWeapons) {
        const r = addWeapon(bag, wid);
        bag = r.state;
        names.push(`${weaponById(wid)?.name ?? wid}${r.upgraded ? '↑' : ''}`);
      }
      battle.droppedWeapons = [];
      const dropMsg = names.length ? `，神兵：${names.join('、')}` : '';

      if (battle.endless) {
        // 无尽：不涨降境界，只记录最高波数；仍发放功德（软奖励，与星级解耦）
        const gain = meritReward(false, battle.wave);
        merit = addMerit(merit, gain);
        const isRecord = recordBestWave(battle.wave);
        endlessResult = { wave: battle.wave, best: getBestWave(), isNewRecord: isRecord, merit: gain };
        settleChange = null;
        battle.message = `抵达第 ${battle.wave} 波（功德 +${gain}${dropMsg}）`;
        settleStart = performance.now();
        screen = 'settle';
      } else {
        const won = battle.status === 'won';
        // 跨局自适应：按本局胜负把 AI 强度朝 70% 目标微调并持久化（仅非无尽局）
        saveAiSkill(nextAiSkill(loadAiSkill(), won));
        const change = won ? recordWin(rank) : recordLose(rank);
        rank = change.state;
        const gain = meritReward(won, battle.wave);
        merit = addMerit(merit, gain);
        battle.message = `${battle.message}（功德 +${gain}${dropMsg}）`;
        endlessResult = null;
        settleChange = change;
        settleStart = performance.now();
        screen = 'settle';
      }
    }
    setHudRank(rankName(rank.level));
    draw(ctx, battle, ui);
    if (ui.paused) drawPausePopup(ctx, pausePhase);
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
  if (screen === 'menu') void bootstrapMenuMusic();
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
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => void;
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
  equipActives: (ids: string[]) => {
    const equipped = ids.slice(0, 2);
    loadout = { ...loadout, ownedActives: [...new Set([...loadout.ownedActives, ...equipped])], equipped };
    newGame();
  },
  equipPassives: (ids: string[]) => {
    const passives = ids.slice(0, 6);
    loadout = { ...loadout, ownedPassives: [...new Set([...loadout.ownedPassives, ...passives])], passives };
    newGame();
  },
  drag: (from, to) => battle.dragUnit(from, to),
  placeFromTray: (index, to) => battle.placeFromTray(index, to),
  autoPlace: () => battle.autoPlaceTray(),
  select: (cell: Cell | null) => {
    ui.selectedMonster = null;
    ui.selected = cell;
    draw(ctx, battle, ui);
  },
  enterBattle: () => { screen = 'battle'; scheduleFrame(); },
  openShop: () => { shopScrollY = 0; shopPopup = null; screen = 'shop'; scheduleFrame(); },
  openCodex: () => { screen = 'codex'; scheduleFrame(); },
  openRank: () => { screen = 'rank'; scheduleFrame(); },
  openBag: () => { bagPopup = null; screen = 'bag'; scheduleFrame(); },
  grantWeapon: (id: string) => { bag = addWeapon(bag, id).state; },
  grantMerit: (n: number) => { merit = addMerit(merit, n); },
  tuning: TUNING,
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endless ?? false, loadAiSkill());
    endHandled = false;
    endlessResult = null;
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
