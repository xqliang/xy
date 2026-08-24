# 五行相克（金木水火土）战斗系统设计

- 日期：2026-08-24
- 状态：已与用户逐节确认
- worktree：`five-elements`（分支 `worktree-five-elements`）

## 1. 目标与定位

给英雄、怪物、地图添加五行相克系统，定位**战斗策略层**：上阵前考虑「我方英雄五行 vs 地图（怪物）五行」，克制增伤、被克减伤。覆盖 PvE 主线与真人对战/AI 对战（PvP 数值天然覆盖，见 §7）。

**明确不做**：

- 不做相生环（只相克单环）
- 基础兵种（刀/枪/骑/弓）无五行，不参与克制
- 服务端（Python）零改动

## 2. 克制模型与数值

标准五行相克单环：**金 → 木 → 土 → 水 → 火 → 金**（箭头 = 克制方）。

| 关系 | 伤害倍率 |
|---|---|
| 攻击方克防御方 | × 1.25（`TUNING.wuxingAdvMul`）|
| 攻击方被克 | × 0.75（`TUNING.wuxingDisMul`）|
| 其他 / 任一方无属性 | × 1.0 |

倍率进 `web/src/battle.ts` 的 `TUNING`（中文行内注释 + DevTools 分组 + 文档同步，按项目耦合惯例）。

## 3. 新模块：`game-core/src/config/wuxing.ts`

放 `@core` 供前后端共用，从 `game-core/src/index.ts` 导出：

```ts
export type Element = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

export const ELEMENTS: { id: Element; zh: string; color: string }[] = [
  { id: 'metal', zh: '金', color: '#e8b423' },
  { id: 'wood',  zh: '木', color: '#4caf50' },
  { id: 'water', zh: '水', color: '#3d8bff' },
  { id: 'fire',  zh: '火', color: '#f4511e' },
  { id: 'earth', zh: '土', color: '#a1743c' },
];

// 纯函数：任一方为 null → 1.0；倍率取自调用方传入（TUNING），保持 core 无游戏态依赖
export function elementMul(atk: Element | null, def: Element | null, adv = 1.25, dis = 0.75): number;
```

## 4. 数据层

### 4.1 地图五行（`web/src/battle.ts`，对齐 `MAP_SKILL` 范式）

```ts
export const MAP_ELEMENT: Record<string, Element> = {
  huoyanshan: 'fire',  // 火焰山：烈焰
  liushahe: 'water',   // 流沙河：流沙
  baiguling: 'metal',  // 白骨岭：白骨肃杀
  pansidong: 'wood',   // 盘丝洞：蛛网藤蔓
  huangfengling: 'earth', // 黄风岭（新图）：黄沙
};
```

### 4.2 怪物五行

`Monster` / `MonsterSpec` / `makeOne`（`battle.ts:678` / `:5801` / `:5810`）加 `element: Element`，`makeOne` 内按 `MAP_ELEMENT[this.map.id]` 赋值——小怪、精英、骑兵、小 Boss、妖王**全部继承地图属性**（妖王不单设，保持规则最简）。

### 4.3 英雄五行（`web/src/generals.ts`）

`GeneralDef`（`generals.ts:24`）加 `element: Element`，24 将逐个人设配置，分布 **金5 / 木5 / 水5 / 火5 / 土4**：

| 五行 | 武将（定位） | 主题依据 |
|---|---|---|
| 金 (5) | 大圣T0输出、二郎T0输出、文殊T1辅助、金吒T2、白骨T2 | 金箍棒/银甲天眼/智慧剑锋/白骨肃杀 |
| 木 (5) | 铁扇T1控制、青牛T2、大蟒T2、慧殊T2、梵音T2 | 芭蕉扇/山林蛇蟒/莲台慧根 |
| 水 (5) | 八戒T0控制、白龙T1输出、沙僧T1控制、观音T1辅助、八仙T2 | 天蓬水军/西海龙/流沙河/净瓶甘露/八仙过海 |
| 火 (5) | 哪吒T0输出、红孩T1输出、老君T1辅助、红袍T2、丹君T2 | 三昧真火/八卦炼丹 |
| 土 (4) | 牛魔T1控制、铁背T2、流沙T2、牛郎T2 | 丑牛属土/铁背山岩/黄沙/男耕女织 |

分布结果（各图克制作战力）：

- 火焰山(火)←水系最强、白骨岭(金)←火系强、盘丝洞(木)←金系最强 → 老图克制阵容充足
- 流沙河(水)←土系、黄风岭(土)←木系偏弱 → **有意偏难**；±25% 幅度下非克制阵容只是略亏，不是不能打

## 5. 伤害注入（方案 A：统一落点）

所有伤害最终汇到 `hurtMonster` / `hurtAiMonster`（`battle.ts:4102` / `:4109`，全仓仅 10 处调用、全在 `battle.ts` 内）：

- 签名增加 `atkEl: Element | null` 参数；函数内 `dmg = Math.round(dmg * elementMul(atkEl, m.element, TUNING.wuxingAdvMul, TUNING.wuxingDisMul))`
- 10 处调用点：英雄普攻（`:6545`）、英雄大招（`:6568/:6569`，AI 半场同样传对应英雄 element）传 `g.def.element`；兵种普攻（`:6239`）、AI 兵种（`:5989`）、灼烧/流星等环境伤害（`:5338`/`:5469`/`:7420`）传 `null`
- 克制倍率同时传给 `spawnDamageFloat` 驱动飘字表现（§8）
- **不**把倍率乘进 `generalAtk` / `stat.atk`（会污染 POW 面板与图鉴战力语义）

