# Exit Dist Path Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `exitDist` 在 `pathDist ≤ 3.5` 时用欧氏到出怪口，否则用出怪口沿路径到最近路径点的格数。

**Architecture:** 在 `board.ts` 新增纯函数 `exitDistToPath`；`Battle.distToPathEntrance` 改为调用它，玩家/AI 的 `AutoPlaceView.exitDist` 自动生效。

**Tech Stack:** TypeScript、Vitest、现有 `web/src/board.ts` / `web/src/battle.ts`

## Global Constraints

- `EXIT_PATH_REACH = 3.5`（神箭手 rge=3 + 容差 0.5）
- 最近点口径与 `Battle.nearestPathDist` 一致（`Math.hypot`，跳过 `r` 出板）
- 出怪口与 `pathEntranceCell` 一致
- 不改 `digPriorityScore` / `seatScore` 权重

---

### Task 1: `exitDistToPath` 纯函数 + 单测

**Files:**
- Create: `web/tests/exit-dist.test.ts`
- Modify: `web/src/board.ts`（在 `pathEntranceCell` 附近导出常量与函数）

**Interfaces:**
- Produces: `EXIT_PATH_REACH: 3.5`；`exitDistToPath(path: Cell[], cell: Cell): number`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { COLS, ROWS, exitDistToPath, EXIT_PATH_REACH } from '../src/board';

describe('exitDistToPath', () => {
  // 直线路径：入口 (0,0) → … → (7,0)
  const path = Array.from({ length: 8 }, (_, c) => ({ c, r: 0 }));

  it('pathDist ≤ REACH：等于欧氏到 gate', () => {
    const cell = { c: 2, r: 2 }; // dist to path = 2 ≤ 3.5
    expect(exitDistToPath(path, cell)).toBeCloseTo(Math.hypot(2, 2));
  });

  it('pathDist > REACH：用沿程下标差（路径末段更大）', () => {
    const nearEnd = { c: 7, r: 5 }; // dist=5 > 3.5，最近点 (7,0) index 7
    const nearStart = { c: 0, r: 5 }; // 最近点 (0,0) index 0
    expect(exitDistToPath(path, nearEnd)).toBe(7);
    expect(exitDistToPath(path, nearStart)).toBe(0);
    expect(exitDistToPath(path, nearEnd)).toBeGreaterThan(exitDistToPath(path, nearStart));
  });

  it('几何近 gate 但 pathDist > REACH：不因欧氏很小而得到小出口距', () => {
    // 入口旁有绕远路径点：path 先离开再回来；cell 在入口旁但离最近路段仍 > 3.5
    // 简化：cell 距 (0,0) 欧氏小，但路径最近点在后段且欧氏 > REACH
    const bent = [
      { c: 0, r: 0 },
      { c: 0, r: 1 },
      { c: 0, r: 2 },
      { c: 7, r: 2 },
      { c: 7, r: 9 },
    ];
    const cell = { c: 7, r: 9 }; // 贴末点，pathDist=0 ≤ REACH → 欧氏
    // 真正够不着：离所有路径点 > 3.5，且几何靠近 gate
    const farButNearGate = { c: 0, r: 8 }; // 到 (0,0)=8，到 (0,2)=6，到 (7,2)/末 >3.5
    expect(Math.hypot(farButNearGate.c - 0, farButNearGate.r - 0)).toBeLessThan(
      exitDistToPath(bent, farButNearGate) + 0.01 || Infinity,
    );
    // 最近点应为 (0,2) index 2，沿程=2；欧氏到 gate=8，沿程更小——换更极端用例：
    // cell 欧氏近 gate、最近点 index 大
    const uPath = [
      { c: 0, r: 0 },
      ...Array.from({ length: 8 }, (_, i) => ({ c: i, r: 4 })),
      { c: 0, r: 9 },
    ];
    // cell 靠近 (0,0) 欧氏，但 r 使得最近是末段
    const tricky = { c: 0, r: 5 };
    // 到 (0,0)=5，到 (0,4)=1，到 (0,9)=4 → 最近点 (0,4) pathDist=1 ≤ REACH → 欧氏
    // 需要 pathDist>3.5：
    const outOfReachNearGate = { c: 1, r: 0 }; // wait pathDist to (0,0)=1
  });
});
```

测试第 3 点最终用例如下（写入文件时用此版，不用上面草稿里的半成品）：

```ts
  it('几何近 gate 但够不着路：exitDist 为沿程而非小欧氏', () => {
    // gate (0,0)；路径迅速拐到远端；cell 在 (1,0) 旁远处——用垂直拉开
    const path = [
      { c: 0, r: 0 },
      { c: 7, r: 0 },
      { c: 7, r: 1 },
      { c: 7, r: 2 },
      { c: 7, r: 3 },
      { c: 7, r: 4 },
      { c: 7, r: 5 },
    ];
    // cell 在 (0,5)：到 gate 欧氏=5；到路径最近点 (7,5) dist=7 > 3.5 → 沿程 index 6
    const cell = { c: 0, r: 5 };
    expect(Math.hypot(cell.c - 0, cell.r - 0)).toBe(5);
    expect(exitDistToPath(path, cell)).toBe(6);
    expect(exitDistToPath(path, cell)).toBeGreaterThan(5); // 沿程 > 欧氏，避免「假近」
  });
