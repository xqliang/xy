import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new', args:['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width:560, height:1010, deviceScaleFactor:2 });
const traces=[]; page.on('console',m=>{ const t=m.text(); if(t.includes('NEGARC')) traces.push(t); });
await page.goto('http://127.0.0.1:5180/?seed=7',{waitUntil:'networkidle0'});
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true',{timeout:15000}).catch(()=>{});
await page.evaluate(()=>{ const proto=CanvasRenderingContext2D.prototype; const orig=proto.arc;
  proto.arc=function(x,y,r,...rest){ if(!(r>=0)) console.log('NEGARC r='+r+' | '+(new Error().stack.split('\n').slice(1,4).map(s=>s.trim()).join(' << '))); return orig.call(this,x,y,Math.max(0,r||0),...rest); }; });
await page.evaluate(()=>{ const g=window.__game; g.restart(7,1); g.enterBattle();
  for(let k=0;k<20;k++){ if(!g.summon()){g.autoPlace(); if(!g.summon())break;} g.autoPlace(); }
  g.grantPeach(300); g.wave();
  for(let i=0;i<30;i++){ g.fastForward(0.3); } }); // fastForward 内部会 draw
console.log('NEG count:', traces.length); console.log([...new Set(traces)].slice(0,4).join('\n'));
await browser.close();
