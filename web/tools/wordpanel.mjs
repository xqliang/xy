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
await page.evaluate(()=>{
  const g=window.__game; g.restart(5,1); g.enterBattle(); const b=g.battle;
  const cells=b.unlockedCells(); const a=cells[0], nb={c:a.c+1,r:a.r};
  b.words.set(`${a.c},${a.r}`,{char:'大',general:'wukong',tier:2,cell:a});
  b.words.set(`${nb.c},${nb.r}`,{char:'圣',general:'wukong',tier:1,cell:nb}); // 激活(取较小阶=1)
  const lone=cells.find(x=>x.c!==a.c&&x.c!==nb.c&&x.r===a.r+1)||cells[3];
  b.words.set(`${lone.c},${lone.r}`,{char:'八',general:'bajie',tier:1,cell:lone}); // 未激活
  g.select(a); // 选中已激活的"大"
});
await new Promise(r=>setTimeout(r,120));
await page.screenshot({ path: path.join(OUT,'wordpanel-active.png') });
await page.evaluate(()=>{ const g=window.__game,b=g.battle; const lone=[...b.words.values()].find(w=>w.general==='bajie'); g.select(lone.cell); });
await new Promise(r=>setTimeout(r,120));
await page.screenshot({ path: path.join(OUT,'wordpanel-inactive.png') });
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
