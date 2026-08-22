// 对局 HUD「境界两侧延迟」布局（T9.4）：双方延迟分列顶部中块（波次/境界）左右两侧。
// 旧实现(netLatencyHudPos)把单侧延迟锚到右上角（让位对手主动技能图标），已被本特性取代为
// 「中块两侧 flank」布局。本文件改测新的纯布局帮助 netLatencyFlankXs（无 ctx 依赖，可钉死公式）。
import { describe, it, expect } from 'vitest';
import { netLatencyFlankXs, VIEW_W } from '../src/render';

const CX = VIEW_W / 2; // 中块水平中心（波次/境界两行均以此居中）

describe('netLatencyFlankXs：两侧延迟 x 锚点（避开中块居中文字）', () => {
  it('默认间距 16：左右关于中块中心对称', () => {
    const { leftX, rightX } = netLatencyFlankXs(120);
    expect(rightX - CX).toBe(CX - leftX); // 对称
    expect(leftX).toBe(CX - 120 - 16); // 左 = 中心 - 半宽 - 间距
    expect(rightX).toBe(CX + 120 + 16); // 右 = 中心 + 半宽 + 间距
  });

  it('两侧标签内缘距中块半宽至少留出间距（绝不压住居中文字）', () => {
    const centerHalf = 90;
    const { leftX, rightX } = netLatencyFlankXs(centerHalf);
    // 左侧标签右缘(leftX) ≤ 中块左缘(CX - centerHalf) - gap；右侧标签左缘(rightX) ≥ 中块右缘 + gap
    expect(leftX).toBeLessThanOrEqual(CX - centerHalf - 16);
    expect(rightX).toBeGreaterThanOrEqual(CX + centerHalf + 16);
  });

  it('半宽取中块两行最大值：两侧都在最宽行的半宽之外', () => {
    // 模拟 drawHud 现场：波次行半宽 150（含地图名，更宽）、境界行半宽 60 → centerHalf=150。
    const centerHalf = Math.max(150, 60);
    const { leftX, rightX } = netLatencyFlankXs(centerHalf);
    // 即便按窄行(60)算会压到宽行，取 max 后两侧都退到 150 半宽之外。
    expect(leftX).toBe(CX - 150 - 16);
    expect(rightX).toBe(CX + 150 + 16);
  });

  it('自定义间距 gap 生效', () => {
    const { leftX, rightX } = netLatencyFlankXs(100, 24);
    expect(leftX).toBe(CX - 100 - 24);
    expect(rightX).toBe(CX + 100 + 24);
  });

  it('centerHalf=0（空文本退化）：两侧紧贴中心 ± 间距，仍对称', () => {
    const { leftX, rightX } = netLatencyFlankXs(0);
    expect(leftX).toBe(CX - 16);
    expect(rightX).toBe(CX + 16);
    expect(rightX - leftX).toBe(32); // 2 * gap
  });
});
