// Web 构建的资源清单：全部走 CDN（火山引擎 TOS，见 asset-manifest.names.ts 的 CDN_BASE），
// 不再由 Vite 把 src/game-assets/ 打进 dist/assets —— 首屏 JS/HTML 体积与部署包大小都不含这些素材，
// 用 `node tools/tos-upload.mjs` 更新素材后即时对所有用户生效（无需重新构建/部署 dist）。
// 注意：微信构建走 asset-manifest.wx.ts（见 vite.wx.config.ts 的别名），二者共享同一份文件名清单。
import { ASSET_FILENAMES, CDN_BASE } from './asset-manifest.names';
// 内容哈希 URL 表：由 tools/tos-upload.mjs 上传时按内容生成（同名同内容永远同 URL，不同内容 URL 必不同）。
// 优先用它做缓存击穿；缺失（如尚未 tos-upload）时回退 bare URL，保证旧构建仍可用。
import { HASHED_URLS } from './game-assets/manifest-generated';

export const ASSET_URLS: Record<string, string> = {};
for (const [key, name] of Object.entries(ASSET_FILENAMES)) {
  ASSET_URLS[key] = HASHED_URLS[name] ?? (CDN_BASE + name);
}
