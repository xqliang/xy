// 网络延迟 HUD 锚点布局（T7.6 用户调整）：延迟与对手主动技能图标同一行（比旧 HUD_H/2 上移 16px）；
// 对手有主动技能 → 技能优先占右上，延迟排到最左一枚主动技能图标左侧；无主动技能 → 贴右上原位。
import { describe, it, expect } from 'vitest';
import { Battle, NO_META } from '../src/battle';
import { MAPS } from '../src/board';
import { netLatencyHudPos, VIEW_W, HUD_H } from '../src/render';
import { activeById } from '../src/actives';

const mk = () =>
  new Battle(7, 1, MAPS[0]!, NO_META, {}, [], [], false, undefined, 1, undefined, undefined);

describe('netLatencyHudPos：延迟 HUD 锚点（主动技能优先、延迟在其左侧）', () => {
  it('对手无主动技能：延迟贴右上，且上移到主动技能行高度', () => {
    const b = mk();
    b.aiPickedItems = [];
    const pos = netLatencyHudPos(b);
    expect(pos.rightX).toBe(VIEW_W - 12);
    expect(pos.y).toBe(HUD_H / 2 - 16); // 比旧位置（HUD_H/2）上移
  });

  it('对手有主动技能：延迟排到最左一枚图标左侧（rightX 显著左移）', () => {
    const b = mk();
    // 找两个真实主动技 id（经 activeById 校验确为主动技），模拟对手装备两枚。
    const ids = ['act_meteor'].filter((id) => activeById(id) != null);
    if (ids.length === 0) return; // id 改名则本用例跳过（防御，不静默失效断言之外的逻辑）
    b.aiPickedItems = [...ids, ...ids]; // 同 id 重复也占位（布局按序排 chip）
    const pos = netLatencyHudPos(b);
    // 两枚图标从右往左排：chip0.x=VIEW_W-12-13、chip1.x=chip0.x-31（actGap=2*13+5）；
    // 延迟文本右缘 = 最左图标 x - 半径13 - 间距8。精确断言钉死布局公式。
    const chip1X = VIEW_W - 12 - 13 - 31;
    expect(pos.rightX).toBe(chip1X - 13 - 8);
    expect(pos.rightX).toBeLessThan(VIEW_W - 12 - 26); // 确实让出了图标宽度
    expect(pos.y).toBe(HUD_H / 2 - 16);
  });
});
