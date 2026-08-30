// 铲子分享结果弹窗预览：成功 / 失败 两态各截一张。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7&map=baiguling', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
for (const ok of [true, false]) {
  await page.evaluate((ok) => window.__game.previewShareResult(ok), ok);
  await new Promise(r => setTimeout(r, 150));
  await page.screenshot({ path: path.join(OUT, `share-shovel-${ok ? 'success' : 'fail'}.png`) });
}
console.log('saved share-shovel-success/fail.png; errors:', logs.join('\n') || '(none)');
await browser.close();
