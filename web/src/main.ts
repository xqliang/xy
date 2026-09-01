// 引导 + 游戏循环 + 指针交互 + 自测钩子（window.__game）。
import { Battle, TUNING, MAP_ELEMENT, findTrayIndex, traySome, trayTokens } from './battle';
// 统一「刷新续玩」全状态持久化（PvP/PvE 共用）。Task 2 接 PvE：开机恢复 + 帧尾落档 + 终局清档。
// Task 6 已退役旧 ./battle-save 的续玩路径：main.ts 不再导入/调用 loadResumeBattle / saveResumeCheckpoint /
// clearBattleSave / readBattleSave（tryResumeLocalBattle 函数亦已删除）；开机恢复、帧尾落档、终局清档一律走 dasheng.session。
// 注意：./battle-save.ts 文件本身保留——pvp-save.ts 仍从中取类型 BattleSaveConfig / BattleCoreState（及 migrateCoreGeneralIds）。
import { readSession, restoreBattle, sessionSaveCheckpoint, clearSessionSave, type SessionSaveV1, type SessionSaveCheckpointIo } from './pvp-save';
import { pushBattleToast, updateBattleToasts, drawBattleToasts, clearBattleToasts, peekBattleToast } from './battle-toast';
import { activeById, isBombActiveEffect, isDragActiveEffect } from './actives';
import { canMerge, ELEMENT_ZH } from '@core';
import type { UnitType } from '@core';
import {
  draw,
  getButtons,
  pxToCell,
  trayIndexAt,
  setHudRank,
  VIEW_W,
  VIEW_H,
  HUD_H,
  hitPauseBtn,
  hitShareShovelBtn,
  hitMonsterAt,
  hitAiItemChip,
  hitPeachHud,
  isPlayerTangsengCell,
  isAiTangsengCell,
  pauseBtnRect,
  peachHudRect,
  cellRect,
  trayTokenRect,
  trayRowRect,
  summonAnimDone,
  setPvpNetLatency,
  traySlotAnimDone,
  drawGuideArrow,
  summonButtonRect,
  guideSkipRect,
  drawGuideSkip,
  drawDeployGuideDemo,
  drawShovelGuideDemo,
  drawSkillGuideDemo,
  introHopY,
  mapBadgeRect,
  activeSlotRect,
  drawGameStartHint,
  stepGameStartHint,
  type GameStartHintState,
  setQualityTier,
  drawScreenBackdrop,
  takeScrim,
  drawFpsOverlay,
  type UiState,
} from './render';
import type { Cell } from './board';
import { pickDailyMap, mapById, MAPS, pathEntranceCell } from './board';
import { loadMapSelection, saveMapSelection, resolveMap, type MapSelection } from './map-select';
import { loadAssets, type AssetLoadProgress } from './assets';
import { drawLoadingScreen } from './loading-screen';
import { hasFinishedGame, markGameFinished, pvpUnlocked } from './play-history';
import { showAutoplaceBtn, wuxingEnabled } from './dev-flags';
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
// Task 9.5：暂停改退出的纯决策（弹窗模态 vs 仿真暂停的拆分），抽到 pvp-pause.ts 以便单测。
import { isPausePopupOpen as isPausePopupOpenPure, shouldStepSim, pausePopupContext } from './pvp-pause';
import { drawInkPopupFrame, drawPlainPopupFrame, drawInkActionButton, inkPopupCloseRect } from './menu-ui'; // Task 7.6：断线弹窗复用卷轴框 + 水墨按钮；续玩弹窗用简化普通框（无宫檐）
import { loadRank, recordWin, recordLose, rankName, type RankState, type RankChange } from './rank';
import { drawSettle, isSettleAnimDone, SETTLE_ANIM_MS, drawEndlessSettle, type EndlessResult, drawPvpSettle, type PvpSettleResult, REASON_SELF_TANGSENG_DEAD_OPP_GONE } from './settle';
import { pvpSettle } from './pvp-settle';
import { loadEndlessEnabled, setEndlessEnabled, recordBestWave, getBestWave } from './endless';
import { loadStamina, addStamina, spendStamina, syncStamina, STAMINA_MAX, STAMINA_COST, type Stamina } from './stamina';
import { drawMenu, menuButtonAt, menuVersionHitAt, STAMINA_PLUS_BTN } from './menu';
import * as pvpClient from './api/pvp-client';
import { loadMerit, metaBonuses, meritReward, addMerit, type MeritState } from './merit';
import {
  loadLoadout,
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
import type { CodexTab } from './codex';
import { drawWeaponPickups, weaponPickupHitAt, weaponPickupRect } from './weaponPickup';
import { loadBag, addWeapon, addWeaponFragment, toggleEquip, weaponBonuses, weaponById, isWeaponFragmentsComplete, type BagState } from './weapons';
import { playSfx, startAmbient, startMenuMusic, stopAmbient, applyAudioVolumes, prefetchMenuBgm, bootstrapMenuMusic, resumeAudioAfterGesture } from './sfx';
import { showRewardedAd } from './ads';
import { getGameCanvas, onAppHide, onAppShow, isWeChat, onNetworkOnline, onWxTouch, type WxTouchEvent, getVersusInviteCode, shareVersusInvite, shareToFriend, onWxShowVersus, getViewportSize } from './platform';
import { fpsMeterTick, type QualityTier, type FpsMeterState } from './quality';
import { canShare, consumeShare, remainingShares } from './share-quota';
import { loadUserId, copyUserId, ensureUserId } from './user-id';
import {
  cloudLogin,
  scheduleCloudSync,
  submitLeaderboard,
  syncAvatarUnlocks,
  updateProfile,
} from './cloud-sync';
import { bootstrapAuth, getToken, clearToken } from './auth';
import { apiFetch } from './api/client';
import { track } from './telemetry';
import { bumpClearCount } from './clear-count';
import { loadProfile } from './profile';
import { avatarById } from './avatar-catalog';
import {
  createProfilePopupState,
  drawProfilePopup,
  profilePopupHitAt,
  applyProfileScrollDrag,
  clampProfileScroll,
  profileCopyToastAnchorY,
  profileConfirmToastAnchorY,
  type ProfilePopupState,
  type ProfileScrollDrag,
} from './profile-popup';
import { openNicknameEditor, closeNicknameEditor } from './nickname-editor';
import { clampNickname } from './nickname';
import { loadAiSkill, recordVersusOutcome, rollMatchAiSkill } from './ai-skill';
import { loadHeroMatchHistory, recordHeroMatchGame } from './hero-match-history';
import {
  getSettings,
  resetSettings,
  setShowDamageNumbers,
  setMusicEnabled,
  setFxLite,
  setSfxEnabled,
  setMusicVolume,
  setSfxVolume,
  type GameSettings,
} from './settings';
import type { HelpLinkId } from './menu-help';
import type { MerchantUiState } from './merchant';
import {
  loadTutorialState,
  maybeStartTutorial,
  hasSeenTutorial,
  advanceTutorial,
  skipTutorial,
  tutorialHitAt,
  drawTutorialOverlay,
  type TutorialState,
  type TutorialOverlay,
  type TutorialSequence,
  type TutorialStep,
} from './tutorial';
import type { ApplyUserResult } from './devtools';

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
// 静置菜单/匹配页的目标帧间隔（~30fps）：这两个界面里真正动的只有大圣 ±5px 浮动和
// 开始按钮扫光，其余全是静态像素；60fps 满帧重绘纯烧电（手机发热主因之一）。
// 交互（触摸/滚轮）后 1s 内恢复 60fps，保证按下反馈/拖动跟手。
const MENU_FRAME_MS = 1000 / 30 - 2;
let lastMenuInputAt = -1e9; // 上次菜单交互时刻（performance.now 基）；初始远古→开机即 30fps
const MENU_INPUT_BURST_MS = 1000;
// 帧率自适应特效档位状态（见 frame()）：frameMsEma=平滑帧时(ms)，qualityTier=当前画质档(high/mid/low)。
// qualityTierSwitchAt=上次切档时刻（rAF 时基）：时间迟滞（最短驻留 3s）用——弱机上开关式降载
// （如关阴影）省的帧时超过阈值迟滞带，降↔升正反馈震荡（阴影「有时无」闪烁），驻留期禁止再切。
let frameMsEma = 0;
let qualityTier: QualityTier = 'high';
let qualityTierSwitchAt = 0;
// FPS 调试显示：连点版本号 7 次开关（全平台含微信——纯 canvas 绘制，不依赖 DOM）。
// fpsMeter 为滚动窗口统计（quality.ts 纯函数），frame() 每真绘制帧推进一次。
let fpsOverlayOn = false;
let fpsMeter: FpsMeterState = { windowStart: -1, frames: 0, fps: 0, durAcc: 0, durMs: 0 };

// 画质档（2 档手动，用户设置驱动；2026-09-01 用户拍板替代 EMA 自动调档——自动调档在
// 临界设备上让阴影「偶尔出现/消失」，改为「特效全开（默认）/精简」设置项，见 settings.fxLite）。
// 经 render.setQualityTier 同步档位 + 刷新标量（标量反喂 setFxQuality 供粒子缩放）。
function applySettingsFxTier(): void {
  qualityTier = gameSettings.fxLite ? 'low' : 'high';
  setQualityTier(qualityTier);
  qualityTierSwitchAt = performance.now();
}

// 切后台暂停：停 rAF 循环与背景音；若在匹配屏则放弃匹配（cancel 服务端 ticket，防残留被别人匹配到）。
onAppHide(() => { pauseLoop(); abandonPvpMatching(); });
onAppShow(() => { resumeLoop(); pvpSock?.reconnectNow(); }); // 回前台：若 PvP 断线等退避，跳过等待立即重连（弱网优化③）

// 菜单降频的交互唤醒：capture 阶段监听指针/滚轮（只打时间戳，不开销），用于
// 「静置 30fps、交互后 1s 内 60fps」的帧预算切换。所有游戏输入都落在 canvas 上，
// 挂在 canvas 上即可；passive 保证不阻塞滚动/合成。
if (typeof canvas.addEventListener === 'function') {
  const markMenuInput = () => { lastMenuInputAt = performance.now(); };
  canvas.addEventListener('pointerdown', markMenuInput, { capture: true, passive: true });
  canvas.addEventListener('pointermove', markMenuInput, { capture: true, passive: true });
  canvas.addEventListener('wheel', markMenuInput, { capture: true, passive: true });
}

let loadProgress: AssetLoadProgress = { loaded: 0, total: 1, phase: 'images' };
/** 资源已在加载，但进度页延迟显示，避免本地缓存命中时闪一下 */
let loadingUiVisible = false;
/** 超过该时间仍未进首页，才展示进度页 */
const LOADING_UI_DELAY_MS = 200;

const params = new URLSearchParams(location.search);
const versusCode = getVersusInviteCode(); // 好友邀请：Web 取 URL ?versus=，小游戏取启动参数 query.versus
// ?seed= 固定种子(可复现/自测)；否则每局随机种子，保证征兵等每局都不同
const fixedSeed = params.get('seed');
const seed = Number(fixedSeed ?? '1') || 1;
function nextSeed(): number {
  return fixedSeed != null ? seed : (Math.floor(Math.random() * 0x7fffffff) || 1);
}

type Screen = 'loading' | 'menu' | 'battle' | 'codex' | 'rank' | 'bag' | 'pvpMatching';

function usesMenuMusic(s: Screen): boolean {
  return s === 'menu' || s === 'codex' || s === 'rank' || s === 'bag' || s === 'pvpMatching';
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

// —— 非战斗核心屏幕/弹窗懒加载：各自独立分包，减小首屏主包体积 —— //
// ensure()：确保模块已加载后再执行回调（用于"进入该屏幕/弹窗"的入口，需先加载完成才能改 screen/弹窗态，
//   保证一旦 screen 切到目标值，对应模块必已加载，故其余使用处可用 get()! 免判空）。
// prefetch()：不阻塞地提前触发加载（用于"几乎必然很快会用到"的模块，如结算后必弹的神秘商人）。
function lazyModule<M>(loader: () => Promise<M>) {
  let mod: M | null = null;
  let pending: Promise<M> | null = null;
  const prefetch = (): Promise<M> => (pending ??= loader().then((m) => { mod = m; return m; }));
  return {
    get: () => mod,
    ensure: (cb: (m: M) => void): void => { if (mod) { cb(mod); return; } void prefetch().then(cb); },
    prefetch,
  };
}
const codexLazy = lazyModule(() => import('./codex'));
const bagLazy = lazyModule(() => import('./bag'));
const leaderboardLazy = lazyModule(() => import('./leaderboard'));
const menuHelpLazy = lazyModule(() => import('./menu-help'));
const menuPopupsLazy = lazyModule(() => import('./menu-popups'));
const merchantLazy = lazyModule(() => import('./merchant'));
const pvpMatchLazy = lazyModule(() => import('./pvp-match'));
const pvpScreenLazy = lazyModule(() => import('./pvp-screen'));
import { drainFixedSteps, PVP_SIM_DT, pvpWaveStartTick } from './pvp-fixedstep'; // PvP 固定步长累加器 + 波起始纪元→tick（Task 9；DELAY_TICKS 延迟重放已随确定性重放拆除）
import { PvpSocket, type PvpSocketOpts } from './pvp-ws';                                 // PvP WS 连接层（Task 3）：连/重连/消息分发 + 上行发送
import { netDead, netRecovered } from './pvp-netwatch';             // PvP 断线看门狗纯判定（>10s 无入站→判死 / 恢复→解冻；Task 7.6 + A1-lite）
import { PvpOppView, normalizeSnapClock } from './pvp-snap';            // 对手双缓冲插值视图 + 跨机时钟归一（Task 4/Task 5）
import type { PvpSnap } from './pvp-snap';                             // 快照类型（onOppSnap 归一化入参类型标注）

function enterCodex(tab?: CodexTab): void {
  codexLazy.ensure((m) => {
    m.resetCodex(tab);
    screen = 'codex';
    scheduleFrame();
  });
}
function enterBag(): void {
  bagLazy.ensure(() => {
    bagToast = '';
    bagPopup = null;
    bagScrollY = 0;
    screen = 'bag';
    scheduleFrame();
  });
}
function enterRank(): void {
  leaderboardLazy.ensure((m) => {
    m.invalidateLeaderboardCache();
    m.ensureLeaderboardLoaded(() => scheduleFrame());
    screen = 'rank';
    scheduleFrame();
  });
}
function openSettingsPopup(): void {
  menuPopupsLazy.ensure(() => { menuPopup = 'settings'; scheduleFrame(); });
}
function openStaminaPopup(): void {
  menuPopupsLazy.ensure(() => { staminaPopupToast = ''; staminaSharesLeft = remainingShares('stamina'); menuPopup = 'stamina'; scheduleFrame(); });
}
function openMapPopup(): void {
  menuPopupsLazy.ensure(() => { menuPopup = 'map'; mapScrollY = 0; scheduleFrame(); });
}

// PvP 网络适配：把 pvp-client 的五个函数组成 PvpMatchNet 对象喂给状态机。
// 注（Task 6 退役）：旧模型曾把本方 loadout 经闭包烘焙进 enqueue/roomCreate/roomJoin 上交服务端，
// WS 快照模型无消费方（对手侧从快照本地插值重建），故回退为直接透传五个 client 函数。
const pvpNet = {
  enqueue: (rank: number) => pvpClient.versusEnqueue(rank),
  poll: pvpClient.versusPoll, cancel: pvpClient.versusCancel,
  forfeit: pvpClient.versusForfeit,
  roomCreate: (rank: number) => pvpClient.versusRoomCreate(rank),
  roomJoin: (code: string) => pvpClient.versusRoomJoin(code),
};
// 集成缝：匹配成功 → 真正开一局 PvP 对局（Plan C Task 5，WS 快照模型）。
// 本方 battle 本地权威实时 step；建对手插值视图 + PvpSocket（每 100ms 发本方快照、收对手快照/波次/终局）、
// 扣体力、切战斗屏。确定性重放机器（oppBattle/PvpSync/1s tick）已拆除，单人不走此函数。
//
// PvpSocket 的下行回调集合（除 matchId/uid 外）被 onPvpMatched 与 resumePvpSession（刷新恢复）共用，
// 抽到 makePvpCallbacks() 一处定义避免复制粘贴漂移；恢复路径在其上覆盖 onWelcome（快进）并追加 onHelloFail（回首页）。
/**
 * 构造 onPvpMatched / resumePvpSession 共用的 PvpSocket 回调集合。
 * 这些闭包引用模块级可变态（oppView/pvpResult/battle/pvpMatchStartMs/pvpWaveStartTicks…），
 * 仅在运行期（对局中，模块已初始化）被调用，故不涉 TDZ。返回不含 matchId/uid/onHelloFail——
 * 前二者每次调用不同、后者仅恢复路径需要（普通对局不重连交看门狗兜底）。
 */
function makePvpCallbacks(): Partial<PvpSocketOpts> {
  return {
    // A4：每次连接取最新 token（重连也刷新），避免烘焙的旧 token 过期后连不上。
    tokenProvider: () => getToken() ?? undefined,
    // A4：连续重连达阈值时探活——打一个 require_auth 的轻量 GET；401=令牌失效。
    // 非 strict 灰度期服务端回退 X-Uid 不会 401，与 WS 同步（那时 WS 也不会因鉴权失败），故不会误短路。
    authProbe: async () => {
      const r = await apiFetch('/api/leaderboard/daily?limit=1', { method: 'GET' });
      return !(r.ok === false && r.status === 401);
    },
    // A4：令牌失效 → 清 token + 退出对局 + 回首页提示重登。
    onAuthFail: () => {
      clearToken();
      endPvpSession();
      screen = 'menu';
      pushMenuFloatToast('登录已失效，请重新进入');
      scheduleFrame();
    },
    onWelcome: (_serverMs) => { /* 对时暂留空：快照时钟已由 normalizeSnapClock 归一化到本机时基，无需 serverMs */ },
    onOppSnap: (s) => {
      if (!oppView) return;
      // 跨机时钟归一：把发送端时刻的快照平移到本机时基再 ingest（interpAt/fx 老化用本机 nowMs，跨机钟差不可混用）。
      const snap = s as PvpSnap;
      normalizeSnapClock(snap, Date.now());
      oppView.ingest(snap);
      // 记最近一次收到对手快照的时刻（performance.now() 时基——与 frame() 的 rAF now、
      // oppReconnected 的入参同时基）：对方断线倒计时期间若重连（新手快照）则撤弹窗。
      // ⚠️ 曾用 Date.now()（epoch 时基）与时基差 ~1.7e12ms → oppReconnected 恒 true →
      // oppGone 弹窗被「假重连」秒撤（用户观察「对方断线一直没提示」的根因，2026-09-01 修）。
      pvpLastSnapRecv = performance.now();
    },
    onNextWave: (wave, startAtServerMs) => {
      // 沿用旧 tick-response：服务端纪元 → 本地开波 tick 缓存；pvpNextWave 存原始值（兼容旧语义）。
      const st = pvpWaveStartTick(startAtServerMs, pvpMatchStartMs);
      pvpWaveStartTicks.set(wave, st);
      pvpNextWave = { wave, startAtServerMs };
    },
    onResult: (r) => { pvpResult = r; }, // 服务端权威终局 → frame() 结算门控消费（不变）
    onOppGone: () => {
      // 对手断线：立即在上半区弹「对方断线」+ 10s 倒计时，倒计时结束判我方胜。
      // 若已终局（pvpResult 非空）则不重复触发；握手阶段早退避免误弹。
      if (pvpResult) return;
      pvpOppGone = true;
      pvpOppGoneStart = performance.now();
      battle.message = '对手网络中断…';
    }, // 倒计时与判胜由 frame() 驱动
    onNoShow: () => {
      // C5：对手全程未应战(打空气)。已终局则不触发；由 frame() 退体力+自动重匹配。
      if (pvpResult) return;
      pvpNoShow = true;
    },
  };
}
function onPvpMatched(ms: import('./api/pvp-client').MatchStart): void {
  pvpController = null;
  const map = mapById(ms.map) ?? currentMap;
  const meta = metaBonuses(merit), wb = weaponBonuses(bag);
  // PvP 固定 difficulty=1（两端同 seed→同怪，跨机确定；强弱由各自 loadout/战力经 wavePressure 体现=各算各的）。
  // 本方 battle 用本方 meta/wb/equipped/passives（本方侧权威）。
  // aiSkill=undefined→DEFAULT_AI_SKILL；heroMatch=undefined；pvpInit 关本地 AI（pvp 时本机不收 AI）。
  battle = new Battle(ms.seed, 1, map, meta, wb, loadout.equipped, loadout.passives, false, undefined, 1, undefined, { enabled: true });
  bindBattleWeaponPickup();
  battle.rollIntroSpeech(Math.random()); // 开局唐僧出场气泡：50% 概率随机一句（展示层掷随机，不占 sim RNG）
  // 对手半场 = WS 快照插值视图（不再确定性重放）。PvpOppView 双缓冲，每收到一份对手快照 ingest 一份。
  oppView = new PvpOppView();
  // WS 连接：本方权威半场每 100ms 发快照；下行 oppSnap→插值视图、nextWave→开波排程、result→结算、oppGone→提示。
  // uid 复用 user-id 的 ensureUserId（与 apiFetch 的 X-Uid 同源，不另起存储）。回调集合与恢复路径共用（makePvpCallbacks）。
  pvpSock = new PvpSocket({ matchId: ms.matchId, uid: ensureUserId(), ...makePvpCallbacks(), wsFactory: pvpWsFactoryOverride ?? undefined });
  pvpSock.connect();
  // 对局态 reset：本方权威时钟归零、终局/波次/认输/结算归零。
  pvpAcc = 0; localSimTick = 0; pvpLastSnapMs = 0; pvpLastSnapRecv = 0; pvpNextWave = null; pvpResult = null; pvpStatusReported = false;
  pvpSaveDirty = false;                  // 新对局从干净脏标起步，避免上一局残留脏标为新局提前触发落档
  pvpNetDead = false; pvpNetDeadStart = 0; pvpOppGone = false; pvpOppGoneStart = 0; pvpNoShow = false; // 新对局从干净态开始（上次对局若被判死，endPvpSession 已清；这里再兜底一次）
  pvpOpponent = ms.opponent; pvpSurrendered = false; pvpSettleResult = null; pvpSettleStart = 0;
  // 座位 side：MatchStart 未下发座位（服务端按 uid+matchId 识别，不靠 side），且 restoreBattle 不按 side 分支，
  // 故 side 仅供存档/恢复对称性，无实际战斗分流意义 → 默认 'a'（恢复时由 save.pvp.side 覆盖为真值）。
  pvpSide = 'a';
  pvpMatchStartMs = ms.startAtServerMs; pvpWaveStartTicks.clear(); pvpPrevWaveActive = false;
  // 真正开打才扣体力（入口 gate 已保证 value ≥ COST，这里再花一次）
  const sp = spendStamina(stamina);
  if (sp.ok) stamina = sp.state;
  // reset 战斗标志（镜像 newGame）
  endHandled = false; endlessResult = null; settleChange = null; ui.paused = false; pvpExitPopup = false; pausePhase = 'main';
  ui.passivePopup = null; ui.passivePopupUntil = 0; ui.activePopup = null; ui.aiItemPopup = null; ui.peachPopup = false; ui.bombPopup = null; pendingFirstSummonTutorial = false;
  screen = 'battle';
  armGameStartHint();
  scheduleFrame();
}

/** 结束当前 PvP 对局并清理所有对局态（所有「离开 battle 屏」的路径都必须调用；幂等）。
 *  单人时这些字段本就是 null/0，调用无副作用。关 WS 最前（否则残留连接会继续重连/收快照）。 */
function endPvpSession(): void {
  pvpSock?.close();            // 关 WS：置 closed、让挂起重连计时器失效、关底层 socket（之后永不重连）
  pvpSock = null; oppView = null;
  pvpResult = null; pvpNextWave = null; pvpSettleResult = null; pvpOpponent = null;
  pvpSurrendered = false; pvpStatusReported = false;
  pvpNetDead = false; pvpNetDeadStart = 0; pvpOppGone = false; pvpOppGoneStart = 0; pvpNoShow = false; // 清断线看门狗标志（下次进对局从干净态开始）
  pvpAcc = 0; localSimTick = 0; pvpLastSnapMs = 0; pvpLastSnapRecv = 0; pvpMatchStartMs = 0;
  pvpSaveDirty = false;        // 结束对局清脏标，避免离开 battle 屏后残留脏标（防御，帧尾落档本就门控 screen==='battle'）
  pvpWaveStartTicks.clear(); pvpPrevWaveActive = false;
  pvpSide = null; // 离开对局：清座位（下次进对局由 onPvpMatched/resumePvpSession 重置）
  // 离开对局统一作废续玩快照：本函数是所有「离开 battle 屏」路径的必经清理，集中在此清档可避免各出口散落
  // （尤其断线倒计时退出 main.ts:2283 之前会漏清，留下陈旧 dasheng.session 让下次刷新去重连一局已弃对局）。
  // 幂等（storeRemove 对已删键无副作用）；PvE 终局/开新局等不经本函数的路径仍各自显式 clearSessionSave。
  clearSessionSave();
}

// —— Task 7.6：PvP 断线看门狗（弹窗「网络已断开」+ 单按钮「返回首页」）——
// 布局常量：断线弹窗置于上半区（标题/提示在上方，不挡棋盘中部）。宽 340、高 200，水平居中、顶部留白。
const NET_POP_W = 340;
const NET_POP_H = 200;
const NET_POP_X = (VIEW_W - NET_POP_W) / 2;
const NET_POP_Y = 24; // 顶部留 24px 边距
const NET_POP_PAD = 24;

/** 断线弹窗右上角 × 命中测试：手动提前结束（都回首页）。 */
function disconnectHitClose(x: number, y: number): boolean {
  const closeR = inkPopupCloseRect(NET_POP_X, NET_POP_Y);
  return x >= closeR.x && x <= closeR.x + closeR.w && y >= closeR.y && y <= closeR.y + closeR.h;
}

/** 通用断线弹窗（上半区，最顶层）：卷轴标题 + 提示 + 居中倒计时。
 *  remainSec=剩余秒数（取整展示）；两态（对方断线 / 我方连不上）共用同一卷轴骨架。 */
function drawDisconnectOverlay(ctx: CanvasRenderingContext2D, title: string, body: string, remainSec: number): void {
  const closeR = inkPopupCloseRect(NET_POP_X, NET_POP_Y);
  const bodyTop = drawInkPopupFrame(ctx, NET_POP_X, NET_POP_Y, NET_POP_W, NET_POP_H, title, closeR);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText(body, NET_POP_X + NET_POP_W / 2, bodyTop + 26);
  // 倒计时大数字：醒目居中，提示「N 秒后退出 / 判胜」
  const sec = Math.max(0, Math.ceil(remainSec));
  ctx.fillStyle = '#8b3a1a';
  ctx.font = 'bold 34px "PingFang SC", serif';
  ctx.fillText(`${sec}`, NET_POP_X + NET_POP_W / 2, bodyTop + 72);
  ctx.fillStyle = 'rgba(90,60,30,0.75)';
  ctx.font = '13px "PingFang SC", serif';
  ctx.fillText('秒', NET_POP_X + NET_POP_W / 2 + 26, bodyTop + 72);
  ctx.fillText('可点右上 × 提前结束', NET_POP_X + NET_POP_W / 2, bodyTop + 116);
}

// —— 续玩选择弹窗：中途恢复对局时弹出，让玩家选「继续」或「回到首页」（替代原 toast 提示）——
let resumePopup = false;
const RESUME_POP_W = 320;
const RESUME_POP_H = 190;
const RESUME_POP_X = (VIEW_W - RESUME_POP_W) / 2;
const RESUME_POP_Y = Math.round((VIEW_H - RESUME_POP_H) / 2);
const RESUME_BTN_W = 132;
const RESUME_BTN_H = 46;
const RESUME_BTN_GAP = 16;
const RESUME_CONTINUE_BTN = {
  x: RESUME_POP_X + (RESUME_POP_W - RESUME_BTN_W * 2 - RESUME_BTN_GAP) / 2,
  y: RESUME_POP_Y + RESUME_POP_H - RESUME_BTN_H - 22,
  w: RESUME_BTN_W,
  h: RESUME_BTN_H,
};
const RESUME_HOME_BTN = { x: RESUME_CONTINUE_BTN.x + RESUME_BTN_W + RESUME_BTN_GAP, y: RESUME_CONTINUE_BTN.y, w: RESUME_BTN_W, h: RESUME_BTN_H };

function drawResumePopup(ctx: CanvasRenderingContext2D): void {
  // 简化版（用户要求）：普通弹窗、无宫檐屋顶，标题下直接两个按钮「继续对局 / 回到首页」。
  const bodyTop = drawPlainPopupFrame(ctx, RESUME_POP_X, RESUME_POP_Y, RESUME_POP_W, RESUME_POP_H, '继续上次对局？');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '15px "PingFang SC", serif';
  const msg = battle.wave >= 1 ? `检测到未完成的对局（第 ${battle.wave} 波）` : '检测到未完成的对局';
  ctx.fillText(msg, RESUME_POP_X + RESUME_POP_W / 2, bodyTop + 26);
  drawInkActionButton(ctx, RESUME_CONTINUE_BTN, '继续对局', false, 'primary');
  drawInkActionButton(ctx, RESUME_HOME_BTN, '回到首页', false, 'secondary');
}

function resumePopupHitAt(x: number, y: number): 'continue' | 'home' | null {
  const inR = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inR(RESUME_CONTINUE_BTN)) return 'continue';
  if (inR(RESUME_HOME_BTN)) return 'home';
  return null; // 模态：点其他处不关闭，必须二选一（简化版无 × 关闭）
}

// —— 铲子分享结果弹窗（微信 tray 铲子分享回来后）：明确告知成功/失败；成功「确认开辟」后才挖格（播挖坑动画）——
let shareShovelPopup: 'success' | 'fail' | null = null;
const SHARE_POP_W = 320;
const SHARE_POP_H = 210;
const SHARE_POP_X = (VIEW_W - SHARE_POP_W) / 2;
const SHARE_POP_Y = Math.round((VIEW_H - SHARE_POP_H) / 2);
const SHARE_POP_BTN = {
  x: SHARE_POP_X + (SHARE_POP_W - 168) / 2,
  y: SHARE_POP_Y + SHARE_POP_H - 46 - 22,
  w: 168,
  h: 46,
};

function drawShareShovelPopup(ctx: CanvasRenderingContext2D): void {
  const ok = shareShovelPopup === 'success';
  const bodyTop = drawPlainPopupFrame(ctx, SHARE_POP_X, SHARE_POP_Y, SHARE_POP_W, SHARE_POP_H, ok ? '分享成功' : '分享未完成');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a3a12';
  ctx.font = '15px "PingFang SC", serif';
  const cx = SHARE_POP_X + SHARE_POP_W / 2;
  if (ok) {
    ctx.fillText('感谢好友助力！', cx, bodyTop + 22);
    ctx.fillText('点「确认开辟」为你铲开一个新阵位', cx, bodyTop + 48);
  } else {
    ctx.fillText('未检测到有效分享', cx, bodyTop + 22);
    ctx.fillText('本次不消耗铲子次数，可再试一次', cx, bodyTop + 48);
  }
  drawInkActionButton(ctx, SHARE_POP_BTN, ok ? '确认开辟' : '知道了', false, ok ? 'primary' : 'secondary');
}

function shareShovelPopupHitAt(x: number, y: number): 'ok' | null {
  const r = SHARE_POP_BTN;
  if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return 'ok';
  return null; // 模态：点窗外不关闭，必须点按钮
}

/** 我方断线弹窗：上半区「我方连不上服务器」+ 10s 倒计时，结束自动退出。
 *  Task 9.4 注：旧 drawNetLatencyHud（右上角单侧延迟）已删除——双方延迟现改由 render.drawHud 画到
 *  顶部中块「波次/境界」左右两侧（见 render.ts drawNetLatencyFlanks，main.ts 每帧 setPvpNetLatency 注入态）。 */
function drawNetDeadOverlay(ctx: CanvasRenderingContext2D, remainSec: number): void {
  drawDisconnectOverlay(ctx, '我方连不上服务器', '与服务器连接已断开', remainSec);
}

/** 对方断线弹窗：上半区「对方断线」+ 10s 倒计时，结束判我方胜。 */
function drawOppGoneOverlay(ctx: CanvasRenderingContext2D, remainSec: number): void {
  drawDisconnectOverlay(ctx, '对方断线', '对手网络已中断', remainSec);
}

/** 重连中横幅：顶部居中小药丸「正在重连…(第 N 次)」。断线判死前(0~countdown)显示——
 *  此时本方 sim 仍在跑，故用不铺满的 HUD 下方横幅，不遮挡棋盘与顶部读数（区别于 drawNetDeadOverlay 全屏弹窗）。 */
function drawReconnectingBanner(ctx: CanvasRenderingContext2D, attempt: number): void {
  const text = attempt > 0 ? `正在重连…(第 ${attempt} 次)` : '正在重连…';
  ctx.save();
  ctx.font = '14px "PingFang SC", serif';
  const padX = 14, h = 28;
  const w = ctx.measureText(text).width + padX * 2;
  const x = (VIEW_W - w) / 2, y = HUD_H + 8; // 落在 HUD(72px 波次/境界带)之下，不遮挡顶部读数（Task4 review M1）
  ctx.fillStyle = 'rgba(20,20,20,0.62)';
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill(); }
  else ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffe9b0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, VIEW_W / 2, y + h / 2);
  ctx.restore();
}

