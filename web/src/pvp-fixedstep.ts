// PvP 固定步长：把可变 dt 累计后按 fixed 切片。PVP_SIM_DT/DELAY_TICKS 供主循环与对手侧延迟重放用。
export const PVP_SIM_DT = 1 / 30;      // PvP 物理固定子步（30Hz），与 versus-user-agent 一致
export const DELAY_TICKS = 15;         // 对手侧延迟重放 tick 数（0.5s @30Hz），覆盖网络抖动
/** 累加器：a=acc+dt，按 fixed 切出整步数与余量；maxSteps 防卡顿后一次跑太多帧（雪崩时丢弃积压）。 */
export function drainFixedSteps(acc: number, dt: number, fixed: number, maxSteps: number): { steps: number; rest: number } {
  let a = acc + dt; let steps = 0;
  while (a >= fixed && steps < maxSteps) { a -= fixed; steps++; }
  if (steps >= maxSteps) a = 0; // 雪崩：丢弃积压，避免螺旋
  return { steps, rest: a };
}
