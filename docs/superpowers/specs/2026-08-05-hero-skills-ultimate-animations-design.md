# 武将技能特色化：每英雄专属大招动画 + 合成等级/单字面板修正

日期：2026-08-05
状态：已与用户对齐，待写实现计划

## 背景

当前武将（英雄）系统：两个同将字牌左右紧邻 → 激活武将（占两格，套金框）。每个武将有一个
`skill` 类型（burst/ranged/stun/knock/slow/heal/none）和 `skillCd`，战斗中冷却到点且范围内
有妖怪时由 `battle.ts:castGeneralSkill()` 自动施放。

四个问题：
1. 合成后每个单字仍显示自己的 `tier` 上标，和金框整体 `Lv` 重复。
2. 所有武将技能的表现都是同一个通用 `Burst` 圆圈，无辨识度、无各自动画。
3. 没有"定期大招"的概念与群攻/暴击的差异化表现。
4. 单字介绍面板：底部状态行与属性行重叠；且未标明单字状态下技能不生效。

## 目标与非目标

**目标**
- 每个有技能的英雄（11 个，弥勒无）拥有一套专属大招动画。
- 大招按定位自动分为"群攻(aoe)"与"暴击(crit)"两种机制与表现。
- 大招复用现有 `skillCd` 定期自动触发，不新增独立系统。
- 合成后只显示整体等级，单字上标在激活英雄占用格上隐藏。
- 单字介绍面板标明技能未生效，并修复底部排版重叠。

**非目标**
- 不新增第二条独立大招冷却系统。
- 不改动主动技能（actives.ts）、被动、道具系统。
- 不做数值大改；仅在暴击时引入倍率与飘字表现。

## 设计

### 1. 合成后只显示整体等级（render.ts）

- `drawWordTile(ctx, char, tier, x, y, s, showTier = true)` 新增 `showTier` 参数；
  `showTier === false` 时跳过 render.ts:384-388 的阶数上标绘制。
- `drawGenerals()` 中：先用 `b.activeGenerals()` 收集所有已激活英雄占用格的 `"c,r"` 集合；
  在画字牌循环（render.ts:1166-1170）里，若该格在集合内则传 `showTier:false`。
- 金框上方整体 `${g.def.name}·Lv${g.state.level}`（render.ts:1193）与经验条保持不变。
- 散落单字牌、备战托盘（render.ts:364）、拖拽 ghost（render.ts:1732）默认 `showTier:true` 不变。

### 2 & 3. 每英雄专属大招动画 + 群攻/暴击（battle.ts + render.ts）

**数据层（generals.ts）**
- `GeneralDef` 新增 `ultType: 'aoe' | 'crit'`（弥勒可省略或标 `'aoe'`，因 skill='none' 不触发）。
- 自动分配（与 skill 类型对齐）：`ranged → crit`，其余（burst/stun/knock/slow/heal）→ `aoe`。
  最终：哪吒/二郎 = crit；悟空/红孩/八戒/铁扇/沙僧/牛魔/观音/白骨/御弟 = aoe；弥勒无。

**特效数据结构（battle.ts）**
- 新增 `interface UltFx { heroId: string; c: number; r: number; ttl: number; maxTtl: number;
  tier: number; aoeR: number; }`（aoeR = 该英雄当前射程，用于范围类动画铺开）。
- `Battle` 新增字段 `ultFx: UltFx[] = []`；在主循环 tick 中按 dt 递减 ttl 并清除到期项
  （与 `bursts`/`fx` 同样的清理位置）。

**触发（battle.ts:castGeneralSkill）**
- 现有各 `case` 的效果结算逻辑保留（伤害/定身/击退/减速/回血）。
- 暴击型（ultType='crit'）：对 `inRange[0]` 施加暴击倍率（在现有 atk×倍数基础上再 ×1.6 左右，
  具体值实现时定并可后续 sweep 调平），并 push 一个飘字 Burst 或复用消息显示"暴击!"。
- 施放时不再 push 通用 `bursts`，改为 `this.ultFx.push({ heroId: g.def.id, ... })`。
  （群攻的范围伤害/控制仍照结算，仅表现层换成专属动画。）

**渲染（render.ts:drawUltFx）**
- 新增 `drawUltFx(ctx, b)`，在 `drawBursts` 之后调用；`switch (f.heroId)` 分派 11 套动画，
  每套用 `prog = 1 - ttl/maxTtl` 驱动，风格对齐现有 `drawFx`（缓动 + 发光 + 描边）：
  - 哪吒 crit：多支火尖枪从上方倾泻聚到单点 + 烈焰爆点
  - 二郎 crit：天眼睁开 → 竖向诛邪光束贯穿
  - 悟空 aoe：金箍棒大范围横扫金弧（复用 monkey 弧扫思路，范围更大）
  - 红孩 aoe：三昧真火由中心扩散的火花花瓣
  - 八戒 aoe：钉耙砸地 → 同心裂纹冲击波环
  - 铁扇 aoe：芭蕉扇狂风 → 叶片旋涡扩散
  - 沙僧 aoe：宝杖水平横扫 + 击退拖影线
  - 牛魔 aoe：蛮牛冲撞 → 直线尘土拖尾
  - 观音 aoe：净瓶甘露水滴下落 + 唐僧格金光回血提示
  - 白骨 aoe：骨雾灰白扩散云
  - 御弟 aoe：诵经金色经文字环逐层扩散
- crit 型附带"暴击!"红字上飘（可在 drawUltFx 内或复用现有飘字通道）。

### 4. 单字介绍面板：标明未生效 + 修排版（render.ts:900-976）

- 非激活分支（`!active`）：
  - 技能名（render.ts:937）与描述（render.ts:939）置灰（降低 alpha / 灰色系），
    并在技能名行尾追加小字「(未激活·不生效)」。
  - 面板高度 `ph` 由 118 → 134。
  - 属性行起点与底部状态行之间保证 ≥14px 间距，消除 `py+106` 与 `py+110` 重叠：
    属性行区与底部「未激活：需「X」左右紧邻」不再交叠。
- 激活分支（`active`）表现保持不变（ph=150 已无重叠）。

## 涉及文件

- `web/src/generals.ts`：`GeneralDef.ultType` 字段 + 各英雄赋值。
- `web/src/battle.ts`：`UltFx` 类型、`Battle.ultFx` 字段、tick 清理、`castGeneralSkill` 改为
  推 `ultFx` 并加暴击倍率。
- `web/src/render.ts`：`drawWordTile` 加 `showTier`、`drawGenerals` 收集激活格、
  新增 `drawUltFx` 及调用、单字面板置灰/追加标注/修 `ph` 与排版。

## 测试与验证

- `game-core` 的 vitest 不覆盖渲染；本次逻辑改动集中在表现层 + 暴击倍率。
- 暴击倍率若影响 combat 数值，补一条 `stats`/`combat` 单测断言暴击结算。
- 主要靠本地 dev server 实机验证：合成英雄看整体等级、各英雄大招动画、单字面板排版。
- 复跑 weaponcheck 冒烟脚本，确保未回归兵器出招/波间卡槽。

## 风险

- 11 套手绘动画工作量最大；按英雄逐个 case 实现，可分批合入、单独调参。
- 暴击倍率引入需注意不破坏后期数值曲线（可用 tools/sweep 复核）。
