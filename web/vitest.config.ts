import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, '../game-core/src/index.ts'),
      // 商城相关测试会经 shop.ts → render.ts → assets.ts 引入 @asset-manifest，
      // 需与 vite.config.ts 一致解析到 web 版清单，否则用例无法加载。
      '@asset-manifest': path.resolve(__dirname, './src/asset-manifest.web.ts'),
    },
  },
  test: {
    root: __dirname,
    dir: './tests',
    // 排除 git worktree（.worktrees/、.claude/worktrees/）里的重复测试，避免缺 node_modules 的旧 worktree 污染发现
    exclude: ['**/.worktrees/**', '**/.claude/worktrees/**', '**/node_modules/**', '**/dist/**'],
  },
});
