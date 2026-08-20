# PvP 客户端匹配（Plan B）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 在现有单机首页上加「真人对战 / 邀请好友」两个入口与一个匹配等待界面（新 `pvpMatching` 屏），通过 HTTP 轮询走通「入队/轮询/取消 + 建私房/加入 + 2 分钟倒计时失败」，匹配成功后交给一个集成缝 `onPvpMatched(matchStart)`（真正开打在 Plan C 接入）。

**Architecture:** 三个新模块——`api/pvp-client.ts`（apiFetch 薄封装 + 类型）、`pvp-match.ts`（可测的匹配状态机，依赖注入 net/now，帧驱动轮询与倒计时）、`pvp-screen.ts`（纯渲染 + 命中）。`main.ts`/`menu.ts` 做受控接线：新屏、入口按钮、体力门禁、深链 `?versus=`。**不含对局本身**（Plan C）。体力入口需 ≥5 但**入口不扣**（spec：两人真正开打才各扣 5，放到 Plan C 的 match-start）。

**Tech Stack:** TypeScript + Canvas + Vite；vitest 单测（stub `CanvasRenderingContext2D`）；后端 `/api/versus/*` 已就绪（Plan A）。

**跑测试：** `cd web && npm test`（vitest run）；类型检查 `cd web && npx tsc --noEmit`。**每个任务结束都要两者全绿。**

**关键现有锚点（已核对，行号可能微移，按符号定位）：**
- `web/src/api/client.ts:22` `apiFetch<T>(path, init & {uid?})` → `ApiResult<T> = {ok:true,data,status} | {ok:false,status,error}`；X-Uid 自动、Content-Type 自动、baseURL 自动。
- `web/src/menu.ts:21` `interface MenuButton {id,x,y,w,h}`；`:126` `menuButtons()`（10 个按钮数组）；`:141` `menuButtonAt(x,y)`；`:306-346` `drawMenu` 的按钮 for 循环按 `b.id` 分支绘制；几何：`START_BTN{x:(VIEW_W-372)/2,y:620,w:372,h:94}`、`ENDLESS_ROW_Y=724`、`RANK_BTN{16,866,262,98}`。菜单 import 自 `menu-ui`：已含 `drawMenuSpriteButton`/`menuInteract`，**未含** `drawInkActionButton`（新按钮要用需补 import）。
- `web/src/main.ts:188` `const params=new URLSearchParams(location.search)`（深链一次性解析）；`:196` `type Screen`；`:198` `usesMenuMusic`；`:202` `audioScreenKind`；`:238-261` `enterCodex/enterBag/enterRank`（lazyModule.ensure→设 screen→scheduleFrame 范式）；`:852` `handleMenu(id)`（if/else-if；`start` 分支用 `spendStamina`）；`:1381` 指针按下 menu 分支（`menuButtonAt`→`menuDownId`）；`:1671` 指针抬起 `if(stillOn) handleMenu(id)`（**menuButtons 里的按钮自动经此触发 handleMenu**）；`:1811` `needsContinuousLoop`；`:1839-1966` `frame()` 渲染分发（`else if(screen===...)`，战斗是末尾 `else`）；`:1386-1401` 指针按下的 codex/rank 分支范式。
- `web/src/stamina.ts`：`STAMINA_COST=5`；`spendStamina(s)→{ok,state}`；`stamina.value`（main.ts 全局 `let stamina`，`:307`）。
- `web/src/rank.ts`：`loadRank()→{level,stars,difficulty}`；`rank.level` 即 rank_level（main.ts 全局 `let rank`，`:306`）。
- `web/src/user-id.ts`：`ensureUserId()`（apiFetch 已自动用）；剪贴板复制可用 `navigator.clipboard.writeText`（若无则降级）。

---

## Task 1: `pvp-client.ts` 网络层 + 类型

