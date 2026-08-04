import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width:560, height:1010, deviceScaleFactor:2 });
const logs=[]; page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
await page.goto('http://127.0.0.1:5180/?seed=7',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
await page.evaluate(()=>{ const g=window.__game; g.restart(7,1); g.enterBattle();
  const manage=()=>{for(let k=0;k<20;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
  g.grantPeach(300); manage(); g.wave();
  // 步进到战斗中(有怪+有攻击fx)
  for(let i=0;i<200;i++){ g.step(1/30); if(g.battle.monsters.length>=4 && g.battle.fx.length>0) break; }
});
await new Promise(r=>setTimeout(r,40));
await page.screenshot({ path: path.join(OUT,'combatfx.png') });
console.log('fx:', await page.evaluate(()=>window.__game.battle.fx.length));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
