# 武将战斗参考

日期：2026-08-20  
代码来源：`web/src/generals.ts`、`web/src/battle.ts`（`castGeneralSkill`、`updateGenerals`、`inAttackRange`）

本文档记录武将**普攻 / 大招**的目标选取与范围伤害分类，便于调数值与写说明文案。

---

## 1. 命中判定与射程环

- 圆心：已激活武将两格的中点 `(ax, ay)`，可为半格坐标。
- 半径：`rge + rangeTolerance`，其中 `rangeTolerance = 0.5` 格（与选中时黄色范围环一致）。
- 判定：攻击圆与目标所在**方格**相交即命中（边相切不算）。
- 神兵「如意金箍棒」等加 `rge` 时，圆变大，可命中更多怪。
- UI 面板「范围」字段即上述 `rge`（含神兵加成时为 `generalRge`），**不区分普攻/大招**——对怪技能共用此环。

普攻与对怪大招共用同一套 `inRange` 列表；区别在于大招是否截断目标数，以及施放条件（见下节）。

---

## 2. 大招施放：CD 与射程

实现：`updateGenerals` → `castGeneralSkill`（`battle.ts`）。  
UI：武将信息面板展示「大招CD」——未激活为配置值 `skillCd`；激活后为 `剩余 / 总额`，就绪时显示「就绪 · Ns」。

### 2.0 施放条件

| 条件 | 对怪大招（burst/ranged/stun/knock/slow/heal/burn） | 友军大招（buff/cdr） |
|------|-----------------------------------------------------|----------------------|
| CD 就绪（`skillCd ≤ 0`） | 必须 | 必须 |
| 射程内至少 1 只怪 | **必须** | 不要求 |
| 结算对象 | `inRange` 内的怪 | 已激活友军武将 + 场上兵器 |
| 特效锚点 | 通常在最前目标附近 | 武将自身 |

流程：

1. 每帧对 `GeneralState.skillCd` 倒数；配置冷却为 `GeneralDef.skillCd`（秒）。
2. **新激活**（含拆开再合并）：`skillCd` 置为 `def.skillCd`（满 CD，需等待首轮冷却）；喂字/战斗升阶**不**重置 CD。
3. CD 归零后，若满足上表条件 → 调用 `castGeneralSkill`，再把 `skillCd` **重置为** `def.skillCd`。
4. 对怪大招：圈内无怪时**憋招**（CD 停在 0，进怪立刻放）。
5. `buff`/`cdr`：CD 好即放，与怪是否在圈无关；普攻仍吃同一射程环与 `targets`。
6. 升阶经验：普攻走 `combatExpFromHits`；每次大招另加固定 `heroSkillExp = 1.5`（友军大招空放也给）。

动画类型：`ultTypeOf(def)` — `ranged → crit`，其余 → `aoe`（仅影响表现）。

### 2.1 范围大招（射程内全体，无目标上限）

### 2.1 范围大招（射程内全体，无目标上限）

对 `inRange` 中**每一只**怪都结算；**没有** `maxTargets` 截断。

| skill 类型 | 代表英雄 | 大招效果 |
|------------|----------|----------|
| `burst` | 大圣、大蟒、哪吒、金吒 | 范围内全员 ×`heroBurstDmgMul`（3）攻击伤害 |
| `burn` | 红孩、红袍 | 范围内全员瞬时伤 + 持续灼烧 DoT |
| `stun` | 八戒、八仙、牛魔、青牛 | 范围内全员定身 + 伤害 |
| `knock` | 铁扇、铁背、沙僧、流沙 | 范围内全员击退 + 伤害 |
| `slow` | 白龙、白骨 | 范围内全员减速 + 伤害 |
| `heal` | 观音、梵音 | 范围内全员减速；每波最多为唐僧 +`heroHealHp`（1）血（几乎无伤害） |

**共 18 名武将**的大招属于对怪范围型。

#### 典型命中数量（无硬上限）

| 场景 | 大致只数 |
|------|----------|
| 常态（怪沿路拉开） | 2～5 |
| 同批叠怪且均在圈内 | 最多接近 `spawnBatchCap`（当前封顶 **10**） |
| 理论上界 | 场上所有在圈内的活怪 |

> 例：**大圣「七十二变·横扫」**（`burst`）与哪吒「万火齐发」同类，一次可打圈内全部怪；普攻仍受 `targets` 限制（大圣为 2）。

### 2.2 单体/贯穿大招（仅最近目标为主）

