// 排行榜：拉取服务端日榜；失败时提示暂不可用（不回退假 NPC）。
import { VIEW_W, VIEW_H } from './render';
import { rankName } from './rank';
import { sprite } from './assets';
import { apiFetch } from './api/client';
import { avatarById, maskUid } from './avatar-catalog';
import { ensureUserId } from './user-id';

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

interface DailyResp {
  day: string;
  entries: Array<{
    uid: string;
    name: string;
    rankLevel: number;
    avatarId: string;
    me?: boolean;
  }>;
  me: { uid: string; name: string; rankLevel: number; avatarId: string; place?: number } | null;
}

let cache: { day: string; rows: LeaderboardRow[]; error: string | null; at: number } | null = null;
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
      cache = { day: '', rows: [], error: '排行榜暂不可用', at: Date.now() };
    } else {
      const uid = ensureUserId();
      const rows: LeaderboardRow[] = res.data.entries.map((e) => ({
        name: e.name || maskUid(e.uid),
        level: e.rankLevel,
        me: !!e.me || e.uid === uid,
        avatarId: e.avatarId || 'wukong',
      }));
      if (res.data.me && !rows.some((r) => r.me)) {
        rows.push({
          name: res.data.me.name,
          level: res.data.me.rankLevel,
          me: true,
          avatarId: res.data.me.avatarId,
          place: res.data.me.place,
        });
      }
      cache = { day: res.data.day, rows, error: null, at: Date.now() };
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
  ctx.fillText('排行榜', VIEW_W / 2, 56);
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
    ctx.fillText(cache ? '今日暂无人上榜' : '加载中…', VIEW_W / 2, VIEW_H / 2);
    return;
  }

  const x = 28;
  const w = VIEW_W - 56;
  const rh = 56;
  const top = 120;
  rows.slice(0, 12).forEach((row, i) => {
    const y = top + i * (rh + 6);
    roundRect(ctx, x, y, w, rh, 10);
    ctx.fillStyle = row.me ? '#3a4e78' : '#2a3048';
    ctx.fill();
    if (row.me) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffd76a';
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rankColor = i === 0 ? '#ffd23c' : i === 1 ? '#cfd6e0' : i === 2 ? '#d9925a' : '#8a92a8';
    ctx.fillStyle = rankColor;
    ctx.font = 'bold 22px "PingFang SC", sans-serif';
    ctx.fillText(`${row.place ?? i + 1}`, x + 30, y + rh / 2);

    const avDef = avatarById(row.avatarId);
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
    ctx.fillStyle = row.me ? '#ffe9a8' : '#e8ecf8';
    ctx.font = 'bold 18px "PingFang SC", sans-serif';
    ctx.fillText(row.name, ax + aw + 12, y + rh / 2 - 8);
    ctx.fillStyle = '#a8b0c8';
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.fillText(rankName(row.level), ax + aw + 12, y + rh / 2 + 12);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd76a';
    ctx.font = 'bold 18px "PingFang SC", sans-serif';
    ctx.fillText(`Lv.${row.level}`, x + w - 16, y + rh / 2);
  });
}
