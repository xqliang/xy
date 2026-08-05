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
const r = await page.evaluate(()=>{
  const g=window.__game; g.equipActives(['act_meteor','act_palm']); g.enterBattle();
  const manage=()=>{for(let k=0;k<20;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
  manage(); g.wave();
  // 跑一段时间让主动技能冷却推进
  for(let i=0;i<300;i++){ g.step(1/30); if(g.snapshot().status!=='playing')break; }
  return { slots:g.battle.activeSlots.map(s=>({id:s.id,cd:Math.round(s.cd),ready:s.ready})), activesReady:g.snapshot().activesReady };
});
await new Promise(r=>setTimeout(r,80));
await page.screenshot({ path: path.join(OUT,'ultui.png') });
console.log('ult ui:', JSON.stringify(r));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
