// tools/freeze-ice-smoke.mjs —— 冰封定身「脚下白色尖角冰晶」渲染冒烟（隔离渲染）。
// 三只怪：刚冻住(elapsed≈0.1s)、冻住中段、即将解冻(剩0.3s)，各画冰晶；另留一只未冻怪对照。
// 断言：渲染不抛错；截图供人工核对（冰晶在脚下、淡入淡出、未冻怪无冰）。
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
  const { Battle, NO_META, TUNING } = await import('/src/battle.ts');
  const { draw } = await import('/src/render.ts');
  const { MAPS } = await import('/src/board.ts');
  const b = new Battle(1, 1, MAPS[0], NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: false });
  const D = TUNING.freezeStunDur;
  // 三档冻结进度 + 一只未冻对照；dist 沿路径分散
  const mk = (id, dist, frozenT) => ({
    id, dist, hp: 100, maxHp: 100, spd: 0.6, isBoss: id === 4, isMiniBoss: false, miniBossKind: null,
    isCavalry: false, hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 1,
    stunT: frozenT, frozenT, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
  });
  b.monsters = [
    mk(1, 4.0, D),          // 刚冻住（淡入中）
    mk(2, 6.0, D * 0.6),    // 冻住中段（全亮度）
    mk(3, 8.0, 0.3),        // 即将解冻（融化中）
    mk(4, 3.0, 0),          // 未冻 BOSS 对照（无冰）
  ];
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
  // 真路径回归：triggerActive 冰冻也写 frozenT（activeSlots 手工装一个 act_freeze）
  const b2 = new Battle(1, 1, MAPS[0], NO_META, {}, ['act_freeze'], [], false);
  b2.introDone = true; b2.status = 'playing';
  b2.activeSlots[0].cd = 0; b2.activeSlots[0].ready = true;
  b2.monsters = [mk(9, 4, 0)];
  const ok = b2.triggerActive(0);
  return { drawOk: true, triggerOk: ok, frozenAfterCast: b2.monsters[0].frozenT, freezeDur: D };
});
await new Promise((r) => setTimeout(r, 100));
await page.screenshot({ path: path.join(OUT, 'freeze-ice.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
