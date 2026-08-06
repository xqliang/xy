// 分析 PNG 中「不透明近白」像素的分布，输出 32x32 降采样 ASCII 图，定位白色区域。
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const file = process.argv[2];
const abs = path.resolve('/Users/jyxc-dz-0100360/work/fun/xy/web/src/game-assets', file);
const b64 = readFileSync(abs).toString('base64');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const grid = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const p = ctx.getImageData(0, 0, w, h).data;
  const N = 32;
  const rows = [];
  for (let gy = 0; gy < N; gy++) {
    let line = '';
    for (let gx = 0; gx < N; gx++) {
      let white = 0, opaque = 0;
      const x0 = Math.floor(gx * w / N), x1 = Math.floor((gx + 1) * w / N);
      const y0 = Math.floor(gy * h / N), y1 = Math.floor((gy + 1) * h / N);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        if (p[i + 3] < 40) continue;
        opaque++;
        const r = p[i], g = p[i + 1], b = p[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if (mn >= 200 && mx - mn <= 30) white++;
      }
      line += opaque === 0 ? ' ' : white / Math.max(1, opaque) > 0.5 ? '#' : white > 0 ? '.' : 'o';
    }
    rows.push(line);
  }
  return { w, h, rows };
}, `data:image/png;base64,${b64}`);
await browser.close();
console.log(`${file}  ${grid.w}x${grid.h}  ( # = 近白块, o = 不透明非白, . = 少量白 )`);
console.log(grid.rows.join('\n'));
