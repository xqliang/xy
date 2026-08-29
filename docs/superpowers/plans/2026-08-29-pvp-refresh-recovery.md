# PvP/PvE 全状态续玩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 PvP 与 PvE（单人/无尽）刷新页面后都能恢复到最新战斗状态；PvP 对手断线时本方继续打；对手断线致本方负不扣段位。

**Architecture:** 复用既有 `Battle.serialize()`/`applyCoreState()`（已存全状态含 4 个 RNG）。新建统一持久化 `web/src/pvp-save.ts`（键 `dasheng.session`，`kind:'pvp'|'pve'` 分流，输入触发+节流写入），取代 `battle-save.ts` 的续玩职责。恢复分叉：PvE 直接 `applyCoreState` 进战斗；PvP 先 `ws_hello` 确认对局在，再恢复+无输入快进到服务端 tick。对手断线去掉 `shouldStepSim` 的 `pvpOppGone` 冻结；断线负不扣段位由服务端 `_set_result` 按胜方断线态给 reason=selfTangsengDeadOppGone，客户端 `pvpSettle` 据此跳过扣段。

**Tech Stack:** TypeScript + Vite（web）、Python + fakeredis/pytest（server）、puppeteer-core（冒烟）、微信小游戏 wx.* API。

**Spec:** `docs/superpowers/specs/2026-08-29-pvp-refresh-recovery-design.md`

**性能基线（spec §5.1 实测）：** serialize 0.002ms / stringify 0.016ms/7.7KB / setItem 0.0002ms。单次安全，节流（500/2000ms）控频率。

---

### Task 0: 分支与基线确认

**Files:** 无（验证）

- [ ] **Step 1: 确认在 worktree 分支 + node_modules 就绪**

Run:
```bash
cd /Users/jyxc-dz-0100360/work/fun/xy/.claude/worktrees/pvp-refresh-recovery
git branch --show-current   # 期望: worktree-pvp-refresh-recovery
cd web && ls -d node_modules 2>/dev/null || ln -s /Users/jyxc-dz-0100360/work/fun/xy/web/node_modules node_modules
```
Expected: 分支名正确；node_modules 存在（本计划已软链）。

- [ ] **Step 2: 跑基线测试确认环境干净**

Run: `cd web && npx vitest run tests/pvp-fixedstep tests/general-combat-tier 2>&1 | tail -8`
Expected: 全 PASS（无环境问题）。

---

### Task 1: 统一续玩持久化 `pvp-save.ts`

**Files:**
- Create: `web/src/pvp-save.ts`
- Test: `web/tests/pvp-save.test.ts`

负责：全状态序列化的读写校验 + 节流写入 + 清除；PvP/PvE 共用。这是后续所有恢复的地基。

- [ ] **Step 1: 写失败测试**