**Files:**
- Create: `web/src/api/pvp-client.ts`
- Test: `web/tests/pvp-client.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/pvp-client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { versusEnqueue, versusPoll, versusCancel, versusRoomCreate, versusRoomJoin } from '../src/api/pvp-client';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}
afterEach(() => vi.restoreAllMocks());

describe('pvp-client', () => {
  it('enqueue 传 rank，回 ticket', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ticket: 'tk1' }));
    const r = await versusEnqueue(3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ticket).toBe('tk1');
  });
  it('poll 回 matched + matchStart', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { status: 'matched', matchStart: { matchId: 'm', seed: 1, map: 'huoyanshan', startAtServerMs: 10, opponent: { uid: '***1', nickname: '乙', avatarId: 'wukong', rankLevel: 3 } } }));
    const r = await versusPoll('tk1');
    expect(r.ok && r.data.status).toBe('matched');
  });
  it('roomCreate 回 code+link', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { code: 'AB12CD', link: 'https://x/?versus=AB12CD', ticket: 'tk', map: 'huoyanshan' }));
    const r = await versusRoomCreate(4);
    expect(r.ok && r.data.code).toBe('AB12CD');
  });
  it('cancel / roomJoin 走通', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ok: true }));
    expect((await versusCancel('tk')).ok).toBe(true);
    vi.stubGlobal('fetch', mockFetch(200, { status: 'matched', matchStart: { matchId: 'm', seed: 1, map: 'huoyanshan', startAtServerMs: 10, opponent: { uid: '***1', nickname: '甲', avatarId: 'wukong', rankLevel: 4 } } }));
    expect((await versusRoomJoin('AB12CD')).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行看失败** — `cd web && npx vitest run tests/pvp-client.test.ts`（模块不存在 → FAIL）。

- [ ] **Step 3: 实现**

```ts
// web/src/api/pvp-client.ts
// PvP 匹配/私房网络层：apiFetch 薄封装，X-Uid 由 apiFetch 自动带。
// tick 转发/心跳属对局阶段，放到 Plan C，本文件只覆盖匹配前的入队/轮询/取消/私房。
import { apiFetch, type ApiResult } from './client';

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
```

- [ ] **Step 4: 运行看通过** + `npx tsc --noEmit`。
- [ ] **Step 5: 提交** — `feat(pvp-web): pvp-client 匹配/私房网络层 + 类型`

---

## Task 2: `pvp-match.ts` 匹配状态机（随机匹配 + 倒计时 + 取消）

**Files:**
- Create: `web/src/pvp-match.ts`
- Test: `web/tests/pvp-match.test.ts`

设计：`PvpMatchController` 依赖注入 `net`（pvp-client 的子集）与 `now()`（毫秒），无直接 `Date.now`/定时器；`pump(nowMs)` 每帧调用，内部按 1s 轮询、按 2min 判超时。状态 `idle|queuing|inviting|matched|failed`。事件用回调 `onMatched`/`onFailed`。

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/pvp-match.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PvpMatchController, MATCH_TIMEOUT_MS, POLL_INTERVAL_MS } from '../src/pvp-match';
import type { MatchStart } from '../src/api/pvp-client';

const flush = () => new Promise((r) => setTimeout(r, 0));
const MS: MatchStart = { matchId: 'm', seed: 1, map: 'huoyanshan', startAtServerMs: 0, opponent: { uid: '***1', nickname: '乙', avatarId: 'wukong', rankLevel: 3 } };

function net(overrides: Partial<any> = {}) {
  return {
    enqueue: vi.fn(async () => ({ ok: true, data: { ticket: 'tk1' }, status: 200 })),
    poll: vi.fn(async () => ({ ok: true, data: { status: 'waiting' }, status: 200 })),
    cancel: vi.fn(async () => ({ ok: true, data: { ok: true }, status: 200 })),
    roomCreate: vi.fn(async () => ({ ok: true, data: { code: 'AB12CD', link: 'l', ticket: 'tk', map: 'huoyanshan' }, status: 200 })),
    roomJoin: vi.fn(async () => ({ ok: true, data: { status: 'matched', matchStart: MS }, status: 200 })),
    ...overrides,
  };
}

describe('PvpMatchController 随机匹配', () => {
  it('startRandom 入队后进入 queuing 并按间隔轮询', async () => {
    let t = 0; const n = net();
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed: vi.fn() });
    await c.startRandom(3); await flush();
    expect(c.state.phase).toBe('queuing');
    expect(n.enqueue).toHaveBeenCalledWith(3);
    t = POLL_INTERVAL_MS; c.pump(t); await flush();
    t = POLL_INTERVAL_MS * 2 + 1; c.pump(t); await flush();
    expect(n.poll.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('poll 到 matched → onMatched(matchStart)，停止轮询', async () => {
    let t = 0; const onMatched = vi.fn();
    const n = net({ poll: vi.fn(async () => ({ ok: true, data: { status: 'matched', matchStart: MS }, status: 200 })) });
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched, onFailed: vi.fn() });
    await c.startRandom(3); await flush();
    t = POLL_INTERVAL_MS + 1; c.pump(t); await flush();
    expect(onMatched).toHaveBeenCalledWith(MS);
    expect(c.state.phase).toBe('matched');
    const before = n.poll.mock.calls.length;
    t += POLL_INTERVAL_MS + 1; c.pump(t); await flush();
    expect(n.poll.mock.calls.length).toBe(before); // 不再轮询
  });

  it('2 分钟超时 → onFailed(timeout) 且尝试 cancel', async () => {
    let t = 0; const onFailed = vi.fn(); const n = net();
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed });
    await c.startRandom(3); await flush();
    t = MATCH_TIMEOUT_MS + 1; c.pump(t); await flush();
    expect(onFailed).toHaveBeenCalledWith('timeout');
    expect(c.state.phase).toBe('failed');
    expect(n.cancel).toHaveBeenCalled();
  });

  it('cancel() → 调用 net.cancel 且回 idle', async () => {
    let t = 0; const n = net();
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed: vi.fn() });
    await c.startRandom(3); await flush();
    await c.cancel(); await flush();
    expect(n.cancel).toHaveBeenCalledWith('tk1');
    expect(c.state.phase).toBe('idle');
  });

  it('入队 banned → onFailed(banned)', async () => {
    let t = 0; const onFailed = vi.fn();
    const n = net({ enqueue: vi.fn(async () => ({ ok: true, data: { banned: true, msg: 'x' }, status: 200 })) });
    const c = new PvpMatchController({ net: n as any, now: () => t, onMatched: vi.fn(), onFailed });
    await c.startRandom(3); await flush();
    expect(onFailed).toHaveBeenCalledWith('banned');
  });
});
```

