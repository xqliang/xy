import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width:560, height:1010, deviceScaleFactor:2 });
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=7&map=baiguling',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
// 菜单截图
await page.screenshot({ path: path.join(OUT,'menu-mapswitch.png') });
// 进战，跑到有怪且刚出怪(gate开)时截
await page.evaluate(()=>{ const g=window.__game; g.restart(7,1,'baiguling'); g.enterBattle();
  const manage=()=>{for(let k=0;k<20;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
  manage(); g.wave();
  for(let i=0;i<40;i++){ g.step(1/30); if(g.battle.monsters.length>=2) break; }
});
await new Promise(r=>setTimeout(r,60));
await page.screenshot({ path: path.join(OUT,'ink-battle.png') });
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
