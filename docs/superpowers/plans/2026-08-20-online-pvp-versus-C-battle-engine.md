# 在线 PvP 对战 · Plan C（对局引擎）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal：** 把现有单人「合成+对称塔防」对局受控改造成在线真人 PvP——固定步长确定性循环、放置动作转发/回放、先清者定波次、断线/认输/胜负结算——匹配成功后两名真人真正开打，且对手侧为**全保真**确定性重放。

**Architecture：** 复用单 `Battle` 实例的「双棋盘」（本方 `this.monsters/units` + 对手侧 `this.aiMonsters/aiUnits`）。本方半场由本机**固定步长(1/30)确定性实时模拟**（权威）；对手半场是把服务端转发来的对手放置动作**在延迟时间线上（落后本地 `DELAY_TICKS≈0.5s`）确定性重放**——因两端各用同一 `MatchStart.seed` 播种自己的 `this.rng`，对手的怪物波序与本方完全一致，故对手侧只需「整体延后 DELAY + 按对手战力定血 + 渲染插值」即成为其真实半场的忠实（时移）复现。**波次开始时间与终局胜负走服务端实时消息**（Plan A 已实现服务端侧），与展示用重放解耦。新增 `web/src/pvp-battle.ts` 持有 simTick/延迟记账、动作缓冲、tick 网络桥接，避免把网络塞进 7000 行 `battle.ts`。

**Tech Stack：** TypeScript + Canvas + Vite；vitest；确定性 mulberry32（`rng.ts`）；`apiFetch`（X-Uid 自动）；服务端 Python 已就绪（Plan A）。

---

## 关键设计决策（已与用户确认：**D1+D2 全保真**）

- **D1 · 对手侧延迟时间线重放 + 渲染插值（本期做）。** 对手半场整体运行在 `aiClock = localClock − DELAY_TICKS`（`DELAY_TICKS=15`，0.5s @1/30，常量可调）：对手动作在 `aiSimTick ≥ a.t` 时施加（`takeReady(aiSimTick)`），对手怪物生成/波次推进/战斗 C/D 均由 `aiClock` 驱动 → 对手半场 = 其真实半场时移 DELAY 的忠实复现（顺滑、按正确相对时序）。迟到（网络>DELAY）动作即时补应用（小顿）。渲染对**双方**单位/怪物做位置插值（存 prev/cur，按 `acc/FIXED` 线性插值），任意帧率平滑。
- **D2 · 对手回放侧怪物血按对手战力保真（本期做）。** 对手侧波血由**对手侧战力**决定：`computeWavePressure(wave, estimateOptimalPower(对手侧))`，而非复用本方 `wavePressure`。对手侧战力来自延迟重放后的 `aiUnits`（确定性），故 HP 确定、`各算各的`观感成立。
- **D3 · 固定步长只在 PvP 启用。** 单人保持可变 dt 老路径（`ai-balance` 门禁敏感，不动），零回归。PvP 走 1/30 累加器（照搬 `versus-user-agent.ts` 已验证的固定子步）。
- **D4 · 权威 seed / 关本地 AI。** PvP 局用 `MatchStart.seed`；跳过 `rollAiLoadout`/`newBattleAiSkill`/rubber-band；DevTools 强制英雄在 PvP 关闭（破坏 tray 对称）。**对手侧怪物用独立 `RNG(seed)` 流**（镜像对手机的 `this.rng`），与本方 `this.rng` 同序但独立推进（延迟时间线）。
- **D5 · 反作弊分层落点。** 本计划只**产出并上报**每 1s 的 `digest`（服务端 backstop=Plan A 已用）。**端上重放交叉核对** 留 **Plan D**。

> **确定性红线**：PvP 局绝不可引入 `Math.random`/`Date.now`/`new Date`；两处 `performance.now()` 规划器 deadline（`battle.ts:5346` AI 规划、`:7075` 一键布阵）在 PvP 下**不得进入判定**——本方一键布阵**转发结果落格清单**，对手侧不跑规划器。延迟重放不破坏确定性：每侧结果 = f(seed, 动作流, 固定 DELAY)，可复现、可单测。

---

## 文件结构（创建/修改）

