import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { autoPlaceBoardKey } from '../src/autoplace';
import { mapById } from '../src/board';

describe('无怪时重复布阵', () => {
  it('不应在两套布局间来回切换', () => {
    const b = new Battle(42, 1, mapById('liushahe'));
    b.grantPeach(9999);
    for (let i = 0; i < 8; i++) {
      b.summon();
      b.autoPlaceTray();
    }
    b.monsters.length = 0;
    b.tray.length = 0;
    const view = () =>
      (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView }).buildPlayerAutoView();
    const keys: string[] = [];
    for (let i = 0; i < 8; i++) {
      b.autoPlaceTray();
      keys.push(autoPlaceBoardKey(view()));
    }
    const changes = keys.filter((k, i) => i > 0 && k !== keys[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
    expect(new Set(keys).size).toBeLessThanOrEqual(2);
  });
});
