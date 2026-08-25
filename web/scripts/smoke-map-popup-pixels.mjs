// 像素级验证：选关弹窗第 3 行（黄风岭卡）真的被绘制出来。
// 方法：截「菜单底屏」与「弹窗开」两帧，第 5 卡矩形区域内差异像素多 → 卡片画出来了。
// 画布被 CDN 跨域污染 getImageData 会抛 SecurityError → 用页面截屏 PNG→dataURL→干净离屏画布绕道。
import puppeteer from 'puppeteer-core';

const URL = 'http://127.0.0.1:5199/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 1010 });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__game');

  // 菜单底屏帧
  await new Promise((r) => setTimeout(r, 300));
  const beforePng = await page.screenshot({ encoding: 'binary' });

  // 开弹窗帧
  await page.mouse.click(280, 548);
  await new Promise((r) => setTimeout(r, 400));
  const afterPng = await page.screenshot({ encoding: 'binary' });

  // 在同一 page 上用离屏画布比对第 5 卡区域（约 x:84-284, y:590-738，由 mapCardRect(4) 推得）
  const diff = await page.evaluate(async (beforeB64, afterB64) => {
    const load = (b64) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = 'data:image/png;base64,' + b64;
    });
    const a = await load(beforeB64);
    const b = await load(afterB64);
    const R = { x: 90, y: 600, w: 190, h: 130 }; // 第 5 卡内部（避开边框文字边缘抖动）
    const cv = document.createElement('canvas');
    cv.width = R.w; cv.height = R.h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const count = (img) => {
      ctx.clearRect(0, 0, R.w, R.h);
      ctx.drawImage(img, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
      return ctx.getImageData(0, 0, R.w, R.h).data;
    };
    const da = count(a);
    const db = count(b);
    let diffPx = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > 12 || Math.abs(da[i + 1] - db[i + 1]) > 12 || Math.abs(da[i + 2] - db[i + 2]) > 12) diffPx++;
    }
    // 弹窗开后该区域呈黄风岭主题的暖土黄渐变（bg0 #eee4c8 → bg1 #d8c294），
    // 而非菜单底/弹窗蒙层的暗色 → 说明第 3 行卡片真的绘制出来了
    let warmPx = 0;
    for (let i = 0; i < db.length; i += 4) {
      const [r, g, b] = [db[i], db[i + 1], db[i + 2]];
      if (r >= 200 && r <= 245 && g >= 185 && g <= 235 && b >= 140 && b <= 210 && r > g && g > b) warmPx++;
    }
    return { diffPx, warmPx, total: R.w * R.h };
  }, Buffer.from(beforePng).toString('base64'), Buffer.from(afterPng).toString('base64'));

  console.log('第 5 卡区域像素统计：', JSON.stringify(diff));
  if (diff.diffPx < diff.total * 0.2) { console.error('❌ 第 5 卡区域前后差异过小，卡片疑似未绘制'); process.exit(1); }
  if (diff.warmPx < diff.total * 0.3) { console.error('❌ 第 5 卡区域暖土黄占比过低，疑似未画黄风岭卡'); process.exit(1); }
  console.log('🎉 像素验证通过：第 3 行黄风岭卡已渲染');
} finally {
  await browser.close();
}