/** 对手快照停更预警横幅：对手快照（正常 100ms/份）停更超阈值、但服务端 oppGone 还没到
 *  （对方异常退出/断网时服务端要 ~10s 才判死）——这段空窗给本方即时反馈「对方网络中断」。
 *  派生显示（无状态）：快照恢复即自动消失；服务端 oppGone 到达后由正式倒计时弹窗接管。 */
function drawOppStalledBanner(ctx: CanvasRenderingContext2D): void {
  const text = '对方网络中断，等待重连…';
  ctx.save();
  ctx.font = '14px "PingFang SC", serif';
  const padX = 14, h = 28;
  const w = ctx.measureText(text).width + padX * 2;
  const x = (VIEW_W - w) / 2, y = HUD_H + 8;
  ctx.fillStyle = 'rgba(26,18,8,0.66)';
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill(); }
  else ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffc98a'; // 暖橙区别于「本方重连」的米黄
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, VIEW_W / 2, y + h / 2);
  ctx.restore();
}

/** 我方断线看门狗刚判死（pvpNetDead false→true）：记倒计时起点。 */
function beginNetDeadCountdown(nowMs: number): void {
  if (!pvpNetDead) return;
  if (pvpNetDeadStart === 0) pvpNetDeadStart = nowMs;
}

/** 我方断线倒计时是否已结束（≥10s）→ 该退出回首页。 */
function netDeadCountdownExpired(nowMs: number): boolean {
  return pvpNetDead && pvpNetDeadStart > 0 && nowMs - pvpNetDeadStart >= DISCONNECT_COUNTDOWN_MS;
}

/** 对方断线倒计时期间是否重连：收到对手新手快照（近 2.5s 内）即视为重连 → 撤弹窗。 */
function oppReconnected(nowMs: number): boolean {
  return pvpLastSnapRecv > 0 && nowMs - pvpLastSnapRecv < 2_500;
}

/** 对方断线倒计时是否已结束（≥10s）且未重连 → 判我方胜。 */
function oppGoneCountdownExpired(nowMs: number): boolean {
  return pvpOppGone && pvpOppGoneStart > 0 && !oppReconnected(nowMs) && nowMs - pvpOppGoneStart >= DISCONNECT_COUNTDOWN_MS;
}

function onPvpFailed(_reason: string): void {
  // 失败态由匹配屏「确认」按钮回首页；这里仅确保重绘（needsContinuousLoop 已保持帧）
  scheduleFrame();
}
function enterPvpMatching(mode: 'random' | 'invite' | 'join', code?: string, note = ''): void {
  if (screen === 'pvpMatching') return; // 防重入：已在匹配屏则忽略（避免并发 ensure 建出多个 controller 泄漏）
  pvpMatchingNote = note;                // C5：no-show 重匹配传提示；普通进入传空清掉
  // 注（Task 6 退役）：旧模型曾在此组装本方配装快照(myLoadout)上交服务端转发给对手；
  // WS 快照模型无消费方，已删除。net 直接用顶层 pvpNet 对象（五个透传函数）。
  pvpMatchLazy.ensure((m) => {
    pvpScreenLazy.ensure(() => {
      pvpMode = mode; pvpCopied = false;
      pvpController = new m.PvpMatchController({
        net: pvpNet, now: () => performance.now(),
        // 匹配成功不立即开局：先留在匹配屏播「匹配成功」对阵卡动画（双方头像/昵称/等级），
        // 动画播完（MATCHED_SHOW_MS）由 frame() 的 pvpMatching 分支真正调 onPvpMatched 开局。
        onMatched: (ms) => { pvpPendingMatch = ms; scheduleFrame(); },
        onFailed: onPvpFailed,
      });
      screen = 'pvpMatching';
      if (mode === 'random') void pvpController.startRandom(rank.level);
      else if (mode === 'invite') void pvpController.startInvite(rank.level);
      else if (mode === 'join' && code) void pvpController.joinCode(code);
      scheduleFrame();
    });
  });
}

/** 放弃当前匹配（若在匹配屏）：cancel 服务端队列 ticket / 作废已成形的对局，并回首页。
 *  用于「点退出按钮」与「切后台/锁屏」——后者若不处理，queuing 的 ticket 会在服务端队列残留最长
 *  ~2.5 分钟(QUEUE_TTL_MS)，期间别人匹配会匹配到这个已离开的玩家、成局后对手看到其从不加入。
 *  - queuing：cancel 清队列 ticket。
 *  - matched（pvpPendingMatch 已置，服务端已建对局）：cancel 对已建对局无效，需额外 forfeit(matchId)
 *    作废对局（服务端判对手胜/作废），否则对手会干等一个在动画期就退出的玩家。
 *  cancel 后再 pump 的在途 poll 因 phase 已转 idle 会被守卫丢弃，不会误触发 onMatched 开局。 */
