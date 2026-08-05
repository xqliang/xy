// 段位（军衔）星级系统：跨局 localStorage 持久化。
// 每个大段位含 STARS_PER_TIER 颗星：胜 +1 星，满星晋级下一档并清零；败 -1 星，零星再败降回上一档并回退到 (满-1) 星。
// 难度与星星解耦：仍按 胜×1.06 / 败×0.88 每局调节——长期均衡胜率约 70%（p·ln1.06 + (1-p)·ln0.88 ≈ 0 → p≈0.7），
// 且"打不过掉星/掉档后更弱"（1.06×0.88<1），降低卡级挫败——对应原作军衔非对称回调。
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

export function loadRank(): RankState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.level === 'number' && typeof s.difficulty === 'number') {
        // 兼容旧存档：缺 stars 时默认 0
        const stars = typeof s.stars === 'number' ? clampStars(s.stars) : 0;
        return { level: Math.max(0, s.level), stars, difficulty: s.difficulty };
      }
    }
  } catch {
    /* ignore */
  }
  return { level: 0, stars: 0, difficulty: 1 };
}

export function saveRank(s: RankState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function clampStars(n: number): number {
  return Math.max(0, Math.min(STARS_PER_TIER, Math.round(n)));
}

const bumpUp = (d: number) => Math.round(d * 1.06 * 1000) / 1000;
const bumpDown = (d: number) => Math.max(0.6, Math.round(d * 0.88 * 1000) / 1000);

export function recordWin(s: RankState): RankChange {
  const before = { level: s.level, stars: s.stars };
  const difficulty = bumpUp(s.difficulty);
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

export function recordLose(s: RankState): RankChange {
  const before = { level: s.level, stars: s.stars };
  const difficulty = bumpDown(s.difficulty);
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
