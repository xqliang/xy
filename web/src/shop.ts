// 「神秘商人」功德商店界面：展示功德余额与可升级项，点击卡片购买，返回主菜单。
import { VIEW_W, VIEW_H } from './render';
import { UPGRADES, levelOf, RARITY_COLOR, type MeritState } from './merit';

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
const GAP = 16;
const GRID_TOP = 130;
const GRID_LEFT = (VIEW_W - (CARD_W * COLS_N + GAP)) / 2;

export interface ShopHit {
  kind: 'buy' | 'back';
  id?: string;
}

function cardRect(i: number): { x: number; y: number } {
  const col = i % COLS_N;
  const row = Math.floor(i / COLS_N);
  return { x: GRID_LEFT + col * (CARD_W + GAP), y: GRID_TOP + row * (CARD_H + GAP) };
}

const BACK = { x: 24, y: 40, w: 92, h: 44 };

export function shopHitAt(x: number, y: number): ShopHit | null {
  if (x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h) return { kind: 'back' };
  for (let i = 0; i < UPGRADES.length; i++) {
    const { x: cx, y: cy } = cardRect(i);
    if (x >= cx && x <= cx + CARD_W && y >= cy && y <= cy + CARD_H) return { kind: 'buy', id: UPGRADES[i]!.id };
  }
  return null;
}

export function drawShop(ctx: CanvasRenderingContext2D, merit: MeritState, toast: string): void {
  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#2a2140');
  bg.addColorStop(1, '#3a2c53');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

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

  // 提示
  if (toast) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd76a';
    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillText(toast, VIEW_W / 2, VIEW_H - 40);
  }
}
