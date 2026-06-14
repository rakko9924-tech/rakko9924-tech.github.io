# Mac で Claude Code を「永続リモート」にする（スマホ→Mac でリリース作業）

目的：あなたのMacで Claude Code を**常駐**させ、**スマホ（同じClaudeアカウント）から指示**して
iOSビルド〜App Storeリリース作業を行えるようにする。

> 前提：このMacに **Claude Code / Xcode / Node.js** が入っていること（Apple Developer 登録済み）。
> ※ クラウドのWeb版チャットからは、この常駐セッションへ「別アカウントで」割り込むことはできません。
>   操作は **同じClaudeアカウント** で行ってください。

---

## 方法1：かんたん常駐（tmux）— まず試すならこれ
切断しても動き続けます（再起動では消えます）。

```bash
cd ~/rakko9924-tech.github.io      # クローン先に合わせて変更
git pull                            # 最新を取得
# 認証がまだなら一度だけ:  claude  → /login で認証 → 終了

brew install tmux 2>/dev/null || true
tmux new -s claude-remote \; send-keys 'caffeinate -dimsu claude remote-control --name "iOS Build Mac"' Enter
```
- スマホから同じアカウントで接続（Claudeアプリ／claude.ai/code のRemote Control）。
- 様子を見る:  `tmux attach -t claude-remote`（抜けるのは `Ctrl-b` → `d`）
- 止める:      `tmux kill-session -t claude-remote`

## 方法2：完全永続（ログイン時に自動起動 / 自動再起動 / スリープ抑止）
```bash
cd ~/rakko9924-tech.github.io
git pull
bash mac-setup/setup-remote-control.sh "$HOME/rakko9924-tech.github.io"
```
- ログイン時に自動起動、落ちても自動再起動、`caffeinate` でスリープ抑止。
- **再起動後も動かすには**：System Settings →（ユーザとグループ）→ **自動ログインを有効化**。
  LaunchAgent は「ログイン後」に動くためです。
- ログ確認: `tail -f /tmp/claude-remote.out.log`
- 解除:     `launchctl unload ~/Library/LaunchAgents/tech.rakko9924.claude-remote.plist`

> `claude remote-control` の正確なフラグはバージョンで変わることがあります。
> 動かないときは `claude --help` でサブコマンド名を確認してください。

---

## スマホから接続できたら、最初に必ず確認
そのセッションでこう打つ：
```
uname -a と sw_vers と pwd を実行して
```
- `Darwin … / macOS … / /Users/あなた/…` → **本物のMac**（ビルド可能）✅
- `Linux … / sw_vers無し` → それはクラウドWeb版（Macではない）❌

Darwin を確認できたら、次の指示でビルド〜リリースに進む：
```
このリポジトリを NATIVE_SETUP.md の手順で iOS アプリ化して。
npm install → npx cap add ios → npx cap sync ios → npx cap open ios まで実行して。
そのあと Xcode で署名・In-App Purchase capability を設定し、Archive まで案内して。
```

---

## 「リリース」について（期待値の調整）
App Store への公開は**ワンコマンドでは終わりません**。CLI（Mac上のClaude）で進められるのは主に：
- Capacitor設定・`cap add/sync`・ビルド・テスト・`fastlane` 等での**アーカイブ/アップロード自動化**

一方、以下は **App Store Connect（Web）/ Xcode のGUI** での人手作業が必要：
- 課金アイテム（`nlh.bb_display` ほか）の登録・価格設定
- スクリーンショット、説明文、年齢レーティング、**プライバシー**設定
- 審査提出 → Apple の**審査（数日）**

希望があれば、`fastlane` を導入して **アーカイブ→TestFlight/App Store Connect アップロードまで自動化**する設定もこちらで用意します（Mac側で実行）。
