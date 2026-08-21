// PvP 对局同步记账：simTick/延迟时钟、出/入站动作缓冲、tick 组装与分发。纯逻辑，时间走注入 now()。
import type { PvpAction, PvpDigest, TickRequest, TickResponse } from './api/pvp-client';

const TICKS_PER_SEC = 30; // 本地权威 30Hz 半场（秒→tick 用整数乘法，避免 (1000/30) 浮点边界 floor 少 1）

export interface PvpSyncOpts {
  matchId: string; seed: number;
  startAtServerMs: number; serverOffsetMs: number; delayTicks: number;
  now: () => number; // 注入时钟（本地 ms）；勿在类内用 Date.now/performance.now
}

export class PvpSync {
  readonly matchId: string;
  readonly seed: number;
  private startAt: number;
  private offset: number;
  private delayTicks: number;
  private now: () => number;
  private outbound: PvpAction[] = [];
  private inbound: PvpAction[] = []; // 对手动作，按 t 升序
  lastServerContactMs = 0;

  constructor(o: PvpSyncOpts) {
    this.matchId = o.matchId; this.seed = o.seed;
    this.startAt = o.startAtServerMs; this.offset = o.serverOffsetMs;
    this.delayTicks = o.delayTicks; this.now = o.now;
  }
  private serverNow(): number { return this.now() + this.offset; }
  /** 本地权威半场当前 simTick（乘 TICKS_PER_SEC 取整，边界处精确为 30 而非浮点少 1） */
  simTick(): number { return Math.max(0, Math.floor((this.serverNow() - this.startAt) * TICKS_PER_SEC / 1000)); }
  /** 对手侧延迟重放 tick（落后 delayTicks）。
   *  注：对手侧延迟重放的实时钟现由 main.ts 的 `localSimTick - DELAY_TICKS` 累加器驱动（纪元 aiSimTick
   *  在未校准两端设备钟差时会误触，累加器更稳健）。本方法作为纪元时钟助手保留，留待 Task 9 服务端波次时间对齐。 */
  aiSimTick(): number { return Math.max(0, this.simTick() - this.delayTicks); }
  /**
   * 本方打点：把一条命令盖时间戳 t 后入出站缓冲。
   * @param a 命令体（不含 t）
   * @param t 命令生效 tick。**由调用方显式传入 = 本方已完成的固定步数 localSimTick**（= 下一步要跑的 tick 索引），
   *   不再用墙钟 simTick()。原因：JS 单线程下事件处理器绝不打断 frame() 的同步 step 循环，玩家按键总是发生在
   *   两帧之间（= 上一步之后、下一步之前），故「即时施加」本就等价于「在下一步之前施加」；盖 localSimTick 后，
   *   本方「即时施加 + 盖 localSimTick」精确等价于对手「takeReady 在 step_localSimTick 之前施加」——保证跨机 rng
   *   消费相对 step 的顺序一致，避免逐 tick 发散（I1）。
   */
  record(a: Omit<PvpAction, 't'>, t: number): void { this.outbound.push({ ...(a as object), t } as PvpAction); }
  /** 取走并清空出站缓冲（组 tick 用） */
  drainOutbound(): PvpAction[] { const o = this.outbound; this.outbound = []; return o; }
  /** 收入对手动作，按 t 稳定归并有序 */
  ingestOpponent(actions: PvpAction[]): void { this.inbound.push(...actions); this.inbound.sort((x, y) => x.t - y.t); }
  /** 取出 t<=simTick 的对手动作（供应用器施加），从缓冲移除 */
  takeReady(simTick: number): PvpAction[] { const r: PvpAction[] = []; while (this.inbound.length && this.inbound[0]!.t <= simTick) r.push(this.inbound.shift()!); return r; }
  /** 组装本次 tick 请求（清空出站） */
  buildTick(digest: PvpDigest, waveClearedAt: TickRequest['waveClearedAt'], status: TickRequest['status']): TickRequest {
    return { matchId: this.matchId, clientMs: this.now(), inputs: this.drainOutbound(), digest, waveClearedAt, status };
  }
  /** 处理 tick 响应：收对手动作、记服务端联络时刻（时钟微调可后续加） */
  applyResponse(r: TickResponse): void { this.ingestOpponent(r.opponentInputs); this.lastServerContactMs = this.now(); }
}
