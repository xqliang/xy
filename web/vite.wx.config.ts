import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// 微信小游戏专用构建：把 src/main.ts 打成单文件 IIFE bundle → ../wechat/game.bundle.js。
// 与 web 的 dev/build/deploy 完全分离（不同 config、不同 outDir），保证本地/服务器路径零影响。
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../game-core/src/index.ts', import.meta.url)),
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
