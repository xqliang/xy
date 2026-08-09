// 神秘商人：每局战斗结算回到首页后自动弹出一次（全屏遮罩 + 卷轴面板），关闭后无入口直至下局结束。
import { VIEW_W, VIEW_H } from './render';
import { sprite } from './assets';
import { activeById, enabledActives, MAX_EQUIPPED_ACTIVES } from './actives';
import { passiveById, enabledPassives, MAX_EQUIPPED_PASSIVES } from './passives';
import {
  buyActive,
  buyPassive,
  equipActive,
  equipPassive,
  grantActive,
  grantPassive,
  isOwnedActive,
  isOwnedPassive,
  unequipActive,
  unequipPassive,
  type LoadoutState,
} from './loadout';
import type { MeritState } from './merit';
import { spendMerit } from './merit';

export type SkillKind = 'active' | 'passive';

export interface MerchantOffer {
  kind: SkillKind;
  id: string;
  /** 今日已购买、当前未装备 → 展示「装备」免费按钮 */
  owned: boolean;
}

export interface MerchantUiState {
  open: boolean;
  tab: 'shop' | 'lottery';
  offers: MerchantOffer[];
  lotteryPreview: Array<{ kind: SkillKind; id: string }>;
  toast: string;
}

export const LOTTERY_MERIT_COST = 45;
export const MERCHANT_OFFER_COUNT = 3;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

type SkillRef = { kind: SkillKind; id: string };

function allSkills(): SkillRef[] {
  const out: SkillRef[] = [];
  for (const a of enabledActives()) out.push({ kind: 'active', id: a.id });
  for (const p of enabledPassives()) out.push({ kind: 'passive', id: p.id });
  return out;
}

function isEquipped(loadout: LoadoutState, ref: SkillRef): boolean {
  return ref.kind === 'active'
    ? loadout.equipped.includes(ref.id)
    : loadout.passives.includes(ref.id);
}

/** 随机池：排除当前已装备；已拥有未装备可再次出现 */
export function rollMerchantOffers(loadout: LoadoutState): MerchantOffer[] {
  const pool = allSkills().filter((s) => !isEquipped(loadout, s));
  const picked = shuffle(pool).slice(0, MERCHANT_OFFER_COUNT);
  return picked.map((s) => ({
    kind: s.kind,
    id: s.id,
    owned: s.kind === 'active' ? isOwnedActive(loadout, s.id) : isOwnedPassive(loadout, s.id),
  }));
}

export function rollLotteryPreview(): Array<{ kind: SkillKind; id: string }> {
  return shuffle(allSkills()).slice(0, 8);
}

export function merchantClosed(): MerchantUiState {
  return { open: false, tab: 'shop', offers: [], lotteryPreview: [], toast: '' };
}

/** 战斗结算回首页时调用：弹出并重 roll 商品 */
export function openMerchant(loadout: LoadoutState): MerchantUiState {
  return {
    open: true,
    tab: 'shop',
    offers: rollMerchantOffers(loadout),
    lotteryPreview: rollLotteryPreview(),
    toast: '',
  };
}

export function closeMerchant(m: MerchantUiState): MerchantUiState {
  return { ...m, open: false, toast: '' };
}

function skillCost(kind: SkillKind, id: string): number {
  const def = kind === 'active' ? activeById(id) : passiveById(id);
  return def?.cost ?? 0;
}

