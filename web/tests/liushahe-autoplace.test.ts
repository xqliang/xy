import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { mapById } from '../src/board';
import { getButtons } from '../src/render';

describe('流沙河一键布阵', () => {
  it('征兵后布阵能落子', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    b.grantPeach(9999);
    const before = b.units.size + b.words.size;
    b.summon();
    expect(b.tray.length).toBeGreaterThan(0);
    b.autoPlaceTray();
    expect(b.units.size + b.words.size).toBeGreaterThan(before);
  });

  it('布阵按钮在候选区右侧，不与槽位重叠', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    const btn = getButtons(b).find((x) => x.id === 'autoplace')!;
    expect(btn.x).toBeGreaterThanOrEqual(450);
    expect(btn.w).toBeGreaterThan(80);
    expect(btn.x).toBeGreaterThan(447);
  });

  it('空盘布阵有提示文案', () => {
    const b = new Battle(1, 1, mapById('liushahe'));
    b.autoPlaceTray();
    expect(b.message).toContain('征兵');
  });
});
