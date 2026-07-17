// engine.js — 星空探検隊 ゲームエンジン（純ロジック・DOM非依存）
// ブラウザ(<script type="module">)と Node シミュレーションの両方から使う。
// 仕様の正: ~/apps/hoshizora/CLAUDE.md + 設計書（ルール完全仕様 v1.0）

export const SUITS = ['star', 'moon', 'cloud', 'wind'];
export const COMET = 'comet';
export const PLAYER_COUNT = 4;
export const HAND_SIZE = 10;
export const TRICKS = 10;

// 席: 0=ソラ(ねこ・人間) 1=ミミ(うさぎ) 2=ペン(ぺんぎん) 3=コロ(いぬ)
export const CHAR_SEAT = { sora: 0, mimi: 1, pen: 2, koro: 3 };
export const SEAT_CHAR = ['sora', 'mimi', 'pen', 'koro'];

// ---- カード ----------------------------------------------------------------

export function cardId(suit, rank) { return suit + '-' + rank; }
export function parseCard(id) {
  const i = id.lastIndexOf('-');
  return { suit: id.slice(0, i), rank: +id.slice(i + 1) };
}
export function isComet(id) { return id.startsWith(COMET); }

export function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 1; r <= 9; r++) deck.push(cardId(s, r));
  for (let r = 1; r <= 4; r++) deck.push(cardId(COMET, r));
  return deck; // 40枚
}

export function taskDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 1; r <= 9; r++) deck.push(cardId(s, r));
  return deck; // 彗星以外の36枚
}

// ---- 乱数（再現可能） ------------------------------------------------------

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- ミッション定義 → ゲーム状態 -------------------------------------------
// missionDef: {
//   id, title, intro,                                  // 文言は {ja,en}
//   tasks: { count, orderedCount, lastTag, assign },   // assign: 'sora'|'choice'|'random'
//   modifiers: [ { key, ...params } ],                 // 特殊条件（missions.js のカタログ）
// }

export function newGame(missionDef, seed) {
  const rng = makeRng(seed);
  const mods = missionDef.modifiers || [];

  // 配札（must_win_with_rank の配札補正: 指定隊員に該当ランクを保証。無ければ引き直し）
  let hands, tries = 0;
  const mustWin = mods.find(m => m.key === 'must_win_with_rank');
  do {
    const deck = shuffled(fullDeck(), rng);
    hands = [[], [], [], []];
    deck.forEach((c, i) => hands[i % PLAYER_COUNT].push(c));
  } while (mustWin && tries++ < 100 &&
    !hands[CHAR_SEAT[mustWin.member]].some(c => parseCard(c).rank === mustWin.rank));
  hands.forEach(h => h.sort(compareForHand));

  // 彗星4を持つ隊員が最初のリーダー（隊長）
  const commander = hands.findIndex(h => h.includes(cardId(COMET, 4)));

  // おねがいカードを36枚から引き、担当を割当
  const t = missionDef.tasks || { count: 0 };
  const drawn = shuffled(taskDeck(), rng).slice(0, t.count || 0);
  const excluded = mods.filter(m => m.key === 'no_tricks_member').map(m => CHAR_SEAT[m.member]);
  const owners = assignTasks(drawn, hands, commander, t.assign || 'choice', excluded, rng, mods);
  const tasks = drawn.map((card, i) => ({
    card,
    owner: owners[i],
    order: i < (t.orderedCount || 0) ? i + 1 : null, // 順序タグ 1..k（引いた順）
    last: !!(t.lastTag && i === drawn.length - 1 && drawn.length > 1),
    done: false,
    doneAtTrick: -1,
  }));

  return {
    seed,
    mission: missionDef,
    hands,
    commander,
    tasks,
    signals: [null, null, null, null], // {card, tag, atTrick}
    leader: commander,
    trickNo: 0,
    currentTrick: [], // [{player, card}]
    history: [],      // [{trickNo, leader, plays, winner}]
    tricksWon: [0, 0, 0, 0],
    status: 'playing', // 'playing' | 'won' | 'lost'
    failReason: null,
    doneCount: 0,
    modState: {},      // 特殊条件の記憶領域（must_win_with_rank 達成フラグ等）
  };
}

