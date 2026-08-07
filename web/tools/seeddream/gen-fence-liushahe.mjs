// 已并入 gen-map-fences.mjs（流沙河栅栏 + 闸门 + 盘丝洞栅栏一并生成）。
// 保留本文件以免旧文档链接失效：直接转调新脚本。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const p = spawn(process.execPath, ['gen-map-fences.mjs'], { cwd: HERE, stdio: 'inherit', env: process.env });
p.on('exit', (code) => process.exit(code ?? 1));
