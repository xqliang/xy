import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.setCacheEnabled(false);
await page.goto('http://127.0.0.1:5180/?seed=7&t=' + Date.now(), { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 注入四种兵器 tier1 / tier5 的飞行特效并冻结在动画峰值，做尺寸对比
await page.evaluate(() => {
  const g = window.__game;
  g.enterBattle();
  const b = g.battle;
  const push = (wtype, tier, r, prog) => {
    // from→to 同排横向，maxTtl 大以便冻结；ttl 决定 prog
    const from = { c: 1, r };
    const to = { c: 5, r };
    const maxTtl = 100;
    b.fx.push({ from, to, ttl: maxTtl * (1 - prog), maxTtl, color: '#7ec46a', wtype, tier });
  };
  // 每种兵器：tier1 一行、tier5 下一行；cavalry 用 prog0.65 看命中环，其余 0.45
  const rows = { monkey: [5, 6], spear: [7, 8], cavalry: [9, 9], archer: [5, 6] };
  push('monkey', 1, 5, 0.45); push('monkey', 5, 6, 0.45);
  push('spear', 1, 7, 0.45); push('spear', 5, 8, 0.45);
  push('archer', 1, 9, 0.45); push('archer', 5, 9, 0.45);
  void rows;
});
await new Promise((r) => setTimeout(r, 30));
await page.screenshot({ path: path.join(OUT, 'fx-tier-compare.png') });
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
