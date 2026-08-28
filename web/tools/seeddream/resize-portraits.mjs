// 按「最终显示尺寸 × 3」裁剪透明边并缩小立绘 PNG，减小 git 体积。透明通道用 canvas 保留。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = process.env.ASSET_DIR
  ? path.resolve(process.env.ASSET_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

// VIEW_W=560, VIEW_H≈1044。值为画面上最大绘制边长 × 3（cover/contain 取按钮框长边）。
const TARGET = {
  'unit-monkey.png': 165, // CELL*0.72*1.06*3 ≈ 155
  'unit-archer.png': 172,
  'unit-spear.png': 168,
  'unit-cavalry.png': 180,
  'tangseng.png': 192,
  'loading-tangseng.png': 360, // 加载页唐僧骑马行走：画面上约 120px 高 ×3
  'item-shovel.png': 180,
  'monster-boss.png': 210,
  'monster-boss-baiguling.png': 210,
  'monster-boss-huoyanshan.png': 210,
  'monster-boss-liushahe.png': 210,
  'monster-boss-pansidong.png': 210,
  'monster-boss-huangfengling.png': 210,
  'monster-minion.png': 300, // 小妖：头像卡片等高缩放需放大到 124px 高，300 源图避免糊（路径小妖绘制远小于此）
  'monster-minion-baiguling.png': 150,
  'monster-minion-huoyanshan.png': 150,
  'monster-minion-liushahe.png': 150,
  'monster-minion-pansidong.png': 150,
  'monster-minion-huangfengling.png': 150,
  'monster-cavalry-huoyanshan.png': 190,
  'monster-cavalry-liushahe.png': 190,
  'monster-cavalry-baiguling.png': 190,
  'monster-cavalry-pansidong.png': 190,
  'monster-cavalry-huangfengling.png': 190,
  'monster-miniboss-frost.png': 200,
  'monster-miniboss-blight.png': 200,
  'monster-miniboss-quake.png': 200,
  'monster-miniboss-gale.png': 200,
  'monster-miniboss-blood.png': 200,
  'monster-miniboss-lion.png': 200, // 黄狮精小 Boss：与其他小 Boss 同尺度
  'hero-ttg.png': 200, // 二郎神大招冲出咬怪的哮天犬：与小 Boss 同尺度
  // 菜单主角立绘 240×3；武将卡同套素材
  'hero-wukong.png': 780,
  'hero-bajie.png': 780,
  'hero-shaseng.png': 780,
  'hero-guanyin.png': 780,
  'hero-nezha.png': 780,
  'hero-erlang.png': 780,
  'hero-tangseng-hero.png': 780,
  'hero-honghaier.png': 780,
  'hero-tieshan.png': 780,
  'hero-taibai.png': 780,
  'hero-niumowang.png': 780,
  'hero-mile.png': 780,
  // 首页 UI（menu.ts / menu-popups.ts / menu-ui.ts 绘制尺寸 ×3）
  'menu-btn-settings.png': 288, // SIDE 96
  'menu-btn-codex.png': 288,
  'menu-btn-rank.png': 786, // max(262, 98)
  'menu-btn-bag.png': 276, // 92
  'menu-btn-start.png': 1116, // 372
  'menu-btn-stamina-plus.png': 96, // PLUS 32
  'menu-btn-map.png': 792, // max(264, 40)
  'menu-btn-stamina-ad.png': 1056, // max(352, 62)
  'menu-btn-stamina-share.png': 1056,
  'rank-star-on.png': 153, // settle 星 44 × 动画放大 1.16 ×3
  'rank-star-off.png': 153,
  // 功德/体力图标：显示尺寸见 MERIT_ICON_PAGE_DISPLAY / STAMINA_ICON_PAGE_DISPLAY ×3
  'icon-merit.png': 108, // 商店 36
  'icon-stamina.png': 252, // 体力弹窗主图 84
  // 技能图标：战斗主动圆 ACT_D=60（drawSkillGlyph 内图约 48）×3；兼作蟠桃 UI（PEACH_UI_ICON_SIZE=39）
  'skill-act-palm.png': 180,
  'skill-act-meteor.png': 180,
  'skill-act-atk.png': 180,
  'skill-act-frq.png': 180,
  'skill-act-freeze.png': 180,
  'skill-act-jinggu.png': 180,
  'skill-pas-pantao.png': 180,
  'skill-pas-xiandan.png': 180,
  'skill-pas-fenghuolun.png': 180,
  'skill-pas-fabaofu.png': 180,
  'skill-pas-zhaoxian.png': 180,
  'skill-pas-mojin.png': 180,
  'skill-pas-luoyangchan.png': 180,
  'skill-pas-yunshi.png': 180,
  'skill-pas-yuni.png': 180,
  'skill-pas-xianyuan.png': 180,
  'skill-pas-jubaopen.png': 180,
  'skill-pas-hushen.png': 180,
  'skill-pas-zhuwang.png': 180,
  'skill-pas-tongxin.png': 180,
  'skill-pas-dinghai.png': 180,
  'skill-act-bomb.png': 180, // 炸药立绘：技能槽约 48px、路径雷约 18px，取 ×3 上限 180 足够
  'menu-home.png': 3132, // max(VIEW_W, VIEW_H) cover 背景
  'merchant-peddler.png': 216, // PEDDLER_BOX 72
};

const only = process.argv.slice(2).map((a) => (a.endsWith('.png') ? a : `${a}.png`));
const entries = Object.entries(TARGET).filter(([name]) => only.length === 0 || only.includes(name));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

let saved = 0, before = 0, after = 0;
for (const [name, maxSide] of entries) {
  const file = path.join(DIR, name);
  if (!existsSync(file)) {
    console.log(`skip ${name} (missing)`);
    continue;
  }
  const raw = readFileSync(file);
  before += raw.length;
  const b64 = raw.toString('base64');
  const out = await page.evaluate(async (src, max) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const sw = img.naturalWidth, sh = img.naturalHeight;

    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(img, 0, 0);
    const data = tctx.getImageData(0, 0, sw, sh).data;
    const ALPHA = 16;
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const a = data[(y * sw + x) * 4 + 3];
        if (a > ALPHA) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return { unchanged: true, sw, sh };

    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(sw - 1, maxX + pad);
    maxY = Math.min(sh - 1, maxY + pad);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    const trimmedMax = Math.max(cw, ch);
    const scale = trimmedMax > max ? max / trimmedMax : 1;
    const dw = Math.max(1, Math.round(cw * scale));
    const dh = Math.max(1, Math.round(ch * scale));

    const trimmedOnly = scale === 1 && cw === sw && ch === sh;
    if (trimmedOnly) return { unchanged: true, sw, sh };

    const cv = document.createElement('canvas');
    cv.width = dw;
    cv.height = dh;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, minX, minY, cw, ch, 0, 0, dw, dh);
    return {
      b64: cv.toDataURL('image/png').split(',')[1],
      dw,
      dh,
      sw,
      sh,
      crop: { minX, minY, cw, ch },
    };
  }, `data:image/png;base64,${b64}`, maxSide);

  if (out.unchanged) {
    after += raw.length;
    console.log(`skip ${name} (${out.sw}x${out.sh} already ≤${maxSide}, no trim)`);
    continue;
  }
  const buf = Buffer.from(out.b64, 'base64');
  writeFileSync(file, buf);
  after += buf.length;
  saved += raw.length - buf.length;
  const cropNote = out.crop ? ` crop ${out.crop.cw}x${out.crop.ch}` : '';
  console.log(`✅ ${name}  ${out.sw}x${out.sh}${cropNote} → ${out.dw}x${out.dh}  ${(raw.length / 1024).toFixed(0)}KB → ${(buf.length / 1024).toFixed(0)}KB`);
}

await browser.close();
console.log(`合计 ${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB  节省 ${(saved / 1024 / 1024).toFixed(1)}MB`);

const WX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../wechat/assets');
let synced = 0;
for (const [name] of entries) {
  const dest = path.join(WX, name);
  if (!existsSync(dest) || !existsSync(path.join(DIR, name))) continue;
  copyFileSync(path.join(DIR, name), dest);
  synced++;
}
if (synced > 0) console.log(`已同步 ${synced} 个文件 → wechat/assets`);
