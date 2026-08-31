// 去掉立绘底部烘焙的灰色地面阴影：Seedream 常无视「无阴影」提示，在脚下画一枚浅灰椭圆，
// 白底 flood-fill 抠图（bg-remove）只吃近白背景、保留了这枚灰阴影。
// 做法：在底部区域(y≥H×BOTTOM)里，把「近中性浅灰」像素(低饱和 + 亮度在阴影区间)清成透明，
// 再按不透明 bbox 裁剪。彩色袍角(高饱和)与近白袍面(>阈值)不受影响。
// 用法（web/）：node tools/seeddream/remove-bottom-shadow.mjs tangseng.png
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
const files = process.argv.slice(2).map((a) => (a.endsWith('.png') ? a : `${a}.png`));
if (files.length === 0) { console.error('用法: remove-bottom-shadow.mjs <file.png> ...'); process.exit(1); }
const BOTTOM = Number(process.env.BOTTOM || 0.82); // 只在底部这一段内清阴影（0.82 = 下 18%）
const SAT_MAX = Number(process.env.SAT_MAX || 0.18); // 视作「中性灰」的饱和度上限
const LO = Number(process.env.LO || 175);  // 阴影亮度下限（避开更暗的描边）
const HI = Number(process.env.HI || 236);  // 阴影亮度上限（避开近白袍面）

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const f of files) {
  const abs = path.join(DIR, f);
  const b64 = readFileSync(abs).toString('base64');
  const res = await page.evaluate(async (src, BOTTOM, SAT_MAX, LO, HI) => {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H); const a = d.data;
    const yStart = Math.floor(H * BOTTOM);
    let removed = 0;
    for (let y = yStart; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (a[i + 3] === 0) continue;
        const r = a[i], g = a[i + 1], b = a[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat < SAT_MAX && mx >= LO && mx < HI) { a[i + 3] = 0; removed++; }
      }
    }
    ctx.putImageData(d, 0, 0);
    // 不透明 bbox 裁剪（去掉清完阴影后底部/四周的空白）
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (a[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const cc = document.createElement('canvas'); cc.width = cw; cc.height = ch;
    cc.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
    return { removed, W, H, cw, ch, dataUrl: cc.toDataURL('image/png') };
  }, `data:image/png;base64,${b64}`, BOTTOM, SAT_MAX, LO, HI);
  const out = Buffer.from(res.dataUrl.split(',')[1], 'base64');
  writeFileSync(abs, out);
  console.log(`✅ ${f}: 清除阴影像素 ${res.removed}，裁剪 ${res.W}x${res.H} → ${res.cw}x${res.ch}，${(out.length / 1024).toFixed(0)}KB`);
}
await browser.close();