| 英雄 | skill | 说明 |
|------|-------|------|
| 二郎 | `ranged` | 以 `inRange[0]`（最靠前）为主目标，×`heroRangedDmgMul`（5）×暴击倍率（`CRIT_MULT = 1.5`）；光束走廊（垂直半宽 `heroBeamCorridor` = 0.95 格）上最多贯穿 `heroPierceMaxMain`（4）只；哮天犬咬最前高血目标：定身 `heroDogStunDur`（3s）、跟随特效 `heroDogTtl`（3s） |
| 牛郎 | `ranged` | 同上但 `heroPierceMaxTransit` = 1（单体过渡，无贯穿/无犬） |

### 2.3 友军辅助大招（不对怪结算）

| skill | 代表英雄 | 大招效果 | 触发条件 |
|-------|----------|----------|----------|
| `buff` | 老君、丹君 | 全体已激活武将 **与场上兵器** 短时攻击倍率（含自己） | CD 就绪即可，无需怪在圈内 |
| `cdr` | 文殊、慧殊 | 缩短**其他**武将大招剩余 CD，并缩短场上兵器当前攻击间隔 | CD 就绪即可，无需怪在圈内 |

`heroSkillFocusDps` 对 `heal` / `buff` / `cdr` 均计 **0**（不进 Boss 压力账本的大招秒伤）。

#### 老君 · 炼丹·金丹（`buff`）

- 满 5：`heroBuffAtkMulMain = 1.35`，`heroBuffDurMain = 5`s
- 满 3：`heroBuffAtkMulTransit = 1.20`，`heroBuffDurTransit = 3.5`s
- 武将写入 `GeneralState.buffAtkT` / `buffAtkMul`；兵器写入 `PlacedUnit.buffAtkT` / `buffAtkMul`
- 与仙丹、羁绊、神兵 **乘算**；刷新取较长时长与较高倍率
- 动画（约 0.85s）：八卦炉升起 → 太极环转 → 金丹外溅 + 地火冲击（暖金）

#### 文殊 · 般若·慧剑（`cdr`）

- 满 5：`heroCdrSecMain = 4`（秒）
- 满 3：`heroCdrSecTransit = 2.5`
- 武将：`ally.skillCd = max(0, skillCd - cdrSec)`；**不**缩短施法者自身刚重置的 CD
- 兵器：`unit.cooldown = max(0, cooldown - cdrSec)`（仅当前攻击间隔，不含永久攻速）
- 动画（约 0.85s）：双层青莲展开 → 三道慧剑弧斩 → 光尘外散（青金/莲紫）

#### 与观音分工

| 武将 | 作用对象 | 核心价值 |
|------|----------|----------|
| 观音 | 怪 + 唐僧 | 减速 + 每波限一次续命 |
| 老君 | 友军武将 + 兵器 | 短时全体攻击加成 |
| 文殊 | 友军武将 + 兵器 | 缩短大招 / 攻击间隔剩余 CD |

---

## 3. 普攻：多目标上限

实现：`updateGenerals`。在 `inRange` 内按**距出口从远到近**排序，最多打 `maxTargets` 个。

`maxTargets = floor(targets) + (概率多 1)`，其中多 1 的概率为 `targets` 的小数部分。

| targets | 英雄 | 普攻最多命中 |
|---------|------|-------------|
| **3** | 八戒 | 3 |
| **2** | 大圣、红孩、牛魔、铁扇、沙僧、观音、老君、文殊 | 2 |
| **1.5** | 大蟒、二郎、哪吒、金吒、红袍、八仙、青牛、铁背、流沙、白龙、梵音、丹君、慧殊 | 1～2（50% 多 1） |
| **1** | 牛郎、白骨 | 1 |

---

## 4. 全武将一览

