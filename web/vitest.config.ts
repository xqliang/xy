import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, '../game-core/src/index.ts'),
      // 商城相关测试会经 shop.ts → render.ts → assets.ts 引入 @asset-manifest，
      // 需与 vite.config.ts 一致解析到 web 版清单，否则用例无法加载。
      '@asset-manifest': path.resolve(__dirname, './src/asset-manifest.web.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