## 6. 难度校准

- `estimateOptimalPower`（`battle.ts:5632`，→ Boss 血量预算 `splitBossHpBudget`）：计入「我方英雄阵容对当前图属性的**平均**克制倍率」（阵容与图属性都已知，均值可静态算，不引入随机）
- 初期不动任何现有血量/攻击数值；`ai-balance` 收敛区间（AI skill ∈ [0.72, 1.8]）是最终裁判，漂移时优先调 `TUNING.wuxing*`，不动关卡数值
- 英雄梯度目标（满5主力 > 满3过渡 > 2个满5武器）不受影响：克制是叠加乘区，不改基础 atk
- `TUNING` 新键按惯例：中文行内注释 + DevTools 分组 + 文档同步

## 7. PvP / 真人对战兼容

- 服务端是**快照转发、不结算战斗**（`server/api_versus.py` 已确认），双方客户端各跑各的 `battle.ts` 30Hz 固定步长模拟 → 五行改动只动前端即自动覆盖 PvP
- `elementMul` 纯函数、无随机 → 不破坏 lockstep 确定性
- 对手半场是快照木偶：快照带英雄 id，对手五行从本地 `generals.ts` 推导 → **协议零新增字段**
- 灰度期版本不一致：各端只结算自己半场，最坏两端强度差 ±25%，无同步风险
- AI 半场（`hurtAiMonster`）与本地 AI 对战同样自动生效

## 8. 表现层

- 元数据（中文名/主题色）在 `wuxing.ts`（§3），前后端共用
- **徽章**：圆形色底 + 汉字（金/木/水/火/土），纯 canvas 绘制，收口为单一 `drawElementBadge()` 工具函数，**不新生成图片素材**；落点：武将卡（手牌/棋盘/图鉴/选将）、怪物头顶小徽章、地图选择处本图属性徽章
- **克制反馈**：`hurtMonster` 算出的倍率传给 `spawnDamageFloat`——克制时飘字变大变元素色附「克」标记（复用 crit 飘字机制），被克时灰色弱化
- **帮助**：新增「五行相克」一节（环形克制说明 + 一句话规则），同步补帮助分区测试断言；图鉴补黄风岭条目

## 9. 新图「黄风岭」`huangfengling`（土）

- `web/src/board.ts` 新增第 5 个 `GameMap`：全新路径几何（不复用现有路径）、土黄系 `theme` 配色、`fenceGaps: []`
- `MAP_SKILL` 加 `huangfengling: 'slow'`（三昧神风裹足，复用现有技能类型，不新增）
- `pickDailyMap` 每日轮换自动纳入（按 `MAPS.length` 取模，无需改）
- **素材两步走**：v1 直接吃 `assets.ts:181` 现有回退（通用小妖/妖王立绘、默认 bgm），功能先全通；v1.5 再按既有素材管线（Seedream → 抠图 → pngquant → tos-upload）出黄风怪专属立绘与 bgm
- 轰天雷部署、真人对战等按 `MAPS` 数组驱动的功能自动兼容（无硬编码 4 图逻辑）

## 10. 测试与验收

| 测试 | 内容 |
|---|---|
| `web/tests/wuxing.test.ts`（新增）| `elementMul` 5×5 全表；`hurtMonster` 注入（克制 1.25 / 被克 0.75 / 兵种 null=1.0，`Math.round` 取整）；`MAP_ELEMENT` 五图齐全；24 将 element 全非空且分布 5/5/5/5/4；新图路径合法性（路径连通至唐僧、`initialBlock` 不与路径重叠）|
| 帮助测试（更新）| 分区断言补「五行相克」 |
| `ai-balance`（门禁）| `cd web && npx vitest run tests/ai-balance.test.ts` 必过 |
| tsc | 基线 ~28 既有错，验收 = 不新增 |
| 浏览器冒烟 | puppeteer（`window.__game` 钩子）验证：五行徽章渲染、黄风岭可进可通、克制飘字变色 |

## 11. 风险与对策

1. **ai-balance 漂移**（最大风险）——估算器修正 + 门禁双保险，漂移先调 `TUNING.wuxing*`
2. **新图路径几何错误**——随 `wuxing.test.ts` 补地图合法性校验
3. **表现层遗漏**——徽章绘制收口 `drawElementBadge()`，各处统一调用

## 12. 交付计划

worktree `five-elements` 内分阶段提交：

1. `@core` wuxing 纯函数 + 单测
2. 数据层挂字段（generals / MAP_ELEMENT / Monster）+ 分布校验测试
3. 伤害注入（hurtMonster/hurtAiMonster + 10 调用点）+ estimateOptimalPower 校准 → 跑 ai-balance
4. 黄风岭新图 + 地图合法性测试
5. 表现层（徽章/飘字/地图标识）
6. 帮助「五行相克」一节 + 图鉴 + 测试断言

收尾前 rebase main、解冲突后 ff 合并（多 worktree 并行惯例）。
