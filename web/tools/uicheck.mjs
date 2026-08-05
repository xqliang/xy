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
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 备战态：底部统一布局 + 征兵进度条（peach < cost 时半格）
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  g.battle.peach = 6; // 成本 12，进度约 50%
});
await sleep(40);
await page.screenshot({ path: path.join(OUT, 'ui-ready.png') });

// 字牌入场砸落动画（summonAnimT 卡在中段）
const midDrop = await page.evaluate(() => {
  const g = window.__game;
  g.battle.tray = [
    { kind: 'word', char: '哪', general: 'nezha', tier: 1 },
    { kind: 'word', char: '吒', general: 'nezha', tier: 1 },
    { kind: 'unit', type: 'archer', tier: 1 },
    { kind: 'shovel' },
    { kind: 'unit', type: 'spear', tier: 1 },
  ];
  g.battle.summonAnimT = 0.18; // 前几个槽正在下落途中
  return g.battle.tray.filter((t) => t.kind === 'word').length;
});
await sleep(40);
await page.screenshot({ path: path.join(OUT, 'ui-worddrop.png') });

console.log('word tokens in tray:', midDrop);
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
