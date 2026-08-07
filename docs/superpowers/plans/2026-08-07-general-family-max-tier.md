# 武将门派满级差 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地门派共享字、满 3/满 5 品质上限、激活继承、禁单字合并、征兵阶段权重与半对保底（N=4），并在武将面板标注攻击方式与满级。

**Architecture:** 配置集中在 `generals.ts`；抽字逻辑抽到 `word-draw.ts`；`battle.ts` 负责激活匹配/继承/禁合并/升阶封顶；UI 只读 `def.atkStyle`/`maxTier`。

**Tech Stack:** TypeScript、Vitest、现有 `web` + `@core`

## Global Constraints

- 兵种仍用全局 `MAX_TIER=5`；武将升阶用 `def.maxTier`
- 半对保底 N=4；波段权重 1–4 / 5–7 / 8+
- 羁绊：悟空上场即开
- 下架出池：弥勒、御弟

---

### Task 1: generals 配置 + 匹配 API

**Files:**
- Modify: `web/src/generals.ts`
- Test: `web/tests/general-family.test.ts`

- [ ] 扩展 `GeneralDef`：`maxTier`、`atkStyle`、`family`；重写 20 武将表；`matchGeneral(left,right)`；`partnerChars(char)`；`maxTierForChar` 辅助；调整 `WORD_POOL` 生成

- [ ] 测试：匹配序对、共享字多武将、满级字段

- [ ] Commit

### Task 2: 禁单字合并 + 激活继承 + maxTier 封顶

**Files:**
- Modify: `web/src/battle.ts`
- Modify: `web/src/render.ts`（canMerge 提示）
- Test: `web/tests/general-family.test.ts` / `general-combat-tier.test.ts`

- [ ] tray/棋盘禁止同字合并；`activeGenerals` 按字匹配 + 继承对齐 + fabaofu/combat 用 `maxTier`

- [ ] 测试继承、满 3 封顶、禁合并

- [ ] Commit

### Task 3: word-draw 阶段权重 + 孤儿/半对保底

**Files:**
- Create: `web/src/word-draw.ts`
- Modify: `web/src/battle.ts` summon
- Test: `web/tests/word-draw.test.ts`

- [ ] `phaseWeight(wave, maxTier)`、`pickWordChar(...)`、orphan 检测、`pairPityAfter: 4`

- [ ] 接入 summon；计数钩子供测

- [ ] Commit

### Task 4: UI + weapons + 资产兜底

**Files:**
- Modify: `web/src/render.ts` `drawWordSelection`
- Modify: `web/src/weapons.ts`
- Modify: `web/src/assets.ts`（若需要）

- [ ] 面板 `攻击方式·满级N`；新武将神兵/asset 复用相近 hero

- [ ] Commit

### Task 5: 全量测试与验收用例

- [ ] `npm test` / vitest 相关套件全绿
- [ ] 修回归（erlang 等旧 id 测试）
