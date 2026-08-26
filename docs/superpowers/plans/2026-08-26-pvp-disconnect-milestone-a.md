# PvP 断线容错 · 里程碑 A（客户端韧性）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PvP 客户端在页面存活的瞬断（抖动/切后台/断网/wss 中断）下更稳地自动恢复——>10s 判死后连接恢复能解冻续打、重连中有横幅提示、账号令牌失效时短路重登并用最新 token 重连。

**Architecture:** 三块独立改动。(A1-lite) `pvp-netwatch.ts` 加纯判定 `netRecovered()`，`main.ts` 帧循环据此在连接恢复时清 `pvpNetDead` 解冻（等同取消暂停，不重建 sim，故安全）。(A3) `PvpSocket` 暴露 `reconnectAttempt`，`main.ts` 在 `reconnecting` 态画顶部横幅。(A4) `PvpSocket` 改为每次连接用最新 token 重建 URL（`tokenProvider` 注入），并在连续重连失败达阈值时经注入的 `authProbe` 探活，401 则 `onAuthFail` 短路；`main.ts` 把 `authProbe` 接到 `apiFetch('/api/leaderboard/daily')`、`onAuthFail` 接到 `clearToken()`+退出+toast。

**Tech Stack:** TypeScript、vitest（node 环境 + FakeWebSocket/可控 scheduler 夹具，测试在 `web/tests/**`）；`main.ts` 帧循环改动无单测夹具，靠 tsc（不新增报错）+ 真机浏览器验证。

**参考规范：** `docs/superpowers/specs/2026-08-26-pvp-disconnect-resilience-design.md` §3（里程碑 A）。

---

## 文件结构

- Modify `web/src/pvp-netwatch.ts` — 加 `netRecovered()` 纯函数；顺手修过时"6s"注释为"10s"。
- Modify `web/src/pvp-ws.ts` — 加 `reconnectAttempt` getter；`tokenProvider` 注入 + 每次连接重算 URL；`authProbe`/`onAuthFail` + 探测短路逻辑；修 `:82` 过时"6s"注释。
- Modify `web/src/main.ts` — 帧循环 A1-lite 复活；A3 横幅函数 + 绘制接线；`onPvpMatched` 里 A4 三个注入 + 相关 import。
- Modify `web/tests/pvp-netwatch.test.ts` — `netRecovered` 边界单测。
- Modify `web/tests/pvp-ws.test.ts` — `reconnectAttempt`、`tokenProvider` 取新 token、`authProbe`→`onAuthFail` 短路 单测。

**执行约定（项目既有）：** 所有 `npm` 命令在 `web/` 下跑；vitest 只收 `web/tests/**`；tsc 基线本有 ~28 处既有报错，验收看**不新增**；`main.ts` 改动必须真机浏览器验证。

---

## Task 1: A1-lite 纯判定 `netRecovered()` + 注释清理

**Files:**
- Modify: `web/src/pvp-netwatch.ts`
- Test: `web/tests/pvp-netwatch.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/tests/pvp-netwatch.test.ts` 顶部 import 改为：

```ts
import { netDead, netRecovered, NET_DEAD_THRESHOLD_MS } from '../src/pvp-netwatch';
```

在文件末尾（`describe('netDead …')` 之后）追加：

```ts
describe('netRecovered 断线后连接恢复判定', () => {
  it('尚未 open（lastInboundAt===0）不算恢复', () => {
    expect(netRecovered(1_000_000, 0)).toBe(false);
  });
  it('入站在阈值内 → 恢复', () => {
    expect(netRecovered(15_000, 10_000)).toBe(true); // 距上次入站 5s ≤ 10s
  });
  it('边界：恰好等于阈值算恢复；超过阈值不算', () => {
    const base = 10_000;
    expect(netRecovered(base + NET_DEAD_THRESHOLD_MS, base)).toBe(true);      // =10000 → 恢复
    expect(netRecovered(base + NET_DEAD_THRESHOLD_MS + 1, base)).toBe(false); // 10001 → 仍算断
  });
  it('自定义阈值生效', () => {
    expect(netRecovered(4_400, 4_000, 500)).toBe(true);  // 400 ≤ 500
    expect(netRecovered(4_600, 4_000, 500)).toBe(false); // 600 > 500
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run tests/pvp-netwatch.test.ts`
Expected: FAIL — `netRecovered is not a function` / import 报错。

