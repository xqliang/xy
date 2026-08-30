import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push('[pageerror] '+e.message)); page.on('console',m=>{ if(m.type()==='error') errs.push('[console.error] '+m.text()); });
await page.goto(process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
// 全流程：菜单各屏 + 一整局到通关
const res = await page.evaluate(()=>{
  const g=window.__game;
  g.openCodex(); g.openRank();
  g.restart(7,1); g.enterBattle();
  const manage=()=>{for(let k=0;k<30;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
  for(let w=0;w<10;w++){ const b=g.battle; if(b.status==='won'||b.status==='lost')break; if(b.pendingShop)g.chooseItem(0); manage(); if(b.status==='ready')g.wave(); let t=0; while(b.status==='playing'&&t<80){g.step(0.1);t+=0.1; g.triggerActive(0);g.triggerActive(1);} }
  return g.snapshot();
});
console.log('end:', JSON.stringify(res));
console.log('errors:', errs.join('\n')||'(none)');
await browser.close();
