// 微信小游戏入口。加载顺序（重要）：
//   1) polyfill.js —— 独立轻量适配层：把 window/document/navigator/URLSearchParams/location/performance
//      等挂到 GameGlobal，document.createElement('canvas')→wx.createCanvas()。必须最先。
//   2) game.bundle.js —— 游戏逻辑打包产物（由 `./start.sh wx` 生成，勿手改）。
//
// 注：不再 require('./weapp-adapter.js')——npm 的 weapp-adapter 是「被 import 进包」的 webpack 模块，
//     作为独立脚本加载时不会往全局挂 window/document（实测 navigator/window 均 undefined）。本工程
//     画布/图片/音频已走 platform.ts 的 wx.* 分支，polyfill.js 即够；如需真 adapter 必须把它 import
//     进 web/src 的构建、而非在此 require。
require('./polyfill.js');
require('./game.bundle.js');
