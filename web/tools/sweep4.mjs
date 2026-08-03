// 更真实的"普通玩家"：波前布好阵，波中不微操(不补兵/不放绝招手动)。隔离玩家单路。
// 找到 波1-4基本不漏、波5+明显有压力(漏血) 的怪物参数。怪数保持9+n。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
const combos = [
  {hpBase:16, hpStep:11, spd:0.62, itv:0.6, boss:6},
  {hpBase:20, hpStep:14, spd:0.65, itv:0.55, boss:6},
  {hpBase:26, hpStep:18, spd:0.7, itv:0.5, boss:7},
  {hpBase:32, hpStep:24, spd:0.72, itv:0.45, boss:8},
];
const seeds=[1,2,3,4,5,6,7,8,9,10];
for (const c of combos) {
  const r = await page.evaluate((c, seeds) => {
    const g = window.__game; let wins=0,lost=0; const waveLeak={}; let endWave=[];
    for (const seed of seeds) {
      Object.assign(g.tuning, { monsterHpBase:c.hpBase, monsterHpStep:c.hpStep, monsterSpd:c.spd, spawnInterval:c.itv, bossHpMul:c.boss });
      g.restart(seed,1); g.battle.aiTangsengHP = 999;
      const manage=()=>{for(let k=0;k<40;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
      for(let w=1;w<=8;w++){ const b=g.battle; if(b.status==='won'||b.status==='lost')break;
        if(b.pendingShop)g.chooseItem(0); manage(); const bh=b.tangsengHP; if(b.status==='ready')g.wave();
        let t=0; while(b.status==='playing'&&t<90){g.step(0.1);t+=0.1;} // 波中不微操
        const s=g.snapshot(); (waveLeak[w] ??=[]).push(bh - s.tangsengHP);
        if(b.status==='lost'){endWave.push(w);break;}
      }
      const f=g.snapshot(); if(f.status==='won')wins++; else if(f.status==='lost')lost++;
    }
    const avgLeak={}; for(const w of Object.keys(waveLeak)){const a=waveLeak[w];avgLeak[w]=(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1);}
    return { wins, total:seeds.length, lost, avgLeak };
  }, c, seeds);
  console.log(`HP=${c.hpBase}+${c.hpStep}n spd=${c.spd} 间隔${c.itv}s boss×${c.boss}: 胜${r.wins}/${r.total} 败${r.lost} | 均漏血/波=${JSON.stringify(r.avgLeak)}`);
}
await browser.close();