- [ ] **Step 3: 实现 `netRecovered` + 修注释**

编辑 `web/src/pvp-netwatch.ts`。把文件头与函数 doc 里过时的"6s / 默认 6000"改成"10s / 默认 10000"，并在 `netDead` 之后追加 `netRecovered`：

```ts
// web/src/pvp-netwatch.ts
// PvP 断线看门狗的纯判定（无副作用，便于单测）：连接已建立且距上次入站超过阈值 → 判死。
//
// 为何抽成纯函数：main.ts 里 frame() 每帧都要判一次「>10s 无入站」，阈值决策与重绘/弹窗解耦后，
// 单测可直接覆盖边界（恰 10000ms 不判死、10001ms 判死、尚未 open 不判死），不用起画布。
//
// lastInboundAt===0 表示连接尚未 open（无基线时间戳）：此时返回 false，避免刚建连被误判为断线。

/** 断线看门狗阈值（ms）：超过该时长无任意入站消息即判网络断开。 */
export const NET_DEAD_THRESHOLD_MS = 10_000;

/**
 * 判定当前是否应触发断线弹窗。
 * @param nowMs 当前墙钟 ms（Date.now()）
 * @param lastInboundAt 最近一次收到下行消息的墙钟 ms（PvpSocket.lastInboundAt；0=尚未 open）
 * @param thresholdMs 阈值 ms（默认 10000）
 * @returns true=应判死并弹「网络已断开」
 */
export function netDead(nowMs: number, lastInboundAt: number, thresholdMs = NET_DEAD_THRESHOLD_MS): boolean {
  return lastInboundAt > 0 && nowMs - lastInboundAt > thresholdMs;
}

/**
 * 判定断线判死后连接是否已恢复（入站在阈值内且已有过入站基线）→ 应清 pvpNetDead 解冻续打。
 * 与 netDead 对称：lastInboundAt===0（尚未 open）不算恢复，返回 false。
 * @param thresholdMs 阈值 ms（默认 10000，与 netDead 同）
 */
export function netRecovered(nowMs: number, lastInboundAt: number, thresholdMs = NET_DEAD_THRESHOLD_MS): boolean {
  return lastInboundAt > 0 && nowMs - lastInboundAt <= thresholdMs;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run tests/pvp-netwatch.test.ts`
Expected: PASS（含既有 netDead 用例 + 新 netRecovered 用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/pvp-netwatch.ts web/tests/pvp-netwatch.test.ts
git commit -m "feat(pvp): netRecovered 纯判定——断线后连接恢复判定（A1-lite 基础）+ 修过时6s注释"
```

---

## Task 2: A1-lite 帧循环——连接恢复时清 `pvpNetDead` 解冻续打

**Files:**
- Modify: `web/src/main.ts`（import 一处；帧循环 `:2614-2617` 一处）

> 无单测夹具（`main.ts` 帧循环依赖画布/全局态）；靠 tsc + 真机验证。改动极小：仅在既有"置死"分支后加一条对称的"复活"分支。

- [ ] **Step 1: 扩展 import**

找到 `main.ts` 中从 `./pvp-netwatch` 的 import（当前为 `import { netDead } from './pvp-netwatch';`，被 `:2614` 使用），改为：

```ts
import { netDead, netRecovered } from './pvp-netwatch';
```

- [ ] **Step 2: 帧循环加"复活"分支**

把 `main.ts:2614-2616` 这段：

```ts
    if (pvpSock && !pvpResult && !pvpNetDead && netDead(Date.now(), pvpSock.lastInboundAt)) {
      pvpNetDead = true;
    }
