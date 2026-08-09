// 武器背包：展示已获得的神兵（品质/加成/专属武将），可切换装备（最多 3 件）。
import { VIEW_W, VIEW_H } from './render';
import {
  WEAPONS, weaponById, weaponQualityName, weaponQualityColor, weaponBonusLabel,
  weaponPctBonus, weaponRangeBonusGrids, STAT_LABEL,
  MAX_EQUIPPED, MAX_WEAPON_TIER, weaponGradeName, weaponGradeColor,
  weaponFragmentCount, weaponFragmentsRequired, isWeaponActivated,
  type BagState,
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
const ROW_GAP = 4;
const LIST_TOP = 124;
const LIST_BOTTOM_PAD = 40;
const LEFT = 24;
const ROW_W = VIEW_W - 48;
const HEADER_H = 108;

/** 已装备（最近在前）→ 已获得未装备 → 未获得，各段内按 WEAPONS 自然顺序 */
export function bagDisplayOrder(bag: BagState): string[] {
  const equippedSet = new Set(bag.equipped);
  const equippedFirst = [...bag.equipped].reverse();
  const ownedUnequipped = WEAPONS.map((w) => w.id).filter(
    (id) => !equippedSet.has(id) && (bag.owned[id] ?? 0) > 0,
  );
  const unowned = WEAPONS.map((w) => w.id).filter((id) => (bag.owned[id] ?? 0) === 0);
  return [...equippedFirst, ...ownedUnequipped, ...unowned];
}

function rowContentY(index: number): number {
  return LIST_TOP + index * (ROW_H + ROW_GAP);
}

export function bagContentHeight(itemCount: number): number {
  if (itemCount <= 0) return LIST_TOP + LIST_BOTTOM_PAD;
  return rowContentY(itemCount - 1) + ROW_H + LIST_BOTTOM_PAD;
}

export function bagMaxScroll(): number {
  return Math.max(0, bagContentHeight(WEAPONS.length) - VIEW_H);
}

export function bagHitAt(
  x: number,
  y: number,
  bag: BagState,
  scrollY = 0,
): { kind: 'back' } | { kind: 'toggle'; id: string } | null {
  if (x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h) return { kind: 'back' };
  return bagHitAtOrder(x, y + scrollY, bagDisplayOrder(bag));
}

function bagHitAtOrder(x: number, contentY: number, order: string[]): { kind: 'toggle'; id: string } | null {
  for (let i = 0; i < order.length; i++) {
    const ry = rowContentY(i);
    if (contentY >= ry && contentY <= ry + ROW_H && x >= LEFT && x <= LEFT + ROW_W) {
      return { kind: 'toggle', id: order[i]! };
    }
  }
  return null;
}

function drawFragmentBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  frags: number,
  req: number,
  color: string,
): void {
  const h = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, x, y, w, h, 2);
  ctx.fill();
  if (frags > 0) {
    roundRect(ctx, x, y, Math.max(h, w * Math.min(1, frags / req)), h, 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawBagRow(
  ctx: CanvasRenderingContext2D,
  bag: BagState,
  w: (typeof WEAPONS)[number],
  y: number,
): void {
  const tier = bag.owned[w.id] ?? 0;
  const has = isWeaponActivated(bag, w.id);
  const on = bag.equipped.includes(w.id);
  const frags = weaponFragmentCount(bag, w.id);
  const req = weaponFragmentsRequired(w.id);
  const gradeColor = weaponGradeColor(w.id);
  roundRect(ctx, LEFT, y, ROW_W, ROW_H, 10);
  ctx.fillStyle = has ? (on ? '#3f3a24' : '#2a2519') : frags > 0 ? '#2a2318' : '#221e16';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = has ? weaponQualityColor(tier) : frags > 0 ? gradeColor : 'rgba(255,255,255,0.08)';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = has ? '#fff6e6' : frags > 0 ? 'rgba(255,246,230,0.75)' : 'rgba(255,246,230,0.35)';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(w.name, LEFT + 14, y + ROW_H / 2 - 10);
  ctx.fillStyle = has ? weaponQualityColor(tier) : gradeColor;
  ctx.font = '12px "PingFang SC", sans-serif';
  const gname = generalById(w.general)?.name ?? '';
  const sub = has
    ? `${weaponQualityName(tier)}阶 · 专属「${gname}」`
    : `${weaponGradeName(w.id)} · 专属「${gname}」`;
  ctx.fillText(sub, LEFT + 14, y + ROW_H / 2 + 12);

  const barX = LEFT + 14;
  const barW = ROW_W - 14 - 96;
  if (!has) {
    drawFragmentBar(ctx, barX, y + ROW_H - 12, barW, frags, req, gradeColor);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = has ? '#9bffb0' : gradeColor;
  ctx.font = 'bold 14px "PingFang SC", sans-serif';
  ctx.fillText(
    has ? weaponBonusLabel(w.stat, tier) : `碎片 ${frags}/${req}`,
    LEFT + ROW_W - 96,
    y + ROW_H / 2,
  );

  const bw = 74;
  const bh = 30;
  const bx = LEFT + ROW_W - bw - 12;
  const by = y + (ROW_H - bh) / 2;
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fillStyle = !has ? '#3a3428' : on ? '#c8792b' : '#4a4534';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = !has ? '#6a6250' : '#fff6e6';
  ctx.font = 'bold 13px "PingFang SC", sans-serif';
  ctx.fillText(!has ? (frags > 0 ? '收集中' : `${frags}/${req}`) : on ? '已装备' : '装备', bx + bw / 2, by + bh / 2);
}

export function drawBag(ctx: CanvasRenderingContext2D, bag: BagState, toast: string, scrollY = 0): void {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2b2418');
  bg.addColorStop(1, '#3b3324');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const order = bagDisplayOrder(bag);
  ctx.save();
  ctx.translate(0, -scrollY);
  for (let i = 0; i < order.length; i++) {
    const def = weaponById(order[i]!);
    if (def) drawBagRow(ctx, bag, def, rowContentY(i));
  }
  ctx.restore();

  // 固定顶栏（遮住上滑列表）
  ctx.fillStyle = '#2b2418';
  ctx.fillRect(0, 0, VIEW_W, HEADER_H);
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
  ctx.fillText(
    `武将攻击10%掉碎片·每局最多1次·左下角领取 · 低1/普2/中3/高4片激活 · 已装备 ${bag.equipped.length}/${MAX_EQUIPPED}`,
    VIEW_W / 2,
    90,
  );

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
  const has = isWeaponActivated(bag, id);
  const on = bag.equipped.includes(id);
  const frags = weaponFragmentCount(bag, id);
  const req = weaponFragmentsRequired(id);
  const gname = generalById(w.general)?.name ?? '';
  const color = has ? weaponQualityColor(tier) : weaponGradeColor(id);

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
  ctx.fillText(
    has ? `${weaponQualityName(tier)}阶 · 专属「${gname}」`
      : `${weaponGradeName(id)} · 专属「${gname}」 · 需 ${req} 片`,
    PX + PAD, PY + 52,
  );

  if (!has) {
    const barW = PW - PAD * 2;
    drawFragmentBar(ctx, PX + PAD, PY + 82, barW, frags, req, weaponGradeColor(id));
    ctx.fillStyle = weaponGradeColor(id);
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText(`碎片进度 ${frags}/${req}`, PX + PAD, PY + 92);
  }

  // 关闭
  roundRect(ctx, CLOSE_R.x, CLOSE_R.y, CLOSE_R.w, CLOSE_R.h, 7);
  ctx.fillStyle = '#3f3a24';
  ctx.fill();
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 16px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✕', CLOSE_R.x + CLOSE_R.w / 2, CLOSE_R.y + CLOSE_R.h / 2);

  // 分隔线
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PX + PAD, PY + (has ? 76 : 118));
  ctx.lineTo(PX + PW - PAD, PY + (has ? 76 : 118));
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
    `专属「${gname}」神兵（${weaponGradeName(id)}），装备后仅对该武将生效：提升「${STAT_LABEL[w.stat]}」。\n` +
    (has ? `当前 ${weaponQualityName(tier)}阶：${STAT_LABEL[w.stat]} ${curBonus}。${bonusExplain}。\n`
         : frags > 0
           ? `收集中：碎片 ${frags}/${req}，集齐后激活。${STAT_LABEL[w.stat]} ${bonusExplain}。\n`
           : `尚未获得。${weaponGradeName(id)}需 ${req} 片激活：${STAT_LABEL[w.stat]} ${bonusExplain}。\n`) +
    `武将攻击10%概率掉碎片（每局最多1次）；左下角点击领取。已集齐的神兵仍参与随机但不显示。最多同时装备 ${MAX_EQUIPPED} 件。`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,240,210,0.9)';
  ctx.font = '15px "PingFang SC", sans-serif';
  let ty = PY + (has ? 90 : 132);
  for (const ln of wrapText(ctx, usage, PW - PAD * 2)) { ctx.fillText(ln, PX + PAD, ty); ty += 24; }

  // 动作按钮：装备 / 已装备(卸下) / 未获得
  roundRect(ctx, ACTION_R.x, ACTION_R.y, ACTION_R.w, ACTION_R.h, 10);
  ctx.fillStyle = !has ? '#3a3428' : on ? '#4a4534' : '#c8792b';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = !has ? '#6a6250' : '#fff6e6';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(!has ? `收集中 ${frags}/${req}` : on ? '已装备（点击卸下）' : '装备', ACTION_R.x + ACTION_R.w / 2, ACTION_R.y + ACTION_R.h / 2);
}
