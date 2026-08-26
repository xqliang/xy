// web/src/pvp-ws.ts
// Plan C Task 3：PvP 对局期 WebSocket 连接层。
//
// 职责单一：建立 WS 连接、握手发 hello、按 type 分发下行消息到回调、提供上行发送（snap/waveCleared/status），
// 并在非手动断开时自动重连（弱网优化③：首试 300ms 快试 + 1s→5s 指数退避，另供 reconnectNow 供
// 网络恢复/回前台立即重连）。弱网优化②：waveCleared/status 断线期间入队、重连后紧跟 hello 补发。
// 本类不碰确定性 sim——网络层允许用 Date.now()（见下方注释）。
//
// 上层接线见 main.ts（Task 5）：onOppSnap→对手插值视图 ingest、nextWave→开波排程、result→结算、oppGone→提示；
// 每 100ms 由主循环 sendSnap(battle.pvpOwnSnapshot(nowMs, pvpSock.rttMs))——rtt 随快照透传给对手供其 HUD 显示；
// 清波下降沿 sendWaveCleared，终局 sendStatus。
//
// 依赖注入：wsFactory / scheduler 均可在单测替换（默认全局 WebSocket / setTimeout），
// 重连延时走注入的 scheduler，单测用可控假计时器逐帧推进，不用真实定时器抖动。


/** 下行消息 type 字面量（与 server/api_versus.py 推送、spec §3 对齐）。 */
type DownType = 'welcome' | 'oppSnap' | 'nextWave' | 'result' | 'oppGone' | 'pong';

/** result 回调入参：权威终局 outcome + reason。 */
export interface PvpResult {
  outcome: 'win' | 'lose' | 'draw';
  reason: string;
}

/** PvpSocket 配置：必填 matchId/uid + 五个下行回调 + 两个可注入依赖（单测用）。 */
export interface PvpSocketOpts {
  matchId: string;
  uid: string;
  // 会话令牌（可选）：登录后由上层（Task 12 的 main.ts）传入，追加到 WS URL 供服务端校验身份。
  token?: string;
  onWelcome?: (serverMs: number) => void;
  onOppSnap?: (s: unknown) => void;
  onNextWave?: (wave: number, startAtServerMs: number) => void;
  onResult?: (r: PvpResult) => void;
  onOppGone?: () => void;
  // 注入 WebSocket 构造器（单测传 FakeWebSocket）；不传则用全局 WebSocket。
  wsFactory?: (url: string) => PvpWsLike;
  // 注入重连延时调度器（单测传可控假计时器）；不传则用全局 setTimeout。
  scheduler?: (fn: () => void, ms: number) => unknown;
}

/** 连接状态：closed 未连/已手动关 / connecting 首连中 / open 已开 / reconnecting 退避等重连。 */
export type PvpSocketState = 'closed' | 'connecting' | 'open' | 'reconnecting';

/** 最小 WebSocket 表面（readyState/send/close + 三个事件属性），真实 WebSocket 与 FakeWebSocket 均满足。 */
interface PvpWsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
}

/** readyState=OPEN 的字面值（浏览器 WebSocket.OPEN===1；FakeWebSocket 同）。避免引用全局 WebSocket（node 无）。 */
const WS_OPEN = 1;
/** 首次重连快试延时（弱网优化③：切基站/瞬断多为秒级可恢复，首试等太久白白加延迟）。 */
const FIRST_RETRY_MS = 300;
/** 指数退避初值（首试失败后从 1s 起步）。 */
const BACKOFF_BASE_MS = 1_000;
/** 指数退避上限（最长等 5s）。 */
const BACKOFF_CAP_MS = 5_000;
/** 应用层心跳间隔（open 态每 2s 发一次 ping，算 RTT 用）。 */
const PING_INTERVAL_MS = 2_000;
/** RTT 指数移动平均系数 α=0.25（越小越平滑，越大越跟手）。 */
const RTT_EWMA_ALPHA = 0.25;
/** 补发队列封顶：超出门槛丢最旧。正常一局事件远少于 16 条，封顶只防极端场景无界增长。 */
const PENDING_MAX = 16;
/** 默认重连调度器：真实 setTimeout（返回句柄，close 时可 clearTimeout 兜底）。 */
const defaultScheduler = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);

