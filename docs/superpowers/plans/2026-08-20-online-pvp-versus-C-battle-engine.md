# 在线 PvP 对战 · Plan C（对局引擎）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal：** 把现有单人「合成+对称塔防」对局受控改造成在线真人 PvP——固定步长确定性循环、放置动作转发/回放、先清者定波次、断线/认输/胜负结算——匹配成功后两名真人真正开打。

**Architecture：** 复用单 `Battle` 实例的「双棋盘」（本方 `this.monsters/units` + 对手侧 `this.aiMonsters/aiUnits`）。本方半场由本机**固定步长(1/30)确定性实时模拟**（权威）；对手半场把服务端转发来的对手放置动作按 simTick **回放**进现有 `ai*` 状态（仅供展示 + 反作弊摘要）。**波次开始时间与终局胜负走服务端实时消息**（Plan A 的 `/api/versus/tick` 已实现服务端侧），与展示用重放解耦——重放漂移只影响对手侧观感，不影响胜负与节奏。新增 `web/src/pvp-battle.ts` 持有 simTick 记账/动作缓冲/tick 网络桥接，避免把网络塞进 7000 行的 `battle.ts`。

**Tech Stack：** TypeScript + Canvas + Vite；vitest（stub CanvasRenderingContext2D）；确定性 mulberry32 RNG（`rng.ts`）；`apiFetch`（X-Uid 自动）；服务端 Python 已就绪（Plan A）。

---

## 关键设计决策（请在交接门评审，可调整）

- **D1 · 对手侧=到达即应用的回放，不做延迟时间线缓冲。** 服务端权威裁决终局、权威下发下一波，对手侧渲染只读确定性 `ai*` 状态。故对手动作按 simTick 排序、**到达即应用**到 `ai*`（网络延迟天然形成 <1s 落后，无需显式缓冲/插值）。平滑插值时间线是**后续 polish**（本计划不做，留 Plan C-后续或 D）。
- **D2 · 「各算各的」波次血量对「决定胜负的半场」天然成立。** 本机按本方战力 `computeWavePressure` 算本方波血（现状即如此，正确）；对手机同理。仅本机**对手回放侧**的怪物血目前复用本方 `wavePressure`（cosmetic 偏差，非胜负/摘要项）→ **保真化留后续**。
- **D3 · 固定步长只在 PvP 模式启用。** 单人保持可变 dt 老路径（`ai-balance` 门禁敏感，不动），零回归风险。PvP 走 1/30 累加器（照搬 `versus-user-agent.ts` 已验证的固定子步）。
- **D4 · 权威 seed / 关本地 AI。** PvP 局用 `MatchStart.seed`（非 `nextSeed()` 的 `Math.random`）；跳过 `rollAiLoadout`/`newBattleAiSkill`/rubber-band；DevTools 强制出英雄在 PvP 关闭（破坏 tray 对称）。
- **D5 · 反作弊分层落点。** 本计划只负责**产出并上报**每 1s 的 `digest`（服务端 backstop=Plan A 已用）+ 合法性靠服务端。**端上重放交叉核对**（比对对手自报 digest）留 **Plan D**。

---

## 文件结构（创建/修改）

| 文件 | 责任 | 动作 |
|------|------|------|
| `web/src/api/pvp-client.ts` | 加 `versusTick()` + Tick 请求/响应类型 | 修改 |
| `web/src/pvp-battle.ts` | **新**：simTick 时钟、出/入站动作缓冲、tick 请求组装/响应分发、断线检测 | 创建 |
| `web/src/battle.ts` | 构造加 `pvp` 选项；`updateAi` PvP 分支（换 A/B 决策段为动作应用器）；`snapshot` 补 `kills` | 修改 |
| `web/src/main.ts` | `frame()` 固定步长累加器（PvP 门）；12 个输入点打点；`onPvpMatched` 建 PvP 局 + tick 循环；status 轮询接终局；深链 join 同理 | 修改 |
| `web/src/pause-popup.ts` | `context:'match'` → 「认输」 | 修改 |
| `web/src/settle.ts` | PvP 结算分支（胜/负/平 + 原因 + 对手，不加减星/不触发商人） | 修改 |
| `web/src/pvp-battle.test.ts` 等 | 各任务的 vitest | 创建 |

> **确定性红线**：PvP 局绝不可引入 `Math.random`/`Date.now`/`new Date`；两处 `performance.now()` 规划器 deadline（`battle.ts:5346` AI 规划、`:7075` 一键布阵）在 PvP 下**不得进入判定**——本方一键布阵**转发其结果落格清单**（非重跑 autoplace），对手侧根本不跑规划器。

---

## 里程碑与任务总览

