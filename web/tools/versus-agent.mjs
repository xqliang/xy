#!/usr/bin/env node
/**
 * 对战用户代理 CLI：20 局 @10× 快放，统计胜率与 AI skill 漂移。
 * 用法: node web/tools/versus-agent.mjs [局数] [seedBase]
 * 或:   npm run versus-agent
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const games = process.argv[2] ?? '20';
const seed = process.argv[3] ?? '42000';
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');

const env = {
  ...process.env,
  VERSUS_AGENT_GAMES: games,
  VERSUS_AGENT_SEED: seed,
};

const child = spawn(
  'npx',
  ['vitest', 'run', 'tests/versus-user-agent.test.ts', '--reporter=verbose'],
  { cwd: webRoot, stdio: 'inherit', env },
);

child.on('exit', (code) => process.exit(code ?? 0));
