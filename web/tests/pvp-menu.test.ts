import { describe, it, expect } from 'vitest';
import { menuButtons, menuButtonAt } from '../src/menu';

describe('menu PvP 入口', () => {
  it('menuButtons 含 pvpMatch/pvpInvite', () => {
    const ids = menuButtons().map((b) => b.id);
    expect(ids).toContain('pvpMatch');
    expect(ids).toContain('pvpInvite');
  });
  it('两按钮可命中且不重叠', () => {
    const m = menuButtons().find((b) => b.id === 'pvpMatch')!;
    expect(menuButtonAt(m.x + 1, m.y + 1)).toBe('pvpMatch');
    const i = menuButtons().find((b) => b.id === 'pvpInvite')!;
    expect(menuButtonAt(i.x + 1, i.y + 1)).toBe('pvpInvite');
    // 两矩形不相交
    expect(m.x + m.w <= i.x || i.x + i.w <= m.x || m.y + m.h <= i.y || i.y + i.h <= m.y).toBe(true);
  });
});