- **C-α 确定性骨架**（Task 1-4）：tick 客户端 + pvp-battle 记账 + PvP 构造 + 固定步长 → 能用服务端 seed 起一局 PvP 空对局。
- **C-β 双向对打**（Task 5-7）：对手动作应用器 + 本方输入打点 + `onPvpMatched` 接线 tick 循环 → 两端真人放置互相可见。
- **C-γ 服务端耦合与终局**（Task 8-10）：先清者定波次 + 断线/认输/胜负 + PvP 结算。
- **C-δ 确定性与回归护栏**（Task 11-12）：确定性单测 + 单人零回归门禁。

---

## Task 1：pvp-client 增 `versusTick` + Tick 类型

**Files:**
- Modify: `web/src/api/pvp-client.ts`
- Test: `web/src/api/pvp-client.tick.test.ts`（新）

对齐设计 spec §5.2 的请求/响应。`op` 用判别联合，`simTick`（=`t`）为整数。

- [ ] **Step 1: 写失败测试** — `pvp-client.tick.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { versusTick, type TickRequest } from './pvp-client';
import * as client from './client';

describe('versusTick', () => {
  it('POST /api/versus/tick，透传 body，解出 opponentInputs/result', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({
      ok: true, status: 200,
      data: { serverMs: 111, opponentInputs: [{ t: 5, op: 'summon' }], opponentDigest: null,
              nextWave: null, opponentStatus: 'playing', result: null, cheatNotice: null },
    });
    const req: TickRequest = {
      matchId: 'm1', clientMs: 100, inputs: [{ t: 3, op: 'summon' }],
      digest: { wave: 1, power: 10, kills: 0, tangsengHP: 3, peach: 5, units: 2 },
      waveClearedAt: null, status: 'playing',
    };
    const r = await versusTick(req);
    expect(spy).toHaveBeenCalledWith('/api/versus/tick', expect.objectContaining({ method: 'POST' }));
    expect(r.ok && r.data.opponentInputs[0].op).toBe('summon');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**（`versusTick` 未定义）
Run: `cd web && npx vitest run src/api/pvp-client.tick.test.ts`  Expected: FAIL

- [ ] **Step 3: 实现** — 在 `pvp-client.ts` 追加类型与函数

```ts
/** 放置/操作动作（带 simTick=t），供对手回放 + 反作弊 */
export type PvpAction =
  | { t: number; op: 'summon'; tray?: string[] }               // 征兵：带抽到的候选字结果（确定性来源转发）
  | { t: number; op: 'place'; token: string; cell: string; index?: number }
  | { t: number; op: 'move'; from: string; to: string }
  | { t: number; op: 'merge'; from: number; to: number }
  | { t: number; op: 'recall'; from: string; slot: number }
  | { t: number; op: 'shovel'; cell: string }
  | { t: number; op: 'active'; id: string; cell?: string; slot?: number }
  | { t: number; op: 'autoplace'; cells: Array<{ token: string; cell: string }> } // 一键布阵→结果落格清单
  | { t: number; op: 'startWave' }
  | { t: number; op: 'claimDrop'; id: string };

export interface PvpDigest { wave: number; power: number; kills: number; tangsengHP: number; peach: number; units: number }

