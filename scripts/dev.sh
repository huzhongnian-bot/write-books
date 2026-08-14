#!/usr/bin/env bash
# write-books 一键启动（Git Bash 运行：bash scripts/dev.sh）
#
# 固化本项目的启动坑（详见 AGENTS.md）：
#   1. 终端进程环境里的同名变量会覆盖 .env.local（dotenv 不覆盖已有变量）
#      ——PowerShell profile 的 ANTHROPIC_* 曾让 AI 全部连不通
#   2. Windows 下杀 npm 壳进程会残留 next 子进程占端口，须 taskkill /F
#   3. 数据库迁移随应用启动自动执行，无需额外命令
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"

echo "==> 1/4 清理会覆盖 .env.local 的终端环境变量"
unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY AI_MODEL \
      OPENAI_BASE_URL OPENAI_API_KEY OPENAI_ORG_ID OPENAI_MODEL \
      HTTPS_PROXY HTTP_PROXY https_proxy http_proxy 2>/dev/null || true

echo "==> 2/4 检查端口 $PORT"
pids=$(netstat -ano 2>/dev/null | grep ":$PORT .*LISTENING" | awk '{print $NF}' | sort -u || true)
if [ -n "${pids:-}" ]; then
  for pid in $pids; do
    echo "    端口 $PORT 被 PID $pid 占用，按旧 dev server 处理：taskkill /F"
    taskkill //PID "$pid" //F >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi

echo "==> 3/4 依赖检查"
if [ ! -d node_modules ]; then
  echo "    node_modules 不存在，执行 npm ci"
  npm ci
fi

echo "==> 4/4 启动 dev server（迁移自动执行）"
npm run dev &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT INT TERM

for i in $(seq 1 60); do
  if curl -s -o /dev/null -m 2 "http://localhost:$PORT"; then
    echo "就绪：http://localhost:$PORT （Ctrl+C 停止）"
    wait "$DEV_PID"
    exit 0
  fi
  sleep 1
done

echo "60s 内未就绪，请查看上方日志" >&2
exit 1
