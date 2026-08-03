import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=11', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
const r = await page.evaluate(() => {
  const g = window.__game; g.restart(11); g.enterBattle();
  g.wave();
  const b = g.battle;
  // 逐帧直到有怪，然后把最靠前的怪推到距唐僧2格，验证危险渲染
  for(let i=0;i<60;i++){ g.step(1/30); if(b.monsters.length>0) break; }
  if(b.monsters[0]) b.monsters[0].dist = b.pathLen - 2;
  if(b.aiMonsters[0]) b.aiMonsters[0].dist = b.aiPathLen ? (b.aiPathLen - 2) : 0;
  g.step(1/60);
  return { danger: b.dangerNear(), aiDanger: b.aiDangerNear() };
});
await new Promise(r=>setTimeout(r,60));
await page.screenshot({ path: path.join(OUT, 'danger.png') });
console.log('danger:', JSON.stringify(r));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