export interface TickRequest {
  matchId: string; clientMs: number; inputs: PvpAction[];
  digest: PvpDigest; waveClearedAt: { wave: number; t: number } | null;
  status: 'playing' | 'tangsengDead' | 'surrender';
}
export type PvpOutcome = 'win' | 'lose' | 'draw';
export interface TickResponse {
  serverMs: number;
  opponentInputs: PvpAction[];
  opponentDigest: PvpDigest | null;
  nextWave: { wave: number; startAtServerMs: number } | null;
  opponentStatus: 'playing' | 'disconnected' | 'surrendered' | 'tangsengDead';
  result: null | { outcome: PvpOutcome; reason: string };
  cheatNotice: null | { banned: true; msg: string };
}
export function versusTick(req: TickRequest): Promise<ApiResult<TickResponse>> {
  return apiFetch<TickResponse>('/api/versus/tick', J(req));
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `npx vitest run src/api/pvp-client.tick.test.ts` Expected: PASS
- [ ] **Step 5: 核对服务端契约** — 打开 `server/api_versus.py` 的 `tick` 处理，逐字段核对键名/取值与上面一致（尤其 `opponentInputs`/`waveClearedAt`/`result.reason` 枚举）。若服务端键名不同，**以服务端为准**改客户端类型并在 commit message 记录差异。
- [ ] **Step 6: Commit** — `git add web/src/api/pvp-client.ts web/src/api/pvp-client.tick.test.ts && git commit -m "feat(pvp-web): pvp-client 增 versusTick + Tick 请求/响应类型（对齐服务端）"`

---

## Task 2：`pvp-battle.ts` 核心记账（simTick / 动作缓冲 / tick 组装）

**Files:**
- Create: `web/src/pvp-battle.ts`
- Test: `web/src/pvp-battle.test.ts`

纯逻辑、不碰 `Battle`/网络，便于单测。职责：①从服务端时钟推 simTick；②出站动作缓冲（本方打点）；③入站对手动作缓冲（按 t 有序、供应用器按 simTick 取用）；④组装 `TickRequest`、分发 `TickResponse`；⑤断线检测（记 `lastServerContactMs`）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { PvpSync } from './pvp-battle';

const clock = (ms: number) => () => ms;
describe('PvpSync', () => {
  it('simTick = floor((now - startAt) / (1000/30))', () => {
    const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 1000, serverOffsetMs: 0, now: clock(1000 + 100) });
    expect(s.simTick()).toBe(3); // 100ms / 33.33 ≈ 3
  });
  it('本方打点进出站缓冲，drainOutbound 清空并返回有序动作', () => {
    let t = 1000; const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 1000, serverOffsetMs: 0, now: () => t });
    t = 1000 + 66; s.record({ op: 'summon' });           // simTick≈1
    t = 1000 + 132; s.record({ op: 'startWave' });        // simTick≈3
    const out = s.drainOutbound();
    expect(out.map((a) => a.op)).toEqual(['summon', 'startWave']);
    expect(out[0].t).toBeLessThan(out[1].t);
    expect(s.drainOutbound()).toEqual([]);                // 已清空
  });
  it('入站对手动作按 t 归并有序，takeReady(simTick) 只取 t<=simTick 的', () => {
    const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 0, serverOffsetMs: 0, now: clock(0) });
    s.ingestOpponent([{ t: 10, op: 'summon' }, { t: 2, op: 'startWave' }]);
    expect(s.takeReady(5).map((a) => a.op)).toEqual(['startWave']); // 仅 t<=5
    expect(s.takeReady(20).map((a) => a.op)).toEqual(['summon']);   // 其余
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npx vitest run src/pvp-battle.test.ts` Expected: FAIL
- [ ] **Step 3: 实现 `PvpSync`**（骨架，字段/方法据测试补全）

```ts
import type { PvpAction, PvpDigest, TickRequest, TickResponse } from './api/pvp-client';

const SIM_DT_MS = 1000 / 30;
export interface PvpSyncOpts { matchId: string; seed: number; startAtServerMs: number; serverOffsetMs: number; now: () => number }

export class PvpSync {
  readonly matchId: string; readonly seed: number;
  private startAt: number; private offset: number; private now: () => number;
  private outbound: PvpAction[] = [];
  private inbound: PvpAction[] = [];        // 对手动作，按 t 升序
  lastServerContactMs = 0;
  constructor(o: PvpSyncOpts) { this.matchId = o.matchId; this.seed = o.seed; this.startAt = o.startAtServerMs; this.offset = o.serverOffsetMs; this.now = o.now; }
  private serverNow() { return this.now() + this.offset; }
  simTick(): number { return Math.max(0, Math.floor((this.serverNow() - this.startAt) / SIM_DT_MS)); }
  record(a: Omit<PvpAction, 't'>): void { this.outbound.push({ ...(a as object), t: this.simTick() } as PvpAction); }
  drainOutbound(): PvpAction[] { const o = this.outbound; this.outbound = []; return o; }
  ingestOpponent(actions: PvpAction[]): void { this.inbound.push(...actions); this.inbound.sort((x, y) => x.t - y.t); }
  /** 取出 t<=simTick 的对手动作（供应用器施加），从缓冲移除 */
  takeReady(simTick: number): PvpAction[] { const r: PvpAction[] = []; while (this.inbound.length && this.inbound[0]!.t <= simTick) r.push(this.inbound.shift()!); return r; }
  buildTick(digest: PvpDigest, waveClearedAt: TickRequest['waveClearedAt'], status: TickRequest['status']): TickRequest {
    return { matchId: this.matchId, clientMs: this.now(), inputs: this.drainOutbound(), digest, waveClearedAt, status };
  }
  applyResponse(r: TickResponse): void { this.ingestOpponent(r.opponentInputs); this.lastServerContactMs = this.now(); /* 时钟微调可选 */ }
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): pvp-battle PvpSync（simTick/出入站缓冲/tick 组装）"`

---

## Task 3：Battle 构造加 `pvp` 选项（关本地 AI、用服务端 seed）

**Files:**
- Modify: `web/src/battle.ts`（构造 `:1789-1801`，AI 初始化块 `:1806-1896`）
- Test: `web/src/battle.pvp-ctor.test.ts`

新增**可选末位参数** `pvp?: PvpInit`（`{ enabled: true }`），不破坏现有 11 参调用点（`main.ts:398,835`、`versus-user-agent.ts:158`）。`enabled` 时：跳过 `rollAiLoadout`（:1865）、`aiSummonTimer/aiRepositionTimer` 初值（:1888-1889）、`versusBand`/`effectiveSkill`/`aiWeaponBonuses`（:1806-1812 改为中性值）、DevTools 强制英雄（:1893-1896）；**保留** `aiPath/aiCells/aiUnlocked/aiActiveSlots` 容器与 `aiRng`（对手侧确定性战斗仍需）。seed 由调用方传服务端值（构造已收 seed，无需改）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { Battle } from './battle';
import { MAPS } from './board';

