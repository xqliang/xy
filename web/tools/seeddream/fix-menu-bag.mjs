// 抠掉 menu-btn-bag 白底/宣纸底：四边 flood + 去除封闭浅色斑块（保留背包墨线）。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
const file = 'menu-btn-bag.png';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const b64 = readFileSync(path.join(OUT, file)).toString('base64');
const dataUrl = `data:image/png;base64,${b64}`;

const pngB64 = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;

  const isBg = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 232 && mx - mn <= 18;
  };
  const isPaper = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 198 && mx - mn <= 28 && (r + g + b) / 3 >= 215;
  };

  const flood = (test) => {
    const visited = new Uint8Array(w * h);
    const stack = [];
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      if (test(idx * 4)) stack.push(idx);
    };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (stack.length) {
      const idx = stack.pop();
      p[idx * 4 + 3] = 0;
      const x = idx % w, y = (idx / w) | 0;
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
    }
  };

  flood(isBg);
  // 封闭浅宣纸块（侧栏图标不要常驻底）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i = idx * 4;
      if (p[i + 3] === 0) continue;
      if (isPaper(i)) p[i + 3] = 0;
    }
  }

  ctx.putImageData(data, 0, 0);
  return cv.toDataURL('image/png').split(',')[1];
}, dataUrl);

writeFileSync(path.join(OUT, file), Buffer.from(pngB64, 'base64'));
await browser.close();
console.log(`✅ ${file} 背景已抠除`);
