// web/tests/intro-speech.test.ts
// 开局唐僧出场气泡的掷定逻辑：Battle.rollIntroSpeech(rand)。
// 契约：50% 概率不说（introSpeech=null），否则从 INTRO_SPEECHES 随机一句；
// 随机源由调用方（main 展示层）注入，本方法不碰 this.rng（保持战斗确定性/PvP 快照不受影响）。
// 映射：[0,0.5)→null；[0.5,0.75)→第1句；[0.75,1)→第2句（即 不说 50% / 两句各 25%）。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';

const mk = () =>
  new Battle(1, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, {});

describe('Battle.rollIntroSpeech：开局唐僧出场气泡掷定', () => {
  it('台词就是产品需求的两句', () => {
    expect(Battle.INTRO_SPEECHES).toEqual(['妖怪来了！', '救命啊~']);
  });

  it('rand<0.5 → 本局不说（null）', () => {
    for (const r of [0, 0.1, 0.49, 0.4999]) {
      const b = mk();
      b.rollIntroSpeech(r);
      expect(b.introSpeech).toBeNull();
    }
  });

  it('[0.5,0.75) → 第 1 句「妖怪来了！」', () => {
    for (const r of [0.5, 0.6, 0.7499]) {
      const b = mk();
      b.rollIntroSpeech(r);
      expect(b.introSpeech).toBe('妖怪来了！');
    }
  });

  it('[0.75,1) → 第 2 句「救命啊~」', () => {
    for (const r of [0.75, 0.9, 0.9999]) {
      const b = mk();
      b.rollIntroSpeech(r);
      expect(b.introSpeech).toBe('救命啊~');
    }
  });

  it('大样本：约 50% 不说、两句各约 25%（用确定性序列而非真随机）', () => {
    let none = 0, a = 0, other = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const b = mk();
      b.rollIntroSpeech(i / N); // 均匀铺满 [0,1)
      if (b.introSpeech === null) none++;
      else if (b.introSpeech === '妖怪来了！') a++;
      else other++;
    }
    expect(none).toBe(500);
    expect(a).toBe(250);
    expect(other).toBe(250);
  });
});
