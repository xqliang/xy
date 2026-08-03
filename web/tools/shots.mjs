// 端到端截图自测：用系统 Chrome 驱动 window.__game，抓关键场景并打印数值快照。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'http://127.0.0.1:5180/?seed=7';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); };
const snap = (page) => page.evaluate(() => window.__game.snapshot());

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[console] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(GAME_URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 300));

// 0) 主菜单
await shot(page, '00-menu.png');

// 进入对局
await page.evaluate(() => window.__game.enterBattle());

// 1) 初始界面
await shot(page, '01-initial.png');
console.log('01 initial:', JSON.stringify(await snap(page)));

// 2) 征兵后候选区（展示 5 格 tray）
await page.evaluate(() => { window.__game.grantPeach(200); window.__game.summon(); });
await shot(page, '02-tray.png');
console.log('02 tray   :', JSON.stringify(await snap(page)));

// 3) 一键布阵后
await page.evaluate(() => { window.__game.autoPlace(); });
await shot(page, '03-placed.png');
console.log('03 placed :', JSON.stringify(await snap(page)));

// 4) 真实布阵 + 第 1 波战斗
await page.evaluate(() => { window.__game.buildDefense(2000); window.__game.wave(); window.__game.fastForward(4); });
await shot(page, '04-combat.png');
console.log('04 combat :', JSON.stringify(await snap(page)));

// 5) 连打多波直到通关
const progress = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7);
  const manage = () => { for (let k = 0; k < 40; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); } };
  const waves = [];
  for (let w = 0; w < 12; w++) {
    if (g.battle.status === 'won' || g.battle.status === 'lost') break;
    if (g.battle.pendingShop) g.chooseItem(0);
    g.grantPeach(300); manage();
    g.wave(); g.fastForward(40);
    const s = g.snapshot();
    waves.push({ wave: s.wave, hp: s.tangsengHP, status: s.status });
  }
  return { final: g.snapshot(), waves };
});
await shot(page, '05-multiwave.png');
console.log('05 multi  :', JSON.stringify(progress.final));
console.log('   轨迹:', JSON.stringify(progress.waves));

// 6) 波间道具商店（3 选 1）
await page.evaluate(() => { const g = window.__game; g.restart(7); g.grantPeach(500); g.buildDefense(300); g.wave(); g.fastForward(60); });
await shot(page, '06-shop.png');
console.log('06 shop   :', JSON.stringify(await snap(page)));

// 7) 失败横幅
await page.evaluate(() => { const g = window.__game; g.restart(7); for (let w = 0; w < 4; w++) { g.wave(); g.fastForward(60); } });
await shot(page, '07-lose.png');
console.log('07 lose   :', JSON.stringify(await snap(page)));

console.log('\n--- page logs ---\n' + (logs.join('\n') || '(none)'));
await browser.close();
