#!/usr/bin/env bash
# Squarefolk → itch.io 一键上传（butler 官方 CLI）
# 用法: ./push.sh <owner>/<game> [channel]     例: ./push.sh boltomli/squarefolk html
# 认证（二选一，key 不要发给任何人）:
#   A) 本机跑过 butler login（凭据在 ~/Library/Application Support/itch/butler_creds）
#   B) 本目录建 .env 写一行 BUTLER_KEY=你的key，chmod 600 .env（.env 已 gitignore）
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:?用法: ./push.sh <owner>/<game>（如 boltomli/squarefolk）}"
CHANNEL="${2:-html}"
USERVERSION="0.1.0"

command -v butler >/dev/null 2>&1 || { echo "✗ 找不到 butler（已装到 /opt/homebrew/bin/butler）"; exit 1; }

if [ -f .env ]; then
  set -a; . ./.env; set +a
  chmod 600 .env
fi

if [ -z "${BUTLER_KEY:-}" ] && [ ! -f "$HOME/Library/Application Support/itch/butler_creds" ]; then
  echo "✗ 还没有认证，二选一："
  echo "   A) 终端跑：butler login   （浏览器授权一次，凭据落盘，之后免输）"
  echo "   B) 在本目录建 .env 写：BUTLER_KEY=你的key   然后 chmod 600 .env"
  echo "     key 在 https://itch.io/user/settings/api-keys 创建（别发聊天里）"
  exit 1
fi

# 保险：重新同步构建产物（发版前最后一次 npm run demo 之后的快照）
if [ -f ../../demo/squarefolk.html ]; then
  cp ../../demo/squarefolk.html build/index.html
fi

echo "→ butler push build/ → ${TARGET}:${CHANNEL} (v${USERVERSION})"
butler push build "$TARGET:$CHANNEL" --userversion "$USERVERSION"

cat <<'EOF'

✓ 推送完成。网页端收尾（每个游戏只需一次）：
  1. itch.io → 该游戏 → Edit game
  2. 页面类型：HTML（默认是 Downloadable，必须改）
  3. 勾选该 channel 为 HTML5 / Playable in browser，入口文件选 index.html
  4. Embed 视窗建议 1280×760，用 Game player 预览跑一回合
  5. 封面/截图仍用网页上传（报错对策见 README「上传报错」一节）
EOF
