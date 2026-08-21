// web/tests/pvp-ws.test.ts
// Plan C Task 3：PvpSocket 客户端 WS 连接层——连接/握手 hello/消息分发/指数退避重连/手动关闭。
//
// 这里只用 node 环境（vitest 默认），没有全局 WebSocket/location，故用 FakeWebSocket + vi.stubGlobal 注入。
// 重连计时器用「可控 scheduler」捕获 (fn, ms)，测试手动触发 fn 来模拟计时器到点（避免真实 setTimeout 抖动）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PvpSocket } from '../src/pvp-ws';

// readyState 常量：与浏览器 WebSocket 取值一致（CONNECTING=0/OPEN=1/CLOSING=2/CLOSED=3）。
const CONNECTING = 0, OPEN = 1, CLOSED = 3;

// 手搓 FakeWebSocket：记录 send 参数、可注入 open/close 触发，构造时自动异步 fire open。
// - readyState 初值 CONNECTING，构造即 queueMicrotask 触发 onopen（readyState→OPEN）——模拟真实握手完成。
// - 若在 open 微任务触发前被 close()，readyState→CLOSED，open 微任务看到非 CONNECTING 即空转（不触发 onopen）。
// - 测试可用 receive() 模拟服务器推消息、close() 模拟连接断开（PvpSocket 靠「是否手动 close」区分，不靠调用方）。
class FakeWebSocket {
  static CONNECTING = CONNECTING;
  static OPEN = OPEN;
  static CLOSING = 2;
  static CLOSED = CLOSED;
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  }
  static reset(): void {
    FakeWebSocket.instances = [];
  }
  readyState = CONNECTING;
  readonly url: string;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    // 异步 fire open：把握手完成推迟到下一个微任务，让 connect() 同步返回后测试能先拿到 socket。
    queueMicrotask(() => {
      if (this.readyState !== CONNECTING) return; // 已 close 则空转，不触发 onopen
      this.readyState = OPEN;
      this.onopen?.({});
    });
  }
  send(data: string): void { this.sent.push(data); }
  close(): void {
    this.readyState = CLOSED;
    this.onclose?.({});
  }
  // 测试辅助：模拟服务器下发一帧文本消息。
  receive(data: string): void { this.onmessage?.({ data }); }
}

// 微任务冲刷：让 FakeWebSocket 排队中的 open 微任务有机会执行。
const tick = async (rounds = 3): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

afterEach(() => {
  FakeWebSocket.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 便捷：用 FakeWebSocket 当工厂。
const fakeFactory = (url: string) => new FakeWebSocket(url);

describe('PvpSocket URL 构造', () => {
  it('https 页面 → wss，http 页面 → ws；query 正确编码', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'game.example.com:8443' } as unknown as Location);
    const s = new PvpSocket({ matchId: 'm/1 x', uid: 'u&2', wsFactory: fakeFactory });
    s.connect();
    expect(FakeWebSocket.last().url).toBe(
      'wss://game.example.com:8443/api/versus/ws?matchId=' +
        encodeURIComponent('m/1 x') + '&uid=' + encodeURIComponent('u&2'),
    );

    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5180' } as unknown as Location);
    const s2 = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    s2.connect();
    const url2 = FakeWebSocket.last().url;
    expect(url2.startsWith('ws://localhost:5180/api/versus/ws?')).toBe(true);
    expect(url2).toContain('matchId=m&uid=u');
  });

  it('无 location（node 单测）回退 ws://localhost', () => {
    const s = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    s.connect();
    expect(FakeWebSocket.last().url).toBe('ws://localhost/api/versus/ws?matchId=m&uid=u');
  });
});

describe('PvpSocket 握手与消息分发', () => {
  it('open 后自动发 hello {type,matchId,uid}', async () => {
    new PvpSocket({ matchId: 'M1', uid: 'U1', wsFactory: fakeFactory }).connect();
    await tick();
    const sock = FakeWebSocket.last();
    expect(sock.sent.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(sock.sent[0]!)).toEqual({ type: 'hello', matchId: 'M1', uid: 'U1' });
  });

  it('dispatch：welcome/oppSnap/nextWave/result/oppGone 各回调触发一次并带正确参数', async () => {
    const seen: unknown[] = [];
    const sock = new PvpSocket({
      matchId: 'm', uid: 'u', wsFactory: fakeFactory,
      onWelcome: (ms) => seen.push(['welcome', ms]),
      onOppSnap: (x) => seen.push(['oppSnap', x]),
      onNextWave: (w, a) => seen.push(['nextWave', w, a]),
      onResult: (r) => seen.push(['result', r]),
      onOppGone: () => seen.push(['oppGone']),
    });
    sock.connect();
    await tick();
    const ws = FakeWebSocket.last();
    ws.receive(JSON.stringify({ type: 'welcome', serverMs: 1234 }));
    ws.receive(JSON.stringify({ type: 'oppSnap', s: { a: 1 } }));
    ws.receive(JSON.stringify({ type: 'nextWave', wave: 3, startAtServerMs: 999 }));
    ws.receive(JSON.stringify({ type: 'result', outcome: 'win', reason: 'r1' }));
    ws.receive(JSON.stringify({ type: 'oppGone' }));
    expect(seen).toEqual([
      ['welcome', 1234],
      ['oppSnap', { a: 1 }],
      ['nextWave', 3, 999],
      ['result', { outcome: 'win', reason: 'r1' }],
      ['oppGone'],
    ]);
  });

  it('畸形 JSON 不向外抛出；未知 type 被忽略', async () => {
    const onWelcome = vi.fn();
    const onOppSnap = vi.fn();
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, onWelcome, onOppSnap });
    sock.connect();
    await tick();
    const ws = FakeWebSocket.last();
    expect(() => ws.receive('not json {')).not.toThrow();
    expect(() => ws.receive(JSON.stringify({ type: 'noSuchType', x: 1 }))).not.toThrow();
    expect(onWelcome).not.toHaveBeenCalled();
    expect(onOppSnap).not.toHaveBeenCalled();
  });
});

