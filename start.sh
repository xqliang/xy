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
#   ./start.sh check      # 类型检查（game-core + web）
#   ./start.sh deploy     # 一键构建并部署到 ECS（默认 ssh ecs → /opt/xy/html，端口 8082）
#                         # 可用环境变量覆盖：ECS_SSH / ECS_DIR / ECS_URL
#   ./start.sh rollback           # 回滚到上一个发布（原子切换）
#   ./start.sh rollback list      # 列出所有可回滚发布（标出当前）
#   ./start.sh rollback <rel|时间戳>  # 回滚到指定发布（可传时间戳子串）
#   ./start.sh wx         # 构建微信小游戏 bundle 到 wechat/（独立于 web，不影响 dev/deploy）
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
  check)
    ensure_deps "$ROOT/game-core"; ensure_deps "$ROOT/web"
    (cd "$ROOT/game-core" && npm run typecheck)
    (cd "$ROOT/web" && npm run typecheck)
    echo "✅ 类型检查通过"
    ;;
  wx)
    # 微信小游戏构建：把 web/src 打成单文件 bundle → wechat/game.bundle.js，并同步资源。
    # 与 web 的 dev/build/deploy 完全分离，不影响本地调试与服务器部署。需微信开发者工具人工联调。
    ensure_deps "$ROOT/web"
    echo "🔨 构建微信小游戏 bundle（wechat/game.bundle.js）…"
    (cd "$ROOT/web" && npx vite build --config vite.wx.config.ts)
    echo "🖼  同步资源 → wechat/assets"
    mkdir -p "$ROOT/wechat/assets"
    cp -R "$ROOT/web/src/game-assets/." "$ROOT/wechat/assets/" 2>/dev/null || true
    echo "✅ 微信构建完成：wechat/game.bundle.js"
    echo "   下一步：把 weapp-adapter.js 放到 wechat/（见 wechat/README.md），用「微信开发者工具」打开 wechat/ 联调"
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
  *)
    echo "未知命令：$CMD"
    echo "可用：dev | bg | stop | logs | build | preview | test | check | deploy | rollback | wx"
    exit 1
    ;;
esac
