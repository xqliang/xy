// 按「最终显示尺寸 × 3」缩小立绘 PNG，减小 git 体积。透明通道用 canvas 保留。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

// CELL=68。各资产在画面上的最大绘制边长 × 3（含 typeScale / cover 余量）
const TARGET = {
  'unit-monkey.png': 165, // CELL*0.72*1.06*3 ≈ 155
  'unit-archer.png': 170, // CELL*0.72*1.09*3 ≈ 160
  'unit-spear.png': 168, // CELL*0.72*1.08*3 ≈ 159
  'unit-cavalry.png': 180,
  'tangseng.png': 192, // CELL*0.46*2*3 ≈ 188
  'item-shovel.png': 180, // CELL*0.86*3 ≈ 175
  'monster-boss.png': 210, // CELL*0.42*2.3*3 ≈ 197
  'monster-boss-baiguling.png': 210,
  'monster-boss-huoyanshan.png': 210,
  'monster-boss-liushahe.png': 210,
  'monster-boss-pansidong.png': 210,
  'monster-minion.png': 150, // CELL*0.28*2.3*3 ≈ 131
  'monster-minion-baiguling.png': 150,
  'monster-minion-huoyanshan.png': 150,
  'monster-minion-liushahe.png': 150,
  'monster-minion-pansidong.png': 150,
  // 菜单主角立绘 260×3；武将卡同套素材（web + wechat 共用尺寸）
  'hero-wukong.png': 780,
  'hero-bajie.png': 780,
  'hero-shaseng.png': 780,
  'hero-guanyin.png': 780,
  'hero-nezha.png': 780,
  'hero-erlang.png': 780,
  'hero-tangseng-hero.png': 780,
  'hero-honghaier.png': 780,
  'hero-tieshan.png': 780,
  'hero-baigujing.png': 780,
  'hero-niumowang.png': 780,
  'hero-mile.png': 780,
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

let saved = 0, before = 0, after = 0;
for (const [name, maxSide] of Object.entries(TARGET)) {
  const file = path.join(DIR, name);
  const raw = readFileSync(file);
  before += raw.length;
  const b64 = raw.toString('base64');
  const out = await page.evaluate(async (src, max) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const sw = img.naturalWidth, sh = img.naturalHeight;
    if (Math.max(sw, sh) <= max) return null; // 已足够小
    const scale = max / Math.max(sw, sh);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const cv = document.createElement('canvas');
    cv.width = dw; cv.height = dh;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dw, dh);
    return { b64: cv.toDataURL('image/png').split(',')[1], dw, dh, sw, sh };
  }, `data:image/png;base64,${b64}`, maxSide);

  if (!out) {
    after += raw.length;
    console.log(`skip ${name} (already ≤${maxSide})`);
    continue;
  }
  const buf = Buffer.from(out.b64, 'base64');
  writeFileSync(file, buf);
  after += buf.length;
  saved += raw.length - buf.length;
  console.log(`✅ ${name}  ${out.sw}x${out.sh} → ${out.dw}x${out.dh}  ${(raw.length / 1024).toFixed(0)}KB → ${(buf.length / 1024).toFixed(0)}KB`);
}

await browser.close();
console.log(`合计 ${(before / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB  节省 ${(saved / 1024 / 1024).toFixed(1)}MB`);

// 同步到微信小游戏 assets（存在同名文件才覆盖）
const WX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../wechat/assets');
let synced = 0;
for (const name of Object.keys(TARGET)) {
  const dest = path.join(WX, name);
  if (!existsSync(dest)) continue;
  copyFileSync(path.join(DIR, name), dest);
  synced++;
}
console.log(`已同步 ${synced} 个文件 → wechat/assets`);
