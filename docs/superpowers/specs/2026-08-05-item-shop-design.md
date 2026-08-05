# 道具商城设计（修订版）：局内道具 → 收编进「每日被动技能商店」

日期：2026-08-05（修订，替换本文件初版）

## 修订缘由

初版 spec（本文件初稿，commit `aac9625`）写完后，仓库并行开发已合入一个**「开局前功德购买、每日重置、开局注入」的被动技能商店框架**（commit `e72cd98`）：`passives.ts` + `loadout.buyPassive` + `shop.ts` 被动区 + `main.ts` 接线 + `Battle` 构造函数第 8 参 `passives`。

因此初版的「新建 `itemLoadout.ts` + 独立道具商城」会**重复造轮子**。修订方向：**把旧 `ITEMS` 收编进现有被动技能商店框架**，复用其购买/UI/注入链，不再新建并列模块。

## 现状事实（已核对）

- 旧局内道具获取链仍**原样死在 `battle.ts`**：`rollShop`(未被调用)/`pendingShop`/`chooseItem`/`canCarry`/`itemCount`/`ITEMS`。
- 旧**效果引擎可用且可复用**：`applyItem(id)`（id→效果的 switch，见 battle.ts 885-910）+ `updateItemEffects(dt)`（洛阳铲/陨石等持续效果）+ `mods`。
- 新框架 battle 侧注入很简陋：构造函数仅 `this.gardenOn = passives.includes('pas_pantao')`，非通用分派。
- `PassiveSkillDef = { id, name, icon, cost, desc }`（无 `kind`）；`PASSIVE_SKILLS` 目前只有 `pas_pantao`（蟠桃园，取代旧 `pantaoyuan`）；`MAX_EQUIPPED_PASSIVES = 2`。
- `buyActive`/`buyPassive` 现为「**满了就拒绝**」（`最多装备 N 个`）。

## 已确认的设计决策

1. **复用现有被动技能商店框架**，不新建 `itemLoadout.ts`。
2. **购买/生效模型（用户新定）**：
   - 商城可展示多个主动 + 被动技能。
   - 当天**不限购买次数**，每次购买照扣功德（天然功德消耗口）。
   - **生效恒为「最新购买的 2 个主动 + 6 个被动」**；后买挤掉最早买的（FIFO：追加后超上限则移除最旧）。
   - 落地：`MAX_EQUIPPED_PASSIVES` 由 2 → **6**；`MAX_EQUIPPED_ACTIVES` 保持 **2**；`buyActive`/`buyPassive` 改为「不因满而拒绝，超限则 `shift()` 最旧」。
3. **迁移旧 ITEMS 为被动技能**：除已被 `pas_pantao` 取代的 `pantaoyuan` 外，全部收编进 `PASSIVE_SKILLS`；沿用旧 id（`xiandan` 等）使 `applyItem` 分派保持不变。
4. **双刃道具改非对称正向**：
   - 疾风咒 `jifeng`：我方全体攻速 **+50%**，AI 对手 **+25%**。
   - 同心咒 `tongxin`：我方唐僧 **+3** 血，对手唐僧 **+2** 血。
5. **删除旧局内获取链**（`rollShop`/`pendingShop`/`chooseItem`/`canCarry`/`itemCount` + render 3 选 1 弹窗）；**保留效果引擎**（`applyItem`/`updateItemEffects`/`mods`）。

## 架构

一句话：**shop 元数据来源统一到 `passives.ts`（`PASSIVE_SKILLS`），效果实现复用 `battle.ts` 的 `applyItem`/`updateItemEffects`，购买走 `loadout.buyPassive`，开局经构造函数 `passives` 参数按 id 通用注入。** 主动技能链保持现状，仅改「满则拒绝」为「FIFO 挤旧」。

## 变更明细

### 1. `web/src/passives.ts`（迁移 ITEMS → 被动技能池）

