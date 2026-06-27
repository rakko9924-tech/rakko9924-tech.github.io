/* ============================================================
   iap.js — 課金（消費型IAP：神石パック）。cordova-plugin-purchase v13。
   ネイティブ: StoreKitが購入の真偽（§1.3）。finished で神石を付与。
   Web: 擬似購入（dev のみ）。
   ============================================================ */
(function () {
  "use strict";
  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());

  // 商品ID → 付与神石数（価格はASCのIAP商品で設定）
  const PACKS = [
    { id: "com.raito.godgacha.gems100",  gems: 100 },
    { id: "com.raito.godgacha.gems550",  gems: 550 },
    { id: "com.raito.godgacha.gems1200", gems: 1200 },
    { id: "com.raito.godgacha.gems6500", gems: 6500 },
  ];
  const BY_ID = {}; PACKS.forEach((p) => (BY_ID[p.id] = p));

  const Purchases = {
    PACKS: PACKS,
    onChange: null,        // 価格更新時のUI再描画
    priceById: {},         // id → 価格文字列（ストアから取得）
    _store: null,
    _pending: null,        // { id, resolve, reject }

    init() {
      if (!isNative) return;
      const self = this;
      function setup() {
        const CdvPurchase = window.CdvPurchase;
        if (!CdvPurchase || self._store) return;
        const store = (self._store = CdvPurchase.store);
        const { ProductType, Platform } = CdvPurchase;
        store.register(PACKS.map((p) => ({
          id: p.id, type: ProductType.CONSUMABLE, platform: Platform.APPLE_APPSTORE,
        })));
        store.when()
          .productUpdated(function (p) {
            const offer = p.getOffer && p.getOffer();
            const ph = offer && offer.pricingPhases && offer.pricingPhases[0];
            if (ph && ph.price) { self.priceById[p.id] = ph.price; self.onChange && self.onChange(); }
          })
          .approved(function (t) { t.verify(); })
          .verified(function (r) { r.finish(); })
          .finished(function (t) {
            (t.products || []).forEach(function (p) {
              const pack = BY_ID[p.id];
              if (pack && window.Gacha) {
                window.Gacha.addGems(pack.gems);   // StoreKit確定後に付与（§1.3）
                if (self._pending && self._pending.id === p.id) {
                  self._pending.resolve(true); self._pending = null;
                }
                self.onChange && self.onChange();
              }
            });
          });
        store.error(function (err) {
          if (self._pending) { self._pending.reject(err); self._pending = null; }
        });
        store.initialize([Platform.APPLE_APPSTORE]);
      }
      document.addEventListener("deviceready", setup, false);
      if (document.readyState !== "loading") setTimeout(setup, 0);
      else document.addEventListener("DOMContentLoaded", setup);
    },

    price(id) { return this.priceById[id] || null; },

    // 購入。成功で true（神石は finished で付与済み）。
    async buy(id) {
      const pack = BY_ID[id]; if (!pack) return false;
      if (isNative) {
        const CdvPurchase = window.CdvPurchase, store = this._store;
        if (!CdvPurchase || !store) return false;
        const Platform = CdvPurchase.Platform;
        const p = store.get(id, Platform.APPLE_APPSTORE);
        if (!p) return false;
        const offer = p.getOffer(); if (!offer) return false;
        const self = this;
        return new Promise(function (resolve, reject) {
          self._pending = { id: id, resolve: resolve, reject: reject };
          offer.order();
        }).then(() => true).catch(() => false);
      }
      // Web 試作：擬似購入（dev のみ・StoreKit非経由）
      if (window.confirm("「💎" + pack.gems + "」を購入しますか？（試作：擬似購入）")) {
        window.Gacha && window.Gacha.addGems(pack.gems);
        this.onChange && this.onChange();
        return true;
      }
      return false;
    },

    async restore() {
      if (isNative && this._store) { try { await this._store.restorePurchases(); } catch (e) {} }
      // 消費型は復元対象外（残高は端末ローカル）。未消費トランザクションのみ finished で回収。
      this.onChange && this.onChange();
    },
  };

  if (!window.Services) window.Services = {};
  window.Services.Purchases = Purchases;
})();