```

改为（追加 `else if` 复活分支）：

```ts
    if (pvpSock && !pvpResult && !pvpNetDead && netDead(Date.now(), pvpSock.lastInboundAt)) {
      pvpNetDead = true;
    } else if (pvpSock && !pvpResult && pvpNetDead && netRecovered(Date.now(), pvpSock.lastInboundAt)) {
      // A1-lite：断线判死后若入站重新到达（socket 已重连）→ 解冻续打。
      // 等同「取消暂停」——sim 状态还在内存里，只是之前被 netDead 冻结（shouldStepSim 门控）；
      // 与「跨刷新重建 sim」不同（后者会与服务端波次时钟 desync，见 spec §3 A1），故此处安全。
      pvpNetDead = false;
      pvpNetDeadStart = 0;
    }
```

（下一行 `beginNetDeadCountdown(now);` 保持不动：复活后 `pvpNetDead=false`，它内部 `if (!pvpNetDead) return` 自然空转。）

- [ ] **Step 3: 类型检查不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 数字与基线一致（≈28，不增加）。可先在 main 基线记下该数字对比。

- [ ] **Step 4: 真机浏览器验证**（强制，见项目约定）

用现有 puppeteer 冒烟框架或手动：进一局 PvP → 断网 >10s（触发"我方连不上"倒计时）→ 在倒计时结束前恢复网络 → **画面应解冻、对局继续**（而非倒计时到点回首页）。再测：断网直到倒计时结束 → 仍按现状回首页。

- [ ] **Step 5: 提交**

```bash
git add web/src/main.ts
git commit -m "feat(pvp): A1-lite——断线判死后连接恢复即解冻续打（清 pvpNetDead），瞬断重连不再强制回首页"
```

---

## Task 3: A3 `PvpSocket` 暴露 `reconnectAttempt`

**Files:**
- Modify: `web/src/pvp-ws.ts`
- Test: `web/tests/pvp-ws.test.ts`

- [ ] **Step 1: 写失败测试**

在 `web/tests/pvp-ws.test.ts` 的 `describe('PvpSocket 指数退避重连', …)` 内追加：

```ts
  it('reconnectAttempt：open=0；断开进入重连后随次数递增；重连成功归零', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler });
    sock.connect();
    await tick();                       // open 成功
    expect(sock.reconnectAttempt).toBe(0);
    FakeWebSocket.last().close();        // 断 → 第 1 次重连排程（retryCount→1）
    expect(sock.reconnectAttempt).toBe(1);
    calls.find((c) => c.ms === 300)!.fn(); // 建新 socket
    FakeWebSocket.last().close();        // 再断 → 第 2 次
    expect(sock.reconnectAttempt).toBe(2);
    calls.find((c) => c.ms === 1000)!.fn();
    await tick();                       // 这次 open 成功 → 归零
    expect(sock.reconnectAttempt).toBe(0);
    sock.close();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run tests/pvp-ws.test.ts -t reconnectAttempt`
Expected: FAIL — `sock.reconnectAttempt` 为 undefined（属性不存在）。

- [ ] **Step 3: 实现 getter**

在 `web/src/pvp-ws.ts` 的 `PvpSocket` 类内（`rttMs` 字段声明之后、构造器之前，约 `:81` 附近）加：

```ts
  /** 当前重连尝试次数（0=未在重连或已 open；≥1=第 N 次重连中）。供 UI 显示"正在重连(第 N 次)"。 */
  get reconnectAttempt(): number { return this.retryCount; }
```

同时把紧邻的 `lastInboundAt` 字段注释（`:82-83`）里过时的"「>6s 无入站」"改为"「>10s 无入站」"（实际阈值 `NET_DEAD_THRESHOLD_MS=10_000`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run tests/pvp-ws.test.ts -t reconnectAttempt`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/src/pvp-ws.ts web/tests/pvp-ws.test.ts
git commit -m "feat(pvp): PvpSocket 暴露 reconnectAttempt（A3 横幅显示第 N 次重连）"
```

---

## Task 4: A3 重连中横幅绘制 + 接线

**Files:**
- Modify: `web/src/main.ts`（新增 `drawReconnectingBanner` 函数；绘制处 `:2807` 附近接线）

> 无单测；tsc + 真机验证。

- [ ] **Step 1: 新增横幅绘制函数**

在 `main.ts` 的 `drawOppGoneOverlay`（`:474-476`）之后加：

```ts
/** 重连中横幅：顶部居中小药丸「正在重连…(第 N 次)」。断线判死前(0~countdown)显示——
 *  此时本方 sim 仍在跑，故用不铺满的顶部横幅，不遮挡棋盘（区别于 drawNetDeadOverlay 全屏弹窗）。 */