| 英雄 | 门派 | 满阶 | skill | 大招结算 | skillCd | rge | 普攻 targets | 定位 |
|------|------|------|-------|----------|---------|-----|--------------|------|
| 大圣 | 大 | 5 | burst | 圈内全体 | 8 | 2.5 | 2 | 输出 T0 |
| 大蟒 | 大 | 3 | burst（蟒影横扫） | 圈内全体 | 10 | 2 | 1.5 | 过渡 |
| 二郎 | 郎 | 5 | ranged | **圈内单体** | 9 | 3 | 1.5 | 输出 T1 |
| 牛郎 | 郎 | 3 | ranged | **圈内单体** | 11 | 2.5 | 1 | 过渡 |
| 哪吒 | 吒 | 5 | burst | 圈内全体 | 10 | 3.0 | 1.5 | 输出 T0 |
| 金吒 | 吒 | 3 | burst | 圈内全体 | 11 | 2.5 | 1.5 | 过渡 |
| 红孩 | 红 | 5 | burn | 圈内全体 | 9 | 2.5 | 2 | 输出 T1 |
| 红袍 | 红 | 3 | burn | 圈内全体 | 10 | 2 | 1.5 | 过渡 |
| 八戒 | 八 | 5 | stun | 圈内全体 | 10 | 2 | 3 | 控制 T0 |
| 八仙 | 八 | 3 | stun | 圈内全体 | 12 | 1.5 | 2 | 过渡 |
| 牛魔 | 牛 | 5 | stun | 圈内全体 | 10 | 1.5 | 2 | 控制 T1 |
| 青牛 | 牛 | 3 | stun | 圈内全体 | 12 | 1.5 | 1.5 | 过渡 |
| 铁扇 | 铁 | 5 | knock | 圈内全体 | 10 | 2.5 | 2 | 控制 T1 |
| 铁背 | 铁 | 3 | knock | 圈内全体 | 12 | 2.0 | 1.5 | 过渡 |
| 沙僧 | 沙 | 5 | knock | 圈内全体 | 10 | 2.5 | 2 | 控制 T1 |
| 流沙 | 沙 | 3 | knock | 圈内全体 | 11 | 2 | 1.5 | 过渡 |
| 白龙 | 白 | 5 | slow | 圈内全体 | 9 | 2.5 | 1.5 | 输出 T1 |
| 白骨 | 白 | 3 | slow | 圈内全体 | 11 | 2 | 1 | 过渡 |
| 观音 | 音 | 5 | heal | 圈内（偏辅助） | 12 | 3 | 2 | 辅助 T1 |
| 梵音 | 音 | 3 | heal | 圈内（偏辅助） | 14 | 2.5 | 1.5 | 过渡 |
| 老君 | 君 | 5 | buff | **友军**（不吃怪射程） | 13 | 2.5 | 2 | 辅助 T1 |
| 丹君 | 君 | 3 | buff | **友军**（不吃怪射程） | 15 | 2.0 | 1.5 | 过渡 |
| 文殊 | 殊 | 5 | cdr | **友军**（不吃怪射程） | 13 | 2.5 | 2 | 辅助 T1 |
| 慧殊 | 殊 | 3 | cdr | **友军**（不吃怪射程） | 15 | 2.0 | 1.5 | 过渡 |

共 **12 门派 / 24 武将**。

---

## 5. 羁绊与升阶（简要）

- **大圣护法**：大圣激活时全队攻击 `+5%`（`BOND_ATK_BONUS = 0.05`），含兵器与友军武将。
- **局内升阶**：激活武将输出攒经验，基础 `expToNext = 5 × 2^level`（即 level0→1 需 5，1→2 需 10，2→3 需 20…）；再乘角色倍率 `generalExpCostMul`：输出（武器）`×1.3`、控制 `×1.15`、观音 `×1.05`，其余 `×1`（可用武将 `expCostMul` 覆盖）；阈值与当前进度均 `roundExp` 保留 1 位小数。经验系数 `combatExpFromHits` 为 `dmg × 加权命中 × 0.036`（多目标有折减）。选中已激活武将时信息面板展示「经验 当前 / 目标」（满级显示「满级」）。

---

## 6. 辅助线普攻（白阶基础，`generals.ts`）

> **过渡战力目标（2026-08-20，按同档 tier3 对比 2武器@3 校准）**：
> 满3过渡 @3（满阶）战力目标：输出型 ≈100 / 控制型 ≈75 / 辅助型 ≈60。
> 过渡 base atk **可高于**同门满5主力（过渡是早期 carry，同档 tier3 短暂强于主力@3），
> 但主力靠 tier4-5 更高上限（coeff 3.276 vs 过渡 2.1）反超，保证 **主力@5 >> 过渡@3**。
> 测试不变量：`generalPOW(main,5) > generalPOW(transit,3)`（见 support-heroes.test.ts）。

辅助线白阶基础值：

| 武将 | atk | frq |
|------|-----|-----|
| 观音 | 3.11 | 1.5 |
| 梵音 | 2.8 | 1.3 |
| 老君 / 文殊 | 3.33 | 1.4 |
| 丹君 / 慧殊 | 3.8 | 1.2 |

---

## 7. 控制 / 辅助大招数值（`TUNING`，2026-08-11）

