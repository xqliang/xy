// PvP 匹配/私房网络层：apiFetch 薄封装，X-Uid 由 apiFetch 自动带。
// 对局期同步已迁至 WS 快照模型（web/src/pvp-ws.ts + pvp-snap.ts），本文件只覆盖匹配前的
// 入队/轮询/取消/私房。
import { apiFetch, type ApiResult } from './client';
export type { ApiResult };

/** 对手展示档（uid 已脱敏） */
export interface OpponentProfile {
  uid: string;
  nickname: string | null;
  avatarId: string;
  rankLevel: number;
}

/** match-start 下发体（与服务端 _match_start_payload 逐字段对齐）。
 *  注（Task 6 退役）：旧模型曾带 opponentLoadout（对方配装，供对手侧确定性重放）；
 *  WS 快照模型对手侧从快照本地插值重建，无消费方，已删除。 */
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

// —— 匹配前四个接口（对局期 tick 心跳/转发已在 Task 6 随 HTTP tick 退役，改走 WS 快照）——
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
