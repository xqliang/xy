import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(()=>{});
// 进入对局，建防线，跑几波看AI侧渲染
const mid = await page.evaluate(() => {
  const g = window.__game; g.restart(7); g.enterBattle();
  const manage = () => { for (let k=0;k<30;k++){ if(!g.summon()){g.autoPlace(); if(!g.summon())break;} g.autoPlace(); } };
  if(g.battle.pendingShop) g.chooseItem(0); g.grantPeach(400); manage();
  g.wave();
  // 步进到 AI 侧有怪且逼近其唐僧，捕捉危险/图标
  for(let i=0;i<400;i++){ g.step(1/30); if(g.battle.aiMonsters.length>0 && g.snapshot().status==='playing') { if(i>120) break; } }
  return g.snapshot();
});
await new Promise(r=>setTimeout(r,120));
await page.screenshot({ path: path.join(OUT, 'aiside.png') });
// 继续跑到分出胜负，验证 AI 亡→won
const end = await page.evaluate(() => {
  const g = window.__game;
  const manage = () => { for (let k=0;k<30;k++){ if(!g.summon()){g.autoPlace(); if(!g.summon())break;} g.autoPlace(); } };
  for(let w=0; w<12; w++){ if(g.battle.status==='won'||g.battle.status==='lost')break; if(g.battle.pendingShop)g.chooseItem(0); g.grantPeach(400); manage(); if(g.battle.status==='ready')g.wave(); g.fastForward(30); }
  return g.snapshot();
});
console.log('mid snap:', JSON.stringify(mid));
console.log('end snap:', JSON.stringify(end));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