export class PvpSocket {
  readonly matchId: string;
  readonly uid: string;
  /** 会话令牌（可选）：构造时随 URL 烘焙进 wsUrl，重连复用同一 URL。 */
  readonly token?: string;
  /** 当前连接状态（只读快照，上层可轮询）。 */
  state: PvpSocketState = 'closed';
  /** 应用层 RTT（ms，EWMA α=0.25）：首个 pong 前为 null，供顶部延迟 HUD 显示。 */
  rttMs: number | null = null;
  /** 当前重连尝试次数（0=未在重连或已 open；≥1=第 N 次重连中）。供 UI 显示"正在重连(第 N 次)"。 */
  get reconnectAttempt(): number { return this.retryCount; }
  /** 最近一次收到任意下行消息的墙钟 ms（Date.now()）：供断线看门狗判定「>10s 无入站」。 */
  lastInboundAt = 0;

  private readonly opts: PvpSocketOpts;
  private readonly factory: (url: string) => PvpWsLike;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly wsUrl: string;
  private sock: PvpWsLike | null = null;
  /** 断线期间积压的事件类上行（waveCleared/status 信封）。弱网优化②：
   *  清波下降沿与终局是「事件」而非「状态」，断线窗口跨过它们时静默丢弃会让服务端判定
   *  错误，故入队、重连 open 后紧跟 hello 补发。snap 不入队——状态量由新快照自然覆盖。 */
  private pending: Array<Record<string, unknown>> = [];
  private closed = false; // 手动 close() 置真：之后永不重连、永不建新 socket
  /** 重连失败计数（成功 open 后清零）：0 → 首试 300ms 快试；n → min(1s·2^(n-1), 5s)。 */
  private retryCount = 0;
  private reconnectGen = 0; // 代数：每次调度/关闭递增，用于让挂起的过期计时器失效
  private timer: unknown = null; // 挂起的重连计时器句柄（真实 setTimeout 句柄；注入 scheduler 返回 void→undefined）
  private pingGen = 0; // 心跳代数：close/重调度时递增，让挂起的过期 ping 计时器失效
  private pingTimer: unknown = null; // 挂起的 ping 计时器句柄（close 时 clearTimeout 兜底）