function pickLotterySkill(loadout: LoadoutState): SkillRef | null {
  const pool = allSkills().filter((s) => !isEquipped(loadout, s));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export interface MerchantActionResult {
  merchant: MerchantUiState;
  loadout: LoadoutState;
  merit: MeritState;
}

export function applyMerchantHit(
  hit: Exclude<MerchantHit, null>,
  merchant: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): MerchantActionResult {
  let m = merchant;
  let lo = loadout;
  let me = merit;

  switch (hit.kind) {
    case 'close':
    case 'continue':
      return { merchant: closeMerchant(m), loadout: lo, merit: me };
    case 'tab':
      return { merchant: { ...m, tab: hit.tab, toast: '' }, loadout: lo, merit: me };
    case 'unequipActive':
      lo = unequipActive(lo, hit.id);
      m = { ...m, offers: rollMerchantOffers(lo), toast: '已卸下' };
      return { merchant: m, loadout: lo, merit: me };
    case 'unequipPassive':
      lo = unequipPassive(lo, hit.id);
      m = { ...m, offers: rollMerchantOffers(lo), toast: '已卸下' };
      return { merchant: m, loadout: lo, merit: me };
    case 'offer': {
      const offer = m.offers[hit.index];
      if (!offer) return { merchant: m, loadout: lo, merit: me };
      if (offer.owned) {
        const res = offer.kind === 'active' ? equipActive(lo, offer.id) : equipPassive(lo, offer.id);
        lo = res.loadout;
        m = {
          ...m,
          offers: rollMerchantOffers(lo),
          toast: res.ok ? '已装备' : res.reason ?? '无法装备',
        };
      } else if (offer.kind === 'active') {
        const res = buyActive(lo, me, offer.id);
        lo = res.loadout;
        me = res.merit;
        m = {
          ...m,
          offers: rollMerchantOffers(lo),
          toast: res.ok
            ? (lo.equipped.includes(offer.id) ? '已购买并装备' : '已购买（槽满，卸下后可装备）')
            : res.reason ?? '无法购买',
        };
      } else {
        const res = buyPassive(lo, me, offer.id);
        lo = res.loadout;
        me = res.merit;
        m = {
          ...m,
          offers: rollMerchantOffers(lo),
          toast: res.ok
            ? (lo.passives.includes(offer.id) ? '已购买并装备' : '已购买（槽满，卸下后可装备）')
            : res.reason ?? '无法购买',
        };
      }
      return { merchant: m, loadout: lo, merit: me };
    }
    case 'lottery':
      return merchantLottery(m, lo, me);
    default: {
      const _exhaustive: never = hit;
      return _exhaustive;
    }
  }
}

/** 抽奖：扣固定功德，随机未装备技能；未拥有则 grant+装备，已拥有则免费装备 */
function merchantLottery(
  merchant: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): MerchantActionResult {
  if (merit.merit < LOTTERY_MERIT_COST) {
    return { merchant: { ...merchant, toast: '功德不足' }, loadout, merit };
  }
  const pick = pickLotterySkill(loadout);
  if (!pick) {
    return { merchant: { ...merchant, toast: '无可抽技能' }, loadout, merit };
  }
  const name = (pick.kind === 'active' ? activeById(pick.id) : passiveById(pick.id))?.name ?? pick.id;
  let lo = loadout;
  let me = spendMerit(merit, LOTTERY_MERIT_COST);

  if (pick.kind === 'active') {
    if (isOwnedActive(lo, pick.id)) {
      const res = equipActive(lo, pick.id);
      lo = res.loadout;
    } else {
      lo = grantActive(lo, pick.id);
    }
    const equipped = lo.equipped.includes(pick.id);
    return {
      merchant: {
        ...merchant,
        offers: rollMerchantOffers(lo),
        lotteryPreview: rollLotteryPreview(),
        toast: equipped ? `抽中「${name}」并已装备` : `抽中「${name}」（请先卸下腾位）`,
      },
      loadout: lo,
      merit: me,
    };
  }

  if (isOwnedPassive(lo, pick.id)) {
    const res = equipPassive(lo, pick.id);
    lo = res.loadout;
    const equipped = lo.passives.includes(pick.id);
    return {
      merchant: {
        ...merchant,
        offers: rollMerchantOffers(lo),
        lotteryPreview: rollLotteryPreview(),
        toast: equipped ? `抽中「${name}」并已装备` : res.reason ?? '槽位已满',
      },
      loadout: lo,
      merit: me,
    };
  }
  lo = grantPassive(lo, pick.id);
  const equipped = lo.passives.includes(pick.id);
  return {
    merchant: {
      ...merchant,
      offers: rollMerchantOffers(lo),
      lotteryPreview: rollLotteryPreview(),
      toast: equipped ? `抽中「${name}」并已装备` : `抽中「${name}」（请先卸下腾位）`,
    },
    loadout: lo,
    merit: me,
  };
}

export function applyMerchantHitFull(
  hit: Exclude<MerchantHit, null>,
  merchant: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): MerchantActionResult {
  return applyMerchantHit(hit, merchant, loadout, merit);
}

/** 技能稀有度色（按功德定价档映射） */
export function skillRarityColor(cost: number): { label: string; color: string } {
  if (cost >= 75) return { label: '传说', color: '#ff9a3c' };
  if (cost >= 65) return { label: '史诗', color: '#b47aff' };
  if (cost >= 55) return { label: '精良', color: '#6ab0ff' };
  return { label: '稀有', color: '#6ab07a' };
}

// —— 弹窗几何 —— //
const PW = 520;
const PH = 880;
const PX = (VIEW_W - PW) / 2;
const PY = 72;
const CLOSE_R = { x: PX + 10, y: PY + 10, w: 34, h: 34 };
const TAB_SHOP = { x: PX + 80, y: PY + 88, w: 160, h: 36 };
const TAB_LOTTERY = { x: PX + 280, y: PY + 88, w: 160, h: 36 };
const CONTENT_TOP = PY + 136;
const CONTENT_H = 430;
const EQUIP_TOP = PY + 580;
const CONTINUE_R = { x: PX + 130, y: PY + PH - 58, w: 260, h: 44 };

const OFFER_H = 128;
const OFFER_GAP = 10;
function offerRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: PX + 16, y: CONTENT_TOP + i * (OFFER_H + OFFER_GAP), w: PW - 32, h: OFFER_H };
}