```

- [ ] **Step 2: 跑测确认失败**

Run: `cd web && npx vitest run tests/exit-dist.test.ts`
Expected: FAIL（`exitDistToPath` 未导出）

- [ ] **Step 3: 实现**

在 `web/src/board.ts` 的 `pathEntranceCell` 后增加：

```ts
/** 最大射程够得着路径的阈值（神箭手 rge=3 + 容差 0.5） */
export const EXIT_PATH_REACH = 3.5;

/** 格到出怪口距离：够得着路用欧氏，否则用出怪口沿路径到最近点的下标差 */
export function exitDistToPath(path: Cell[], cell: Cell): number {
  const gate = pathEntranceCell(path);
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.r < 0 || p.r >= ROWS) continue;
    const d = Math.hypot(p.c - cell.c, p.r - cell.r);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (bestI < 0 || bestD <= EXIT_PATH_REACH) {
    return Math.hypot(cell.c - gate.c, cell.r - gate.r);
  }
  let gateI = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (p.c >= 0 && p.c < COLS && p.r >= 0 && p.r < ROWS) {
      gateI = i;
      break;
    }
  }
  return Math.abs(bestI - gateI);
}
```

- [ ] **Step 4: 跑测通过**

Run: `cd web && npx vitest run tests/exit-dist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/board.ts web/tests/exit-dist.test.ts
git commit -m "feat(web): exitDist 够得着用欧氏、够不着用沿程"
```

---

### Task 2: Battle 接入

**Files:**
- Modify: `web/src/battle.ts`（`distToPathEntrance`；确保 `exitDistToPath` 已 import）

**Interfaces:**
- Consumes: `exitDistToPath` from `./board`

- [ ] **Step 1: 将 `distToPathEntrance` 改为委托**

```ts
private distToPathEntrance(path: { c: number; r: number }[], cell: { c: number; r: number }): number {
  return exitDistToPath(path, cell);
}
```

从 `./board` 的现有 import 列表加入 `exitDistToPath`。

- [ ] **Step 2: typecheck + 相关测试**

Run: `cd web && npm run typecheck && npx vitest run tests/exit-dist.test.ts tests/autoplace.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/battle.ts
git commit -m "feat(web): Battle.exitDist 改用 exitDistToPath"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| REACH 3.5 分支 | Task 1 |
| 欧氏 / 沿程 | Task 1 |
| 玩家+AI exitDist | Task 2（共用 distToPathEntrance） |
| 单测三点 | Task 1 |
| 不改 score 公式 | （无改动）|
