import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
// tray 槽位几何(与 render.ts 常量一致)：TRAY_Y=772, 槽中心y=811
const TRAY_LEFT = 80, TRAY_SLOT = 74, SLOT_CY = 811;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5180/?seed=5', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// —— 场景A：放一个棍猴(rge=1)并选中，看范围环是否覆盖整格 ——
const geo = await page.evaluate(() => {
  const g = window.__game; g.restart(5, 1); g.enterBattle();
  let placed = null;
  for (let k = 0; k < 40 && !placed; k++) {
    g.grantPeach(200); g.summon();
    const cells = g.battle.unlockedCells();
    for (let i = 0; i < g.battle.tray.length && !placed; i++) {
      const t = g.battle.tray[i];
      if (t && t.kind === 'unit' && t.type === 'dao') {
        for (const c of cells) {
          const key = `${c.c},${c.r}`;
          if (!g.battle.units.has(key) && !g.battle.words.has(key) && g.placeFromTray(i, c)) { placed = { c, type: t.type }; break; }
        }
      }
    }
  }
  // 若没抽到棍猴就退而用任意 unit
  if (!placed) for (let k = 0; k < 40 && !placed; k++) {
    g.grantPeach(200); g.summon();
    const cells = g.battle.unlockedCells();
    for (let i = 0; i < g.battle.tray.length && !placed; i++) {
      const t = g.battle.tray[i];
      if (t && t.kind === 'unit') for (const c of cells) {
        const key = `${c.c},${c.r}`;
        if (!g.battle.units.has(key) && !g.battle.words.has(key) && g.placeFromTray(i, c)) { placed = { c, type: t.type }; break; }
      }
    }
  }
  if (placed) g.select(placed.c);
  return { placed };
});
await new Promise(r => setTimeout(r, 120));
await page.screenshot({ path: path.join(OUT, 'range-select.png') });

// 清掉选中，准备场景B
await page.evaluate(() => window.__game.select(null));

// —— 场景B：按住 tray 里的一个 unit 令牌，看信息面板+范围环 ——
const trayInfo = await page.evaluate(() => {
  const g = window.__game;
  for (let k = 0; k < 20; k++) {
    if (g.battle.tray.some(t => t && t.kind === 'unit')) break;
    g.grantPeach(200); g.summon();
  }
  const idx = g.battle.tray.findIndex(t => t && t.kind === 'unit');
  return { idx, tray: g.battle.tray.map(t => t ? (t.kind === 'unit' ? t.type : t.kind) : null) };
});
if (trayInfo.idx >= 0) {
  const sx = TRAY_LEFT + trayInfo.idx * TRAY_SLOT + TRAY_SLOT / 2;
  await page.mouse.move(sx, SLOT_CY);
  await page.mouse.down();
  await page.mouse.move(sx, SLOT_CY - 10); // 轻微移动进入拖拽态
  await new Promise(r => setTimeout(r, 150));
  await page.screenshot({ path: path.join(OUT, 'tray-hold.png') });
  await page.mouse.up();
}

console.log('placed:', JSON.stringify(geo));
console.log('trayInfo:', JSON.stringify(trayInfo));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