function abandonPvpMatching(): void {
  if (screen !== 'pvpMatching' || !pvpController) return;
  void pvpController.cancel(); // 异步发 cancel；phase 立即转 idle，防在途 poll 误 matched
  // matched 动画期退出：作废已成形的对局（cancel 只清队列、对已建对局无效），避免对手干等。
  if (pvpPendingMatch) { void pvpNet.forfeit(pvpPendingMatch.matchId); pvpPendingMatch = null; }
  pvpController = null;
  screen = 'menu';
  scheduleFrame();
}

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
    ensureUserId();
    // 先换取会话令牌（微信=wx.login→code；Web=本机 uid TOFU），供随后的 cloudLogin / PvP 带 token。
    // 用超时兜底：最多等 4s，网络慢/服务端无响应也不卡加载页——超时先进游戏，
    // token 由 bootstrapAuth 后台完成后补上；灰度期 cloudLogin 无 token 会回退 X-Uid。
    await Promise.race([
      bootstrapAuth(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);
    // 登录 + 云存档拉取先行：必须放在下方续玩短路（return）之前。cloudLogin 异步拉服务端 profile
    // （昵称/头像）与云存档（段位/功德/背包），并在成功后 track('login')。若放在 return 之后，续玩局会
    // 整个 app 会话都不执行 cloudLogin——丢失登录遥测 + 跨设备云存档拉取（旧 tryResumeLocalBattle 落空到
    // 此处是会调用的，故这是相对旧行为的回归修复）。恢复局用的是本地存档，云拉取异步更新 rank/merit/bag
    // 模块态、波间生效可接受（与旧「续玩后 cloudLogin 更新段位」行为一致）。两分支都在此调用一次、仅一次。
    void cloudLogin().then((ok) => {
      if (ok) track('login');
      scheduleFrame();
    });
    // 开机按用户设置定画质档（2 档手动：特效全开（默认）/精简），须在续玩恢复/进战斗之前——
    // 否则开局头几帧仍是满档绘制。曾按 benchmarkLevel 开机分级 + 战斗中 EMA 自动调档，
    // 2026-09-01 用户拍板改为纯手动设置（自动调档在临界设备上让阴影「偶尔出现/消失」）。
    applySettingsFxTier();
    // 续玩恢复优先（PvP/PvE 统一）：有有效未终局快照则恢复进战斗、跳过首页；否则走原首页逻辑。
    // PvP 深链（versusCode 非空）优先于本地续玩：保留原 `versusCode == null` 守卫——此时不恢复本地局，
    // 直接进 PvP 匹配（见下方 enterPvpMatching），避免点了对战邀请却被塞回旧的单人局。
    // 恢复逻辑抽到 tryResumeSession()（声明在各模块级 let 之后）以避开 TDZ；PvP 快照由 Task 3 接入。
    const session = versusCode == null ? readSession() : null;
    if (session && tryResumeSession(session)) {
      return; // 已恢复进战斗，短路首页逻辑（finally 仍会排一帧画出续玩局）
    }
    screen = 'menu';
    if (versusCode) enterPvpMatching('join', versusCode);
  } catch (err) {
    // 加固：启动流程任一步异常（弱网 / 域名未配 / 微信 jsbridge 未就绪 / 存储或登录异常等）
    // 也绝不把玩家永久卡在加载页。记录后「兜底进首页」——缺图有背景+按钮 fallback、
    // 缺登录态时 apiFetch 自动回退匿名 X-Uid，均可正常显示与游玩。
    console.error('[boot] 启动流程异常，兜底进入首页：', err);
    if (screen === 'loading') screen = 'menu';
  } finally {
    window.clearTimeout(showUiTimer);
    scheduleFrame(); // 无论成功 / 失败 / 超时：务必排一帧，把当前界面（首页或续玩战斗）画出来
    // 神秘商人几乎每局结算后必弹出：首屏就绪后空闲预取分包，避免结算时才现拉取造成等待。
    // 放进 finally：续玩短路 return 也会经 finally，故恢复局与首页路径都预取——恢复的中途局正是会命中
    // 结算开商人的场景，若不预取会在首次结算时现连拉取卡顿。
    const prefetchMerchantChunk = (): void => { void merchantLazy.prefetch(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetchMerchantChunk, { timeout: 4000 });
    else window.setTimeout(prefetchMerchantChunk, 1500);
  }
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
let bag: BagState = safePersisted(loadBag, { owned: {}, fragments: {}, equipped: [] });
let bagToast = '';
let bagPopup: string | null = null; // 打开详情 tips 的神兵 id（null=未开）
let menuToast = '';
let pvpController: import('./pvp-match').PvpMatchController | null = null;
let pvpMode: 'random' | 'invite' | 'join' = 'random';
let pvpCopied = false;
// —— PvP 对局期状态（battle 阶段，区别于匹配期 pvpController）——
// Model C（Plan C）：本方半场本地权威实时 step；每 100ms 经 WS 发本方快照；对手半场由 WS 快照
// → PvpOppView 双缓冲插值 → bridgeOpponentFromSnap 渲染。pvpSock 非空即「在线对局中」的唯一哨兵。
let pvpSock: PvpSocket | null = null;   // 非空=当前在线 PvP 对局中（WS 已连）；本方权威发快照，终局后冻结
// —— 冒烟注入点（仅测试用；生产恒 null，零副作用）——
// PvP WebSocket 工厂覆盖：非 null 时 onPvpMatched / resumePvpSession 建 PvpSocket 都用它替代真实全局 WebSocket，
// 供 headless 冒烟（tools/pvp-refresh-smoke.mjs）在无 Python 服务端时脚本化「welcome+oppSnap」或「静默不 welcome」
// 两条恢复链路。默认取自 window.__pvpWsFactory——刷新恢复的 resumePvpSession 在 boot IIFE（await 之后）即建 socket，
// 早于任何 page.evaluate 能调用 setPvpWsFactory 的时机，故恢复路径的注入须由 page.evaluateOnNewDocument 在页面脚本
// 之前把工厂挂到 window，从而在本模块初始化时被读入。生产环境 window 无该字段 → 恒 null → 走真实 WebSocket。
let pvpWsFactoryOverride: PvpSocketOpts['wsFactory'] | null =
  (typeof window !== 'undefined'
    ? ((window as unknown as { __pvpWsFactory?: PvpSocketOpts['wsFactory'] }).__pvpWsFactory ?? null)
    : null);
let pvpAcc = 0;                        // 固定步长累加器余量（本方半场 fixed-step，保留）
let oppView: PvpOppView | null = null; // 对手半场双缓冲插值视图（WS 快照 → bridgeOpponentFromSnap）
let localSimTick = 0;                   // 本方 battle 已完成的固定步数 = 下一步 tick 索引（maybeOpenPvpWave 时钟基准；每对局 reset）
// 落档「输入脏标」（Task 5，PvP/PvE 共用同一存档槽故共用一个标志）：任一玩家输入（征兵/部署/合并/铲地/
// 主动技/领取碎片）置真，帧尾 sessionSaveCheckpoint 据此在 500ms MIN 节流下尽快落档，而非干等 2s MAX 心跳。
// 消费策略见帧尾：仅当 checkpoint 真正写入（返回 true）才清零——若因未过 MIN 被节流（返回 false）则保留脏标，
// 使写入在 MIN 到点时触发（否则 ~60fps 下几乎每次输入都会在下一帧被无写入地清掉、退回 2s 心跳，失去「尽快」意义）。
// 跨对局在 onPvpMatched / endPvpSession / newGame / 两条恢复路径重置，避免陈旧脏标为新局/已结束局触发写入。
// ⚠️ 新增任何「改动序列化战斗态」的玩家输入路径时，务必在该处设 pvpSaveDirty=true（漏置只由 2s MAX 心跳
//    兜底——非数据丢失但会丢该输入最近 ≤2s 的改动；见 Battle.serialize 的落档字段范围）。
let pvpSaveDirty = false;
let pvpLastSnapMs = 0;                  // 上次发本方快照的墙钟 ms（100ms 节流）
let pvpLastSnapRecv = 0;                // 最近一次收到对手快照的时刻（performance.now() 时基；对方断线倒计时期间据此判重连撤弹窗、快照停更预警）
let pvpNextWave: { wave: number; startAtServerMs: number } | null = null; // 服务端下一波（WS nextWave 缓存，Task 9 用）
let pvpResult: { outcome: 'win' | 'lose' | 'draw'; reason: string } | null = null; // 服务端权威终局（WS result → frame 驱动结算）
let pvpStatusReported = false;          // 终局 status 已上报一次性标志（surrender / tangsengDead 各只经 WS 发一次）
// —— Task 9：先清者定波次（服务端 nextWave 权威排程，本机按 tick 确定性开波）——
let pvpMatchStartMs = 0;                        // 开局纪元（服务端 startAtServerMs）：波次纪元→tick 的零点
// 本方座位（a/b）：仅供刷新存档/恢复对称，服务端按 uid+matchId 识别、restoreBattle 不按 side 分支，故战斗无分流意义。
// onPvpMatched 置默认 'a'（MatchStart 未下发座位）；resumePvpSession 用 save.pvp.side 覆盖为落档时的真值。null=非对局中。
let pvpSide: 'a' | 'b' | null = null;
const pvpWaveStartTicks = new Map<number, number>(); // 波号→该波本地开波 tick（缓存：两端各按自己 wave+1 查表）
let pvpPrevWaveActive = false;                  // 本方上一帧 waveActive（下降沿检测：true→false = 刚清波，立即经 WS 上报）
// matched 后先播「匹配成功」对阵卡动画（双方头像/昵称/等级），动画播完才真正开局——
// pendingMatch 非空表示动画窗口期（matchedAt 由 pvp-match state 提供，渲染层用它驱动进度）。
let pvpPendingMatch: import('./api/pvp-client').MatchStart | null = null;
// —— Task 10：PvP 终局（认输 / 服务端 result 权威结算 / 断线提示）——
let pvpSurrendered = false;                     // 本方已点「认输」：经 WS 上报 surrender，等服务端 result 驱动终局
let pvpOpponent: import('./api/pvp-client').OpponentProfile | null = null; // 当前对手档案（结算屏展示头像/昵称）
let pvpSettleResult: PvpSettleResult | null = null; // PvP 结算屏 payload（服务端 result 一到即构造，null=未结算）
let pvpSettleStart = 0;                         // 打开 PvP 结算屏的时间戳（虽无加减星动画，保留供可能的淡入/时间线复用）
// —— Task 7.6：PvP 断线看门狗 ——
let pvpNetDead = false;                         // 本局已判网络断开（>10s 无入站）：置真即冻结本方 + 弹「我方连不上服务器」倒计时
let pvpNetDeadStart = 0;                        // 判死时刻(ms)：倒计时起点，0=未开始
let pvpOppGone = false;                         // 对手已断线（WS oppGone）：置真即弹「对方断线」倒计时
let pvpOppGoneStart = 0;                        // 对手断线时刻(ms)：倒计时起点，0=未开始
let pvpNoShow = false;              // C5：服务端判对手打空气 → frame() 退体力+自动重匹配
let pvpMatchingNote = '';           // C5：匹配中界面提示（如「对手未应战，正在重新匹配…」）
// 本局是否使用过任意主动技能（点击或拖放施放都算）：首次技能就绪的「施放演示动画」
// （拖到兵器/路径格/点按）播到玩家真用过一次为止——用过即视为已学会。
let activeUsedThisGame = false;
/** 断线倒计时时长（ms）：与服务端 DISCONNECT_GRACE_MS(15s) 对齐——客户端倒计时 ≥ 服务端宽限，
 *  确保不早于服务端权威 result 就回首页（正常由服务端 result 驱动结算，倒计时到点未收到是兜底）。
 *  起点是 netDead 判死时刻（其前还有 NET_DEAD_THRESHOLD_MS 的无入站检测窗，二者不同）。45s→15s（用户拍板：45s 判胜太久）。 */
const DISCONNECT_COUNTDOWN_MS = 15_000;   // 与服务端 DISCONNECT_GRACE_MS 对齐（45s→15s）：断线倒计时/复活窗口
/** 对手快照停更预警阈值：快照正常 100ms/份，停更 1.5s（≈15 份未达）即显示「对方网络中断」横幅——
 *  覆盖对方异常退出（杀进程/断网，服务端要 ~10s 才判死推 oppGone）的空窗；弱网抖动偶发 1s 停更不误报。 */
const PVP_OPP_STALL_WARN_MS = 1_500;
/** Cell → PvpAction cell 字符串（协议格式 r{r}c{c}；与内部 cellKey 的 `c,r` 顺序不同，勿混用） */
const cs = (c: Cell): string => `r${c.r}c${c.c}`;
/**
 * PvP 到点开波（硬同步）：某实例 b 的 wave+1 已被服务端排程、其时钟已达 startTick → 开波（step 之前调）。
 *
 * 与单人「清完再开」不同，PvP 波次由服务端绝对纪元权威排程（startAtServerMs，跨机同值），两端在同一
 * tick 索引开波——哪怕本方上一波还没清，也**强制切到下一波**，旧怪继续走/被打（startNextWave 在 pvp
 * 下放行且不触碰 this.monsters，旧怪因此存活）；本波骑兵/小Boss 等技能照常 roll。这正是「对方已清波、
 * 倒计时到下一波、我方还在打上一波时我方也切到下一波」的硬同步语义。
 *
 * 两道闸门：
 *  1. `!b.introDone` 早退——第 1 波必须等唐僧归位（intro 视觉走完 ~6s）后才发，给玩家布阵时间；
 *     归位完成由 battle.step 的 PvP intro 分支置 introDone。wave1 的 startTick 由 start_at_ms
 *     = now+START_DELAY_MS 算得，相对 matchStart 为 0 → 到 tick 0 即可尝试开波，实际由本闸门拖到
 *     intro 结束（~tick 180 @30Hz）。两端 intro 都始于 match start，加载微偏差可接受。
 *  2. `st === undefined || tick < st` 早退——未排程或时钟未到则等。tick===startTick 恰开一次（wave 自增
 *     后下一波查自己的 st，无重复开波）。
 * 每 tick 「开波→step」顺序两端一致 → startNextWave 消费 this.rng 的骑兵/小Boss roll 序一致（确定性）。
 */
function maybeOpenPvpWave(b: Battle, tick: number): void {
  if (b.status === 'won' || b.status === 'lost') return;
  if (!b.introDone) return; // 等唐僧归位后才发第 1 波（布阵时间）
  const st = pvpWaveStartTicks.get(b.wave + 1);
  if (st === undefined || tick < st) return;
  b.startNextWave();
}

// 首页按钮按下态：down 时显示压下视觉，up 且仍在同一按钮上才触发点击
let menuDownId: string | null = null;
let menuPressedId: string | null = null; // 手指仍压在原按钮上时 = menuDownId，滑出则 null
let menuHoverId: string | null = null;
/** 连续点版本号 → DevTools */
const VERSION_SECRET_TAPS = 7;
const VERSION_SECRET_TAP_MS = 2500;
let versionTapCount = 0;
let versionTapLastAt = 0;
let versionPointerDown = false;
let merchantPointerActive = false;
let merchantDragged = false;
let merchantDownX = 0;
let merchantDownY = 0;
let merchantDownScroll = 0;
let bagScrollY = 0;
let bagPointerActive = false;
let bagDownX = 0, bagDownY = 0, bagDownScroll = 0, bagDragged = false;
let mapSelection: MapSelection = safePersisted(loadMapSelection, { mode: 'daily' });
let currentMap = params.get('map') ? mapById(params.get('map')!) : resolveMap(mapSelection);

/** 新开一局：在持久化玩家 skill ±1 内随机本局 AI 基础强度 */
function newBattleAiSkill(): number {
  return rollMatchAiSkill(loadAiSkill(), () => Math.random());
}

/** 跨局武将匹配：上一局未匹配则本局保底；近 10 局降重 */
function heroMatchOptsForNewBattle() {
  const hist = loadHeroMatchHistory();
  return {
    forceMatchThisGame: !hist.lastGameHadMatch,
    recentMatchedHeroIds: hist.recentMatched,
  };
}

let battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, false, newBattleAiSkill(), 1, heroMatchOptsForNewBattle());
bindBattleWeaponPickup();
let endHandled = false; // 本局胜负是否已结算入境界
let settleChange: RankChange | null = null; // 局内结算弹层要播放的段位变化
let settleStart = 0; // 打开结算弹层的时间戳（performance.now）
let endlessOn = safePersisted(loadEndlessEnabled, false); // 开局前无尽勾选（持久化）
let endlessResult: EndlessResult | null = null; // 无尽局结束展示数据
let pendingMerchant = false; // 本局已结算，回首页时弹出神秘商人
// 关闭态字面量与 merchant.ts 的 merchantClosed() 保持一致：避免首屏同步依赖该分包模块。
let merchant: MerchantUiState = {
  open: false,
  tab: 'shop',
  offers: [],
  lotteryPreview: [],
  toast: '',
  confirmOffer: null,
  confirmUnequip: null,
  skillInfo: null,
  shopPurchaseDone: false,
  testMode: false,
  scrollY: 0,
};
// 直接 getSettings（loadSettings→parseStoredJson 已全量 try/catch 容错，不会抛）。
// 曾写成 safePersisted(getSettings, resetSettings())——JS 参数急切求值让 resetSettings()
// 在每次模块加载时无条件执行，把用户设置静默重置为默认（音效/音量长期不持久的根因；
// 2026-09-01 加 fxLite 后因档位一眼可见而暴露）。
let gameSettings: GameSettings = getSettings();

function isSettleOpen(): boolean {
  // Task 10：PvP 结算屏也视为「结算打开」态（冻结战斗 + 阻断暂停弹窗 + 点击返回生效）。
  return settleChange !== null || endlessResult !== null || pvpSettleResult !== null;
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
type MenuPopup = 'none' | 'settings' | 'stamina' | 'map' | 'help' | 'profile';
let menuPopup: MenuPopup = 'none';
let profilePopup: ProfilePopupState | null = null;
let profileScrollDrag: ProfileScrollDrag | null = null;
let profileCopyBusy = false;
let staminaPopupToast = '';
let staminaSharesLeft = 0;
let menuSliderDrag: 'music' | 'sfx' | null = null;
let helpScrollY = 0;
let helpPointerActive = false;
let helpDragged = false;
let helpDownX = 0;
let helpDownY = 0;
let helpDownScroll = 0;
// 地图选择弹窗：卡片区拖拽滚动（同帮助弹窗范式；当前 5 图全可见，滚动为更多图预留）
let mapScrollY = 0;
let mapPointerActive = false;
let mapDragged = false;
let mapDownX = 0;
let mapDownY = 0;
let mapDownScroll = 0;

function openHelpLink(id: HelpLinkId): void {
  menuPopup = 'none';
  helpScrollY = 0;
  helpPointerActive = false;
  helpDragged = false;
  playSfx('click');
  switch (id) {
    case 'codex-unit':
      enterCodex('unit');
      return;
    case 'codex-hero':
      enterCodex('hero');
      return;
    case 'codex-monster':
      enterCodex('monster');
      return;
    case 'codex-skill':
      enterCodex('skill');
      return;
    case 'codex-rank':
      enterCodex('rank');
      return;
    case 'codex-versus':
      enterCodex('versus');
      return;
    case 'bag':
      enterBag();
      return;
    case 'stamina':
      openStaminaPopup();
      return;
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
    }
  }
}
let pausePhase: PausePhase = 'main';
// PvP 退出弹窗开启标志：真人对战时点「退出」按钮弹窗用。与单人 ui.paused 的关键区别——
// 它只做**输入模态**（吞掉棋盘/布阵点击，让弹窗独占指针），但**不暂停仿真**：
// 仿真步进门控仍只看 ui.paused，故 pvpExitPopup=true 时怪照走、WS 照发，弹窗只是浮在上层的「退出确认」。
// 单人路径（ui.paused）完全不受影响。
let pvpExitPopup = false;
// 注：弹窗开启判定用导入的纯函数 isPausePopupOpenPure(ui.paused, pvpExitPopup)；
// 仿真步进判定用 shouldStepSim({...})——两者都不把 pvpExitPopup 当作「暂停」，
// 这是 T9.5 的核心：PvP 退出弹窗只做输入模态，不停仿真。
/** 关闭弹窗（单人继续 / PvP 继续或认输后）：同时清两路标志 + 回到主阶段。 */
function closePausePopup(): void { ui.paused = false; pvpExitPopup = false; pausePhase = 'main'; }
const ui: UiState = {
  dragFrom: null,
  dragTrayIndex: null,
  dragPos: null,
  trayDragStart: null,
  dragActiveSlot: null,
  activeDragStart: null,
  selected: null,
  selectedTrayIndex: null,
  selectedMonster: null,
  passivePopup: null,
  passivePopupUntil: 0,
  activePopup: null,
  activePopupUntil: 0,
  aiItemPopup: null,
  peachPopup: false,
  bombPopup: null,
  paused: false,
};

// —— 新手引导：首次触发时机 + 各锚点闭包（引用当前 battle/merchant，battle 会随 newGame() 重新赋值） —— //
let tutorial: TutorialState = safePersisted(loadTutorialState, { seen: {} });
let tutorialOverlay: TutorialOverlay | null = null;

// 每局开始的「征兵→部署」非阻塞提示：两阶段状态机（见 render.ts stepGameStartHint）。
// 过了首次引导（见过 battleIntro）后，每局（AI/真人）开局显示一次；不暂停、不影响出怪时机。
// ① 征兵提示常驻直到玩家点过征兵；② 部署提示在征兵后出现、放置首个 tray 令牌后 2s 淡出。
let gameStartHint: GameStartHintState = { stage: 'off', fadeT: 0 };
let gameStartHintTrayLen = -1; // 上帧 tray 有效令牌数（-1=未初始化）：下降沿=放置了一枚令牌。
// 注意 tray 是稀疏数组（clearTraySlot 用 delete 挖洞，length 不变），必须用 trayTokens 压实计数。
function armGameStartHint(): void {
  gameStartHint = hasSeenTutorial(tutorial, 'battleIntro')
    ? { stage: 'summon', fadeT: 0 }
    : { stage: 'off', fadeT: 0 };
  gameStartHintTrayLen = trayTokens(battle.tray).length;
}

// —— Task 10 首局部署引导：非模态动态箭头（征兵→部署两阶段）——
// 与 tutorialOverlay 的「modal 高亮卡片」共存但独立：modal 开着时箭头隐藏、关掉后恢复。
// 仅在首局单人（newGame 时 isFirstGame=true）激活；PvP/非首局为 'done'（不画箭头）。
//   summon    → 箭头指征兵按钮「点击征兵」
//   deploy    → 玩家至少征兵过一次后，箭头指候选区「把兵器拖到战场部署」
//   done      → tray 兵/字牌都上场（首波押后释放），箭头消失
//   dismissed → 玩家点「跳过」，箭头消失 + 释放首波押后
type GuidePhase = 'summon' | 'deploy' | 'done' | 'dismissed';
let guidePhase: GuidePhase = 'done';
let playerSummonedThisGame = false; // 本局玩家是否至少征兵过一次（summon→deploy 的前置条件）

/** 首局引导是否处于活跃阶段（箭头可见）。modal 教程展示期间箭头另由绘制处隐藏。 */
function isGuideActive(): boolean {
  return guidePhase === 'summon' || guidePhase === 'deploy';
}

/** 新开局重置引导状态：首局从「征兵」阶段起，其余直接 'done'（无箭头）。 */
function resetFirstGameGuide(isFirstGame: boolean): void {
  playerSummonedThisGame = false;
  guidePhase = isFirstGame ? 'summon' : 'done';
}

function buttonRect(id: string): { x: number; y: number; w: number; h: number } | null {
  const btn = getButtons(battle).find((b) => b.id === id);
  return btn ? { x: btn.x, y: btn.y, w: btn.w, h: btn.h } : null;
}

function battleIntroSequence(): TutorialSequence {
  const steps: TutorialStep[] = [
    {
      id: 'spawnGate',
      title: '怪物出口',
      text: '怪物从这里出来，沿路线走向我方守护的唐僧，需要征兵部署抵挡怪物。',
      getAnchor: () => {
        const gate = pathEntranceCell(battle.map.path);
        return cellRect(gate.c, gate.r);
      },
    },
    {
      id: 'tangseng',
      title: '我方唐僧',
      text: '这是我方要守护的唐僧，怪物吃到唐僧扣一滴血，唐僧血量归零时游戏失败。',
      getAnchor: () => cellRect(battle.map.tangseng.c, battle.map.tangseng.r),
    },
  ];
  // 无尽模式没有 AI 对手（不会被击败判负），不展示该步
  if (!battle.endless) {
    steps.push({
      id: 'aiOpponent',
      title: '对手唐僧',
      text: '这是对手守护的唐僧，双方同时守护各自的唐僧——谁的唐僧先被妖怪吃掉，谁就算输！',
      getAnchor: () => cellRect(battle.aiTangseng.c, battle.aiTangseng.r),
    });
  }
  steps.push(
    {
      id: 'pause',
      title: '暂停游戏',
      text: '点这里可以随时暂停游戏，方便查看局面或临时离开。',
      getAnchor: () => pauseBtnRect(),
    },
    {
      id: 'peach',
      title: '蟠桃',
      text: '这是我方当前拥有的蟠桃数量，击杀妖怪会掉落蟠桃。每次征兵需要一定数量的蟠桃。',
      getAnchor: () => peachHudRect(),
    },
    {
      id: 'goSummon',
      title: '征兵布阵',
      text: '唐僧还在赶来的路上——趁这段时间点【征兵】招募，将士兵部署地图空白位置上，怪物来袭时才能抵挡怪物！',
      getAnchor: () => buttonRect('summon'),
    },
  );
  return { id: 'battleIntro', steps };
}

function firstSummonSequence(): TutorialSequence {
  // 布阵按钮默认隐藏（DevTools 可开）→ 整段「征兵引导」不弹（steps 留空即被 maybeStartTutorial 跳过），
  // 避免弹出一张指向不存在按钮的「一键布阵」卡片。首局部署流改由非模态箭头引导（guidePhase）承担。
  if (!showAutoplaceBtn()) return { id: 'firstSummon', steps: [] };
  return {
    id: 'firstSummon',
    steps: [
      {
        id: 'unitTypes',
        title: '兵种介绍',
        text: '刀兵近战重击单体、骑兵近战攻击多目标、枪兵中距攻击多目标、弓兵远程攻击单体，合理搭配更抗打。',
        getAnchor: () => trayRowRect(),
      },
      {
        id: 'dragToBoard',
        title: '部署到地图',
        text: '按住候选区的士兵，拖到上方地图的白色空格，让它的攻击范围覆盖怪物路径。',
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
        text: '点击阵上的士兵可查看攻击范围，只要攻击范围圈和怪物路径有相交，就能打到该格子的怪物。',
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
        title: '什么是神将',
        text: '这是神将字牌，未激活的神将字没有攻击力，需要部两个左右连着的字才能激活神将（比如"大圣"）。神将比普通兵攻击高，有各自的大招。',
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
        title: '洛阳铲',
        text: '这是洛阳铲，把它按住拖到地图锁定的灰格上即可挖开，解锁新的部署位置。',
        getAnchor: firstShovelAnchor,
      },
      {
        id: 'shovelWhere',
        title: '挖哪里最好',
        text: '推荐优先挖靠近怪物出口，尽早防守，效率更高。',
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

// 首次主动技能冷却完成 → 引导「点击释放 / 拖到地图使用」（一次性）。
function firstActiveReadySequence(): TutorialSequence {
  const idx = battle.activeSlots.findIndex((s) => s.ready);
  if (idx < 0 || idx > 1) return { id: 'firstActiveReady', steps: [] };
  const def = activeById(battle.activeSlots[idx]!.id);
  const name = def?.name ?? '主动技能';
  return {
    id: 'firstActiveReady',
    steps: [
      {
        id: 'activeReady',
        title: `${name} · 已就绪`,
        text: '主动技能冷却完成！点击释放，或按住拖到地图上使用。',
        getAnchor: () => activeSlotRect(idx as 0 | 1),
      },
    ],
  };
}

function firstHeroComboSequence(): TutorialSequence {
  return {
    id: 'firstHeroCombo',
    steps: [
      {
        id: 'heroCombo',
        title: '怎么激活神将',
        text: '把同一位神将的两张字牌拼到左右相邻，就能激活神将并获得强力效果。',
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
        title: '升级武器',
        text: '同兵种同等级的两个单位拖到一起即可合并升级，最高升级到5级。',
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
        text: '击杀怪物时有机会掉落神兵碎片，武器碎片可以兑换武器，加强对应神将的攻击，点这张卡片即可领取。',
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
        text: '主动技能需要在局内手动点击释放，有冷却时间，能造成爆发效果或增加攻击属性。',
        getAnchor: () => merchantLazy.get()!.merchantActiveRowRect(),
      },
      {
        id: 'passiveSkill',
        title: '被动技能是什么',
        text: '被动技能装备后全程自动生效，无需手动操作，能造成爆发效果或增加攻击属性。',
        getAnchor: () => merchantLazy.get()!.merchantPassiveRowRect(),
      },
    ],
  };
}

/** 五行地图指引：五行总开关（DevTools/默认）开启才弹；独立 seen key——
 *  老玩家（已见过其余引导）也会见到一次，五行是新机制需要单独交代。
 *  三步：① 本图五行是什么、妖怪全部继承（锚 HUD 地图名旁徽章）
 *        ② 相克环与倍率（居中卡片）
 *        ③ 武将徽章怎么看克制（居中卡片）。 */
function wuxingMapSequence(): TutorialSequence {
  if (!wuxingEnabled()) return { id: 'wuxingMap', steps: [] };
  const mapEl = MAP_ELEMENT[battle.map.id] ?? null;
  return {
    id: 'wuxingMap',
    steps: [
      {
        id: 'mapBadge',
        title: '地图五行',
        text: `每张地图都有自己的五行，本图是「${mapEl ? ELEMENT_ZH[mapEl] : '？'}」——图上所有妖怪（小怪/精英/小Boss/妖王）都继承它。徽章就在顶部地图名旁边。`,
        getAnchor: () => mapBadgeRect(ctx, battle),
      },
      {
        id: 'cycle',
        title: '相克之道',
        text: '金克木、木克土、土克水、水克火、火克金。克制妖怪伤害×1.25，被克×0.75；兵种没有五行，不受影响。',
        getAnchor: () => null,
      },
      {
        id: 'generalBadge',
        title: '武将五行',
        text: '武将名字后有五行徽章（图鉴·神将可查各将属性）：金底「克」=克制本图、伤害更高；灰底「被克」=被本图克制，尽量少上。',
        getAnchor: () => null,
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
        text: isWeChat
          ? '体力不够时无法开始游戏，点这里的【+】可以分享好友补充体力。'
          : '体力不够时无法开始游戏，点这里的【+】可以看广告补充体力。',
        getAnchor: () => ({ ...STAMINA_PLUS_BTN }),
      },
    ],
  };
}

// 首次征兵后：等候选令牌飞入动画结束、真正落位到 tray 后再弹引导，避免指向还在飞行中的令牌
let pendingFirstSummonTutorial = false;

// —— Task 10 首局动态引导：每帧推进阶段 + 「跳过」命中 —— //
// 与 checkBattleTutorials（modal 教程）解耦：箭头是非模态，modal 开着时箭头另由绘制处隐藏，
// 但阶段机照常推进（不会因为玩家在看 modal 就漏切阶段）。

/** 首局引导「跳过」按钮命中：仅活跃阶段可点，消耗本次点击（main.ts 置顶调用处 return）。 */
function firstGameGuideSkipHit(x: number, y: number): boolean {
  if (!isGuideActive()) return false;
  const r = guideSkipRect();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 玩家点「跳过」→ 隐藏箭头并释放首波押后（下个 intro-complete 检查即放行第 1 波）。 */
function dismissFirstGameGuide(): void {
  if (!isGuideActive()) return;
  guidePhase = 'dismissed';
  battle.holdFirstWaveForSetup = false; // 释放押后 latch
}

/**
 * 每帧推进首局引导阶段机：
 *   - modal 教程展示中（tutorialOverlay 非空）→ 不动（箭头本就隐藏，等 modal 关再继续）。
 *   - summon 阶段 + 玩家已征兵过 → 切 deploy（箭头改指候选区「拖到战场」）。
 *   - deploy 阶段 + tray 已无兵/字牌 → 切 done（布阵完成；押后随之释放，第 1 波开打）。
 * 首波押后的「放行」由 battle.ts 的 shouldHoldFirstWave 独立判定（ tray 清空即放行），
 * 这里只负责箭头阶段切换，两侧不互相依赖。
 */
function updateFirstGameGuide(): void {
  if (guidePhase === 'done' || guidePhase === 'dismissed') return;
  if (battle.status !== 'ready' && battle.status !== 'playing') return;
  if (tutorialOverlay) return; // modal 开着：暂停推进，避免与 modal 抢戏
  if (guidePhase === 'summon' && playerSummonedThisGame) {
    guidePhase = 'deploy';
    return;
  }
  if (guidePhase === 'deploy' && !battle.trayHasDeployables()) {
    guidePhase = 'done'; // 兵/字牌都上场了 → 引导完成（押后同步释放）
  }
}

/** 局内条件触发的引导：每帧检查一次，命中即弹（只弹未展示过的第一条）。 */
function checkBattleTutorials(): void {
  if (tutorialOverlay) return;
  if (battle.status !== 'ready' && battle.status !== 'playing') return;
  // 五行地图指引最先弹（battleIntro 结束后的第一帧即触发），让玩家开打前先懂克制
  tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, wuxingMapSequence());
  if (tutorialOverlay) return;
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
  if (tutorialOverlay) return;
  // 首个主动技能冷却完成即引导（一次性）；未装备主动技能时 activeSlots 无 ready 项，不触发。
  if (battle.activeSlots.some((s) => s.ready)) {
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, firstActiveReadySequence());
  }
}

function newGame() {
  // 使用当前(可在首页切换的)地图；每局随机种子(除非 ?seed= 固定)
  battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endlessOn, newBattleAiSkill(), 1, heroMatchOptsForNewBattle());
  bindBattleWeaponPickup();
  battle.rollIntroSpeech(Math.random()); // 开局唐僧出场气泡：50% 概率随机一句（展示层掷随机，不占 sim RNG）
  endHandled = false;
  clearSessionSave(); // 开新局：作废统一续玩快照（PvE/PvP 共用槽位）
  pvpSaveDirty = false; // 开新局清脏标，避免上一局残留脏标为新局提前触发落档
  clearBattleToasts(); // 清残留续玩 toast
  endlessResult = null;
  settleChange = null;
  ui.paused = false;
  pvpExitPopup = false;
  pausePhase = 'main';
  ui.passivePopup = null;
  ui.passivePopupUntil = 0;
  ui.activePopup = null;
  ui.aiItemPopup = null;
  ui.peachPopup = false;
  ui.bombPopup = null;
  pendingFirstSummonTutorial = false;
  activeUsedThisGame = false; // 新局重置：本局没用过主动技 → 技能就绪施放演示可再播（对局中途购买的技能也有引导）
  // Task 10 首局体验：首局单人开启「第 1 波押后 + 征兵/部署动态引导」。
  // newGame 只服务单人（PvP 走 enterPvpMatching，不经过这里），故无需再判 pvp；
  // 「是否首局」用对局历史判定（!hasFinishedGame）——既准又可被测试直控（resetFinishedGame）。
  const firstGame = !hasFinishedGame();
  battle.holdFirstWaveForSetup = firstGame;
  resetFirstGameGuide(firstGame);
}

// PvE 刷新续玩（统一存档 pvp-save）：读有效未终局 PvE 快照→重建 battle→进战斗界面（不扣体力、跳过首页）。
// 返回 true=已恢复进战斗（调用方短路首页逻辑）；false=不可恢复（PvP 快照留给 Task 3；终局 PvE 已就地清档）。
// 仅启动 IIFE 调用：此时各 ui.*Popup / 引导态 / tutorialOverlay 尚为初始默认值，故这里只复位与 newGame
// 对称的核心循环/结算标志。抽成函数（声明在模块级 let 之后）亦为避开 boot IIFE 的 TDZ。
function tryResumeSession(session: SessionSaveV1): boolean {
  // Task 3：PvP 跨刷新恢复——连 WS 确认对局仍在（welcome）→ 无输入快进续打；hello 失败 → 回首页。
  // resumePvpSession 内部异步（等 welcome/close），此处立即 return true 让 boot 短路首页逻辑；
  // 屏幕在 welcome 到达前停留 'loading'（WS 连接 + 快进的短暂窗口），随后切 'battle' 或 'menu'。
  if (session.kind === 'pvp') { resumePvpSession(session); return true; }
  if (session.kind !== 'pve') return false; // 未知 kind：不恢复
  // 直接恢复：离线战斗墙钟不走，序列化状态即最新
  const rb = restoreBattle(session);
  if (rb.status === 'won' || rb.status === 'lost') {
    clearSessionSave(); // 续玩前一刻已终局 → 清快照回首页（避免弹终局结算的复杂路径）
    return false;
  }
  battle = rb;
  currentMap = mapById(session.config.mapId); // 氛围音/HUD 对齐存档地图
  // 只重挂注入型函数字段：走 injectWeaponPickupVisible() 而非
  // bindBattleWeaponPickup()——后者会 planBattleFragmentDrop() 消耗 rng 并覆盖已恢复的碎片掉落态，
  // 破坏「恢复后前向确定性」（rng 走样）。故续玩恢复严禁调 bindBattleWeaponPickup()。
  injectWeaponPickupVisible();
  endHandled = false;
  pvpSaveDirty = false; // 恢复的 PvE 局从干净脏标起步（首帧尾靠 MAX 心跳补写，无需继承旧脏标）
  pendingMerchant = false;
  endlessResult = null;
  settleChange = null;
  ui.paused = false;
  pvpExitPopup = false;
  pausePhase = 'main';
  screen = 'battle';
  resumePopup = true; // 复用现有「继续 / 回到首页」选择弹窗（模态、冻结仿真）
  scheduleFrame();
  return true;
}

/** 恢复时等待服务端 welcome 的截止（ms）：覆盖 WS 连接 + 首个 welcome（正常亚秒级，8s 极宽松）。
 *  到点仍无 welcome → 判对局已亡（服务端对已不存在的局不回 welcome 也不关连接，见 resumePvpSession），回首页。 */
const RESUME_WELCOME_TIMEOUT_MS = 8000;
/**
 * PvP 刷新恢复（Task 3）：连 WS 发 hello → 服务端确认对局仍在则回 welcome，据此重建本方半场并
 * 「无输入快进」到服务端当前 tick（catch up）后进战斗屏；若对局已结束/被回收则清快照回首页、不进战斗。
 *
 * 「对局已亡」的判定靠 welcomeTimeoutMs（RESUME_WELCOME_TIMEOUT_MS）而非 WS 关闭：服务端对已不存在的
 * 对局收到 hello 后既不回 welcome、也不关连接（bad_hello 只是忽略），且客户端 2s 心跳会一直喂活服务端 5s
 * 读超时使其 idle-reap 永不触发——故连接会无限挂着，仅靠 close 触发的 onHelloFail 永远不来。改由 PvpSocket
 * 的 welcome 截止计时器：自 connect 起 8s 内没等到 welcome → 触发 onHelloFail=goHome。
 *
 * 时序：boot IIFE 里 tryResumeSession 立即返回 true 短路首页，此函数只发起 WS 连接就返回；屏幕暂停在
 * 'loading'，待 onWelcome（→'battle'）或 onHelloFail（→'menu'）异步切换。这段 loading 是 WS 连接 + 快进
 * 的短暂窗口（正常亚秒级；对局已亡/服务端挂起时最长 RESUME_WELCOME_TIMEOUT_MS 后回首页）。
 *
 * 已知简化（对手档案）：存档未持久化对手昵称/头像/段位，恢复时 pvpOpponent=null；对手半场从其后续
 * WS 快照重建渲染即可，结算屏对手信息缺省。持久化对手档案属后续任务（Task 6/未来）可选增强，不阻塞恢复。
 *
 * 已知简化（gap 内波次）：快进时 pvpWaveStartTicks 为空（刚 clear），maybeOpenPvpWave 不会开断线期间
 * 本应开的波——那些波由重连后服务端重新宣告的 nextWave 驱动补开（ws_hello 清 last_next_wave，重连首快照
 * 会重推 nextWave）。快进主职是推进落档时的活动波 + 对齐本地时钟，与「真·跨刷新逐波重放」的差距可接受
 * （见记忆：真·跨刷新恢复不可行，本方案为尽力而为的确认+快进）。
 */
function resumePvpSession(save: SessionSaveV1): void {
  const meta = save.pvp;
  if (!meta) { clearSessionSave(); screen = 'menu'; scheduleFrame(); return; } // 防御：readSession 已保证 pvp 存在，兜底回首页

  // welcome：服务端确认对局仍在 → 重建本方半场 + 无输入快进 + 进战斗屏。
  const fastForward = (serverMs: number): void => {
    battle = restoreBattle(save);            // 用 config（difficultyMul/endless/mapId…）+ pvpInit{enabled:true} 重建，再 applyCoreState
    currentMap = mapById(save.config.mapId); // 氛围音/HUD 对齐存档地图
    // 只重挂注入型可见性判定，不重跑碎片掉落规划（planBattleFragmentDrop 会消耗 rng 破坏前向确定性）——同 PvE 恢复。
    injectWeaponPickupVisible();
    // 对局态 reset（镜像 onPvpMatched 的 reset 块，但不重扣体力、不重置 matchStart 为 0）。
    pvpAcc = 0; localSimTick = 0; pvpLastSnapMs = 0; pvpLastSnapRecv = 0; pvpNextWave = null; pvpResult = null; pvpStatusReported = false;
    pvpNetDead = false; pvpNetDeadStart = 0; pvpOppGone = false; pvpOppGoneStart = 0; pvpNoShow = false;
    pvpSaveDirty = false;                     // 恢复的 PvP 局从干净脏标起步（快进后由帧尾 MAX 心跳补写，无需继承旧脏标）
    pvpOpponent = null;                      // 已知简化：存档无对手档案，置 null（见函数头注释）
    pvpSurrendered = false; pvpSettleResult = null; pvpSettleStart = 0;
    pvpSide = meta.side;                      // 恢复落档时的真实座位（覆盖 onPvpMatched 默认 'a'）
    pvpMatchStartMs = meta.startAtServerMs; pvpWaveStartTicks.clear(); pvpPrevWaveActive = false;
    // —— 无输入快进：把本方 sim 从落档 tick 推进到服务端当前 tick ——
    // 步序（开波→step→tick++）与主循环 PvP 分支一致，保 rng 消费序；pvpWaveStartTicks 为空故不开新波（见头注释）。
    const targetTick = pvpWaveStartTick(serverMs, meta.startAtServerMs);
    let tick = meta.localSimTick;
    while (tick < targetTick && battle.status === 'playing') {
      maybeOpenPvpWave(battle, tick);
      battle.step(PVP_SIM_DT);
      tick++;
    }
    localSimTick = tick;
    // 从恢复后的实际波次态起步下降沿检测：否则快进结束时若正处 waveActive，首个 post-resume step 的
    // 清波下降沿(true→false)会被漏判 → 那一波的 sendWaveCleared 不发（主循环仅在 pvpPrevWaveActive && !waveActive 时发）。
    pvpPrevWaveActive = battle.waveActive;
    oppView = new PvpOppView();               // 全新对手视图：待对手后续 WS 快照填充
    // 战斗 UI reset（镜像 onPvpMatched；不重扣体力、不 arm 开局「征兵→部署」提示——玩家已在对局中途）。
    endHandled = false; endlessResult = null; settleChange = null; ui.paused = false; pvpExitPopup = false; pausePhase = 'main';
    ui.passivePopup = null; ui.passivePopupUntil = 0; ui.activePopup = null; ui.aiItemPopup = null; ui.peachPopup = false; ui.bombPopup = null;
    // 快进后本方唐僧已死（我方刷新期间空转推进被吃穿）→ ①立即经 WS 上报 tangsengDead（一次性，镜像主循环终局上报），
    // 让服务端据权威模型即时结算对手、不必干等断线计时器；②本地先置判负 result：frame() 结算门控据此冻结定格并走
    // PvP 结算（我方刷新致死是正常扣减）。服务端权威 result 到达时因 pvpResult 已非空不再重复结算。
    if (battle.status === 'lost') {
      if (pvpSock && !pvpStatusReported) { pvpSock.sendStatus('tangsengDead'); pvpStatusReported = true; }
      pvpResult = { outcome: 'lose', reason: 'selfTangsengDead' };
    }
    screen = 'battle';
    scheduleFrame();
  };

  // hello 失败：服务端未确认对局（已结束/被回收，或 uid 不属于该局）→ 清对局态（含清快照）+ 回首页，不进战斗。
  const goHome = (): void => {
    endPvpSession();     // 关这条已死 WS + 清 pvpSock/oppView 等；内部已 clearSessionSave（作废这一局快照，别再重连）
    screen = 'menu';
    scheduleFrame();
  };

  // 连 WS 校验对局是否仍在：共用 makePvpCallbacks（onOppSnap/onNextWave/onResult/onOppGone/onNoShow + 鉴权），
  // 覆盖 onWelcome=快进、追加 onHelloFail=回首页。uid 用存档记录值（与本机 ensureUserId 同源）。
  // welcomeTimeoutMs：对局已亡时服务端不回 welcome 也不关连接（见函数头注释），必须靠此截止兜底回首页，否则永卡 loading。
  pvpSock = new PvpSocket({
    matchId: meta.matchId,
    uid: meta.uid,
    ...makePvpCallbacks(),
    onWelcome: fastForward,
    onHelloFail: goHome,
    welcomeTimeoutMs: RESUME_WELCOME_TIMEOUT_MS,
    wsFactory: pvpWsFactoryOverride ?? undefined,
  });
  pvpSock.connect();
  // 屏幕保持 'loading'（boot 已短路首页）：welcome→fastForward 切 'battle'；hello 失败/超时→goHome 切 'menu'。
}

function abortBattleToMenu(): void {
  endPvpSession(); // Task 10：统一清理 PvP 对局态（关 WS、清 pvpSock/oppView/pvpSettleResult 等）；内部已 clearSessionSave（作废统一续玩快照）。单人调用无副作用（幂等）
  clearBattleToasts(); // 清残留续玩 toast
  ui.paused = false;
  pvpExitPopup = false;
  resumePopup = false; // 退出对局：清续玩选择弹窗态
  shareShovelPopup = null; // 退出对局：清铲子分享结果弹窗态
  pausePhase = 'main';
  ui.passivePopup = null;
  ui.passivePopupUntil = 0;
  ui.activePopup = null;
  ui.aiItemPopup = null;
  ui.peachPopup = false;
  ui.bombPopup = null;
  settleChange = null;
  endlessResult = null;
  clearBoardSelect();
  try { stopAmbient(); } catch { /* ignore */ }
  screen = 'menu';
}

/** 首页连点版本号 7 次：打开 DevTools 调参面板 */
function handleVersionSecretTap(): void {
  const now = performance.now();
  if (now - versionTapLastAt > VERSION_SECRET_TAP_MS) versionTapCount = 0;
  versionTapLastAt = now;
  versionTapCount++;
  if (versionTapCount < VERSION_SECRET_TAPS) return;
  versionTapCount = 0;
  playSfx('click');
  // FPS 调试浮层：连点 7 次 toggle（全平台——纯 canvas 绘制，微信小游戏也能用；
  // 真机低端机排查帧率问题主要靠它，见 perf-diagnosis 记忆）。
  fpsOverlayOn = !fpsOverlayOn;
  // DevTools 面板是 DOM 实现（document.createElement/<style>/<input>…），微信小游戏运行时无 DOM，
  // 触到 document 会抛 ReferenceError；旧代码 .then 无 .catch → 连点 7 下静默无反应（用户反馈「显示不出来」）。
  // 微信端明确提示不可用（应在网页端调参、真机只做验证）；.catch 兜底任何加载/构造错误。
  if (isWeChat) {
    menuToast = fpsOverlayOn ? 'FPS 显示已开（再连 7 次关闭）' : 'FPS 显示已关';
    scheduleFrame();
    return;
  }
  // DevTools 面板体积较大且仅调试用，动态导入让它独立分包，不进主包体积（非循环依赖规避，纯代码分割）
  void import('./devtools').then(({ openDevTools }) => {
    openDevTools({ onUserApplied: applyDevUserResult });
    menuToast = '已打开 DevTools';
    scheduleFrame();
  }).catch(() => { menuToast = 'DevTools 打开失败'; scheduleFrame(); });
}

function applyDevUserResult(r: ApplyUserResult): void {
  stamina = r.stamina;
  merit = r.merit;
  rank = r.rank;
  loadout = r.loadout;
  bag = r.bag;
  tutorial = loadTutorialState();
  setHudRank(rankName(rank.level));
  scheduleFrame();
}

function handleMenu(id: string) {
  playSfx('click');
  if (id === 'avatar') {
    profilePopup = createProfilePopupState();
    menuPopup = 'profile';
    scheduleFrame();
    return;
  }
  if (id === 'settings') {
    openSettingsPopup();
    return;
  }
  if (id === 'help') {
    menuHelpLazy.ensure(() => {
      helpScrollY = 0;
      menuPopup = 'help';
      scheduleFrame();
    });
    return;
  }
  if (id === 'staminaPlus') {
    openStaminaPopup();
    return;
  }
  if (id === 'mapPick') {
    openMapPopup();
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
    track('stamina', { delta: -5, remain: stamina.value });
    track('game_start', { endless: endlessOn, mapId: currentMap.id });
    scheduleCloudSync(5000);
    newGame();
    screen = 'battle';
    tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, battleIntroSequence());
    armGameStartHint();
  } else if (id === 'pvpMatch' || id === 'pvpInvite') {
    // PvP 入口门槛（Task 10）：需先玩过一局单人关卡才解锁真人对战。
    // 未解锁时只飘字提示、不进入匹配；体力门槛在其后、彼此独立（先查解锁，再查体力）。
    // 用 pvpUnlocked()（纯谓词，见 play-history.ts）而非直接读标记，便于单测门槛决策。
    if (!pvpUnlocked()) {
      menuToast = '先玩一局单人关卡熟悉玩法';
      pushMenuFloatToast('先玩一局单人关卡熟悉玩法，再来真人对战', { replace: true });
      scheduleFrame();
      return;
    }
    if (stamina.value < STAMINA_COST) {
      menuToast = '体力不足（需 5 点）！点 + 补充';
      pushMenuFloatToast('体力不足，无法进入匹配');
      scheduleFrame();
      return;
    }
    enterPvpMatching(id === 'pvpInvite' ? 'invite' : 'random');
  } else if (id === 'codex') {
    enterCodex();
  } else if (id === 'rank') {
    enterRank();
  } else if (id === 'bag') {
    enterBag();
  } else {
    menuToast = '该功能开发中…';
  }
}

function handleMenuPopupPointer(x: number, y: number): boolean {
  if (menuPopup === 'none') return false;
  if (menuPopup === 'profile' && profilePopup) {
    const hit = profilePopupHitAt(x, y, profilePopup);
    if (hit === null) return true;
    if (hit.kind === 'scroll' || hit.kind === 'avatar') {
      // 按下只开始拖动；轻点松手再选中，避免一滑就换头像
      profileScrollDrag = {
        x,
        scroll: profilePopup.scrollX,
        moved: false,
        avatarId: hit.kind === 'avatar' ? hit.id : null,
      };
      return true;
    }
    playSfx('click');
    if (hit.kind === 'close') {
      closeNicknameEditor();
      menuPopup = 'none';
      profilePopup = null;
      profileScrollDrag = null;
      return true;
    }
    if (hit.kind === 'nickname') {
      openNicknameEditor(profilePopup.nicknameDraft, (next) => {
        if (next !== null && profilePopup) {
          profilePopup.nicknameDraft = clampNickname(next);
        }
        scheduleFrame();
      });
      return true;
    }
    if (hit.kind === 'copyUid') {
      const uid = loadUserId();
      if (uid && !profileCopyBusy) {
        profileCopyBusy = true;
        void copyUserId(uid).then((ok) => {
          pushMenuFloatToast(ok ? '复制成功' : '复制失败', {
            replace: true,
            anchorY: profileCopyToastAnchorY(),
          });
          scheduleFrame();
        }).finally(() => {
          profileCopyBusy = false;
        });
      }
      return true;
    }
    if (hit.kind === 'confirm') {
      const sel = profilePopup.selectedId;
      if (!profilePopup.unlocked.has(sel)) {
        menuToast = '该头像尚未解锁';
        pushMenuFloatToast('头像未解锁', { replace: true, anchorY: profileConfirmToastAnchorY() });
        return true;
      }
      const nick = profilePopup.nicknameDraft.trim() || null;
      void updateProfile({ avatarId: sel, nickname: nick }).then((ok) => {
        menuToast = ok ? '资料已更新' : '资料同步失败（已保留本地选择）';
        pushMenuFloatToast(ok ? '资料已更新' : '资料同步失败', {
          replace: true,
          // 失败时弹层仍开着，锚在确认按钮上方；成功已关层，用默认起点
          ...(ok ? {} : { anchorY: profileConfirmToastAnchorY() }),
        });
        if (ok) {
          closeNicknameEditor();
          menuPopup = 'none';
          profilePopup = null;
        }
        scheduleFrame();
      });
      return true;
    }
    return true;
  }
  if (menuPopup === 'settings') {
    const pop = menuPopupsLazy.get()!;
    const hit = pop.settingsHitAt(x, y, gameSettings);
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
    if (hit.kind === 'toggleFx') {
      // 精简特效（2 档手动画质，默认全开）：即时切档并持久化——替代曾因帧时波动
      // 让阴影「偶尔出现/消失」的 EMA 自动调档（2026-09-01 用户拍板）
      gameSettings = setFxLite(gameSettings, !gameSettings.fxLite);
      applySettingsFxTier();
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
    if (hit.kind === 'musicKnob') {
      menuSliderDrag = 'music';
      gameSettings = setMusicVolume(gameSettings, pop.settingsMusicVolumeFromX(x));
      syncAudioFromSettings();
      return true;
    }
    if (hit.kind === 'sfxKnob') {
      menuSliderDrag = 'sfx';
      gameSettings = setSfxVolume(gameSettings, pop.settingsSfxVolumeFromX(x));
      syncAudioFromSettings();
      return true;
    }
    return true;
  }
  if (menuPopup === 'help') {
    const hit = menuHelpLazy.get()!.helpPopupHitAt(x, y, helpScrollY, ctx);
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
    const hit = menuPopupsLazy.get()!.mapPopupHitAt(x, y, mapScrollY);
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
    // 点卡片/滚动视区：先进拖拽态，未拖动抬起才算点选（拖动=滚动卡片区）
    mapPointerActive = true;
    mapDragged = false;
    mapDownX = x;
    mapDownY = y;
    mapDownScroll = mapScrollY;
    return true;
  }
  const hit = menuPopupsLazy.get()!.staminaPopupHitAt(x, y);
  if (hit === null) return true;
  playSfx('click');
  if (hit.kind === 'close') {
    menuPopup = 'none';
    staminaPopupToast = '';
    return true;
  }
  if (hit.kind === 'ad') {
    staminaPopupToast = '正在加载广告…';
    track('ad_click', { scene: 'stamina' });
    void showRewardedAd('stamina').then((ok) => {
      if (ok) {
        stamina = addStamina(stamina, 10);
        staminaPopupToast = '体力 +10';
        track('ad_reward', { scene: 'stamina' });
        track('stamina', { delta: 10, remain: stamina.value });
        scheduleCloudSync(2000);
      } else {
        staminaPopupToast = '未看完广告，未发放体力';
      }
      scheduleFrame();
    });
    return true;
  }
  if (hit.kind === 'share') {
    // 微信端真分享：判定成功后 +5 体力，扣 1 次每日额度；web 端此位画的是看广告(hit 映射为 'ad')，不会进本分支。
    if (!canShare('stamina')) { staminaPopupToast = '今日分享已达上限'; return true; }
    if (stamina.value >= STAMINA_MAX) { staminaPopupToast = '体力已满'; return true; }
    staminaPopupToast = '正在拉起分享…';
    track('share_click', { scene: 'stamina' });
    void shareToFriend({ title: '大圣塔防·助我一臂之力！' }).then((ok) => {
      if (ok) {
        consumeShare('stamina');
        staminaSharesLeft = remainingShares('stamina');
        stamina = addStamina(stamina, 5);
        staminaPopupToast = '分享成功，体力 +5';
        track('share_success', { scene: 'stamina' });
        track('stamina', { delta: 5, remain: stamina.value });
        scheduleCloudSync(2000);
      } else {
        staminaPopupToast = '未完成分享，未发放体力';
        track('share_fail', { scene: 'stamina' });
      }
      scheduleFrame();
    }).catch(() => { /* 防御:内部已各自吞错 */ });
    return true;
  }
  return true;
}

function handleMenuPopupDrag(x: number): void {
  if (menuPopup === 'profile' && profilePopup && profileScrollDrag) {
    applyProfileScrollDrag(profilePopup, profileScrollDrag, x);
    scheduleFrame();
    return;
  }
  if (menuPopup !== 'settings' || !menuSliderDrag) return;
  const pop = menuPopupsLazy.get()!;
  const v = menuSliderDrag === 'music' ? pop.settingsMusicVolumeFromX(x) : pop.settingsSfxVolumeFromX(x);
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
  const mc = merchantLazy.get()!;
  const hit = mc.merchantHitAt(x, y, merchant, loadout);
  if (hit === null) {
    if (merchant.testMode && mc.merchantTestScrollAreaContains(x, y)) return false;
    return true;
  }
  playSfx('click');
  const res = mc.applyMerchantHitFull(hit, merchant, loadout, merit);
  merchant = res.merchant;
  loadout = res.loadout;
  merit = res.merit;
  return true;
}

function applyMerchantHitAt(x: number, y: number): void {
  const mc = merchantLazy.get()!;
  const hit = mc.merchantHitAt(x, y, merchant, loadout);
  if (!hit) return;
  playSfx('click');
  const res = mc.applyMerchantHitFull(hit, merchant, loadout, merit);
  merchant = res.merchant;
  loadout = res.loadout;
  merit = res.merit;
}

// 只重挂注入型函数字段（续玩用）：不触发一次性神兵碎片掉落规划，避免覆盖已恢复状态/推进 RNG。
function injectWeaponPickupVisible(): void {
  battle.weaponPickupVisible = (id) => !isWeaponFragmentsComplete(bag, id);
}
function bindBattleWeaponPickup(): void {
  injectWeaponPickupVisible();
  battle.planBattleFragmentDrop(); // 新开局：规划本局神兵碎片掉落（会消耗 rng、置 battleFragmentDropped/Id）
}

function visibleWeaponPickups(): string[] {
  return battle.pendingWeaponPickups.filter((id) => !isWeaponFragmentsComplete(bag, id));
}

/**
 * 关键节点/帧尾统一落档：按当前是否在线 PvP 选 kind 与 opts，写入受 io（dirty/force/now 节流）控制，返回是否真正写入。
 * 仅在「可续玩战斗」中有效：screen==='battle' 且 !endHandled；PvP 终局（pvpResult 到达）后即停（match 已结束不留
 * 可恢复快照，否则刷新会尝试恢复一局已亡对局）。其余情形（非战斗屏/已终局/PvP 已判定）为 no-op 返回 false。
 * 集中于此，避免帧尾与关键节点（如领取碎片强制落档）两处各自构造 PvP 元信息而漂移。
 *
 * seed 传中性常量 1：Battle 不暴露构造种子，恢复走 restoreBattle+applyCoreState 覆盖全部 RNG 态，故 seed 与恢复无关。
 * mapId 无需在 opts 传：serialize 已把它落入 config.mapId。PvP 元信息：matchId/uid 取自当前 WS（public readonly，
 * 身份零漂移），side 用 pvpSide（?? 'a' 仅防御 null，对局中不会为 null），localSimTick=本方已完成步数（恢复后据此
 * + 服务端当前 tick 快进对齐）。
 */
function sessionCheckpointNow(io: SessionSaveCheckpointIo): boolean {
  if (screen !== 'battle' || endHandled) return false;
  if (pvpSock) {
    if (pvpResult) return false;             // PvP 终局：result 一到即停止落档
    return sessionSaveCheckpoint('pvp', battle, {
      seed: 1,
      pvp: {
        matchId: pvpSock.matchId,
        uid: pvpSock.uid,
        side: pvpSide ?? 'a',
        startAtServerMs: pvpMatchStartMs,
        localSimTick,
      },
    }, io);
  }
  return sessionSaveCheckpoint('pve', battle, { seed: 1 }, io);
}

function claimWeaponPickup(id: string): void {
  const idx = battle.pendingWeaponPickups.indexOf(id);
  if (idx < 0) return;
  battle.pendingWeaponPickups.splice(idx, 1);
  // 领取神兵碎片是「改动已序列化战斗态(pendingWeaponPickups)」的玩家输入：碎片立即入 bag(addWeaponFragment→saveBag)，
  // 而 pendingWeaponPickups 若不同刻落档，节流窗口内刷新会恢复旧拾取（拾取重现）而 bag 已记账 → 可反复领取刷重复碎片。
  // 领取低频（无写风暴风险），故除置脏标外再强制立即落档一次，把 pendingWeaponPickups 与 bag 落到同一刻、彻底关闭该窗口；
  // 强制写成功即清脏标，免帧尾重复写。非可续玩战斗（如结算屏领取，terminal-gated）中 force 落档为 no-op，脏标留待兜底、无害。
  pvpSaveDirty = true;
  if (sessionCheckpointNow({ force: true })) pvpSaveDirty = false;
  playSfx('click');
  const r = addWeaponFragment(bag, id);
  bag = r.state;
  const name = weaponById(id)?.name ?? id;
  if (r.activated) battle.message = `激活神兵：${name}`;
  else if (r.upgraded) battle.message = `获得神兵：${name} 升阶`;
  else battle.message = `获得碎片：${name}（${r.fragments}/${r.required}）`;
}

function leaveSettleToMenu(): void {
  endPvpSession(); // Task 10：统一清理 PvP 对局态（PvP 结算点「返回」也走此路径；幂等）
  settleChange = null;
  endlessResult = null;
  screen = 'menu';
  if (pendingMerchant) {
    pendingMerchant = false;
    // 通常已被空闲预取加载完毕，ensure() 同步回调；极端情况下（战斗结算过快）在此兜底等待分包加载。
    merchantLazy.ensure((m) => {
      merchant = m.openMerchant(loadout);
      tutorialOverlay = maybeStartTutorial(tutorial, tutorialOverlay, merchantFirstOpenSequence());
      scheduleFrame();
    });
  }
}

// —— 画布尺寸 / DPR —— //
let cssScale = 1;
let viewOffsetX = 0; // 小游戏 letterbox 水平偏移(CSS px)：VIEW 居中留黑边，toLogical 反算触摸用
let viewOffsetY = 0; // 小游戏 letterbox 垂直偏移(CSS px)

function isCoarseMobile(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

function readViewport(): { w: number; h: number; offsetX: number; offsetY: number } {
  // 微信小游戏：视口取 wx 窗口信息（window.innerWidth 在小游戏里是 1×1 桩，会把画布算成 2px→整屏糊底）。
  if (isWeChat) {
    const { w, h } = getViewportSize();
    return { w, h, offsetX: 0, offsetY: 0 };
  }
  const vv = window.visualViewport;
  if (!vv) {
    return { w: window.innerWidth, h: window.innerHeight, offsetX: 0, offsetY: 0 };
  }
  return { w: vv.width, h: vv.height, offsetX: vv.offsetLeft, offsetY: vv.offsetTop };
}

/** 首次触摸时尝试进入浏览器全屏（Android 等支持；iOS 需「添加到主屏幕」） */
let mobileFullscreenTried = false;
function tryMobileFullscreen(): void {
  // 微信小游戏本就全屏，且运行时无 document.documentElement（读 .requestFullscreen 会抛
  // "Cannot read properties of undefined"）——直接跳过。全屏是纯 Web 浏览器的事。
  if (isWeChat) return;
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
  if (isWeChat) {
    // 小游戏：主画布即全屏，位图=屏幕像素；VIEW 居中等比 letterbox。裁剪与「黑边无缝填充」改到 frame() 每帧做
    // （裁剪到 VIEW 画游戏，再把 VIEW 边缘像素拉伸进上下/左右黑边 → 无缝全屏）。无 CSS，故不设 canvas.style。
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    viewOffsetX = Math.round((w - VIEW_W * fit) / 2);
    viewOffsetY = Math.round((h - VIEW_H * fit) / 2);
    ctx.setTransform(fit * dpr, 0, 0, fit * dpr, viewOffsetX * dpr, viewOffsetY * dpr);
    scheduleFrame();
    return;
  }
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
  if (isWeChat) {
    // 小游戏：touch 坐标是屏幕 CSS 像素；扣掉 letterbox 偏移再按 fit 反算到 VIEW 逻辑坐标。
    return { x: (clientX - viewOffsetX) / cssScale, y: (clientY - viewOffsetY) / cssScale };
  }
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / cssScale,
    y: (clientY - rect.top) / cssScale,
  };
}

function activeSlotHit(x: number, y: number): 0 | 1 | null {
  for (const btn of getButtons(battle)) {
    if ((btn.id === 'act0' || btn.id === 'act1') && btn.enabled
      && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      return btn.id === 'act0' ? 0 : 1;
    }
  }
  return null;
}

function handlePillActivePointerDown(e: PointerEvent, x: number, y: number): boolean {
  const actSlot = activeSlotHit(x, y);
  if (actSlot === null) return false;
  const slot = battle.activeSlots[actSlot];
  const def = slot ? activeById(slot.id) : undefined;
  if (!def || !isDragActiveEffect(def.effect)) return false; // 仙丹/风火轮/炸药：拖拽释放
  // 备战(ready)与对战(playing)都允许拖放主动技能（仙丹/风火轮预布兵器、炸药预埋路径）
  const usableNow = battle.status === 'playing' || battle.status === 'ready';
  if (usableNow && slot?.ready) {
    ui.dragActiveSlot = actSlot;
    ui.activeDragStart = { x, y };
    ui.dragPos = { x, y };
    ui.activePopup = null;
    canvas.setPointerCapture(e.pointerId);
    return true;
  }
  ui.activePopup = actSlot;
  ui.activePopupUntil = performance.now() + 2500;
  clearBoardSelect();
  return true;
}

function clearActiveDrag(): void {
  ui.dragActiveSlot = null;
  ui.activeDragStart = null;
}

function handleButton(x: number, y: number): boolean {
  for (const btn of getButtons(battle)) {
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      if (!btn.enabled) {
        // 桃够但飞入未结束：吞掉连点并提示，避免连续征兵抖动
        if (
          btn.id === 'summon'
          && battle.peach >= battle.effectiveSummonCost()
          && !summonAnimDone(battle)
        ) {
          battle.message = '征兵冷却中';
        }
        return true;
      }
      if (!btn.id.startsWith('pas')) playSfx('click');
      if (btn.id === 'summon') {
        if (battle.summon()) {
          pvpSaveDirty = true; // 征兵成功改动战斗态 → 尽快落档
          pendingFirstSummonTutorial = true;
          // 首局引导：玩家成功征兵 → 记录（供 updateFirstGameGuide 把箭头从「征兵」切到「部署」阶段）
          if (guidePhase === 'summon') playerSummonedThisGame = true;
        }
      } else if (btn.id === 'autoplace') { battle.autoPlaceTray(); pvpSaveDirty = true; } // 一键布阵改动部署态 → 尽快落档
      else if (btn.id === 'act0' || btn.id === 'act1') {
        const i = btn.id === 'act1' ? 1 : 0;
        const def = activeById(battle.activeSlots[i]?.id ?? '');
        if (def && isDragActiveEffect(def.effect)) return true; // 拖拽类技能不响应点按触发
        if (battle.activeSlots[i]?.ready) { battle.triggerActive(i); pvpSaveDirty = true; activeUsedThisGame = true; } // 主动技释放改动战斗态 → 尽快落档；用过了→停施放演示
        else {
          ui.activePopup = i;
          ui.activePopupUntil = performance.now() + 2500;
        }
      }
      else if (btn.id.startsWith('pas')) {
        ui.aiItemPopup = null;
        ui.peachPopup = false;
        ui.passivePopup = Number(btn.id.slice(3));
        ui.passivePopupUntil = performance.now() + 2500;
      } // 点击被动图标看详情
      else if (btn.id === 'restart') { endPvpSession(); screen = 'menu'; } // 结束后返回主菜单（看更新的境界/体力）；Task 10 补清 PvP 对局态（幂等）
      return true;
    }
  }
  return false;
}

// tray 铲子分享按钮点击：微信真分享 → 回来弹「分享结果」弹窗（成功/失败都明确告知）。
// 成功后不立即挖格，改由弹窗「确认开辟」按钮触发 shareDigBest（播挖坑动画）并扣 1 次铲子额度（见 onPointerDown）。
async function handleShareShovel(): Promise<void> {
  if (!canShare('shovel')) return; // 双保险（按钮已按铲子额度隐藏）
  if (!battle.hasDiggableCell()) { battle.message = '暂无可开垦阵位'; scheduleFrame(); return; } // 无可挖不发起分享
  track('share_click', { scene: 'shovel' });
  const ok = await shareToFriend({ title: '大圣塔防·助我一铲之力！' });
  track(ok ? 'share_success' : 'share_fail', { scene: 'shovel' });
  shareShovelPopup = ok ? 'success' : 'fail'; // 弹明显结果窗口；成功挖格挪到「确认」按钮
  scheduleFrame();
}

function onPointerDown(e: PointerEvent) {
  e.preventDefault();
  if (screen === 'loading') return; // 加载中不响应点击（BGM 仍可在进首页后由首次手势唤醒）
  // 战斗屏跟随 battle 的实际地图（PvP 由服务端指定，可能与菜单所选 currentMap 不同）
  resumeAudioAfterGesture(audioScreenKind(screen), screen === 'battle' ? battle.map.id : currentMap.id);
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
  // Task 10 首局引导「跳过」按钮：非模态——玩家仍可自由操作（征兵/拖拽），
  // 仅点中右上「跳过」胶囊才消耗点击：隐藏箭头 + 释放首波押后。
  // 置于教程 gate 之后、各 screen 分支之前，确保 battle 屏内任何位置点跳过都生效。
  if (screen === 'battle' && firstGameGuideSkipHit(x, y)) {
    dismissFirstGameGuide();
    playSfx('click');
    scheduleFrame();
    return;
  }
  if (screen === 'menu') {
    if (merchant.open && merchant.testMode) {
      const hit = merchantLazy.get()!.merchantHitAt(x, y, merchant, loadout);
      if (
        hit &&
        (hit.kind === 'close' ||
          hit.kind === 'continue' ||
          hit.kind === 'unequipActive' ||
          hit.kind === 'unequipPassive' ||
          hit.kind === 'cancelOfferBuy' ||
          hit.kind === 'confirmOfferBuy')
      ) {
        applyMerchantHitAt(x, y);
        return;
      }
      if (merchantLazy.get()!.merchantTestScrollAreaContains(x, y)) {
        merchantPointerActive = true;
        merchantDragged = false;
        merchantDownX = x;
        merchantDownY = y;
        merchantDownScroll = merchant.scrollY;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (handleMerchantPointer(x, y)) return;
    } else if (handleMerchantPointer(x, y)) {
      return;
    }
    if (handleMenuPopupPointer(x, y)) {
      if (menuSliderDrag || helpPointerActive || mapPointerActive || profileScrollDrag) canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (menuPopup === 'none' && !merchant.open && menuVersionHitAt(x, y)) {
      versionPointerDown = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    menuDownId = menuButtonAt(x, y);
    menuPressedId = menuDownId;
    if (menuDownId) canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (screen === 'pvpMatching') {
    const mc = pvpMatchLazy.get(); const sc = pvpScreenLazy.get();
    if (!mc || !sc || !pvpController) return;
    const view = mc.toMatchView(pvpController.state, pvpMode, pvpCopied);
    if (!view) { screen = 'menu'; scheduleFrame(); return; }
    const hit = sc.pvpMatchingHitAt(x, y, view);
    if (hit === 'exit') {
      playSfx('click'); abandonPvpMatching(); // 复用：cancel 服务端 ticket + 回首页
    } else if (hit === 'ok') {
      pvpController = null; screen = 'menu'; scheduleFrame();
    } else if (hit === 'copy' && pvpController.state.code) {
      const code = pvpController.state.code;
      if (isWeChat) {
        // 小游戏：弹微信分享卡片(query 带房号)，好友点卡片启动小游戏即加入；无链接可复制。
        shareVersusInvite(code, '来和我 1v1！——妖怪来袭');
        pvpCopied = true; // 复用该态作「已分享」反馈（文案在 pvp-screen 按平台区分）
      } else {
        // 网页：复制深链（location.origin+pathname 自适应 /xy 子路径），好友打开链接即加入。
        const link = sc.versusShareLink(code);
        try { void navigator.clipboard?.writeText(link).then(() => { pvpCopied = true; scheduleFrame(); }).catch(() => {}); } catch { /* 剪贴板不可用则忽略 */ }
      }
      scheduleFrame();
    }
    return;
  }
  if (screen === 'codex') {
    const cx = codexLazy.get()!;
    if (cx.codexHitBack(x, y)) {
      screen = 'menu';
      return;
    }
    if (cx.codexPointerDown(x, y)) {
      canvas.setPointerCapture(e.pointerId);
      scheduleFrame();
    }
    return;
  }
  if (screen === 'rank') {
    if (leaderboardLazy.get()!.leaderboardHitBack(x, y)) screen = 'menu';
    return;
  }
  if (screen === 'bag') {
    if (bagPopup) {
      const r = bagLazy.get()!.bagPopupHitAt(x, y);
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
  // 断线弹窗独占——展示期间（我方断线 pvpNetDead / 对方断线 pvpOppGone）吞掉其它战斗点击。
  // 点中 × → 提前结束：我方侧关 WS 回首页；对方侧直接走结算（不手动跳过倒计时，但允许 × 提前退出）。
  if (pvpNetDead) {
    if (disconnectHitClose(x, y)) { playSfx('click'); endPvpSession(); screen = 'menu'; scheduleFrame(); }
    return;
  }
  if (pvpOppGone && !pvpResult) {
    if (disconnectHitClose(x, y)) { playSfx('click'); pvpResult = { outcome: 'win', reason: 'opponentDisconnectTimeout' }; }
    return;
  }
  if (isSettleOpen()) {
    const pickupId = weaponPickupHitAt(x, y, visibleWeaponPickups(), bag);
    if (pickupId) {
      claimWeaponPickup(pickupId);
      return;
    }
    // PvP 结算用 pvpSettleStart 计时；单人仍用 settleStart。动画未完成则跳到终态（允许点击）。
    const animDone = pvpSettleResult
      ? isSettleAnimDone(performance.now() - pvpSettleStart)
      : (endlessResult || isSettleAnimDone(performance.now() - settleStart));
    if (animDone) {
      // leaveSettleToMenu 开头会调 endPvpSession()：PvP 下清 pvpSock/pvpSettleResult 等全部对局态。
      leaveSettleToMenu();
    } else if (!pvpSettleResult) {
      // 单人结算才允许「点击跳到终态」；PvP 无加减星动画，保持计时不动。
      settleStart = performance.now() - SETTLE_ANIM_MS;
    }
    return;
  }
  // —— 续玩选择弹窗（中途恢复）：模态，必须选「继续」或「回到首页」，点窗外不关闭 —— //
  if (resumePopup) {
    const hit = resumePopupHitAt(x, y);
    if (hit === null) return;
    playSfx('click');
    resumePopup = false;
    if (hit === 'home') abortBattleToMenu(); // 回到首页：清续玩存档 + 回主界面
    else if (battle.status === 'ready') battle.startNextWave(); // 继续即开打：跳过恢复后的开波等待(waveGap 倒计时/入场)，不必再点一次页面
    scheduleFrame();
    return;
  }
  // —— 铲子分享结果弹窗：模态，只响应「确认」按钮；成功「确认」后才挖格（播挖坑动画）——
  if (shareShovelPopup) {
    const hit = shareShovelPopupHitAt(x, y);
    if (hit === null) return; // 点窗外不关闭
    playSfx('click');
    const wasSuccess = shareShovelPopup === 'success';
    shareShovelPopup = null;
    if (wasSuccess) {
      // shareDigBest 内 push digFx 播挖坑动画；挖到才扣 1 次铲子额度（先挖后扣，无可挖格不扣）
      if (battle.shareDigBest()) { pvpSaveDirty = true; consumeShare('shovel'); } // 开格改动棋盘 → 尽快落档
      else battle.message = '暂无可开垦阵位';
    }
    scheduleFrame();
    return;
  }
  // —— 局内暂停/退出弹窗：继续 / 终止（二次确认·单人） / 认输（PvP 一步到位） —— //
  // 用纯函数 isPausePopupOpenPure(ui.paused, pvpExitPopup) 同时覆盖单人暂停(ui.paused) 与 PvP 退出弹窗(pvpExitPopup)：
  // 两者都把指针锁进弹窗（模态输入），差别只在仿真是否停（由下方步进门控的 ui.paused 决定）。
  if (isPausePopupOpenPure(ui.paused, pvpExitPopup)) {
    const hit = pausePopupHitAt(x, y, pausePhase, pvpSock ? 'match' : 'battle');
    if (hit === null) return;
    playSfx('click');
    if (hit.kind === 'continue') {
      closePausePopup();
    } else if (hit.kind === 'surrender') {
      // PvP 认输：经 WS 上报 surrender（一次性），等服务端 result 驱动结算（不直接 abortBattleToMenu，否则泄漏对局且无结算）。
      pvpSurrendered = true;
      if (pvpSock && !pvpStatusReported) { pvpSock.sendStatus('surrender'); pvpStatusReported = true; }
      closePausePopup();
      battle.message = '已认输，等待结算…';
    } else if (hit.kind === 'quit') {
      pausePhase = 'confirmQuit';
    } else if (hit.kind === 'cancelQuit') {
      pausePhase = 'main';
    } else if (hit.kind === 'confirmQuit') {
      pvpExitPopup = false; // 防御性清零（此分支本只属单人，但确认终止后不应残留 PvP 弹窗态）
      abortBattleToMenu();
    }
    return;
  }
  if (hitShareShovelBtn(x, y, battle)) {
    playSfx('click');
    void handleShareShovel().catch(() => {});
    return;
  }
  if (hitPauseBtn(x, y) && (battle.status === 'ready' || battle.status === 'playing')) {
    playSfx('click');
    if (pvpSock) {
      // PvP：右上角「退出」按钮——只开退出弹窗（模态拦截输入），**不**置 ui.paused，
      // 仿真步进门控只看 ui.paused，故怪照走、WS 照发，弹窗只是浮在上层的退出确认。
      pvpExitPopup = true;
    } else {
      // 单人：原暂停语义——仿真同步冻结。
      ui.paused = true;
    }
    pausePhase = 'main';
    clearBoardSelect();
    ui.dragFrom = null;
    ui.dragTrayIndex = null;
    ui.dragPos = null;
    ui.trayDragStart = null;
    clearActiveDrag();
    return;
  }
  // 点棋盘任意处先关掉地雷信息弹窗（若点中的正是同一颗地雷，则下方按「再次点=关闭」处理）
  const prevBombPopup = ui.bombPopup;
  ui.bombPopup = null;
  // 我方蟠桃 / AI 道具详情：任意点击先关闭（消费本次点击）
  if (ui.peachPopup) { ui.peachPopup = false; return; }
  if (ui.aiItemPopup !== null) { ui.aiItemPopup = null; return; }
  if (hitPeachHud(x, y) && (battle.status === 'ready' || battle.status === 'playing')) {
    ui.passivePopup = null;
    ui.activePopup = null;
    ui.aiItemPopup = null;
    ui.peachPopup = true;
    clearBoardSelect();
    return;
  }
  const aiChip = hitAiItemChip(x, y, battle);
  if (aiChip !== null) {
    ui.passivePopup = null;
    ui.activePopup = null;
    ui.peachPopup = false;
    ui.aiItemPopup = ui.aiItemPopup === aiChip ? null : aiChip;
    clearBoardSelect();
    return;
  }
  const pickupId = weaponPickupHitAt(x, y, visibleWeaponPickups(), bag);
  if (pickupId) {
    claimWeaponPickup(pickupId);
    return;
  }
  if (handlePillActivePointerDown(e, x, y)) return;
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
  // 点击路径上已埋的地雷：查看信息（玩家/AI 双方的都可点，炸弹画在棋盘地面层）
  if (cell) {
    const hit = battle.bombs.find((bm) => bm.c === cell.c && bm.r === cell.r)
      ?? battle.aiBombs.find((bm) => bm.c === cell.c && bm.r === cell.r);
    if (hit) {
      const now = performance.now();
      const same = prevBombPopup && prevBombPopup.c === cell.c && prevBombPopup.r === cell.r && now < prevBombPopup.until;
      ui.bombPopup = same ? null : { c: cell.c, r: cell.r, until: now + 2500 };
      clearBoardSelect();
      return;
    }
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
// Web 用 canvas 的 DOM pointer 事件；微信小游戏走下面的 onWxTouch（wx.onTouch*）。
// 关键：微信开发者工具（基于 Chrome）里 canvas 也会派发 DOM pointerdown，但真机不会——若两条都注册，
// DevTools 下同一次点击会「双触发」（如暂停被连点两次=开了又关=看似无反应），且 pointerdown 里的
// tryMobileFullscreen 在小游戏运行时会抛错。故微信下只保留 onWxTouch 这一条，与真机行为一致。
if (!isWeChat) {
  canvas.addEventListener('pointerdown', (e) => { tryMobileFullscreen(); onPointerDown(e); scheduleFrame(); });
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', (e) => { onPointerUp(e); scheduleFrame(); });
  canvas.addEventListener('pointercancel', (e) => { onPointerUp(e, true); scheduleFrame(); });
}
// 小游戏无 pointer 事件：把 wx.onTouch* 合成成 PointerEvent 复用同一套指针逻辑（单指为主，多指取最新触点）。
if (isWeChat) {
  const synth = (t: { clientX: number; clientY: number; identifier: number }): PointerEvent => ({
    clientX: t.clientX, clientY: t.clientY, pointerId: t.identifier ?? 0, pointerType: 'touch',
    button: 0, buttons: 1, isPrimary: true,
    preventDefault() {}, stopPropagation() {}, setPointerCapture() {}, releasePointerCapture() {},
  } as unknown as PointerEvent);
  const latest = (e: WxTouchEvent) => e.touches[e.touches.length - 1] ?? e.changedTouches[e.changedTouches.length - 1];
  onWxTouch({
    start: (e) => { const t = latest(e); if (!t) return; onPointerDown(synth(t)); scheduleFrame(); },
    move: (e) => { const t = latest(e); if (t) onPointerMove(synth(t)); },
    end: (e) => { const t = e.changedTouches[e.changedTouches.length - 1] ?? e.touches[0]; onPointerUp(t ? synth(t) : undefined); scheduleFrame(); },
    cancel: (e) => { const t = e.changedTouches[e.changedTouches.length - 1]; onPointerUp(t ? synth(t) : undefined, true); scheduleFrame(); },
  });
}
function onPointerMove(e: PointerEvent) {
  if (screen === 'menu') {
    const { x, y } = toLogical(e.clientX, e.clientY);
    if (menuSliderDrag || profileScrollDrag) {
      handleMenuPopupDrag(x);
      return;
    }
    if (helpPointerActive && menuPopup === 'help') {
      const dy = y - helpDownY;
      if (Math.abs(dy) > 6) helpDragged = true;
      helpScrollY = Math.max(0, Math.min(menuHelpLazy.get()!.helpMaxScroll(ctx), helpDownScroll - dy));
      scheduleFrame();
      return;
    }
    if (mapPointerActive && menuPopup === 'map') {
      const dy = y - mapDownY;
      if (Math.abs(dy) > 6) mapDragged = true;
      mapScrollY = Math.max(0, Math.min(menuPopupsLazy.get()!.mapMaxScroll(), mapDownScroll - dy));
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
    if (merchantPointerActive && merchant.open && merchant.testMode) {
      const dy = y - merchantDownY;
      if (Math.abs(dy) > 6) merchantDragged = true;
      const max = merchantLazy.get()!.merchantMaxScroll(merchant);
      merchant = { ...merchant, scrollY: Math.max(0, Math.min(max, merchantDownScroll - dy)) };
      scheduleFrame();
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
  if (screen === 'bag' && bagPointerActive && !bagPopup) {
    const { y } = toLogical(e.clientX, e.clientY);
    const dy = y - bagDownY;
    if (Math.abs(dy) > 6) bagDragged = true;
    bagScrollY = Math.max(0, Math.min(bagLazy.get()!.bagMaxScroll(), bagDownScroll - dy));
    scheduleFrame();
    return;
  }
  if (screen === 'codex') {
    const { x, y } = toLogical(e.clientX, e.clientY);
    codexLazy.get()!.codexPointerMove(x, y);
    scheduleFrame();
    return;
  }
  if (!ui.dragFrom && ui.dragTrayIndex === null && ui.dragActiveSlot === null) return;
  ui.dragPos = toLogical(e.clientX, e.clientY);
  scheduleFrame(); // 拖拽中持续重绘（战斗界面本就连续；此处保证拖影跟手）
}
function onPointerUp(e?: PointerEvent, cancelled = false) {
  if (screen === 'pvpMatching') return; // 匹配屏交互只在 pointerdown 处理，pointerup 无动作（与 onPointerDown 对称）
  if (screen === 'menu') {
    if (merchantPointerActive) {
      const upX = e && !cancelled ? toLogical(e.clientX, e.clientY).x : merchantDownX;
      const upY = e && !cancelled ? toLogical(e.clientX, e.clientY).y : merchantDownY;
      const wasDrag = merchantDragged;
      merchantPointerActive = false;
      merchantDragged = false;
      if (!cancelled && !wasDrag && merchant.open && merchant.testMode) {
        applyMerchantHitAt(upX, upY);
      }
    }
    menuSliderDrag = null;
    if (profileScrollDrag && profilePopup) {
      if (!profileScrollDrag.moved && profileScrollDrag.avatarId) {
        profilePopup.selectedId = profileScrollDrag.avatarId;
        playSfx('click');
        scheduleFrame();
      }
      profileScrollDrag = null;
    }
    if (versionPointerDown) {
      versionPointerDown = false;
      if (!cancelled && e) {
        const { x, y } = toLogical(e.clientX, e.clientY);
        if (menuVersionHitAt(x, y) && menuPopup === 'none') handleVersionSecretTap();
      }
    }
    if (helpPointerActive) {
      const upX = e && !cancelled ? toLogical(e.clientX, e.clientY).x : helpDownX;
      const upY = e && !cancelled ? toLogical(e.clientX, e.clientY).y : helpDownY;
      const wasDrag = helpDragged;
      helpPointerActive = false;
      helpDragged = false;
      if (!cancelled && !wasDrag) {
        const hit = menuHelpLazy.get()!.helpPopupHitAt(upX, upY, helpScrollY, ctx);
        if (hit?.kind === 'link') openHelpLink(hit.id);
      }
      return;
    }
    if (mapPointerActive) {
      const upX = e && !cancelled ? toLogical(e.clientX, e.clientY).x : mapDownX;
      const upY = e && !cancelled ? toLogical(e.clientX, e.clientY).y : mapDownY;
      const wasDrag = mapDragged;
      mapPointerActive = false;
      mapDragged = false;
      // 未拖动（=点选）且未取消：按抬起位置重新命中，命中卡片才切换关卡
      if (!cancelled && !wasDrag && menuPopup === 'map') {
        const hit = menuPopupsLazy.get()!.mapPopupHitAt(upX, upY, mapScrollY);
        if (hit?.kind === 'map') {
          mapSelection = saveMapSelection({ mode: 'fixed', mapId: hit.mapId });
          currentMap = resolveMap(mapSelection);
          menuToast = `已切换：${currentMap.name}`;
          menuPopup = 'none';
          scheduleFrame();
        }
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
  if (screen === 'bag') {
    if (bagPointerActive && !bagDragged && !bagPopup) {
      const hit = bagLazy.get()!.bagHitAt(bagDownX, bagDownY, bag, bagScrollY);
      if (hit?.kind === 'back') screen = 'menu';
      else if (hit?.kind === 'toggle') bagPopup = hit.id;
    }
    bagPointerActive = false;
    return;
  }
  if (screen === 'codex') {
    const cx = codexLazy.get()!;
    if (e && !cancelled) {
      const { x, y } = toLogical(e.clientX, e.clientY);
      const action = cx.codexPointerUp(x, y, loadout);
      if (action) {
        playSfx('click');
        if (action.kind === 'unequip') {
          loadout = action.skillKind === 'active'
            ? unequipActive(loadout, action.id)
            : unequipPassive(loadout, action.id);
          cx.setCodexToast('已卸下');
        } else {
          const res = action.skillKind === 'active'
            ? equipActive(loadout, action.id)
            : equipPassive(loadout, action.id);
          loadout = res.loadout;
          cx.setCodexToast(res.ok ? '已装备' : (res.reason ?? (action.skillKind === 'active' ? ACTIVE_FULL_HINT : PASSIVE_FULL_HINT)));
        }
      }
    } else {
      cx.codexPointerUp();
    }
    return;
  }
  if (ui.dragActiveSlot !== null && ui.dragPos) {
    const moved = ui.activeDragStart
      && Math.hypot(ui.dragPos.x - ui.activeDragStart.x, ui.dragPos.y - ui.activeDragStart.y) > 8;
    if (!moved) {
      ui.activePopup = ui.dragActiveSlot;
      ui.activePopupUntil = performance.now() + 2500;
    } else {
      const target = pxToCell(ui.dragPos.x, ui.dragPos.y);
      if (target) {
        const slotDef = activeById(battle.activeSlots[ui.dragActiveSlot]?.id ?? '');
        const actId = battle.activeSlots[ui.dragActiveSlot]?.id;
        if (slotDef && isBombActiveEffect(slotDef.effect)) { battle.placeBomb(ui.dragActiveSlot, target); }
        else { battle.applyPillActive(ui.dragActiveSlot, target); }
        pvpSaveDirty = true; activeUsedThisGame = true; // 炸药预埋 / 仙丹·风火轮拖放施放改动战斗态 → 尽快落档；用过了→停施放演示
      }
    }
  } else if (ui.dragPos) {
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
        pvpSaveDirty = true; // 部署 / 铲地开格（shovel 令牌走同一 placeFromTray）改动战斗态 → 尽快落档
        ui.selectedTrayIndex = null;
      } else if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
        pvpSaveDirty = true; // 候选区合并升阶改动战斗态 → 尽快落档
        ui.selectedTrayIndex = null;
      }
    } else if (ui.dragFrom) {
      // 棋盘→候选区：空槽放入；同型同级槽位合并升阶；其它武器/字牌槽则交换（见 Battle.recallToTray）
      if (trayTarget !== null) {
        if (battle.recallToTray(ui.dragFrom, trayTarget)) { pvpSaveDirty = true; clearBoardSelect(); } // 回收到候选区改动战斗态 → 尽快落档
      } else if (target) {
        if (target.c === ui.dragFrom.c && target.r === ui.dragFrom.r) {
          // 未移动 = 点击：切换选中（显示/隐藏该单位信息面板与攻击范围）
          // 已激活武将：点左右任一格都视为同一选中态（双字同时选中）
          const same = isSameSelection(battle, ui.selected, target);
          if (same) clearBoardSelect();
          else selectBoardCell(target);
        } else {
          battle.dragBoard(ui.dragFrom, target);
          pvpSaveDirty = true; // 棋盘内移动/交换单位改动部署态 → 尽快落档
          clearBoardSelect();
        }
      }
    }
  }
  ui.dragFrom = null;
  ui.dragTrayIndex = null;
  ui.dragPos = null;
  ui.trayDragStart = null;
  clearActiveDrag();
}

// 桌面端滚轮滚动商城
canvas.addEventListener('wheel', (e) => {
  if (screen === 'menu' && menuPopup === 'profile' && profilePopup) {
    e.preventDefault();
    // 触控板横滑用 deltaX；鼠标滚轮用 deltaY 映射为横滚
    profilePopup.scrollX += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    clampProfileScroll(profilePopup);
    scheduleFrame();
    return;
  }
  if (screen === 'menu' && merchant.open && merchant.testMode) {
    e.preventDefault();
    merchant = merchantLazy.get()!.merchantApplyWheel(merchant, e.deltaY);
    scheduleFrame();
    return;
  }
  if (screen === 'menu' && menuPopup === 'help') {
    e.preventDefault();
    helpScrollY = Math.max(0, Math.min(menuHelpLazy.get()!.helpMaxScroll(ctx), helpScrollY + e.deltaY));
    scheduleFrame();
    return;
  }
  if (screen === 'bag' && !bagPopup) {
    e.preventDefault();
    bagScrollY = Math.max(0, Math.min(bagLazy.get()!.bagMaxScroll(), bagScrollY + e.deltaY));
    scheduleFrame();
    return;
  }
  if (screen === 'codex') {
    e.preventDefault();
    codexLazy.get()!.codexWheel(e.deltaY);
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

// 当前帧预算（帧间隔上限）：战斗/结算等 60fps；静置的菜单/匹配页 30fps 省电，
// 交互后 1s 内（按 lastMenuInputAt）回到 60fps 保跟手。按需唤醒的单帧不受此限。
function frameBudgetMs(now: number): number {
  if ((screen === 'menu' || screen === 'pvpMatching')
    && now - lastMenuInputAt >= MENU_INPUT_BURST_MS) return MENU_FRAME_MS;
  return MIN_FRAME_MS;
}

// 加固：帧内异常上报（节流）。首 3 次必报、之后每 ~120 帧(约 2s)一次，
// 避免持续抛错刷爆控制台，同时保证「第一现场」的报错一定被看到（含微信开发者工具）。
let frameErrCount = 0;
function reportFrameError(err: unknown): void {
  frameErrCount++;
  if (frameErrCount <= 3 || frameErrCount % 120 === 0) {
    console.error('[frame] 渲染/逻辑异常（已兜底，循环继续）：', err);
  }
}

// 当前界面是否需要连续动画：战斗一直跑；结算星级动画期间跑；菜单大圣待机动画需持续重绘。
function needsContinuousLoop(): boolean {
  if (screen === 'loading') return loadingUiVisible;
  if (screen === 'menu') return true;
  if (screen === 'pvpMatching') return true;
  if (screen === 'battle') {
    if (isSettleOpen()) {
      return !isSettleAnimDone(performance.now() - settleStart) || visibleWeaponPickups().length > 0;
    }
    return !ui.paused;
  }
  if (screen === 'codex') return codexLazy.get()?.codexNeedsAnim() ?? false;
  return false;
}

function frame(now: number): void {
  rafId = null;
  // 微信自愈：jsbridge 启动时序会让首个 resize() 拿到 1×1（画布退化成 ~2px、整屏被拉成糊底）。
  // 每帧极廉价地看一眼画布尺寸，退化就重跑 resize()（此时 jsbridge 多已就绪→取到真实屏幕尺寸）；修好即不再触发。
  if (isWeChat && canvas.width < 32) resize();
  const elapsed = now - last;
  // 连续动画(战斗/结算)限速到 ~60fps、静置菜单/匹配页 30fps（见 frameBudgetMs）；
  // 按需唤醒的单帧走 needsContinuousLoop()=false 分支，不受限、立即重绘。
  if (needsContinuousLoop() && elapsed < frameBudgetMs(now)) {
    scheduleFrame(); // 距上一帧太近，跳过本帧的 step/draw，仅重新排帧
    return;
  }
  let dt = elapsed / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // 防卡顿跳步
  const frameStartMs = performance.now(); // 帧内 JS 耗时测量起点（FPS 浮层分诊 JS vs GPU 瓶颈用）
  // 加固：整帧的「仿真 + 绘制」全部包进 try——任何一处抛错（缺图 drawImage、某页绘制 bug、
  // 小游戏运行时缺失的全局等）都不再中断循环；帧尾 catch 复位画布、finally 照常重排下一帧，
  // 绝不因单帧异常而永久定格白屏（此前无外层 try，一次抛错就让 rAF 停摆）。
  try {
  // 帧时 EMA 仅作 FPS 浮层显示（ms 读数）：画质档 2026-09-01 起改为设置驱动的 2 档手动
  // （特效全开/精简，见 applySettingsFxTier），不再 EMA 自动调档——自动调档在临界设备上
  // 让开关式降载（阴影等）「偶尔出现/消失」，迟滞（阈值带+时间驻留）都压不住正反馈震荡。
  // 仅战斗屏统计：菜单静置 30fps 是刻意降频，不该计入。
  if (screen === 'battle' && needsContinuousLoop() && elapsed > 0 && elapsed < 120) {
    frameMsEma = frameMsEma <= 0 ? elapsed : frameMsEma * 0.9 + elapsed * 0.1;
  }
  // 首页及背包/图鉴/排行仍播首页 BGM；战斗播地图氛围音；其余界面静音。均幂等。
  if (usesMenuMusic(screen)) startMenuMusic();
  else if (screen !== 'battle') stopAmbient();
  // 小游戏无缝全屏：在 letterbox 变换下把「当前页自己的背景」铺满整屏(含上下黑边)，再裁剪到 VIEW 画内容
  // （内容不外溢黑边→修图鉴拖动残影）。各页 inline 背景在 wx 下跳过 → 全屏只此一层、随页切换的背景，无双重/固定底。
  if (isWeChat) {
    const bleedX = viewOffsetX / cssScale; // 左右黑边的逻辑宽(竖屏一般为 0)
    const bleedY = viewOffsetY / cssScale; // 上下黑边的逻辑高
    drawScreenBackdrop(ctx, screen, battle, -bleedX, -bleedY, VIEW_W + bleedX * 2, VIEW_H + bleedY * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
  }
  if (screen === 'loading') {
    // 仅当资源确实还在加载（超过 LOADING_UI_DELAY_MS 仍未就绪）才画加载页；
    // 缓存秒进时不画任何内容，保留 index.html 画布底色，直接切首页，避免刷新时闪一下加载页再跳变。
    if (loadingUiVisible) drawLoadingScreen(ctx, loadProgress, now);
  } else if (screen === 'menu') {
    updateMenuFloatToasts(dt);
    stamina = syncStamina(stamina); // 结算离线/挂机恢复后再画顶栏
    {
      const prof = loadProfile();
      const art = avatarById(prof.avatarId)?.art || 'hero-wukong';
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
        avatarArt: art,
      });
    }
    if (menuPopup === 'settings') menuPopupsLazy.get()!.drawSettingsPopup(ctx, gameSettings);
    else if (menuPopup === 'stamina') menuPopupsLazy.get()!.drawStaminaPopup(ctx, stamina.value, staminaPopupToast, staminaSharesLeft);
    else if (menuPopup === 'map') menuPopupsLazy.get()!.drawMapPopup(ctx, mapSelection, pickDailyMap().name, mapScrollY);
    else if (menuPopup === 'help') menuHelpLazy.get()!.drawHelpPopup(ctx, helpScrollY);
    else if (menuPopup === 'profile' && profilePopup) drawProfilePopup(ctx, profilePopup);
    if (merchant.open) {
      updateMerchantFloatToasts(dt);
      merchantLazy.get()!.drawMerchant(ctx, merchant, loadout, merit, {
        equipTutorialPreview: tutorialOverlay?.sequenceId === 'merchantFirstOpen',
      });
      drawMerchantFloatToasts(ctx);
    }
    drawMenuFloatToasts(ctx);
  } else if (screen === 'codex') {
    codexLazy.get()!.drawCodex(ctx, loadout, rank);
  } else if (screen === 'rank') {
    leaderboardLazy.get()!.drawLeaderboard(ctx, rank.level);
  } else if (screen === 'bag') {
    bagLazy.get()!.drawBag(ctx, bag, bagToast, bagScrollY);
    if (bagPopup) bagLazy.get()!.drawBagPopup(ctx, bag, bagPopup);
  } else if (screen === 'pvpMatching') {
    const mc = pvpMatchLazy.get(); const sc = pvpScreenLazy.get();
    if (mc && sc && pvpController) {
      pvpController.pump(performance.now());
      const view = mc.toMatchView(pvpController.state, pvpMode, pvpCopied, {
        nickname: loadProfile().nickname,
        avatarId: loadProfile().avatarId,
        rankLevel: rank.level,
      }, pvpMatchingNote);
      if (view) sc.drawPvpMatching(ctx, view);
      // matched 动画窗口期：MATCHED_SHOW_MS 播完对阵卡动画后真正开局（onPvpMatched 会切战斗屏并清 controller）
      if (pvpPendingMatch && pvpController.state.matchedAt > 0
        && performance.now() - pvpController.state.matchedAt >= sc.MATCHED_SHOW_MS) {
        const ms = pvpPendingMatch;
        pvpPendingMatch = null;
        onPvpMatched(ms);
      }
    }
  } else {
    // —— 战斗（含局内结算弹层） —— //
    // 新手引导展示期间强制唐僧渲染于归位点，避免引导指向的格子里唐僧还没走到（不影响 introT 计时）
    battle.tangsengRenderOverride = !!tutorialOverlay;
    // Task 7.6：PvP 断线看门狗——对局中（pvpSock 非空）且未终局时，>10s 无任意入站即判死。
    // 纯判定放 netDead()（lastInboundAt===0=尚未 open 时返回 false，避免刚建连误判）。
    // 一旦置真，本局内保持不变，直到 endPvpSession() 清零（下面冻结 + 弹窗 + 倒计时退出都靠它）。
    if (pvpSock && !pvpResult && !pvpNetDead && netDead(Date.now(), pvpSock.lastInboundAt)) {
      pvpNetDead = true;
    } else if (pvpSock && !pvpResult && pvpNetDead && netRecovered(Date.now(), pvpSock.lastInboundAt)) {
      // A1-lite：断线判死后若入站重新到达（socket 已重连）→ 解冻续打。
      // 等同「取消暂停」——sim 状态还在内存里，只是之前被 netDead 冻结（shouldStepSim 门控）；
      // 与「跨刷新重建 sim」不同（后者会与服务端波次时钟 desync，见 spec §3 A1），故此处安全。
      // 注：这里只凭「传输层存活」（lastInboundAt 在 PvpSocket.handleOpen 重开时即刷新），不代表服务端仍认对局有效；
      // 若服务端其实已判负，本地最多空跑 ~10s 后重新判死并最终回首页（安全）。真·会话恢复属后续服务端里程碑。
      pvpNetDead = false;
      pvpNetDeadStart = 0;
    }
    beginNetDeadCountdown(now); // 判死瞬间记倒计时起点（幂等）
    // 冻结战斗（不 step）：结算弹层 / 暂停 / 引导 / 我方断线判死(pvpNetDead)。
    // 仍连续重绘以播动画（断线时定格画面 + 弹窗倒计时）。
    // Task 4：**移除**了「对方断线(pvpOppGone) 也冻结本方」——对手掉线时我方半场照常打（对手半场定格在最后快照）。
    // 对手若重连则恢复同步；若超时则我方胜(DisconnectTimeout，见下方 oppGone 倒计时/兜底)。只有「我方自己」断线判死才冻结。
    // Task 9.5：步进门控用 shouldStepSim()——入参只有 paused/tutorial/settleOpen/netDead，
    // **不含** pvpExitPopup。故 PvP 退出弹窗开着时(pvpExitPopup=true、ui.paused=false) 仿真照常步进，
    // 实现「弹窗不暂停对局」。单人暂停(paused=true)则仍冻结。
    if (!resumePopup && shouldStepSim({ paused: ui.paused, tutorial: !!tutorialOverlay, settleOpen: isSettleOpen(), netDead: pvpNetDead })) {
      try {
        if (pvpSock && !pvpResult) {
          // PvP（Model C）：本方半场本地权威。累计真实时间，按 1/30 固定子步多次 step（确定性、帧率无关）。
          // 对手半场不在此步进——由 WS 快照每帧镜像渲染（见下方渲染桥）。
          // Task 10：服务端 result 一到即冻结本方半场（`&& !pvpResult`）——胜可能来自对手唐僧死而本方仍 playing，
          // 继续 step 会让本方唐僧也死，破坏「冻结定格」语义，所以终局后不再步进。
          const { steps, rest } = drainFixedSteps(pvpAcc, dt, PVP_SIM_DT, 8);
          pvpAcc = rest;
          for (let i = 0; i < steps; i++) {
            maybeOpenPvpWave(battle, localSimTick);              // 到点开波（step 前；本方输入即时施加在 handler，step 前已就绪）
            battle.step(PVP_SIM_DT);
            // 清波下降沿：waveActive true→false = 本波刚清空，立即经 WS 上报（fire-and-forget，无需待确认缓冲）。
            if (pvpPrevWaveActive && !battle.waveActive) pvpSock.sendWaveCleared(battle.wave);
            pvpPrevWaveActive = battle.waveActive;
            localSimTick++; // 完成一步，步数 +1 = 下一步 tick 索引（本方权威时钟；maybeOpenPvpWave 基准）
            // 终局 status 上报（一次性）：本方唐僧一死立即经 WS 报 tangsengDead，等服务端 result 结算。
            if (battle.status === 'lost' && !pvpStatusReported) {
              pvpSock.sendStatus('tangsengDead');
              pvpStatusReported = true;
            }
            if (battle.status === 'won' || battle.status === 'lost') break;
          }
        } else {
          battle.step(dt);
        }
      } catch (err) {
        console.error('[battle.step]', err);
        battle.message = '战斗逻辑异常，已跳过本帧（请刷新页面）';
      }
      checkBattleTutorials();
      updateFirstGameGuide(); // Task 10：推进首局引导阶段（征兵→部署→done，modal 期间暂停）
    }
  // BGM 跟随实际战斗地图而非菜单所选：PvP 的地图由服务端 match 决定（onPvpMatched 用 ms.map 建 battle），
  // 与 currentMap 不一致时会一直播错曲（曾表现为真人对战播的始终是首页前选中的那张图的 BGM）。
  startAmbient(battle.map.id); // 进入对战启动该地图氛围音（幂等）
    updateBattleToasts(dt); // 战斗内 toast（续玩提示等）按真实时间淡出
    // 播放引擎发出的音效事件
    if (battle.sfxEvents.length) {
      for (const ev of battle.sfxEvents) playSfx(ev);
      battle.sfxEvents.length = 0;
    }
    // 胜负结算入境界 + 功德（仅一次），随后在战斗页弹出结算层。
    // Task 10：PvP 由「服务端 result 权威」终局（下方块），单人不吃 pvpSock 分支——故这里加 `&& !pvpSock` 分流。
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost') && !pvpSock) {
      endHandled = true;
      clearSessionSave(); // 本局终局：作废统一续玩快照（PvE；防刷新后误恢复已结束的一局）
      pendingMerchant = true;
      recordHeroMatchGame(battle.heroMatchedIdsThisGame());
      // Task 10：单人到达终局 → 标记「已玩过一局」，据此解锁 PvP 入口。
      // 幂等（markGameFinished 内部只写一次）；本块已被 `&& !pvpSock` 排除 PvP，PvP 终局不会污染该标记。
      markGameFinished();

      if (battle.endless) {
        // 无尽：不涨降境界，只记录最高波数；仍发放功德（软奖励，与星级解耦）
        const gain = meritReward(false, battle.wave, { endless: true });
        merit = addMerit(merit, gain);
        const isRecord = recordBestWave(battle.wave);
        endlessResult = { wave: battle.wave, best: getBestWave(), isNewRecord: isRecord, merit: gain };
        settleChange = null;
        battle.message = `抵达第 ${battle.wave} 波（功德 +${gain}）`;
        settleStart = performance.now();
        track('game_end', {
          win: false,
          wave: battle.wave,
          rankLevel: rank.level,
          heroes: battle.heroMatchedIdsThisGame(),
          items: [...loadout.equipped, ...loadout.passives],
          endless: true,
        });
        track('merit', { delta: gain, remain: merit.merit });
        void syncAvatarUnlocks();
        void submitLeaderboard();
        scheduleCloudSync(1000);
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
        if (won) bumpClearCount();
        track('game_end', {
          win: won,
          wave: battle.wave,
          rankLevel: rank.level,
          heroes: battle.heroMatchedIdsThisGame(),
          items: [...loadout.equipped, ...loadout.passives],
          endless: false,
        });
        track('merit', { delta: gain, remain: merit.merit });
        void syncAvatarUnlocks();
        void submitLeaderboard();
        scheduleCloudSync(1000);
      }
    }
    // C5：对手打空气 → 退还本局体力(镜像 onPvpMatched 的扣费)，关会话，自动静默重新匹配。
    if (pvpSock && pvpNoShow) {
      stamina = addStamina(stamina, STAMINA_COST);   // 退回本局扣的体力，避免为一场真实对局二次扣费
      endPvpSession();                                // 关 WS + 清 PvP 态（含 pvpNoShow=false）
      enterPvpMatching('random', undefined, '对手未应战，正在重新匹配…');
      scheduleFrame();
      return;
    }
    // —— Task 10：PvP 终局由「服务端 result」权威驱动 ——
    // 与单人块互斥（单人块已加 && !pvpSock）。result 一到：本方半场已在 step 门控冻结，这里结算段位/功德/商人
    // （与单人一致，差别：段位冻结单人 AI 难度、平局不动段位，见 pvp-settle.ts）。不设 endHandled（那是单人概念），PvP 用 pvpSettleResult 开关。
    if (pvpSock && pvpResult && !pvpSettleResult) {
      // PvP 终局即时清档（保留，非冗余）：本块不经 endPvpSession（那要等玩家点结算屏「返回」才走 leaveSettleToMenu），
      // 在此 result 一到就清，避免玩家停留结算屏期间刷新去重连一局已结束的对局。与单人终局块对称、幂等。
      clearSessionSave();
      // Task 4：服务端把「我方唐僧死时对手正断线/未连」的失败标为 selfTangsengDeadOppGone → 免扣段位
      //（对手跑路不该偷我段位）。我方自己刷新/掉线致死仍是 selfTangsengDead → 正常扣减。功德不受影响。
      const { rankChange, meritGain } = pvpSettle(pvpResult.outcome, rank, battle.wave,
        { noPenalty: pvpResult.reason === REASON_SELF_TANGSENG_DEAD_OPP_GONE });
      if (rankChange) rank = rankChange.state; // 胜/负动段位（recordWin/Lose 内部已持久化）；平局 rankChange=null 不动
      merit = addMerit(merit, meritGain);      // 累加并持久化功德（封顶 300，同单人）
      pendingMerchant = true;                  // 回首页弹神秘商人（同单人）
      pvpSettleResult = {
        outcome: pvpResult.outcome,
        reason: pvpResult.reason,
        opponent: { nickname: pvpOpponent?.nickname ?? null, avatarId: pvpOpponent?.avatarId ?? '' },
        rankChange,
        merit: meritGain,
      };
      pvpSettleStart = performance.now();
      const outLabel = pvpResult.outcome === 'win' ? '胜利' : pvpResult.outcome === 'lose' ? '失败' : '平局';
      battle.message = `${outLabel}（功德 +${meritGain}）`;
      void syncAvatarUnlocks(); // 段位/功德变化可能触发头像解锁
      scheduleCloudSync(1000);  // 持久化段位/功德到云端
      // 不接入（单人专属，PvP 不该污染）：recordVersusOutcome（单人 AI 加压连胜）、submitLeaderboard（波数榜）、
      // markGameFinished、bumpClearCount；遥测未接 track（TelemetryType 无 pvp_end，避免扩 schema）。
    }
    setHudRank(rankName(rank.level));
    // PvP 渲染桥（Model C）：每帧渲染前把对手 WS 快照（经 PvpOppView 插值）镜像进 battle.ai*，复用 drawAiSide 画对手半场。
    // 仅 pvpSock 非空（在线对局中）且 oppView 已有至少一份快照时桥一次；单人路径完全不碰，零影响。
    // 注：对手唐僧血/存活直接来自其快照（发送端权威，snap.status==='lost'→aiDefeated），无需旧权威纠正。
    if (pvpSock && oppView && oppView.hasSnap) {
      const nowMs = Date.now();
      battle.bridgeOpponentFromSnap(oppView.interpAt(nowMs));
      // #2 对手战斗反馈本地补演：bridge 重建 aiUnits/aiMonsters 后，本地模拟对手兵器/英雄普攻
      // 动效（按真实攻击间隔出招，只发特效不落伤害——hp/生死以服务端快照为准），并补伤害飘字/
      // 击杀加桃（见 Battle.stepOpponentJuice）。放在 bridge 之后、渲染之前，同源 nowMs。
      battle.stepOpponentJuice(nowMs);
    }
    // 本方快照 100ms 节流上报（每渲染帧检查、墙钟节流）：只要对局未终局（!pvpResult）就持续发，
    // 对手端据此双缓冲插值渲染本方半场。终局(pvpResult)一到即停发（本方冻结定格）。
    if (pvpSock && !pvpResult) {
      const nowMs = Date.now();
      if (nowMs - pvpLastSnapMs >= 100) {
        pvpSock.sendSnap(battle.pvpOwnSnapshot(nowMs, pvpSock.rttMs));
        pvpLastSnapMs = nowMs;
      }
    }
    // —— 断线倒计时处理（冻结画面期间每帧推进）——
    // 我方侧：倒计时结束 → 退出回首页（会话态由 endPvpSession 统一清）。
    if (netDeadCountdownExpired(now)) {
      endPvpSession();
      screen = 'menu';
      scheduleFrame();
    }
    // 对方侧：期间若重连（收到新手快照）→ 撤弹窗继续；倒计时结束且未重连 → 判我方胜。
    if (pvpOppGone) {
      if (oppReconnected(now)) {
        pvpOppGone = false;
        pvpOppGoneStart = 0;
      } else if (oppGoneCountdownExpired(now) && !pvpResult && !pvpSettleResult) {
        // 倒计时到点且服务端 result 未到：客户端判我方胜（兜底；正常路径由服务端 result 驱动）。
        pvpResult = { outcome: 'win', reason: 'opponentDisconnectTimeout' };
      }
    }
    // Task 9.4：PvP 双方延迟 HUD——写入 render 态供 drawHud 画到境界左右两侧（drawHud 内部读取）。
    // myRtt = 本侧 pvpSock.rttMs；oppRtt = 对手最新快照 rtt（首 pong 前为 null）。单人(pvpSock 空)→null（drawHud 不画）。
    // 必须在 draw() 之前写入：drawHud 在渲染链路内读此态画两侧标注。
    setPvpNetLatency(pvpSock ? { myRtt: pvpSock.rttMs, oppRtt: oppView?.latestRtt ?? null } : null);
    draw(ctx, battle, ui);
    // 每局开局「征兵→部署」提示（非阻塞、不暂停；modal 教程展示时让位）。
    // 每帧推进状态机：征兵过(summonCount>0)、放置过 tray（长度下降沿）两个事件源驱动阶段切换。
    if (gameStartHint.stage !== 'off' && !tutorialOverlay) {
      const trayLen = trayTokens(battle.tray).length;
      const placed = gameStartHintTrayLen >= 0 && trayLen < gameStartHintTrayLen;
      gameStartHintTrayLen = trayLen;
      gameStartHint = stepGameStartHint(gameStartHint, battle.summonCount > 0, placed, dt);
      drawGameStartHint(ctx, gameStartHint);
    }
    drawBattleToasts(ctx); // 续玩恢复提示 toast（非阻塞；结算/暂停等叠层之下）
    // 结算层互斥：PvP 结算屏优先（pvpSettleResult 非空=服务端 result 已到），否则单人无尽/段位结算。
    if (pvpSettleResult) drawPvpSettle(ctx, pvpSettleResult, now - pvpSettleStart);
    else if (endlessResult) drawEndlessSettle(ctx, endlessResult, now - settleStart);
    else if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
    drawWeaponPickups(ctx, visibleWeaponPickups(), bag);
    // Task 7.6：断线弹窗最顶层（盖住结算/暂停），只有判死后才画。
    if (pvpNetDead) drawNetDeadOverlay(ctx, (DISCONNECT_COUNTDOWN_MS - (now - pvpNetDeadStart)) / 1000);
    // A3：断线重连期间（含每次握手尝试的 connecting 子态）→ 顶部横幅（sim 仍在跑，不遮挡；判死后由 drawNetDeadOverlay 接管）。
    // 用 reconnectAttempt>0 而非 state==='reconnecting'：后者会在每次握手尝试的 connecting 子态漏掉——
    // 若握手挂起（弱网黑洞/captive portal），会出现近 10s 既无横幅也无弹窗的盲区。retryCount 在整个重连周期恒≥1，
    // 初次连接/成功 open 后为 0；手动关/鉴权失败后 pvpSock 会被 endPvpSession 置空，再加 state!=='closed' 双保险。
    if (pvpSock && !pvpResult && !pvpNetDead && !pvpOppGone && pvpSock.reconnectAttempt > 0 && pvpSock.state !== 'closed') {
      drawReconnectingBanner(ctx, pvpSock.reconnectAttempt);
    }
    // 对手快照停更预警：快照（正常 100ms/份）停更超阈值、本方 WS 正常、服务端 oppGone 未到——
    // 填补「对方异常退出后服务端 ~10s 判死」空窗的即时反馈（用户报「对方断了却一直没提示」）。
    // 派生显示无状态：快照恢复自动消失；oppGone 到达后 pvpOppGone 分支的正式倒计时弹窗接管。
    if (pvpSock && oppView && !pvpResult && !pvpSettleResult && !pvpNetDead && !pvpOppGone
      && pvpSock.reconnectAttempt === 0 && pvpLastSnapRecv > 0
      && now - pvpLastSnapRecv > PVP_OPP_STALL_WARN_MS) {
      drawOppStalledBanner(ctx);
    }
    // 对方断线弹窗：倒计时期间显示；结算屏一开（pvpSettleResult 非空）则让位给结算（避免两顶层重叠）。
    if (pvpOppGone && !pvpResult && !pvpSettleResult) drawOppGoneOverlay(ctx, (DISCONNECT_COUNTDOWN_MS - (now - pvpOppGoneStart)) / 1000);
    // 暂停/退出弹窗：与结算、断线互斥（ settle > net-dead > pause 的视觉优先级靠下面的 !isSettleOpen()/!pvpNetDead 保证）。
    if (isPausePopupOpenPure(ui.paused, pvpExitPopup) && !isSettleOpen() && !pvpNetDead) drawPausePopup(ctx, pausePhase, pausePopupContext(!!pvpSock));
    if (resumePopup) drawResumePopup(ctx); // 中途恢复的「继续/回到首页」选择弹窗（最顶层）
    if (shareShovelPopup) drawShareShovelPopup(ctx); // 铲子分享结果弹窗（成功/失败，最顶层）
  }
  if (tutorialOverlay) drawTutorialOverlay(ctx, tutorialOverlay, now);
  // Task 10 首局动态引导：非模态箭头 + 「跳过」。仅 battle 屏、引导活跃、且无 modal 教程时画
  // （modal 教程开着时箭头让位，关掉后由 updateFirstGameGuide 恢复）。箭头与波次押后在
  // battle.ts 的 holdFirstWaveForSetup 联动，这里只管绘制。
  // deploy 阶段优先画「手型拖拽演示」（循环示范拖放手势）——比箭头更直观；
  // 候选区有洛阳铲时**铲子演示优先**（首次出铲的教学点：拖到未挖的灰格开垦），
  // 无铲子走兵器部署演示（拖到已开垦的推荐空格）；无可演示内容回退箭头。
  if (screen === 'battle' && isGuideActive() && !tutorialOverlay && battle.status !== 'won' && battle.status !== 'lost') {
    const demoDrawn = guidePhase === 'deploy'
      && (drawShovelGuideDemo(ctx, battle, ui, now) || drawDeployGuideDemo(ctx, battle, ui, now));
    if (!demoDrawn) {
      const target = guidePhase === 'summon' ? summonButtonRect() : trayRowRect();
      const label = guidePhase === 'summon' ? '点击征兵' : '把兵器拖到战场部署';
      drawGuideArrow(ctx, target, label, now);
    }
    drawGuideSkip(ctx); // 「跳过」与箭头同层，始终可点
  }
  // 首次主动技能就绪的施放演示（与本局是否用过绑定，非首局限定——技能引导对每个新玩家
  // 都有价值，用过一次即学会）：有 ready 槽且本局未使用过任何主动技时，按技能目标类型
  // 循环演示拖拽/点按（仙丹→兵器格、轰天雷→路径格、即时技→点按+范围虚线圈）。
  // modal 教程开着/玩家正在拖技能槽时让位。
  if (screen === 'battle' && !tutorialOverlay && !activeUsedThisGame && battle.status === 'playing' && ui.dragActiveSlot === null) {
    const readyIdx = battle.activeSlots.findIndex((s) => s.ready);
    if (readyIdx === 0 || readyIdx === 1) drawSkillGuideDemo(ctx, battle, readyIdx, now);
  }
  // FPS 调试浮层：最顶层叠画（VIEW 内、微信裁剪 restore 前），所有界面通用。
  // 帧尾先推进滚动窗口（fps + 平均帧内 JS 耗时——dur 低而 fps 低=GPU/合成瓶颈，dur 高=JS 瓶颈）。
  if (fpsOverlayOn) {
    fpsMeter = fpsMeterTick(fpsMeter, now, performance.now() - frameStartMs);
    drawFpsOverlay(ctx, { fps: fpsMeter.fps, emaMs: frameMsEma, durMs: fpsMeter.durMs, tier: qualityTier });
  }
  if (isWeChat) {
    ctx.restore(); // 撤掉帧首的 VIEW 裁剪（与帧首 save/clip 配对）；黑边区已在帧首由 drawScreenBackdrop 用当前页背景铺满
    // 弹窗蒙层只画在 VIEW 内（受上面的裁剪），上下/左右黑边露出未压暗的亮底；此处给黑边补一层同色蒙层，使其盖满整屏。
    // 黑边区只有背景、无卡片，补一层与 VIEW 内相同的半透明色即视觉一致（撤裁剪后画，不会二次压暗 VIEW）。
    const scrim = takeScrim();
    if (scrim) {
      const bx = viewOffsetX / cssScale; // 左右黑边逻辑宽（竖屏一般为 0）
      const by = viewOffsetY / cssScale; // 上下黑边逻辑高
      ctx.fillStyle = scrim;
      if (by > 0) {
        ctx.fillRect(-bx, -by, VIEW_W + bx * 2, by); // 顶部黑边
        ctx.fillRect(-bx, VIEW_H, VIEW_W + bx * 2, by); // 底部黑边
      }
      if (bx > 0) {
        ctx.fillRect(-bx, 0, bx, VIEW_H); // 左黑边
        ctx.fillRect(VIEW_W, 0, bx, VIEW_H); // 右黑边
      }
    }
  }
  // 续玩落档（PvP/PvE 统一，Task 2 接 PvE、Task 3 接 PvP）：帧尾按节流写入全状态快照；kind/opts 与终局门控见 sessionCheckpointNow。
  // dirty 传输入脏标：有玩家输入时在 500ms MIN 节流下尽快落档；无输入靠 2s MAX 心跳保底。仅当 checkpoint 真正写入
  // （返回 true）才清脏标——若因未过 MIN 被节流（返回 false）须保留脏标，使写入在 MIN 到点后触发；无条件清会让 ~60fps
  // 下的输入在下一帧被无写入地清掉、退回 2s 心跳。终局清档：PvE 结算块 clearSessionSave / PvP endPvpSession 路径。
  if (sessionCheckpointNow({ dirty: pvpSaveDirty })) pvpSaveDirty = false;
  // 仅在需要动画时排下一帧；静态界面画完即停，等待输入唤醒。
  } catch (err) {
    // 加固：仿真/绘制中途抛错——先记录（节流），再撤掉可能残留的 save/clip/transform
    // （restore 到空栈是 no-op，安全），使下一帧从干净状态重画；循环由 finally 续上。
    reportFrameError(err);
    for (let i = 0; i < 4; i++) { try { ctx.restore(); } catch { break; } }
  } finally {
    if (needsContinuousLoop()) scheduleFrame();
  }
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
    if (document.hidden) { pauseLoop(); abandonPvpMatching(); } // 切后台：停循环 + 放弃匹配(清服务端 ticket)
    else { resumeLoop(); pvpSock?.reconnectNow(); } // 回前台：PvP 断线时跳过退避立即重连（弱网优化③）
  });
}
// 网络恢复（飞行模式关闭/切网）→ 立即重连 PvP 断线中的 WS，不等退避计时器（弱网优化③）。
// reconnectNow 只在 reconnecting 态动作，open/closed 态空转，故无条件调用是安全的。
onNetworkOnline(() => pvpSock?.reconnectNow());
// 小游戏温启动：已在首页时好友点了邀请分享卡片 → 直接进「加入」匹配（仅首页触发，避免打断对局/其他界面）。
onWxShowVersus((code) => { if (screen === 'menu') enterPvpMatching('join', code); });

// —— 自测钩子：供 headless Chrome 确定性驱动与快照 —— //
interface GameHook {
  battle: Battle;
  summon: () => boolean;
  wave: () => boolean;
  // DevTools：第 N 波征兵必出指定英雄两字（测试用）
  forceWaveHero: (heroId: string, wave?: number) => void;
  clearForceWaveHero: () => void;
  forceWaveHeroStatus: () => { summonN: number; heroId: string };
  ult: () => boolean; // 兼容垫片：绝招已移除，恒返回 false（旧工具不报错）
  triggerActive: (i: number) => boolean;
  equipActives: (ids: string[]) => void;
  equipPassives: (ids: string[]) => void;
  drag: (from: Cell, to: Cell) => boolean;
  placeFromTray: (index: number, to: Cell) => boolean;
  autoPlace: () => void;
  // 开局「征兵→部署」提示当前阶段（冒烟断言用；画布像素采样在繁忙 UI 背景下不可行）
  gameStartHint: () => GameStartHintState;
  select: (cell: Cell | null) => void;
  enterBattle: () => void;
  openCodex: () => void;
  openRank: () => void;
  openBag: () => void;
  grantWeapon: (id: string) => void;
  grantMerit: (n: number) => void;
  tuning: typeof TUNING;
  openDevTools: () => void;
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => void;
  // Task 10 自测钩子：把当前局标记为首局/非首局（冒烟验证用；real 路径由 newGame 自动判定）。
  markFirstGame: () => void;
  markNotFirstGame: () => void;
  step: (dt: number) => void;
  fastForward: (seconds: number, dt?: number) => void;
  grantPeach: (n: number) => void;
  buildDefense: (peach?: number) => void;
  snapshot: () => ReturnType<Battle['snapshot']>;
  curScreen: () => string;
  // 预览/回归截图：直接打开首页某个菜单弹窗（settings/stamina/map/help/profile），供 popup 截图工具用。
  openMenuPopup: (name: MenuPopup) => void;
  // 预览/截图：在战斗屏弹出铲子分享结果弹窗（success/fail）。
  previewShareResult: (ok: boolean) => void;
  // 预览/截图：个人信息弹窗头像卷轴滚到起点/终点。
  previewProfileScroll: (end: boolean) => void;
  // 测试钩子：直接起一局 PvP（绕过匹配 UI 与体力门），供 headless 冒烟验证本方权威 step + 渲染桥。
  // 注（Task 5）：onPvpMatched 会尝试连一个真实 WS（ fabricated matchId），连不上则 PvpSocket 指数退避静默重连、
  // 本方半场照常本地运行（PvpSocket 不抛）。对无服务端的单机探针场景可接受。
  enterPvp: (seed: number) => void;
  // 冒烟注入钩子（Part B）：运行期覆盖 PvP WebSocket 工厂（供无 Python 服务端时脚本化 WS 链路）。
  // 注意：刷新恢复（resumePvpSession）在 boot 期就建 socket，早于本钩子可被调用的时机——恢复路径的注入须改用
  // page.evaluateOnNewDocument 把工厂挂到 window.__pvpWsFactory（模块初始化时读入，见 pvpWsFactoryOverride 注释）。
  // 本钩子适用于运行期路径（如先调用它、再 enterPvp）。传 undefined/null 可清除覆盖。
  setPvpWsFactory: (f: PvpSocketOpts['wsFactory']) => void;
  // 冒烟钩子：不经真实服务端直接摆出匹配屏阶段（queuing 匹配中 / matched 对阵卡动画窗口），
  // 供 headless 验证匹配屏渲染与「动画播完自动开局」。matched 会走真实开局路径（MATCHED_SHOW_MS 后切战斗屏）。
  fakePvpMatch: (phase: 'queuing' | 'matched') => void;
  // 自测探针：PvP 对局内部状态（只读，供 headless 冒烟验证快照收发/插值视图/波驱动/终局）。
  pvpProbe: () => {
    active: boolean;             // pvpSock 非空=对局进行中
    sockState: string;           // PvpSocket.state（connecting/open/reconnecting/closed）
    snapCount: number;           // oppView 已 ingest 的快照份数（>0 表示在收对手快照）
    oppSnapT: number | null;     // oppView 最新快照归一化时刻 t（本机时基）
    localSimTick: number;        // 本方权威步数
    matchStartMs: number;        // 开局纪元
    waveStartTicks: [number, number][]; // 波号→本地开波 tick 缓存
    ownMonsters: number;         // 本方场上怪物数（>0 表示出怪口已吐怪=波次模型生效）
    oppUnits: number;            // oppView 最新快照携带的对手场上单位数（>0 表示对手放了单位，且快照可观测）
    result: { outcome: 'win' | 'lose' | 'draw'; reason: string } | null; // 服务端终局
  } | null;
  // Task 10 自测探针：PvP 终局态（冒烟验证 result 驱动结算 + endPvpSession 清理）。
  pvpEndProbe: () => {
    pvpSync: boolean;               // 非空(pvpSock)=对局未清（心跳已由 WS 推送取代，字段名保留供旧探针兼容）
    pvpSettleResult: PvpSettleResult | null; // 非空=已进 PvP 结算
    pvpSurrendered: boolean;
    curScreen: string;
  };
  // 真服务器双端冒烟探针（Task 7）：匹配态只读快照（房号/阶段）供桥接两侧成局。
  pvpMatchProbe: () => { code: string | null; phase: string | null } | null;
  // Task 9.5 自测探针：暂停/退出弹窗当前态（冒烟验证「PvP 退出弹窗不停仿真」）。
  pauseState: () => { paused: boolean; pvpExitPopup: boolean; phase: string; tutorial: boolean };
  // Task 10 自测钩子：触发认输（镜像 pause→认输命中处理：置 surrendered、关暂停，并直接经 WS 上报 surrender）。
  pvpSurrender: () => void;
  // Task 7 自测钩子：镜像结算屏「返回」点击（anim 已毕点屏→leaveSettleToMenu），返回是否执行离场。
  pvpLeaveSettle: () => { left: boolean; reason?: string };
  // 自测探针：境界/功德（冒烟验证 PvP 终局也结算 rank/merit，与单人一致）。
  rankMerit: () => { rankLevel: number; merit: number };
  // 续玩冒烟：读当前 screen / 是否有存档 / 当前 battle 波数，供 smoke-resume.mjs 断言。
  resumeProbe: () => { screen: string; hasSave: boolean; wave: number; status: string | null; toast: string | null; resumePopup: boolean };
  // 自测探针：唐僧入场走跳（冒烟验证 introT 推进 + hopY 振荡、归位后归零）。
  tangsengIntro: () => { t: number; done: boolean; hopY: number };
  // 自测探针：强制切画质档位（低端机降载冒烟用：验证切档不崩 + 低档确有绘制差异）。
  setQualityTier: (tier: QualityTier) => void;
  // 自测探针：FPS 调试浮层开关 + 读数（冒烟断言：开 overlay 后 fps/dur 窗口滚动出数）。
  setFpsOverlay: (on: boolean) => boolean;
  fpsProbe: () => { fps: number; durMs: number; emaMs: number; tier: QualityTier; overlayOn: boolean };
}
const hook: GameHook = {
  get battle() {
    return battle;
  },
  summon: () => battle.summon(),
  wave: () => battle.startNextWave(),
  // DevTools：第 N 波征兵必出指定英雄两字（测试用）
  forceWaveHero: (heroId: string, wave = 2) => battle.setDevForceWave2Hero(heroId, wave),
  clearForceWaveHero: () => battle.clearDevForceWave2Hero(),
  forceWaveHeroStatus: () => battle.devForceWave2HeroStatus(),
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
  gameStartHint: () => gameStartHint,
  select: (cell: Cell | null) => {
    ui.selectedMonster = null;
    ui.selected = cell;
    draw(ctx, battle, ui);
  },
  enterBattle: () => { screen = 'battle'; scheduleFrame(); },
  openCodex: () => enterCodex(),
  openRank: () => enterRank(),
  openBag: () => enterBag(),
  grantWeapon: (id: string) => { bag = addWeapon(bag, id).state; },
  grantMerit: (n: number) => { merit = addMerit(merit, n); },
  tuning: TUNING,
  openDevTools: () => {
    void import('./devtools').then(({ openDevTools }) => openDevTools({ onUserApplied: applyDevUserResult }));
  },
  restart: (s?: number, diff?: number, mapId?: string, endless?: boolean) => {
    endPvpSession(); // Task 10：DevTools 重开前先清上一局 PvP 对局态（关 WS、清 pvpSock/oppView 残留），单人调用幂等无副作用
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endless ?? false, newBattleAiSkill(), 1, heroMatchOptsForNewBattle());
    bindBattleWeaponPickup();
    endHandled = false;
    endlessResult = null;
    settleChange = null;
    // Task 9.5：重开新局时一并清零暂停/退出弹窗态（与 newGame 对称），避免残留弹窗画到新局上。
    ui.paused = false;
    pvpExitPopup = false;
    pausePhase = 'main';
    screen = 'battle';
    scheduleFrame();
  },
  // Task 10 自测钩子：把当前局标记为「首局」（开启首波押后 + 征兵引导），供 headless 冒烟验证
  // 首局体验。real 路径由 newGame() 据 hasFinishedGame() 自动判定；这里只给冒烟一个显式开关，
  // 不影响 restart() 的中立性（restart 不自动判首局，避免污染其它冒烟工具）。
  markFirstGame: () => {
    battle.holdFirstWaveForSetup = true;
    resetFirstGameGuide(true);
  },
  markNotFirstGame: () => {
    battle.holdFirstWaveForSetup = false;
    resetFirstGameGuide(false);
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
  curScreen: () => screen,
  // 预览/回归截图：切到首页并打开指定菜单弹窗（经 lazy 模块 ensure，与真实入口 openSettingsPopup 同源）。
  openMenuPopup: (name: MenuPopup) => {
    menuPopupsLazy.ensure(() => {
      screen = 'menu';
      if (name === 'profile') profilePopup = createProfilePopupState(); // profile 弹窗需 state 才绘制
      menuPopup = name;
      scheduleFrame();
    });
  },
  // 预览/截图：在战斗屏弹出铲子分享结果弹窗（success/fail），供 popupshot 验证。
  previewShareResult: (ok: boolean) => { screen = 'battle'; shareShovelPopup = ok ? 'success' : 'fail'; scheduleFrame(); },
  // 预览/截图：把个人信息弹窗头像卷轴滚到起点/终点，验证首尾头像边框完整。
  previewProfileScroll: (end: boolean) => {
    if (!profilePopup) return;
    profilePopup.scrollX = end ? 1e9 : -1e9; // clamp 夹到 max / 0
    clampProfileScroll(profilePopup);
    scheduleFrame();
  },
  // 测试钩子：直接起一局 PvP（绕过匹配 UI 与体力门），供 headless 冒烟验证本方权威 step + 对手快照渲染桥。
  // 注（Task 5）：对手半场现由 WS 快照重建，不在本机确定性重放；fabricated matchId 连不上真实服务端时
  // PvpSocket 指数退避静默重连（不抛），本方半场照常本地运行。
  // 注（Task 6 退役）：旧曾传 opponentLoadout 供本机重放，WS 快照模型无消费方，参数已删除。
  enterPvp: (seed: number) => {
    const ms = {
      matchId: 'smoke-t8', seed, map: currentMap.id, startAtServerMs: Date.now() - 1000,
      opponent: { uid: 'opp-smoke', nickname: '烟雾对手', avatarId: 'hero-wukong', rankLevel: 1 },
    } as import('./api/pvp-client').MatchStart;
    onPvpMatched(ms);
  },
  // 冒烟注入钩子（Part B）：运行期覆盖/清除 PvP WS 工厂。恢复路径的注入见 window.__pvpWsFactory（该变量注释）。
  setPvpWsFactory: (f) => { pvpWsFactoryOverride = f ?? null; },
  fakePvpMatch: (phase) => {
    // 复用真实 pvpNet 构造 controller 但不调 startRandom/startInvite（不触发网络）：
    // queuing 态 ticket 为 null → pump 不轮询；matched 态 pump 直接短路。
    pvpMatchLazy.ensure((m) => {
      pvpScreenLazy.ensure(() => {
        pvpPendingMatch = null;
        pvpController = new m.PvpMatchController({
          net: pvpNet, now: () => performance.now(),
          onMatched: (ms) => { pvpPendingMatch = ms; },
          onFailed: () => {},
        });
        const s = pvpController.state;
        pvpMode = 'random';
        if (phase === 'matched') {
          s.phase = 'matched';
          s.opponent = { uid: 'opp-smoke', nickname: '烟雾对手', avatarId: 'erlang', rankLevel: 3 };
          s.matchedAt = performance.now();
          // 伪装 MatchStart：动画播完 frame() 会用 pvpPendingMatch 走真实开局（连不上服务器则静默重连，可接受）
          pvpPendingMatch = {
            matchId: 'smoke-match', seed: 20260826, map: currentMap.id, startAtServerMs: Date.now() - 1000,
            opponent: s.opponent,
          } as import('./api/pvp-client').MatchStart;
        } else {
          s.phase = 'queuing';
          s.remainMs = 60_000;
        }
        screen = 'pvpMatching';
        scheduleFrame();
      });
    });
  },
  pvpProbe: () => {
    if (!pvpSock) return null;
    return {
      active: true,
      sockState: pvpSock.state,
      snapCount: oppView?.count ?? 0,
      oppSnapT: oppView?.latestT ?? null,
      localSimTick,
      matchStartMs: pvpMatchStartMs,
      waveStartTicks: [...pvpWaveStartTicks.entries()],
      ownMonsters: battle.monsters.length, // 真服务器冒烟：>0 证实「nextWave 宣告→本方开波出怪」链路生效（曾因首波不宣告而永不出怪）
      oppUnits: oppView?.latestUnits ?? 0, // 真服务器冒烟：>0 证实对手放了单位且快照中继可观测
      result: pvpResult,
    };
  },
  // Task 10：PvP 终局态探针（冒烟验证 result 驱动结算 + endPvpSession 清理）。
  pvpEndProbe: () => ({
    pvpSync: pvpSock !== null,
    pvpSettleResult,
    pvpSurrendered,
    curScreen: screen,
  }),
  // Task 7：匹配态只读快照——建房后房号存在 controller.state.code，桥接 page2 深链加入。
  pvpMatchProbe: () => (pvpController
    ? {
        code: pvpController.state.code, phase: pvpController.state.phase,
        matchedAt: pvpController.state.matchedAt, nowMs: performance.now(),
        pendingMatch: pvpPendingMatch !== null, // matched 动画窗口期（>0ms 未开局）
      }
    : null),
  // Task 9.5：暂停/退出弹窗当前态探针（供 headless 冒烟验证「PvP 退出弹窗开着但仿真照跑」）。
  pauseState: () => ({ paused: ui.paused, pvpExitPopup, phase: pausePhase, tutorial: !!tutorialOverlay }),
  // Task 10：触发认输（镜像 pause→认输命中处理：置 surrendered、关暂停，并**直接经 WS 上报 surrender**）。
  // 注（bug 修复）：此前只置 pvpSurrendered 标志、无一处在 frame 内据此发送→经由本钩子的认输永不生效（死代码）。
  // 现与暂停弹窗「认输」路径同源：直接 sendStatus('surrender')；sendStatus 在 socket 未开时静默丢弃，调用安全。
  pvpSurrender: () => {
    pvpSurrendered = true;
    // 与暂停弹窗「认输」路径同源：单人暂停 / PvP 退出弹窗两路标志一并清零。
    ui.paused = false;
    pvpExitPopup = false;
    pausePhase = 'main';
    battle.message = '已认输，等待结算…';
    if (pvpSock && !pvpStatusReported) { pvpSock.sendStatus('surrender'); pvpStatusReported = true; }
  },
  // 自测探针：境界/功德（冒烟验证 PvP 终局也结算 rank/merit，与单人一致）。
  rankMerit: () => ({ rankLevel: rank.level, merit: merit.merit }),
  // Task 7 自测钩子：镜像结算屏「返回」点击（结算动画已毕时点屏→leaveSettleToMenu）。
  // 与 main.ts 指针路径同源：isSettleOpen 且 animDone 时才生效；返回是否真的执行了离场。
  pvpLeaveSettle: () => {
    if (!isSettleOpen()) return { left: false, reason: 'no-settle' };
    const animDone = pvpSettleResult
      ? isSettleAnimDone(performance.now() - pvpSettleStart)
      : (!!endlessResult || isSettleAnimDone(performance.now() - settleStart));
    if (!animDone) return { left: false, reason: 'anim-not-done' };
    leaveSettleToMenu();
    return { left: true };
  },
  // 续玩冒烟：读当前 screen / 是否有存档 / 当前 battle 波数，供 smoke-resume.mjs 断言。
  // hasSave 现读统一续玩存档 dasheng.session（readSession），与开机恢复的真相源一致——旧 readBattleSave
  // （dasheng.battleSave）已无读取方（boot 只从 dasheng.session 恢复），继续读它会让探针与实际恢复源脱节。
  // resumePopup：新恢复 UX 是「继续 / 回到首页」模态弹窗（替代旧 toast），供 PvE 续玩冒烟断言弹窗已弹出。
  resumeProbe: () => ({ screen, hasSave: !!readSession(), wave: battle.wave, status: battle.status, toast: peekBattleToast(), resumePopup }),
  // 自测探针：唐僧入场走跳（hopY 与 drawTangseng 同源 introHopY，供 headless 冒烟验证）。
  tangsengIntro: () => ({ t: battle.introT, done: battle.introDone, hopY: introHopY(battle) }),
  // 自测探针：强制切画质档位（同步档位 + 刷新标量，与 EMA 自动调档同源 setQualityTier）。
  setQualityTier: (tier: QualityTier) => { qualityTier = tier; setQualityTier(tier); },
  // 自测探针：FPS 调试浮层（与「版本号连点 7 次」同一开关状态，冒烟不必模拟连点）。
  setFpsOverlay: (on: boolean) => { fpsOverlayOn = on; scheduleFrame(); return fpsOverlayOn; },
  fpsProbe: () => ({ fps: fpsMeter.fps, durMs: fpsMeter.durMs, emaMs: frameMsEma, tier: qualityTier, overlayOn: fpsOverlayOn }),
};
(window as unknown as { __game: GameHook }).__game = hook;
