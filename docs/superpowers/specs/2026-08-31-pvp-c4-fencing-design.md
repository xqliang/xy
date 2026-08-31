# PvP C4-fencing 设计:每局 owner 令牌,防瞬时双 owner 双写/误删 mstate

> 状态:设计已与用户确认(2026-08-31)。里程碑 C 的 C4 的一个可独立落地、可单测的子集(fencing 机制)。再均衡/零停机发版依赖 C3 多实例,不在本设计。

## 目标

给每局加一个 **owner 令牌**,使得当 C3 落地后一局的 owner 因实例重启/故障/再均衡而切换时,**只有当前持令牌的实例能写/删该局的 `xy:pvp:mstate:{mid}`**;失去归属的旧 owner 的写(周期 flush)与删(`_reap`/forfeit 经 `_forget_match_state`)被"栅栏"挡住,不覆盖/不误删新 owner 的活态。单实例下恒通过,零行为变化。

## 背景与动机

- C2 让 `mstate:{mid}` 成为跨实例懒认领/接管的数据源;C2 终审已点名隐患:C3 若允许瞬时双 owner,两实例都写 `mstate` → last-writer-wins → 旧 owner 陈旧写覆盖新 owner 活态。
- 探查(2026-08-31)进一步发现两条**旧 owner 会误删新 owner mstate** 的路径:
  - `_reap` 回收循环里调 `_forget_match_state(mid)`(C2 加):旧 owner IDLE-reap 其陈旧内存副本时会 `DEL mstate:{mid}`。
  - 新增 `forfeit` 端点(main `f7397b6`)**可在任意实例运行**:它像 `ws_hello` 一样 `_load_match_from_redis` 懒认领,再经 `_set_result`/`_set_no_contest` → `_forget_match_state` 删 mstate。
- 故 fencing 必须同时覆盖**写(flush)**与**删(`_forget_match_state`)**两个 choke point;认领点覆盖建局与懒认领接管。

## 现状锚点(探查确认,均在 `server/api_versus.py`)

- `__init__`(62-83):有 `self.r`/`self.matches`/`self.lock`/`self._flush_lock`;**无 instance_id**。构造点 `server.py:153` 只传 `db` + `redis_client`,不传身份 → instance_id 在 `__init__` 内生成最省事。
- `_queue_match_record`(167-176):建局往 pipe 写 `match:{mid}`/`tm`,被 `_make_match`(标准)与 `_pair_once`(撮合 WATCH/MULTI 内)共用 → 认领 owner 的天然落点(与轻量记录原子)。
- `_load_match_from_redis`(943-968):懒认领接管点,`ws_hello`(729)与 `forfeit`(561)都经它 → 抢占 owner 的落点。
- `flush_active_matches`(902-941):当前用 `pipeline(transaction=False)` 一把批量 SET 所有局的 mstate(C2 已把写移进 `self.lock`)→ 改逐局 WATCH/MULTI fence。
- `_forget_match_state`(970-978):所有 mstate DEL 的唯一 choke point(终局 `_set_result`/`_set_draw`/`_set_no_contest` 与 `_reap` 都经它)→ 加 owner 守卫。
- 现成 WATCH/MULTI idiom:`_pair_once`(230-261),`from redis.exceptions import WatchError`(15),`pipe=self.r.pipeline()`→`watch`→`exists/get`→`unwatch` 或 `multi`→`execute`,`except WatchError: continue`,`finally: pipe.reset()`,`for _ in range(8)` 重试。
- 常量:`MATCH_REAP_MS = 120_000`(mstate/match/tm 的 TTL)→ owner key 复用之,同寿过期。
- 测试:`rhub` 夹具存 `h._redis_server`(FakeServer),`_reopen(db, srv, start_ms)` 起共享后端的第二 hub → 现成"旧 owner vs 新 owner"设置。fakeredis 支持 WATCH/MULTI(`_pair_once` 已依赖)与 SET/GET/DEL。

## 设计

### 实例身份
`__init__` 加可选参数 `instance_id: str | None = None`,`self.instance_id = instance_id or secrets.token_hex(8)`(镜像 `redis_client=None` 约定;server.py 无需改,每进程随机;测试可传定值)。`reset()` 不动 instance_id(进程身份,非每测状态;reset 的 `flushdb` 已清 owner key)。

### owner key
`xy:pvp:owner:{mid}`(经 `rediskv.k("owner", mid)`)= `self.instance_id`(字符串)。写/续期时 `PEXPIRE MATCH_REAP_MS`。

### 认领 owner(claim)
- **建局**:`_queue_match_record` 的 pipe 追加 `pipe.set(k("owner", mid), self.instance_id); pipe.pexpire(k("owner", mid), MATCH_REAP_MS)`。因 `_queue_match_record` 需要 mid/instance,签名不变(mid 已有;instance 用 self)。覆盖 `_make_match` 与 `_pair_once` 两路径,与轻量记录原子写入。
- **懒认领接管**:`_load_match_from_redis` 成功重建(插入 `self.matches` 后)`self.r.set(k("owner", mid), self.instance_id)` + `pexpire`。抢占式(blind SET,last claim wins);`ws_hello`/`forfeit` 都经此。

