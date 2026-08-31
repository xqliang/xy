// 视觉回归：同 seed 同状态分别截「改前(5180)/改后(5191)」的战斗画面，逐像素 diff。
// 棋盘缓存(B)重写了 drawBoard 的绘制路径，必须证明画面与改前完全一致。
// 用法：node tools/shot-diff.mjs（需两个 dev server 都在跑）
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BEFORE = process.env.BEFORE_URL || 'http://127.0.0.1:5180/?seed=7';
const AFTER = process.env.AFTER_URL || 'http://127.0.0.1:5191/?seed=7';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

// 同一份确定性布阵：restart(seed) → 征兵+自动布阵 25 轮（不 startWave，画面静止无随机动画）
const ENDLESS = process.env.MODE === 'endless';
const setup = (endless) => {
  const g = window.__game;
  g.restart(7, 1, undefined, endless); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  return { status: g.battle.status, units: g.battle.units.size, wave: g.battle.wave };
};

async function shot(url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game && window.__game.snapshot');
  await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
  const state = await page.evaluate(setup, ENDLESS);
  await sleep(6000); // 等 intro 入场/召唤闪光等一切瞬态动画彻底衰减完
  const png = await page.screenshot({ encoding: 'base64' });
  await page.close();
  return { png, state };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('截图中…');
const before = await shot(BEFORE);
const after = await shot(AFTER);
console.log('before state:', JSON.stringify(before.state), ' after state:', JSON.stringify(after.state));
writeFileSync('shots/perf-before.png', Buffer.from(before.png, 'base64'));
writeFileSync('shots/perf-after.png', Buffer.from(after.png, 'base64'));

// 在页面里解码两张 PNG 并逐像素对比（容忍每通道 ±6 的编码抖动）
const diff = await (async () => {
  const page = await browser.newPage();
  const res = await page.evaluate(async (b64a, b64b) => {
    const load = (b64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = 'data:image/png;base64,' + b64;
    });
    const [ia, ib] = await Promise.all([load(b64a), load(b64b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.drawImage(ia, 0, 0); const da = c.getImageData(0, 0, w, h).data;
    c.clearRect(0, 0, w, h); c.drawImage(ib, 0, 0); const db = c.getImageData(0, 0, w, h).data;
    const avg = (d) => { let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, b / n].map((x) => x.toFixed(0)).join(','); };
    const avgA = avg(da), avgB = avg(db);
    let diffPx = 0, maxDelta = 0;
    const rows = new Array(h).fill(0); // 每行差异像素数（定位差异区域）
    for (let i = 0, p = 0; i < da.length; i += 4, p++) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > maxDelta) maxDelta = d;
      if (d > 6) { diffPx++; rows[p % h]++; }
    }
    // 分十个横带统计（dpr2：1 逻辑行=2 物理行）
    const bands = [];
    for (let k = 0; k < 10; k++) {
      let s = 0; for (let y = Math.floor(h / 10 * k); y < Math.floor(h / 10 * (k + 1)); y++) s += rows[y];
      bands.push(s);
    }
    return { w, h, diffPx, total: w * h, maxDelta, bands, avgA, avgB };
  }, before.png, after.png);
  await page.close();
  return res;
})();
await browser.close();
console.log(JSON.stringify(diff));
console.log(diff.diffPx === 0 ? '✅ 逐像素一致' : `⚠️ ${diff.diffPx}/${diff.total} 像素有差异 (${(diff.diffPx / diff.total * 100).toFixed(2)}%), maxDelta=${diff.maxDelta}`);