| 常量 | 满5 | 满3 |
|------|-----|-----|
| 定身 `heroStunDur*` | 1.5s | 1.0s |
| 击退 `heroKnockPush*` | 1.5 格 | 1.0 格 |
| 炼丹攻击倍率 `heroBuffAtkMul*` | 1.35 | 1.20 |
| 炼丹持续 `heroBuffDur*` | 5s | 3.5s |
| 般若减 CD `heroCdrSec*` | 4s | 2.5s |

牛魔 / 青牛定身附带伤害倍率仍为 `heroChargeStunDmgMul = 2.0`（高于八戒线 `0.8`）。

### 大招伤害 / 贯穿 / 回复 / 动画时长（`TUNING`，2026-08-23 起可调）

| 常量 | 默认 | 含义 |
|------|------|------|
| `heroBurstDmgMul` | 3 | burst 系大招瞬时倍率 |
| `heroRangedDmgMul` | 5 | ranged 系大招基础倍率（再乘 `CRIT_MULT`） |
| `heroPierceMaxMain` / `heroPierceMaxTransit` | 4 / 1 | 二郎贯穿怪数 / 牛郎单体 |
| `heroBeamCorridor` | 0.95 格 | 贯穿光束走廊垂直半宽 |
| `heroDogStunDur` / `heroDogTtl` | 3s / 3s | 哮天犬定身与跟随时长 |
| `heroHealHp` | 1 | 观音系每波为唐僧回血 |
| `heroUltFxTtlLong/Bite/Support/Default` | 0.9 / 0.8 / 0.85 / 0.6 | 大招动画时长（大圣·红孩 / 白龙 / 辅助系 / 其余；纯视觉） |

### 唐僧受伤免疫

- `tangsengHurtImmuneDur = 3`：漏怪成功扣血后短暂免疫。
- 免疫期内再有怪越线：移除该怪，**不扣血、不给**舍身饲魔蟠桃（防同帧连扣 / 免疫窗刷桃）。
- AI 唐僧对称（`aiTangsengHurtImmuneT`）。

---

## 8. 征兵字/铲、武将匹配与布阵对称（`TUNING` / `word-draw.ts` / `autoplace.ts`，2026-08-12）

字牌与铲子在**征兵**时进入候选区（非挖地掉落）。有效字率 ≈ `(wordDrawChance + 招贤榜等加成) × wordSlotChanceMul`；每兵槽独立判定，单次征兵最多 `SUMMON_MAX_WORD_SLOTS` 字。另有连续无字 / 无铲（`shovelPityAfter`=**4**）/ 半对保底；强制出铲在字·半对·匹配保底之后执行，只替换剩余兵槽，不覆盖其它保底牌。

**玩家 `Battle.summon` 与 AI `Battle.aiSummon` 共用同一套字/铲/保底/软压规则**（各用独立计数与棋盘；见 §8.5）。

### 8.1 基础配额与掉率

| 常量 | 值 | 含义 |
|------|----|------|
| `wordDrawChance` | **0.08** | 每兵槽独立转字概率（英雄随机） |
| `SUMMON_MAX_WORD_SLOTS` | **2** | 单次征兵最多出几个字 |
| `PARTNER_BOOST` | **0.12** | 非保底时：半对孤儿所需配对字的抽字权重倍率（软加权） |
| `TRANSIT_RAMP_START/FULL` | 4 / 10 | 满3过渡武将在场时，**相对其组成波次**在后续 4-10 波内提升同门满5**非共享字**权重（age=当前波−组成波；age<4 不 boost、4→10 线性、≥10 满额）。各满3 独立计时，故不同波次组成的满3 各自爬坡；确保能在其组成后约 4-10 波抽到该字，把满3换非共享字升为同门满5（如牛郎 牛+郎 于第 5 波组成 → 第 9-15 波爬坡抽「二」→ 二郎）。组成波次记在 `GeneralState.formedWave`（首次激活时记录） |
| `TRANSIT_BOOST_MAX` | **8** | 上述爬坡满额倍率（×8，强压过满5基础 weight=1 与其它衰减） |
| `pairPityAfter` / `PAIR_PITY_AFTER` | 6 | 有孤儿且连续 N 次未补 → 强制抽一张配对字 |
| `PAIR_PITY_FOCUS_MIN_ORPHANS` | **3** | 半对保底聚焦阈值：场上独特单字 ≥ 该数 |
| `PAIR_PITY_FOCUS_W` | **0.4** | 保底时随机选中的孤儿，其配对字相对权重 |
| `PAIR_PITY_OTHER_W` | **0.2** | 保底时其余配对字相对权重（孤儿不足 3 时全部用此权） |
| `wordPityAfter` | **8** | 连续 N 次无字 → 下次强制 1 字 |
| `earlyWordCapWave` / `earlyWordCap` | 3 / 1 | 前 3 波征兵累计最多 1 字 |
| `earlyWordGuaranteeWave` / `earlyWordGuarantee` | 6 / 1 | 第 6 波仍无字则强制 1 字 |
| `earlyShovelWave` / `earlyShovelMin` / `earlyShovelMax` | 3 / 1 / 3 | 前 3 波征兵累计铲子 1–3（不含 `initialShovels`） |
| `shovelDrawChance` | **0.18** | 候选中出现铲子的概率（仍有待挖空位或地图桃树时） |
| `shovelPityAfter` | **4** | 连续 N 次无铲 → 强制 1 铲（同上；在匹配保底之后落定） |

