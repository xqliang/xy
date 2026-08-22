// 引导 + 游戏循环 + 指针交互 + 自测钩子（window.__game）。
import { Battle, TUNING, findTrayIndex, traySome } from './battle';
import { activeById, isBombActiveEffect, isDragActiveEffect } from './actives';
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
  HUD_H,
  hitPauseBtn,
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
  type UiState,
} from './render';
import type { Cell } from './board';
import { pickDailyMap, mapById, MAPS, pathEntranceCell } from './board';
import { loadMapSelection, saveMapSelection, resolveMap, type MapSelection } from './map-select';
import { loadAssets, type AssetLoadProgress } from './assets';
import { drawLoadingScreen } from './loading-screen';
import { hasFinishedGame, markGameFinished, pvpUnlocked } from './play-history';
import { showAutoplaceBtn } from './dev-flags';
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
import { drawInkPopupFrame, drawInkActionButton, inkPopupCloseRect } from './menu-ui'; // Task 7.6：断线弹窗复用卷轴框 + 水墨按钮
import { loadRank, recordWin, recordLose, rankName, type RankState, type RankChange } from './rank';
import { drawSettle, isSettleAnimDone, SETTLE_ANIM_MS, drawEndlessSettle, type EndlessResult, drawPvpSettle, type PvpSettleResult } from './settle';
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
import { getGameCanvas, onAppHide, onAppShow } from './platform';
import { loadUserId, copyUserId, ensureUserId } from './user-id';
import {
  cloudLogin,
  scheduleCloudSync,
  submitLeaderboard,
  syncAvatarUnlocks,
  updateProfile,
} from './cloud-sync';
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
const versusCode = params.get('versus'); // 好友邀请深链 ?versus=<code>
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
import { PvpSocket } from './pvp-ws';                                 // PvP WS 连接层（Task 3）：连/重连/消息分发 + 上行发送
import { netDead } from './pvp-netwatch';                            // PvP 断线看门狗纯判定（>6s 无入站→判死；Task 7.6）
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
  menuPopupsLazy.ensure(() => { staminaPopupToast = ''; menuPopup = 'stamina'; scheduleFrame(); });
}
function openMapPopup(): void {
  menuPopupsLazy.ensure(() => { menuPopup = 'map'; scheduleFrame(); });
}

