// tools/oppjuice.mjs —— #2 对手战斗反馈本地补演的可视验证（隔离渲染）。
// 用单机对局取「真实」的 AI 怪物/单位对象，拷进一个 PvP 电池，跑真 stepOpponentJuice 造出
// 伤害飘字/加桃/命中特效，再整帧 draw 到自建画布，截图看这些反馈是否落在【上半场(AI)】。
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
page.on('console', (m) => { if (m.type() === 'error') logs.push('[console.error] ' + m.text()); });
await page.goto('http://127.0.0.1:5181/?seed=7', { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const res = await page.evaluate(async () => {
  const g = window.__game;
  g.restart(7); g.enterBattle();
  const manage = () => { for (let k = 0; k < 30; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); } };
  if (g.battle.pendingShop) g.chooseItem(0);
  g.grantPeach(600); manage(); g.wave();
  // 跑到 AI 侧既有怪又有单位
  for (let i = 0; i < 500; i++) { g.step(1 / 30); if (g.battle.aiMonsters.length >= 3 && g.battle.aiUnits.length >= 2 && i > 120) break; }
  const src = g.battle;

  const { Battle, NO_META } = await import('/src/battle.ts');
  const { draw } = await import('/src/render.ts');
  const { MAPS } = await import('/src/board.ts');
  const b = new Battle(1, 1, MAPS[0], NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });
  // 拷贝真实 AI 单位/怪物（真 Monster/PlacedUnit，字段齐全可渲染）
  b.aiUnits = src.aiUnits.map((u) => ({ ...u, cell: { ...u.cell } }));
  b.aiMonsters = src.aiMonsters.map((m) => ({ ...m }));
  b.aiTangsengHP = src.aiTangsengHP;
  b.stepOpponentJuice(1000); // 基线
  // 制造：击杀队首怪（移除），其余各掉 40% 血
  const killed = b.aiMonsters[0];
  b.aiMonsters = b.aiMonsters.slice(1).map((m) => ({ ...m, hp: Math.max(1, m.hp - m.maxHp * 0.4) }));
  b.stepOpponentJuice(1050); // 掉血 + 击杀（唐僧血不变 → 加桃）

  const cv = document.createElement('canvas');
  cv.width = 560; cv.height = 1044;
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const ui = {
    dragFrom: null, dragTrayIndex: null, dragPos: null, dragActiveSlot: null, activeDragStart: null,
    trayDragStart: null, selected: null, selectedTrayIndex: null, selectedMonster: null,
    passivePopup: null, passivePopupUntil: 0, activePopup: null, activePopupUntil: 0,
    aiItemPopup: null, peachPopup: false, bombPopup: null, paused: false,
  };
  draw(ctx, b, ui);
  return {
    aiUnits: b.aiUnits.length, aiMonsters: b.aiMonsters.length,
    damageFloats: b.damageFloats.length, peachFloats: b.peachFloats.length, fx: b.fx.length,
    bursts: b.bursts.length,
    killedWasBoss: killed ? killed.isBoss : null,
    // 飘字应全部落在上半场（r < 5，ROWS=10 → 上半 0..4）
    damageRows: b.damageFloats.map((d) => +d.r.toFixed(2)),
    peachRows: b.peachFloats.map((p) => +p.r.toFixed(2)),
  };
});
await new Promise((r) => setTimeout(r, 100));
await page.screenshot({ path: path.join(OUT, 'oppjuice.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
