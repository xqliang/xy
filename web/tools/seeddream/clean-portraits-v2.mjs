// 重生成后的二次清理兜底（regeneration 仍漏的底色 / 脚下阴影）：
//   1) clean-pale-bg：模型偶用淡绿/淡蓝幕（饱和度不够），chroma 阈值扣不净，留一片 uniform 底色。
//      用「绿色通道占优」g > max(r,b)+10 且 g >= 150 作为背景色判定（仅适用于画面本无绿色的角色如
//      Mile/唐僧/哪吒等；观音杨柳用蓝幕不在此列）。从任何偏绿的边缘像素泛洪向内清除——透明四角
//      g≈0 不起洪，金/红/棕/肌肤/奶白 g 皆非主通道被放过，故无需 anyOpaque 守卫。
//   2) clean-bottom-shadow：清除 y0=74% 向下的灰投影（mn 140-215、低彩、非暖），专治脚下阴影；
//      亮度上界 215 避开高亮白衣裤，低彩卡住彩色角色服。对角色无改错伤害。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/game-assets');
const files = process.argv.slice(2).map((a) => (a.endsWith('.png') ? a : `${a}.png`));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

for (const file of files) {
  const filePath = path.join(DIR, file);
  const b64 = readFileSync(filePath).toString('base64');

  const result = await page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;

    const lum = (i) => Math.min(p[i], p[i + 1], p[i + 2]);
    const isWarm = (i) => p[i] > p[i + 1] + 14 && p[i] > p[i + 2] + 10;
    const isFloorShadow = (i) => {
      if (p[i + 3] === 0) return false;
      const mn = lum(i);
      const mx = Math.max(p[i], p[i + 1], p[i + 2]);
      return mn >= 140 && mn <= 215 && mx - mn <= 24 && !isWarm(i);
    };
    // 背景绿判定 v2（放宽阈值抓淡绿幕残留 + 内部孤岛）：g 通道占优且够亮。
    // 哪吒等角色的红/金/皮肤 g 都不是主通道，不会被放过；放宽到 >= 110 且 g > max(r,b)+5
    // 能把 chroma 漏扣的淡绿底色孤岛也纳入，以便 push 起始点能覆盖到它们。
    const isBgGreen = (i) => p[i + 1] > Math.max(p[i], p[i + 2]) + 5 && p[i + 1] >= 110;

    let hazeCleared = 0;
    {
      const visited = new Uint8Array(w * h);
      const stack = [];
      const push = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const idx = y * w + x;
        if (visited[idx]) return;
        visited[idx] = 1;
        if (isBgGreen(idx * 4)) stack.push(idx);
      };
      // v2：起始点不只看四边，整张图所有底色嫌疑像素都 push 进栈，
      // 让泛洪能渗进被角色挡住的内部孤岛（v1 只从四边 push，孤岛碰不到）。
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          push(x, y);
        }
      }
      while (stack.length) {
        const idx = stack.pop();
        const i = idx * 4;
        if (p[i + 3] > 0) { p[i + 3] = 0; hazeCleared++; }
        const x = idx % w, y = (idx / w) | 0;
        push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
      }
    }

    const y0 = Math.floor(h * 0.74);
    let shadowCleared = 0;
    for (let y = y0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (p[i + 3] > 0 && isFloorShadow(i)) { p[i + 3] = 0; shadowCleared++; }
      }
    }

    ctx.putImageData(data, 0, 0);
    return { png: cv.toDataURL('image/png').split(',')[1], hazeCleared, shadowCleared };
  }, `data:image/png;base64,${b64}`);

  writeFileSync(filePath, Buffer.from(result.png, 'base64'));
  console.log(`✅ ${file}: green-haze ${result.hazeCleared} | bottom-shadow ${result.shadowCleared}`);
}
await browser.close();