| 文件 | 责任 | 动作 |
|------|------|------|
| `web/src/api/pvp-client.ts` | 加 `versusTick()` + Tick 请求/响应类型 | 修改 |
| `web/src/pvp-battle.ts` | **新**：simTick + 延迟时钟、出/入站动作缓冲、tick 组装/分发、断线检测 | 创建 |
| `web/src/pvp-fixedstep.ts` | **新**：`drainFixedSteps` 累加器 + `PVP_SIM_DT`/`DELAY_TICKS` | 创建 |
| `web/src/pvp-record.ts` | **新**：`toPvpAction` 输入→动作映射 | 创建 |
| `web/src/battle.ts` | 构造 `pvp` 选项；对手侧延迟时钟 + 独立怪物流 + 波血按对手战力；`applyOpponentAction`；`updateAi` PvP 分支；插值用 prev/cur 位置；`snapshot` 补 `kills` | 修改 |
| `web/src/render.ts` | 双方单位/怪物位置插值渲染（读 prev/cur + alpha） | 修改 |
| `web/src/main.ts` | `frame()` 固定步长累加器 + 插值 alpha（PvP 门）；12 输入点打点；`onPvpMatched` 建局 + tick 循环；status/result 终局；深链 join | 修改 |
| `web/src/pause-popup.ts` | `context:'match'` → 「认输」 | 修改 |
| `web/src/settle.ts` | PvP 结算分支（胜/负/平 + 原因 + 对手） | 修改 |
| `web/src/*.test.ts` | 各任务 vitest | 创建 |

---

## 里程碑与任务总览（全保真 15 任务）

- **C-α 确定性骨架**（T1-4）：tick 客户端 + PvpSync（含延迟）+ PvP 构造 + 固定步长累加器。
- **C-β 对手侧全保真重放**（T5-8）：动作应用器 + 延迟时间线独立驱动 + 对手战力定波血(D2) + 渲染插值(D1)。
- **C-γ 本方输入与接线**（T9-10）：12 输入点打点 + `onPvpMatched` 建局接 tick 循环。
- **C-δ 服务端耦合与终局**（T11-13）：先清者定波次 + 断线/认输/权威终局 + PvP 结算。
- **C-ε 确定性与回归护栏**（T14-15）：确定性单测（含延迟重放/插值帧率无关）+ 单人零回归门禁。

---

## Task 1：pvp-client 增 `versusTick` + Tick 类型

**Files:** Modify `web/src/api/pvp-client.ts`；Test `web/src/api/pvp-client.tick.test.ts`（新）

对齐 spec §5.2。`op` 判别联合，`t`=simTick 整数。

- [ ] **Step 1: 写失败测试**
```ts
import { describe, it, expect, vi } from 'vitest';
import { versusTick, type TickRequest } from './pvp-client';
import * as client from './client';
describe('versusTick', () => {
  it('POST /api/versus/tick，透传 body，解出 opponentInputs', async () => {
    const spy = vi.spyOn(client, 'apiFetch').mockResolvedValue({ ok: true, status: 200,
      data: { serverMs: 111, opponentInputs: [{ t: 5, op: 'summon' }], opponentDigest: null, nextWave: null, opponentStatus: 'playing', result: null, cheatNotice: null } });
    const req: TickRequest = { matchId: 'm1', clientMs: 100, inputs: [{ t: 3, op: 'summon' }],
      digest: { wave: 1, power: 10, kills: 0, tangsengHP: 3, peach: 5, units: 2 }, waveClearedAt: null, status: 'playing' };
    const r = await versusTick(req);
    expect(spy).toHaveBeenCalledWith('/api/versus/tick', expect.objectContaining({ method: 'POST' }));
    expect(r.ok && r.data.opponentInputs[0].op).toBe('summon');
  });
});
```
- [ ] **Step 2: 跑测试确认失败** — Run `cd web && npx vitest run src/api/pvp-client.tick.test.ts` Expected FAIL
- [ ] **Step 3: 实现** — 追加类型与函数
```ts
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
export interface PvpDigest { wave: number; power: number; kills: number; tangsengHP: number; peach: number; units: number }
export interface TickRequest { matchId: string; clientMs: number; inputs: PvpAction[]; digest: PvpDigest; waveClearedAt: { wave: number; t: number } | null; status: 'playing' | 'tangsengDead' | 'surrender' }
export type PvpOutcome = 'win' | 'lose' | 'draw';
export interface TickResponse { serverMs: number; opponentInputs: PvpAction[]; opponentDigest: PvpDigest | null; nextWave: { wave: number; startAtServerMs: number } | null; opponentStatus: 'playing' | 'disconnected' | 'surrendered' | 'tangsengDead'; result: null | { outcome: PvpOutcome; reason: string }; cheatNotice: null | { banned: true; msg: string } }
export function versusTick(req: TickRequest): Promise<ApiResult<TickResponse>> { return apiFetch<TickResponse>('/api/versus/tick', J(req)); }
```
- [ ] **Step 4: 跑测试确认通过** — Expected PASS
- [ ] **Step 5: 核对服务端契约** — 打开 `server/api_versus.py` 的 `tick`，逐字段核对键名/枚举（`opponentInputs`/`waveClearedAt`/`result.reason`）；不一致以服务端为准改客户端并在 commit 记录。
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): pvp-client 增 versusTick + Tick 类型（对齐服务端）"`

