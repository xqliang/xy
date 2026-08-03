// 隔离玩家单路压力：把AI唐僧血设为极高(不因击败AI提前结束)，扫 HP/速度/出怪间隔，
// 直到"超人级"启发式玩家也会漏血/偶尔失败。怪数保持文章的9+n不变。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
const combos = [
  {hpBase:20, hpStep:14, spd:0.7,  itv:0.5},
  {hpBase:30, hpStep:22, spd:0.8,  itv:0.4},
  {hpBase:40, hpStep:30, spd:0.9,  itv:0.3},
  {hpBase:55, hpStep:42, spd:1.0,  itv:0.28},
];
const seeds=[1,2,3,4,5,6,7,8,9,10];
for (const c of combos) {
  const r = await page.evaluate((c, seeds) => {
    const g = window.__game; let wins=0,lost=0; const waveLeak={};
    for (const seed of seeds) {
      Object.assign(g.tuning, { monsterHpBase:c.hpBase, monsterHpStep:c.hpStep, monsterSpd:c.spd, spawnInterval:c.itv });
      g.restart(seed,1); g.battle.aiTangsengHP = 999; // 隔离：AI不死
      const manage=()=>{for(let k=0;k<40;k++){if(!g.summon()){g.autoPlace();if(!g.summon())break;}g.autoPlace();}};
      for(let w=1;w<=8;w++){ const b=g.battle; if(b.status==='won'||b.status==='lost')break;
        if(b.pendingShop)g.chooseItem(0); manage(); const bh=b.tangsengHP; if(b.status==='ready')g.wave();
        let t=0; while(b.status==='playing'&&t<90){g.step(0.1);t+=0.1; if(Math.round(t*10)%5===0){const s=g.snapshot(); if(s.dangerPct>=90&&s.palmReady)g.palm(); g.summon();g.autoPlace();}}
        const s=g.snapshot(); (waveLeak[w] ??=[]).push(bh - s.tangsengHP);
        if(b.status==='lost')break;
      }
      const f=g.snapshot(); if(f.status==='won')wins++; else if(f.status==='lost')lost++;
    }
    const avgLeak={}; for(const w of Object.keys(waveLeak)){const a=waveLeak[w];avgLeak[w]=(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1);}
    return { wins, total:seeds.length, lost, avgLeak };
  }, c, seeds);
  console.log(`HP=${c.hpBase}+${c.hpStep}n spd=${c.spd} 间隔${c.itv}s: 胜${r.wins}/${r.total} 败${r.lost} | 均漏血/波=${JSON.stringify(r.avgLeak)}`);
}
await browser.close();
