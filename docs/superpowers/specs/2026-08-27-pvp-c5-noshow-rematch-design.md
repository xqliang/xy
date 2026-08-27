# PvP C5 设计:打空气 → 空赢不计战绩 + 在场方自动重匹配

> 状态:设计已与用户确认(2026-08-27)。里程碑 C(Redis 水平扩展)的 C5;独立于 C3/C4,不依赖多实例。

## 目标(北极星)

撮合成局后**对手全程从未连接**(打空气)时,不再给在场方判「空赢」、不计战绩;改为**该局作废(no-contest,不写 `pvp_results`)+ 退还在场方本局体力 + 客户端自动静默重新匹配**。取代里程碑 B 的 B4b「一侧到场、对手从未连接 → 在场方直接判胜」。

## 背景:当前「打空气判胜」链路(探查确认)

- 一侧打空气判胜**只有一处**:`server/api_versus.py` `_ws_check_gone_locked` 分支2(`:643-649`)。当 `not side.connected_ever and other.connected_ever and now - m["created_ms"] > MATCH_CONNECT_GRACE_MS`(20s)时,调 `_set_result(m, key, "DisconnectTimeout", now)`(判在场方 `other` 胜)并推 `{type:"result"}` 给在场方。由在场方自己的 `ws_*` 流量驱动。
- `_set_result` → `_persist_result`(`:529`)是 `pvp_results` 的**唯一写入点**,被真实终局(`_set_result`/`_set_draw`)共享,无按 reason 的门控。
- **双方都没连**的情况已符合 C5:`_reap`(`:290-292`)在 `MATCH_CONNECT_GRACE_MS` 后静默删局,**不记录、不判胜**。C5 不动它。
- `connected_ever`:`_new_side` 初始化 `False`;`ws_hello` 置 `True`;`_deserialize_match`(C2 回放)按持久化值恢复。是区分「打空气(False)」与「真实掉线(True)」的准确标志。
- 服务端→客户端 WS 消息 type 现有:`welcome / oppSnap / nextWave / oppGone / result / pong`。**无重匹配相关 type**。
- 客户端 `pvp-ws.ts` `DownType` 联合类型 + `handleMessage` switch 分发到回调;`result` → `onResult` → `main.ts` 置 `pvpResult` → `frame()` 结算。**无「再来一局/重匹配」流程**,结算后只 `leaveSettleToMenu()` 回首页。
- 客户端匹配入口唯一:`enterPvpMatching('random')`(`main.ts:539`);开局扣体力在 `onPvpMatched`(`:388-390`,`spendStamina`)。

## 设计决策(已确认)

1. **判定范围**:只算**对手全程从未连接**(`connected_ever=False`)。对手连过、开打后掉线 → 仍走分支1 判在场方胜、计战绩(不变)。
2. **重匹配 UX**:**自动静默重排队**——显示「对手未应战,正在重新匹配…」,直接回匹配队列,无需用户操作。
3. **战绩口径**:打空气这局**完全不写 `pvp_results`**(不计胜/负/场次)。
4. **体力**:打空气**退还在场方本局体力**(`STAMINA_COST`)。否则自动重排队时下一局会二次扣费,等于为一场真实对局付两次费,对在场方不公。退款后重排队 → 下一局正常扣费 → 净扣一次。

## 架构与改动点

### 服务端 `server/api_versus.py`

- **新助手 `_set_no_contest(m, now)`**:置 `m["ended"]=True; m["ended_ms"]=now; m["no_contest"]=True`(**不设 `m["result"]`、不调 `_persist_result`**),调 `_forget_match_state(m["match_id"])`(C2:同步删 Redis mstate)。幂等:`if m.get("ended"): return` 开头守卫。
- **改 `_ws_check_gone_locked` 分支2**(`:643-649`):把 `_set_result(m, key, "DisconnectTimeout", now)` + 推 `{type:"result"}` 换成 `_set_no_contest(m, now)` + 给在场方 `other` 推**新消息 `{type:"noShow"}`**(仅当 `other.ws_send` 存在)。
- **加固 `_ws_check_gone_locked` 分支1(正确性修复)**:分支1 的条件加 `and side.get("connected_ever")`。原因:C2 回放把两侧 `gone_ms=now`;一个「从未连接」的被恢复侧在 `DISCONNECT_GRACE_MS`(45s)后会误触分支1 → `DisconnectTimeout` 判胜+记录,违背 C5。加守卫后:从未连接侧永远只由分支2(no-contest)处理,不论 `gone_ms`;连过又掉线侧仍走分支1 判胜(不变)。这也消除了原「20-45s 走分支2、>45s 走分支1」的脆弱阈值耦合(原代码注释已点明该耦合)。
- **`_persist_result` 不动**:no-contest 压根不调它,天然「不写战绩」;真实终局路径不受影响。
- **`_reap` 双方未连接分支不动**(已静默退队)。

