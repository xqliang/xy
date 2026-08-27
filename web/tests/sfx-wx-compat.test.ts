// 回归：微信小游戏运行时不暴露 Web Audio 全局构造器（AudioNode / GainNode）。
// sfx.ts 曾用 `a.node instanceof AudioNode` / `instanceof GainNode`——启用 WX 背景音乐后（commit 48f828b），
// 这两行会在真机执行到时抛 `ReferenceError: AudioNode is not defined`（真机报错栈即此）。
// vitest 默认 node 环境同样没有这些全局，故能忠实复现：修复前抛 ReferenceError，修复后不抛。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 记录所有创建出来的增益节点，便于断言「确实走到了增益节点」（而非静默跳过）。
const gains: Array<{ gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
function makeGain() {
  const g = { gain: { value: 0, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  gains.push(g);
  return g;
}
const fakeCtx = {
  currentTime: 0,
  state: 'running' as const,
  destination: {},
  createGain: vi.fn(() => makeGain()),
  createBufferSource: vi.fn(() => ({ buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
  decodeAudioData: vi.fn(),
  resume: vi.fn(() => Promise.resolve()),
};

vi.mock('../src/platform', () => ({ createAudioContext: () => fakeCtx }));
vi.mock('../src/storage', () => ({ storeGet: () => '0', storeSet: () => {} }));
vi.mock('@asset-manifest', () => ({ ASSET_URLS: { 'bgm-menu': 'http://example.invalid/bgm.mp3' } }));

import { initAudio, startMenuMusic, stopAmbient, applyAudioVolumes } from '../src/sfx';

describe('sfx 微信小游戏兼容：无 Web Audio 全局构造器时不崩溃', () => {
  beforeEach(() => {
    stopAmbient(); // 清空 ambientNodes（模块单例状态跨用例保留）
    gains.length = 0;
    vi.clearAllMocks();
    // 网络屏蔽：decodeBgm 的 fetch 会异步失败并被 .catch 兜底，不影响同步断言
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no-net'))));
  });

  it('前提：当前运行环境（同 WX）没有 AudioNode / GainNode 全局', () => {
    expect(typeof (globalThis as unknown as { AudioNode?: unknown }).AudioNode).toBe('undefined');
    expect(typeof (globalThis as unknown as { GainNode?: unknown }).GainNode).toBe('undefined');
  });

  it('stopAmbient 不抛 ReferenceError: AudioNode is not defined，并断开 WebAudio 节点', () => {
    initAudio();
    startMenuMusic(); // 同步向 ambientNodes 压入一个增益节点
    const bgmGain = gains[gains.length - 1]; // 最后创建的即 BGM 增益节点
    expect(() => stopAmbient()).not.toThrow();
    expect(bgmGain.disconnect).toHaveBeenCalled(); // 走到了「断开」分支（非静默跳过）
  });

  it('applyAudioVolumes 不抛 ReferenceError: GainNode is not defined，并调节增益', () => {
    initAudio();
    startMenuMusic();
    const bgmGain = gains[gains.length - 1];
    expect(() => applyAudioVolumes(0.6, 0.6)).not.toThrow();
    expect(bgmGain.gain.setTargetAtTime).toHaveBeenCalled(); // isGainNode 命中，调了音量
  });
});
