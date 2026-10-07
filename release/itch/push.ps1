# Squarefolk → itch.io 一键上传（butler 官方 CLI，Windows / PowerShell 版）
# 用法: .\push.ps1 <owner>/<game> [channel]     例: .\push.ps1 boltomli/squarefolk html
# 认证（二选一，key 不要发给任何人）:
#   A) 本机跑过 butler login（凭据在 ~\.config\itch\butler_creds，本脚本会检查）
#   B) 本目录建 .env 写一行 BUTLER_KEY=你的key（.env 已 gitignore；Windows 无需 chmod）
# 执行策略拦住时: pwsh -NoProfile -ExecutionPolicy Bypass -File push.ps1 <owner>/<game>
[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $true)]
    [string]$Target,
    [Parameter(Position = 1)]
    [string]$Channel = "html"
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$UserVersion = "0.1.0"

if (-not (Get-Command butler -ErrorAction SilentlyContinue)) {
    Write-Host "✗ 找不到 butler（安装: scoop install butler）"
    exit 1
}

# .env → 环境变量（存在才读，行格式 BUTLER_KEY=值）
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*BUTLER_KEY\s*=\s*(.*)\s*$') {
            $env:BUTLER_KEY = $Matches[1].Trim()
        }
    }
}

# butler 默认凭据路径（butler login --help 给出的 -i 缺省值）
$credsPath = if ($env:XDG_CONFIG_HOME) {
    Join-Path $env:XDG_CONFIG_HOME 'itch/butler_creds'
} else {
    Join-Path $env:USERPROFILE '.config/itch/butler_creds'
}
if (-not $env:BUTLER_KEY -and -not (Test-Path -LiteralPath $credsPath)) {
    Write-Host "✗ 还没有认证，二选一："
    Write-Host "   A) 终端跑：butler login   （浏览器授权一次，凭据落盘，之后免输）"
    Write-Host "   B) 在本目录建 .env 写：BUTLER_KEY=你的key"
    Write-Host "     key 在 https://itch.io/user/settings/api-keys 创建（别发聊天里）"
    exit 1
}

# 保险：重新同步构建产物（发版前最后一次 npm run demo 之后的快照）
$demoHtml = Join-Path $PSScriptRoot '..\..\demo\squarefolk.html'
$buildDir = Join-Path $PSScriptRoot 'build'
$indexHtml = Join-Path $buildDir 'index.html'
if (Test-Path -LiteralPath $demoHtml) {
    New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
    Copy-Item -LiteralPath $demoHtml -Destination $indexHtml -Force
}
if (-not (Test-Path -LiteralPath $indexHtml)) {
    Write-Host "✗ build/index.html 不存在（先跑 npm run demo 生成 demo/squarefolk.html）"
    exit 1
}

Write-Host "→ butler push build/ → ${Target}:${Channel} (v$UserVersion)"
butler push build "${Target}:${Channel}" --userversion $UserVersion
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ butler 退出码 $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host @'

✓ 推送完成。网页端收尾（每个游戏只需一次）：
  1. itch.io → 该游戏 → Edit game
  2. 页面类型：HTML（默认是 Downloadable，必须改）
  3. 勾选该 channel 为 HTML5 / Playable in browser，入口文件选 index.html
  4. Embed 视窗建议 1280×760，用 Game player 预览跑一回合
  5. 封面/截图仍用网页上传（报错对策见 README「上传报错」一节）
'@
