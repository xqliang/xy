// 黄风岭 BGM 接线 + 黄狮精「卷走」扩展（偷埋雷炸药 / 偷空白阵位）浏览器冒烟。
// 前置：worktree 的 web/ 下 dev 服务：npx vite --port 5199 --strictPort
// 运行：node scripts/smoke-hfl-bgm-steal.mjs（可 PORT / CHROME_PATH 覆盖）
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || '5199';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('❌ 冒烟失败：' + msg); process.exitCode = 1; throw new Error(msg); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => { console.error('⚠️ 页面运行时异常：', e.message); errors.push(String(e)); process.exitCode = 1; });
  const bgmReqs = [];
  page.on('response', (r) => { if (r.url().includes('bgm-huangfengling')) bgmReqs.push(r.status()); });

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // ── A：黄风岭 BGM ──
  // 音乐默认开，但 AudioContext 需要手势才 resume；这里直接动态 import sfx 模块 initAudio +
  // startAmbient 驱动加载。CDN（TOS）没配 CORS：fetch+decodeAudioData 会被拦，代码会退回
  // HTMLAudioElement 循环——<audio> 的媒体请求不走 CORS 校验，网络层应出现该 URL 的 200 响应。
  await page.evaluate(() => window.__game.restart(20260824, 1, 'huangfengling', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.evaluate(() => window.__game.fastForward(7));
  await page.evaluate(async () => {
    const sfx = await import('/src/sfx.ts');
    sfx.initAudio();
    sfx.startAmbient('huangfengling');
  });
  await sleep(1500);
  const bgmLoaded = await page.evaluate(() =>
    performance.getEntriesByType('resource').some((e) => e.name.includes('bgm-huangfengling') && e.transferSize > 0),
  );
  console.log('BGM 网络请求：', JSON.stringify(bgmReqs), '资源表命中：', bgmLoaded);
  // 206 是 <audio> 兜底的 Range 媒体请求（CORS 不适用于媒体元素）；200 是直接 fetch 成功
  if (!bgmReqs.some((s) => s === 200 || s === 206) && !bgmLoaded) fail('进入黄风岭未加载 bgm-huangfengling（MAP_BGM/清单/兜底播放接线断？）');
  console.log('✅ A 通过：黄风岭 BGM 经 manifest → CDN 加载成功（fetch 受 CORS 拦时由 <audio> 兜底）');

  // ── B：黄狮精偷「埋在路径上的炸药」 ──
  // 注入一只 spd=0/skillCd=0 的黄狮精在 (1,7)（黄风岭左谷路径格），
  // 清掉其它可偷目标，只留 (1,8) 路径上一颗炸药（距狮 1 格，避开接触引爆半径 0.55）。
  await page.evaluate(() => window.__game.restart(20260824, 1, 'huangfengling', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.evaluate(() => window.__game.fastForward(7));
  await page.evaluate(() => {
    const b = window.__game.battle;
    b.units.clear(); b.words.clear(); b.trees.clear(); b.bombs.length = 0;
    b.unlocked.clear();
    b.monsters.length = 0; // 清场：只要我们的狮子
    b.monsters.push({
      id: 999, dist: 4, hp: 500, maxHp: 500, spd: 0, isBoss: false, isMiniBoss: true,
      miniBossKind: 'lion', isCavalry: false, hitFlash: 0, skill: null, skillCd: 0,
      castFlash: 0, spawnT: 1, stunT: 0, slowT: 0, hasteT: 0, healFlash: 0,
      burnT: 0, burnDps: 0, miniBossCasted: false,
    });
    b.bombs.push({ c: 1, r: 8, t: 0 });
  });
  await page.evaluate(() => window.__game.fastForward(0.3));
  let probe = await page.evaluate(() => {
    const b = window.__game.battle;
    return { bombs: b.bombs.length, fx: b.stealFx.map((s) => s.kind), msg: b.message };
  });
  console.log('偷炸药探测：', JSON.stringify(probe));
  if (probe.bombs !== 0) fail('炸药未被卷走（bombs.length=' + probe.bombs + '）');
  if (!probe.fx.includes('bomb')) fail('未见 kind=bomb 的幽灵残影：' + JSON.stringify(probe.fx));
  if (!probe.msg.includes('炸药')) fail('底部提示未点名炸药：' + probe.msg);
  console.log('✅ B 通过：路径上的炸药被黄狮精整颗卷走');

  // ── C：黄狮精偷「空白阵位」 ──
  // 同一只狮子，只留一个已解锁空格 (2,7)（黄风岭初始块格，距狮 (1,7) 恰 1 格）。
  await page.evaluate(() => window.__game.restart(20260824, 1, 'huangfengling', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.evaluate(() => window.__game.fastForward(7));
  await page.evaluate(() => {
    const b = window.__game.battle;
    b.units.clear(); b.words.clear(); b.trees.clear(); b.bombs.length = 0;
    b.unlocked.clear();
    b.unlocked.add('2,7'); // 只留一个空白阵位候选：黄风岭初始块格，距狮 (1,7) 恰 1 格
    b.monsters.length = 0;
    b.monsters.push({
      id: 998, dist: 4, hp: 500, maxHp: 500, spd: 0, isBoss: false, isMiniBoss: true,
      miniBossKind: 'lion', isCavalry: false, hitFlash: 0, skill: null, skillCd: 0,
      castFlash: 0, spawnT: 1, stunT: 0, slowT: 0, hasteT: 0, healFlash: 0,
      burnT: 0, burnDps: 0, miniBossCasted: false,
    });
  });
  await page.evaluate(() => window.__game.fastForward(0.3));
  probe = await page.evaluate(() => {
    const b = window.__game.battle;
    return { fx: b.stealFx.map((s) => s.kind), msg: b.message, unlocked: b.unlocked.has('2,7') };
  });
  console.log('偷空阵位探测：', JSON.stringify(probe));
  if (probe.unlocked) fail('空白阵位 (2,7) 未被回收成未挖开');
  if (!probe.fx.includes('cell')) fail('未见 kind=cell 的幽灵残影：' + JSON.stringify(probe.fx));
  if (!probe.msg.includes('空阵位')) fail('底部提示未点名空阵位：' + probe.msg);
  await page.screenshot({ path: '/tmp/hfl-steal-cell.png' });
  console.log('✅ C 通过：空白阵位被偷后变回未挖开（截图 /tmp/hfl-steal-cell.png）');

  if (errors.length) fail('页面运行时异常共 ' + errors.length + ' 处');
  console.log('🎉 黄风岭 BGM + 黄狮精偷取扩展冒烟全部通过');
} finally {
  await browser.close();
}
