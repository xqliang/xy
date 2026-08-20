// 匹配状态机：帧驱动（pump）轮询 + 倒计时，依赖注入 net/now 便于单测；不直接用 Date.now/setInterval。
// 由游戏主循环每帧 pump(nowMs) 驱动：每 POLL_INTERVAL_MS 轮询一次，总时长到 MATCH_TIMEOUT_MS 判超时。
import type { ApiResult, EnqueueResp, PollResp, RoomCreateResp, RoomJoinResp, MatchStart } from './api/pvp-client';

export const MATCH_TIMEOUT_MS = 120_000; // 与服务端一致的 2 分钟总倒计时
export const POLL_INTERVAL_MS = 1_000;   // 轮询间隔（1s）

/** 状态机阶段：idle 空闲 / queuing 排队中 / inviting 建房邀请中 / matched 已匹配 / failed 失败 */
export type MatchPhase = 'idle' | 'queuing' | 'inviting' | 'matched' | 'failed';
/** 失败原因：timeout 超时 / banned 封禁 / error 其它错误 */
export type FailReason = 'timeout' | 'banned' | 'error';

/** 网络层依赖（对齐 pvp-client 的五个接口），便于测试时 mock。 */
export interface PvpMatchNet {
  enqueue(rank: number): Promise<ApiResult<EnqueueResp>>;
  poll(ticket: string): Promise<ApiResult<PollResp>>;
  cancel(ticket: string): Promise<ApiResult<{ ok: boolean }>>;
  roomCreate(rank: number): Promise<ApiResult<RoomCreateResp>>;
  roomJoin(code: string): Promise<ApiResult<RoomJoinResp>>;
}
/** 对外暴露的只读状态快照。 */
export interface PvpMatchState {
  phase: MatchPhase;
  startedAt: number;
  remainMs: number;
  ticket: string | null;
  code: string | null;
  link: string | null;
  opponent: MatchStart['opponent'] | null;
  message: string;
}
/** 控制器依赖注入：net 网络层、now 时间源、onMatched/onFailed 回调。 */
interface Deps {
  net: PvpMatchNet;
  now: () => number;
  onMatched: (ms: MatchStart) => void;
  onFailed: (reason: FailReason, msg?: string) => void;
}

export class PvpMatchController {
  state: PvpMatchState;
  private d: Deps;
  private lastPollAt = 0; // 上次发起轮询的时刻（防重复轮询）
  private polling = false; // 是否有一笔 poll 在飞（避免重叠）

  constructor(d: Deps) {
    this.d = d;
    // 初始 idle：剩余时间为满额倒计时，其余字段置空。
    this.state = { phase: 'idle', startedAt: 0, remainMs: MATCH_TIMEOUT_MS, ticket: null, code: null, link: null, opponent: null, message: '' };
  }

  /** 进入一个新的阶段：刷新阶段/起始时间/剩余时间，并重置轮询计时锚点。 */
  private begin(phase: MatchPhase): void {
    const t = this.d.now();
    this.state.phase = phase;
    this.state.startedAt = t;
    this.state.remainMs = MATCH_TIMEOUT_MS;
    this.lastPollAt = t;
  }

  /** 随机匹配：入队成功后进入 queuing，由主循环 pump 驱动轮询。 */
  async startRandom(rank: number): Promise<void> {
    this.begin('queuing');
    const r = await this.d.net.enqueue(rank);
    if (!r.ok) { this.fail('error', r.error); return; }
    if (r.data.banned) { this.fail('banned', r.data.msg); return; }
    this.state.ticket = r.data.ticket ?? null;
    if (!this.state.ticket) this.fail('error', '入队失败');
  }

  /** 建房邀请：建房成功后进入 inviting，分享 code/link，pump 驱动轮询对手加入。 */
  async startInvite(rank: number): Promise<void> {
    this.begin('inviting');
    const r = await this.d.net.roomCreate(rank);
    if (!r.ok) { this.fail('error', r.error); return; }
    if (r.data.banned) { this.fail('banned', r.data.msg); return; }
    this.state.ticket = r.data.ticket ?? null;
    this.state.code = r.data.code ?? null;
    this.state.link = r.data.link ?? null;
    if (!this.state.ticket || !this.state.code) this.fail('error', '建房失败');
  }

  /** 加入好友房间：roomJoin 同步返回 matched，否则报错。 */
  async joinCode(code: string): Promise<void> {
    this.begin('queuing');
    const r = await this.d.net.roomJoin(code);
    if (!r.ok) { this.fail('error', r.error); return; }
    if ('banned' in r.data && r.data.banned) { this.fail('banned', r.data.msg); return; }
    if ('status' in r.data && r.data.status === 'matched') { this.matched(r.data.matchStart); return; }
    this.fail('error', 'error' in r.data ? r.data.error : '房间不可用');
  }

  /** 每帧调用：驱动倒计时与轮询。仅在 queuing/inviting 阶段生效。 */
  pump(nowMs: number): void {
    const s = this.state;
    if (s.phase !== 'queuing' && s.phase !== 'inviting') return;
    // 刷新剩余时间；到点判超时并尝试取消。
    s.remainMs = Math.max(0, MATCH_TIMEOUT_MS - (nowMs - s.startedAt));
    if (s.remainMs <= 0) { this.fail('timeout'); void this.safeCancel(); return; }
    // 到了轮询间隔且没有重叠 poll 时发起一次轮询。
    if (this.state.ticket && !this.polling && nowMs - this.lastPollAt >= POLL_INTERVAL_MS) {
      this.lastPollAt = nowMs;
      this.polling = true;
      void this.d.net.poll(this.state.ticket).then((r) => {
        this.polling = false;
        // 轮询返回前阶段可能已变（取消/超时/已匹配），已离开匹配阶段则丢弃结果。
        if (this.state.phase !== 'queuing' && this.state.phase !== 'inviting') return;
        if (!r.ok) return;
        if (r.data.status === 'matched') this.matched(r.data.matchStart);
        else if (r.data.status === 'timeout') { this.fail('timeout'); }
      }).catch(() => { this.polling = false; });
    }
  }

  /** 主动取消匹配：尝试通知服务端取消，然后回 idle。 */
  async cancel(): Promise<void> {
    await this.safeCancel();
    this.state.phase = 'idle';
  }
  /** 尽力取消：有 ticket 就调 net.cancel，异常忽略（取消失败不影响前端回 idle）。 */
  private async safeCancel(): Promise<void> {
    const tk = this.state.ticket;
    if (tk) { try { await this.d.net.cancel(tk); } catch { /* 忽略 */ } }
  }
  /** 进入 matched：记录对手并触发回调。 */
  private matched(ms: MatchStart): void {
    this.state.phase = 'matched';
    this.state.opponent = ms.opponent;
    this.d.onMatched(ms);
  }
  /** 进入 failed：幂等（已 failed/matched 不再重复触发），记录消息并触发回调。 */
  private fail(reason: FailReason, msg?: string): void {
    if (this.state.phase === 'failed' || this.state.phase === 'matched') return;
    this.state.phase = 'failed';
    this.state.message = msg ?? '';
    // 回调只传 reason（msg 已存入 state.message）；与单测 toHaveBeenCalledWith(reason) 对齐。
    this.d.onFailed(reason);
  }
}
