import {
  exportAiPersistState,
  importAiPersistState,
  loadAiSkill,
  rollMatchAiSkill,
  saveAiSkill,
  AI_TARGET_WINRATE,
} from '../ai-skill';
import { RNG } from '../rng';
import {
  playVersusMatch,
  simulatePostMatch,
  type VersusMatchResult,
  type VersusSessionOpts,
  type VersusSessionReport,
} from '../versus-user-agent';
import { DEFAULT_AI_SKILL } from '../ai-skill';

export interface SimProgress {
  done: number;
  total: number;
  wins: number;
  losses: number;
  timeouts: number;
  /** 已分胜负局中的玩家胜率 */
  runningWinRate: number;
  aiSkill: number;
  last?: VersusMatchResult;
  results: VersusMatchResult[];
}

export interface SimRunOpts extends VersusSessionOpts {
  /** false=跑完恢复 AI/连胜连败（默认）；true=写入持久化 */
  persist?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: SimProgress) => void;
  /** 每批局数后让出主线程（默认 1） */
  batchSize?: number;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** 异步分片跑对战模拟，便于 DevTools 实时刷新图表 */
export async function runVersusSessionAsync(opts: SimRunOpts): Promise<VersusSessionReport> {
  const games = Math.max(1, Math.floor(opts.games));
  const seedBase = opts.seedBase ?? 10_000;
  const persist = opts.persist === true;
  const batchSize = Math.max(1, opts.batchSize ?? 1);
  const snap = exportAiPersistState();

  let aiSkill = opts.initialAiSkill ?? loadAiSkill();
  const aiSkillStart = aiSkill;
  let aiSkillMin = aiSkill;
  let aiSkillMax = aiSkill;
  const sessionRng = new RNG(seedBase ^ 0x9e3779b9);
  const results: VersusMatchResult[] = [];
  let wins = 0;
  let losses = 0;
  let timeouts = 0;

  const emit = (last?: VersusMatchResult) => {
    const decided = wins + losses;
    opts.onProgress?.({
      done: results.length,
      total: games,
      wins,
      losses,
      timeouts,
      runningWinRate: decided > 0 ? wins / decided : 0,
      aiSkill,
      last,
      results: [...results],
    });
  };

  try {
    // 先让出一帧，确保「模拟中…」按钮/进度条已上屏，再跑可能长达数十秒的同步对局
    await yieldToUi();
    for (let i = 0; i < games; i++) {
      if (opts.signal?.aborted) break;
      const matchSkill = rollMatchAiSkill(aiSkill, () => sessionRng.next());
      let r: VersusMatchResult;
      try {
        r = playVersusMatch(seedBase + i, matchSkill, opts);
      } catch (err) {
        // 单局逻辑异常不应让整个 DevTools 模拟「点了没反应」；记超时并继续
        console.error(`[DevTools 胜率模拟] 第 ${i + 1} 局失败 seed=${seedBase + i}:`, err);
        r = {
          seed: seedBase + i,
          outcome: 'timeout',
          wave: 0,
          frames: 0,
          simSeconds: 0,
          playerHp: 0,
          aiHp: 0,
          baseAiSkill: matchSkill,
          matchAiSkill: matchSkill,
          winStreak: 0,
          lossStreak: 0,
        };
      }
      results.push(r);
      if (r.outcome === 'won') wins++;
      else if (r.outcome === 'lost') losses++;
      else timeouts++;

      if (r.outcome === 'timeout') {
        aiSkill = simulatePostMatch(aiSkill, false);
      } else {
        aiSkill = simulatePostMatch(aiSkill, r.outcome === 'won');
      }
      aiSkillMin = Math.min(aiSkillMin, aiSkill);
      aiSkillMax = Math.max(aiSkillMax, aiSkill);
      emit(r);

      if ((i + 1) % batchSize === 0 || i === games - 1) {
        await yieldToUi();
      }
    }
  } finally {
    if (!persist) {
      importAiPersistState(snap);
    } else {
      saveAiSkill(aiSkill);
    }
  }

  const decided = wins + losses;
  const playerWinRate = decided > 0 ? wins / decided : 0;
  const aiSkillEndSession = aiSkill;
  const balanceOk =
    playerWinRate >= 0.40
    && playerWinRate <= 0.80
    && aiSkillMin >= 0.72
    && aiSkillMax <= 1.8
    && timeouts <= Math.ceil(games * 0.15);

  return {
    games: results.length,
    wins,
    losses,
    timeouts,
    playerWinRate,
    aiSkillStart,
    aiSkillEnd: aiSkillEndSession,
    aiSkillMin,
    aiSkillMax,
    targetWinRate: AI_TARGET_WINRATE,
    balanceOk,
    results,
  };
}

export { DEFAULT_AI_SKILL, AI_TARGET_WINRATE };
