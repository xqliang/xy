# 黄狮精小 Boss —「卷走」技能设计

- 日期：2026-08-22
- 状态：待实现（已确认设计，待用户审阅 spec）
- 涉及：西游塔防（xy）`web/` 小 Boss 系统、战斗逻辑、立绘管线

## 1. 背景与目标

现有小 Boss（小 Boss）有 5 种跨地图光环型头目：霜魄妖、蚀甲妖、撼地妖、疾风妖、血泉妖，
都走 `castMiniBossSkill` 每 `miniBossInterval`(4s) 循环对半径内目标施加**可恢复的减益**
（攻速↓/伤害↓/倒下/加速/回血）。缺少一种「真的把玩家一件东西拿走、永久消失」的惩罚型小 Boss。

新增第 6 种小 Boss **黄狮精**，技能「卷走」：从出怪口出来后，在随机 1–20s 内**只触发一次**，
把身边 3 格范围内随机一件**兵器 / 英雄字块 / 桃树**永久卷走（消失、变空格、不进候选区），
对被卷目标造成不可恢复的损失，提升中后期压迫感与「宝物被偷」的主题表达。

西游出处：黄狮精是玉华州偷兵器的黄毛狮子精，把悟空金箍棒、八戒九齿钉耙、沙僧降妖杖偷去开「钉耙宴」，
与「随机卷走一格兵器」的机制天然对应。

## 2. 非目标（YAGNI）

- 不做「卷走」的通用复用抽象（目前只有黄狮精一个 caller，方案 C 的 `destroyRandomInRadius` 公共函数暂不做）。
- 不让「卷走」针对唐僧（失败条件，被卷近乎直接判负）。
- 不给被卷目标蟠桃奖励、不退回候选区（设计决策：彻底消失）。
- 不新增复杂的逐格淡出动画，复用现有 `death` 粒子爆裂作为消失特效。

## 3. 怪物身份

在现有小 Boss 框架新增 `lion` 种类：

- `MiniBossKind` 联合类型追加 `'lion'`。
- `MINI_BOSS_KINDS` 数组追加 `'lion'`（与现有 5 种一同随机出场）。
- `MINI_BOSS_META` 追加：
  ```ts
  lion: { name: '黄狮精', skillName: '卷走', color: '#e8c24a', icon: '偷', desc: '随机卷走3格内一件兵器/英雄/桃树' }
  ```
- 移速：用默认 `miniBossSpdMul`(0.82)，不设快/慢档（`miniBossSpawnSpdMul` 命中 default 分支）。
- 击杀奖励：沿用 `ECONOMY.PEACH_PER_MINI_BOSS`(6)，不改经济表。

## 4. 核心机制「卷走」（一次性）

复用 `castMiniBossSkill` 的调度循环，加一次性开关：

1. **出场延时**：`spawnMonster` 里，lion 的初始 `skillCd` 不是固定的 `miniBossFirstDelay`(2.0)，
   而是 **1–20s 随机**（新增调参 `miniBossStealDelayMin`/`miniBossStealDelayMax`）。
2. **一次性开关**：`Monster` 新增 `miniBossCasted: boolean`（默认 false）。
   `updateMonsterSkills` 小 Boss 分支加守卫 `if (m.miniBossCasted) continue;`；
   成功偷到一次后置 `true`，本局不再施法。
3. **空目标重试**：若 3 格内没有任何可卷目标，**不消耗这次机会**——不置位、
   把 `skillCd` 设成 `miniBossInterval` 后重试，直到偷到为止再置位。
   保证每只黄狮精技能**一定生效一次**（不会因出生点旁无物而白给）。

## 5. 目标选择与移除

以黄狮精当前位置 `posAtDistance(this.map, m.dist)` 为圆心、`miniBossStealRadius`(3) 格为半径
（`Math.hypot` ≤ 3），收集三类候选并合池**随机取 1 个**（不分远近、纯随机）：

- **兵器** `this.units`：选中后 `this.units.delete(k)` 永久删除。
- **英雄字块** `this.words`：
  - 若该字属于已激活武将对（`activeGenerals()` 命中），**只删这一格**，另一格保留 → 打断配对。
  - 否则（孤儿字块）直接 `this.words.delete(k)`。
  - `activeGenerals()` 按字牌实时扫描，删一字后配对自动解除，无需手动清理武将状态。
- **桃树** `this.trees`：选中后 `this.trees.delete(k)` 永久删除。

**排除**：唐僧（失败条件）、路径/空地。被卷目标**不进候选区、不给蟠桃奖励**。

## 6. 消失特效

