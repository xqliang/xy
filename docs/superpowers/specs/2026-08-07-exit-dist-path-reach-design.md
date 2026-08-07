# 出口距：射程可达用欧氏 / 够不着用沿程

**日期：** 2026-08-07  
**状态：** 已批准（对话确认）  
**范围：** `AutoPlaceView.exitDist`（挖铲、落位、合成；玩家 + AI）

## 问题

当前 `distToPathEntrance` 一律用格到出怪口（路径首个网格内点）的**欧氏距离**。  
够不着怪路的格（例如靠近唐僧、几何上又靠近出怪口）会被算成「很近出口」，挖铲/落位错误偏向这些无法开火的格。希望路径末尾侧在「够不着」时距离更大。

## 目标

- 最大射程武器够得着路径 → 保持现有欧氏出口距  
- 够不着 → 用「出怪口沿路径到最近路径附着点」的格数，使路径末尾更远  
- 挖铲、落位、合成共用同一 `exitDist` 口径

## 非目标

- 不改 `digPriorityScore` / `seatScore` 权重公式本身  
- 不改 `nearestPathDist` / `pathTouchSides` 定义  
- 不单独为洛阳铲做第二套出口距

## 常量

| 名 | 值 | 含义 |
|---|---|---|
| `EXIT_REACH` | `3.5` | 神箭手 `rge=3` + 战斗容差 `0.5`；`pathDist ≤` 此值视为够得着路径 |
| 收入带 | `< 3` | 从当前格沿「指向最近路径点」方向收入后的附着带；径向投影下附着点 = 最近路径格 |

## 算法

纯函数（建议 `exitDistToPath(path, cell)`，由 `battle` 玩家/AI 视图接入）：

1. 在路径网格内点上算 `pathDist` 与最近格 `P`（与现有 `nearestPathDist` 同口径：`Math.hypot`，跳过板外行）
2. 出怪口 `gate` = 路径上首个在网格内的点（与现逻辑一致）
3. **若 `pathDist ≤ EXIT_REACH`：**  
   `exitDist = hypot(cell, gate)`（常规欧氏）
4. **否则：**  
   `exitDist =` `gate` 沿路径到 `P` 的格数（路径下标差；仅计网格内连续点，与 `gate`/`P` 选取一致）

说明：步骤 4 等价于「先收入到距路 < 3 再量沿程」——径向靠近 `P` 时最近路径点不变。

## 接入点

- 替换 / 封装 `Battle.distToPathEntrance`  
- `buildPlayerAutoView` / `buildAiAutoView` 的 `exitDist` 均走新函数（AI 路径用 `aiPath`）

## 测试要点

1. `pathDist ≤ 3.5`：结果与旧欧氏一致  
2. `pathDist > 3.5` 且 `P` 在路径后段：`exitDist` 大于同欧氏近出口、但最近点在前段的格  
3. 几何近 `gate` 但 `pathDist > 3.5`：不再因欧氏很小而优于贴路中后段格（在挖铲分里体现为出口项更大）

## 验收

- 单元测试覆盖上述三点  
- 玩家与 AI 一键布阵/挖铲行为符合「够得着用欧氏、够不着用沿程」