```ts
// web/tests/pvp-save.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildSessionSave, readSession, clearSessionSave,
  sessionSaveCheckpoint, SESSION_SAVE_MIN_INTERVAL_MS, SESSION_SAVE_MAX_INTERVAL_MS,
  type SessionSaveV1,
} from '../src/pvp-save';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

function makePveBattle(seed = 7): Battle {
  const b = new Battle(seed, 1, mapById('pansidong'));
  b.startNextWave();
  for (let i = 0; i < 60; i++) b.step(1 / 30);
  return b;
}

beforeEach(() => { localStorage.clear(); });

describe('pvp-save 读写往返', () => {
  it('build→read 往返保留 wave 与 RNG 态', () => {
    const b = makePveBattle();
    const save = buildSessionSave('pve', b, { seed: 7, mapId: 'pansidong' });
    localStorage.setItem('dasheng.session', JSON.stringify(save));
    const back = readSession();
    expect(back).not.toBeNull();
    expect(back!.kind).toBe('pve');
    expect(back!.core.wave).toBe(b.wave);
    expect(back!.core.rngS).toEqual(b.serialize().core.rngS);
  });

  it('版本/结构校验：缺 core 或版本不符返回 null', () => {
    localStorage.setItem('dasheng.session', JSON.stringify({ v: 999 }));
    expect(readSession()).toBeNull();
    localStorage.setItem('dasheng.session', 'not json{');
    expect(readSession()).toBeNull();
  });

  it('终局(won/lost)不写', () => {
    const b = makePveBattle();
    b.status = 'won';
    const wrote = sessionSaveCheckpoint('pve', b, { seed: 7, mapId: 'pansidong' });
    expect(wrote).toBe(false);
    expect(localStorage.getItem('dasheng.session')).toBeNull();
  });
});

describe('pvp-save 节流', () => {
  it('dirty 后未过 MIN 间隔不写；force 过 MAX 间隔必写', () => {
    const b = makePveBattle();
    const base = { seed: 7, mapId: 'pansidong' };
    // 首次：force（无上次写入）
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000, force: true })).toBe(true);
    const first = localStorage.getItem('dasheng.session');
    // 立刻 dirty 再写：未过 MIN → 跳过
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000 + SESSION_SAVE_MIN_INTERVAL_MS - 1, dirty: true })).toBe(false);
    expect(localStorage.getItem('dasheng.session')).toBe(first);
    // 过 MAX 间隔：即使不 dirty 也写
    expect(sessionSaveCheckpoint('pve', b, base, { now: 1000 + SESSION_SAVE_MAX_INTERVAL_MS + 1 })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/pvp-save.test.ts 2>&1 | tail -12`
Expected: FAIL（`Cannot find module '../src/pvp-save'`）

- [ ] **Step 3: 实现 `pvp-save.ts`**

