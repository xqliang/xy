// 排行榜：拉取服务端日榜；失败时提示暂不可用（不回退假 NPC）。
import { VIEW_W, VIEW_H } from './render';
import { rankName } from './rank';
import { sprite } from './assets';
import { apiFetch } from './api/client';
import { avatarById } from './avatar-catalog';

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

export function leaderboardHitBack(x: number, y: number): boolean {
  return x >= BACK.x && x <= BACK.x + BACK.w && y >= BACK.y && y <= BACK.y + BACK.h;
}

export interface LeaderboardRow {
  name: string;
  level: number;
  me: boolean;
  avatarId: string;
  place?: number;
}

/** 当前用户自己的成绩（用于未上榜时在底部固定展示）。unranked=未进入服务端榜单。 */
interface SelfRow {
  name: string;
  level: number;
  avatarId: string;
  place?: number;
  unranked: boolean;
}

interface DailyResp {
  day: string;
  entries: Array<{
    name: string;
    rankLevel: number;
    avatarId: string;
    me?: boolean;
  }>;
  me: { name: string; rankLevel: number; avatarId: string; place?: number } | null;
}

let cache: { day: string; rows: LeaderboardRow[]; self: SelfRow | null; error: string | null; at: number } | null = null;
let inflight: Promise<void> | null = null;

export function invalidateLeaderboardCache(): void {
  cache = null;
}

export function ensureLeaderboardLoaded(onDone?: () => void): void {
  if (cache && Date.now() - cache.at < 30_000) {
    onDone?.();
    return;
  }
  if (inflight) {
    void inflight.then(() => onDone?.());
    return;
  }
  inflight = (async () => {
    const res = await apiFetch<DailyResp>('/api/leaderboard/daily?limit=50', { method: 'GET' });
    if (!res.ok) {
      cache = { day: '', rows: [], self: null, error: '排行榜暂不可用', at: Date.now() };
    } else {
      const rows: LeaderboardRow[] = res.data.entries.map((e) => ({
        name: e.name,
        level: e.rankLevel,
        me: !!e.me,
        avatarId: e.avatarId || 'wukong',
      }));
      // 自己的成绩单独保存：unranked=当前用户不在服务端返回的榜单条目里（即未上榜）。
      // 未上榜时不再把「我」塞进 rows 末尾（会被列表截断丢掉），改为在底部固定展示。
      const meInList = rows.some((r) => r.me);
      const self: SelfRow | null = res.data.me
        ? {
            name: res.data.me.name,
            level: res.data.me.rankLevel,
            avatarId: res.data.me.avatarId,
            place: res.data.me.place,
            unranked: !meInList,
          }
        : null;
      cache = { day: res.data.day, rows, self, error: null, at: Date.now() };
    }
    inflight = null;
    onDone?.();
  })();
}

