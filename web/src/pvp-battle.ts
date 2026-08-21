// PvP 对局同步记账：simTick/延迟时钟、出/入站动作缓冲、tick 组装与分发。纯逻辑，时间走注入 now()。
import type { PvpAction, PvpDigest, TickRequest, TickResponse } from './api/pvp-client';
import { RETRANSMIT_WINDOW_MS } from './pvp-fixedstep';

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
  // 出站重传窗口：保留最近 RETRANSMIT_WINDOW_MS 内 record 过的动作，每 tick 整窗重发。
  // 为什么不清空：1s 轮询下若「上传」丢包，命令本就不在服务端；保留窗口让下个 tick 自动补发，
  // 覆盖「我上传丢了」。重发由服务端按 seq 去重，故重复下发幂等。
  private buffer: { at: number; action: PvpAction }[] = [];
  private seqCounter = 0; // 本方动作单调序号（网络去重用；record 时分配，仅增不减，与 order 一致）
  private inbound: PvpAction[] = []; // 对手动作，按 t 升序
  private seenOppSeqs = new Set<number>(); // 已收对手 seq（服务端重传窗口会重复下发，去重防重复施加）
  lastServerContactMs = 0;
  // 服务端权威信号（每 tick 更新，供渲染层纠正本地重放发散）：
  //   oppDigest = 对手自报摘要（含权威 tangsengHP，唐僧血单调不增）；oppStatus = 对手对局状态。
  // 用途见 reconcileOppAlive：防本地 oppBattle 因残余丢命令/RNG 边界误把对手唐僧打死→假「被吃」。
  oppDigest: PvpDigest | null = null;
  oppStatus: TickResponse['opponentStatus'] = 'playing';

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
   * 本方打点：把一条命令盖时间戳 t + 单调序号 seq 后入出站重传缓冲。
   * @param a 命令体（不含 t）
   * @param t 命令生效 tick。**由调用方显式传入 = 本方已完成的固定步数 localSimTick**（= 下一步要跑的 tick 索引），
   *   不再用墙钟 simTick()。原因：JS 单线程下事件处理器绝不打断 frame() 的同步 step 循环，玩家按键总是发生在
   *   两帧之间（= 上一步之后、下一步之前），故「即时施加」本就等价于「在下一步之前施加」；盖 localSimTick 后，
   *   本方「即时施加 + 盖 localSimTick」精确等价于对手「takeReady 在 step_localSimTick 之前施加」——保证跨机 rng
   *   消费相对 step 的顺序一致，避免逐 tick 发散（I1）。
   *   seq 亦在此分配（seqCounter++）：单调递增、与 record 调用顺序一致，供客户端/服务端双向按 seq 去重幂等
   *   施加——网络丢包重发时同一命令可能多次到达，去重保证 oppBattle 每条命令恰好施加一次（否则重复施加会
   *   让 rng 流分叉）。seq 是本机单调，无需与对手对齐。
   */
  record(a: Omit<PvpAction, 't'>, t: number): void {
    const action = { ...(a as object), t, seq: this.seqCounter++ } as PvpAction;
    this.buffer.push({ at: this.now(), action });
  }
  /** 取走并清空全部出站缓冲（测试/工具用；生产走 buildTick 的重传窗口，不调用本方法） */
  drainOutbound(): PvpAction[] { const o = this.buffer.map((x) => x.action); this.buffer = []; return o; }
  /**
   * 收入对手动作，按 t 稳定归并有序；按 seq 去重（服务端保留窗口会重复下发同一动作，防重复施加破坏确定性）。
   *   - a.seq != null：已收过的 seq 直接跳过（Set 判重，与到达顺序无关）；否则收下并记入 seenOppSeqs。
   *   - a.seq == null（旧客户端/旧单测）：不去重（向后兼容，退化=现网行为）。
   * 去重后再按 t 排序，保证 takeReady 按非递减 t 施加（rng 消费序一致）。只有真正新增才重排，省一次 sort。
   */
  ingestOpponent(actions: PvpAction[]): void {
    let added = false;
    for (const a of actions) {
      if (a.seq != null) {
        if (this.seenOppSeqs.has(a.seq)) continue; // 去重：已收过的重发跳过
        this.seenOppSeqs.add(a.seq);
      }
      this.inbound.push(a);
      added = true;
    }
    if (added) this.inbound.sort((x, y) => x.t - y.t);
  }
  /** 取出 t<=simTick 的对手动作（供应用器施加），从缓冲移除 */
  takeReady(simTick: number): PvpAction[] { const r: PvpAction[] = []; while (this.inbound.length && this.inbound[0]!.t <= simTick) r.push(this.inbound.shift()!); return r; }
  /**
   * 组装本次 tick 请求：**不清空出站**——整窗重发（冗余重传，覆盖「上传丢包」）。
   *   1s 轮询下 buffer 里每条动作会在连续 ~4 个 tick 被重发，服务端按 seq 去重幂等；只有超出
   *   RETRANSMIT_WINDOW_MS 的旧动作才剔除（防缓冲无限增长）。服务端补齐路径：下 tick 重发即补上丢失的。
   */
  buildTick(digest: PvpDigest, waveClearedAt: TickRequest['waveClearedAt'], status: TickRequest['status']): TickRequest {
    const now = this.now();
    this.buffer = this.buffer.filter((x) => now - x.at <= RETRANSMIT_WINDOW_MS); // 剔除过窗口的（防无限增长）
    return { matchId: this.matchId, clientMs: now, inputs: this.buffer.map((x) => x.action), digest, waveClearedAt, status };
  }
  /** 处理 tick 响应：收对手动作、存服务端权威 digest/status、记服务端联络时刻（时钟微调可后续加） */
  applyResponse(r: TickResponse): void {
    this.ingestOpponent(r.opponentInputs);
    this.oppDigest = r.opponentDigest;   // 存权威 digest（含真实 tangsengHP）
    this.oppStatus = r.opponentStatus;   // 存对手权威状态
    this.lastServerContactMs = this.now();
  }
}

/**
 * 用服务端权威信号纠正「对手半场」的唐僧存活显示，兜底本地 oppBattle 重放的发散假象
 *（残余丢命令/RNG 边界可能让本地重放误把对手唐僧打死）。返回 null 字段表示「无权威，保留本地重放值」。
 *   - opponentStatus==='tangsengDead'（对手自报唐僧被吃，服务端确认）→ 判死（血归零）。
 *   - 有 digest → 以权威 tangsengHP 为准（>0 存活；<=0 判死）。唐僧血单调不增，digest 虽略延迟仍是真相。
 *   - 尚无 digest（开局首 tick 前）→ 两字段返回 null，调用方保留桥接写入的本地重放值。
 * 注：对手的怪物/单位仍来自 oppBattle 忠实重放；此处只纠正决定性的「唐僧血/存活」这一权威状态，
 *     避免延迟/发散造成的假「被吃」直接呈现给用户（对手断线/认输也不在此判死，判负走服务端 result）。
 */
export function reconcileOppAlive(
  oppDigest: PvpDigest | null,
  oppStatus: TickResponse['opponentStatus'],
): { tangsengHP: number | null; defeated: boolean | null } {
  if (oppStatus === 'tangsengDead') return { tangsengHP: 0, defeated: true };
  if (oppDigest) return { tangsengHP: oppDigest.tangsengHP, defeated: oppDigest.tangsengHP <= 0 };
  return { tangsengHP: null, defeated: null };
}