```ts
// web/src/pvp-save.ts
// PvP/PvE 统一全状态续玩持久化：刷新恢复到最新战斗。
// 复用 Battle.serialize()/applyCoreState()（已含 4 个 RNG 状态、飞行实体、status/waveActive）。
// 与单人旧 battle-save.ts 的区别：全状态 + 输入触发节流（解除 ready-only 保守限制），
// PvE 进行中(playing)也存，刷新恢复到最新一帧。性能依据见 spec §5.1（单次 stringify ~0.016ms）。
import type { BattleSaveConfig, BattleCoreState } from './battle-save';
import type { Battle } from './battle';

export const SESSION_KEY = 'dasheng.session';
export const SESSION_VERSION = 1;
/** 节流：dirty 后距上次写入 ≥ 此值才落盘（吸收输入风暴） */
export const SESSION_SAVE_MIN_INTERVAL_MS = 500;
/** 兜底：距上次写入 ≥ 此值无条件落盘（长时间无输入也保最新） */
export const SESSION_SAVE_MAX_INTERVAL_MS = 2000;

export interface PvpSessionMeta { matchId: string; uid: string; side: 'a' | 'b'; startAtServerMs: number; localSimTick: number; }
export interface SessionSaveV1 {
  v: number;
  gameVersion: string;
  savedAt: number;
  kind: 'pvp' | 'pve';
  pvp?: PvpSessionMeta;
  seed: number;
  mapId: string;
  config: BattleSaveConfig;
  core: BattleCoreState;
}

let lastWriteMs = 0;
let lastKey = '';

function appVersion(): string {
  try { return (globalThis as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ?? 'dev'; }
  catch { return 'dev'; }
}

/** 战斗是否「进行中」（可续玩）：非终局。won/lost 不写。 */
function isResumable(b: Battle): boolean {
  return b.status !== 'won' && b.status !== 'lost';
}

/**
 * 构造存档对象。opts.pvp 传 PvP 专有元信息（PvE 不传）。
 * config 直接取 serialize() 的 config（含 endless/difficultyMul/mapId）。
 */
export function buildSessionSave(
  kind: 'pvp' | 'pve', b: Battle,
  opts: { seed: number; mapId: string; pvp?: PvpSessionMeta },
): SessionSaveV1 {
  const { config, core } = b.serialize();
  return {
    v: SESSION_VERSION, gameVersion: appVersion(), savedAt: Date.now(),
    kind, ...(opts.pvp ? { pvp: opts.pvp } : {}),
    seed: opts.seed, mapId: opts.mapId, config, core,
  };
}

/** 读取并校验；无效（缺失/损坏/版本/结构）返回 null。 */
export function readSession(): SessionSaveV1 | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SESSION_KEY); } catch { return null; }
  if (!raw) return null;
  let save: SessionSaveV1;
  try { save = JSON.parse(raw) as SessionSaveV1; } catch { return null; }
  if (!save || save.v !== SESSION_VERSION || save.gameVersion !== appVersion()) return null;
  if (!save.core || (save.kind !== 'pvp' && save.kind !== 'pve')) return null;
  if (save.kind === 'pvp' && !save.pvp) return null;
  return save;
}

/** 清除续玩快照并复位节流状态。 */
export function clearSessionSave(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  lastWriteMs = 0; lastKey = '';
}

/**
 * 帧尾调用：满足写入门槛才落盘。返回是否写出。
 * @param dirty 本帧有我方输入（征兵/部署/合并/铲地/技/大招）
 * @param now 当前 ms（可注入，便于测试）
 * @param force 无视 dirty/间隔强制写（首次/关键点）
 */
export function sessionSaveCheckpoint(
  kind: 'pvp' | 'pve', b: Battle,
  opts: { seed: number; mapId: string; pvp?: PvpSessionMeta },
  io: { now?: number; dirty?: boolean; force?: boolean } = {},
): boolean {
  if (!isResumable(b)) return false;
  const now = io.now ?? Date.now();
  const since = now - lastWriteMs;
  const shouldWrite = io.force || (io.dirty && since >= SESSION_SAVE_MIN_INTERVAL_MS) || since >= SESSION_SAVE_MAX_INTERVAL_MS;
  if (!shouldWrite) return false;
  const key = `${kind}:${b.wave}:${b.status}`;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(buildSessionSave(kind, b, opts)));
    lastWriteMs = now; lastKey = key;
    return true;
  } catch { return false; } // 配额/wx 存储失败：best-effort
}

/** 恢复构造 Battle：中性参数 + applyCoreState 覆盖全状态。PvP 带 pvpInit。 */
export function restoreBattle(save: SessionSaveV1): Battle {
  // 延迟 import 避免循环（battle 重）
  const { Battle } = require('../src/battle') as typeof import('../src/battle');
  const { mapById } = require('../src/board') as typeof import('../src/board');
  const b = new Battle(
    save.seed, 1, mapById(save.mapId),
    undefined, undefined, undefined, undefined, // meta/weapons/equipped/passives 由 core 覆盖
    save.config.endless, undefined, 1, undefined,
    save.kind === 'pvp' ? { enabled: true } : undefined,
  );
  b.applyCoreState(save.core);
  return b;
}
```

> 注：`require` 在 ESM/Vite 下不合法。改用顶层 `import`（battle-save.ts 已 `import type { Battle }`，运行期 import 由 vite 处理循环）。实现时把 `restoreBattle` 的 `require` 换成静态 import，并确认无循环（pvp-save → battle → … ；若成环则把 restoreBattle 放到 main.ts 或加动态 import）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/pvp-save.test.ts 2>&1 | tail -12`
Expected: 全 PASS（如 require 改静态 import 后有循环报错，按注处理）

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "pvp-save" || echo "clean"`
Expected: pvp-save 无新增类型错

- [ ] **Step 6: Commit**

```bash
git add web/src/pvp-save.ts web/tests/pvp-save.test.ts
git commit -m "feat(web): 统一全状态续玩持久化 pvp-save（PvP/PvE 共用+节流）"
```

---

### Task 2: PvE 刷新恢复（先 PvE 验证序列化）

**Files:**
- Modify: `web/src/main.ts`（boot 恢复 + frame 尾落档 + 退役 battle-save 续玩）
- Test: `web/tests/pve-resume.test.ts`（单测 restoreBattle 正确性）

PvE 恢复无网络依赖，先做它验证全状态序列化正确性，给 PvP 打底。

