// web/src/ai-skill.ts
// 跨局自适应 AI 强度控制器：把长期玩家胜率收敛到 AI_TARGET_WINRATE。
// 纯逻辑，无副作用（持久化读写单列 load/save，便于单测）。
import { enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
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

export interface AiLoadoutRoll {
  actives: string[];
  passives: string[];
}

/** 按 aiSkill 与玩家装备数，决定 AI 本局应携带的道具数量（随机挑选，非复制玩家清单）。 */
export function aiItemTargetCount(playerCount: number, aiSkill: number): number {
  if (playerCount <= 0) return 0;
  const ratio = aiSkill / DEFAULT_AI_SKILL;
  let target = Math.round(playerCount * ratio);
  if (aiSkill >= DEFAULT_AI_SKILL) {
    // 玩家有配置时，至少接近玩家数量（约 70% 起）
    target = Math.max(target, Math.round(playerCount * 0.7));
  } else {
    const t = (aiSkill - AI_SKILL_MIN) / (DEFAULT_AI_SKILL - AI_SKILL_MIN);
    target = Math.min(target, Math.round(playerCount * Math.max(0, t)));
  }
  if (aiSkill >= DEFAULT_AI_SKILL * 1.2) target = Math.min(playerCount + 2, target + 1);
  return Math.max(0, Math.min(playerCount + 2, target));
}

function shufflePick<T>(pool: readonly T[], count: number, pick: (n: number) => number): T[] {
  if (count <= 0 || pool.length === 0) return [];
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

/** 开局为 AI 随机挑选主动/被动道具：数量随 aiSkill 调节（强则多、弱则少或无）。 */
export function rollAiLoadout(
  playerActives: readonly string[],
  playerPassives: readonly string[],
  aiSkill: number,
  pick: (n: number) => number,
): AiLoadoutRoll {
  const playerCount = playerActives.length + playerPassives.length;
  const target = aiItemTargetCount(playerCount, aiSkill);
  if (target <= 0) return { actives: [], passives: [] };

  const activePool = enabledActives().map((a) => a.id);
  const passivePool = enabledPassives()
    .map((p) => p.id)
    .filter((id) => id !== 'pas_pantao'); // AI 不镜像蟠桃园

  const activeRatio = playerCount > 0 ? playerActives.length / playerCount : 0.5;
  let targetActives = Math.min(
    MAX_EQUIPPED_ACTIVES,
    activePool.length,
    Math.round(target * activeRatio),
  );
  let targetPassives = Math.min(
    MAX_EQUIPPED_PASSIVES,
    passivePool.length,
    target - targetActives,
  );
  // 被动池有余量时尽量凑满 target
  if (targetActives + targetPassives < target) {
    targetPassives = Math.min(passivePool.length, target - targetActives);
  }
  if (targetActives + targetPassives < target && activePool.length > targetActives) {
    targetActives = Math.min(activePool.length, MAX_EQUIPPED_ACTIVES, target - targetPassives);
  }

  return {
    actives: shufflePick(activePool, targetActives, pick),
    passives: shufflePick(passivePool, targetPassives, pick),
  };
}
