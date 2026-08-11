// 首页「操作说明」弹窗：水墨卷轴风，分区短文 + 可滚动，面向新手。
import { VIEW_W, VIEW_H } from './render';
import { drawInkPopupFrame, inkPopupCloseRect, roundRect } from './menu-ui';
import { STAMINA_COST } from './stamina';
import { MAX_EQUIPPED_ACTIVES } from './actives';
import { MAX_EQUIPPED_PASSIVES } from './passives';

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const HELP_PW = 440;
const HELP_PH = 640;
const HELP_PX = (VIEW_W - HELP_PW) / 2;
const HELP_PY = (VIEW_H - HELP_PH) / 2;
const HELP_PAD = 22;
const HELP_CLOSE = inkPopupCloseRect(HELP_PX, HELP_PY);
const HELP_BODY_TOP = HELP_PY + 58;
const HELP_BODY_BOTTOM = HELP_PY + HELP_PH - 18;
const HELP_VIEW_H = HELP_BODY_BOTTOM - HELP_BODY_TOP;
const HELP_TEXT_W = HELP_PW - HELP_PAD * 2;

type HelpBlock =
  | { kind: 'title'; text: string }
  | { kind: 'body'; text: string }
  | { kind: 'step'; n: number; text: string }
  | { kind: 'link'; id: HelpLinkId; text: string }
  | { kind: 'gap'; h: number };

/** 说明内跳转目标：图鉴 Tab / 神兵背包 */
export type HelpLinkId = 'codex-unit' | 'codex-hero' | 'codex-monster' | 'codex-skill' | 'bag' | 'stamina';

