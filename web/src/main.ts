// 引导 + 游戏循环 + 指针交互 + 自测钩子（window.__game）。
import { Battle, TUNING, findTrayIndex, traySome } from './battle';
import { canMerge } from '@core';
import type { UnitType } from '@core';
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
  hitAiItemChip,
  isPlayerTangsengCell,
  isAiTangsengCell,
  pauseBtnRect,
  cellRect,
  trayTokenRect,
  trayRowRect,
  summonAnimDone,
  traySlotAnimDone,
  type UiState,
} from './render';
import type { Cell } from './board';
import { pickDailyMap, mapById, MAPS, pathEntranceCell } from './board';
import { loadMapSelection, saveMapSelection, resolveMap, type MapSelection } from './map-select';
import { loadAssets, type AssetLoadProgress } from './assets';
import { drawLoadingScreen, drawLoadingBackdrop } from './loading-screen';
import {
  pushMenuFloatToast,
  updateMenuFloatToasts,
  drawMenuFloatToasts,
} from './menu-toast';
import {
  updateMerchantFloatToasts,
  drawMerchantFloatToasts,
} from './merchant-toast';
import {
  drawPausePopup,
  pausePopupHitAt,
  type PausePhase,
} from './pause-popup';
import { loadRank, recordWin, recordLose, rankName, type RankState, type RankChange } from './rank';
import { drawSettle, isSettleAnimDone, SETTLE_ANIM_MS, drawEndlessSettle, type EndlessResult } from './settle';
import { loadEndlessEnabled, setEndlessEnabled, recordBestWave, getBestWave } from './endless';
import { loadStamina, addStamina, spendStamina, syncStamina, STAMINA_MAX, type Stamina } from './stamina';
import { drawMenu, menuButtonAt, STAMINA_PLUS_BTN } from './menu';
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
import {
  drawCodex,
  codexHitBack,
  resetCodex,
  codexPointerDown,
  codexPointerMove,
  codexPointerUp,
  codexWheel,
  setCodexToast,
  codexNeedsAnim,
} from './codex';
import { drawLeaderboard, leaderboardHitBack } from './leaderboard';
import { drawBag, bagHitAt, drawBagPopup, bagPopupHitAt, bagMaxScroll } from './bag';
import { drawWeaponPickups, weaponPickupHitAt, weaponPickupRect } from './weaponPickup';
import { loadBag, addWeapon, addWeaponFragment, toggleEquip, weaponBonuses, weaponById, isWeaponFragmentsComplete, type BagState } from './weapons';
import { playSfx, startAmbient, startMenuMusic, stopAmbient, applyAudioVolumes, prefetchMenuBgm, bootstrapMenuMusic, resumeAudioAfterGesture } from './sfx';
import { showRewardedAd } from './ads';
import { getGameCanvas, onAppHide, onAppShow } from './platform';
import { loadUserId, copyUserId } from './user-id';
import { loadAiSkill, recordVersusOutcome, rollMatchAiSkill } from './ai-skill';
import {
  getSettings,
  resetSettings,
  setShowDamageNumbers,
  setMusicEnabled,
  setSfxEnabled,
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
  drawHelpPopup,
  helpPopupHitAt,
  helpMaxScroll,
  type HelpLinkId,
} from './menu-help';
import {
  merchantClosed,
  openMerchant,
  drawMerchant,
  merchantHitAt,
  applyMerchantHitFull,
  merchantActiveRowRect,
  merchantPassiveRowRect,
  type MerchantUiState,
} from './merchant';
import {
  loadTutorialState,
  maybeStartTutorial,
  advanceTutorial,
  skipTutorial,
  tutorialHitAt,
  drawTutorialOverlay,
  type TutorialState,
  type TutorialOverlay,
  type TutorialSequence,
} from './tutorial';

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

// 游戏循环状态须早于 loadAssets().then / resize()：二者都会 scheduleFrame()，否则 rafId 仍在 TDZ。
let last = performance.now();
let rafId: number | null = null;
const MIN_FRAME_MS = 1000 / 60 - 4;

// 切后台暂停：停 rAF 循环与背景音，回前台再唤醒（pauseLoop/resumeLoop 见游戏循环处，函数声明已提升）。
// 微信小游戏走 onAppHide/onAppShow；Web 端这两者为 no-op，改由下方 visibilitychange 处理，二者不重叠。
onAppHide(() => pauseLoop());
onAppShow(() => resumeLoop());

let loadProgress: AssetLoadProgress = { loaded: 0, total: 1, phase: 'images' };
/** 资源已在加载，但进度页延迟显示，避免本地缓存命中时闪一下 */
let loadingUiVisible = false;
/** 超过该时间仍未进首页，才展示进度页 */
const LOADING_UI_DELAY_MS = 200;

const params = new URLSearchParams(location.search);
// ?seed= 固定种子(可复现/自测)；否则每局随机种子，保证征兵等每局都不同
const fixedSeed = params.get('seed');
const seed = Number(fixedSeed ?? '1') || 1;
function nextSeed(): number {
  return fixedSeed != null ? seed : (Math.floor(Math.random() * 0x7fffffff) || 1);
}

type Screen = 'loading' | 'menu' | 'battle' | 'shop' | 'codex' | 'rank' | 'bag';