const LOT_CELL = 88;
const LOT_GAP = 8;
const LOT_GRID_W = LOT_CELL * 3 + LOT_GAP * 2;
const LOT_OX = PX + (PW - LOT_GRID_W) / 2;
const LOT_OY = CONTENT_TOP + 24;
function lotCellRect(row: number, col: number): { x: number; y: number; w: number; h: number } {
  return {
    x: LOT_OX + col * (LOT_CELL + LOT_GAP),
    y: LOT_OY + row * (LOT_CELL + LOT_GAP),
    w: LOT_CELL,
    h: LOT_CELL,
  };
}
const LOTTERY_BTN = lotCellRect(1, 1);

function lotPreviewIndex(row: number, col: number): number | null {
  if (row === 1 && col === 1) return null;
  if (row === 0) return col;
  if (row === 1) return col === 0 ? 3 : 4;
  return 5 + col;
}

const ACT_SLOT = 52;
const PAS_SLOT = 44;
const ACT_ROW_Y = EQUIP_TOP + 36;
const PAS_ROW_Y = EQUIP_TOP + 96;

function equippedActiveRects(loadout: LoadoutState): Array<{ x: number; y: number; w: number; h: number; id: string }> {
  const pitch = ACT_SLOT + 10;
  const startX = PX + (PW - MAX_EQUIPPED_ACTIVES * pitch + 10) / 2;
  return loadout.equipped.map((id, i) => ({
    x: startX + i * pitch,
    y: ACT_ROW_Y,
    w: ACT_SLOT,
    h: ACT_SLOT,
    id,
  }));
}

function equippedPassiveRects(loadout: LoadoutState): Array<{ x: number; y: number; w: number; h: number; id: string }> {
  const pitch = PAS_SLOT + 6;
  const startX = PX + (PW - MAX_EQUIPPED_PASSIVES * pitch + 6) / 2;
  return loadout.passives.map((id, i) => ({
    x: startX + i * pitch,
    y: PAS_ROW_Y,
    w: PAS_SLOT,
    h: PAS_SLOT,
    id,
  }));
}

function unequipBtnRect(slot: { x: number; y: number; w: number; h: number }) {
  return { x: slot.x + slot.w - 14, y: slot.y - 6, w: 18, h: 18 };
}

