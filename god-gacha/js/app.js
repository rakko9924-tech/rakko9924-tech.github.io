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
  // アセットのキャッシュバスター（index.htmlのAPP_VERと連動。スプライト差し替え時に反映させる）
  const AV = "?v=" + (window.APP_VER || "0");
  function artURL(key) { return "assets/" + key + ".png" + AV; }

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
    $("#btnMega").disabled = !G.canAfford(G.CFG.COST_MEGA);
    $("#btnUltra").disabled = !G.canAfford(G.CFG.COST_ULTRA);
    $("#btnGiga").disabled = !G.canAfford(G.CFG.COST_GIGA);
    $("#btnTera").disabled = !G.canAfford(G.CFG.COST_TERA);
  }

  // ---------- アート（画像 or 絵文字フォールバック）----------
  // assets/<artKey>.png をimgで読み込み、404なら自動でimgを消して絵文字を見せる。
  function artInner(god, emojiClass) {
    // 絵文字はスプライト読み込み失敗時のみ表示（既定は非表示＝結果カード裏に絵文字を出さない）
    return '<span class="emoji ' + (emojiClass || "") + '" style="display:none">' + god.emoji + "</span>" +
      '<img class="art-img" alt="" loading="lazy" src="' + artURL(god.artKey) + '" ' +
      'onerror="this.style.display=\'none\'; var e=this.previousElementSibling; if(e)e.style.display=\'\'">';
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

  let pendingOpen = null; // 玉フェーズの開封関数

  function playResults(results) {
    stage.innerHTML = "";
    overlay.classList.add("show", "balls");
    overlay.classList.remove("big", "legendary", "cosmic", "concept");
    const top = results.reduce(function (m, x) { return x.rarity.rank > m.rarity.rank ? x : m; }, results[0]);
    const hasBlack = results.some(function (r) { return r.ball === "black"; });
    const BIG = results.length > 12;

    // --- Phase1: ガチャ玉を出す（色＝最低保証のテーザー）---
    // 大量連は玉を全部は出さず、目立つ玉（高レア・黒玉）を最大24個だけ見せる。
    let ballList = results;
    if (BIG) {
      ballList = results.slice().sort(function (a, b) {
        const ra = a.ball === "black" ? 999 : a.rarity.rank;
        const rb = b.ball === "black" ? 999 : b.rarity.rank;
        return rb - ra;
      }).slice(0, 24);
    }
    const bg = document.createElement("div");
    bg.className = "ball-grid" + (results.length === 1 ? " single" : "") + (BIG ? " many" : "");
    ballList.forEach(function (res, i) {
      const b = document.createElement("div");
      b.className = "ball-item ball-" + (res.ball || "white");
      b.style.animationDelay = (Math.min(i, 20) * 55) + "ms";
      b.innerHTML = '<img src="assets/ball_' + (res.ball || "white") + '.png" alt="">';
      bg.appendChild(b);
    });
    stage.appendChild(bg);
    const hint = document.createElement("div");
    hint.className = "ball-hint";
    hint.textContent = hasBlack ? "…黒玉…！？ タップで開封"
      : BIG ? (fmt(results.length) + "連！ タップで一括開封")
      : "タップで開封！";
    if (hasBlack) overlay.classList.add("ominous");
    stage.appendChild(hint);

    let opened = false;
    const timer = setTimeout(function () { pendingOpen && pendingOpen(); }, 2600); // AUTO_OPEN
    pendingOpen = function () {
      if (opened) return; opened = true; clearTimeout(timer); pendingOpen = null;
      revealCards(results, top);
    };
    bg.addEventListener("click", pendingOpen);

    refreshHud();
  }

  let pendingHero = null; // SSR以上の大演出→次へ

  function buildGrid(results, top) {
    stage.innerHTML = "";
    const BIG = results.length > 12;

    // 大量連はレア度別の集計バーを上に出す
    if (BIG) {
      const counts = {};
      results.forEach(function (r) { counts[r.rarity.id] = (counts[r.rarity.id] || 0) + 1; });
      const bar = document.createElement("div");
      bar.className = "result-summary";
      bar.innerHTML = '<div class="rs-title">' + fmt(results.length) + "連 結果</div>" +
        '<div class="rs-tags">' + D.RARITIES.slice().reverse().filter(function (r) { return counts[r.id]; })
          .map(function (r) {
            return '<span class="rs-tag r-' + r.id + '" style="--rc:' + r.color + '">' + r.id + " ×" + counts[r.id] + "</span>";
          }).join("") + "</div>";
      stage.appendChild(bar);
    }

    const grid = document.createElement("div");
    grid.className = "result-grid" + (results.length === 1 ? " single" : "") + (BIG ? " dense" : "");
    stage.appendChild(grid);

    // 大量連はレア度降順で並べ、表示は上位120体まで（図鑑には全件反映済み）
    let list = results, truncated = 0;
    const CAP = 120;
    if (BIG) {
      list = results.slice().sort(function (a, b) { return b.rarity.rank - a.rarity.rank; });
      if (list.length > CAP) { truncated = list.length - CAP; list = list.slice(0, CAP); }
    }
    list.forEach(function (res, i) {
      const c = card(res.god, res.rarity, { isNew: res.isNew, refund: res.refund });
      c.style.animationDelay = (Math.min(i, 30) * (BIG ? 22 : 70)) + "ms";
      c.classList.add("pop");
      grid.appendChild(c);
    });
    if (truncated > 0) {
      const note = document.createElement("div");
      note.className = "result-note";
      note.textContent = "ほか " + fmt(truncated) + "体（レア度の高い順に上位のみ表示・図鑑には全て反映）";
      stage.appendChild(note);
    }
    renderDexMini();
  }

  // SSR以上：その神を画面いっぱいに大きく表示（GPT召喚背景）→タップで全体結果へ
  function heroReveal(top, onContinue) {
    stage.innerHTML = "";
    const r = top.rarity;
    const h = document.createElement("div");
    h.className = "hero r-" + r.id + (r.aurora ? " aurora" : "") + (r.glitch ? " glitch" : "");
    h.style.setProperty("--rc", r.color);
    h.style.setProperty("--rg", r.glow);
    const flair = r.rank >= D.BY_ID.XR.rank ? "概念神 降臨…！"
      : r.rank >= D.BY_ID.GR.rank ? "宇宙神 降臨！"
      : r.rank >= D.BY_ID.LR.rank ? "主神 降臨！"
      : r.rank >= D.BY_ID.UR.rank ? "大神 降臨！" : "上級神 降臨！";
    h.innerHTML =
      '<div class="hero-rays"></div>' +
      '<div class="hero-badge">' + r.id + "</div>" +
      '<img class="hero-god" src="' + artURL(top.god.artKey) + '" alt="">' +
      '<div class="hero-flair">' + flair + "</div>" +
      '<div class="hero-name">' + top.god.name + "</div>" +
      '<div class="hero-tier">' + r.label + " · " + r.tier + "</div>" +
      '<div class="hero-hint">タップで結果へ</div>';
    stage.appendChild(h);
    let done = false;
    const t = setTimeout(function () { go(); }, 3200);
    function go() { if (done) return; done = true; clearTimeout(t); pendingHero = null; onContinue(); }
    h.addEventListener("click", go);
    pendingHero = go;
  }

  function revealCards(results, top) {
    overlay.classList.remove("balls");
    const rk = top.rarity.rank;
    overlay.style.setProperty("--flash", top.rarity.glow);
    overlay.classList.toggle("big", rk >= D.BY_ID.SSR.rank);
    overlay.classList.toggle("legendary", rk >= D.BY_ID.UR.rank);
    overlay.classList.toggle("cosmic", rk >= D.BY_ID.GR.rank);
    overlay.classList.toggle("concept", rk >= D.BY_ID.XR.rank);

    // 玉を割る
    stage.querySelectorAll(".ball-item").forEach(function (b) { b.classList.add("crack"); });
    const h = stage.querySelector(".ball-hint"); if (h) h.remove();

    setTimeout(function () {
      overlay.classList.remove("ominous");
      if (rk >= D.BY_ID.SSR.rank) {
        overlay.classList.add("hero-on");
        heroReveal(top, function () { overlay.classList.remove("hero-on"); buildGrid(results, top); });
      } else {
        buildGrid(results, top);
      }
    }, 460);
  }

  function showConceptBanner(god) {
    const b = $("#concept");
    $("#conceptName").textContent = god.name;
    b.classList.add("show");
  }
  $("#conceptClose").addEventListener("click", function () { $("#concept").classList.remove("show"); });

  function closeOverlay() {
    overlay.classList.remove("show", "balls", "ominous", "hero-on");
    if (window.Services && Services.Ads) Services.Ads.maybeInterstitial(); // §7.2 次画面描画後に表示
  }
  $("#stageClose").addEventListener("click", closeOverlay);
  overlay.addEventListener("click", function (e) {
    if (e.target !== overlay) return;
    if (overlay.classList.contains("balls") && pendingOpen) { pendingOpen(); return; }   // 玉フェーズは開封
    if (overlay.classList.contains("hero-on") && pendingHero) { pendingHero(); return; }  // 大演出は次へ
    closeOverlay();
  });

  // ---------- ボタン ----------
  function doPull(kind) {
    const res = kind === "tera" ? G.pullTera()
      : kind === "giga" ? G.pullGiga()
      : kind === "ultra" ? G.pullUltra()
      : kind === "mega" ? G.pullMega()
      : kind === "multi" ? G.pullMulti()
      : G.pullSingle();
    if (!res.ok) { toast("神石が たりない"); return; }
    playResults(res.results);
  }
  $("#btnSingle").addEventListener("click", function () { doPull("single"); });
  $("#btnMulti").addEventListener("click", function () { doPull("multi"); });
  $("#btnMega").addEventListener("click", function () { doPull("mega"); });
  $("#btnUltra").addEventListener("click", function () { doPull("ultra"); });
  $("#btnGiga").addEventListener("click", function () { doPull("giga"); });
  $("#btnTera").addEventListener("click", function () { doPull("tera"); });

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
    { id: "com.raito.godgacha.gems1200",   gems: 1200,   fallback: "¥160",   tag: "" },
    { id: "com.raito.godgacha.gems7000",   gems: 7000,   fallback: "¥800",   tag: "+17%" },
    { id: "com.raito.godgacha.gems16000",  gems: 16000,  fallback: "¥1,600", tag: "+33% お得" },
    { id: "com.raito.godgacha.gems120000", gems: 120000, fallback: "¥8,000", tag: "+100% 大量" },
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
        cell.addEventListener("click", function () { openGodModal(gd, r, n); });
        grid.appendChild(cell);
      });
      wrap.appendChild(grid);
    });
    const st = G.dexStats();
    $("#dexPct").textContent = "コンプ率 " + st.pct.toFixed(1) + "%（" + st.owned + "/" + st.total + "）";
  }
  function ratePct(r) {
    if (r.id === "XR") return "0.000001%（1/1億）"; // XRは黒玉+潜伏で実効1/1億
    const w = r.weight * 100;
    if (w >= 1) return w.toFixed(1) + "%";
    if (w >= 0.001) return w.toFixed(3) + "%";
    return w.toExponential(0) + "%";
  }

  // ---------- 図鑑：キャラ詳細モーダル（大きく表示＋フレーバー）----------
  const godModal = $("#godModal");
  function openGodModal(god, r, n) {
    if (!godModal) return;
    if (n) {
      godModal.className = "godmodal show r-" + r.id + (r.aurora ? " aurora" : "") + (r.glitch ? " glitch" : "");
      godModal.style.setProperty("--rc", r.color);
      godModal.style.setProperty("--rg", r.glow);
      godModal.innerHTML =
        '<div class="gm-card" role="dialog">' +
          '<div class="gm-badge">' + r.id + " " + r.label + "</div>" +
          (n > 1 ? '<div class="gm-count">×' + n + "</div>" : "") +
          '<div class="gm-art">' + artInner(god) + "</div>" +
          '<div class="gm-name">' + god.name + "</div>" +
          '<div class="gm-yomi">' + god.yomi + " · " + r.tier + "</div>" +
          '<div class="gm-desc">' + god.desc + "</div>" +
          '<button class="gm-close">とじる</button>' +
        "</div>";
    } else {
      godModal.className = "godmodal show locked";
      godModal.innerHTML =
        '<div class="gm-card" role="dialog">' +
          '<div class="gm-art gm-unknown">❔</div>' +
          '<div class="gm-name">？？？</div>' +
          '<div class="gm-desc">まだ発見していない神。ガチャで引き当てよう。</div>' +
          '<button class="gm-close">とじる</button>' +
        "</div>";
    }
  }
  function closeGodModal() { if (godModal) godModal.className = "godmodal"; }
  if (godModal) {
    godModal.addEventListener("click", function (e) {
      if (e.target === godModal || (e.target.classList && e.target.classList.contains("gm-close"))) closeGodModal();
    });
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
