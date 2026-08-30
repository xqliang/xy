// 匹配屏预览：打开 PvP「匹配中」并截图（web 路径，验证顶部渐晕无回归）。
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
await page.evaluate(() => window.__game.fakePvpMatch('queuing'));
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: path.join(OUT, 'pvp-matching.png') });
console.log('saved shots/pvp-matching.png; errors:', logs.join('\n') || '(none)');
await browser.close();