/** 新手操作说明正文（固定文案，便于排版与单测） */
export const HELP_BLOCKS: HelpBlock[] = [
  { kind: 'title', text: '游戏目标' },
  {
    kind: 'body',
    text: '地图分为上下两半：你守护下半场唐僧，上半场是对称的 AI 对手。妖怪沿路推进，别让它们撞上唐僧——任一方唐僧倒下，本局结束。',
  },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '三步上手' },
  { kind: 'step', n: 1, text: '点「征兵」花蟠桃，下方候选区会出现兵、铲子或武将字牌。' },
  { kind: 'step', n: 2, text: '把它们拖到棋盘绿色格子上摆好。铲子拖到未开垦格，可开辟新阵位。' },
  { kind: 'step', n: 3, text: '同种类、同等级的两个兵叠在一起或拖到一起，即可合成升阶（最高 5 阶）。' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '常用操作' },
  {
    kind: 'body',
    text: '· 拖：候选区 → 棋盘摆放；棋盘上拖动可换位或合成；拖回空候选格可收回。',
  },
  {
    kind: 'body',
    text: '· 「布阵」：一键把候选区自动摆到合适位置，省去逐个拖放。建议先点布阵，再手动微调站位与合成。',
  },
  { kind: 'body', text: '· 轻点单位 / 妖怪 / 唐僧：查看信息与攻击范围。' },
  { kind: 'body', text: '· 主动技能：征兵旁的技能按钮，冷却好了再点即可释放。' },
  { kind: 'body', text: '· 左上角暂停：可继续或终止本局（终止不保留进度）。' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '兵器' },
  {
    kind: 'body',
    text: '征兵得到的兵就是兵器：棍猴（刀）、枪天兵（枪）、天马骑兵（骑）、神箭手（弓）。它们是守路的主力，摆在妖怪必经之路上持续输出。',
  },
  {
    kind: 'body',
    text: '同种类、同等级可合成升阶（最高 5 阶），阶越高越强。铲子用来开垦未解锁格子，扩充可摆阵位。',
  },
  { kind: 'link', id: 'codex-unit', text: '打开兵器图鉴 ›' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '武将（英雄）' },
  {
    kind: 'body',
    text: '征兵有时会出武将字牌。把同一武将的两个字左右紧邻摆放，就会金框激活，成为场上强力单位，并自带技能。悟空（大圣）在场时，还能触发羁绊给全队增伤。',
  },
  {
    kind: 'body',
    text: '武将分满 3 与满 5：满 3 是前期过渡将，更容易抽到，最高升到 3 阶；满 5 是核心主将，更强但更稀有，最高可升到 5 阶。',
  },
  {
    kind: 'body',
    text: '同门派共享一字（如「郎」）。可先练满 3 过渡将拉高字牌阶，再换成同门派满 5 主将——激活时两边字牌会按较高阶对齐继承（只升不降，受该武将满级封顶）。',
  },
  {
    kind: 'body',
    text: '· 输出：主力伤害（大圣、哪吒、二郎等）',
  },
  {
    kind: 'body',
    text: '· 控制：定身、击退等控场（八戒、牛魔、铁扇等）',
  },
  {
    kind: 'body',
    text: '· 辅助：续命减速（观音）、炼丹加攻（老君）、缩短友军大招冷却（文殊）等。',
  },
  {
    kind: 'body',
    text: '· 过渡：同门派的满 3 弱将，前期先用，后期交给满 5 主将继承等级。',
  },
  {
    kind: 'body',
    text: '点选武将可看攻击范围与大招 CD：范围环是普攻与对怪大招共用的射程；多数大招需圈内有怪才放，老君/文殊的友军大招只需 CD 就绪。',
  },
  {
    kind: 'body',
    text: '武将还可靠输出、技能与喂同将字牌在局内升阶；拆开双字或中间隔空会失效。',
  },
  { kind: 'link', id: 'codex-hero', text: '打开英雄图鉴 ›' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '神兵（武器）' },
  {
    kind: 'body',
    text: '每位武将有一件专属神兵。对局中武将攻击有机会掉落碎片，集齐后激活；重复获得可提升品质（白→金），提供攻击、攻速或范围加成。',
  },
  {
    kind: 'body',
    text: '在首页「神兵背包」装备神兵（最多 3 件），下一局开局即生效。未装备的神兵不会带入对局。',
  },
  { kind: 'link', id: 'bag', text: '打开神兵背包 ›' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '主动与被动技能' },
  {
    kind: 'body',
    text: '每局战斗结算回到首页后，神秘商人会自动出现一次（关闭后本局不再有入口，需再打一局才会再来）。用结算获得的功德购买并装配技能，开局带入本局。',
  },
  {
    kind: 'body',
    text: '购买按自然日重置：跨天后拥有与装配都会清空，需重新购买。今日买过的可在本页卸下/再装备，不扣功德。',
  },
  {
    kind: 'body',
    text: `· 主动技能：战斗中手动释放，冷却好了再点。征兵旁最多装备 ${MAX_EQUIPPED_ACTIVES} 个，例如如来神掌退敌、仙丹/风火轮短时强化、冰封定身等。`,
  },
  {
    kind: 'body',
    text: `· 被动技能：整场自动生效，无需点击。最多装备 ${MAX_EQUIPPED_PASSIVES} 个，例如蟠桃园产桃、聚宝盆击杀多桃、护身金光加唐僧血量、招贤榜提高字牌掉率等。`,
  },
  {
    kind: 'body',
    text: '技能图鉴可查看并管理今日装配（卸下/重装）；本页不能购买，只有神秘商人出现时才能买。',
  },
  { kind: 'link', id: 'codex-skill', text: '打开技能图鉴 ›' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '蟠桃从哪来' },
  {
    kind: 'body',
    text: '击杀妖怪得蟠桃；唐僧掉血也会补偿一些。装备被动技能后还能额外产桃，例如「蟠桃园」自动种桃树、「聚宝盆」击杀多给、「摸金校尉」挖地额外得桃等。',
  },
  {
    kind: 'body',
    text: '征兵费用会越来越高，记得边打边合、把兵摆在妖怪必经之路上。',
  },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '体力' },
  {
    kind: 'body',
    text: `开始游戏消耗 ${STAMINA_COST} 点体力。体力不足时，可点顶栏「+」看广告或分享好友补充；未满时也会随时间自动恢复。`,
  },
  { kind: 'link', id: 'stamina', text: '获取体力 ›' },
  { kind: 'gap', h: 14 },

  { kind: 'title', text: '局外成长' },
  { kind: 'body', text: '· 结算获得功德；回首页时神秘商人自动出现，可购买并装配今日主动 / 被动技能。' },
  { kind: 'body', text: '· 勾选「无尽模式」可挑战不限波次、难度渐增的持久战。' },
  { kind: 'gap', h: 10 },

  { kind: 'title', text: '相关页面' },
  { kind: 'link', id: 'codex-unit', text: '兵器图鉴 ›' },
  { kind: 'link', id: 'codex-hero', text: '英雄图鉴 ›' },
  { kind: 'link', id: 'bag', text: '神兵背包 ›' },
  { kind: 'link', id: 'codex-monster', text: '妖怪图鉴 ›' },
  { kind: 'link', id: 'codex-skill', text: '技能图鉴 ›' },
  { kind: 'link', id: 'stamina', text: '获取体力 ›' },
];

