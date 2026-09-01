// 复现用户真机观察：「点征兵后开始卡、tray 部署空后就不卡」。
// 方法：CDP CPU 4x 节流模拟中低端手机 + 教程预置（老玩家干净环境，无引导/modal 干扰），
// 同一对局内三阶段测量（intro 备战窗口 6s 内无怪，S1/S2 唯一差异 = tray 空满）：
//   S1 征兵前（intro·无怪·tray 空）
//   S2 征兵后（intro·无怪·tray 满 ← 用户说的「开始卡」）
//   S3 部署完（战斗·tray 空 ← 用户说的「不卡了」）
// 同时记录 rAF 帧间隔(gaps)、每帧 JS 回调耗时(durs)、Canvas API 计数——
// durs 高=JS 瓶颈；durs 低但 gaps 大=渲染/合成瓶颈。
// 用法：node tools/perf-tray-stall.mjs（需 dev server 5180 或 PERF_URL）
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 }); // 4 倍节流≈中低端手机

await page.evaluateOnNewDocument(() => {
  // 预置「教程全已见 + 已玩过一局」：老玩家干净环境（无首局引导箭头/押后/modal 冻结仿真）
  try {
    const ids = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel',
      'firstActiveReady', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'wuxingMap'];
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
    localStorage.setItem('dasheng.playedOnce', '1');
  } catch { /* 非 web 环境忽略 */ }
  window.__prof = {
    gaps: [], durs: [], frames: 0, t0: 0, last: null,
    rad: 0, lin: 0, save: 0, fillText: 0, strokeText: 0, drawImg: 0, fillRect: 0,
  };
  // 包装 rAF：帧间隔 + 每帧 JS 回调耗时
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRaf((t) => {
    const p = window.__prof;
    if (p.last != null && p.t0 > 0) p.gaps.push(t - p.last);
    p.last = t;
    const s = performance.now();
    try { cb(t); } finally { if (p.t0 > 0) { p.durs.push(performance.now() - s); p.frames++; } }
  });
  // Canvas API 计数
  const proto = CanvasRenderingContext2D.prototype;
  const c = window.__prof;
  const o = {
    rad: proto.createRadialGradient, lin: proto.createLinearGradient, sv: proto.save,
    ft: proto.fillText, st: proto.strokeText, img: proto.drawImage, fr: proto.fillRect,
  };
  proto.createRadialGradient = function (...a) { if (c.t0 > 0) c.rad++; return o.rad.apply(this, a); };
  proto.createLinearGradient = function (...a) { if (c.t0 > 0) c.lin++; return o.lin.apply(this, a); };
  proto.save = function (...a) { if (c.t0 > 0) c.save++; return o.sv.apply(this, a); };
  proto.fillText = function (...a) { if (c.t0 > 0) c.fillText++; return o.ft.apply(this, a); };
  proto.strokeText = function (...a) { if (c.t0 > 0) c.strokeText++; return o.st.apply(this, a); };
  proto.drawImage = function (...a) { if (c.t0 > 0) c.drawImg++; return o.img.apply(this, a); };
  proto.fillRect = function (...a) { if (c.t0 > 0) c.fillRect++; return o.fr.apply(this, a); };
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

const reset = () => page.evaluate(() => {
  const p = window.__prof;
  p.gaps = []; p.durs = []; p.frames = 0;
  p.rad = p.lin = p.save = p.fillText = p.strokeText = p.drawImg = p.fillRect = 0;
  p.t0 = performance.now(); p.last = null;
});
const collect = (label) => page.evaluate((label) => {
  const p = window.__prof;
  p.t0 = 0; // 停止计数
  const q = (a, x) => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * x))].toFixed(1) : 0;
  const f = Math.max(1, p.frames);
  const totalMs = p.gaps.reduce((s, g) => s + g, 0);
  return {
    label, frames: p.frames, fpsAvg: +(1000 * p.frames / Math.max(1, totalMs)).toFixed(1),
    gapP50: q(p.gaps, 0.5), gapP95: q(p.gaps, 0.95), gapMax: q(p.gaps, 0.999),
    durP50: q(p.durs, 0.5), durP95: q(p.durs, 0.95), durMax: q(p.durs, 0.999),
    save: +(p.save / f).toFixed(1), fillText: +(p.fillText / f).toFixed(1), strokeText: +(p.strokeText / f).toFixed(1),
    drawImg: +(p.drawImg / f).toFixed(1), linGrad: +(p.lin / f).toFixed(1), radGrad: +(p.rad / f).toFixed(1), fillRect: +(p.fillRect / f).toFixed(1),
  };
}, label);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 进战斗：intro 备战窗口 6s（无怪）
await page.evaluate(() => { const g = window.__game; g.restart(7, 1); g.enterBattle(); });
await sleep(800);

// S1 征兵前（intro·无怪·tray 空）
await reset(); await sleep(2500);
console.log(JSON.stringify(await collect('S1 征兵前·intro无怪·tray空')));

// S2 征兵后（intro·无怪·tray 满）——用户报告的「开始卡」
const s2 = await page.evaluate(() => {
  const g = window.__game;
  return { summonOk: g.summon(), tray: g.battle.tray.filter(Boolean).length, status: g.battle.status };
});
console.log('summon:', JSON.stringify(s2));
await sleep(900); // 等丝带飞入落位(~0.4s)+缓冲
await reset(); await sleep(2500);
console.log(JSON.stringify(await collect('S2 征兵后·intro无怪·tray满')));

// S3 部署完（tray 空·战斗中）——用户报告的「不卡了」
const s3 = await page.evaluate(() => {
  const g = window.__game;
  for (let k = 0; k < 10; k++) { g.summon(); g.autoPlace(); }
  if (g.battle.status === 'ready') g.wave();
  return { tray: g.battle.tray.filter(Boolean).length, status: g.battle.status, wave: g.battle.wave };
});
console.log('deploy:', JSON.stringify(s3));
await sleep(900);
await reset(); await sleep(2500);
console.log(JSON.stringify(await collect('S3 部署完·战斗·tray空')));

await browser.close();