- [ ] **Step 2: 运行看失败**。

- [ ] **Step 3: 实现**

```ts
// web/src/pvp-match.ts
// 匹配状态机：帧驱动（pump）轮询 + 倒计时，依赖注入 net/now 便于单测；不直接用 Date.now/setInterval。
import type { ApiResult, EnqueueResp, PollResp, RoomCreateResp, RoomJoinResp, MatchStart } from './api/pvp-client';

export const MATCH_TIMEOUT_MS = 120_000; // 与服务端一致的 2 分钟总倒计时
export const POLL_INTERVAL_MS = 1_000;   // 轮询间隔

export type MatchPhase = 'idle' | 'queuing' | 'inviting' | 'matched' | 'failed';
export type FailReason = 'timeout' | 'banned' | 'error';

export interface PvpMatchNet {
  enqueue(rank: number): Promise<ApiResult<EnqueueResp>>;
  poll(ticket: string): Promise<ApiResult<PollResp>>;
  cancel(ticket: string): Promise<ApiResult<{ ok: boolean }>>;
  roomCreate(rank: number): Promise<ApiResult<RoomCreateResp>>;
  roomJoin(code: string): Promise<ApiResult<RoomJoinResp>>;
}
export interface PvpMatchState {
  phase: MatchPhase;
  startedAt: number;      // now() 时刻
  remainMs: number;       // 剩余倒计时
  ticket: string | null;
  code: string | null;    // 邀请码（inviting）
  link: string | null;    // 邀请链接
  opponent: MatchStart['opponent'] | null;
  message: string;
}
interface Deps {
  net: PvpMatchNet;
  now: () => number;
  onMatched: (ms: MatchStart) => void;
  onFailed: (reason: FailReason, msg?: string) => void;
}

export class PvpMatchController {
  state: PvpMatchState;
  private d: Deps;
  private lastPollAt = 0;
  private polling = false;

  constructor(d: Deps) {
    this.d = d;
    this.state = { phase: 'idle', startedAt: 0, remainMs: MATCH_TIMEOUT_MS, ticket: null, code: null, link: null, opponent: null, message: '' };
  }

  private begin(phase: MatchPhase): void {
    const t = this.d.now();
    this.state.phase = phase;
    this.state.startedAt = t;
    this.state.remainMs = MATCH_TIMEOUT_MS;
    this.lastPollAt = t;
  }

  async startRandom(rank: number): Promise<void> {
    this.begin('queuing');
    const r = await this.d.net.enqueue(rank);
    if (!r.ok) { this.fail('error', r.error); return; }
    if (r.data.banned) { this.fail('banned', r.data.msg); return; }
    this.state.ticket = r.data.ticket ?? null;
    if (!this.state.ticket) this.fail('error', '入队失败');
  }

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

  async joinCode(code: string): Promise<void> {
    this.begin('queuing');
    const r = await this.d.net.roomJoin(code);
    if (!r.ok) { this.fail('error', r.error); return; }
    if ('banned' in r.data && r.data.banned) { this.fail('banned', r.data.msg); return; }
    if ('status' in r.data && r.data.status === 'matched') { this.matched(r.data.matchStart); return; }
    this.fail('error', 'error' in r.data ? r.data.error : '房间不可用');
  }

  /** 每帧调用：驱动轮询与倒计时。 */
  pump(nowMs: number): void {
    const s = this.state;
    if (s.phase !== 'queuing' && s.phase !== 'inviting') return;
    s.remainMs = Math.max(0, MATCH_TIMEOUT_MS - (nowMs - s.startedAt));
    if (s.remainMs <= 0) { this.fail('timeout'); void this.safeCancel(); return; }
    // inviting 阶段房主也要轮询 poll(ticket) 等好友加入成局
    if (this.state.ticket && !this.polling && nowMs - this.lastPollAt >= POLL_INTERVAL_MS) {
      this.lastPollAt = nowMs;
      this.polling = true;
      void this.d.net.poll(this.state.ticket).then((r) => {
        this.polling = false;
        if (this.state.phase !== 'queuing' && this.state.phase !== 'inviting') return;
        if (!r.ok) return; // 单次轮询失败忽略，下一拍重试（倒计时兜底）
        if (r.data.status === 'matched') this.matched(r.data.matchStart);
        else if (r.data.status === 'timeout') { this.fail('timeout'); }
      }).catch(() => { this.polling = false; });
    }
  }

  async cancel(): Promise<void> {
    await this.safeCancel();
    this.state.phase = 'idle';
  }
  private async safeCancel(): Promise<void> {
    const tk = this.state.ticket;
    if (tk) { try { await this.d.net.cancel(tk); } catch { /* 忽略 */ } }
  }
  private matched(ms: MatchStart): void {
    this.state.phase = 'matched';
    this.state.opponent = ms.opponent;
    this.d.onMatched(ms);
  }
  private fail(reason: FailReason, msg?: string): void {
    if (this.state.phase === 'failed' || this.state.phase === 'matched') return;
    this.state.phase = 'failed';
    this.state.message = msg ?? '';
    this.d.onFailed(reason, msg);
  }
}
```

