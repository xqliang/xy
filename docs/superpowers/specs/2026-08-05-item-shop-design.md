# 道具商城设计（局内道具 → 开局前购买）

日期：2026-08-05

## 背景与目标

现状：局内道具系统（`ITEMS` + 3 选 1）已是**半死代码**——`rollShop()` 定义于 `battle.ts` 但全项目零调用（历史 `821cbdb` 按用户「清波不弹窗直接继续」的要求主动移除了调用）。`chooseItem`/`pendingShop`/局内 3 选 1 UI 因此永不触发。

目标：**彻底移除「局内获取道具」这条链**，改为**开局前在「神秘商人」商城用功德主动购买**，与现有「主动技能每日装备」（`loadout.ts` + `actives.ts`）完全同构。

## 已确认的设计决策

1. **有效期**：每日重置——每天用功德重新购买，次日清空（照搬 `loadout.ts` 模式）。
2. **入口**：并入现有「神秘商人」页面，作为第三区（不新建独立页）。
3. **携带上限**：保留 `MAX_ENHANCE_ITEMS=2`（强化）、`MAX_PASSIVE_ITEMS=6`（被动），作为每日装备上限，形成 Build 取舍。
4. **双刃道具改非对称正向**（我方收益优于 AI 对手）：
   - 疾风咒 `jifeng`：我方全体攻速 **+50%**，AI 对手 **+25%**。
   - 同心咒 `tongxin`：我方唐僧 **+3** 血，对手唐僧 **+2** 血。
5. **商城布局**：三区叠加超屏高，采用**整页竖向滚动**（非分页签）。

## 架构：方案 A（新建 `itemLoadout.ts`，与 `loadout.ts` 并列）

遵循现有「一类消耗一个模块」风格（`loadout.ts`↔`actives.ts`、`merit.ts`↔`UPGRADES`）。道具装备状态独立成模块，`Battle` 构造函数多收一个 `items: string[]` 参数。

## 变更明细

### 1. 数据模型（`web/src/battle.ts`）

- `ItemDef` 接口增加 `cost: number`（购买消耗功德）。
- `ITEMS` 每项补 `cost`。定价草案（功德，可再调）：

  | 类别 | 道具 | 价 |
  |---|---|---|
  | 强化 | 仙丹 xiandan | 60 |
  | 强化 | 风火轮符 fenghuolun | 60 |
  | 强化 | 法宝符 fabaofu | 80 |
  | 强化 | 疾风咒 jifeng | 70 |
  | 被动·经济 | 蟠桃园 pantaoyuan | 40 |
  | 被动·经济 | 招贤榜 zhaoxian | 40 |
  | 被动·经济 | 摸金校尉 mojin | 40 |
  | 被动·经济 | 洛阳铲 luoyangchan | 50 |
  | 被动·经济 | 聚宝盆 jubaopen | 40 |
  | 被动·经济 | 仙缘幡 xianyuan | 50 |
  | 被动·防控 | 陨石 yunshi | 70 |
  | 被动·防控 | 淤泥 yuni | 50 |
  | 被动·防控 | 绊妖蛛网 zhuwang | 50 |
  | 被动·防控 | 护身金光 hushen | 40 |
  | 被动·防控 | 同心咒 tongxin | 60 |
  | 被动·防控 | 自动定海针 dinghai | 70 |

- 双刃道具改数值：
  - `jifeng` desc → 「全体攻速 +50%（AI 对手仅 +25%）」；`applyItem`：`this.mods.frqMul += 0.5; this.aiFrqMul += 0.25;`
  - `tongxin` desc → 「唐僧 +3 血（对手仅 +2）」；`applyItem`：`this.tangsengMaxHP += 3; this.tangsengHP += 3; this.aiTangsengHP += 2;`
  - kind 保持不变（jifeng=强化、tongxin=被动）。

### 2. 每日装备状态 `web/src/itemLoadout.ts`（新建，照搬 `loadout.ts`）

- `KEY = 'dasheng.items'`；`today()` 用与 `loadout.ts`/`stamina.ts` 一致的自然日算法。
- `interface ItemLoadoutState { day: number; equipped: string[]; }`
- `loadItemLoadout()`：读取；`day !== today()` 则清空重存。
- `isBought(state, id)`。
- `buyItem(state, merit, id)`：按 `buyActive` 同款返回 `{ state, merit, ok, reason? }`，校验顺序：
  1. `itemById(id)` 不存在 → `无此道具`
  2. 已购 → `已购买`
  3. 该 kind 已满（强化已购数 ≥2 或 被动已购数 ≥6）→ `强化道具已满(2)` / `被动道具已满(6)`
  4. `merit.merit < def.cost` → `功德不足`
  5. 通过 → `spendMerit` 扣费、`equipped` 追加、存盘。
