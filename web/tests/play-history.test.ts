// web/tests/play-history.test.ts
// Task 10 首局体验：对局历史标记的往返与幂等。
// 被 PvP 入口门槛与首局引导共同依赖——「是否玩过一局」的判据要稳，否则门槛会误拦/误放。
import { beforeEach, describe, expect, it } from 'vitest';
import { hasFinishedGame, markGameFinished, resetFinishedGame, pvpUnlocked } from '../src/play-history';

// 仿照 devtools-sim.test.ts：vitest 默认 node 环境无 localStorage，测试内手动装一个内存版。
function installMemStorage(): Map<string, string> {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
  return mem;
}

describe('play-history 对局历史', () => {
  beforeEach(() => installMemStorage());

  it('默认未玩过：hasFinishedGame=false', () => {
    expect(hasFinishedGame()).toBe(false);
  });

  it('markGameFinished 后 hasFinishedGame=true（往返）', () => {
    markGameFinished();
    expect(hasFinishedGame()).toBe(true);
  });

  it('markGameFinished 幂等：重复调用不报错、仍为 true', () => {
    markGameFinished();
    markGameFinished();
    markGameFinished();
    expect(hasFinishedGame()).toBe(true);
  });

  it('resetFinishedGame 回到未玩过', () => {
    markGameFinished();
    expect(hasFinishedGame()).toBe(true);
    resetFinishedGame();
    expect(hasFinishedGame()).toBe(false);
  });

  it('resetFinishedGame 后再 markGameFinished 可再次置位', () => {
    markGameFinished();
    resetFinishedGame();
    expect(hasFinishedGame()).toBe(false);
    markGameFinished();
    expect(hasFinishedGame()).toBe(true);
  });

  it('pvpUnlocked 与 hasFinishedGame 一致（门槛谓词）', () => {
    expect(pvpUnlocked()).toBe(false);
    markGameFinished();
    expect(pvpUnlocked()).toBe(true);
    resetFinishedGame();
    expect(pvpUnlocked()).toBe(false);
  });
});