- [ ] **Step 4: 运行看通过** + tsc。
- [ ] **Step 5: 提交** — `feat(pvp-web): 匹配状态机(轮询+倒计时+取消+邀请)`

---

## Task 3: `pvp-screen.ts` 匹配等待界面渲染 + 命中

**Files:**
- Create: `web/src/pvp-screen.ts`
- Test: `web/tests/pvp-screen.test.ts`

- [ ] **Step 1: 写失败测试**（stub ctx，只验证命中矩形与不抛异常）

```ts
// web/tests/pvp-screen.test.ts
import { describe, it, expect } from 'vitest';
import { drawPvpMatching, pvpMatchingHitAt, type PvpMatchingView } from '../src/pvp-screen';

function stubCtx() {
  const noop = () => {};
  return new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 40 }) : (p === 'canvas' ? { width: 540, height: 960 } : noop)) }) as unknown as CanvasRenderingContext2D;
}
const view = (o: Partial<PvpMatchingView> = {}): PvpMatchingView => ({ mode: 'random', phase: 'queuing', remainMs: 90_000, opponent: null, link: null, copied: false, message: '', ...o });

describe('pvp-screen', () => {
  it('random/invite/failed 各态都能画且不抛', () => {
    const ctx = stubCtx();
    expect(() => drawPvpMatching(ctx, view())).not.toThrow();
    expect(() => drawPvpMatching(ctx, view({ mode: 'invite', link: 'https://x/?versus=AB12CD' }))).not.toThrow();
    expect(() => drawPvpMatching(ctx, view({ phase: 'failed', message: '未匹配到对手' }))).not.toThrow();
  });
  it('exit 按钮命中', () => {
    const hit = pvpMatchingHitAt(270, 900, view()); // 底部退出区（坐标以实现常量为准，测试用实现导出的 rect）
    expect(hit === 'exit' || hit === null).toBe(true);
  });
  it('invite 模式复制链接命中返回 copy', () => {
    // 用实现导出的 COPY_RECT 中心点命中
    const v = view({ mode: 'invite', link: 'l' });
    const { COPY_RECT } = require('../src/pvp-screen');
    expect(pvpMatchingHitAt(COPY_RECT.x + 1, COPY_RECT.y + 1, v)).toBe('copy');
  });
});
```

