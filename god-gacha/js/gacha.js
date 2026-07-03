/* ============================================================
   gacha.js — 排出ロジック・天井・通貨・図鑑（ゲームの“中身”）
   UIには一切触れない純ロジック層。状態は localStorage に永続化。
   ============================================================ */
(function () {
  "use strict";
  const D = window.GG_DATA;

  // ---- 設定値（バランス調整はここ）---------------------------
  const CFG = {
    // 通貨
    START_GEMS: 1500,          // 初回付与
    COST_SINGLE: 5,            // 単発コスト（神石）
    COST_MULTI: 50,            // 10連コスト（割引なし＝保証が価値）
    MULTI_COUNT: 10,
    MULTI_FLOOR: "SR",         // 10連はSR以上1体確定
    MEGA_COUNT: 100,           // 100連
    COST_MEGA: 450,            // 100連コスト（10%OFF）
    MEGA_FLOOR: "UR",          // 100連はUR以上1体確定
    ULTRA_COUNT: 1000,         // 1000連
    COST_ULTRA: 4000,          // 1000連コスト（20%OFF）
    ULTRA_FLOOR: "LR",         // 1000連はLR以上1体確定
    // 無料回復（プロト用に速め。実機ではゆっくりに調整）
    REGEN_PER: 1,              // 回復量
    REGEN_INTERVAL_MS: 30000,  // 30秒ごと
    REGEN_CAP: 120,            // 自然回復で貯まる上限（課金分は上限なし）
    // 天井（ピティ）
    SOFT_PITY_SSR: 50,         // SSR以上が連続で出ないとき、N連目で確定
    HARD_PITY_UR: 100,         // 天井：UR以上をN連目で確定
    // ダブり還元（既所持を引いたら神石に変換）
    DUP_REFUND: { N:1, R:2, SR:5, SSR:15, UR:40, LR:120, GR:400, XR:100000 },

    // --- ガチャ玉（演出用・最低保証テーザー）---
    // 結果レア度→玉の色。色を見れば最低ランクが分かる（赤=SSR以上, 金=UR以上, 虹=LR以上）。
    BALL_OF: { N:"white", R:"green", SR:"blue", SSR:"red", UR:"gold", LR:"rainbow", GR:"rainbow", XR:"rainbow" },
    // 黒玉：XR入手の主路。出現0.9/100万、中身1%XR/99%N ⇒ 黒玉XR=0.9e-8（XR全体の90%）。
    BLACK_BALL_RATE: 0.9e-6,
    BLACK_XR_CHANCE: 0.01,
    // 潜伏XR：通常玉(白〜虹)のどれにも紛れるXR。合計0.1e-8（XR全体の10%）を6色へ均等。
    // 黒玉XR(0.9e-8)＋潜伏XR(0.1e-8)=1e-8=1/1億 を厳守。
    HIDDEN_XR_RATE: 1e-9,
    HIDDEN_XR_BALLS: ["white", "green", "blue", "red", "gold", "rainbow"],

    // --- ポイントガチャ（連打クリッカー層）---
    // 1タップ=1スピン。GP がランダムに出る。超レアで神石(gems)直ドロップ。
    GP_PER_GEM: 10,            // 交換レート：10 GP = 神石1（=神ガチャ単発の1/5）
    POINT_TABLE: [
      { gp: 1,    w: 0.70,   label: "+1",       color: "#9aa0a6", big: 0 },
      { gp: 3,    w: 0.20,   label: "+3",       color: "#7a8089", big: 0 },
      { gp: 10,   w: 0.07,   label: "+10",      color: "#3ec46d", big: 0 },
      { gp: 50,   w: 0.025,  label: "+50 あたり！",   color: "#3aa0ff", big: 1 },
      { gp: 300,  w: 0.004,  label: "+300 大当たり！", color: "#a96bff", big: 1 },
      { gp: 2000, w: 0.0009, label: "+2000 特大！！",  color: "#ffc23a", big: 2 },
      { gems: 300, w: 0.0001, label: "💎+300 神石ジャックポット！！", color: "#ff5e9a", big: 3, rainbow: true },
    ], // w総和 = 1.0
  };

  const SAVE_KEY = "gg_save_v1";

  // ---- 状態 --------------------------------------------------
  let S = load();

  function freshState() {
    return {
      gems: CFG.START_GEMS,
      gp: 0,                   // ガチャポイント（ポイントガチャで稼ぐ）
      totalSpins: 0,           // ポイントガチャ累計タップ
      lastRegen: 0,            // 後で now() で初期化
      sinceSSR: 0,            // SSR以上が出てからのハズレ連続数
      sinceUR: 0,            // UR以上が出てからのハズレ連続数
      totalPulls: 0,
      dex: {},               // godId -> 所持数
      best: -1,              // これまでの最高 rank
      log: [],               // 直近の排出履歴（id, rarity, t）
      spentGems: 0,
    };
  }

  function load() {
    let s;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { s = null; }
    if (!s || typeof s.gems !== "number") s = freshState();
    if (typeof s.gp !== "number") s.gp = 0;
    if (typeof s.totalSpins !== "number") s.totalSpins = 0;
    if (!s.lastRegen) s.lastRegen = now();
    if (!s.dex) s.dex = {};
    if (!s.log) s.log = [];
    return s;
  }
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
  function now() { return Date.now(); }

  // ---- 無料回復 ---------------------------------------------
  // 経過時間ぶんの神石を回復（上限 REGEN_CAP まで。課金で超過した分は減らさない）。
  function tickRegen() {
    const t = now();
    const elapsed = t - S.lastRegen;
    if (elapsed < CFG.REGEN_INTERVAL_MS) return;
    const steps = Math.floor(elapsed / CFG.REGEN_INTERVAL_MS);
    S.lastRegen += steps * CFG.REGEN_INTERVAL_MS;
    if (S.gems < CFG.REGEN_CAP) {
      S.gems = Math.min(CFG.REGEN_CAP, S.gems + steps * CFG.REGEN_PER);
    }
    save();
  }
  // 次の回復までの残りms
  function msToNextRegen() {
    if (S.gems >= CFG.REGEN_CAP) return null; // 上限なら回復停止
    return Math.max(0, CFG.REGEN_INTERVAL_MS - (now() - S.lastRegen));
  }

  // ---- 加重乱数（素の確率で1レア度を選ぶ）-------------------
  function rollRarityNatural() {
    const r = Math.random();          // [0,1)
    let acc = 0;
    // rank 降順に積むと XR/GR の極小確率が浮動小数で潰れにくい
    for (let i = D.RARITIES.length - 1; i >= 0; i--) {
      acc += D.RARITIES[i].weight;
    }
    // 上の acc は ~1.0。ここからは通常の累積で判定（rank 昇順）。
    acc = 0;
    for (let i = 0; i < D.RARITIES.length; i++) {
      acc += D.RARITIES[i].weight;
      if (r < acc) return D.RARITIES[i];
    }
    return D.RARITIES[0]; // 端数フォールバック=N
  }

  // floorRank 以上の中から weight 比で1レア度を選ぶ（天井・保証用）
  function rollRarityAtLeast(floorRank) {
    const pool = D.RARITIES.filter(function (r) { return r.rank >= floorRank; });
    let total = 0; pool.forEach(function (r) { total += r.weight; });
    let x = Math.random() * total, acc = 0;
    for (let i = 0; i < pool.length; i++) {
      acc += pool[i].weight;
      if (x < acc) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function pickGod(rarityId) {
    const arr = D.POOL[rarityId];
    return arr[(Math.random() * arr.length) | 0];
  }

  // ---- 1回の排出（pity 計算込み）-----------------------------
  // opts.guaranteeMinRank: この rank 以上を保証（10連の最終保証などで使用）
  function drawOne(opts) {
    opts = opts || {};

    // 黒玉（最優先・XRの唯一路）。1/100万で出現、99%N/1%XR。
    if (Math.random() < CFG.BLACK_BALL_RATE) {
      const isXR = Math.random() < CFG.BLACK_XR_CHANCE;
      const brar = isXR ? D.BY_ID.XR : D.BY_ID.N;
      if (brar.rank >= D.BY_ID.SSR.rank) S.sinceSSR = 0; else S.sinceSSR++;
      if (brar.rank >= D.BY_ID.UR.rank)  S.sinceUR = 0;  else S.sinceUR++;
      const bgod = pickGod(brar.id);
      const bhad = S.dex[bgod.id] || 0; const bnew = bhad === 0; S.dex[bgod.id] = bhad + 1;
      let brefund = 0; if (!bnew) { brefund = CFG.DUP_REFUND[brar.id] || 0; S.gems += brefund; }
      S.totalPulls++; if (brar.rank > S.best) S.best = brar.rank;
      S.log.unshift({ id: bgod.id, r: brar.id, t: now() }); if (S.log.length > 200) S.log.length = 200;
      return { god: bgod, rarity: brar, isNew: bnew, refund: brefund, pitied: false, ball: "black" };
    }

    // 潜伏XR：通常玉(白〜虹)のどれかに紛れるXR（XRの10%）。玉色はランダムで“じつはXR”のサプライズ。
    if (Math.random() < CFG.HIDDEN_XR_RATE) {
      const xrar = D.BY_ID.XR;
      S.sinceSSR = 0; S.sinceUR = 0; // XRはSSR/UR以上→天井カウンタをリセット
      const xgod = pickGod("XR");
      const xhad = S.dex[xgod.id] || 0; const xnew = xhad === 0; S.dex[xgod.id] = xhad + 1;
      let xrefund = 0; if (!xnew) { xrefund = CFG.DUP_REFUND.XR || 0; S.gems += xrefund; }
      S.totalPulls++; if (xrar.rank > S.best) S.best = xrar.rank;
      S.log.unshift({ id: xgod.id, r: "XR", t: now() }); if (S.log.length > 200) S.log.length = 200;
      const ballc = CFG.HIDDEN_XR_BALLS[(Math.random() * CFG.HIDDEN_XR_BALLS.length) | 0];
      return { god: xgod, rarity: xrar, isNew: xnew, refund: xrefund, pitied: false, ball: ballc };
    }

    // 天井による下限 rank を決定
    let floorRank = -1;
    if (S.sinceUR + 1 >= CFG.HARD_PITY_UR)  floorRank = Math.max(floorRank, D.BY_ID.UR.rank);
    else if (S.sinceSSR + 1 >= CFG.SOFT_PITY_SSR) floorRank = Math.max(floorRank, D.BY_ID.SSR.rank);
    if (typeof opts.guaranteeMinRank === "number") floorRank = Math.max(floorRank, opts.guaranteeMinRank);

    let rar = rollRarityNatural();
    let pitied = false;
    if (floorRank >= 0 && rar.rank < floorRank) {
      rar = rollRarityAtLeast(floorRank); // 下限以上を引き直し（GR/XR の一発も残す）
      pitied = true;
    }

    // カウンタ更新
    if (rar.rank >= D.BY_ID.SSR.rank) S.sinceSSR = 0; else S.sinceSSR++;
    if (rar.rank >= D.BY_ID.UR.rank)  S.sinceUR = 0;  else S.sinceUR++;

    const god = pickGod(rar.id);

    // 図鑑＆ダブり判定
    const had = S.dex[god.id] || 0;
    const isNew = had === 0;
    S.dex[god.id] = had + 1;
    let refund = 0;
    if (!isNew) { refund = CFG.DUP_REFUND[rar.id] || 0; S.gems += refund; }

    S.totalPulls++;
    if (rar.rank > S.best) S.best = rar.rank;
    S.log.unshift({ id: god.id, r: rar.id, t: now() });
    if (S.log.length > 200) S.log.length = 200;

    return { god: god, rarity: rar, isNew: isNew, refund: refund, pitied: pitied, ball: CFG.BALL_OF[rar.id] || "white" };
  }

  // ---- 課金/消費 ---------------------------------------------
  function canAfford(cost) { return S.gems >= cost; }
  function spend(cost) { S.gems -= cost; S.spentGems += cost; }

  // 単発
  function pullSingle() {
    tickRegen();
    if (!canAfford(CFG.COST_SINGLE)) return { ok: false, reason: "gems" };
    spend(CFG.COST_SINGLE);
    const res = [drawOne()];
    save();
    return { ok: true, results: res };
  }

  // まとめ引き。10連ブロックごとに SR 以上を1体保証（10連と同じ）。
  // さらに全体の最後の枠で headlineFloor（例：100連ならUR以上）を保証。
  function pullBatch(count, cost, headlineFloor) {
    tickRegen();
    if (!canAfford(cost)) return { ok: false, reason: "gems" };
    spend(cost);
    const out = [];
    const srRank = D.BY_ID[CFG.MULTI_FLOOR].rank;
    let maxRank = -1, blockMax = -1;
    for (let i = 0; i < count; i++) {
      const pos = i % CFG.MULTI_COUNT;
      if (pos === 0) blockMax = -1;
      const lastInBlock = pos === CFG.MULTI_COUNT - 1;
      let floor = -1;
      if (lastInBlock && blockMax < srRank) floor = srRank;      // 各10連でSR以上確定
      if (i === count - 1 && headlineFloor) {                    // 全体の目玉保証
        const hr = D.BY_ID[headlineFloor].rank;
        if (maxRank < hr) floor = Math.max(floor, hr);
      }
      const r = drawOne(floor >= 0 ? { guaranteeMinRank: floor } : undefined);
      maxRank = Math.max(maxRank, r.rarity.rank);
      blockMax = Math.max(blockMax, r.rarity.rank);
      out.push(r);
    }
    save();
    return { ok: true, results: out };
  }

  // 10連（SR以上1体確定）
  function pullMulti() { return pullBatch(CFG.MULTI_COUNT, CFG.COST_MULTI, null); }
  // 100連（UR以上1体確定）
  function pullMega()  { return pullBatch(CFG.MEGA_COUNT,  CFG.COST_MEGA,  CFG.MEGA_FLOOR); }
  // 1000連（LR以上1体確定）
  function pullUltra() { return pullBatch(CFG.ULTRA_COUNT, CFG.COST_ULTRA, CFG.ULTRA_FLOOR); }

  // 課金（神石パック）。Web=擬似付与。ネイティブ消費型IAPはあとで iap.js に接続。
  function addGems(n) { S.gems += n; save(); }

  // ---- ポイントガチャ（連打クリッカー）----------------------
  // 1タップ=1スピン。連打前提なので save() はしない（呼び出し側が間引いて保存）。
  let _dirty = false;
  function spinPoint() {
    const t = CFG.POINT_TABLE;
    const x = Math.random(); let acc = 0, hit = t[t.length - 1];
    for (let i = 0; i < t.length; i++) { acc += t[i].w; if (x < acc) { hit = t[i]; break; } }
    const gp = hit.gp || 0, gems = hit.gems || 0;
    S.gp += gp; if (gems) S.gems += gems;
    S.totalSpins++;
    _dirty = true;
    return { gp: gp, gems: gems, tier: hit };
  }
  // 連打中の保存間引き：1秒ループから呼ぶ
  function flush() { if (_dirty) { _dirty = false; save(); } }

  // GP → 神石 交換。gemUnits=欲しい神石数。
  function exchangeGP(gemUnits) {
    const costGP = gemUnits * CFG.GP_PER_GEM;
    if (gemUnits <= 0 || S.gp < costGP) return { ok: false };
    S.gp -= costGP; S.gems += gemUnits; save();
    return { ok: true, gems: gemUnits, gp: costGP };
  }
  function exchangeMax() { return exchangeGP(Math.floor(S.gp / CFG.GP_PER_GEM)); }
  function gp() { return S.gp; }

  // ---- 図鑑/統計 --------------------------------------------
  function dexStats() {
    const total = D.GODS.length;
    let owned = 0;
    D.GODS.forEach(function (gd) { if (S.dex[gd.id]) owned++; });
    return { owned: owned, total: total, pct: total ? (owned / total * 100) : 0 };
  }
  function ownedCount(godId) { return S.dex[godId] || 0; }

  // 天井までの残り
  function pityInfo() {
    return {
      toSSR: Math.max(0, CFG.SOFT_PITY_SSR - S.sinceSSR),
      toUR:  Math.max(0, CFG.HARD_PITY_UR - S.sinceUR),
      sinceSSR: S.sinceSSR, sinceUR: S.sinceUR,
    };
  }

  function devReset() { S = freshState(); save(); }

  window.Gacha = {
    CFG: CFG,
    state: function () { return S; },
    gems: function () { return S.gems; },
    gp: gp,
    totalSpins: function () { return S.totalSpins; },
    spinPoint: spinPoint,
    flush: flush,
    exchangeGP: exchangeGP,
    exchangeMax: exchangeMax,
    totalPulls: function () { return S.totalPulls; },
    bestRank: function () { return S.best; },
    tickRegen: tickRegen,
    msToNextRegen: msToNextRegen,
    pullSingle: pullSingle,
    pullMulti: pullMulti,
    pullMega: pullMega,
    pullUltra: pullUltra,
    addGems: addGems,
    canAfford: canAfford,
    dexStats: dexStats,
    ownedCount: ownedCount,
    pityInfo: pityInfo,
    save: save,
    devReset: devReset,
  };
})();
