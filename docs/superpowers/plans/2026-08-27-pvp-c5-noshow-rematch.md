# PvP C5 实现计划:打空气 → 空赢不计战绩 + 在场方自动重匹配

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对手全程从未连接(打空气)时,该局作废(no-contest、不写 `pvp_results`)+ 退还在场方本局体力 + 客户端自动静默重新匹配,取代 B4b「一侧到场对手没连→在场方判胜」。

**Architecture:** 服务端把 `_ws_check_gone_locked` 分支2(唯一的一侧打空气判胜点)从 `_set_result(DisconnectTimeout)` 改为 `_set_no_contest` + 推新消息 `{type:"noShow"}`;分支1 加 `connected_ever` 守卫修正 C2 回放局 45s 误判胜。客户端 `pvp-ws.ts` 加 `noShow` 消息 type + `onNoShow` 回调;`main.ts` 收到后退体力 + 关会话 + `enterPvpMatching('random')`。

**Tech Stack:** Python 3 stdlib(`server/api_versus.py`)、pytest + fakeredis + 真 MariaDB(`XY_DB_PORT=3308`);TypeScript + vitest(`web/`,测试放 `web/tests/`)。

**分支:** `feat/pvp-c5-noshow-rematch`(在主树 checkout,非 worktree)。仓库根 `/Users/jyxc-dz-0100360/work/fun/xy`。**不 push**(灰度惯例)。

**关键现状(探查确认,逐字):**
- `_ws_check_gone_locked`(`server/api_versus.py:619-649`):分支1 = 掉线超时判胜(`side.gone_ms` 且 `>DISCONNECT_GRACE_MS`);分支2 = 打空气判胜(`not side.connected_ever and other.connected_ever and now-created_ms>MATCH_CONNECT_GRACE_MS`)。
- 常量:`DISCONNECT_GRACE_MS=45_000`、`MATCH_CONNECT_GRACE_MS=20_000`。
- `_set_result`(`:506-519`)→ `_persist_result`(`:529`,唯一写 `pvp_results`)。
- `pvp-ws.ts`:`DownType`(`:18`)、`handleMessage` switch(`:182-229`)、`PvpSocketOpts`(`:35-39`)。
- `main.ts`:`onPvpMatched`(`:324-397`,体力扣于 `:388-390` `spendStamina`)、对局态 reset(`:384-387`)、`endPvpSession`(`:401`)、`enterPvpMatching`(`:539`)。
- `stamina.ts`:`STAMINA_COST=5`、`addStamina(s,n)`、`spendStamina(s)`。

---

## Task 1(服务端):打空气 no-contest + 分支1 `connected_ever` 守卫

**Files:**
- Modify: `server/api_versus.py`(`_ws_check_gone_locked` ~619-649;新增 `_set_no_contest`)
- Test: `server/tests/test_versus_persist.py`(改写 ~184-207 与 C2 的 no-show 回放测试;新增 2 个)

- [ ] **Step 1: 写失败测试——一侧打空气 no-contest + 推 noShow**

在 `server/tests/test_versus_persist.py` 里,把现有 `test_opponent_never_connects_present_side_wins`(约 184-207 行)**整段替换**为:

```python
def test_opponent_never_connects_no_contest_rematch():
    # C5：一侧到场、对手从未连接 → 该局作废(no-contest)，不判胜、不写战绩，推 noShow 给在场方重匹配。
    from api_versus import MATCH_CONNECT_GRACE_MS
    import json
    hub = _fake_hub()
    e1 = {"uid": "A1", "rank": 3, "ticket": "tA"}
    e2 = {"uid": "B1", "rank": 3, "ticket": "tB"}
    mid = hub._make_match(e1, e2, hub._now())
    sent_a = []
    hub.ws_hello("A1", mid, lambda t: (sent_a.append(t), True)[1])   # A 连上；B 从未连接
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    hub.ws_snap("A1", mid, {"type": "snap", "t": 1, "s": base})
    assert hub.matches[mid].get("ended") is not True                 # 未过撮合宽限：不判定
    hub._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    hub.ws_snap("A1", mid, {"type": "snap", "t": 2, "s": base})
    m = hub.matches[mid]
    assert m["ended"] is True
    assert m.get("result") is None            # 不判胜
    assert m.get("no_contest") is True        # 作废
    types = [json.loads(t).get("type") for t in sent_a]
    assert "noShow" in types                  # 推重匹配信号
    assert "result" not in types              # 不推 result
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_opponent_never_connects_no_contest_rematch -v`
Expected: FAIL(当前分支2 判胜、推 result、无 `no_contest`)

- [ ] **Step 3: 新增 `_set_no_contest` 助手**