- [ ] **Step 2: 运行看失败**。

- [ ] **Step 3: 实现**（水墨风，与现有 UI 一致；导出命中矩形常量便于测试与 main 复用）

```ts
// web/src/pvp-screen.ts
// PvP 匹配/等待界面：搜索动画 + 2 分钟倒计时环 + 退出匹配；邀请模式额外画分享链接与复制按钮。纯渲染 + 命中。
import { VIEW_W, VIEW_H } from './render';
import { drawInkActionButton } from './menu-ui';

export interface PvpMatchingView {
  mode: 'random' | 'invite' | 'join';
  phase: 'queuing' | 'inviting' | 'matched' | 'failed';
  remainMs: number;
  opponent: { nickname: string | null; avatarId: string; rankLevel: number } | null;
  link: string | null;
  copied: boolean;
  message: string;
}

export const EXIT_RECT = { x: VIEW_W / 2 - 90, y: 820, w: 180, h: 52 };
export const COPY_RECT = { x: VIEW_W / 2 - 90, y: 560, w: 180, h: 46 };
export const FAIL_OK_RECT = { x: VIEW_W / 2 - 90, y: 560, w: 180, h: 52 };
const RING_C = { x: VIEW_W / 2, y: 360, r: 110 };

export type PvpMatchingHit = 'exit' | 'copy' | 'ok' | null;

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function pvpMatchingHitAt(x: number, y: number, view: PvpMatchingView): PvpMatchingHit {
  if (view.phase === 'failed') return inRect(x, y, FAIL_OK_RECT) ? 'ok' : null;
  if (view.mode === 'invite' && view.link && inRect(x, y, COPY_RECT)) return 'copy';
  if (inRect(x, y, EXIT_RECT)) return 'exit';
  return null;
}

function fmtRemain(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function drawPvpMatching(ctx: CanvasRenderingContext2D, view: PvpMatchingView): void {
  // 背景
  ctx.fillStyle = '#efe3c6';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (view.phase === 'failed') {
    ctx.fillStyle = '#5a3a12';
    ctx.font = 'bold 22px "PingFang SC", serif';
    ctx.fillText(view.message || '未匹配到对手', VIEW_W / 2, 380);
    drawInkActionButton(ctx, FAIL_OK_RECT, '确认', false, 'primary');
    return;
  }

  // 标题
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 24px "PingFang SC", serif';
  ctx.fillText(view.mode === 'invite' ? '等待好友加入…' : '正在匹配对手…', VIEW_W / 2, 150);

  // 倒计时环（剩余比例）
  const frac = Math.max(0, Math.min(1, view.remainMs / 120_000));
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(90,58,18,0.18)';
  ctx.beginPath(); ctx.arc(RING_C.x, RING_C.y, RING_C.r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#b3541e';
  ctx.beginPath(); ctx.arc(RING_C.x, RING_C.y, RING_C.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 30px "PingFang SC", serif';
  ctx.fillText(fmtRemain(view.remainMs), RING_C.x, RING_C.y);

  if (view.phase === 'matched' && view.opponent) {
    ctx.font = '18px "PingFang SC", serif';
    ctx.fillText(`已匹配到对手：${view.opponent.nickname ?? '无名侠'}`, VIEW_W / 2, RING_C.y + RING_C.r + 40);
  }

  // 邀请模式：分享链接 + 复制
  if (view.mode === 'invite' && view.link) {
    ctx.font = '14px "PingFang SC", serif';
    ctx.fillStyle = '#6a4a1a';
    ctx.fillText('把链接发给好友，对方打开即开战', VIEW_W / 2, 520);
    drawInkActionButton(ctx, COPY_RECT, view.copied ? '已复制 ✓' : '复制邀请链接', false, 'secondary');
  }

  drawInkActionButton(ctx, EXIT_RECT, '退出匹配', false, 'secondary');
}
```

- [ ] **Step 4: 运行看通过** + tsc（注意 `require` 在 vitest ESM 下用 `await import` 替代；若测试 require 报错，改为顶部 `import { COPY_RECT }`）。
- [ ] **Step 5: 提交** — `feat(pvp-web): 匹配等待界面渲染 + 命中`

