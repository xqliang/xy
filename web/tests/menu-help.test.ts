import { describe, it, expect } from 'vitest';
import {
  HELP_BLOCKS,
  helpContentHeight,
  helpMaxScroll,
  helpPopupHitAt,
  helpPopupBounds,
  helpScrollArea,
} from '../src/menu-help';

/** 足够真实的 measureText，让换行逻辑可测 */
function makeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as CanvasRenderingContext2D;
}

describe('操作说明弹窗', () => {
  it('包含新手必需的分区标题', () => {
    const titles = HELP_BLOCKS.filter((b) => b.kind === 'title').map((b) => b.text);
    expect(titles).toEqual([
      '游戏目标',
      '三步上手',
      '常用操作',
      '兵器',
      '武将（英雄）',
      '神兵（武器）',
      '主动与被动技能',
      '蟠桃从哪来',
      '境界（段位）',
      '体力',
      '局外成长',
      '相关页面',
    ]);
  });

  it('兵器说明在武将之前，并介绍四类兵种', () => {
    const titles = HELP_BLOCKS.filter((b) => b.kind === 'title').map((b) => b.text);
    expect(titles.indexOf('兵器')).toBeLessThan(titles.indexOf('武将（英雄）'));
    const unit = HELP_BLOCKS.find((b) => b.kind === 'body' && b.text.includes('棍猴'));
    expect(unit && unit.kind === 'body' ? unit.text : '').toMatch(/枪|骑|弓/);
  });

  it('提供跳转武将、兵器、神兵等页面的链接', () => {
    const links = HELP_BLOCKS.filter((b) => b.kind === 'link');
    const ids = links.map((b) => (b.kind === 'link' ? b.id : ''));
    expect(ids).toContain('codex-hero');
    expect(ids).toContain('codex-unit');
    expect(ids).toContain('bag');
    expect(ids).toContain('codex-monster');
    expect(ids).toContain('codex-skill');
    expect(ids).toContain('stamina');
  });

  it('游戏目标点明地图上下半场', () => {
    const goal = HELP_BLOCKS.find((b) => b.kind === 'body' && b.text.includes('地图'));
    expect(goal && goal.kind === 'body' ? goal.text : '').toMatch(/地图分为上下两半/);
    expect(goal && goal.kind === 'body' ? goal.text : '').toMatch(/下半场/);
    expect(goal && goal.kind === 'body' ? goal.text : '').toMatch(/上半场/);
  });

  it('布阵说明建议先自动再微调', () => {
    const auto = HELP_BLOCKS.find((b) => b.kind === 'body' && b.text.includes('布阵'));
    expect(auto && auto.kind === 'body' ? auto.text : '').toMatch(/先点布阵/);
    expect(auto && auto.kind === 'body' ? auto.text : '').toMatch(/手动微调/);
  });

  it('武将介绍包含字牌激活、满级差、继承与分类', () => {
    const heroBodies = HELP_BLOCKS.filter((b) => b.kind === 'body').map((b) =>
      b.kind === 'body' ? b.text : '',
    );
    const joined = heroBodies.join('\n');
    expect(joined).toMatch(/左右紧邻/);
    expect(joined).toMatch(/满 3/);
    expect(joined).toMatch(/满 5/);
    expect(joined).toMatch(/继承|对齐/);
    expect(joined).toMatch(/输出/);
    expect(joined).toMatch(/控制/);
    expect(joined).toMatch(/辅助/);
    expect(joined).toMatch(/观音|老君|文殊/);
    expect(joined).toMatch(/大招 CD|大招CD/);
    expect(joined).toMatch(/过渡/);
  });

  it('技能说明包含主动被动装配与日重置', () => {
    const skillTitle = HELP_BLOCKS.find((b) => b.kind === 'title' && b.text === '主动与被动技能');
    expect(skillTitle).toBeTruthy();
    const joined = HELP_BLOCKS.filter((b) => b.kind === 'body')
      .map((b) => (b.kind === 'body' ? b.text : ''))
      .join('\n');
    expect(joined).toMatch(/神秘商人/);
    expect(joined).toMatch(/结算.*首页|回首页/);
    expect(joined).toMatch(/主动技能/);
    expect(joined).toMatch(/被动技能/);
    expect(joined).toMatch(/自然日|每日|跨天/);
    expect(joined).toMatch(/最多装备 2/);
    expect(joined).toMatch(/最多装备 6/);
    expect(joined).toMatch(/技能图鉴.*卸下|卸下\/重装|本页不能购买/);
  });

  it('神兵介绍包含掉落与装备上限', () => {
    const weapon = HELP_BLOCKS.filter((b) => b.kind === 'body' && b.text.includes('神兵'));
    expect(weapon.some((b) => b.kind === 'body' && /碎片/.test(b.text))).toBe(true);
    expect(weapon.some((b) => b.kind === 'body' && /最多 3 件/.test(b.text))).toBe(true);
  });

  it('蟠桃说明包含被动技能产桃', () => {
    const peach = HELP_BLOCKS.find((b) => b.kind === 'body' && b.text.includes('被动'));
    expect(peach && peach.kind === 'body' ? peach.text : '').toMatch(/被动技能/);
  });

  it('体力说明包含消耗与补充途径', () => {
    const sta = HELP_BLOCKS.find((b) => b.kind === 'body' && b.text.includes('体力'));
    expect(sta && sta.kind === 'body' ? sta.text : '').toMatch(/消耗/);
    expect(sta && sta.kind === 'body' ? sta.text : '').toMatch(/广告|分享|自动恢复/);
  });

  it('三步上手有编号步骤', () => {
    const steps = HELP_BLOCKS.filter((b) => b.kind === 'step');
    expect(steps.map((s) => (s.kind === 'step' ? s.n : 0))).toEqual([1, 2, 3]);
  });

  it('内容高度超过可视区，需要滚动', () => {
    const ctx = makeCtx();
    expect(helpContentHeight(ctx)).toBeGreaterThan(400);
    expect(helpMaxScroll(ctx)).toBeGreaterThan(0);
  });

  it('关闭钮与面板外点击关闭，面板内可滚动', () => {
    const bounds = helpPopupBounds();
    const area = helpScrollArea();
    const ctx = makeCtx();
    // 预热布局，便于链接命中检测
    helpContentHeight(ctx);
    expect(helpPopupHitAt(bounds.x + 20, bounds.y + 20, 0, ctx)?.kind).toBe('close');
    expect(helpPopupHitAt(area.x + 10, area.y + 10, 0, ctx)?.kind).toBe('scroll');
    expect(helpPopupHitAt(0, 0, 0, ctx)?.kind).toBe('close');
  });

  it('可命中章节内的跳转链接', () => {
    const ctx = makeCtx();
    const layoutH = helpContentHeight(ctx);
    // 滚到接近底部，命中「相关页面」里的英雄图鉴链接附近
    const scrollY = Math.max(0, layoutH - 200);
    const area = helpScrollArea();
    // 在内容区左侧扫一遍，至少应能命中某个 link
    let found: string | null = null;
    for (let y = area.y + 8; y < area.y + area.h - 8; y += 10) {
      const hit = helpPopupHitAt(area.x + 8, y, scrollY, ctx);
      if (hit?.kind === 'link') {
        found = hit.id;
        break;
      }
    }
    expect(found).toBeTruthy();
  });
});
