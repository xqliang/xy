import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=5&map=liushahe', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
const res = await page.evaluate(() => {
  const g = window.__game; g.restart(5, 1, 'liushahe'); g.enterBattle();
  g.buildDefense(2000);
  g.wave();
  // 步进到"多个单位正在开火"的一帧（firePulse 高）
  let best = null;
  for (let i = 0; i < 400; i++) {
    g.step(1 / 60);
    const firing = [...g.battle.units.values()].filter(u => u.firePulse > 0.5).length;
    if (!best || firing > best.firing) best = { firing, i };
    if (firing >= 3) break;
  }
  // 让当前帧停留（不再 step），记录开火数
  const firing = [...g.battle.units.values()].filter(u => u.firePulse > 0.3).map(u => ({ t: u.type, p: +u.firePulse.toFixed(2), dir: u.fireDir?.toFixed(2) }));
  return { units: g.battle.units.size, firing, best };
});
await new Promise(r => setTimeout(r, 60));
await page.screenshot({ path: path.join(OUT, 'weapondyn.png') });
console.log('units=', res.units, 'firing=', JSON.stringify(res.firing), 'best=', JSON.stringify(res.best));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
