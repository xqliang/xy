import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const logs = [];

// scenario: { name, rank(localStorage before load), result: 'won'|'lost' }
async function shot({ name, rank, result }) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => logs.push(`[${name}] ` + e.message));
  await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
  // 预置段位存档（在页面脚本执行前写 localStorage）
  await page.evaluateOnNewDocument((r) => { if (r) localStorage.setItem('dasheng.rank', JSON.stringify(r)); }, rank ?? null);
  await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game && window.__game.snapshot');
  // 进入对战并强制本局结果，触发 endHandled → 结算页
  await page.evaluate((res) => {
    window.__game.enterBattle();
    window.__game.battle.status = res; // Status 为公有字段
  }, result);
  await sleep(650); // 动画中途
  await page.screenshot({ path: path.join(OUT, `settle-${name}-mid.png`) });
  await sleep(900); // 动画结束（终态 + 晋级/降档提示）
  await page.screenshot({ path: path.join(OUT, `settle-${name}-end.png`) });
  await page.close();
}

await shot({ name: 'win', rank: { level: 1, stars: 1, difficulty: 1 }, result: 'won' });
await shot({ name: 'promote', rank: { level: 1, stars: 4, difficulty: 1 }, result: 'won' });
await shot({ name: 'lose', rank: { level: 2, stars: 3, difficulty: 1 }, result: 'lost' });
await shot({ name: 'demote', rank: { level: 2, stars: 0, difficulty: 1 }, result: 'lost' });

console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
