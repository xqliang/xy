// web/tests/game-start-hint.test.ts
// 开局「征兵→部署」提示状态机（stepGameStartHint 纯函数）单测。
// 需求：①征兵提示常驻直到玩家点过征兵；②部署提示在征兵后才出现、放置首个 tray 后
// 慢慢淡出消失。canvas 绘制本身不测（仓库惯例），只测阶段推进与透明度曲线。
import { describe, it, expect } from 'vitest';
import {
  stepGameStartHint, gameStartHintAlpha, GAME_START_HINT_FADE_S,
  type GameStartHintState,
} from '../src/render';

const summon0: GameStartHintState = { stage: 'summon', fadeT: 0 };

describe('开局征兵→部署提示状态机', () => {
  it('summon 阶段：未征兵保持不变（常驻直到点击征兵）', () => {
    expect(stepGameStartHint(summon0, false, false, 0.1)).toEqual(summon0);
    // 放了 tray 也不会跳阶段（正常流程 tray 为空前不可能放置；防御语义）
    expect(stepGameStartHint(summon0, false, true, 0.1)).toEqual(summon0);
  });

  it('summon → deploy：征兵后（summonCount>0）切到部署提示', () => {
    expect(stepGameStartHint(summon0, true, false, 0.1)).toEqual({ stage: 'deploy', fadeT: 0 });
  });

  it('deploy 阶段：tray 长度未下降保持；下降（放置了一枚）后切 fade', () => {
    const deploy: GameStartHintState = { stage: 'deploy', fadeT: 0 };
    expect(stepGameStartHint(deploy, true, false, 0.1)).toEqual(deploy);
    expect(stepGameStartHint(deploy, true, true, 0.1)).toEqual({ stage: 'fade', fadeT: 0 });
  });

  it('fade 阶段：按 dt 累计计时，到 GAME_START_HINT_FADE_S 后 off', () => {
    let s = stepGameStartHint({ stage: 'fade', fadeT: 0 }, true, true, 0.5);
    expect(s).toEqual({ stage: 'fade', fadeT: 0.5 });
    s = stepGameStartHint(s, true, true, GAME_START_HINT_FADE_S); // 再走满全程
    expect(s.stage).toBe('off');
  });

  it('off 阶段：任何输入都保持 off（本局不再出现）', () => {
    const off: GameStartHintState = { stage: 'off', fadeT: 0 };
    expect(stepGameStartHint(off, true, true, 1)).toEqual(off);
  });

  it('alpha：summon/deploy 恒 1；fade 线性降到 0；off 为 0', () => {
    expect(gameStartHintAlpha(summon0)).toBe(1);
    expect(gameStartHintAlpha({ stage: 'deploy', fadeT: 0 })).toBe(1);
    expect(gameStartHintAlpha({ stage: 'fade', fadeT: GAME_START_HINT_FADE_S / 2 })).toBeCloseTo(0.5);
    expect(gameStartHintAlpha({ stage: 'fade', fadeT: GAME_START_HINT_FADE_S })).toBe(0);
    expect(gameStartHintAlpha({ stage: 'off', fadeT: 0 })).toBe(0);
  });
});