---

## Task 2：`pvp-battle.ts` — simTick + 延迟时钟 + 动作缓冲

**Files:** Create `web/src/pvp-battle.ts`；Test `web/src/pvp-battle.test.ts`

纯逻辑。职责：①从服务端时钟推 `simTick`；②延迟时钟 `aiSimTick = simTick − DELAY_TICKS`；③出站缓冲（本方打点）；④入站对手缓冲（按 t 有序，`takeReady(aiSimTick)` 取用）；⑤组装 `TickRequest`/分发 `TickResponse`；⑥断线检测。

- [ ] **Step 1: 写失败测试**
```ts
import { describe, it, expect } from 'vitest';
import { PvpSync } from './pvp-battle';
const clk = (ms: number) => () => ms;
describe('PvpSync', () => {
  it('simTick 与延迟 aiSimTick', () => {
    const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 1000, serverOffsetMs: 0, delayTicks: 15, now: clk(1000 + 1000) });
    expect(s.simTick()).toBe(30);          // 1000ms/33.33≈30
    expect(s.aiSimTick()).toBe(15);        // 30-15
  });
  it('本方打点→drainOutbound 有序清空', () => {
    let t = 1000; const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 1000, serverOffsetMs: 0, delayTicks: 15, now: () => t });
    t = 1066; s.record({ op: 'summon' }); t = 1132; s.record({ op: 'startWave' });
    expect(s.drainOutbound().map(a => a.op)).toEqual(['summon', 'startWave']);
    expect(s.drainOutbound()).toEqual([]);
  });
  it('入站对手动作按 t 归并，takeReady 只取 t<=给定值', () => {
    const s = new PvpSync({ matchId: 'm', seed: 1, startAtServerMs: 0, serverOffsetMs: 0, delayTicks: 0, now: clk(0) });
    s.ingestOpponent([{ t: 10, op: 'summon' }, { t: 2, op: 'startWave' }]);
    expect(s.takeReady(5).map(a => a.op)).toEqual(['startWave']);
    expect(s.takeReady(20).map(a => a.op)).toEqual(['summon']);
  });
});
```
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现 `PvpSync`**（含 `delayTicks`；`aiSimTick()=max(0,simTick()-delayTicks)`；`record/drainOutbound/ingestOpponent/takeReady/buildTick/applyResponse/lastServerContactMs`，全走注入的 `now`，无 `Date.now`）
- [ ] **Step 4: 跑测试确认通过** — Expected PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): PvpSync（simTick/延迟时钟/出入站缓冲/tick 组装）"`

---

## Task 3：Battle 构造加 `pvp` 选项

**Files:** Modify `web/src/battle.ts`（构造 `:1789-1801`，AI 初始化块 `:1806-1896`）；Test `web/src/battle.pvp-ctor.test.ts`