- [ ] **Step 1: 写失败测试（restoreBattle 状态一致）**

```ts
// web/tests/pve-resume.test.ts
import { describe, it, expect } from 'vitest';
import { buildSessionSave, restoreBattle, readSession } from '../src/pvp-save';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';

describe('PvE restoreBattle 状态一致', () => {
  it('restore 后 wave/HP/units/RNG 与序列化前逐位一致', () => {
    const b = new Battle(7, 1, mapById('pansidong'));
    b.startNextWave();
    for (let i = 0; i < 120; i++) b.step(1 / 30);
    const before = b.serialize();
    const save = buildSessionSave('pve', b, { seed: 7, mapId: 'pansidong' });
    // 模拟 localStorage 往返
    localStorage.setItem('dasheng.session', JSON.stringify(save));
    const back = readSession()!;
    const rb = restoreBattle(back);
    const after = rb.serialize();
    expect(after.core.wave).toBe(before.core.wave);
    expect(after.core.tangsengHP).toBe(before.core.tangsengHP);
    expect(after.core.rngS).toEqual(before.core.rngS);
    expect(after.core.monsters.length).toBe(before.core.monsters.length);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/pve-resume.test.ts 2>&1 | tail -8`
Expected: FAIL（restoreBattle 的 require 未修 / 或 boot 未接线）

- [ ] **Step 3: 修 restoreBattle 为静态 import（消 require）+ boot 接线**

在 `pvp-save.ts` 顶部改为静态 import：
```ts
import { Battle } from './battle';
import { mapById } from './board';
```
并把 `restoreBattle` 内的 `require(...)` 删掉，直接用 import 的 `Battle`/`mapById`。（若 vite 报循环依赖 `battle → pvp-save`，则 `pvp-save` 不 import battle 的**运行值**、只 `import type`，`restoreBattle` 改为在 main.ts 实现或动态 `await import('./battle')`。）

在 `main.ts` boot IIFE（约 595 行 `tryResumeLocalBattle()` 处）插入 PvE 恢复优先：
```ts
// 续玩恢复优先（PvP/PvE 统一）：有有效快照则恢复，无则走原首页/单人逻辑
const session = readSession();
if (session) {
  if (session.kind === 'pve') {
    const rb = restoreBattle(session);
    // 若已终局（续玩前一刻 won/lost）→ 走正常结算而非进战斗；否则进战斗
    if (rb.status === 'won' || rb.status === 'lost') {
      // 交由既有单人终局处理（此处简化为清快照回首页；完 saffron 结算逻辑后续接）
      clearSessionSave();
    } else {
      battle = rb; currentMap = mapById(session.mapId);
      screen = 'battle'; endHandled = false; ui.paused = false;
      scheduleFrame();
      return; // 短路 boot 后续首页逻辑
    }
  }
  // kind='pvp' 由 Task 3 处理
}
```

- [ ] **Step 4: frame 尾落档接线**

