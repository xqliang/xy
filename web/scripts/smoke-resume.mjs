// 续玩浏览器冒烟（PvE 单机）：验证「本地对局落档到统一存档 dasheng.session（wave≥1 含单位盘面）→ 刷新 →
// 自动续玩回战斗屏 + 弹『继续/回到首页』模态」端到端不崩。复用仓库既有 puppeteer-core + 系统 Chrome +
// window.__game 套路（见 web/tools/*.mjs）。
//
// 与旧版差异（Task 6 迁移）：
//   · 存档键由旧 dasheng.battleSave（仅 wave 检查点、仅 status==='ready' 落档、结构含 mode）迁移到统一的
//     dasheng.session（全量核心态、playing 也落档、结构含 kind: 'pvp'|'pve'）；开机恢复只从 dasheng.session 走。
//   · 恢复 UX 由旧 toast 改为 resumePopup 模态弹窗（继续 / 回到首页）；断言相应改为 resumeProbe().resumePopup。
//   · 旧「在线 PvP 不落档」断言已废弃/反转：PvP 现在也落档 dasheng.session 并支持刷新恢复（其真·握手链路由
//     tools/pvp-refresh-smoke.mjs 用假 WS 覆盖，本脚本专注 PvE 单机）。
//
// 关键点：
//   · 全新浏览器所有教程「未看过」，教程 overlay 会冻结仿真/落档；故加载前预置 dasheng.tutorial 全已看（等价老玩家）。
//   · sessionCheckpointNow 在 frame() 帧尾按节流写入（首帧靠 MAX 心跳立即写、之后 2s 心跳）；__game.fastForward
//     直接 battle.step() 绕过 frame()，故推进到目标态后需反复 enterBattle()（scheduleFrame → 生产 frame）踢帧落档。
//
// 前置：本脚本自带 dev 服务（spawn npx vite --strictPort），无需外部起服务。可用 PORT / CHROME_PATH 覆盖。
// 运行：node scripts/smoke-resume.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = process.env.PORT || '5192';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 全部教程序列 id（取自 main.ts），预置为已看以禁用教程 overlay。
const TUTORIAL_IDS = ['spawnGate', 'tangseng', 'aiOpponent', 'pause', 'peach', 'goSummon', 'battleIntro',
  'firstSummon', 'unitTypes', 'dragToBoard', 'autoplace', 'firstPlacement', 'attackRange', 'firstHeroWord',
  'heroWord', 'firstShovel', 'shovelUse', 'shovelWhere', 'firstActiveReady', 'activeReady', 'firstHeroCombo',
  'heroCombo', 'firstMergeable', 'mergeUpgrade', 'firstFragmentDrop', 'fragmentInfo', 'weaponUpgrade',
  'merchantFirstOpen', 'activeSkill', 'passiveSkill', 'lowStamina', 'staminaPlus'];

function fail(msg) { console.error('❌ 冒烟失败：' + msg); process.exitCode = 1; throw new Error(msg); }

// 读统一续玩存档 dasheng.session 概要（core.units 是 Map→[[k,v],...] 序列化，length 即单位数）。
const readSave = (page) => page.evaluate(() => {
  try {
    const s = JSON.parse(localStorage.getItem('dasheng.session'));
    return s && s.core ? { kind: s.kind, wave: s.core.wave, status: s.core.status, units: s.core.units.length } : null;
  } catch { return null; }
});

// dev 服务：spawn vite，轮询首页可达后返回进程句柄。
async function startVite() {
  const proc = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { cwd: WEB_DIR, stdio: 'pipe' });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => { const s = String(d); if (/error|EADDRINUSE/i.test(s)) console.error('[vite]', s.trim()); });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(URL); if (r.ok) return proc; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('vite dev 服务启动超时');
}

// 推进到 wave≥1、含单位、非终局的落档并返回该存档概要（PvE 单机）。
async function reachMidBattleSave(page) {
  await page.evaluate(() => window.__game.markNotFirstGame()); // 不押后首波：intro 完即开波
  await page.evaluate(() => window.__game.buildDefense(3000)); // 布强防线（避免快进期间被打穿终局）
  await page.evaluate(() => window.__game.fastForward(7));     // 过 6s 入场 → 进入 wave1 playing
  let live = { status: '', wave: 0, units: 0 };
  for (let i = 0; i < 40; i++) {
    live = await page.evaluate(() => {
      const b = window.__game.battle;
      if (b.status === 'playing' && b.units.size < 6) window.__game.buildDefense(1500); // 补防线
      return { status: b.status, wave: b.wave, units: b.units.size };
    });
    if (live.status === 'won' || live.status === 'lost') fail('对局在检查点前已终局：' + JSON.stringify(live));
    if (live.wave >= 1 && (live.status === 'playing' || live.status === 'ready')) break;
    await page.evaluate(() => window.__game.fastForward(1));
  }
  if (!(live.wave >= 1)) fail('fastForward 未到 wave≥1：' + JSON.stringify(live));
  // 踢生产 frame() 落档：首帧 MAX 心跳立即写、之后 2s 心跳；轮询直到 dasheng.session 写出 wave≥1 含单位档。
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.__game.enterBattle()); // scheduleFrame → frame() 帧尾 sessionCheckpointNow
    await sleep(300);
    const saved = await readSave(page);
    if (saved && saved.wave >= 1 && saved.units > 0 && saved.status !== 'won' && saved.status !== 'lost') return saved;
  }
  fail('生产 frame() 未在 wave≥1 落含单位档；最后 live=' + JSON.stringify(live) + '，存档=' + JSON.stringify(await readSave(page)));
}