function usesMenuMusic(s: Screen): boolean {
  return s === 'menu' || s === 'codex' || s === 'rank' || s === 'bag';
}

function audioScreenKind(s: Screen): 'menu' | 'battle' | 'other' {
  if (usesMenuMusic(s)) return 'menu';
  if (s === 'battle') return 'battle';
  return 'other';
}
function safePersisted<T>(load: () => T, fallback: T): T {
  try {
    return load();
  } catch {
    return fallback;
  }
}

let screen: Screen = 'loading';

// 先加载资源，再进首页；进度页延迟 LOADING_UI_DELAY_MS，缓存秒进则不闪进度 UI
void (async () => {
  const showUiTimer = window.setTimeout(() => {
    if (screen !== 'loading') return;
    loadingUiVisible = true;
    scheduleFrame();
  }, LOADING_UI_DELAY_MS);

  try {
    await loadAssets((p) => {
      loadProgress = p;
      if (loadingUiVisible) scheduleFrame();
    });
    loadProgress = { loaded: loadProgress.total, total: loadProgress.total, phase: 'audio' };
    if (loadingUiVisible) scheduleFrame();
    await prefetchMenuBgm();
    loadProgress = { ...loadProgress, phase: 'done' };
    bootstrapMenuMusic();
    screen = 'menu';
  } finally {
    window.clearTimeout(showUiTimer);
  }
  scheduleFrame();
})();

let rank: RankState = safePersisted(loadRank, { level: 0, stars: 0, difficulty: 1 });
let stamina: Stamina = safePersisted(loadStamina, { value: STAMINA_MAX, lastTick: Date.now() });
let merit: MeritState = safePersisted(loadMerit, { merit: 0, levels: {} });
let loadout: LoadoutState = safePersisted(loadLoadout, {
  day: Math.floor(Date.now() / 86400000),
  ownedActives: [],
  ownedPassives: [],
  equipped: [],
  passives: [],
});
let bag: BagState = safePersisted(loadBag, { owned: {}, equipped: [] });
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
let bagScrollY = 0;
let bagPointerActive = false;
let bagDownX = 0, bagDownY = 0, bagDownScroll = 0, bagDragged = false;
let mapSelection: MapSelection = safePersisted(loadMapSelection, { mode: 'daily' });
let currentMap = params.get('map') ? mapById(params.get('map')!) : resolveMap(mapSelection);

/** 新开一局：在持久化玩家 skill ±1 内随机本局 AI 基础强度 */
function newBattleAiSkill(): number {
  return rollMatchAiSkill(loadAiSkill(), () => Math.random());
}

let battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, false, newBattleAiSkill());
bindBattleWeaponPickup();
let endHandled = false; // 本局胜负是否已结算入境界
let settleChange: RankChange | null = null; // 局内结算弹层要播放的段位变化
let settleStart = 0; // 打开结算弹层的时间戳（performance.now）
let endlessOn = safePersisted(loadEndlessEnabled, false); // 开局前无尽勾选（持久化）
let endlessResult: EndlessResult | null = null; // 无尽局结束展示数据
let pendingMerchant = false; // 本局已结算，回首页时弹出神秘商人
let merchant: MerchantUiState = merchantClosed();
let gameSettings: GameSettings = safePersisted(getSettings, resetSettings());

function isSettleOpen(): boolean {
  return settleChange !== null || endlessResult !== null;
}

function syncAudioFromSettings(): void {
  applyAudioVolumes(gameSettings.musicVolume, gameSettings.sfxVolume, {
    musicEnabled: gameSettings.musicEnabled,
    sfxEnabled: gameSettings.sfxEnabled,
  });
}

try {
  syncAudioFromSettings();
} catch {
  gameSettings = resetSettings();
  syncAudioFromSettings();
}
type MenuPopup = 'none' | 'settings' | 'stamina' | 'map' | 'help';
let menuPopup: MenuPopup = 'none';
let staminaPopupToast = '';
let menuSliderDrag: 'music' | 'sfx' | null = null;
let helpScrollY = 0;
let helpPointerActive = false;
let helpDragged = false;
let helpDownX = 0;
let helpDownY = 0;
let helpDownScroll = 0;

function openHelpLink(id: HelpLinkId): void {
  menuPopup = 'none';
  helpScrollY = 0;
  helpPointerActive = false;
  helpDragged = false;
  playSfx('click');
  switch (id) {
    case 'codex-unit':
      resetCodex('unit');
      screen = 'codex';
      return;
    case 'codex-hero':
      resetCodex('hero');
      screen = 'codex';
      return;
    case 'codex-monster':
      resetCodex('monster');
      screen = 'codex';
      return;
    case 'codex-skill':
      resetCodex('skill');
      screen = 'codex';
      return;
    case 'bag':
      bagToast = '';
      bagPopup = null;
      bagScrollY = 0;
      screen = 'bag';
      return;
    case 'stamina':
      staminaPopupToast = '';
      menuPopup = 'stamina';
      return;
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
    }
  }
}
let pausePhase: PausePhase = 'main';
const ui: UiState = { dragFrom: null, dragTrayIndex: null, dragPos: null, trayDragStart: null, selected: null, selectedTrayIndex: null, selectedMonster: null, passivePopup: null, passivePopupUntil: 0, activePopup: null, activePopupUntil: 0, aiItemPopup: null, paused: false };

