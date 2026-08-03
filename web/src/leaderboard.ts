// 排行榜：伪竞技榜单。以玩家当前境界为中心，展示上下若干名"对手"(确定性生成)，玩家高亮。
import { VIEW_W, VIEW_H } from './render';
import { rankName } from './rank';

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
// 对手名池（西游披皮，确定性取用）
const NAMES = ['小钻风', '巡山虎', '奔波儿灞', '灞波儿奔', '有来有去', '精细鬼', '伶俐虫', '刁钻古怪', '古怪刁钻', '云里雾', '雾里云', '急如火', '快如风', '兴烘掀', '掀烘兴', '倒海龙', '翻江蜃'];

export function leaderboardHitBack(x: number, y: number): boolean {
  return x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h;
}

interface Row { name: string; level: number; me: boolean; }

// 以玩家等级为锚，构造一份榜单（玩家附近的对手等级围绕其分布）
function buildRows(playerLevel: number): Row[] {
  const rows: Row[] = [];
  // 生成 12 名对手，等级在 [playerLevel-6, playerLevel+6] 抖动，确定性
  for (let i = 0; i < NAMES.length; i++) {
    const jitter = ((i * 7 + 3) % 13) - 6; // -6..6 确定性
    const lv = Math.max(0, playerLevel + jitter + (i % 2 === 0 ? 1 : -1));
    rows.push({ name: NAMES[i]!, level: lv, me: false });
  }
  rows.push({ name: '大圣（我）', level: playerLevel, me: true });
  rows.sort((a, b) => b.level - a.level || (a.me ? -1 : 1));
  return rows.slice(0, 12);
}

export function drawLeaderboard(ctx: CanvasRenderingContext2D, playerLevel: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  bg.addColorStop(0, '#22283a');
  bg.addColorStop(1, '#2e3550');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  roundRect(ctx, BACK.x, BACK.y, BACK.w, BACK.h, 10);
  ctx.fillStyle = '#4a5a7a';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹ 返回', BACK.x + BACK.w / 2, BACK.y + BACK.h / 2);

  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 30px "PingFang SC", sans-serif';
  ctx.fillText('排行榜', VIEW_W / 2, 56);
  ctx.fillStyle = '#c8d0e8';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText('每日重置 · 冲击更高境界', VIEW_W / 2, 88);

  const rows = buildRows(playerLevel);
  const x = 28, w = VIEW_W - 56, rh = 56, top = 120;
  rows.forEach((row, i) => {
    const y = top + i * (rh + 6);
    roundRect(ctx, x, y, w, rh, 10);
    ctx.fillStyle = row.me ? '#3a4e78' : '#2a3048';
    ctx.fill();
    if (row.me) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffd76a';
      ctx.stroke();
    }
    // 名次
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rankColor = i === 0 ? '#ffd23c' : i === 1 ? '#cfd6e0' : i === 2 ? '#d9925a' : '#8a92a8';
    ctx.fillStyle = rankColor;
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.fillText(`${i + 1}`, x + 30, y + rh / 2);
    // 名称
    ctx.textAlign = 'left';
    ctx.fillStyle = row.me ? '#fff6c0' : '#e8ecf6';
    ctx.font = `bold 18px "PingFang SC", sans-serif`;
    ctx.fillText(row.name, x + 62, y + rh / 2 - 8);
    // 境界
    ctx.fillStyle = '#9aa4c0';
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.fillText(`境界 · ${rankName(row.level)}`, x + 62, y + rh / 2 + 12);
    // 星级
    ctx.textAlign = 'right';
    const stars = Math.min(5, row.level);
    ctx.fillStyle = '#e0a020';
    ctx.font = '15px sans-serif';
    ctx.fillText('★'.repeat(stars) + '☆'.repeat(5 - stars), x + w - 16, y + rh / 2);
  });
}