// 担当割当。'choice'=手札適性の自動最適割当（作戦会議の代わり）/'random'=完全ランダム/'sora'等=固定
function assignTasks(drawn, hands, commander, assign, excluded, rng, mods) {
  const allowed = [0, 1, 2, 3].filter(p => !excluded.includes(p));
  if (CHAR_SEAT[assign] !== undefined) return drawn.map(() => CHAR_SEAT[assign]);
  if (assign === 'random') return drawn.map(() => allowed[Math.floor(rng() * allowed.length)]);
  // 'choice': カード保持+同スート上位札+彗星保有で採点、担当数はならす
  const cometOnly = (mods || []).some(m => m.key === 'task_won_by_comet');
  const cometW = cometOnly ? 3.2 : 0.6; // 彗星縛りでは彗星保有が最重要
  const load = [0, 0, 0, 0];
  return drawn.map(card => {
    const { suit, rank } = parseCard(card);
    let best = allowed[0], bestScore = -Infinity;
    for (const p of allowed) {
      let s = 0;
      // 自分の高い札は自力で勝てるので好相性。低い札を自分で持つのは回収が難しく不利
      if (hands[p].includes(card)) s += rank >= 7 ? 7 : rank >= 5 ? 2 : -2;
      s += hands[p].filter(c => parseCard(c).suit === suit && parseCard(c).rank > rank).length * 2;
      s += hands[p].filter(c => isComet(c)).length * cometW;
      s -= load[p] * 2.5;
      s += rng() * 0.01; // 同点の決定性を崩すだけの微小ノイズ
      if (s > bestScore) { bestScore = s; best = p; }
    }
    load[best]++;
    return best;
  });
}

function compareForHand(a, b) {
  const A = parseCard(a), B = parseCard(b);
  const order = [...SUITS, COMET];
  if (A.suit !== B.suit) return order.indexOf(A.suit) - order.indexOf(B.suit);
  return A.rank - B.rank;
}

// ---- 手番と合法手 -----------------------------------------------------------

export function currentPlayer(state) {
  if (state.status !== 'playing') return -1;
  return (state.leader + state.currentTrick.length) % PLAYER_COUNT;
}

export function legalCards(state, p) {
  if (currentPlayer(state) !== p) return [];
  const hand = state.hands[p];
  let cards;
  if (state.currentTrick.length === 0) {
    cards = hand.slice();
  } else {
    const ledSuit = parseCard(state.currentTrick[0].card).suit;
    const follow = hand.filter(c => parseCard(c).suit === ledSuit);
    cards = follow.length ? follow : hand.slice();
  }
  // 特殊条件による制限（絞り込み結果が空になる制限は課さない=詰み防止の大原則）
  for (const m of (state.mission.modifiers || [])) {
    const impl = MODIFIERS[m.key];
    if (impl && impl.legalFilter) {
      const filtered = impl.legalFilter(state, p, cards, m);
      if (filtered && filtered.length) cards = filtered;
    }
  }
  return cards;
}

// ---- シグナルランプ ---------------------------------------------------------
// トリック開始前（場にカードが無いとき）だけ、1ミッション1回、彗星以外を公開できる。
// タグは自動判定: その色の手札が1枚だけ→only / 最高→highest / 最低→lowest。どれでもなければ出せない。

export function signalTag(state, p, card) {
  if (isComet(card)) return null;
  const suit = parseCard(card).suit;
  const same = state.hands[p].filter(c => parseCard(c).suit === suit);
  if (!same.includes(card)) return null;
  if (same.length === 1) return 'only';
  const ranks = same.map(c => parseCard(c).rank);
  const r = parseCard(card).rank;
  if (r === Math.max(...ranks)) return 'highest';
  if (r === Math.min(...ranks)) return 'lowest';
  return null;
}

export function signalLimit(mission) {
  const m = (mission.modifiers || []).find(x => x.key === 'signal_limit');
  return m ? m.max : Infinity; // チーム合計の上限
}

export function canSignal(state, p) {
  if (state.status !== 'playing') return false;
  if (state.signals[p]) return false;
  if (state.currentTrick.length !== 0) return false;
  const used = state.signals.filter(Boolean).length;
  if (used >= signalLimit(state.mission)) return false;
  return true;
}

export function signalableCards(state, p) {
  if (!canSignal(state, p)) return [];
  return state.hands[p].filter(c => signalTag(state, p, c) !== null);
}

export function playSignal(state, p, card) {
  if (!canSignal(state, p)) throw new Error('signal not allowed');
  const tag = signalTag(state, p, card);
  if (!tag) throw new Error('card not signalable: ' + card);
  state.signals[p] = { card, tag, atTrick: state.trickNo };
  return tag;
}

// ---- カードプレイとトリック解決 ---------------------------------------------

export function playCard(state, p, card) {
  if (state.status !== 'playing') throw new Error('game over');
  if (currentPlayer(state) !== p) throw new Error('not your turn: ' + p);
  if (!legalCards(state, p).includes(card)) throw new Error('illegal card: ' + card);

  state.hands[p] = state.hands[p].filter(c => c !== card);
  state.currentTrick.push({ player: p, card });

  for (const m of (state.mission.modifiers || [])) {
    const impl = MODIFIERS[m.key];
    if (impl && impl.onCardPlayed) {
      const res = impl.onCardPlayed(state, { player: p, card }, m);
      if (res && res.fail) return fail(state, res.fail);
    }
  }

  if (state.currentTrick.length === PLAYER_COUNT) resolveTrick(state);
  return state;
}

