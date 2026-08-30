// 性能剖析：定位「偶发卡顿 + 手机发热」。
// 用法：node tools/perf-profile.mjs（需 vite dev server 在 127.0.0.1:5180）
//
// 方法：
// - puppeteer headless Chrome + CDP Emulation.setCPUThrottlingRate(4) 模拟中端手机 CPU；
// - 在页面加载前包装 requestAnimationFrame：记录帧间隔(gaps)、每帧回调 JS 耗时(durs)；
// - PerformanceObserver 统计 longtask（>50ms 阻塞任务，卡顿直接证据）；
// - 每 200ms 采样 usedJSHeapSize，看 GC 锯齿（堆忽降 = 刚发生 GC）。
// 场景：A=菜单挂机 10s；B=战斗(有单位互殴) 15s；C=战斗高压(多波推进) 10s。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:5180/?seed=7';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-precise-memory-info'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); // iPhone 尺寸+dpr2，接近微信小游戏
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 }); // 4 倍节流≈中端手机

// 页面加载前注入：包装 rAF + longtask 观察器 + 堆采样
await page.evaluateOnNewDocument(() => {
  window.__prof = { gaps: [], durs: [], longtasks: [], last: null, heap: [], t0: 0 };
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    orig((t) => {
      const p = window.__prof;
      if (p.last != null && p.t0 > 0 && t >= p.t0) p.gaps.push(t - p.last);
      p.last = t;
      const s = performance.now();
      try { cb(t); } finally { if (p.t0 > 0) p.durs.push(performance.now() - s); }
    });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__prof.longtasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* 旧内核无 longtask */ }
  setInterval(() => {
    if (performance.memory && window.__prof.t0 > 0) {
      window.__prof.heap.push(performance.memory.usedJSHeapSize);
    }
  }, 200);
});

const reset = () => page.evaluate(() => {
  const p = window.__prof;
  p.gaps = []; p.durs = []; p.longtasks = []; p.heap = [];
  p.t0 = performance.now(); p.last = null;
});
const collect = (label) => page.evaluate((label) => {
  const p = window.__prof;
  const q = (arr, x) => arr[Math.min(arr.length - 1, Math.floor(arr.length * x))];
  const fmt = (arr) => arr.length
    ? `n=${arr.length} p50=${q(arr, .5).toFixed(1)} p90=${q(arr, .9).toFixed(1)} p99=${q(arr, .99).toFixed(1)} max=${Math.max(...arr).toFixed(1)}`
    : 'n=0';
  const sortedGaps = [...p.gaps].sort((a, b) => a - b);
  const sortedDurs = [...p.durs].sort((a, b) => a - b);
  const heapMB = p.heap.map((x) => x / 1048576);
  const gcDrops = []; // 堆下降>0.5MB 的采样点≈GC 事件
  for (let i = 1; i < heapMB.length; i++) if (heapMB[i - 1] - heapMB[i] > 0.5) gcDrops.push(heapMB[i - 1] - heapMB[i]);
  const miss16 = p.gaps.filter((g) => g > 22).length;   // >22ms≈丢帧
  const stutter = p.gaps.filter((g) => g > 80).length;  // >80ms≈肉眼可见卡顿
  return {
    label,
    gaps: fmt(sortedGaps),
    frameJsMs: fmt(sortedDurs),
    missedFrames: miss16, visibleStutters: stutter,
    longtasks: p.longtasks.length ? `n=${p.longtasks.length} top=${[...p.longtasks].sort((a,b)=>b-a).slice(0,5).join(',')}` : 'none',
    heap: heapMB.length ? `min=${Math.min(...heapMB).toFixed(1)}MB max=${Math.max(...heapMB).toFixed(1)}MB gcDrops=${gcDrops.length}(${gcDrops.slice(0,5).map(x=>x.toFixed(1)).join(',')}MB)` : 'n/a',
  };
}, label);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});
console.log('booted, errors so far:', errs.length ? errs.join(' | ') : '(none)');

// —— 场景 A：菜单挂机 10s —— //
await reset();
await sleep(10000);
console.log('\n=== A. 菜单挂机 10s（CPU 4x 节流） ===');
console.log(JSON.stringify(await collect('menu-idle'), null, 1));

// —— 场景 B：战斗，摆兵开打，真实时间跑 15s —— //
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  // 摆兵：征兵+自动布阵几轮，让场面有单位互殴
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  if (g.battle.status === 'ready') g.wave();
});
await reset();
await sleep(15000);
console.log('\n=== B. 战斗进行中 15s（CPU 4x 节流） ===');
console.log(JSON.stringify(await collect('battle'), null, 1));

// —— 场景 C：战斗高压，推进几波再测 10s —— //
await page.evaluate(() => {
  const g = window.__game;
  for (let k = 0; k < 30; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  const b = g.battle; let t = 0;
  while (b.status === 'playing' && t < 90) { g.step(0.1); t += 0.1; } // 快进把怪放出来
  for (let k = 0; k < 15; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
});
await reset();
await sleep(10000);
console.log('\n=== C. 战斗高压 10s（CPU 4x 节流） ===');
console.log(JSON.stringify(await collect('battle-heavy'), null, 1));

if (errs.length) { console.log('\n=== 页面报错（可能是性能问题的伴随症状） ==='); console.log(errs.slice(0, 10).join('\n')); }
await browser.close();
