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

  const mergeAll = () => {
    for (let pass = 0; pass < 30; pass++) {
      const arr = [...g.battle.units.values()];
      let did = false;
      for (let i = 0; i < arr.length && !did; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (arr[i].type === arr[j].type && arr[i].tier === arr[j].tier) {
            if (g.drag(arr[i].cell, arr[j].cell)) { did = true; break; }
          }
        }
      }
      if (!did) break;
    }
  };
  const manage = () => {
    mergeAll();
    // 有空阵位就召唤到买不起为止
    for (let k = 0; k < 30; k++) if (!g.summon()) break;
    mergeAll();
    // 蟠桃富裕则开阵位再补召唤
    while (g.battle.peach > 40 && g.open()) {
      for (let k = 0; k < 10; k++) if (!g.summon()) break;
      mergeAll();
    }
  };

  const log = [];
  for (let w = 0; w < 15; w++) {
    const st = g.battle.status;
    if (st === 'won' || st === 'lost') break;
    manage();               // 备战
    const before = g.snapshot();
    g.wave();               // 开波
    // 战斗推进
    let t = 0;
    while (g.battle.status === 'playing' && t < 80) {
      g.step(0.1); t += 0.1;
      if (Math.round(t * 10) % 5 === 0) {   // 每 0.5s 运营一次
        const s = g.snapshot();
        if (s.dangerPct >= 85 && s.palmReady) g.palm();
        g.summon(); // 有钱有位就补
        mergeAll();
      }
    }
    const after = g.snapshot();
    log.push({
      wave: after.wave,
      备战单位: before.units,
      备战桃: before.peach,
      清完桃: after.peach,
      唐僧血: after.tangsengHP,
      status: after.status,
    });
  }
  return { final: g.snapshot(), log };
});

console.log('最终:', JSON.stringify(trace.final));
console.log('逐波:');
for (const r of trace.log) console.log('  ' + JSON.stringify(r));
await browser.close();
