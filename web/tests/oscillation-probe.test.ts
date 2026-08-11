import { describe, it, expect } from 'vitest';
import { Battle } from '../src/battle';
import { autoPlaceBoardKey } from '../src/autoplace';
import { mapById } from '../src/board';

function playerView(b: Battle) {
  return (b as unknown as { buildPlayerAutoView(): import('../src/autoplace').AutoPlaceView }).buildPlayerAutoView();
}

function repeatedAutoplaceKeys(b: Battle, rounds: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < rounds; i++) {
    b.autoPlaceTray();
    keys.push(autoPlaceBoardKey(playerView(b)));
  }
  return keys;
}

describe('无怪时重复布阵', () => {
  it('兵器布局不应在两套状态间来回切换', () => {
    const b = new Battle(42, 1, mapById('liushahe'));
    b.grantPeach(9999);
    for (let i = 0; i < 8; i++) {
      b.summon();
      b.autoPlaceTray();
    }
    b.monsters.length = 0;
    b.tray.length = 0;
    const keys = repeatedAutoplaceKeys(b, 8);
    const changes = keys.filter((k, i) => i > 0 && k !== keys[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
    expect(new Set(keys).size).toBeLessThanOrEqual(2);
  });

  it('英雄字牌布局不应在两套状态间来回切换', () => {
    const b = new Battle(7, 1, mapById('liushahe'));
    b.grantPeach(9999);
    for (let i = 0; i < 6; i++) {
      b.summon();
      b.autoPlaceTray();
    }
    b.monsters.length = 0;
    b.tray.length = 0;
    // 确保棋盘上有未激活字牌（无怪时微调可能触发字↔兵换位）
    expect(b.words.size).toBeGreaterThan(0);
    const keys = repeatedAutoplaceKeys(b, 8);
    const changes = keys.filter((k, i) => i > 0 && k !== keys[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('手动拖字后应允许重新布阵', () => {
    const b = new Battle(42, 1, mapById('liushahe'));
    b.grantPeach(9999);
    for (let i = 0; i < 8; i++) {
      b.summon();
      b.autoPlaceTray();
    }
    b.monsters.length = 0;
    b.tray.length = 0;
    b.autoPlaceTray();
    const w = [...b.words.values()][0];
    const free = playerView(b).freeCells().find((c) => c.c !== w?.cell.c || c.r !== w?.cell.r);
    if (w && free) {
      b.dragWord(w.cell, free);
      b.autoPlaceTray();
      expect(b.message).not.toBe('布阵：当前暂无可执行操作');
    }
  });

  it('AI 对手半场不应在两套布局间来回切换', () => {
    const b = new Battle(42, 1, mapById('liushahe'));
    (b as unknown as { aiPeach: number }).aiPeach = 9999;
    for (let t = 0; t < 150; t++) b.step(0.1);
    b.aiMonsters.length = 0;
    b.aiTray.length = 0;
    expect(b.aiUnits.length + b.aiWords.size).toBeGreaterThan(0);
    const tick = (b as unknown as { tickAiBattleAdjust(p: number): void }).tickAiBattleAdjust.bind(b);
    const view = (b as unknown as { buildAiAutoView(): import('../src/autoplace').AutoPlaceView }).buildAiAutoView.bind(b);
    const keys: string[] = [];
    for (let i = 0; i < 10; i++) {
      tick(0);
      keys.push(autoPlaceBoardKey(view()));
    }
    const changes = keys.filter((k, i) => i > 0 && k !== keys[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
  });
});
