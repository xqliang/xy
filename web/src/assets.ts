// 资源加载：加载 Seedream 生成的立绘（已离线抠成透明 PNG），缓存为 <img>。
// 资源 URL 来自 @asset-manifest：web 构建=带内容哈希的 /assets/*-<hash>.*（见 asset-manifest.web.ts），
// 微信构建=包内相对路径 assets/*（见 asset-manifest.wx.ts）；由各自 vite 配置的别名切换。
import type { UnitType } from '@core';
import { createImage } from './platform';
import { ASSET_URLS } from '@asset-manifest';

export type AssetKey =
  | 'tangseng'
  | 'loading-tangseng'
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
  | 'monster-cavalry-huoyanshan'
  | 'monster-cavalry-liushahe'
  | 'monster-cavalry-baiguling'
  | 'monster-cavalry-pansidong'
  | 'monster-miniboss-frost'
  | 'monster-miniboss-blight'
  | 'monster-miniboss-quake'
  | 'monster-miniboss-gale'
  | 'monster-miniboss-blood'
  | 'item-shovel'
  | 'hero-wukong'
  | 'hero-bajie'
  | 'hero-shaseng'
  | 'hero-guanyin'
  | 'hero-nezha'
  | 'hero-erlang'
  | 'hero-tangseng-hero'
  | 'hero-ttg' // 二郎神大招冲出咬怪的哮天犬
  | 'hero-honghaier'
  | 'hero-tieshan'
  | 'hero-baigujing'
  | 'hero-niumowang'
  | 'hero-mile'
  | 'hero-damang'
  | 'hero-niulang'
  | 'hero-jinzha'
  | 'hero-hongpao'
  | 'hero-baxian'
  | 'hero-qingniu'
  | 'hero-tiebei'
  | 'hero-liusha'
  | 'hero-bailong'
  | 'hero-fanyin'
  | 'hero-laojun'
  | 'hero-danjun'
  | 'hero-wenshu'
  | 'hero-huishu'
  | 'map-huoyanshan'
  | 'map-liushahe'
  | 'map-baiguling'
  | 'map-pansidong'
  | 'fence-baiguling'
  | 'fence-liushahe'
  | 'fence-pansidong'
  | 'gate-liushahe'
  | 'merchant-scroll'
  | 'merchant-peddler'
  | 'menu-home'
  | 'menu-btn-settings'
  | 'menu-btn-codex'
  | 'menu-btn-rank'
  | 'menu-btn-bag'
  | 'menu-btn-start'
  | 'menu-btn-stamina-plus'
  | 'menu-btn-map'
  | 'menu-btn-stamina-ad'
  | 'menu-btn-stamina-share'
  | 'rank-star-on'
  | 'rank-star-off'
  | 'icon-merit'
  | 'icon-stamina'
  | `skill-${string}`;

const cache: Partial<Record<string, HTMLImageElement>> = {};
let ready = false;
export function assetsReady(): boolean {
  return ready;
}

export type AssetLoadPhase = 'images' | 'audio' | 'done';
export interface AssetLoadProgress {
  loaded: number;
  total: number;
  phase: AssetLoadPhase;
  /** 当前刚完成的资源 key（可选，便于调试） */
  key?: string;
}

export type AssetLoadProgressCb = (p: AssetLoadProgress) => void;

// CDN 加载兜底超时：单个资源卡死（弱网/连接被中间设备吞掉）不应让 Promise.all 永远不 resolve、
// 把玩家卡在加载页出不去——超时后按失败处理（sprite 缺失，与 onerror 行为一致），游戏仍可进入。
const ASSET_LOAD_TIMEOUT_MS = 15000;

function loadOne(key: string): Promise<void> {
  return new Promise((resolve) => {
    const url = ASSET_URLS[key];
    if (!url) { resolve(); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ASSET_LOAD_TIMEOUT_MS);
    const img = createImage();
    img.onload = () => {
      cache[key] = img; // 素材已是离线抠好的透明 PNG，直接使用；即使超时后才到达也补上，好过永远缺失
      finish();
    };
    img.onerror = () => finish();
    img.src = url;
  });
}

/** 图片类资源 key（不含 bgm-*） */
export function imageAssetKeys(): string[] {
  return Object.keys(ASSET_URLS).filter((k) => !k.startsWith('bgm-'));
}

/**
 * 预载全部图片素材；可通过 onProgress 驱动加载页。
 * bgm-* 不走 <img>，由 sfx 模块按需 fetch+decode（加载页可单独标 phase='audio'）。
 */
export async function loadAssets(onProgress?: AssetLoadProgressCb): Promise<void> {
  const imgKeys = imageAssetKeys();
  const total = imgKeys.length;
  let loaded = 0;
  onProgress?.({ loaded: 0, total, phase: 'images' });

  // 加载页立绘优先：先单独拉「唐僧骑马」这一张小图（~33KB），保证进度页一出现
  // 就能播放行走动画，而不是和其余数十张素材一起在并发队列里排队、迟迟不出现。
  const PRIORITY = 'loading-tangseng';
  if (ASSET_URLS[PRIORITY]) {
    await loadOne(PRIORITY);
    loaded += 1;
    onProgress?.({ loaded, total, phase: 'images', key: PRIORITY });
  }

  await Promise.all(imgKeys.filter((k) => k !== PRIORITY).map(async (key) => {
    await loadOne(key);
    loaded += 1;
    onProgress?.({ loaded, total, phase: 'images', key });
  }));

  // 货币桃图标与被动「蟠桃园」同图，避免重复打包
  if (cache['skill-pas-pantao']) cache.peach = cache['skill-pas-pantao'];

  ready = true;
  (window as unknown as { __assetsReady: boolean }).__assetsReady = true;
  onProgress?.({ loaded: total, total, phase: 'done' });
}

export function sprite(key: AssetKey | string): HTMLImageElement | undefined {
  return cache[key];
}

export function unitAsset(type: UnitType): AssetKey {
  // 刀兵 id 为 dao，立绘文件仍为历史名 unit-monkey
  if (type === 'dao') return 'unit-monkey';
  return `unit-${type}` as AssetKey;
}

// 怪物立绘按地图取专属图（monster-{role}-{mapId}），缺图回退通用 monster-{role}。
export function monsterSprite(mapId: string, isBoss: boolean): HTMLImageElement | undefined {
  const role = isBoss ? 'boss' : 'minion';
  return cache[`monster-${role}-${mapId}` as AssetKey] ?? cache[`monster-${role}` as AssetKey];
}

// 骑兵妖：每图专属立绘（monster-cavalry-{mapId}），缺图回退该图小妖。
export function cavalrySprite(mapId: string): HTMLImageElement | undefined {
  return cache[`monster-cavalry-${mapId}` as AssetKey] ?? monsterSprite(mapId, false);
}

// 小 Boss：按种类专属立绘（monster-miniboss-{kind}），缺图回退该图妖王立绘。
export function miniBossSprite(kind: string, mapId: string): HTMLImageElement | undefined {
  return cache[`monster-miniboss-${kind}` as AssetKey] ?? monsterSprite(mapId, true);
}
