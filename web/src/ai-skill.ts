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

/** AI 不随机携带的被动（蟠桃园 / 洛阳铲 — 后者 AI 无 shovel 消费链） */
export const AI_EXCLUDED_PASSIVES = new Set(['pas_pantao', 'luoyangchan']);

const DEBUFF_PASSIVES = new Set(['yuni', 'zhuwang']);
const ECON_PASSIVES = new Set(['xianyuan', 'jubaopen', 'mojin', 'zhaoxian']);

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

/** 神兵加成随 aiSkill 缩放：弱 AI 65% → 强 AI 100% */
export function aiWeaponScale(skill: number): number {
  const t = Math.max(0, Math.min(1, (skill - AI_SKILL_MIN) / (AI_SKILL_MAX - AI_SKILL_MIN)));
  return 0.65 + t * 0.35;
}

export function scaleWeaponBonuses(
  src: Record<string, { atk: number; frq: number; rge: number }>,
  scale: number,
): Record<string, { atk: number; frq: number; rge: number }> {
  if (scale >= 1 - 1e-9) return { ...src };
  const out: Record<string, { atk: number; frq: number; rge: number }> = {};
  for (const [id, b] of Object.entries(src)) {
    out[id] = { atk: b.atk * scale, frq: b.frq * scale, rge: b.rge * scale };
  }
  return out;
}

export interface AiLoadoutRoll {
  actives: string[];
  passives: string[];
}

/** 玩家未装备时 AI 随机携带道具数的上限（含 0，即 pick(EMPTY_PLAYER_ITEM_CAP + 1) → 0..CAP）。 */
export const EMPTY_PLAYER_ITEM_CAP = 2;

/** 按 aiSkill 与玩家装备数，决定 AI 本局应携带的道具数量（随机挑选，非复制玩家清单）。 */
export function aiItemTargetCount(
  playerCount: number,
  aiSkill: number,
  pick?: (n: number) => number,
): number {
  if (playerCount <= 0) {
    return pick ? pick(EMPTY_PLAYER_ITEM_CAP + 1) : 0;
  }
  const ratio = aiSkill / DEFAULT_AI_SKILL;
  let target = Math.round(playerCount * ratio);
  if (aiSkill >= DEFAULT_AI_SKILL) {
    target = Math.max(target, Math.round(playerCount * 0.7));
  } else {
    const t = (aiSkill - AI_SKILL_MIN) / (DEFAULT_AI_SKILL - AI_SKILL_MIN);
    target = Math.min(target, Math.round(playerCount * ratio * Math.max(0.35, t)));
    // 弱 AI 仍带至少 1 件，避免过于贫瘠（上限约为玩家一半）
    target = Math.max(1, target);
    target = Math.min(target, Math.max(1, Math.round(playerCount * 0.5)));
  }
  if (aiSkill >= DEFAULT_AI_SKILL * 1.2) target = Math.min(playerCount + 2, target + 1);
  return Math.max(0, Math.min(playerCount + 2, target));
}

function passiveWeight(id: string, aiSkill: number): number {
  if (DEBUFF_PASSIVES.has(id)) {
    return aiSkill >= DEFAULT_AI_SKILL
      ? 1.4 + (aiSkill - DEFAULT_AI_SKILL) * 0.6
      : 0.55;
  }
  if (ECON_PASSIVES.has(id)) {
    return aiSkill < DEFAULT_AI_SKILL ? 1.7 : 0.85;
  }
  return 1;
}

function weightedPickIds(
  pool: readonly string[],
  count: number,
  weightOf: (id: string) => number,
  pick: (n: number) => number,
): string[] {
  const out: string[] = [];
  const rest = [...pool];
  for (let n = 0; n < count && rest.length > 0; n++) {
    const weights = rest.map(weightOf);
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) break;
    let roll = pick(Math.max(1, Math.floor(total * 1000))) / 1000;
    let idx = rest.length - 1;
    for (let i = 0; i < rest.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) { idx = i; break; }
    }
    out.push(rest.splice(idx, 1)[0]!);
  }
  return out;
}

function ensureDebuffPassive(
  passives: string[],
  passivePool: readonly string[],
  targetCount: number,
  aiSkill: number,
  pick: (n: number) => number,
): string[] {
  if (aiSkill < DEFAULT_AI_SKILL * 1.05 || targetCount <= 0) return passives;
  if (passives.some((id) => DEBUFF_PASSIVES.has(id))) return passives;
  const debuffPool = passivePool.filter((id) => DEBUFF_PASSIVES.has(id) && !passives.includes(id));
  if (debuffPool.length === 0) return passives;
  const extra = weightedPickIds(debuffPool, 1, (id) => passiveWeight(id, aiSkill), pick)[0];
  if (!extra) return passives;
  const next = [...passives];
  if (next.length >= targetCount) next[next.length - 1] = extra;
  else next.push(extra);
  return next;
}

/** 开局为 AI 加权随机挑选主动/被动：强 AI 偏 debuff，弱 AI 偏经济。 */
export function rollAiLoadout(
  playerActives: readonly string[],
  playerPassives: readonly string[],
  aiSkill: number,
  pick: (n: number) => number,
): AiLoadoutRoll {
  const playerCount = playerActives.length + playerPassives.length;
  const target = aiItemTargetCount(playerCount, aiSkill, pick);
  if (target <= 0) return { actives: [], passives: [] };

  const activePool = enabledActives().map((a) => a.id);
  const passivePool = enabledPassives()
    .map((p) => p.id)
    .filter((id) => !AI_EXCLUDED_PASSIVES.has(id));

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
  if (targetActives + targetPassives < target) {
    targetPassives = Math.min(passivePool.length, target - targetActives);
  }
  if (targetActives + targetPassives < target && activePool.length > targetActives) {
    targetActives = Math.min(activePool.length, MAX_EQUIPPED_ACTIVES, target - targetPassives);
  }

  const actives = weightedPickIds(activePool, targetActives, () => 1, pick);
  let passives = weightedPickIds(
    passivePool,
    targetPassives,
    (id) => passiveWeight(id, aiSkill),
    pick,
  );
  passives = ensureDebuffPassive(passives, passivePool, targetPassives, aiSkill, pick);

  return { actives, passives };
}