单次征兵出铲上限 = `min(待挖空位 + 地图桃树数, early.maxShovels / summonMaxPerKey)`。桃树占住锁定格时仍可出铲（可先挪树再挖）；阵位全开且无桃树时不出铲。

满盘且激活将均为满 5 时**仍可出字**；`isHeroRosterComplete` 仅影响布阵优先（兵器顶孤儿），不再关闭征兵出字。

#### 半对保底（单字配对聚焦）

代码：`word-draw.ts` → `pickForcedPartnerChar`；征兵侧 `Battle.summon` / `aiSummon` 在 `forcePartner` 时调用。玩家与 AI **规则相同**（各用本方棋盘孤儿与独立 `summonsSincePair` / `aiSummonsSincePair`）。

**何时触发**

1. 非首次征兵，且本方棋盘存在未激活占用的单字（孤儿，`boardOrphanCharsNow` / AI 对称）。
2. 连续 `pairPityAfter`（**6**）次征兵仍未抽出可补该孤儿的配对字。
3. 本盘字槽策略允许强制配对（`allowForcePartner`，且 `wordSlotsCap > 0`）。

触发后本盘至少强制抽 **1** 张「仍缺的配对字」（`pendingPartnerChars`，已排除本盘 tray 已有字与场上达上限的字）；**不会**抽非配对字。

**强制抽字时的权重（聚焦）**

在仍缺的配对字集合 `need` 上加权抽取（相对权重，再归一化）：

| 条件 | 行为 |
|------|------|
| 场上独特单字数 ≥ `PAIR_PITY_FOCUS_MIN_ORPHANS`（**3**） | 在「仍有缺口配对」的独特孤儿中**随机选 1 个**作为聚焦；该孤儿所需、且落在 `need` 内的配对字权重 = `PAIR_PITY_FOCUS_W`（**0.4**）；`need` 内其余配对字权重 = `PAIR_PITY_OTHER_W`（**0.2**） |
| 独特单字不足 **3** | `need` 内全部配对字等权 `PAIR_PITY_OTHER_W`（**0.2**） |

说明：

- 「独特单字」按字去重；只统计至少还有一个配对字落在 `need` 里的孤儿。
- 同一聚焦孤儿若对应多个可补配对（如「大」→「圣」「蟒」），这些字各自权重均为 **0.4**。
- 非保底征兵时的软加权仍用 `PARTNER_BOOST`（**0.12**），与上表无关。
- 与 §8.3「匹配保底」（跨局/波段强制新匹配）是不同系统；匹配保底用 `forcedMatchWordChars` / `FORCE_MATCH_HALF_PAIR_P`。

### 8.2 匹配口径与软权重（玩家 / AI）

**匹配英雄**：某一武将双字同时存在于本方 `tray ∪ 棋盘字`（可组合，不必已激活摆位）。

| 常量 | 值 | 含义 |
|------|-----|------|
| `YIN_SUPPORT_PRESS_MUL` | **0.4** | 本方已出现观/音/梵后，君/殊门派字权重 ×0.4 |
| `RECENT_HERO_REPEAT_MUL` | **0.4** | 近 `RECENT_HERO_HISTORY_LEN`（**10**）局匹配过的武将字权重 ×0.4 |
| `YIN_SUPPORT_CHARS` | 观、音、梵 | 触发音系软压 |
| `YIN_PRESS_FAMILIES` | 君、殊 | 被软压的门派（老君/丹君/文殊/慧殊） |

- **音系软压**：玩家看 `wordCharCounts ∪ 己方棋盘`；AI 看 `aiWordCharCounts ∪ AI 棋盘`；本盘 tray 新出观/音/梵也会立刻加压（`yinPressActive`）。
- **近局降重**：玩家与 AI 共用开局注入的 `recentMatchedHeroIds`（来自玩家 `heroMatchHistory.recentMatched`）。
- 跨局持久化：`dasheng.heroMatchHistory`（`hero-match-history.ts`）存 `lastGameHadMatch` 与 `recentMatched`——**仅按玩家局末匹配更新**。