type LaidLine =
  | { kind: 'title'; text: string; y: number }
  | { kind: 'body'; text: string; y: number }
  | { kind: 'step'; n: number; text: string; y: number }
  | { kind: 'link'; id: HelpLinkId; text: string; y: number; textW: number };

// 不做跨帧缓存：若首次测量时自定义字体尚未加载完成，缓存会永久锁死一份用回退字体量出的
// 错误高度，导致后续可视区与实际渲染错位、滚到底也显示不全（"滚不动"）。文案是静态的一小段
// 文本，每次重排的开销可忽略，直接按当前 ctx 字体状态重新量取即可保证与实际渲染一致。
function measureLayout(ctx: CanvasRenderingContext2D): { lines: LaidLine[]; contentH: number } {
  const lines: LaidLine[] = [];
  let y = 0;
  const titleLh = 28;
  const bodyLh = 22;
  const stepLh = 22;
  const linkLh = 26;

  for (const block of HELP_BLOCKS) {
    if (block.kind === 'gap') {
      y += block.h;
      continue;
    }
    if (block.kind === 'title') {
      lines.push({ kind: 'title', text: block.text, y });
      y += titleLh + 4;
      continue;
    }
    if (block.kind === 'link') {
      ctx.font = 'bold 14px "PingFang SC", serif';
      const textW = ctx.measureText(block.text).width;
      lines.push({ kind: 'link', id: block.id, text: block.text, y, textW });
      y += linkLh;
      continue;
    }
    if (block.kind === 'step') {
      ctx.font = '14px "PingFang SC", serif';
      const indent = 28;
      const wrapped = wrapText(ctx, block.text, HELP_TEXT_W - indent);
      for (let i = 0; i < wrapped.length; i++) {
        lines.push({
          kind: 'step',
          n: i === 0 ? block.n : 0,
          text: wrapped[i]!,
          y,
        });
        y += stepLh;
      }
      y += 6;
      continue;
    }
    ctx.font = '14px "PingFang SC", serif';
    const wrapped = wrapText(ctx, block.text, HELP_TEXT_W);
    for (const ln of wrapped) {
      lines.push({ kind: 'body', text: ln, y });
      y += bodyLh;
    }
    y += 4;
  }

  return { lines, contentH: y + 8 };
}

export function helpContentHeight(ctx: CanvasRenderingContext2D): number {
  return measureLayout(ctx).contentH;
}

export function helpMaxScroll(ctx: CanvasRenderingContext2D): number {
  return Math.max(0, helpContentHeight(ctx) - HELP_VIEW_H);
}

export function helpPopupBounds(): { x: number; y: number; w: number; h: number } {
  return { x: HELP_PX, y: HELP_PY, w: HELP_PW, h: HELP_PH };
}

export function helpScrollArea(): { x: number; y: number; w: number; h: number } {
  return {
    x: HELP_PX + HELP_PAD,
    y: HELP_BODY_TOP,
    w: HELP_TEXT_W,
    h: HELP_VIEW_H,
  };
}

export type HelpPopupHit =
  | { kind: 'close' }
  | { kind: 'scroll' }
  | { kind: 'link'; id: HelpLinkId }
  | null;

function linkHitRect(
  ln: Extract<LaidLine, { kind: 'link' }>,
  scrollY: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = HELP_PX + HELP_PAD;
  const drawY = HELP_BODY_TOP + ln.y - scrollY;
  return { x: x0 - 4, y: drawY - 4, w: Math.min(HELP_TEXT_W + 8, ln.textW + 16), h: 28 };
}

export function helpPopupHitAt(x: number, y: number, scrollY = 0, ctx?: CanvasRenderingContext2D): HelpPopupHit {
  if (inRect(x, y, HELP_CLOSE)) return { kind: 'close' };
  if (x < HELP_PX || x > HELP_PX + HELP_PW || y < HELP_PY || y > HELP_PY + HELP_PH) {
    return { kind: 'close' };
  }
  // 内容区内优先检测链接（需已布局）
  if (ctx && y >= HELP_BODY_TOP && y <= HELP_BODY_BOTTOM) {
    const layout = measureLayout(ctx);
    const maxScroll = Math.max(0, layout.contentH - HELP_VIEW_H);
    const sy = Math.max(0, Math.min(maxScroll, scrollY));
    for (const ln of layout.lines) {
      if (ln.kind !== 'link') continue;
      const r = linkHitRect(ln, sy);
      if (r.y + r.h < HELP_BODY_TOP || r.y > HELP_BODY_BOTTOM) continue;
      if (inRect(x, y, r)) return { kind: 'link', id: ln.id };
    }
  }
  return { kind: 'scroll' };
}

