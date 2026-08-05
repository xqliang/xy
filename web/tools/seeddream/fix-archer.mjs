// 补抠 unit-archer.png：弓与身体之间的「封闭白色区」四边 flood-fill 到不了，残留不透明近白。
// 该角色本身无白色，故对当前 PNG 做一次「全局近白 → 透明」+ 边缘羽化，安全去掉内凹残留白。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets/unit-archer.png');

const b64 = readFileSync(FILE).toString('base64');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
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
    return mn >= 236 && mx - mn <= 14;
  };
  // 全局近白 → 透明（角色本身无白，封闭内凹白一并去掉）
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] !== 0 && isBg(i)) p[i + 3] = 0;
  }
  // 边缘羽化：仍不透明但邻接透明且偏白的像素，降 alpha
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] === 0) continue;
      const near = [(y * w + x + 1), (y * w + x - 1), ((y + 1) * w + x), ((y - 1) * w + x)];
      if (near.some((n) => p[n * 4 + 3] === 0)) {
        const mn = Math.min(p[i], p[i + 1], p[i + 2]);
        if (mn >= 228) p[i + 3] = Math.round(p[i + 3] * 0.4);
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return cv.toDataURL('image/png').split(',')[1];
}, `data:image/png;base64,${b64}`);

writeFileSync(FILE, Buffer.from(pngB64, 'base64'));
console.log('✅ unit-archer.png 内凹白已清除');
await browser.close();