export function trickWinner(plays) {
  const comets = plays.filter(x => isComet(x.card));
  if (comets.length) {
    return comets.reduce((a, b) => parseCard(a.card).rank > parseCard(b.card).rank ? a : b).player;
  }
  const ledSuit = parseCard(plays[0].card).suit;
  const inSuit = plays.filter(x => parseCard(x.card).suit === ledSuit);
  return inSuit.reduce((a, b) => parseCard(a.card).rank > parseCard(b.card).rank ? a : b).player;
}

export function winnerCardOf(rec) {
  return rec.plays.find(x => x.player === rec.winner).card;
}

function resolveTrick(state) {
  const plays = state.currentTrick.slice();
  const winner = trickWinner(plays);
  const rec = { trickNo: state.trickNo, leader: state.leader, plays, winner };
  state.history.push(rec);
  state.tricksWon[winner]++;
  state.currentTrick = [];
  state.leader = winner;
  state.trickNo++;

  // (1) 横取り判定（順序判定より優先）: 場の未達成おねがいカードの所有者≠勝者なら即失敗
  const inTrick = state.tasks.filter(t => !t.done && plays.some(x => x.card === t.card));
  for (const t of inTrick) {
    if (winner !== t.owner) return fail(state, { type: 'taskStolen', task: t, winner });
  }
  // (2) 達成処理: 順序タグ昇順（タグ無し=99・「最後」は最終）に1枚ずつ done 化しながら検査
  inTrick.sort((a, b) => (a.last ? 999 : (a.order || 99)) - (b.last ? 999 : (b.order || 99)));
  for (const t of inTrick) {
    if (t.order != null) {
      const pending = state.tasks.some(x => x !== t && !x.done && x.order != null && x.order < t.order);
      if (pending) return fail(state, { type: 'orderViolation', task: t });
    }
    if (t.last && state.tasks.some(x => x !== t && !x.done)) {
      return fail(state, { type: 'lastViolation', task: t });
    }
    if (!t.last && state.tasks.some(x => x.last && x.done)) {
      return fail(state, { type: 'lastViolation', task: t });
    }
    t.done = true;
    t.doneAtTrick = rec.trickNo;
    state.doneCount++;
  }

  // (3) 特殊条件のトリック後チェック
  for (const m of (state.mission.modifiers || [])) {
    const impl = MODIFIERS[m.key];
    if (impl && impl.onTrickResolved) {
      const res = impl.onTrickResolved(state, rec, m);
      if (res && res.fail) return fail(state, res.fail);
    }
  }

  // (4) 終了判定
  const allTasksDone = state.tasks.length > 0 && state.tasks.every(t => t.done);
  if (allTasksDone && !earlyWinBlocked(state)) return win(state);
  if (state.trickNo >= TRICKS) {
    if (state.tasks.some(t => !t.done)) return fail(state, { type: 'tasksIncomplete' });
    for (const m of (state.mission.modifiers || [])) {
      const impl = MODIFIERS[m.key];
      if (impl && impl.atEnd) {
        const res = impl.atEnd(state, m);
        if (res && res.fail) return fail(state, res.fail);
      }
    }
    return win(state);
  }
  return state;
}

// おねがい全達成でも続行が必要か（未達の勝利条件を持つ特殊条件）
function earlyWinBlocked(state) {
  if (state.tasks.length === 0) return true; // おねがい0面は10トリック完走
  for (const m of (state.mission.modifiers || [])) {
    const impl = MODIFIERS[m.key];
    if (impl && impl.blocksEarlyWin && impl.blocksEarlyWin(state, m)) return true;
  }
  return false;
}

function fail(state, reason) { state.status = 'lost'; state.failReason = reason; return state; }
function win(state) { state.status = 'won'; return state; }

// ---- AI用ビュー（自分の手札+公開情報のみ。他人の手札は見せない） -------------

export function makeView(state, p) {
  return {
    me: p,
    hand: state.hands[p].slice(),
    handCounts: state.hands.map(h => h.length),
    commander: state.commander,
    tasks: state.tasks.map(t => ({ ...t })),
    signals: state.signals.map(s => (s ? { ...s } : null)),
    leader: state.leader,
    trickNo: state.trickNo,
    currentTrick: state.currentTrick.map(x => ({ ...x })),
    history: state.history,
    tricksWon: state.tricksWon.slice(),
    modifiers: (state.mission.modifiers || []).map(m => ({ ...m })),
    modState: { ...state.modState },
    legal: legalCards(state, p),
    canSignal: canSignal(state, p),
    signalable: canSignal(state, p) ? signalableCards(state, p) : [],
  };
}

// ---- 特殊条件（modifier）実装の登録口 ---------------------------------------
// 実装本体は missions.js（カタログと1:1）。
export const MODIFIERS = {};
export function registerModifier(key, impl) { MODIFIERS[key] = impl; }
