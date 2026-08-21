# 在线 PvP · WS 实时状态同步（Model C）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal：** 对局期同步由「命令转发+确定性重放」替换为「各自权威半场 + WS 100ms 快照中继 + 接收端插值渲染」，按构造消灭 desync 类问题。

**Architecture（已定，见 spec `2026-08-21-online-pvp-ws-state-sync-design.md`）：** 本机 `battle` 本地权威；每 100ms 序列化本方半场快照经 WS 发服务器原样转发；对手端存双缓冲快照、怪物 dist 插值（滞后 120ms）、渲染桥映射进 `battle.ai*` 复用 `drawAiSide`。服务器 stdlib `ThreadingHTTPServer` 手写 RFC6455（零新依赖）；匹配层 HTTP 不动；权威终局/波次排程沿用 VersusHub 逻辑搬到 WS。拆除 oppBattle/applyPvpInput/record 打点/PvpSync/seq 重传/DELAY_TICKS/权威纠正（对手状态=发送端权威快照）。

**Tech Stack：** Python stdlib（socket/sha1/base64/struct）+ http.server；TS + Canvas；vitest（web/tests/）+ pytest（server/tests/，3308 MariaDB 或 _FakeDB）；puppeteer-core 真双端冒烟。

---

## 关键设计决策（摘要）

- **100ms 快照 + 120ms 插值延迟**：10Hz 对 TD 足够平滑；带宽 ~20–40KB/s。
- **WS 认证**：query 参数 `?matchId=<mid>&uid=<uid>`（GET 升级请求无自定义 header 机制；与 X-Uid 同信任级）。
- **服务器不解析快照大字段**，仅派生小 digest（wave/tangsengHP/kills/units）喂 `_anticheat` 与终局。
- **断线宽限 6s**：WS close → 记 gone_ms + 推 oppGone；同 uid 期内重连恢复（不补历史）；超时 → DisconnectTimeout。
- **快照字段面 = 现 `bridgeOpponentFrom` 的消费面**（aiMonsters/aiUnits/aiWords/aiBombs/aiDigFx/aiUnlocked/aiGeneralStates/lastAiActivePairKeys/aiActiveSlots/aiPickedItems/aiTangsengHP/aiDefeated/aiMods/aiSkillFx/aiPalmPushFx/aiPassiveFlash/aiSpawnGateT）——序列化=「本方侧同名字段」，镜像规则沿用现桥。
- **单人零影响红线不变**：所有新代码 pvp 门控；拆除的 record/applyPvpInput 本就 pvpSync 门控。
- **过时测试删除清单**：pvp-determinism*、pvp-relay-reliability、pvp-opponent-loadout、pvp-battle、battle.pvp-input、pvp-authority-reconcile、battle.pvp-wave（视 T6 保留 maybeOpenPvpWave 与否，保留则留测）。

---

## 文件结构

| 文件 | 责任 | 动作 |
|------|------|------|
| `server/ws.py` | RFC6455 握手 + 帧编解码（纯函数） | 创建(T1) |
| `server/api_versus.py` | VersusHub WS 会话/转发/终局/断线宽限 + ws 路由 handler | 修改(T2,T7) |
| `server/server.py` | GET /api/versus/ws 分发到 WS handler | 修改(T2) |
| `web/src/pvp-ws.ts` | PvpSocket：连接/重连/消息分发 | 创建(T4) |
| `web/src/pvp-snap.ts` | Battle.pvpOwnSnapshot 序列化 + PvpOppView 双缓冲插值 | 创建(T5) |
| `web/src/battle.ts` | 拆 applyPvpInput/桥改快照源；pvpOwnSnapshot（读本方 private 需在类内） | 修改(T5,T6) |
| `web/src/main.ts` | onPvpMatched 连 WS、100ms 发快照、渲染桥换源、拆重放机器 | 修改(T6) |
| `web/src/api/pvp-client.ts` | 拆 versusTick/PvpAction/PvpLoadout/MatchStart.opponentLoadout | 修改(T7) |
| `web/vite.config.ts` | /api 代理加 ws:true | 修改(T8) |
| `docs/deploy/` | nginx WS 配置 | 创建(T8) |

---

## Task 1：WS 帧编解码 + 握手（`server/ws.py` 纯函数）

**Files:** Create `server/ws.py`；Test `server/tests/test_ws.py`

