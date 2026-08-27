# PvP 多实例水平扩展 + 零停机（Redis 共享态）— 设计方案（Milestone C）

- 日期：2026-08-27
- worktree：`worktree-pvp-redis`（基于 main，含已合并的 A + B-core）
- 状态：设计中，待用户评审
- 已定架构决策（用户拍板）：**方 1a — 按 matchId 分片 + 反代一致性哈希路由 + 进程内中继 + Redis 共享态**；ECS 已有 Redis，直接用，**所有 key 加 `xy:` 前缀**。

---

## 1. 背景与目标

B-core 让单进程重启不丢活跃对局（MariaDB 镜像 + 回放）。现在要**真多实例水平扩展**：多个 server 实例，任一局可由某个实例服务，加实例即扩容；同时发版零停机。

**关键取舍（已定，方 1a）**：一局归**一个实例**所有（owner，由 matchId 决定），该局两个客户端都路由到 owner 实例 → snap 中继走**进程内**（10Hz 热路径不进 Redis）。Redis 只承载**跨实例共享的东西**：匹配队列、对局归属、对局态镜像（供故障/发版时被另一实例接管）。水平扩展 = 对局按 matchId 分散到各实例。

**这会重做 B-core 的一部分**：B-core 的 `pvp_active_match` + `flush/load`（MariaDB 单进程回放）被 **Redis 共享态**取代/降级——Redis 本身跨实例且 survive 重启。`pvp_results` / `pvp_anomaly`（终局归档/异常）**保留**在 MariaDB。

---

## 2. 架构总览（方 1a）

```
         客户端A ─┐                        ┌─ 客户端B
                  │  wss://…/api/versus/ws?matchId=M   │
                  ▼                        ▼
         ┌────────────────────────────────────────┐
         │  反代(nginx)  upstream: hash $arg_matchId consistent │  ← 同 matchId 恒路由到同一后端
         └───────────────┬──────────────────────────┘
              ┌──────────┼───────────┐
           实例#1      实例#2  …    实例#N        （systemd 多单元 / 多端口）
              │          │
      (owner of M 的实例把 M 的两条 WS 都收在本进程 → 进程内中继)
              │
              ▼
        ┌───────────────── Redis (xy: 前缀) ─────────────────┐
        │ 匹配队列 / 私房 / ticket→match / match→owner /       │
        │ 活跃对局态镜像(供接管) / 分布式锁                     │
        └────────────────────────────────────────────────────┘
        （终局结果/异常仍写 MariaDB: pvp_results / pvp_anomaly）
```

- **路由**：反代对 `/api/versus/ws` 按 `?matchId=` 做 **consistent hash**（nginx `hash $arg_matchId consistent;`），保证同一局两个客户端落到同一后端 owner。匹配阶段的 HTTP（enqueue/poll/room）可走普通轮询（它们只读写 Redis 共享态，任意实例都行）。
- **owner 实例**：持有该局的内存态（沿用现有 `matches[mid]` 结构 + 进程内 `threading.Lock` 守护——因为只有 owner 碰它），并把关键态**节流镜像到 Redis**（供接管）。进程内中继逻辑（`ws_snap`→推给对手 ws_send）**基本不变**。
- **接管/再均衡**：实例增减 → 一致性哈希环变化 → 某些 matchId 的 owner 变了 → 老 owner 上那局的两个客户端 WS 断（老实例 drain/挂了）→ 客户端自动重连(A 期的无限重连)→ 反代按新环路由到**新 owner** → 新 owner 从 Redis 加载该局态 + `ws_hello` 重挂（复用 A 的重连 + B 的回放语义,只是源从 MariaDB 换 Redis）。这就是零停机发版 + 故障接管。

---

## 3. Redis 数据模型（所有 key 加 `xy:` 前缀）

| 用途 | key | 类型 | 说明 |
|---|---|---|---|
| 匹配队列(按 rank 分桶) | `xy:pvp:queue:{rank}` | ZSET/LIST | 成员=ticket；score=入队时刻(用于超时/公平)。跨实例共享。 |
| 排队者详情 | `xy:pvp:ticket:{ticket}` | HASH | uid/rank/enqueued_ms/(matched→match_id) |
| 私房 | `xy:pvp:room:{code}` | HASH | host uid/rank/map/created_ms |
| 对局态镜像 | `xy:pvp:match:{mid}` | STRING(JSON) 或 HASH | `_serialize_match` 的产物（复用 B-core 序列化，剔 ws_send）。owner 节流写。 |
| 对局归属 | `xy:pvp:match:{mid}:owner` | STRING | 当前 owner 实例 id（诊断/接管用；真实路由靠反代哈希，这个是软信息） |
| 活跃对局索引 | `xy:pvp:matches` | SET | 所有未终局 mid（供扫描/回收；替代 B-core 的全表 SELECT） |
| 分布式锁 | `xy:pvp:lock:queue` / `xy:pvp:lock:match:{mid}` | SET NX PX | 见 §4 |
| 实例心跳(可选) | `xy:pvp:instance:{id}` | STRING EX | 实例存活（再均衡/诊断） |

