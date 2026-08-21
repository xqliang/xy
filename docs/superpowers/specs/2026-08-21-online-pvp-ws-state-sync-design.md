# 在线 PvP · WS 实时状态同步（Model C）设计 spec

> 本文是对 `2026-08-20-online-pvp-versus-design.md`（Model B 命令重放）的**架构替换**：
> 对局期同步模型由「命令转发 + 两端确定性重放」改为「**各自权威半场 + WebSocket 快照中继**」。
> 匹配层（HTTP enqueue/poll/私房）不变。用户已确认（2026-08-21）。

## 1. 背景与动机

- Model B 依赖「同 seed + 同引擎确定性 + 同序命令恰好一次 + 同 loadout」四前提，真机 playtest 暴露三处破坏（loadout 发散 / 中继丢命令 / 权威不消费），虽已逐一修复，但确定性链条本身脆弱：任何未覆盖命令、跨浏览器浮点差异都会级联发散。
- 本作两半场**互不交互**（各自防守各自的唐僧，胜负=谁的唐僧先死），状态同步天然干净：每端只需权威模拟**自己**的半场，把渲染所需状态发给对方。
- 新模型按构造消灭整类 desync：不再需要 oppBattle、applyPvpInput、seed/命令序/loadout 对齐、延迟步进。旧 Bug-1 三因在战斗层失去存在前提。
- 附带收益：对手动作可见延迟从 ~1.5s（1s 轮询+0.5s 延迟窗）降到 ~100–250ms；断线由 WS close 即刻感知（原 6s 心跳超时）；服务器每 100ms 看到完整状态，反作弊（Plan D）素材更全。

## 2. 同步模型总览

```
本机 battle(30Hz 本地权威) ──每100ms 快照──▶ WS ──▶ 服务器 VersusHub ──原样转发──▶ 对手 WS ──▶ 快照视图(插值) ──▶ 渲染桥 ──▶ 对手上半场画面
```

- **本方半场**：现有 `battle` 实时本地模拟（保留 pvp 固定步长累加器与微门），玩家输入即时生效，无网络依赖。
- **快照**：每 100ms 由本方序列化自己半场的渲染态（英雄/单位/怪物位置血量/字牌/特效/唐僧血/波次…），JSON 文本帧发 WS。
- **对手半场渲染**：接收端保存最近 2 份快照，怪物 `dist` 线性插值（渲染滞后 ~150ms），其余取最新快照；渲染桥把快照视图映射进 `battle.ai*`，复用 `drawAiSide`。
- **权威**：开局/波次排程（先清者定波）/终局裁决仍在服务器（沿用 VersusHub 既有逻辑，信道从 HTTP tick 搬到 WS）。

## 3. WS 协议（JSON 文本帧）

连接：`GET /api/versus/ws?matchId=<mid>&uid=<uid>`（Upgrade: websocket）。以 query 参数认证（握手是 GET 请求，无自定义 header 机制；uid 与既有 X-Uid 同源同信任级）。

### 客户端 → 服务器

| 消息 | 时机 | 载荷 |
|---|---|---|
| `hello` | 连接后首条（冗余校验 matchId/uid 与 query 一致） | `{type:'hello', matchId, uid}` |
| `snap` | 每 100ms | `{type:'snap', t:<客户端ms>, s:<快照，见§4>}` |
| `waveCleared` | 本方清波下降沿 | `{type:'waveCleared', wave:N}` |
| `status` | 认输/唐僧死 | `{type:'status', v:'surrender'\|'tangsengDead'}` |

### 服务器 → 客户端

| 消息 | 时机 | 载荷 |
|---|---|---|
| `welcome` | hello 校验通过 | `{type:'welcome', serverMs}`（对时用） |
| `oppSnap` | 收到对手 snap 即转发 | `{type:'oppSnap', s:<对手快照>}` |
| `nextWave` | 首清排程后（对双方） | `{type:'nextWave', wave:N, startAtServerMs}` |
| `result` | 权威终局 | `{type:'result', outcome:'win'\|'lose'\|'draw', reason}` |
| `oppGone` | 对手 WS 断开（宽限期内） | `{type:'oppGone'}`（UI 提示；超宽限未回→result） |

