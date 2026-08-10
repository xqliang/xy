import { describe, it, expect } from 'vitest';
import { imageAssetKeys } from '../src/assets';

describe('asset preload keys', () => {
  it('图片清单不含 bgm，且包含首页关键图', () => {
    const keys = imageAssetKeys();
    expect(keys.some((k) => k.startsWith('bgm-'))).toBe(false);
    expect(keys).toContain('menu-home');
    expect(keys).toContain('hero-wukong');
    expect(keys.length).toBeGreaterThan(20);
  });
});
