// ads.js — 広告ファサード（Web=モック / iOS=Capacitor AdMob に差し替え）
// 既存アプリの定番構成に合わせた共通API。実IDは iOS 化時に注入する。
// RELEASE-RULES §7: AdMob取得は registerPlugin フォールバック必須 /
// インタースティシャルは次画面を描画してから表示 / バナーは placeholder 帯方式。

const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// ---- 内部状態 ----
let AdMob = null;
let bannerLoaded = false;
let interstitialReady = false;
let rewardReady = false;

export function adsAvailable() { return isNative && !!AdMob; }

export async function initAds() {
  if (!isNative) return; // Webは広告なし（モックはリワードのみ）
  try {
    const cap = window.Capacitor;
    AdMob = (cap.Plugins && cap.Plugins.AdMob) || null;
    if (!AdMob && cap.registerPlugin) AdMob = cap.registerPlugin('AdMob');
    if (!AdMob) return;
    await AdMob.initialize({ initializeForTesting: false });
    prepareInterstitial();
    prepareReward();
  } catch (e) { AdMob = null; }
}

// ---- バナー（プレイ画面では出さない設計。マップ/リザルトのみが基本） ----
export async function showBanner() {
  if (!adsAvailable()) return;
  try {
    await AdMob.showBanner({ adId: window.HZ_AD_BANNER, position: 'TOP_CENTER', margin: 0 });
    bannerLoaded = true;
    document.body.classList.add('banner-on');
  } catch (e) {}
}
export async function hideBanner() {
  if (!adsAvailable()) return;
  try { await AdMob.hideBanner(); } catch (e) {}
  document.body.classList.remove('banner-on');
}

// ---- インタースティシャル ----
async function prepareInterstitial() {
  if (!adsAvailable()) return;
  try { await AdMob.prepareInterstitial({ adId: window.HZ_AD_INTERSTITIAL }); interstitialReady = true; } catch (e) {}
}
// 次の画面を描画し終えてから呼ぶこと（呼び出し側の責務）
export async function showInterstitial() {
  if (!adsAvailable() || !interstitialReady) return false;
  try {
    await AdMob.showInterstitial();
    interstitialReady = false;
    setTimeout(prepareInterstitial, 1000);
    return true;
  } catch (e) { return false; }
}

// ---- リワード（ヒント用） ----
async function prepareReward() {
  if (!adsAvailable()) return;
  try { await AdMob.prepareRewardVideoAd({ adId: window.HZ_AD_REWARD }); rewardReady = true; } catch (e) {}
}
// 成功時 onReward() を呼ぶ。Webではモック（1秒待ちの疑似視聴）で必ず成功。
export function showRewardAd(onReward, onFail) {
  if (!isNative) {
    // Webモック: 実広告なしで即付与（プロトタイプ検証用）
    setTimeout(() => onReward && onReward(), 600);
    return;
  }
  if (!adsAvailable() || !rewardReady) { onFail && onFail(); return; }
  (async () => {
    try {
      const listener = AdMob.addListener && AdMob.addListener('onRewardedVideoAdReward', () => {
        listener && listener.remove && listener.remove();
        onReward && onReward();
      });
      await AdMob.showRewardVideoAd();
      rewardReady = false;
      setTimeout(prepareReward, 1000);
    } catch (e) { onFail && onFail(); }
  })();
}