- `MAX_EQUIPPED_PASSIVES`：2 → **6**。
- `PASSIVE_SKILLS` 增加以下条目（沿用旧 id；`cost` 为草案功德价，可调）。desc 直接沿用旧 `ITEMS` 文案，双刃两项按新数值改写：

  | id | name | icon | cost | desc |
  |---|---|---|---|---|
  | xiandan | 仙丹 | 💊 | 60 | 全体攻击 +15% |
  | fenghuolun | 风火轮符 | 🌀 | 60 | 全体攻速 +20% |
  | fabaofu | 法宝符 | 📜 | 80 | 所有武将等级 +1 |
  | jifeng | 疾风咒 | 💨 | 70 | 全体攻速 +50%（AI 对手仅 +25%） |
  | zhaoxian | 招贤榜 | 📋 | 40 | 武将字牌掉率 +10% |
  | mojin | 摸金校尉 | ⛏ | 40 | 每次用铲子额外 +6 蟠桃 |
  | luoyangchan | 洛阳铲 | 🥄 | 50 | 每 45 秒自动获得 1 把铲子 |
  | yunshi | 陨石 | ☄ | 70 | 每波开始砸向最前妖怪 |
  | yuni | 淤泥 | 🟤 | 50 | 出怪口附近妖怪移速 -18% |
  | xianyuan | 仙缘幡 | 🎏 | 50 | 召唤成本 -1 |
  | jubaopen | 聚宝盆 | 💰 | 40 | 击杀额外 +1 蟠桃 |
  | hushen | 护身金光 | 🛡 | 40 | 唐僧 +1 血 |
  | zhuwang | 绊妖蛛网 | 🕸 | 50 | 妖怪移速 -12% |
  | tongxin | 同心咒 | ❤ | 60 | 唐僧 +3 血（对手仅 +2） |
  | dinghai | 自动定海针 | 🪡 | 70 | 立即开辟 1 阵位 |

- 保留既有 `pas_pantao`（蟠桃园）。**不迁移** 旧 `pantaoyuan`（已被取代）。

### 2. `web/src/loadout.ts`（购买语义：不限购 + FIFO 挤旧）

- `buyActive`：删除「`已满，最多 N 个`」分支；成功分支改为：
  ```
  const eq = [...loadout.equipped, id];
  while (eq.length > MAX_EQUIPPED_ACTIVES) eq.shift(); // 挤掉最旧
  const nextLoadout = save({ ...loadout, day: today(), equipped: eq });
  ```
  保留「无此技能 / 已装备（在当前生效列表中）/ 功德不足」三项校验。
- `buyPassive`：同理，对 `passives` 做 `[...passives, id]` + `while(len>MAX_EQUIPPED_PASSIVES) shift()`。
- `isEquipped`/`isPassiveEquipped` 语义不变（判断是否在「当前生效列表」中）：已生效者不可重复购买；被挤出后可再买（会再次扣功德）。
- `loadLoadout` 的 `slice(0, MAX)` 防御保留（此后列表恒 ≤N）。

### 3. `web/src/battle.ts`（通用被动注入 + 删旧链）

- **通用注入**：构造函数末尾（初始解锁格设置**之后**，保证 `dinghai` 能取到 `lockedCells()`）遍历 `passives`：
  ```
  for (const id of passives.slice(0, MAX_EQUIPPED_PASSIVES)) {
    if (id === 'pas_pantao') { this.gardenOn = true; continue; } // 蟠桃园走桃树系统
    this.applyItem(id);          // 复用效果引擎
    this.pickedItems.push(id);   // 供 HUD 被动条显示
  }
  ```
  删去构造函数早期的 `this.gardenOn = passives.includes('pas_pantao')`（合并进上面循环）。
- `applyItem` 的双刃两项改数值：
  - `jifeng`：`this.mods.frqMul += 0.5; this.aiFrqMul += 0.25;`
  - `tongxin`：`this.tangsengMaxHP += 3; this.tangsengHP += 3; this.aiTangsengHP += 2;`
