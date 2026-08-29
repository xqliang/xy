// tools/pvp-refresh-smoke.mjs —— PvP「刷新恢复」端到端冒烟（含 dead-match 不卡 loading 回归）。
//
// 背景：单测（tests/pvp-ws.test.ts / pvp-resume.test.ts）只覆盖 tick 换算与 PvpSocket 分发，
//   覆盖不到「刷新 → 开机恢复读 dasheng.session → resumePvpSession 连 WS 发 hello → 收 welcome →
//   restoreBattle + 无输入快进 → 进战斗屏」这条真·握手链路（含 DOM/渲染循环）。本冒烟用系统 Chrome
//   跑 dev 站，经 window.__pvpWsFactory 注入一个「脚本化假 WebSocket」，在无 Python 服务端时驱动两条链路：
//
//   ① Happy path（对局仍在）：假 WS open 后回 welcome{serverMs}（serverMs 领先落档 startAt+tick，
//      使无输入快进真的推进若干步）+ 一份 oppSnap。断言：刷新后 screen 从 'loading' → 'battle'（已恢复+快进），
//      而非卡在 'loading'。
//   ② Dead-match path（对局已亡）：假 WS open 后【永不】回 welcome、也【不】关连接——精确复刻 Task 3 发现的
//      服务端 bug（对已不存在的对局既不 welcome 也不关，客户端 2s 心跳还一直喂活其读超时）。此时唯一的兜底是
//      客户端 welcome 截止计时器（RESUME_WELCOME_TIMEOUT_MS=8000）→ onHelloFail → 回首页。断言：刷新后先停在
//      'loading'，8s 后 → 'menu'（且清档），而非永久卡 'loading'。★ 这是 Task 3 dead-match 卡死的头号回归测试。
//
// 注入时序（关键）：resumePvpSession 在 boot IIFE（await bootstrapAuth 之后）就建 socket，早于任何 page.evaluate
//   能调用 __game.setPvpWsFactory 的时机；故假 WS 工厂必须经 page.evaluateOnNewDocument 在页面脚本之前挂到
//   window.__pvpWsFactory，由 main.ts 模块初始化时读入 pvpWsFactoryOverride（见 main.ts 该变量注释）。
//   两条链路的行为经 localStorage['__smokeWsMode']（'welcome' / 'silent'）切换——localStorage 跨刷新存活。
//
// 前置：本脚本自带 dev 服务（spawn npx vite --strictPort），无需外部起服务。可用 PORT / CHROME_PATH 覆盖。
// 运行：node tools/pvp-refresh-smoke.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PORT || '5191';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(WEB_DIR, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— dev 服务：spawn vite，轮询首页可达后再继续 ——
async function startVite() {
  const proc = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { cwd: WEB_DIR, stdio: 'pipe' });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => { const s = String(d); if (/error|EADDRINUSE/i.test(s)) console.error('[vite]', s.trim()); });
  for (let i = 0; i < 100; i++) { // 最多 ~20s 等待就绪
    try { const r = await fetch(URL); if (r.ok) return proc; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('vite dev 服务启动超时');
}

// —— 假 WebSocket 工厂：在页面上下文运行（document-start 注入，早于 main.ts）——
// 行为由 localStorage['__smokeWsMode'] 决定：'welcome'=回 welcome+oppSnap（对局仍在）；其它/未设=静默（对局已亡）。
function installFakeWs() {
  const CONNECTING = 0, OPEN = 1, CLOSED = 3;
  const instances = [];
  window.__fakeWs = {
    instances,
    count: () => instances.length,
    last: () => instances[instances.length - 1] || null,
    info: () => {
      const w = instances[instances.length - 1];
      return w ? { url: w.url, readyState: w.readyState, sentCount: w.sent.length, welcomed: w.welcomed } : null;
    },
  };
  class FakeWs {
    constructor(url) {
      this.url = url;
      this.readyState = CONNECTING;
      this.sent = [];
      this.welcomed = false;
      this.onopen = null; this.onclose = null; this.onmessage = null; this.onerror = null;
      instances.push(this);
      // 异步 fire open（镜像真实握手；也镜像单测 FakeWebSocket）——被 close 抢先则空转。
      setTimeout(() => { if (this.readyState !== CONNECTING) return; this.readyState = OPEN; this.onopen && this.onopen({}); }, 0);
    }
    _recv(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
    send(data) {
      this.sent.push(data);
      let msg = null; try { msg = JSON.parse(data); } catch { /* ignore */ }
      if (!msg || msg.type !== 'hello' || this.welcomed) return; // 只对 hello 应答一次
      let mode = null; try { mode = localStorage.getItem('__smokeWsMode'); } catch { /* ignore */ }
      if (mode !== 'welcome') return; // 'silent'/未设：模拟对局已亡——既不 welcome 也不 close
      this.welcomed = true;
      // serverMs：落档 startAt + 落档 tick 对应时长 + gap，使 resumePvpSession 的无输入快进真的推进若干步。
      let startAt = Date.now(), savedTick = 0, oppSnap = null;
      try {
        const s = JSON.parse(localStorage.getItem('dasheng.session'));
        if (s && s.pvp) { startAt = s.pvp.startAtServerMs; savedTick = s.pvp.localSimTick || 0; }
      } catch { /* ignore */ }
      try { oppSnap = JSON.parse(localStorage.getItem('__smokeOppSnap')); } catch { /* ignore */ }
      const serverMs = startAt + Math.round((savedTick / 30) * 1000) + 1000; // +30 tick 快进（1s；远不足以让唐僧被吃穿）
      // 稍作异步，避免在 PvpSocket.handleOpen 执行中同步重入 onmessage。
      setTimeout(() => { if (this.readyState === OPEN) this._recv({ type: 'welcome', serverMs }); }, 5);
      // 恢复后补一份对手快照（用建档时捕获的真实 PvpSnap，schema 保真、不崩桥）；证明下行链路在恢复后仍通。
      if (oppSnap) setTimeout(() => { if (this.readyState === OPEN) this._recv({ type: 'oppSnap', s: { ...oppSnap, t: serverMs } }); }, 40);
    }
    close() { this.readyState = CLOSED; if (this.onclose) this.onclose({}); }
  }
  window.__pvpWsFactory = (url) => new FakeWs(url);
}

// 全部教程序列 id 预置为「已看」，避免教程 overlay 冻结仿真（与 scripts/smoke-resume.mjs 一致）。
const TUTORIAL_IDS = ['spawnGate', 'tangseng', 'aiOpponent', 'pause', 'peach', 'goSummon', 'battleIntro',
  'firstSummon', 'unitTypes', 'dragToBoard', 'autoplace', 'firstPlacement', 'attackRange', 'firstHeroWord',
  'heroWord', 'firstShovel', 'shovelUse', 'shovelWhere', 'firstActiveReady', 'activeReady', 'firstHeroCombo',
  'heroCombo', 'firstMergeable', 'mergeUpgrade', 'firstFragmentDrop', 'fragmentInfo', 'weaponUpgrade',
  'merchantFirstOpen', 'activeSkill', 'passiveSkill', 'lowStamina', 'staminaPlus'];

// 建一份「有效未终局」的 PvP 全状态存档写入 dasheng.session（用真实模块 buildSessionSave，version/config/core 保真），
// 并捕获一份真实 PvpSnap 存入 __smokeOppSnap 供假 WS 回放。返回存档概要。
async function writePvpSave(page, seed) {
  return page.evaluate(async (seedArg) => {
    const { Battle } = await import('/src/battle.ts');
    const { MAPS } = await import('/src/board.ts');
    const { buildSessionSave, SESSION_KEY } = await import('/src/pvp-save.ts');
    // pvpInit={enabled:true} 打开 isPvp；其余走构造默认（与 restoreBattle 的构造对齐）。
    const b = new Battle(seedArg, 1, MAPS[0], undefined, undefined, undefined, undefined, false, undefined, 1, undefined, { enabled: true });
    b.startNextWave(); // status:'ready'→'playing'、wave→1：使恢复后快进 while(status==='playing') 真的步进
    const startAt = Date.now() - 1000; // 略早于「现在」，与 enterPvp 的 startAtServerMs 取值一致
    const save = buildSessionSave('pvp', b, {
      seed: seedArg,
      pvp: { matchId: 'smoke-refresh', uid: 'u-smoke', side: 'a', startAtServerMs: startAt, localSimTick: 0 },
    });
    localStorage.setItem(SESSION_KEY, JSON.stringify(save));
    // 捕获一份真实本方快照当作「对手快照」回放（schema 保真，避免手搓 PvpSnap 漏字段崩桥）。
    try { localStorage.setItem('__smokeOppSnap', JSON.stringify(b.pvpOwnSnapshot(0))); } catch { /* ignore */ }
    return { kind: save.kind, gameVersion: save.gameVersion, wave: save.core.wave, status: save.core.status, hasPvp: !!save.pvp };
  }, seed);
}

// 轮询 curScreen 直到等于目标或超时；返回最终 screen。
async function waitForScreen(page, target, timeoutMs) {
  const t0 = Date.now();
  let cur = '';
  while (Date.now() - t0 < timeoutMs) {
    cur = await page.evaluate(() => (window.__game && window.__game.curScreen ? window.__game.curScreen() : '(no __game)'));
    if (cur === target) return cur;
    await sleep(150);
  }
  return cur;
}

let fail = false;
const say = (ok, msg) => { console.log((ok ? '✅ ' : '❌ ') + msg); if (!ok) fail = true; };

const vite = await startVite();
console.log('[vite] ready on', URL);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
// 环境噪声（CDN 跨域 / 无后端的 /api 请求失败）与本次验证无关，过滤掉；真·未捕获 pageerror 一律计入。
const NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|net::|WebSocket|handshake|\/api\/|status of (401|404|500)|decodeAudio/i;
const pageErrs = [];
const consoleErrs = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => pageErrs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrs.push(m.text()); });
  // document-start 注入：① 假 WS 工厂（挂 window.__pvpWsFactory，早于 main.ts 读入）；② 教程全已看。
  await page.evaluateOnNewDocument(installFakeWs);
  await page.evaluateOnNewDocument((ids) => {
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);

  // —— setup：首个加载（无存档 → 首页；假 WS 处于休眠，无 socket 被建）——
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.curScreen && window.__game.resumeProbe', { timeout: 20000 });
  await page.evaluate(() => { try { localStorage.removeItem('dasheng.session'); } catch { /* ignore */ } });
  const fakeUp = await page.evaluate(() => typeof window.__pvpWsFactory === 'function');
  say(fakeUp, '假 WS 工厂已在页面注入（window.__pvpWsFactory 就位，恢复路径将走它而非真实 WebSocket）');

  // ============ 链路①：Happy path（对局仍在 → welcome → 快进 → battle）============
  const saved = await writePvpSave(page, 7);
  console.log('  建档：', JSON.stringify(saved));
  say(saved.kind === 'pvp' && saved.hasPvp && saved.status === 'playing', 'PvP 存档写入 dasheng.session（kind=pvp, status=playing, 带 pvp 元信息）');
  await page.evaluate(() => localStorage.setItem('__smokeWsMode', 'welcome'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.curScreen && window.__game.resumeProbe', { timeout: 20000 });
  const probeBoot = await page.evaluate(() => window.__game.resumeProbe());
  say(probeBoot.hasSave, 'resumeProbe().hasSave=true（开机读到 dasheng.session）');
  const screenH = await waitForScreen(page, 'battle', 6000);
  say(screenH === 'battle', `刷新后恢复进入战斗屏（screen=${screenH}，非卡 loading）`);
  const afterH = await page.evaluate(() => {
    const p = window.__game.resumeProbe();
    const pv = window.__game.pvpProbe ? window.__game.pvpProbe() : null;
    return { screen: p.screen, status: p.status, wave: p.wave, hasSave: p.hasSave,
             sock: pv ? pv.sockState : null, snap: pv ? pv.snapCount : null, tick: pv ? pv.localSimTick : null };
  });
  console.log('  恢复后：', JSON.stringify(afterH));
  say(afterH.sock === 'open', `PvpSocket 已 open（假 WS 握手 + welcome 成功；sockState=${afterH.sock}）`);
  say(afterH.tick >= 30, `无输入快进已推进 sim（localSimTick=${afterH.tick}，≥ 目标 30 tick）`);
  say(afterH.snap > 0, `恢复后对手快照下行链路通（snapCount=${afterH.snap}）`);
  await page.screenshot({ path: path.join(OUT, 'pvp-refresh-happy.png') }).catch(() => {});

  // ============ 链路②：Dead-match（对局已亡 → 永不 welcome → welcome 超时 → 回首页）============
  // 重写一份 PvP 存档（happy 路径已在续玩局，重置为干净的可恢复档，隔离两条链路）。
  await writePvpSave(page, 7);
  await page.evaluate(() => localStorage.setItem('__smokeWsMode', 'silent')); // 静默：假 WS 只 open，永不 welcome、永不 close
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.curScreen', { timeout: 20000 });
  // 先证明「正在等 welcome」：短时内应仍停在 loading（不是立刻回家，也不是立刻进战斗）。
  await sleep(1200);
  const midScreen = await page.evaluate(() => window.__game.curScreen());
  const midInfo = await page.evaluate(() => (window.__fakeWs ? window.__fakeWs.info() : null));
  console.log('  dead-match 1.2s：', JSON.stringify({ screen: midScreen, ws: midInfo }));
  say(midScreen === 'loading', `等待 welcome 期间停在 loading（screen=${midScreen}）——尚未误判`);
  say(midInfo && midInfo.readyState === 1 && !midInfo.welcomed, '假 WS 已 open 但未 welcome、未 close（精确复刻对局已亡：服务端不 welcome 也不关连接）');
  // 关键断言：welcome 截止（8s）到点后 → 回首页（menu），而非永久卡 loading。等到 ~11s 兜底。
  console.log('  等待 welcome 截止（RESUME_WELCOME_TIMEOUT_MS=8000）触发 onHelloFail → 回首页…');
  const deadScreen = await waitForScreen(page, 'menu', 11000);
  const afterD = await page.evaluate(() => ({ screen: window.__game.curScreen(), hasSave: window.__game.resumeProbe().hasSave }));
  console.log('  dead-match 终态：', JSON.stringify(afterD));
  say(deadScreen === 'menu', `★ dead-match：welcome 超时后回到首页（screen=${deadScreen}），未永久卡 loading——Task 3 卡死回归通过`);
  say(afterD.hasSave === false, 'dead-match 回首页时已清档（goHome→endPvpSession→clearSessionSave，防再次尝试恢复已亡对局）');
  await page.screenshot({ path: path.join(OUT, 'pvp-refresh-deadmatch-menu.png') }).catch(() => {});

  // —— 无未捕获错误 ——
  say(pageErrs.length === 0, `全程无未捕获 pageerror（实际 ${pageErrs.length} 条）`);
  if (pageErrs.length) pageErrs.slice(0, 6).forEach((l) => console.log('   [pageerror]', l.slice(0, 200)));
  if (consoleErrs.length) { console.log('ℹ️  其它 console.error（已滤环境噪声）：'); consoleErrs.slice(0, 6).forEach((l) => console.log('   ', l.slice(0, 200))); }
} finally {
  await browser.close();
  try { vite.kill('SIGTERM'); } catch { /* ignore */ }
}

if (fail) { console.error('\nPvP 刷新恢复冒烟：FAIL'); process.exit(1); }
console.log('\n🎉 PvP 刷新恢复冒烟：PASS（happy 恢复进战斗 + dead-match 回首页不卡 loading；截图见 web/shots/pvp-refresh-*.png）');
process.exit(0);
