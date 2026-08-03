// 资源加载：加载 Seedream 生成的立绘，把纯白背景抠成透明，缓存为离屏 canvas。
import type { UnitType } from '@core';

export type AssetKey =
  | 'tangseng'
  | 'unit-monkey'
  | 'unit-spear'
  | 'unit-cavalry'
  | 'unit-archer'
  | 'monster-minion'
  | 'monster-boss';

const FILES: Record<AssetKey, string> = {
  tangseng: '/assets/tangseng.jpg',
  'unit-monkey': '/assets/unit-monkey.jpg',
  'unit-spear': '/assets/unit-spear.jpg',
  'unit-cavalry': '/assets/unit-cavalry.jpg',
  'unit-archer': '/assets/unit-archer.jpg',
  'monster-minion': '/assets/monster-minion.jpg',
  'monster-boss': '/assets/monster-boss.jpg',
};

const cache: Partial<Record<AssetKey, HTMLCanvasElement>> = {};
let ready = false;
export function assetsReady(): boolean {
  return ready;
}

// 纯白背景抠透明：near-white 且低饱和的像素 → alpha 0，边缘做一档羽化。
function keyWhite(img: HTMLImageElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(img, 0, 0);
  const data = c.getImageData(0, 0, cv.width, cv.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i]!, g = p[i + 1]!, b = p[i + 2]!;
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    if (mn >= 244 && mx - mn <= 12) {
      p[i + 3] = 0; // 纯白 → 透明
    } else if (mn >= 232 && mx - mn <= 18) {
      p[i + 3] = Math.round(p[i + 3]! * 0.35); // 近白边缘羽化
    }
  }
  c.putImageData(data, 0, 0);
  return cv;
}

function loadOne(key: AssetKey): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        cache[key] = keyWhite(img);
      } catch {
        /* 忽略单张失败 */
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = FILES[key];
  });
}

export async function loadAssets(): Promise<void> {
  await Promise.all((Object.keys(FILES) as AssetKey[]).map(loadOne));
  ready = true;
  (window as unknown as { __assetsReady: boolean }).__assetsReady = true;
}

export function sprite(key: AssetKey): HTMLCanvasElement | undefined {
  return cache[key];
}

export function unitAsset(type: UnitType): AssetKey {
  return `unit-${type}` as AssetKey;
}