const vite = await startVite();
console.log('[vite] ready on', URL);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('⚠️ 页面运行时异常：', e.message, '\nSTACK:', e.stack); process.exitCode = 1; });
  // 加载前预置教程为「全部已看」，避免教程 overlay 冻结仿真/落档。
  await page.evaluateOnNewDocument((ids) => {
    const seen = {}; for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.resumeProbe');
  await page.evaluate(() => { try { localStorage.removeItem('dasheng.session'); } catch { /* ignore */ } });

  // ── Part A：PvE 单机 落档（wave≥1 含单位）→ 刷新 → 自动续玩到同波 + 弹 resumePopup 模态 ──
  await page.evaluate(() => window.__game.restart(20260828, 1, undefined, false)); // 起一局本地 versus（非 PvP，isPvp=false → 落 'pve' 档）
  const saved = await reachMidBattleSave(page);
  console.log('reload 前存档：', JSON.stringify(saved));
  if (saved.kind !== 'pve') fail('存档 kind 应为 pve，实际：' + saved.kind);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.battle');
  await sleep(500);
  const after = await page.evaluate(() => {
    const b = window.__game.battle;
    const trayInfo = (arr) => ({ len: arr.length, nulls: arr.filter((x) => x === null).length });
    return { p: window.__game.resumeProbe(), units: b.units.size, tray: trayInfo(b.tray) };
  });
  console.log('reload 后：', JSON.stringify(after));
  if (!after.p.hasSave) fail('刷新后 resumeProbe().hasSave 应为 true（读 dasheng.session）');
  if (after.p.screen !== 'battle') fail('刷新后未自动进入战斗界面（screen=' + after.p.screen + '）');
  if (after.p.status === 'won' || after.p.status === 'lost') fail('续玩后状态不应为终局，实际：' + after.p.status);
  if (after.p.wave !== saved.wave) fail(`续玩波数与存档不一致：存档 ${saved.wave} → 恢复 ${after.p.wave}`);
  if (after.units <= 0) fail('续玩后盘面为空——applyCoreState 未恢复单位');
  if (after.p.resumePopup !== true) fail('续玩未弹出 resumePopup 模态（继续/回到首页），实际：' + after.p.resumePopup);
  console.log(`✅ Part A 通过：刷新后自动续玩（screen=battle, status=${after.p.status}, wave=${after.p.wave}, 单位数=${after.units}, resumePopup=true）`);

  // ── Part B：续玩不重跑 planBattleFragmentDrop（回归；键改到 dasheng.session）──
  // 篡改存档把神兵碎片标记设满；若续玩误调 planBattleFragmentDrop 会重置为 false/null（并推进 rng）。
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dasheng.session'));
    s.core.battleFragmentDropped = true;
    s.core.battleFragmentDropId = 'jingubang';
    localStorage.setItem('dasheng.session', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.battle');
  await sleep(300);
  const frag = await page.evaluate(() => {
    const c = window.__game.battle.serialize().core;
    return { dropped: c.battleFragmentDropped, id: c.battleFragmentDropId };
  });
  console.log('续玩后碎片状态：', JSON.stringify(frag));
  if (frag.dropped !== true || frag.id !== 'jingubang') {
    fail('续玩重置了神兵碎片状态（planBattleFragmentDrop 被误跑）：' + JSON.stringify(frag));
  }
  console.log('✅ Part B 通过：续玩保留碎片状态，未重跑 planBattleFragmentDrop');

  // ── Part C：终局不续玩（回归）——把存档核心态改成 lost → 刷新应清档回首页，不恢复已终局的一局 ──
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dasheng.session'));
    s.core.status = 'lost';
    localStorage.setItem('dasheng.session', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__game.resumeProbe');
  await sleep(400);
  const term = await page.evaluate(() => ({ screen: window.__game.curScreen(), hasSave: window.__game.resumeProbe().hasSave }));
  console.log('终局存档刷新后：', JSON.stringify(term));
  if (term.screen === 'battle') fail('终局存档不应恢复进战斗（应清档回首页），实际 screen=battle');
  if (term.hasSave !== false) fail('终局存档刷新后应已清档（hasSave=false），实际：' + term.hasSave);
  console.log('✅ Part C 通过：终局存档刷新即清档回首页，不误恢复');

  console.log('🎉 PvE 续玩冒烟全部通过（dasheng.session + resumePopup）');
} finally {
  await browser.close();
  try { vite.kill('SIGTERM'); } catch { /* ignore */ }
}
