// 实测各场景每帧 Canvas API 调用计数：渐变创建 / save-restore / fillText / drawImage。
// 用法：node tools/perf-count.mjs（默认 5180；可用 PERF_URL 指定其它 dev server）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

// 在 canvas 2d context 原型上打点（getContext 拿到的实例都继承自原型）
await page.evaluateOnNewDocument(() => {
  window.__cnt = { rad: 0, lin: 0, save: 0, fillText: 0, drawImg: 0, fillRect: 0, frames: 0, t0: 0 };
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const wrap = () => page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const c = window.__cnt;
  if (!c.wrapped) {
    c.wrapped = true;
    const origRad = proto.createRadialGradient, origLin = proto.createLinearGradient,
      origSave = proto.save, origText = proto.fillText, origImg = proto.drawImage, origRect = proto.fillRect;
    proto.createRadialGradient = function (...a) { if (c.t0 > 0) c.rad++; return origRad.apply(this, a); };
    proto.createLinearGradient = function (...a) { if (c.t0 > 0) c.lin++; return origLin.apply(this, a); };
    proto.save = function (...a) { if (c.t0 > 0) c.save++; return origSave.apply(this, a); };
    proto.fillText = function (...a) { if (c.t0 > 0) c.fillText++; return origText.apply(this, a); };
    proto.drawImage = function (...a) { if (c.t0 > 0) c.drawImg++; return origImg.apply(this, a); };
    proto.fillRect = function (...a) { if (c.t0 > 0) c.fillRect++; return origRect.apply(this, a); };
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => origRaf((t) => { if (c.t0 > 0) c.frames++; cb(t); });
  }
  c.rad = c.lin = c.save = c.fillText = c.drawImg = c.fillRect = c.frames = 0;
  c.t0 = performance.now();
});
const report = (label) => page.evaluate((label) => {
  const c = window.__cnt;
  const f = Math.max(1, c.frames);
  window.__cnt.t0 = 0; // 停止计数
  return { label, rafFrames: c.frames,
    radialGrad_per_frame: +(c.rad / f).toFixed(1), linearGrad_per_frame: +(c.lin / f).toFixed(1),
    save_per_frame: +(c.save / f).toFixed(1), fillText_per_frame: +(c.fillText / f).toFixed(1),
    drawImage_per_frame: +(c.drawImg / f).toFixed(1), fillRect_per_frame: +(c.fillRect / f).toFixed(1) };
}, label);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 场景1：菜单
await wrap(); await sleep(5000);
console.log(JSON.stringify(await report('菜单 5s')));

// 场景2：战斗
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  if (g.battle.status === 'ready') g.wave();
});
await sleep(2000);
await wrap(); await sleep(5000);
console.log(JSON.stringify(await report('战斗 5s')));

// 场景3：菜单重载基线（与场景1互相印证菜单计数稳定）
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
await wrap(); await sleep(3000);
console.log(JSON.stringify(await report('菜单重载 3s（基线）')));
await browser.close();
