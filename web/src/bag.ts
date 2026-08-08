// 武器背包：展示已获得的神兵（品质/加成/专属武将），可切换装备（最多 3 件）。
import { VIEW_W, VIEW_H } from './render';
import {
  WEAPONS, weaponById, weaponQualityName, weaponQualityColor, weaponBonusLabel,
  weaponPctBonus, weaponRangeBonusGrids, STAT_LABEL,
  MAX_EQUIPPED, MAX_WEAPON_TIER, type BagState,
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
    ctx.fillText(has ? weaponBonusLabel(w.stat, tier) : `${STAT_LABEL[w.stat]} —`, LEFT + ROW_W - 96, y + ROW_H / 2);

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

// ———————————————————————————————————————————————————————————
// 神兵详情 tips 弹窗：点击背包行打开，展示完整说明 + 装备/卸下按钮
// ———————————————————————————————————————————————————————————

export type BagPopupHit = 'toggle' | 'close' | 'outside' | null;

const PW = 400;
const PH = 300;
const PX = (VIEW_W - PW) / 2;
const PY = (VIEW_H - PH) / 2;
const PAD = 22;
const CLOSE_R = { x: PX + PW - 40, y: PY + 14, w: 26, h: 26 };
const ACTION_R = { x: PX + PAD, y: PY + PH - 60, w: PW - PAD * 2, h: 44 };

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function bagPopupHitAt(x: number, y: number): BagPopupHit {
  if (inRect(x, y, CLOSE_R)) return 'close';
  if (inRect(x, y, ACTION_R)) return 'toggle';
  if (x >= PX && x <= PX + PW && y >= PY && y <= PY + PH) return null; // 框内非按钮：吞掉
  return 'outside';
}

export function drawBagPopup(ctx: CanvasRenderingContext2D, bag: BagState, id: string): void {
  const w = weaponById(id);
  if (!w) return;
  const tier = bag.owned[id] ?? 0;
  const has = tier > 0;
  const on = bag.equipped.includes(id);
  const gname = generalById(w.general)?.name ?? '';
  const color = has ? weaponQualityColor(tier) : '#7a7466';

  // 遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 底板
  roundRect(ctx, PX, PY, PW, PH, 14);
  ctx.fillStyle = '#2a2418';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 标题
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText(w.name, PX + PAD, PY + 22);
  ctx.fillStyle = color;
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(has ? `${weaponQualityName(tier)}阶 · 专属「${gname}」` : `未获得 · 专属「${gname}」`, PX + PAD, PY + 52);

  // 关闭
  roundRect(ctx, CLOSE_R.x, CLOSE_R.y, CLOSE_R.w, CLOSE_R.h, 7);
  ctx.fillStyle = '#3f3a24';
  ctx.fill();
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 16px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✕', CLOSE_R.x + CLOSE_R.w / 2, CLOSE_R.y + CLOSE_R.h / 2 + 1);

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PX + PAD, PY + 76);
  ctx.lineTo(PX + PW - PAD, PY + 76);
  ctx.stroke();

  // 说明：定位 + 当前加成 + 满阶加成 + 获取方式
  const curBonus = has
    ? (w.stat === 'rge' ? `+${weaponRangeBonusGrids(tier)}格` : `+${Math.round(weaponPctBonus(tier) * 100)}%`)
    : '';
  const maxBonus = w.stat === 'rge'
    ? `+${weaponRangeBonusGrids(MAX_WEAPON_TIER)}格`
    : `+${Math.round(weaponPctBonus(MAX_WEAPON_TIER) * 100)}%`;
  const bonusExplain = w.stat === 'rge'
    ? `范围每升一阶 +0.35 格（金阶满 ${maxBonus}）`
    : `随品质提升（金阶满 ${maxBonus}）`;
  const usage =
    `专属「${gname}」神兵，装备后仅对该武将生效：提升「${STAT_LABEL[w.stat]}」。\n` +
    (has ? `当前 ${weaponQualityName(tier)}阶：${STAT_LABEL[w.stat]} ${curBonus}。${bonusExplain}。\n`
         : `尚未获得。获得后可装备：${STAT_LABEL[w.stat]} ${bonusExplain}。\n`) +
    `对局中随机掉落，重复掉落自动升品质；背包最多同时装备 ${MAX_EQUIPPED} 件。`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.9)';
  ctx.font = '15px "PingFang SC", sans-serif';
  let ty = PY + 90;
  for (const ln of wrapText(ctx, usage, PW - PAD * 2)) { ctx.fillText(ln, PX + PAD, ty); ty += 24; }

  // 动作按钮：装备 / 已装备(卸下) / 未获得
  roundRect(ctx, ACTION_R.x, ACTION_R.y, ACTION_R.w, ACTION_R.h, 10);
  ctx.fillStyle = !has ? '#3a3428' : on ? '#4a4534' : '#c8792b';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = !has ? '#6a6250' : '#fff6e6';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(!has ? '未获得' : on ? '已装备（点击卸下）' : '装备', ACTION_R.x + ACTION_R.w / 2, ACTION_R.y + ACTION_R.h / 2);
}
