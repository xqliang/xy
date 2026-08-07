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
  const g=window.__game, b=g.battle;
  g.restart(5,1); g.enterBattle();
  const cells=b.unlockedCells();
  const a=cells[0], far=cells[4];
  // 放 大 在 a，圣 在远处 → 未激活
  b.words.set(`${a.c},${a.r}`,{char:'大',general:'wukong',tier:1,cell:a});
  b.words.set(`${far.c},${far.r}`,{char:'圣',general:'wukong',tier:1,cell:far});
  const step1 = b.activeGenerals().length;
  // 拖 圣 到 大 右边 → 应激活
  const nb={c:a.c+1,r:a.r};
  const moved = b.dragBoard(far, nb);
  const step2 = b.activeGenerals().map(x=>x.def.name);
  // 再把 圣 拖走 → 应拆分
  const split = b.dragBoard(nb, far);
  const step3 = b.activeGenerals().length;
  // 同字同阶升阶：再放一个 大 拖到 大 上
  b.words.set(`${far.c},${far.r}`,{char:'大',general:'wukong',tier:1,cell:far});
  b.dragBoard(far, a);
  const tierAfter = b.words.get(`${a.c},${a.r}`).tier;
  return { step1_notAdjacent:step1, moved, step2_activated:step2, split, step3_afterSplit:step3, tierAfterMerge:tierAfter, msg:b.message };
});
await new Promise(r=>setTimeout(r,60));
await page.screenshot({ path: path.join(OUT,'dragword.png') });
console.log(JSON.stringify(res,null,1));
console.log('errors:', logs.join('\n')||'(none)');
await browser.close();