在 `server/api_versus.py` 的 `_set_result`(`:506-519`)之后新增:

```python
    def _set_no_contest(self, m, now: int) -> None:
        """C5：打空气作废——对手全程从未连接时该局不判胜、不写战绩(不调 _persist_result)。
        仅置终局标志 + no_contest 供 _reap 回收;删 Redis mstate(C2)。幂等。"""
        if m.get("ended"):
            return
        m["ended"] = True
        m["ended_ms"] = now
        m["no_contest"] = True
        self._forget_match_state(m["match_id"])
```

- [ ] **Step 4: 改 `_ws_check_gone_locked`——分支2 走 no-contest + 分支1 加守卫**

把 `server/api_versus.py` 的 `_ws_check_gone_locked`(`:619-649`)方法体里的循环替换为下面版本(docstring 保留、按需微调;核心是分支1 加 `and side.get("connected_ever")`、分支2 改 `_set_no_contest` + 推 `noShow`):

```python
        for key, other_key in (("a", "b"), ("b", "a")):
            side = m[key]
            other = m[other_key]
            # 分支1：连过又掉线超时 → 判负(DisconnectTimeout)，推 result 给存活侧。
            # C5：加 connected_ever 守卫——「从未连接」侧即便被 C2 回放置了 gone_ms，也不算掉线，
            # 只能走下面分支2(no-contest)，绝不经此判胜；连过又掉线仍照旧判胜。
            if (side.get("connected_ever") and side.get("gone_ms")
                    and now - side["gone_ms"] > DISCONNECT_GRACE_MS):
                self._set_result(m, key, "DisconnectTimeout", now)
                if other.get("ws_send"):
                    self._ws_push_locked(other, side, m,
                                         {"type": "result", **m["result"][other_key]})
                return
            # 分支2（C5 打空气作废）：对手从未连接（撮合后一方到场、另一方一直没 hello）→ 过撮合宽限
            # 即把该局作废(no-contest)、不判胜不计战绩，推 noShow 给在场方触发自动重匹配。
            # 仅当"恰好一方缺席"命中：双方都没连由 _reap 的 20s 分支静默删除。
            if (not side.get("connected_ever") and other.get("connected_ever")
                    and now - m["created_ms"] > MATCH_CONNECT_GRACE_MS):
                self._set_no_contest(m, now)
                if other.get("ws_send"):
                    self._ws_push_locked(other, side, m, {"type": "noShow"})
                return
```

- [ ] **Step 5: 运行确认 Step 1 测试通过**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py::test_opponent_never_connects_no_contest_rematch -v`
Expected: PASS

- [ ] **Step 6: 改写 C2 的 no-show 回放测试为 no-contest + 新增两个回归测试**

在 `server/tests/test_versus_persist.py`:

**(a)** 把 `test_reload_lazy_opponent_no_show_present_side_wins`(C2 加的那个,断言判胜)**整段替换**为:

```python
def test_reload_lazy_opponent_no_show_no_contest(rhub):
    # C5：回放恢复的对局上，一侧打空气同样 no-contest（不判胜、不写 pvp_results、推 noShow）。
    from api_versus import MATCH_CONNECT_GRACE_MS
    import json
    mid = _mk(rhub, "PW1", "PW2")
    rhub.ws_hello("PW1", mid, lambda t: True)   # PW1 连过；PW2 从未连接
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 9_000_000)
    sent = []
    h2.ws_hello("PW1", mid, lambda t: (sent.append(t), True)[1])   # 懒加载重建
    h2._clock["ms"] += MATCH_CONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    h2.ws_snap("PW1", mid, {"type": "snap", "t": 1, "s": base})
    m = h2.matches[mid]
    assert m["ended"] is True
    assert m.get("result") is None
    assert m.get("no_contest") is True
    assert "noShow" in [json.loads(t).get("type") for t in sent]
    with rhub.db.cursor() as cur:                                   # 空赢不计战绩
        cur.execute("SELECT COUNT(*) AS c FROM pvp_results WHERE match_id=%s", (mid,))
        assert cur.fetchone()["c"] == 0
