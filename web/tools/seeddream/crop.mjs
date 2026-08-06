// 裁剪 PNG 指定区域并放大导出，便于肉眼查看细节。用法: node crop.mjs <file> <x0f> <y0f> <x1f> <y1f>
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [file, x0f = 0, y0f = 0.5, x1f = 1, y1f = 1] = process.argv.slice(2);
const abs = path.resolve('/Users/jyxc-dz-0100360/work/fun/xy/web/src/game-assets', file);
const b64 = readFileSync(abs).toString('base64');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const out = await page.evaluate(async (src, x0f, y0f, x1f, y1f) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const sx = x0f * w, sy = y0f * h, sw = (x1f - x0f) * w, sh = (y1f - y0f) * h;
  const scale = 1.6;
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const ctx = cv.getContext('2d');
  // 棋盘格底纹凸显透明区
  for (let y = 0; y < cv.height; y += 16) for (let x = 0; x < cv.width; x += 16) {
    ctx.fillStyle = ((x / 16 + y / 16) % 2 === 0) ? '#cccccc' : '#f0f0f0';
    ctx.fillRect(x, y, 16, 16);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png').split(',')[1];
}, `data:image/png;base64,${b64}`, +x0f, +y0f, +x1f, +y1f);
await browser.close();
writeFileSync('/tmp/crop.png', Buffer.from(out, 'base64'));
console.log('saved /tmp/crop.png');
