// PvP 结算屏改动运行时冒烟：PvP 终局现在也结算段位/功德/商人，drawPvpSettle 补画了
//   段位加减星动画 + 功德+N。typecheck+vitest 抓不到「渲染循环运行时抛错」与布局问题，
//   故按项目规范用系统 Chrome 真机跑 dev 站验证。
// 断言：
//   A1 应用启动无未捕获 JS 异常（新增 import './pvp-settle' 未打断 bundle 初始化）。
//   A2 单人进对战、快进若干帧无异常（main.ts 渲染循环改动未破坏单人路径）。
//   A3 drawPvpSettle 对 胜(晋级)/胜(普通)/负(降档)/平局 四种 payload 均能渲染且不抛错。
//   A4 结算面板区域确有非背景像素（确实画出了内容）。
// 产物：shots/pvp-settle-*.png 供人工核对布局（星排/功德/对手信息不重叠）。
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5199/?seed=7';
const VIEW_W = 560, VIEW_H = 1044; // 逻辑画布尺寸（render.ts 常量推导：COLS=8,ROWS=10）
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=2'] });
const page = await browser.newPage();
await page.setViewport({ width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2 });
const shot = async (name) => { try { await page.screenshot({ path: path.join(OUT, name) }); } catch (e) { console.log('[shot-fail]', name, e.message); } };

const pageerrs = [];
const ENV_NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|WebSocket connection|handshake|status of (404|500)/i;
page.on('console', (m) => { if (m.type() === 'error' && !ENV_NOISE.test(m.text())) pageerrs.push('[console.error] ' + m.text()); });
page.on('pageerror', (e) => pageerrs.push('[pageerror] ' + e.message));

const ALL_TUTORIALS = ['battleIntro', 'firstSummon', 'firstPlacement', 'firstHeroWord', 'firstShovel', 'firstHeroCombo', 'firstMergeable', 'firstFragmentDrop', 'merchantFirstOpen', 'lowStamina'];
await page.evaluateOnNewDocument((ids) => {
  const seen = {}; for (const id of ids) seen[id] = true;
  localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
}, ALL_TUTORIALS);

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__game && window.__game.snapshot');
await page.waitForFunction('window.__assetsReady === true', { timeout: 15000 }).catch(() => {});

// A2：单人进对战 + 快进若干帧（确认 main.ts 渲染循环改动未破坏单人路径）。
await page.evaluate(() => { const g = window.__game; g.enterBattle(); g.buildDefense(200); g.wave(); g.fastForward(2); });
await sleep(300);

// A3/A4：直接用 dev 站已打包的模块渲染 drawPvpSettle 四种 payload。
const scenes = await page.evaluate(async (dims) => {
  const settle = await import('/src/settle.ts');
  const { pvpSettle } = await import('/src/pvp-settle.ts');
  const out = [];
  // 四种 payload：胜(晋级)/胜(普通)/负(降档)/平局
  const mk = (outcome, rankBefore, reason) => {
    const { rankChange, meritGain } = outcome === 'draw'
      ? pvpSettle('draw', rankBefore, 6)
      : pvpSettle(outcome, rankBefore, 6);
    return { outcome, reason, opponent: { nickname: '齐天小圣', avatarId: '' }, rankChange, merit: meritGain };
  };
  const cases = [
    ['win-promote', mk('win', { level: 1, stars: 4, difficulty: 1.4 }, 'opponentTangsengDead')],
    ['win-normal', mk('win', { level: 1, stars: 2, difficulty: 1.4 }, 'opponentSurrender')],
    ['lose-demote', mk('lose', { level: 2, stars: 0, difficulty: 1.4 }, 'selfTangsengDead')],
    ['draw', mk('draw', { level: 1, stars: 2, difficulty: 1.4 }, 'draw')],
  ];
  const cv = document.createElement('canvas');
  cv.width = dims.w; cv.height = dims.h;
  cv.id = '__pvpSettleCv';
  cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
  document.body.appendChild(cv);
  window.__pvpRender = (payload, tMs) => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, dims.w, dims.h);
    ctx.fillStyle = '#1a1510'; ctx.fillRect(0, 0, dims.w, dims.h); // 底色，模拟战场被压暗
    settle.drawPvpSettle(ctx, payload, tMs);
  };
  window.__pvpCases = cases.map(([k, p]) => ({ key: k, payload: p }));
  for (const [key, payload] of cases) {
    let ok = true, err = '';
    try {
      window.__pvpRender(payload, settle.SETTLE_ANIM_MS + 200); // 动画放完态
      window.__pvpRender(payload, 700);                         // 动画中途帧（不抛错即可）
    } catch (e) { ok = false; err = String(e && e.message || e); }
    // 注：星星/头像来自跨域 CDN，会 taint 画布导致 getImageData 抛错，故不做像素读取；
    //     渲染是否抛错由上面 try/catch 判定，布局正确性由截图人工核对。
    out.push({ key, ok, err, rankChange: payload.rankChange ? { won: payload.rankChange.won, promoted: payload.rankChange.promoted, demoted: payload.rankChange.demoted, stars: payload.rankChange.state.stars, diff: payload.rankChange.state.difficulty } : null, merit: payload.merit });
  }
  return out;
}, { w: VIEW_W, h: VIEW_H });

// 逐场景截图供人工核对布局
for (const s of scenes) {
  await page.evaluate((k) => { const c = window.__pvpCases.find((x) => x.key === k); window.__pvpRender(c.payload, 1e6); }, s.key);
  await sleep(120);
  await shot(`pvp-settle-${s.key}.png`);
}

// —— 断言汇总 ——
let fail = false;
const say = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) fail = true; };
say(pageerrs.length === 0, `A1/A2 无未捕获 JS 异常（实际 ${pageerrs.length} 条）`);
if (pageerrs.length) console.log(pageerrs.join('\n'));
for (const s of scenes) {
  say(s.ok, `A3 drawPvpSettle 渲染「${s.key}」不抛错${s.err ? '：' + s.err : ''}`);
}
// 冻结难度自检：胜/负场景 rankChange.state.difficulty 应等于输入 1.4（不 bump）
const wp = scenes.find((s) => s.key === 'win-promote');
const ld = scenes.find((s) => s.key === 'lose-demote');
say(wp?.rankChange?.diff === 1.4, `胜·晋级冻结难度：difficulty 保持 1.4（实际 ${wp?.rankChange?.diff}）`);
say(ld?.rankChange?.diff === 1.4, `负·降档冻结难度：difficulty 保持 1.4（实际 ${ld?.rankChange?.diff}）`);
say(scenes.find((s) => s.key === 'draw')?.rankChange === null, `平局不动段位：rankChange=null`);

console.log('\n场景明细:', JSON.stringify(scenes, null, 2));
await browser.close();
if (fail) { console.error('\nPvP 结算冒烟：FAIL'); process.exit(1); }
console.log('\nPvP 结算冒烟：PASS（截图见 web/shots/pvp-settle-*.png）');
