// 武器背包：展示已获得的神兵（品质/加成/专属武将），可切换装备（最多 3 件）。
import { VIEW_W, VIEW_H } from './render';
import {
  WEAPONS, weaponQualityName, weaponQualityColor, weaponBonus, STAT_LABEL,
  MAX_EQUIPPED, type BagState,
} from './weapons';
import { generalById } from './generals';

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
const ROW_H = 62;
const TOP = 124;
const LEFT = 24;
const ROW_W = VIEW_W - 48;

export function bagHitAt(x: number, y: number): { kind: 'back' } | { kind: 'toggle'; id: string } | null {
  if (x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h) return { kind: 'back' };
  for (let i = 0; i < WEAPONS.length; i++) {
    const ry = TOP + i * (ROW_H + 4);
    if (y >= ry && y <= ry + ROW_H && x >= LEFT && x <= LEFT + ROW_W) {
      return { kind: 'toggle', id: WEAPONS[i]!.id };
    }
  }
  return null;
}

export function drawBag(ctx: CanvasRenderingContext2D, bag: BagState, toast: string): void {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2b2418');
  bg.addColorStop(1, '#3b3324');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

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
  ctx.fillText('武器背包', VIEW_W / 2, 56);
  ctx.fillStyle = '#d8c8a0';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(`神兵对局随机掉落 · 重复升品质 · 已装备 ${bag.equipped.length}/${MAX_EQUIPPED}（点击切换）`, VIEW_W / 2, 90);

  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i]!;
    const tier = bag.owned[w.id] ?? 0;
    const has = tier > 0;
    const on = bag.equipped.includes(w.id);
    const y = TOP + i * (ROW_H + 4);
    roundRect(ctx, LEFT, y, ROW_W, ROW_H, 10);
    ctx.fillStyle = has ? (on ? '#3f3a24' : '#2a2519') : '#221e16';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = has ? weaponQualityColor(tier) : 'rgba(255,255,255,0.08)';
    ctx.stroke();

    // 名称 + 专属武将
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = has ? '#fff6e6' : 'rgba(255,246,230,0.35)';
    ctx.font = 'bold 17px "PingFang SC", sans-serif';
    ctx.fillText(w.name, LEFT + 14, y + ROW_H / 2 - 10);
    ctx.fillStyle = has ? weaponQualityColor(tier) : 'rgba(200,200,200,0.3)';
    ctx.font = '12px "PingFang SC", sans-serif';
    const gname = generalById(w.general)?.name ?? '';
    ctx.fillText(has ? `${weaponQualityName(tier)}阶 · 专属「${gname}」` : `未获得 · 专属「${gname}」`, LEFT + 14, y + ROW_H / 2 + 12);

    // 加成
    ctx.textAlign = 'right';
    ctx.fillStyle = has ? '#9bffb0' : 'rgba(155,255,176,0.25)';
    ctx.font = 'bold 14px "PingFang SC", sans-serif';
    ctx.fillText(has ? `${STAT_LABEL[w.stat]} +${Math.round(weaponBonus(tier) * 100)}%` : `${STAT_LABEL[w.stat]} —`, LEFT + ROW_W - 96, y + ROW_H / 2);

    // 装备状态徽标
    const bw = 74, bh = 30;
    const bx = LEFT + ROW_W - bw - 12, by = y + (ROW_H - bh) / 2;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = !has ? '#3a3428' : on ? '#c8792b' : '#4a4534';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = !has ? '#6a6250' : '#fff6e6';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.fillText(!has ? '未获得' : on ? '已装备' : '装备', bx + bw / 2, by + bh / 2);
  }

  if (toast) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd76a';
    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillText(toast, VIEW_W / 2, VIEW_H - 26);
  }
}