可选末位参 `pvpInit?: PvpInit`（`{ enabled, delayTicks? }`）；不破坏 11 参调用点。`enabled` 时跳过 `rollAiLoadout`(:1865)/`aiSummonTimer/aiRepositionTimer`(:1888-1889)/rubber-band(:1806-1812 取中性)/DevTools 强制英雄(:1893-1896)；保留 `aiPath/aiCells/aiUnlocked/aiActiveSlots` 容器；新增 `aiSpawnRng = new RNG(seed)`（镜像对手机 `this.rng`，供对手侧怪物 D2）。

- [ ] **Step 1: 写失败测试** — pvp 局 `b.aiUnits.length===0`、`snapshot().aiDefeated===false`、`wave===0`；默认(非 pvp)行为回归不变。
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现** — `export interface PvpInit { enabled: boolean; delayTicks?: number }`；`this.pvp`/`this.pvpDelayTicks`/`this.aiSpawnRng` 字段；`if (!this.pvp)` 包住跳过清单；rubber-band 中性；DevTools 块加 `&& !this.pvp`。
- [ ] **Step 4: 跑测试确认通过** — Expected PASS
- [ ] **Step 5: 回归** — `npx vitest run`（含 `ai-balance`/`versus-user-agent`/`support-heroes`）全过
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): Battle 构造 pvp 选项（关本地AI + aiSpawnRng 镜像对手怪物流）"`

---

## Task 4：固定步长累加器 + 插值 alpha（PvP 门）

**Files:** Create `web/src/pvp-fixedstep.ts`；Modify `web/src/main.ts`（`frame()` `:1965-1973`）；Test `web/src/pvp-fixedstep.test.ts`

- [ ] **Step 1: 写失败测试**
```ts
import { describe, it, expect } from 'vitest';
import { drainFixedSteps } from './pvp-fixedstep';
describe('drainFixedSteps', () => {
  const F = 1 / 30;
  it('累计足够整步才切片，余量留下', () => { let r = drainFixedSteps(0, 0.05, F, 8); expect(r.steps).toBe(1); r = drainFixedSteps(r.rest, 0.05, F, 8); expect(r.steps).toBe(2); });
  it('不同 dt 累计步数一致（帧率无关）', () => { const total = 1.0; const cnt = (c: number) => { let a = 0, n = 0; for (let t = 0; t < total - 1e-9; t += c) { const r = drainFixedSteps(a, c, F, 999); n += r.steps; a = r.rest; } return n; }; expect(cnt(1/60)).toBe(cnt(1/20)); });
  it('maxSteps 兜底', () => { expect(drainFixedSteps(0, 10, F, 8).steps).toBe(8); });
});
```
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现 `pvp-fixedstep.ts`**
```ts
export const PVP_SIM_DT = 1 / 30;
export const DELAY_TICKS = 15; // 对手侧延迟重放 0.5s，覆盖网络抖动
export function drainFixedSteps(acc: number, dt: number, fixed: number, maxSteps: number): { steps: number; rest: number } {
  let a = acc + dt; let steps = 0;
  while (a >= fixed && steps < maxSteps) { a -= fixed; steps++; }
  if (steps >= maxSteps) a = 0;
  return { steps, rest: a };
}
```
- [ ] **Step 4: main.ts 接入** — 模块级 `let pvpAcc = 0;`；PvP 局时：`const { steps, rest } = drainFixedSteps(pvpAcc, dt, PVP_SIM_DT, 8); pvpAcc = rest; for (i<steps) { battle.step(PVP_SIM_DT); onPvpSimTick(); if (终局) break; }`；渲染传插值 `alpha = pvpAcc / PVP_SIM_DT`（Task 8 用）。非 pvp 走原 `battle.step(dt)`。`onPvpSimTick` 先占位。
- [ ] **Step 5: 测试 + typecheck** — Expected PASS + 无新错
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 固定步长累加器 + 插值 alpha（PvP门，单人保持可变dt）"`

---

## Task 5：`applyOpponentAction` — 对手动作映射到对手侧

**Files:** Modify `web/src/battle.ts`（复用 `aiPlaceFromTray:3041`/AI 版 `dragUnit`/`aiSummon:3148`）；Test `web/src/battle.pvp-apply.test.ts`

