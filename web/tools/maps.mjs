// 截取 4 张地图的初始画面，验证不同路径/色系。
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const MAPS = ['huoyanshan', 'liushahe', 'baiguling', 'pansidong'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });

for (const id of MAPS) {
  await page.goto(`http://127.0.0.1:5180/?map=${id}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game && window.__game.snapshot');
  await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
  // 布几个兵展示
  await page.evaluate(() => { const g = window.__game; g.enterBattle(); g.grantPeach(200); g.summon(); g.autoPlace(); });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: path.join(OUT, `map-${id}.png`) });
  console.log(id, JSON.stringify(await page.evaluate(() => window.__game.snapshot())).slice(0, 90));
}
await browser.close();
