import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_SKILL, exportAiPersistState, importAiPersistState, loadAiSkill, saveAiSkill } from '../src/ai-skill';
import { runVersusSessionAsync } from '../src/devtools/sim-runner';

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
  saveAiSkill(DEFAULT_AI_SKILL);
});

describe('devtools sim-runner', () => {
  it('persist=false 不污染 AI skill', async () => {
    saveAiSkill(1.1);
    const before = exportAiPersistState();
    const report = await runVersusSessionAsync({
      games: 2,
      seedBase: 91001,
      initialAiSkill: 1.1,
      persist: false,
      speedMul: 10,
    });
    expect(report.games).toBe(2);
    expect(report.results).toHaveLength(2);
    expect(loadAiSkill()).toBeCloseTo(before.skill, 5);
    const after = exportAiPersistState();
    expect(after.winStreak).toBe(before.winStreak);
    expect(after.lossStreak).toBe(before.lossStreak);
  }, 120_000);

  it('onProgress 会推进', async () => {
    const ticks: number[] = [];
    await runVersusSessionAsync({
      games: 2,
      seedBase: 91011,
      initialAiSkill: DEFAULT_AI_SKILL,
      persist: false,
      onProgress: (p) => ticks.push(p.done),
    });
    expect(ticks[ticks.length - 1]).toBe(2);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('import/export AI 持久化往返', () => {
    importAiPersistState({ skill: 1.25, winStreak: 2, lossStreak: 0 });
    const s = exportAiPersistState();
    expect(s.skill).toBeCloseTo(1.25, 5);
    expect(s.winStreak).toBe(2);
    expect(s.lossStreak).toBe(0);
  });
});
