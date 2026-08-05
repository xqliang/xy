// 微信小游戏构建的资源清单：包内相对路径 assets/<name>.<ext>
// （由 start.sh wx 从 src/game-assets/ 拷贝到 wechat/assets/，不带哈希）。
// 小游戏是本地包、无 HTTP 缓存问题，不需要内容指纹；此文件让微信构建绕开 Vite 的资源指纹处理。
// vite.wx.config.ts 的别名把 '@asset-manifest' 指到这里。
export const ASSET_URLS: Record<string, string> = {
  tangseng: 'assets/tangseng.png',
  'unit-monkey': 'assets/unit-monkey.png',
  'unit-spear': 'assets/unit-spear.png',
  'unit-cavalry': 'assets/unit-cavalry.png',
  'unit-archer': 'assets/unit-archer.png',
  'monster-minion': 'assets/monster-minion.png',
  'monster-boss': 'assets/monster-boss.png',
  'item-shovel': 'assets/item-shovel.png',
  'hero-wukong': 'assets/hero-wukong.png',
  'hero-bajie': 'assets/hero-bajie.png',
  'hero-shaseng': 'assets/hero-shaseng.png',
  'hero-guanyin': 'assets/hero-guanyin.png',
  'hero-nezha': 'assets/hero-nezha.png',
  'hero-erlang': 'assets/hero-erlang.png',
  'hero-tangseng-hero': 'assets/hero-tangseng-hero.png',
  'hero-honghaier': 'assets/hero-honghaier.png',
  'hero-tieshan': 'assets/hero-tieshan.png',
  'hero-baigujing': 'assets/hero-baigujing.png',
  'hero-niumowang': 'assets/hero-niumowang.png',
  'hero-mile': 'assets/hero-mile.png',
  'map-huoyanshan': 'assets/map-huoyanshan.jpg',
  'map-liushahe': 'assets/map-liushahe.jpg',
  'map-baiguling': 'assets/map-baiguling.jpg',
  'map-pansidong': 'assets/map-pansidong.jpg',
  'bgm-pansidong': 'assets/bgm-pansidong.mp3',
};
