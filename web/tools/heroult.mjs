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

const heroes = [
  'nezha', 'erlang', 'niulang',
  'dasheng', 'honghaier', 'bajie', 'tieshan', 'shaseng', 'niumowang', 'guanyin', 'laojun', 'wenshu',
  'baigujing', 'tangseng',
  'damang', 'jinzha', 'hongpao', 'baxian', 'qingniu', 'tiebei', 'liusha', 'fanyin', 'danjun', 'huishu',
  'bailong',
];
for (const id of heroes) {
  await page.evaluate((heroId) => {
    const g = window.__game; g.enterBattle();
    const b = g.battle;
    b.heroUltFx = [];
    const cx = 4, cy = 3; // 上半场爆心
    b.heroUltFx.push({ heroId, c: cx, r: cy, ttl: 0.36, maxTtl: 0.6, tier: 5, rge: 2.5, crit: heroId === 'nezha' || heroId === 'erlang', critDmg: 999 });
    g.step(0.001); // 触发一次渲染（peak≈prog 0.4）
  }, id);
  await new Promise((r) => setTimeout(r, 60));
  await page.screenshot({ path: path.join(OUT, `heroult-${id}.png`) });
}
console.log(logs.length ? logs.join('\n') : 'heroult OK: ' + heroes.length + ' shots');
await browser.close();
if (logs.length) process.exit(1);
