// 性能剖析 v2：坐实「偶发卡顿」证据。
// 相比 v1：longtask 记 startTime（区分测量窗内外）；丢帧(gap>32ms)记时间戳+当时堆大小（关联 GC）；
// 战斗连续跑 30s 无中途布阵干扰，看卡顿是否周期出现。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = (process.env.PERF_URL || 'http://127.0.0.1:5180/?seed=7').replace(/\?seed/, '?seed');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--enable-precise-memory-info'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

await page.evaluateOnNewDocument(() => {
  window.__prof = { gaps: [], durs: [], longtasks: [], heap: [], t0: 0, last: null, janks: [] };
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    orig((t) => {
      const p = window.__prof;
      if (p.last != null && p.t0 > 0) {
        const gap = t - p.last;
        p.gaps.push(gap);
        if (gap > 32) p.janks.push({ at: +(t - p.t0).toFixed(0), gap: +gap.toFixed(0), heapMB: p.heap.length ? +(p.heap[p.heap.length - 1] / 1048576).toFixed(1) : -1 });
      }
      p.last = t;
      const s = performance.now();
      try { cb(t); } finally { if (p.t0 > 0) p.durs.push(performance.now() - s); }
    });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (window.__prof.t0 > 0 && e.startTime >= window.__prof.t0) {
          window.__prof.longtasks.push({ at: +(e.startTime - window.__prof.t0).toFixed(0), ms: Math.round(e.duration) });
        }
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
  setInterval(() => {
    if (performance.memory && window.__prof.t0 > 0) window.__prof.heap.push(performance.memory.usedJSHeapSize);
  }, 200);
});

const reset = () => page.evaluate(() => {
  const p = window.__prof;
  p.gaps = []; p.durs = []; p.longtasks = []; p.heap = []; p.janks = [];
  p.t0 = performance.now(); p.last = null;
});
const collect = (label) => page.evaluate((label) => {
  const p = window.__prof;
  const q = (a, x) => a[Math.min(a.length - 1, Math.floor(a.length * x))];
  const fmt = (a) => a.length ? `n=${a.length} p50=${q(a,.5).toFixed(1)} p90=${q(a,.9).toFixed(1)} p99=${q(a,.99).toFixed(1)} max=${Math.max(...a).toFixed(1)}` : 'n=0';
  const heapMB = p.heap.map((x) => x / 1048576);
  const gcDrops = [];
  for (let i = 1; i < heapMB.length; i++) if (heapMB[i - 1] - heapMB[i] > 0.5) gcDrops.push(heapMB[i - 1] - heapMB[i]);
  return {
    label,
    rafGapsMs: fmt([...p.gaps].sort((a, b) => a - b)),
    frameJsMs: fmt([...p.durs].sort((a, b) => a - b)),
    janks: p.janks,               // gap>32ms：时间戳+当时堆
    longtasks: p.longtasks,       // 窗口内 longtask：时间戳+时长
    gc: `drops=${gcDrops.length} in ${p.heap.length * 0.2}s, heap ${Math.min(...heapMB).toFixed(1)}→${Math.max(...heapMB).toFixed(1)}MB`,
  };
}, label);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady===true', { timeout: 15000 }).catch(() => {});

// 战斗：布阵一次（测量窗之前完成），然后纯挂机 30s 观察自然卡顿
await page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  if (g.battle.status === 'ready') g.wave();
});
// 预热 3s（跳过开局动画/首帧图片解码），再开测
await sleep(3000);
console.log('warmup state:', await page.evaluate(() => {
  const g = window.__game;
  return { status: g.battle?.status, wave: g.battle?.wave };
}).catch((e) => 'eval-failed: ' + e.message));

// 30s 测量窗；每 2s 巡检一次，终局/暂停就重开对局保持战斗循环活着
const startBattle = () => page.evaluate(() => {
  const g = window.__game;
  g.restart(7, 1); g.enterBattle();
  for (let k = 0; k < 25; k++) { if (!g.summon()) { g.autoPlace(); if (!g.summon()) break; } g.autoPlace(); }
  if (g.battle.status === 'ready') g.wave();
});
await reset();
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  await sleep(2000);
  const st = await page.evaluate(() => {
    const g = window.__game;
    return { status: g.battle?.status, paused: !!(g.battle && g.battle.uiPaused !== undefined ? g.battle.uiPaused : false) };
  }).catch(() => null);
  if (!st || st.status === 'won' || st.status === 'lost') { await startBattle(); await sleep(500); await reset(); }
}
console.log('=== 战斗挂机 30s（预热后，CPU 4x 节流） ===');
console.log(JSON.stringify(await collect('battle-30s'), null, 1));
await browser.close();
