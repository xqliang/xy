import { describe, it, expect } from 'vitest';
import { MINI_BOSS_KINDS, MINI_BOSS_META, TUNING } from '../src/battle';

describe('黄狮精 lion 小 Boss 登记', () => {
  it('lion 在合法种类列表与 meta 中', () => {
    expect(MINI_BOSS_KINDS).toContain('lion');
    const meta = MINI_BOSS_META.lion;
    expect(meta.name).toBe('黄狮精');
    expect(meta.skillName).toBe('卷走');
    expect(meta.color).toBeTruthy();
    expect(meta.icon).toBeTruthy();
    expect(meta.desc).toContain('卷走');
  });

  it('steal 调参存在且范围合法', () => {
    expect(TUNING.miniBossStealRadius).toBe(3);
    expect(TUNING.miniBossStealDelayMin).toBeGreaterThanOrEqual(1);
    expect(TUNING.miniBossStealDelayMax).toBeGreaterThan(TUNING.miniBossStealDelayMin);
  });
});
