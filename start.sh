#!/usr/bin/env bash
# 《大圣与唐僧》启动脚本
# 用法：
#   ./start.sh            # 启动开发服务器（前台，http://127.0.0.1:5180）
#   ./start.sh dev        # 同上
#   ./start.sh bg         # 后台启动开发服务器（日志 web/vite.log）
#   ./start.sh stop       # 停止后台/占用 5180 的服务器
#   ./start.sh logs       # 查看后台服务器日志（tail -f）
#   ./start.sh build      # 生产构建（输出 web/dist）
#   ./start.sh preview    # 预览已构建产物（http://127.0.0.1:5180）
#   ./start.sh test       # 运行 game-core 数值单元测试
#   ./start.sh versus-agent [局数] [种子]  # 对战用户代理 headless 模拟（默认 20 局 @10×）
#   ./start.sh check      # 类型检查（game-core + web）
#   ./start.sh deploy     # 一键构建并部署到 ECS（默认 ssh ecs → /opt/xy/html，端口 8082）
#                         # 可用环境变量覆盖：ECS_SSH / ECS_DIR / ECS_URL
#   ./start.sh rollback           # 回滚到上一个发布（原子切换）
#   ./start.sh rollback list      # 列出所有可回滚发布（标出当前）
#   ./start.sh rollback <rel|时间戳>  # 回滚到指定发布（可传时间戳子串）
#   ./start.sh wx         # 构建微信小游戏 bundle 到 wechat/（独立于 web，不影响 dev/deploy）
#   ./start.sh release [patch|minor|major|x.y.z]  # 发版：Claude 分组 CHANGELOG、写版本号、commit 并打 v* tag
#   ./start.sh release dry|raw [..]               # dry=仅预览；raw=跳过 Claude 用原始 git log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-dev}"
PIDFILE="$ROOT/.vite.pid"
LOGFILE="$ROOT/web/vite.log"

need_node() {
  command -v node >/dev/null 2>&1 || { echo "❌ 未找到 node，请先安装 Node.js (>=18)"; exit 1; }
}

# 按需安装依赖（node_modules 缺失时）
ensure_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "📦 安装依赖：$dir"
    (cd "$dir" && npm install)
  fi
}

# 释放 5180 端口上的残留监听（避免"port in use"漂移到 5181）
free_port() {
  local pids="$(lsof -ti tcp:5180 2>/dev/null || true)"
  if [ -n "${pids:-}" ]; then
    echo "🧹 释放端口 5180（结束残留进程 ${pids}）"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

need_node

# —— 发版：根据上次 tag 以来的 git log 写 CHANGELOG，更新版本号，commit 后打 tag ——
# 用法：
#   ./start.sh release              # patch 自增（默认）
#   ./start.sh release minor|major  # 次/主版本自增
#   ./start.sh release 1.2.3        # 指定版本号（不要带 v）
#   ./start.sh release dry [..]     # 只预览 changelog / 新版本，不写文件、不提交
#   ./start.sh release raw [..]     # 跳过 Claude，直接用原始 git log
# 说明：拿到提交列表后默认调用 `claude -p` 做中文分组总结再写入 CHANGELOG.md；
#       无 claude CLI / 调用失败时回退为原始列表。也可用环境变量 RELEASE_SKIP_CLAUDE=1 跳过。
bump_semver() {
  local ver="$1" kind="$2"
  local major minor patch
  IFS=. read -r major minor patch <<<"$ver"
  major="${major:-0}"; minor="${minor:-0}"; patch="${patch:-0}"
  case "$kind" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *) echo "❌ 未知 bump 类型：$kind" >&2; return 1 ;;
  esac
}

