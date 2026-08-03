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
  tangseng: '/assets/tangseng.png',
  'unit-monkey': '/assets/unit-monkey.png',
  'unit-spear': '/assets/unit-spear.png',
  'unit-cavalry': '/assets/unit-cavalry.png',
  'unit-archer': '/assets/unit-archer.png',
  'monster-minion': '/assets/monster-minion.png',
  'monster-boss': '/assets/monster-boss.png',
};

const cache: Partial<Record<AssetKey, HTMLImageElement>> = {};
let ready = false;
export function assetsReady(): boolean {
  return ready;
}

function loadOne(key: AssetKey): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      cache[key] = img; // 素材已是离线抠好的透明 PNG，直接使用
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

export function sprite(key: AssetKey): HTMLImageElement | undefined {
  return cache[key];
}

export function unitAsset(type: UnitType): AssetKey {
  return `unit-${type}` as AssetKey;
}
