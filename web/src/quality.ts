// 画质档位：低端机自适应降载的「单一真源」。
//
// 背景：战斗屏每帧绘制量大（save/restore、fillText 飘字、drawImage、发光叠加），低端机会掉帧。
// 这里把「档位」从 render.ts 散落的 fxQuality 标量升级为一等概念，集中表达三档及各自的降载开关：
//   - high(1.0)：全开，现状行为
//   - mid(0.6)：减命中爆点、关发光叠加(lighter/shadowBlur)
//   - low(0.3)：再关毛玻璃/blur 滤镜
//
// 标量值直接喂给 render.setFxQuality()，让已有的 3 个粒子缩放点（灼烧火舌/火星/冰晶）零改动继续工作；
// 布尔降载开关供 render/main 读取，控制「不适合用标量表达」的开/关类降载（爆点、发光、blur）。
//
// 档位如何变化由两处驱动（都在 main.ts 帧循环）：
//   1. 开机 pickInitialTier()：按设备性能分级定初始档，差的机器开局即低档，不必等 EMA 爬到降档线。
//   2. 战斗中 updateQualityTier()：按平滑帧时(EMA)三档升降，迟滞防抖（升档阈值严于降档，避免临界抖动）。

/** 三档标量。high=现状满档；low 不低于 render.setFxQuality 的 clamp 下限 0.3。 */
export const QUALITY_TIERS = { high: 1, mid: 0.6, low: 0.3 } as const;
export type QualityTier = keyof typeof QUALITY_TIERS;

/** 档位 → 标量（喂 render.setFxQuality）。 */
export function qualityScalar(tier: QualityTier): number {
  return QUALITY_TIERS[tier];
}

// EMA 阈值（平滑帧时，单位 ms，参照 60fps 上限 12.7ms）：
// 降档：>26ms(≈<38fps) 认为过慢；恢复要更稳，升档阈值显著更严，制造迟滞带防抖。
const DOWN_MS = 26;   // high→mid、mid→low 的降档阈值
const UP_HIGH_MS = 17; // mid→high：帧时回落到多快才敢升回满档
const UP_MID_MS = 21;  // low→mid：帧时回落到多快才升回中档

/**
 * 据当前档位与平滑帧时(EMA)算下一档（纯函数，便于单测）。
 * 迟滞：降档用 DOWN_MS，升档用更严的 UP_*_MS，避免帧时在阈值附近来回跳档。
 */
export function updateQualityTier(prev: QualityTier, emaMs: number): QualityTier {
  if (prev === 'high') {
    return emaMs > DOWN_MS ? 'mid' : 'high';
  }
  if (prev === 'mid') {
    if (emaMs > DOWN_MS) return 'low';
    if (emaMs < UP_HIGH_MS) return 'high';
    return 'mid';
  }
  // prev === 'low'
  return emaMs < UP_MID_MS ? 'mid' : 'low';
}

// 设备分级阈值（微信 getSystemInfoSync().benchmarkLevel，数值越大越强）：
// 机型基准差异大，只做粗分。<10 视为弱机，10~22 中等，>22 强机；缺省回高档。
const LOW_BENCH = 10;
const HIGH_BENCH = 22;

/**
 * 开机据设备性能分级定初始档。
 * @param benchmarkLevel 微信 wx.getSystemInfoSync().benchmarkLevel；Web/取不到为 null。
 *                       null 一律回 high——浏览器多为开发/中高端，不误伤。
 */
export function pickInitialTier(benchmarkLevel: number | null): QualityTier {
  if (benchmarkLevel == null || !Number.isFinite(benchmarkLevel)) return 'high';
  if (benchmarkLevel < LOW_BENCH) return 'low';
  if (benchmarkLevel > HIGH_BENCH) return 'high';
  return 'mid';
}

/** 档位 → 渲染降载开关。高档全关（现状）；中/低档逐级开启。 */
export interface QualityFlags {
  basicReduce: boolean;  // 基础渲染降载总开关（true=非高档）：省地面阴影/睡眠Z等纯装饰层
  reduceBursts: boolean; // 命中/击杀爆点减量（渲染时跳帧绘制部分爆点）
  disableGlow: boolean;  // 关发光叠加（globalCompositeOperation='lighter'、shadowBlur 发光）
  disableBlur: boolean;  // 关毛玻璃/blur 滤镜（如无尽冰封磨砂）
}
export function qualityFlags(tier: QualityTier): QualityFlags {
  const reduced = tier !== 'high';
  switch (tier) {
    case 'low':
      return { basicReduce: reduced, reduceBursts: true, disableGlow: true, disableBlur: true };
    case 'mid':
      return { basicReduce: reduced, reduceBursts: true, disableGlow: true, disableBlur: false };
    case 'high':
    default:
      return { basicReduce: false, reduceBursts: false, disableGlow: false, disableBlur: false };
  }
}
