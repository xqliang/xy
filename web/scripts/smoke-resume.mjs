// 续玩浏览器冒烟：验证「本地对战落档（wave≥1 含单位盘面）→ 刷新 → 自动续玩」端到端不崩，且在线 PvP 不落档。
// 复用仓库既有 puppeteer-core + 系统 Chrome + window.__game 套路（见 web/tools/*.mjs）。
//
// 关键点：
// - saveResumeCheckpoint 在主循环 frame() 的 shouldStepSim() 块内；教程 overlay 一旦弹出会冻结 sim/落档。
//   全新浏览器所有教程「未看过」，故本脚本在页面加载前预置 dasheng.tutorial 把所有序列标记为已看（等价老玩家），
//   使 sim 正常步进。真实老玩家本就如此，不影响生产行为。
// - __game.fastForward 直接 battle.step() 绕过 frame()，用于可靠推进 sim（headless rAF 不可靠，仓库工具皆如此）；
//   到 wave≥1 的 ready 后，用 enterBattle()（内部 scheduleFrame）踢生产 frame() 跑一帧，让 saveResumeCheckpoint 落档。
//
// 前置：worktree 的 web/ 下起 dev 服务（默认连 127.0.0.1:5199）：npx vite --port 5199 --strictPort
// 运行：node scripts/smoke-resume.mjs   （可用环境变量 PORT / CHROME_PATH 覆盖）
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || '5199';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 全部教程序列 id（取自 main.ts），预置为已看以禁用教程 overlay。
const TUTORIAL_IDS = ['spawnGate', 'tangseng', 'aiOpponent', 'pause', 'peach', 'goSummon', 'battleIntro',
  'firstSummon', 'unitTypes', 'dragToBoard', 'autoplace', 'firstPlacement', 'attackRange', 'firstHeroWord',
  'heroWord', 'firstShovel', 'shovelUse', 'shovelWhere', 'firstActiveReady', 'activeReady', 'firstHeroCombo',
  'heroCombo', 'firstMergeable', 'mergeUpgrade', 'firstFragmentDrop', 'fragmentInfo', 'weaponUpgrade',
  'merchantFirstOpen', 'activeSkill', 'passiveSkill', 'lowStamina', 'staminaPlus'];

function fail(msg) { console.error('❌ 冒烟失败：' + msg); process.exitCode = 1; throw new Error(msg); }

const readSave = (page) => page.evaluate(() => {
  try {
    const s = JSON.parse(localStorage.getItem('dasheng.battleSave'));
    return s && s.core ? { mode: s.mode, wave: s.core.wave, status: s.core.status, units: s.core.units.length } : null;
  } catch { return null; }
});