新增 `applyOpponentAction(a: PvpAction)`：`summon(带tray结果)`/`place`/`move`/`merge`/`recall`/`shovel`/`active`/`autoplace(结果落格清单)`/`startWave`/`claimDrop` → `ai*` 写入。对手 `summon` 用**转发的抽字结果**（不本地滚 `aiRng` 抽字），保证两端 tray 一致。

- [ ] **Step 1: 写失败测试** — 应用 `summon{tray:['金']}` + `place{token:'金',cell}` → `aiUnits.length` +1（字段/格串格式实现时对齐现状）。
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现 `applyOpponentAction`** — 逐 op 分派到既有 AI 侧写入方法；`summon` 用传入 tray。
- [ ] **Step 4: 跑测试确认通过** — Expected PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): applyOpponentAction 把对手动作映射到对手侧状态"`

---

## Task 6：对手侧延迟时间线独立驱动（D1 核心）

**Files:** Modify `web/src/battle.ts`（`updateAi` `:5320-5426`；对手侧怪物生成从共享 `spawnMonster` 拆出）；Test `web/src/battle.pvp-delay.test.ts`

`updateAi` PvP 分支：**跳过 A/B 决策**；C/D（战斗/推怪/扣血/产桃）改由 `aiClock` 驱动（累计 `aiElapsed += dt`，实际处理 `aiSimTick = simTick − DELAY`）。对手侧怪物用 `aiSpawnRng`（Task 3）按**对手波次**在 `aiClock` 上生成（与本方同序、时移 DELAY）。对手动作由 `main.ts`（Task 9/10）每 sim tick `takeReady(aiSimTick)` 后逐条 `applyOpponentAction`。

- [ ] **Step 1: 写失败测试** — pvp 局：喂入对手 `summon+place@t=3`，本地 step 到 `simTick=3`（对手侧尚未到 `aiSimTick=3`，需到 `simTick=3+DELAY`）才见 `aiUnits` 变化 → 验证延迟应用时序。
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现** — `updateAi` 加 `if (this.pvp)` 分支：不跑 A/B；用 `aiElapsed` 累加，`aiClock` 驱动 C/D 与对手怪物生成（`aiSpawnRng`）；暴露 `pvpApplyReadyOpponent(aiSimTick, actions)` 或由外部灌入。对手侧怪物生成从 `spawnMonster` 抽出 `spawnAiMonster(...)`（用 `aiSpawnRng`、对手 wavePressure 见 Task 7）。
- [ ] **Step 4: 跑测试确认通过** — Expected PASS
- [ ] **Step 5: 回归** — 单人 `updateAi` 未变（`if(!this.pvp)` 原路径），`ai-balance` 过
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 对手侧延迟时间线重放（aiClock=local-DELAY 驱动对手怪物/战斗，动作按 aiSimTick 施加）"`

---

## Task 7：对手回放侧怪物血按对手战力（D2）

**Files:** Modify `web/src/battle.ts`（`spawnAiMonster`/`computeWavePressure:5017`/`estimateOptimalPower:4970`）；Test `web/src/battle.pvp-wavehp.test.ts`

对手侧波血由**对手侧战力**算：新增 `estimateOptimalPowerAi()`（对 `aiUnits` 复用 `estimateOptimalPower` 逻辑）→ `computeWavePressure(aiWave, aiPower)` → 供 `spawnAiMonster` 定 HP。与本方 `wavePressure` 解耦（`各算各的`）。

- [ ] **Step 1: 写失败测试** — 构造两局：对手侧放强/弱不同单位（经 `applyOpponentAction`），断言对手侧怪物 HP 随对手战力变化（强战力→高血），且**本方**怪物 HP 不受对手影响。
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现** — `estimateOptimalPowerAi()`；`spawnAiMonster` 用对手 wavePressure；确保确定性（纯 `aiUnits` 派生）。
- [ ] **Step 4: 跑测试确认通过** — Expected PASS
- [ ] **Step 5: 回归** — 单人不受影响（对手侧走 AI 决策时同样可用对手战力，但需 `ai-balance` 全过——若影响单人平衡则加 `if(this.pvp)` 仅 PvP 走对手战力，单人保持原共享逻辑）
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 对手回放侧怪物血按对手战力(各算各的, D2)"`

---

## Task 8：双方渲染位置插值（D1 顺滑）