- [ ] Step1 失败测试：`ws_accept_key(key)`（= b64(sha1(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))，RFC6455 魔串）对 RFC 样例断言；`encode_frame(opcode,text)`（服务端不 mask、长度 125/<64KB/>=64KB 三分支、FIN=1）；`decode_frame(buf)`（客户端帧带 mask：解析 b1/b2、len 126/127 扩展、4 字节 mask key、异或解掩码；返回 {opcode, payload, consumed}；不足一帧返回 consumed=0）；控制帧（ping=0x9/pong=0xA/close=0x8）与 text(0x1) 同路解析。
- [ ] Step2 跑测确认 FAIL（模块不存在）。
- [ ] Step3 实现（struct/hashlib/base64，无状态纯函数；decode 需处理分片到达=返回 consumed=0 等更多数据）。
- [ ] Step4 pytest 全过。
- [ ] Step5 commit `feat(pvp-server): RFC6455 握手与帧编解码纯函数`。

## Task 2：`/api/versus/ws` 端点 + VersusHub WS 会话（转发/波次/终局/断线宽限/重连）

**Files:** Modify `server/api_versus.py`、`server/server.py`（GET 路由分流）；Test `server/tests/test_versus_ws.py`

- [ ] Step1 失败测试（真 socket 集成，_FakeDB + 可控时钟，参照 test_versus.py 的 `_fake_hub` 模式；用 `socket.create_connection` + 手写客户端帧（复用 T1 的 encode 加 mask 版本或测试内手搓）：
  1. 握手：GET /api/versus/ws?matchId=&uid= 带 Upgrade 头 → 101 + Sec-WebSocket-Accept 正确；
  2. hello → welcome(serverMs)；
  3. A 发 snap → B 收 oppSnap 原文一致；B 发 snap → A 收；
  4. A 发 waveCleared{wave:1} → 双方收 nextWave{wave:2,startAtServerMs}（首清排程，沿用 INTER_WAVE_DELAY_MS）；
  5. A 发 status surrender → 双方收 result（outcome/reason 对两侧正确，沿用 _result_for）；
  6. A 断开（close 帧/裸断）→ B 收 oppGone；6s 宽限内 A 重连 hello → 恢复转发；超 6s → B 收 result(opponentDisconnectTimeout)（此用例时钟可控推进）；
  7. 服务器从 snap 派生 digest 存 side["last_digest"]（供 _anticheat；可从 nextWave 排程被触发间接断言）。
- [ ] Step2 FAIL。
- [ ] Step3 实现：
  - `api_versus.py`：`VersusHub` side 增 `ws_send`（`Callable[[str], bool]`|None）、`gone_ms`；`ws_hello(uid,match_id,send)`（校验 match 存在+uid 属于该局；恢复重连清 gone_ms）；`ws_snap(uid,match_id,snap)`（派生 digest{wave,tangsengHP,kills,units} 存 last_digest、转发给对手 ws_send）；`ws_wave_cleared`/`ws_status`（走既有排程/_resolve_terminal，result 用双方 ws_send 推送）；`ws_gone(uid,match_id)`（记 gone_ms、推 oppGone、调度宽限超时判定——超时判定挂在对手/自身后续任意入口调用或 hub reap 扫描，实现取最简：在每次任意消息处理时惰性检查双方 gone 超时）。
  - `server.py`：`do_GET` 里 `/api/versus/ws` 分流到 `handle_versus_ws`（导自 api_versus）：完成 101 握手后循环读帧（读 self.rfile，T1 decode 分片安全），分发 hello/snap/waveCleared/status/close；每 5s 发 ping（select/timeout 读循环实现）；socket 异常→ws_gone。
- [ ] Step4 pytest 全过（含既有 test_versus.py 不回归——tick 路由本任务**保留不删**，客户端未切换前兼容）。
- [ ] Step5 commit `feat(pvp-server): /api/versus/ws 端点——快照转发/波次/终局/断线宽限/重连`。

## Task 3：客户端 `pvp-ws.ts`（PvpSocket）

**Files:** Create `web/src/pvp-ws.ts`；Test `web/tests/pvp-ws.test.ts`

- [ ] Step1 失败测试（mock WebSocket 类，记录 send 参数、可注入 onmessage/onclose/onopen）：
  1. connect 用 `ws(s)://location.host/api/versus/ws?matchId=&uid=`（https→wss，dev http→ws）；
  2. onopen 后自动发 hello {type,matchId,uid}；
  3. dispatch：welcome/oppSnap/nextWave/result/oppGone 各回调触发一次，未知 type 忽略；
  4. close 后指数退避重连（fake timers：1s→2s→4s 封顶 5s；`closed` 标志后不再重连）；
  5. `sendSnap(s)`/`sendWaveCleared(w)`/`sendStatus(v)` 组装正确 JSON；未 open 时 send 静默丢弃（返回 false）。
