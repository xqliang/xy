import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5180/?seed=5', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// —— 场景A：棍猴(rge=1)选中 → 单位范围环 ——
const a = await page.evaluate(() => {
  const g = window.__game; g.restart(5, 1); g.enterBattle();
  const cell = g.battle.unlockedCells()[0];
  g.battle.tray = [{ kind: 'unit', type: 'monkey', tier: 1 }];
  g.placeFromTray(0, cell);
  g.select(cell);
  return { cell };
});
await new Promise(r => setTimeout(r, 120));
await page.screenshot({ path: path.join(OUT, 'unit-ring.png') });

// —— 场景B：确定性激活哪吒(nezha, rge=3.5) → 英雄范围环 ——
const b = await page.evaluate(() => {
  const g = window.__game; g.restart(5, 1); g.enterBattle();
  const cells = g.battle.unlockedCells();
  const set = new Set(cells.map(c => `${c.c},${c.r}`));
  let L = null, R = null;
  for (const c of cells) { if (set.has(`${c.c + 1},${c.r}`)) { L = c; R = { c: c.c + 1, r: c.r }; break; } }
  if (!L) return { ok: false, reason: 'no adjacent pair' };
  g.battle.tray = [{ kind: 'word', char: '哪', general: 'nezha', tier: 1 }];
  g.placeFromTray(0, L);
  g.battle.tray = [{ kind: 'word', char: '吒', general: 'nezha', tier: 1 }];
  g.placeFromTray(0, R);
  const act = g.battle.activeGenerals();
  if (act.length === 0) return { ok: false, reason: 'not activated' };
  g.select(L);
  return { ok: true, name: act[0].def.name, rge: +g.battle.generalRge(act[0]).toFixed(2), tol: g.tuning.rangeTolerance, L, R };
});
await new Promise(r => setTimeout(r, 120));
await page.screenshot({ path: path.join(OUT, 'hero-ring.png') });

// —— 场景C：实战掉血——铺一波防御，开怪，快进，确认新命中判定能击杀 ——
const c = await page.evaluate(() => {
  const g = window.__game; g.restart(5, 1); g.enterBattle();
  g.buildDefense(3000);
  const before = g.snapshot();
  g.wave();
  g.fastForward(12);
  const after = g.snapshot();
  return { before, after };
});

console.log('unit:', JSON.stringify(a));
console.log('hero:', JSON.stringify(b));
console.log('combat:', JSON.stringify(c.after));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
