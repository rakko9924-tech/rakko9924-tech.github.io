/* ============================================================
   services.js — プラットフォーム連携（広告 AdMob）
   ネイティブ(iOS): @capacitor-community/admob。Web: 何もしない。
   構成: インタースティシャル＋リワード動画（無料神石）。バナーは未使用。
   RELEASE-RULES:
     §1.2 テスト広告IDを本番に出さない。実IDが揃うまで ADS_READY=false。
     §7.1 AdMobは Capacitor.registerPlugin('AdMob')（Capacitor.Plugins.AdMobは使わない）。
     §9   ATTは「初回ユーザータップ」起点。タイマー/起動時に呼ぶと無言denied→却下。
   ============================================================ */
(function () {
  "use strict";
  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());

  // 実AdMob ID（siosen323 / pub-1975437480047330）。AdMobでアプリ/ユニット作成後に記入。
  // 実IDが入るまで ADS_READY=false（テストIDは絶対に本番へ出さない §1.2）。
  const AD_UNITS = {
    interstitial: "ca-app-pub-1975437480047330/7919659090", // ゴッドガチャ∞ godgacha-interstitial-ios（実ID）
    rewarded:     "ca-app-pub-1975437480047330/5568029161", // ゴッドガチャ∞ godgacha-rewarded-ios（実ID）
  };
  const ADS_READY = true;    // 実ID投入済み。app id = ca-app-pub-1975437480047330~9089270538
  const AD_TESTING = false;  // 本番では絶対 false

  const INTER_EVERY = 3;     // ガチャ結果クローズ何回ごとにインタースティシャル

  function getAdMob() {
    if (!Cap) return null;
    try { if (typeof Cap.registerPlugin === "function") return Cap.registerPlugin("AdMob"); } catch (e) {}
    return (Cap.Plugins && Cap.Plugins.AdMob) || null;
  }

  const Ads = {
    _admob: null,
    _ready: false,        // initialize 済み
    _attDone: false,
    _interReady: false,
    _rewardReady: false,
    _interCount: 0,

    init() {
      if (isNative) this._admob = getAdMob();
    },

    // 初回ユーザータップから呼ぶ（§9）。ATT→initialize→広告prep を一度だけ。
    ensureStarted() {
      if (!isNative || !ADS_READY || this._attDone) return Promise.resolve();
      this._attDone = true;
      const A = this._admob; if (!A) return Promise.resolve();
      const self = this;
      return Promise.resolve()
        .then(() => A.requestTrackingAuthorization ? A.requestTrackingAuthorization() : null).catch(() => {})
        .then(() => A.initialize({ initializeForTesting: AD_TESTING })).catch(() => {})
        .then(() => { self._ready = true; })
        .then(() => self._prepInter()).catch(() => {})
        .then(() => self._prepReward()).catch(() => {});
    },

    _prepInter() {
      const A = this._admob; if (!A || !this._ready) return Promise.resolve(); const self = this;
      return A.prepareInterstitial({ adId: AD_UNITS.interstitial, isTesting: AD_TESTING })
        .then(() => { self._interReady = true; }).catch(() => { self._interReady = false; });
    },
    _prepReward() {
      const A = this._admob; if (!A || !this._ready) return Promise.resolve(); const self = this;
      return A.prepareRewardVideoAd({ adId: AD_UNITS.rewarded, isTesting: AD_TESTING })
        .then(() => { self._rewardReady = true; }).catch(() => { self._rewardReady = false; });
    },

    // ガチャ結果クローズ時に呼ぶ。INTER_EVERY回ごとに表示（§7.2: 次画面描画後）。
    maybeInterstitial() {
      if (!isNative || !ADS_READY || !this._ready) return;
      this._interCount++;
      if (this._interCount % INTER_EVERY !== 0) return;
      const A = this._admob; if (!A) return; const self = this;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        Promise.resolve().then(() => self._interReady ? null : self._prepInter())
          .then(() => A.showInterstitial()).catch(() => {})
          .then(() => { self._interReady = false; self._prepInter(); });
      }));
    },

    // リワード動画。報酬を得たら true。Web/未対応では false。
    rewardedAvailable() { return isNative && ADS_READY && this._ready; },
    showRewarded() {
      if (!this.rewardedAvailable()) return Promise.resolve(false);
      const A = this._admob; if (!A) return Promise.resolve(false); const self = this;
      return Promise.resolve()
        .then(() => self._rewardReady ? null : self._prepReward())
        .then(() => A.showRewardVideoAd())
        .then((reward) => {
          self._rewardReady = false; self._prepReward();
          return !!(reward && (reward.amount != null || reward.type != null || reward.rewarded));
        })
        .catch(() => { self._rewardReady = false; self._prepReward(); return false; });
    },
  };

  window.Services = { isNative, Ads, ADS_READY };
})();
