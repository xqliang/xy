// 复现用户实测：「正常 21fps，点征兵后立马 9fps」（弱设备）。
// 高倍率 CPU 节流（默认 15x）+ 征兵前后各测 3s：逐帧记录 gap/dur + Canvas API 计数——
// API 涨=渲染路径（丝带/引导箭头/tag/AI 半场），API 不涨而 dur 涨=JS 侧（序列化/规划器/GC）。
// 用法：node tools/perf-summon-drop.mjs  THROTTLE=20 node tools/perf-summon-drop.mjs
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const RATE = Number(process.env.THROTTLE || 15);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: RATE });

await page.evaluateOnNewDocument(() => {
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
  window.__p = { t0: 0, last: 0, gaps: [], durs: [], frames: 0,
    save: 0, drawImg: 0, fillText: 0, strokeText: 0, rad: 0, lin: 0, grad2conic: 0,
    shadowBlur: 0, clip: 0 };
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 打点：rAF 帧间隔/耗时 + Canvas API 计数（含 shadowBlur 赋值——低端机 GPU 杀手探针）
await page.evaluate(() => {
  const p = window.__p;
  const proto = CanvasRenderingContext2D.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'shadowBlur');
  const o = {
    sv: proto.save, img: proto.drawImage, ft: proto.fillText, st: proto.strokeText,
    rg: proto.createRadialGradient, lg: proto.createLinearGradient,
  };
  proto.save = function (...a) { if (p.t0 > 0) p.save++; return o.sv.apply(this, a); };
  proto.drawImage = function (...a) { if (p.t0 > 0) p.drawImg++; return o.img.apply(this, a); };
  proto.fillText = function (...a) { if (p.t0 > 0) p.fillText++; return o.ft.apply(this, a); };
  proto.strokeText = function (...a) { if (p.t0 > 0) p.strokeText++; return o.st.apply(this, a); };
  proto.createRadialGradient = function (...a) { if (p.t0 > 0) p.rad++; return o.rg.apply(this, a); };
  proto.createLinearGradient = function (...a) { if (p.t0 > 0) p.lin++; return o.lg.apply(this, a); };
  if (desc?.set) {
    Object.defineProperty(proto, 'shadowBlur', {
      ...desc,
      set(v) { if (p.t0 > 0 && v > 0) p.shadowBlur++; desc.set.call(this, v); },
    });
  }
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => {
    const gap = p.last > 0 && p.t0 > 0 ? t - p.last : 0;
    p.last = t;
    const s = performance.now();
    try { cb(t); } finally {
      if (p.t0 > 0 && gap > 0) { p.gaps.push(gap); p.durs.push(performance.now() - s); p.frames++; }
    }
  });
});

const reset = () => page.evaluate(() => {
  const p = window.__p;
  p.gaps = []; p.durs = []; p.frames = 0;
  p.save = p.drawImg = p.fillText = p.strokeText = p.rad = p.lin = p.shadowBlur = 0;
  p.t0 = performance.now(); p.last = 0;
});
const collect = (label) => page.evaluate((label) => {
  const p = window.__p; p.t0 = 0;
  const q = (a, x) => +((a.length ? a.slice().sort((m, n) => m - n)[Math.min(a.length - 1, Math.floor(a.length * x))] : 0)).toFixed(1);
  const f = Math.max(1, p.frames);
  const totalMs = p.gaps.reduce((s, g) => s + g, 0);
  return {
    label, fps: +(1000 * p.frames / Math.max(1, totalMs)).toFixed(1),
    gapP50: q(p.gaps, 0.5), gapP95: q(p.gaps, 0.95),
    durP50: q(p.durs, 0.5), durP95: q(p.durs, 0.95),
    save: +(p.save / f).toFixed(1), drawImg: +(p.drawImg / f).toFixed(1),
    fillText: +(p.fillText / f).toFixed(1), strokeText: +(p.strokeText / f).toFixed(1),
    rad: +(p.rad / f).toFixed(1), lin: +(p.lin / f).toFixed(1), shadowBlurOn: +(p.shadowBlur / f).toFixed(1),
  };
}, label);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 进战斗：直接开打（部署+开波），复刻用户「战斗中点征兵」场景
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  g.battle.peach = 999; // 实验补桃：保证后续「点征兵」成功（用户场景）
  if (g.battle.status === 'ready') g.wave();
});
await sleep(2500); // 等战斗稳定推进

// 征兵前基线 3s
await reset(); await sleep(3000);
console.log(`节流 ${RATE}x |`, JSON.stringify(await collect('征兵前(战斗·tray空)')));

// 点征兵 → 丝带动画(0.4s) + 落位；随后持续观测 3s（覆盖「立马掉帧」窗口）
const s1 = await page.evaluate(() => {
  const g = window.__game;
  const ok = g.summon();
  return { ok, tray: g.battle.tray.filter(Boolean).length, status: g.battle.status };
});
await reset(); await sleep(3000);
console.log(`征兵: ${JSON.stringify(s1)} |`, JSON.stringify(await collect('征兵后0-3s')));

// 征兵后 3-6s（看是否恢复）
await reset(); await sleep(3000);
console.log(`${''.padEnd(24)} |`, JSON.stringify(await collect('征兵后3-6s')));

await browser.close();
