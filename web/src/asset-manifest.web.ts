// Web 构建的资源清单：让 Vite 处理 src/game-assets/ 下的图，输出带内容哈希的 URL
// （形如 /assets/unit-archer-<hash>.png）。图片内容不变 → 哈希不变 → URL 跨部署一致，
// 配合服务器对 /assets/* 的 immutable 缓存，实现"没改动就零请求"。
// 注意：微信构建走 asset-manifest.wx.ts（见 vite.wx.config.ts 的别名），不经过此文件。

// eager + ?url：拿到每个资源的最终打包 URL（字符串）
const mods = import.meta.glob('./game-assets/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

// key = 去掉目录与扩展名的文件名（即 AssetKey，如 'unit-archer' / 'map-huoyanshan'）
export const ASSET_URLS: Record<string, string> = {};
for (const [p, url] of Object.entries(mods)) {
  const name = p.split('/').pop()!.replace(/\.(png|jpg)$/, '');
  ASSET_URLS[name] = url;
}
