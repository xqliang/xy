import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// 复用 game-core 数值内核：alias 直接指向其 TS 源，Vite 负责转译。
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../game-core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 5180, host: '127.0.0.1' },
  build: { target: 'es2020', outDir: 'dist' },
});