function drawReconnectingBanner(ctx: CanvasRenderingContext2D, attempt: number): void {
  const text = attempt > 0 ? `正在重连…(第 ${attempt} 次)` : '正在重连…';
  ctx.save();
  ctx.font = '14px "PingFang SC", serif';
  const padX = 14, h = 28;
  const w = ctx.measureText(text).width + padX * 2;
  const x = (VIEW_W - w) / 2, y = 36;
  ctx.fillStyle = 'rgba(20,20,20,0.62)';
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill(); }
  else ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffe9b0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, VIEW_W / 2, y + h / 2);
  ctx.restore();
}
```

- [ ] **Step 2: 接线到绘制**

在 `main.ts:2807` 的 `if (pvpNetDead) drawNetDeadOverlay(ctx, …);` 这一行**之后**加：

```ts
    // A3：断线判死前、连接处于重连中 → 顶部横幅（sim 仍在跑，不遮挡；判死后由 drawNetDeadOverlay 接管）。
    if (pvpSock && !pvpResult && !pvpNetDead && !pvpOppGone && pvpSock.state === 'reconnecting') {
      drawReconnectingBanner(ctx, pvpSock.reconnectAttempt);
    }
```

- [ ] **Step 3: 类型检查不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 与基线一致（不增加）。

- [ ] **Step 4: 真机浏览器验证**

进一局 PvP → 短暂断网（<10s）→ 顶部应出现"正在重连…(第 N 次)"横幅，且棋盘/本方战斗仍可见在跑；恢复后横幅消失；若断超 10s，横幅被"我方连不上"全屏弹窗接管。

- [ ] **Step 5: 提交**

```bash
git add web/src/main.ts
git commit -m "feat(pvp): A3——重连中顶部横幅『正在重连(第N次)』，断线判死前提示不遮挡对局"
```

---

## Task 5: A4-a `tokenProvider` 注入 + 每次连接用最新 token 重建 URL

**Files:**
- Modify: `web/src/pvp-ws.ts`
- Test: `web/tests/pvp-ws.test.ts`

> 现状 URL 在构造时烘焙一次（`:109`），token 过期重连也不刷新。改为每次 `connect()` 用 `tokenProvider()` 重算。

- [ ] **Step 1: 写失败测试**

在 `web/tests/pvp-ws.test.ts` 的 `describe('PvpSocket URL 构造', …)` 内追加：

```ts
  it('tokenProvider：每次连接取最新 token 拼进 &token=（重连刷新，不烘焙旧值）', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'h' } as unknown as Location);
    let tok: string | undefined = 'T1';
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const s = new PvpSocket({ matchId: 'm', uid: 'u', tokenProvider: () => tok, wsFactory: fakeFactory, scheduler });
    s.connect();
    expect(FakeWebSocket.last().url).toContain('&token=T1');
    FakeWebSocket.last().close();          // 断 → 排重连
    tok = 'T2';                            // 令牌在重连前刷新了
    calls.find((c) => c.ms === 300)!.fn(); // 重连
    expect(FakeWebSocket.last().url).toContain('&token=T2'); // 用的是新 token，不是烘焙的 T1
    s.close();
  });

  it('tokenProvider 返回 undefined → URL 不带 &token=', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'h' } as unknown as Location);
    const s = new PvpSocket({ matchId: 'm', uid: 'u', tokenProvider: () => undefined, wsFactory: fakeFactory });
    s.connect();
    expect(FakeWebSocket.last().url).not.toContain('token=');
    s.close();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run tests/pvp-ws.test.ts -t tokenProvider`
Expected: FAIL — `&token=T2` 不匹配（当前烘焙成 T1），或 tokenProvider 未被使用。

- [ ] **Step 3: 实现**

在 `web/src/pvp-ws.ts`：

(a) `PvpSocketOpts` 接口内 `token?: string;` 之后加：

```ts
  // 会话令牌提供者（可选）：每次连接/重连时调用取最新 token，避免构造时烘焙导致过期后重连仍用旧 token。
  // 与 token 二选一；两者都给则 tokenProvider 优先。
  tokenProvider?: () => string | undefined;
