import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 驱动到战斗中，步进到有单位正在出招(firePulse 处于中段)时截图
const info = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 24; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  g.grantPeach(400);
  for (let k = 0; k < 24; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  g.wave();
  const midFiring = () => [...g.battle.units.values()].filter((u) => u.firePulse > 0.35 && u.firePulse < 0.9).length;
  for (let i = 0; i < 400; i++) { g.step(1 / 60); if (g.battle.monsters.length >= 4 && midFiring() >= 2) break; }
  const combos = [...g.battle.units.values()].filter((u) => u.combo > 0).map((u) => u.type + ':' + u.combo);
  return { units: g.battle.units.size, firing: midFiring(), combos };
});
await new Promise((r) => setTimeout(r, 30));
await page.screenshot({ path: path.join(OUT, 'weapons-firing.png') });

// 验证卡槽 bug 修复：让所有单位刚开火(firePulse=1)，切到波间 'ready'，步进 0.5s 后 firePulse 应≈0
const bug = await page.evaluate(() => {
  const g = window.__game;
  for (const u of g.battle.units.values()) u.firePulse = 1;
  g.battle.status = 'ready'; g.battle.waveActive = false; g.battle.introDone = true; g.battle.wave = 1;
  let maxPulse = 0;
  for (let i = 0; i < 30; i++) g.step(1 / 60); // 0.5s，全在 'ready' 状态
  for (const u of g.battle.units.values()) maxPulse = Math.max(maxPulse, u.firePulse);
  return { maxPulseAfterReady: Number(maxPulse.toFixed(4)) };
});

console.log('info:', JSON.stringify(info));
console.log('bugfix:', JSON.stringify(bug), bug.maxPulseAfterReady <= 0.02 ? 'PASS (无卡槽)' : 'FAIL (仍有残留)');
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
