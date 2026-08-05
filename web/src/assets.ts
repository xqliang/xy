// 资源加载：加载 Seedream 生成的立绘（已离线抠成透明 PNG），缓存为 <img>。
// 资源 URL 来自 @asset-manifest：web 构建=带内容哈希的 /assets/*-<hash>.*（见 asset-manifest.web.ts），
// 微信构建=包内相对路径 assets/*（见 asset-manifest.wx.ts）；由各自 vite 配置的别名切换。
import type { UnitType } from '@core';
import { createImage } from './platform';
import { ASSET_URLS } from '@asset-manifest';

export type AssetKey =
  | 'tangseng'
  | 'unit-monkey'
  | 'unit-spear'
  | 'unit-cavalry'
  | 'unit-archer'
  | 'monster-minion'
  | 'monster-boss'
  | 'item-shovel'
  | 'camp'
  | 'hero-wukong'
  | 'hero-bajie'
  | 'hero-shaseng'
  | 'hero-guanyin'
  | 'hero-nezha'
  | 'hero-erlang'
  | 'hero-tangseng-hero'
  | 'hero-honghaier'
  | 'hero-tieshan'
  | 'hero-baigujing'
  | 'hero-niumowang'
  | 'hero-mile'
  | 'map-huoyanshan'
  | 'map-liushahe'
  | 'map-baiguling'
  | 'map-pansidong';

const cache: Partial<Record<AssetKey, HTMLImageElement>> = {};
let ready = false;
export function assetsReady(): boolean {
  return ready;
}

function loadOne(key: AssetKey): Promise<void> {
  return new Promise((resolve) => {
    const url = ASSET_URLS[key];
    if (!url) { resolve(); return; }
    const img = createImage();
    img.onload = () => {
      cache[key] = img; // 素材已是离线抠好的透明 PNG，直接使用
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

export async function loadAssets(): Promise<void> {
  await Promise.all((Object.keys(ASSET_URLS) as AssetKey[]).map(loadOne));
  ready = true;
  (window as unknown as { __assetsReady: boolean }).__assetsReady = true;
}

export function sprite(key: AssetKey): HTMLImageElement | undefined {
  return cache[key];
}

export function unitAsset(type: UnitType): AssetKey {
  return `unit-${type}` as AssetKey;
}