  constructor(opts: PvpSocketOpts) {
    this.opts = opts;
    this.matchId = opts.matchId;
    this.uid = opts.uid;
    this.token = opts.token;
    this.factory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as PvpWsLike);
    this.schedule = opts.scheduler ?? defaultScheduler;
    this.wsUrl = buildWsUrl(this.matchId, this.uid, this.token);
  }

  /** 建立连接：创建 socket、绑定三事件。幂等保护——已手动关闭则不再连。 */
  connect(): void {
    if (this.closed) return;
    this.state = 'connecting';
    const sock = this.factory(this.wsUrl);
    this.sock = sock;
    sock.onopen = () => this.handleOpen();
    sock.onmessage = (e) => this.handleMessage(e.data);
    sock.onclose = () => this.handleClose();
  }

  /** open：握手成功，退避重置、发 hello，状态置 open。 */
  private handleOpen(): void {
    if (this.closed) return; // 握手完成前已被手动关：丢弃，不 hello、不标 open
    this.retryCount = 0; // 成功 open → 重连序列重置（下次断线再从 300ms 快试起）
    this.state = 'open';
    this.lastInboundAt = Date.now(); // 连上即视为刚收到（避免刚 open 就被看门狗误判）
    this.sendRaw({ type: 'hello', matchId: this.matchId, uid: this.uid });
    this.flushPending(); // 补发断线期间积压的事件（hello 必须先行——服务端在 hello 前忽略一切消息）
    this.schedulePing(); // 启动应用层心跳（每 2s 一次，算 RTT）
  }

  /** 补发积压事件：按序发送，成功一条出队一条；发不出去（理论不会——刚 open）则留待下次。 */
  private flushPending(): void {
    while (this.pending.length > 0) {
      if (!this.sendRaw(this.pending[0]!)) break;
      this.pending.shift();
    }
  }

  /** 调度一次 ping：代数 +1 防过期；open 态每 PING_INTERVAL_MS 发一次应用层 ping。 */
  private schedulePing(): void {
    if (this.closed) return;
    this.pingGen++;
    const gen = this.pingGen;
    this.pingTimer = this.schedule(() => {
      // 过期（已手动关闭或已被新一轮调度取代）→ 忽略，不误发。
      if (this.closed || gen !== this.pingGen) return;
      if (this.state === 'open') this.sendPing(); // 仅 open 态真发（中间态不发）
      this.pingTimer = null;
      if (!this.closed) this.schedulePing(); // 链式排下一个（close 后 pingGen 已变，新调度立即失效）
    }, PING_INTERVAL_MS);
  }

  /** 发一次应用层 ping：带客户端墙钟 t，服务端原样回 pong → 客户端算 RTT。 */
  private sendPing(): void {
    this.sendRaw({ type: 'ping', t: Date.now() });
  }

  /** 下行消息：JSON 解析（畸形忽略）、按 type 分发（未知忽略）。 */
  private handleMessage(data: string): void {
    // 任意入站字节都视为连接存活：刷新看门狗时间戳（畸形帧也算有流量，不误判断线）。
    this.lastInboundAt = Date.now();
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // 畸形帧：静默忽略，不抛出
    }
    if (msg === null || typeof msg !== 'object') return;
    const type = (msg as { type?: unknown }).type;
    switch (type as DownType) {
      case 'welcome':
        this.opts.onWelcome?.((msg as { serverMs: number }).serverMs);
        break;
      case 'oppSnap':
        this.opts.onOppSnap?.((msg as { s: unknown }).s);
        break;
      case 'nextWave':
        this.opts.onNextWave?.(
          (msg as { wave: number }).wave,
          (msg as { startAtServerMs: number }).startAtServerMs,
        );
        break;
      case 'result': {
        const rm = msg as { outcome: PvpResult['outcome']; reason: string };
        this.opts.onResult?.({ outcome: rm.outcome, reason: rm.reason ?? '' });
        break;
      }      case 'oppGone':
        this.opts.onOppGone?.();
        break;
      case 'pong': {
        // 心跳回响：服务端原样回 t=发 ping 时的客户端墙钟 → RTT = 收 pong 时刻 − t。
        const t = (msg as { t?: unknown }).t;
        if (typeof t === 'number') {
          const rtt = Date.now() - t;
          if (rtt >= 0) {
            // EWMA：首个样本直接取值，之后 α 加权平滑（抑制抖动，仍跟手）。
            this.rttMs = this.rttMs === null ? rtt : this.rttMs + RTT_EWMA_ALPHA * (rtt - this.rttMs);
          }
        }
        break;
      }
      default:
        break; // 未知 type：忽略
    }
  }

  /** 非手动断开：清 socket、清心跳计时器、按退避调度重连。手动关闭由 handleClose 前短路，永不进这里。 */
  private handleClose(): void {
    if (this.closed) return;
    this.clearPingTimer(); // 连接断了：停心跳、清过期 ping 计时器（重连 open 后会重排）
    this.rttMs = null; // 旧连接的 RTT 失效：下次首 pong 前一直显示 --
    this.sock = null;
    this.state = 'reconnecting';
    this.scheduleReconnect();
  }

  /** 清掉挂起的 ping 计时器（代数 +1 让过期回调空转 + clearTimeout 兜底）。 */
  private clearPingTimer(): void {
    this.pingGen++; // 让任何挂起的过期 ping 计时器空转
    if (this.pingTimer !== null && this.pingTimer !== undefined) {
      clearTimeout(this.pingTimer as ReturnType<typeof setTimeout>);
    }
    this.pingTimer = null;
  }

  /** 重连退避：首试 300ms 快试，之后 1s→2s→4s→封顶 5s；用代数让过期计时器失效。 */
  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.retryCount === 0
      ? FIRST_RETRY_MS
      : Math.min(BACKOFF_BASE_MS * 2 ** (this.retryCount - 1), BACKOFF_CAP_MS);
    this.retryCount++;
    this.reconnectGen++;
    const gen = this.reconnectGen;
    this.timer = this.schedule(() => {
      // 过期（已手动关闭或已被新一轮调度取代）→ 忽略，不建新 socket。
      if (this.closed || gen !== this.reconnectGen) return;
      this.timer = null;
      this.connect();
    }, delay);
  }

  /** 立即重连：跳过挂起的退避等待（仅 reconnecting 态生效）。供 online 事件 / 回前台 /
   *  wx.onAppShow 主动触发——切后台被杀的 socket 不必干等退避计时器。其余态空转：
   *  open=连接活着别折腾、connecting=已在连、closed=手动关永不复活。 */
  reconnectNow(): void {
    if (this.closed || this.state !== 'reconnecting') return;
    this.reconnectGen++; // 让挂起的退避计时器过期（到点空转）
    if (this.timer !== null && this.timer !== undefined) {
      clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    }
    this.timer = null;
    this.connect();
  }

  /** 上行发送通用门：仅 OPEN 态真正发出，否则静默丢弃返回 false。 */
  private sendRaw(obj: unknown): boolean {
    if (!this.sock || this.sock.readyState !== WS_OPEN) return false;
    this.sock.send(JSON.stringify(obj));
    return true;
  }

  /** 本方半场快照（每 100ms 由主循环调用）。网络层允许 Date.now()——确定性红线只约束 sim。 */
  sendSnap(s: unknown): boolean {
    return this.sendRaw({ type: 'snap', t: Date.now(), s });
  }

  /** 本方清波下降沿上报。事件类上行：未 open 时入队、重连后补发（见 pending 注释）。 */
  sendWaveCleared(wave: number): boolean {
    return this.sendOrQueue({ type: 'waveCleared', wave });
  }

  /** 认输 / 唐僧死 状态上报。事件类上行：未 open 时入队、重连后补发（见 pending 注释）。 */
  sendStatus(v: 'surrender' | 'tangsengDead'): boolean {
    return this.sendOrQueue({ type: 'status', v });
  }

  /** 事件类上行通用门：open 态立即发出；否则入队（封顶丢最旧）等重连补发。手动关闭后一律丢弃。 */
  private sendOrQueue(env: Record<string, unknown>): boolean {
    if (this.closed) return false;
    const sent = this.sendRaw(env);
    if (!sent) {
      this.pending.push(env);
      if (this.pending.length > PENDING_MAX) this.pending.shift();
    }
    return sent;
  }

  /** 手动关闭：置 closed、清队列与挂起计时器、关底层 socket。之后永不重连、入队一律丢弃。 */
  close(): void {
    this.closed = true;
    this.pending = [];
    this.reconnectGen++; // 让任何挂起的重连计时器失效
    this.clearPingTimer(); // 让任何挂起的心跳计时器过期（onclose→handleClose 因 closed 早退，这里兜底清）
    if (this.timer !== null && this.timer !== undefined) {
      clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    }
    this.timer = null;
    this.state = 'closed';
    this.sock?.close();
    this.sock = null;
  }
}

/** 由 location 推导 WS URL：https→wss、http→ws；无 location（node 单测）回退 ws://localhost；有 token 追加 &token=。 */
export function buildWsUrl(matchId: string, uid: string, token?: string): string {
  let scheme: string;
  let host: string;
  if (typeof location !== 'undefined' && location) {
    scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    host = location.host;
  } else {
    scheme = 'ws://';
    host = 'localhost';
  }
  let url =
    scheme + host +
    '/api/versus/ws?matchId=' + encodeURIComponent(matchId) +
    '&uid=' + encodeURIComponent(uid);
  if (token) url += '&token=' + encodeURIComponent(token);
  return url;
}