function drawScrollTrack(ctx: CanvasRenderingContext2D, scrollY: number, maxScroll: number): void {
  if (maxScroll <= 0) return;
  const trackX = HELP_PX + HELP_PW - 10;
  const trackY = HELP_BODY_TOP + 4;
  const trackH = HELP_VIEW_H - 8;
  const thumbH = Math.max(28, (HELP_VIEW_H / (HELP_VIEW_H + maxScroll)) * trackH);
  const thumbY = trackY + (scrollY / maxScroll) * (trackH - thumbH);
  ctx.fillStyle = 'rgba(90,60,30,0.18)';
  roundRect(ctx, trackX, trackY, 4, trackH, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(138,64,32,0.55)';
  roundRect(ctx, trackX, thumbY, 4, thumbH, 2);
  ctx.fill();
}

export function drawHelpPopup(ctx: CanvasRenderingContext2D, scrollY: number): void {
  drawInkPopupFrame(ctx, HELP_PX, HELP_PY, HELP_PW, HELP_PH, '操作说明', HELP_CLOSE);
  const layout = measureLayout(ctx);
  const maxScroll = Math.max(0, layout.contentH - HELP_VIEW_H);
  const sy = Math.max(0, Math.min(maxScroll, scrollY));

  ctx.save();
  ctx.beginPath();
  ctx.rect(HELP_PX + 10, HELP_BODY_TOP, HELP_PW - 20, HELP_VIEW_H);
  ctx.clip();

  const x0 = HELP_PX + HELP_PAD;
  for (const ln of layout.lines) {
    const drawY = HELP_BODY_TOP + ln.y - sy;
    if (drawY + 28 < HELP_BODY_TOP || drawY > HELP_BODY_BOTTOM) continue;

    if (ln.kind === 'title') {
      // 小节标题左侧朱红短竖
      ctx.fillStyle = '#8a4020';
      roundRect(ctx, x0, drawY + 4, 4, 16, 2);
      ctx.fill();
      ctx.fillStyle = '#5a3a12';
      ctx.font = 'bold 16px "PingFang SC", "STKaiti", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(ln.text, x0 + 12, drawY + 2);
      continue;
    }

    if (ln.kind === 'step') {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (ln.n > 0) {
        const badge = { x: x0, y: drawY + 1, w: 18, h: 18 };
        roundRect(ctx, badge.x, badge.y, badge.w, badge.h, 9);
        ctx.fillStyle = 'rgba(180,90,70,0.85)';
        ctx.fill();
        ctx.fillStyle = '#fff8ee';
        ctx.font = 'bold 12px "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ln.n), badge.x + badge.w / 2, badge.y + badge.h / 2 + 0.5);
      }
      ctx.fillStyle = '#5a3a12';
      ctx.font = '14px "PingFang SC", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(ln.text, x0 + 28, drawY);
      continue;
    }

    if (ln.kind === 'link') {
      ctx.fillStyle = '#8a4020';
      ctx.font = 'bold 14px "PingFang SC", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(ln.text, x0, drawY);
      // 下划线提示可点
      ctx.strokeStyle = 'rgba(138,64,32,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, drawY + 16);
      ctx.lineTo(x0 + ln.textW, drawY + 16);
      ctx.stroke();
      continue;
    }

    ctx.fillStyle = '#6a4a22';
    ctx.font = '14px "PingFang SC", serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(ln.text, x0, drawY);
  }
  ctx.restore();

  // 内容区上下淡出，提示还有更多内容
  if (sy > 2) {
    const fade = ctx.createLinearGradient(0, HELP_BODY_TOP, 0, HELP_BODY_TOP + 16);
    fade.addColorStop(0, 'rgba(240,230,208,0.95)');
    fade.addColorStop(1, 'rgba(240,230,208,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(HELP_PX + 10, HELP_BODY_TOP, HELP_PW - 20, 16);
  }
  if (sy < maxScroll - 2) {
    const fade = ctx.createLinearGradient(0, HELP_BODY_BOTTOM - 16, 0, HELP_BODY_BOTTOM);
    fade.addColorStop(0, 'rgba(220,201,164,0)');
    fade.addColorStop(1, 'rgba(220,201,164,0.95)');
    ctx.fillStyle = fade;
    ctx.fillRect(HELP_PX + 10, HELP_BODY_BOTTOM - 16, HELP_PW - 20, 16);
  }

  drawScrollTrack(ctx, sy, maxScroll);
}
