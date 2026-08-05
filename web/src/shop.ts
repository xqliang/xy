// 「神秘商人」功德商店界面：展示功德余额与可升级项 + 主动技能（每日重置）购买，点击卡片购买，返回主菜单。
import { VIEW_W, VIEW_H } from './render';
import { UPGRADES, levelOf, RARITY_COLOR, type MeritState } from './merit';
import { ACTIVE_SKILLS, MAX_EQUIPPED_ACTIVES } from './actives';
import { PASSIVE_SKILLS, MAX_EQUIPPED_PASSIVES } from './passives';
import { isEquipped, isPassiveEquipped, type LoadoutState } from './loadout';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const COLS_N = 2;
const CARD_W = 250;
const CARD_H = 150;
const GAP = 12;
const GRID_TOP = 110;
const GRID_LEFT = (VIEW_W - (CARD_W * COLS_N + GAP)) / 2;

export interface ShopHit {
  kind: 'buy' | 'buyActive' | 'buyPassive' | 'back';
  id?: string;
}

function cardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: GRID_TOP + row * (CARD_H + GAP) };
}

// 主动技能区（功德升级卡片下方）：紧凑卡片
const ACT_CARD_H = 72;
const ACT_TOP = GRID_TOP + Math.ceil(UPGRADES.length / COLS_N) * (CARD_H + GAP) + 30;
function activeCardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: ACT_TOP + row * (ACT_CARD_H + GAP) };
}

// 被动技能区（主动技能区下方）：与主动技能同样的紧凑卡片
const PAS_TOP = ACT_TOP + Math.ceil(ACTIVE_SKILLS.length / COLS_N) * (ACT_CARD_H + GAP) + 30;
function passiveCardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: PAS_TOP + row * (ACT_CARD_H + GAP) };
}

const BACK = { x: 24, y: 40, w: 92, h: 44 };

// 商城可滚动内容的总高度（最后一个被动卡片底部 + 底部留白）
export function shopContentHeight(): number {
  const passiveRows = Math.ceil(PASSIVE_SKILLS.length / COLS_N);
  const lastBottom = PAS_TOP + (passiveRows - 1) * (ACT_CARD_H + GAP) + ACT_CARD_H;
  return lastBottom + 24; // 底部留白
}
export const SHOP_MAX_SCROLL = () => Math.max(0, shopContentHeight() - VIEW_H);

export function shopHitAt(x: number, y: number, scrollY = 0): ShopHit | null {
  if (x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h) return { kind: 'back' };
  const cy0 = y + scrollY; // 卡片随内容上移，屏幕 y 映射到内容坐标需加回 scrollY
  for (let i = 0; i < UPGRADES.length; i++) {
    const { x: cx, y: cy } = cardRect(i);
    if (x >= cx && x <= cx + CARD_W && cy0 >= cy && cy0 <= cy + CARD_H) return { kind: 'buy', id: UPGRADES[i]!.id };
  }
  for (let i = 0; i < ACTIVE_SKILLS.length; i++) {
    const { x: cx, y: cy } = activeCardRect(i);
    if (x >= cx && x <= cx + CARD_W && cy0 >= cy && cy0 <= cy + ACT_CARD_H) return { kind: 'buyActive', id: ACTIVE_SKILLS[i]!.id };
  }
  for (let i = 0; i < PASSIVE_SKILLS.length; i++) {
    const { x: cx, y: cy } = passiveCardRect(i);
    if (x >= cx && x <= cx + CARD_W && cy0 >= cy && cy0 <= cy + ACT_CARD_H) return { kind: 'buyPassive', id: PASSIVE_SKILLS[i]!.id };
  }
  return null;
}

