/* ============================================================
   app.js — UI / 演出 / 画面遷移。ロジックは Gacha / GG_DATA に委譲。
   見た目はプレースホルダ（CSSグラデ＋絵文字）。GPTアセットで後差し替え。
   ============================================================ */
(function () {
  "use strict";
  const D = window.GG_DATA;
  const G = window.Gacha;
  const $ = function (s, el) { return (el || document).querySelector(s); };
  const $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  // ---------- ヘッダ・通貨表示 ----------
  function fmt(n) { return n.toLocaleString("ja-JP"); }
  function refreshHud() {
    $("#gemCount").textContent = fmt(G.gems());
    $("#gpCount").textContent = fmt(G.gp());
    const p = G.pityInfo();
    $("#pitySSR").textContent = p.toSSR;
    $("#pityUR").textContent = p.toUR;
    const ms = G.msToNextRegen();
    $("#regen").textContent = ms == null ? "満タン" : ("次の無料 +1 まで " + Math.ceil(ms / 1000) + "s");
    // ボタンの可否
    $("#btnSingle").disabled = !G.canAfford(G.CFG.COST_SINGLE);
    $("#btnMulti").disabled = !G.canAfford(G.CFG.COST_MULTI);
  }

  // ---------- アート（画像 or 絵文字フォールバック）----------
  // assets/<artKey>.png をimgで読み込み、404なら自動でimgを消して絵文字を見せる。
  function artInner(god, emojiClass) {
    return '<span class="emoji ' + (emojiClass || "") + '">' + god.emoji + "</span>" +
      '<img class="art-img" alt="" loading="lazy" src="assets/' + god.artKey + '.png" onerror="this.style.display=\'none\'">';
  }

  // ---------- カード生成 ----------
  function card(god, rarity, opts) {
    opts = opts || {};
    const r = rarity;
    const el = document.createElement("div");
    el.className = "card r-" + r.id + (r.aurora ? " aurora" : "") + (r.glitch ? " glitch" : "");
    el.style.setProperty("--rc", r.color);
    el.style.setProperty("--rg", r.glow);
    // アート：assets/<artKey>.png があれば画像、無ければ絵文字フォールバック
    const art = '<div class="art">' + artInner(god) + "</div>";
    const badge = '<div class="rbadge">' + r.id + "</div>";
    const newt = opts.isNew ? '<div class="newt">NEW</div>' : "";
    const refund = (opts.refund ? '<div class="refund">+' + opts.refund + ' 💎</div>' : "");
    el.innerHTML =
      badge + newt +
      art +
      '<div class="cname">' + god.name + "</div>" +
      '<div class="ctier">' + r.label + " · " + r.tier + "</div>" +
      refund;
    return el;
  }

  // ---------- 排出演出 ----------
  const overlay = $("#overlay");
  const stage = $("#stage");

  function playResults(results) {
    stage.innerHTML = "";
    overlay.classList.add("show");
    const top = results.reduce(function (m, x) { return x.rarity.rank > m.rarity.rank ? x : m; }, results[0]);

    // 最高レアに応じた閃光色
    overlay.style.setProperty("--flash", top.rarity.glow);
    overlay.classList.toggle("big", top.rarity.rank >= D.BY_ID.SSR.rank);
    overlay.classList.toggle("legendary", top.rarity.rank >= D.BY_ID.UR.rank);
    overlay.classList.toggle("cosmic", top.rarity.rank >= D.BY_ID.GR.rank);
    overlay.classList.toggle("concept", top.rarity.rank >= D.BY_ID.XR.rank);

    // カードを順次出す
    const grid = document.createElement("div");
    grid.className = "result-grid" + (results.length === 1 ? " single" : "");
    stage.appendChild(grid);
    results.forEach(function (res, i) {
      const c = card(res.god, res.rarity, { isNew: res.isNew, refund: res.refund });
      c.style.animationDelay = (i * 70) + "ms";
      c.classList.add("pop");
      grid.appendChild(c);
    });

    // 概念神(XR)の特別バナー
    if (top.rarity.rank >= D.BY_ID.XR.rank) showConceptBanner(top.god);
    else if (top.rarity.rank >= D.BY_ID.GR.rank) toast("✦ 宇宙神 降臨 ✦");

    refreshHud();
    renderDexMini();
  }

  function showConceptBanner(god) {
    const b = $("#concept");
    $("#conceptName").textContent = god.name;
    b.classList.add("show");
  }
  $("#conceptClose").addEventListener("click", function () { $("#concept").classList.remove("show"); });

  function closeOverlay() {
    overlay.classList.remove("show");
    if (window.Services && Services.Ads) Services.Ads.maybeInterstitial(); // §7.2 次画面描画後に表示
  }
  $("#stageClose").addEventListener("click", closeOverlay);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });

  // ---------- ボタン ----------
  function doPull(kind) {
    const res = kind === "multi" ? G.pullMulti() : G.pullSingle();
    if (!res.ok) { toast("神石が たりない"); return; }
    playResults(res.results);
  }
  $("#btnSingle").addEventListener("click", function () { doPull("single"); });
  $("#btnMulti").addEventListener("click", function () { doPull("multi"); });

  // ---------- リワード動画（無料神石）----------
  const REWARD_GEMS = 30;
  const btnReward = $("#btnReward");
  btnReward.addEventListener("click", function () {
    const Ads = window.Services && window.Services.Ads;
    if (!Ads || !Ads.rewardedAvailable()) { toast("動画は実機で視聴できます"); return; }
    btnReward.disabled = true;
    Ads.showRewarded().then(function (rewarded) {
      btnReward.disabled = false;
      if (rewarded) { G.addGems(REWARD_GEMS); refreshHud(); toast("💎 +" + REWARD_GEMS + "（動画視聴）"); }
    }).catch(function () { btnReward.disabled = false; });
  });

  // ---------- ショップ（消費型IAP：神石パック）----------
  const Purchases = (window.Services && window.Services.Purchases) || null;
  // 商品ID → 表示情報（価格はストアから取得・無ければ参考表示）
  const PACKS = [
    { id: "com.raito.godgacha.gems100",  gems: 100,  fallback: "¥160",   tag: "" },
    { id: "com.raito.godgacha.gems550",  gems: 550,  fallback: "¥800",   tag: "+10%" },
    { id: "com.raito.godgacha.gems1200", gems: 1200, fallback: "¥1,600", tag: "+20% お得" },
    { id: "com.raito.godgacha.gems6500", gems: 6500, fallback: "¥8,000", tag: "+30% 大量" },
  ];
  function renderShop() {
    const wrap = $("#shopList"); wrap.innerHTML = "";
    PACKS.forEach(function (p) {
      const price = (Purchases && Purchases.price(p.id)) || p.fallback;
      const el = document.createElement("button");
      el.className = "pack";
      el.innerHTML = '<div class="pg">💎 ' + fmt(p.gems) + "</div>" +
        (p.tag ? '<div class="ptag">' + p.tag + "</div>" : "") +
        '<div class="pp">' + price + "</div>";
      el.addEventListener("click", function () {
        if (!Purchases) { toast("購入は実機のみ"); return; }
        el.disabled = true;
        Purchases.buy(p.id).then(function (ok) {
          el.disabled = false;
          if (ok) { refreshHud(); toast("💎 +" + fmt(p.gems)); }
        }).catch(function () { el.disabled = false; });
      });
      wrap.appendChild(el);
    });
  }

  // ---------- 図鑑 ----------
  function renderDex() {
    const wrap = $("#dexList"); wrap.innerHTML = "";
    // レア度ごとにセクション
    D.RARITIES.slice().reverse().forEach(function (r) {
      const gods = D.POOL[r.id];
      if (!gods.length) return;
      const head = document.createElement("div");
      head.className = "dex-head r-" + r.id;
      head.style.setProperty("--rc", r.color);
      const ownedInTier = gods.filter(function (gd) { return G.ownedCount(gd.id); }).length;
      head.innerHTML = '<span class="dh-id">' + r.id + "</span> " + r.label +
        ' <span class="dh-rate">' + ratePct(r) + "</span>" +
        '<span class="dh-cnt">' + ownedInTier + "/" + gods.length + "</span>";
      wrap.appendChild(head);
      const grid = document.createElement("div");
      grid.className = "dex-grid";
      gods.forEach(function (gd) {
        const n = G.ownedCount(gd.id);
        const cell = document.createElement("div");
        cell.className = "dex-cell r-" + r.id + (n ? "" : " locked");
        cell.style.setProperty("--rc", r.color);
        cell.innerHTML = n
          ? '<span class="de">' + artInner(gd) + '</span><span class="dn">' + gd.name + '</span>' +
            (n > 1 ? '<span class="dx">×' + n + "</span>" : "")
          : '<span class="de">❔</span><span class="dn">？？？</span>';
        cell.title = n ? (gd.name + "（" + gd.yomi + "）" + gd.desc) : "未発見";
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
    });
    const st = G.dexStats();
    $("#dexPct").textContent = "コンプ率 " + st.pct.toFixed(1) + "%（" + st.owned + "/" + st.total + "）";
  }
  function ratePct(r) {
    const w = r.weight * 100;
    if (w >= 1) return w.toFixed(1) + "%";
    if (w >= 0.001) return w.toFixed(3) + "%";
    return (r.weight === 1e-8) ? "0.000001%（1/1億）" : w.toExponential(0) + "%";
  }

  function renderDexMini() {
    const st = G.dexStats();
    $("#dexBadge").textContent = st.owned + "/" + st.total;
  }

  // ---------- 確率表 ----------
  function renderRates() {
    const wrap = $("#rateList"); wrap.innerHTML = "";
    D.RARITIES.slice().reverse().forEach(function (r) {
      const row = document.createElement("div");
      row.className = "rate-row r-" + r.id;
      row.style.setProperty("--rc", r.color);
      row.innerHTML = '<span class="rr-id">' + r.id + "</span>" +
        '<span class="rr-lab">' + r.label + "</span>" +
        '<span class="rr-pct">' + ratePct(r) + "</span>";
      wrap.appendChild(row);
    });
    $("#pityNote").innerHTML =
      "天井：" + G.CFG.SOFT_PITY_SSR + "連で<b>SSR以上</b>確定／" + G.CFG.HARD_PITY_UR + "連で<b>UR以上</b>確定。" +
      "<br>10連は<b>SR以上1体確定</b>。GR(宇宙神)・XR(概念神)は天井対象外の<b>純運</b>。";
  }

  // ---------- タブ ----------
  $$(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      $$(".tab").forEach(function (x) { x.classList.remove("on"); });
      $$(".panel").forEach(function (x) { x.classList.remove("on"); });
      t.classList.add("on");
      const id = t.dataset.tab;
      $("#panel-" + id).classList.add("on");
      if (id === "point") refreshPoint();
      if (id === "dex") renderDex();
      if (id === "shop") renderShop();
      if (id === "rate") renderRates();
    });
  });

  // ---------- トースト ----------
  let toastT;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove("show"); }, 1600);
  }

  // ---------- ポイントガチャ（連打クリッカー）----------
  const machine = $("#machine");
  const floatLayer = $("#floatLayer");
  const cap = $(".cap", machine);
  // タップごとにスピン。連打前提で軽量に。
  function spinOnce(clientX, clientY) {
    const res = G.spinPoint();
    const tier = res.tier;
    // カプセル弾み
    cap.classList.remove("bounce"); void cap.offsetWidth; cap.classList.add("bounce");
    // 浮かぶ獲得テキスト
    floatGain(tier);
    // 大当たり演出（連打を止めない範囲で）
    if (tier.big >= 3) { machine.classList.add("hit-rainbow"); setTimeout(function(){ machine.classList.remove("hit-rainbow"); }, 600); toast(tier.label); }
    else if (tier.big >= 2) { machine.classList.add("hit-gold"); setTimeout(function(){ machine.classList.remove("hit-gold"); }, 400); }
    // HUD/統計を即時反映（保存は1秒ループで間引き）
    $("#gpCount").textContent = fmt(G.gp());
    $("#gpCount2").textContent = fmt(G.gp());
    $("#gemCount").textContent = fmt(G.gems());
    $("#spinCount").textContent = fmt(G.totalSpins());
    updateExchangeUI();
  }
  function floatGain(tier) {
    const el = document.createElement("div");
    el.className = "gain b" + tier.big;
    el.textContent = tier.label;
    el.style.color = tier.color;
    // 少しランダムに散らす
    el.style.left = (40 + Math.random() * 20) + "%";
    floatLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 850);
  }
  // pointerdown で即反応（連打しやすい）。クリックの二重発火を防ぐ。
  machine.addEventListener("pointerdown", function (e) { e.preventDefault(); spinOnce(); });
  // 長押し放置のオート連打はナシ（手動連打のみ）

  // 交換UI
  function updateExchangeUI() {
    const max = Math.floor(G.gp() / G.CFG.GP_PER_GEM);
    $("#exMaxNote").textContent = max > 0 ? ("💎" + fmt(max)) : "—";
    $$(".ex-btn[data-gem]").forEach(function (b) {
      const need = (+b.dataset.gem) * G.CFG.GP_PER_GEM;
      b.disabled = G.gp() < need;
    });
    $("#exMax").disabled = max <= 0;
  }
  $$(".ex-btn[data-gem]").forEach(function (b) {
    b.addEventListener("click", function () {
      const r = G.exchangeGP(+b.dataset.gem);
      if (!r.ok) { toast("🎟 が たりない"); return; }
      toast("💎 +" + r.gems + "（🎟-" + fmt(r.gp) + "）");
      refreshHud(); updateExchangeUI();
    });
  });
  $("#exMax").addEventListener("click", function () {
    const r = G.exchangeMax();
    if (!r.ok) { toast("🎟 が たりない"); return; }
    toast("💎 +" + fmt(r.gems) + "（🎟-" + fmt(r.gp) + "）");
    refreshHud(); updateExchangeUI();
  });

  // ---------- 開発用 ----------
  $("#devReset").addEventListener("click", function () {
    if (confirm("セーブを初期化しますか？")) { G.devReset(); refreshHud(); renderDexMini(); toast("リセット完了"); }
  });

  function refreshPoint() {
    $("#gpCount2").textContent = fmt(G.gp());
    $("#spinCount").textContent = fmt(G.totalSpins());
    updateExchangeUI();
  }

  // ---------- ループ ----------
  function loop() { G.tickRegen(); G.flush(); refreshHud(); renderDexMini(); }
  setInterval(loop, 1000);

  // ---------- プラットフォーム連携（広告/課金）----------
  if (window.Services) {
    if (Services.Ads) Services.Ads.init();
    if (Services.Purchases) {
      Services.Purchases.onChange = function () { if ($("#panel-shop").classList.contains("on")) renderShop(); };
      Services.Purchases.init();
    }
    // ATTは初回ユーザータップ起点（§9: タイマー起動だと無言denied→却下）
    const onFirstTap = function () {
      document.removeEventListener("pointerdown", onFirstTap, true);
      if (Services.Ads) Services.Ads.ensureStarted();
    };
    document.addEventListener("pointerdown", onFirstTap, true);
  }

  // 初期表示
  G.tickRegen();
  refreshHud();
  renderDexMini();
})();
