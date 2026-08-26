# PvP 断线容错强化 — 设计方案

- 日期：2026-08-26
- 分支/worktree：`worktree-pvp-reconnect`
- 状态：设计已获用户批准（A1 完整 / A4 客户端探测 / grace 45s），待写实现计划
- 范围：真人对战（PvP / versus）对局期的断线容错、自动重连、减少断线

---

## 1. 背景与问题

真人对战遇到断线。经对客户端 + 服务端源码的逐条核实，**现状已有相当完整的容错与自动重连**，但存在几个明确缺口会导致"看起来老断线 / 被判掉线"。

### 1.1 现状（已验证）

**客户端 `web/src/pvp-ws.ts`（`PvpSocket`）**
- 自动重连，**无次数上限**：`handleClose()`（:211）→ `scheduleReconnect()`（:230），首试 300ms，之后 1s→2s→4s→封顶 5s 指数退避，成功 open 清零。
- 立即重连：回前台 / 网络恢复触发 `reconnectNow()`（`main.ts:207/2771/2776`）。
- 应用层心跳：每 2s ping，仅算 RTT 供 HUD，不判死（:143-159）。
- 半开检测：看门狗 `netDead()`，>10s 无入站判死（`pvp-netwatch.ts:10`，每帧 `main.ts:2525` 检查）。
- 会话内 rejoin：重连 open 后重发 `hello`（同 matchId+uid），断线期积压的 waveCleared/status 入队补发（:129-140,282-290）。
- 收发容错：畸形帧静默丢弃、未 open 发送丢弃/入队（:162-208,260-290）。
- 断线 UI：我方断线 `drawNetDeadOverlay`（`main.ts:467`）、对手断线 oppGone/oppBack（`main.ts:353/488`），均 10s 倒计时。

**服务端 `server/api_versus.py`（手写 RFC6455，单进程 `ThreadingHTTPServer`）**
- 断开感知靠 OSError/EOF/CLOSE 帧/空闲 2×5s/发送失败，无框架 `WebSocketDisconnect` 概念。
- 断线通知对手 `{"type":"oppGone"}`（:455）。
- 10s 宽限重连 `DISCONNECT_GRACE_MS`（:25），超时判负 `DisconnectTimeout →`（对手 `opponentDisconnectTimeout` / 自己 `selfDisconnect`，:343）。
- 保活 PING + pong echo；并发用一把全局大锁 + 每连接发送锁 + 陈旧连接身份比对。
- **活跃对局纯内存**（`VersusHub` 进程内字典 :68-74），代码注释明确"重启即丢活跃对局"（:5）。

### 1.2 缺口（按体感影响排序）

1. **刷新 / 小游戏被回收 → 无法 rejoin**：`matchId/uid/side` 只在 `PvpSocket` 内存，未持久化；页面上下文销毁即丢，只能重新匹配。最常见的断线诱因。
2. **服务端活跃对局零持久化**：`systemctl restart` 发版 = 硬重启 = 所有进行中对局全丢，重连必失败。
3. **鉴权失败被当普通断线**：token 失效后陷入无限退避重连，不提示重登。
4. **无"正在重连"提示**：断线到 10s 判死之间画面定格，体感像卡死。
5. 判负惰性（无后台定时线程，靠下条消息触发；极端双方静默要等 `IDLE_REAP_MS=300s`）。
6. 过时注释：`pvp-netwatch.ts` / `pvp-ws.ts:83` 写"6s"，实际 10s。

### 1.3 已验证的关键约束（推翻了此前的错误假设）

- **不存在 4001/4009 关闭码**。服务端鉴权失败是**握手前返回 HTTP 401**（`_ws_authenticate` → `send_json(handler, 401, …)`），WS 根本没 open；浏览器不把失败握手的 HTTP 状态暴露给 JS，客户端只收到 `onclose` code 1006 → **无法靠关闭码区分鉴权失败与网络失败**。这决定 A4 必须用别的机制。
- **WS URL 没有 `&side=`**（`buildWsUrl` 仅 matchId/uid/token，:309-323）。side 来自 `onPvpMatched(MatchStart)`。
- 客户端已有跨平台存储 `storage.ts`（`storeGet/storeSet/storeRemove`，Web=localStorage / 微信=wx storage）。
- 客户端已有 `battle-save.ts`（`saveResumeCheckpoint/loadResumeBattle/readBattleSave/clearBattleSave`），`saveResumeCheckpoint` 目前**内部守卫跳过 PvP**（`main.ts:2559`）——是跨刷新续玩的扩展点。

