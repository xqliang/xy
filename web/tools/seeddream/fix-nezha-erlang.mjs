// 补抠 hero-nezha / hero-erlang：只清背景白/地影/轮廓溢白，不误伤银甲与白披帛。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
const FILES = process.argv.slice(2).length
  ? process.argv.slice(2).map((a) => (a.endsWith('.png') ? a : `${a}.png`))
  : ['hero-nezha.png', 'hero-erlang.png'];
// 白/银为主的角色开 protect：只清薄边、不动大面积白/银（银甲、白披帛、白衣）。
const PROTECT = new Set(['erlang', 'guanyin']);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const file of FILES) {
  const FILE = path.join(DIR, file);
  const b64 = readFileSync(FILE).toString('base64');
  const protectWhite = [...PROTECT].some((k) => file.includes(k));

  const result = await page.evaluate(async (src, protect) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;

    const lum = (i) => Math.min(p[i], p[i + 1], p[i + 2]);
    const chroma = (i) => Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]);
    // 背景白：极高亮、几乎无色；银甲通常 chroma 略高或 lum 没这么高
    const isBgWhite = (i) => lum(i) >= 248 && chroma(i) <= 8;
    const isSoftBgWhite = (i) => lum(i) >= 238 && chroma(i) <= 12;
    const isWarm = (i) => p[i] > p[i + 1] + 14 && p[i] > p[i + 2] + 10;
    const isFloorGray = (i) => {
      const mn = Math.min(p[i], p[i + 1], p[i + 2]);
      const mx = Math.max(p[i], p[i + 1], p[i + 2]);
      return mn >= 150 && mx - mn <= 26 && !isWarm(i);
    };
    // 中灰背景：淡地图水印/宣纸底纹/地面投影。亮度落在中段、几乎无彩、非暖色；
    // protect（银甲/白衣）时上限收到 224 保护亮白；非 protect（哪吒无大白面）可放到 236，
    // 连淡地图残影一并清掉。角色内部白靠深轮廓与边隔断，泛洪到不了，故安全。
    const grayCap = protect ? 224 : 236;
    const isMidGray = (i) => {
      const mn = Math.min(p[i], p[i + 1], p[i + 2]);
      const mx = Math.max(p[i], p[i + 1], p[i + 2]);
      return mn >= 150 && mn <= grayCap && mx - mn <= 22 && !isWarm(i);
    };

    const flood = (pred) => {
      const visited = new Uint8Array(w * h);
      const stack = [];
      const push = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const idx = y * w + x;
        if (visited[idx]) return;
        visited[idx] = 1;
        if (pred(idx * 4)) stack.push(idx);
      };
      for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
      for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
      let n = 0;
      while (stack.length) {
        const idx = stack.pop();
        const i = idx * 4;
        if (p[i + 3] !== 0) { p[i + 3] = 0; n++; }
        const x = idx % w, y = (idx / w) | 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
      }
      return n;
    };

    let cleared = 0;
    cleared += flood((i) => p[i + 3] < 36 || isBgWhite(i));
    // 中灰背景从四边泛洪清除（淡地图/宣纸底纹/地面灰影）。角色内部的银甲/白衣不与边相连，
    // 被角色深色轮廓隔断，泛洪到不了，因此低阈值也安全。
    cleared += flood((i) => p[i + 3] < 36 || isMidGray(i));
    if (!protect) {
      cleared += flood((i) => p[i + 3] < 36 || isSoftBgWhite(i));
    }

    // 封闭白洞：仅严格背景白，且面积小（夹缝）；不碰银甲/披帛
    let holes = 0;
    {
      const visited = new Uint8Array(w * h);
      const maxHole = Math.floor(w * h * 0.008);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const start = y * w + x;
          if (visited[start]) continue;
          const si = start * 4;
          if (p[si + 3] === 0 || !isBgWhite(si)) { visited[start] = 1; continue; }
          const stack = [start];
          visited[start] = 1;
          const comp = [];
          let touchBorder = false;
          while (stack.length) {
            const idx = stack.pop();
            comp.push(idx);
            const cx = idx % w, cy = (idx / w) | 0;
            if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchBorder = true;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nidx = ny * w + nx;
              if (visited[nidx]) continue;
              const ni = nidx * 4;
              if (p[ni + 3] === 0 || !isBgWhite(ni)) continue;
              visited[nidx] = 1;
              stack.push(nidx);
            }
          }
          if (!touchBorder && comp.length >= 8 && comp.length <= maxHole) {
            for (const idx of comp) { p[idx * 4 + 3] = 0; holes++; }
          }
        }
      }
    }

    // 底部地影
    let bottom = 0;
    const y0 = Math.floor(h * 0.74);
    for (let y = y0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (p[i + 3] === 0) continue;
        if (isFloorGray(i) || isBgWhite(i) || isSoftBgWhite(i)) { p[i + 3] = 0; bottom++; }
      }
    }

    // 轮廓溢白：贴透明的背景白 → 清；彩色角色边的浅灰晕 → 向邻色靠拢
    let fringe = 0;
    const passes = protect ? 3 : 6;
    for (let pass = 0; pass < passes; pass++) {
      const snap = new Uint8ClampedArray(p);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          const i = idx * 4;
          if (snap[i + 3] === 0) continue;
          const nbs = [idx + 1, idx - 1, idx + w, idx - w, idx + w + 1, idx + w - 1, idx - w + 1, idx - w - 1];
          let trans = 0, whiteN = 0, colorN = 0;
          let sr = 0, sg = 0, sb = 0;
          for (const n of nbs) {
            const ni = n * 4;
            if (snap[ni + 3] < 36) { trans++; continue; }
            if (lum(ni) >= 236 && chroma(ni) <= 14) whiteN++;
            else {
              colorN++;
              sr += snap[ni]; sg += snap[ni + 1]; sb += snap[ni + 2];
            }
          }
          if (trans === 0) continue;

          const mn = lum(i);
          const ch = chroma(i);

          if (protect) {
            // 白披帛：仅清「薄边」——贴透明且周围白邻居很少
            if ((isBgWhite(i) || isSoftBgWhite(i)) && whiteN <= 2 && trans >= 2) {
              p[i + 3] = 0; fringe++;
            }
            continue;
          }

          // 哪吒等：积极去边
          if (mn >= 236 && ch <= 16) { p[i + 3] = 0; fringe++; continue; }
          if (mn >= 210 && ch <= 28) {
            if (colorN > 0) {
              p[i] = Math.round(sr / colorN);
              p[i + 1] = Math.round(sg / colorN);
              p[i + 2] = Math.round(sb / colorN);
            }
            p[i + 3] = Math.round(snap[i + 3] * (isWarm(i) ? 0.35 : 0.12));
            fringe++;
            continue;
          }
          if (mn >= 175 && ch <= 35 && trans >= 3 && !isWarm(i)) {
            p[i + 3] = Math.round(snap[i + 3] * 0.25);
            fringe++;
          }
        }
      }
    }

    ctx.putImageData(data, 0, 0);
    return { png: cv.toDataURL('image/png').split(',')[1], cleared, holes, bottom, fringe };
  }, `data:image/png;base64,${b64}`, protectWhite);

  writeFileSync(FILE, Buffer.from(result.png, 'base64'));
  console.log(`✅ ${file}: flood ${result.cleared}, holes ${result.holes}, bottom ${result.bottom}, fringe ${result.fringe}`);
}

await browser.close();
