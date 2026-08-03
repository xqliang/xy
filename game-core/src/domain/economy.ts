import {
  INITIAL_PEACH, PEACH_PER_KILL, PEACH_PER_BLEED,
  MONSTER_BASE, PEACH_COST_BASE, PEACH_COST_STEP, REMAINING_INTERCEPT,
} from '../config/economy';

// 第 n 波怪物数 = 9 + n（wave1=10 … wave10=19）
export function monstersInWave(n: number): number {
  return MONSTER_BASE + n;
}

// 第 n 波掉落蟠桃 = 怪物数 × 每只桃（全部击杀）
export function dropInWave(n: number): number {
  return monstersInWave(n) * PEACH_PER_KILL;
}

// 第 n 波抽卡消耗蟠桃（原作「消耗」列，单调递增 +2/波）：wave1..6 = 10,12,14,16,18,20
export function costInWave(n: number): number {
  return PEACH_COST_BASE + PEACH_COST_STEP * n;
}

// 原作实测「剩余蟠桃」曲线（第5波转负）：remaining(n) = 11 − n(n+1)/2；remaining(0)=初始20。
// 注：原作「消耗」列与「剩余」列均为作者古法手记，二者不完全自洽。本内核将两条序列
// 各自忠实保留——costInWave 保「消耗」列（递增抽卡成本），remainingPeach 保「剩余」列
// （产耗结果曲线）。设计关键不变量：蟠桃在第 5 波转负 → 广告触发点自然浮现。
export function remainingPeach(n: number): number {
  if (n <= 0) return INITIAL_PEACH;
  return REMAINING_INTERCEPT - (n * (n + 1)) / 2;
}

// 蟠桃首次转负的波次（"第5波危机"）
export function firstDeficitWave(maxWave = 30): number {
  for (let w = 1; w <= maxWave; w++) {
    if (remainingPeach(w) < 0) return w;
  }
  return -1;
}

// 舍身饲魔：唐僧掉 dropsOfBlood 滴血换取的蟠桃
export function sellBloodReward(dropsOfBlood: number): number {
  return dropsOfBlood * PEACH_PER_BLEED;
}