### 客户端 `web/src/pvp-ws.ts`

- `DownType` 加 `'noShow'` 字面量;`handleMessage` switch 加 `case 'noShow': this.opts.onNoShow?.(); break;`;`PvpSocketOpts` 加可选回调 `onNoShow?: () => void`。

### 客户端 `web/src/main.ts`

- `onPvpMatched` 的 `PvpSocket` 配置里加 `onNoShow: () => { if (pvpResult) return; pvpNoShow = true; }`(已终局则不触发)。
- 新模块变量 `pvpNoShow`(bool),在 `onPvpMatched` 的对局态 reset 处归零(与 `pvpResult` 等并列),`endPvpSession` 里也兜底归零。
- `frame()` 里(与 `pvpResult` 消费并列、在结算门控之前)检测:`if (pvpSock && pvpNoShow) { const st = addStamina(stamina, STAMINA_COST); stamina = st; /* 退还本局体力,镜像 onPvpMatched 扣费的持久化 */ endPvpSession(); pvpMatchingNote = '对手未应战,正在重新匹配…'; enterPvpMatching('random'); return; }`。
  - `pvpMatchingNote`:新模块变量,匹配中界面读它显示一行提示(下次成局或超时清空)。若匹配中界面已有 message 机制则复用。
- degenerate:队列没别人 → 重排队后正常走 `poll` 超时 → `onPvpFailed`(现有),无死循环。对手(从未连接)的 ticket 已消耗,不会被重新配对撞回同一鬼影。

## 数据流

1. 撮合成局,在场方 `ws_hello`(`connected_ever=True`),对手从未 hello(`connected_ever=False`)。
2. 在场方开打,30Hz 发 snap;每条 snap 顶部触发 `_ws_check_gone_locked`。
3. `now - created_ms > 20s` 时分支2 命中 → `_set_no_contest` + 推 `{type:"noShow"}` 给在场方。
4. 客户端 `onNoShow` → `pvpNoShow=true`;`frame()` → 退体力 + `endPvpSession()` + `enterPvpMatching('random')` + 提示。
5. 在场方重新排队;对手鬼影 ticket 不再参与配对。

## 错误处理与边界

- 推 `noShow` 失败(在场方 socket 也恰好死了):在场方 `ws_send` 缺失则不推;该局 `ended=True/no_contest`,由 `_reap` 清 `self.matches` + `ticket_match` + `_forget_match_state` 已删 mstate。在场方客户端走自身断线路径(`pvpNetDead`)。
- 已终局幂等:`_set_no_contest` 开头 `if m.get("ended"): return`;`onNoShow` 里 `if (pvpResult) return`。
- 回放局(C2):从未连接侧过 45s 也只走分支2 no-contest(分支1 已加 `connected_ever` 守卫)。
- 无限重排队:不设上限(YAGNI);无对手时自然退化为正常匹配超时。

## 测试

**服务端(`server/tests/`,`XY_DB_PORT=3308` + fakeredis):**
- 改写 `test_opponent_never_connects_present_side_wins` → `test_opponent_never_connects_no_contest_rematch`:断言对局 `ended=True` 且 `m.get("result")` 为 None(或 `no_contest=True`)、`pvp_results` 无该 match 行、在场方收到 `{type:"noShow"}` 而非 `result`。
- 改写 `test_reload_lazy_opponent_no_show_present_side_wins` → no-contest 版本(回放局上同样 no-contest + 推 noShow)。
- **新增** `test_reloaded_never_connected_side_no_contest_after_disconnect_grace`:回放的从未连接侧过 `DISCONNECT_GRACE_MS`(45s)仍 no-contest、不判胜、`pvp_results` 无行(验证分支1 的 `connected_ever` 守卫)。
- **新增/保留回归** `test_connected_then_dropped_still_wins`:一方连过(`connected_ever=True`)后 `gone_ms` 超 45s → 仍 `_set_result(DisconnectTimeout)` 判对方胜 + 写 `pvp_results`(分支1 不变)。
- `test_both_never_connect_not_resolved_as_win_still_reaped` 不变。

**客户端(`web/`,vitest 放 `web/tests/`):**
- `pvp-ws.ts`:新增单测,喂 `{type:"noShow"}` 帧断言 `onNoShow` 被调用一次;未知 type 仍忽略。
- `main.ts` 帧逻辑(退体力 + 重排队)不易单测 → 走 `tsc` 不新增基线报错 + 真机浏览器验证(改了帧循环/匹配转场,见 [[verify-web-in-browser]] / [[web-smoke-test-harness]])。

## 明确不做(YAGNI)

- 不加服务端「原子退队重排队」API(客户端已能 `enqueue`,复用即可)。
- 不加连续打空气次数上限(正常超时兜底)。
- 不记 `no_contest` 可查记录(用户已定「完全不写」)。
- 不改 `MATCH_CONNECT_GRACE_MS`(20s 在场方独打时长,沿用)。