协议层：服务器每 5s 发 WS ping（保活 + 探活）；客户端任意帧即隐式存活。close 帧正常处理。

## 4. 快照 schema（`s` 字段）

序列化为纯 JSON。字段分组与 `bridgeOpponentFrom` 消费面一一对应：

```ts
interface PvpSnap {
  t: number;                       // 发送端 ms（接收端用于特效老化/插值时基）
  wave: number; waveActive: boolean; spawnRemaining: number;
  tangsengHP: number; status: 'playing' | 'lost';
  peach: number; kills: number;
  // 连续运动实体（接收端插值 dist）
  monsters: Array<{ dist: number; hp: number; type: number; tier: number; slow?: number; freeze?: number }>;
  // 静态/准静态实体（取最新快照）
  units: Array<{ cell: { c: number; r: number }; type: number; tier: number; fireDir?: number }>;
  words: Array<{ cell: { c: number; r: number }; char: string; general: string; tier: number; fabaofuBoosted?: boolean }>;
  unlocked: string[];              // "c,r" 键数组
  generalStates: Record<string, { cd: number; ready?: boolean }>;  // 键=heroPairKey
  activeSlots: Array<{ id: string; cd: number }>; pickedItems: unknown[];
  bombs: Array<{ c: number; r: number; t: number }>; digFx: Array<{ c: number; r: number; t: number }>;
  // 瞬态特效（带 t，接收端按 (now - t) 老化）
  fx: Array<{ kind: 'skill' | 'palm' | 'flash'; t: number; x?: number; y?: number }>;
  spawnGateT: number; introT: number;
}
```

> 实现时以「渲染函数实际读取的 ai* 字段」为准确枚举（计划任务里逐字段勘定并加 round-trip 测试锁死）；上表为契约级分组。协议带 `v` 版本号字段预留演进。

## 5. 插值与渲染

- 接收端维护 `prev/cur` 两份快照 + 各自到达时间；渲染时刻取 `cur.t - INTERP_DELAY_MS(120)`，怪物 `dist = lerp(prev.dist_i, cur.dist_i, α)`（按 index 对齐；数量不一致时多的取 cur）。
- 单位/字牌/武将组等离散变化取 `cur`（100ms 内的放置/合并呈现为轻微步进，可接受；后续可加落子动画）。
- 特效按 `now - fx.t` 老化，与发送端时间基对齐（welcome 对时 + 每 snap 校正漂移，阈值内不跳变）。
- 渲染桥 `bridgeOpponentFromSnap(view)`：把插值后的视图映射进 `battle.ai*`（镜像规则与现桥一致：cell 镜像、fireDir+π、heroPairKey 重排）。

## 6. 服务端设计

- **框架**：沿用 stdlib `ThreadingHTTPServer`，**手写 RFC6455**（握手 `Sec-WebSocket-Accept = b64(sha1(key + GUID))`；帧编解码：FIN/opcode/mask/len(126/127 扩展)、text/binary/ping/pong/close；客户端帧必带 mask，服务端帧不 mask）。纯函数编解码 + 单测，~200 行，零新依赖，单进程单端口。
- **线程模型**：WS 连接占用其 http.server 线程（握手 101 后循环读帧）；发送走每连接一把锁（跨线程写 socket）。与既有 ThreadingHTTPServer 模型一致。
- **VersusHub 改造**：side 增加 `ws`（发送闭包）、断线时刻；`snap` → 服务器**从快照派生 digest**（wave/tangsengHP/kills/units，供 `_anticheat` 与终局判定，客户端无需再自报 digest）；`waveCleared`/`status` 走既有 `_resolve_terminal`/波次排程逻辑；`oppSnap` 原样转发（服务器不解析大字段，仅派生 digest 用的小字段）。
- **断线与重连**：WS close/发送失败 → 记 `gone_ms`，推 `oppGone` 给对方；`DISCONNECT_GRACE_MS(6s)` 内同 uid 重新 hello → 恢复（继续收快照）；超时 → 既有 `DisconnectTimeout` 终局。**重连不补历史**（对手半场从重连后首个快照重建，短暂空洞可接受）。
- **退役**：HTTP `/api/versus/tick` 路由删除；`MatchStart.opponentLoadout` 及 enqueue/room 的 loadout 上交删除（无重放即无消费方）。

