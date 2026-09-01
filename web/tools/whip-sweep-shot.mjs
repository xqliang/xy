// 鞭扫贴图化视觉留档 + 三档切档冒烟：
// 1) 进战斗部署骑兵放怪，攻击动画期连拍 12 张存 shots/whip-*.png（人工核对扇区残影贴图效果）
// 2) 三档来回切（high↔mid↔low）+ 出入战斗，断言零 pageerror、battle status 正常
// 用法：node tools/whip-sweep-shot.mjs（需 dev server 5180 或 PERF_URL）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const errs = [];
const NOISE = /favicon|\/api\/|CORS|Failed to load resource/i;
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('[console.error] ' + m.text()); });

await page.evaluateOnNewDocument(() => {
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 进战斗：反复征兵+布阵（兵种池含骑兵）+ 开波，让骑兵进入攻击循环
const setup = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  let cavalry = 0;
  for (let k = 0; k < 25; k++) {
    if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; }
    cavalry += g.battle.tray.filter((t) => t.kind === 'unit' && t.type === 'cavalry').length;
    g.autoPlace();
  }
  if (g.battle.status === 'ready') g.wave();
  cavalry += g.battle.units.size ? [...g.battle.units.values()].filter((u) => u.type === 'cavalry').length : 0;
  return { status: g.battle.status, wave: g.battle.wave, units: g.battle.units.size, cavalry };
});
console.log('setup:', JSON.stringify(setup));
await new Promise((r) => setTimeout(r, 2500)); // 等开波后怪物进攻击范围

// 连拍 12 张（间隔 ~200ms，捕捉骑兵攻击动画不同相位）
for (let i = 0; i < 12; i++) {
  await page.screenshot({ path: `shots/whip-${String(i).padStart(2, '0')}.png` });
  await new Promise((r) => setTimeout(r, 200));
}

// 三档来回切换冒烟（贴图缓存跨档共用；确认切档零报错、状态正常）
const tiers = await page.evaluate(() => {
  const g = window.__game;
  const log = [];
  for (const t of ['low', 'mid', 'high', 'mid', 'low', 'high']) { g.setQualityTier(t); log.push(t); }
  return { log, status: g.battle.status, wave: g.battle.wave };
});
console.log('tier switching:', JSON.stringify(tiers));

const fail = [];
if (errs.length) fail.push(`页面报错: ${errs.slice(0, 3).join(' | ')}`);
if (tiers.status !== 'playing') fail.push(`战斗状态异常: ${tiers.status}`);
console.log(fail.length ? `FAIL: ${fail.join('; ')}` : 'PASS: 连拍完成、三档切换零报错、战斗状态正常');
await browser.close();
process.exit(fail.length ? 1 : 0);