**Files:** Modify `web/src/battle.ts`（单位/怪物存 `prevPos`/`curPos`）、`web/src/render.ts`（按 alpha 插值绘制）；Test `web/src/pvp-interp.test.ts`

每 `step` 前把 `curPos→prevPos`、step 后更新 `curPos`；渲染用 `alpha=pvpAcc/PVP_SIM_DT` 线性插值 `lerp(prevPos,curPos,alpha)`。PvP 门；非 pvp 直接用当前值（不改单人）。

- [ ] **Step 1: 写失败测试** — 纯函数 `lerpPos(prev, cur, alpha)`：alpha=0→prev，1→cur，0.5→中点。
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现** — `lerpPos`；battle 存 prev/cur（PvP 时）；render 读 alpha 插值（双方 monsters/units）。
- [ ] **Step 4: 跑测试 + typecheck** — Expected PASS + 无新错
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): 双方单位/怪物渲染位置插值（固定步长下顺滑, D1）"`

---

## Task 9：本方 12 输入点打点

**Files:** Modify `web/src/main.ts`（输入点：summon `:1356`/autoPlaceTray `:1357`/placeFromTray `:1804`/dragBoard `:1822`/recallToTray `:1813`/mergeTrayTokens `:1807`/triggerActive `:1362`/applyPillActive+placeBomb `:1787-1788`/startNextWave `:2103`/claimWeaponPickup `:1207`）；Create `web/src/pvp-record.ts`；Test `web/src/pvp-record.test.ts`

抽 `toPvpAction(kind,payload,result?)` 纯映射；各点**操作成功后**调 `pvpSync?.record(toPvpAction(...))`。`summon`/`autoPlaceTray` 带**结果**（抽到的字 / 落格清单）。

- [ ] **Step 1: 写失败测试**（`toPvpAction` place/autoplace/summon 映射）
- [ ] **Step 2: 跑测试确认失败** — Expected FAIL
- [ ] **Step 3: 实现** `pvp-record.ts` + main.ts 各点接入
- [ ] **Step 4: 测试 + typecheck** — Expected PASS + 无新错
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): 本方输入点打点为 PvpAction（summon/autoplace 带结果）"`

---

## Task 10：`onPvpMatched` 建 PvP 局 + tick 循环

**Files:** Modify `web/src/main.ts`（`onPvpMatched` `:284`；新增 `startPvpBattle`/`onPvpSimTick`/`pumpPvpTick`）；验收=浏览器冒烟

`onPvpMatched(ms)`：注入本方配装（同 `newGame`），`new Battle(ms.seed,…,{enabled:true,delayTicks:DELAY_TICKS})`，建 `pvpSync`，`spendStamina(STAMINA_COST)`（开打才扣），`screen='battle'`，启 tick 轮询（1s + 出站非空 ~300ms 去抖 flush）。`onPvpSimTick`：`for (const a of pvpSync.takeReady(battle.aiSimTick())) battle.applyOpponentAction(a)`。`pumpPvpTick`：`digest`（`snapshot`→`{wave,power=towerPow,kills,tangsengHP,peach,units}`）→ `versusTick` → `applyResponse` + 处理 `nextWave`(Task 11)/`result`(Task 12)/`opponentStatus`/`cheatNotice`。

- [ ] **Step 1-5:** 实现 `startPvpBattle`/tick 轮询/去抖/`onPvpSimTick`/失败计数(>6s 提示)；typecheck + build。
- [ ] **Step 6: 浏览器冒烟** — mock tick 返回对手 `place` → 对手侧 `aiUnits` 延迟出现、体力扣5、0 pageerror（见「验收」）。
- [ ] **Step 7: Commit** — `git commit -m "feat(pvp-web): onPvpMatched 建 PvP 局并接 tick 循环（开打扣体力/对手延迟应用/摘要上报）"`

---

## Task 11：先清者定波次（服务端 nextWave 驱动）

**Files:** Modify `web/src/battle.ts`（波间 `:6735,:6805`/清波 `:6801`）、`web/src/main.ts`（`pumpPvpTick` 处理 `nextWave` + 上报 `waveClearedAt`）；Test `web/src/battle.pvp-wave.test.ts`