```

**(b)** 追加分支1 守卫的回归测试(回放的从未连接侧过 45s 仍 no-contest):

```python
def test_reloaded_never_connected_side_no_contest_after_disconnect_grace(rhub):
    # 分支1 守卫回归：C2 回放把两侧 gone_ms=now；从未连接侧过 DISCONNECT_GRACE_MS(45s)
    # 也不得经分支1 误判胜，必须走分支2 no-contest。
    from api_versus import DISCONNECT_GRACE_MS
    import json
    mid = _mk(rhub, "N1", "N2")
    rhub.ws_hello("N1", mid, lambda t: True)   # N1 连过；N2 从未连接
    rhub.flush_active_matches()
    h2 = _reopen(rhub.db, rhub._redis_server, 20_000_000)
    sent = []
    h2.ws_hello("N1", mid, lambda t: (sent.append(t), True)[1])
    h2._clock["ms"] += DISCONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    h2.ws_snap("N1", mid, {"type": "snap", "t": 1, "s": base})
    m = h2.matches[mid]
    assert m.get("result") is None            # 分支1 守卫生效：不判胜
    assert m.get("no_contest") is True        # 走分支2 作废
    assert "result" not in [json.loads(t).get("type") for t in sent]
```

**(c)** 追加分支1 正常判胜的回归测试(连过又掉线仍判胜+计战绩):

```python
def test_connected_then_dropped_still_wins(rhub):
    # 分支1 不变回归：一方连过(connected_ever=True)后掉线超 45s → 仍判对方胜 + 写 pvp_results。
    from api_versus import DISCONNECT_GRACE_MS
    mid = _mk(rhub, "D1", "D2")
    rhub.ws_hello("D1", mid, lambda t: True)
    rhub.ws_hello("D2", mid, lambda t: True)                # 两侧都连过
    rhub.matches[mid]["b"]["gone_ms"] = rhub._now()          # 模拟 D2 socket 掉线（连过又断）
    rhub._clock["ms"] += DISCONNECT_GRACE_MS + 1
    base = {"wave": 0, "tangsengHP": 3, "kills": 0, "units": []}
    rhub.ws_snap("D1", mid, {"type": "snap", "t": 1, "s": base})   # D1 流量驱动检查
    m = rhub.matches[mid]
    assert m["ended"] is True
    assert m.get("no_contest") is not True
    assert m["result"]["a"]["outcome"] == "win"             # D1(a) 判胜
    assert m["result"]["a"]["reason"] == "opponentDisconnectTimeout"
    with rhub.db.cursor() as cur:                            # 计战绩：两行
        cur.execute("SELECT COUNT(*) AS c FROM pvp_results WHERE match_id=%s", (mid,))
        assert cur.fetchone()["c"] == 2
```

- [ ] **Step 7: 跑整份持久化测试 + 服务端全量**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/server && XY_DB_PORT=3308 python -m pytest tests/test_versus_persist.py -v && XY_DB_PORT=3308 python -m pytest -q`
Expected: 全绿(注意:若别的测试文件也断言了旧「打空气判胜」行为,一并按 no-contest 修正——先 grep `opponentDisconnectTimeout` / `present_side_wins` 定位)。

- [ ] **Step 8: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add server/api_versus.py server/tests/test_versus_persist.py
git commit -m "feat(server): PvP C5 打空气改 no-contest（不判胜/不计战绩）+ 分支1 加 connected_ever 守卫"
```

---

## Task 2(客户端 pvp-ws.ts):`noShow` 消息 type + `onNoShow` 回调

**Files:**
- Modify: `web/src/pvp-ws.ts`(`DownType` ~18;`PvpSocketOpts` ~35-39;`handleMessage` switch ~182-229)
- Test: `web/tests/`(找现有 pvp-ws 测试文件追加;无则新建 `web/tests/pvp-ws-noshow.test.ts`)

- [ ] **Step 1: 写失败测试——收到 `{type:"noShow"}` 调 onNoShow**

先确认现有 pvp-ws 测试位置:`ls web/tests/ | grep -i pvp-ws`。若有(如 `pvp-ws.test.ts`)在其中追加;否则新建 `web/tests/pvp-ws-noshow.test.ts`。测试(按现有 pvp-ws 测试构造 PvpSocket 的方式改造;下面是自包含版本):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PvpSocket } from '../src/pvp-ws';

describe('PvpSocket noShow (C5)', () => {
  it('dispatches {type:"noShow"} to onNoShow', () => {
    const onNoShow = vi.fn();
    const sock = new PvpSocket({ matchId: 'm1', uid: 'u1', onNoShow });
    // 直接喂入站帧到私有分发（与现有 pvp-ws 测试同法）：
    (sock as unknown as { handleMessage(d: string): void }).handleMessage(
      JSON.stringify({ type: 'noShow' }),
    );
    expect(onNoShow).toHaveBeenCalledTimes(1);
  });
});
```
（若现有测试用别的入口驱动 `handleMessage`(如模拟 WebSocket onmessage),照其模式改写本测试。）

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/web && npx vitest run tests/pvp-ws-noshow.test.ts`
Expected: FAIL(`onNoShow` 未被调用——`noShow` 未分发)

- [ ] **Step 3: `DownType` + `PvpSocketOpts` + switch case**

**(a)** `web/src/pvp-ws.ts:18` 的 `DownType` 加 `'noShow'`:
```typescript
type DownType = 'welcome' | 'oppSnap' | 'nextWave' | 'result' | 'oppGone' | 'noShow' | 'pong';
```
**(b)** `PvpSocketOpts`(~35-39)加可选回调(放在 `onOppGone` 附近):
```typescript
  /** C5：对手全程未应战(打空气) → 服务端作废该局并通知在场方自动重新匹配。 */
  onNoShow?: () => void;
