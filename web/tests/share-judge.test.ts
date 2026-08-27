import { describe, it, expect } from 'vitest';
import { judgeShareSuccess } from '../src/platform';

describe('judgeShareSuccess：onHide 真触发 + 停留≥2s 判成功', () => {
  it('未切后台(onHide 未触发) → 失败', () => {
    expect(judgeShareSuccess(false, 0, 999999)).toBe(false);
  });

  it('切了后台但停留 <2s（秒取消） → 失败', () => {
    expect(judgeShareSuccess(true, 1000, 1000 + 1999)).toBe(false);
  });

  it('切了后台且停留 =2s（边界） → 成功', () => {
    expect(judgeShareSuccess(true, 1000, 1000 + 2000)).toBe(true);
  });

  it('切了后台且停留 >2s → 成功', () => {
    expect(judgeShareSuccess(true, 1000, 1000 + 5000)).toBe(true);
  });

  it('可自定义阈值', () => {
    expect(judgeShareSuccess(true, 0, 2500, 3000)).toBe(false);
    expect(judgeShareSuccess(true, 0, 3000, 3000)).toBe(true);
  });
});