PvP 时本地 `nextWaveTimer` 不自动开波；由服务端 `nextWave.startAtServerMs`（对齐本地时钟）触发 `startNextWave()`（本方与对手侧各按自己时钟到点 spawn，对手侧在 `aiClock`）。本方清波置 `waveClearedAt={wave,t=simTick}` 上报。

- [ ] **Step 1-2: 失败测试** — pvp 清波后 `status='ready'` 且不因本地计时自增 wave。
- [ ] **Step 3: 实现** — `step` 波间自动开波前加 `if(!this.pvp)`；PvP 由外部到点调 `startNextWave()`；清波置 `waveClearedAt`。
- [ ] **Step 4: main.ts 接线** — `nextWave` 换本地时刻到点开波；上报 `consumeWaveCleared()`。
- [ ] **Step 5: 测试 + 回归** — Expected PASS，单人波次不变。
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 波次开始改服务端先清者驱动（PvP 关本地自动开波 + 清波上报）"`

---

## Task 12：断线 / 认输 / 权威终局

**Files:** Modify `web/src/pause-popup.ts`（`context:'match'|'battle'`）、`web/src/main.ts`（暂停 `:1434`、status 轮询 `:1981`、`pumpPvpTick` 的 `result`/`opponentStatus`）；Test `web/src/pause-popup.test.ts`

- 暂停区 PvP：`context:'match'`→「认输」；确认→`pvpSync` status=`surrender`、立即 flush、等服务端 `result`。
- 本方唐僧血→0：`status='lost'`，上报 `status:tangsengDead`，等服务端 `result`。
- 服务端 `result` 终局权威 → 记原因（`opponentTangsengDead/opponentSurrender/opponentDisconnectTimeout/selfTangsengDead/selfSurrender/draw`）→ 进结算（Task 13）。
- `opponentStatus:'disconnected'`→提示；本方 >6s 无成功 tick→提示「网络中断，可能判负」。

- [ ] **Step 1: pause-popup context** — 失败测试 `context:'match'` 含「认输」；实现。
- [ ] **Step 2: main.ts 暂停/认输** — flush surrender。
- [ ] **Step 3: 终局权威** — `result` 驱动终局，复用 `endHandled` 门禁。
- [ ] **Step 4: 断线 UI**。
- [ ] **Step 5: 测试 + typecheck** — Expected PASS + 无新错。
- [ ] **Step 6: Commit** — `git commit -m "feat(pvp-web): 认输/断线/服务端权威终局（pause context:match + result 裁决）"`

---

## Task 13：PvP 结算分支

**Files:** Modify `web/src/settle.ts`、`web/src/main.ts`（结算入口 `:1981` 后）；Test `web/src/settle.pvp.test.ts`

展示 胜/负/平 + 原因 + 对手头像昵称；**不加减星/不触商人/不动境界功德**；返回首页清 `pvpSync`/`battle`、`screen='menu'`。

- [ ] **Step 1-2: 失败测试** — `drawPvpSettle(ctx,{outcome,reason,opponent})` 按 outcome 出标题；`pvpSettleHitAt` 命中返回首页。
- [ ] **Step 3: 实现** — `settle.ts` 加 `drawPvpSettle`/`pvpSettleHitAt`（`drawInkActionButton`、`avatarById`）；main.ts PvP 终局走此分支。
- [ ] **Step 4: 测试 + 浏览器冒烟** — result:win → 「胜利·对手唐僧被吃」+ 返回首页回菜单。
- [ ] **Step 5: Commit** — `git commit -m "feat(pvp-web): PvP 结算屏（胜负平+原因+对手，不加减星/不触商人/不动境界）"`

---

## Task 14：确定性单测（含延迟重放 / 插值帧率无关）

**Files:** Test `web/src/pvp-determinism.test.ts`

- [ ] **Step 1: 写测试** —
  1. 同 seed + 同动作流 → 两独立 `Battle(pvp)` 逐检查点 `wave/tangsengHP/units/towerPow` 一致。
  2. **对手侧延迟重放**：同 seed + 同对手动作流 + 同 `DELAY_TICKS` → 对手侧 `aiUnits/aiDefeated` 逐检查点一致。
  3. 固定步长在 `1/60` vs `1/20` 帧切法下同 seed 结果一致（`drainFixedSteps`）。
  4. 插值 `lerpPos` 纯函数边界。
