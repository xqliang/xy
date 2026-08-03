import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
const res = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7); g.enterBattle();
  const manage = () => { for (let k=0;k<30;k++){ if(!g.summon()){g.autoPlace(); if(!g.summon())break;} g.autoPlace(); } };
  for (let w=0; w<2; w++){ if(g.battle.pendingShop) g.chooseItem(0); g.grantPeach(400); manage(); g.wave(); g.fastForward(30); }
  if(g.battle.pendingShop) g.chooseItem(0); g.grantPeach(400); manage();
  g.wave();
  let fireSnap=null;
  for(let i=0;i<900;i++){ g.step(1/30); if(g.battle.ultFlash>0){fireSnap=g.snapshot();break;} if(g.snapshot().status!=='playing')break; }
  return { fireSnap, cur: g.snapshot(), ultCount: g.battle.ultCount };
});
await new Promise((r)=>setTimeout(r,80));
await page.screenshot({ path: path.join(OUT, 'ult.png') });
console.log('ult fire snap:', JSON.stringify(res.fireSnap));
console.log('current      :', JSON.stringify(res.cur));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
