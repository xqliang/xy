// web/tests/ai-skill-ui.test.ts
// 地图右上角 AI 技能图标簇：几何布局 + 点击命中测试（纯函数，不依赖 Canvas）。
import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { getAiSkillIcons, aiSkillIconAt } from '../src/render';
import { AI_SKILL_MAX } from '../src/ai-skill';

describe('AI 技能图标簇（地图右上角）', () => {
  it('AI 强度地板（无购买）时不渲染任何图标', () => {
    const b = new Battle(1); // 默认 aiSkill=DEFAULT_AI_SKILL；显式设成地板更直接
    (b as any).aiActivesEquipped = [];
    (b as any).aiPassivesEquipped = [];
    expect(getAiSkillIcons(b)).toEqual([]);
  });

  it('主动在前、被动在后，依次从右上角向左排列', () => {
    const b = new Battle(2, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MAX);
    expect(b.aiActivesEquipped.length + b.aiPassivesEquipped.length).toBeGreaterThan(0);
    const icons = getAiSkillIcons(b);
    expect(icons.length).toBe(b.aiActivesEquipped.length + b.aiPassivesEquipped.length);
    for (let i = 0; i < b.aiActivesEquipped.length; i++) {
      expect(icons[i]!.kind).toBe('active');
      expect(icons[i]!.id).toBe(b.aiActivesEquipped[i]);
    }
    for (let i = 0; i < b.aiPassivesEquipped.length; i++) {
      const idx = b.aiActivesEquipped.length + i;
      expect(icons[idx]!.kind).toBe('passive');
      expect(icons[idx]!.id).toBe(b.aiPassivesEquipped[i]);
    }
    // 相邻图标从右向左排列（第二个的 x 应比第一个更靠左，或换行到下一行）
    if (icons.length >= 2) {
      const sameRow = icons[1]!.y === icons[0]!.y;
      if (sameRow) expect(icons[1]!.x).toBeLessThan(icons[0]!.x);
    }
  });

  it('无尽模式没有 AI 对手，图标簇恒为空', () => {
    const b = new Battle(2, 1, undefined, undefined, undefined, undefined, undefined, true, AI_SKILL_MAX);
    expect(getAiSkillIcons(b)).toEqual([]);
  });

  it('点击图标范围内命中对应技能引用，范围外返回 null', () => {
    const b = new Battle(2, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MAX);
    const icons = getAiSkillIcons(b);
    expect(icons.length).toBeGreaterThan(0);
    const first = icons[0]!;
    const hit = aiSkillIconAt(b, first.x + first.w / 2, first.y + first.h / 2);
    expect(hit).toEqual({ kind: first.kind, id: first.id });
    const miss = aiSkillIconAt(b, -9999, -9999);
    expect(miss).toBeNull();
  });

  it('战斗结束后（won/lost）不再响应图标点击', () => {
    const b = new Battle(2, 1, undefined, undefined, undefined, undefined, undefined, false, AI_SKILL_MAX);
    const icons = getAiSkillIcons(b);
    expect(icons.length).toBeGreaterThan(0);
    (b as any).status = 'won';
    const first = icons[0]!;
    expect(aiSkillIconAt(b, first.x + first.w / 2, first.y + first.h / 2)).toBeNull();
  });
});
