// ads.js — 広告ファサード（Web=モック / iOS=Capacitor AdMob 実ID）
// AdMobアプリ: ほしぞら探検隊 ca-app-pub-1975437480047330~1169042164（siosen323・2026-07-18作成）
// RELEASE-RULES §7: registerPlugin フォールバック必須 / ATTは初回ユーザータップ起点 /
// インタースティシャルは次画面を描画してから表示 / 本番 initializeForTesting=false。

const AD_BANNER = 'ca-app-pub-1975437480047330/1304773535';       // hoshizora-banner
const AD_INTERSTITIAL = 'ca-app-pub-1975437480047330/8807859036'; // hoshizora-interstitial
const AD_REWARD = 'ca-app-pub-1975437480047330/7542878820';       // hoshizora-reward

const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// ---- 内部状態 ----
let AdMob = null;
let inited = false;
let interstitialReady = false;
let rewardReady = false;

function admobPlugin() {
  const cap = window.Capacitor;
  if (!cap) return null;
  let ad = null;
  if (typeof cap.registerPlugin === 'function') {
    try { ad = cap.registerPlugin('AdMob'); } catch (e) { ad = null; }
  }
  if (!ad && cap.Plugins) ad = cap.Plugins.AdMob || null;
  return ad;
}

export function adsAvailable() { return isNative && !!AdMob && inited; }

// UMP（Google User Messaging Platform）同意フロー。EEA/UKでは同意が必要。
// 失敗しても広告初期化は続行（非致命）。地域外では NOT_REQUIRED で即抜け。
async function gatherConsent() {
  try {
    if (!AdMob || !AdMob.requestConsentInfo) return;
    const info = await AdMob.requestConsentInfo();
    if (info && info.status === 'REQUIRED' && info.isConsentFormAvailable && AdMob.showConsentForm) {
      await AdMob.showConsentForm();
    }
  } catch (e) {}
}

export async function initAds() {
  if (!isNative) return; // Webは広告なし（リワードのみモック）
  AdMob = admobPlugin();
  if (!AdMob) return;
  // ATT は「初回ユーザータップ」起点（inactive中に呼ぶと無言で.denied確定→二度と出ない罠。
  // ISSEN build8 の却下実例）。タップは必ず active なので確実に提示される。
  let started = false;
  const startAds = () => {
    if (started) return; started = true;
    window.removeEventListener('pointerdown', startAds, true);
    window.removeEventListener('touchend', startAds, true);
    Promise.resolve()
      .then(() => gatherConsent()) // UMP: EEA/UK の GDPR 同意（AdMob EUユーザー同意ポリシー必須）
      .then(() => (AdMob.requestTrackingAuthorization ? AdMob.requestTrackingAuthorization() : null)) // ATT: IDFA
      .catch(() => {})
      .then(() => AdMob.initialize({ initializeForTesting: false, testingDevices: [] }))
      .then(() => { inited = true; prepareInterstitial(); prepareReward(); })
      .catch(() => {});
  };
  window.addEventListener('pointerdown', startAds, true);
  window.addEventListener('touchend', startAds, true);
}

// ---- バナー（プレイ画面には置かない。星図/リザルトのみ） ----
export async function showBanner() {
  if (!adsAvailable()) return;
  try {
    await AdMob.showBanner({ adId: AD_BANNER, position: 'TOP_CENTER', margin: 0 });
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
  if (!AdMob || !inited) return;
  try { await AdMob.prepareInterstitial({ adId: AD_INTERSTITIAL }); interstitialReady = true; } catch (e) {}
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

// ---- リワード ----
// 完了は「イベント」で確定させる。native showRewardVideoAd の await はユーザーが報酬を
// 獲得したときしか解決しない（早期に閉じると永久に未解決）ので、await に依存しない。
let rewardCb = null;       // 報酬獲得時のコールバック（1本だけ）
let rewardFail = null;     // 未獲得で閉じた/失敗時のコールバック
let rewardEarned = false;  // この視聴で報酬を得たか
let rewardListenerSet = false;

async function prepareReward() {
  if (!AdMob || !inited) return;
  try { await AdMob.prepareRewardVideoAd({ adId: AD_REWARD }); rewardReady = true; } catch (e) {}
}
function ensureRewardListener() {
  // リスナーは常設1本。コールバックだけ差し替える（蓄積・再発火バグの防止）
  if (rewardListenerSet || !AdMob || !AdMob.addListener) return;
  rewardListenerSet = true;
  AdMob.addListener('onRewardedVideoAdReward', () => {
    rewardEarned = true;
    const cb = rewardCb; rewardCb = null;
    cb && cb();
  });
  // 閉じた/表示失敗（単発広告は消費済みなので必ず次を読み込み直す）
  const done = () => {
    rewardReady = false;
    setTimeout(prepareReward, 800);
    if (!rewardEarned) { const fb = rewardFail; rewardCb = null; rewardFail = null; fb && fb(); }
    rewardEarned = false;
  };
  AdMob.addListener('onRewardedVideoAdDismissed', done);
  AdMob.addListener('onRewardedVideoAdFailedToShow', done);
}
// 成功時 onReward() を1回だけ呼ぶ。閉じ/失敗時は onFail()。Webはモックで必ず成功。
export function showRewardAd(onReward, onFail) {
  if (!isNative) {
    setTimeout(() => onReward && onReward(), 600);
    return;
  }
  if (!adsAvailable() || !rewardReady) { onFail && onFail(); return; }
  (async () => {
    try {
      ensureRewardListener();
      rewardEarned = false;
      rewardCb = onReward;
      rewardFail = onFail;
      await AdMob.showRewardVideoAd();
      // 完了/失敗の後処理は Reward/Dismissed/FailedToShow リスナーで確定させる
    } catch (e) { rewardReady = false; setTimeout(prepareReward, 800); rewardCb = null; rewardFail = null; onFail && onFail(); }
  })();
}
