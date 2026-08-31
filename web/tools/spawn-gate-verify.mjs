import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1010, deviceScaleFactor: 2 });
const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// ---- 1) 大批出怪：确认都从门口(entranceDist)附近冒出，而非被推到门后 1+ 格 ----
const spawnInfo = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, 'huoyanshan');
  g.enterBattle();
  const b = g.battle;
  b.wave = 15;              // 高波 → spawnBatchCap 大 → 一批多只
  b.startNextWave();
  // 步进到一批怪刚冒出
  let snap = null;
  for (let i = 0; i < 30; i++) {
    g.step(1 / 60);
    if (b.monsters.length >= 3) {
      snap = b.monsters.slice(0, 8).map(m => ({ d: +(m.dist - b.entranceDist).toFixed(3), s: +m.spawnT.toFixed(2) }));
      break;
    }
  }
  return {
    entranceDist: +b.entranceDist.toFixed(3),
    gateT: +b.spawnGateT.toFixed(2),
    count: b.monsters.length,
    // 每只相对门口的沿路偏移（应落在 [-0.5, 0]，即贴门后 0~0.5 格）与入场缩放 spawnT
    offsets: snap,
  };
});
await new Promise(r => setTimeout(r, 30));
await page.screenshot({ path: path.join(OUT, 'spawn-gate.png') });
console.log('SPAWN:', JSON.stringify(spawnInfo));

// ---- 2) 唐僧 9 滴血：心是否变小、堆叠是否正常（截图人工看）----
const tsBox = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, 'huoyanshan');
  g.enterBattle();
  g.markNotFirstGame && g.markNotFirstGame();
  const b = g.battle;
  b.tangsengMaxHP = 9; b.tangsengHP = 9;
  for (let i = 0; i < 600; i++) g.step(1 / 60); // 走完入场，唐僧归位
  b.tangsengHP = 9;
  // 玩家唐僧格中心像素（用于裁剪），从渲染模块暴露的换算
  const c = b.map.tangseng;
  return { c: c.c, r: c.r, introDone: b.introDone };
});
await new Promise(r => setTimeout(r, 60));
await page.screenshot({ path: path.join(OUT, 'tangseng-9hp.png') });
// 裁剪玩家唐僧区域（右侧栅栏行附近），放大看心的大小/堆叠
await page.screenshot({ path: path.join(OUT, 'tangseng-9hp-crop.png'), clip: { x: 400, y: 330, width: 160, height: 230 } });
console.log('TANGSENG:', JSON.stringify(tsBox));

// ---- 3) 无尽模式：唐僧默认血应为 5 ----
const endlessHp = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, 'huoyanshan', true); // endless=true
  return { hp: g.battle.tangsengHP, max: g.battle.tangsengMaxHP, endless: g.battle.endless };
});
console.log('ENDLESS:', JSON.stringify(endlessHp));

// ---- 4) 普通模式：唐僧默认血应为 3 ----
const normalHp = await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1, 'huoyanshan', false);
  return { hp: g.battle.tangsengHP, max: g.battle.tangsengMaxHP, endless: g.battle.endless };
});
console.log('NORMAL:', JSON.stringify(normalHp));

console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