### 8.3 匹配保底（玩家 / AI 征兵）

| 规则 | 行为 |
|------|------|
| **每两盘必匹配** | 上一局玩家 `lastGameHadMatch=false` → 本局 `forceMatchThisGame` 与 `aiForceMatchThisGame` **同步开启**；各方独立计数，直至**本方**至少匹配 1 名武将 |
| **波 10 后每 10 波** | 窗口 11–20、21–30…；窗口末波（20/30…，含波间准备期）若**本方**窗口尚无新匹配 → 强制补对（玩家 `heroMatchWaves` / AI `aiHeroMatchWaves`） |
| 强制手段 | `forcedMatchWordChars`（受 `SUMMON_MAX_WORD_SLOTS` 限制） |
| 有半对可补时 | `FORCE_MATCH_HALF_PAIR_P`=**0.6** 补场上单字（只补能形成**新匹配**的半对）；**0.4** 给出一对双字皆未出场的新武将 |
| 无半对 / 新英雄抽不出 | 回退：半对补齐，或从未完整匹配武将中尽量出双字 |

仍保留随机抽字；保底仅在条件触发时硬塞。实现：`word-draw.ts` + `Battle.summon` / `Battle.aiSummon`。局末仅 `recordHeroMatchGame(玩家匹配)`；AI 匹配不写回 history。

### 8.4 布阵孤儿单字上限（`autoplace.ts`）

| 常量 | 值 | 含义 |
|------|----|------|
| `AI_MAX_ORPHAN_WORDS` | **4** | 未激活英雄单字最多保留数（已激活武将双字不计入） |

- **玩家一键布阵**与 **AI 征兵后布阵 / 战中补字**均传 `maxOrphanWords: AI_MAX_ORPHAN_WORDS`。
- 选留（`orphanKeepScore` / `selectOrphansToKeep`）：满5 字 ≫ 满3；补齐缺失职业（输出/控制/辅助）；同字、同门派降权。超出顶回 tray，tray 满则 `removeWord`。达上限后低分单字可留 tray。
- **冗余同字**：棋盘已有某字且 tray 同字当前不能凑对激活、也不能顶替更低阶同字时，优先部署其它字或武器（`trayWordIsRedundantDuplicate` / `mayLeaveWordInTray`）；仅在必须清空 tray 时再强制落同字。

### 8.5 布阵步数预算与落子时序（`autoplace.ts` / `PLACE_TIMING`）

| 常量 | 值 | 含义 |
|------|----|------|
| `PLAYER_PLACE_MAX_STEPS` / `AI_PLACE_MAX_STEPS` | **150** | 单轮自动布阵最多落子步（AI 别名等于玩家） |
| `PLAYER_PLACE_MAX_GUARD` / `AI_PLACE_MAX_GUARD` | **300** | 布阵循环护栏（防死循环；AI 同玩家） |
| `PLAYER_REPOSITION_MAX_STEPS` | **100** | 玩家一键布阵后的战中调位步数上限 |
| `PLAYER_PLACE_DEADLINE_MS` / `AI_PLACE_DEADLINE_MS` | **80 / 64** | 场上有怪时单帧布阵规划软超时（ms） |
| `PLACE_TIMING.digDur` | **0.4** | 挖坑动画（铲两下；每铲播 `shovel` 音效） |
| `PLACE_TIMING.dragDur` | **0.18** | 玩家一键布阵虚线拖拽时长（秒） |
| `PLACE_TIMING.staggerMin` / `staggerMax` | **0.18 / 0.25** | 连续落子间隔（秒） |

挖坑进行中可并行落**其他格**；新挖格预占，挖完后再落武器（`pendingPlace` / `digFx`）。

**布阵拖拽落子（防字牌复制）**：`queueAutoPlaceDrag` 入队时预扣 tray；同 `trayIndex` 不可二次排队；`commitAutoPlaceDrag` 仅处理仍在 `autoPlaceDragFx` 内的项，失败退回 tray。禁止 tray 已空仍用克隆 token 再落一份（表现为点一次布阵多出一个相同字）。

**铲子 + 桃树**：tray 仅剩挖不了的铲时，`sweepRemainingTrayDeploy` 不得空转调位。

### 8.6 玩家 ↔ AI：已对齐 vs 有意保留差异

