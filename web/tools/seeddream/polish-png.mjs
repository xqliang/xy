// 已抠 PNG 二次清理：去掉残留白底毛边，并按内容 bbox 裁剪。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = process.env.ASSET_DIR
  ? path.resolve(process.env.ASSET_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');

const only = process.argv.slice(2).map((a) => (a.endsWith('.png') ? a : `${a}.png`));
const maxSide = Number(process.env.POLISH_MAX_SIDE || 0);

const files = only.length > 0
  ? only.filter((f) => existsSync(path.join(DIR, f)))
  : [];

if (files.length === 0) {
  console.log('没有 png 待处理');
  process.exit(0);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const f of files) {
  const raw = readFileSync(path.join(DIR, f));
  const out = await page.evaluate(async (src, max) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;

    const idx = (x, y) => (y * w + x) * 4;
    const alphaAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : p[idx(x, y) + 3]);

    // 贴透明边的近白/灰白像素：视为残留底，清掉
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = idx(x, y);
          const a = p[i + 3];
          if (a === 0) continue;
          const r = p[i], g = p[i + 1], b = p[i + 2];
          const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
          let nearTrans = false;
          for (let dy = -1; dy <= 1 && !nearTrans; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (alphaAt(x + dx, y + dy) === 0) { nearTrans = true; break; }
            }
          }
          if (!nearTrans) continue;
          if (mn >= 248 && mx - mn <= 10) p[i + 3] = 0;
          else if (mn >= 235 && mx - mn <= 16) p[i + 3] = Math.round(a * 0.15);
          else if (mn >= 220 && mx - mn <= 20) p[i + 3] = Math.round(a * 0.45);
        }
      }
    }

    ctx.putImageData(data, 0, 0);

    // 内容 bbox 裁剪
    const trimmed = ctx.getImageData(0, 0, w, h);
    const tp = trimmed.data;
    const ALPHA = 16;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (tp[idx(x, y) + 3] > ALPHA) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null;

    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    let dw = cw, dh = ch;
    if (max > 0) {
      const scale = max / Math.max(cw, ch);
      if (scale < 1) {
        dw = Math.max(1, Math.round(cw * scale));
        dh = Math.max(1, Math.round(ch * scale));
      }
    }

    const outCv = document.createElement('canvas');
    outCv.width = dw;
    outCv.height = dh;
    const octx = outCv.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cv, minX, minY, cw, ch, 0, 0, dw, dh);
    return {
      b64: outCv.toDataURL('image/png').split(',')[1],
      sw: w,
      sh: h,
      dw,
      dh,
    };
  }, `data:image/png;base64,${raw.toString('base64')}`, maxSide);

  if (!out) {
    console.log(`skip ${f} (empty)`);
    continue;
  }
  writeFileSync(path.join(DIR, f), Buffer.from(out.b64, 'base64'));
  console.log(`✅ ${f}  ${out.sw}x${out.sh} → ${out.dw}x${out.dh}`);
}

await browser.close();