export function drawLeaderboard(ctx: CanvasRenderingContext2D, _playerLevel: number): void {
  ensureLeaderboardLoaded();

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
  ctx.fillText('昨日排行榜', VIEW_W / 2, 56);
  ctx.fillStyle = '#c8d0e8';
  ctx.font = '13px "PingFang SC", sans-serif';
  ctx.fillText(cache?.day ? `每日榜 · ${cache.day}` : '每日重置 · 冲击更高境界', VIEW_W / 2, 88);

  if (cache?.error) {
    ctx.fillStyle = '#e8c8a0';
    ctx.font = '18px "PingFang SC", sans-serif';
    ctx.fillText(cache.error, VIEW_W / 2, VIEW_H / 2);
    return;
  }

  const rows = cache?.rows ?? [];
  if (!rows.length) {
    ctx.fillStyle = '#c8d0e8';
    ctx.font = '18px "PingFang SC", sans-serif';
    ctx.fillText(cache ? '昨日暂无人上榜' : '加载中…', VIEW_W / 2, VIEW_H / 2);
    return;
  }

  const x = 28;
  const w = VIEW_W - 56;
  const rh = 56;
  const top = 120;
  const rendered = rows.slice(0, 12);
  rendered.forEach((row, i) => {
    const y = top + i * (rh + 6);
    const rankColor = i === 0 ? '#ffd23c' : i === 1 ? '#cfd6e0' : i === 2 ? '#d9925a' : '#8a92a8';
    drawEntryRow(ctx, x, y, w, rh, {
      placeText: `${row.place ?? i + 1}`,
      placeColor: rankColor,
      name: row.name,
      level: row.level,
      avatarId: row.avatarId,
      me: row.me,
    });
  });

  // 未上榜（或自己排名不在可见列表内）：底部固定展示当前用户成绩，并提示「未上榜」。
  const self = cache?.self;
  const meVisible = rendered.some((r) => r.me);
  if (self && !meVisible) {
    const cardY = bottomCardY(rh);
    // 分隔标签
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8a92a8';
    ctx.font = '13px "PingFang SC", sans-serif';
    ctx.fillText('— 我的成绩 —', VIEW_W / 2, cardY - 16);
    drawEntryRow(ctx, x, cardY, w, rh, {
      placeText: self.unranked ? '—' : `${self.place ?? '—'}`,
      placeColor: '#8a92a8',
      name: self.name,
      level: self.level,
      avatarId: self.avatarId,
      me: true,
      tag: self.unranked ? '未上榜' : undefined,
    });
  }
}

/** 底部固定卡片的 y 坐标（贴近页面底部，留出安全边距）。 */
function bottomCardY(rh: number): number {
  return VIEW_H - rh - 30;
}

/** 绘制一行榜单卡片（名次 + 头像 + 名字/境界 + Lv）。tag 存在时在境界后追加橙色提示（如「未上榜」）。 */
function drawEntryRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  rh: number,
  opts: {
    placeText: string;
    placeColor: string;
    name: string;
    level: number;
    avatarId: string;
    me: boolean;
    tag?: string;
  },
): void {
  roundRect(ctx, x, y, w, rh, 10);
  ctx.fillStyle = opts.me ? '#3a4e78' : '#2a3048';
  ctx.fill();
  if (opts.me) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffd76a';
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.placeColor;
  ctx.font = 'bold 22px "PingFang SC", sans-serif';
  ctx.fillText(opts.placeText, x + 30, y + rh / 2);

  const avDef = avatarById(opts.avatarId);
  const spr = avDef ? sprite(avDef.art as never) : null;
  const ax = x + 58;
  const aw = 40;
  roundRect(ctx, ax, y + (rh - aw) / 2, aw, aw, 8);
  ctx.fillStyle = '#3a3048';
  ctx.fill();
  if (spr) {
    const sc = Math.min((aw - 4) / spr.width, (aw - 4) / spr.height);
    ctx.drawImage(
      spr,
      ax + (aw - spr.width * sc) / 2,
      y + (rh - spr.height * sc) / 2,
      spr.width * sc,
      spr.height * sc,
    );
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = opts.me ? '#ffe9a8' : '#e8ecf8';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(opts.name, ax + aw + 12, y + rh / 2 - 8);
  // 第二行：境界名；若有 tag（未上榜）在其后追加橙色提示
  const line2X = ax + aw + 12;
  const line2Y = y + rh / 2 + 12;
  ctx.fillStyle = '#a8b0c8';
  ctx.font = '14px "PingFang SC", sans-serif';
  const rn = rankName(opts.level);
  ctx.fillText(rn, line2X, line2Y);
  if (opts.tag) {
    const rnW = ctx.measureText(rn).width;
    ctx.fillStyle = '#ff9a5a';
    ctx.fillText(`· ${opts.tag}`, line2X + rnW + 6, line2Y);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd76a';
  ctx.font = 'bold 18px "PingFang SC", sans-serif';
  ctx.fillText(`Lv.${opts.level}`, x + w - 16, y + rh / 2);
}
