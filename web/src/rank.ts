// 段位（军衔）星级系统：跨局持久化（storage 抽象层，Web=localStorage / 微信=wx storage）。
// 每个大段位含 STARS_PER_TIER 颗星：胜 +1 星，满星晋级下一档并清零；败 -1 星，零星再败降回上一档并回退到 (满-1) 星。
// 难度与星星解耦：仍按 胜×1.06 / 败×0.88 每局调节——长期均衡胜率约 70%（p·ln1.06 + (1-p)·ln0.88 ≈ 0 → p≈0.7），
// 且"打不过掉星/掉档后更弱"（1.06×0.88<1），降低卡级挫败——对应原作军衔非对称回调。
import { storeGet, storeSet, parseStoredJson, safeNumber } from './storage';
const KEY = 'dasheng.rank';

// 每个大段位的星数
export const STARS_PER_TIER = 5;

const LADDER = ['凡人', '弼马温', '斗战小将', '天将', '广目天王', '托塔天王', '斗战胜佛', '齐天大圣'];
// 大段位档数（最高档下标 = LADDER_LEN - 1）
export const LADDER_LEN = LADDER.length;

export interface RankState {
  level: number; // 大段位下标（0=凡人 … LADDER_LEN-1=齐天大圣）
  stars: number; // 当前档内星数（0..STARS_PER_TIER）
  difficulty: number; // 怪物强度系数
}

// 一次胜负结算产生的变化描述，供结算页决定动画方向。
export interface RankChange {
  state: RankState; // 结算后的状态
  before: { level: number; stars: number }; // 结算前
  won: boolean;
  promoted: boolean; // 是否晋级到更高档
  demoted: boolean; // 是否降档
  starDelta: -1 | 0 | 1; // 本次星星净变化（地板/封顶时为 0）
}

export function rankName(level: number): string {
  if (level < LADDER.length) return LADDER[level]!;
  return `齐天大圣 +${level - LADDER.length + 1}`;
}

function clampStars(n: number): number {
  return Math.max(0, Math.min(STARS_PER_TIER, Math.round(n)));
}

const DEFAULT_RANK: RankState = { level: 0, stars: 0, difficulty: 1 };

function normalizeRank(raw: unknown): RankState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.level !== 'number' && typeof s.difficulty !== 'number') return null;
  return {
    level: Math.max(0, Math.min(LADDER_LEN - 1, Math.floor(safeNumber(s.level, 0, 0)))),
    stars: clampStars(safeNumber(s.stars, 0)),
    difficulty: safeNumber(s.difficulty, 1, 0.6),
  };
}

export function loadRank(): RankState {
  return parseStoredJson(storeGet(KEY), normalizeRank, DEFAULT_RANK);
}

export function saveRank(s: RankState): void {
  try {
    storeSet(KEY, JSON.stringify(normalizeRank(s) ?? DEFAULT_RANK));
  } catch {
    /* ignore */
  }
}

const bumpUp = (d: number) => Math.round(d * 1.06 * 1000) / 1000;
const bumpDown = (d: number) => Math.max(0.6, Math.round(d * 0.88 * 1000) / 1000);

// 结算选项：freezeDifficulty=true 时只推进星级/段位、**不改单人 AI 难度系数**。
// PvP 结算用（PvP 胜负不应污染单人对战的难度自适应，见 pvp-settle.ts）；单人不传 → 行为不变。
export interface RankRecordOpts {
  freezeDifficulty?: boolean;
}

export function recordWin(s: RankState, opts?: RankRecordOpts): RankChange {
  const before = { level: s.level, stars: s.stars };
  const difficulty = opts?.freezeDifficulty ? s.difficulty : bumpUp(s.difficulty);
  const atTop = s.level >= LADDER_LEN - 1 && s.stars >= STARS_PER_TIER;
  let next: RankState;
  let promoted = false;
  let starDelta: -1 | 0 | 1 = 1;
  if (atTop) {
    // 最高档满星：星封顶，无加星动画
    next = { level: s.level, stars: STARS_PER_TIER, difficulty };
    starDelta = 0;
  } else if (s.stars + 1 >= STARS_PER_TIER) {
    // 满星晋级下一档，星清零
    next = { level: s.level + 1, stars: 0, difficulty };
    promoted = true;
  } else {
    next = { level: s.level, stars: s.stars + 1, difficulty };
  }
  saveRank(next);
  return { state: next, before, won: true, promoted, demoted: false, starDelta };
}

export function recordLose(s: RankState, opts?: RankRecordOpts): RankChange {
  const before = { level: s.level, stars: s.stars };
  const difficulty = opts?.freezeDifficulty ? s.difficulty : bumpDown(s.difficulty);
  const atFloor = s.level <= 0 && s.stars <= 0;
  let next: RankState;
  let demoted = false;
  let starDelta: -1 | 0 | 1 = -1;
  if (atFloor) {
    // 凡人 0 星：地板，无减星动画
    next = { level: 0, stars: 0, difficulty };
    starDelta = 0;
  } else if (s.stars - 1 < 0) {
    // 零星再败：降回上一档，回退到 (满-1) 星
    next = { level: s.level - 1, stars: STARS_PER_TIER - 1, difficulty };
    demoted = true;
  } else {
    next = { level: s.level, stars: s.stars - 1, difficulty };
  }
  saveRank(next);
  return { state: next, before, won: false, promoted: false, demoted, starDelta };
}
