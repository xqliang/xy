// 多地图栅栏开销对比：各地图空场（intro·无怪·tray 空）每帧 Canvas API 计数。
// 背景：白骨岭骨墙曾每帧矢量重画 ~90 骨堆（占空场 save 58%，已离屏缓存）；
// 其余地图栅栏代码审查是素材平铺（drawTiledHFence=1 drawImage/帧）或微量矢量，
// 本工具实测复核「其他地图是否有类似问题」。
// 用法：node tools/perf-maps.mjs（需 dev server 5180 或 PERF_URL）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });

await page.evaluateOnNewDocument(() => {
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
  window.__cnt = { save: 0, drawImg: 0, fillText: 0, frames: 0, t0: 0 };
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 打点
await page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const c = window.__cnt;
  const o = { sv: proto.save, img: proto.drawImage, ft: proto.fillText };
  proto.save = function (...a) { if (c.t0 > 0) c.save++; return o.sv.apply(this, a); };
  proto.drawImage = function (...a) { if (c.t0 > 0) c.drawImg++; return o.img.apply(this, a); };
  proto.fillText = function (...a) { if (c.t0 > 0) c.fillText++; return o.ft.apply(this, a); };
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => { if (c.t0 > 0) c.frames++; cb(t); });
});

const MAPS = ['baiguling', 'pansidong', 'liushahe', 'huangfengling', 'huoyanshan'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('地图            | save/帧 | drawImage/帧 | fillText/帧');
for (const mapId of MAPS) {
  await page.evaluate((mapId) => {
    const g = window.__game;
    g.restart(7, 1, mapId); g.enterBattle();
  }, mapId);
  await sleep(1200); // 等 intro 稳定 + 素材/缓存就绪（首帧建离屏缓存）
  await page.evaluate(() => { const c = window.__cnt; c.save = c.drawImg = c.fillText = c.frames = 0; c.t0 = performance.now(); });
  await sleep(2500);
  const r = await page.evaluate(() => {
    const c = window.__cnt; c.t0 = 0;
    const f = Math.max(1, c.frames);
    return { save: +(c.save / f).toFixed(1), drawImg: +(c.drawImg / f).toFixed(1), fillText: +(c.fillText / f).toFixed(1), frames: c.frames };
  });
  console.log(`${mapId.padEnd(15)} | ${String(r.save).padEnd(7)} | ${String(r.drawImg).padEnd(12)} | ${r.fillText}  (${r.frames}帧)`);
}

await browser.close();