- 按 kind 计数用 `itemById(id).kind` 过滤 `equipped`。

### 3. 商城 UI（`web/src/shop.ts` + `web/src/main.ts`）

- `ShopHit.kind` 增加 `'buyItem'`。
- 新增第三区「道具（每日重置 · 强化≤2 / 被动≤6）」，位于主动技能区下方，复用紧凑卡片样式；卡片显示：图标、名称、kind、desc、`购买 · N 功德` / `✓ 已购` / `该类已满`。
- `shopHitAt` 增道具卡命中；`drawShop` 增道具区渲染，签名加入 `itemLoadout: ItemLoadoutState`。
- **整页竖向滚动**：`drawShop` 引入 `scrollY` 偏移（所有卡片 y 减 `scrollY`），`shopHitAt` 命中判定同步加 `scrollY`；`main.ts` 记录 shop 页的滚动状态，绑定 wheel/touch 滚动事件，`scrollY` 夹在 `[0, contentHeight - VIEW_H]`。返回按钮固定不随滚动。
- `main.ts` shop 点击处理增 `buyItem` 分支（调用 `buyItem`，更新 merit 与 itemLoadout，设置 toast）。

### 4. 局内应用（`web/src/battle.ts` + `web/src/main.ts`）

- `Battle` 构造函数增第 7 参 `items: string[] = []`。
- 在构造函数**末尾**（初始解锁格设置之后，保证 `dinghai` 能取到 `lockedCells()`）遍历应用：
  ```
  const enh = items.filter(id => itemById(id)?.kind === '强化').slice(0, MAX_ENHANCE_ITEMS);
  const pas = items.filter(id => itemById(id)?.kind === '被动').slice(0, MAX_PASSIVE_ITEMS);
  for (const id of [...enh, ...pas]) { this.pickedItems.push(id); this.applyItem(id); }
  ```
- `main.ts` 三处 `new Battle(...)`（约 60/68/415 行）补传 `itemLoadout.equipped` 作第 7 参；`main.ts` 顶部 `loadItemLoadout()` 初始化，购买后刷新该变量。
- `pickedItems` 语义从「局内累积」变为「构造注入的本局道具」；局内被动技能条渲染（`render.ts` 遍历 `pickedItems`）自然沿用，显示本局已购被动。

### 5. 死代码清理

删除（行号为近似，实现时以符号为准）：
- `battle.ts`：`rollShop()`、`pendingShop` 字段及所有引用、`chooseItem()`、`canCarry(id)`、`itemCount(kind)`。
  - 说明：`canCarry` 仅被 `chooseItem` 与 `rollShop` 调用，`itemCount` 仅被 `canCarry` 调用，三者随局内获取链一并成为死代码。购买期的 2/6 计数改由 `itemLoadout.buyItem` 自行按 kind 过滤 `equipped` 完成。
- `render.ts`：`pendingShop` 相关的 3 选 1 弹窗渲染与命中区。
- `main.ts`：item 点击分支、`chooseItem` 接口声明与实现。

保留：`ITEMS`、`applyItem`、`itemById`、`MAX_ENHANCE_ITEMS`/`MAX_PASSIVE_ITEMS`、`passiveProgress`、`pickedItems` 字段、被动技能条渲染。

### 6. 测试

- 新增 `web/tests/item-shop.test.ts`：
  - `buyItem`：正常扣费追加；重复购买 `ok=false 已购买`；强化第 3 件 / 被动第 7 件 `已满`；功德不足；跨天 `loadItemLoadout` 清空。
- 新增 Battle 构造注入校验（可并入现有 battle/combat 测试或新建）：
  - `items:['xiandan']` → `mods.atkMul` 含 +0.15。
  - `items:['jifeng']` → `mods.frqMul` 含 +0.5 且 `aiFrqMul` 含 +0.25。
  - `items:['tongxin']` → 我方 `tangsengMaxHP` +3、`aiTangsengHP` +2。
  - `items:['dinghai']` → 额外解锁 1 阵位。
- 回归：删除 `pendingShop` 后，现有 vitest 全绿；`weaponcheck` 冒烟脚本通过。

## 非目标（本次不做）

- 日维度道具的「跨局累积」以外的经济系统（农民/荒地、转盘、道具升色）——属另立需求。
- 广告变现节点接入。
- 商城分页签布局（本次用滚动）。
