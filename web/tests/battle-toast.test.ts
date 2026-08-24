// 战斗内 toast（续玩提示等）的推入/替换/淡出/清空逻辑。
import { describe, it, expect, beforeEach } from 'vitest';
import { pushBattleToast, updateBattleToasts, clearBattleToasts, peekBattleToast } from '../src/battle-toast';

describe('battle-toast 战斗内提示', () => {
  beforeEach(() => clearBattleToasts());

  it('push 后 peek 返回文案', () => {
    pushBattleToast('已恢复对局 · 上次进行到第 3 波');
    expect(peekBattleToast()).toBe('已恢复对局 · 上次进行到第 3 波');
  });

  it('push 替换旧的（同一时刻只保留一条）', () => {
    pushBattleToast('A');
    pushBattleToast('B');
    expect(peekBattleToast()).toBe('B');
  });

  it('超过 maxAge 后淡出消失', () => {
    pushBattleToast('X', 1); // 总时长 1s
    updateBattleToasts(0.5);
    expect(peekBattleToast()).toBe('X');
    updateBattleToasts(0.6); // 累计 1.1s > 1s
    expect(peekBattleToast()).toBeNull();
  });

  it('clear 立即清空', () => {
    pushBattleToast('Y');
    clearBattleToasts();
    expect(peekBattleToast()).toBeNull();
  });
});
