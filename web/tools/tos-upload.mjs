// 把 src/game-assets/ 下的静态资源（立绘/地图/BGM 等）上传到火山引擎 TOS（公共读）。
// 复用 ../dubbing 项目同一个账号/桶（user-growth），只是换了前缀：dev/xy/<文件名>
// （保留原文件名、不做内容哈希，方便直接按名字引用；与 dubbing 的 dev/dubbing/ 互不冲突）。
//
// 凭证：优先读环境变量 TOS_ACCESS_KEY / TOS_SECRET_KEY；未设置时自动从 ../../dubbing/.env
// 读取（同一开发者的同一账号，dubbing 项目已在用）。
//
// 用法（在 web/ 目录跑）：
//   node tools/tos-upload.mjs                       # 上传 src/game-assets 下所有文件
//   node tools/tos-upload.mjs hero-wukong.png ...    # 只上传指定文件（相对 --base）
//   node tools/tos-upload.mjs --base DIR file1 ...   # 指定资源根目录
// 输出 stdout：JSON { "<文件名>": "https://user-growth.tos-cn-shanghai.volces.com/dev/xy/<文件名>", ... }
import { TosClient } from '@volcengine/tos-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGION = 'cn-shanghai';
const BUCKET = 'user-growth';
const ENDPOINT = 'tos-cn-shanghai.volces.com';
const URL_PREFIX = `https://${BUCKET}.${ENDPOINT}/`;
const KEY_PREFIX = 'dev/xy/';
// 文件名不带内容哈希（同名可能被热更覆盖），不能用 immutable；但配合 ETag 的条件请求(304)
// 仍能让「未改动」的重复访问免于重新下载 body，明显改善加载页耗时。
const CACHE_CONTROL = 'public, max-age=604800, must-revalidate';

/** dubbing 项目 .env 用 `export KEY=VALUE` 格式；只在未设置对应环境变量时补上（不覆盖）。 */
function loadDubbingEnvFallback() {
  if (process.env.TOS_ACCESS_KEY && process.env.TOS_SECRET_KEY) return;
  const envPath = path.resolve(__dirname, '../../../dubbing/.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = /^export\s+([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function contentTypeOf(name) {
  switch (path.extname(name).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.mp3':
      return 'audio/mpeg';
    default:
      return undefined;
  }
}

function parseArgs(argv) {
  let baseDir = path.resolve(__dirname, '../src/game-assets');
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      baseDir = path.resolve(argv[++i]);
      continue;
    }
    files.push(argv[i]);
  }
  return { baseDir, files };
}

async function main() {
  loadDubbingEnvFallback();
  const accessKeyId = process.env.TOS_ACCESS_KEY;
  const accessKeySecret = process.env.TOS_SECRET_KEY;
  if (!accessKeyId || !accessKeySecret) {
    console.error('错误: 缺少 TOS_ACCESS_KEY / TOS_SECRET_KEY（环境变量，或 ../dubbing/.env）');
    process.exit(1);
  }

  const { baseDir, files } = parseArgs(process.argv.slice(2));
  const names =
    files.length > 0
      ? files
      : fs.readdirSync(baseDir).filter((f) => fs.statSync(path.join(baseDir, f)).isFile());
  names.sort();

  const client = new TosClient({ accessKeyId, accessKeySecret, region: REGION, endpoint: ENDPOINT });

  const result = {};
  for (const name of names) {
    const filePath = path.join(baseDir, name);
    const key = KEY_PREFIX + name;
    const contentType = contentTypeOf(name);
    await client.putObjectFromFile({
      bucket: BUCKET,
      key,
      filePath,
      acl: 'public-read',
      contentType,
      cacheControl: CACHE_CONTROL,
    });
    const url = URL_PREFIX + key;
    result[name] = url;
    console.error(`  上传 ${name} → ${url}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('错误: 上传失败:', err && err.message ? err.message : err);
  process.exit(1);
});
