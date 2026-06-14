/* iap.js — App内課金ブリッジ。
   ネイティブ（iOS/Capacitor）に cordova-plugin-purchase (CdvPurchase) を入れると、
   それを game.js が期待する window.IAP = { purchase(productId), restore() } に適合させる。
   ブラウザ/PWA（プラグイン無し）では何もしない → game.js が確認ダイアログでフォールバックする。 */
(function () {
  const IDS = ['nlh.bb_display', 'nlh.edit_stack', 'nlh.tournament', 'nlh.no_ante', 'nlh.all_bundle'];

  function init() {
    if (!window.CdvPurchase || window.IAP) return;
    const { store, ProductType, Platform } = window.CdvPurchase;
    const pending = {}; // productId -> {resolve, reject}

    IDS.forEach((id) =>
      store.register({ id, type: ProductType.NON_CONSUMABLE, platform: Platform.APPLE_APPSTORE })
    );

    store.when()
      .approved((t) => t.verify())
      .verified((receipt) => receipt.finish())
      .finished((t) => {
        (t.products || []).forEach((p) => {
          if (pending[p.id]) { pending[p.id].resolve(); delete pending[p.id]; }
        });
      });

    store.error((err) => {
      Object.keys(pending).forEach((id) => { pending[id].reject(err); delete pending[id]; });
    });

    store.initialize([Platform.APPLE_APPSTORE]);

    window.IAP = {
      purchase(productId) {
        return new Promise((resolve, reject) => {
          const product = store.get(productId);
          const offer = product && product.getOffer && product.getOffer();
          if (!offer) { reject(new Error('product not available: ' + productId)); return; }
          pending[productId] = { resolve, reject };
          store.order(offer);
        });
      },
      restore() {
        return Promise.resolve(store.restorePurchases()).then(() =>
          IDS.filter((id) => { const p = store.get(id); return p && p.owned; })
        );
      },
    };
  }

  // Cordova/Capacitor では deviceready、無ければ即時にも試す。
  document.addEventListener('deviceready', init, false);
  if (window.CdvPurchase) init();
})();