// —— 新手引导：首次触发时机 + 各锚点闭包（引用当前 battle/merchant，battle 会随 newGame() 重新赋值） —— //
let tutorial: TutorialState = safePersisted(loadTutorialState, { seen: {} });
let tutorialOverlay: TutorialOverlay | null = null;

function buttonRect(id: string): { x: number; y: number; w: number; h: number } | null {
  const btn = getButtons(battle).find((b) => b.id === id);
  return btn ? { x: btn.x, y: btn.y, w: btn.w, h: btn.h } : null;
}

function battleIntroSequence(): TutorialSequence {
  return {
    id: 'battleIntro',
    steps: [
      {
        id: 'spawnGate',
        title: '怪物出口',
        text: '敌人会从这里的出怪口不断冒出，沿路线冲向你的唐僧。',
        getAnchor: () => {
          const gate = pathEntranceCell(battle.map.path);
          return cellRect(gate.c, gate.r);
        },
      },
      {
        id: 'tangseng',
        title: '防守目标',
        text: '这是唐僧，血量归零就会失败，务必守住他。',
        getAnchor: () => cellRect(battle.map.tangseng.c, battle.map.tangseng.r),
      },
      {
        id: 'pause',
        title: '暂停游戏',
        text: '点这里可以随时暂停游戏，方便查看局面或临时离开。',
        getAnchor: () => pauseBtnRect(),
      },
      {
        id: 'summon',
        title: '怎么征兵',
        text: '点【征兵】消耗蟠桃招募士兵和武将，是你的主要操作。',
        getAnchor: () => buttonRect('summon'),
      },
    ],
  };
}

function firstSummonSequence(): TutorialSequence {
  return {
    id: 'firstSummon',
    steps: [
      {
        id: 'unitTypes',
        title: '兵种介绍',
        text: '刀兵近战均衡、枪兵可穿透打多个目标、骑兵机动灵活、弓兵射程最远，合理搭配更抗打。',
        getAnchor: () => trayRowRect(),
      },
      {
        id: 'dragToBoard',
        title: '部署到地图',
        text: '把候选区里的令牌拖到下方绿色格子上即可放置。',
        getAnchor: () => {
          const i = findTrayIndex(battle.tray, (t) => t.kind === 'unit' || t.kind === 'word');
          return i >= 0 ? trayTokenRect(i) : trayRowRect();
        },
      },
      {
        id: 'autoplace',
        title: '一键布阵',
        text: '不想手动拖拽？点【布阵】自动帮你摆放候选区里的兵和武将。',
        getAnchor: () => buttonRect('autoplace'),
      },
    ],
  };
}

function firstPlacementAnchor(): { x: number; y: number; w: number; h: number } | null {
  const key = battle.units.keys().next().value as string | undefined;
  if (!key) return null;
  const [c, r] = key.split(',').map(Number);
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
  return cellRect(c, r);
}

function firstPlacementSequence(): TutorialSequence {
  return {
    id: 'firstPlacement',
    steps: [
      {
        id: 'attackRange',
        title: '查看攻击范围',
        text: '点击场上的兵可以查看它的攻击范围（圆环内能打到怪），再点一次取消选中。',
        getAnchor: firstPlacementAnchor,
      },
    ],
  };
}

function firstHeroWordAnchor(): { x: number; y: number; w: number; h: number } | null {
  const i = findTrayIndex(battle.tray, (t) => t.kind === 'word');
  return i >= 0 ? trayTokenRect(i) : null;
}

function firstHeroWordSequence(): TutorialSequence {
  return {
    id: 'firstHeroWord',
    steps: [
      {
        id: 'heroWord',
        title: '什么是英雄',
        text: '这是武将（英雄）字牌，代表一位有专属技能的英雄，比普通兵种更强。',
        getAnchor: firstHeroWordAnchor,
      },
    ],
  };
}

function firstShovelAnchor(): { x: number; y: number; w: number; h: number } | null {
  const i = findTrayIndex(battle.tray, (t) => t.kind === 'shovel');
  return i >= 0 ? trayTokenRect(i) : null;
}

