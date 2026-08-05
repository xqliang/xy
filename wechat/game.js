// 微信小游戏入口。
// 顺序很重要：先加载 weapp-adapter（提供 document/window/canvas/Image/AudioContext 等垫片），
// 再运行打包后的游戏 bundle（由 `./start.sh wx` 生成）。
//
// 注意：weapp-adapter.js 需自行放置到本目录（见 README.md）。若未放置，游戏无法在小游戏运行时启动。
require('./weapp-adapter.js');
require('./game.bundle.js');
