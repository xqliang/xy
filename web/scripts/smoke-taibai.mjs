// 太白改名冒烟（#64）：立绘加载 + 新版大招特效四层渲染。
// 验证：
//   1. 网络：hero-taibai（带哈希 URL）真的被请求（资源键接线 + CDN 上传 OK）；
//   2. 像素：直接注入 heroUltFx（视觉层公有数组），在大招三个相位截图，
//      对比无特效基线——星爆相位应有显著暖金增量（金色星体/十字光芒），
//      扫击/余韵相位也应有可测增量。地图选盘丝洞（冷紫底）避免土黄底误报。
// 前置：web/ 下 npx vite --port 5199 --strictPort
import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5199/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fail = (msg) => { console.error('❌ ' + msg); process.exitCode = 1; throw new Error(msg); };

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
  page.on('pageerror', (e) => { errors.push(String(e)); process.exitCode = 1; });
  const fetched = new Set();
  page.on('response', (r) => fetched.add(r.url()));
  await page.evaluateOnNewDocument((ids) => {
    const seen = {};
    for (const id of ids) seen[id] = true;
    localStorage.setItem('dasheng.tutorial', JSON.stringify({ seen }));
  }, TUTORIAL_IDS);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  await page.evaluate(() => window.__game.restart(20260824, 1, 'pansidong', false));
  await page.evaluate(() => window.__game.enterBattle());
  await page.waitForFunction('window.__game.assetsReady?.() === true', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  // 1) 立绘网络请求（哈希 URL 命中即证明 manifest 接线 + 上传成功）
  const hit = [...fetched].some((u) => u.includes('hero-taibai'));
  console.log('hero-taibai 网络请求命中：', hit);
  if (!hit) fail('hero-taibai 未被请求（资源键未接线或未上传）');

  // 像素分析页（画布被 CDN 跨域污染，截图走干净画布）。
  // 注意：新建标签会抢走前台，游戏页 rAF 随之被节流停帧（截图会与基线逐像素相同），
  // 必须把游戏页 bringToFront 切回来再截图。
  const anaPage = await browser.newPage();
  await page.bringToFront();
  const goldCount = async (shotB64) => anaPage.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('load fail')); img.src = 'data:image/png;base64,' + b64; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    // 特效中心：格 (3,5)。canvas 高 800 → 等比 scale=800/1044，视口居中。
    const scale = cv.height / 1044;
    const vx = (cv.width - 560 * scale) / 2; // 视口左缘
    const cx = vx + (8 + 3.5 * 68) * scale; // BOARD_X = (560-68*8)/2 = 8
    const cy = (84 + 5.5 * 68) * scale;
    const rad = 3.5 * 68 * scale; // rge=3 格的特效半径再放宽半格
    const d = ctx.getImageData(Math.max(0, cx - rad), Math.max(0, cy - rad), rad * 2, rad * 2).data;
    let gold = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      n++;
      if (d[i] > 195 && d[i + 1] > 165 && d[i + 2] < 190 && d[i] - d[i + 2] > 45) gold++; // 暖金且明显偏黄
    }
    return { gold, n, goldPct: +(gold / Math.max(1, n) * 100).toFixed(2) };
  }, shotB64);

  // 暖化像素统计：对比基线与特效截图同区域的逐像素变化，数「明显变暖变亮」的像素。
  // 半透明的星尘混在深色底上达不到亮金阈值，必须用差分才能测到。
  const warmedCount = async (baseB64, fxB64) => anaPage.evaluate(async ([s1, s2]) => {
    const load = (b) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load fail')); i.src = 'data:image/png;base64,' + b; });
    const i1 = await load(s1), i2 = await load(s2);
    const mk = (img) => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0); return c.getImageData(0, 0, cv.width, cv.height).data; };
    const d1 = mk(i1), d2 = mk(i2);
    const scale = i1.height / 1044;
    const vx = (i1.width - 560 * scale) / 2;
    const x0 = Math.max(0, Math.round(vx + (8 + 3.5 * 68 - 3.5 * 68) * scale));
    const y0 = Math.max(0, Math.round((84 + 5.5 * 68 - 3.5 * 68) * scale));
    const w = Math.round(7 * 68 * scale), h = w;
    let warm = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * i1.width + x) * 4;
      const dr = d2[i] - d1[i], dg = d2[i + 1] - d1[i + 1], db = d2[i + 2] - d1[i + 2];
      if (dr > 15 && dr - db > 10) warm++; // 变亮且偏暖
    }
    return warm;
  }, [baseB64, fxB64]);

  // 2) 大招三相位：maxTtl 拉长到 1.5s 便于采样。
  //    headless 下 rAF 帧率不稳、游戏 dt 与墙钟不成正比，不能按墙钟等——
  //    轮询 fx.ttl 到目标进度 p 再截图（p = 1 - ttl/maxTtl）。
  //    p≈0.25（拂尘扫击）/ p≈0.55（长庚星爆最亮）/ p≈0.85（星环+星尘余韵）
  const phases = [
    { name: '扫击(p≈0.25)', prog: 0.25, minDelta: 60, minWarmed: 150 },
    { name: '星爆(p≈0.55)', prog: 0.55, minDelta: 300, minWarmed: 800 },
    { name: '余韵(p≈0.85)', prog: 0.85, minDelta: 40, minWarmed: 80 },
  ];
  for (const ph of phases) {
    // 每相位先截「新鲜基线」：场景本身有动画（门/唐僧/计时），跟最早那张静态基线比
    // 会引入随时间累积的漂移（曾测得 -500+ 的假阴性）。
    // 必须等上一相位特效彻底消失（ttl 拉长到 1.5s，250ms 远不够）。
    await page.waitForFunction('window.__game.battle.heroUltFx.length === 0', { timeout: 6000, polling: 100 }).catch(() => {});
    const phBaseShot = Buffer.from(await page.screenshot({ type: 'png' })).toString('base64');
    const phBase = await goldCount(phBaseShot);
    await page.evaluate(() => {
      const b = window.__game.battle;
      b.heroUltFx.length = 0;
      b.heroUltFx.push({ heroId: 'taibai', c: 3, r: 5, ttl: 1.5, maxTtl: 1.5, tier: 3, rge: 3, crit: false });
    });
    // 轮询到目标相位（超时 5s 兜底）
    await page.waitForFunction(
      (target) => {
        const f = window.__game.battle.heroUltFx[0];
        return !f || 1 - f.ttl / f.maxTtl >= target;
      },
      { timeout: 5000, polling: 50 },
      ph.prog,
    ).catch(() => {});
    const shot = Buffer.from(await page.screenshot({ type: 'png' })).toString('base64');
    const st = await goldCount(shot);
    const delta = st.gold - phBase.gold;
    const warmed = await warmedCount(phBaseShot, shot);
    console.log(`${ph.name}：gold=${st.gold}（相位基线 ${phBase.gold}，增量 ${delta}，暖化像素 ${warmed}）`);
    if (delta < ph.minDelta && warmed < ph.minWarmed) {
      fail(`${ph.name} 暖金增量 ${delta} 与暖化像素 ${warmed} 均不足——大招疑似未渲染`);
    }
  }
  await page.screenshot({ path: '/tmp/taibai-ult.png' });

  if (errors.length) fail('页面运行时异常：' + errors[0]);
  console.log('🎉 太白冒烟通过（截图 /tmp/taibai-ult.png）');
  await anaPage.close();
} finally {
  await browser.close();
}
