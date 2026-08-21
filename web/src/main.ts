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
  traySlotAnimDone,
  type UiState,
} from './render';
import type { Cell } from './board';
import { pickDailyMap, mapById, MAPS, pathEntranceCell } from './board';
import { loadMapSelection, saveMapSelection, resolveMap, type MapSelection } from './map-select';
import { loadAssets, type AssetLoadProgress } from './assets';
import { drawLoadingScreen } from './loading-screen';
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
import { drawSettle, isSettleAnimDone, SETTLE_ANIM_MS, drawEndlessSettle, type EndlessResult, drawPvpSettle, type PvpSettleResult } from './settle';
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
import { PvpSync } from './pvp-battle';                   // PvP 对局同步记账（Task 6 的 onPvpMatched 实例化）
import { toPvpAction } from './pvp-record';                  // 玩家输入 → PvpAction 命令映射（本方打点，Task 5）
import { drainFixedSteps, PVP_SIM_DT, DELAY_TICKS, pvpWaveStartTick } from './pvp-fixedstep'; // PvP 固定步长累加器 + 延迟重放 tick 数 + 波起始纪元→tick（Task 9）

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

// PvP 网络适配：把 pvp-client 的五个函数喂给状态机（签名逐字一致）
function pvpNet() {
  return {
    enqueue: pvpClient.versusEnqueue, poll: pvpClient.versusPoll, cancel: pvpClient.versusCancel,
    roomCreate: pvpClient.versusRoomCreate, roomJoin: pvpClient.versusRoomJoin,
  };
}
// 集成缝：匹配成功 → 真正开一局 PvP 对局（Plan C Task 6）。
// 建两个确定性 Battle 实例（本方 battle + 对手 oppBattle，同 MatchStart.seed）、建 PvpSync、
// 扣体力、切战斗屏、起 1s tick 轮询（上报本方摘要、收对手动作/下一波/终局）。
function onPvpMatched(ms: import('./api/pvp-client').MatchStart): void {
  pvpController = null;
  const map = mapById(ms.map) ?? currentMap;
  const meta = metaBonuses(merit), wb = weaponBonuses(bag);
  // PvP 固定 difficulty=1（两端同 seed→同怪，跨机确定；强弱由各自 loadout/战力经 wavePressure 体现=各算各的）。
  // 对手 loadout 暂用对称占位（MatchStart 未下发对手配装，DONE_WITH_CONCERNS）——aiWeaponBonuses 亦对称占位。
  // aiSkill=undefined→DEFAULT_AI_SKILL；heroMatch=undefined；pvpInit 关本地 AI（pvp 时本机不收 AI）。
  const mk = () => new Battle(ms.seed, 1, map, meta, wb, loadout.equipped, loadout.passives, false, undefined, 1, undefined, { enabled: true });
  battle = mk();
  oppBattle = mk(); // 对手侧确定性重放实例（Task 7 喂对手动作、Task 8 渲染到对手半场）
  bindBattleWeaponPickup();
  pvpSync = new PvpSync({ matchId: ms.matchId, seed: ms.seed, startAtServerMs: ms.startAtServerMs, serverOffsetMs: 0, delayTicks: DELAY_TICKS, now: () => Date.now() });
  pvpAcc = 0; pvpOppSimTick = 0; localSimTick = 0; pvpNextWave = null; pvpResult = null; pvpLastServerOkMs = performance.now();
  // Task 10：记对手档案（结算屏展示）、认输标志归零；PvP 结算屏归零。
  pvpOpponent = ms.opponent; pvpSurrendered = false; pvpSettleResult = null; pvpSettleStart = 0;
  // Task 9 波驱动状态 reset：开局纪元 + 波号→startTick 缓存清空 + 清波上报/下降沿归零。
  pvpMatchStartMs = ms.startAtServerMs; pvpWaveStartTicks.clear(); pvpPendingWaveClear = null; pvpPrevWaveActive = false;
  // 真正开打才扣体力（入口 gate 已保证 value ≥ COST，这里再花一次）
  const sp = spendStamina(stamina);
  if (sp.ok) stamina = sp.state;
  // reset 战斗标志（镜像 newGame）
  endHandled = false; endlessResult = null; settleChange = null; ui.paused = false; pausePhase = 'main';
  ui.passivePopup = null; ui.passivePopupUntil = 0; ui.activePopup = null; ui.aiItemPopup = null; ui.peachPopup = false; ui.bombPopup = null; pendingFirstSummonTutorial = false;
  screen = 'battle';
  startPvpTickLoop();
  scheduleFrame();
}

