// 数值平衡基准：真实经济(不作弊)，难度=1，多seed。报告胜负来源(存活winWave vs 击败AI)、
// 波次、双方唐僧血、玩家每波漏血。用于校准怪物强度与AI公平性。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const seeds = [1,2,3,4,5,6,7,8,9,10];
const rows = await page.evaluate((seeds) => {
  const out = [];
  for (const seed of seeds) {
    const g = window.__game;
    g.restart(seed, 1); // 难度1 (凡人)
    const manage = () => { for (let k=0;k<40;k++){ if(!g.summon()){g.autoPlace(); if(!g.summon())break;} g.autoPlace(); } };
    const perWave = [];
    let src = 'timeout';
    for (let w=0; w<12; w++) {
      const b = g.battle;
      if (b.status==='won'||b.status==='lost') break;
      if (b.pendingShop) g.chooseItem(0);
      manage();
      const beforeHp = b.tangsengHP, beforeAi = b.aiTangsengHP;
      if (b.status==='ready') g.wave();
      let t=0;
      while (b.status==='playing' && t<80) {
        g.step(0.1); t+=0.1;
        if (Math.round(t*10)%5===0){ const s=g.snapshot(); if(s.dangerPct>=88 && s.palmReady) g.palm(); if(g.battle.ultReady()) g.ult(); g.summon(); g.autoPlace(); }
      }
      const s = g.snapshot();
      perWave.push({ w:s.wave, leak: beforeHp - s.tangsengHP, aiLeak: beforeAi - s.aiHp, danger:s.dangerPct });
      if (b.status!=='playing' && b.status!=='ready') { src = b.aiDefeated ? 'ai-defeated' : (s.status==='won'?'survive':'lost'); break; }
    }
    const f = g.snapshot();
    out.push({ seed, status:f.status, wave:f.wave, hp:f.tangsengHP, aiHp:f.aiHp, aiDefeated:f.aiDefeated, src, perWave });
  }
  return out;
}, seeds);

let win=0, aiDef=0, survive=0, lost=0;
for (const r of rows) {
  if (r.status==='won') win++;
  if (r.src==='ai-defeated') aiDef++;
  if (r.src==='survive') survive++;
  if (r.status==='lost') lost++;
  const leaks = r.perWave.map(p=>p.leak).join(',');
  const aiLeaks = r.perWave.map(p=>p.aiLeak).join(',');
  console.log(`seed${r.seed}: ${r.status} wave${r.wave} hp${r.hp} aiHp${r.aiHp} via=${r.src} | 我漏血/波=[${leaks}] AI漏血/波=[${aiLeaks}]`);
}
console.log(`\n汇总(${rows.length}局 难度1): 胜${win} 其中击败AI${aiDef}/存活通关${survive}; 败${lost}`);
await browser.close();
