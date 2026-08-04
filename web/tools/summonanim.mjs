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
await page.evaluate(()=>{ const g=window.__game; g.restart(5,1); g.enterBattle(); g.grantPeach(200); g.summon(); g.step(0.12); }); // 动画进行中
await new Promise(r=>setTimeout(r,40));
await page.screenshot({ path: path.join(OUT,'summon-anim.png') });
const s=await page.evaluate(()=>({summonAnimT:window.__game.battle.summonAnimT, tray:window.__game.battle.tray.length}));
console.log(JSON.stringify(s)); console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
