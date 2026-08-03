// 图鉴：展示四大兵种(逐阶数值)与妖怪，帮助玩家理解数值体系。从主菜单进入，返回主菜单。
import { VIEW_W, VIEW_H } from './render';
import { UNITS, getUnitStat, towerPOW, MAX_TIER, type UnitType } from '@core';
import { sprite, unitAsset } from './assets';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const BACK = { x: 24, y: 40, w: 92, h: 44 };
const UNIT_ORDER: UnitType[] = ['monkey', 'spear', 'cavalry', 'archer'];

export function codexHitBack(x: number, y: number): boolean {
  return x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h;
}

const UNIT_COLOR: Record<UnitType, string> = { monkey: '#ff9a3c', spear: '#5bd1ff', cavalry: '#7dff8a', archer: '#c79bff' };

export function drawCodex(ctx: CanvasRenderingContext2D): void {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2a2418');
  bg.addColorStop(1, '#3a3222');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 返回
  roundRect(ctx, BACK.x, BACK.y, BACK.w, BACK.h, 10);
  ctx.fillStyle = '#6a5a3a';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ 返回', BACK.x + BACK.w / 2, BACK.y + BACK.h / 2);

  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText('图鉴', VIEW_W / 2, 56);
  ctx.fillStyle = '#d8c8a0';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText('同型同级合成升阶 · 攻击/攻速逐阶 ×1.5/1.4/1.3/1.2', VIEW_W / 2, 88);

  // 四大兵种卡片
  const cardW = 250, cardH = 172, gap = 14;
  const left = (VIEW_W - (cardW * 2 + gap)) / 2;
  const top = 108;
  UNIT_ORDER.forEach((type, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = left + col * (cardW + gap);
    const y = top + row * (cardH + gap);
    drawUnitCard(ctx, type, x, y, cardW, cardH);
  });

  // 妖怪一栏
  const my = top + 2 * (cardH + gap);
  drawMonsterRow(ctx, left, my, cardW * 2 + gap);
}

function drawUnitCard(ctx: CanvasRenderingContext2D, type: UnitType, x: number, y: number, w: number, h: number) {
  const cfg = UNITS[type];
  const color = UNIT_COLOR[type];
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 立绘
  const spr = sprite(unitAsset(type));
  const box = 54;
  if (spr) {
    const s = Math.min(box / spr.width, box / spr.height);
    ctx.drawImage(spr, x + 12, y + 12, spr.width * s, spr.height * s);
  }
  // 名称 + 定位
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.fillText(`${cfg.name}`, x + 74, y + 14);
  ctx.fillStyle = color;
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(`法宝「${cfg.origin}」· ${cfg.role}`, x + 74, y + 40);
  ctx.fillStyle = 'rgba(255,240,210,0.75)';
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillText(`范围 ${cfg.rge}　目标 ${cfg.targets}`, x + 74, y + 60);

  // 逐阶 ATK / POW 小表
  const s1 = getUnitStat(type, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText('阶', x + 14, y + 84);
  ctx.fillText('攻击', x + 60, y + 84);
  ctx.fillText('攻速', x + 120, y + 84);
  ctx.fillText('战力', x + 186, y + 84);
  for (let t = 1; t <= MAX_TIER; t++) {
    const st = getUnitStat(type, t);
    const yy = y + 100 + (t - 1) * 14;
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`${t}阶`, x + 14, yy);
    ctx.fillText(st.atk.toFixed(2), x + 60, yy);
    ctx.fillText(st.frq.toFixed(2), x + 120, yy);
    ctx.fillStyle = color;
    ctx.fillText(towerPOW(type, t).toFixed(1), x + 186, yy);
  }
  void s1;
}

function drawMonsterRow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = 120;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = '#241f16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#a24a6a';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ff9ab0';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText('妖怪', x + 14, y + 12);

  const drawM = (key: 'monster-minion' | 'monster-boss', cx: number, label: string, desc: string) => {
    const spr = sprite(key);
    const box = 46;
    if (spr) {
      const s = Math.min(box / spr.width, box / spr.height);
      ctx.drawImage(spr, cx, y + 44, spr.width * s, spr.height * s);
    }
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText(label, cx + 54, y + 46);
    ctx.fillStyle = 'rgba(255,240,210,0.75)';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(desc, cx + 54, y + 68);
  };
  drawM('monster-minion', x + 14, '小妖', '战力 = 血量 × 移速');
  drawM('monster-boss', x + w / 2 + 6, 'BOSS/精英', '高血量·可施减益技能');
}
