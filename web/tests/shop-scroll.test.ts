import { describe, it, expect } from 'vitest';
import { shopContentHeight, SHOP_MAX_SCROLL, shopHitAt } from '../src/shop';
import { VIEW_H } from '../src/render';

describe('商城滚动', () => {
  it('内容高度超过屏高（确有溢出，需要滚动）', () => {
    expect(shopContentHeight()).toBeGreaterThan(VIEW_H);
    expect(SHOP_MAX_SCROLL()).toBeGreaterThan(0);
  });

  it('返回按钮固定，不随滚动偏移', () => {
    // 返回按钮位于 (24,40)~(116,84)，任意 scrollY 都应命中
    expect(shopHitAt(40, 60, 0)?.kind).toBe('back');
    expect(shopHitAt(40, 60, 500)?.kind).toBe('back');
  });
});
