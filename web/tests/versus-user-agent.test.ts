import { beforeEach, describe, it, expect } from 'vitest';
import {
  runVersusSession,
  formatVersusSessionReport,
  userAgentTick,
  DEFAULT_SPEED_MUL,
} from '../src/versus-user-agent';
import { Battle } from '../src/battle';
import { DEFAULT_AI_SKILL, loadAiSkill, saveAiSkill } from '../src/ai-skill';

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

describe('versus-user-agent', () => {
  it('userAgentTick：够桃则征兵并布阵', () => {
    const b = new Battle(1, 1, undefined, undefined, {}, [], [], false, 1);
    b.grantPeach(999);
    b.startNextWave();
    const peachBefore = b.peach;
    userAgentTick(b);
    expect(b.peach).toBeLessThan(peachBefore);
  });

  it('20 局 @10×：输出胜率分布并校验平衡', () => {
    const report = runVersusSession({
      games: 20,
      seedBase: 42_000,
      speedMul: DEFAULT_SPEED_MUL,
      initialAiSkill: DEFAULT_AI_SKILL,
    });
    console.log('\n' + formatVersusSessionReport(report));

    expect(report.timeouts).toBeLessThan(4);
    expect(report.playerWinRate).toBeGreaterThan(0.35);
    expect(report.playerWinRate).toBeLessThan(0.9);
    expect(report.aiSkillEnd).toBeGreaterThanOrEqual(0.72);
    expect(report.aiSkillEnd).toBeLessThanOrEqual(1.8);
    expect(loadAiSkill()).toBe(report.aiSkillEnd);
  }, 120_000);
});
