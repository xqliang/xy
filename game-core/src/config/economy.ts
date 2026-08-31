// 蟠桃经济常量（照搬《赵云与阿斗》馒头模型；精英/小Boss/大Boss 按本局玩法）
// 使用可变对象，便于 DevTools 热调；下方兼容导出为初始快照（测试用）。

export const ECONOMY = {
  INITIAL_PEACH: 20, // 开局初始蟠桃
  PEACH_PER_KILL: 1, // 杀普通怪 1 桃/只
  PEACH_PER_BLEED: 10, // 唐僧掉血 10 桃/滴（舍身饲魔）
  PEACH_PER_ELITE: 4, // 击杀精英妖 4 桃
  PEACH_PER_MINI_BOSS: 6, // 击杀小 Boss 6 桃
  PEACH_PER_BOSS: 10, // 击杀大 Boss 10 桃
  TANGSENG_INITIAL_HP: 3, // 唐僧初始 3 滴血（道具可拉高）
  ENDLESS_TANGSENG_INITIAL_HP: 5, // 无尽模式唐僧默认血（更耐久，鼓励冲高波数）
  TANGSENG_MAX_HP: 9, // 唐僧血量上限（无论怎么加都不会超过 9 滴）
  MAX_PEACH: 200, // 蟠桃数量上限（防溢出）
  /** 第 n 波怪物数 = 10 + n - 1 */
  MONSTER_BASE: 9,
  /** 抽卡成本：cost(n) = PEACH_COST_BASE + PEACH_COST_STEP × n */
  PEACH_COST_BASE: 8,
  PEACH_COST_STEP: 2,
  /** 原作「剩余」列：remaining(n) = REMAINING_INTERCEPT − n(n+1)/2 */
  REMAINING_INTERCEPT: 11,
};

/** @deprecated 快照；运行时请读 ECONOMY.* */
export const INITIAL_PEACH = ECONOMY.INITIAL_PEACH;
export const PEACH_PER_KILL = ECONOMY.PEACH_PER_KILL;
export const PEACH_PER_BLEED = ECONOMY.PEACH_PER_BLEED;
export const PEACH_PER_ELITE = ECONOMY.PEACH_PER_ELITE;
export const PEACH_PER_MINI_BOSS = ECONOMY.PEACH_PER_MINI_BOSS;
export const PEACH_PER_BOSS = ECONOMY.PEACH_PER_BOSS;
export const TANGSENG_INITIAL_HP = ECONOMY.TANGSENG_INITIAL_HP;
export const ENDLESS_TANGSENG_INITIAL_HP = ECONOMY.ENDLESS_TANGSENG_INITIAL_HP;
export const TANGSENG_MAX_HP = ECONOMY.TANGSENG_MAX_HP;
export const MAX_PEACH = ECONOMY.MAX_PEACH;
export const MONSTER_BASE = ECONOMY.MONSTER_BASE;
export const PEACH_COST_BASE = ECONOMY.PEACH_COST_BASE;
export const PEACH_COST_STEP = ECONOMY.PEACH_COST_STEP;
export const REMAINING_INTERCEPT = ECONOMY.REMAINING_INTERCEPT;
