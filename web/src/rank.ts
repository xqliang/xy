// 境界（军衔）系统：跨局 localStorage 持久化。胜进败退，难度非对称调节。
// 难度按 胜×1.06 / 败×0.88 变化：长期均衡胜率约 70%（p·ln1.06 + (1-p)·ln0.88 ≈ 0 → p≈0.7），
// 且"打不过掉级后更弱"（1.06×0.88<1），降低卡级挫败——对应原作军衔非对称回调。
const KEY = 'dasheng.rank';

export interface RankState {
  level: number; // 境界等级（用于展示/排行榜）
  difficulty: number; // 怪物强度系数
}

const LADDER = ['凡人', '弼马温', '斗战小将', '天将', '广目天王', '托塔天王', '斗战胜佛', '齐天大圣'];

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
        return { level: s.level, difficulty: s.difficulty };
      }
    }
  } catch {
    /* ignore */
  }
  return { level: 0, difficulty: 1 };
}

export function saveRank(s: RankState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function recordWin(s: RankState): RankState {
  const next: RankState = { level: s.level + 1, difficulty: Math.round(s.difficulty * 1.06 * 1000) / 1000 };
  saveRank(next);
  return next;
}

export function recordLose(s: RankState): RankState {
  const next: RankState = {
    level: Math.max(0, s.level - 1),
    difficulty: Math.max(0.6, Math.round(s.difficulty * 0.88 * 1000) / 1000),
  };
  saveRank(next);
  return next;
}
