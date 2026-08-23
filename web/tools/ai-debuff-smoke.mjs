// tools/ai-debuff-smoke.mjs —— AI 半场怪物施法（减益）真实对局冒烟。
// 白骨岭连开多波，观测上半场：带技能怪的施法爆点、AI 兵器 stunT>0（被定身停手）。
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');

const res = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, 'baiguling');
  g.enterBattle();
  g.buildDefense(400);
  if (g.grantPeach) g.grantPeach(3000);
  const stats = { waves: 0, aiCastFlashes: 0, aiStunnedMax: 0, aiUnitsMax: 0, aiSkillMonMax: 0 };
  for (let w = 0; w < 9; w++) {
    if (!g.wave()) break;
    stats.waves++;
    for (let i = 0; i < 40 * 30; i++) {
      g.step(1 / 30);
      const b = g.battle;
      let stunned = 0;
      for (const u of b.aiUnits) if (u.stunT > 0 || u.slowT > 0 || u.weakenT > 0) stunned++;
      stats.aiStunnedMax = Math.max(stats.aiStunnedMax, stunned);
      stats.aiUnitsMax = Math.max(stats.aiUnitsMax, b.aiUnits.length);
      stats.aiSkillMonMax = Math.max(stats.aiSkillMonMax, b.aiMonsters.filter((m) => m.skill).length);
      for (const m of b.aiMonsters) if (m.castFlash >= 0.99) stats.aiCastFlashes++;
      if (b.monsters.length === 0 && i > 30) { if (g.grantPeach) g.grantPeach(500); g.buildDefense(300); break; }
    }
  }
  return stats;
});
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
