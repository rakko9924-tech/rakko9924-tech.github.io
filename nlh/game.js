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

  // ---- 画面：アクション ----
  function renderAction() {
    const i = H.toAct;
    const opp = 1 - i;
    const toCall = currentToCall(i);
    const seatRot = (i === 1 && settings.rotateP2) ? 'rot180' : '';

    const board = [0, 1, 2, 3, 4].map((k) =>
      H.board[k] ? cardHTML(H.board[k], true) : `<div class="card placeholder"></div>`
    ).join('');

    const myEval = H.board.length >= 3
      ? P.evaluate7([...H.holes[i], ...H.board]).name
      : '';

    const callBtn = toCall > 0
      ? `<button class="btn call" data-act="call">コール<span class="amt">${Math.min(toCall, G.stacks[i])}</span></button>`
      : `<button class="btn check" data-act="check">チェック</button>`;

    const canRaise = G.stacks[i] > toCall && !H.allIn[opp];
    const minRaiseTarget = H.bet[opp] + Math.max(H.lastRaiseSize, settings.bigBlind);
    const maxTarget = H.bet[i] + G.stacks[i];
    const raiseWord = toCall === 0 ? 'ベット' : 'レイズ';

    const faceUp = `${cardHTML(H.holes[i][0], true)}${cardHTML(H.holes[i][1], true)}`;
    const faceDown = `${cardHTML(null, false)}${cardHTML(null, false)}`;

    $('#app').innerHTML = `
      <div class="table ${seatRot}">
        <div class="opp-row">
          <div class="player-tag">${settings.names[opp]} ${opp === H.button ? '🔘' : ''}</div>
          <div class="hole">${cardHTML(null, false)}${cardHTML(null, false)}</div>
          <div class="stack">スタック ${G.stacks[opp]}</div>
        </div>

        <div class="center">
          <div class="turn">${settings.names[i]} の番</div>
          <div class="pot">POT <b>${H.pot}</b></div>
          <div class="board">${board}</div>
          <div class="street">${streetLabel(H.street)}</div>
        </div>

        <div class="me-row">
          <div class="player-tag me">${settings.names[i]} ${i === H.button ? '🔘' : ''}</div>
          <div class="peek" id="peek">
            <div class="hole big" id="holeCards">${faceDown}</div>
            <div class="peek-hint" id="peekHint">👈 左手で隠して、ここを長押しで手札を確認</div>
            <div class="peek-eval myhand" id="peekEval" style="visibility:hidden">&nbsp;</div>
          </div>
          <div class="stack">スタック ${G.stacks[i]}</div>
        </div>

        <div class="actions">
          <button class="btn fold" data-act="fold">フォールド</button>
          ${callBtn}
          ${canRaise ? `<button class="btn raise" id="openRaise">${raiseWord}</button>` : ''}
          <button class="btn allin" data-act="allin">オールイン</button>
        </div>
      </div>

      <div class="raise-panel hidden ${seatRot}" id="raisePanel">
        <div class="rp-inner">
          <div class="rp-title">${raiseWord}額（合計）</div>
          <div class="rp-value"><b id="rpVal">${Math.min(minRaiseTarget, maxTarget)}</b></div>
          <input type="range" id="rpRange" min="${Math.min(minRaiseTarget, maxTarget)}" max="${maxTarget}" step="${settings.smallBlind}" value="${Math.min(minRaiseTarget, maxTarget)}">
          <div class="rp-quick">
            <button data-frac="0.5">½ポット</button>
            <button data-frac="0.75">¾ポット</button>
            <button data-frac="1">ポット</button>
            <button data-frac="max">MAX</button>
          </div>
          <div class="rp-buttons">
            <button class="btn" id="rpCancel">戻る</button>
            <button class="btn primary" id="rpConfirm">決定</button>
          </div>
        </div>
      </div>`;

    // 手札の覗き見（長押し＝トランプを捲る）。指を離すと自動で伏せる。
    const peek = $('#peek');
    const holeCards = $('#holeCards');
    const peekHint = $('#peekHint');
    const peekEval = $('#peekEval');
    const reveal = () => {
      holeCards.innerHTML = faceUp;
      peek.classList.add('peeking');
      if (peekHint) peekHint.textContent = '指を離すと伏せます';
      if (myEval && peekEval) { peekEval.textContent = myEval; peekEval.style.visibility = 'visible'; }
    };
    const hide = () => {
      holeCards.innerHTML = faceDown;
      peek.classList.remove('peeking');
      if (peekHint) peekHint.textContent = '👈 左手で隠して、ここを長押しで手札を確認';
      if (peekEval) peekEval.style.visibility = 'hidden';
    };
    if (peek) {
      const down = (e) => { e.preventDefault(); reveal(); };
      const up = (e) => { e.preventDefault(); hide(); };
      // Pointer Events（iOS Safari / Chrome 対応）。保険でタッチ/マウスも併用。
      peek.addEventListener('pointerdown', down);
      peek.addEventListener('pointerup', up);
      peek.addEventListener('pointerleave', up);
      peek.addEventListener('pointercancel', up);
      peek.addEventListener('touchstart', down, { passive: false });
      peek.addEventListener('touchend', up);
      peek.addEventListener('touchcancel', up);
      peek.addEventListener('mousedown', down);
      peek.addEventListener('mouseup', up);
      peek.addEventListener('mouseleave', up);
      peek.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // アクションボタン
    document.querySelectorAll('.actions [data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.getAttribute('data-act');
        if (a === 'allin') {
          if (!confirm('オールインしますか？')) return;
          act('allin');
        } else {
          act(a);
        }
      };
    });

    const openRaise = $('#openRaise');
    if (openRaise) {
      const panel = $('#raisePanel');
      const range = $('#rpRange');
      const val = $('#rpVal');
      const sync = () => { val.textContent = range.value; };
      range.oninput = sync;
      openRaise.onclick = () => panel.classList.remove('hidden');
      $('#rpCancel').onclick = () => panel.classList.add('hidden');
      $('#rpConfirm').onclick = () => {
        const target = parseInt(range.value, 10);
        panel.classList.add('hidden');
        act(toCall === 0 ? 'bet' : 'raise', target);
      };
      document.querySelectorAll('.rp-quick button').forEach((qb) => {
        qb.onclick = () => {
          const frac = qb.getAttribute('data-frac');
          let target;
          if (frac === 'max') target = maxTarget;
          else {
            // ポット基準レイズ: コールしてからポットの割合分を上乗せ
            const potAfterCall = H.pot + toCall;
            const add = Math.round(potAfterCall * parseFloat(frac));
            target = H.bet[opp] + add;
          }
          target = Math.max(Math.min(minRaiseTarget, maxTarget), Math.min(target, maxTarget));
          // ステップに丸め
          range.value = target;
          sync();
        };
      });
    }
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
