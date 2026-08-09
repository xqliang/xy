// 对局左下角神兵碎片领取卡片：清波掉落后点击才入库。
import { VIEW_H } from './render';
import {
  weaponById, weaponGradeColor, weaponGradeName,
  weaponFragmentCount, weaponFragmentsRequired, type BagState,
} from './weapons';

const PICKUP_X = 10;
const PICKUP_W = 172;
const PICKUP_H = 54;
const PICKUP_GAP = 6;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function weaponPickupRect(index: number): { x: number; y: number; w: number; h: number } {
  const y = VIEW_H - 14 - PICKUP_H - index * (PICKUP_H + PICKUP_GAP);
  return { x: PICKUP_X, y, w: PICKUP_W, h: PICKUP_H };
}

export function weaponPickupHitAt(x: number, y: number, ids: string[], _bag: BagState): string | null {
  for (let i = 0; i < ids.length; i++) {
    const r = weaponPickupRect(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return ids[i]!;
  }
  return null;
}

export function drawWeaponPickups(ctx: CanvasRenderingContext2D, ids: string[], bag: BagState): void {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const def = weaponById(id);
    if (!def) continue;
    const r = weaponPickupRect(i);
    const gradeColor = weaponGradeColor(id);
    const cur = weaponFragmentCount(bag, id);
    const req = weaponFragmentsRequired(id);
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fillStyle = 'rgba(20,16,10,0.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = gradeColor;
    ctx.stroke();

    const iconR = 18;
    const iconCx = r.x + 16 + iconR;
    const iconCy = r.y + r.h / 2;
    ctx.beginPath();
    ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2);
    ctx.fillStyle = '#3a3020';
    ctx.fill();
    ctx.strokeStyle = gradeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 16px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('片', iconCx, iconCy);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 14px "PingFang SC", sans-serif';
    ctx.fillText(def.name, r.x + 56, r.y + r.h / 2 - 8);
    ctx.fillStyle = '#ffd76a';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(`${weaponGradeName(id)} · 碎片 ${cur + 1}/${req}`, r.x + 56, r.y + r.h / 2 + 12);
  }
}
