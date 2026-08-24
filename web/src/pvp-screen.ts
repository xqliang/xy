// PvP 匹配/等待界面：搜索标题 + 2 分钟倒计时环 + 退出匹配；邀请模式额外画分享链接与复制按钮。纯渲染 + 命中。
import { VIEW_W, VIEW_H } from './render';
import { drawInkActionButton } from './menu-ui';
import { isWeChat } from './platform';

// PvP 匹配视图状态：外部（pvp-match 等逻辑层）把当前态灌进来，本文件只负责把它画出来并做命中检测。
export interface PvpMatchingView {
  mode: 'random' | 'invite' | 'join'; // random=随机匹配，invite=我发起邀请，join=我通过链接加入
  phase: 'queuing' | 'inviting' | 'matched' | 'failed'; // 当前阶段
  remainMs: number; // 剩余匹配时间（毫秒），用于驱动倒计时环与文字
  opponent: { nickname: string | null; avatarId: string; rankLevel: number } | null; // 匹配到的对手（matched 阶段有值）
  code: string | null; // 房号（invite 模式展示的随机唯一地址；分享链接由 versusShareLink 客户端构造）
  copied: boolean; // 链接是否已复制（影响复制按钮文案）
  message: string; // 失败提示文案
}

// 各按钮命中矩形：居中排布，宽度统一 180。
export const EXIT_RECT = { x: VIEW_W / 2 - 90, y: 820, w: 180, h: 52 }; // 退出匹配按钮
export const COPY_RECT = { x: VIEW_W / 2 - 90, y: 585, w: 180, h: 46 }; // 邀请模式下复制链接按钮（下移给房号腾位）
export const FAIL_OK_RECT = { x: VIEW_W / 2 - 90, y: 560, w: 180, h: 52 }; // 失败态确认按钮
// 倒计时环圆心与半径
const RING_C = { x: VIEW_W / 2, y: 360, r: 110 };
const MATCH_TIMEOUT_MS = 120_000; // 匹配总时长 2 分钟，环以此为满刻度

export type PvpMatchingHit = 'exit' | 'copy' | 'ok' | null;

// 点是否落在矩形内（含边界）。
function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// 命中检测：根据当前视图态决定哪个按钮可点。failed 阶段只有确认；邀请模式额外可点复制；其余阶段只有退出。
export function pvpMatchingHitAt(x: number, y: number, view: PvpMatchingView): PvpMatchingHit {
  if (view.phase === 'failed') return inRect(x, y, FAIL_OK_RECT) ? 'ok' : null;
  if (view.mode === 'invite' && view.code && inRect(x, y, COPY_RECT)) return 'copy';
  if (inRect(x, y, EXIT_RECT)) return 'exit';
  return null;
}

// 剩余时间格式化为 mm:ss。
function fmtRemain(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function drawPvpMatching(ctx: CanvasRenderingContext2D, view: PvpMatchingView): void {
  // 米色底铺满整个视图。
  ctx.fillStyle = '#efe3c6';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 失败态：画提示消息 + 确认按钮后直接返回。
  if (view.phase === 'failed') {
    ctx.fillStyle = '#5a3a12';
    ctx.font = 'bold 22px "PingFang SC", serif';
    ctx.fillText(view.message || '未匹配到对手', VIEW_W / 2, 380);
    drawInkActionButton(ctx, FAIL_OK_RECT, '确认', false, 'primary');
    return;
  }

  // 顶部搜索标题：邀请态提示等好友，其余态提示匹配中。
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 24px "PingFang SC", serif';
  ctx.fillText(view.mode === 'invite' ? '等待好友加入…' : '正在匹配对手…', VIEW_W / 2, 150);

  // 倒计时环：先画浅色底环，再按剩余比例画橙色进度弧（从 12 点方向顺时针递减）。
  const frac = Math.max(0, Math.min(1, view.remainMs / MATCH_TIMEOUT_MS));
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(90,58,18,0.18)';
  ctx.beginPath(); ctx.arc(RING_C.x, RING_C.y, RING_C.r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#b3541e';
  ctx.beginPath(); ctx.arc(RING_C.x, RING_C.y, RING_C.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
  // 环中央显示剩余时间。
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 30px "PingFang SC", serif';
  ctx.fillText(fmtRemain(view.remainMs), RING_C.x, RING_C.y);

  // matched 阶段在环下提示已匹配到谁。
  if (view.phase === 'matched' && view.opponent) {
    ctx.font = '18px "PingFang SC", serif';
    ctx.fillText(`已匹配到对手：${view.opponent.nickname ?? '无名侠'}`, VIEW_W / 2, RING_C.y + RING_C.r + 40);
  }

  // 邀请模式（未匹配时）：网页复制邀请链接 / 小游戏原生分享给好友。均不需房号手输——好友打开链接或点分享卡片即加入。
  if (view.mode === 'invite' && view.code && view.phase !== 'matched') {
    ctx.fillStyle = '#6a4a1a';
    ctx.font = '15px "PingFang SC", serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      isWeChat ? '点下方「分享给好友」，对方点开卡片即加入' : '把邀请链接发给好友，对方打开即加入',
      VIEW_W / 2,
      540,
    );
    const label = isWeChat
      ? (view.copied ? '已分享 ✓' : '分享给好友')
      : (view.copied ? '已复制链接 ✓' : '复制邀请链接');
    drawInkActionButton(ctx, COPY_RECT, label, false, 'secondary');
  }

  // 底部退出按钮：所有非失败阶段都有。
  drawInkActionButton(ctx, EXIT_RECT, '退出匹配', false, 'secondary');
}

/**
 * 客户端构造邀请深链：用 location.origin + location.pathname 自适应部署子路径（如 /xy），
 * 避免服务端按 Origin 派生的根路径链在子路径部署下丢掉 /xy（好友打开即 404/白屏）。
 * 深链解析走 ?versus=<code>（与路径无关），故只要路径对即可加入。location 不可用时降级为相对链（测试/SSR）。
 */
export function versusShareLink(code: string): string {
  const loc = typeof location !== 'undefined' ? location : { origin: '', pathname: '/' };
  return loc.origin + loc.pathname + '?versus=' + encodeURIComponent(code);
}