- [ ] **Step 2: 跑测试** — Expected PASS（不过=有非确定源潜入，查 `Math.random`/`performance.now` 进判定）
- [ ] **Step 3: Commit** — `git commit -m "test(pvp-web): PvP 确定性（本方/对手延迟重放逐检查点一致 + 固定步长帧率无关）"`

---

## Task 15：单人零回归护栏 + 全门禁

**Files:** 复用既有 + 断言「pvp=false 时 updateAi/主循环/波血未变」

- [ ] **Step 1: 断言 PvP 关时行为不变** — `Battle(默认)` 仍走本地 AI 决策、主循环仍可变 dt（`frame` 非 pvp 不走 `drainFixedSteps`）、波血仍共享逻辑。
- [ ] **Step 2: 全量门禁** — `cd web && npx vitest run`（含 `ai-balance`/`versus-user-agent`）全过；`npm run typecheck 2>&1 | grep -E 'pvp|main\.ts'` 无新错；`npm run build` 成功。
- [ ] **Step 3: 浏览器冒烟（真机路径）** — 匹配→开打→放置延迟互见→（mock）先清定波→（mock）result 胜负→结算回首页；0 pageerror。
- [ ] **Step 4: Commit** — `git commit -m "test(pvp-web): 单人零回归护栏 + 全门禁（ai-balance/vitest/typecheck/build/冒烟）"`

---

## 验收：浏览器冒烟脚本（贯穿 T10/13/15）

沿用既有 puppeteer 冒烟（`web/tools/`，puppeteer-core + 本机 Chrome + `window.__game.curScreen()`）。要点：
- worktree dev server 跑**独立端口**（`npx vite --port 5185 --strictPort`），**勿** `./start.sh bg`（会杀 5180 主检出）。
- `page.evaluateOnNewDocument` mock `window.fetch` 的 `/api/versus/*`：enqueue→ticket、poll→matched(带 MatchStart)、**tick→对手 `place` 动作 / nextWave / result**。
- 断言：进 `battle`、对手侧 `aiUnits` 经 DELAY 后出现、体力扣 5、result→结算屏、0 pageerror（过滤跨域 CDN/BGM 噪声）。
- 画布跨域污染 → **不** `getImageData` 判黑，用 `page.screenshot` + `curScreen()` 断言。临时脚本用后即删（`web/tools/_pvp-*.mjs`）。

---

## 自检（写完计划回看 spec）

- **spec 覆盖**：§5 同步（Task1-2/5/9）、§5.3 先清定波（Task11）、§6 引擎（构造3/updateAi5-6/主循环4/波次11/胜负12）、**§3.1 延迟重放+插值全保真（Task6/8，D1 本期做）**、**§30 各算各的对手侧保真（Task7，D2 本期做）**、§8 心跳断线（Task12）、结算（Task13）、§13 测试（Task14-15）。§7 端上重放交叉核对→Plan D（本计划产/传 digest）。
- **类型一致**：`PvpAction`/`TickRequest`/`TickResponse`(T1)贯穿 T2/5/9/10；`PvpInit`+`delayTicks`(T3)；`drainFixedSteps`/`PVP_SIM_DT`/`DELAY_TICKS`(T4)；`aiSimTick`(T2)驱动 T6/10；`estimateOptimalPowerAi`(T7)；`lerpPos`(T8)。
- **占位符扫描**：无 TODO；每任务有测试与命令。`battle.ts` 内部字段名（`aiUnlockedCells`/格串格式/`spawnAiMonster` 拆分点）标注"实现时对齐现状"——为 7000 行文件的显式落地校准点，非占位符。
- **风险提示（供执行时警惕）**：Task6（对手侧延迟独立时钟）与 Task7（对手战力波血）是全保真的**高风险改动**，触及 `updateAi`/`spawnMonster` 核心；每个都以 `if(this.pvp)` 隔离单人路径 + `ai-balance` 门禁兜底，任一破坏单人平衡即回退到"仅 PvP 生效"。
