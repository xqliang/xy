// 五行相克浏览器冒烟（T10）：复用仓库既有 puppeteer-core + 系统 Chrome + window.__game 套路。
// 验证四件事：
//   A. 老图（火焰山）怪物继承 fire 五行、盘面武将有五行、渲染不抛错（徽章在 canvas 里，靠截图人工复核）
//   B. 五行克制飘字管线端到端生效：火焰山上混编阵容输出，damageFloats 里应出现 wuxing 'adv'/'dis' 标记
//   C. 新图黄风岭可开局可推进：怪物继承 earth、buildDefense 后能拿到击杀
//   D. 真人对战（enterPvp）可开局且不写续玩存档（PvP 零协议改动回归）
// 前置：worktree 的 web/ 下起 dev 服务：npx vite --port 5199 --strictPort
// 运行：node scripts/smoke-wuxing.mjs（可 PORT / CHROME_PATH 覆盖）
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || '5199';
const URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('❌ 冒烟失败：' + msg); process.exitCode = 1; throw new Error(msg); };

// 教程全部预置为已看（同 smoke-resume：避免 overlay 冻结 sim）
const TUTORIAL_IDS = ['spawnGate', 'tangseng', 'aiOpponent', 'pause', 'peach', 'goSummon', 'battleIntro',
  'firstSummon', 'unitTypes', 'dragToBoard', 'autoplace', 'firstPlacement', 'attackRange', 'firstHeroWord',
  'heroWord', 'firstShovel', 'shovelUse', 'shovelWhere', 'firstActiveReady', 'activeReady', 'firstHeroCombo',
  'heroCombo', 'firstMergeable', 'mergeUpgrade', 'firstFragmentDrop', 'fragmentInfo', 'weaponUpgrade',
  'merchantFirstOpen', 'activeSkill', 'passiveSkill', 'lowStamina', 'staminaPlus'];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => { console.error('⚠️ 页面运行时异常：', e.message); errors.push(String(e)); process.exitCode = 1; });
  await page.evaluateOnNewDocument((ids) => {
    const seen = {};
    for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // ── A+B：火焰山（fire）开局，验证继承 + 克制飘字管线 ──
  await page.evaluate(() => window.__game.restart(20260824, 1, 'huoyanshan', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.evaluate(() => window.__game.fastForward(7)); // 过入场进 wave1
  await page.evaluate(() => window.__game.buildDefense(3000)); // 兵种防线（兵种无五行）
  // 直接摆武将字牌对（单测同款 words.set 通道）：八戒=水（克火→adv）、金吒=金（被火克→dis）。
  // 两个坑（调试踩过）：① buildDefense 只放兵种不放武将；② 字牌必须放已解锁格（initialBlock
  // c2-4/r6-7），放未解锁格会被生产帧巡检回收——火焰山解锁区内 (2,7) 恰好贴路径 r8 行（射程内）。
  await page.evaluate(() => {
    const b = window.__game.battle;
    const put = (c, r, char, general) => b.words.set(`${c},${r}`, { char, general, tier: 2, cell: { c, r } });
    put(2, 7, '八', 'bajie'); put(3, 7, '戒', 'bajie'); // 贴路径 (2,8)/(3,8)，射程 1 内
    put(2, 6, '金', 'jinzha'); put(3, 6, '吒', 'jinzha'); // 解锁区内第二对
    return b.activeGenerals().map((g) => ({ id: g.def.id, el: g.def.element }));
  }).then((a) => console.log('已激活武将：', JSON.stringify(a)));
  let sawAdv = false, sawDis = false, sample = null;
  const seenEls = new Set(); // 累计各采样点观测到的怪五行（末次可能怪已清空）
  for (let i = 0; i < 60; i++) {
    // 推进+采样必须同一 evaluate 原子完成：教程已读时生产 rAF 循环实时并行跑，
    // 分两次调用的话 evaluate 往返延迟里短命飘字就过期了（调试踩过的坑）。
    sample = await page.evaluate(() => {
      window.__game.fastForward(0.5);
      const b = window.__game.battle;
      return {
        monsters: b.monsters.length,
        monsterEls: [...new Set(b.monsters.map((m) => m.element))],
        kills: b.snapshot().kills,
        wuxingTags: [...new Set(b.damageFloats.map((d) => d.wuxing).filter(Boolean))],
      };
    });
    for (const e of sample.monsterEls) seenEls.add(e);
    if (sample.wuxingTags.includes('adv')) sawAdv = true;
    if (sample.wuxingTags.includes('dis')) sawDis = true;
    if (i % 10 === 0 || sample.wuxingTags.length) console.log('  采样' + i, JSON.stringify(sample));
    if (sawAdv && sawDis && seenEls.has('fire')) break;
  }
  console.log('火焰山采样：', JSON.stringify(sample));
  if (!seenEls.has('fire')) fail('火焰山怪物未继承 fire 五行：' + JSON.stringify([...seenEls]));
  if (sample.kills <= 0) fail('火焰山混编阵容 30 秒内零击杀（对局异常）');
  if (!sawAdv) fail('未观测到克制飘字（wuxing=adv）——水系打火怪管线未生效');
  if (!sawDis) fail('未观测到被克飘字（wuxing=dis）——金吒(金)打火怪管线未生效');
  await page.screenshot({ path: '/tmp/wuxing-huoyanshan.png' });

  // 像素级徽章验证：游戏画布被 CDN 跨域立绘污染，getImageData 会抛 SecurityError——
  // 改为截屏 PNG 塞进干净画布（data URL 无污染）再数元素主题色像素（±30 容差，阈值 30）。
  // 注意：游戏页可能有 CSP 拦 data: 图，分析放在独立 about:blank 页做。
  const anaPage = await browser.newPage();
  const countColors = async (rgb) => {
    const buf = await page.screenshot({ type: 'png' });
    return anaPage.evaluate(async (dataUrl, [r, g, b]) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load fail')); img.src = dataUrl; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - r) <= 30 && Math.abs(d[i + 1] - g) <= 30 && Math.abs(d[i + 2] - b) <= 30) n++;
      }
      return n;
    }, 'data:image/png;base64,' + Buffer.from(buf).toString('base64'), rgb); // 截屏是 Uint8Array，直接 .toString('base64') 会退化成 toString(radix)
  };
  const firePx = await countColors([244, 81, 30]);   // 火 #f4511e（怪头顶徽章）
  const waterPx = await countColors([61, 139, 255]); // 水 #3d8bff（八戒头顶徽章）
  console.log('徽章像素扫描：', JSON.stringify({ fire: firePx, water: waterPx }));
  if (firePx < 30) fail('火焰山画面未见火元素徽章色像素（怪物头顶徽章未渲染？）');
  if (waterPx < 30) fail('画面未见水元素徽章色像素（八戒头顶徽章未渲染？）');
  console.log('✅ A2 通过：火/水徽章像素级渲染确认（fire=' + firePx + ', water=' + waterPx + '）');
  console.log('✅ A+B 通过：fire 继承 + 克制飘字（adv' + (sawDis ? '/dis' : '') + '）已观测，截图 /tmp/wuxing-huoyanshan.png');

  // ── C：黄风岭（earth）可开局可推进 ──
  await page.evaluate(() => window.__game.restart(20260824, 1, 'huangfengling', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.evaluate(() => window.__game.fastForward(7));
  await page.evaluate(() => window.__game.buildDefense(3000));
  let hfl = null;
  const hflEls = new Set(); // 累计观测（同 A 段：末次可能怪已清空）
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.__game.fastForward(1));
    hfl = await page.evaluate(() => {
      const b = window.__game.battle;
      return { status: b.status, wave: b.wave, kills: b.snapshot().kills,
        monsterEls: [...new Set(b.monsters.map((m) => m.element))] };
    });
    for (const e of hfl.monsterEls) hflEls.add(e);
    if (hfl.kills > 0) break;
  }
  console.log('黄风岭采样：', JSON.stringify(hfl));
  if (hfl.status === 'lost') fail('黄风岭开局即败（数值/路径异常）');
  if (!hflEls.has('earth')) fail('黄风岭怪物未继承 earth 五行：' + JSON.stringify([...hflEls]));
  if (hfl.kills <= 0) fail('黄风岭 30 秒内零击杀（不可推进）');
  await page.screenshot({ path: '/tmp/wuxing-huangfengling.png' });
  // 像素级徽章验证（同 A2 的 countColors）：黄风岭怪为土系，扫土元素色 #a1743c
  const earthPx = await countColors([161, 116, 60]);
  if (earthPx < 30) fail('黄风岭画面未见土元素徽章色像素（怪物头顶徽章未渲染？）：' + earthPx);
  console.log('✅ C2 通过：土徽章像素级渲染确认（earth=' + earthPx + '）');
  console.log('✅ C 通过：黄风岭 earth 继承 + 可推进（wave=' + hfl.wave + ', kills=' + hfl.kills + '），截图 /tmp/wuxing-huangfengling.png');

  // ── D：真人对战可开局且不写续玩存档 ──
  await page.evaluate(() => window.__game.enterPvp(7));
  await sleep(300);
  await page.evaluate(() => localStorage.removeItem('dasheng.battleSave'));
  await page.evaluate(() => window.__game.fastForward(8));
  await sleep(700);
  const pvp = await page.evaluate(() => ({
    isPvp: !!(window.__game.battle && window.__game.battle.isPvp),
    status: window.__game.battle ? window.__game.battle.status : 'none',
    save: localStorage.getItem('dasheng.battleSave'),
    probe: window.__game.pvpProbe(),
  }));
  console.log('PvP 检查：', JSON.stringify({ isPvp: pvp.isPvp, status: pvp.status, save: pvp.save, ownMonsters: pvp.probe?.ownMonsters }));
  if (!pvp.isPvp) fail('enterPvp 后 battle.isPvp 非真——真人对战开不了局');
  if (pvp.save !== null) fail('在线 PvP 期间写入了续玩存档（应永不落档）');
  console.log('✅ D 通过：真人对战可开局（isPvp=' + pvp.isPvp + '）且不落档');

  if (errors.length) fail('页面运行时异常共 ' + errors.length + ' 处');
  console.log('🎉 五行冒烟全部通过');
  await anaPage.close();
} finally {
  await browser.close();
}