/** 挑一个「离怪物出口最近」的锁定格作为推荐开挖点（贴合布阵后攻击范围覆盖更长路线的直觉）。 */
function firstShovelDigSpotAnchor(): { x: number; y: number; w: number; h: number } | null {
  const locked = battle.lockedCells();
  if (locked.length === 0) return null;
  const gate = pathEntranceCell(battle.map.path);
  let best = locked[0]!;
  let bestDist = Infinity;
  for (const c of locked) {
    const d = Math.hypot(c.c - gate.c, c.r - gate.r);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return cellRect(best.c, best.r);
}

function firstShovelSequence(): TutorialSequence {
  return {
    id: 'firstShovel',
    steps: [
      {
        id: 'shovelUse',
        title: '洛阳铲怎么用',
        text: '这是洛阳铲，把它拖到锁定的灰格上即可挖开，解锁新的部署位置。',
        getAnchor: firstShovelAnchor,
      },
      {
        id: 'shovelWhere',
        title: '挖哪里最好',
        text: '推荐优先挖靠近怪物出口、摆放武器后攻击范围能覆盖更长路线的区域，防守效率更高；也可以直接点【布阵】自动挖最优位置。',
        getAnchor: firstShovelDigSpotAnchor,
      },
    ],
  };
}

function firstHeroComboAnchor(): { x: number; y: number; w: number; h: number } | null {
  const g = battle.activeGenerals()[0];
  if (!g) return null;
  const [a, b] = g.cells;
  const ra = cellRect(a.c, a.r);
  const rb = cellRect(b.c, b.r);
  const x = Math.min(ra.x, rb.x);
  const y = Math.min(ra.y, rb.y);
  return { x, y, w: Math.max(ra.x + ra.w, rb.x + rb.w) - x, h: Math.max(ra.y + ra.h, rb.y + rb.h) - y };
}

function firstHeroComboSequence(): TutorialSequence {
  return {
    id: 'firstHeroCombo',
    steps: [
      {
        id: 'heroCombo',
        title: '怎么合并英雄',
        text: '把同一位武将的两张字牌拼到左右相邻，就能激活武将并获得强力效果。',
        getAnchor: firstHeroComboAnchor,
      },
    ],
  };
}

/** 在棋盘单位与候选区兵种令牌中查找一对「同兵种同等级」可合并的目标，返回其外接高亮框。 */
function firstMergeableAnchor(): { x: number; y: number; w: number; h: number } | null {
  const spots: { rect: { x: number; y: number; w: number; h: number }; type: UnitType; tier: number }[] = [];
  for (const [key, u] of battle.units) {
    const [c, r] = key.split(',').map(Number);
    spots.push({ rect: cellRect(c, r), type: u.type, tier: u.tier });
  }
  battle.tray.forEach((t, i) => {
    if (t.kind === 'unit') spots.push({ rect: trayTokenRect(i), type: t.type, tier: t.tier });
  });
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      if (canMerge({ type: spots[i]!.type, tier: spots[i]!.tier }, { type: spots[j]!.type, tier: spots[j]!.tier })) {
        const a = spots[i]!.rect;
        const b = spots[j]!.rect;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
      }
    }
  }
  return null;
}

function firstMergeableSequence(): TutorialSequence {
  return {
    id: 'firstMergeable',
    steps: [
      {
        id: 'mergeUpgrade',
        title: '合并升级武器',
        text: '同兵种同等级的两个单位拖到一起即可合并升阶，也可以直接点【布阵】自动帮你合并。',
        getAnchor: firstMergeableAnchor,
      },
    ],
  };
}

function firstFragmentDropSequence(): TutorialSequence {
  return {
    id: 'firstFragmentDrop',
    steps: [
      {
        id: 'fragmentInfo',
        title: '武器碎片是什么',
        text: '击杀怪物时有机会掉落神兵碎片，点这张卡片即可领取。',
        getAnchor: () => weaponPickupRect(0),
      },
      {
        id: 'weaponUpgrade',
        title: '怎么升级武器',
        text: '集满所需碎片会自动解锁/强化神兵，可到首页【背包】查看进度并装备。',
        getAnchor: () => weaponPickupRect(0),
      },
    ],
  };
}

function merchantFirstOpenSequence(): TutorialSequence {
  return {
    id: 'merchantFirstOpen',
    steps: [
      {
        id: 'activeSkill',
        title: '主动技能是什么',
        text: '主动技能需要在局内手动点击释放，有冷却时间，能造成爆发效果。',
        getAnchor: () => merchantActiveRowRect(),
      },
      {
        id: 'passiveSkill',
        title: '被动技能是什么',
        text: '被动技能装备后全程自动生效，无需手动操作。',
        getAnchor: () => merchantPassiveRowRect(),
      },
    ],
  };
}

function lowStaminaSequence(): TutorialSequence {
  return {
    id: 'lowStamina',
    steps: [
      {
        id: 'staminaPlus',
        title: '体力不足',
        text: '体力不够时无法开始游戏，点这里的【+】可以看广告或分享好友补充体力。',
        getAnchor: () => ({ ...STAMINA_PLUS_BTN }),
      },
    ],
  };
}

// 首次征兵后：等候选令牌飞入动画结束、真正落位到 tray 后再弹引导，避免指向还在飞行中的令牌
let pendingFirstSummonTutorial = false;

/** 局内条件触发的引导：每帧检查一次，命中即弹（只弹未展示过的第一条）。 */
function checkBattleTutorials(): void {
  if (tutorialOverlay) return;
  if (battle.status !== 'ready' && battle.status !== 'playing') return;
  if (pendingFirstSummonTutorial && summonAnimDone(battle)) {
    pendingFirstSummonTutorial = false;
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstSummonSequence());
  }
  if (tutorialOverlay) return;
  if (battle.units.size > 0) {
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstPlacementSequence());
  }
  if (tutorialOverlay) return;
  // 候选令牌飞入动画期间 tray 数据已就位但尚未落位显示，需等动画结束再检测同级可合并，避免抢在首次征兵引导之前弹出
  if (summonAnimDone(battle) && firstMergeableAnchor()) {
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstMergeableSequence());
  }
  if (tutorialOverlay) return;
  // 同理需等候选令牌落位动画结束，避免铲子还在飞入时就弹引导
  if (summonAnimDone(battle) && traySome(battle.tray, (t) => t.kind === 'shovel')) {
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstShovelSequence());
  }
  if (tutorialOverlay) return;
  // 英雄字牌需等该槽飞入动画结束再弹引导，避免指向空槽或丝带
  {
    const heroTrayIdx = findTrayIndex(battle.tray, (t) => t.kind === 'word');
    if (heroTrayIdx >= 0 && traySlotAnimDone(battle, heroTrayIdx)) {
      tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstHeroWordSequence());
    }
  }
  if (tutorialOverlay) return;
  if (battle.activeGenerals().length > 0) {
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstHeroComboSequence());
  }
  if (tutorialOverlay) return;
  if (visibleWeaponPickups().length > 0) {
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstFragmentDropSequence());
  }
}

