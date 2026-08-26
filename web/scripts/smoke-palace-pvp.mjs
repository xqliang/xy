// 宫檐与 PvP UI 冒烟：A 弹窗厚重宫檐标题栏；B 匹配中屏（背景+雷达）；C 匹配成功对阵卡动画+自动开局；
// D 首页 PvP 入口按钮（朱红/青灰 Seedream 底图 + canvas 叠字）。
// 前置：web/ 下 npx vite --port 5199 --strictPort；headless 依赖 window.__game.fakePvpMatch 钩子
// （无服务端摆出匹配屏各阶段；matched 分支动画播完走真实开局路径）。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error('❌ ' + msg); process.exit(1); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', (e) => { console.error('⚠️', e.message); errs.push(e.message); });
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');
  await sleep(600);

  const geo = await page.evaluate(async () => {
    const r = await import('/src/render.ts');
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, W: r.VIEW_W, H: r.VIEW_H };
  });
  const toPage = (vx, vy) => ({ x: geo.x + vx * geo.w / geo.W, y: geo.y + vy * geo.h / geo.H });
  const ana = await browser.newPage();
  await page.bringToFront(); // ana 建立会激活新 tab → game 页变后台、rAF 被节流 → 拉回前台（否则 frame 循环停转）
  // view 坐标 → 页面坐标后采样：朱红瓦面 / 金饰计数 + 平均色
  const sampleView = async (vx0, vy0, vx1, vy1) => {
    const buf = await page.screenshot({ type: 'png' });
    const a = toPage(vx0, vy0), b = toPage(vx1, vy1);
    return ana.evaluate(async (dataUrl, A, B) => {
      const img = new Image();
      await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('f')); img.src = dataUrl; });
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let red = 0, gold = 0, n = 0, sr = 0, sg = 0, sb = 0;
      for (let y = Math.floor(A.y); y < B.y; y++) for (let x = Math.floor(A.x); x < B.x; x++) {
        const i = (y * cv.width + x) * 4; n++;
        const [r, g, bl] = [d[i], d[i + 1], d[i + 2]];
        sr += r; sg += g; sb += bl;
        if (r > 140 && g < 100 && bl < 90 && r - g > 50) red++;
        if (r >= 185 && r <= 245 && g >= 135 && g <= 195 && bl <= 115) gold++;
      }
      return { red, gold, n, avg: [sr / n, sg / n, sb / n].map(Math.round) };
    }, 'data:image/png;base64,' + Buffer.from(buf).toString('base64'), a, b);
  };

  // —— D：首页 PvP 入口按钮（真人对战=朱红底图 / 邀请好友=青灰底图，程序叠字）——
  // 初始屏就是菜单，放在最前采样；C 段会切到战斗屏且无回菜单钩子。
  // PVP_MATCH_BTN = { x:(560-372)/2=94, y:772, w:180, h:64 }；INVITE x=94+180+12=286
  await page.screenshot({ path: '/tmp/pvp-buttons.png' });
  const mBtn = await sampleView(96, 774, 272, 834);
  const iBtn = await sampleView(288, 774, 464, 834);
  console.log('真人对战按钮：朱红', mBtn.red, '平均色', mBtn.avg, '邀请好友按钮：平均色', iBtn.avg);
  if (mBtn.red < 300) fail('真人对战按钮未见朱红底图（素材未加载？）');
  // 邀请好友青灰底：R-G 色差应远小于朱红按钮（朱红 R-G≈86 / 青灰 R-G≈2）
  if (iBtn.avg[0] - iBtn.avg[1] > (mBtn.avg[0] - mBtn.avg[1]) / 2) fail('邀请好友按钮底图色调未区分（青灰缺失？）');
  console.log('✅ D 首页 PvP 入口按钮（截图 /tmp/pvp-buttons.png）');

  // —— A：弹窗厚重宫檐标题栏（帮助弹窗 HELP_PW=440 HELP_PH=640，弹窗顶 view y≈202）——
  const btn = toPage(64, 379);
  await page.mouse.click(btn.x, btn.y);
  await sleep(500);
  await page.screenshot({ path: '/tmp/palace-popup-v2.png' });
  const head = await sampleView(geo.W / 2 - 200, 194, geo.W / 2 + 200, 244);
  console.log('弹窗标题栏：朱红瓦面', head.red, '金饰', head.gold, '平均色', head.avg);
  if (head.red < 400) fail('标题栏未见朱红瓦面（宫檐带未渲染？）');
  if (head.gold < 40) fail('标题栏未见金饰（翘角/瓦当缺失？）');
  console.log('✅ A 厚重宫檐标题栏（截图 /tmp/palace-popup-v2.png）');
  // 关弹窗：右上角 ×（inkPopupCloseRect：headH=46、BAND_LIFT=15、CLOSE_LIFT=0）
  const closeBtn = toPage(geo.W / 2 + 440 / 2 - 24, 202 + 23);
  await page.mouse.click(closeBtn.x, closeBtn.y);
  await sleep(300);
  const menuBack = await page.evaluate(() => window.__game.curScreen());
  if (menuBack !== 'menu') fail('关闭按钮新位置点击未生效（弹窗未关）：' + menuBack);

  // —— B：匹配中屏（背景图 + 雷达扫描 + 呼吸点）——
  await page.evaluate(() => window.__game.fakePvpMatch('queuing'));
  await sleep(600);
  const scrB = await page.evaluate(() => window.__game.curScreen());
  if (scrB !== 'pvpMatching') fail('fakePvpMatch(queuing) 未进匹配屏: ' + scrB);
  await page.screenshot({ path: '/tmp/pvp-queuing.png' });
  const bgTop = await sampleView(20, 30, geo.W - 20, 130); // 顶部背景区（无 UI 元素）
  console.log('匹配屏顶部背景平均色', bgTop.avg);
  // 背景图与米色回退 (#efe3c6=239,227,198) 应有显著差异（云海图偏青灰）
  const dist = Math.abs(bgTop.avg[0] - 239) + Math.abs(bgTop.avg[1] - 227) + Math.abs(bgTop.avg[2] - 198);
  if (dist < 30) fail('匹配屏背景疑似未加载（色彩接近米色回退）dist=' + dist.toFixed(0));
  console.log('✅ B 匹配中屏：背景图 + 状态动画（截图 /tmp/pvp-queuing.png）');

  // —— C：匹配成功对阵卡动画 + 自动开局 ——
  await page.evaluate(() => window.__game.fakePvpMatch('matched'));
  await sleep(1100); // 动画中段：头像卡已滑入、VS 已弹出、金字已淡入
  await page.screenshot({ path: '/tmp/pvp-matched.png' });
  // 左右头像卡区域（cy=400：头像 cy-30±46 → view y 324..416；左卡中心 x=280-150=130，右卡 x=280+150=430）
  const l = await sampleView(130 - 50, 330, 130 + 50, 420);
  const r = await sampleView(430 - 50, 330, 430 + 50, 420);
  // VS 金字区
  const vs = await sampleView(geo.W / 2 - 40, 340, geo.W / 2 + 40, 420);
  console.log('左头像卡金框', l.gold, '右头像卡金框', r.gold, 'VS区金字', vs.gold);
  if (l.gold < 15 || r.gold < 15) fail('对阵卡头像未见（金圆框缺失）');
  if (vs.gold < 8) fail('VS 金字未见');
  // 等动画播完（MATCHED_SHOW_MS=2600）→ 应自动开局进战斗屏
  await sleep(2200);
  const probe = await page.evaluate(() => ({ probe: window.__game.pvpMatchProbe(), screen: window.__game.curScreen() }));
  console.log('probe:', JSON.stringify(probe));
  const scrC = probe.screen;
  console.log('动画播完 curScreen =', scrC);
  if (scrC !== 'battle') fail('匹配成功动画播完未自动开局（应切 battle）');
  if (errs.length) fail('页面运行时异常 ' + errs.length + ' 处');
  console.log('✅ C 匹配成功对阵卡 + 自动开局（截图 /tmp/pvp-matched.png）');
  console.log('🎉 全部通过');
} finally {
  await browser.close();
}
