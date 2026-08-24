// web/tests/general-panel-layout.test.ts
// 武将信息面板（drawWordSelection）高度布局纯函数单测。
// 背景：旧实现基础余量仅 ~3px；羁绊详情给 ph 加 18 却把 statTop 推后 24 → 内容净溢出 ~3px，
// 加上增益行（炼丹/羁绊/仙丹/风火轮）后底部越贴越紧直至超出面板边框。
// 这里锁定不变式：任意标志组合下，最后一行内容（含图标芯片 8px 半高）距面板底边 ≥8px；
// 未激活面板的底部提示行与最后一行属性行之间也有可分辨的间隙。
import { describe, it, expect } from 'vitest';
import { GENERAL_PANEL_STAT_TOP_BASE, generalPanelMetrics, type GeneralPanelOpts } from '../src/render';

describe('武将信息面板布局', () => {
  it('statTop 基准：无羁绊/神兵 90，羁绊 +24，神兵再 +16（与文案栈一致）', () => {
    expect(generalPanelMetrics({ active: true }).statTop).toBe(GENERAL_PANEL_STAT_TOP_BASE);
    expect(generalPanelMetrics({ active: true, showBondDetail: true }).statTop).toBe(GENERAL_PANEL_STAT_TOP_BASE + 24);
    expect(generalPanelMetrics({ active: true, equippedWeapon: true }).statTop).toBe(GENERAL_PANEL_STAT_TOP_BASE + 16);
    expect(generalPanelMetrics({ active: true, showBondDetail: true, equippedWeapon: true }).statTop)
      .toBe(GENERAL_PANEL_STAT_TOP_BASE + 24 + 16);
  });

  it('不变式：激活面板最后一行（含芯片半高 8）距底边 ≥8px，descExtra 不破坏', () => {
    const combos: Partial<GeneralPanelOpts>[] = [];
    for (const bond of [false, true])
      for (const weapon of [false, true])
        for (const buff of [0, 1, 2])
          for (const pill of [0, 1, 2])
            for (const desc of [0, 15, 30])
              combos.push({ active: true, showBondDetail: bond, equippedWeapon: weapon, buffCount: buff, pillCount: pill, descExtra: desc });
    for (const c of combos) {
      const m = generalPanelMetrics(c as GeneralPanelOpts);
      const rows = 7 + (c.buffCount ?? 0) + (c.pillCount ?? 0); // 激活：7 属性行 + 增益行
      const contentBottom = m.statTop + rows * 16 - 16 + 8; // 最后一行中心 + 芯片半高
      expect(m.ph - contentBottom).toBeGreaterThanOrEqual(8);
    }
  });

  it('不变式：未激活面板底部提示行与末行属性不重叠（间隙 ≥6px）', () => {
    for (const desc of [0, 15, 30]) {
      const m = generalPanelMetrics({ active: false, descExtra: desc });
      const lastStatBottom = m.statTop + 5 * 16 - 16 + 7; // 5 属性行，末行中心+文字半高
      const hintTop = m.ph - 10 - 6; // 提示行画在 ph-10，12px 字半高 6
      expect(hintTop - lastStatBottom).toBeGreaterThanOrEqual(6);
    }
  });

  it('pw：激活带仙丹/风火轮芯片行加宽到 210；未激活多搭子加宽 248', () => {
    expect(generalPanelMetrics({ active: true, pillCount: 0 }).pw).toBe(194);
    expect(generalPanelMetrics({ active: true, pillCount: 1 }).pw).toBe(210);
    expect(generalPanelMetrics({ active: false }).pw).toBe(194);
    expect(generalPanelMetrics({ active: false, inactivePartners: 2 }).pw).toBe(248);
    expect(generalPanelMetrics({ active: false, hintMinW: 260 }).pw).toBe(260);
  });
});