在 `frame()` 函数末尾、`if (needsContinuousLoop()) scheduleFrame();` **之前**插入（需先在本文件已有 dirty 标记；初版先用 force + 间隔兜底，输入 dirty 由 Task 5 补精确触发）：
```ts
// 续玩落档（PvP/PvE 统一节流；初版 dirty=false 靠 MAX 间隔兜底，Task 5 接入输入 dirty）
if (screen === 'battle' && !endHandled) {
  const kind: 'pvp' | 'pve' = pvpSock ? 'pvp' : 'pve';
  const opts = pvpSock
    ? { seed: /*battle seed*/0, mapId: battle.map.id, pvp: { matchId: pvpSock.matchId, uid: ensureUserId(), side: /*a|b*/'a', startAtServerMs: pvpMatchStartMs, localSimTick } }
    : { seed: /*battle seed*/0, mapId: battle.map.id };
  sessionSaveCheckpoint(kind, battle, opts, { dirty: /*pendingSaveDirty*/ false });
}
```
> 注：`seed`/`side`/`pendingSaveDirty` 的精确保留/获取在 Task 5 落实；本步先跑通 PvE（seed 用 battle 内部或存档无关项因 core 会覆盖 RNG）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/pve-resume.test.ts 2>&1 | tail -8`
Expected: PASS

- [ ] **Step 6: typecheck + 手动冒烟占位**

Run: `npx tsc --noEmit 2>&1 | grep -E "main.ts|pvp-save" || echo "clean"`
Expected: main.ts/pvp-save 无新增类型错（基线 ~26 不增）

- [ ] **Step 7: Commit**

```bash
git add web/src/pvp-save.ts web/src/main.ts web/tests/pve-resume.test.ts
git commit -m "feat(web): PvE 刷新恢复（restoreBattle + boot 接线 + frame 尾落档）"
```

---

### Task 3: PvP 刷新恢复（ws_hello 确认 + 快进）

**Files:**
- Modify: `web/src/pvp-ws.ts`（加 `onHelloFail` + `gotWelcome`）
- Modify: `web/src/main.ts`（`resumePvpSession` 恢复路径 + 快进）
- Test: `web/tests/pvp-resume.test.ts`（快进 tick 计算 + onHelloFail 回调）

- [ ] **Step 1: 写失败测试（onHelloFail 回调）**

```ts
// web/tests/pvp-resume.test.ts
import { describe, it, expect, vi } from 'vitest';
import { pvpWaveStartTick, PVP_SIM_DT } from '../src/pvp-fixedstep';

