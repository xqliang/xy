# 白骨岭台阶篱笆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 白骨岭改为竞品巨鹿式台阶路径/半场、对角唐僧、初始槽，并以连续 Q 版白骨堆作上下分界栅栏（无开口）。

**Architecture:** `isPlayerCell(map,c,r)` 取代硬编码 `r>=FENCE_ROW`；白骨岭 path/tangseng/initialBlock 按规格；栅栏沿台阶分界铺满 `fence-baiguling` 精灵（Seedream 生成 + 抠图），其它图仍用水平木栅栏。

**Tech Stack:** TypeScript、Canvas 2D、火山方舟 Seedream（`web/tools/seeddream/`）

## Global Constraints

- 坐标：口语 1 起算，代码 0 起算
- 唐僧我方 `(7,9)`，AI 镜像 `(0,0)`
- 左 4 列路径 `r=5`，右 4 列 `r=3`，竖段 `c=3`
- 栅栏必须连续、无开口（`fenceGaps: []`）
- 仅改白骨岭半场几何；其它三图默认 `r >= FENCE_ROW`

---

### Task 1: isPlayerCell + 白骨岭地图数据

**Files:**
- Modify: `web/src/board.ts`
- Modify: `web/src/battle.ts`（`isPlaceable`）
- Test: `web/tests/baiguling-side.test.ts`

**Interfaces:**
- Produces: `export function isPlayerCell(map: GameMap, c: number, r: number): boolean`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { mapById, isPlayerCell, isPathCell, slotUnlockOrder } from '../src/board';

