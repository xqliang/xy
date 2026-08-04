import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width:560, height:1010, deviceScaleFactor:2 });
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=5',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
const res = await page.evaluate(()=>{
  const g=window.__game; g.restart(5,1); g.enterBattle();
  // 反复征兵+布阵，直到出现武将
  for(let k=0;k<60;k++){ g.grantPeach(200); g.summon(); g.autoPlace(); if(g.battle.activeGenerals().length>0) break; }
  g.wave();
  for(let i=0;i<600;i++){ g.step(1/30); if(g.battle.activeGenerals().some(x=>x.state.level>1)) break; }
  const gs = g.battle.activeGenerals().map(x=>({id:x.def.id,name:x.def.name,tier:x.tier,level:x.state.level,exp:+x.state.exp.toFixed(1),cells:x.cells}));
  return { generals: gs, snap: g.snapshot() };
});
await new Promise(r=>setTimeout(r,80));
await page.screenshot({ path: path.join(OUT,'generals.png') });
console.log('generals:', JSON.stringify(res.generals));
console.log('snap:', JSON.stringify(res.snap));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
