// tools/ai-lion-smoke.mjs —— 黄狮精在 AI 半场卷走的运行时冒烟（隔离渲染）。
// 断言：AI lion 施法卷走 aiUnits、stealFx 幽灵落在上半场（r<5）、整帧 draw 不抛错。
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5180/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const res = await page.evaluate(async () => {
  const { Battle, NO_META } = await import('/src/battle.ts');
  const { draw } = await import('/src/render.ts');
  const { MAPS } = await import('/src/board.ts');
  const b = new Battle(1, 1, MAPS[0], NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: false });
  b.introDone = true; b.status = 'playing';
  const lion = {
    id: 1, dist: 3, hp: 100, maxHp: 100, spd: 0, isBoss: false, isMiniBoss: true, miniBossKind: 'lion',
    isCavalry: false, hitFlash: 0, skill: null, skillCd: 0.01, castFlash: 0, spawnT: 1,
    stunT: 0, frozenT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0, miniBossCasted: false,
  };
  const p = b.aiMonsterPos(lion);
  b.aiMonsters = [lion];
  b.aiUnits = [
    { type: 'dao', tier: 1, cell: { c: p.c, r: p.r }, cooldown: 0, firePulse: 0, combo: 0, fireDir: 0,
      stunT: 0, slowT: 0, weakenT: 0, rangeCutT: 0, knockdownT: 0, stunImmuneT: 0, slowImmuneT: 0, weakenImmuneT: 0, rangeCutImmuneT: 0, knockdownImmuneT: 0 },
  ];
  b.aiWords.set(`${p.c + 1},${p.r}`, { char: '大', general: 'dasheng', tier: 1, cell: { c: p.c + 1, r: p.r } });
  b.aiTangsengHP = 10;
  for (let t = 0; t < 0.5; t += 1 / 30) b.step(1 / 30);
  const cv = document.createElement('canvas');
  cv.width = 560; cv.height = 1044;
  const ctx = cv.getContext('2d');
  const ui = {
    dragFrom: null, dragTrayIndex: null, dragPos: null, dragActiveSlot: null, activeDragStart: null,
    trayDragStart: null, selected: null, selectedTrayIndex: null, selectedMonster: null,
    passivePopup: null, passivePopupUntil: 0, activePopup: null, activePopupUntil: 0,
    aiItemPopup: null, peachPopup: false, bombPopup: null, paused: false,
  };
  draw(ctx, b, ui);
  return {
    aiUnitsLeft: b.aiUnits.length,
    wordsLeft: b.aiWords.size,
    casted: lion.miniBossCasted,
    ghostAt: b.stealFx.map((s) => ({ kind: s.kind, c: s.c, r: s.r })),
    upperHalf: b.stealFx.every((s) => s.r < 5),
  };
});
await new Promise((r) => setTimeout(r, 100));
await page.screenshot({ path: path.join(OUT, 'ai-lion-steal.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