| 规则 | 玩家 | AI | 说明 |
|------|------|-----|------|
| 字/铲/半对保底、前期配额 | ✓ | ✓ | 独立计数器 |
| 英雄匹配保底（跨局 + 波段） | ✓ | ✓ | 独立 `*ForceMatch*` / `*MatchWaves*`；跨局开关同源 |
| 音系软压 | ✓ | ✓ | 各看本方字池 |
| 近局武将降重 | ✓ | ✓ | 共享 `recentMatchedHeroIds` |
| 孤儿单字 ≤4 | ✓ 一键布阵 | ✓ 布阵/补字 | `AI_MAX_ORPHAN_WORDS` |
| 布阵 steps/guard | 150 / 300 | 150 / 300 | 常量别名相等 |
| 局末写入 `heroMatchHistory` | ✓ | ✗ | 避免 AI 匹配抬高玩家「上局已匹配」 |
| 次优落子 `pSubOptimal` | 0 | 随 `aiSkill` | 强度杠杆 |
| 挖铲出口随机权重 | ✗ | ✓ `randomDigExitWeight` | AI 挖格多样性 |
| 战中定时调位 | ✗（一键后一次性） | ✓ `tickAiBattleAdjust` | 节奏见 `versus-user-agent.md` |
| 征兵节奏 | 玩家点击 | `aiSummonTimer` | skill 越快间隔越短 |
| 功德桃 / 神兵 | 全额 meta | 无 bonusPeach；神兵按 skill 缩放 | |
| 手动拖放 / tray 召回 | ✓ | ✗ | 操作层差异 |

---

## 9. 波次压力、怪物血量与移速（`TUNING` / `board-power.ts`，2026-08-12）

### 9.1 小怪基础血量 `normalMonsterHp(wave)`

**前 3 波（≤ `monsterHpNoDiffTo`）绝对血量**（`monsterHpEarlyFixed`，不含境界）：

```
fixed(w) = monsterHpEarlyFixed[w−1] × wavePostMul
```

当前表：**20 / 40 / 65**。

**第 4 波起目标血量**（含境界；第 `MONSTER_HP_FROM_WAVE` 波起再与 DPS 公式取 max）：

```
static = (monsterHpBase + monsterHpStep × wave) × effectiveDifficulty × wavePostMul
powerHp = optimalDps × MONSTER_HP_KILL_SEC × pressureRatio × effectiveDifficulty × wavePostMul
target = max(static, powerHp)   // optimalDps=0 时回退 static
```

**爬坡**（从上波实际血量朝 target；起始波 `rampFrom = monsterHpNoDiffTo + 1`，默认 4）：

```
maxStep(w) = monsterHpStep × monsterHpRampMul + (w − rampFrom)
hp(w) = w ≤ monsterHpNoDiffTo ? fixed(w) : min(target(w), hp(w−1) + maxStep(w))
```

| 常量 | 值 | 说明 |
|------|-----|------|
| `monsterHpEarlyFixed` | **[20, 40, 65]** | 波 1–3 绝对血量 |
| `monsterHpBase` | **10** | 爬坡期静态公式基数 |
| `monsterHpStep` | **13** | 静态公式每波 +13；爬坡步长基准 |
| `monsterHpNoDiffTo` | 3 | 波 1–3 用 EarlyFixed |
| `monsterHpRampMul` | **2** | 爬坡：`step×2 + (wave−rampFrom)` |
| `wavePostMul` | 波 ≤10 → 1；否则 `1 + (wave−10)/100` | 波 >10 每波 HP +1% |

| 常量（`BOARD_POWER`） | 值 |
|----------------------|-----|
| `MONSTER_HP_FROM_WAVE` | 2 |
| `MONSTER_HP_KILL_SEC` | 3 |

例（目标境界 1.5、空板）：波 1–3 = 20/40/65；波 4 maxStep=`13×2+(4−4)=26` → min(93, 65+26)=91；波 5 maxStep=27… 直至追上 target。

### 9.2 各类型怪物血量（均从 `normalMonsterHp()` 起算）

| 类型 | 公式 | 关键倍率 |
|------|------|----------|
| 普通妖 | `normalMonsterHp()` | — |
| 精英 | × `eliteHpMul` | **1.4**（第 `eliteFromWave`=4 波起，概率 `eliteChance`=0.28） |
| 小 Boss | × `miniBossHpMul` | **3.5**（第 `miniBossFromWave`=5 波起，非妖王波概率 0.42） |
| 骑兵 | 在普通/精英上再 × `cavalryHpMul` | **2/3** |
| 妖王 | 开波 `max(normalMonsterHp, pathDamage × 压力比)`；双雄引妖王实时重算 | 见 `bossHpMulEarly`~`bossHpMul` |

