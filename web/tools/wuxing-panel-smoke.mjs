// tools/wuxing-panel-smoke.mjs —— 武将信息面板「五行克制行」修复验证：
//  ① 五行行(py+50)不再与「技能」行重叠（此前 py+50 vs py+52 挤在一起）；
//  ② 五行元素名显示中文（克木/被木克），不显示英文 wood。
// 构造：土地图(huangfengling)+木将(铁扇)→木克土=adv→面板出现「克木 +25% 伤害」。
// 断言走截图人工核对（画布被 CDN 图污染无法采样像素）。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5183/?seed=5';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
// 关掉所有新手引导（含五行地图引导 wuxingMap），否则引导弹窗会盖住武将面板顶部的五行/技能行
await page.evaluateOnNewDocument(() => {
  const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
    'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina', 'wuxingMap'];
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen: Object.fromEntries(ids.map((i) => [i, true])) }));
  localStorage.setItem('dasheng.playedOnce', '1');
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const info = await page.evaluate(async () => {
  const g = window.__game;
  g.restart(5, 1, 'huangfengling'); // 土地图（黄风岭）
  g.enterBattle();
  const b = g.battle;
  const cells = b.unlockedCells();
  const a = cells[0], nb = { c: a.c + 1, r: a.r };
  // 木将「铁扇」(铁/扇)：木克土 → 在土地图上 adv → 面板应显示「克木 +25% 伤害」
  b.words.set(`${a.c},${a.r}`, { char: '铁', general: 'tieshan', tier: 2, cell: a });
  b.words.set(`${nb.c},${nb.r}`, { char: '扇', general: 'tieshan', tier: 1, cell: nb });
  const act = b.activeGenerals().find((x) => x.def.id === 'tieshan');
  g.select(a);
  const bt = await import('/src/battle.ts');
  const wx = await import('/src/wuxing-ui.ts');
  const mapEl = bt.MAP_ELEMENT[b.map.id];
  return {
    mapId: b.map.id, mapEl,
    heroEl: act?.def.element ?? '(未激活)',
    rel: wx.counterRelation(act?.def.element, mapEl),
    activated: !!act,
  };
});
console.log('场景:', JSON.stringify(info));
await sleep(250);
await page.screenshot({ path: path.join(OUT, 'wuxing-panel.png') });
console.log('截图: shots/wuxing-panel.png');
console.log('errors:', logs.join('\n') || '(none)');
if (!info.activated) console.log('⚠️ 铁扇未激活，面板可能不含技能行');
if (info.rel !== 'adv') console.log('⚠️ 预期 adv(克)，实际:', info.rel);
await browser.close();
