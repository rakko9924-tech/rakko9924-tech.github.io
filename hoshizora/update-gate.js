/* update-gate.js — 強制アップデート案内（全アプリ共通テンプレート・汎用版）。
   App Storeの公開バージョンより古いアプリは全画面案内でブロックし、更新するまで遊べなくする。
   使い方:
     1) version.js で window.APP_VERSION と window.APP_STORE_ID を定義（このファイルより先に読み込む）
     2) index.html で version.js → update-gate.js の順に <script> 追加
     3) CSSに #updateGate / .ug-card スタイルを追加（README参照）
   仕様: 通信失敗/オフライン時はブロックしない(fail-open)。Web(非ネイティブ)では動作しない。 */
(function () {
  const APP_ID = window.APP_STORE_ID; // 例: '6781177113'
  if (!APP_ID) return;
  const STORE_URL = 'itms-apps://itunes.apple.com/app/id' + APP_ID;
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // 'a.b.c' 形式の数値比較: a>b=1 / a==b=0 / a<b=-1
  function cmp(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function showOverlay(storeVer) {
    if (document.getElementById('updateGate')) return;
    const o = document.createElement('div');
    o.id = 'updateGate';
    o.innerHTML = `<div class="ug-card">
      <div class="ug-icon">⬆️</div>
      <h2>アップデートのお願い</h2>
      <p>新しいバージョン <b>v${storeVer}</b> が公開されています。<br>最新版にアップデートしてからお楽しみください。</p>
      <button class="btn big" id="ugGo">App Storeでアップデート</button>
    </div>`;
    const add = () => { document.body.appendChild(o); document.getElementById('ugGo').onclick = () => { location.href = STORE_URL; }; };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  }

  async function check() {
    try {
      const r = await fetch(`https://itunes.apple.com/jp/lookup?id=${APP_ID}&_=${Date.now()}`, { cache: 'no-store' });
      const j = await r.json();
      const store = j && j.results && j.results[0] && j.results[0].version;
      if (store && cmp(store, window.APP_VERSION || '0') > 0) showOverlay(store);
    } catch (e) { /* fail-open */ }
  }

  if (isNative) { check(); document.addEventListener('resume', check); }
  window.UPDATEGATE = { cmp, showOverlay, check };
})();