function newGame() {
  // 使用当前(可在首页切换的)地图；每局随机种子(除非 ?seed= 固定)
  battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endlessOn, newBattleAiSkill());
  bindBattleWeaponPickup();
  endHandled = false;
  endlessResult = null;
  settleChange = null;
  ui.paused = false;
  pausePhase = 'main';
  ui.passivePopup = null;
  ui.passivePopupUntil = 0;
  ui.activePopup = null;
  ui.aiItemPopup = null;
  pendingFirstSummonTutorial = false;
}

function abortBattleToMenu(): void {
  ui.paused = false;
  pausePhase = 'main';
  ui.passivePopup = null;
  ui.passivePopupUntil = 0;
  ui.activePopup = null;
  ui.aiItemPopup = null;
  settleChange = null;
  endlessResult = null;
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
  if (id === 'help') {
    helpScrollY = 0;
    menuPopup = 'help';
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
      pushMenuFloatToast('体力不足，无法开始游戏');
      tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, lowStaminaSequence());
      scheduleFrame();
      return;
    }
    stamina = r.state;
    newGame();
    screen = 'battle';
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, battleIntroSequence());
  } else if (id === 'codex') {
    resetCodex();
    screen = 'codex';
  } else if (id === 'rank') {
    screen = 'rank';
  } else if (id === 'bag') {
    bagToast = '';
    bagPopup = null;
    bagScrollY = 0;
    screen = 'bag';
  } else {
    menuToast = '该功能开发中…';
  }
}

