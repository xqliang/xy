// 冒烟验证：神秘商人商品 tips/二次确认弹窗 + 武器背包 tips 弹窗
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1080, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 逻辑坐标 → 客户端坐标后用真实鼠标点击（真实事件才支持 setPointerCapture）
async function tap(lx, ly) {
  const pt = await page.evaluate((lx, ly) => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const s = c.clientWidth / 560;
    return { x: r.left + lx * s, y: r.top + ly * s };
  }, lx, ly);
  await page.mouse.click(pt.x, pt.y);
  await sleep(60);
}
const meritNow = () => page.evaluate(() => Number(JSON.parse(localStorage.getItem('dasheng.merit') || '{}').merit || 0));

// —— 神秘商人 —— //
await page.evaluate(() => { window.__game.grantMerit(500); window.__game.openShop(); });
await sleep(80);
const meritBefore = await meritNow();
await page.screenshot({ path: path.join(OUT, 'shop-0-open.png') });

// 点第一张升级卡 → 详情弹窗
await tap(149, 185);
await page.screenshot({ path: path.join(OUT, 'shop-1-detail.png') });

// 点弹窗购买按钮 → 确认阶段
await tap(280, 632);
await page.screenshot({ path: path.join(OUT, 'shop-2-confirm.png') });

// 点确认扣费 → 执行购买
await tap(372, 632);
await sleep(80);
await page.screenshot({ path: path.join(OUT, 'shop-3-bought.png') });
const meritAfter = await meritNow();

// —— 武器背包 —— //
await page.evaluate(() => { window.__game.grantWeapon('jingubang'); window.__game.openBag(); });
await sleep(80);
await page.screenshot({ path: path.join(OUT, 'bag-0-open.png') });
await tap(280, 155); // 点第一行 → 详情 tips
await page.screenshot({ path: path.join(OUT, 'bag-1-detail.png') });
await tap(280, 615); // 点装备/卸下按钮
await sleep(60);
await page.screenshot({ path: path.join(OUT, 'bag-2-toggle.png') });

console.log('merit before/after:', meritBefore, '->', meritAfter, meritAfter < meritBefore ? '(deducted ✓)' : '(NOT deducted ✗)');
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
