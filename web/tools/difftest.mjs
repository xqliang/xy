// 跨境界(难度)胜率与手感：难度1/1.5/2.0/2.5，真实经济+超人启发式。观察胜率是否随难度下降。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
const diffs=[1,1.5,2.0,2.5];
const seeds=[1,2,3,4,5,6,7,8,9,10,11,12];
for (const diff of diffs) {
  const r = await page.evaluate((diff, seeds) => {
    const g=window.__game; let aiDef=0,survive=0,lost=0; let endW=[];
    for(const seed of seeds){
      g.restart(seed,diff);
      const manage=()=>{for(let k=0;k<40;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
      let src='timeout';
      for(let w=1;w<=8;w++){const b=g.battle; if(b.status==='won'||b.status==='lost')break;
        if(b.pendingShop)g.chooseItem(0); manage(); if(b.status==='ready')g.wave();
        let t=0; while(b.status==='playing'&&t<80){g.step(0.1);t+=0.1; if(Math.round(t*10)%5===0){const s=g.snapshot(); if(s.dangerPct>=88&&s.palmReady)g.palm(); g.triggerActive(0);g.triggerActive(1); g.summon();g.autoPlace();}}
        if(b.status!=='playing'&&b.status!=='ready'){src=b.aiDefeated?'ai':(g.snapshot().status==='won'?'survive':'lost');break;}
      }
      const f=g.snapshot(); endW.push(f.wave);
      if(f.status==='won'){if(src==='ai')aiDef++; else survive++;} else if(f.status==='lost')lost++;
    }
    return {aiDef,survive,lost,total:seeds.length,avgEnd:(endW.reduce((s,x)=>s+x,0)/endW.length).toFixed(1)};
  }, diff, seeds);
  const win=r.aiDef+r.survive;
  console.log(`难度${diff}: 胜${win}/${r.total}(${Math.round(win/r.total*100)}%) 击败AI${r.aiDef} 存活${r.survive} 败${r.lost} 平均结束波${r.avgEnd}`);
}
await browser.close();
