#!/usr/bin/env bash
# 《大圣与唐僧》启动脚本
# 用法：
#   ./start.sh            # 启动开发服务器（默认，http://127.0.0.1:5180）
#   ./start.sh dev        # 同上
#   ./start.sh build      # 生产构建（输出 web/dist）
#   ./start.sh preview    # 预览已构建产物（http://127.0.0.1:5180）
#   ./start.sh test       # 运行 game-core 数值单元测试
#   ./start.sh check      # 类型检查（game-core + web）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-dev}"

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

need_node

case "$CMD" in
  dev)
    ensure_deps "$ROOT/web"
    echo "🚀 开发服务器：http://127.0.0.1:5180"
    (cd "$ROOT/web" && npm run dev)
    ;;
  build)
    ensure_deps "$ROOT/web"
    (cd "$ROOT/web" && npm run build)
    echo "✅ 构建完成：web/dist"
    ;;
  preview)
    ensure_deps "$ROOT/web"
    if [ ! -d "$ROOT/web/dist" ]; then (cd "$ROOT/web" && npm run build); fi
    echo "👀 预览：http://127.0.0.1:5180"
    (cd "$ROOT/web" && npm run preview)
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
    echo "可用：dev | build | preview | test | check"
    exit 1
    ;;
esac
