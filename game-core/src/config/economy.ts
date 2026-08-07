// 蟠桃经济常量（照搬《赵云与阿斗》馒头模型；精英/小Boss 数值按本局玩法微调）
export const INITIAL_PEACH = 20;      // 开局初始蟠桃
export const PEACH_PER_KILL = 1;      // 杀普通怪 1 桃/只
export const PEACH_PER_BLEED = 10;    // 唐僧掉血 10 桃/滴（舍身饲魔）
export const PEACH_PER_ELITE = 2;     // 击杀精英妖 2 桃
export const PEACH_PER_MINI_BOSS = 3; // 击杀小 Boss 3 桃
export const PEACH_PER_BOSS = 10;     // 击杀大 Boss 10 桃
export const TANGSENG_INITIAL_HP = 3; // 唐僧初始 3 滴血（道具可拉高）

// 第 n 波怪物数 = MONSTER_BASE + n
export const MONSTER_BASE = 9;
// 抽卡成本（原作「消耗」列，单调递增 +2/波）：cost(n) = PEACH_COST_BASE + PEACH_COST_STEP × n
export const PEACH_COST_BASE = 8;
export const PEACH_COST_STEP = 2;
// 原作「剩余」列曲线截距：remaining(n) = REMAINING_INTERCEPT − n(n+1)/2
export const REMAINING_INTERCEPT = 11;
