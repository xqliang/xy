// PvP「暂停改退出」纯逻辑测试（Task 9.5）。
// 核心不变量：真人对战开退出弹窗时，弹窗模态拦输入，但**仿真照常步进**。
// 单人暂停则仿真同步冻结。这些决策被抽到 pvp-pause.ts 以便单测（主流程闭包无法直接测）。
import { describe, it, expect } from 'vitest';
import { isPausePopupOpen, shouldStepSim, pausePopupContext } from '../src/pvp-pause';

describe('isPausePopupOpen', () => {
  it('单人暂停 → 弹窗开', () => {
    expect(isPausePopupOpen(true, false)).toBe(true);
  });
  it('PvP 退出弹窗 → 弹窗开', () => {
    expect(isPausePopupOpen(false, true)).toBe(true);
  });
  it('两者都关 → 弹窗关', () => {
    expect(isPausePopupOpen(false, false)).toBe(false);
  });
  it('两者都开 → 弹窗开（防御）', () => {
    expect(isPausePopupOpen(true, true)).toBe(true);
  });
});

describe('shouldStepSim — PvP 退出弹窗不冻结仿真', () => {
  const base = { paused: false, tutorial: false, settleOpen: false, netDead: false };

  it('常态：仿真步进', () => {
    expect(shouldStepSim(base)).toBe(true);
  });
  it('T9.5 核心：PvP 退出弹窗开着(pvpExitPopup 不进此函数) 仍步进——仿真不停', () => {
    // pvpExitPopup 只影响 isPausePopupOpen（输入模态），不在此函数入参内，
    // 所以即便「弹窗开着」，只要 paused=false 就继续步进。
    expect(shouldStepSim({ ...base, paused: false })).toBe(true);
  });
  it('单人暂停(paused=true) → 仿真冻结', () => {
    expect(shouldStepSim({ ...base, paused: true })).toBe(false);
  });
  it('新手引导 → 冻结', () => {
    expect(shouldStepSim({ ...base, tutorial: true })).toBe(false);
  });
  it('结算弹层 → 冻结', () => {
    expect(shouldStepSim({ ...base, settleOpen: true })).toBe(false);
  });
  it('PvP 断线判死 → 冻结', () => {
    expect(shouldStepSim({ ...base, netDead: true })).toBe(false);
  });
});

describe('pausePopupContext', () => {
  it('有 WS 连接 → match（继续/认输）', () => {
    expect(pausePopupContext(true)).toBe('match');
  });
  it('无 WS → battle（继续/终止）', () => {
    expect(pausePopupContext(false)).toBe('battle');
  });
});