# 用 Claude 把原始 commit 列表总结分组；失败则原样返回。
summarize_changelog_with_claude() {
  local raw="$1"
  local ver="$2"
  local skip="${3:-0}"

  if [ "$skip" = 1 ] || [ "${RELEASE_SKIP_CLAUDE:-0}" = 1 ]; then
    echo "$raw"
    return 0
  fi
  if ! command -v claude >/dev/null 2>&1; then
    echo "⚠️  未找到 claude CLI，CHANGELOG 使用原始 git log" >&2
    echo "$raw"
    return 0
  fi

  echo "🤖 正在用 Claude 汇总分组 changelog…" >&2
  local prompt system_prompt out
  system_prompt='你是发版编辑。把 git 提交列表整理成面向玩家/开发者的中文 CHANGELOG 正文。只输出 Markdown 正文，不要包裹代码围栏，不要输出版本标题（不要 ## [x.y.z]）。按实际内容选用分组小标题（有则写、无则省略），推荐：### 新功能、### 修复、### 平衡调整、### 体验与 UI、### 文档、### 其他。每条用 "- " 开头，合并重复/琐碎提交，保留关键信息，去掉无意义的 chore/格式化噪音。语言简洁。'

  prompt="$(cat <<EOF
请整理版本 v${ver} 的 CHANGELOG 正文。

原始提交：
${raw}
EOF
)"

  # --bare：纯文本推理，不读写仓库；失败则回退原始列表
  if ! out="$(
    claude -p --bare --output-format text --no-session-persistence \
      --system-prompt "$system_prompt" \
      "$prompt" 2>/dev/null
  )"; then
    echo "⚠️  Claude 调用失败，CHANGELOG 使用原始 git log" >&2
    echo "$raw"
    return 0
  fi

  # 去掉偶发的代码围栏与首尾空行
  out="$(printf '%s\n' "$out" | sed '/^```/d')"
  out="$(printf '%s\n' "$out" | awk '
    NF { started=1 }
    started { lines[++n]=$0 }
    END {
      while (n>0 && lines[n] ~ /^[[:space:]]*$/) n--
      for (i=1; i<=n; i++) print lines[i]
    }
  ')"

  if [ -z "$out" ]; then
    echo "⚠️  Claude 返回为空，CHANGELOG 使用原始 git log" >&2
    echo "$raw"
    return 0
  fi
  echo "$out"
}

do_release() {
  local dry=0
  local skip_claude=0
  local spec=""
  local a
  for a in "$@"; do
    case "$a" in
      dry|--dry-run|-n) dry=1 ;;
      raw|--no-claude|--skip-claude) skip_claude=1 ;;
      *)
        if [ -z "$spec" ]; then spec="$a"; fi
        ;;
    esac
  done
  spec="${spec:-patch}"

  if [ "$dry" != 1 ]; then
    if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
      echo "❌ 工作区有未提交改动，请先提交或暂存后再发版"
      git -C "$ROOT" status -sb
      exit 1
    fi
  fi

  local last_tag
  last_tag="$(git -C "$ROOT" tag -l 'v*' --sort=-v:refname | head -n1 || true)"
  local range_desc log_range base_ver
  if [ -n "$last_tag" ]; then
    range_desc="自 ${last_tag} 以来"
    log_range="${last_tag}..HEAD"
    base_ver="${last_tag#v}"
  else
    range_desc="全部提交（尚无 v* tag）"
    log_range=""
    base_ver="$(node -p "require('${ROOT}/web/package.json').version" 2>/dev/null || echo "0.1.0")"
  fi

  local new_ver
  case "$spec" in
    major|minor|patch)
      if [ -n "$last_tag" ]; then
        new_ver="$(bump_semver "$base_ver" "$spec")"
      else
        # 无 tag 时：patch=沿用 package 当前版本作为首发；minor/major 再 bump
        if [ "$spec" = patch ]; then new_ver="$base_ver"
        else new_ver="$(bump_semver "$base_ver" "$spec")"
        fi
      fi
      ;;
    *)
      if [[ "$spec" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        new_ver="$spec"
      else
        echo "❌ 版本参数无效：$spec（可用 patch|minor|major 或 1.2.3）"
        exit 1
      fi
      ;;
  esac

  if [ -n "$last_tag" ] && [ "$new_ver" = "$base_ver" ]; then
    echo "❌ 新版本与上一 tag 相同：v${new_ver}"
    exit 1
  fi
  if git -C "$ROOT" rev-parse "v${new_ver}" >/dev/null 2>&1; then
    echo "❌ tag 已存在：v${new_ver}"
    exit 1
  fi

  local raw_changes
  if [ -n "$log_range" ]; then
    raw_changes="$(git -C "$ROOT" log --no-merges --pretty=format:'- %s (%h)' "$log_range" | grep -vE '^- chore\(release\)' || true)"
  else
    raw_changes="$(git -C "$ROOT" log --no-merges --pretty=format:'- %s (%h)' | grep -vE '^- chore\(release\)' || true)"
  fi
  if [ -z "$raw_changes" ]; then
    echo "❌ ${range_desc}没有可写入 changelog 的提交"
    exit 1
  fi

  local changes
  changes="$(summarize_changelog_with_claude "$raw_changes" "$new_ver" "$skip_claude")"

  local today
  today="$(date +%Y-%m-%d)"
  local section
  section="$(cat <<EOF
## [${new_ver}] - ${today}

${changes}
EOF
)"

  echo "📦 发版预览"
  echo "   上一版本：${last_tag:-（无）}"
  echo "   新版本  ：v${new_ver}"
  echo "   范围    ：${range_desc}"
  echo ""
  echo "$section"
  echo ""

  if [ "$dry" = 1 ]; then
    echo "（dry-run：未写入文件、未提交、未打 tag）"
    return 0
  fi

  local changelog="$ROOT/CHANGELOG.md"
  local tmp
  tmp="$(mktemp)"
  {
    echo "# Changelog"
    echo ""
    echo "$section"
    echo ""
    if [ -f "$changelog" ]; then
      # 去掉旧文件开头的标题与紧随空行，避免重复
      awk '
        NR==1 && $0=="# Changelog" { next }
        NR==2 && $0=="" && !seen { next }
        { seen=1; print }
      ' "$changelog"
    fi
  } >"$tmp"
  mv "$tmp" "$changelog"

  cat >"$ROOT/web/src/version.ts" <<EOF
/** 应用版本号：由 \`./start.sh release\` 写入，请勿手改。 */
export const APP_VERSION = '${new_ver}';
EOF

  node -e "
    const fs = require('fs');
    const p = '${ROOT}/web/package.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '${new_ver}';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "

  git -C "$ROOT" add CHANGELOG.md web/src/version.ts web/package.json
  git -C "$ROOT" commit -m "$(cat <<EOF
chore(release): v${new_ver}

EOF
)"
  git -C "$ROOT" tag -a "v${new_ver}" -m "Release v${new_ver}"
  echo "✅ 已提交并打 tag：v${new_ver}"
  echo "   推送：git push && git push origin v${new_ver}"
}

