import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width:560, height:1010, deviceScaleFactor:2 });
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=7&map=huoyanshan',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
const info = await page.evaluate(()=>{ const g=window.__game; g.restart(7,1,'huoyanshan'); g.enterBattle(); g.wave();
  // 步进到刚好第一只怪冒出(spawnT小,gate开)
  for(let i=0;i<60;i++){ g.step(1/60); const m=g.battle.monsters[0]; if(m && m.spawnT>0.05 && m.spawnT<0.2){ return {dist:m.dist, spawnT:+m.spawnT.toFixed(2), gate:+g.battle.spawnGateT.toFixed(2), entrance:g.battle.monsters[0].dist}; } }
  const m=g.battle.monsters[0]; return m?{dist:m.dist,spawnT:+m.spawnT.toFixed(2),gate:+g.battle.spawnGateT.toFixed(2)}:{none:true};
});
await new Promise(r=>setTimeout(r,40));
await page.screenshot({ path: path.join(OUT,'spawn-pop.png') });
console.log('spawn:', JSON.stringify(info));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
