// 微信小游戏构建的资源清单：与 Web 一样全部走 CDN（火山引擎 TOS），不再把 game-assets 拷进
// wechat/assets 包体 —— 大幅减小小游戏包大小，且素材可随时热更新（无需重新提审发版）。
// 前提：需在小程序后台「开发管理 → 开发设置 → 服务器域名」把 CDN 域名加入
// downloadFile 合法域名（wx.createImage/InnerAudioContext 走网络图片时会走该白名单校验）。
// vite.wx.config.ts 的别名把 '@asset-manifest' 指到这里；文件名清单与 Web 共用一份（见 asset-manifest.names.ts）。
import { ASSET_FILENAMES, CDN_BASE } from './asset-manifest.names';

export const ASSET_URLS: Record<string, string> = {};
for (const [key, name] of Object.entries(ASSET_FILENAMES)) {
  ASSET_URLS[key] = CDN_BASE + name;
}