case "$CMD" in
  dev)
    ensure_deps "$ROOT/web"
    free_port
    echo "🚀 开发服务器：http://127.0.0.1:5180  （Ctrl+C 退出）"
    # exec 让 Ctrl+C(SIGINT) 直接送达 vite；--strictPort 固定端口不漂移
    cd "$ROOT/web" && exec npx vite --strictPort
    ;;
  bg)
    ensure_deps "$ROOT/web"
    free_port
    (cd "$ROOT/web" && nohup npx vite --strictPort > "$LOGFILE" 2>&1 & echo $! > "$PIDFILE")
    sleep 1
    echo "🚀 后台运行：http://127.0.0.1:5180  (PID $(cat "$PIDFILE"))"
    echo "   日志：./start.sh logs   停止：./start.sh stop"
    ;;
  stop)
    stopped=0
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null && stopped=1
      rm -f "$PIDFILE"
    fi
    # 兜底：结束仍占用 5180 的进程
    pids="$(lsof -ti tcp:5180 2>/dev/null || true)"
    [ -n "${pids:-}" ] && { kill $pids 2>/dev/null || true; stopped=1; }
    [ "$stopped" = 1 ] && echo "🛑 已停止开发服务器" || echo "（没有正在运行的服务器）"
    ;;
  logs)
    [ -f "$LOGFILE" ] && tail -f "$LOGFILE" || echo "无日志（先 ./start.sh bg 启动）"
    ;;
  build)
    ensure_deps "$ROOT/web"
    (cd "$ROOT/web" && npm run build)
    echo "✅ 构建完成：web/dist"
    ;;
  preview)
    ensure_deps "$ROOT/web"
    if [ ! -d "$ROOT/web/dist" ]; then (cd "$ROOT/web" && npm run build); fi
    free_port
    echo "👀 预览：http://127.0.0.1:5180  （Ctrl+C 退出）"
    cd "$ROOT/web" && exec npx vite preview --strictPort
    ;;
  test)
    ensure_deps "$ROOT/game-core"
    (cd "$ROOT/game-core" && npm test)
    ;;
  versus-agent)
    ensure_deps "$ROOT/web"
    GAMES="${2:-20}"
    SEED="${3:-42000}"
    echo "🤖 对战用户代理模拟：${GAMES} 局 @10×（seed=${SEED}）"
    echo "   行为：征兵 → 布阵 → 主动技能；局间更新 AI skill / 连胜"
    echo "   详见 docs/versus-user-agent.md"
    (cd "$ROOT/web" && VERSUS_AGENT_GAMES="$GAMES" VERSUS_AGENT_SEED="$SEED" npm run versus-agent)
    ;;
  check)
    ensure_deps "$ROOT/game-core"; ensure_deps "$ROOT/web"
    (cd "$ROOT/game-core" && npm run typecheck)
    (cd "$ROOT/web" && npm run typecheck)
    echo "✅ 类型检查通过"
    ;;
  wx)
    # 微信小游戏构建：把 web/src 打成单文件 bundle → wechat/game.bundle.js。
    # 素材（立绘/地图/BGM）已改走 CDN（见 asset-manifest.wx.ts），不再拷进包体，
    # 需先用 `node web/tools/tos-upload.mjs` 把 web/src/game-assets 上传到 TOS。
    # 与 web 的 dev/build/deploy 完全分离，不影响本地调试与服务器部署。需微信开发者工具人工联调。
    ensure_deps "$ROOT/web"
    echo "🔨 构建微信小游戏 bundle（wechat/game.bundle.js）…"
    (cd "$ROOT/web" && npx vite build --config vite.wx.config.ts)
    echo "✅ 微信构建完成：wechat/game.bundle.js"
    echo "   下一步：把 weapp-adapter.js 放到 wechat/（见 wechat/README.md），用「微信开发者工具」打开 wechat/ 联调"
    echo "   ⚠️  首次联调前需在小程序后台「开发管理→开发设置→服务器域名」把 CDN 域名加入 downloadFile 合法域名"
    ;;
  deploy)
    # 一键部署：构建生产产物 → 打包经 ssh 传到 ECS 静态目录 → 健康检查。
    # 服务器用 systemd(python http.server) 直读目录，无需重启；见首次部署说明。
    ensure_deps "$ROOT/web"
    ECS_SSH="${ECS_SSH:-ecs}"          # ~/.ssh/config 里的主机别名
    ECS_DIR="${ECS_DIR:-/opt/xy/html}" # 服务器静态站根目录
    ECS_URL="${ECS_URL:-http://124.221.105.4:8082/}" # 健康检查地址
    echo "🔨 构建生产产物（web/dist）…"
    (cd "$ROOT/web" && npm run build)
    echo "📤 上传 dist → ${ECS_SSH}:${ECS_DIR}（解压到新发布目录后原子切换，零停机）"
    # 零停机：远程把 tar 流解压到全新的 releases/rel-<ts> 目录，再用 ln -sfn 原子切换 symlink，
    # 保证任何时刻 ECS_DIR 都指向一份完整产物（绝不先删后解压）。首次若 ECS_DIR 是真实目录则迁移为 symlink。
    # 该远程脚本的 stdin 即 tar 流（由 `tar xzf -` 消费）；${ECS_DIR} 在本地展开，其余 \$ 变量在远程求值。
    remote_cmd="set -e
