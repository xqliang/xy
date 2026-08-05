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
  deploy)
    # 一键部署：构建生产产物 → 打包经 ssh 传到 ECS 静态目录 → 健康检查。
    # 服务器用 systemd(python http.server) 直读目录，无需重启；见首次部署说明。
    ensure_deps "$ROOT/web"
    ECS_SSH="${ECS_SSH:-ecs}"          # ~/.ssh/config 里的主机别名
    ECS_DIR="${ECS_DIR:-/opt/xy/html}" # 服务器静态站根目录
    ECS_URL="${ECS_URL:-http://124.221.105.4:8082/}" # 健康检查地址
    echo "🔨 构建生产产物（web/dist）…"
    (cd "$ROOT/web" && npm run build)
    echo "📤 上传 dist → ${ECS_SSH}:${ECS_DIR}"
    # COPYFILE_DISABLE=1 抑制 macOS 附加属性；remote 先清空目录再解包（原子性足够，站点为纯静态）
    COPYFILE_DISABLE=1 tar czf - -C "$ROOT/web/dist" . 2>/dev/null \
      | ssh "$ECS_SSH" "mkdir -p '${ECS_DIR}' && rm -rf '${ECS_DIR}'/* && tar xzf - -C '${ECS_DIR}' 2>/dev/null"
    echo "🔎 健康检查：${ECS_URL}"
    code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$ECS_URL" || echo 000)"
    if [ "$code" = "200" ]; then
      echo "✅ 部署完成：${ECS_URL} (HTTP ${code})"
    else
      echo "⚠️  已上传，但健康检查返回 HTTP ${code}（检查 systemd 服务 xy-web / 云安全组端口放行）"
    fi
    ;;
  *)
    echo "未知命令：$CMD"
    echo "可用：dev | bg | stop | logs | build | preview | test | check | deploy"
    exit 1
    ;;
esac