function handleMenuPopupPointer(x: number, y: number): boolean {
  if (menuPopup === 'none') return false;
  if (menuPopup === 'settings') {
    const hit = settingsHitAt(x, y, gameSettings, loadUserId());
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
    if (hit.kind === 'toggleMusic') {
      gameSettings = setMusicEnabled(gameSettings, !gameSettings.musicEnabled);
      syncAudioFromSettings();
      if (gameSettings.musicEnabled && usesMenuMusic(screen)) startMenuMusic();
      return true;
    }
    if (hit.kind === 'toggleSfx') {
      gameSettings = setSfxEnabled(gameSettings, !gameSettings.sfxEnabled);
      syncAudioFromSettings();
      return true;
    }
    if (hit.kind === 'copyUid') {
      const uid = loadUserId();
      if (uid) {
        void copyUserId(uid).then((ok) => {
          menuToast = ok ? 'UID 已复制' : '复制失败';
          scheduleFrame();
        });
      }
      return true;
    }
    if (hit.kind === 'musicKnob') {
      menuSliderDrag = 'music';
      gameSettings = setMusicVolume(gameSettings, settingsMusicVolumeFromX(x, loadUserId()));
      syncAudioFromSettings();
      return true;
    }
    if (hit.kind === 'sfxKnob') {
      menuSliderDrag = 'sfx';
      gameSettings = setSfxVolume(gameSettings, settingsSfxVolumeFromX(x, loadUserId()));
      syncAudioFromSettings();
      return true;
    }
    return true;
  }
  if (menuPopup === 'help') {
    const hit = helpPopupHitAt(x, y, helpScrollY, ctx);
    if (hit === null) return true;
    if (hit.kind === 'close') {
      playSfx('click');
      menuPopup = 'none';
      helpScrollY = 0;
      helpPointerActive = false;
      helpDragged = false;
      return true;
    }
    // 面板内：交给拖动滚动；轻点链接在 pointerup 处理
    helpPointerActive = true;
    helpDragged = false;
    helpDownX = x;
    helpDownY = y;
    helpDownScroll = helpScrollY;
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
  const uid = loadUserId();
  const v = menuSliderDrag === 'music' ? settingsMusicVolumeFromX(x, uid) : settingsSfxVolumeFromX(x, uid);
  if (menuSliderDrag === 'music') {
    gameSettings = setMusicVolume(gameSettings, v);
  } else {
    gameSettings = setSfxVolume(gameSettings, v);
  }
  syncAudioFromSettings();
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

function bindBattleWeaponPickup(): void {
  battle.weaponPickupVisible = (id) => !isWeaponFragmentsComplete(bag, id);
  battle.planBattleFragmentDrop();
}

function visibleWeaponPickups(): string[] {
  return battle.pendingWeaponPickups.filter((id) => !isWeaponFragmentsComplete(bag, id));
}

function claimWeaponPickup(id: string): void {
  const idx = battle.pendingWeaponPickups.indexOf(id);
  if (idx < 0) return;
  battle.pendingWeaponPickups.splice(idx, 1);
  playSfx('click');
  const r = addWeaponFragment(bag, id);
  bag = r.state;
  const name = weaponById(id)?.name ?? id;
  if (r.activated) battle.message = `激活神兵：${name}`;
  else if (r.upgraded) battle.message = `获得神兵：${name} 升阶`;
  else battle.message = `获得碎片：${name}（${r.fragments}/${r.required}）`;
}

function leaveSettleToMenu(): void {
  settleChange = null;
  endlessResult = null;
  screen = 'menu';
  if (pendingMerchant) {
    merchant = openMerchant(loadout);
    pendingMerchant = false;
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, merchantFirstOpenSequence());
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

// —— 画布尺寸 / DPR —— //
let cssScale = 1;

function isCoarseMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

function readViewport(): { w: number; h: number; offsetX: number; offsetY: number } {
  const vv = window.visualViewport;
  if (!vv) {
    return { w: window.innerWidth, h: window.innerHeight, offsetX: 0, offsetY: 0 };
  }
  return { w: vv.width, h: vv.height, offsetX: vv.offsetLeft, offsetY: vv.offsetTop };
}

/** 首次触摸时尝试进入浏览器全屏（Android 等支持；iOS 需「添加到主屏幕」） */
let mobileFullscreenTried = false;
function tryMobileFullscreen(): void {
  if (!isCoarseMobile() || mobileFullscreenTried) return;
  mobileFullscreenTried = true;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  if (document.fullscreenElement ?? doc.webkitFullscreenElement) return;
  const el = document.documentElement as HTMLElement & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  req?.().catch(() => { /* 用户拒绝或不支持 */ });
}

function resize() {
  // DPR 上限 2：3 倍屏按 3×3=9 倍像素填充，手游里 2 倍肉眼几乎无差别，却能砍掉最费电的像素填充量。
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h, offsetX, offsetY } = readViewport();
  const fit = Math.min(w / VIEW_W, h / VIEW_H);
  cssScale = fit;
  canvas.width = Math.round(VIEW_W * dpr);
  canvas.height = Math.round(VIEW_H * dpr);
  const cssW = Math.round(VIEW_W * fit);
  const cssH = Math.round(VIEW_H * fit);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  if (isCoarseMobile()) {
    canvas.style.position = 'fixed';
    canvas.style.left = `${Math.round(offsetX + (w - cssW) / 2)}px`;
    canvas.style.top = `${Math.round(offsetY + (h - cssH) / 2)}px`;
  } else {
    canvas.style.position = '';
    canvas.style.left = '';
    canvas.style.top = '';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleFrame(); // 重置画布会清空内容，静态界面需重绘一帧
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);
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
      if (!btn.id.startsWith('pas')) playSfx('click');
      if (btn.id === 'summon') {
        if (battle.summon()) pendingFirstSummonTutorial = true;
      } else if (btn.id === 'autoplace') battle.autoPlaceTray();
      else if (btn.id === 'act0') { if (battle.activeSlots[0]?.ready) battle.triggerActive(0); else { ui.activePopup = 0; ui.activePopupUntil = performance.now() + 2500; } }
      else if (btn.id === 'act1') { if (battle.activeSlots[1]?.ready) battle.triggerActive(1); else { ui.activePopup = 1; ui.activePopupUntil = performance.now() + 2500; } }
      else if (btn.id.startsWith('pas')) {
        ui.aiItemPopup = null;
        ui.passivePopup = Number(btn.id.slice(3));
        ui.passivePopupUntil = performance.now() + 2500;
      } // 点击被动图标看详情
      else if (btn.id === 'restart') screen = 'menu'; // 结束后返回主菜单（看更新的境界/体力）
      return true;
    }
  }
  return false;
}