- `applyItem` 由 `private` 仍可保持 private（构造函数内可调用）。`updateItemEffects` 不变。
- **删除死代码**：`rollShop()`、`pendingShop` 字段及引用（含 stats 的 `shopOpen`）、`chooseItem()`、`canCarry()`、`itemCount()`、`ItemDef`/`ItemKind`/`ITEMS`/`itemById()`/`MAX_ENHANCE_ITEMS`/`MAX_PASSIVE_ITEMS`。
  - 说明：`applyItem` 是自包含 switch，不依赖 `ITEMS`；shop 元数据改由 `PASSIVE_SKILLS` 承载，故整块 `ITEMS` 定义可删。
  - `stats` 对象移除 `shopOpen`、`itemsPicked`（已核实二者除定义处外无任何消费者，可直接删）。

### 4. `web/src/render.ts`（删弹窗 + 被动条改走 passiveById）

- 删除 `getButtons` 中 `if (b.pendingShop) {…}` 的 3 选 1 卡片分支（约 69-83）。
- 删除 `drawButtons` 中 `pendingShop` 标题块与 `isItem` 分支（约 1519-1549），保留普通按钮绘制（原 `else` 体去缩进）。
- 被动技能条渲染：将 `itemById(b.pickedItems[i])` 改为 `passiveById(...)`（引入 `import { passiveById } from './passives'`），取 `name`/`icon`/`desc`。`kind` 相关着色去除（`PassiveSkillDef` 无 `kind`，统一用被动色）。
- 移除对 `itemById` 的 import。

### 5. `web/src/main.ts`（清理旧 item 接线）

- 删除按钮点击里 `else if (btn.id.startsWith('item')) battle.chooseItem(...)`（约 186）。
- 删除 `chooseItem` 接口声明与实现（约 378/409）。
- 主动/被动购买接线（`buyActive`/`buyPassive`）已存在，无需改（其行为改动在 loadout.ts 内部完成）。
- `new Battle(..., loadout.equipped, loadout.passives)` 已传参，无需改。

### 6. 测试（`web/tests/`）

vitest 跑在 node 环境（无 `localStorage`）→ 测 `loadout` 需在 `beforeEach` 注入内存版 `globalThis.localStorage`（storage.ts 在非 wx 时走 localStorage 分支）。

- 新增 `tests/passive-shop.test.ts`：
  - `buyPassive` 正常：扣功德、追加、`isPassiveEquipped` 为真。
  - **FIFO 挤旧**：连续买 7 个被动，`passives` 长度恒为 6，且为「最新 6 个」，最早那个被挤出、`isPassiveEquipped` 变假。
  - `buyActive` 同理：买 3 个主动 → 恒留最新 2。
  - 功德不足：`ok=false 功德不足`，列表不变。
  - 重复购买当前生效项：`ok=false 已装备`。
  - 跨天：写入旧 `day` 的 raw → `loadLoadout` 清空 `equipped`/`passives`。
- 新增/扩展 Battle 注入校验（新建 `tests/passive-inject.test.ts` 或并入现有）：
  - `passives:['xiandan']` → `mods.atkMul` 含 +0.15。
  - `passives:['jifeng']` → `mods.frqMul` +0.5 且 `aiFrqMul` +0.25。
  - `passives:['tongxin']` → 我方 `tangsengMaxHP` +3、`aiTangsengHP` +2。
  - `passives:['dinghai']` → 额外解锁 1 阵位（`unlocked.size` +1）。
  - `passives:['pas_pantao']` → `gardenOn` 为真、且不误入 applyItem。
  - 传入 8 个被动 → 仅最新 6 生效（前 2 个不产生效果）。
- 回归：删 `pendingShop`/`ITEMS` 后 `npm test`（vitest run）全绿、`npm run typecheck` 通过、`npm run build` 通过。

## 非目标（本次不做）

- 农民/荒地经济、转盘、道具升色。
- 广告变现节点接入。
- 主动技能池扩充（沿用现有 `ACTIVE_SKILLS`，仅改购买为 FIFO 挤旧）。
- 商城布局：现有 shop 已含被动区；若 15 项被动导致超屏，另议滚动（本次以功能正确为先，布局溢出在实现时评估，必要时加滚动作为附带项）。