---

## 2. 目标 / 非目标

**目标**
- 显著降低"断线导致对局中断/被判负"的发生率与体感。
- 刷新 / 短暂被杀后能自动恢复正在进行的 PvP 对局。
- 服务端发版/重启不再丢活跃对局。
- 鉴权失效时给出正确引导而非无限重连。
- 提供数据支撑的心跳阈值调优（不拍脑袋改）。

**非目标**
- 多进程横向扩展 / Redis（当前单机规模 YAGNI，用户已确认）。
- 抗任意时长断网（超过 grace 仍判负，符合公平性）。
- 改动确定性 sim 本身。

---

## 3. 里程碑 A — 客户端断线韧性（纯 `web/`，可独立上线）

### A1 · 跨刷新/被杀后重进对局（**完整方案**）
持久化对局标识 + 扩展本地战局检查点，重进后自动重连恢复。

- **组件**
  - `storage.ts` 新增一条 active-PvP 记录 key（如 `pvp.active`），存 `{matchId, uid, side, startedAtMs}`。
  - `battle-save.ts`：去掉/放宽 `saveResumeCheckpoint` 的 isPvp 跳过，允许 PvP 检查点（含波次/HP/RNG 等确定性状态），并区分单人存档与 PvP 存档 key，互不覆盖。
  - `main.ts`：`onPvpMatched` 时写 active-PvP 记录并开始 PvP 检查点；收到 `result` / 手动退 / 判负时 `clearBattleSave` + 清 active-PvP 记录。
- **数据流（重进恢复）**：App 启动 → 读 active-PvP 记录 → 若 `now - startedAtMs < 恢复窗口`（对齐服务端 grace 45s）→ `loadResumeBattle` 恢复我方半场 → 用存的 matchId/uid/side `new PvpSocket(...).connect()` → 服务端在 grace 内（或已从 B5 持久化回放）→ hello 恢复 → 继续对局。**不弹"继续/首页"选择框**（PvP 时间在走，直接自动恢复以省 grace）。
- **一致性**：对手是快照木偶（见项目既有认知），恢复我方后继续发快照，对手 puppet 视角会有一次轻微跳变，可接受；波次/quorum/终局仍由服务端权威裁决。
- **错误处理**：恢复窗口已过 / 服务端已判负 / hello 返回 bad_hello → 清 active-PvP 记录 + 存档，回到匹配首页并提示"上局已结束"。

### A3 · "正在重连"横幅
- `PvpSocket` 暴露 `retryCount`（或 `reconnectAttempt`）只读快照。
- `main.ts` 新增 `drawReconnectingOverlay`（沿用 `drawNetDeadOverlay` 画法），`pvpSock.state==='reconnecting'` 且尚未 net-dead 时显示"正在重连…(第 N 次)"。
- 视觉优先级：settle > net-dead > reconnecting > pause。

### A4 · 鉴权失败短路（**客户端探测**）
- 因拿不到 close code：`PvpSocket` 记连续重连失败次数；达阈值（如 3 次）时，用 `apiFetch`（带 Bearer）打一个已 `require_auth` 的轻量端点（如 `/api/player`）探活。
  - 返回 401 → 判定 token 失效 → 停止重连 + 回调 `onAuthFail`。
  - 返回 200 → 认为是网络问题 → 继续退避重连。
- `main.ts` 收 `onAuthFail` → `clearToken()`（`auth-token.ts:19`）+ 提示"登录失效，请重新进入" + 退出对局。
- **附带修复**：重连用最新 token 重建 URL。把 `PvpSocket` 的静态 `token` 改为注入 `tokenProvider?: () => string | undefined`，`connect()` 内每次 `buildWsUrl(matchId, uid, tokenProvider?.())`（保持单测可注入）。

### A 期附带清理
- 修 `pvp-netwatch.ts` 文件头/函数 doc 与 `pvp-ws.ts:83` 的过时"6s"注释为"10s"（或参数化后写实际默认）。

### A 期接口小结
- `PvpSocket` 新增：`retryCount` 只读、`tokenProvider` 注入、`onAuthFail` 回调、鉴权探测阈值常量。
- `battle-save.ts` 新增：PvP 检查点存/取/清（独立 key）。
- `storage.ts`：active-PvP 记录读写（可直接用现有 `storeGet/Set/Remove` + JSON）。

---

## 4. 里程碑 B — 服务端持久化 + 撮合/网络加固（`server/` + 部署）