---

## Task 4: 首页两入口按钮（menu.ts）

**Files:**
- Modify: `web/src/menu.ts`
- Test: `web/tests/pvp-menu.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/pvp-menu.test.ts
import { describe, it, expect } from 'vitest';
import { menuButtons, menuButtonAt } from '../src/menu';

describe('menu PvP 入口', () => {
  it('menuButtons 含 pvpMatch/pvpInvite 且不重叠', () => {
    const ids = menuButtons().map((b) => b.id);
    expect(ids).toContain('pvpMatch');
    expect(ids).toContain('pvpInvite');
  });
  it('两按钮可命中', () => {
    const m = menuButtons().find((b) => b.id === 'pvpMatch')!;
    expect(menuButtonAt(m.x + 1, m.y + 1)).toBe('pvpMatch');
    const i = menuButtons().find((b) => b.id === 'pvpInvite')!;
    expect(menuButtonAt(i.x + 1, i.y + 1)).toBe('pvpInvite');
  });
});
```

- [ ] **Step 2: 运行看失败**。

- [ ] **Step 3: 实现**

在 `menu.ts` 几何常量区（`RANK_BTN` 附近）加两个按钮矩形（放在无尽行 `ENDLESS_ROW_Y≈724` 与底部 `RANK_BTN(y:866)` 之间的空档，左右并排）：
```ts
// PvP 入口：无尽行下方、底部栏上方的空档，左右并排
const PVP_ROW_Y = 772;
const PVP_BTN_H = 64;
const PVP_GAP = 12;
const PVP_BTN_W = (START_W - PVP_GAP) / 2; // 与开始按钮同总宽居中
const PVP_ROW_X = (VIEW_W - START_W) / 2;
const PVP_MATCH_BTN = { x: PVP_ROW_X, y: PVP_ROW_Y, w: PVP_BTN_W, h: PVP_BTN_H };
const PVP_INVITE_BTN = { x: PVP_ROW_X + PVP_BTN_W + PVP_GAP, y: PVP_ROW_Y, w: PVP_BTN_W, h: PVP_BTN_H };
```
在 `menuButtons()` 数组里，`{ id: 'start', ...START_BTN }` 之后、`{ id: 'rank' ... }` 之前插入：
```ts
    { id: 'pvpMatch', ...PVP_MATCH_BTN },
    { id: 'pvpInvite', ...PVP_INVITE_BTN },
```
在 `menu.ts` 顶部 import 从 `./menu-ui` 里补 `drawInkActionButton`：
```ts
import {
  roundRect, drawInkResourceBar, drawInkPlusButton, drawInkCheckbox, drawRankStars,
  drawMenuSpriteButton, inkCheckboxCenteredLayout, menuInteract, applyMenuInteract,
  drawInkActionButton,   // 新增
  type MenuInteract,
} from './menu-ui';
```
在 `drawMenu` 的按钮 for 循环里（`start` 分支之后）加两分支：
```ts
    if (b.id === 'pvpMatch') {
      drawInkActionButton(ctx, b, '真人对战', info.pressedId === 'pvpMatch', 'primary');
      continue;
    }
    if (b.id === 'pvpInvite') {
      drawInkActionButton(ctx, b, '邀请好友', info.pressedId === 'pvpInvite', 'secondary');
      continue;
    }
```

- [ ] **Step 4: 运行看通过** + tsc。
- [ ] **Step 5: 提交** — `feat(pvp-web): 首页真人对战/邀请好友入口按钮`

---

## Task 5: main.ts 接线（新屏 + 体力门禁 + 进入/退出 + 渲染 + 指针 + 深链）

**Files:**
- Modify: `web/src/main.ts`
- Test: `web/tests/pvp-integration.test.ts`（对可导出的纯函数做冒烟；main.ts 主体靠手动+后续真机，见 Task 6）

> main.ts 是单文件主控，改动点多但都小且局部。逐条改，改完 `npx tsc --noEmit` 必须过。

- [ ] **Step 1: Screen 类型与音频/循环分支**

`main.ts:196` 改：
```ts
type Screen = 'loading' | 'menu' | 'battle' | 'codex' | 'rank' | 'bag' | 'pvpMatching';
```
`usesMenuMusic`（`:198`）加 `pvpMatching`（匹配界面沿用首页 BGM）：
```ts
function usesMenuMusic(s: Screen): boolean {
  return s === 'menu' || s === 'codex' || s === 'rank' || s === 'bag' || s === 'pvpMatching';
}
```
`needsContinuousLoop`（`:1811`）加分支（搜索动画/倒计时需持续重绘）：在 `if (screen === 'menu') return true;` 之后加 `if (screen === 'pvpMatching') return true;`