export type MerchantHit =
  | { kind: 'close' }
  | { kind: 'tab'; tab: 'shop' | 'lottery' }
  | { kind: 'offer'; index: number }
  | { kind: 'lottery' }
  | { kind: 'unequipActive'; id: string }
  | { kind: 'unequipPassive'; id: string }
  | { kind: 'continue' }
  | null;

export function merchantHitAt(x: number, y: number, m: MerchantUiState, loadout: LoadoutState): MerchantHit {
  if (!m.open) return null;
  if (inRect(x, y, CLOSE_R)) return { kind: 'close' };
  if (inRect(x, y, TAB_SHOP)) return { kind: 'tab', tab: 'shop' };
  if (inRect(x, y, TAB_LOTTERY)) return { kind: 'tab', tab: 'lottery' };
  if (inRect(x, y, CONTINUE_R)) return { kind: 'continue' };

  for (const r of equippedActiveRects(loadout)) {
    if (inRect(x, y, unequipBtnRect(r))) return { kind: 'unequipActive', id: r.id };
  }
  for (const r of equippedPassiveRects(loadout)) {
    if (inRect(x, y, unequipBtnRect(r))) return { kind: 'unequipPassive', id: r.id };
  }

  if (m.tab === 'shop') {
    for (let i = 0; i < m.offers.length; i++) {
      if (inRect(x, y, offerRect(i))) return { kind: 'offer', index: i };
    }
  } else if (inRect(x, y, LOTTERY_BTN)) {
    return { kind: 'lottery' };
  }

  // 面板内非按钮区吞掉；遮罩空白不关闭（须点 × 或「关闭」）
  if (x >= PX && x <= PX + PW && y >= PY && y <= PY + PH) return null;
  return null;
}

function drawScrollPanel(ctx: CanvasRenderingContext2D): void {
  const scrollImg = sprite('merchant-scroll');
  if (scrollImg) {
    ctx.drawImage(scrollImg, PX, PY, PW, PH);
    return;
  }
  roundRect(ctx, PX, PY, PW, PH, 18);
  const grad = ctx.createLinearGradient(PX, PY, PX, PY + PH);
  grad.addColorStop(0, '#f5e6c8');
  grad.addColorStop(0.5, '#edd9a8');
  grad.addColorStop(1, '#e0c890');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8b4513';
  ctx.stroke();
  ctx.fillStyle = '#6b2f0a';
  roundRect(ctx, PX + 8, PY - 6, PW - 16, 14, 6);
  ctx.fill();
  roundRect(ctx, PX + 8, PY + PH - 8, PW - 16, 14, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,40,10,0.35)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, PX + 12, PY + 12, PW - 24, PH - 24, 14);
  ctx.stroke();
}

function drawMerchantAvatar(ctx: CanvasRenderingContext2D): void {
  const peddler = sprite('merchant-peddler');
  const cx = VIEW_W / 2;
  const cy = PY + 52;
  if (peddler) {
    const s = 56;
    const scale = Math.min(s / peddler.width, s / peddler.height);
    ctx.drawImage(peddler, cx - (peddler.width * scale) / 2, cy - s + 8, peddler.width * scale, peddler.height * scale);
    return;
  }
  ctx.font = '40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🧙', cx, cy);
}