// PvP 1s tick 心跳：上报本方摘要（含 kills）、收对手动作/下一波/终局。pvpSync 门控，离局即停。
function startPvpTickLoop(): void {
  if (pvpTickTimer) { clearTimeout(pvpTickTimer); pvpTickTimer = null; }
  const loop = () => {
    if (!pvpSync) return;               // 已离开 PvP（结算/退出）→ 停
    void pumpPvpTick();
    pvpTickTimer = setTimeout(loop, 1000); // 1s 心跳（放置动作即时补发的 ~300ms 去抖留后续优化）
  };
  pvpTickTimer = setTimeout(loop, 1000);
}
function stopPvpTickLoop(): void { if (pvpTickTimer) { clearTimeout(pvpTickTimer); pvpTickTimer = null; } }

/** 结束当前 PvP 对局并清理所有对局态（所有「离开 battle 屏」的路径都必须调用；幂等）。
 *  单人时这些字段本就是 null/0，调用无副作用。停在心跳最前（否则残留定时器会再 pump 一次打服务端）。 */
function endPvpSession(): void {
  stopPvpTickLoop();
  pvpSync = null; oppBattle = null;
  pvpResult = null; pvpNextWave = null; pvpSettleResult = null; pvpOpponent = null;
  pvpSurrendered = false;
  pvpAcc = 0; pvpOppSimTick = 0; localSimTick = 0; pvpLastServerOkMs = 0; pvpMatchStartMs = 0;
  pvpWaveStartTicks.clear(); pvpPendingWaveClear = null; pvpPrevWaveActive = false;
}