- [ ] Step2 FAIL。Step3 实现（无 Date.now 限制——网络层非 sim；重连计时用 setTimeout）。Step4 过 + typecheck 零新错。Step5 commit `feat(pvp-web): PvpSocket——WS 连接/重连/消息分发`。

## Task 4：`pvp-snap.ts` 快照序列化 + 双缓冲插值视图

**Files:** Create `web/src/pvp-snap.ts`；Modify `web/src/battle.ts`（`pvpOwnSnapshot()` 方法、`bridgeOpponentFromSnap(view)`）；Test `web/tests/pvp-snap.test.ts` + `web/tests/pvp-bridge-snap.test.ts`

- [ ] Step1 失败测试：
  1. round-trip：建 pvp Battle（同 pvp-bridge.test.ts 的 NO_META 构造）放单位/字牌/出怪（step 若干）→ `pvpOwnSnapshot()` → 构 PvpOppView.ingest(snap) → `battle2.bridgeOpponentFromSnap(view)` → 断言 battle2.aiUnits/aiWords/aiMonsters/aiUnlocked/aiGeneralStates 与现桥 `bridgeOpponentFrom(opp)` 结果逐字段等价（镜像 cell/fireDir+π/heroPairKey 重排规则照搬）；
  2. 插值：ingest 两个快照（dist=1.0@t0、dist=1.1@t1）→ `view.interp(now=t1+Δ)` 的怪物 dist 在两值之间线性、Δ<0 取 prev、Δ>INTERP_DELAY(120ms) 取 cur；
  3. 特效老化：fx.t 早于 now-寿命 → 不出现；
  4. 快照纯 JSON 可序列化（JSON.parse(JSON.stringify(s)) 往返不变）。
- [ ] Step2 FAIL。Step3 实现：
  - `Battle.pvpOwnSnapshot(): PvpSnap`：类内读本方 private（monsters/units/words/unlocked/generalStates/lastActivePairKeys/activeSlots/pickedItems/bombs/digFx/playerSkillFx/palmPushFx/passiveFlash/spawnGateT/tangsengHP/status/peach/kills/wave/waveActive/spawnRemaining/introT），字段面=现桥消费面（实现时逐一 grep 核对，漏字段=渲染缺件）。
  - `PvpOppView`：prev/cur 双缓冲、ingest(t)、interpAt(nowMs)→{monsters(dist 插值), 其余取 cur}、fx 老化。
  - `bridgeOpponentFromSnap(view)`：与 bridgeOpponentFrom 同构但数据源=插值视图（镜像规则复制；aiMonsters 元素需带渲染所需全字段——快照 monster 含 dist/hp/maxHp/type/tier/slowT/freeze 等渲染实读字段）。
- [ ] Step4 过 + typecheck。Step5 commit `feat(pvp-web): 本方半场快照序列化 + 对手双缓冲插值视图 + 快照渲染桥`。

## Task 5：main.ts 接线 + 拆除重放机器 + 过时测试清理

**Files:** Modify `web/src/main.ts`、`web/src/battle.ts`（删 applyPvpInput/bridgeOpponentFrom 或保留前者删除——见下）、`web/src/pvp-battle.ts`（删 PvpSync/相关）；Delete `web/tests/` 过时测试；Modify `web/src/api/pvp-client.ts`（tick 相关类型移除留到 T6，本任务不动）

- [ ] Step1 失败测试：无新单测（本任务=接线+拆除），验收=既有保留测试全绿 + singleplayer-guard 不变。
- [ ] Step2 `onPvpMatched`：建 battle（不变）→ `pvpSock = new PvpSocket(matchId, uid)`；`onmessage`：oppSnap→oppView.ingest；nextWave→沿用现有纪元缓存/开波；result→pvpResult（复用现有结算门控）；oppGone→battle.message 提示；welcome→记 serverMs 对时。
- [ ] Step3 frame()：`pvpSync` 引用全部替换——每 100ms（墙钟节流）`pvpSock.sendSnap(battle.pvpOwnSnapshot())`；渲染前 `battle.bridgeOpponentFromSnap(oppView.interpAt(now))`；清波下降沿改 `sendWaveCleared`；status 上报改 `sendStatus`；`endPvpSession` 增 `pvpSock.close()`；删除 oppBattle/pvpSync/pvpOppSimTick/onPvpSimTick/takeReady 循环/10 处 record 打点（pvpSync 为 null 判据改 pvpSock）。
- [ ] Step4 拆 battle.ts：删 `applyPvpInput`/`bridgeOpponentFrom`/`applyOppAuthority`（被快照版取代）；pvp 微门（updateAi/spawnMonster ai 推/checkOpponentDefeated/autoPlaceTray deadline）**保留**——本方半场仍 pvp 构造。删 pvp-battle.ts 的 PvpSync/reconcileOppAlive（保留 pvpWaveStartTick 所在 pvp-fixedstep.ts）。
- [ ] Step5 删过时测试（清单见「关键设计决策」末条），跑全量 vitest + typecheck（基线随删除下降属预期，记录新基线）+ build。
- [ ] Step6 commit `feat(pvp-web): main.ts 接线 WS 快照同步，拆除确定性重放机器`。

