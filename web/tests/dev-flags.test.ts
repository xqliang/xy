// web/tests/dev-flags.test.ts
// Task 10 首局体验：开发者标记「显示布阵按钮」的往返 + 对战斗按钮列表的实际影响。
// 该开关被 render.ts getButtons 同步读取（draw 与 hit 共享同一列表），隐藏则两处一起消失。
import { beforeEach, describe, expect, it } from 'vitest';
import { showAutoplaceBtn, setShowAutoplaceBtn } from '../src/dev-flags';
import { getButtons } from '../src/render';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';

// 内存版 localStorage（dev-flags 走 storage.ts，Web 端即 localStorage）
function installMemStorage(): void {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
}

// 一局就绪态的单人战斗（status='ready'，非 won/lost）——getButtons 会返回完整按钮列表。
function readyBattle(): Battle {
  return new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined);
}

describe('dev-flags 显示布阵按钮', () => {
  beforeEach(() => installMemStorage());

  it('默认关闭：showAutoplaceBtn=false', () => {
    expect(showAutoplaceBtn()).toBe(false);
  });

  it('setShowAutoplaceBtn(true) 后为 true（往返）', () => {
    setShowAutoplaceBtn(true);
    expect(showAutoplaceBtn()).toBe(true);
    setShowAutoplaceBtn(false);
    expect(showAutoplaceBtn()).toBe(false);
  });

  it('关闭时 getButtons 不含 autoplace（draw 与 hit 都消失）', () => {
    setShowAutoplaceBtn(false);
    const ids = getButtons(readyBattle()).map((b) => b.id);
    expect(ids).not.toContain('autoplace');
    expect(ids).toContain('summon'); // 征兵按钮不受影响
  });

  it('开启时 getButtons 含 autoplace', () => {
    setShowAutoplaceBtn(true);
    const ids = getButtons(readyBattle()).map((b) => b.id);
    expect(ids).toContain('autoplace');
    expect(ids).toContain('summon');
  });
});
