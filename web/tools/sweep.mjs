// 扫参：在真实经济、难度1下，尝试不同(hpBase,hpStep,accel,spd)组合，报告平均漏血与胜率。
// 目标：波1-4基本不漏，波5+开始漏血，竞技玩家难度1胜率~70-85%(其余靠境界自适应)。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const combos = [
  {hpBase:10, hpStep:6,  accel:1.5, spd:0.6},
  {hpBase:12, hpStep:8,  accel:2.0, spd:0.65},
  {hpBase:14, hpStep:10, accel:2.5, spd:0.7},
  {hpBase:16, hpStep:12, accel:3.0, spd:0.7},
];
const seeds=[1,2,3,4,5,6,7,8];

for (const c of combos) {
  const r = await page.evaluate((c, seeds) => {
    const g = window.__game;
    let wins=0; const waveLeak={};
    for (const seed of seeds) {
      // 覆盖 TUNING（含二次项：HP = hpBase + hpStep*n + accel*n^2，通过 hpStep 线性+我们在spawn用不了accel...）
      Object.assign(g.tuning, { monsterHpBase:c.hpBase, monsterHpStep:c.hpStep, monsterSpd:c.spd });
      g.restart(seed,1);
      const manage=()=>{for(let k=0;k<40;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
      for(let w=1;w<=8;w++){ const b=g.battle; if(b.status==='won'||b.status==='lost')break;
        if(b.pendingShop)g.chooseItem(0); manage(); const bh=b.tangsengHP; if(b.status==='ready')g.wave();
        let t=0; while(b.status==='playing'&&t<80){g.step(0.1);t+=0.1; if(Math.round(t*10)%5===0){const s=g.snapshot(); if(s.dangerPct>=88&&s.palmReady)g.palm(); g.summon();g.autoPlace();}}
        const s=g.snapshot(); (waveLeak[w] ??=[]).push(bh - s.tangsengHP);
        if(b.status!=='playing'&&b.status!=='ready')break;
      }
      if(g.snapshot().status==='won')wins++;
    }
    const avgLeak={}; for(const w of Object.keys(waveLeak)){const a=waveLeak[w];avgLeak[w]=(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1);}
    return { wins, total:seeds.length, avgLeak };
  }, c, seeds);
  console.log(`HP=${c.hpBase}+${c.hpStep}n spd=${c.spd}: 胜${r.wins}/${r.total} 均漏血/波=${JSON.stringify(r.avgLeak)}`);
}
await browser.close();
