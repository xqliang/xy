// tools/burnfx.mjs —— 验证：①怪物身上连续火烧特效；②帧率降档减少灼烧/冰冻粒子（draw 耗时对比）；③档位 clamp。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5190/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const res = await page.evaluate(async () => {
  const g = window.__game;
  g.restart(7); g.enterBattle();
  const manage = () => { for (let k = 0; k < 30; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); } };
  if (g.battle.pendingShop) g.chooseItem(0);
  g.grantPeach(600); manage(); g.wave();
  for (let i = 0; i < 500; i++) { g.step(1 / 30); if (g.battle.monsters.length >= 3 && i > 120) break; }
  const b = g.battle;
  const { draw, setFxQuality, getFxQuality } = await import('/src/render.ts');
  const ui = {
    dragFrom: null, dragTrayIndex: null, dragPos: null, dragActiveSlot: null, activeDragStart: null,
    trayDragStart: null, selected: null, selectedTrayIndex: null, selectedMonster: null,
    passivePopup: null, passivePopupUntil: 0, activePopup: null, activePopupUntil: 0,
    aiItemPopup: null, peachPopup: false, bombPopup: null, paused: false,
  };
  const cv = document.createElement('canvas');
  cv.width = 560; cv.height = 1044; cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  // ① 截图：给现有怪全部点燃（+一只冻结对照），满档渲染一帧
  const real = b.monsters.slice();
  for (let i = 0; i < real.length; i++) { real[i].burnT = 2.0; real[i].burnDps = 5; }
  if (real[0]) real[0].frozenT = 2.0; // 顺带看冰冻仍在（取燃烧中段，避开淡入淡出的 vis=0）
  setFxQuality(1);
  draw(ctx, b, ui);

  // ② 微基准：40 只燃烧怪，对比满档(1) vs 省档(0.4) 的 draw 平均耗时
  const many = [];
  const proto = real[0] ?? { hp: 100, maxHp: 100, isBoss: false, isMiniBoss: false, spd: 0, hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 1, stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnDps: 5, miniBossKind: null, isCavalry: false };
  for (let i = 0; i < 40; i++) many.push({ ...proto, id: 1000 + i, dist: 2 + (i % 8) + (i / 40), burnT: 2.0, burnDps: 5, frozenT: i % 3 === 0 ? 2.0 : 0, stunT: 0 });
  b.monsters = many;
  const bench = (q, iters) => { setFxQuality(q); draw(ctx, b, ui); const t0 = performance.now(); for (let k = 0; k < iters; k++) draw(ctx, b, ui); return (performance.now() - t0) / iters; };
  const high = bench(1, 300);
  const low = bench(0.4, 300);

  // ③ clamp 断言
  setFxQuality(5); const cHi = getFxQuality();
  setFxQuality(-1); const cLo = getFxQuality();
  setFxQuality(1);

  return { monsters: real.length, benchHighMs: +high.toFixed(3), benchLowMs: +low.toFixed(3), speedup: +(high / low).toFixed(2), clampHigh: cHi, clampLow: cLo };
});
await new Promise((r) => setTimeout(r, 80));
await page.screenshot({ path: path.join(OUT, 'burnfx.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
