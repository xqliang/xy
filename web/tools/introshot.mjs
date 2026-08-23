// tools/introshot.mjs —— 验证：①菜单/加载页标题已改「悟空救我」；②唐僧开局出场气泡。
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
await page.goto('http://127.0.0.1:5181/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 400));
// ① 菜单标题
await page.screenshot({ path: path.join(OUT, 'title-menu.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });

// ② 唐僧出场气泡：隔离渲染（构造单机电池，置 intro 中途 + 强制台词，整帧 draw 到自建画布）
const res = await page.evaluate(async () => {
  const { Battle, NO_META } = await import('/src/battle.ts');
  const { draw } = await import('/src/render.ts');
  const { MAPS } = await import('/src/board.ts');
  const b = new Battle(7, 1, MAPS[0], NO_META, {}, [], [], false, undefined, 1, undefined, {});
  b.introDone = false;
  b.introT = 3.0;              // 出场行走中途（INTRO_DUR=6，气泡窗口 [2.1,4.3]）
  b.introSpeech = '妖怪来了！'; // 强制展示（正常 50% 概率由 rollIntroSpeech 掷定）
  const cv = document.createElement('canvas');
  cv.width = 560; cv.height = 1044;
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  document.body.appendChild(cv);
  const ui = {
    dragFrom: null, dragTrayIndex: null, dragPos: null, dragActiveSlot: null, activeDragStart: null,
    trayDragStart: null, selected: null, selectedTrayIndex: null, selectedMonster: null,
    passivePopup: null, passivePopupUntil: 0, activePopup: null, activePopupUntil: 0,
    aiItemPopup: null, peachPopup: false, bombPopup: null, paused: false,
  };
  draw(cv.getContext('2d'), b, ui);
  // 顺带回报：气泡透明度不为 0（在窗口内）
  return { introT: b.introT, introSpeech: b.introSpeech, tangsengPos: b.tangsengRenderPos() };
});
await new Promise((r) => setTimeout(r, 80));
await page.screenshot({ path: path.join(OUT, 'intro-bubble.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });
console.log('bubble render:', JSON.stringify(res));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