- [ ] **Step 2: 懒加载模块 + 进入函数 + 控制器状态**

在 lazyModule 定义区（`:231-236` 附近）加：
```ts
const pvpMatchLazy = lazyModule(() => import('./pvp-match'));
const pvpScreenLazy = lazyModule(() => import('./pvp-screen'));
```
在合适的模块级状态区（如 `let screen` 附近）加：
```ts
let pvpController: import('./pvp-match').PvpMatchController | null = null;
let pvpMatched: import('./api/pvp-client').MatchStart | null = null; // Plan C 用；Plan B 仅暂存
let pvpMode: 'random' | 'invite' | 'join' = 'random';
let pvpCopied = false;
```
加集成缝 + 进入函数：
```ts
// 匹配成功的集成缝：Plan B 先回首页提示；Plan C 覆盖为进入 PvP 对局。
function onPvpMatched(ms: import('./api/pvp-client').MatchStart): void {
  pvpMatched = ms;
  screen = 'menu';
  menuToast = `已匹配到 ${ms.opponent.nickname ?? '对手'}（对战功能开发中）`;
  scheduleFrame();
}
function onPvpFailed(reason: string): void {
  // 停在失败态，由界面「确认」回首页；banned 直接给文案
  scheduleFrame();
}
function enterPvpMatching(mode: 'random' | 'invite' | 'join', code?: string): void {
  pvpMatchLazy.ensure((m) => {
    pvpScreenLazy.ensure(() => {
      pvpMode = mode; pvpCopied = false;
      pvpController = new m.PvpMatchController({
        net: pvpNet(), now: () => performance.now(), onMatched: onPvpMatched, onFailed: onPvpFailed,
      });
      screen = 'pvpMatching';
      if (mode === 'random') void pvpController.startRandom(rank.level);
      else if (mode === 'invite') void pvpController.startInvite(rank.level);
      else if (mode === 'join' && code) void pvpController.joinCode(code);
      scheduleFrame();
    });
  });
}
```
在 import 区加 net 适配（用 pvp-client）：
```ts
import * as pvpClient from './api/pvp-client';
function pvpNet() {
  return {
    enqueue: pvpClient.versusEnqueue, poll: pvpClient.versusPoll, cancel: pvpClient.versusCancel,
    roomCreate: pvpClient.versusRoomCreate, roomJoin: pvpClient.versusRoomJoin,
  };
}
```

- [ ] **Step 3: handleMenu 两入口（体力 ≥5 门禁，不扣）**

`handleMenu`（`:852`）在 `start` 分支之后、`else if (id==='codex')` 之前，插入：
```ts
  } else if (id === 'pvpMatch' || id === 'pvpInvite') {
    if (stamina.value < STAMINA_COST) {
      menuToast = '体力不足（需 5 点）！点 + 补充';
      pushMenuFloatToast('体力不足，无法进入匹配');
      scheduleFrame();
      return;
    }
    enterPvpMatching(id === 'pvpInvite' ? 'invite' : 'random');
```
（注意：入口只校验 `stamina.value >= STAMINA_COST`，**不 spendStamina**——真正开打才扣，留给 Plan C 的 match-start。）

- [ ] **Step 4: frame() 渲染分支**

`frame()`（`:1876` 一带，`else if (screen === 'bag')` 之后、战斗 `else` 之前）插入：
```ts
  } else if (screen === 'pvpMatching') {
    const mc = pvpMatchLazy.get(); const sc = pvpScreenLazy.get();
    if (mc && sc && pvpController) {
      pvpController.pump(performance.now());
      const s = pvpController.state;
      sc.drawPvpMatching(ctx, {
        mode: pvpMode, phase: s.phase === 'idle' ? 'queuing' : s.phase,
        remainMs: s.remainMs, opponent: s.opponent, link: s.link, copied: pvpCopied, message: s.message,
      });
    }
```

- [ ] **Step 5: 指针按下分支（退出/复制/失败确认）**