describe('Battle pvp 构造', () => {
  it('pvp 模式不本地生成 AI 配装/征兵计时（对手侧起始为空、等回放）', () => {
    const b = new Battle(123, 1, MAPS[0]!, undefined, {}, [], [], false, undefined, 1, undefined, { enabled: true });
    const s = b.snapshot();
    // 对手侧无本地 AI 决策产生的初始单位/字（容器存在但为空）
    expect(b.aiUnits.length).toBe(0);
    expect(s.aiDefeated).toBe(false);
    // 本方侧照常可用（不受 pvp 影响）
    expect(b.wave).toBe(0);
  });
  it('pvp=false（默认）行为与既有一致（回归）', () => {
    const b = new Battle(123, 1, MAPS[0]!);
    expect(b.wave).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（`pvp` 参数/行为未实现）
- [ ] **Step 3: 实现** — 定义 `export interface PvpInit { enabled: boolean }`；构造签名末位加 `pvpInit?: PvpInit`；存 `this.pvp = pvpInit?.enabled ?? false`（新私有字段）；用 `if (!this.pvp)` 包住上述"跳过"清单（`rollAiLoadout` 及计时初值等），rubber-band 相关在 pvp 时取中性（`versusBand=1`/`effectiveSkill=aiSkill`/`aiWeaponBonuses=weapons` 不缩放）；DevTools 强制英雄块加 `&& !this.pvp`。
- [ ] **Step 4: 跑测试确认通过** — Expected: PASS
- [ ] **Step 5: 回归** — Run: `npx vitest run`（含 `ai-balance`、`versus-user-agent`、`support-heroes`）Expected: 全过（单人路径未变）
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): Battle 构造 pvp 选项（关本地AI配装/技能/rubber-band，保留对手侧容器）"`

---

## Task 4：main.ts `frame()` 固定步长累加器（PvP 门）

**Files:**
- Modify: `web/src/main.ts`（`frame()` step 调用点 `:1965-1973`）
- Test: `web/src/pvp-fixedstep.test.ts`（纯累加器逻辑抽函数测）

抽一个纯函数 `drainFixedSteps(acc, dt, fixed, maxSteps)` → `{ steps, rest }`，在 `frame()` 里 PvP 时用它按 1/30 多次 `step`，非 PvP 走原可变 dt。抽函数便于单测帧率无关性。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { drainFixedSteps } from './pvp-fixedstep';

describe('drainFixedSteps', () => {
  it('累计足够整步才切片，余量留下', () => {
    const F = 1 / 30;
    let r = drainFixedSteps(0, 0.05, F, 8); expect(r.steps).toBe(1); // 0.05/0.0333=1 步，余 0.0167
    r = drainFixedSteps(r.rest, 0.05, F, 8); expect(r.steps).toBe(2); // 累计 0.0667 → 2 步
  });
  it('不同 dt 切法累计步数一致（帧率无关）', () => {
    const F = 1 / 30; const total = 1.0;
    const count = (chunk: number) => { let acc = 0, n = 0; for (let t = 0; t < total - 1e-9; t += chunk) { const r = drainFixedSteps(acc, chunk, F, 999); n += r.steps; acc = r.rest; } return n; };
    expect(count(1 / 60)).toBe(count(1 / 20)); // 都应 = 30
  });
  it('maxSteps 兜底防卡顿雪崩', () => { expect(drainFixedSteps(0, 10, 1 / 30, 8).steps).toBe(8); });
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL
- [ ] **Step 3: 实现** — `web/src/pvp-fixedstep.ts`

```ts
export const PVP_SIM_DT = 1 / 30;
/** 固定步长累加器：把可变 dt 累计后按 fixed 切片，返回应跑步数与余量。maxSteps 防卡顿后一次跑太多。 */
export function drainFixedSteps(acc: number, dt: number, fixed: number, maxSteps: number): { steps: number; rest: number } {
  let a = acc + dt; let steps = 0;
  while (a >= fixed && steps < maxSteps) { a -= fixed; steps++; }
  if (steps >= maxSteps) a = 0; // 雪崩时丢弃积压，避免螺旋
  return { steps, rest: a };
}
```

- [ ] **Step 4: main.ts 接入** — 在 `frame()` 的 step 门禁块（`:1965-1973`）：新增模块级 `let pvpAcc = 0;`；当 `pvpController?.inBattle`（或 `battle` 处于 pvp 标记）时：
```ts
const { steps, rest } = drainFixedSteps(pvpAcc, dt, PVP_SIM_DT, 8);
pvpAcc = rest;
for (let i = 0; i < steps; i++) { battle.step(PVP_SIM_DT); onPvpSimTick(); if (battle.status === 'won' || battle.status === 'lost') break; }
```
非 pvp 分支保留原 `battle.step(dt)`。`onPvpSimTick()` 先留空占位（Task 7 填对手动作应用 + tick 上报节流）。
- [ ] **Step 5: 跑测试 + typecheck** — Run: `npx vitest run src/pvp-fixedstep.test.ts && npm run typecheck 2>&1 | grep -E 'main\.ts|pvp-fixedstep' || echo clean` Expected: PASS + 无新错
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 固定步长累加器 drainFixedSteps + frame() PvP 门（单人保持可变dt）"`

---

## Task 5：`updateAi` PvP 分支 = 对手动作应用器

**Files:**
- Modify: `web/src/battle.ts`（`updateAi` `:5320-5426`；复用 `aiPlaceFromTray:3041`/AI 版 `dragUnit`/`aiSummon:3148`）
- Test: `web/src/battle.pvp-apply.test.ts`

PvP 时 `updateAi` 的 **A（征兵+布阵决策 :5323-5372）/B（战中调整 :5373-5385）** 两段替换为「按 simTick 施加对手转发动作」；**C（战斗 :5386-5396）/D（推怪+扣血+产桃 :5397-5425）保留**。新增 `applyOpponentAction(a: PvpAction)`：把 `place/move/merge/recall/shovel/active/autoplace/summon(带 tray 结果)/startWave/claimDrop` 映射到 `ai*` 写入。对手 `summon` 必须带其**抽字结果**（不本地滚 `aiRng` 抽字），保证两端 tray 一致。

- [ ] **Step 1: 写失败测试**（应用一条 place 动作，对手侧出现该单位）

```ts
import { describe, it, expect } from 'vitest';
import { Battle } from './battle';
import { MAPS } from './board';

describe('applyOpponentAction', () => {
  it('summon(带tray) + place → 对手侧 aiUnits 落在指定格', () => {
    const b = new Battle(1, 1, MAPS[0]!, undefined, {}, [], [], false, undefined, 1, undefined, { enabled: true });
    b.startNextWave(); // 进 playing，允许放置
    b.applyOpponentAction({ t: 1, op: 'summon', tray: ['金'] });
    const before = b.aiUnits.length;
    const cell = b.aiUnlockedCells?.()[0] ?? { c: 0, r: 0 }; // 取一个对手侧合法格（据实现）
    b.applyOpponentAction({ t: 2, op: 'place', token: '金', cell: `r${cell.r}c${cell.c}` });
    expect(b.aiUnits.length).toBe(before + 1);
  });
});
```
> 具体断言字段（`aiUnits` 结构、格串格式 `rNcM`）实现时对齐 `battle.ts` 现状微调；重点是「应用后对手侧状态确有变化」。

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL
- [ ] **Step 3: 实现 `applyOpponentAction`** + `updateAi` PvP 分支：`if (this.pvp) { for (const a of this.pvpDrainReady()) this.applyOpponentAction(a); /* 跳过 A/B 决策 */ } else { /* 原 A/B */ }`；C/D 段在 `if` 外照跑。`pvpDrainReady` 由外部（Task 7）喂入本 tick 已就绪的对手动作（或 Battle 持一个待应用队列，`main.ts` 每 simTick 灌入）。**决策**：为不把网络塞进 battle，`applyOpponentAction` 逐条公开、由 `main.ts` 的 `onPvpSimTick` 驱动 `sync.takeReady(simTick)` 后逐条调；`updateAi` 里 PvP 只做「不执行本地 A/B」。→ 简化为：`updateAi` PvP 时**只跳过 A/B**，C/D 保留；应用器在 `onPvpSimTick` 调。
- [ ] **Step 4: 跑测试确认通过** — Expected: PASS
- [ ] **Step 5: 回归** — `npx vitest run`（单人 `updateAi` 未变，`ai-balance` 过）
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): updateAi PvP 分支跳过本地决策 + applyOpponentAction 应用对手动作到对手侧"`

---

## Task 6：本方 12 个输入点打点（出站动作）

**Files:**
- Modify: `web/src/main.ts`（§ 输入调用点：summon `:1356`、autoPlaceTray `:1357`、placeFromTray `:1804`、dragBoard `:1822`、recallToTray `:1813`、mergeTrayTokens `:1807`、triggerActive `:1362`、applyPillActive/placeBomb `:1787-1788`、startNextWave `:2103`、claimWeaponPickup `:1207` 等）
- Test: `web/src/pvp-record.test.ts`（对打点映射函数单测）

抽 `toPvpAction(kind, payload, trayResult?)` 纯函数做「输入→PvpAction」映射，`main.ts` 各点在**操作成功后**（返回 true / 确有变更）调 `pvpSync?.record(action)`。`summon`/`autoPlaceTray` 带**结果**：summon 记录抽到的 tray 字；autoPlace 记录落格清单（读 `battle` 布阵后结果，非指令）。

- [ ] **Step 1: 写失败测试**（映射函数）

```ts
import { describe, it, expect } from 'vitest';
import { toPvpAction } from './pvp-record';
describe('toPvpAction', () => {
  it('place 映射带 token/cell', () => {
    expect(toPvpAction('place', { token: '金', cell: 'r2c4', index: 0 })).toMatchObject({ op: 'place', token: '金', cell: 'r2c4' });
  });
  it('autoplace 映射结果落格清单', () => {
    expect(toPvpAction('autoplace', { cells: [{ token: '木', cell: 'r1c1' }] })).toMatchObject({ op: 'autoplace', cells: [{ token: '木', cell: 'r1c1' }] });
  });
  it('summon 带抽字结果', () => {
    expect(toPvpAction('summon', { tray: ['水'] })).toMatchObject({ op: 'summon', tray: ['水'] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL
- [ ] **Step 3: 实现** `web/src/pvp-record.ts` 的 `toPvpAction`（不含 `t`，`t` 由 `PvpSync.record` 补）；然后在 `main.ts` 每个输入点成功后 `if (pvpSync) pvpSync.record(toPvpAction(...))`。**注意**：`summon()`/`autoPlaceTray()` 返回后从 `battle` 读结果（新入 tray 的字 / 新落格单位）再 record。
- [ ] **Step 4: 跑测试 + typecheck** — Expected: PASS + 无新错
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): 本方输入点打点为 PvpAction（summon/autoplace 带结果）+ toPvpAction 映射"`

---

## Task 7：`onPvpMatched` 建 PvP 局 + tick 循环接线

**Files:**
- Modify: `web/src/main.ts`（`onPvpMatched` `:284`；新增 `startPvpBattle(ms)`/`onPvpSimTick`/`pumpPvpTick`）
- Test: 浏览器冒烟（本任务后做一次；纯逻辑部分靠 Task 1/2 单测）

`onPvpMatched(ms: MatchStart)` 从「弹 toast 回首页」改为：注入本方养成配装（同 `newGame`），`new Battle(ms.seed, …, { enabled: true })`，建 `pvpSync = new PvpSync({ matchId, seed, startAtServerMs, serverOffsetMs, now: performance.now })`，`spendStamina(STAMINA_COST)`（真正开打才扣，双方各扣），`screen='battle'`，启动 tick 轮询（1s + 有出站动作时 ~300ms 去抖 flush）。`onPvpSimTick`：`for (const a of pvpSync.takeReady(battle.simTickForPvp())) battle.applyOpponentAction(a)`。`pumpPvpTick`：组装 digest（`battle.snapshot()`→`{wave,power=towerPow,kills,tangsengHP,peach,units}`）→ `versusTick` → `pvpSync.applyResponse` + 处理 `nextWave`/`result`/`opponentStatus`/`cheatNotice`。

- [ ] **Step 1: 实现 `startPvpBattle`** — 参照 `newGame()`（`main.ts:790` 附近）注入配装，用 `ms.seed`，`{ enabled: true }`；存 `pvpSync`；`screen='battle'`；`scheduleFrame()`。
- [ ] **Step 2: 实现 tick 轮询** — `setInterval`/递归 `setTimeout` 每 1000ms 调 `pumpPvpTick`；出站非空时 300ms 去抖提前 flush；`pumpPvpTick` 用 `versusTick`（Task 1）；失败（`ok:false`）计连续失败数，>6s 无成功 → 本地提示「连接中断」。
- [ ] **Step 3: 填 `onPvpSimTick`**（Task 4 占位）— 应用 `takeReady` 的对手动作。
- [ ] **Step 4: 终局/下一波接线**（先接 result → 进结算占位；nextWave → 见 Task 8）。
- [ ] **Step 5: typecheck + 构建** — `npm run typecheck`（无新错）`+ npm run build`
- [ ] **Step 6: 浏览器冒烟**（见「验收：冒烟脚本」）— mock `/api/versus/tick` 返回对手一条 `place` → 断言对手侧 `aiUnits` 出现、无 pageerror、体力扣 5。
- [ ] **Step 7: Commit** — `git commit -m "feat(pvp-web): onPvpMatched 建 PvP 局并接 tick 循环（confirm 开打扣体力/对手动作应用/摘要上报）"`

---

## Task 8：先清者定波次（服务端 nextWave 驱动 spawn）

**Files:**
- Modify: `web/src/battle.ts`（波间计时 `nextWaveTimer:1691`/`step` `:6735,:6805`；清波判定 `:6801`）、`web/src/main.ts`（`pumpPvpTick` 处理 `nextWave`；清波上报 `waveClearedAt`）
- Test: `web/src/battle.pvp-wave.test.ts`

PvP 时**本地 `nextWaveTimer` 不自动开下一波**；改由服务端 `nextWave.startAtServerMs`（对齐本地时钟）到点触发 `startNextWave()`。本方清波（`monsters.length===0 && spawnRemaining===0`）时置 `waveClearedAt={wave,t=simTick}` 供本 tick 上报。

- [ ] **Step 1: 写失败测试** — pvp 局清波后 `status` 停在 `'ready'` 且**不**因本地计时自动进下一波（需外部 `startPvpWave(n, atMs)` 才开）。
```ts
it('pvp 清波后不本地自动开下一波，需服务端信号', () => {
  const b = new Battle(1, 1, MAPS[0]!, undefined, {}, [], [], false, undefined, 1, undefined, { enabled: true });
  b.startNextWave();
  // 模拟清空本方怪（据实现清 monsters + spawnRemaining=0），step 若干秒
  // 断言：即使 step 超过 waveGapSec，wave 不自增（PvP 门禁生效）
});
```
- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL
- [ ] **Step 3: 实现** — `step` 中波间自动 `startNextWave()` 前加 `if (!this.pvp)`；PvP 靠新增 `pvpStartWaveAt(wave, localMs)`（记目标时刻，`step` 到点 spawn）或由 `main.ts` 直接在时钟到点调 `startNextWave()`。清波处置 `this.waveClearedAt`。
- [ ] **Step 4: main.ts 接线** — `pumpPvpTick` 收到 `nextWave` → 换算本地时刻 → 到点 `battle.startNextWave()`；上报时带 `battle.consumeWaveCleared()`。
- [ ] **Step 5: 测试 + 回归** — Expected: PASS，单人波次不受影响
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 波次开始改服务端先清者驱动（PvP 关本地自动开波 + 清波上报）"`

---

## Task 9：断线 / 认输 / 胜负

**Files:**
- Modify: `web/src/pause-popup.ts`（`context:'match'|'battle'`）、`web/src/main.ts`（暂停分支 `:1434` 附近、status 轮询 `:1981`、`pumpPvpTick` 的 `result`/`opponentStatus`）
- Test: `web/src/pause-popup.test.ts`（加 context 断言）

- 暂停区 PvP：`context:'match'` 显示「认输」；确认 → `pvpSync` status 置 `surrender`、立即 flush tick、等服务端 `result:lose/selfSurrender`。
- 本方唐僧血→0：`battle.status='lost'`（现有），PvP 时上报 `status:tangsengDead`，等服务端 `result`（避免双方各判）。
- 服务端 `result` 是终局权威：`pumpPvpTick` 收到 → 置本地终局 + 记原因（`opponentTangsengDead/opponentSurrender/opponentDisconnectTimeout/selfTangsengDead/selfSurrender/draw`）→ 进 PvP 结算（Task 10）。
- `opponentStatus:'disconnected'` → UI 提示「对手连接中断…」；服务端超 6s 会给 `result:win/opponentDisconnectTimeout`。
- 本方 >6s 无 tick 成功 → 本地提示「网络中断，可能判负」。

- [ ] **Step 1: pause-popup 加 context** — 写失败测试：`context:'match'` 时按钮文案含「认输」；实现 `PausePhase`/绘制分支。
- [ ] **Step 2: main.ts 暂停分支** — PvP 局暂停走 `context:'match'`；确认认输 → 置 surrender 并 flush。
- [ ] **Step 3: 终局权威接线** — `pumpPvpTick` 的 `result` 驱动终局；`status` 轮询 `:1981` 的 `endHandled` 门禁复用（PvP 时终局来源改服务端 result 而非本地 status）。
- [ ] **Step 4: 断线 UI** — `opponentStatus`/本地失败计数 → toast。
- [ ] **Step 5: 测试 + typecheck** — Expected: PASS + 无新错
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 认输/断线/服务端权威终局接线（pause context:match + result 裁决）"`

---

## Task 10：PvP 结算分支

**Files:**
- Modify: `web/src/settle.ts`（PvP 分支）、`web/src/main.ts`（结算入口 `:1981` 后、返回首页）
- Test: `web/src/settle.pvp.test.ts`

PvP 结算：展示 胜/负/平 + 原因文案 + 对手头像昵称；**不加减星、不触发神秘商人、不动境界/功德**；上报 `pvp_result`（若服务端 result 已落库则前端仅展示）；「返回首页」清 `pvpSync`/`battle`、`screen='menu'`。

- [ ] **Step 1: 写失败测试** — `drawPvpSettle(ctx, { outcome, reason, opponent })` 存在且按 outcome 出不同标题；`pvpSettleHitAt` 命中「返回首页」。
- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL
- [ ] **Step 3: 实现** — `settle.ts` 加 `drawPvpSettle`/`pvpSettleHitAt`（复用 `drawInkActionButton`、对手头像用 `avatarById`）；`main.ts` PvP 终局走此分支而非 `drawSettle`。
- [ ] **Step 4: 测试 + 浏览器冒烟** — 模拟 result:win → 结算屏出「胜利·对手唐僧被吃」+ 返回首页可点回菜单。
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): PvP 结算屏（胜负平+原因+对手，不加减星/不触商人/不动境界）"`

---

## Task 11：确定性单测（§13 核心）

**Files:**
- Test: `web/src/pvp-determinism.test.ts`

- [ ] **Step 1: 写测试** — 同 seed + 同一放置动作流，喂给两个独立 `Battle(pvp)` 实例，逐 tick 跑固定步长，断言关键不变量（`wave/tangsengHP/units/towerPow`）**逐检查点一致**；再验固定步长在 `1/60` vs `1/20` 帧切法下同 seed 结果一致（复用 `drainFixedSteps`）。
```ts
it('同 seed + 同动作流 → 两实例逐检查点一致', () => {
  const run = () => { const b = new Battle(777, 1, MAPS[0]!, undefined, {}, [], [], false, undefined, 1, undefined, { enabled: true }); b.startNextWave(); for (let i = 0; i < 300; i++) b.step(1 / 30); return b.snapshot(); };
  const a = run(), c = run();
  expect(a.tangsengHP).toBe(c.tangsengHP); expect(a.wave).toBe(c.wave); expect(a.towerPow).toBe(c.towerPow);
});
```
- [ ] **Step 2: 跑测试** — Expected: PASS（若不 PASS 说明有非确定源潜入，须查 `Math.random`/`performance.now` 进入判定）
- [ ] **Step 3: Commit** — `git commit -m "test(pvp-web): PvP 确定性（同seed同动作流逐检查点一致 + 固定步长帧率无关）"`

---

## Task 12：单人零回归护栏 + 全门禁

**Files:**
- Test: 复用既有 + 一条断言「pvp=false 时 updateAi 决策路径与主循环 dt 未变」

- [ ] **Step 1: 断言 PvP 关时行为不变** — 写测试：`Battle(默认)` 不含 pvp 时 `updateAi` 仍产生本地 AI 决策（对手侧随 step 会出单位），主循环仍可变 dt（通过 `frame` 门禁：非 pvp 不走 `drainFixedSteps`）。
- [ ] **Step 2: 全量门禁** — Run: `cd web && npx vitest run`（**含 `ai-balance` 与 `versus-user-agent`**）Expected: 全过。`npm run typecheck 2>&1 | grep -E 'pvp|main\.ts'` 无新错。`npm run build` 成功。
- [ ] **Step 3: 浏览器冒烟（真机路径）** — 见下「验收」；跑通 匹配→开打→放置互见→（mock）先清定波→（mock）result 胜负→结算回首页；0 pageerror。
- [ ] **Step 4: Commit** — `git commit -m "test(pvp-web): 单人零回归护栏 + 全门禁（ai-balance/vitest/typecheck/build/冒烟）"`

---

## 验收：浏览器冒烟脚本（贯穿 Task 7/10/12）

沿用既有 puppeteer 冒烟法（`web/tools/`，puppeteer-core + 本机 Chrome + `window.__game.curScreen()`）。**要点**：
- worktree dev server 跑在**独立端口**（如 5185，`npx vite --port 5185 --strictPort`），勿用 `./start.sh bg`（会杀 5180 主检出）。
- `page.evaluateOnNewDocument` mock `window.fetch` 的 `/api/versus/*`：enqueue→ticket、poll→matched(带 MatchStart)、**tick→构造对手 `place` 动作 / nextWave / result**。
- 断言：进 `battle` 屏、对手侧 `aiUnits` 因 tick 回放出现、体力扣 5、result→结算屏、0 pageerror（过滤跨域 CDN/BGM 噪声）。
- 画布被跨域素材污染 → **不要** `getImageData` 判黑，用 `page.screenshot` 人工核对 + `curScreen()` 断言。
- 临时脚本用后即删（`web/tools/_pvp-*.mjs`）。

---

## 自检（写完计划回看 spec）

- **spec 覆盖**：§5 同步（seed/tick/simTick=Task1-2、动作流=Task5-6）、§5.3 先清定波（Task8）、§6 引擎改动（构造 Task3 / updateAi Task5 / 主循环 Task4 / 波次 Task8 / 胜负 Task9）、§8 心跳断线（Task9）、§4.3 匹配屏（Plan B 已）、结算（Task10）、§13 测试（Task11-12）。**§7 反作弊端上重放交叉核对 → Plan D**（本计划只产/传 digest）。**§3.1 延迟重放平滑插值 → 后续 polish**（D1，不阻断可玩）。
- **类型一致**：`PvpAction`/`TickRequest`/`TickResponse`（Task1）贯穿 Task2/5/6/7；`PvpInit`（Task3）；`drainFixedSteps`/`PVP_SIM_DT`（Task4）。
- **占位符扫描**：无 TODO/待定；每任务有测试与命令。个别 `battle.ts` 内部字段名（`aiUnlockedCells`/格串格式）标注"实现时对齐现状微调"——因 7000 行文件内部命名需落地核对，非占位符而是显式的落地校准点。
