// 首次引导「拖拽演示动画」的纯逻辑层（渲染在 render.ts、接线在 main.ts）。
//
// 背景：首局布阵（guidePhase 'deploy'）与首次主动技能就绪时，箭头引导对「拖放/施放」
// 这种手势操作的传达力不够——用户需求：画一个手型按住→拖到目标→放下的循环演示；
// 主动技能按作用目标（兵器/怪物/地图格）用不同的虚线高亮示意。
//
// 本模块只做三件可单测的事：
//   1. guideDemoPhase——循环时间相位机（起点按下→移动→终点按下→停顿→淡出→间歇）；
//   2. pickDemoDeployCell——布阵演示的推荐空格（贴路径优先、过滤已占）；
//   3. guideSkillTargetKind / instantSkillRadiusCells——主动技能的目标类型与即时技范围。
import { isPillActiveEffect, isBombActiveEffect, type ActiveEffect } from './actives';
import type { Cell } from './board';

// —— 1) 循环时间相位机 —— //

/** 演示一个循环的时长（秒）：拿起→拖动→放下→停顿反馈→淡出→间歇。 */
export const GUIDE_DEMO_PERIOD_S = 3.2;

export interface GuideDemoPhaseSpan {
  phase: 'pressFrom' | 'move' | 'pressTo' | 'hold' | 'fade' | 'rest';
  t0: number; // 相位起点（秒，周期内）
  t1: number; // 相位终点（不含）
}

/** 相位表（拼满整个周期，时间轴单调）。渲染层按 phase 决定画什么（手型姿态/ghost 跟随/虚线脉冲）。 */
export const GUIDE_DEMO_PHASES: GuideDemoPhaseSpan[] = [
  { phase: 'pressFrom', t0: 0.0, t1: 0.35 }, // 起点按下（涟漪 + token 微亮）
  { phase: 'move', t0: 0.35, t1: 1.5 },      // 沿弧线移动（ghost 跟手、轨迹虚线渐显）
  { phase: 'pressTo', t0: 1.5, t1: 1.8 },    // 终点按下（目标虚线高亮脉冲）
  { phase: 'hold', t0: 1.8, t1: 2.4 },       // 停顿（目标高亮闪两下，给玩家看清落点）
  { phase: 'fade', t0: 2.4, t1: 2.7 },       // 手型/ghost 淡出
  { phase: 'rest', t0: 2.7, t1: GUIDE_DEMO_PERIOD_S }, // 间歇 → 下一轮
];

export interface GuideDemoInput {
  t: number; // 当前时刻（秒；任意值，内部取模）
}

export interface GuideDemoState {
  phase: GuideDemoPhaseSpan['phase'];
  tInPhase: number; // 相位内进度（秒）
  /** 相位归一进度 0→1（move 相位为 easeInOut 曲线值——中段快两端慢，符合手指拖动节奏）。 */
  k: number;
  /** 整体可见度：可见相位 1，fade 相位 1→0，rest 0。 */
  alpha: number;
  /** move 相位的直线进度（0→1 未缓动），供渲染层算弧线插值/轨迹虚线露出长度。 */
  rawK: number;
}

const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** 推进演示相位机（纯函数）：t 取模周期后落进相位表，产出渲染所需的全部派生量。 */
export function guideDemoPhase(input: GuideDemoInput): GuideDemoState {
  const tm = ((input.t % GUIDE_DEMO_PERIOD_S) + GUIDE_DEMO_PERIOD_S) % GUIDE_DEMO_PERIOD_S; // 负 t 容错
  const span = GUIDE_DEMO_PHASES.find((p) => tm >= p.t0 && tm < p.t1)
    ?? GUIDE_DEMO_PHASES[GUIDE_DEMO_PHASES.length - 1]!; // 周期边界兜底（t 恰等于周期时取模已归零，理论上不可达）
  const rawK = (tm - span.t0) / (span.t1 - span.t0);
  const alpha = span.phase === 'fade' ? 1 - rawK : span.phase === 'rest' ? 0 : 1;
  return {
    phase: span.phase,
    tInPhase: tm - span.t0,
    k: span.phase === 'move' ? easeInOut(rawK) : rawK,
    alpha,
    rawK,
  };
}

// —— 2) 布阵演示的推荐空格 —— //

/**
 * 从「贴路径优先的可放格序」里挑第一个空格作演示落点（纯函数，输入由调用方从 battle 派生）。
 * 视觉演示不需要最优解——「看起来是块好地」（贴近怪路径的空格）即可。
 * @param proxCells placeableByProximity 的产物（贴路径由近及远）
 * @param occupied  已占格集合（"c,r" 键：单位/武将字/桃树等）
 */
export function pickDemoDeployCell(proxCells: readonly Cell[], occupied: ReadonlySet<string>): Cell | null {
  for (const c of proxCells) {
    if (!occupied.has(`${c.c},${c.r}`)) return c;
  }
  return null;
}

// —— 3) 主动技能演示的目标类型 —— //

/** 演示目标类型：拖到兵器/武将（仙丹·风火轮）、拖到路径格（轰天雷）、点按即放（其余即时技）。 */
export type GuideSkillTargetKind = 'unit' | 'cell' | 'instant';

export function guideSkillTargetKind(effect: ActiveEffect | string): GuideSkillTargetKind {
  if (isPillActiveEffect(effect as ActiveEffect)) return 'unit';
  if (isBombActiveEffect(effect as ActiveEffect)) return 'cell';
  return 'instant';
}

/** 即时技演示的作用范围（格半径，画虚线圈示意；0=全场/无需画圈，演示点按即可）。 */
export function instantSkillRadiusCells(effect: ActiveEffect | string): number {
  switch (effect) {
    case 'meteor': return 2;   // 天降陨石：对最前怪群半径 2
    case 'jinggu': return 2.5; // 紧箍咒：以最前怪为中心半径 2.5
    default: return 0;         // 如来神掌/冰封等全场或无需落点圈
  }
}