// 推进到 wave≥1、含单位的 ready 检查点并落档，返回该存档概要。
async function reachSavedReadyWave1(page) {
  await page.evaluate(() => window.__game.fastForward(7)); // 过 6s 入场，进入 wave1 playing
  await page.evaluate(() => window.__game.buildDefense(3000)); // 布一条强防线（playing 态可布兵）
  let live = { status: '', wave: 0, units: 0 };
  for (let i = 0; i < 40; i++) {
    live = await page.evaluate(() => {
      const b = window.__game.battle;
      if (b.status === 'playing' && b.units.size < 6) window.__game.buildDefense(1500);
      return { status: b.status, wave: b.wave, units: b.units.size };
    });
    if (live.status === 'won' || live.status === 'lost') fail('对局在检查点前已终局：' + JSON.stringify(live));
    if (live.status === 'ready' && live.wave >= 1) break;
    await page.evaluate(() => window.__game.fastForward(1));
  }
  if (!(live.status === 'ready' && live.wave >= 1)) fail('fastForward 未到 wave≥1 ready：' + JSON.stringify(live));
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.__game.enterBattle()); // scheduleFrame → 生产 frame() 一帧：step + saveResumeCheckpoint
    await sleep(250);
    const saved = await readSave(page);
    if (saved && saved.status === 'ready' && saved.wave >= 1 && saved.units > 0) return saved;
  }
  fail('生产 frame() 未在 wave≥1 ready 落含单位档；最后 live=' + JSON.stringify(live) + '，存档=' + JSON.stringify(await readSave(page)));
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('⚠️ 页面运行时异常：', e.message, '\nSTACK:', e.stack); process.exitCode = 1; });
  // 加载前预置教程为「全部已看」，避免教程 overlay 冻结 sim/落档。
  await page.evaluateOnNewDocument((ids) => {
    const seen = {};
    for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // ── Part A：本地 AI 对战 落档（wave≥1 含单位）→ 刷新 → 自动续玩到同波 ──
  await page.evaluate(() => window.__game.restart(20260823, 1, 'huoyanshan', false)); // 起一局 versus
  const saved = await reachSavedReadyWave1(page);
  console.log('reload 前存档：', JSON.stringify(saved));
  if (saved.mode !== 'versus') fail('存档 mode 应为 versus，实际：' + saved.mode);

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game && window.__game.battle');
  await sleep(500);
  const after = await page.evaluate(() => {
    const b = window.__game.battle;
    const trayInfo = (arr) => ({ len: arr.length, nulls: arr.filter((x) => x === null).length, holes: arr.length - arr.filter(() => true).length });
    return { p: window.__game.resumeProbe(), units: b.units.size, tray: trayInfo(b.tray), aiTray: trayInfo(b.aiTray) };
  });
  console.log('reload 后：', JSON.stringify(after));
  if (after.p.screen !== 'battle') fail('刷新后未自动进入战斗界面（screen=' + after.p.screen + '）');
  if (after.p.status !== 'ready') fail('续玩后状态应为 ready，实际：' + after.p.status);
  if (after.p.wave !== saved.wave) fail(`续玩波数与存档不一致：存档 ${saved.wave} → 恢复 ${after.p.wave}`);
  if (after.units <= 0) fail('续玩后盘面为空——applyCoreState 未恢复单位');
  if (!after.p.toast || !after.p.toast.includes('恢复')) fail('续玩未弹出恢复 toast：' + JSON.stringify(after.p.toast));
  await page.screenshot({ path: '/tmp/resume-toast.png' });
  console.log('续玩 toast：', after.p.toast, '（截图 /tmp/resume-toast.png）');
  console.log(`✅ Part A 通过：刷新后自动续玩（screen=battle, status=ready, wave=${after.p.wave}, 单位数=${after.units}）`);

  // ── Part C：续玩不重跑 planBattleFragmentDrop（回归最终评审发现的 bug）──
  // 篡改存档把神兵碎片标记设满；若续玩误调 planBattleFragmentDrop 会重置为 false/null（并推进 rng）。
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('dasheng.battleSave'));
    s.core.battleFragmentDropped = true;
    s.core.battleFragmentDropId = 'jingubang';
    localStorage.setItem('dasheng.battleSave', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'networkidle0' });
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
  console.log('✅ Part C 通过：续玩保留碎片状态，未重跑 planBattleFragmentDrop');

  // ── Part B：在线 PvP 不落档（回归）──
  await page.evaluate(() => window.__game.enterPvp(7));
  await sleep(300);
  await page.evaluate(() => localStorage.removeItem('dasheng.battleSave'));
  await page.evaluate(() => window.__game.fastForward(8));
  await sleep(700);
  const pvp = await page.evaluate(() => ({
    isPvp: !!(window.__game.battle && window.__game.battle.isPvp),
    save: localStorage.getItem('dasheng.battleSave'),
  }));
  console.log('PvP 检查：', JSON.stringify(pvp));
  if (!pvp.isPvp) console.warn('⚠️ enterPvp 后 battle.isPvp 非真（hook 行为或有变），PvP 回归以存档为准');
  if (pvp.save !== null) fail('在线 PvP 期间竟写入了续玩存档（应永不落档）：' + pvp.save);
  console.log('✅ Part B 通过：在线 PvP 不写续玩存档');

  console.log('🎉 续玩冒烟全部通过');
} finally {
  await browser.close();
}
