// web/src/pvp-ws.ts
// Plan C Task 3：PvP 对局期 WebSocket 连接层。
//
// 职责单一：建立 WS 连接、握手发 hello、按 type 分发下行消息到回调、提供上行发送（snap/waveCleared/status），
// 并在非手动断开时按指数退避自动重连。本类不碰确定性 sim——网络层允许用 Date.now()（见下方注释）。
//
// 上层接线见 main.ts（Task 5）：onOppSnap→对手插值视图 ingest、nextWave→开波排程、result→结算、oppGone→提示；
// 每 100ms 由主循环 sendSnap(battle.pvpOwnSnapshot())，清波下降沿 sendWaveCleared，终局 sendStatus。
//
// 依赖注入：wsFactory / scheduler 均可在单测替换（默认全局 WebSocket / setTimeout），
// 重连延时走注入的 scheduler，单测用可控假计时器逐帧推进，不用真实定时器抖动。


/** 下行消息 type 字面量（与 server/api_versus.py 推送、spec §3 对齐）。 */
type DownType = 'welcome' | 'oppSnap' | 'nextWave' | 'result' | 'oppGone';

/** result 回调入参：权威终局 outcome + reason。 */
export interface PvpResult {
  outcome: 'win' | 'lose' | 'draw';
  reason: string;
}

/** PvpSocket 配置：必填 matchId/uid + 五个下行回调 + 两个可注入依赖（单测用）。 */
export interface PvpSocketOpts {
  matchId: string;
  uid: string;
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
/** 指数退避初值（首次重连等 1s）。 */
const BACKOFF_BASE_MS = 1_000;
/** 指数退避上限（最长等 5s）。 */
const BACKOFF_CAP_MS = 5_000;
/** 默认重连调度器：真实 setTimeout（返回句柄，close 时可 clearTimeout 兜底）。 */
const defaultScheduler = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);

export class PvpSocket {
  readonly matchId: string;
  readonly uid: string;
  /** 当前连接状态（只读快照，上层可轮询）。 */
  state: PvpSocketState = 'closed';

  private readonly opts: PvpSocketOpts;
  private readonly factory: (url: string) => PvpWsLike;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly wsUrl: string;
  private sock: PvpWsLike | null = null;
  private closed = false; // 手动 close() 置真：之后永不重连、永不建新 socket
  private backoff = BACKOFF_BASE_MS; // 当前退避基数（成功 open 后重置为 BASE）
  private reconnectGen = 0; // 代数：每次调度/关闭递增，用于让挂起的过期计时器失效
  private timer: unknown = null; // 挂起的重连计时器句柄（真实 setTimeout 句柄；注入 scheduler 返回 void→undefined）

  constructor(opts: PvpSocketOpts) {
    this.opts = opts;
    this.matchId = opts.matchId;
    this.uid = opts.uid;
    this.factory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as PvpWsLike);
    this.schedule = opts.scheduler ?? defaultScheduler;
    this.wsUrl = buildWsUrl(opts.matchId, opts.uid);
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
    this.backoff = BACKOFF_BASE_MS; // 成功 open → 退避序列重置为 1s
    this.state = 'open';
    this.sendRaw({ type: 'hello', matchId: this.matchId, uid: this.uid });
  }

  /** 下行消息：JSON 解析（畸形忽略）、按 type 分发（未知忽略）。 */
  private handleMessage(data: string): void {
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
      default:
        break; // 未知 type：忽略
    }
  }

  /** 非手动断开：清 socket、按退避调度重连。手动关闭由 handleClose 前短路，永不进这里。 */
  private handleClose(): void {
    if (this.closed) return;
    this.sock = null;
    this.state = 'reconnecting';
    this.scheduleReconnect();
  }

  /** 指数退避重连：delay=min(当前退避, 上限)，随后退避翻倍封顶；用代数让过期计时器失效。 */
  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(this.backoff, BACKOFF_CAP_MS);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_CAP_MS);
    this.reconnectGen++;
    const gen = this.reconnectGen;
    this.timer = this.schedule(() => {
      // 过期（已手动关闭或已被新一轮调度取代）→ 忽略，不建新 socket。
      if (this.closed || gen !== this.reconnectGen) return;
      this.timer = null;
      this.connect();
    }, delay);
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

  /** 本方清波下降沿上报。 */
  sendWaveCleared(wave: number): boolean {
    return this.sendRaw({ type: 'waveCleared', wave });
  }

  /** 认输 / 唐僧死 状态上报。 */
  sendStatus(v: 'surrender' | 'tangsengDead'): boolean {
    return this.sendRaw({ type: 'status', v });
  }

  /** 手动关闭：置 closed、递增代数让挂起计时器过期、尽力 clearTimeout 兜底、关底层 socket。之后永不重连。 */
  close(): void {
    this.closed = true;
    this.reconnectGen++; // 让任何挂起的重连计时器失效
    if (this.timer !== null && this.timer !== undefined) {
      clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    }
    this.timer = null;
    this.state = 'closed';
    this.sock?.close();
    this.sock = null;
  }
}

/** 由 location 推导 WS URL：https→wss、http→ws；无 location（node 单测）回退 ws://localhost。 */
function buildWsUrl(matchId: string, uid: string): string {
  let scheme: string;
  let host: string;
  if (typeof location !== 'undefined' && location) {
    scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    host = location.host;
  } else {
    scheme = 'ws://';
    host = 'localhost';
  }
  return (
    scheme + host +
    '/api/versus/ws?matchId=' + encodeURIComponent(matchId) +
    '&uid=' + encodeURIComponent(uid)
  );
}