### B5 · 活跃对局持久化 + 重启回放
- **schema**：新增 MariaDB 表 `pvp_active_match`：`match_id` 主键、`updated_ms`、`version`（乐观并发）、`state_json`（权威状态：双方 uid/side、当前 wave/下一波排程、每侧 status(存活/认输/唐僧死)、quorum/进度、gone_ms/last_tick_ms）。**不存** ws_send、**不存**位置快照。
- **写入**：状态显著变化（波次推进、status 变更、终局）即在**锁内标脏**；实际**落库在大锁外**执行（沿用现有 poll 锁外读档模式，热路径不被 DB 串住）；`version` 单调递增，写时 `WHERE version < :new` 防旧覆盖新。终局后从活跃表删除（终局已有 `pvp_results` 落库）。
- **重启回放**：`VersusHub.__init__` 从 `pvp_active_match` 加载未终局对局到 `self.matches`，`ws_send=None`、`gone_ms=now`（全员视为断线待重连）。客户端在 grace 内重连 hello → 恢复。
- **优雅关机**：装 SIGTERM handler（现 `server.py:152` `serve_forever()` 无信号处理），`systemctl restart` 时先把所有活跃对局刷库再退出（best-effort，超时保护）。
- **并发安全**（用户硬要求）：脏标记/版本自增在锁内；DB 写在锁外且幂等；回放在 `__init__`（serve 前，无并发）。

### B6 · 撮合阶段防"僵尸局/打空气"
- 撮合成局后，要求双方在短窗口（6–8s）内 WS hello。
- 任一方超窗未现身 → 取消该 match，把**在场**玩家退回匹配队列重新撮合，而非让对手进去打空气。
- 清掉"enqueue 后失联仍被撮合"的缺口（现最长滞留 `QUEUE_TTL_MS=150s`）。

### B7 · 心跳判死阈值调优（**先测量，后定值**）
- 遵循"性能优化必须有 benchmark 数据"：**不盲目**把 10s 改小。
- 阈值保持可配（已是常量）；用现有 puppeteer 冒烟框架（见项目既有 web-smoke-test 认知）+ CDP `Network.emulateNetworkConditions` 搭弱网测量脚本，测不同阈值下"误判重连率 vs 断线检测延迟"。
- **交付数据**，评审时据数据定值。本设计不预设新阈值。

### B8 · 网络层 / 反代
- 确认 wss（已是）、TCP_NODELAY（服务端握手前已 set）。
- 排查 `peiyin.seealso.cn/xy` 反代 WS location 的 `proxy_read_timeout`/`proxy_send_timeout` 必须 > 心跳间隔，否则反代先掐连接。检查部署配置并按需改。

---

## 5. grace 时长

`DISCONNECT_GRACE_MS` 从 10s 拉到 **45s**（覆盖"刷新重载页面 + 重连"）。客户端 net-dead / opp-gone 倒计时同步为 45s。两端常量对齐。

---

## 6. 测试与验收（遵循项目既有约定）

- **服务端**：`server/` pytest 用 3308 一次性 MariaDB。新增：B5 持久化写/回放/幂等/版本并发测试、SIGTERM 刷库测试、B6 撮合超窗退队测试、grace 45s 相关既有测试更新。
- **前端**：vitest 放 `web/tests/**`（不放 src）。新增：A1 active 记录 + PvP 检查点存取、A4 探测短路状态机、重连横幅 state 驱动、tokenProvider 重连取新 token。
- **类型检查**：tsc 基线本有 ~28 处既有报错，验收标准 = **不新增**。
- **真机验证**（强制）：A 期改渲染/循环，必须浏览器真机验证——重连横幅、刷新续玩、鉴权失效提示。
- **B7**：交付弱网测量数据，不凭感觉改阈值。

---

## 7. 交付顺序

1. 里程碑 A（客户端，独立可上线）：A1 → A3 → A4 → 注释清理 → 真机验证 → 合并。
2. 里程碑 B（服务端 + 网络）：B5（schema + 写入 + 回放 + SIGTERM）→ grace 45s → B6 → B8 反代排查 → B7 测量定值。
- 各里程碑单独 plan、单独验收；共用本 spec。

---

## 8. 遗留 / 后续跟进
- A4 可选增强：B 期给服务端加"握手后发 `{"type":"error"}` + 关闭码 4001"精确信号，客户端改为优先读关闭码、探测兜底。
- B5 若未来真需多进程横向扩展，再评估 Redis + 分布式锁（当前 YAGNI）。
- 恢复窗口与 grace 的具体秒数可按 B7 真机数据回调。
