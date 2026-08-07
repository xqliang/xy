import { describe, it, expect } from 'vitest';
import { mapById, mirrorCell } from '../src/board';

describe('liushahe 唐僧位置', () => {
  const m = mapById('liushahe');

  it('我方第8列第6行，AI 第1列第5行（1起算）', () => {
    expect(m.tangseng).toEqual({ c: 7, r: 5 });
    expect(mirrorCell(m.tangseng)).toEqual({ c: 0, r: 4 });
  });

  it('路径终点落在唐僧格', () => {
    const end = m.path[m.path.length - 1]!;
    expect(end).toEqual(m.tangseng);
  });
});
