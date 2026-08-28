// 弹窗预览截图：打开首页「设置」弹窗并截图，用于验证宫檐/红木边框/立体线的视觉效果。
// 依赖本机 Chrome + 已启动的 dev server（:5180）。用法：node tools/popupshot.mjs
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
// 打开设置弹窗（新加的 openMenuPopup 钩子），等一帧确保绘制完成
await page.evaluate(() => window.__game.openMenuPopup('settings'));
await new Promise(r => setTimeout(r, 120));
await page.screenshot({ path: path.join(OUT, 'settings-popup.png') });
console.log('saved shots/settings-popup.png; errors:', logs.join('\n') || '(none)');
await browser.close();