// 单次 tick：组摘要+请求→发服务端→应用响应（对手动作入库、记联络时刻、存下一波/终局）。
async function pumpPvpTick(): Promise<void> {
  if (!pvpSync) return;
  const s = battle.snapshot();
  const digest = { wave: s.wave, power: s.towerPow, kills: s.kills, tangsengHP: s.tangsengHP, peach: s.peach, units: s.units };
  // status：认输 > 唐僧死 > 正常（Task 10 新增 surrender；认走后服务端据此下发 lose/opponentSurrender）
  const status: 'playing' | 'tangsengDead' | 'surrender' =
    pvpSurrendered ? 'surrender' : (battle.status === 'lost' ? 'tangsengDead' : 'playing');
  // 清波上报：捕获待上报快照（防 await 期间被新一轮下降沿覆盖；成功后再按同一引用清除）。
  const wc = pvpPendingWaveClear;
  const req = pvpSync.buildTick(digest, wc, status);
  const r = await pvpClient.versusTick(req);
  if (!pvpSync) return;                 // await 期间可能已离局
  if (r.ok) {
    pvpSync.applyResponse(r.data);
    pvpLastServerOkMs = performance.now();
    if (r.data.nextWave) {
      pvpNextWave = r.data.nextWave;
      // 缓存 波号→本地开波 tick：两端同 server 纪元→同 tick；各实例按自己 wave+1 查表在各自时钟到点开波。
      const st = pvpWaveStartTick(r.data.nextWave.startAtServerMs, pvpMatchStartMs);
      pvpWaveStartTicks.set(r.data.nextWave.wave, st);
    }
    if (r.data.result) pvpResult = r.data.result;            // Task 10 消费（服务端权威终局 → frame() 驱动结算）
    // 断线提示：对手断线（服务端 opponentStatus=disconnected）时给一条战场提示，真正判负由服务端 DisconnectTimeout→result 驱动。
    if (r.data.opponentStatus === 'disconnected') battle.message = '对手网络中断…';
    // 反作弊提示：若服务端下发 cheatNotice（作弊封禁），给一条提示（UI-only，复杂封禁流程后续迭代）。
    if (r.data.cheatNotice) battle.message = r.data.cheatNotice.msg;
    // 仅当上报的是我们刚捕获的那份（未被新一轮清波替换）才清除，避免 await 期间新值被误清。
    if (pvpPendingWaveClear === wc) pvpPendingWaveClear = null;
  }
  // 失败(r.ok===false)：Task 10 做断线判定（frame() 按 pvpLastServerOkMs>6s 提示）；本任务先忽略（下次心跳重试）
}
function onPvpFailed(_reason: string): void {
  // 失败态由匹配屏「确认」按钮回首页；这里仅确保重绘（needsContinuousLoop 已保持帧）
  scheduleFrame();
}
function enterPvpMatching(mode: 'random' | 'invite' | 'join', code?: string): void {
  if (screen === 'pvpMatching') return; // 防重入：已在匹配屏则忽略（避免并发 ensure 建出多个 controller 泄漏）
  pvpMatchLazy.ensure((m) => {
    pvpScreenLazy.ensure(() => {
      pvpMode = mode; pvpCopied = false;
      pvpController = new m.PvpMatchController({
        net: pvpNet(), now: () => performance.now(), onMatched: onPvpMatched, onFailed: onPvpFailed,
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
let pvpSync: PvpSync | null = null;   // 非空表示当前处于 PvP 对局（Task 10 的 onPvpMatched 赋值）
let pvpAcc = 0;                        // 固定步长累加器余量
let oppBattle: Battle | null = null;   // 对手侧确定性重放实例（Task 7 喂动作、Task 8 渲染）
let pvpOppSimTick = 0;                  // oppBattle 已步进到的延迟 simTick（每对局 reset；Task 7 延迟重放节拍）
let localSimTick = 0;                   // 本方 battle 已完成的固定步数 = 下一步 tick 索引；record 打点与对手延迟的统一时钟基准（每对局 reset）
let pvpTickTimer: ReturnType<typeof setTimeout> | null = null; // 1s tick 心跳定时器
let pvpNextWave: { wave: number; startAtServerMs: number } | null = null; // 存服务端下一波（Task 9 用）
let pvpResult: { outcome: 'win' | 'lose' | 'draw'; reason: string } | null = null; // 存服务端终局（Task 10 用）
let pvpLastServerOkMs = 0;             // 最近一次 tick 成功时刻（断线检测，Task 10）
// —— Task 9：先清者定波次（服务端 nextWave 权威排程，本机按 tick 确定性开波）——
let pvpMatchStartMs = 0;                        // 开局纪元（服务端 startAtServerMs）：波次纪元→tick 的零点
const pvpWaveStartTicks = new Map<number, number>(); // 波号→该波本地开波 tick（缓存：两端各按自己 wave+1 查表）
let pvpPendingWaveClear: { wave: number; t: number } | null = null; // 待上报的清波（本方 waveActive 下降沿，交给下次 tick 上报）
let pvpPrevWaveActive = false;                  // 本方上一帧 waveActive（下降沿检测：true→false = 刚清波）
// —— Task 10：PvP 终局（认输 / 服务端 result 权威结算 / 断线提示）——
let pvpSurrendered = false;                     // 本方已点「认输」：tick status 改报 surrender，等服务端 result 驱动终局
let pvpOpponent: import('./api/pvp-client').OpponentProfile | null = null; // 当前对手档案（结算屏展示头像/昵称）
let pvpSettleResult: PvpSettleResult | null = null; // PvP 结算屏 payload（服务端 result 一到即构造，null=未结算）
let pvpSettleStart = 0;                         // 打开 PvP 结算屏的时间戳（虽无加减星动画，保留供可能的淡入/时间线复用）
/** Cell → PvpAction cell 字符串（协议格式 r{r}c{c}；与内部 cellKey 的 `c,r` 顺序不同，勿混用） */
const cs = (c: Cell): string => `r${c.r}c${c.c}`;
/**
 * PvP 到点开波：某实例 b 的 wave+1 已被服务端排程且其时钟已达 startTick、且当前无活动波 → 开波（step 之前调）。
 *
 * 两实例各按自己 wave+1 查同一份「波号→startTick」缓存，在各自时钟（battle 用 localSimTick、oppBattle 用
 * pvpOppSimTick）到点开波。因 startTick 由绝对服务端纪元算得（跨机同值），两端在同一 tick 索引开波；
 * 每 tick 的「输入→开波→step」顺序两端一致 → startNextWave 消费 this.rng 的骑兵/小Boss roll 序一致（确定性）。
 * tick<st 早退 + startNextWave 内 waveActive 幂等 → 即使某帧追多 tick，也必恰在 tick===startTick 那一步开波。
 */
function maybeOpenPvpWave(b: Battle, tick: number): void {
  if (b.waveActive || b.status === 'won' || b.status === 'lost') return;
  const st = pvpWaveStartTicks.get(b.wave + 1);
  if (st === undefined || tick < st) return;
  b.startNextWave();
}

/** 每个 PvP 固定子步后回调：把 oppBattle 追到延迟目标 tick，施加对手转发来的动作（延迟重放）。
 *  由 frame() 固定步长循环每子步调用（Task 4 已接）。每帧把 oppBattle 追到 `localSimTick - DELAY_TICKS`
 *  （与本方同一累加器时钟，恒落后 DELAY_TICKS），实现对手半场的延迟重放；开局前 DELAY_TICKS 步
 *  target<0，oppBattle 不步进（对手侧稍后出现，正常 warmup）。
 *  注：不再用纪元 aiSimTick()——纪元时钟在未校准两端设备钟差时会误触，累加器更稳健。 */
function onPvpSimTick(): void {
  if (!pvpSync || !oppBattle) return;
  const target = localSimTick - DELAY_TICKS; // 与本方同一累加器时钟，恒落后 DELAY_TICKS；开局前 DELAY_TICKS 步 target<0，oppBattle 不步进（正常 warmup）
  let guard = 0;
  while (pvpOppSimTick < target && guard++ < 240) { // guard 防极端追帧卡死（240 步 = 8s @ 30Hz）
    for (const a of pvpSync.takeReady(pvpOppSimTick)) oppBattle.applyPvpInput(a); // 到点施加对手动作（缓冲已按 t 升序）
    maybeOpenPvpWave(oppBattle, pvpOppSimTick); // 到点开波（step 前、对手输入之后；与本方同序=输入→开波→step，保确定性）
    oppBattle.step(PVP_SIM_DT);
    pvpOppSimTick++;
  }
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

function buttonRect(id: string): { x: number; y: number; w: number; h: number } | null {
  const btn = getButtons(battle).find((b) => b.id === id);
  return btn ? { x: btn.x, y: btn.y, w: btn.w, h: btn.h } : null;
}

function battleIntroSequence(): TutorialSequence {
  const steps: TutorialStep[] = [
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
  ];
  // 无尽模式没有 AI 对手（不会被击败判负），不展示该步
  if (!battle.endless) {
    steps.push({
      id: 'aiOpponent',
      title: 'AI 对手',
      text: '对角是 AI 对手的唐僧，双方同时应战——谁的唐僧先被妖怪吃掉，谁就算输！',
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
      text: '这里显示你当前拥有的蟠桃数量，击杀妖怪也会掉落。点击桃子可查看获取途径。蟠桃是征兵的唯一资源，攒够后就能召募士兵和武将。',
      getAnchor: () => peachHudRect(),
    },
    {
      id: 'goSummon',
      title: '赶紧去征兵',
      text: '唐僧还在赶来的路上——趁这段时间点【征兵】招募，再把士兵拖到地图上布阵，等他归位、怪物来袭时才有防线可用！',
      getAnchor: () => buttonRect('summon'),
    },
  );
  return { id: 'battleIntro', steps };
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
        getAnchor: () => merchantLazy.get()!.merchantActiveRowRect(),
      },
      {
        id: 'passiveSkill',
        title: '被动技能是什么',
        text: '被动技能装备后全程自动生效，无需手动操作。',
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
  pausePhase = 'main';
  ui.passivePopup = null;
  ui.passivePopupUntil = 0;
  ui.activePopup = null;
  ui.aiItemPopup = null;
  ui.peachPopup = false;
  ui.bombPopup = null;
  pendingFirstSummonTutorial = false;
}

function abortBattleToMenu(): void {
  endPvpSession(); // Task 10：统一清理 PvP 对局态（停心跳、清 pvpSync/oppBattle/pvpSettleResult 等），单人调用无副作用（幂等）
  ui.paused = false;
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
  if (pvpSync) pvpSync.record(toPvpAction('claimDrop', { id }), localSimTick); // 成功拾取后记命令（仅命令，不记碎片结果）
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
        if (battle.summon()) { pendingFirstSummonTutorial = true; if (pvpSync) pvpSync.record(toPvpAction('summon', {}), localSimTick); }
      } else if (btn.id === 'autoplace') { battle.autoPlaceTray(); if (pvpSync) pvpSync.record(toPvpAction('autoplace', {}), localSimTick); }
      else if (btn.id === 'act0' || btn.id === 'act1') {
        const i = btn.id === 'act1' ? 1 : 0;
        const def = activeById(battle.activeSlots[i]?.id ?? '');
        if (def && isDragActiveEffect(def.effect)) return true; // 拖拽类技能不响应点按触发
        if (battle.activeSlots[i]?.ready) { battle.triggerActive(i); if (pvpSync) pvpSync.record(toPvpAction('active', { slot: i, id: battle.activeSlots[i]?.id }), localSimTick); }
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
    } else if (hit === 'copy' && pvpController.state.link) {
      const link = pvpController.state.link;
      try { void navigator.clipboard?.writeText(link).catch(() => {}); } catch { /* 剪贴板不可用则忽略 */ }
      pvpCopied = true; scheduleFrame();
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
      // leaveSettleToMenu 开头会调 endPvpSession()：PvP 下清 pvpSync/pvpSettleResult 等全部对局态。
      leaveSettleToMenu();
    } else if (!pvpSettleResult) {
      // 单人结算才允许「点击跳到终态」；PvP 无加减星动画，保持计时不动。
      settleStart = performance.now() - SETTLE_ANIM_MS;
    }
    return;
  }
  // —— 局内暂停：弹窗内继续 / 终止（二次确认） / 认输（PvP 一步到位） —— //
  if (ui.paused) {
    const hit = pausePopupHitAt(x, y, pausePhase, pvpSync ? 'match' : 'battle');
    if (hit === null) return;
    playSfx('click');
    if (hit.kind === 'continue') {
      ui.paused = false;
      pausePhase = 'main';
    } else if (hit.kind === 'surrender') {
      // PvP 认输：标记 surrendered，关暂停，走服务端 result→结算（不直接 abortBattleToMenu，否则泄漏对局且无结算）。
      pvpSurrendered = true;
      ui.paused = false;
      pausePhase = 'main';
      battle.message = '已认输，等待结算…';
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
        if (slotDef && isBombActiveEffect(slotDef.effect)) { battle.placeBomb(ui.dragActiveSlot, target); if (pvpSync) pvpSync.record(toPvpAction('active', { slot: ui.dragActiveSlot, id: actId, cell: cs(target) }), localSimTick); }
        else { battle.applyPillActive(ui.dragActiveSlot, target); if (pvpSync) pvpSync.record(toPvpAction('active', { slot: ui.dragActiveSlot, id: actId, cell: cs(target) }), localSimTick); }
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
        if (pvpSync) pvpSync.record(toPvpAction('place', { index: ui.dragTrayIndex, cell: cs(target) }), localSimTick);
        ui.selectedTrayIndex = null;
      } else if (trayTarget !== null && trayTarget !== ui.dragTrayIndex) {
        battle.mergeTrayTokens(ui.dragTrayIndex, trayTarget);
        if (pvpSync) pvpSync.record(toPvpAction('merge', { from: ui.dragTrayIndex, to: trayTarget }), localSimTick);
        ui.selectedTrayIndex = null;
      }
    } else if (ui.dragFrom) {
      // 棋盘→候选区：空槽放入；槽内有武器/字牌则交换（见 Battle.recallToTray）
      if (trayTarget !== null) {
        if (battle.recallToTray(ui.dragFrom, trayTarget)) { clearBoardSelect(); if (pvpSync) pvpSync.record(toPvpAction('recall', { from: cs(ui.dragFrom), slot: trayTarget }), localSimTick); }
      } else if (target) {
        if (target.c === ui.dragFrom.c && target.r === ui.dragFrom.r) {
          // 未移动 = 点击：切换选中（显示/隐藏该单位信息面板与攻击范围）
          // 已激活武将：点左右任一格都视为同一选中态（双字同时选中）
          const same = isSameSelection(battle, ui.selected, target);
          if (same) clearBoardSelect();
          else selectBoardCell(target);
        } else {
          battle.dragBoard(ui.dragFrom, target);
          if (pvpSync) pvpSync.record(toPvpAction('move', { from: cs(ui.dragFrom), to: cs(target) }), localSimTick);
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
    // 结算弹层 / 暂停 / 引导时冻结战斗（不 step），仍连续重绘以播动画
    if (!ui.paused && !tutorialOverlay && !isSettleOpen()) {
      try {
        if (pvpSync && !pvpResult) {
          // PvP：累计真实时间，按 1/30 固定子步多次 step（确定性、帧率无关）。
          // Task 10：服务端 result 一到即冻结本方半场（`&& !pvpResult`）——胜可能来自对手唐僧死而本方仍 playing，
          // 继续 step 会让本方唐僧也死，破坏「冻结定格」语义，所以终局后不再步进。
          // 断线提示（UI-only）：>6s 未收到服务端确认即提示；真正判负由服务端 DisconnectTimeout→result 驱动（上方 pumpPvpTick 消费）。
          if (performance.now() - pvpLastServerOkMs > 6000) battle.message = '网络中断，可能判负…';
          const { steps, rest } = drainFixedSteps(pvpAcc, dt, PVP_SIM_DT, 8);
          pvpAcc = rest;
          for (let i = 0; i < steps; i++) {
            maybeOpenPvpWave(battle, localSimTick);              // 到点开波（step 前；本方输入即时施加在 handler，step 前已就绪）
            battle.step(PVP_SIM_DT);
            if (pvpPrevWaveActive && !battle.waveActive) pvpPendingWaveClear = { wave: battle.wave, t: localSimTick }; // 清波下降沿：本波刚清空，记入待上报（交给下次 tick）
            pvpPrevWaveActive = battle.waveActive;
            localSimTick++; // 完成一步，步数 +1 = 下一步 tick 索引（本方权威时钟；record 打点与对手延迟都以此为基准）
            onPvpSimTick();
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
    }
    startAmbient(currentMap.id); // 进入对战启动该地图氛围音（幂等）
    // 播放引擎发出的音效事件
    if (battle.sfxEvents.length) {
      for (const ev of battle.sfxEvents) playSfx(ev);
      battle.sfxEvents.length = 0;
    }
    // 胜负结算入境界 + 功德（仅一次），随后在战斗页弹出结算层。
    // Task 10：PvP 由「服务端 result 权威」终局（下方块），单人不吃 pvpSync 分支——故这里加 `&& !pvpSync` 分流。
    if (!endHandled && (battle.status === 'won' || battle.status === 'lost') && !pvpSync) {
      endHandled = true;
      pendingMerchant = true;
      recordHeroMatchGame(battle.heroMatchedIdsThisGame());

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
    // 与单人块互斥（单人块已加 && !pvpSync）。result 一到：停心跳（保留 pvpSync/pvpSettleResult 供冻结渲染+结算）、
    // 构造结算 payload、不记境界/功德/商人（PvP 与境界解耦）。不设 endHandled（那是单人概念），PvP 用 pvpSettleResult 开关。
    if (pvpSync && pvpResult && !pvpSettleResult) {
      stopPvpTickLoop();                        // 终局停心跳（保留 pvpSync/pvpSettleResult 供冻结渲染+结算，点击返回时 endPvpSession 才清）
      pvpSettleResult = {
        outcome: pvpResult.outcome,
        reason: pvpResult.reason,
        opponent: { nickname: pvpOpponent?.nickname ?? null, avatarId: pvpOpponent?.avatarId ?? '' },
      };
      pvpSettleStart = performance.now();
      battle.message = pvpResult.outcome === 'win' ? '对局胜利' : pvpResult.outcome === 'lose' ? '对局失败' : '平局';
      // 故意不做：recordWin/recordLose、meritReward/addMerit、pendingMerchant（PvP 不动境界/功德/商人）
      // 注：PvP 终局遥测未接 track（TelemetryType 联合未含 pvp_end，避免扩 schema）；后续如需统计再加。
    }
    setHudRank(rankName(rank.level));
    // PvP 渲染桥（Task 8）：每帧渲染前把 oppBattle 本方侧镜像进 battle.ai*，复用 drawAiSide 画对手半场。
    // 仅 pvpSync 非空（在线对局中）时桥一次；单人路径完全不碰，零影响。
    if (pvpSync && oppBattle) battle.bridgeOpponentFrom(oppBattle);
    draw(ctx, battle, ui);
    // 结算层互斥：PvP 结算屏优先（pvpSettleResult 非空=服务端 result 已到），否则单人无尽/段位结算。
    if (pvpSettleResult) drawPvpSettle(ctx, pvpSettleResult, now - pvpSettleStart);
    else if (endlessResult) drawEndlessSettle(ctx, endlessResult, now - settleStart);
    else if (settleChange) drawSettle(ctx, settleChange, now - settleStart);
    drawWeaponPickups(ctx, visibleWeaponPickups(), bag);
    if (ui.paused && !isSettleOpen()) drawPausePopup(ctx, pausePhase, pvpSync ? 'match' : 'battle');
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
  // DevTools：第 N 波征兵必出指定英雄两字（测试用）
  forceWaveHero: (heroId: string, wave?: number) => void;
  clearForceWaveHero: () => void;
  forceWaveHeroStatus: () => { wave: number; heroId: string };
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
  step: (dt: number) => void;
  fastForward: (seconds: number, dt?: number) => void;
  grantPeach: (n: number) => void;
  buildDefense: (peach?: number) => void;
  snapshot: () => ReturnType<Battle['snapshot']>;
  curScreen: () => string;
  // 测试钩子：直接起一局 PvP（绕过匹配 UI 与体力门），供 headless 冒烟验证双 Battle + 渲染桥。
  // 对手动作由调用方经 mock 的 /api/versus/tick 下发，进 pvpSync 缓冲后正常落后 DELAY_TICKS 重放。
  enterPvp: (seed: number) => void;
  // 自测探针：PvP 波驱动内部状态（只读，供 headless 冒烟验证 nextWave 缓存/两实例开波确定性）。
  pvpProbe: () => {
    battleWave: number; oppWave: number; battleWaveActive: boolean;
    localSimTick: number; pvpOppSimTick: number; matchStartMs: number;
    waveCache: [number, number][]; pendingClear: boolean;
  } | null;
  // Task 10 自测探针：PvP 终局态（冒烟验证 result 驱动结算 + endPvpSession 清理）。
  pvpEndProbe: () => {
    pvpSync: boolean;               // 非空=对局未清（心跳在跑）
    pvpSettleResult: PvpSettleResult | null; // 非空=已进 PvP 结算
    pvpSurrendered: boolean;
    curScreen: string;
  };
  // Task 10 自测钩子：触发认输（镜像 pause→认输命中处理：置 surrendered、关暂停，走服务端 result→结算）。
  pvpSurrender: () => void;
  // 自测探针：境界/功德（冒烟验证 PvP 终局不动 rank/merit）。
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
    endPvpSession(); // Task 10：DevTools 重开前先清上一局 PvP 对局态（防泄漏 1s 心跳 + oppBattle 残留）；单人调用幂等无副作用
    battle = new Battle(s ?? seed, diff ?? 1, mapId ? mapById(mapId) : currentMap, metaBonuses(merit), weaponBonuses(bag), loadout.equipped, loadout.passives, endless ?? false, newBattleAiSkill(), 1, heroMatchOptsForNewBattle());
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
  curScreen: () => screen,
  // 测试钩子：直接起一局 PvP（绕过匹配 UI 与体力门），供 headless 冒烟验证双 Battle + 渲染桥。
  // 对手动作由调用方经 mock 的 /api/versus/tick 下发，进 pvpSync 缓冲后正常落后 DELAY_TICKS 重放。
  enterPvp: (seed) => {
    const ms = {
      matchId: 'smoke-t8', seed, map: currentMap.id, startAtServerMs: Date.now() - 1000,
      opponent: { uid: 'opp-smoke', nickname: '烟雾对手', avatarId: 'hero-wukong', rankLevel: 1 },
    } as import('./api/pvp-client').MatchStart;
    onPvpMatched(ms);
  },
  pvpProbe: () => {
    if (!pvpSync) return null;
    return {
      battleWave: battle.wave,
      oppWave: oppBattle?.wave ?? -1,
      battleWaveActive: battle.waveActive,
      localSimTick,
      pvpOppSimTick,
      matchStartMs: pvpMatchStartMs,
      waveCache: [...pvpWaveStartTicks.entries()],
      pendingClear: pvpPendingWaveClear !== null,
    };
  },
  // Task 10：PvP 终局态探针（冒烟验证 result 驱动结算 + endPvpSession 清理）。
  pvpEndProbe: () => ({
    pvpSync: pvpSync !== null,
    pvpSettleResult,
    pvpSurrendered,
    curScreen: screen,
  }),
  // Task 10：触发认输（镜像 pause→认输命中处理，保持与真实 UI 路径同源）。
  pvpSurrender: () => {
    pvpSurrendered = true;
    ui.paused = false;
    pausePhase = 'main';
    battle.message = '已认输，等待结算…';
  },
  // 自测探针：境界/功德（冒烟验证 PvP 终局不动 rank/merit）。
  rankMerit: () => ({ rankLevel: rank.level, merit: merit.merit }),
};
(window as unknown as { __game: GameHook }).__game = hook;
