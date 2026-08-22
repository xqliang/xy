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
  server: {
    port: 5180,
    host: '127.0.0.1',
    // 本地开发把 /api、/admin 转到本机游戏服务（默认 8082；可用 XY_API_PROXY 覆盖）
    proxy: {
      // ws:true：PvP 对局 WebSocket（/api/versus/ws）经 vite 代理升级转发（本地联调用）
      '/api': { target: process.env.XY_API_PROXY || 'http://127.0.0.1:8082', changeOrigin: true, ws: true },
      '/admin': { target: process.env.XY_API_PROXY || 'http://127.0.0.1:8082', changeOrigin: true },
    },
  },
  preview: { port: 5180, host: '127.0.0.1' },
  build: { target: 'es2020', outDir: 'dist' },
});