## 7. 客户端设计

- 新 `web/src/pvp-ws.ts`：`PvpSocket`（connect/自动重连[指数退避，宽限期内]/onmessage 分发/send），URL 由 `location` 推导（https→wss）。
- 新 `web/src/pvp-snap.ts`：`Battle.pvpOwnSnapshot()`（本方侧→PvpSnap 序列化）+ `PvpOppView`（双缓冲快照 + 插值 + 特效老化）。
- `main.ts`：`onPvpMatched` 建 battle 后连 WS；frame 里每 100ms 发快照；收到 `oppSnap` 更新视图，渲染前 `bridgeOpponentFromSnap`；`endPvpSession` 关 WS（复用 4 退出路径）。
- **拆除**（单人零影响不变）：`oppBattle`、`applyPvpInput`、10 处 `record` 打点、`PvpSync` 出/入站缓冲与 seq 重传、`DELAY_TICKS`、`reconcileOppAlive`/`applyOppAuthority`（对手唐僧血直接来自其快照=发送端权威，假死不可能）。
- **保留**：本方固定步长累加器、`maybeOpenPvpWave`（本方按服务器纪元开波）、`pvpWaveStartTick`、波次上报、pause 认输、结算屏、匹配层。
- `nextWave` 纪元→本地换算沿用现有 `serverOffset` 对时。

## 8. 生命周期与终局

- 认输/唐僧死 → `status` 消息 → 服务器 `_resolve_terminal` → `result` 推送 → 既有结算流程（endPvpSession/结算屏不变）。
- 服务器 `result` 为唯一终局权威；客户端收到即冻结本方半场并进结算（沿用 `pvpResult` 门控）。
- 异常退出（关页）→ WS close → 6s 宽限 → `DisconnectTimeout`。

## 9. 反作弊（Plan D 素材）

服务器每 100ms 拿到完整快照 → 服务端校验天然可行：唐僧血单调不增、kills 单调不减、wave 不超前排程、units 上界。本计划只把 digest 派生接上 `_anticheat`（既有逻辑），深度校验留 Plan D。

## 10. 部署

- nginx 反代加 WS 支持（`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`，`/xy/api/versus/ws` location 或全局 /api 下统一加）。
- 沿用零停机流程（新目录解压 + 原子 ln -sfn 切换）。
- dev：vite 代理加 `ws: true`（本地联调/冒烟用）。

## 11. 测试策略

- **服务端**：帧编解码纯函数单测（掩码/分片长度/控制帧）；握手 Accept 计算；真 socket 集成测试（起 ThreadingHTTPServer 于临时端口，两条 WS 连接跑 hello→snap 转发→result 全链路）；断线宽限/重连恢复。
- **web**：快照 round-trip（battle→snap→bridge→ai* 断言镜像正确，复用 pvp-bridge 测试模式）；插值数学；PvpSocket 消息分发（mock WebSocket）。
- **删除过时测试**：pvp-determinism*、pvp-relay-reliability、pvp-opponent-loadout、pvp-battle（PvpSync）、battle.pvp-input（applyPvpInput）、pvp-authority-reconcile；保留 singleplayer-guard/pause-popup/settle/pvp-match/pvp-screen（按删改适配）。
- **端到端冒烟**（新能力）：本地起真 `server.py`（测试配置/端口），两个 puppeteer 页面经真 WS 打完整局：双方互见对方半场渲染、波次推进、result 结算、0 pageerror。不再依赖 mock fetch。

## 12. 取舍与不做

- 快照 JSON 不做二进制压缩（带宽余量大；协议留 `v` 版本号，量大再演进）。
- 重连不补历史快照（短暂空洞可接受）。
- 单位放置步进不做过渡动画（100ms 步进可接受，后续可加）。
- HTTP 匹配层不动（非延迟敏感）。