describe('baiguling side', () => {
  const m = mapById('baiguling');
  it('left cols: player from r>=6', () => {
    expect(isPlayerCell(m, 0, 6)).toBe(true);
    expect(isPlayerCell(m, 0, 4)).toBe(false);
  });
  it('right cols: player from r>=4', () => {
    expect(isPlayerCell(m, 5, 4)).toBe(true);
    expect(isPlayerCell(m, 5, 2)).toBe(false);
  });
  it('path not player', () => {
    expect(isPathCell(m, 0, 5)).toBe(true);
    expect(isPlayerCell(m, 0, 5)).toBe(false);
  });
  it('tangseng and initial block', () => {
    expect(m.tangseng).toEqual({ c: 7, r: 9 });
    const block = slotUnlockOrder(m).slice(0, 6);
    expect(block).toEqual(
      expect.arrayContaining([
        { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
        { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
      ]),
    );
    expect(block).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 实现 isPlayerCell 与 placeableCells**

```ts
export function isPlayerCell(map: GameMap, c: number, r: number): boolean {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  if (isPathCell(map, c, r)) return false;
  if (map.id === 'baiguling') {
    const fenceR = c <= 3 ? 5 : 3;
    return r > fenceR;
  }
  return r >= FENCE_ROW;
}

export function placeableCells(map: GameMap): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isPlayerCell(map, c, r)) cells.push({ c, r });
    }
  }
  return cells;
}
```

注意：`r > fenceR` 对左列即 `r >= 6`，右列 `r >= 4`。

- [ ] **Step 3: 更新白骨岭 map 条目**

```ts
{
  id: 'baiguling',
  name: '白骨岭',
  theme: { /* 不变 */ },
  path: [
    { c: -1, r: 5 }, { c: 0, r: 5 }, { c: 1, r: 5 }, { c: 2, r: 5 }, { c: 3, r: 5 },
    { c: 3, r: 4 }, { c: 3, r: 3 },
    { c: 4, r: 3 }, { c: 5, r: 3 }, { c: 6, r: 3 }, { c: 7, r: 3 },
    { c: 7, r: 4 }, { c: 7, r: 5 }, { c: 7, r: 6 }, { c: 7, r: 7 }, { c: 7, r: 8 }, { c: 7, r: 9 },
  ],
  tangseng: { c: 7, r: 9 },
  initialBlock: [
    { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 },
    { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
  ],
  fenceGaps: [],
},
```

- [ ] **Step 4: battle.isPlaceable 改用 isPlayerCell**

```ts
private isPlaceable(c: number, r: number): boolean {
  return isPlayerCell(this.map, c, r);
}
```

（`isPlayerCell` 已含非路径与网格范围。）

- [ ] **Step 5: 跑测试通过后暂不单独 commit（与栅栏绘制同一次 feat commit，或本 task 先 commit `feat(web): 白骨岭台阶路径与半场`）**

---

### Task 2: 渲染半场 + 连续白骨堆栅栏

**Files:**
- Modify: `web/src/render.ts`
- Modify: `web/src/assets.ts`
- Create: `web/tools/seeddream/gen-fence-baiguling.mjs`
- Create: `web/public/assets/fence-baiguling.png`（生成后）

**Interfaces:**
- Consumes: `isPlayerCell`, `sprite('fence-baiguling')`

- [ ] **Step 1: assets 注册**

在 `AssetKey` 与 `FILES` 增加 `'fence-baiguling': '/assets/fence-baiguling.png'`。

- [ ] **Step 2: drawBoard 用 isPlayerCell 判定半场**

将 `const inPlayer = r >= FENCE_ROW` 改为：路径格仍按镜像规则；非路径时：

```ts
const onPath = isPathCell(b.map, src.c, src.r);
// 半场：玩家用 isPlayerCell；AI 格 = 非路径且非我方
const inPlayer = isPlayerCell(b.map, c, r) || (onPath && /* 路径格本身无阵营；解锁绘制走下面 */ false);
```

更稳妥写法（与现逻辑对齐）：

```ts
const src = /* 若该格属于我方或为我方路径投影： */
```

推荐：
```ts
const playerOwned = isPlayerCell(b.map, c, r);
const aiOwned = !isPathCell(b.map, c, r) && !playerOwned && c>=0 && r>=0;
const srcForPath = playerOwned || (r >= FENCE_ROW && isPathCell(b.map, c, r))
  ? { c, r }
  : mirrorCell({ c, r });
```

因白骨岭路径跨旧半场，**路径着色必须直接 `isPathCell(b.map, c, r)`**（不再对 AI 半场只查镜像源）：

```ts
const onPath = isPathCell(b.map, c, r);
const inPlayer = isPlayerCell(b.map, c, r);
const cellOpen = inPlayer
  ? unlocked.has(`${c},${r}`)
  : (!onPath && aiUnlocked.has(`${c},${r}`));
```

AI 解锁仍是玩家初始格的镜像；路径格两侧都不算 open。

- [ ] **Step 3: drawFence 分支**

- 非 `baiguling`：保持水平木栅栏 + gaps
- `baiguling`：沿分界铺满白骨堆，**无开口**：
  - 列 0..3：在路径格 `(c,5)` 与我方 `(c,6)` 之间画（中心约 `r=5.5` 或贴路径格中心）
  - 列 3 竖段：在 `(3,3)/(3,4)/(3,5)` 路径侧向我方一侧补段
  - 列 4..7：在 `(c,3)` 路径与我方之间
  - 右缘下行路径旁可不重复挡满整列（分界主水平台阶 + 拐角即可）
  - 使用 `sprite('fence-baiguling')`，缺图时画小白骨色块占位

- [ ] **Step 4: Seedream 脚本**

`web/tools/seeddream/gen-fence-baiguling.mjs`：单 job，prompt 示例：

`白骨岭栅栏用的小白骨堆，几根白骨和圆颅骨堆成一小簇，Q版扁平游戏图标，粗黑描边，浅灰白色主调，纯白色背景，无阴影，无文字`

生成后跑 `bg-remove.mjs` 产出 `web/public/assets/fence-baiguling.png`。若无 `ARK_API_KEY`，先提交脚本 + 矢量兜底，素材稍后补。

- [ ] **Step 5: 测试 + typecheck**

```bash
cd web && npx vitest run tests/baiguling-side.test.ts && npx tsc --noEmit
```

- [ ] **Step 6: Commit（与 Task 1 合并为一次地图 feat）**

```bash
git add web/src/board.ts web/src/battle.ts web/src/render.ts web/src/assets.ts \
  web/tests/baiguling-side.test.ts web/tools/seeddream/gen-fence-baiguling.mjs \
  web/public/assets/fence-baiguling.png
git commit -m "$(cat <<'EOF'
feat(web): 白骨岭台阶半场与白骨堆栅栏

EOF
)"
```
