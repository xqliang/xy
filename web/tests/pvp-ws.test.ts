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

  it('close 后重连退避：首试 300ms 快试，随后 1s→2s→4s→封顶 5s；成功 open 重置回 300ms', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    dropLast(); // 首连未 open 即断
    expect(calls.map((c) => c.ms)).toEqual([300]);   // 弱网优化③：首次重连快试 300ms

    calls[0]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([300, 1000]);

    calls[1]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([300, 1000, 2000]);

    calls[2]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([300, 1000, 2000, 4000]);

    calls[3]!.fn(); dropLast();
    expect(calls.map((c) => c.ms)).toEqual([300, 1000, 2000, 4000, 5000]); // 8000 封顶 5s

    // 第 6 次重连：让它真正 open 成功（冲刷微任务），退避应重置回首试 300ms。
    calls[4]!.fn();
    await tick();
    expect(FakeWebSocket.last().readyState).toBe(OPEN);
    // open 成功会顺带排一次心跳 ping（2000ms）—— captured scheduler 里多这一条。
    expect(calls.map((c) => c.ms)).toEqual([300, 1000, 2000, 4000, 5000, 2000]); // 5 条重连退避 + 心跳 ping
    dropLast(); // open 成功后再断
    expect(calls.map((c) => c.ms)).toEqual([300, 1000, 2000, 4000, 5000, 2000, 300]); // 重连回快试 300ms
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

  // —— 弱网优化③：reconnectNow 供 online / 回前台 / wx.onAppShow 主动触发 —— //
  it('reconnectNow：reconnecting 态跳过退避立即建新 socket；被跳过的旧计时器触发不重复建', () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    FakeWebSocket.last().close();                // 未 open 即断 → reconnecting，挂起 300ms 重连计时器
    expect(sock.state).toBe('reconnecting');
    sock.reconnectNow();                         // 立即重连
    expect(sock.state).toBe('connecting');
    expect(FakeWebSocket.instances.length).toBe(2); // 新 socket 已建
    const stale = calls.find((c) => c.ms === 300)!;
    stale.fn();                                  // 被跳过的旧计时器到点：空转，不建第 3 个
    expect(FakeWebSocket.instances.length).toBe(2);
    sock.close();
  });

  it('reconnectNow：open / connecting / closed 态空转（不建新 socket）', async () => {
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory,
      scheduler: (fn, ms) => { void fn; void ms; } });
    sock.connect();
    sock.reconnectNow();                         // connecting 态：空转
    expect(FakeWebSocket.instances.length).toBe(1);
    await tick();                                // open
    sock.reconnectNow();                         // open 态：空转（连接好好的，别折腾）
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(sock.state).toBe('open');
    sock.close();
    sock.reconnectNow();                         // closed 态：空转（手动关闭永不复活）
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(sock.state).toBe('closed');
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
    // open 会顺带排一次心跳 ping（2000ms）；手动关应清掉它（clearPingTimer），且绝不触发重连。
    expect(calls.length).toBe(1);            // 仅那次心跳 ping 被调度
    expect(calls[0]!.ms).toBe(2000);
    calls[0]!.fn();                          // 触发已排的 ping 计时器
    expect(calls.length).toBe(1);            // 手动关后 ping 计时器过期：既不发 ping、也不再排下一个
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

describe('PvpSocket 应用层心跳 ping / RTT / 入站时间戳', () => {
  // 便捷：捕获被调度计时器的可控 scheduler（返回 push 的新长度当句柄，close 时 clearTimeout 无害）。
  function capturingScheduler(): { calls: Array<{ fn: () => void; ms: number }>; schedule: (fn: () => void, ms: number) => unknown } {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const schedule = (fn: () => void, ms: number) => calls.push({ fn, ms });
    return { calls, schedule };
  }

  it('open 后每 2s 发一次 ping（信封 {type:ping,t:number}），且 firing 后会重排下一个', async () => {
    const { calls, schedule } = capturingScheduler();
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler: schedule });
    sock.connect();
    await tick(); // open 成功
    const pings = () => calls.filter((c) => c.ms === 2000);
    expect(pings().length).toBe(1); // open 后排了一次心跳
    pings()[0]!.fn(); // 到点 → 发 ping
    const ws = FakeWebSocket.last();
    const pingMsg = ws.sent.map(JSON.parse).filter((m) => m.type === 'ping');
    expect(pingMsg.length).toBe(1);
    expect(typeof pingMsg[0]!.t).toBe('number');
    expect(pings().length).toBe(2); // 发完重排下一个 2s 心跳
  });

  it('入站 pong（t=now-40）→ rttMs≈40（EWMA 首样本即取 RTT）', async () => {
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    sock.connect();
    await tick();
    expect(sock.rttMs).toBeNull(); // 首 pong 前为 null
    const t = Date.now() - 40;
    FakeWebSocket.last().receive(JSON.stringify({ type: 'pong', t }));
    expect(sock.rttMs).not.toBeNull();
    expect(Math.abs(sock.rttMs! - 40)).toBeLessThan(100); // ≈40
    // 第二次 pong 触发 EWMA 平滑：仍收敛在合理范围（不会跳飞）。
    FakeWebSocket.last().receive(JSON.stringify({ type: 'pong', t: Date.now() - 80 }));
    expect(sock.rttMs!).toBeGreaterThan(0);
    expect(sock.rttMs!).toBeLessThan(200);
  });

  it('pong 缺 t 时 rttMs 不变（不因畸形心跳污染）', async () => {
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    sock.connect();
    await tick();
    FakeWebSocket.last().receive(JSON.stringify({ type: 'pong' })); // 无 t
    expect(sock.rttMs).toBeNull();
  });

  it('任意入站消息都刷新 lastInboundAt（看门狗基线）', async () => {
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory });
    sock.connect();
    await tick();
    sock.lastInboundAt = 1; // 伪造一个很久以前的值
    FakeWebSocket.last().receive(JSON.stringify({ type: 'welcome', serverMs: 1 }));
    expect(sock.lastInboundAt).toBeGreaterThan(1);
  });

  it('open 前不排心跳；close 后排的 ping 计时器过期即失效（不发、不重排）', async () => {
    const { calls, schedule } = capturingScheduler();
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler: schedule });
    sock.connect();
    expect(calls.filter((c) => c.ms === 2000).length).toBe(0); // 未 open：无心跳
    await tick(); // open → 排一次心跳
    const pings = () => calls.filter((c) => c.ms === 2000);
    expect(pings().length).toBe(1);
    const ws = FakeWebSocket.last();
    const sentBefore = ws.sent.length;
    sock.close(); // 手动关：心跳计时器过期
    pings()[0]!.fn(); // 触发已过期的心跳
    expect(ws.sent.length).toBe(sentBefore); // 没多发 ping
    expect(pings().length).toBe(1); // 也未重排下一个
    expect(sock.state).toBe('closed');
  });
});

