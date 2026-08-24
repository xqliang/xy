// tools/general-panel-smoke.mjs —— 武将信息面板「底部增益行贴边/出框」修复的冒烟截图。
// 构造最拥挤组合：激活大圣（羁绊详情两行）+ 神兵 + 被动攻/速 + 炼丹 + 仙丹/风火轮双芯片 +
// 多行技能描述 → 面板高度必须盖住所有增益行（截图人工核对底边距）。
// 另截未激活面板（底部橙色提示行 vs 属性行不重叠）。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5181/?seed=5', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
await page.evaluate(() => {
  const g = window.__game; g.restart(5, 1); g.enterBattle(); const b = g.battle;
  const cells = b.unlockedCells(); const a = cells[0], nb = { c: a.c + 1, r: a.r };
  b.words.set(`${a.c},${a.r}`, { char: '大', general: 'dasheng', tier: 2, cell: a });
  b.words.set(`${nb.c},${nb.r}`, { char: '圣', general: 'dasheng', tier: 1, cell: nb }); // 激活(取较小阶=1)
  const lone = cells.find((x) => x.c !== a.c && x.c !== nb.c && x.r === a.r + 1) || cells[3];
  b.words.set(`${lone.c},${lone.r}`, { char: '八', general: 'bajie', tier: 1, cell: lone }); // 未激活
  const act = b.activeGenerals()[0];
  // 拥挤构造：神兵 + 炼丹 + 仙丹/风火轮 + 全局被动攻/速（羁绊行由 showBondDetail 换成详情两行）
  b.weaponBonuses['dasheng'] = { atk: 0.25, frq: 0, rge: 0 };
  act.state.buffAtkT = 5; act.state.buffAtkMul = 1.5;
  act.pillAtk = 5; act.pillFrq = 5;
  b.mods = { ...b.mods, atkMul: 1.25, frqMul: 1.2 };
  g.select(a);
});
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: path.join(OUT, 'general-panel-crowded.png') });
await page.evaluate(() => {
  const g = window.__game, b = g.battle;
  const lone = [...b.words.values()].find((w) => w.general === 'bajie');
  g.select(lone.cell);
});
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: path.join(OUT, 'general-panel-inactive.png') });
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
