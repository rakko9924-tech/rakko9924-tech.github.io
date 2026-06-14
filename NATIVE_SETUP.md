# iPhoneアプリ化（Capacitor）と App内課金（StoreKit）の手順

このリポジトリの `nlh/` にあるWebアプリを、**Capacitor** で iOS ネイティブアプリにラップし、
**App内課金（StoreKit）** を有効化するための手順です。

> ⚠️ **iOSのビルドには Mac + Xcode が必須**です（Windows/Linux 不可）。
> 以下は Mac 上での作業を想定しています。

---

## 0. 必要なもの
- macOS + **Xcode**（App Store からインストール）
- **Node.js 18+**（`brew install node` など）
- **Apple Developer Program** 登録（年額・課金には必須）
- CocoaPods（`sudo gem install cocoapods`）

## 1. 依存をインストール
リポジトリ直下（`package.json` がある場所）で：
```bash
npm install
```

## 2. iOS プロジェクトを生成
```bash
npx cap add ios
npx cap sync ios
```
- `capacitor.config.json` の `webDir` は `nlh` を指しています（Webアプリ本体）。
- Webアプリを更新するたびに `npx cap sync ios` で iOS 側へ反映します。

## 3. Xcode で開く
```bash
npx cap open ios
```
Xcode で：
- **Signing & Capabilities** → チーム（Apple Developer アカウント）を設定。
- **In-App Purchase** capability を追加。
- Bundle Identifier を `tech.rakko9924.nlh`（または任意）に設定。

## 4. App Store Connect で課金アイテムを登録
[App Store Connect](https://appstoreconnect.apple.com) → 対象アプリ → **App内課金** で、
**非消耗型（Non-Consumable）** を以下の Product ID で作成します（`nlh/iap.js` と一致）：

| 機能 | Product ID | 価格 |
|---|---|---|
| BB表示 | `nlh.bb_display` | ¥500 |
| 初期スタック編集 | `nlh.edit_stack` | ¥500 |
| トーナメントモード | `nlh.tournament` | ¥1,000 |
| ante無しモード | `nlh.no_ante` | ¥300 |
| 全部セット | `nlh.all_bundle` | ¥1,500 |

※ Product ID を変える場合は `nlh/iap.js` の `IDS` と `nlh/game.js` の `IAP_IDS` も合わせて変更してください。
※「全部セット」は非消耗型として実装しています（個別購入との二重購入を避けたい場合は、アプリ側で
　 全部セット所持時に個別購入ボタンを隠す等の調整を推奨）。

## 5. 課金プラグインを組み込む
`cordova-plugin-purchase`（CdvPurchase）を使います。`package.json` に記載済みなので、
`npx cap sync ios` でネイティブへ取り込まれます。アプリ起動時に `nlh/iap.js` が
`window.CdvPurchase` を検出して `window.IAP` を生成し、`nlh/game.js` のストア処理に接続されます。

- ネイティブ環境（実機/シミュレータ）：実際の StoreKit 課金フローが走ります。
- ブラウザ/PWA：`window.IAP` が無いため、確認ダイアログで解放するフォールバックになります（開発確認用）。

## 6. 課金のテスト
- App Store Connect で **Sandbox テスター** を作成。
- 実機の「設定 → App Store → Sandbox アカウント」でサインイン。
- アプリ内「ストア」から購入・**購入を復元** が動作することを確認。

## 7. 審査・公開
- スクリーンショット、説明、**プライバシー**（同梱の `privacy-policy.html` を参照/公開URL設定）を用意。
- App内課金のメタデータ（スクショ/説明）も登録。
- アーカイブ（Xcode → Product → Archive）→ App Store Connect へアップロード → 審査提出。

---

## 補足
- Web版（GitHub Pages）はそのまま無料でオフラインプレイ可能なデモとして機能します。
  課金が実際に走るのは **ネイティブアプリ版のみ** です。
- 効果音は外部音源を使わず Web Audio API で合成しています（ライセンス・帰属表示不要）。
