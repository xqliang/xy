// PvP 匹配/等待界面：背景图（pvp-bg，Seedream 生成）+ 匹配中雷达扫描动画 + 匹配成功对阵卡动画；
// 邀请模式额外画分享链接与复制按钮。纯渲染 + 命中。
import { VIEW_W, VIEW_H } from './render';
import { drawInkActionButton } from './menu-ui';
import { isWeChat } from './platform';
import { sprite } from './assets';
import { avatarById } from './avatar-catalog';
import { rankName } from './rank';

// PvP 匹配视图状态：外部（pvp-match 等逻辑层）把当前态灌进来，本文件只负责把它画出来并做命中检测。
export interface PvpMatchingView {
  mode: 'random' | 'invite' | 'join'; // random=随机匹配，invite=我发起邀请，join=我通过链接加入
  phase: 'queuing' | 'inviting' | 'matched' | 'failed'; // 当前阶段
  remainMs: number; // 剩余匹配时间（毫秒），用于驱动倒计时环与文字
  opponent: { nickname: string | null; avatarId: string; rankLevel: number } | null; // 匹配到的对手（matched 阶段有值）
  code: string | null; // 房号（invite 模式展示的随机唯一地址；分享链接由 versusShareLink 客户端构造）
  copied: boolean; // 链接是否已复制（影响复制按钮文案）
  message: string; // 失败提示文案
  /** 本方档案（matched 对阵卡左侧）：昵称/头像/段位。由 main.ts 从 profile+rank 灌入 */
  me?: { nickname: string | null; avatarId: string; rankLevel: number };
  /** 进入 matched 的时刻（performance.now 时基，ms）——驱动「匹配成功」动画进度；缺省视为动画已播完 */
  matchedAtMs?: number;
}

// 各按钮命中矩形：居中排布，宽度统一 180。
export const EXIT_RECT = { x: VIEW_W / 2 - 90, y: 820, w: 180, h: 52 }; // 退出匹配按钮
export const COPY_RECT = { x: VIEW_W / 2 - 90, y: 585, w: 180, h: 46 }; // 邀请模式下复制链接按钮（下移给房号腾位）
export const FAIL_OK_RECT = { x: VIEW_W / 2 - 90, y: 560, w: 180, h: 52 }; // 失败态确认按钮
// 倒计时环圆心与半径
const RING_C = { x: VIEW_W / 2, y: 360, r: 110 };
const MATCH_TIMEOUT_MS = 120_000; // 匹配总时长 2 分钟，环以此为满刻度
/** 匹配成功动画总时长：滑入/弹入播完后才由 main.ts 真正开局切战斗屏 */
export const MATCHED_SHOW_MS = 2_600;

export type PvpMatchingHit = 'exit' | 'copy' | 'ok' | null;

// 点是否落在矩形内（含边界）。
function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// 命中检测：根据当前视图态决定哪个按钮可点。failed 阶段只有确认；邀请模式额外可点复制；matched 阶段动画期间无按钮。
export function pvpMatchingHitAt(x: number, y: number, view: PvpMatchingView): PvpMatchingHit {
  if (view.phase === 'failed') return inRect(x, y, FAIL_OK_RECT) ? 'ok' : null;
  if (view.phase === 'matched') return null; // 匹配成功动画期间不可退出（马上自动开局）
  if (view.mode === 'invite' && view.code && inRect(x, y, COPY_RECT)) return 'copy';
  if (inRect(x, y, EXIT_RECT)) return 'exit';
  return null;
}

