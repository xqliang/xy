import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=3'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 3 });
await page.goto('http://127.0.0.1:5180/?seed=5&map=liushahe', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
// 冻结在多单位开火帧：手动布防+发波+step，然后强制 select(null) 触发一次 draw
await page.evaluate(() => {
  const g = window.__game; g.restart(5,1,'liushahe'); g.enterBattle(); g.buildDefense(2000); g.wave();
  for (let i=0;i<400;i++){ g.step(1/60); const f=[...g.battle.units.values()].filter(u=>u.firePulse>0.6).length; if(f>=4) break; }
  g.select(null); // 强制用当前(开火)状态画一帧
});
await new Promise(r => setTimeout(r, 30));
await page.screenshot({ path: path.join(OUT, 'weapondyn_crop.png'), clip: { x: 30, y: 300, width: 500, height: 320 } });
console.log('done');
await browser.close();