DIR='${ECS_DIR}'
RELROOT=\"\$(dirname \"\$DIR\")/releases\"
REL=\"\$RELROOT/rel-\$(date +%Y%m%d%H%M%S)-\$\$\"
mkdir -p \"\$REL\"
tar xzf - -C \"\$REL\" 2>/dev/null
if [ -d \"\$DIR\" ] && [ ! -L \"\$DIR\" ]; then rm -rf \"\$DIR\"; fi   # 首次：真实目录→迁移为 symlink（仅一次）
ln -sfn \"\$REL\" \"\$DIR\"                                            # 原子切换
ls -1dt \"\$RELROOT\"/rel-* 2>/dev/null | tail -n +6 | xargs -r rm -rf # 仅保留最近 5 个发布(可回滚)
echo \"✅ 已原子切换：\$DIR → \$REL\""
    COPYFILE_DISABLE=1 tar czf - -C "$ROOT/web/dist" . 2>/dev/null | ssh "$ECS_SSH" "$remote_cmd"
    echo "🔎 健康检查：${ECS_URL}"
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$ECS_URL" || echo 000)"
    if [ "$code" = "200" ]; then
      echo "✅ 部署完成：${ECS_URL} (HTTP ${code})"
    else
      echo "⚠️  已上传，但健康检查返回 HTTP ${code}（检查 systemd 服务 xy-web / 云安全组端口放行）"
    fi
    ;;
  rollback)
    # 回滚到某个历史发布（releases/rel-*），同样用 ln -sfn 原子切换，零停机。
    # 用法：rollback（上一个）| rollback list（列出）| rollback <rel名或时间戳子串>（指定）
    ECS_SSH="${ECS_SSH:-ecs}"
    ECS_DIR="${ECS_DIR:-/opt/xy/html}"
    ECS_URL="${ECS_URL:-http://124.221.105.4:8082/}"
    TARGET_ARG="${2:-}"
    remote_cmd="set -e
