import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  window.__draws = 0;
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); try { cb(t); } finally { if (performance.now() - s > 0.2) window.__draws++; } });
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
// 静置菜单 6s：实际发生绘制（JS>0.2ms）的帧数
await page.evaluate(() => { window.__draws = 0; });
await new Promise((r) => setTimeout(r, 6000));
const idle = await page.evaluate(() => window.__draws);
// 模拟交互后 6s 内的前 1s：应回到 ~60fps
await page.evaluate(() => { window.__draws = 0; });
await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.up();
await new Promise((r) => setTimeout(r, 1000));
const burst = await page.evaluate(() => window.__draws);
console.log(JSON.stringify({ label: '菜单实际绘制帧数', 静置6s: idle, '≈fps': +(idle / 6).toFixed(1), 交互后1s: burst, '≈fps': burst }));
await browser.close();
