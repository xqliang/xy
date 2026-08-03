// 扫AI部署率，使AI战力≈玩家，游戏不再2波速通。报告平均结束波次/胜负来源/双方POW。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
const combos = [ {b:8,p:1.5},{b:10,p:2},{b:12,p:2.5},{b:14,p:3} ];
const seeds=[1,2,3,4,5,6,7,8,9,10];
for (const c of combos) {
  const r = await page.evaluate((c, seeds) => {
    const g = window.__game; let aiDef=0,survive=0,lost=0; let endW=[]; let pP=0,pA=0,n=0;
    for (const seed of seeds) {
      Object.assign(g.tuning, { aiDeployBase:c.b, aiDeployPerWave:c.p });
      g.restart(seed,1);
      const manage=()=>{for(let k=0;k<40;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
      let src='timeout';
      for(let w=1;w<=8;w++){ const b=g.battle; if(b.status==='won'||b.status==='lost')break;
        if(b.pendingShop)g.chooseItem(0); manage();
        const ps=g.snapshot(); pP+=ps.towerPow; pA+=ps.aiPow; n++;
        if(b.status==='ready')g.wave();
        let t=0; while(b.status==='playing'&&t<80){g.step(0.1);t+=0.1; if(Math.round(t*10)%5===0){const s=g.snapshot(); if(s.dangerPct>=88&&s.palmReady)g.palm(); g.summon();g.autoPlace();}}
        if(b.status!=='playing'&&b.status!=='ready'){ src=b.aiDefeated?'ai':(g.snapshot().status==='won'?'survive':'lost'); break; }
      }
      const f=g.snapshot(); endW.push(f.wave);
      if(f.status==='won'){ if(src==='ai')aiDef++; else survive++; } else if(f.status==='lost')lost++;
    }
    return { aiDef, survive, lost, avgEnd:(endW.reduce((s,x)=>s+x,0)/endW.length).toFixed(1), pP:Math.round(pP/n), pA:Math.round(pA/n) };
  }, c, seeds);
  console.log(`AI=${c.b}+${c.p}n: 击败AI${r.aiDef} 存活${r.survive} 败${r.lost} 平均结束波${r.avgEnd} | 玩家POW均${r.pP} AIPOW均${r.pA}`);
}
await browser.close();
