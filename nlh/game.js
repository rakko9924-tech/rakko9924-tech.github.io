/* game.js — ヘッズアップ NLH のゲームエンジンとUI制御
   1台のiPhoneを2人で挟んで対面プレイ（正面通し）する。
   ・各プレイヤーの手番では、まず「プライバシーゲート」を表示して覗き見を防ぐ。
   ・相手側（席2）の画面は180°回転して表示できる。 */

(function () {
  const P = window.Poker;
  const $ = (sel) => document.querySelector(sel);

  // ---- 設定の保存（端末内のみ） ----
  const SETTINGS_KEY = 'nlh_settings_v2';
  const defaultSettings = {
    names: ['プレイヤー1', 'プレイヤー2'],
    startStack: 20000,   // 100BB（@ BB200）
    smallBlind: 100,
    bigBlind: 200,
    ante: 200,           // BBアンティ（BBプレイヤーが支払う）
    rotateP2: true,      // 席2の画面を180°回転
    // 課金で解放される設定（解放されていない間は既定値に固定）
    bbDisplay: false,    // 金額をBB表示
    anteOff: false,      // アンティ無し
    tournament: false,   // トーナメントモード（ブラインド上昇）
  };
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return Object.assign({}, defaultSettings, s || {});
    } catch (e) {
      return Object.assign({}, defaultSettings);
    }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
  let settings = loadSettings();

  // ---- 課金（端末内に解放状態を保存）----
  // 注: PWA版では実決済(StoreKit等)は接続できないため、購入＝端末内で解放する雛形。
  //     実アプリ化の際にここを各ストアの課金APIに差し替える。
  const UNLOCK_KEY = 'nlh_unlocks_v1';
  const PRODUCTS = {
    bb_display: { name: 'BB表示', price: 500, desc: 'スタックやポットをBB（ビッグブラインド）単位で表示' },
    edit_stack: { name: '初期スタック編集', price: 500, desc: '開始時のチップ量を自由に設定' },
    tournament: { name: 'トーナメントモード', price: 1000, desc: 'ハンドが進むごとにブラインド／アンティが上昇' },
    no_ante: { name: 'ante無しモード', price: 300, desc: 'アンティ無し（100-200のみ）で対戦' },
  };
  const BUNDLE_PRICE = 1500;
  function loadUnlocks() {
    try { return Object.assign({}, JSON.parse(localStorage.getItem(UNLOCK_KEY)) || {}); }
    catch (e) { return {}; }
  }
  let unlocks = loadUnlocks();
  function isUnlocked(key) { return !!unlocks[key]; }
  function allUnlocked() { return Object.keys(PRODUCTS).every((k) => isUnlocked(k)); }
  function purchase(key) { unlocks[key] = true; localStorage.setItem(UNLOCK_KEY, JSON.stringify(unlocks)); }
  function purchaseBundle() { Object.keys(PRODUCTS).forEach((k) => { unlocks[k] = true; }); localStorage.setItem(UNLOCK_KEY, JSON.stringify(unlocks)); }
  const yen = (n) => '¥' + n.toLocaleString('en-US');

  // ---- 現在のブラインド／アンティ（トーナメントなら上昇） ----
  // トーナメントのブラインド表（SB, BB, ante）。一定ハンドごとにレベルが上がる。
  const TOURNEY_LEVELS = [
    { sb: 100, bb: 200, ante: 200 },
    { sb: 150, bb: 300, ante: 300 },
    { sb: 200, bb: 400, ante: 400 },
    { sb: 300, bb: 600, ante: 600 },
    { sb: 500, bb: 1000, ante: 1000 },
    { sb: 800, bb: 1600, ante: 1600 },
    { sb: 1200, bb: 2400, ante: 2400 },
    { sb: 2000, bb: 4000, ante: 4000 },
    { sb: 3000, bb: 6000, ante: 6000 },
    { sb: 5000, bb: 10000, ante: 10000 },
  ];
  const HANDS_PER_LEVEL = 8;
  function tourneyLevel() {
    const lv = Math.floor(((G ? G.handNo : 1) - 1) / HANDS_PER_LEVEL);
    return Math.max(0, Math.min(TOURNEY_LEVELS.length - 1, lv));
  }
  function currentBlinds() {
    if (settings.tournament && isUnlocked('tournament')) {
      return TOURNEY_LEVELS[tourneyLevel()];
    }
    const ante = (settings.anteOff && isUnlocked('no_ante')) ? 0 : settings.ante;
    return { sb: settings.smallBlind, bb: settings.bigBlind, ante };
  }

  // 現在のブラインド表示（トーナメントならレベルと次レベルまでのハンド数も）。
  function blindsLabel() {
    const b = (H && H.blinds) ? H.blinds : currentBlinds();
    const ante = b.ante > 0 ? ` (ante ${b.ante.toLocaleString('en-US')})` : '';
    let base = `${b.sb.toLocaleString('en-US')}-${b.bb.toLocaleString('en-US')}${ante}`;
    if (settings.tournament && isUnlocked('tournament')) {
      const lv = tourneyLevel();
      const handsLeft = HANDS_PER_LEVEL - (((G ? G.handNo : 1) - 1) % HANDS_PER_LEVEL);
      const next = lv < TOURNEY_LEVELS.length - 1 ? `・あと${handsLeft}ハンドで上昇` : '・最終レベル';
      base = `🏆Lv.${lv + 1}　${base}${next}`;
    }
    return base;
  }

  // 金額の表示整形（BB表示が解放＆ONなら BB 単位）。
  function fmt(n) {
    if (settings.bbDisplay && isUnlocked('bb_display')) {
      const bb = currentBlinds().bb || 1;
      const v = Math.round((n / bb) * 10) / 10;
      return v + 'BB';
    }
    return n.toLocaleString('en-US');
  }

  // ---- ゲーム状態 ----
  let G = null; // 試合全体（スタック等）
  let H = null; // 1ハンドの状態

  function newMatch() {
    G = {
      stacks: [settings.startStack, settings.startStack],
      button: 0, // ボタン（＝ヘッズアップではSB）
      handNo: 0,
    };
  }

  function startHand() {
    if (G.stacks[0] <= 0 || G.stacks[1] <= 0) {
      showGameOver();
      return;
    }
    G.handNo++;
    const deck = P.shuffle(P.makeDeck());
    const sb = G.button; // ヘッズアップではボタンがSB、先にアクション（プリフロップ）
    const bb = 1 - sb;
    const blinds = currentBlinds();

    H = {
      deck,
      holes: [[deck.pop(), deck.pop()], [deck.pop(), deck.pop()]],
      board: [],
      street: 'preflop', // preflop|flop|turn|river|showdown
      pot: 0,
      bet: [0, 0], // このストリートで投入した額
      committed: [0, 0], // このハンドで投入した総額（アンティ等のデッドマネーは含めない）
      sb, bb,
      blinds,
      toAct: sb, // プリフロップはSB(ボタン)から
      lastRaiseSize: blinds.bb,
      lastAggressor: bb, // プリフロップのBBはオプションを持つ
      actedSinceRaise: new Set(),
      folded: [false, false],
      allIn: [false, false],
      finished: false,
      log: [],
    };

    // アンティ（BBアンティ：BBプレイヤーがポットに支払う。ベット額には含めない＝デッドマネー）
    if (blinds.ante > 0) postAnte(bb, blinds.ante);
    // ブラインド投入
    postBlind(sb, blinds.sb);
    postBlind(bb, blinds.bb);
    H.lastRaiseSize = blinds.bb;
    const anteMsg = blinds.ante > 0 ? `、アンティ ${blinds.ante}` : '';
    pushLog(`#${G.handNo} 開始。${settings.names[sb]} がSB ${blinds.sb}、${settings.names[bb]} がBB ${blinds.bb}${anteMsg} を投入。`);

    // プリフロップ。SBがコールしてもBBにオプションがあるので actedSinceRaise はBBを未行動扱い。
    H.actedSinceRaise = new Set();
    renderAction();
  }

  function postBlind(i, amount) {
    const pay = Math.min(amount, G.stacks[i]);
    G.stacks[i] -= pay;
    H.bet[i] += pay;
    H.committed[i] += pay;
    H.pot += pay;
    if (G.stacks[i] === 0) H.allIn[i] = true;
  }

  // アンティはポットに入るがベット額・committed には含めない（未コール返金の対象外）。
  function postAnte(i, amount) {
    const pay = Math.min(amount, G.stacks[i]);
    G.stacks[i] -= pay;
    H.pot += pay;
    if (G.stacks[i] === 0) H.allIn[i] = true;
  }

  function pushLog(msg) {
    H.log.unshift(msg);
    if (H.log.length > 40) H.log.pop();
  }

  // ---- アクション ----
  function currentToCall(i) {
    return Math.max(0, H.bet[1 - i] - H.bet[i]);
  }

  function roundClosed() {
    // ベッティングラウンドが終了したか判定する。
    const live = [0, 1].filter((i) => !H.folded[i]);
    if (live.length < 2) return true; // 片方フォールド
    const nonAllIn = live.filter((i) => !H.allIn[i]);
    if (nonAllIn.length === 0) return true; // 全員オールイン
    if (nonAllIn.length === 1) {
      // 行動できるのは1人だけ（相手はオールイン）。その1人が額を満たし行動済みなら終了。
      const i = nonAllIn[0];
      return H.bet[i] >= H.bet[1 - i] && H.actedSinceRaise.has(i);
    }
    // 2人とも行動可能：ベット額が揃い、両者がレイズ以降に行動済みか
    const betsEqual = H.bet[0] === H.bet[1];
    return betsEqual && live.every((i) => H.actedSinceRaise.has(i) || H.allIn[i]);
  }

  function act(type, amount) {
    const i = H.toAct;
    if (H.finished) return;
    const toCall = currentToCall(i);

    if (type === 'fold') {
      H.folded[i] = true;
      pushLog(`${settings.names[i]} がフォールド。`);
      endHandByFold(1 - i);
      return;
    }

    if (type === 'check') {
      if (toCall !== 0) return; // 不正
      pushLog(`${settings.names[i]} がチェック。`);
      H.actedSinceRaise.add(i);
    }

    if (type === 'call') {
      const pay = Math.min(toCall, G.stacks[i]);
      G.stacks[i] -= pay;
      H.bet[i] += pay;
      H.committed[i] += pay;
      H.pot += pay;
      if (G.stacks[i] === 0) H.allIn[i] = true;
      pushLog(`${settings.names[i]} がコール (${pay})。`);
      H.actedSinceRaise.add(i);
    }

    if (type === 'raise' || type === 'bet' || type === 'allin') {
      // amount = このストリートでの「合計ベット額」（bet[i] を含む目標値）
      let target = amount;
      const maxTarget = H.bet[i] + G.stacks[i];
      if (type === 'allin') target = maxTarget;
      target = Math.min(target, maxTarget);
      const add = target - H.bet[i];
      G.stacks[i] -= add;
      H.bet[i] = target;
      H.committed[i] += add;
      H.pot += add;
      const raiseSize = target - H.bet[1 - i];
      if (raiseSize > 0) H.lastRaiseSize = Math.max(H.lastRaiseSize, raiseSize);
      if (G.stacks[i] === 0) H.allIn[i] = true;
      const word = toCall === 0 ? 'ベット' : 'レイズ';
      pushLog(`${settings.names[i]} が${word} ${target}${H.allIn[i] ? ' (オールイン)' : ''}。`);
      // レイズが入ったので相手は再び行動が必要
      H.actedSinceRaise = new Set([i]);
    }

    // 次へ
    advance();
  }

  function endHandByFold(winner) {
    H.finished = true;
    G.stacks[winner] += H.pot;
    pushLog(`${settings.names[winner]} が ${H.pot} を獲得（相手フォールド）。`);
    H.result = { type: 'fold', winner, pot: H.pot };
    H.street = 'showdown';
    renderResult();
  }

  function advance() {
    if (roundClosed()) {
      goNextStreet();
      return;
    }
    // 相手の番へ。相手が行動不能（フォールド/オールイン）ならラウンド終了扱い。
    const next = 1 - H.toAct;
    if (H.folded[next] || H.allIn[next]) {
      goNextStreet();
      return;
    }
    H.toAct = next;
    renderAction();
  }

  function dealBoard(n) {
    for (let k = 0; k < n; k++) H.board.push(H.deck.pop());
  }

  function resetStreetBets() {
    H.bet = [0, 0];
    H.actedSinceRaise = new Set();
    H.lastRaiseSize = H.blinds.bb;
    // ポストフロップはBB(=非ボタン)から
    H.toAct = H.bb;
    // 行動不能な側はスキップ
  }

  function someoneAllIn() {
    return (H.allIn[0] || H.allIn[1]);
  }

  function goNextStreet() {
    // 全員オールイン or 片方オールインでコール済み → 残りのボードを配って決着
    const needRunout = someoneAllIn();

    if (needRunout) {
      // 残りカードを全部配ってショーダウン
      while (H.board.length < 5) {
        if (H.board.length === 0) dealBoard(3);
        else dealBoard(1);
      }
      H.street = 'showdown';
      doShowdown();
      return;
    }

    if (H.street === 'preflop') {
      H.street = 'flop';
      dealBoard(3);
      resetStreetBets();
      maybeSkipOrGate();
    } else if (H.street === 'flop') {
      H.street = 'turn';
      dealBoard(1);
      resetStreetBets();
      maybeSkipOrGate();
    } else if (H.street === 'turn') {
      H.street = 'river';
      dealBoard(1);
      resetStreetBets();
      maybeSkipOrGate();
    } else if (H.street === 'river') {
      H.street = 'showdown';
      doShowdown();
    }
  }

  function maybeSkipOrGate() {
    pushLog(`--- ${streetLabel(H.street)} ---`);
    renderAction();
  }

  function doShowdown() {
    H.finished = true;
    // 未コールのベット（オーバーベット分）は多く出した側へ払い戻す。
    const diff = H.committed[0] - H.committed[1];
    if (diff > 0) { G.stacks[0] += diff; H.pot -= diff; H.committed[0] -= diff; pushLog(`未コール分 ${diff} を ${settings.names[0]} に返却。`); }
    else if (diff < 0) { G.stacks[1] += -diff; H.pot -= -diff; H.committed[1] -= -diff; pushLog(`未コール分 ${-diff} を ${settings.names[1]} に返却。`); }

    const e0 = P.evaluate7([...H.holes[0], ...H.board]);
    const e1 = P.evaluate7([...H.holes[1], ...H.board]);
    const c = P.cmpScore(e0.score, e1.score);
    let winner;
    if (c > 0) winner = 0;
    else if (c < 0) winner = 1;
    else winner = -1; // 引き分け

    if (winner === -1) {
      const half = Math.floor(H.pot / 2);
      G.stacks[0] += half;
      G.stacks[1] += H.pot - half;
      pushLog(`引き分け（スプリットポット）。`);
    } else {
      G.stacks[winner] += H.pot;
      pushLog(`${settings.names[winner]} が ${H.pot} を獲得（${winner === 0 ? e0.name : e1.name}）。`);
    }
    H.result = { type: 'showdown', winner, pot: H.pot, e0, e1 };
    renderResult();
  }

  // ---- 表示ヘルパ ----
  function streetLabel(s) {
    return { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: 'ショーダウン' }[s];
  }

  function cardHTML(c, faceUp) {
    if (!faceUp) return `<div class="card back"></div>`;
    const color = P.SUIT_COLOR[c.s];
    return `<div class="card ${color}"><span class="r">${P.RANK_LABEL[c.r]}</span><span class="s">${P.SUIT_SYMBOL[c.s]}</span></div>`;
  }

  // ---- 画面：アクション（固定・縦対称テーブル） ----
  // プレイヤー0=下、プレイヤー1=上で常に固定。コミュニティカードは上下中央に置く。
  function renderAction() {
    const actor = H.toAct;
    const opp = 1 - actor;
    const toCall = currentToCall(actor);

    const board = [0, 1, 2, 3, 4].map((k) =>
      H.board[k] ? cardHTML(H.board[k], true) : `<div class="card placeholder"></div>`
    ).join('');

    const minRaiseTarget = H.bet[opp] + Math.max(H.lastRaiseSize, H.blinds.bb);
    const maxTarget = H.bet[actor] + G.stacks[actor];

    const faceDown = `${cardHTML(null, false)}${cardHTML(null, false)}`;

    const initVal = Math.min(minRaiseTarget, maxTarget);

    // 各プレイヤーのアクション列（両者ぶん常に表示し、手番でない側は無効化）。
    // 手番側のレイズUIは席内（＝自分側の半分）にインライン展開する（GGPoker風）。
    const seatActions = (p) => {
      const isActor = (p === actor);
      const tc = Math.max(0, H.bet[1 - p] - H.bet[p]);
      const cr = G.stacks[p] > tc && !H.allIn[1 - p];
      const rw = tc === 0 ? 'ベット' : 'レイズ';
      const dis = isActor ? '' : 'disabled';
      const callOrCheck = tc > 0
        ? `<button class="btn call" data-act="call" ${dis}>コール<span class="amt">${fmt(Math.min(tc, G.stacks[p]))}</span></button>`
        : `<button class="btn check" data-act="check" ${dis}>チェック</button>`;
      const buttons = `<div class="actions ${isActor ? 'live' : 'dim'}">
          <button class="btn fold" data-act="fold" ${dis}>フォールド</button>
          ${callOrCheck}
          ${cr ? `<button class="btn raise" ${isActor ? 'id="openRaise"' : ''} ${dis}>${rw}</button>` : ''}
          <button class="btn allin" data-act="allin" ${dis}>オールイン</button>
        </div>`;
      // レイズ用インラインパネル（手番側のみ）。スライダー＋サイズボタン＋確定。
      const betui = (isActor && cr) ? `
        <div class="betui" data-min="${initVal}" data-max="${maxTarget}" data-step="${H.blinds.sb}">
          <div class="bet-head"><span class="bet-label">${rw}額（合計）</span><b class="bet-val">${fmt(initVal)}</b></div>
          <div class="bet-presets">
            <button class="chip" data-frac="min">最小</button>
            <button class="chip" data-frac="0.5">½</button>
            <button class="chip" data-frac="0.75">¾</button>
            <button class="chip" data-frac="1">ポット</button>
            <button class="chip" data-frac="max">オールイン</button>
          </div>
          <div class="bet-slider-row">
            <button class="step" data-step="-1">−</button>
            <input type="range" class="bet-range" min="${initVal}" max="${maxTarget}" step="${H.blinds.sb}" value="${initVal}">
            <button class="step" data-step="1">＋</button>
          </div>
          <div class="bet-confirm-row">
            <button class="btn betcancel" data-betcancel>✕ 戻る</button>
            <button class="btn primary betconfirm" data-betconfirm>${rw} <b class="bet-val">${fmt(initVal)}</b></button>
          </div>
        </div>` : '';
      return `<div class="action-col">${buttons}${betui}</div>`;
    };

    // 1プレイヤー分の席：左に情報＋手札、右にアクション列。
    const seatHTML = (p) => {
      const isActor = (p === actor);
      const rot = (p === 1 && settings.rotateP2) ? 'rot180' : '';
      const betNow = H.bet[p] > 0 ? `<span class="bet-chip">ベット ${fmt(H.bet[p])}</span>` : '';
      const tag = `<div class="player-tag ${isActor ? 'me' : ''}">${settings.names[p]} ${p === H.button ? '🔘' : ''} ・ スタック ${fmt(G.stacks[p])} ${betNow}</div>`;
      const peekBlock = `
        <div class="peek" data-player="${p}">
          <div class="hole big">${faceDown}</div>
          <div class="peek-hint">長押しで手札を確認</div>
          <div class="peek-eval myhand" style="visibility:hidden">&nbsp;</div>
        </div>`;
      return `<div class="seat seat-${p} ${rot} ${isActor ? 'actor' : 'idle'}">
          <div class="seat-main">${tag}${peekBlock}</div>
          ${seatActions(p)}
        </div>`;
    };

    $('#app').innerHTML = `
      <div class="table2">
        ${seatHTML(1)}
        <div class="center">
          <div class="blinds-line">${blindsLabel()}</div>
          <div class="pot">POT <b>${fmt(H.pot)}</b></div>
          <div class="board">${board}</div>
          <div class="street">${streetLabel(H.street)} ・ ${settings.names[actor]} の番</div>
        </div>
        ${seatHTML(0)}
      </div>`;

    // 各プレイヤーの手札を長押し（＝トランプを捲る）で確認。指を離すと自動で伏せる。
    // 両席とも自分の手札はいつでも確認できる（左手で隠しながら右手で長押し）。
    document.querySelectorAll('.peek').forEach((peek) => {
      const p = parseInt(peek.dataset.player, 10);
      const holeEl = peek.querySelector('.hole');
      const hintEl = peek.querySelector('.peek-hint');
      const evalEl = peek.querySelector('.peek-eval');
      const up = `${cardHTML(H.holes[p][0], true)}${cardHTML(H.holes[p][1], true)}`;
      const down = `${cardHTML(null, false)}${cardHTML(null, false)}`;
      const evName = H.board.length >= 3 ? P.evaluate7([...H.holes[p], ...H.board]).name : '';
      const reveal = () => {
        holeEl.innerHTML = up;
        peek.classList.add('peeking');
        hintEl.textContent = '指を離すと伏せます';
        if (evName) { evalEl.textContent = evName; evalEl.style.visibility = 'visible'; }
      };
      const hide = () => {
        holeEl.innerHTML = down;
        peek.classList.remove('peeking');
        hintEl.textContent = '長押しで手札を確認';
        evalEl.style.visibility = 'hidden';
      };
      const onDown = (e) => { e.preventDefault(); reveal(); };
      const onUp = (e) => { e.preventDefault(); hide(); };
      // Pointer Events（iOS Safari / Chrome 対応）。保険でタッチ/マウスも併用。
      peek.addEventListener('pointerdown', onDown);
      peek.addEventListener('pointerup', onUp);
      peek.addEventListener('pointerleave', onUp);
      peek.addEventListener('pointercancel', onUp);
      peek.addEventListener('touchstart', onDown, { passive: false });
      peek.addEventListener('touchend', onUp);
      peek.addEventListener('touchcancel', onUp);
      peek.addEventListener('mousedown', onDown);
      peek.addEventListener('mouseup', onUp);
      peek.addEventListener('mouseleave', onUp);
      peek.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // レイズ用インラインパネル（自分側の席内で完結）。先に配線して all-in からも使えるようにする。
    const openRaiseBtn = $('#openRaise');
    let openRaising = null; // () => レイズUIをMAXで開く（all-in 用）
    if (openRaiseBtn) {
      const seat = openRaiseBtn.closest('.seat');
      const betui = seat.querySelector('.betui');
      const range = betui.querySelector('.bet-range');
      const min = parseInt(betui.dataset.min, 10);
      const max = parseInt(betui.dataset.max, 10);
      const step = parseInt(betui.dataset.step, 10);
      const incr = H.blinds.bb; // ＋／− はBB単位で調整
      const valEls = betui.querySelectorAll('.bet-val');
      const chips = betui.querySelectorAll('.chip');

      const setVal = (v) => {
        v = Math.round(v / step) * step;
        v = Math.max(min, Math.min(max, v));
        range.value = v;
        valEls.forEach((e) => { e.textContent = fmt(v); });
        // どのプリセットに一致するか軽くハイライト
        chips.forEach((ch) => {
          const t = presetTarget(ch.dataset.frac);
          ch.classList.toggle('active', t === v);
        });
      };
      const presetTarget = (frac) => {
        if (frac === 'min') return min;
        if (frac === 'max') return max;
        const potAfterCall = H.pot + toCall;
        const t = H.bet[opp] + Math.round(potAfterCall * parseFloat(frac));
        return Math.max(min, Math.min(max, Math.round(t / step) * step));
      };
      const openPanel = (v) => { seat.classList.add('raising'); setVal(v); };

      openRaiseBtn.onclick = () => openPanel(parseInt(range.value, 10));
      openRaising = () => openPanel(max);
      betui.querySelector('[data-betcancel]').onclick = () => seat.classList.remove('raising');
      betui.querySelector('[data-betconfirm]').onclick = () =>
        act(toCall === 0 ? 'bet' : 'raise', parseInt(range.value, 10));
      range.oninput = () => setVal(parseInt(range.value, 10));
      betui.querySelectorAll('.step').forEach((s) => {
        s.onclick = () => setVal(parseInt(range.value, 10) + parseInt(s.dataset.step, 10) * incr);
      });
      chips.forEach((ch) => { ch.onclick = () => setVal(presetTarget(ch.dataset.frac)); });
    }

    // アクションボタン（手番側 .live のみ有効）
    document.querySelectorAll('.actions.live [data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.getAttribute('data-act');
        if (a === 'allin') {
          // レイズ可能ならレイズUIをMAXで開いて確定させる（中央モーダルを使わず自分側で確認）。
          if (openRaising) openRaising();
          else act('allin');
        } else {
          act(a);
        }
      };
    });
  }

  // ---- 画面：結果（ショーダウン/フォールド） ----
  function renderResult() {
    const r = H.result;
    const board = [0, 1, 2, 3, 4].map((k) =>
      H.board[k] ? cardHTML(H.board[k], true) : `<div class="card placeholder"></div>`
    ).join('');

    let p0Cards, p1Cards, summary;
    if (r.type === 'showdown') {
      p0Cards = H.holes[0].map((c) => cardHTML(c, true)).join('');
      p1Cards = H.holes[1].map((c) => cardHTML(c, true)).join('');
      if (r.winner === -1) summary = `引き分け（スプリットポット ${fmt(r.pot)}）`;
      else summary = `${settings.names[r.winner]} の勝ち　<span class="myhand">${r.winner === 0 ? r.e0.name : r.e1.name}</span>　+${fmt(r.pot)}`;
    } else {
      // フォールド時は手札を伏せたまま
      p0Cards = H.holes[0].map(() => cardHTML(null, false)).join('');
      p1Cards = H.holes[1].map(() => cardHTML(null, false)).join('');
      summary = `${settings.names[r.winner]} の勝ち（相手フォールド）　+${fmt(r.pot)}`;
    }

    const over = (G.stacks[0] <= 0 || G.stacks[1] <= 0);

    $('#app').innerHTML = `
      <div class="result">
        <h2>結果</h2>
        <div class="res-summary">${summary}</div>
        <div class="board center">${board}</div>
        <div class="showdown-row">
          <div class="sd-player">
            <div class="player-tag">${settings.names[0]}</div>
            <div class="hole">${p0Cards}</div>
            <div class="stack">スタック ${fmt(G.stacks[0])}</div>
            ${r.type === 'showdown' && r.e0 ? `<div class="myhand">${r.e0.name}</div>` : ''}
          </div>
          <div class="sd-player">
            <div class="player-tag">${settings.names[1]}</div>
            <div class="hole">${p1Cards}</div>
            <div class="stack">スタック ${fmt(G.stacks[1])}</div>
            ${r.type === 'showdown' && r.e1 ? `<div class="myhand">${r.e1.name}</div>` : ''}
          </div>
        </div>
        <div class="res-buttons">
          ${over ? `<button class="btn big primary" id="toGameOver">ゲーム終了へ</button>`
                 : `<button class="btn big primary" id="nextHand">次のハンドへ</button>`}
        </div>
        <details class="log"><summary>ハンドログ</summary><div>${H.log.map((l) => `<div>${l}</div>`).join('')}</div></details>
      </div>`;

    if (over) {
      $('#toGameOver').onclick = showGameOver;
    } else {
      $('#nextHand').onclick = () => {
        G.button = 1 - G.button; // ボタン交代
        startHand();
      };
    }
  }

  function showGameOver() {
    const winner = G.stacks[0] > G.stacks[1] ? 0 : 1;
    $('#app').innerHTML = `
      <div class="gameover">
        <h1>🏆 ゲーム終了</h1>
        <p class="big-win">${settings.names[winner]} の勝利！</p>
        <p>${settings.names[0]}: ${fmt(G.stacks[0])}　/　${settings.names[1]}: ${fmt(G.stacks[1])}</p>
        <button class="btn big primary" id="restart">もう一度遊ぶ</button>
      </div>`;
    $('#restart').onclick = renderHome;
  }

  // ---- 画面：ホーム/設定 ----
  function renderHome() {
    const b = currentBlinds();
    const stackEditable = isUnlocked('edit_stack');
    const bbCount = Math.round((settings.startStack / b.bb) * 10) / 10;
    const ante = b.ante > 0 ? ` (ante ${b.ante.toLocaleString('en-US')})` : '';

    // 課金トグル行（未解放なら無効化＋🔒価格、行タップでストアへ）
    const paidToggle = (key, settingKey, label, sub) => {
      const unlocked = isUnlocked(key);
      return `<label class="check paid ${unlocked ? '' : 'locked'}" ${unlocked ? '' : `data-tostore="${key}"`}>
          <input type="checkbox" id="${settingKey}" ${settings[settingKey] ? 'checked' : ''} ${unlocked ? '' : 'disabled'}>
          <span class="pt-label">${label}${sub ? `<span class="pt-sub">${sub}</span>` : ''}</span>
          ${unlocked ? '' : `<span class="lock">🔒 ${yen(PRODUCTS[key].price)}</span>`}
        </label>`;
    };

    $('#app').innerHTML = `
      <div class="home">
        <div class="logo">♠♥<br>HEADS-UP<br><span>NLH ポーカー</span></div>
        <p class="tag">オフライン・対面プレイ（正面通し）</p>

        <button class="btn storebtn" id="store">🛒 ストア${allUnlocked() ? '（全解放済み）' : ''}</button>

        <div class="panel">
          <div class="fmt-line">フォーマット：<b>${b.sb.toLocaleString('en-US')}-${b.bb.toLocaleString('en-US')}${ante}</b>　スタック <b>${settings.startStack.toLocaleString('en-US')}</b>（${bbCount}BB）${settings.tournament && isUnlocked('tournament') ? '　🏆トーナメント' : ''}</div>
        </div>

        <div class="panel settings">
          <label>プレイヤー1の名前
            <input id="n0" type="text" value="${escapeAttr(settings.names[0])}" maxlength="10">
          </label>
          <label>プレイヤー2の名前
            <input id="n1" type="text" value="${escapeAttr(settings.names[1])}" maxlength="10">
          </label>
          <label class="check">
            <input id="rot" type="checkbox" ${settings.rotateP2 ? 'checked' : ''}>
            <span class="pt-label">プレイヤー2側の画面を180°回転（対面で読みやすく）</span>
          </label>
        </div>

        <div class="panel settings">
          <div class="panel-title">設定（課金で解放）</div>
          <label class="${stackEditable ? '' : 'locked'}" ${stackEditable ? '' : 'data-tostore="edit_stack"'}>
            <span class="pt-label">開始スタック ${stackEditable ? '' : `<span class="lock">🔒 ${yen(PRODUCTS.edit_stack.price)}</span>`}</span>
            <input id="ss" type="number" value="${settings.startStack}" min="200" step="100" ${stackEditable ? '' : 'disabled'}>
          </label>
          ${paidToggle('bb_display', 'bbd', 'BB表示', 'スタックやポットをBB単位で表示')}
          ${paidToggle('no_ante', 'antoff', 'ante無しモード', 'アンティを無しにして対戦')}
          ${paidToggle('tournament', 'tourn', 'トーナメントモード', 'ハンドが進むとブラインドが上昇')}
        </div>

        <button class="btn big primary" id="start">ゲーム開始</button>

        <details class="rules panel">
          <summary>遊び方 / ルール</summary>
          <div class="rules-body">
            <p>1台のスマホを2人で挟み、向かい合って遊ぶヘッズアップ（1対1）の No Limit Texas Hold'em です。完全オフラインで動作します。</p>
            <ul>
              <li>手番のプレイヤーの手札を長押し（左手で隠して右手で捲る感覚）すると自分の手札を確認できます。</li>
              <li>フォールド／チェック／コール／ベット・レイズ／オールインから選びます。</li>
              <li>各ハンド終了でボタン（🔘＝ディーラー兼SB）が交代します。</li>
              <li>どちらかのスタックが0になるとゲーム終了です。</li>
            </ul>
          </div>
        </details>
        <p class="version">v1.1 ・ ホーム画面に追加するとアプリのように起動できます</p>
      </div>`;

    // 未解放トグル／項目はタップでストアへ
    document.querySelectorAll('[data-tostore]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); renderStore(); });
    });

    $('#store').onclick = renderStore;

    $('#start').onclick = () => {
      settings.names[0] = ($('#n0').value || 'プレイヤー1').trim();
      settings.names[1] = ($('#n1').value || 'プレイヤー2').trim();
      settings.rotateP2 = $('#rot').checked;
      if (stackEditable) settings.startStack = clampInt($('#ss').value, 200, 100000000, 20000);
      settings.bbDisplay = isUnlocked('bb_display') ? $('#bbd').checked : false;
      settings.anteOff = isUnlocked('no_ante') ? $('#antoff').checked : false;
      settings.tournament = isUnlocked('tournament') ? $('#tourn').checked : false;
      saveSettings(settings);
      newMatch();
      startHand();
    };
  }

  // ---- 画面：ストア（課金） ----
  function renderStore() {
    const item = (key) => {
      const p = PRODUCTS[key];
      const owned = isUnlocked(key);
      return `<div class="store-item">
          <div class="si-main"><div class="si-name">${p.name}</div><div class="si-desc">${p.desc}</div></div>
          <button class="btn ${owned ? 'owned' : 'primary'}" data-buy="${key}" ${owned ? 'disabled' : ''}>${owned ? '購入済み' : yen(p.price)}</button>
        </div>`;
    };
    const bundleOwned = allUnlocked();
    $('#app').innerHTML = `
      <div class="store">
        <div class="store-head"><button class="btn back" id="back">← 戻る</button><h2>ストア</h2></div>
        <p class="muted store-note">課金すると各機能が解放されます。<br>※このWeb版では実際の決済は行われず、購入操作で端末内に解放される雛形です（実アプリ化の際にApp Storeの課金へ接続します）。</p>
        ${Object.keys(PRODUCTS).map(item).join('')}
        <div class="store-item bundle">
          <div class="si-main"><div class="si-name">⭐ 全部セット</div><div class="si-desc">上記すべてを解放（おトク）</div></div>
          <button class="btn ${bundleOwned ? 'owned' : 'primary'}" id="buyBundle" ${bundleOwned ? 'disabled' : ''}>${bundleOwned ? '購入済み' : yen(BUNDLE_PRICE)}</button>
        </div>
      </div>`;

    $('#back').onclick = renderHome;
    document.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.getAttribute('data-buy');
        const p = PRODUCTS[key];
        if (confirm(`「${p.name}」を ${yen(p.price)} で購入しますか？\n（デモ版：実決済は行われません）`)) {
          purchase(key);
          renderStore();
        }
      };
    });
    const bb = $('#buyBundle');
    if (bb && !bundleOwned) {
      bb.onclick = () => {
        if (confirm(`「全部セット」を ${yen(BUNDLE_PRICE)} で購入しますか？\n（デモ版：実決済は行われません）`)) {
          purchaseBundle();
          renderStore();
        }
      };
    }
  }

  function clampInt(v, lo, hi, dflt) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ---- テスト用フック（ブラウザ動作には影響しない） ----
  window.NLH = {
    _state: () => ({ G, H }),
    _setSettings: (s) => { settings = Object.assign({}, defaultSettings, s); },
    newMatch, startHand, act, renderAction, renderResult, renderHome, renderStore, showGameOver,
    _unlock: (k) => purchase(k), _unlockAll: purchaseBundle,
    get G() { return G; }, get H() { return H; },
  };

  // ---- 起動 ----
  window.addEventListener('DOMContentLoaded', renderHome);

  // Service Worker 登録（オフライン化）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
})();