复用现有 `drawBursts` 的 `death` 粒子环（8 颗向外爆散的圆），在被偷的那一格爆开，
用黄狮精金色 `meta.color`、`big: true`。**不新增 `SkillFxKind`**——直接往 `this.bursts` push：

```ts
this.bursts.push({ kind: 'death', c: target.c, r: target.r, ttl: 0.45, maxTtl: 0.45, big: true, color: meta.color });
```

渲染层 `drawBursts` 零改动。

## 7. 底部提示信息

复用 `this.message`（render.ts ~9767 居中渲染于底部栏下方）。施法成功后设：

```
⚠ 黄狮精卷走了「{目标中文名}」！
```

目标中文名：兵器用 `UNITS[type].name`、英雄字块用武将名（`w.general` → 武将显示名）/ 字 `w.char`、
桃树固定「蟠桃树」。3 格内无目标时不弹（等重试）。

## 8. 生成立绘接入

走现有小 Boss 立绘管线：

1. `web/tools/seeddream/` 仿 `gen-cavalry-miniboss.mjs` 写 `gen-lion.mjs`：
   Seedream 出 `monster-miniboss-lion.png`，**绿幕背景**（黄狮精黄毛，按素材记忆规则用绿幕+软抠，避免洪泛误扣黄色）。
2. `node tools/seeddream/bg-remove-chroma.mjs monster-miniboss-lion` 抠成透明 PNG。
3. `resize-portraits.mjs` 的 `TARGET` 加 `monster-miniboss-lion`（小 Boss 用 max-side 128，= 显示尺寸×3），运行；可选 `pngquant`。
4. `web/src/asset-manifest.names.ts`：`ASSET_FILENAMES` 加 `'monster-miniboss-lion': 'monster-miniboss-lion.png'`，`AssetKey` 联合加对应成员。
5. `miniBossSprite('lion', mapId)` 已自动解析（`assets.ts` 第 191 行 `cache['monster-miniboss-${kind}']`），无需改 `assets.ts`。
6. `cd web && node tools/tos-upload.mjs monster-miniboss-lion.png` 上传 CDN、刷新 `manifest-generated.ts`。
   onboard 渲染（render.ts ~2211）与码 card（codex.ts `drawBossCard`）自动吃到新图。

立绘风格：沿用小 Boss Q版图标基线——造型简洁、粗黑描边、强剪影、单一主色（黄）、正面全身居中、绿幕、无地面无投影无文字。

## 9. 调参与 DevTools

新增调参（`TUNING`）：

```ts
miniBossStealRadius: 3,      // 卷走作用半径（格）
miniBossStealDelayMin: 1,    // 出场后首次触发最短延时（秒）
miniBossStealDelayMax: 20,   // 出场后首次触发最长延时（秒）
```

按记忆规则「加键要进 devtools 分组」，上述 3 个键需挂到 DevTools 小 Boss 分组，便于线上调平衡。

## 10. 测试与验证

单测（放 `web/tests/`，vitest 只在 `web/` 跑）：
1. lion 出场后 `skillCd` 落在 `[miniBossStealDelayMin, miniBossStealDelayMax]`。
2. 成功施法一次后 `miniBossCasted === true` 且后续不再触发。
3. 3 格内正确收集三类目标、`delete` 永久移除、且不写入 tray、不给蟠桃。
4. 配对英雄字块只删一字、另一字与武将状态保留。
5. 3 格内无目标时不置位、`skillCd` 重置为 `miniBossInterval` 重试。

浏览器冒烟（按记忆 `web-smoke-test-harness`）：force 出一只黄狮精，确认 death 粒子特效 + 底部提示正常、目标格子变空。

**提交前必过 `ai-balance` 门禁**（记忆规则：改战斗/AI 必跑）——确认加入「随机丢格子」后 AI 胜率未崩、新手引导/支撑英雄测试（support-heroes）不回归。

## 11. 验收标准

- 黄狮精作为第 6 种小 Boss 随机出场，立绘正确显示。
- 出场 1–20s 内必然触发一次「卷走」，3 格内随机一件兵器/英雄(字)/桃树永久消失、变空格。
- 配对英雄只拆一字；唐僧与路径不受影响。
- 被偷格有金色 death 粒子特效，底部出现「⚠ 黄狮精卷走了「X」！」提示。
- 单测 + 浏览器冒烟通过，`ai-balance` 门禁通过，tsc 不新增报错（基线已有 ~28 处既有报错，看「不新增」）。

## 12. 待拍板

1. DevTools 可调（第 9 节）：要。已纳入设计。
2. 开发环境：实现阶段用 git worktree 隔离（用户明确要求「开关 worktree」）。