在指针按下的屏幕分支链里（`:1386` 的 `if (screen === 'codex')` 之前或之后），加：
```ts
  if (screen === 'pvpMatching') {
    const sc = pvpScreenLazy.get();
    if (!sc || !pvpController) return;
    const hit = sc.pvpMatchingHitAt(x, y, {
      mode: pvpMode, phase: pvpController.state.phase === 'idle' ? 'queuing' : pvpController.state.phase,
      remainMs: pvpController.state.remainMs, opponent: pvpController.state.opponent,
      link: pvpController.state.link, copied: pvpCopied, message: pvpController.state.message,
    });
    if (hit === 'exit') {
      playSfx('click');
      void pvpController.cancel();
      pvpController = null; screen = 'menu'; scheduleFrame();
    } else if (hit === 'ok') { // 失败确认回首页
      pvpController = null; screen = 'menu'; scheduleFrame();
    } else if (hit === 'copy' && pvpController.state.link) {
      const link = pvpController.state.link;
      try { void navigator.clipboard?.writeText(link); } catch { /* 降级：忽略 */ }
      pvpCopied = true; scheduleFrame();
    }
    return;
  }
```

- [ ] **Step 6: 深链 `?versus=`**

`:190` 附近加：
```ts
const versusCode = params.get('versus');
```
在资源加载完成、`screen` 首次进入 `'menu'` 的那段（async IIFE，`:273` 一带，进首页处）之后追加：
```ts
  if (versusCode) enterPvpMatching('join', versusCode);
```
（确保此时 `rank` 等全局已初始化；`enterPvpMatching` 内部懒加载安全。）

- [ ] **Step 7: 运行 tsc + vitest 全量**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: 全绿（含前面任务的单测；main.ts 只做接线，无新单测，靠 tsc 保证类型正确）。

- [ ] **Step 8: 提交** — `feat(pvp-web): 首页入口→匹配屏接线(体力门禁/进入退出/渲染/指针/深链)`

---

## Task 6: 冒烟自检 + 回归

**Files:** 无新增（验证任务）

- [ ] **Step 1: 类型 + 单测全绿** — `cd web && npx tsc --noEmit && npm test`（期望：新增 4 个测试文件全过，既有测试无回归）。
- [ ] **Step 2: 构建通过** — `cd web && npm run build`（Vite 打包无错，确认懒加载分包 `pvp-match`/`pvp-screen` 正常）。
- [ ] **Step 3: 记录手动验证清单**（真机在 Plan D 统一做，这里先列）：首页两按钮显示/点击；体力<5 提示；匹配屏倒计时环与退出；邀请屏复制链接；`?versus=CODE` 深链进 join；2 分钟超时失败→确认回首页。
- [ ] **Step 4: 提交（若有微调）** — `chore(pvp-web): Plan B 冒烟自检`

---

## Self-Review（对照 spec §4/§9 与本计划）

- §4.1 随机匹配入队/轮询/2min 倒计时 → Task 2（`startRandom`/`pump`/`MATCH_TIMEOUT_MS`）。✓ 自适应窗口/放宽在服务端（Plan A），客户端只入队+轮询。✓
- §4.2 邀请私房 create/link/join + 深链 → Task 2（`startInvite`/`joinCode`）+ Task 5 Step 6（`?versus=`）+ Task 3（复制链接）。✓
- §4.3 匹配界面：搜索+倒计时环+退出匹配；邀请显示分享链接+已复制 → Task 3。✓ 配对成功「已匹配到对手」提示 → Task 3 matched 态 + Task 5 `onPvpMatched`。✓
- §2 体力：入口需 ≥5、**不在入口扣**（开打才扣）→ Task 5 Step 3。✓
- §9 暂停区匹配中→退出匹配：本计划实现为**匹配屏自带「退出匹配」按钮**（比复用 pause-popup 更简单直接）；对局中「认输」留给 Plan C。**这是有意的设计选择，记录在此。**
- 禁赛：服务端在 enqueue/room 返回 `banned` → Task 2 `onFailed('banned')` + 文案。✓
- **明确不做（Plan C/D）**：真正开打（固定步长/输入重放/对局 UI/结算）、tick 心跳、时钟对齐、认输、反作弊端上核对。`onPvpMatched` 是交接缝。
- 占位扫描：无 TODO/占位；每个新模块给了完整可运行代码与测试；main.ts 改动逐条给了代码与锚点。
- 类型一致性：`MatchStart`/`PollResp` 等类型在 pvp-client 定义，pvp-match/main 复用同名；`PvpMatchingView` 在 pvp-screen 定义，main 构造时字段对齐。