// ============================================================================
//  弱网优化②：断线期间事件补发队列
//  waveCleared（清波下降沿）与 status（认输/唐僧死终局）是「事件」而非「状态」——
//  断线窗口恰好跨过清波/终局时静默丢弃会导致服务端判定错误。改为未 open 时入队，
//  重连 open 后紧跟 hello 按序补发；snap 是状态量（新快照覆盖旧值）不入队。
// ============================================================================
describe('PvpSocket 弱网事件补发队列', () => {
  // 便捷：open 成功 → 服务器断开（进入 reconnecting，挂起一个重连计时器）。
  function dropAfterOpen(sock: PvpSocket, calls: Array<{ fn: () => void; ms: number }>): void {
    FakeWebSocket.last().close();          // 服务器断 → handleClose → 调度重连（calls 尾部）
    expect(sock.state).toBe('reconnecting');
    void calls;
  }

  it('未 open 时 waveCleared/status 入队；重连 open 后先 hello、再按序补发', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => { calls.push({ fn, ms }); };
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    await tick();                          // open + hello
    dropAfterOpen(sock, calls);            // 断线，进入 reconnecting
    const dead = FakeWebSocket.last();
    sock.sendWaveCleared(3);               // 断线期间清了一波
    sock.sendStatus('surrender');          // 随后认输
    expect(dead.sent.some((m) => m.includes('waveCleared'))).toBe(false); // 旧 socket 未再发

    calls[calls.length - 1]!.fn();         // 触发重连计时器 → 新 socket
    await tick();                          // open 成功
    const s = FakeWebSocket.last();
    const sent = s.sent.map((m) => JSON.parse(m) as { type: string });
    expect(sent.map((m) => m.type)).toEqual(['hello', 'waveCleared', 'status']); // hello 先行
    expect(sent[1]).toEqual({ type: 'waveCleared', wave: 3 });
    expect(sent[2]).toEqual({ type: 'status', v: 'surrender' });
    sock.close();
  });

  it('补发后队列清空：同一连接不再重复发（ping 计时器触发不重发）', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => { calls.push({ fn, ms }); };
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    await tick();
    dropAfterOpen(sock, calls);
    sock.sendWaveCleared(2);
    calls[calls.length - 1]!.fn();
    await tick();                          // open + hello + 补发 waveCleared
    const s = FakeWebSocket.last();
    expect(s.sent.filter((m) => m.includes('waveCleared'))).toHaveLength(1);
    // 触发一次 ping 计时器（新连接 open 后排的 2000ms 那条——取最后一条，
    // 因为断掉的旧连接也留有一条同延时的过期 ping 计时器在 calls 里）：只发 ping，不重发队列。
    const pingCall = calls.filter((c) => c.ms === 2000).pop()!;
    pingCall.fn();
    expect(s.sent.filter((m) => m.includes('waveCleared'))).toHaveLength(1);
    expect(s.sent.some((m) => m.includes('"ping"'))).toBe(true);
    sock.close();
  });

  it('sendSnap 不入队：状态量由新快照覆盖，重连 open 后只发 hello', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => { calls.push({ fn, ms }); };
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    await tick();
    dropAfterOpen(sock, calls);
    expect(sock.sendSnap({ wave: 1 })).toBe(false);   // 未 open：丢弃（不入队）
    calls[calls.length - 1]!.fn();
    await tick();
    const sent = FakeWebSocket.last().sent.map((m) => JSON.parse(m) as { type: string });
    expect(sent).toEqual([{ type: 'hello', matchId: 'm', uid: 'u' }]);  // 无补发
    sock.close();
  });

  it('队列封顶 16：超出丢最旧，重连后只补发最近 16 条', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => { calls.push({ fn, ms }); };
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    await tick();
    dropAfterOpen(sock, calls);
    for (let w = 1; w <= 20; w++) sock.sendWaveCleared(w);   // 20 条：丢最旧 4 条
    calls[calls.length - 1]!.fn();
    await tick();
    const waves = FakeWebSocket.last().sent
      .map((m) => JSON.parse(m) as { type: string; wave?: number })
      .filter((m) => m.type === 'waveCleared')
      .map((m) => m.wave);
    expect(waves).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    sock.close();
  });

});