function drawOfferCard(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  merit: MeritState,
  index: number,
): void {
  const offer = m.offers[index];
  if (!offer) return;
  const r = offerRect(index);
  const def = offer.kind === 'active' ? activeById(offer.id) : passiveById(offer.id);
  if (!def) return;
  const rarity = skillRarityColor(def.cost);
  const cost = skillCost(offer.kind, offer.id);
  const canAfford = merit.merit >= cost;

  roundRect(ctx, r.x, r.y, r.w, r.h, 12);
  ctx.fillStyle = 'rgba(255,248,230,0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rarity.color;
  ctx.stroke();

  ctx.fillStyle = rarity.color;
  ctx.font = 'bold 11px "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rarity.label, r.x + 10, r.y + 8);

  ctx.font = '34px sans-serif';
  ctx.fillText(def.icon, r.x + 14, r.y + 34);

  ctx.fillStyle = '#4a2808';
  ctx.font = 'bold 17px "PingFang SC", sans-serif';
  ctx.fillText(def.name, r.x + 58, r.y + 28);
  ctx.fillStyle = 'rgba(70,45,15,0.85)';
  ctx.font = '13px "PingFang SC", sans-serif';
  const desc = offer.kind === 'active'
    ? `${def.desc} · CD${activeById(offer.id)!.cd}s`
    : def.desc;
  ctx.fillText(fitText(ctx, desc, r.w - 130), r.x + 58, r.y + 52);

  const bw = 88;
  const bh = 36;
  const bx = r.x + r.w - bw - 12;
  const by = r.y + (r.h - bh) / 2;
  roundRect(ctx, bx, by, bw, bh, 8);
  if (offer.owned) {
    ctx.fillStyle = '#3a6a4a';
    ctx.fill();
    ctx.fillStyle = '#e8ffe8';
    ctx.font = 'bold 14px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('装备', bx + bw / 2, by + bh / 2);
  } else {
    ctx.fillStyle = canAfford ? '#c8792b' : '#8a7a6a';
    ctx.fill();
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${cost} 功德`, bx + bw / 2, by + bh / 2);
  }
}

function drawLotteryGrid(ctx: CanvasRenderingContext2D, m: MerchantUiState): void {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cell = lotCellRect(row, col);
      const isCenter = row === 1 && col === 1;
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 10);
      if (isCenter) {
        ctx.fillStyle = '#b5391f';
        ctx.fill();
        ctx.strokeStyle = '#ffd76a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff6e6';
        ctx.font = 'bold 16px "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('抽奖', cell.x + cell.w / 2, cell.y + cell.h / 2 - 8);
        ctx.font = '12px "PingFang SC", sans-serif';
        ctx.fillText(`${LOTTERY_MERIT_COST} 功德`, cell.x + cell.w / 2, cell.y + cell.h / 2 + 14);
        continue;
      }
      const idx = lotPreviewIndex(row, col);
      const preview = idx !== null ? m.lotteryPreview[idx] : undefined;
      ctx.fillStyle = 'rgba(255,248,230,0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(139,69,19,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (preview) {
        const def = preview.kind === 'active' ? activeById(preview.id) : passiveById(preview.id);
        if (def) {
          ctx.font = '28px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.icon, cell.x + cell.w / 2, cell.y + cell.h / 2);
        }
      }
    }
  }
  const legends = [
    { label: '稀有', color: '#6ab07a' },
    { label: '精良', color: '#6ab0ff' },
    { label: '史诗', color: '#b47aff' },
    { label: '传说', color: '#ff9a3c' },
  ];
  const ly = CONTENT_TOP + CONTENT_H - 28;
  const pitch = 118;
  const lx0 = PX + (PW - legends.length * pitch) / 2 + 20;
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < legends.length; i++) {
    const lg = legends[i]!;
    ctx.fillStyle = lg.color;
    ctx.fillRect(lx0 + i * pitch, ly, 14, 14);
    ctx.fillStyle = '#5a3a12';
    ctx.textAlign = 'left';
    ctx.fillText(lg.label, lx0 + i * pitch + 20, ly + 7);
  }
}

function drawEquippedSection(ctx: CanvasRenderingContext2D, loadout: LoadoutState): void {
  roundRect(ctx, PX + 12, EQUIP_TOP, PW - 24, 168, 12);
  ctx.fillStyle = 'rgba(120,80,30,0.18)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,10,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#6b3a10';
  ctx.font = 'bold 15px "PingFang SC", sans-serif';
  ctx.fillText('我的道具', PX + 24, EQUIP_TOP + 10);
  ctx.font = '12px "PingFang SC", sans-serif';
  ctx.fillStyle = 'rgba(90,50,10,0.75)';
  ctx.fillText(`主动 ${loadout.equipped.length}/${MAX_EQUIPPED_ACTIVES}`, PX + 24, ACT_ROW_Y - 16);
  ctx.fillText(`被动 ${loadout.passives.length}/${MAX_EQUIPPED_PASSIVES}`, PX + 24, PAS_ROW_Y - 16);

  for (const r of equippedActiveRects(loadout)) {
    const def = activeById(r.id);
    roundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fillStyle = '#4a3828';
    ctx.fill();
    ctx.strokeStyle = '#6ab0ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = `${Math.round(r.w * 0.48)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def?.icon ?? '?', r.x + r.w / 2, r.y + r.h / 2);
    drawUnequipX(ctx, unequipBtnRect(r));
  }

  for (const r of equippedPassiveRects(loadout)) {
    const def = passiveById(r.id);
    roundRect(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.fillStyle = '#2c4a30';
    ctx.fill();
    ctx.strokeStyle = '#6ab07a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = `${Math.round(r.w * 0.48)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def?.icon ?? '?', r.x + r.w / 2, r.y + r.h / 2);
    drawUnequipX(ctx, unequipBtnRect(r));
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(90,50,10,0.6)';
  ctx.font = '11px "PingFang SC", sans-serif';
  ctx.fillText('tip: 道具仅当天有效', VIEW_W / 2, EQUIP_TOP + 152);
}

function drawUnequipX(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }): void {
  ctx.beginPath();
  ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#c0392b';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('×', r.x + r.w / 2, r.y + r.h / 2 + 1);
}

/** 全屏透明遮罩 + 卷轴面板（叠在首页之上） */
export function drawMerchant(
  ctx: CanvasRenderingContext2D,
  m: MerchantUiState,
  loadout: LoadoutState,
  merit: MeritState,
): void {
  if (!m.open) return;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawScrollPanel(ctx);

  roundRect(ctx, CLOSE_R.x, CLOSE_R.y, CLOSE_R.w, CLOSE_R.h, 8);
  ctx.fillStyle = 'rgba(90,50,10,0.25)';
  ctx.fill();
  ctx.fillStyle = '#6b3a10';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('×', CLOSE_R.x + CLOSE_R.w / 2, CLOSE_R.y + CLOSE_R.h / 2);

  drawMerchantAvatar(ctx);

  ctx.fillStyle = '#b5391f';
  ctx.font = 'bold 28px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('神秘商人', VIEW_W / 2, PY + 68);

  ctx.fillStyle = '#6b3a10';
  ctx.font = 'bold 14px "PingFang SC", sans-serif';
  ctx.fillText(`功德 ${merit.merit}`, VIEW_W / 2, PY + 118);

  for (const tab of [{ id: 'shop' as const, r: TAB_SHOP, label: '商店' }, { id: 'lottery' as const, r: TAB_LOTTERY, label: '抽奖' }]) {
    const active = m.tab === tab.id;
    roundRect(ctx, tab.r.x, tab.r.y, tab.r.w, tab.r.h, 10);
    ctx.fillStyle = active ? '#b5391f' : 'rgba(120,80,30,0.15)';
    ctx.fill();
    if (active) {
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = active ? '#fff6e6' : '#6b3a10';
    ctx.font = 'bold 16px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tab.label, tab.r.x + tab.r.w / 2, tab.r.y + tab.r.h / 2);
  }

  if (m.tab === 'shop') {
    for (let i = 0; i < m.offers.length; i++) drawOfferCard(ctx, m, merit, i);
  } else {
    drawLotteryGrid(ctx, m);
  }

  drawEquippedSection(ctx, loadout);

  roundRect(ctx, CONTINUE_R.x, CONTINUE_R.y, CONTINUE_R.w, CONTINUE_R.h, 12);
  ctx.fillStyle = '#c8792b';
  ctx.fill();
  ctx.fillStyle = '#fff6e6';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('关闭', CONTINUE_R.x + CONTINUE_R.w / 2, CONTINUE_R.y + CONTINUE_R.h / 2);

  if (m.toast) {
    ctx.fillStyle = '#b5391f';
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.toast, VIEW_W / 2, PY + PH + 8);
  }
}
