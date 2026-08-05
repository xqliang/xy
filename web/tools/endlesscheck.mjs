import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const result = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, undefined, true); // endless=true
  g.enterBattle();
  const b = g.battle;
  g.grantPeach(800);
  for (let k = 0; k < 30; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  const waves = [];
  for (let w = 0; w < 12 && b.status !== 'lost'; w++) {
    g.wave();
    for (let i = 0; i < 2000; i++) {
      g.step(1 / 60);
      if (b.status === 'lost') break;
      if (b.status === 'ready') break;
    }
    waves.push({ wave: b.wave, status: b.status, aiMonsters: b.aiMonsters.length });
    if (b.status === 'lost') break;
    g.grantPeach(300);
    for (let k = 0; k < 12; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  }
  return {
    reachedWave: b.wave,
    endless: b.endless,
    everWon: waves.some((x) => x.status === 'won'),
    aiMonstersMax: Math.max(...waves.map((x) => x.aiMonsters)),
    finalStatus: b.status,
  };
});
await new Promise((r) => setTimeout(r, 30));
await page.screenshot({ path: path.join(OUT, 'endless.png') });

const ok = result.endless === true && result.everWon === false && result.aiMonstersMax === 0 && result.reachedWave >= 5;
console.log('[endlesscheck]', JSON.stringify(result), 'PASS=' + ok);
if (logs.length) console.log(logs.join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