```
**(c)** `handleMessage` switch(~182-229)在 `case 'oppGone':` 之后加:
```typescript
      case 'noShow':
        this.opts.onNoShow?.();
        break;
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/web && npx vitest run tests/pvp-ws-noshow.test.ts`
Expected: PASS

- [ ] **Step 5: 跑 web 全量 vitest + tsc**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/web && npx vitest run && npx tsc --noEmit 2>&1 | tail -5`
Expected: vitest 全绿;tsc 仅既有基线报错(~26-28 处),**不新增**(见 [[web-typecheck-baseline-dirty]])。

- [ ] **Step 6: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add web/src/pvp-ws.ts web/tests/
git commit -m "feat(web): pvp-ws 加 noShow 消息 type + onNoShow 回调（C5）"
```

---

## Task 3(客户端 main.ts):onNoShow 接线 + 退体力 + 自动重匹配

**Files:**
- Modify: `web/src/main.ts`(`onPvpMatched` ~324-397;对局态 reset ~384-387;`endPvpSession` ~401;`enterPvpMatching` ~539;`frame()` 的 `pvpResult` 消费附近;匹配中界面绘制处;新模块变量;`stamina` 导入)

- [ ] **Step 1: 加模块变量 + 导入**

**(a)** 在 `pvpResult`/`pvpOppGone` 等 PvP 模块变量声明附近(`main.ts:634`/`:651` 一带)加:
```typescript
let pvpNoShow = false;              // C5：服务端判对手打空气 → frame() 退体力+自动重匹配
let pvpMatchingNote = '';           // C5：匹配中界面提示（如「对手未应战，正在重新匹配…」）
```
**(b)** 确认 `main.ts` 顶部 stamina 导入含 `addStamina` 与 `STAMINA_COST`(现已导入 `spendStamina`);缺则补:
```typescript
import { /* …现有… */, spendStamina, addStamina, STAMINA_COST } from './stamina';
```
（若 stamina 走 `import * as` 或命名不同,按现有风格补齐 `addStamina`/`STAMINA_COST`。）

- [ ] **Step 2: `onPvpMatched` 加 onNoShow 回调 + reset 归零**

**(a)** 在 `onPvpMatched` 的 `PvpSocket({...})` 配置里,`onOppGone` 回调之后加:
```typescript
    onNoShow: () => {
      // C5：对手全程未应战(打空气)。已终局则不触发；由 frame() 退体力+自动重匹配。
      if (pvpResult) return;
      pvpNoShow = true;
    },
```
**(b)** 在对局态 reset 行(`:385` `pvpOppGone = false; ...` 一带)把 `pvpNoShow` 一并归零:
```typescript
  pvpNetDead = false; pvpNetDeadStart = 0; pvpOppGone = false; pvpOppGoneStart = 0; pvpNoShow = false;
