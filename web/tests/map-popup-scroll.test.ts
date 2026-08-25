// 地图选择弹窗布局与滚动（面板加高默认显示全 3 行 + 拖拽滚动预留）。
import { describe, it, expect } from 'vitest';
import {
  mapCardRect,
  mapGridContentHeight,
  mapMaxScroll,
  mapPopupHitAt,
  mapScrollArea,
} from '../src/menu-popups';
import { MAPS } from '../src/board';

describe('地图选择弹窗：加高 + 滚动', () => {
  it('五图 2 列共 3 行，内容高度不超过滚动视区（默认全可见）', () => {
    expect(MAPS).toHaveLength(5);
    expect(mapGridContentHeight()).toBe(3 * (148 + 12) - 12); // 3 行卡片含行距
    expect(mapGridContentHeight()).toBeLessThanOrEqual(mapScrollArea().h);
    // 当前 5 图全可见 → 最大滚动量为 0（滚动能力为将来更多图预留）
    expect(mapMaxScroll()).toBe(0);
  });

  it('全部卡片都在面板滚动视区内（第 5 张黄风岭卡不被裁掉）', () => {
    const area = mapScrollArea();
    for (let i = 0; i < MAPS.length; i++) {
      const r = mapCardRect(i);
      expect(r.y, `卡${i} 顶部`).toBeGreaterThanOrEqual(area.y);
      expect(r.y + r.h, `卡${i} 底部`).toBeLessThanOrEqual(area.y + area.h);
    }
  });

  it('点击第 5 张卡命中黄风岭；点击卡片间隙命中滚动视区', () => {
    const r = mapCardRect(4);
    const hit = mapPopupHitAt(r.x + r.w / 2, r.y + r.h / 2);
    expect(hit).toEqual({ kind: 'map', mapId: 'huangfengling' });
    // 第 2、3 行之间的间隙落在滚动视区（可拖拽滚动的落点）
    const top2 = mapCardRect(2);
    const gap = mapPopupHitAt(top2.x + 10, top2.y - 6);
    expect(gap).toEqual({ kind: 'scroll' });
  });

  it('scrollY 偏移参与命中：滚动后按新位置命中卡片', () => {
    // 当前 maxScroll=0 无法真滚；直接用大 scrollY 验证偏移语义（hit 内部会 clamp 无影响，这里测 rect 平移）
    const r0 = mapCardRect(0, 0);
    const r0s = mapCardRect(0, 40);
    expect(r0s.y).toBe(r0.y - 40);
  });
});
