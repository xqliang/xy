// 扫参2：公平AI下，扫怪物HP/速度 与 AI部署率，报告胜率/胜负来源/双方POW/漏血。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const combos = [
  {hpBase:12, hpStep:8, spd:0.6, aiB:3, aiP:0.8},
  {hpBase:16, hpStep:11, spd:0.62, aiB:3, aiP:1.0},
  {hpBase:20, hpStep:14, spd:0.65, aiB:4, aiP:1.2},
  {hpBase:24, hpStep:18, spd:0.65, aiB:4, aiP:1.4},
];
const seeds=[1,2,3,4,5,6,7,8,9,10];

for (const c of combos) {
  const r = await page.evaluate((c, seeds) => {
    const g = window.__game;
    let wins=0, aiDef=0, survive=0, lost=0; const waveLeak={}; let powP=0,powA=0,n=0;
    for (const seed of seeds) {
      Object.assign(g.tuning, { monsterHpBase:c.hpBase, monsterHpStep:c.hpStep, monsterSpd:c.spd, aiDeployBase:c.aiB, aiDeployPerWave:c.aiP });
      g.restart(seed,1);
      const manage=()=>{for(let k=0;k<40;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
      let src='timeout';
      for(let w=1;w<=8;w++){ const b=g.battle; if(b.status==='won'||b.status==='lost')break;
        if(b.pendingShop)g.chooseItem(0); manage(); const bh=b.tangsengHP;
        const ps=g.snapshot(); powP+=ps.towerPow; powA+=ps.aiPow; n++;
        if(b.status==='ready')g.wave();
        let t=0; while(b.status==='playing'&&t<80){g.step(0.1);t+=0.1; if(Math.round(t*10)%5===0){const s=g.snapshot(); if(s.dangerPct>=88&&s.palmReady)g.palm(); g.summon();g.autoPlace();}}
        const s=g.snapshot(); (waveLeak[w] ??=[]).push(bh - s.tangsengHP);
        if(b.status!=='playing'&&b.status!=='ready'){ src = b.aiDefeated?'ai':(s.status==='won'?'survive':'lost'); break; }
      }
      const f=g.snapshot();
      if(f.status==='won'){wins++; if(src==='ai')aiDef++; else survive++;} else if(f.status==='lost'){lost++;}
    }
    const avgLeak={}; for(const w of Object.keys(waveLeak)){const a=waveLeak[w];avgLeak[w]=(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1);}
    return { wins, total:seeds.length, aiDef, survive, lost, avgLeak, powP:Math.round(powP/n), powA:Math.round(powA/n) };
  }, c, seeds);
  console.log(`HP=${c.hpBase}+${c.hpStep}n spd=${c.spd} AI=${c.aiB}+${c.aiP}n: 胜${r.wins}/${r.total}(击败AI${r.aiDef}/存活${r.survive}) 败${r.lost} | 玩家POW均${r.powP} AIPOW均${r.powA} | 漏血/波=${JSON.stringify(r.avgLeak)}`);
}
await browser.close();
