# write-books 一键启动（PowerShell）：与 scripts/dev.sh 等价
# 用法：powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
#       （或先 Set-ExecutionPolicy RemoteSigned -Scope CurrentUser 后 .\scripts\dev.ps1）
#
# 固化本项目的启动坑（详见 AGENTS.md）：
#   1. 终端环境里的同名变量覆盖 .env.local（dotenv 不覆盖已有变量）
#      ——本机 PowerShell profile 的 ANTHROPIC_* 曾让 AI 全部连不通
#   2. Windows 下杀 npm 壳进程会残留 next 子进程占端口，须 taskkill /F
#   3. 数据库迁移随应用启动自动执行，无需额外命令
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$Port = if ($env:PORT) { [int]$env:PORT } else { 3000 }

Write-Host '==> 1/4 清理会覆盖 .env.local 的终端环境变量'
$names = @(
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'AI_MODEL',
  'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_MODEL',
  'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'
)
foreach ($name in $names) {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}

Write-Host "==> 2/4 检查端口 $Port"
$ownerPids = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
foreach ($ownerPid in $ownerPids) {
  Write-Host "    端口 $Port 被 PID $ownerPid 占用，按旧 dev server 处理：taskkill /F"
  taskkill /PID $ownerPid /F | Out-Null
}
if ($ownerPids) { Start-Sleep -Seconds 1 }

Write-Host '==> 3/4 依赖检查'
if (-not (Test-Path node_modules)) {
  Write-Host '    node_modules 不存在，执行 npm ci'
  npm ci
}

Write-Host '==> 4/4 启动 dev server（迁移自动执行，Ctrl+C 停止）'
npm run dev