- 复用 B-core 的 `_serialize_match`/`_deserialize_match`（已剔 ws_send、int 键还原、回放重置时间戳、保留 connected_ever）——**序列化格式不变,只是落点从 MariaDB 换成 Redis**。
- TTL：`xy:pvp:match:{mid}` 设一个宽 TTL（如 10min）兜底防泄漏；owner 活着会持续刷新。

---

## 4. 并发模型（用户硬性要求：DB/共享态操作并发安全）

- **单 owner 原则消解大部分分布式并发**：一局只有 owner 实例碰它的内存态，故 `matches[mid]` 仍由 owner 进程内 `threading.Lock` 守护，**per-snap 无需分布式锁**（这是方 1a 的核心红利）。
- **真正需要跨实例原子的是共享结构**：
  - **匹配撮合**：多个实例并发从 `xy:pvp:queue:{rank}` 取人配对——用 **Lua 脚本原子**"取两个等待者 + 建 match + 写归属"（避免两实例把同一 ticket 各配一局）。或 `xy:pvp:lock:queue` 短锁串行撮合。
  - **对局态镜像写**：只有 owner 写自己那局，天然无写冲突；用 `SET`（可带 fencing/version 防旧 owner 回写——见接管）。
  - **接管**：新 owner 加载前，用 `xy:pvp:match:{mid}:owner` + 一个 fencing token/version 确保老 owner 不再回写（老 owner 发现自己不再是 owner 就停写）。
- **禁止两个实例同时 owner 同一局**：靠反代一致性哈希（同 matchId→同后端）保证；哈希环变更瞬间的边界由 fencing/version + 客户端重连兜底（老连接断、新 owner 接管）。

---

## 5. 匹配（matchmaking）搬到 Redis

- `enqueue`/`poll`/`cancel`/`room_create`/`room_join` 从"进程内字典"改为"读写 Redis 共享结构"（任意实例都能处理这些 HTTP，走普通轮询即可）。
- 撮合成局：Lua 原子取两等待者 → 生成 mid → 写 `xy:pvp:match:{mid}`（初始态）+ `xy:pvp:matches` + ticket→match 映射。poll 返回 matchId,客户端连 `?matchId=` → 反代路由到 owner → owner 首次见到该 mid 时从 Redis 载入内存(或按需懒加载)。
- **owner 如何"认领"一局**：owner 实例在某客户端首次 `ws_hello(matchId)` 到达本进程时,若本地 `matches` 无此 mid,则从 `xy:pvp:match:{mid}` 载入内存并开始服务(懒认领)。因反代保证同 mid 同后端,两个客户端都会到这同一 owner。

---

## 6. 对局态镜像与接管（复用 B-core 语义,落点换 Redis）

- **owner 节流镜像**：owner 每 ~2-5s（+ 关键事件:波次/终局/断线）把 `_serialize_match(m)` 写 `xy:pvp:match:{mid}`（复用 B-core flush 的锁内快照+锁外写,`_flush_lock` 串行）。
- **接管加载**：新 owner 懒认领时 `_deserialize_match(json.loads(redis.get))`（复用 B-core），gone_ms/last_tick_ms/created_ms 重置为 now、保留 connected_ever（B-core I1 修复的语义）→ 客户端 `ws_hello` 重连恢复。
- **终局**：写 `pvp_results`(MariaDB,不变) + 删 `xy:pvp:match:{mid}` 与 `xy:pvp:matches` 成员。
- **回收**：用 `xy:pvp:matches` SET 扫描替代 B-core 的全表 reconcile；owner 定期清自己拥有的终局/废弃局。跨实例孤儿(owner 挂了没人清)靠 match key TTL 兜底。

---

## 7. 与 B-core 的关系（明确重做范围）

- **移除/降级**：B-core 的 `pvp_active_match` 表 + `flush_active_matches`/`load_active_matches`(MariaDB) → 由 Redis 镜像取代。`_serialize_match`/`_deserialize_match` **保留复用**。server.py 的"启动回放"改为"懒认领 from Redis";SIGTERM 优雅关机保留(改为:停止认领新局 + 把本实例 owner 的局镜像刷一遍 Redis + 让客户端重连到新 owner)。
- **保留**:grace 45s、撮合退队(`_reap` 逻辑迁到 Redis 扫描)、打空气判胜(B4b)、A 期全部客户端韧性(重连/横幅/鉴权,天然适配——客户端重连时反代按 matchId 路由到新 owner)。