## Task 6：退役 HTTP tick + loadout 传输（服务端+客户端）

**Files:** Modify `server/api_versus.py`（删 tick()/_opp_status HTTP 面/relay_buffer/sent_seqs/RELAY 相关、loadout 存取与 opponentLoadout 下发）、`server/server.py`（删路由）、`web/src/api/pvp-client.ts`（删 versusTick/PvpAction/PvpDigest/TickRequest/TickResponse/PvpLoadout/MatchStart.opponentLoadout 及 enqueue/room 的 loadout 参）、`web/src/main.ts`（删 myLoadout/pvpNet 闭包回简单签名）、`web/src/pvp-match.ts`（PvpMatchNet 接口回无 loadout 版）；相应测试清理。

- [ ] Step1 更新 server pytest（删 tick 用例、保留匹配/私房/终局用例——终局已 T2 覆盖）；Step2 实现；Step3 全门禁（server pytest + web vitest/typecheck/build）；Step4 commit `refactor(pvp): 退役 HTTP tick 与 loadout 传输（WS 快照模型无消费方）`。

## Task 7：真服务器双浏览器端到端冒烟

**Files:** 临时 `web/tools/_pvp-ws-smoke.mjs`（用后即删）

- [ ] 起 `server.py`（测试配置/独立端口 8083、_FakeDB 或测试库）、`vite --port 5185`（vite 代理 XY_API_PROXY 指向 8083 + ws:true——若 T8 未做则本步顺带）。
- [ ] 双 puppeteer 页面：P1 邀请建房（mock 或真实 roomCreate）、P2 深链 join → 双方 matched 进 battle；P1 放置单位（evaluate 调 __game 钩子或模拟点击）→ 断言 P2 画面对手侧出现该单位（pvpProbe 扩展暴露 oppView 快照计数/units 数）；推进波次（服务端排程）→ 双方 wave 一致；P2 认输 → P1 收 result 结算 → 双方回菜单、WS 关闭、0 pageerror（过滤 CDN/BGM 噪声）。
- [ ] 断网恢复子用例：杀 P2 WS（Cdp detachNetwork）→ P1 见 oppGone 提示 → 宽限内恢复 → 快照续传。
- [ ] commit（若有 main.ts 探针扩展）`test(pvp): 真服务器 WS 双端冒烟`。

## Task 8：部署配置（vite ws 代理 + nginx 文档）

**Files:** Modify `web/vite.config.ts`（`'/api': { target, changeOrigin, ws: true }`）；Create `docs/deploy/nginx-ws.md`

- [ ] vite `/api` 代理加 `ws: true`（本地联调 WS 经 vite 代理）。nginx 片段：
```nginx
location /xy/api/versus/ws {
    proxy_pass http://127.0.0.1:8082/api/versus/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;  # 长连接（有 5s ping 保活，防中间层超时）
}
```
- [ ] 全门禁最终跑一遍（web vitest/typecheck/build + server pytest），记录新 typecheck 基线；commit `chore(pvp): WS 部署配置（vite ws 代理 + nginx 升级头）`。

---

## 验收

- 真双端冒烟（T7）全过、0 pageerror；单人全量门禁不回归；typecheck 无新增错误（删除后基线下降需记录）；server pytest 全绿。
- 行为验收：对手操作 ~100–250ms 可见；对手半场与对手本机画面一致（快照直传，无重放分叉）；断线 6s 内重连无损恢复；终局一律服务端 result。

## 自检

- **spec 覆盖**：§2 模型（T4/T5）、§3 协议（T2/T3）、§4 快照（T4）、§5 插值（T4）、§6 服务端（T1/T2/T6）、§7 客户端（T3/T4/T5）、§8 生命周期（T2/T5）、§9 反作弊素材（T2 digest 派生）、§10 部署（T8）、§11 测试（各任务+T7）。
- **风险**：手写 RFC6455（T1/T2 纯函数+真 socket 测试兜底）；快照漏字段=渲染缺件（T4 round-trip 与现桥逐字段等价测试锁死）；main.ts 大改（T5 拆步+全量回归）；跨浏览器无确定性要求（模型免除）。
- **类型一致**：`PvpSnap`（T4 spec§4）、消息 type 字面量（T2/T3 对齐）、`PvpSocket` 回调签名。
