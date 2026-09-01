// A/B 对比：战斗进行中「tray 空 vs tray 满」的每帧 Canvas API 增量。
// 背景：用户真机观察「点征兵后开始卡、tray 部署空了就不卡」——原 perf-count.mjs 场景2
// 的脚本 summon+autoPlace 会把 tray 全部署光，基线从未覆盖「tray 有牌」状态。
// 用法：node tools/perf-tray.mjs（需 dev server 跑在 5180，或 PERF_URL 指定）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

await page.evaluateOnNewDocument(() => {
  window.__cnt = { rad: 0, lin: 0, save: 0, fillText: 0, strokeText: 0, drawImg: 0, fillRect: 0, frames: 0, t0: 0, lastT: 0, maxGap: 0, gaps: [] };
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const wrap = () => page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const c = window.__cnt;
  if (!c.wrapped) {
    c.wrapped = true;
    const orig = {
      rad: proto.createRadialGradient, lin: proto.createLinearGradient,
      save: proto.save, ft: proto.fillText, st: proto.strokeText,
      img: proto.drawImage, fr: proto.fillRect,
    };
    proto.createRadialGradient = function (...a) { if (c.t0 > 0) c.rad++; return orig.rad.apply(this, a); };
    proto.createLinearGradient = function (...a) { if (c.t0 > 0) c.lin++; return orig.lin.apply(this, a); };
    proto.save = function (...a) { if (c.t0 > 0) c.save++; return orig.save.apply(this, a); };
    proto.fillText = function (...a) { if (c.t0 > 0) c.fillText++; return orig.ft.apply(this, a); };
    proto.strokeText = function (...a) { if (c.t0 > 0) c.strokeText++; return orig.st.apply(this, a); };
    proto.drawImage = function (...a) { if (c.t0 > 0) c.drawImg++; return orig.img.apply(this, a); };
    proto.fillRect = function (...a) { if (c.t0 > 0) c.fillRect++; return orig.fr.apply(this, a); };
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => origRaf((t) => {
      if (c.t0 > 0) {
        c.frames++;
        if (c.lastT > 0) {
          const gap = t - c.lastT;
          c.gaps.push(gap);
          if (gap > c.maxGap) c.maxGap = gap;
        }
      }
      c.lastT = t;
      cb(t);
    });
  }
  Object.assign(c, { rad: 0, lin: 0, save: 0, fillText: 0, strokeText: 0, drawImg: 0, fillRect: 0, frames: 0, t0: performance.now(), lastT: 0, maxGap: 0, gaps: [] });
});
const report = (label) => page.evaluate((label) => {
  const c = window.__cnt;
  const f = Math.max(1, c.frames);
  c.t0 = 0; // 停止计数
  const gaps = c.gaps.slice().sort((a, b) => a - b);
  const avg = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
  const p99 = gaps.length ? gaps[Math.floor(gaps.length * 0.99)] : 0;
  return {
    label, rafFrames: c.frames, avgFrameMs: +avg.toFixed(1), p99FrameMs: +p99.toFixed(1), maxFrameMs: +c.maxGap.toFixed(1),
    radialGrad: +(c.rad / f).toFixed(1), linearGrad: +(c.lin / f).toFixed(1), save: +(c.save / f).toFixed(1),
    fillText: +(c.fillText / f).toFixed(1), strokeText: +(c.strokeText / f).toFixed(1),
    drawImage: +(c.drawImg / f).toFixed(1), fillRect: +(c.fillRect / f).toFixed(1),
  };
}, label);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 场景A：战斗·tray 空（部署循环建防守 → 强制清空候选区 → 开波）
const deployA = () => page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  // 部署循环后棋盘放不下会剩牌；实验里直接清槽保证「tray 空」对照组纯净
  for (let i = 0; i < g.battle.tray.length; i++) delete g.battle.tray[i];
  if (g.battle.status === 'ready') g.wave();
  return { tray: g.battle.tray.filter(Boolean).length, status: g.battle.status };
});
console.log('A setup:', JSON.stringify(await deployA()));
await sleep(2500);
const aState = await page.evaluate(() => ({ tray: window.__game.battle.tray.filter(Boolean).length, status: window.__game.battle.status, wave: window.__game.battle.wave }));
console.log('A pre-measure state:', JSON.stringify(aState));
await wrap(); await sleep(5000);
console.log(JSON.stringify(await report('A 战斗·tray空')));

// 场景B：战斗·tray 满（同 A 的部署循环先建防守 → 补桃再征兵补满候选区、不部署，开波）
// 与 A 唯一差异 = tray 里有 token —— 真机用户「边打边留着牌」的场景
const deployB = () => page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  g.battle.peach = 999; // 实验补桃，保证征兵成功
  const lastSummonOk = g.summon(); // 补满候选区
  if (g.battle.status === 'ready') g.wave();
  return { lastSummonOk, tray: g.battle.tray.filter(Boolean).length, status: g.battle.status };
});
console.log('B setup:', JSON.stringify(await deployB()));
await sleep(2500); // 等丝带飞入落位(约0.4s)+开波动画
const bState = await page.evaluate(() => ({ tray: window.__game.battle.tray.filter(Boolean).length, status: window.__game.battle.status }));
console.log('B pre-measure state:', JSON.stringify(bState));
await wrap(); await sleep(5000);
console.log(JSON.stringify(await report('B 战斗·tray满')));
const bEnd = await page.evaluate(() => ({ tray: window.__game.battle.tray.filter(Boolean).length, status: window.__game.battle.status, wave: window.__game.battle.wave }));
console.log('B post-measure state:', JSON.stringify(bEnd));

await browser.close();
