// web/tests/guide-arrow.test.ts
// Task 10 首局动态引导：箭头几何纯函数 guideArrowLayout 的单测（canvas 视觉本身不测）。
// 保证胶囊/箭头定位随目标矩形正确计算、上方放不下时翻到下方、水平 clamp 不出界。
import { describe, it, expect } from 'vitest';
import { guideArrowLayout } from '../src/render';

const VIEW_W = 560;

describe('guideArrowLayout 箭头几何', () => {
  it('胶囊置于目标上方，箭头从胶囊底指向目标顶', () => {
    const target = { x: 180, y: 876, w: 200, h: 78 }; // 征兵按钮位置
    const g = guideArrowLayout(target, 60, 0, VIEW_W);
    // 胶囊在目标上方
    expect(g.pill.y + g.pill.h).toBeLessThanOrEqual(target.y);
    // 箭头起点=胶囊底中，终点在目标顶附近
    expect(g.from.y).toBe(g.pill.y + g.pill.h);
    expect(g.to.x).toBe(target.x + target.w / 2);
    expect(g.to.y).toBeLessThan(target.y); // 箭头指向上方目标的顶端
  });

  it('胶囊水平居中于目标（并在视口内 clamp）', () => {
    const target = { x: 180, y: 400, w: 200, h: 78 };
    const g = guideArrowLayout(target, 60, 0, VIEW_W);
    expect(g.pill.x).toBeGreaterThanOrEqual(8);
    expect(g.pill.x + g.pill.w).toBeLessThanOrEqual(VIEW_W - 8);
    // 居中：胶囊中心 ≈ 目标中心（除非被 clamp）
    expect(g.pill.x + g.pill.w / 2).toBeCloseTo(target.x + target.w / 2, -1);
  });

  it('目标贴顶（上方放不下）→ 胶囊翻到目标下方，箭头反向朝上', () => {
    const target = { x: 100, y: 2, w: 200, h: 40 }; // y=2，上方几乎没有空间
    const g = guideArrowLayout(target, 60, 0, VIEW_W);
    expect(g.pill.y).toBeGreaterThanOrEqual(target.y + target.h); // 胶囊在目标下方
    expect(g.to.y).toBeGreaterThan(target.y + target.h); // 箭头终点在目标底之下
  });

  it('bob 随 now 变化但幅度受限（±4）', () => {
    const target = { x: 180, y: 400, w: 200, h: 78 };
    const ys = new Set<number>();
    for (let i = 0; i < 40; i++) ys.add(guideArrowLayout(target, 60, i * 30, VIEW_W).to.y);
    // 不同时刻箭头终点 y 有变化（动画在动）
    expect(ys.size).toBeGreaterThan(1);
  });

  it('超宽文字被 clamp 到视口内（pill 宽不超过 VIEW_W-16）', () => {
    const target = { x: 0, y: 400, w: 560, h: 78 };
    const g = guideArrowLayout(target, 2000, 0, VIEW_W); // 极宽文字
    expect(g.pill.w).toBeLessThanOrEqual(VIEW_W - 16);
    expect(g.pill.x).toBeGreaterThanOrEqual(8);
  });
});
