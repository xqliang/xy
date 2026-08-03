// 测量真实经济下玩家每波"备战完成时"的塔总POW，用于按文章约束(怪总POW < 玩家POW上限)校准怪物HP。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
const seeds=[1,2,3,4,5];
const res = await page.evaluate((seeds) => {
  const perWave = {};
  for (const seed of seeds) {
    const g = window.__game; g.restart(seed,1);
    const manage = () => { for (let k=0;k<40;k++){ if(!g.summon()){g.autoPlace(); if(!g.summon())break;} g.autoPlace(); } };
    for (let w=1; w<=8; w++) {
      const b=g.battle; if(b.status==='won'||b.status==='lost')break;
      if(b.pendingShop)g.chooseItem(0); manage();
      const pow = g.snapshot().towerPow; // 备战完成时的塔POW
      (perWave[w] ??= []).push(pow);
      if(b.status==='ready')g.wave();
      let t=0; while(b.status==='playing'&&t<80){ g.step(0.1); t+=0.1; if(Math.round(t*10)%5===0){g.summon();g.autoPlace();} }
    }
  }
  const avg={}; for(const w of Object.keys(perWave)){ const a=perWave[w]; avg[w]=Math.round(a.reduce((s,x)=>s+x,0)/a.length); }
  return avg;
}, seeds);
console.log('玩家每波备战POW(均值):');
for(const w of Object.keys(res)) console.log(`  wave${w}: 塔POW≈${res[w]}   怪数=${9+Number(w)}   建议怪总POW(70%)≈${Math.round(res[w]*0.7)}   → 每怪POW≈${Math.round(res[w]*0.7/(9+Number(w)))}   (SPD0.55→HP≈${Math.round(res[w]*0.7/(9+Number(w))/0.55)})`);
await browser.close();
