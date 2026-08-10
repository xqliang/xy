/**
 * 对战用户代理：模拟真实点击节奏（征兵 → 布阵 → 主动技能），用于 headless 批量对局。
 * 不含体力限制；默认 10× 快放，但用 1/fps 物理子步进（避免大 dt 同帧多漏/少开火）。
 */
import { Battle } from './battle';
import {
  AI_TARGET_WINRATE,
  DEFAULT_AI_SKILL,
  effectiveAiSkill,
  loadAiSkill,
  nextAiSkill,
  recordVersusOutcome,
  rollMatchAiSkill,
  saveAiSkill,
  loadPlayerWinStreak,
  loadPlayerLossStreak,
  versusRubberBand,
} from './ai-skill';
import { RNG } from './rng';
import { AI_ADJUST_INTERVAL_FAST_SCALE } from './autoplace';

export const DEFAULT_SPEED_MUL = 10;
export const DEFAULT_FPS = 30;
/** 单局最大外层 tick 数（防 hang）；每 tick = speedMul 个物理步 */
export const DEFAULT_FRAME_CAP = 60 * 30;

export type MatchOutcome = 'won' | 'lost' | 'timeout';

export interface VersusUserAgentOpts {
  /**
   * 快放倍率：每 tick 推进 speedMul 个物理帧（每帧 1/fps 秒）。
   * 勿把整段 dt 一次喂给 battle.step——大 dt 会同帧多漏怪且少开火。
   */
  speedMul?: number;
  fps?: number;
  frameCap?: number;
  /** 到该波仍未分胜负则记 timeout（0 = 不限制） */
  waveCap?: number;
  /** 每局开波前是否跳过 ready/intro 等待（等同玩家点「开战」） */
  skipReadyWait?: boolean;
  /** 是否自动释放已就绪主动技能 */
  useActives?: boolean;
  /**
   * 征兵/布阵/放技能的最小间隔（游戏秒）。
   * 默认 0.75：贴近人手，避免「每物理帧狂点」把 AI 经济甩开导致胜率虚高。
   */
  actionInterval?: number;
}

export interface VersusMatchResult {
  seed: number;
  outcome: MatchOutcome;
  wave: number;
  frames: number;
  simSeconds: number;
  playerHp: number;
  aiHp: number;
  baseAiSkill: number;
  matchAiSkill: number;
  winStreak: number;
  lossStreak: number;
}

export interface VersusSessionOpts extends VersusUserAgentOpts {
  games: number;
  seedBase?: number;
  /** 会话起始 AI skill；默认读持久化 */
  initialAiSkill?: number;
}

export interface VersusSessionReport {
  games: number;
  wins: number;
  losses: number;
  timeouts: number;
  playerWinRate: number;
  aiSkillStart: number;
  aiSkillEnd: number;
  aiSkillMin: number;
  aiSkillMax: number;
  targetWinRate: number;
  /** 胜率落在目标窗内且 AI skill 未贴边 */
  balanceOk: boolean;
  results: VersusMatchResult[];
}

const DEFAULT_AGENT: Required<VersusUserAgentOpts> = {
  speedMul: DEFAULT_SPEED_MUL,
  fps: DEFAULT_FPS,
  frameCap: DEFAULT_FRAME_CAP,
  waveCap: 0,
  skipReadyWait: true,
  useActives: true,
  actionInterval: 0.75,
};

/** 单 tick：模拟用户一次操作循环（开战 → 征兵 → 布阵 → 技能） */
export function userAgentTick(battle: Battle, opts: VersusUserAgentOpts = {}): void {
  const o = { ...DEFAULT_AGENT, ...opts };
  if (o.skipReadyWait && battle.status === 'ready') {
    battle.startNextWave();
    return;
  }
  if (battle.status !== 'playing') return;

  if (battle.peach >= battle.effectiveSummonCost()) {
    battle.summon();
  }
  battle.autoPlaceTray();

  if (o.useActives) {
    for (let i = 0; i < battle.activeSlots.length; i++) {
      const slot = battle.activeSlots[i];
      if (slot?.ready) battle.triggerActive(i);
    }
  }
}

/** 仅开战（不受 actionInterval 节流） */
export function userAgentStartWave(battle: Battle, opts: VersusUserAgentOpts = {}): boolean {
  const o = { ...DEFAULT_AGENT, ...opts };
  if (o.skipReadyWait && battle.status === 'ready') {
    battle.startNextWave();
    return true;
  }
  return false;
}

/** 模拟结算后流程：记录连胜/连败、更新跨局 AI skill（等同关闭神秘商人并开始下一局的前置状态） */
export function simulatePostMatch(sessionAiSkill: number, playerWon: boolean): number {
  recordVersusOutcome(playerWon);
  const next = nextAiSkill(sessionAiSkill, playerWon);
  saveAiSkill(next);
  return next;
}

function physDt(opts: VersusUserAgentOpts): number {
  const o = { ...DEFAULT_AGENT, ...opts };
  return 1 / o.fps;
}

function substeps(opts: VersusUserAgentOpts): number {
  const o = { ...DEFAULT_AGENT, ...opts };
  return Math.max(1, Math.round(o.speedMul));
}