小 Boss 额外血量计入本波出怪预算（`miniBossExtraHp = normalHp × (miniBossHpMul − 1)`）。

### 9.3 移速

| 类型 | 移速 |
|------|------|
| 普通妖 | 固定 `monsterSpd` = **0.6** 格/s（不随波次 / `effectiveDifficulty` 升高） |
| 骑兵 | × `cavalrySpdMul` = **1.25** |
| 小 Boss | × `miniBossSpdMul` = 0.82 |
| 妖王 | × `bossSpdMul` = 0.625 |

被动蛛网/淤泥、技能疾风/减速照常叠加。

### 9.4 骑兵波

第 `cavalryFromWave`（**5**）波起，每波 **50%** 概率成为骑兵波（`cavalryWaveChance`）。命中后本波占比：

| 波次 | 占比 | 常量 |
|------|------|------|
| 5–20 | 线性 **30% → 55%**（每波固定值） | `cavalryRatioRampStart/End`，`RampLoWave`=5，`RampHiWave`=20 |
| 21+ | 每波 **[56%, 70%]** 均匀随机 | `cavalryRatioLateLo/Hi` |

逐只普通怪独立判定是否变骑兵；妖王 / 小 Boss 不会是骑兵。

### 9.5 分圈难度 `effectiveDifficulty`

```
effectiveDifficulty = difficultyMul × endlessCycleStep ^ floor((wave−1) / endlessWavesPerCycle)
```

| 常量 | 值 |
|------|-----|
| `endlessWavesPerCycle` | 10 |
| `endlessCycleStep` | **1.2** |

| 波次 | 圈系数 |
|------|--------|
| 1–10 | ×1 |
| 11–20 | ×1.2 |
| 21–30 | ×1.44（1.2²） |

对战与无尽共用；写入目标血量的 `effectiveDifficulty` 乘区（波 ≤ `monsterHpNoDiffTo` 不乘，其后经绝对血量爬坡逼近），**不影响移速**。

### 9.6 出怪压力（第 `PRESSURE_FROM_WAVE` 波起，默认 6）

| 机制 | 说明 |
|------|------|
| **出怪总量** | `planWavePressure`：最优 DPS × `PRESSURE_WINDOW_SEC`（10s）× 压力比；数量不低于 `monstersInWave(wave)`（10+n−1） |
| **同批叠怪** | `spawnBatchCap(wave)`：单次随机 1..N（波 6 起 N≥2，约波 22 封顶 10） |
| **压力比** | 波 ≤6 → 60%；6→20 线性至 75%；波 21 起每波 +2%（无封顶） |

| 常量（`BOARD_POWER`） | 值 |
|----------------------|-----|
| `PRESSURE_FROM_WAVE` | 6 |
| `PRESSURE_RATIO` / `PRESSURE_RATIO_MID` | 0.60 / 0.75 |
| `PRESSURE_RATIO_MID_WAVE` | 20 |
| `PRESSURE_RATIO_STEP_AFTER` | 0.02 |
| `PRESSURE_WINDOW_SEC` | 10 |
| `SPAWN_BATCH_CAP_MAX` | 10 |

出怪间隔不再随难度缩短（`difficultySpawnFactor = 1`）；仅保留 `spawnInterval`（1.25s）与门口防秒杀压间隔。

---

## 10. 相关文件

| 用途 | 路径 |
|------|------|
| 武将表 | `web/src/generals.ts` |
| 战斗结算 | `web/src/battle.ts` |
| 承压 / 出怪规划 | `web/src/board-power.ts` |
| 征兵前期配额 | `web/src/summon-early.ts`、`web/src/summon-draw.ts`、`web/src/word-draw.ts` |
| 自动布阵 / 孤儿上限 / 步数预算 | `web/src/autoplace.ts` |
| 跨局匹配历史 | `web/src/hero-match-history.ts` |
| AI 强度 | `web/src/ai-skill.ts` |
| 大招动画 | `web/src/render.ts`（`drawHeroUlt` / `drawUltDasheng` 等） |
| 门派与满阶设计 | `docs/superpowers/specs/2026-08-07-general-family-max-tier-design.md` |
| 辅助武将设计 | `docs/superpowers/specs/2026-08-11-support-heroes-laojun-wenshu-design.md` |
| 大招动画设计 | `docs/superpowers/specs/2026-08-05-hero-skills-ultimate-animations-design.md` |
| 对战代理与 AI 节奏 | `docs/versus-user-agent.md` |