export function drawShop(ctx: CanvasRenderingContext2D, merit: MeritState, loadout: LoadoutState, toast: string, scrollY = 0): void {
  // 背景（固定，铺满整个画布）
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2a2140');
  bg.addColorStop(1, '#3a2c53');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // —— 随内容竖向滚动的三段卡片（升级 / 主动 / 被动）——
  ctx.save();
  ctx.translate(0, -scrollY);

  // 卡片
  for (let i = 0; i < UPGRADES.length; i++) {
    const up = UPGRADES[i]!;
    const lv = levelOf(merit, up.id);
    const maxed = lv >= up.maxLevel;
    const cost = up.cost(lv);
    const afford = merit.merit >= cost;
    const { x, y } = cardRect(i);
    roundRect(ctx, x, y, CARD_W, CARD_H, 12);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = RARITY_COLOR[up.rarity];
    ctx.stroke();
    // 图标 + 名称
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '30px sans-serif';
    ctx.fillText(up.icon, x + 14, y + 12);
    ctx.fillStyle = '#fff6e6';
    ctx.font = 'bold 19px "PingFang SC", sans-serif';
    ctx.fillText(up.name, x + 54, y + 16);
    // 稀有度 + 等级
    ctx.fillStyle = RARITY_COLOR[up.rarity];
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.fillText(`${up.rarity} · Lv.${lv}/${up.maxLevel}`, x + 54, y + 42);
    // 下一级效果
    ctx.fillStyle = 'rgba(255,240,210,0.85)';
    ctx.font = '15px "PingFang SC", sans-serif';
    ctx.fillText(maxed ? '已满级' : up.desc(lv), x + 14, y + 74);
    // 等级点
    const dotY = y + 102;
    for (let k = 0; k < up.maxLevel; k++) {
      ctx.beginPath();
      ctx.arc(x + 20 + k * 16, dotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = k < lv ? RARITY_COLOR[up.rarity] : 'rgba(255,255,255,0.18)';
      ctx.fill();
    }
    // 购买条
    const bw = CARD_W - 28;
    const by = y + CARD_H - 34;
    roundRect(ctx, x + 14, by, bw, 24, 8);
    ctx.fillStyle = maxed ? '#3a3350' : afford ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = maxed ? '#8a86a0' : afford ? '#fff6e6' : '#9a8a7a';
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText(maxed ? '——' : `购买 · ${cost} 功德`, x + 14 + bw / 2, by + 12);
  }

  // —— 主动技能区（每日重置）——
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.fillText(`主动技能（每日重置，最多装备 ${MAX_EQUIPPED_ACTIVES} 个）`, GRID_LEFT, ACT_TOP - 16);
  for (let i = 0; i < ACTIVE_SKILLS.length; i++) {
    const act = ACTIVE_SKILLS[i]!;
    const equipped = isEquipped(loadout, act.id);
    const afford = merit.merit >= act.cost;
    const { x, y } = activeCardRect(i);
    roundRect(ctx, x, y, CARD_W, ACT_CARD_H, 12);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = equipped ? '#6ab0ff' : '#5a4a7a';
    ctx.stroke();
    // 图标 + 名称
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(act.icon, x + 12, y + 12);
    ctx.font = 'bold 18px "PingFang SC", sans-serif';
    ctx.fillText(act.name, x + 52, y + 12);
    ctx.fillStyle = 'rgba(255,240,210,0.8)';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText(act.desc, x + 52, y + 36);
    // 购买/已装备条
    const bw = CARD_W - 24;
    const by = y + ACT_CARD_H - 26;
    roundRect(ctx, x + 12, by, bw, 20, 7);
    ctx.fillStyle = equipped ? '#2f5a3a' : afford ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = equipped ? '#9bffb0' : afford ? '#fff6e6' : '#9a8a7a';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.fillText(equipped ? '✓ 已装备' : `购买装备 · ${act.cost} 功德 · CD${act.cd}s`, x + 12 + bw / 2, by + 10);
  }

  // —— 被动技能区（每日重置）——
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.fillText(`被动技能（每日重置，最多装备 ${MAX_EQUIPPED_PASSIVES} 个）`, GRID_LEFT, PAS_TOP - 16);
  for (let i = 0; i < PASSIVE_SKILLS.length; i++) {
    const pas = PASSIVE_SKILLS[i]!;
    const equipped = isPassiveEquipped(loadout, pas.id);
    const afford = merit.merit >= pas.cost;
    const { x, y } = passiveCardRect(i);
    roundRect(ctx, x, y, CARD_W, ACT_CARD_H, 12);
    ctx.fillStyle = '#241d38';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = equipped ? '#7ec46a' : '#5a4a7a';
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '28px "PingFang SC", sans-serif';
    ctx.fillStyle = '#fff6e6';
    ctx.fillText(pas.icon, x + 12, y + 12);
    ctx.font = 'bold 18px "PingFang SC", sans-serif';
    ctx.fillText(pas.name, x + 52, y + 12);
    ctx.fillStyle = 'rgba(255,240,210,0.8)';
    ctx.font = '11px "PingFang SC", sans-serif';
    ctx.fillText(pas.desc.length > 22 ? pas.desc.slice(0, 22) + '…' : pas.desc, x + 52, y + 36);
    const bw = CARD_W - 24;
    const by = y + ACT_CARD_H - 26;
    roundRect(ctx, x + 12, by, bw, 20, 7);
    ctx.fillStyle = equipped ? '#2f5a3a' : afford ? '#c8792b' : '#4a3a30';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = equipped ? '#9bffb0' : afford ? '#fff6e6' : '#9a8a7a';
    ctx.font = 'bold 13px "PingFang SC", sans-serif';
    ctx.fillText(equipped ? '✓ 已装备' : `购买装备 · ${pas.cost} 功德`, x + 12 + bw / 2, by + 10);
  }

  // —— 结束滚动内容 ——
  ctx.restore();

  // —— 固定顶部栏（不随滚动）：不透明色带遮住上滑卡片，再画返回/标题/余额 ——
  ctx.fillStyle = '#2a2140';
  ctx.fillRect(0, 0, VIEW_W, 104);

  // 返回按钮
  roundRect(ctx, BACK.x, BACK.y, BACK.w, BACK.h, 10);
  ctx.fillStyle = '#5a4a7a';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ 返回', BACK.x + BACK.w / 2, BACK.y + BACK.h / 2);

  // 标题 + 功德余额
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText('神秘商人', VIEW_W / 2, 56);
  ctx.fillStyle = '#e0c8ff';
  ctx.font = 'bold 20px "PingFang SC", sans-serif';
  ctx.fillText(`功德 ${merit.merit}`, VIEW_W / 2, 92);

  // 提示（贴底显示，避免遮住被动技能卡片）
  if (toast) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffd76a';
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.fillText(toast, VIEW_W / 2, VIEW_H - 8);
  }
}