```

(b) 删除私有字段 `private readonly wsUrl: string;`（`:88`）。

(c) 构造器内删除 `this.wsUrl = buildWsUrl(this.matchId, this.uid, this.token);`（`:109`），并新增保存 provider。构造器末尾（`this.schedule = …` 之后）改为：

```ts
    this.schedule = opts.scheduler ?? defaultScheduler;
    this.tokenProvider = opts.tokenProvider;
```

在字段区（`readonly token?: string;` 之后）加：

```ts
  private readonly tokenProvider?: () => string | undefined;
```

(d) `connect()` 内把 `const sock = this.factory(this.wsUrl);`（`:116`）改为：

```ts
    const sock = this.factory(buildWsUrl(this.matchId, this.uid, this.currentToken()));
```

(e) 在 `connect()` 之前加私有方法：

```ts
  /** 取当前令牌：优先 tokenProvider（每连接刷新），回退构造时的静态 token。 */
  private currentToken(): string | undefined {
    return this.tokenProvider ? this.tokenProvider() : this.token;
  }
```

- [ ] **Step 4: 运行全 pvp-ws 测试确认通过（含既有 URL 用例仍绿）**

Run: `cd web && npx vitest run tests/pvp-ws.test.ts`
Expected: PASS（既有"URL 构造/无 location 回退"等用例不受影响——它们没传 token/tokenProvider，`currentToken()` 返回 undefined，URL 不带 token，与原断言一致）。

- [ ] **Step 5: 提交**

```bash
git add web/src/pvp-ws.ts web/tests/pvp-ws.test.ts
git commit -m "feat(pvp): PvpSocket tokenProvider——每次连接取最新 token 重建 URL（修重连用过期 token）"
```

---

## Task 6: A4-b 鉴权失败探测短路（`authProbe`/`onAuthFail`）

**Files:**
- Modify: `web/src/pvp-ws.ts`
- Test: `web/tests/pvp-ws.test.ts`

> 因浏览器不暴露失败握手的 HTTP 401 给 JS（详见 spec §1.3），无法靠 close code 区分鉴权失败。改为：连续重连失败达阈值时，经注入的 `authProbe()` 探活；返回 false（探到 401）→ `onAuthFail` 并停止重连。

- [ ] **Step 1: 写失败测试**

在 `web/tests/pvp-ws.test.ts` 末尾追加：

```ts
describe('PvpSocket 鉴权失败探测短路', () => {
  it('连续重连达阈值(3) → authProbe 返回 false → onAuthFail 触发且不再重连', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const onAuthFail = vi.fn();
    const authProbe = vi.fn(async () => false); // 探到 401：令牌失效
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler, authProbe, onAuthFail });
    sock.connect();
    FakeWebSocket.last().close();          // retryCount→1（排 300ms）
    calls.find((c) => c.ms === 300)!.fn();
    FakeWebSocket.last().close();          // retryCount→2（排 1000ms）
    calls.find((c) => c.ms === 1000)!.fn();
    FakeWebSocket.last().close();          // retryCount→3 → 触发 authProbe
    expect(authProbe).toHaveBeenCalledTimes(1);
    await tick();                          // 等 probe promise resolve → failAuth
    expect(onAuthFail).toHaveBeenCalledTimes(1);
    const socketsBefore = FakeWebSocket.instances.length;
    // 之后即便挂起的重连计时器到点，也不再建新 socket（已短路）。
    calls.filter((c) => c.ms === 2000).forEach((c) => c.fn());
    expect(FakeWebSocket.instances.length).toBe(socketsBefore);
    expect(sock.state).toBe('closed');
  });

  it('authProbe 返回 true（仍有效，网络问题）→ 不触发 onAuthFail，继续重连', async () => {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = (fn: () => void, ms: number) => calls.push({ fn, ms });
    const onAuthFail = vi.fn();
    const authProbe = vi.fn(async () => true);
    const sock = new PvpSocket({ matchId: 'm', uid: 'u', wsFactory: fakeFactory, scheduler, authProbe, onAuthFail });
    sock.connect();
    FakeWebSocket.last().close();
    calls.find((c) => c.ms === 300)!.fn();
    FakeWebSocket.last().close();
    calls.find((c) => c.ms === 1000)!.fn();
    FakeWebSocket.last().close();          // retryCount→3 → probe
    await tick();
    expect(onAuthFail).not.toHaveBeenCalled();
    // 仍在重连（下一次退避计时器已排）
    expect(calls.some((c) => c.ms === 2000)).toBe(true);
    sock.close();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run tests/pvp-ws.test.ts -t 鉴权失败探测短路`
Expected: FAIL — `authProbe`/`onAuthFail` 未被调用（选项未实现）。

- [ ] **Step 3: 实现**

在 `web/src/pvp-ws.ts`：

(a) 常量区（`const PENDING_MAX = 16;` 附近）加：

```ts
/** 连续重连失败达此次数即探活一次账号令牌（区分「网络断」与「令牌失效」）。 */
const AUTH_PROBE_AFTER_ATTEMPTS = 3;
```

(b) `PvpSocketOpts` 内加：

```ts
  // 鉴权探活（可选）：连续重连达阈值时调用，返回 false=令牌已失效(探到 401)。因浏览器不暴露失败
  // 握手的 HTTP 401 给 JS，无法靠 close code 判定，故用它探活。默认不注入=永不短路（保持无限重连）。
  authProbe?: () => Promise<boolean>;
  // 令牌失效回调（authProbe 返回 false 时触发一次）：上层据此 clearToken + 退出重登。
  onAuthFail?: () => void;
```

(c) 字段区（`private retryCount = 0;` 附近）加：

```ts
  private authProbing = false; // 正在探活（防重复并发探测）
  private authFatal = false;   // 已判令牌失效：短路，永不再重连
```

(d) `scheduleReconnect()` 内，把现有 `this.retryCount++;`（`:235`）之后紧接着加探测触发：

```ts
    this.retryCount++;
    // A4：连续重连达阈值 → 探活账号令牌（一次）。探到失效则短路重连。
    if (this.retryCount === AUTH_PROBE_AFTER_ATTEMPTS && this.opts.authProbe && !this.authProbing && !this.authFatal) {
      this.runAuthProbe();
    }
```

(e) 新增两个私有方法（放在 `scheduleReconnect` 之后）：

```ts
  /** 探活账号令牌：返回 false（探到 401）→ 判令牌失效短路。fire-and-forget，探测中不阻塞重连退避。 */
  private runAuthProbe(): void {
    const probe = this.opts.authProbe;
    if (!probe) return;
    this.authProbing = true;
    probe().then((ok) => {
      this.authProbing = false;
      if (!ok && !this.closed && !this.authFatal) this.failAuth();
    }).catch(() => {
      this.authProbing = false; // 探测本身失败（网络问题）：不短路，继续重连
    });
  }

  /** 令牌失效短路：停止一切重连（等同手动 close 的重连抑制），回调 onAuthFail 让上层重登。 */
  private failAuth(): void {
    if (this.closed) return;
    this.authFatal = true;
    this.closed = true;          // 复用 closed 语义：connect/scheduleReconnect 均短路
    this.reconnectGen++;         // 让挂起的退避计时器过期
    this.clearPingTimer();
    if (this.timer !== null && this.timer !== undefined) {
      clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    }
    this.timer = null;
    this.state = 'closed';
    this.sock?.close();
    this.sock = null;
    this.opts.onAuthFail?.();
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run tests/pvp-ws.test.ts`
Expected: PASS（新增两组 + 既有全绿）。

- [ ] **Step 5: 提交**

```bash
git add web/src/pvp-ws.ts web/tests/pvp-ws.test.ts
git commit -m "feat(pvp): PvpSocket 鉴权失败探测短路（authProbe/onAuthFail）——令牌失效不再无限重连"
```

---

## Task 7: A4-c `main.ts` 接线（tokenProvider + authProbe + onAuthFail）

**Files:**
- Modify: `web/src/main.ts`（import 若干；`onPvpMatched` 的 `new PvpSocket({…})` 选项 `:335-363`）

> 无单测；tsc + 真机验证。

- [ ] **Step 1: 补齐 import**

确认/新增 `main.ts` 顶部 import：
- `getToken` 已从 `./auth-token` 导入（`:338` 已用）。改为 `import { getToken, clearToken } from './auth-token';`
- 新增 `import { apiFetch } from './api/client';`
- 新增 `import { pushMenuFloatToast } from './menu-toast';`

（若某个已存在则并入，勿重复声明。）

- [ ] **Step 2: 改 `new PvpSocket` 选项**

在 `onPvpMatched`（`:335`）的 `new PvpSocket({ … })` 里，把 `token: getToken() ?? undefined,`（`:338`）替换为下面三项：

```ts
    // A4：每次连接取最新 token（重连也刷新），避免烘焙的旧 token 过期后连不上。
    tokenProvider: () => getToken() ?? undefined,
    // A4：连续重连达阈值时探活——打一个 require_auth 的轻量 GET；401=令牌失效。
    // 非 strict 灰度期服务端回退 X-Uid 不会 401，与 WS 同步（那时 WS 也不会因鉴权失败），故不会误短路。
    authProbe: async () => {
      const r = await apiFetch('/api/leaderboard/daily?limit=1', { method: 'GET' });
      return !(r.ok === false && r.status === 401);
    },
    // A4：令牌失效 → 清 token + 退出对局 + 回首页提示重登。
    onAuthFail: () => {
      clearToken();
      endPvpSession();
      screen = 'menu';
      pushMenuFloatToast('登录已失效，请重新进入');
      scheduleFrame();
    },
```

- [ ] **Step 3: 类型检查不新增报错**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 与基线一致（不增加）。

- [ ] **Step 4: 真机浏览器验证**

- 正常 PvP：连接/重连正常（tokenProvider 生效，URL 带 token）。
- 模拟令牌失效（DevTools 里把 `localStorage['dasheng.token']` 改成无效值并让服务端处于 strict）：断线重连 3 次后应清 token、回首页、弹"登录已失效，请重新进入"，而非无限重连。

- [ ] **Step 5: 提交**

```bash
git add web/src/main.ts
git commit -m "feat(pvp): A4 接线——PvP WS 用最新 token 连接；令牌失效探测短路后清token+回首页重登"
```

---

## Task 8: 里程碑 A 收尾——全量测试 + 类型基线 + 真机冒烟

**Files:** 无（验收）

- [ ] **Step 1: 全量前端单测**

Run: `cd web && npx vitest run`
Expected: 全绿（尤其 `pvp-ws.test.ts` / `pvp-netwatch.test.ts`）。

- [ ] **Step 2: 类型检查不新增**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: ≤ 基线数（≈28）。若增加，定位到本里程碑改动修掉。

- [ ] **Step 3: 真机浏览器冒烟（综合）**

一局 PvP 内依次验证：①短断（<10s）出"正在重连"横幅、恢复后消失、对局不中断；②断 >10s 触发"我方连不上"倒计时，倒计时内恢复→解冻续打，倒计时到点→回首页；③（strict + 坏 token）重连 3 次后清 token 回首页提示重登。

- [ ] **Step 4: 里程碑 A 完成**

按 `superpowers:finishing-a-development-branch` 决定合并/PR。里程碑 B（服务端持久化 + grace 45s + 撮合退队 + B7 弱网测量 + 反代排查）另起计划。
