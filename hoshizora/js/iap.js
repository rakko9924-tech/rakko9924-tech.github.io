// iap.js — 課金「広告を消す＋毎日ヒント1枚」¥500（非消耗型）
// 正はStoreKit（cordova-plugin-purchase）。localStorage は補助キャッシュ（RELEASE-RULES §1.3）。
// Web/プラグイン未導入では安全に何もしない。無料付与は絶対にしない。
import { isAdFree, setAdFree } from './storage.js';
import { hideBanner } from './ads.js';

const PRODUCT_ID = 'com.raito.hoshizora.removeads';

function isNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }

function grant() {
  setAdFree(true);
  try { hideBanner(); } catch (e) {}
  try { window.dispatchEvent(new Event('ads-removed')); } catch (e) {}
}

export function initIAP() {
  const CP = window.CdvPurchase;
  if (!CP || !isNative()) return;
  try {
    const { store, Platform, ProductType } = CP;
    store.register([{ id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: Platform.APPLE_APPSTORE }]);
    store.when()
      .approved(t => { try { t.verify(); } catch (e) { t.finish(); grant(); } })
      .verified(r => { try { r.finish(); } catch (e) {} grant(); })
      .productUpdated(() => {});
    store.initialize([Platform.APPLE_APPSTORE]);
  } catch (e) {}
}

export function buyRemoveAds(onUnavailable) {
  if (isAdFree()) { grant(); return; }
  const CP = window.CdvPurchase;
  if (!CP || !isNative()) { onUnavailable && onUnavailable(); return; }
  try {
    const p = CP.store.get(PRODUCT_ID, CP.Platform.APPLE_APPSTORE);
    const offer = p && p.getOffer && p.getOffer();
    if (offer) offer.order();
    else onUnavailable && onUnavailable();
  } catch (e) { onUnavailable && onUnavailable(); }
}

export function restorePurchases() {
  const CP = window.CdvPurchase;
  if (!CP || !isNative()) return;
  try { CP.store.restorePurchases(); } catch (e) {}
}

export function iapAvailable() { return isNative() && !!window.CdvPurchase; }