/** 跑一局对战直至胜/负/超时 */
export function playVersusMatch(
  seed: number,
  matchAiSkill: number,
  opts: VersusUserAgentOpts = {},
): VersusMatchResult {
  const o = { ...DEFAULT_AGENT, ...opts };
  const winStreak = loadPlayerWinStreak();
  const lossStreak = loadPlayerLossStreak();
  const band = versusRubberBand(winStreak, lossStreak);
  const effective = effectiveAiSkill(matchAiSkill, band);
  const battle = new Battle(seed, 1, undefined, undefined, {}, [], [], false, matchAiSkill, AI_ADJUST_INTERVAL_FAST_SCALE);
  const dt = physDt(o);
  const steps = substeps(o);
  let frames = 0;
  let simSeconds = 0;
  let nextActionAt = 0;

  while (battle.status !== 'won' && battle.status !== 'lost') {
    if (frames >= o.frameCap) break;
    if (o.waveCap > 0 && battle.wave >= o.waveCap) break;
    if (userAgentStartWave(battle, o)) {
      nextActionAt = simSeconds; // 开波后立即可操作
    } else if (simSeconds >= nextActionAt) {
      userAgentTick(battle, o);
      nextActionAt = simSeconds + o.actionInterval;
    }
    for (let i = 0; i < steps; i++) {
      battle.step(dt);
      simSeconds += dt;
      if (battle.status === 'won' || battle.status === 'lost') break;
    }
    frames++;
  }

  let outcome: MatchOutcome = 'timeout';
  if (battle.status === 'won') outcome = 'won';
  else if (battle.status === 'lost') outcome = 'lost';

  const snap = battle.snapshot();
  return {
    seed,
    outcome,
    wave: snap.wave,
    frames,
    simSeconds,
    playerHp: snap.tangsengHP,
    aiHp: snap.aiHp ?? 0,
    baseAiSkill: matchAiSkill,
    matchAiSkill: effective,
    winStreak,
    lossStreak,
  };
}

/** 连续多局：每局随机 AI skill ±1、隐藏 rubber-band、post-match 更新 skill */
export function runVersusSession(opts: VersusSessionOpts): VersusSessionReport {
  const games = Math.max(1, opts.games);
  const seedBase = opts.seedBase ?? 10_000;
  const agentOpts: VersusUserAgentOpts = opts;
  let aiSkill = opts.initialAiSkill ?? loadAiSkill();
  const aiSkillStart = aiSkill;
  let aiSkillMin = aiSkill;
  let aiSkillMax = aiSkill;

  const sessionRng = new RNG(seedBase ^ 0x9e3779b9);
  const results: VersusMatchResult[] = [];

  for (let i = 0; i < games; i++) {
    const matchSkill = rollMatchAiSkill(aiSkill, () => sessionRng.next());
    const r = playVersusMatch(seedBase + i, matchSkill, agentOpts);
    results.push(r);

    if (r.outcome === 'timeout') {
      // 超时视为玩家未胜，避免 skill 控制器被虚假拉高
      aiSkill = simulatePostMatch(aiSkill, false);
    } else {
      aiSkill = simulatePostMatch(aiSkill, r.outcome === 'won');
    }
    aiSkillMin = Math.min(aiSkillMin, aiSkill);
    aiSkillMax = Math.max(aiSkillMax, aiSkill);
  }

  const wins = results.filter((r) => r.outcome === 'won').length;
  const losses = results.filter((r) => r.outcome === 'lost').length;
  const timeouts = results.filter((r) => r.outcome === 'timeout').length;
  const decided = wins + losses;
  const playerWinRate = decided > 0 ? wins / decided : 0;

  const balanceOk =
    playerWinRate >= 0.40
    && playerWinRate <= 0.80
    && aiSkillMin >= 0.72
    && aiSkillMax <= 1.8
    && timeouts <= Math.ceil(games * 0.15);

  return {
    games,
    wins,
    losses,
    timeouts,
    playerWinRate,
    aiSkillStart,
    aiSkillEnd: aiSkill,
    aiSkillMin,
    aiSkillMax,
    targetWinRate: AI_TARGET_WINRATE,
    balanceOk,
    results,
  };
}

/** 终端友好摘要 */
export function formatVersusSessionReport(report: VersusSessionReport): string {
  const lines: string[] = [
    '── 对战用户代理 · 批量结果 ──',
    `局数: ${report.games}  胜: ${report.wins}  负: ${report.losses}  超时: ${report.timeouts}`,
    `玩家胜率: ${(report.playerWinRate * 100).toFixed(1)}%  (目标长期 ~${(report.targetWinRate * 100).toFixed(0)}%)`,
    `AI skill: ${report.aiSkillStart.toFixed(3)} → ${report.aiSkillEnd.toFixed(3)}  [${report.aiSkillMin.toFixed(3)}, ${report.aiSkillMax.toFixed(3)}]`,
    `平衡判定: ${report.balanceOk ? '通过' : '未通过'}`,
    '',
    '逐局:',
  ];
  for (let i = 0; i < report.results.length; i++) {
    const r = report.results[i]!;
    const tag = r.outcome === 'won' ? '胜' : r.outcome === 'lost' ? '负' : '超时';
    lines.push(
      `  #${i + 1} seed=${r.seed} ${tag} 波=${r.wave} `
      + `AI=${r.matchAiSkill.toFixed(2)} 连胜=${r.winStreak} 连败=${r.lossStreak} `
      + `(${r.simSeconds.toFixed(0)}s sim)`,
    );
  }
  return lines.join('\n');
}
