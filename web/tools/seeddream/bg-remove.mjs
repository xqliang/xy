// 把 public/assets 下的白底 JPG 抠成透明 PNG：从四边 flood-fill near-white 背景 → alpha0，
// 保留角色内部白色。用系统 Chrome（puppeteer）在离屏 canvas 完成，导出 PNG，删除原 jpg。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');

// 可选：node bg-remove.mjs fence-baiguling.jpg  — 只处理指定文件，避免误伤地图 jpg
const only = process.argv.slice(2);
const jpgs = readdirSync(DIR).filter((f) => f.endsWith('.jpg') && (only.length === 0 || only.includes(f)));
if (jpgs.length === 0) {
  console.log('没有 jpg 待处理');
  process.exit(0);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const f of jpgs) {
  const b64 = readFileSync(path.join(DIR, f)).toString('base64');
  const dataUrl = `data:image/jpeg;base64,${b64}`;
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
    const visited = new Uint8Array(w * h);
    const stack = [];
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      if (isBg(idx * 4)) stack.push(idx);
    };
    // 从四边入栈
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (stack.length) {
      const idx = stack.pop();
      p[idx * 4 + 3] = 0; // 透明
      const x = idx % w, y = (idx / w) | 0;
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
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
  }, dataUrl);

  const outName = f.replace(/\.jpg$/, '.png');
  writeFileSync(path.join(DIR, outName), Buffer.from(pngB64, 'base64'));
  unlinkSync(path.join(DIR, f));
  console.log(`✅ ${f} -> ${outName}`);
}

await browser.close();
console.log('抠图完成。');
