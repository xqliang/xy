// web/src/ai-skill.ts
// 跨局自适应 AI 强度控制器：把长期玩家胜率收敛到 AI_TARGET_WINRATE。
// 纯逻辑，无副作用（持久化读写单列 load/save，便于单测）。
import { enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
import { storeGet, storeSet } from './storage';

const KEY = 'dasheng.aiskill';
const WIN_STREAK_KEY = 'dasheng.aiwinstreak';
const LOSS_STREAK_KEY = 'dasheng.ailossstreak';

/** 对战隐藏调节（不展示）：仅通过抽字/道具概率微调，不在 UI 展示 */
export interface VersusRubberBand {
  /** AI 抽字：满5 武将权重倍率（叠 HIGH_TIER_BIAS） */
  aiWordTier5Bias: number;
  /** 玩家抽字：满5 武将权重倍率 */
  playerWordTier5Bias: number;
  /** AI 征兵字牌转化额外概率（叠 wordDrawChance） */
  aiWordDrawBonus: number;
  /** 玩家征兵字牌转化额外概率 */
  playerWordDrawBonus: number;
  skillFloor: number;
  skillCeiling: number;
  /** AI 额外道具数（主动+被动） */
  aiItemBonus: number;
  /** AI 主动技能占比偏移（正=多带主动） */
  aiActiveRatioBoost: number;
  /** AI 被动 debuff 类（蛛网/淤泥）选取权重倍率 */
  aiDebuffPassiveBias: number;
}

export const DEFAULT_AI_SKILL = 1.0;
export const AI_SKILL_MIN = 0.72; // 下限刻意收紧：AI 再弱也维持基本防线（打压不过头/不明显）
export const AI_SKILL_MAX = 1.8;
export const AI_TARGET_WINRATE = 0.6;
const STEP_K = 0.06; // 步长；胜 +(1-p*)k、负 -p*k（p*=0.6 → 胜 +0.4k、负 -0.6k）

const NEUTRAL_BAND: VersusRubberBand = {
  aiWordTier5Bias: 1,
  playerWordTier5Bias: 1,
  aiWordDrawBonus: 0,
  playerWordDrawBonus: 0,
  skillFloor: AI_SKILL_MIN,
  skillCeiling: AI_SKILL_MAX,
  aiItemBonus: 0,
  aiActiveRatioBoost: 0,
  aiDebuffPassiveBias: 1,
};

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

const BASE_SUMMON_INTERVAL = 1.2; // skill=1 时的征兵节奏（贴近人手点征兵）
const ITV_MIN = 0.6, ITV_MAX = 3.0;
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

/** 本局 AI 基础 skill：在玩家 skill ±1 内均匀随机，再 clamp 到 [MIN, MAX] */
export function rollMatchAiSkill(playerSkill: number, roll: () => number): number {
  const base = Math.max(AI_SKILL_MIN, Math.min(AI_SKILL_MAX, playerSkill));
  const lo = Math.max(AI_SKILL_MIN, base - 1);
  const hi = Math.min(AI_SKILL_MAX, base + 1);
  if (hi <= lo + 1e-9) return lo;
  return lo + roll() * (hi - lo);
}

function loadStreak(key: string): number {
  try {
    const raw = storeGet(key);
    if (raw != null) {
      const v = Math.floor(Number(raw));
      if (Number.isFinite(v) && v >= 0) return v;
    }
  } catch { /* ignore */ }
  return 0;
}

/** 玩家对战连胜数（上一局结算后持久化；本局开局读取） */
export function loadPlayerWinStreak(): number {
  return loadStreak(WIN_STREAK_KEY);
}

/** 玩家对战连败数（与连胜互斥，胜则清零） */
export function loadPlayerLossStreak(): number {
  return loadStreak(LOSS_STREAK_KEY);
}

/** DevTools 模拟：快照 / 恢复 AI skill 与连胜连败，避免污染真实进度 */
export function exportAiPersistState(): { skill: number; winStreak: number; lossStreak: number } {
  return {
    skill: loadAiSkill(),
    winStreak: loadPlayerWinStreak(),
    lossStreak: loadPlayerLossStreak(),
  };
}

export function importAiPersistState(s: { skill: number; winStreak: number; lossStreak: number }): void {
  saveAiSkill(s.skill);
  try {
    storeSet(WIN_STREAK_KEY, String(Math.max(0, Math.floor(s.winStreak))));
    storeSet(LOSS_STREAK_KEY, String(Math.max(0, Math.floor(s.lossStreak))));
  } catch { /* ignore */ }
}

/** 对战结算：胜则 win+1/loss 清零，负则 loss+1/win 清零 */
export function recordVersusOutcome(playerWon: boolean): { win: number; loss: number } {
  if (playerWon) {
    const win = loadPlayerWinStreak() + 1;
    try {
      storeSet(WIN_STREAK_KEY, String(win));
      storeSet(LOSS_STREAK_KEY, '0');
    } catch { /* ignore */ }
    return { win, loss: 0 };
  }
  const loss = loadPlayerLossStreak() + 1;
  try {
    storeSet(LOSS_STREAK_KEY, String(loss));
    storeSet(WIN_STREAK_KEY, '0');
  } catch { /* ignore */ }
  return { win: 0, loss };
}

/** 本局 effective skill：连胜抬 floor、连败压 ceiling */
export function effectiveAiSkill(base: number, band: VersusRubberBand): number {
  let s = base;
  s = Math.max(s, band.skillFloor);
  s = Math.min(s, band.skillCeiling);
  return Math.max(AI_SKILL_MIN, Math.min(AI_SKILL_MAX, s));
}

function mergeBand(base: VersusRubberBand, patch: Partial<VersusRubberBand>): VersusRubberBand {
  return { ...base, ...patch };
}

/**
 * 按连胜/连败档位隐藏调节下一局难度（参数刻意 subtle）：
 * 连胜 1→AI≈70%胜，2→≈80%，≥3 全力；连败 1→玩家≈60%胜，≥2 玩家大概率胜。
 */
export function versusRubberBand(winStreak: number, lossStreak: number): VersusRubberBand {
  const w = Math.max(0, Math.floor(winStreak));
  const l = Math.max(0, Math.floor(lossStreak));
  if (w > 0 && l > 0) return { ...NEUTRAL_BAND }; // 不应同时出现，防御性回退

  if (w > 0) {
    switch (w) {
      case 1:
        return mergeBand(NEUTRAL_BAND, {
          aiWordTier5Bias: 1.24,
          aiWordDrawBonus: 0.03,
          skillFloor: 1.18,
          aiActiveRatioBoost: 0.05,
          aiDebuffPassiveBias: 1.2,
        });
      case 2:
        return mergeBand(NEUTRAL_BAND, {
          aiWordTier5Bias: 1.42,
          aiWordDrawBonus: 0.05,
          skillFloor: 1.32,
          aiItemBonus: 1,
          aiActiveRatioBoost: 0.08,
          aiDebuffPassiveBias: 1.35,
        });
      default:
        return mergeBand(NEUTRAL_BAND, {
          aiWordTier5Bias: 1.62,
          aiWordDrawBonus: 0.07,
          skillFloor: AI_SKILL_MAX,
          aiItemBonus: 2,
          aiActiveRatioBoost: 0.12,
          aiDebuffPassiveBias: 1.55,
        });
    }
  }

  if (l > 0) {
    switch (l) {
      case 1:
        return mergeBand(NEUTRAL_BAND, {
          playerWordTier5Bias: 1.2,
          playerWordDrawBonus: 0.03,
          aiWordTier5Bias: 0.88,
          skillCeiling: 0.94,
          aiItemBonus: -1,
        });
      default:
        return mergeBand(NEUTRAL_BAND, {
          playerWordTier5Bias: 1.36,
          playerWordDrawBonus: 0.05,
          aiWordTier5Bias: 0.76,
          skillCeiling: AI_SKILL_MIN + 0.04,
          aiItemBonus: -2,
          aiActiveRatioBoost: -0.06,
          aiDebuffPassiveBias: 0.72,
        });
    }
  }

  return { ...NEUTRAL_BAND };
}

/** @deprecated 用 versusRubberBand(win, 0) */
export function streakPressure(streak: number): VersusRubberBand {
  return versusRubberBand(streak, 0);
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
/** 玩家有装备时，AI 至少携带玩家道具数的比例（向上取整，至少 1 件） */
export const AI_MIN_ITEM_RATIO = 0.6;

/** 按 aiSkill 与玩家装备数，决定 AI 本局应携带的道具数量（随机挑选，非复制玩家清单）。 */
export function aiItemTargetCount(
  playerCount: number,
  aiSkill: number,
  pick?: (n: number) => number,
  itemBonus = 0,
): number {
  if (playerCount <= 0) {
    // 空 loadout：0..CAP 随机，再叠 rubber-band itemBonus；不突破 CAP（避免 AI 比「玩家未装备」设计上限更满）
    const base = pick ? pick(EMPTY_PLAYER_ITEM_CAP + 1) : 0;
    return Math.max(0, Math.min(EMPTY_PLAYER_ITEM_CAP, base + itemBonus));
  }
  const minItems = Math.max(1, Math.ceil(playerCount * AI_MIN_ITEM_RATIO));
  const ratio = aiSkill / DEFAULT_AI_SKILL;
  let target = Math.round(playerCount * ratio);
  if (aiSkill >= DEFAULT_AI_SKILL) {
    target = Math.max(target, Math.round(playerCount * 0.7));
  } else {
    const t = (aiSkill - AI_SKILL_MIN) / (DEFAULT_AI_SKILL - AI_SKILL_MIN);
    target = Math.min(target, Math.round(playerCount * ratio * Math.max(0.35, t)));
  }
  if (aiSkill >= DEFAULT_AI_SKILL * 1.2) target = Math.min(playerCount + 2, target + 1);
  target += itemBonus;
  const maxTotal = MAX_EQUIPPED_ACTIVES + MAX_EQUIPPED_PASSIVES;
  return Math.max(minItems, Math.min(maxTotal, playerCount + 2, target));
}

function passiveWeight(id: string, aiSkill: number, debuffBias = 1): number {
  if (DEBUFF_PASSIVES.has(id)) {
    const base = aiSkill >= DEFAULT_AI_SKILL
      ? 1.4 + (aiSkill - DEFAULT_AI_SKILL) * 0.6
      : 0.55;
    return base * debuffBias;
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

export interface AiLoadoutRollOpts {
  itemBonus?: number;
  activeRatioBoost?: number;
  debuffPassiveBias?: number;
}

/** 开局为 AI 加权随机挑选主动/被动：强 AI 偏 debuff，弱 AI 偏经济。 */
export function rollAiLoadout(
  playerActives: readonly string[],
  playerPassives: readonly string[],
  aiSkill: number,
  pick: (n: number) => number,
  opts: AiLoadoutRollOpts = {},
): AiLoadoutRoll {
  const playerCount = playerActives.length + playerPassives.length;
  const target = aiItemTargetCount(playerCount, aiSkill, pick, opts.itemBonus ?? 0);
  if (target <= 0) return { actives: [], passives: [] };

  const activePool = enabledActives().map((a) => a.id);
  const passivePool = enabledPassives()
    .map((p) => p.id)
    .filter((id) => !AI_EXCLUDED_PASSIVES.has(id));

  const debuffBias = opts.debuffPassiveBias ?? 1;
  let activeRatio = playerCount > 0 ? playerActives.length / playerCount : 0.5;
  activeRatio = Math.max(0.15, Math.min(0.85, activeRatio + (opts.activeRatioBoost ?? 0)));
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
  // 补足总数时仍须遵守主动≤2 / 被动≤6（旧逻辑只 clamp 了 pool.length，会滚出 7 个被动）
  if (targetActives + targetPassives < target) {
    targetPassives = Math.min(
      MAX_EQUIPPED_PASSIVES,
      passivePool.length,
      target - targetActives,
    );
  }
  if (targetActives + targetPassives < target && activePool.length > targetActives) {
    targetActives = Math.min(activePool.length, MAX_EQUIPPED_ACTIVES, target - targetPassives);
  }

  const actives = weightedPickIds(activePool, targetActives, () => 1, pick);
  let passives = weightedPickIds(
    passivePool,
    targetPassives,
    (id) => passiveWeight(id, aiSkill, debuffBias),
    pick,
  );
  passives = ensureDebuffPassive(passives, passivePool, targetPassives, aiSkill, pick);

  return {
    actives: actives.slice(0, MAX_EQUIPPED_ACTIVES),
    passives: passives.slice(0, MAX_EQUIPPED_PASSIVES),
  };
}