---

## 8. #2 打空气：空赢不算正常胜 / 退队重匹配（用户已选）

- 对手从未连接(B4b 触发)时,不再直接给"空赢",而是:**把在场方退回 Redis 匹配队列重新匹配**(优先),并**不把这次记为正常胜/不计连胜/不掉分**。
- 落点:B4b 的 `_ws_check_gone_locked` 分支 + 撮合队列(Redis)。给在场方推一个"对手未到场,正在为你重新匹配"的信号(新增轻量 reason/type,客户端提示 + 自动回匹配)。这与 Redis 匹配队列改造同期做最省。

---

## 9. 基础设施 / 部署改动

- **依赖**:`server/requirements.txt` 加 `redis>=5`(redis-py)。
- **配置**:`config.py`/`config.yaml` 加 Redis 段(host/port/db/password),key 前缀常量 `xy:`。测试用 ECS 那台 Redis 的独立 db 号或 `xy:test:` 前缀隔离(避免踩生产键)。
- **反代**:nginx upstream 对 `/api/versus/ws` 配 `hash $arg_matchId consistent;`(需确认现网反代支持;若走的是别的反代要对应配置)。匹配 HTTP 端点普通轮询。
- **多实例拉起**:systemd 多单元(xy-web@1..N,各监听不同端口)或进程管理器;反代 upstream 池列这些后端。
- **实例 id**:每实例一个稳定 id(端口/环境变量),写 `xy:pvp:match:{mid}:owner` 与心跳。

---

## 10. 分子里程碑（各自 spec→plan→实现;不要一把梭）

- **C1 · Redis 客户端 + 配置 + 匹配队列迁移**:接入 redis-py、config、`xy:` 前缀;`enqueue/poll/cancel/room_*` 改用 Redis 共享结构(Lua 原子撮合)。单实例即可测(行为对齐现状)。
- **C2 · 对局态镜像到 Redis + 懒认领/接管**:owner 节流写 `xy:pvp:match:{mid}`;首次 hello 懒认领;替换 B-core MariaDB flush/load。
- **C3 · 反代一致性哈希 + 多实例部署**:nginx `hash $arg_matchId consistent`;systemd 多单元;instance id/心跳。这是"真多实例"落地的一步。
- **C4 · 故障接管 / 再均衡 / 零停机发版**:环变更时的 fencing、老 owner 停写、drain 发版流程。
- **C5 · #2 打空气退队重匹配 + 空赢不计战绩**。
- （C1/C2 单实例可先跑起来并验证等价;C3+ 才需要多实例 + 反代改造。）

---

## 11. 测试策略

- 需要一个测试 Redis:用 ECS 那台的独立 db 号(如 `db=15`)或专用 `xy:test:` 前缀 + 每测试清理,避免踩生产键。fakeredis 也可用于纯逻辑单测(不连真 Redis)。
- 撮合原子性、镜像 round-trip(复用 B-core 序列化测试)、懒认领加载、接管(模拟 owner 切换:实例A建局→序列化进 Redis→实例B载入→ws_hello 恢复)、多实例撮合并发不重复配对(Lua 原子)。
- 服务端 pytest 仍用 3308 MariaDB(终局归档不变)。客户端 A 期行为不变(vitest/tsc)。

---

## 12. 风险 / 待确认

- **反代能否 `hash $arg_matchId consistent`**:方 1a 的前提。需确认现网反代(nginx?)支持按 query 参数一致性哈希;不支持则要么换 1b(匹配返回实例地址、客户端直连)、要么被迫方 2(pub/sub)。**这是 C3 的硬前提,动 C3 前必须核实。**
- **环变更瞬间的一致性**:哈希环增减实例时,部分 mid 的 owner 迁移,迁移窗内的 fencing/旧 owner 停写要做对,否则短暂双写。靠 version/fencing + 客户端重连兜底。
- **懒认领竞态**:同 mid 两客户端几乎同时到同一 owner(反代保证同后端)→ owner 内用 per-mid 认领锁防重复 load。
- **匹配公平/超时**:Redis ZSET 实现的排队超时/退队要对齐现有 `MATCH_TIMEOUT_MS`/`QUEUE_TTL_MS` 语义。
- **安全**:matchId 在 URL query 里(反代要读它做哈希)——本就如此;鉴权仍 token/uid(A/B 已有)。

---

## 13. 非目标

- 不改客户端 sim/确定性、不改 A 期客户端韧性(天然适配)。
- 不追求跨机房/多区域(单 ECS 多实例即可)。
- 不在 C-core 里做 pub/sub 全共享(方 2)——除非 C3 发现反代无法按 matchId 哈希才回退。
