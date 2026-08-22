// 把 src/game-assets/ 下的静态资源（立绘/地图/BGM 等）上传到火山引擎 TOS（公共读）。
// 复用 ../dubbing 项目同一个账号/桶（user-growth），只是换了前缀：dev/xy/<原名>-<内容哈希>
//
// 关键：文件名带内容哈希（<原名>-<sha256前8>.<扩展>），与 Vite 给 JS chunk 的命名一致
// （参考 dist/assets/index-CccPhrYM.js）。这样：
//   - 内容一变 → 哈希变 → URL 变 → 浏览器/CDN 自动缓存击穿；
//   - 同一内容永远对应同一 URL，故可 immutable（Cache-Control: max-age=1 年）；
//   - 无需重新部署 bundle，用户就能看到新上传的素材（彻底解决「客户端缓存 7 天看不到新资源」）。
//
// 上传同时把「原名 → hashed URL」表写到 src/game-assets/manifest-generated.ts，
// Web / 微信构建的 ASSET_URLS 会优先引用该表（缺失时回退 CDN_BASE+原名）。
//
// 凭证：优先读环境变量 TOS_ACCESS_KEY / TOS_SECRET_KEY；未设置时自动从 ../../dubbing/.env
// 读取（同一开发者的同一账号，dubbing 项目已在用）。
//
// 用法（在 web/ 目录跑）：
//   node tools/tos-upload.mjs                       # 上传 src/game-assets 下所有文件
//   node tools/tos-upload.mjs hero-wukong.png ...    # 只上传指定文件（相对 --base）
//   node tools/tos-upload.mjs --base DIR file1 ...   # 指定资源根目录
// 输出 stdout：JSON { "<原名>": "https://.../dev/xy/<原名>-<哈希>.<扩展>", ... }
import { TosClient } from '@volcengine/tos-sdk';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGION = 'cn-shanghai';
const BUCKET = 'user-growth';
const ENDPOINT = 'tos-cn-shanghai.volces.com';
const URL_PREFIX = `https://${BUCKET}.${ENDPOINT}/`;
const KEY_PREFIX = 'dev/xy/';
// 文件名已带内容哈希，同一内容永远同一 URL，可 immutable：浏览器/CDN 永久缓存、不重校验。
// 真正要刷新生效时，上传会得到新的哈希→新 URL→天然击穿旧缓存。
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// 只上传白名单内的扩展名，避免把 manifest-generated.ts、.DS_Store 之类非资源文件误上传。
const ALLOWED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp',
  '.mp3', '.ogg', '.wav', '.m4a', '.aac',
]);

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
    case '.webp':
      return 'image/jpeg';
    case '.mp3':
      return 'audio/mpeg';
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    default:
      return undefined;
  }
}

// 内容哈希：sha256 取前 8 位十六进制。8 位 = 2^32 空间，碰撞概率可忽略，且文件名不致过长。
function contentHash(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').slice(0, 8);
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

// 写回生成的 hashed-URL 表。Web / 微信构建引用它实现内容哈希缓存击穿。
// 文件由本工具在每次上传时重算覆盖，不要手改；首次上传前仓库里会保留一个空骨架（{}），
// 保证尚未上传资源时 `vite build` 仍能解析通过（未命中则回退 bare URL）。
function writeGeneratedManifest(map) {
  const manifestPath = path.resolve(__dirname, '../src/game-assets/manifest-generated.ts');
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  const lines = entries.map(([name, url]) => `  ${JSON.stringify(name)}: ${JSON.stringify(url)},`);
  const body =
    `// AUTO-GENERATED — 由 tools/tos-upload.mjs 在每次上传 src/game-assets/ 时重算覆盖。\n` +
    `// 内容哈希 <原名>-<sha256前8>.<扩展>：内容一变 URL 就变，浏览器/CDN 自动缓存击穿。\n` +
    `// Web / 微信构建的 ASSET_URLS 优先引用此表（缺失时回退 CDN_BASE+原名）。不要手改。\n` +
    `import { CDN_BASE } from '../asset-manifest.names';\n` +
    `export const HASHED_URLS: Record<string, string> = {\n` +
    (lines.length ? lines.join('\n') + '\n' : '') +
    `};\n`;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, body, 'utf8');
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
  // manifest 的条目 = baseDir 下全部白名单资源（哈希是内容函数：未指定上传的文件内容没变，
  // 其 URL 与 CDN 上已有对象一致，无需重传也能安全写入表）。分文件参数只控制「上传哪些」，
  // 绝不影响 manifest 覆盖范围——否则分文件上传会把表改写成只剩几条、其余素材丢 hashed URL
  // （2026-08-22 实际踩过：`tos-upload.mjs loading-tangseng.png` 后全表只剩 1 条）。
  const allNames = fs.readdirSync(baseDir)
    .filter((f) => ALLOWED_EXTS.has(path.extname(f).toLowerCase()))
    .filter((f) => f !== 'manifest-generated.ts' && f !== '.DS_Store')
    .filter((f) => fs.statSync(path.join(baseDir, f)).isFile())
    .sort();
  const uploadNames = files.length > 0
    ? allNames.filter((f) => files.includes(f))
    : allNames;
  if (files.length > 0 && uploadNames.length === 0) {
    console.error('错误: 指定的文件都不在白名单/目录内'); process.exit(1);
  }

  const client = new TosClient({ accessKeyId, accessKeySecret, region: REGION, endpoint: ENDPOINT });

  const result = {};
  const hashed = {};
  for (const name of allNames) {
    const filePath = path.join(baseDir, name);
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    const hash = contentHash(filePath);
    const key = `${KEY_PREFIX}${base}-${hash}${ext}`;
    const url = URL_PREFIX + key;
    hashed[name] = url;                    // 全量入表（含本次未上传的——内容未变 URL 未变）
    if (!uploadNames.includes(name)) continue;
    const contentType = contentTypeOf(name);
    await client.putObjectFromFile({
      bucket: BUCKET,
      key,
      filePath,
      acl: 'public-read',
      contentType,
      cacheControl: CACHE_CONTROL,
    });
    result[name] = url;
    console.error(`  上传 ${name} → ${url}`);
  }

  writeGeneratedManifest(hashed);
  console.error(`  已生成 manifest-generated.ts（${Object.keys(hashed).length} 条 hashed URL）`);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('错误: 上传失败:', err && err.message ? err.message : err);
  process.exit(1);
});
