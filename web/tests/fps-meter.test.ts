import { describe, it, expect } from 'vitest';
import {
  FPS_METER_WINDOW_MS,
  fpsMeterTick,
  type FpsMeterState,
} from '../src/quality';

/** 构造一个初始态（windowStart=-1 表示尚未开始统计） */
const fresh = (): FpsMeterState => ({ windowStart: -1, frames: 0, fps: 0 });

describe('FPS 显示滚动窗口 fpsMeterTick', () => {
  it('窗口常量存在且为正（约 0.5s，兼顾刷新快与抖动平滑）', () => {
    expect(FPS_METER_WINDOW_MS).toBeGreaterThan(0);
    expect(FPS_METER_WINDOW_MS).toBeLessThan(2000);
  });

  it('首帧初始化：记录窗口起点、计 1 帧、fps 仍为 0（样本不足不出数）', () => {
    const s = fpsMeterTick(fresh(), 1000);
    expect(s).toEqual({ windowStart: 1000, frames: 1, fps: 0 });
  });

  it('窗口内只累计帧数，不刷新 fps 值', () => {
    let s = fpsMeterTick(fresh(), 1000);
    s = fpsMeterTick(s, 1016);
    s = fpsMeterTick(s, 1032);
    expect(s.frames).toBe(3);
    expect(s.fps).toBe(0); // 未跨窗口不出数，避免半窗抖动
    expect(s.windowStart).toBe(1000); // 起点不漂移
  });

  it('跨窗口边界：按窗口实际时长换算 fps（500ms 窗口 31 帧 → ~62fps）', () => {
    let s = fpsMeterTick(fresh(), 0);
    // 0..500ms 均匀 31 帧（含首帧）：第 31 帧落在 500ms 整，跨过窗口边界
    for (let i = 1; i <= 30; i++) s = fpsMeterTick(s, i * (500 / 30));
    expect(s.fps).toBeCloseTo(62, 0); // 31 帧 / 0.5s
    // 跨窗后新窗口从当前帧时刻重新起算
    expect(s.windowStart).toBeCloseTo(500, 6);
    expect(s.frames).toBe(0);
  });

  it('连续两个窗口各自独立统计', () => {
    let s = fpsMeterTick(fresh(), 0);
    for (let i = 1; i <= 60; i++) s = fpsMeterTick(s, i * (1000 / 60)); // 1s 60 帧 → 跨两次窗口
    expect(s.fps).toBeGreaterThan(55); // 第二窗仍应接近 60
  });

  it('切后台巨帧回来：fps 按真实跨度算出低值（不除零、不 NaN）', () => {
    let s = fpsMeterTick(fresh(), 0);
    s = fpsMeterTick(s, 16); // 窗口内 2 帧
    s = fpsMeterTick(s, 16000); // 巨帧（后台 16s）
    expect(Number.isFinite(s.fps)).toBe(true);
    expect(s.fps).toBeLessThan(1); // 3 帧/16s → ~0.19fps，真实反映
  });

  it('不可变：返回新状态，不改入参', () => {
    const prev = { windowStart: 1000, frames: 5, fps: 0 };
    const next = fpsMeterTick(prev, 1016);
    expect(prev).toEqual({ windowStart: 1000, frames: 5, fps: 0 });
    expect(next.frames).toBe(6);
    expect(next).not.toBe(prev);
  });
});
