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

/**
 * 波起始纪元 → 本地 simTick（相对开局纪元，30Hz）。
 *
 * 服务端「先清者定波次」给每波一个绝对纪元 startAtServerMs（match 级共享，两端同值）。
 * 本机按 PVP_SIM_DT=1/30 固定步长推进，故 (波起始纪元 - 开局纪元) * 30 / 1000 即为该波应在哪一步开波。
 * 两端同 server 纪元 → 同 tick，与本地墙钟无关 → 两端在同一 tick 索引开波（rng 消费序一致，确定性开波基准）。
 * round 抗浮点累计误差。
 */
export function pvpWaveStartTick(waveStartAtServerMs: number, matchStartAtServerMs: number): number {
  return Math.round((waveStartAtServerMs - matchStartAtServerMs) * 30 / 1000);
}
