// 多种子胜率测量：同一启发式策略跑 N 个种子×若干难度，统计通关率，用于难度调平。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME_URL = 'http://127.0.0.1:5180/';
const SEEDS = Number(process.argv[2] ?? 20);
const DIFFS = (process.argv[3] ?? '1.0,1.4,1.8').split(',').map(Number);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(GAME_URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const runOne = (seed, diff) =>
  page.evaluate((seed, diff) => {
    const g = window.__game;
    g.restart(seed, diff);
    const manage = () => {
      for (let k = 0; k < 40; k++) {
        if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; }
        g.autoPlace();
      }
    };
    for (let w = 0; w < 15; w++) {
      if (g.battle.status === 'won' || g.battle.status === 'lost') break;
      if (g.battle.pendingShop) g.chooseItem(0);
      manage();
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
    }
    const s = g.snapshot();
    return { status: s.status, wave: s.wave };
  }, seed, diff);

for (const diff of DIFFS) {
  let wins = 0;
  const waves = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = await runOne(seed, diff);
    if (r.status === 'won') wins++;
    waves.push(r.wave);
  }
  const rate = ((wins / SEEDS) * 100).toFixed(0);
  const avgWave = (waves.reduce((a, b) => a + b, 0) / SEEDS).toFixed(1);
  console.log(`难度 ${diff.toFixed(2)}: 胜率 ${rate}% (${wins}/${SEEDS})，平均到达波次 ${avgWave}`);
}
await browser.close();
