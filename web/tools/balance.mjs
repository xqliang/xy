// 真实经济平衡自测：不作弊（不 grantPeach），用启发式策略自动游玩，观察节奏。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'http://127.0.0.1:5180/?seed=7';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(GAME_URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const trace = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7);
  const manage = () => {
    for (let k = 0; k < 40; k++) {
      if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; }
      g.autoPlace();
    }
  };
  const log = [];
  for (let w = 0; w < 15; w++) {
    if (g.battle.status === 'won' || g.battle.status === 'lost') break;
    if (g.battle.pendingShop) g.chooseItem(0);
    manage();
    const before = g.snapshot();
    g.wave();
    let t = 0;
    while (g.battle.status === 'playing' && t < 80) {
      g.step(0.1); t += 0.1;
      if (Math.round(t * 10) % 5 === 0) {
        const s = g.snapshot();
        if (s.dangerPct >= 85 && s.palmReady) g.palm();
        g.summon(); g.autoPlace();
      }
    }
    const after = g.snapshot();
    log.push({ wave: after.wave, 备战单位: before.units, 备战桃: before.peach, 清完桃: after.peach, 唐僧血: after.tangsengHP, status: after.status });
  }
  return { final: g.snapshot(), log };
});

console.log('最终:', JSON.stringify(trace.final));
console.log('逐波:');
for (const r of trace.log) console.log('  ' + JSON.stringify(r));
await browser.close();