### fence 写点 1:flush 写 mstate(WATCH/MULTI,照搬 `_pair_once`)
`flush_active_matches` 的写循环从"一把非事务 pipe"改为**逐局事务**:
```
for mid, blob in snap:
    for _ in range(3):                      # WatchError 重试上限
        pipe = self.r.pipeline()             # transaction=True
        try:
            pipe.watch(k("owner", mid))
            if pipe.get(k("owner", mid)) != self.instance_id:
                pipe.unwatch()
                break                        # 已不是我 → 跳过（被 fence，不覆盖新 owner）
            pipe.multi()
            pipe.set(k("mstate", mid), blob)
            pipe.pexpire(k("mstate", mid), MATCH_REAP_MS)
            pipe.pexpire(k("owner", mid), MATCH_REAP_MS)   # 续期 owner，与 mstate 同寿
            pipe.execute()
            break
        except WatchError:
            continue                         # owner 在事务窗内被改 → 重试（下一轮 GET 会跳过）
        finally:
            pipe.reset()
```
快照仍在 `self.lock` 内构建(不变);写循环仍在 `self.lock`/`_flush_lock` 内(与 C2 一致)。由一把批量 pipe 变为逐局事务 pipe:局数有界 + 5s 周期,锁内多次往返成本可忽略(与 `_sweep` 锁内多轮 Redis IO 一致)。`decode_responses=True` → GET 返回 str,与 `self.instance_id`(str)直接比较。

### fence 写点 2:删 mstate(`_forget_match_state` 加 owner 守卫)
```
def _forget_match_state(self, mid):
    if self.r is None: return
    try:
        owner = self.r.get(k("owner", mid))
        if owner is not None and owner != self.instance_id:
            return                           # 属别人 → 不删（旧 owner 的 _reap/forfeit 不许删新 owner 态）
        self.r.delete(k("mstate", mid))
        self.r.delete(k("owner", mid))       # 终局/回收：owner key 一并清
    except Exception:
        logging.exception(...)
```
- `owner is None`(无主/已清)或 `== self.instance_id`(我持有)→ 删 mstate + owner。
- `owner != self.instance_id`(别人持有)→ 跳过,不动任何 key。
- 简单 GET-then-DEL(非事务):最坏在极小窗内多删一次,下一轮真 owner 的 flush(≤5s)重写 mstate 自愈;不值得为删加事务复杂度。

### 覆盖 forfeit(无需专门代码)
forfeit 经 `_load_match_from_redis`(懒认领 → claim owner)→ `_set_result`/`_set_no_contest` → `_forget_match_state`(带 owner 守卫)。故:
- forfeit 在**非 owner 实例**运行 → 它先懒认领抢占 owner(SET owner=me),再 `_forget_match_state` 时 owner==me → 合法删(这是参与者主动作废,正确)。
- 一个**未接管却陈旧**的实例即便调到 `_forget_match_state`(如其 `_reap`),owner≠me → 跳过。

## 取舍(已确认)

1. **fence-fail(flush)只跳过写,不把该局踢出 `self.matches`**:切换窗内客户端可能还连旧 owner;踢掉会断它。旧 owner 停止持久化即可,内存副本随后 IDLE-reap。
2. **`_forget_match_state` 用简单 GET 守卫,不用 WATCH/MULTI**:后果自愈,复杂度不划算。
3. **flush 写用 WATCH/MULTI**:这是主隐患(C2 点名),要强正确性。
4. **单实例零行为变化**:owner 恒==自己,flush/删照常。

## 明确不做(YAGNI / 依赖 C3)

- 再均衡(ring 变动重分配)、零停机滚动发版:依赖 C3 多实例,不在本设计。
- 终局判定(`_set_result` 等)本身不加 fence:终局由"连着的客户端"驱动,C3 把两端路由到 true owner;旧 owner 无连接不跑终局。真正无脑定时跑的是 flush(已 fence),删由 `_forget_match_state` fence 兜住。旧 owner 上客户端 surrender 的 split-brain 属 C3 集成问题,留 C3 跟进。
- instance_id 不做心跳/注册表(C3 再做)。

## 测试(`server/tests/`,fakeredis + 两 hub 共享 FakeServer)

- `test_create_claims_owner`:`_mk` 后 `GET owner:{mid}` == `hub.instance_id`。
- `test_lazy_load_takes_over_owner`:旧 hub 建局+flush;`_reopen` 新 hub → `ws_hello`(或 `_load_match_from_redis`)→ `GET owner` == 新 hub.instance_id ≠ 旧。
- `test_stale_owner_flush_is_fenced`:旧建局+flush(owner=旧);新接管(owner=新);新 flush 写入可区分的 mstate;旧再 flush → mstate 仍是新的(旧被 fence)。
- `test_stale_owner_forget_is_fenced`:旧 owns;新接管;旧 `_forget_match_state(mid)`(模拟 reap)→ mstate 仍在(未被旧删)。
- `test_owner_terminal_deletes_owner_key`:owner 终局 → `owner:{mid}` 与 `mstate:{mid}` 均删。
- `test_single_instance_flush_still_writes`:无第二 owner → flush 照写 mstate(fence 恒过);回归。
- 全量:`XY_DB_PORT=3308 python -m pytest -q` 不回归(尤其 `test_versus.py` 撮合、`test_versus_persist.py`、`test_versus_ws.py`)。
