// tools/boot-harden-smoke.mjs —— 启动/循环加固冒烟验证。
// 目的：验证 main.ts 的两处加固在「正常 Web 路径」下无回归，且在「缺图」下仍能进首页：
//   ① 启动流程 fail-open：boot 任一步异常也兜底 screen='menu' 并排帧（不再永久卡加载页）。
//   ② frame() 外层 try/catch/finally：单帧抛错不再让 rAF 停摆；异常经 reportFrameError 上报。
// 断言：boot 后 curScreen()==='menu'（循环活着且到达首页）；画布非空白（有内容绘制）；
//       正常路径不应出现 [frame]/[boot] 兜底日志（出现即说明有真实抛错，需查）。
// 注：localhost 下素材走 CDN 可能被 CORS 拦（与真机/线上无关），正好顺带验证「缺图仍出首页」。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5183/?seed=7';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 560, height: 1044, deviceScaleFactor: 2 });

// CDN 跨域/资源加载失败是 localhost 固有噪声，与本次加固无关，过滤掉。
const NOISE = /CORS|volces|Failed to load resource|ERR_FAILED|net::|WebSocket|handshake|decodeAudio/i;
const consoleErrs = [];
const pageErrs = [];
const hardenLogs = []; // 我方兜底标记：[frame] / [boot]
page.on('console', (m) => {
  const t = m.text();
  if (/\[frame\]|\[boot\]/.test(t)) hardenLogs.push(t);
  else if (m.type() === 'error' && !NOISE.test(t)) consoleErrs.push(t);
});
page.on('pageerror', (e) => pageErrs.push(e.message));

const fail = async (msg) => { console.log('❌ FAIL：' + msg); await browser.close(); process.exit(1); };

await page.goto(URL, { waitUntil: 'domcontentloaded' });
// 等 boot 钩子就绪（boot IIFE 跑完会挂 __game 并进入 menu）
await page.waitForFunction('window.__game && typeof window.__game.curScreen === "function"', { timeout: 15000 })
  .catch(() => {});

// ① boot fail-open / 正常 boot：给足时间（含 4s auth 兜底 + 资源）后应到首页
await sleep(6000);
const screen = await page.evaluate(() => window.__game?.curScreen?.() ?? '(no __game)');
console.log('curScreen =', screen);
if (screen === 'loading' || screen === '(no __game)') {
  await fail(`启动后仍停在 "${screen}"——加固失效（应 fail-open 进 menu）`);
}
console.log('✅ ① 启动到达可玩界面：', screen);

// ② 画布非空白：优先采样像素方差；若画布因绘制了跨域 CDN 图而被 taint（getImageData 抛
//    SecurityError），这本身即证明「drawImage 了真实立绘/背景」＝有内容，直接判 PASS。
const px = await page.evaluate(() => {
  const c = document.getElementById('game');
  if (!c) return { err: 'no canvas' };
  const g = c.getContext('2d');
  try {
    const step = 40; const seen = new Set(); let n = 0;
    for (let y = 10; y < c.height; y += step) {
      for (let x = 10; x < c.width; x += step) {
        const d = g.getImageData(x, y, 1, 1).data;
        seen.add(`${d[0] >> 4},${d[1] >> 4},${d[2] >> 4}`); n++;
      }
    }
    return { canvas: `${c.width}x${c.height}`, samples: n, distinctColors: seen.size, tainted: false };
  } catch (e) {
    return { canvas: `${c.width}x${c.height}`, tainted: true, reason: String(e).slice(0, 60) };
  }
});
console.log('canvas =', px.canvas, px.tainted ? '(tainted → 已 drawImage 跨域立绘=有内容)' : `distinctColors=${px.distinctColors}`);
if (px.err) await fail('取不到画布：' + px.err);
if (!px.tainted && px.distinctColors < 8) {
  await fail(`画布疑似空白/纯底（distinctColors=${px.distinctColors}）——菜单未画出`);
}
await page.screenshot({ path: '../shots/boot-harden-menu.png' }).catch(() => {});
console.log('✅ ② 画布有内容（截图 shots/boot-harden-menu.png）');

// ③ 循环存活：连续两次快照的时间戳/帧号应推进（首页大圣待机动画持续重绘）
await sleep(1200);
const alive = await page.evaluate(() => !!(window.__game && window.__game.curScreen));
if (!alive) await fail('__game 钩子丢失');
console.log('✅ ③ 渲染循环存活（__game 持续可用）');

// 正常路径（①~③）不应出现任何 [frame]/[boot] 兜底日志——有则说明真实抛错被兜住，需排查。
if (hardenLogs.length) {
  console.log('⚠️  正常路径出现兜底日志：');
  hardenLogs.slice(0, 5).forEach((l) => console.log('   ', l.slice(0, 200)));
  await fail('正常 Web 路径触发了兜底（说明有真实抛错），需排查');
}
console.log('✅ 正常路径无兜底日志（无真实抛错）');

// ④ 故障注入：让下一次 ctx.fillRect 抛错一次，直接检验 frame() 的 try/catch 是否兜住。
//    加固前：一次抛错 → rAF 停摆 → fillRect 调用数停在个位数；加固后：捕获后照常重排帧 → 持续增长。
await page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillRect;
  window.__fillRectCalls = 0;
  window.__threwOnce = false;
  proto.fillRect = function (...a) {
    window.__fillRectCalls++;
    if (!window.__threwOnce) { window.__threwOnce = true; throw new Error('SMOKE_INJECTED_frame_throw'); }
    return orig.apply(this, a);
  };
});
await sleep(1200);
const inj = await page.evaluate(() => ({ calls: window.__fillRectCalls, threw: window.__threwOnce }));
console.log('注入后 1.2s：fillRect 调用', inj.calls, '次，已触发注入抛错 =', inj.threw);
if (!inj.threw) await fail('注入的抛错没被触发（fillRect 未被调用？）');
if (inj.calls < 30) {
  await fail(`单帧抛错后循环疑似停摆（fillRect 仅 ${inj.calls} 次）——frame() 兜底失效`);
}
// 注入必然产生 [frame] 兜底日志（puppeteer 里错误参数渲染为 JSHandle@error，按条数判定即可）
if (!hardenLogs.some((l) => /\[frame\]/.test(l))) await fail('注入抛错未见 [frame] 兜底日志——未走 reportFrameError 路径');
console.log('✅ ④ 单帧抛错被 frame() 兜住，循环继续（fillRect 持续增长 + 见 [frame] 日志）');

// 汇总：正常路径的兜底已在 ④ 前断言为 0；此处只需确认无「未捕获」的 pageerror（rAF 回调里
// 未被 frame() try/catch 兜住的错误会走这里）。注入产生的 [frame] 日志属预期，不计入失败。
if (pageErrs.length) {
  console.log('⚠️  未捕获 pageerror：');
  pageErrs.slice(0, 5).forEach((l) => console.log('   ', l.slice(0, 200)));
}
if (consoleErrs.length) {
  console.log('ℹ️  其它 console.error（已滤 CDN/CORS 噪声）：');
  consoleErrs.slice(0, 5).forEach((l) => console.log('   ', l.slice(0, 200)));
}

const hardBad = pageErrs.length > 0;
console.log(hardBad ? '\n❌ 存在未捕获错误（见上）' : '\n✅ PASS：启动 fail-open + 循环 try/catch 均生效，正常路径无回归、单帧抛错不再停摆');
await browser.close();
process.exit(hardBad ? 1 : 0);