```

- [ ] **Step 3: `endPvpSession` 兜底归零 pvpNoShow**

在 `endPvpSession`(`:401`+)清理 PvP 态处加 `pvpNoShow = false;`(与其它 `pvp*` 标志并列)。

- [ ] **Step 4: `enterPvpMatching` 支持提示参数**

把 `enterPvpMatching(mode, code?)`(`:539`)签名加可选 `note`,并在函数体设置/清空 `pvpMatchingNote`:
```typescript
function enterPvpMatching(mode: 'random' | 'invite' | 'join', code?: string, note = ''): void {
  if (screen === 'pvpMatching') return;
  pvpMatchingNote = note;              // C5：no-show 重匹配传提示；普通进入传空清掉
  // …原有逻辑不变…
```
（普通菜单进入不传 note → 清空;no-show 重匹配传提示文案。）

- [ ] **Step 5: `frame()` 消费 pvpNoShow——退体力 + 关会话 + 重匹配**

在 `frame()` 里 `pvpResult` 结算门控**之前**(约 `main.ts:2820` 那段结算触发之前)加:
```typescript
  // C5：对手打空气 → 退还本局体力(镜像 onPvpMatched 的扣费)，关会话，自动静默重新匹配。
  if (pvpSock && pvpNoShow) {
    stamina = addStamina(stamina, STAMINA_COST);   // 退回本局扣的体力，避免为一场真实对局二次扣费
    endPvpSession();                                // 关 WS + 清 PvP 态（含 pvpNoShow=false）
    enterPvpMatching('random', undefined, '对手未应战，正在重新匹配…');
    scheduleFrame();
    return;
  }
```

- [ ] **Step 6: 匹配中界面显示 pvpMatchingNote**

找到匹配中界面绘制(`screen==='pvpMatching'` 的 draw;搜 `pvpMatching` 的渲染分支或 `drawPvpMatching`/匹配状态文本)。在其状态文本附近加一行:若 `pvpMatchingNote` 非空则绘制该提示。示例(按现有绘制风格调整坐标/字号):
```typescript
    if (pvpMatchingNote) {
      ctx.save();
      ctx.fillStyle = '#ffd', ctx.textAlign = 'center', ctx.font = `${Math.round(14 * DPR)}px sans-serif`;
      ctx.fillText(pvpMatchingNote, VIEW_W / 2, /* 状态文本下方 y */);
      ctx.restore();
    }
```
（若匹配界面已有 message/副标题机制,复用之,不必新画。）

- [ ] **Step 7: tsc 不新增基线报错**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/web && npx tsc --noEmit 2>&1 | tail -8`
Expected: 仅既有基线报错(~26-28),不新增(对比 Task 2 Step 5 的输出)。

- [ ] **Step 8: web 全量 vitest(不回归)**

Run: `cd /Users/jyxc-dz-0100360/work/fun/xy/web && npx vitest run 2>&1 | tail -3`
Expected: 全绿。

- [ ] **Step 9: Commit**

```bash
cd /Users/jyxc-dz-0100360/work/fun/xy
git add web/src/main.ts
git commit -m "feat(web): PvP C5 收到 noShow → 退体力+自动重新匹配（附匹配中提示）"
```

- [ ] **Step 10: ⚠️ 真机浏览器验证(改了帧循环/匹配转场,单测抓不到运行时)**

按 [[verify-web-in-browser]] / [[web-smoke-test-harness]]:构造/模拟对手打空气(或注入 `window.__game` 触发 onNoShow),确认:进入对局后 ~20s 收到 noShow → 提示「对手未应战,正在重新匹配…」→ 体力退回一格 → 自动回到匹配中 → 再次成局正常扣体力。此步由用户在真机/浏览器执行(无自动化夹具)。

---

## Self-Review

**1. Spec 覆盖:**
- 打空气 no-contest 不判胜/不计战绩 → Task 1(`_set_no_contest`,不调 `_persist_result`)。✅
- 分支1 `connected_ever` 守卫修回放误判 → Task 1 Step 4 + 回归测试 Step 6(b)。✅
- 只算「全程从未连接」、连过又掉线仍判胜 → Task 1 Step 6(c) 回归。✅
- 客户端 noShow 消息 + 回调 → Task 2。✅
- 自动静默重匹配 + 提示 → Task 3(frame 分支 + `pvpMatchingNote`)。✅
- 退体力 → Task 3 Step 5(`addStamina(stamina, STAMINA_COST)`,镜像 `onPvpMatched` 扣费)。✅
- 双方未连 `_reap` 静默退队不变 → 未触碰。✅

**2. Placeholder 扫描:** 代码步骤均给完整可粘贴代码;仅两处「按现有风格调整」(匹配界面绘制坐标、stamina 导入形态)——因这两处依赖仓库现有约定,已给出定位方式与示例,非 TBD。

**3. 类型/命名一致性:** `_set_no_contest`/`no_contest`/`{type:"noShow"}`/`onNoShow`/`pvpNoShow`/`pvpMatchingNote` 全程一致;`DownType` 加 `'noShow'` 与 switch case、回调三处对齐;`addStamina`/`STAMINA_COST` 与 `stamina.ts` 导出一致。

**4. 绿灯连续性:** Task 1 服务端独立可提交绿;Task 2 客户端 pvp-ws 独立;Task 3 依赖 Task 2 的 `onNoShow` 回调存在(顺序执行)。每 Task 结束跑对应测试 + 全量。

---

## Execution Handoff

计划已存 `docs/superpowers/plans/2026-08-27-pvp-c5-noshow-rematch.md`。两种执行:
1. **子代理逐任务(推荐)** — 每任务新子代理 + 双阶段评审(规范→质量),任务间审查。
2. **本会话内联执行** — 分批 + 检查点。

选哪种?
