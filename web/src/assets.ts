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
  | 'monster-minion-huoyanshan'
  | 'monster-boss-huoyanshan'
  | 'monster-minion-liushahe'
  | 'monster-boss-liushahe'
  | 'monster-minion-baiguling'
  | 'monster-boss-baiguling'
  | 'monster-minion-pansidong'
  | 'monster-boss-pansidong'
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
  | 'map-pansidong'
  | 'fence-baiguling'
  | 'fence-liushahe';

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
  // 只预载图片素材；bgm-* 等音频资源不走 <img>，由 sfx 模块按需 fetch+decode。
  const imgKeys = (Object.keys(ASSET_URLS) as AssetKey[]).filter((k) => !k.startsWith('bgm-'));
  await Promise.all(imgKeys.map(loadOne));
  ready = true;
  (window as unknown as { __assetsReady: boolean }).__assetsReady = true;
}

export function sprite(key: AssetKey): HTMLImageElement | undefined {
  return cache[key];
}

export function unitAsset(type: UnitType): AssetKey {
  return `unit-${type}` as AssetKey;
}

// 怪物立绘按地图取专属图（monster-{role}-{mapId}），缺图回退通用 monster-{role}。
export function monsterSprite(mapId: string, isBoss: boolean): HTMLImageElement | undefined {
  const role = isBoss ? 'boss' : 'minion';
  return cache[`monster-${role}-${mapId}` as AssetKey] ?? cache[`monster-${role}` as AssetKey];
}
