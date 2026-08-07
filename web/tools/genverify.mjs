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
  const b=g.battle;
  const cells=b.unlockedCells();
  // 手工放置：大(c) 与 圣(c+1) 相邻 → 应激活大圣；再放一个孤立的"八"→ 不应激活
  const a=cells[0], nb={c:a.c+1,r:a.r};
  b.words.set(`${a.c},${a.r}`,{char:'大',general:'wukong',tier:1,cell:a});
  b.words.set(`${nb.c},${nb.r}`,{char:'圣',general:'wukong',tier:1,cell:nb});
  const lone=cells.find(x=>x.c!==a.c&&x.c!==nb.c);
  b.words.set(`${lone.c},${lone.r}`,{char:'八',general:'bajie',tier:1,cell:lone});
  const before=b.activeGenerals().map(x=>x.def.name);
  g.wave();
  for(let i=0;i<400;i++){ g.step(1/30); if(b.activeGenerals().some(x=>x.state.level>1)) break; }
  const act=b.activeGenerals().map(x=>({name:x.def.name,tier:x.tier,level:x.state.level,exp:+x.state.exp.toFixed(1)}));
  // 拆分测试：把"圣"移走 → 大圣应失效
  b.words.delete(`${nb.c},${nb.r}`);
  const afterSplit=b.activeGenerals().map(x=>x.def.name);
  return { before, act, bond:b.bondActive(), afterSplit, words:b.words.size };
});
await new Promise(r=>setTimeout(r,60));
await page.screenshot({ path: path.join(OUT,'generals.png') });
console.log(JSON.stringify(res,null,1));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