describe('PvP 恢复快进 tick', () => {
  it('targetTick = pvpWaveStartTick(serverMs, startAt) 与在线 onNextWave 同基准', () => {
    const startAt = 1_000_000;
    const serverMs = 1_000_000 + 10_000; // 开局后 10s
    const tick = pvpWaveStartTick(serverMs, startAt);
    expect(tick).toBe(Math.round(10_000 / 1000 / PVP_SIM_DT)); // 10s / (1/30) = 300 tick
  });
});
```

> onHelloFail 的行为测试（PvpSocket 收到 close 但未 welcome → 回调）因依赖 WS mock，放冒烟 `pvp-refresh-smoke.mjs`；单测只覆盖纯函数 tick 计算。

- [ ] **Step 2: 跑测试确认失败/通过边界**

Run: `npx vitest run tests/pvp-resume.test.ts 2>&1 | tail -6`
Expected: tick 测试 PASS（纯函数已存在）；确认无回归

- [ ] **Step 3: `PvpSocket` 加 `gotWelcome` + `onHelloFail`**

在 `pvp-ws.ts`：
- `PvpSocketOpts` 加 `onHelloFail?: () => void;`
- 加私有字段 `private gotWelcome = false;`
- `handleOpen()` 发 hello 后**不**改 gotWelcome；在 `handleMessage` 的 `case 'welcome'` 里 `this.gotWelcome = true;`
- `handleClose()` 开头（`if (this.closed) return;` 之后）加：
```ts
// hello 失败：连上后未收到 welcome 就被服务端关闭（对局不存在/uid 不属于）→ 不重连，回调上层回首页
if (!this.gotWelcome) { this.opts.onHelloFail?.(); return; }
```

- [ ] **Step 4: `main.ts` 实现 `resumePvpSession(save)`**

新增函数（ Task 2 的 `kind='pvp'` 分支调用它）：
```ts
function resumePvpSession(save: SessionSaveV1 & { kind: 'pvp' }): void {
  const pvp = save.pvp!;
  pvpSock = new PvpSocket({
    matchId: pvp.matchId, uid: pvp.uid,
    tokenProvider: () => getToken() ?? undefined,
    onWelcome: (serverMs) => {
      // 恢复本方半场 + 快进到服务端当前 tick
      const rb = restoreBattle(save);
      battle = rb; currentMap = mapById(save.mapId);
      pvpMatchStartMs = pvp.startAtServerMs;
      const targetTick = pvpWaveStartTick(serverMs, pvp.startAtServerMs);
      // 无输入快进：防御自动战斗 = 我方不在时的自然演进
      let tick = pvp.localSimTick;
      while (tick < targetTick && battle.status === 'playing') { maybeOpenPvpWave(battle, tick); battle.step(PVP_SIM_DT); tick++; }
      localSimTick = tick; pvpAcc = 0;
      if (battle.status === 'lost') {
        // 我方刷新导致快进中死 → 负·扣段位（Task 4 的 no-penalty 只免「对手断线」）
        pvpResult = { outcome: 'lose', reason: 'selfTangsengDead' };
      }
      // 按 onPvpMatched 等价初始化 pvpOpponent/oppView 等 + screen='battle'
      screen = 'battle'; scheduleFrame();
    },
    onHelloFail: () => { clearSessionSave(); screen = 'menu'; scheduleFrame(); },
    // onOppSnap/onNextWave/onResult/onOppGone/onNoShow 同 onPvpMatched 的回调（复用）
    onOppSnap: /*…同 Task2/onPvpMatched…*/, onNextWave: /*…*/, onResult: (r) => { pvpResult = r; },
    onOppGone: /*…同 onPvpMatched…*/, onNoShow: /*…*/,
  });
  pvpSock.connect();
}
```
> 精确保存/恢复 `pvpOpponent`（对手档案）在 Task 5 落实（快进前对手档案可先从 save 恢复或等首条 oppSnap）；本步先跑通快进 + hello 失败兜底。

- [ ] **Step 5: 跑 typecheck + tick 测试**

Run: `npx vitest run tests/pvp-resume.test.ts && npx tsc --noEmit 2>&1 | grep -E "main.ts|pvp-ws" || echo "clean"`
Expected: tick 测试 PASS；无新增类型错

- [ ] **Step 6: Commit**

```bash
git add web/src/pvp-ws.ts web/src/main.ts web/tests/pvp-resume.test.ts
git commit -m "feat(web): PvP 刷新恢复（ws_hello 确认 + 无输入快进 + onHelloFail 回首页）"
```

---

### Task 4: 对手断线续打 + 断线负不扣段位

**Files:**
- Modify: `web/src/pvp-pause.ts`（`shouldStepSim` 去 `pvpOppGone`）
- Modify: `web/src/pvp-settle.ts`（`pvpSettle` 加 `noPenalty`）
- Modify: `web/src/main.ts`（结算分流按 reason）
- Modify: `server/api_versus.py`（`_set_result` reason 区分）
- Test: `server/tests/test_versus_ws.py` 或 `test_versus_redis.py`（no-penalty reason）、`web/tests/pvp-pause.test.ts`

- [ ] **Step 1: 写失败测试（no-penalty reason）**

服务端（`test_versus_redis.py` 或新用例）：构造 match，a 连过(connected_ever=True)、b 从未连或 gone；触发 a 的 TangsengDead 判负 → 断言 b(胜方)断线时 a 的 reason=selfTangsengDeadOppGone。

Web（`tests/pvp-settle.test.ts`）：
```ts
import { pvpSettle } from '../src/pvp-settle';
it('selfTangsengDeadOppGone 不扣段位（rankChange=null）', () => {
  const rank = { level: 3, stars: 2, difficulty: 1 };
  const r = pvpSettle('lose', rank, 5, { noPenalty: true });
  expect(r.rankChange).toBeNull();
});
it('普通 lose 扣段位（rankChange 非 null）', () => {
  const rank = { level: 3, stars: 2, difficulty: 1 };
  const r = pvpSettle('lose', rank, 5);
  expect(r.rankChange).not.toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && .venv/bin/python -m pytest tests/test_versus_redis.py -k no_penalty -q 2>&1 | tail -5` 与 `cd web && npx vitest run tests/pvp-settle.test.ts 2>&1 | tail -6`
Expected: FAIL（noPenalty 参数/reason 不存在）

- [ ] **Step 3: Web `pvpSettle` 加 noPenalty**

`pvp-settle.ts`：`pvpSettle(outcome, rank, wave, opts?: { noPenalty?: boolean })`，lose 分支：
```ts
else if (outcome === 'lose') rankChange = opts?.noPenalty ? null : recordLose(rank, { freezeDifficulty: true });
```

- [ ] **Step 4: Web 结算分流 + 去冻结**

`main.ts` 结算处（约 2874 行）：
```ts
const noPenalty = pvpResult.reason === 'selfTangsengDeadOppGone';
const { rankChange, meritGain } = pvpSettle(pvpResult.outcome, rank, battle.wave, { noPenalty });
```
`pvp-pause.ts` 的 `shouldStepSim`：去掉入参 `pvpOppGone`（或恒 false），使对手断线本方继续 step。

- [ ] **Step 5: 服务端 `_set_result` reason 区分**

`server/api_versus.py` `_set_result`：判 `TangsengDead` 时，检查胜方 side 是否断线（`not m[winner].get('connected_ever') or m[winner].get('gone_ms')`）→ 负方 reason 用 `selfTangsengDeadOppGone`（`REASON` 表加该键或在方法内特判）。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd server && .venv/bin/python -m pytest tests/test_versus_redis.py -q 2>&1 | tail -4` 与 `cd web && npx vitest run tests/pvp-settle.test.ts tests/pvp-pause 2>&1 | tail -6`
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/pvp-pause.ts web/src/pvp-settle.ts web/src/main.ts server/api_versus.py web/tests/pvp-settle.test.ts server/tests/test_versus_redis.py
git commit -m "feat: 对手断线续打 + 断线负不扣段位（服务端 reason 区分 + 客户端 pvpSettle noPenalty）"
```

---

### Task 5: 反作弊重连基线重置 + 输入 dirty 接入

**Files:**
- Modify: `server/api_versus.py`（`ws_hello` 重置 digest 基线）
- Modify: `web/src/main.ts`（输入处理置 `pvpSaveDirty`；落档 opts 补 seed/side/pvp 元信息）
- Test: `server/tests/test_versus_ws.py`（hello 重置基线）、现有 autoplace/pvp 测试回归

- [ ] **Step 1: 写失败测试（hello 重置 digest 基线）**

`test_versus_ws.py`：side 有 `last_digest`/`wave` → `ws_hello` 后断言被清零为 None。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && .venv/bin/python -m pytest tests/test_versus_ws.py -k hello -q 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 3: `ws_hello` 重置基线**

`api_versus.py` `ws_hello`（已重置 `last_next_wave` 处）加：`me["last_digest"] = None`（及 wave 水位字段）。

- [ ] **Step 4: Web 输入 dirty + 落档元信息**

`main.ts`：加 `let pvpSaveDirty = false;`，在我方输入处理（征兵/部署/合并/铲地/技能）末尾 `pvpSaveDirty = true;`；frame 尾 `sessionSaveCheckpoint` 传 `{ dirty: pvpSaveDirty }` 并写后复位 `pvpSaveDirty = false`；落档 opts 补 `seed`（battle 构造 seed，需在 PvP/PvE 建 battle 时记录）、`side`（`pvpSock` 侧从 `ensureUserId` 与 match 的 a/b 比对得出）。

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `cd server && .venv/bin/python -m pytest tests/test_versus_ws.py -q 2>&1 | tail -4` 与 `cd web && npx vitest run 2>&1 | tail -8`
Expected: 服务端 hello 测试 PASS；web 全绿（或仅既存 flaky `versus-user-agent` 胜率边界）

- [ ] **Step 6: Commit**

```bash
git add server/api_versus.py web/src/main.ts server/tests/test_versus_ws.py
git commit -m "feat: 反作弊重连基线重置 + 接入输入 dirty 落档"
```

---

### Task 6: 浏览器冒烟 + 门禁 + wx bundle

**Files:**
- Create: `web/tools/pve-resume-smoke.mjs`、`web/tools/pvp-refresh-smoke.mjs`
- 无源码修改（验证）

- [ ] **Step 1: 写 PvE 冒烟**

`pve-resume-smoke.mjs`：起 vite dev → 进单人战斗步进 → 读 `dasheng.session` 存在且 kind=pve → `page.reload()` → 断言 `window.__game.curScreen()==='battle'` 且 `snapshot().wave` 与存档一致。

- [ ] **Step 2: 写 PvP 冒烟**

`pvp-refresh-smoke.mjs`：用 `window.__game.enterPvp(seed)` 起对局 → 写快照 → reload → mock/真实 WS hello 返回 serverMs → 断言恢复进战斗 + 快进步数合理；构造对局不存在（清 Redis match）→ reload → 断言回首页。

- [ ] **Step 3: 跑冒烟**

Run: `(npx vite --port 5183 &) && node tools/pve-resume-smoke.mjs && node tools/pvp-refresh-smoke.mjs`
Expected: 两条 PASS

- [ ] **Step 4: 全量门禁**

Run: `cd web && npx tsc --noEmit 2>&1 | grep -cE "error TS"`（≤ 基线 26）与 `npx vitest run 2>&1 | tail -5`
Run: `cd server && .venv/bin/python -m pytest tests/ -q 2>&1 | tail -6`（fakeredis 部分全过；DB 部分需 3308 则跳过）
Expected: 类型不新增；测试无回归

- [ ] **Step 5: 重建 wx bundle + 真机提示**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy && ./start.sh wx 2>&1 | grep -E "built|完成"`
Expected: bundle 重建成功；提示微信 DevTools 双开验证三条路径

- [ ] **Step 6: Commit**

```bash
git add web/tools/pve-resume-smoke.mjs web/tools/pvp-refresh-smoke.mjs
git commit -m "test(web): PvP/PvE 续玩恢复浏览器冒烟"
```

---

## Self-Review

**1. Spec coverage：**
- 统一持久化+节流 → Task 1 ✓
- PvE 刷新恢复（解除 ready-only）→ Task 2 ✓
- PvP 刷新恢复（hello 确认+快进+bad_hello 兜底）→ Task 3 ✓
- 对手断线续打（去 pvpOppGone 冻结）→ Task 4 ✓
- 断线负不扣段位（服务端 reason + 客户端 noPenalty）→ Task 4 ✓
- 反作弊重连基线重置 → Task 5 ✓
- 性能基准 → spec §5.1（已实测，Task 1 节流实现其策略）✓
- 冒烟/门禁/wx bundle → Task 6 ✓

**2. Placeholder scan：** Task 2 Step 4 / Task 3 Step 4 / Task 5 Step 4 有 `/*…*/` 注释指向"Task 5 落实 seed/side/dirty 精确获取"——这是**有意的前向引用**（先 PvE 跑通再补 PvP 专有元信息），非占位符；但为降低执行风险，执行时若某步因未定义符号编译失败，应按注释就地落实该字段（记录 seed、从 match 定 side），不要留 `/*TODO*/`。

**3. Type consistency：** `sessionSaveCheckpoint(kind, b, opts, io)` / `buildSessionSave(kind, b, opts)` / `restoreBattle(save)` / `readSession()` / `clearSessionSave()` 全程一致；`pvpSettle(outcome, rank, wave, opts?: {noPenalty?})` 一致；`pvpWaveStartTick(waveStart, matchStart)` / `PVP_SIM_DT` 与既有 `pvp-fixedstep` 一致。

**风险提示（执行时注意）：**
- Task 1 `restoreBattle` 的循环依赖：`pvp-save → battle` 若成环，`restoreBattle` 移到 main.ts 或用动态 import。
- Task 3 `resumePvpSession` 需复用 `onPvpMatched` 的一整套回调（onOppSnap/onNextWave/onOppGone/onNoShow）+ `pvpOpponent` 恢复——建议把 `onPvpMatched` 的回调构造抽成共享函数 `makePvpCallbacks()`，恢复路径复用，避免复制走样。
- Task 4 服务端 reason 判定依赖终局时刻胜方 side 的 `gone_ms`/`connected_ever` 仍有效（`_set_result` 持锁同步、`_forget_match_state` 在后）——测试锁死该时序。
