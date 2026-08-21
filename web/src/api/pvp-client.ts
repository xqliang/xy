// PvP 匹配/私房网络层：apiFetch 薄封装，X-Uid 由 apiFetch 自动带。
// tick 转发/心跳属对局阶段，放到 Plan C，本文件只覆盖匹配前的入队/轮询/取消/私房。
import { apiFetch, type ApiResult } from './client';
export type { ApiResult };

/** 对手展示档（uid 已脱敏） */
export interface OpponentProfile {
  uid: string;
  nickname: string | null;
  avatarId: string;
  rankLevel: number;
}
/** match-start 下发体（与服务端 _match_start_payload 对齐） */
export interface MatchStart {
  matchId: string;
  seed: number;
  map: string;
  startAtServerMs: number;
  opponent: OpponentProfile;
}
export interface EnqueueResp { ticket?: string; banned?: boolean; msg?: string }
export type PollResp =
  | { status: 'waiting' }
  | { status: 'timeout' }
  | { status: 'matched'; matchStart: MatchStart };
export interface RoomCreateResp { code?: string; link?: string; ticket?: string; map?: string; banned?: boolean; msg?: string }
export type RoomJoinResp =
  | { status: 'matched'; matchStart: MatchStart }
  | { error: string }
  | { banned: true; msg: string };

const J = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export function versusEnqueue(rank: number): Promise<ApiResult<EnqueueResp>> {
  return apiFetch<EnqueueResp>('/api/versus/enqueue', J({ rank }));
}
export function versusPoll(ticket: string): Promise<ApiResult<PollResp>> {
  return apiFetch<PollResp>('/api/versus/poll', J({ ticket }));
}
export function versusCancel(ticket: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>('/api/versus/cancel', J({ ticket }));
}
export function versusRoomCreate(rank: number): Promise<ApiResult<RoomCreateResp>> {
  return apiFetch<RoomCreateResp>('/api/versus/room/create', J({ rank }));
}
export function versusRoomJoin(code: string): Promise<ApiResult<RoomJoinResp>> {
  return apiFetch<RoomJoinResp>('/api/versus/room/join', J({ code }));
}

// —— 对局期 tick（Plan C）：每秒双向心跳 ——
// 上报本方放置动作/摘要，收对手动作 + 下一波 + 终局。
// 类型与 server/api_versus.py 的 tick()/_opp_status()/_result_for() 逐字段对齐。
/** 放置/操作动作（带 simTick=t），供对手回放 + 反作弊 */
export type PvpAction =
  | { t: number; op: 'summon'; tray?: string[] }
  | { t: number; op: 'place'; token: string; cell: string; index?: number }
  | { t: number; op: 'move'; from: string; to: string }
  | { t: number; op: 'merge'; from: number; to: number }
  | { t: number; op: 'recall'; from: string; slot: number }
  | { t: number; op: 'shovel'; cell: string }
  | { t: number; op: 'active'; id: string; cell?: string; slot?: number }
  | { t: number; op: 'autoplace'; cells: Array<{ token: string; cell: string }> }
  | { t: number; op: 'startWave' }
  | { t: number; op: 'claimDrop'; id: string };
/** 每秒摘要（digest）：服务端据此做反作弊启发式（唐僧血单调不增/击杀上界/波次不超前） */
export interface PvpDigest { wave: number; power: number; kills: number; tangsengHP: number; peach: number; units: number }
export interface TickRequest {
  matchId: string; clientMs: number; inputs: PvpAction[];
  digest: PvpDigest; waveClearedAt: { wave: number; t: number } | null;
  status: 'playing' | 'tangsengDead' | 'surrender';
}
export type PvpOutcome = 'win' | 'lose' | 'draw';
export interface TickResponse {
  serverMs: number; opponentInputs: PvpAction[]; opponentDigest: PvpDigest | null;
  nextWave: { wave: number; startAtServerMs: number } | null;
  // 与服务端 _opp_status() 完全一致：tangsengDead/surrender 派生自对手 status，
  // 心跳超宽限(6s)判为 disconnected，否则 playing。
  opponentStatus: 'playing' | 'disconnected' | 'surrendered' | 'tangsengDead';
  // 终局按 side 下发：outcome∈{win,lose,draw}，reason 为服务端 REASON 表里的契约串
  // （对手认输→opponentSurrender / 唐僧被吃→opponentTangsengDead / 断线超时→opponentDisconnectTimeout 等）
  result: null | { outcome: PvpOutcome; reason: string };
  cheatNotice: null | { banned: true; msg: string };
}
export function versusTick(req: TickRequest): Promise<ApiResult<TickResponse>> {
  return apiFetch<TickResponse>('/api/versus/tick', J(req));
}