// PvP 网络适配：把 pvp-client 的五个函数组成 PvpMatchNet 对象喂给状态机。
// 注（Task 6 退役）：旧模型曾把本方 loadout 经闭包烘焙进 enqueue/roomCreate/roomJoin 上交服务端，
// WS 快照模型无消费方（对手侧从快照本地插值重建），故回退为直接透传五个 client 函数。
const pvpNet = {
  enqueue: (rank: number) => pvpClient.versusEnqueue(rank),
  poll: pvpClient.versusPoll, cancel: pvpClient.versusCancel,
  roomCreate: (rank: number) => pvpClient.versusRoomCreate(rank),
  roomJoin: (code: string) => pvpClient.versusRoomJoin(code),
};
// 集成缝：匹配成功 → 真正开一局 PvP 对局（Plan C Task 5，WS 快照模型）。
// 本方 battle 本地权威实时 step；建对手插值视图 + PvpSocket（每 100ms 发本方快照、收对手快照/波次/终局）、
// 扣体力、切战斗屏。确定性重放机器（oppBattle/PvpSync/1s tick）已拆除，单人不走此函数。
function onPvpMatched(ms: import('./api/pvp-client').MatchStart): void {
  pvpController = null;
  const map = mapById(ms.map) ?? currentMap;
  const meta = metaBonuses(merit), wb = weaponBonuses(bag);
  // PvP 固定 difficulty=1（两端同 seed→同怪，跨机确定；强弱由各自 loadout/战力经 wavePressure 体现=各算各的）。
  // 本方 battle 用本方 meta/wb/equipped/passives（本方侧权威）。
  // aiSkill=undefined→DEFAULT_AI_SKILL；heroMatch=undefined；pvpInit 关本地 AI（pvp 时本机不收 AI）。
  battle = new Battle(ms.seed, 1, map, meta, wb, loadout.equipped, loadout.passives, false, undefined, 1, undefined, { enabled: true });
  bindBattleWeaponPickup();
  // 对手半场 = WS 快照插值视图（不再确定性重放）。PvpOppView 双缓冲，每收到一份对手快照 ingest 一份。
  oppView = new PvpOppView();
  // WS 连接：本方权威半场每 100ms 发快照；下行 oppSnap→插值视图、nextWave→开波排程、result→结算、oppGone→提示。
  // uid 复用 user-id 的 ensureUserId（与 apiFetch 的 X-Uid 同源，不另起存储）。
  pvpSock = new PvpSocket({
    matchId: ms.matchId,
    uid: ensureUserId(),
    onWelcome: (_serverMs) => { /* 对时暂留空：快照时钟已由 normalizeSnapClock 归一化到本机时基，无需 serverMs */ },
    onOppSnap: (s) => {
      if (!oppView) return;
      // 跨机时钟归一：把发送端时刻的快照平移到本机时基再 ingest（interpAt/fx 老化用本机 nowMs，跨机钟差不可混用）。
      const snap = s as PvpSnap;
      normalizeSnapClock(snap, Date.now());
      oppView.ingest(snap);
      pvpLastSnapRecv = Date.now(); // 记最近一次收到对手快照的时刻：对方断线倒计时期间若重连（新手快照）则撤弹窗
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
  });
  pvpSock.connect();
  // 对局态 reset：本方权威时钟归零、终局/波次/认输/结算归零。
  pvpAcc = 0; localSimTick = 0; pvpLastSnapMs = 0; pvpLastSnapRecv = 0; pvpNextWave = null; pvpResult = null; pvpStatusReported = false;
  pvpNetDead = false; pvpNetDeadStart = 0; pvpOppGone = false; pvpOppGoneStart = 0; // 新对局从干净态开始（上次对局若被判死，endPvpSession 已清；这里再兜底一次）
  pvpOpponent = ms.opponent; pvpSurrendered = false; pvpSettleResult = null; pvpSettleStart = 0;
  pvpMatchStartMs = ms.startAtServerMs; pvpWaveStartTicks.clear(); pvpPrevWaveActive = false;
  // 真正开打才扣体力（入口 gate 已保证 value ≥ COST，这里再花一次）
  const sp = spendStamina(stamina);
  if (sp.ok) stamina = sp.state;
  // reset 战斗标志（镜像 newGame）
  endHandled = false; endlessResult = null; settleChange = null; ui.paused = false; pvpExitPopup = false; pausePhase = 'main';
  ui.passivePopup = null; ui.passivePopupUntil = 0; ui.activePopup = null; ui.aiItemPopup = null; ui.peachPopup = false; ui.bombPopup = null; pendingFirstSummonTutorial = false;
  screen = 'battle';
  scheduleFrame();
}

/** 结束当前 PvP 对局并清理所有对局态（所有「离开 battle 屏」的路径都必须调用；幂等）。
 *  单人时这些字段本就是 null/0，调用无副作用。关 WS 最前（否则残留连接会继续重连/收快照）。 */
function endPvpSession(): void {
  pvpSock?.close();            // 关 WS：置 closed、让挂起重连计时器失效、关底层 socket（之后永不重连）
  pvpSock = null; oppView = null;
  pvpResult = null; pvpNextWave = null; pvpSettleResult = null; pvpOpponent = null;
  pvpSurrendered = false; pvpStatusReported = false;
  pvpNetDead = false; pvpNetDeadStart = 0; pvpOppGone = false; pvpOppGoneStart = 0; // 清断线看门狗标志（下次进对局从干净态开始）
  pvpAcc = 0; localSimTick = 0; pvpLastSnapMs = 0; pvpLastSnapRecv = 0; pvpMatchStartMs = 0;
  pvpWaveStartTicks.clear(); pvpPrevWaveActive = false;
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
function enterPvpMatching(mode: 'random' | 'invite' | 'join', code?: string): void {
  if (screen === 'pvpMatching') return; // 防重入：已在匹配屏则忽略（避免并发 ensure 建出多个 controller 泄漏）
  // 注（Task 6 退役）：旧模型曾在此组装本方配装快照(myLoadout)上交服务端转发给对手；
  // WS 快照模型无消费方，已删除。net 直接用顶层 pvpNet 对象（五个透传函数）。
  pvpMatchLazy.ensure((m) => {
    pvpScreenLazy.ensure(() => {
      pvpMode = mode; pvpCopied = false;
      pvpController = new m.PvpMatchController({
        net: pvpNet, now: () => performance.now(), onMatched: onPvpMatched, onFailed: onPvpFailed,
      });
      screen = 'pvpMatching';
      if (mode === 'random') void pvpController.startRandom(rank.level);
      else if (mode === 'invite') void pvpController.startInvite(rank.level);
      else if (mode === 'join' && code) void pvpController.joinCode(code);
      scheduleFrame();
    });
  });
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
    screen = 'menu';
    if (versusCode) enterPvpMatching('join', versusCode);
    void cloudLogin().then((ok) => {
      if (ok) track('login');
      scheduleFrame();
    });
  } finally {
    window.clearTimeout(showUiTimer);
  }
  scheduleFrame();
  // 神秘商人几乎每局结算后必弹出：首屏就绪后空闲预取分包，避免结算时才现拉取造成等待。
  const prefetchMerchantChunk = (): void => { void merchantLazy.prefetch(); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetchMerchantChunk, { timeout: 4000 });
  else window.setTimeout(prefetchMerchantChunk, 1500);
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
let pvpAcc = 0;                        // 固定步长累加器余量（本方半场 fixed-step，保留）
let oppView: PvpOppView | null = null; // 对手半场双缓冲插值视图（WS 快照 → bridgeOpponentFromSnap）
let localSimTick = 0;                   // 本方 battle 已完成的固定步数 = 下一步 tick 索引（maybeOpenPvpWave 时钟基准；每对局 reset）
let pvpLastSnapMs = 0;                  // 上次发本方快照的墙钟 ms（100ms 节流）
let pvpLastSnapRecv = 0;                // 最近一次收到对手快照的墙钟 ms（对方断线倒计时期间据此判重连撤弹窗）
let pvpNextWave: { wave: number; startAtServerMs: number } | null = null; // 服务端下一波（WS nextWave 缓存，Task 9 用）
let pvpResult: { outcome: 'win' | 'lose' | 'draw'; reason: string } | null = null; // 服务端权威终局（WS result → frame 驱动结算）
let pvpStatusReported = false;          // 终局 status 已上报一次性标志（surrender / tangsengDead 各只经 WS 发一次）
// —— Task 9：先清者定波次（服务端 nextWave 权威排程，本机按 tick 确定性开波）——
let pvpMatchStartMs = 0;                        // 开局纪元（服务端 startAtServerMs）：波次纪元→tick 的零点
const pvpWaveStartTicks = new Map<number, number>(); // 波号→该波本地开波 tick（缓存：两端各按自己 wave+1 查表）
let pvpPrevWaveActive = false;                  // 本方上一帧 waveActive（下降沿检测：true→false = 刚清波，立即经 WS 上报）
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
/** 断线倒计时时长（ms）：与 NET_DEAD_THRESHOLD_MS / 服务端 DISCONNECT_GRACE_MS 对齐。 */
const DISCONNECT_COUNTDOWN_MS = 10_000;
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
let gameSettings: GameSettings = safePersisted(getSettings, resetSettings());

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
        title: '什么是英雄',
        text: '这是英雄字牌，未激活的英雄字没有攻击力，需要部两个左右连着的字才能激活英雄（比如"大圣"）。英雄比普通兵攻击高，有各自的大招。',
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

function firstHeroComboSequence(): TutorialSequence {
  return {
    id: 'firstHeroCombo',
    steps: [
      {
        id: 'heroCombo',
        title: '怎么激活英雄',
        text: '把同一位英雄的两张字牌拼到左右相邻，就能激活英雄并获得强力效果。',
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
        text: '击杀怪物时有机会掉落神兵碎片，武器碎片可以兑换武器，加强对应英雄的攻击，点这张卡片即可领取。',
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
  battle = new Battle(nextSeed(), rank.difficulty, currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endlessOn, newBattleAiSkill(), 1, heroMatchOptsForNewBattle());
  bindBattleWeaponPickup();
  endHandled = false;
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
  // Task 10 首局体验：首局单人开启「第 1 波押后 + 征兵/部署动态引导」。
  // newGame 只服务单人（PvP 走 enterPvpMatching，不经过这里），故无需再判 pvp；
  // 「是否首局」用对局历史判定（!hasFinishedGame）——既准又可被测试直控（resetFinishedGame）。
  const firstGame = !hasFinishedGame();
  battle.holdFirstWaveForSetup = firstGame;
  resetFirstGameGuide(firstGame);
}

function abortBattleToMenu(): void {
  endPvpSession(); // Task 10：统一清理 PvP 对局态（关 WS、清 pvpSock/oppView/pvpSettleResult 等），单人调用无副作用（幂等）
  ui.paused = false;
  pvpExitPopup = false;
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
  // DevTools 面板体积较大且仅调试用，动态导入让它独立分包，不进主包体积（非循环依赖规避，纯代码分割）
  void import('./devtools').then(({ openDevTools }) => {
    openDevTools({ onUserApplied: applyDevUserResult });
    menuToast = '已打开 DevTools';
    scheduleFrame();
  });
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
    const hit = menuPopupsLazy.get()!.mapPopupHitAt(x, y);
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
    stamina = addStamina(stamina, 5);
    staminaPopupToast = '体力 +5';
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
          pendingFirstSummonTutorial = true;
          // 首局引导：玩家成功征兵 → 记录（供 updateFirstGameGuide 把箭头从「征兵」切到「部署」阶段）
          if (guidePhase === 'summon') playerSummonedThisGame = true;
        }
      } else if (btn.id === 'autoplace') { battle.autoPlaceTray(); }
      else if (btn.id === 'act0' || btn.id === 'act1') {
        const i = btn.id === 'act1' ? 1 : 0;
        const def = activeById(battle.activeSlots[i]?.id ?? '');
        if (def && isDragActiveEffect(def.effect)) return true; // 拖拽类技能不响应点按触发
        if (battle.activeSlots[i]?.ready) { battle.triggerActive(i); }
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
      if (menuSliderDrag || helpPointerActive || profileScrollDrag) canvas.setPointerCapture(e.pointerId);
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
      playSfx('click'); void pvpController.cancel(); pvpController = null; screen = 'menu'; scheduleFrame();
    } else if (hit === 'ok') {
      pvpController = null; screen = 'menu'; scheduleFrame();
    } else if (hit === 'copy' && pvpController.state.code) {
      // 客户端构造深链（location.origin+pathname 自适应 /xy 子路径）；复制成功才置「已复制」，
      // 失败也无妨——房号已显示在屏上，可口头/手动分享。
      const link = sc.versusShareLink(pvpController.state.code);
      try { void navigator.clipboard?.writeText(link).then(() => { pvpCopied = true; scheduleFrame(); }).catch(() => {}); } catch { /* 剪贴板不可用则忽略（房号已显示） */ }
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
canvas.addEventListener('pointerdown', (e) => { tryMobileFullscreen(); onPointerDown(e); scheduleFrame(); });
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', (e) => { onPointerUp(e); scheduleFrame(); });
canvas.addEventListener('pointercancel', (e) => { onPointerUp(e, true); scheduleFrame(); });
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
        ui.selectedTrayIndex = null;
      } else if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
        ui.selectedTrayIndex = null;
      }
    } else if (ui.dragFrom) {
      // 棋盘→候选区：空槽放入；槽内有武器/字牌则交换（见 Battle.recallToTray）
      if (trayTarget !== null) {
        if (battle.recallToTray(ui.dragFrom, trayTarget)) { clearBoardSelect(); }
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
    else if (menuPopup === 'stamina') menuPopupsLazy.get()!.drawStaminaPopup(ctx, stamina.value, staminaPopupToast);
    else if (menuPopup === 'map') menuPopupsLazy.get()!.drawMapPopup(ctx, mapSelection, pickDailyMap().name);
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
    codexLazy.get()!.drawCodex(ctx, loadout);
  } else if (screen === 'rank') {
    leaderboardLazy.get()!.drawLeaderboard(ctx, rank.level);
  } else if (screen === 'bag') {
    bagLazy.get()!.drawBag(ctx, bag, bagToast, bagScrollY);
    if (bagPopup) bagLazy.get()!.drawBagPopup(ctx, bag, bagPopup);
  } else if (screen === 'pvpMatching') {
    const mc = pvpMatchLazy.get(); const sc = pvpScreenLazy.get();
    if (mc && sc && pvpController) {
      pvpController.pump(performance.now());
      const view = mc.toMatchView(pvpController.state, pvpMode, pvpCopied);
      if (view) sc.drawPvpMatching(ctx, view);
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
    }
    beginNetDeadCountdown(now); // 判死瞬间记倒计时起点（幂等）
    // 冻结战斗（不 step）：结算弹层 / 暂停 / 引导 / 我方断线(pvpNetDead) / 对方断线倒计时(pvpOppGone)。
    // 仍连续重绘以播动画（断线时定格画面 + 弹窗倒计时）。
    // Task 9.5：步进门控用 shouldStepSim()——入参只有 paused/tutorial/settleOpen/netDead，
    // **不含** pvpExitPopup。故 PvP 退出弹窗开着时(pvpExitPopup=true、ui.paused=false) 仿真照常步进，
    // 实现「弹窗不暂停对局」。单人暂停(paused=true)则仍冻结。
    if (shouldStepSim({ paused: ui.paused, tutorial: !!tutorialOverlay, settleOpen: isSettleOpen(), netDead: pvpNetDead || pvpOppGone })) {
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
    startAmbient(currentMap.id); // 进入对战启动该地图氛围音（幂等）
    // 播放引擎发出的音效事件
    if (battle.sfxEvents.length) {
      for (const ev of battle.sfxEvents) playSfx(ev);
      battle.sfxEvents.length = 0;
    }
    // 胜负结算入境界 + 功德（仅一次），随后在战斗页弹出结算层。
    // Task 10：PvP 由「服务端 result 权威」终局（下方块），单人不吃 pvpSock 分支——故这里加 `&& !pvpSock` 分流。
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost') && !pvpSock) {
      endHandled = true;
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
    // —— Task 10：PvP 终局由「服务端 result」权威驱动 ——
    // 与单人块互斥（单人块已加 && !pvpSock）。result 一到：本方半场已在 step 门控冻结，这里结算段位/功德/商人
    // （与单人一致，差别：段位冻结单人 AI 难度、平局不动段位，见 pvp-settle.ts）。不设 endHandled（那是单人概念），PvP 用 pvpSettleResult 开关。
    if (pvpSock && pvpResult && !pvpSettleResult) {
      const { rankChange, meritGain } = pvpSettle(pvpResult.outcome, rank, battle.wave);
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
      const outLabel = pvpResult.outcome === 'win' ? '对局胜利' : pvpResult.outcome === 'lose' ? '对局失败' : '平局';
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
      battle.bridgeOpponentFromSnap(oppView.interpAt(Date.now()));
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
    // 结算层互斥：PvP 结算屏优先（pvpSettleResult 非空=服务端 result 已到），否则单人无尽/段位结算。
    if (pvpSettleResult) drawPvpSettle(ctx, pvpSettleResult, now - pvpSettleStart);
    else if (endlessResult) drawEndlessSettle(ctx, endlessResult, now - settleStart);
    else if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
    drawWeaponPickups(ctx, visibleWeaponPickups(), bag);
    // Task 7.6：断线弹窗最顶层（盖住结算/暂停），只有判死后才画。
    if (pvpNetDead) drawNetDeadOverlay(ctx, (DISCONNECT_COUNTDOWN_MS - (now - pvpNetDeadStart)) / 1000);
    // 对方断线弹窗：倒计时期间显示；结算屏一开（pvpSettleResult 非空）则让位给结算（避免两顶层重叠）。
    if (pvpOppGone && !pvpResult && !pvpSettleResult) drawOppGoneOverlay(ctx, (DISCONNECT_COUNTDOWN_MS - (now - pvpOppGoneStart)) / 1000);
    // 暂停/退出弹窗：与结算、断线互斥（ settle > net-dead > pause 的视觉优先级靠下面的 !isSettleOpen()/!pvpNetDead 保证）。
    if (isPausePopupOpenPure(ui.paused, pvpExitPopup) && !isSettleOpen() && !pvpNetDead) drawPausePopup(ctx, pausePhase, pausePopupContext(!!pvpSock));
  }
  if (tutorialOverlay) drawTutorialOverlay(ctx, tutorialOverlay, now);
  // Task 10 首局动态引导：非模态箭头 + 「跳过」。仅 battle 屏、引导活跃、且无 modal 教程时画
  // （modal 教程开着时箭头让位，关掉后由 updateFirstGameGuide 恢复）。箭头与波次押后在
  // battle.ts 的 holdFirstWaveForSetup 联动，这里只管绘制。
  if (screen === 'battle' && isGuideActive() && !tutorialOverlay && battle.status !== 'won' && battle.status !== 'lost') {
    const target = guidePhase === 'summon' ? summonButtonRect() : trayRowRect();
    const label = guidePhase === 'summon' ? '点击征兵' : '把兵器拖到战场部署';
    drawGuideArrow(ctx, target, label, now);
    drawGuideSkip(ctx); // 「跳过」与箭头同层，始终可点
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
  // 测试钩子：直接起一局 PvP（绕过匹配 UI 与体力门），供 headless 冒烟验证本方权威 step + 渲染桥。
  // 注（Task 5）：onPvpMatched 会尝试连一个真实 WS（ fabricated matchId），连不上则 PvpSocket 指数退避静默重连、
  // 本方半场照常本地运行（PvpSocket 不抛）。对无服务端的单机探针场景可接受。
  enterPvp: (seed: number) => void;
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
    ? { code: pvpController.state.code, phase: pvpController.state.phase }
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
};
(window as unknown as { __game: GameHook }).__game = hook;
