// 个人信息（头像设置）弹窗预览：截「起点」（首个头像左边框）与「终点」（末个头像右边框）两态。
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
await page.evaluate(() => window.__game.openMenuPopup('profile'));
await page.evaluate(() => window.__game.previewProfileScroll(false)); // 起点
await new Promise(r => setTimeout(r, 120));
await page.screenshot({ path: path.join(OUT, 'profile-start.png') });
await page.evaluate(() => window.__game.previewProfileScroll(true)); // 终点
await new Promise(r => setTimeout(r, 120));
await page.screenshot({ path: path.join(OUT, 'profile-end.png') });
console.log('saved profile-start.png / profile-end.png; errors:', logs.join('\n') || '(none)');
await browser.close();
