import { describe, it, expect, beforeEach } from 'vitest';
import { loadEndlessEnabled, setEndlessEnabled, getBestWave, recordBestWave } from '../src/endless';
import { Battle, TUNING } from '../src/battle';

// vitest 默认 node 环境无 localStorage；storage.ts 在无 wx 时走 localStorage。
// 注入内存版 stub（不引入 jsdom 依赖），使 storeGet/storeSet 可往返。
beforeEach(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  } as Storage;
});

describe('endless persistence', () => {
  it('开关默认关闭，可开启并持久化', () => {
    expect(loadEndlessEnabled()).toBe(false);
    setEndlessEnabled(true);
    expect(loadEndlessEnabled()).toBe(true);
    setEndlessEnabled(false);
    expect(loadEndlessEnabled()).toBe(false);
  });

  it('最高波数默认 0', () => {
    expect(getBestWave()).toBe(0);
  });

  it('recordBestWave 仅在更高时更新并返回是否破纪录', () => {
    expect(recordBestWave(5)).toBe(true);
    expect(getBestWave()).toBe(5);
    expect(recordBestWave(3)).toBe(false);
    expect(getBestWave()).toBe(5);
    expect(recordBestWave(9)).toBe(true);
    expect(getBestWave()).toBe(9);
  });
});

describe('endless difficulty curve', () => {
  it('波>10：基础血量 ×(1+(wave-10)/100)；移速不随波次变化', () => {
    const endless = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    const versus = new Battle(1, 1, undefined, undefined, {}, [], [], false);
    for (const b of [endless, versus]) {
      expect(b.wavePostMul(10)).toBe(1);
      expect(b.wavePostMul(11)).toBeCloseTo(1.01, 5);
      expect(b.wavePostMul(20)).toBeCloseTo(1.1, 5);
      expect(b.wavePostMul(50)).toBeCloseTo(1.4, 5);
    }
  });

  it('移速不随波次/境界升高', () => {
    const b = new Battle(1, 2, undefined, undefined, {}, [], [], false);
    const priv = b as unknown as { endlessMonsterBaseSpeed: (w: number) => number };
    expect(priv.endlessMonsterBaseSpeed(1)).toBe(TUNING.monsterSpd);
    expect(priv.endlessMonsterBaseSpeed(50)).toBe(TUNING.monsterSpd);
    expect(b.effectiveDifficulty(50)).toBeGreaterThan(1);
  });

  it('effectiveDifficulty 分圈阶梯：每 10 波一圈 ×STEP', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    const S = TUNING.endlessCycleStep;
    expect(b.effectiveDifficulty(1)).toBeCloseTo(1, 5);
    expect(b.effectiveDifficulty(10)).toBeCloseTo(1, 5);
    expect(b.effectiveDifficulty(11)).toBeCloseTo(S, 5);
    expect(b.effectiveDifficulty(20)).toBeCloseTo(S, 5);
    expect(b.effectiveDifficulty(21)).toBeCloseTo(S * S, 5);
  });

  it('对战模式 effectiveDifficulty 同样分圈加压', () => {
    const b = new Battle(1, 1.5, undefined, undefined, {}, [], [], false);
    const S = TUNING.endlessCycleStep;
    expect(b.effectiveDifficulty(1)).toBeCloseTo(1.5, 5);
    expect(b.effectiveDifficulty(30)).toBeCloseTo(1.5 * S * S, 5);
  });
});

describe('endless disables opponent and win-cap', () => {
  it('无尽模式不生成 AI 对手怪、不触发击败对手=胜', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    b.startNextWave();
    for (let i = 0; i < 120; i++) b.step(1 / 60);
    expect(b.aiMonsters.length).toBe(0);
    expect(b.status).not.toBe('won');
  });

  it('无尽模式清空第 10 波后继续（进入 ready），不判通关', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], true);
    for (let w = 0; w < 10; w++) {
      b.startNextWave();
      b.forceClearWaveForTest();
    }
    expect(b.wave).toBe(10);
    expect(b.status).not.toBe('won');
  });

  it('对战模式清空第 12 波不判通关（与无尽同不封顶）', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], false);
    for (let w = 0; w < 12; w++) {
      b.startNextWave();
      b.forceClearWaveForTest();
    }
    expect(b.status).not.toBe('won');
    expect(b.wave).toBe(12);
  });
});