function onPointerDown(e: PointerEvent) {
  e.preventDefault();
  if (screen === 'loading') return; // 加载中不响应点击（BGM 仍可在进首页后由首次手势唤醒）
  resumeAudioAfterGesture(audioScreenKind(screen), currentMap.id);
  const { x, y } = toLogical(e.clientX, e.clientY);
  // 新手引导展示中：拦截全部点击，仅响应「跳过引导」或前进到下一步
  if (tutorialOverlay) {
    const hit = tutorialHitAt(ctx, x, y, tutorialOverlay);
    playSfx('click');
    const res = hit.kind === 'skip' ? skipTutorial(tutorialOverlay, tutorial) : advanceTutorial(tutorialOverlay, tutorial);
    tutorialOverlay = res.overlay;
    tutorial = res.state;
    return;
  }
  if (screen === 'menu') {
    if (handleMerchantPointer(x, y)) return;
    if (handleMenuPopupPointer(x, y)) {
      if (menuSliderDrag || helpPointerActive) canvas.setPointerCapture(e.pointerId);
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
    if (codexHitBack(x, y)) {
      screen = 'menu';
      return;
    }
    if (codexPointerDown(x, y)) {
      canvas.setPointerCapture(e.pointerId);
      scheduleFrame();
    }
    return;
  }
  if (screen === 'rank') {
    if (leaderboardHitBack(x, y)) screen = 'menu';
    return;
  }
  if (screen === 'bag') {
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
    bagPointerActive = true;
    bagDragged = false;
    bagDownX = x;
    bagDownY = y;
    bagDownScroll = bagScrollY;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (isSettleOpen()) {
    const pickupId = weaponPickupHitAt(x, y, visibleWeaponPickups(), bag);
    if (pickupId) {
      claimWeaponPickup(pickupId);
      return;
    }
    if (endlessResult || isSettleAnimDone(performance.now() - settleStart)) {
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
  // AI 道具详情弹窗：任意点击先关闭（消费本次点击）
  if (ui.aiItemPopup !== null) { ui.aiItemPopup = null; return; }
  const aiChip = hitAiItemChip(x, y, battle);
  if (aiChip !== null) {
    ui.passivePopup = null;
    ui.activePopup = null;
    ui.aiItemPopup = ui.aiItemPopup === aiChip ? null : aiChip;
    clearBoardSelect();
    return;
  }
  const pickupId = weaponPickupHitAt(x, y, visibleWeaponPickups(), bag);
  if (pickupId) {
    claimWeaponPickup(pickupId);
    return;
  }
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
canvas.addEventListener('pointerdown', (e) => { tryMobileFullscreen(); onPointerDown(e); scheduleFrame(); });
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
    if (helpPointerActive && menuPopup === 'help') {
      const dy = y - helpDownY;
      if (Math.abs(dy) > 6) helpDragged = true;
      helpScrollY = Math.max(0, Math.min(helpMaxScroll(ctx), helpDownScroll - dy));
      scheduleFrame();
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
  if (screen === 'bag' && bagPointerActive && !bagPopup) {
    const { y } = toLogical(e.clientX, e.clientY);
    const dy = y - bagDownY;
    if (Math.abs(dy) > 6) bagDragged = true;
    bagScrollY = Math.max(0, Math.min(bagMaxScroll(), bagDownScroll - dy));
    scheduleFrame();
    return;
  }
  if (screen === 'codex') {
    const { x, y } = toLogical(e.clientX, e.clientY);
    codexPointerMove(x, y);
    scheduleFrame();
    return;
  }
  if (!ui.dragFrom && ui.dragTrayIndex === null) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
  scheduleFrame(); // 拖拽中持续重绘（战斗界面本就连续；此处保证拖影跟手）
}
function onPointerUp(e?: PointerEvent, cancelled = false) {
  if (screen === 'menu') {
    menuSliderDrag = null;
    if (helpPointerActive) {
      const upX = e && !cancelled ? toLogical(e.clientX, e.clientY).x : helpDownX;
      const upY = e && !cancelled ? toLogical(e.clientX, e.clientY).y : helpDownY;
      const wasDrag = helpDragged;
      helpPointerActive = false;
      helpDragged = false;
      if (!cancelled && !wasDrag) {
        const hit = helpPopupHitAt(upX, upY, helpScrollY, ctx);
        if (hit?.kind === 'link') openHelpLink(hit.id);
      }
      return;
    }
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
  if (screen === 'bag') {
    if (bagPointerActive && !bagDragged && !bagPopup) {
      const hit = bagHitAt(bagDownX, bagDownY, bag, bagScrollY);
      if (hit?.kind === 'back') screen = 'menu';
      else if (hit?.kind === 'toggle') bagPopup = hit.id;
    }
    bagPointerActive = false;
    return;
  }
  if (screen === 'codex') {
    if (e && !cancelled) {
      const { x, y } = toLogical(e.clientX, e.clientY);
      const action = codexPointerUp(x, y, loadout);
      if (action) {
        playSfx('click');
        if (action.kind === 'unequip') {
          loadout = action.skillKind === 'active'
            ? unequipActive(loadout, action.id)
            : unequipPassive(loadout, action.id);
          setCodexToast('已卸下');
        } else {
          const res = action.skillKind === 'active'
            ? equipActive(loadout, action.id)
            : equipPassive(loadout, action.id);
          loadout = res.loadout;
          setCodexToast(res.ok ? '已装备' : (res.reason ?? (action.skillKind === 'active' ? ACTIVE_FULL_HINT : PASSIVE_FULL_HINT)));
        }
      }
    } else {
      codexPointerUp();
    }
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
    } else if (ui.dragFrom) {
      if (trayTarget !== null && !battle.tray[trayTarget]) {
        battle.recallToTray(ui.dragFrom, trayTarget);
        clearBoardSelect();
      } else if (target) {
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
  }
  ui.dragFrom = null;
  ui.dragTrayIndex = null;
  ui.dragPos = null;
  ui.trayDragStart = null;
}

// 桌面端滚轮滚动商城
canvas.addEventListener('wheel', (e) => {
  if (screen === 'menu' && menuPopup === 'help') {
    e.preventDefault();
    helpScrollY = Math.max(0, Math.min(helpMaxScroll(ctx), helpScrollY + e.deltaY));
    scheduleFrame();
    return;
  }
  if (screen === 'shop') {
    e.preventDefault();
    shopScrollY = Math.max(0, Math.min(SHOP_MAX_SCROLL(), shopScrollY + e.deltaY));
    scheduleFrame(); // 按需重绘：滚轮滚动后重画商城
    return;
  }
  if (screen === 'bag' && !bagPopup) {
    e.preventDefault();
    bagScrollY = Math.max(0, Math.min(bagMaxScroll(), bagScrollY + e.deltaY));
    scheduleFrame();
    return;
  }
  if (screen === 'codex') {
    e.preventDefault();
    codexWheel(e.deltaY);
    scheduleFrame();
  }
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
  if (screen === 'loading') return loadingUiVisible;
  if (screen === 'menu') return true;
  if (screen === 'battle') {
    if (isSettleOpen()) {
      return !isSettleAnimDone(performance.now() - settleStart) || visibleWeaponPickups().length > 0;
    }
    return !ui.paused;
  }
  if (screen === 'codex') return codexNeedsAnim();
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
  // 首页及背包/图鉴/排行仍播首页 BGM；战斗播地图氛围音；其余界面静音。均幂等。
  if (usesMenuMusic(screen)) startMenuMusic();
  else if (screen !== 'battle') stopAmbient();
  if (screen === 'loading') {
    if (loadingUiVisible) drawLoadingScreen(ctx, loadProgress, now);
    else drawLoadingBackdrop(ctx);
  } else if (screen === 'menu') {
    updateMenuFloatToasts(dt);
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
    if (menuPopup === 'settings') drawSettingsPopup(ctx, gameSettings, loadUserId());
    else if (menuPopup === 'stamina') drawStaminaPopup(ctx, stamina.value, staminaPopupToast);
    else if (menuPopup === 'map') drawMapPopup(ctx, mapSelection, pickDailyMap().name);
    else if (menuPopup === 'help') drawHelpPopup(ctx, helpScrollY);
    if (merchant.open) {
      updateMerchantFloatToasts(dt);
      drawMerchant(ctx, merchant, loadout, merit, {
        equipTutorialPreview: tutorialOverlay?.sequenceId === 'merchantFirstOpen',
      });
      drawMerchantFloatToasts(ctx);
    }
    drawMenuFloatToasts(ctx);
  } else if (screen === 'shop') {
    drawShop(ctx, merit, loadout, shopToast, shopScrollY);
    if (shopPopup) drawShopPopup(ctx, shopPopup, merit, loadout);
  } else if (screen === 'codex') {
    drawCodex(ctx, loadout);
  } else if (screen === 'rank') {
    drawLeaderboard(ctx, rank.level);
  } else if (screen === 'bag') {
    drawBag(ctx, bag, bagToast, bagScrollY);
    if (bagPopup) drawBagPopup(ctx, bag, bagPopup);
  } else {
    // —— 战斗（含局内结算弹层） —— //
    // 新手引导展示期间强制唐僧渲染于归位点，避免引导指向的格子里唐僧还没走到（不影响 introT 计时）
    battle.tangsengRenderOverride = !!tutorialOverlay;
    // 结算弹层 / 暂停 / 引导时冻结战斗（不 step），仍连续重绘以播动画
    if (!ui.paused && !tutorialOverlay && !isSettleOpen()) {
      try {
        battle.step(dt);
      } catch (err) {
        console.error('[battle.step]', err);
        battle.message = '战斗逻辑异常，已跳过本帧（请刷新页面）';
      }
      checkBattleTutorials();
    }
    startAmbient(currentMap.id); // 进入对战启动该地图氛围音（幂等）
    // 播放引擎发出的音效事件
    if (battle.sfxEvents.length) {
      for (const ev of battle.sfxEvents) playSfx(ev);
      battle.sfxEvents.length = 0;
    }
    // 胜负结算入境界 + 功德（仅一次），随后在战斗页弹出结算层
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost')) {
      endHandled = true;
      pendingMerchant = true;

      if (battle.endless) {
        // 无尽：不涨降境界，只记录最高波数；仍发放功德（软奖励，与星级解耦）
        const gain = meritReward(false, battle.wave, { endless: true });
        merit = addMerit(merit, gain);
        const isRecord = recordBestWave(battle.wave);
        endlessResult = { wave: battle.wave, best: getBestWave(), isNewRecord: isRecord, merit: gain };
        settleChange = null;
        battle.message = `抵达第 ${battle.wave} 波（功德 +${gain}）`;
        settleStart = performance.now();
      } else {
        const won = battle.status === 'won';
        // 对战连胜：下一局按档位隐藏加压（70% / 80% / 全力）
        recordVersusOutcome(won);
        const change = won ? recordWin(rank) : recordLose(rank);
        rank = change.state;
        const gain = meritReward(won, battle.wave);
        merit = addMerit(merit, gain);
        battle.message = `${battle.message}（功德 +${gain}）`;
        endlessResult = null;
        settleChange = change;
        settleStart = performance.now();
      }
    }
    setHudRank(rankName(rank.level));
    draw(ctx, battle, ui);
    if (endlessResult) drawEndlessSettle(ctx, endlessResult, now - settleStart);
    else if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
    drawWeaponPickups(ctx, visibleWeaponPickups(), bag);
    if (ui.paused && !isSettleOpen()) drawPausePopup(ctx, pausePhase);
  }
  if (tutorialOverlay) drawTutorialOverlay(ctx, tutorialOverlay, now);
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
  if (usesMenuMusic(screen)) void bootstrapMenuMusic();
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
  openCodex: () => { resetCodex(); screen = 'codex'; scheduleFrame(); },
  openRank: () => { screen = 'rank'; scheduleFrame(); },
  openBag: () => { bagPopup = null; bagScrollY = 0; screen = 'bag'; scheduleFrame(); },
  grantWeapon: (id: string) => { bag = addWeapon(bag, id).state; },
  grantMerit: (n: number) => { merit = addMerit(merit, n); },
  tuning: TUNING,
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => {
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endless ?? false, newBattleAiSkill());
    bindBattleWeaponPickup();
    endHandled = false;
    endlessResult = null;
    settleChange = null;
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
