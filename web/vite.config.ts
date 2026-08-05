import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// 复用 game-core 数值内核：alias 直接指向其 TS 源，Vite 负责转译。
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../game-core/src/index.ts', import.meta.url)),
      // Web 构建用带内容哈希的资源清单（微信构建在 vite.wx.config.ts 指向 .wx 版本）
      '@asset-manifest': fileURLToPath(new URL('./src/asset-manifest.web.ts', import.meta.url)),
    },
  },
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 5180, host: '127.0.0.1' },
  build: { target: 'es2020', outDir: 'dist' },
});