DIR='${ECS_DIR}'
RELROOT=\"\$(dirname \"\$DIR\")/releases\"
# 必须用 readlink -f：否则 symlink 目标与 ls 列出的绝对路径对不上，rollback 会误选「最新版」= 当前错误版
rel_path() { readlink -f \"\$1\" 2>/dev/null || echo \"\$1\"; }
CUR=\"\$(rel_path \"\$DIR\" 2>/dev/null || true)\"
ARG='${TARGET_ARG}'
if [ \"\$ARG\" = list ] || [ \"\$ARG\" = ls ]; then
  echo \"可回滚发布（新→旧，* 为当前）：\"
  echo \"  当前指向：\${CUR:-（\$DIR 非 symlink 或未识别）}\"
  for r in \$(ls -1dt \"\$RELROOT\"/rel-* 2>/dev/null); do
    if [ \"\$(rel_path \"\$r\")\" = \"\$CUR\" ]; then echo \"* \$r\"; else echo \"  \$r\"; fi
  done
  exit 0
fi
TARGET=
if [ -n \"\$ARG\" ]; then
  for r in \$(ls -1dt \"\$RELROOT\"/rel-* 2>/dev/null); do
    case \"\$(basename \"\$r\")\" in *\"\$ARG\"*) TARGET=\"\$r\"; break;; esac
  done
  [ -z \"\$TARGET\" ] && { echo \"❌ 未找到匹配发布：\$ARG（用 rollback list 查看）\"; exit 1; }
else
  SEEN_CUR=0
  for r in \$(ls -1dt \"\$RELROOT\"/rel-* 2>/dev/null); do
    if [ \"\$SEEN_CUR\" = 1 ]; then TARGET=\"\$r\"; break; fi
    if [ -n \"\$CUR\" ] && [ \"\$(rel_path \"\$r\")\" = \"\$CUR\" ]; then SEEN_CUR=1; fi
  done
  if [ -z \"\$TARGET\" ]; then
    TARGET=\"\$(ls -1dt \"\$RELROOT\"/rel-* 2>/dev/null | sed -n '2p' || true)\"
  fi
  [ -z \"\$TARGET\" ] && { echo \"❌ 没有可回滚的历史发布（仅 1 个 release 或当前未识别）\"; exit 1; }
fi
[ -d \"\$TARGET\" ] || { echo \"❌ 目标发布不存在：\$TARGET\"; exit 1; }
if [ -n \"\$CUR\" ] && [ \"\$(rel_path \"\$TARGET\")\" = \"\$CUR\" ]; then
  echo \"❌ 目标与当前相同，无需回滚（若线上仍不对，可能是浏览器缓存 index.html，请强刷 Ctrl+Shift+R）\"
  exit 1
fi
ln -sfn \"\$TARGET\" \"\$DIR\"
echo \"↩️  已回滚：\$DIR → \$TARGET\"
echo \"   原：\${CUR:-无}\"
echo \"   新：\$(rel_path \"\$TARGET\")\"
echo \"   若页面仍不对，请强刷或清缓存（index.html 可能被浏览器缓存）\""
    ssh "$ECS_SSH" "$remote_cmd"
    if [ "$TARGET_ARG" != "list" ] && [ "$TARGET_ARG" != "ls" ]; then
      code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$ECS_URL" || echo 000)"
      echo "🔎 健康检查 ${ECS_URL} → HTTP ${code}"
    fi
    ;;
  release)
    do_release "${@:2}"
    ;;
  *)
    echo "未知命令：$CMD"
    echo "可用：dev | bg | stop | logs | build | preview | test | versus-agent | check | deploy | rollback | wx | release"
    exit 1
    ;;
esac
