#!/usr/bin/env bash
# Mac で Claude Code の Remote Control を「永続化」する設定スクリプト。
# ・ログイン時に自動起動（LaunchAgent）
# ・スリープを抑止（caffeinate）
# ・落ちても自動再起動（KeepAlive）
#
# 使い方:   bash mac-setup/setup-remote-control.sh [リポジトリの絶対パス]
# 例:       bash mac-setup/setup-remote-control.sh "$HOME/rakko9924-tech.github.io"
set -euo pipefail

REPO_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
LABEL="tech.rakko9924.claude-remote"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> リポジトリ: $REPO_DIR"

# 1) claude の存在確認
if ! command -v claude >/dev/null 2>&1; then
  echo "✗ claude コマンドが見つかりません。先に Claude Code をインストールしてください:"
  echo "    curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi
CLAUDE_BIN="$(command -v claude)"
echo "==> claude: $CLAUDE_BIN"

# 2) 認証チェック（未ログインなら一度だけ対話ログインが必要）
echo "==> 認証状態を確認します（未ログインならブラウザが開きます）..."
echo "    ※初回のみ。完了したらこのスクリプトを再実行してください。"
claude whoami >/dev/null 2>&1 || {
  echo "  未ログインの可能性があります。`claude` を一度起動して /login で認証してから、再度このスクリプトを実行してください。"
}

# 3) LaunchAgent を作成
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$REPO_DIR" &amp;&amp; exec caffeinate -dimsu "$CLAUDE_BIN" remote-control --name "iOS Build Mac"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/claude-remote.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/claude-remote.err.log</string>
</dict>
</plist>
PLIST
echo "==> 作成: $PLIST"

# 4) 読み込み（再読込）
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✓ 登録しました。ログイン時に自動起動し、スリープも抑止します。"
echo "  ログ:  tail -f /tmp/claude-remote.out.log"
echo "  停止:  launchctl unload \"$PLIST\""
echo
echo "【重要】再起動後も自動で動かすには、System Settings → ユーザとグループ →"
echo "        自動ログイン を有効化してください（LaunchAgent はログイン後に動くため）。"
