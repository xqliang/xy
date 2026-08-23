// tools/oppjuice-sim.mjs —— 对手普攻「本地视觉模拟」的浏览器验证（隔离渲染）。
// 场景：PvP 电池（isPvp=true），手工放 2 兵器 + 大圣字对 + 3 怪，逐帧 stepOpponentJuice：
//   1) fx 按真实攻击间隔持续产生（兵器 wtype 特效 + 英雄 heroId 特效）；
//   2) 出招脉冲 firePulse 出招瞬间=1、随后本地衰减（不再冻结）；
//   3) 纯视觉：怪物 hp 恒不被本地扣；伤害飘字只来自快照 hp 下降；
//   4) draw 一帧中动画截图，肉眼确认特效落在上半场。
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
  const b = new Battle(1, 1, MAPS[0], NO_META, {}, [], [], false, undefined, 1, undefined, { enabled: true });

  // 怪：3 只排在 AI 路径 dist 4~7（互不同格附近），hp 100
  b.aiMonsters = [0, 1, 2].map((i) => ({
    id: i + 1, dist: 4 + i * 1.2, hp: 100, maxHp: 100, spd: 0.6, isBoss: false, isMiniBoss: false,
    miniBossKind: null, isCavalry: false, hitFlash: 0, skill: null, skillCd: 0, castFlash: 0, spawnT: 1,
    stunT: 0, slowT: 0, hasteT: 0, healFlash: 0, burnT: 0, burnDps: 0,
  }));
  // 兵器：摆在首怪位置附近两格（射程内），cooldown=0 → 首帧即出招
  const p0 = b.aiMonsterPos(b.aiMonsters[0]);
  const p1 = b.aiMonsterPos(b.aiMonsters[1]);
  const clamp = (c, r) => ({ c: Math.max(0, Math.min(7, Math.round(c))), r: Math.max(0, Math.min(4, Math.round(r))) });
  const uCell = clamp(p0.c, p0.r - 1);
  const wCell = clamp(p1.c - 1, p1.r);
  b.aiUnits = [
    { type: 'dao', tier: 2, cell: uCell, cooldown: 0, firePulse: 0, combo: 0, fireDir: 0 },
    { type: 'archer', tier: 1, cell: wCell, cooldown: 0, firePulse: 0, combo: 0, fireDir: 0 },
  ];
  // 大圣字对：横向紧邻（激活组由 aiWords 推导），摆在怪 2 下方
  const gp = clamp(p1.c, p1.r + 1);
  b.aiWords.set(`${gp.c},${gp.r}`, { char: '大', general: 'dasheng', tier: 1, cell: gp });
  b.aiWords.set(`${gp.c + 1},${gp.r}`, { char: '圣', general: 'dasheng', tier: 1, cell: { c: gp.c + 1, r: gp.r } });
  b.aiTangsengHP = 10;

  // 逐帧跑 3 秒（16ms 一帧），记录节奏
  const snap = { fx: [], pulses: [], heroFx: 0, unitFx: 0 };
  let t = 1000;
  for (let i = 0; i < 190; i++) {
    t += 16;
    // 模拟快照：怪 dist 缓慢前进（桥每帧重建后的真实样子），hp 恒定（本地不扣）
    for (const m of b.aiMonsters) m.dist += 0.01;
    b.aiMonsters = b.aiMonsters.map((m) => ({ ...m })); // 模拟 bridge 整体重建
    b.stepOpponentJuice(t);
    snap.fx.push(b.fx.length);
    if (i % 10 === 0) snap.pulses.push(b.aiUnits.map((u) => +u.firePulse.toFixed(2)));
  }
  snap.heroFx = b.fx.filter((f) => f.heroId === 'dasheng').length;
  snap.unitFx = b.fx.filter((f) => f.wtype).length;
  const hpUnchanged = b.aiMonsters.every((m) => m.hp === 100);
  const floatsWithoutHpDrop = b.damageFloats.length;

  // 模拟服务端快照掉血：怪 1 掉 30 → 恰好 1 条伤害飘字
  const before = b.damageFloats.length;
  b.aiMonsters = b.aiMonsters.map((m) => (m.id === 1 ? { ...m, hp: 70 } : { ...m }));
  t += 16;
  b.stepOpponentJuice(t);
  const floatDelta = b.damageFloats.length - before;

  // 渲染一帧看动画（中段时刻，fx 数组已清过旧的？fx.ttl 不会自动衰减——updateFx 才衰减；
  // 这里手动衰减模拟渲染循环，避免旧特效堆满画面）
  for (const f of b.fx) f.ttl = Math.max(0, f.ttl - 0.05);
  b.fx = b.fx.filter((f) => f.ttl > 0);
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
    fxGrowth: { first5: snap.fx.slice(0, 5), last5: snap.fx.slice(-5), max: Math.max(...snap.fx) },
    heroFx: snap.heroFx, unitFx: snap.unitFx,
    pulseSamples: snap.pulses,
    hpUnchanged, floatsWithoutHpDrop, floatDelta,
    generalActive: b.aiActiveGenerals().map((g) => g.def.id),
    generalPulse: b.aiActiveGenerals().map((g) => +g.state.firePulse.toFixed(2)),
  };
});
await new Promise((r) => setTimeout(r, 100));
await page.screenshot({ path: path.join(OUT, 'oppjuice-sim.png'), clip: { x: 0, y: 0, width: 560, height: 1044 } });
console.log('result:', JSON.stringify(res, null, 2));
console.log('errors:', logs.join('\n') || '(none)');
await browser.close();
