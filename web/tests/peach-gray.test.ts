import { describe, it, expect } from 'vitest';
import { grayscalePeachPixels } from '../src/peach-icon';

/** 构造 RGBA 像素数组 */
const px = (...rgba: number[]): Uint8ClampedArray => new Uint8ClampedArray(rgba);

describe('grayscalePeachPixels 桃图标灰度化（预渲染用，替代每帧 ctx.filter）', () => {
  it('彩色像素 → 等值灰（BT.601 亮度 × 0.9 亮度系数），alpha 通道不动', () => {
    const p = px(255, 0, 0, 255, 0, 255, 0, 128);
    grayscalePeachPixels(p);
    // 红 (255,0,0)：亮度 0.299*255≈76.2 → ×0.9≈68.6 → 四舍五入 69
    expect(p[0]).toBeCloseTo(69, 0);
    expect(p[0]).toBe(p[1]);
    expect(p[1]).toBe(p[2]);
    expect(p[3]).toBe(255); // alpha 保留（PNG 透明区不糊成黑块）
    // 绿 (0,255,0)：亮度 0.587*255≈149.7 → ×0.9≈134.7 → 135
    expect(p[4]).toBeCloseTo(135, 0);
    expect(p[5]).toBeCloseTo(135, 0);
    expect(p[7]).toBe(128);
  });

  it('灰上再灰会继续变暗（×0.9 亮度语义非幂等，符合 CSS brightness 行为）', () => {
    const p = px(100, 100, 100, 255);
    grayscalePeachPixels(p);
    expect([...p]).toEqual([90, 90, 90, 255]); // 100×0.9=90
    const q = px(90, 90, 90, 255);
    grayscalePeachPixels(q);
    expect([...q]).toEqual([81, 81, 81, 255]); // 90×0.9=81
  });

  it('全透明像素 RGB 被改也不可见（alpha=0 保留 0），不抛错', () => {
    const p = px(200, 50, 50, 0);
    grayscalePeachPixels(p);
    expect(p[3]).toBe(0);
  });

  it('空数组与短数组安全', () => {
    expect(() => grayscalePeachPixels(new Uint8ClampedArray(0))).not.toThrow();
    expect(() => grayscalePeachPixels(px(1, 2, 3))).not.toThrow(); // 非 4 倍长：循环按步长 4 不越界
  });
});
