import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.setCacheEnabled(false);
await page.goto('http://127.0.0.1:5180/?seed=7&t=' + Date.now(), { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 装备蟠桃园 → 进战斗，注入几棵不同等级桃树到未开垦格，选中一棵看信息面板
const info = await page.evaluate(() => {
  const g = window.__game;
  g.equipPassives(['pas_pantao']); // 触发 newGame（gardenOn）
  g.enterBattle();
  const locked = g.battle.lockedCells();
  const levels = [1, 3, 5];
  const cells = [];
  for (let i = 0; i < levels.length && i < locked.length; i++) {
    const c = locked[i];
    g.battle.trees.set(`${c.c},${c.r}`, { level: levels[i], cell: c, growT: levels[i] * 0.5 });
    cells.push(c);
  }
  g.select(cells[1]); // 选中 3 级树 → 显示信息面板/进度条
  return { trees: g.battle.trees.size, gardenOn: true, selected: cells[1] };
});
await sleep(60);
await page.screenshot({ path: path.join(OUT, 'peach-board.png') });

console.log('info:', JSON.stringify(info));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
