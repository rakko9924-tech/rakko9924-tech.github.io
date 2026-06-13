/* game.js — ヘッズアップ NLH のゲームエンジンとUI制御
   1台のiPhoneを2人で挟んで対面プレイ（正面通し）する。
   ・各プレイヤーの手番では、まず「プライバシーゲート」を表示して覗き見を防ぐ。
   ・相手側（席2）の画面は180°回転して表示できる。 */

(function () {
  const P = window.Poker;
  const $ = (sel) => document.querySelector(sel);

  // ---- 設定の保存（端末内のみ） ----
  const SETTINGS_KEY = 'nlh_settings_v1';
  const defaultSettings = {
    names: ['プレイヤー1', 'プレイヤー2'],
    startStack: 1000,
    smallBlind: 10,
    bigBlind: 20,
    rotateP2: true, // 席2の画面を180°回転
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

    H = {
      deck,
      holes: [[deck.pop(), deck.pop()], [deck.pop(), deck.pop()]],
      board: [],
      street: 'preflop', // preflop|flop|turn|river|showdown
      pot: 0,
      bet: [0, 0], // このストリートで投入した額
      committed: [0, 0], // このハンドで投入した総額
      sb, bb,
      toAct: sb, // プリフロップはSB(ボタン)から
      lastRaiseSize: settings.bigBlind,
      lastAggressor: bb, // プリフロップのBBはオプションを持つ
      actedSinceRaise: new Set(),
      folded: [false, false],
      allIn: [false, false],
      finished: false,
      log: [],
    };

    // ブラインド投入
    postBlind(sb, settings.smallBlind);
    postBlind(bb, settings.bigBlind);
    H.lastRaiseSize = settings.bigBlind;
    pushLog(`#${G.handNo} 開始。${settings.names[sb]} がSB ${settings.smallBlind}、${settings.names[bb]} がBB ${settings.bigBlind} を投入。`);

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
    H.lastRaiseSize = settings.bigBlind;
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

    const minRaiseTarget = H.bet[opp] + Math.max(H.lastRaiseSize, settings.bigBlind);
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
        ? `<button class="btn call" data-act="call" ${dis}>コール<span class="amt">${Math.min(tc, G.stacks[p])}</span></button>`
        : `<button class="btn check" data-act="check" ${dis}>チェック</button>`;
      const buttons = `<div class="actions ${isActor ? 'live' : 'dim'}">
          <button class="btn fold" data-act="fold" ${dis}>フォールド</button>
          ${callOrCheck}
          ${cr ? `<button class="btn raise" ${isActor ? 'id="openRaise"' : ''} ${dis}>${rw}</button>` : ''}
          <button class="btn allin" data-act="allin" ${dis}>オールイン</button>
        </div>`;
      // レイズ用インラインパネル（手番側のみ）。スライダー＋サイズボタン＋確定。
      const betui = (isActor && cr) ? `
        <div class="betui" data-min="${initVal}" data-max="${maxTarget}" data-step="${settings.smallBlind}">
          <div class="bet-head"><span class="bet-label">${rw}額（合計）</span><b class="bet-val">${initVal}</b></div>
          <div class="bet-presets">
            <button class="chip" data-frac="min">最小</button>
            <button class="chip" data-frac="0.5">½</button>
            <button class="chip" data-frac="0.75">¾</button>
            <button class="chip" data-frac="1">ポット</button>
            <button class="chip" data-frac="max">オールイン</button>
          </div>
          <div class="bet-slider-row">
            <button class="step" data-step="-1">−</button>
            <input type="range" class="bet-range" min="${initVal}" max="${maxTarget}" step="${settings.smallBlind}" value="${initVal}">
            <button class="step" data-step="1">＋</button>
          </div>
          <div class="bet-confirm-row">
            <button class="btn betcancel" data-betcancel>✕ 戻る</button>
            <button class="btn primary betconfirm" data-betconfirm>${rw} <b class="bet-val">${initVal}</b></button>
          </div>
        </div>` : '';
      return `<div class="action-col">${buttons}${betui}</div>`;
    };

    // 1プレイヤー分の席：左に情報＋手札、右にアクション列。
    const seatHTML = (p) => {
      const isActor = (p === actor);
      const rot = (p === 1 && settings.rotateP2) ? 'rot180' : '';
      const betNow = H.bet[p] > 0 ? `<span class="bet-chip">ベット ${H.bet[p]}</span>` : '';
      const tag = `<div class="player-tag ${isActor ? 'me' : ''}">${settings.names[p]} ${p === H.button ? '🔘' : ''} ・ スタック ${G.stacks[p]} ${betNow}</div>`;
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
          <div class="pot">POT <b>${H.pot}</b></div>
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
      const incr = settings.bigBlind; // ＋／− はBB単位で調整
      const valEls = betui.querySelectorAll('.bet-val');
      const chips = betui.querySelectorAll('.chip');

      const setVal = (v) => {
        v = Math.round(v / step) * step;
        v = Math.max(min, Math.min(max, v));
        range.value = v;
        valEls.forEach((e) => { e.textContent = v; });
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
      if (r.winner === -1) summary = `引き分け（スプリットポット ${r.pot}）`;
      else summary = `${settings.names[r.winner]} の勝ち　<span class="myhand">${r.winner === 0 ? r.e0.name : r.e1.name}</span>　+${r.pot}`;
    } else {
      // フォールド時は手札を伏せたまま
      p0Cards = H.holes[0].map(() => cardHTML(null, false)).join('');
      p1Cards = H.holes[1].map(() => cardHTML(null, false)).join('');
      summary = `${settings.names[r.winner]} の勝ち（相手フォールド）　+${r.pot}`;
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
            <div class="stack">スタック ${G.stacks[0]}</div>
            ${r.type === 'showdown' && r.e0 ? `<div class="myhand">${r.e0.name}</div>` : ''}
          </div>
          <div class="sd-player">
            <div class="player-tag">${settings.names[1]}</div>
            <div class="hole">${p1Cards}</div>
            <div class="stack">スタック ${G.stacks[1]}</div>
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
        <p>${settings.names[0]}: ${G.stacks[0]}　/　${settings.names[1]}: ${G.stacks[1]}</p>
        <button class="btn big primary" id="restart">もう一度遊ぶ</button>
      </div>`;
    $('#restart').onclick = renderHome;
  }

  // ---- 画面：ホーム/設定 ----
  function renderHome() {
    $('#app').innerHTML = `
      <div class="home">
        <div class="logo">♠♥<br>HEADS-UP<br><span>NLH ポーカー</span></div>
        <p class="tag">オフライン・対面プレイ（正面通し）</p>

        <div class="settings panel">
          <label>プレイヤー1の名前
            <input id="n0" type="text" value="${escapeAttr(settings.names[0])}" maxlength="10">
          </label>
          <label>プレイヤー2の名前
            <input id="n1" type="text" value="${escapeAttr(settings.names[1])}" maxlength="10">
          </label>
          <label>開始スタック
            <input id="ss" type="number" value="${settings.startStack}" min="100" step="100">
          </label>
          <div class="row2">
            <label>SB
              <input id="sb" type="number" value="${settings.smallBlind}" min="1" step="1">
            </label>
            <label>BB
              <input id="bb" type="number" value="${settings.bigBlind}" min="2" step="1">
            </label>
          </div>
          <label class="check">
            <input id="rot" type="checkbox" ${settings.rotateP2 ? 'checked' : ''}>
            プレイヤー2側の画面を180°回転（対面で読みやすく）
          </label>
        </div>

        <button class="btn big primary" id="start">ゲーム開始</button>

        <details class="rules panel">
          <summary>遊び方 / ルール</summary>
          <div class="rules-body">
            <p>1台のスマホを2人で挟み、向かい合って遊ぶヘッズアップ（1対1）の No Limit Texas Hold'em です。完全オフラインで動作します。</p>
            <ul>
              <li>自分の手番になると「タップして手札を確認」と表示されます。相手に見えないように画面を手元に引き寄せてから確認してください。</li>
              <li>フォールド／チェック／コール／ベット・レイズ／オールインから選びます。</li>
              <li>各ハンド終了でボタン（🔘＝ディーラー兼SB）が交代します。</li>
              <li>どちらかのスタックが0になるとゲーム終了です。</li>
            </ul>
          </div>
        </details>
        <p class="version">v1.0 ・ ホーム画面に追加するとアプリのように起動できます</p>
      </div>`;

    $('#start').onclick = () => {
      settings.names[0] = ($('#n0').value || 'プレイヤー1').trim();
      settings.names[1] = ($('#n1').value || 'プレイヤー2').trim();
      settings.startStack = clampInt($('#ss').value, 100, 1000000, 1000);
      settings.smallBlind = clampInt($('#sb').value, 1, 100000, 10);
      settings.bigBlind = Math.max(settings.smallBlind + 1, clampInt($('#bb').value, 2, 200000, 20));
      settings.rotateP2 = $('#rot').checked;
      saveSettings(settings);
      newMatch();
      startHand();
    };
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
    newMatch, startHand, act, renderAction, renderResult, renderHome, showGameOver,
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
