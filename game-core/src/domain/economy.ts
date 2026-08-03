import { INITIAL_PEACH, PEACH_PER_KILL, PEACH_PER_BLEED } from '../config/economy';

// 第 n 波怪物数 = 9 + n（wave1=10 … wave10=19）
export function monstersInWave(n: number): number {
  return 9 + n;
}

// 第 n 波掉落蟠桃 = 怪物数 × 每只桃（全部击杀）
export function dropInWave(n: number): number {
  return monstersInWave(n) * PEACH_PER_KILL;
}

// 原作实测「剩余蟠桃」曲线：剩余(n) = 11 − n(n+1)/2；剩余(0) = 初始 20。
// 逐项还原原文表格（wave1..6 = 10,8,5,1,-4,-10；wave10 = -44）。
function referenceRemaining(n: number): number {
  return n <= 0 ? INITIAL_PEACH : 11 - (n * (n + 1)) / 2;
}

// 第 n 波抽卡消耗蟠桃：由剩余曲线反推，使模拟循环严格复现原文表格。
// 注：原文「消耗」列为古法手记，与「剩余」列存在 ±1 噪声；此处以自洽的
// 「剩余」曲线为准。实际对局「递增抽卡成本」将在 M2 依此曲线调参。
export function costInWave(n: number): number {
  return dropInWave(n) - (referenceRemaining(n) - referenceRemaining(n - 1));
}

// 无额外系统介入时，第 n 波结束后的剩余蟠桃（模拟循环）
export function peachAfterWave(n: number): number {
  let peach = INITIAL_PEACH;
  for (let w = 1; w <= n; w++) {
    peach += dropInWave(w) - costInWave(w);
  }
  return peach;
}

// 蟠桃首次转负的波次（"第5波危机" → 广告触发点自然浮现）
export function firstDeficitWave(maxWave = 30): number {
  for (let w = 1; w <= maxWave; w++) {
    if (peachAfterWave(w) < 0) return w;
  }
  return -1;
}

// 舍身饲魔：唐僧掉 dropsOfBlood 滴血换取的蟠桃
export function sellBloodReward(dropsOfBlood: number): number {
  return dropsOfBlood * PEACH_PER_BLEED;
}
