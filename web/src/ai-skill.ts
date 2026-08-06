// web/src/ai-skill.ts
// 跨局自适应 AI 强度控制器：把长期玩家胜率收敛到 AI_TARGET_WINRATE。
// 纯逻辑，无副作用（持久化读写单列 load/save，便于单测）。
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.aiskill';

export const DEFAULT_AI_SKILL = 1.0;
export const AI_SKILL_MIN = 0.72; // 下限刻意收紧：AI 再弱也维持基本防线（打压不过头/不明显）
export const AI_SKILL_MAX = 1.8;
export const AI_TARGET_WINRATE = 0.7;
const STEP_K = 0.06; // 步长；胜 +0.3k、负 -0.7k

// 随机逼近：胜=+ (1-p*)·k，负=- p*·k → 期望零漂移在 p=p*，长期胜率锁定 p*。
export function nextAiSkill(cur: number, playerWon: boolean, target = AI_TARGET_WINRATE): number {
  const delta = playerWon ? STEP_K * (1 - target) : -STEP_K * target;
  return Math.max(AI_SKILL_MIN, Math.min(AI_SKILL_MAX, cur + delta));
}

export interface AiKnobs {
  summonInterval: number; // 两次 AI 征兵的最小间隔（秒）
  pSubOptimal: number;    // 布阵次优概率 [0, PSUB_MAX]
}

const BASE_SUMMON_INTERVAL = 2.4; // skill=1 时的征兵节奏
const ITV_MIN = 1.2, ITV_MAX = 5.0;
const PSUB_MAX = 0.35; // 次优上限，保证 AI 始终连贯
const PSUB_SLOPE = 0.9;

export function skillToKnobs(skill: number): AiKnobs {
  const summonInterval = Math.max(ITV_MIN, Math.min(ITV_MAX, BASE_SUMMON_INTERVAL / skill));
  const pSubOptimal = Math.max(0, Math.min(PSUB_MAX, (1 - skill) * PSUB_SLOPE));
  return { summonInterval, pSubOptimal };
}

export function loadAiSkill(): number {
  try {
    const raw = storeGet(KEY);
    if (raw != null) {
      const v = Number(raw);
      if (Number.isFinite(v)) return Math.max(AI_SKILL_MIN, Math.min(AI_SKILL_MAX, v));
    }
  } catch { /* ignore */ }
  return DEFAULT_AI_SKILL;
}

export function saveAiSkill(v: number): void {
  try { storeSet(KEY, String(v)); } catch { /* ignore */ }
}