describe('PvpSocket 上行发送（OPEN 门控）', () => {
  it('sendSnap：未 open 静默丢弃返回 false；open 后返回 true 且信封正确（t 为数字、s 原样）', async () => {
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    sock.connect();
    expect(sock.sendSnap({ hp: 5 })).toBe(false); // readyState=CONNECTING → 不发
    await tick();
    const ws = FakeWebSocket.last();
    const before = ws.sent.length; // 已有 hello
    expect(sock.sendSnap({ hp: 5 })).toBe(true);
    const env = JSON.parse(ws.sent[ws.sent.length - 1]!);
    expect(env.type).toBe('snap');
    expect(typeof env.t).toBe('number');
    expect(env.s).toEqual({ hp: 5 });
    expect(ws.sent.length).toBe(before + 1);
  });

  it('sendWaveCleared / sendStatus：未开丢弃，开后正确信封', async () => {
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    sock.connect();
    expect(sock.sendWaveCleared(2)).toBe(false);
    expect(sock.sendStatus('surrender')).toBe(false);
    await tick();
    const ws = FakeWebSocket.last();
    expect(sock.sendWaveCleared(2)).toBe(true);
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!)).toEqual({ type: 'waveCleared', wave: 2 });
    expect(sock.sendStatus('tangsengDead')).toBe(true);
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!)).toEqual({ type: 'status', v: 'tangsengDead' });
  });
});

describe('PvpSocket 指数退避重连', () => {
  // 同步关闭刚创建的 socket（在其 open 微任务触发前）→ readyState→CLOSED → open 微任务空转，
  // 这样 backoff 不会被「成功 open 重置」，可连续验证 1s→2s→4s→封顶 5s。
  function dropLast(): void {
    FakeWebSocket.last().close();
  }

  it('close 后指数退避：1s→2s→4s→封顶 5s；成功 open 后重置为 1s', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    dropLast(); // 首连未 open 即断
    expect(calls.map((c) => c.ms)).toEqual([1000]);

    calls[0]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([1000, 2000]);

    calls[1]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([1000, 2000, 4000]);

    calls[2]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([1000, 2000, 4000, 5000]); // 8000 封顶 5s

    // 第 5 次重连：让它真正 open 成功（冲刷微任务），backoff 应重置为 1s。
    calls[3]!.fn();
    await tick();
    expect(FakeWebSocket.last().readyState).toBe(OPEN);
    dropLast(); // open 成功后再断
    expect(calls.map((c) => c.ms)).toEqual([1000, 2000, 4000, 5000, 1000]); // 重置回 1s
  });

  it('重连每次都建一个全新 WebSocket', () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    dropLast();
    expect(FakeWebSocket.instances.length).toBe(1);
    calls[0]!.fn(); // 第 2 个 socket
    expect(FakeWebSocket.instances.length).toBe(2);
    dropLast();
    calls[1]!.fn(); // 第 3 个 socket
    expect(FakeWebSocket.instances.length).toBe(3);
  });
});

describe('PvpSocket 手动关闭', () => {
  it('open 态手动 close()：不调度任何重连，状态 closed', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    await tick(); // open 成功
    const before = FakeWebSocket.instances.length;
    sock.close();
    expect(calls.length).toBe(0); // open 态手动关，本就不该有挂起重连
    expect(sock.state).toBe('closed');
    expect(FakeWebSocket.instances.length).toBe(before); // 无新 socket
  });

  it('close() 让挂起的重连计时器过期：触发它既不建新 socket、也不再调度', () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    FakeWebSocket.last().close(); // 触发一次重连调度（call0，1s）
    expect(calls.length).toBe(1);
    const before = FakeWebSocket.instances.length;
    sock.close(); // 手动关闭：代数 +1，call0 过期
    calls[0]!.fn(); // 触发已过期的计时器
    expect(FakeWebSocket.instances.length).toBe(before); // 无新 socket
    expect(calls.length).toBe(1); // 也未再调度新计时器
    expect(sock.state).toBe('closed');
  });
});
