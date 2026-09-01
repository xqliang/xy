// FPS 调试浮层冒烟：探针开 overlay → 进战斗跑 ~1.2s（跨两个 500ms 窗口）→
// 断言 fps 出数 + tier 正常 + 零 pageerror；截图人工核对左上角小字条。
// 用法：node tools/fps-overlay-smoke.mjs（需 dev server 5180 或 PERF_URL）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errs = [];
// 环境噪音过滤：favicon 404、dev 无后端时的 /api/* 5xx（与前端代码无关）
const NOISE = /favicon|\/api\/|CORS|Failed to load resource/i;
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('[console.error] ' + m.text()); });

await page.evaluateOnNewDocument(() => {
  // 教程全已见（否则 battleIntro modal 冻结仿真）+ 非首局（无引导箭头/押后）
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 进战斗 + 开 overlay
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  g.setFpsOverlay(true);
});
await new Promise((r) => setTimeout(r, 1300)); // 跨两个 500ms 窗口

const probe = await page.evaluate(() => window.__game.fpsProbe());
console.log('fpsProbe:', JSON.stringify(probe));

// 断言：overlay 开、fps 出数（>0）、tier 合法
const fail = [];
if (!probe.overlayOn) fail.push('overlay 未开启');
if (!(probe.fps > 0)) fail.push(`fps 未出数: ${probe.fps}`);
if (!['high', 'mid', 'low'].includes(probe.tier)) fail.push(`tier 异常: ${probe.tier}`);
if (errs.length) fail.push(`页面报错: ${errs.slice(0, 3).join(' | ')}`);

await page.screenshot({ path: 'shots/fps-overlay-smoke.png' });
console.log(fail.length ? `FAIL: ${fail.join('; ')}` : 'PASS: overlay 开启、fps 出数、零报错');
await browser.close();
process.exit(fail.length ? 1 : 0);
