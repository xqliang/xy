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
  *)
    echo "未知命令：$CMD"
    echo "可用：dev | bg | stop | logs | build | preview | test | check"
    exit 1
    ;;
esac