// 剩余时间格式化为 mm:ss。
function fmtRemain(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 缓动：出场后段减速（滑入用）
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
// 缓动：过冲回弹（VS 弹入用）
const easeOutBack = (t: number) => { const c = 1.70158; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
// 把 v 限制在 [lo, hi]。
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 圆形头像：按 cover 裁剪画进圆框（金边 + 深底）。art 为 assets sprite key；素材缺失画首字占位。 */
function drawAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, avatarId: string, fallbackChar: string): void {
  ctx.save();
  // 深色圆底：头像图未加载/裁剪不满时兜底
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#6b4a20';
  ctx.fill();
  const img = sprite(avatarById(avatarId)?.art || 'hero-wukong');
  if (img && img.naturalWidth) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    // 裁剪取景：按宽撑满再放大 1.6 倍，让「脸部中心」（国风全身立绘约在图高 22% 处）对准圆心。
    // 只按宽撑满（旧版）时 2r 窗口仅占图高 ~70% 且起点在 18%，脸会贴在框顶显得人像吊在上面不居中。
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const ZOOM = 1.6;
    const s = (r * 2 * ZOOM) / iw; // 宽放大撑满（ZOOM 倍）
    const dh = ih * s;
    let top = dh * 0.22 - r; // 显示窗口顶部在图内的位置（把脸拉到圆心）
    top = Math.max(0, Math.min(dh - r * 2, top)); // 夹在图内，避免上溢/下溢
    ctx.drawImage(img, cx - r, cy - r - top, r * 2, dh);
    ctx.restore();
  } else {
    // 占位：头像名首字
    ctx.fillStyle = '#ffe9b8';
    ctx.font = `bold ${Math.round(r)}px "PingFang SC", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fallbackChar, cx, cy + 1);
  }
  // 金色圆框收边
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.strokeStyle = '#d8a018';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** 一侧对阵卡：头像 + 昵称 + 段位（等级）称号。cardX 是卡片中心。 */
function drawMatchCard(
  ctx: CanvasRenderingContext2D,
  cardX: number, cy: number,
  p: { nickname: string | null; avatarId: string; rankLevel: number },
  fallbackName: string,
): void {
  const r = 46;
  drawAvatar(ctx, cardX, cy - 30, r, p.avatarId, (p.nickname ?? fallbackName).slice(0, 1));
  // 昵称（超长截断，防两侧卡片重叠）
  ctx.fillStyle = '#4a3010';
  ctx.font = 'bold 20px "PingFang SC", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const nick = p.nickname ?? fallbackName;
  ctx.fillText(nick.length > 6 ? nick.slice(0, 6) + '…' : nick, cardX, cy + 38);
  // 段位（等级）：金底徽章小字
  ctx.fillStyle = '#8a5a14';
  ctx.font = '15px "PingFang SC", serif';
  ctx.fillText(`Lv.${p.rankLevel} ${rankName(p.rankLevel)}`, cardX, cy + 66);
}

export function drawPvpMatching(ctx: CanvasRenderingContext2D, view: PvpMatchingView): void {
  // 背景：Seedream 生成的云海仙山对战背景（824×1536，与视口同比例直接铺满）；
  // 未加载时回退米色平涂。上沿加轻微暗化渐晕，让顶部标题文字更清楚。
  const bg = sprite('pvp-bg');
  if (bg && bg.naturalWidth) {
    ctx.drawImage(bg, 0, 0, VIEW_W, VIEW_H);
    const dim = ctx.createLinearGradient(0, 0, 0, 200);
    dim.addColorStop(0, 'rgba(60,42,20,0.30)');
    dim.addColorStop(1, 'rgba(60,42,20,0)');
    ctx.fillStyle = dim;
    ctx.fillRect(0, 0, VIEW_W, 200);
  } else {
    ctx.fillStyle = '#efe3c6';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 动画统一时基：渲染层直接取本机时钟（逻辑层不注入，保持纯渲染文件无副作用）
  const now = performance.now();

  // 失败态：画提示消息 + 确认按钮后直接返回。
  if (view.phase === 'failed') {
    ctx.fillStyle = '#5a3a12';
    ctx.font = 'bold 22px "PingFang SC", serif';
    ctx.fillText(view.message || '未匹配到对手', VIEW_W / 2, 380);
    drawInkActionButton(ctx, FAIL_OK_RECT, '确认', false, 'primary');
    return;
  }

  // —— 匹配成功对阵卡（matched）：两侧头像卡滑入 + VS 弹入 + 金字淡入，播完由 main.ts 开局 ——
  if (view.phase === 'matched' && view.opponent) {
    const t = view.matchedAtMs != null ? now - view.matchedAtMs : MATCHED_SHOW_MS; // 缺省视为动画已播完（测试/旧调用）
    const slide = easeOutCubic(clamp01(t / 600));            // 头像卡滑入 0..600ms
    const vsPop = easeOutBack(clamp01((t - 260) / 500));     // VS 弹入 260..760ms（过冲回弹）
    const banner = clamp01((t - 650) / 400);                 // 「匹配成功」金字淡入 650..1050ms
    const cy = 400;
    const finalGap = 150; // 两卡中心到画面中心的最终间距
    // 从画面外两侧（左 -120 / 右 VIEW_W+120）滑到距中心 ±finalGap
    const leftX = (-120) + (VIEW_W / 2 - finalGap - (-120)) * slide;
    const rightX = (VIEW_W + 120) - ((VIEW_W + 120) - (VIEW_W / 2 + finalGap)) * slide;
    // 我方在左、对手在右（我方档案缺失时兜底「行者」）
    drawMatchCard(ctx, leftX, cy, view.me ?? { nickname: null, avatarId: 'wukong', rankLevel: 0 }, '行者');
    drawMatchCard(ctx, rightX, cy, view.opponent, '无名侠');
    // 中央 VS：金色描边大字，弹入缩放（vsPop 从 0→1 过冲到 ~1.1 再回落）
    ctx.save();
    ctx.translate(VIEW_W / 2, cy - 26);
    ctx.scale(Math.max(0.01, vsPop), Math.max(0.01, vsPop));
    ctx.font = 'bold 52px "PingFang SC", serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(90,30,8,0.9)';
    ctx.strokeText('VS', 0, 0);
    ctx.fillStyle = '#e0b04a';
    ctx.fillText('VS', 0, 0);
    ctx.restore();
    // 「匹配成功」金字：淡入 + 轻微上浮 + 四射金光短线
    if (banner > 0) {
      const by = 210 - 10 * banner;
      ctx.save();
      ctx.globalAlpha = banner;
      ctx.font = 'bold 34px "PingFang SC", serif';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(90,30,8,0.85)';
      ctx.strokeText('匹 配 成 功', VIEW_W / 2, by);
      ctx.fillStyle = '#ffe9b8';
      ctx.fillText('匹 配 成 功', VIEW_W / 2, by);
      // 金光短线：从字两侧斜上/斜下射出（随进度伸长）
      ctx.strokeStyle = '#e0b04a';
      ctx.lineWidth = 3;
      const L = 46 * banner;
      ctx.beginPath(); ctx.moveTo(VIEW_W / 2 - 130, by); ctx.lineTo(VIEW_W / 2 - 130 - L, by - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(VIEW_W / 2 + 130, by); ctx.lineTo(VIEW_W / 2 + 130 + L, by - 12); ctx.stroke();
      ctx.restore();
    }
    // 底部提示：即将进入对战
    if (banner > 0) {
      ctx.save();
      ctx.globalAlpha = banner;
      ctx.fillStyle = '#6a4a1a';
      ctx.font = '16px "PingFang SC", serif';
      ctx.fillText('即将进入对战…', VIEW_W / 2, cy + 150);
      ctx.restore();
    }
    return;
  }

  // —— 匹配中（queuing/join）或等待好友（invite）——
  // 顶部标题：米金字 + 深棕描边（云海背景上可读，也更有仙气；纯深棕字压暗底显生硬），
  // 状态点放文字右侧留出安全间距（标题 6 字 bold 26px 半宽约 80，点从 +100 起才不叠字）
  const title = view.mode === 'invite' ? '等待好友加入' : '正在匹配对手';
  ctx.font = 'bold 26px "PingFang SC", "STKaiti", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = 'rgba(70,42,14,0.9)';
  ctx.strokeText(title, VIEW_W / 2 - 18, 130); // 中心左移 18px 给右侧状态点让位
  ctx.fillStyle = '#ffe9b8';
  ctx.fillText(title, VIEW_W / 2 - 18, 130);
  const dotT = (now % 1400) / 1400; // 三点呼吸周期 1.4s
  for (let i = 0; i < 3; i++) {
    // 每点错相 1/3 周期：正弦亮度 0.25..1
    const ph = dotT - i / 3;
    const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(ph * Math.PI * 2));
    ctx.fillStyle = `rgba(224,176,74,${a.toFixed(3)})`; // 金色点（原橙棕太突兀，与金字同系）
    ctx.beginPath();
    ctx.arc(VIEW_W / 2 + 92 + i * 17, 132, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 倒计时环：先画浅色底环，再按剩余比例画橙色进度弧（从 12 点方向顺时针递减）。
  const frac = Math.max(0, Math.min(1, view.remainMs / MATCH_TIMEOUT_MS));
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(90,58,18,0.18)';
  ctx.beginPath(); ctx.arc(RING_C.x, RING_C.y, RING_C.r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#b3541e';
  ctx.beginPath(); ctx.arc(RING_C.x, RING_C.y, RING_C.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
  // 雷达扫描弧：环内旋转的橙色扇形渐变（只在搜索中显示），示意「正在搜索对手」
  if (view.phase === 'queuing' || view.phase === 'inviting') {
    const sweep = (now / 1600) % 1 * Math.PI * 2; // 1.6s 一圈
    const rIn = RING_C.r - 26;
    const grad = ctx.createRadialGradient(RING_C.x, RING_C.y, rIn * 0.2, RING_C.x, RING_C.y, RING_C.r - 8);
    grad.addColorStop(0, 'rgba(179,84,30,0)');
    grad.addColorStop(1, 'rgba(179,84,30,0.30)');
    ctx.save();
    ctx.beginPath(); ctx.moveTo(RING_C.x, RING_C.y);
    ctx.arc(RING_C.x, RING_C.y, RING_C.r - 8, sweep - 0.7, sweep);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
  // 环中央显示剩余时间。
  ctx.fillStyle = '#5a3a12';
  ctx.font = 'bold 30px "PingFang SC", serif';
  ctx.fillText(fmtRemain(view.remainMs), RING_C.x, RING_C.y);
  // 环下小字：随机匹配的搜索语（invite 模式画分享 UI，不重复占位）
  if (view.mode !== 'invite') {
    ctx.fillStyle = '#6a4a1a';
    ctx.font = '16px "PingFang SC", serif';
    ctx.fillText('正在为你寻找实力相近的对手…', VIEW_W / 2, RING_C.y + RING_C.r + 40);
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

  // 底部退出按钮：所有非失败、非 matched 阶段都有。
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
