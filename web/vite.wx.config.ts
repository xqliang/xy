import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// 微信小游戏专用构建：把 src/main.ts 打成单文件 IIFE bundle → ../wechat/game.bundle.js。
// 与 web 的 dev/build/deploy 完全分离（不同 config、不同 outDir），保证本地/服务器路径零影响。
export default defineConfig({
  // 不拷贝 web 的 public/（避免把 server.py 等泄漏进小游戏包）；素材已改走 CDN，不再打进包体
  publicDir: false,
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../game-core/src/index.ts', import.meta.url)),
      // 微信构建的资源清单：CDN 完整 URL（见 asset-manifest.wx.ts / asset-manifest.names.ts）
      '@asset-manifest': fileURLToPath(new URL('./src/asset-manifest.wx.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2019',
    outDir: fileURLToPath(new URL('../wechat', import.meta.url)),
    emptyOutDir: false, // 保留 wechat/ 下的 game.json / project.config.json / game.js / weapp-adapter.js
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      formats: ['iife'],
      name: 'DaShengGame',
      fileName: () => 'game.bundle.js',
    },
    rollupOptions: {
      output: { entryFileNames: 'game.bundle.js' },
    },
  },
});
