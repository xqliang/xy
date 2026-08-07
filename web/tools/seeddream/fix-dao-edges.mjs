// 刀兵立绘后处理：只清底部灰影/夹角白块，保护白刃不被抠掉；边缘轻羽化。
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, '../../src/game-assets');
const WX = path.resolve(HERE, '../../../wechat/assets');
const FILE = 'unit-monkey.png';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

const b64 = readFileSync(path.join(DIR, FILE)).toString('base64');
const out = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;

  // 只处理下半：脚底与两腿夹角；上半白刃完全不动
  const yCut = Math.floor(h * 0.55);

  const nearWhite = (i) => {
    const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3];
    if (a === 0) return false;
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    return mn >= 220 && mx - mn <= 25;
  };

  // 1) 底部封闭近白孔洞（两腿夹角白块）：不与透明邻接才清；白刃在上方不进此区域扫描种子也可被透明邻接保护
  const seen = new Uint8Array(w * h);
  let holes = 0;
  for (let y = yCut; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (seen[start] || p[start * 4 + 3] === 0 || !nearWhite(start * 4)) continue;
      const comp = [];
      const st = [start];
      seen[start] = 1;
      let touchesTransparent = false;
      let touchesTop = false; // 若连通爬到上半，可能是误伤，放弃
      while (st.length) {
        const idx = st.pop();
        comp.push(idx);
        const cx = idx % w, cy = (idx / w) | 0;
        if (cy < yCut) touchesTop = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            touchesTransparent = true;
            continue;
          }
          const nidx = ny * w + nx;
          const ni = nidx * 4;
          if (p[ni + 3] < 12) {
            touchesTransparent = true;
            continue;
          }
          if (seen[nidx] || !nearWhite(ni)) continue;
          seen[nidx] = 1;
          st.push(nidx);
        }
      }
      // 仅清：纯底部孔洞、且不贴透明（贴透明的多半是角色边缘，宁可留着）
      if (!touchesTransparent && !touchesTop && comp.length >= 6) {
        for (const idx of comp) {
          p[idx * 4 + 3] = 0;
          holes++;
        }
      }
    }
  }

  // 2) 脚底灰投影 / 椭圆底座（仅更靠下；绝不碰近白刀刃）
  let shadow = 0;
  for (let y = Math.floor(h * 0.58); y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p[i + 3] === 0) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2], a = p[i + 3];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      const avg = (r + g + b) / 3;
      // 保护白/近白（刀尖可能伸到底部）
      if (mn >= 200 && mx - mn <= 30) continue;
      // 保护高饱和橙甲
      if (mx - mn > 40 && (r > g + 20 || r > b + 20)) continue;
      const isGray = mx - mn <= 32 && avg >= 35 && avg < 240;
      const isSoft = a < 230 && mx - mn <= 45 && avg >= 30 && avg < 230;
      const isPaleOval = y > h * 0.72 && mx - mn <= 40 && avg >= 80 && avg < 250 && a < 255;
      if (isGray || isSoft || isPaleOval) {
        p[i + 3] = 0;
        shadow++;
      }
    }
  }

  // 3) 全图轻羽化（不对近白额外惩罚，避免刀刃变透明）
  const a0 = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) a0[k] = p[k * 4 + 3];
  const R = 2;
  let feathered = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (a0[idx] === 0) continue;
      let transp = 0, total = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { total++; transp++; continue; }
          total++;
          if (a0[ny * w + nx] < 12) transp++;
        }
      }
      if (transp === 0) continue;
      let a = 1 - transp / total;
      a = a * a * (3 - 2 * a);
      // 近白像素（刀刃）几乎不羽化掉
      const i = idx * 4;
      const mn = Math.min(p[i], p[i + 1], p[i + 2]);
      const mx = Math.max(p[i], p[i + 1], p[i + 2]);
      if (mn >= 210 && mx - mn <= 28) a = Math.max(a, 0.92);
      const na = Math.round(a0[idx] * a);
      if (na !== a0[idx]) feathered++;
      p[i + 3] = na;
    }
  }

  ctx.putImageData(data, 0, 0);
  return {
    b64: cv.toDataURL('image/png').split(',')[1],
    holes,
    shadow,
    feathered,
    w,
    h,
  };
}, `data:image/png;base64,${b64}`);

const buf = Buffer.from(out.b64, 'base64');
writeFileSync(path.join(DIR, FILE), buf);
if (existsSync(WX)) {
  mkdirSync(WX, { recursive: true });
  copyFileSync(path.join(DIR, FILE), path.join(WX, FILE));
}
await browser.close();
console.log(`✅ ${FILE}  去底孔 ${out.holes}  去灰影 ${out.shadow}  羽化 ${out.feathered}  → ${(buf.length / 1024).toFixed(0)}KB`);
