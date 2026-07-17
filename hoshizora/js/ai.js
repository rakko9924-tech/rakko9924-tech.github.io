// ai.js — AIクルーの思考ルーチン
// 入力は engine.makeView(state, p) のビューのみ。他人の手札は参照しない（カンニング禁止）。
// 2段構え:
//   1) ヒューリスティック評価（scoreFollow/scoreLead）= ロールアウト用の方策
//   2) chooseCard = 決定化ロールアウト探索。未知カードの配置を制約付きでサンプリングした
//      「あり得る世界」を複数作り、各候補手についてヒューリスティック自己対戦で終局まで
//      進めた勝率で手を選ぶ。シードはビューから決めるので同一局面では同一出力（純関数）。
import {
  fullDeck, parseCard, isComet, CHAR_SEAT, TRICKS,
  makeRng, playCard, playSignal, currentPlayer, makeView, canSignal,
} from './engine.js';

const HUMAN = 0;
const W = {
  CAPTURE: 1000, FAIL: -1000, FEED: 800, FEED_SETUP: 500,
  NO_TRICKS_WIN: -900, WIN_LEAD: 120, DANGER_DISCARD: 90,
  SPEND_COMET: -80, SPEND_BOSS: -60, DUCK: 40,
};
const SAFE_SURV = 0.7, FORCED_RISK_AI = 0.12, FORCED_RISK_HUMAN = 0.25;

// ---- 基本ルール関数（ビュー内だけで完結） -----------------------------------

function winnerPlay(plays) {
  const comets = plays.filter(x => isComet(x.card));
  if (comets.length) return comets.reduce((a, b) => parseCard(a.card).rank > parseCard(b.card).rank ? a : b);
  const led = parseCard(plays[0].card).suit;
  const inSuit = plays.filter(x => parseCard(x.card).suit === led);
  return inSuit.reduce((a, b) => parseCard(a.card).rank > parseCard(b.card).rank ? a : b);
}

// ---- 知識構築（公開情報のみ） -----------------------------------------------

function buildKnowledge(view) {
  const seen = new Set(view.hand);
  for (const t of view.history) for (const x of t.plays) seen.add(x.card);
  for (const x of view.currentTrick) seen.add(x.card);
  const unseen = fullDeck().filter(c => !seen.has(c));

  const seats = [0, 1, 2, 3].filter(s => s !== view.me);
  const possible = new Map(); // card -> Set(seat)
  for (const c of unseen) possible.set(c, new Set(seats));

  // ボイド検出（フォローしなかった席はそのスートを持たない）
  const voids = [{}, {}, {}, {}];
  const scanTrick = plays => {
    if (!plays.length) return;
    const led = parseCard(plays[0].card).suit;
    for (const x of plays.slice(1)) {
      if (parseCard(x.card).suit !== led) voids[x.player][led] = true;
    }
  };
  for (const t of view.history) scanTrick(t.plays);
  scanTrick(view.currentTrick);
  for (const c of unseen) {
    for (const s of seats) if (voids[s][parseCard(c).suit]) possible.get(c).delete(s);
  }

  // シグナル制約
  view.signals.forEach((sig, s) => {
    if (!sig || s === view.me) return;
    if (possible.has(sig.card)) possible.set(sig.card, new Set([s]));
    const sc = parseCard(sig.card);
    for (const c of unseen) {
      const pc = parseCard(c);
      if (pc.suit !== sc.suit || c === sig.card) continue;
      if (sig.tag === 'only') possible.get(c).delete(s);
      if (sig.tag === 'highest' && pc.rank > sc.rank) possible.get(c).delete(s);
      if (sig.tag === 'lowest' && pc.rank < sc.rank) possible.get(c).delete(s);
    }
  });

  const isBoss = card => {
    const { suit, rank } = parseCard(card);
    return !unseen.some(c => parseCard(c).suit === suit && parseCard(c).rank > rank);
  };
  return { unseen, possible, voids, isBoss };
}

// 現在の勝ち手が最後まで勝ち残る確率の近似
function survivalProb(view, k, plays) {
  if (!plays.length) return 1;
  const w = winnerPlay(plays);
  const led = parseCard(plays[0].card).suit;
  const played = new Set(plays.map(x => x.player));
  const remaining = [0, 1, 2, 3].filter(s => !played.has(s));
  let prob = 1;
  for (const s of remaining) {
    const beaters = k.unseen.filter(c => {
      const set = k.possible.get(c);
      if (!set || !set.has(s)) return false;
      return beats(c, w.card, led);
    });
    if (!beaters.length) continue;
    const suitCount = k.unseen.filter(c => parseCard(c).suit === led && k.possible.get(c).has(s)).length;
    const risk = (s === HUMAN ? FORCED_RISK_HUMAN : FORCED_RISK_AI) * beaters.length / Math.max(1, suitCount);
    prob *= (1 - Math.min(0.9, risk));
  }
  return prob;
}

function beats(a, b, led) {
  const A = parseCard(a), B = parseCard(b);
  if (isComet(a) && isComet(b)) return A.rank > B.rank;
  if (isComet(a)) return true;
  if (isComet(b)) return false;
  if (A.suit === B.suit) return A.rank > B.rank;
  return A.suit === led;
}

// そのカードが既にプレイ済みか（シグナル公開札の生存確認用）
function seenAlready(view, card) {
  for (const t of view.history) if (t.plays.some(x => x.card === card)) return true;
  return view.currentTrick.some(x => x.card === card);
}

// ---- タスクプランナ ---------------------------------------------------------

function planTasks(view, k) {
  const pending = view.tasks.filter(t => !t.done);
  const byCard = new Map();
  for (const t of pending) byCard.set(t.card, t);

  const tagAllowsNow = t => {
    if (t.order != null && pending.some(o => o !== t && o.order != null && o.order < t.order)) return false;
    if (t.last && pending.some(o => o !== t)) return false;
    if (!t.last && view.tasks.some(o => o.last) && false) return false; // lastは最終なのでタグ無しは常に可
    return true;
  };
  const locate = card => {
    if (view.hand.includes(card)) return 'ME';
    const set = k.possible.get(card);
    if (!set) return 'PLAYED';
    if (set.size === 1) return [...set][0];
    return 'UNKNOWN';
  };
  const noTricksSeats = view.modifiers.filter(m => m.key === 'no_tricks_member').map(m => CHAR_SEAT[m.member]);
  return { pending, byCard, tagAllowsNow, locate, noTricksSeats };
}

function isDangerCard(card, plan, me) {
  const { suit, rank } = parseCard(card);
  if (isComet(card)) return false;
  return plan.pending.some(t => {
    const tc = parseCard(t.card);
    return tc.suit === suit && rank > tc.rank && (t.owner !== me || !plan.tagAllowsNow(t));
  });
}
function bossNeededLater(card, plan, me) {
  const { suit } = parseCard(card);
  return plan.pending.some(t => t.owner === me && parseCard(t.card).suit === suit);
}
function ownsDoableTask(plan, me) {
  return plan.pending.some(t => t.owner === me && plan.tagAllowsNow(t));
}
function myPendingElsewhere(view, plan, k) {
  return plan.pending.some(t => t.owner === view.me && !view.hand.includes(t.card) && k.unseen.includes(t.card));
}

// ---- 特殊条件のスコア補正（勝つ/負けるの善し悪しを条件で曲げる） -------------

function modifierWinScore(view, plan, card, iWin) {
  let s = 0;
  const me = view.me;
  const remaining = TRICKS - view.trickNo; // このトリックを含む残り数
  const trickPlays = [...view.currentTrick, { player: me, card }];
  const taskInTrick = plan.pending.some(t => trickPlays.some(x => x.card === t.card));

  for (const m of view.modifiers) {
    switch (m.key) {
      case 'no_tricks_member':
        if (CHAR_SEAT[m.member] === me && iWin) s += W.NO_TRICKS_WIN;
        break;
      case 'max_win_streak': {
        if (!iWin) break;
        const h = view.history;
        const streak = m.streak;
        if (h.length >= streak && h.slice(-streak).every(r => r.winner === me)) s += -950;
        else if (h.length >= streak - 1 && streak > 1 && h.slice(-(streak - 1)).every(r => r.winner === me)) s += -40;
        break;
      }
      case 'exact_tricks_member': {
        if (CHAR_SEAT[m.member] !== me) break;
        const w = view.tricksWon[me];
        if (iWin) {
          if (w >= m.count) s += -950;
          else s += (m.count - w) >= remaining ? 500 : 60;
        } else if (w < m.count && (m.count - w) >= remaining) s += -400; // 取り損ねると届かない
        break;
      }
      case 'fewer_tricks_than': {
        const a = CHAR_SEAT[m.memberA], b = CHAR_SEAT[m.memberB];
        if (me === a && iWin) s += view.tricksWon[a] + 1 >= view.tricksWon[b] + (remaining - 1) ? -600 : -120;
        if (me === b && iWin && view.tricksWon[a] >= view.tricksWon[b]) s += 120;
        break;
      }
      case 'all_members_win': {
        if (!iWin) break;
        const zeros = view.tricksWon.filter(w => w === 0).length;
        if (view.tricksWon[me] === 0) s += zeros >= remaining - 1 ? 400 : 100;
        else if (zeros >= remaining) s += -600; // 0勝の仲間に回すべきトリック
        else if (zeros > 0 && zeros >= remaining - 2) s += -150; // 余裕がないうちは譲る
        break;
      }
      case 'first_trick_member':
        if (view.trickNo === 0) s += iWin ? (CHAR_SEAT[m.member] === me ? 600 : -800) : (CHAR_SEAT[m.member] === me ? -300 : 20);
        break;
      case 'last_trick_member':
        if (view.trickNo === TRICKS - 1) s += iWin ? (CHAR_SEAT[m.member] === me ? 600 : -800) : (CHAR_SEAT[m.member] === me ? -300 : 20);
        break;
      case 'no_win_with_rank':
        if (iWin && !isComet(card) && parseCard(card).rank === m.rank) s += -950;
        break;
      case 'must_win_with_rank':
        if (CHAR_SEAT[m.member] === me && !view.modState.mustWinDone && iWin && parseCard(card).rank === m.rank) s += 700;
        break;
      case 'no_comet_on_task':
        if (iWin && taskInTrick && isComet(card)) s += -950;
        break;
      case 'task_won_by_comet':
        if (iWin && taskInTrick && !isComet(card)) s += -950;
        if (iWin && taskInTrick && isComet(card)) s += 120;
        break;
    }
  }
  return s;
}

// ---- ヒューリスティック方策（ロールアウト用） --------------------------------

export function chooseCardHeuristic(view) {
  const legal = view.legal;
  if (legal.length === 1) return legal[0];
  const k = buildKnowledge(view);
  const plan = planTasks(view, k);
  const isLead = view.currentTrick.length === 0;
  let best = legal[0], bestScore = -Infinity;
  for (const card of legal) {
    const s = isLead ? scoreLead(card, view, k, plan) : scoreFollow(card, view, k, plan);
    if (s > bestScore) { best = card; bestScore = s; }
  }
  return best;
}

// ---- 決定化ロールアウト探索 --------------------------------------------------

// サンプリングする世界の数（多いほど強いが遅い）。実ゲームは既定16で十分速い。
// Nodeシミュレーション時のみ HZ_WORLDS 環境変数で上書き可能。
const SEARCH_WORLDS = (typeof process !== 'undefined' && process.env && +process.env.HZ_WORLDS) || 16;

// ビューから決定的なシードを作る（同一局面 → 同一乱数列）
function seedFromView(view) {
  let h = 2166136261 >>> 0;
  const mix = str => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
  mix('m' + view.me + 't' + view.trickNo + 'l' + view.leader);
  for (const c of view.hand) mix(c);
  for (const x of view.currentTrick) mix(x.card + x.player);
  return h >>> 0;
}

// 未知カードを制約（ボイド・シグナル・手札枚数）に合わせて他家3席へ配る
function sampleWorld(view, k, rng) {
  const seats = [0, 1, 2, 3].filter(s => s !== view.me);
  const capacity = {};
  for (const s of seats) capacity[s] = view.handCounts[s];
  const cards = k.unseen.slice();
  // 許可席が少ないカードから割り当てる
  cards.sort((a, b) => (k.possible.get(a)?.size || 3) - (k.possible.get(b)?.size || 3));
  for (let attempt = 0; attempt < 30; attempt++) {
    const cap = { ...capacity };
    const hands = { }; for (const s of seats) hands[s] = [];
    let ok = true;
    for (const c of cards) {
      const allowed = [...(k.possible.get(c) || seats)].filter(s => cap[s] > 0);
      if (!allowed.length) { ok = false; break; }
      const s = allowed[Math.floor(rng() * allowed.length)];
      hands[s].push(c); cap[s]--;
    }
    if (ok) return hands;
  }
  // 制約を満たせない場合は枚数だけ守って配る
  const cap = { ...capacity };
  const hands = {}; for (const s of seats) hands[s] = [];
  for (const c of cards) {
    const open = seats.filter(s => cap[s] > 0);
    const s = open[Math.floor(rng() * open.length)];
    hands[s].push(c); cap[s]--;
  }
  return hands;
}

// ビュー+世界からエンジンが動かせる状態を合成する
function synthState(view, world) {
  const hands = [];
  for (let s = 0; s < 4; s++) hands[s] = s === view.me ? view.hand.slice() : world[s].slice();
  return {
    seed: 0,
    mission: { id: -1, tasks: { count: view.tasks.length }, modifiers: view.modifiers },
    hands,
    commander: view.commander,
    tasks: view.tasks.map(t => ({ ...t })),
    signals: view.signals.map(s => (s ? { ...s } : null)),
    leader: view.leader,
    trickNo: view.trickNo,
    currentTrick: view.currentTrick.map(x => ({ ...x })),
    history: view.history.slice(),
    tricksWon: view.tricksWon.slice(),
    status: 'playing',
    failReason: null,
    doneCount: view.tasks.filter(t => t.done).length,
    modState: { ...view.modState },
  };
}

// ヒューリスティック同士で終局まで進める。トリック頭でシグナルも打つ（協調を再現）。
function rollout(state) {
  let guard = 0;
  while (state.status === 'playing' && guard++ < 80) {
    if (state.currentTrick.length === 0) {
      for (let i = 0; i < 4; i++) {
        const q = (state.leader + i) % 4;
        if (canSignal(state, q)) {
          const sig = chooseSignal(makeView(state, q));
          if (sig) playSignal(state, q, sig);
        }
      }
    }
    const p = currentPlayer(state);
    playCard(state, p, chooseCardHeuristic(makeView(state, p)));
  }
  return state.status === 'won' ? 1 : 0;
}

// ---- 作戦会議: おねがい担当の最適化（1デッキ1回、newGame直後に呼ぶ） ---------
// The Crew のタスク配分交渉に相当。全員が手札を見て「誰がどのおねがいを取るか」を
// 相談する場面を、ヒューリスティック自己対戦の勝率で山登り探索して再現する。
// 制約: no_tricks_member の席は担当から除外。'random'/固定 assign のミッションでは動かさない。

function cloneStateForPlan(state, owners) {
  return {
    seed: state.seed,
    mission: state.mission,
    hands: state.hands.map(h => h.slice()),
    commander: state.commander,
    tasks: state.tasks.map((t, i) => ({ ...t, owner: owners ? owners[i] : t.owner })),
    signals: [null, null, null, null],
    leader: state.commander,
    trickNo: 0,
    currentTrick: [],
    history: [],
    tricksWon: [0, 0, 0, 0],
    status: 'playing',
    failReason: null,
    doneCount: 0,
    modState: {},
  };
}

function evalAssignment(state, owners, rolls) {
  let wins = 0;
  for (let r = 0; r < rolls; r++) wins += rollout(cloneStateForPlan(state, owners));
  return wins / rolls;
}

export function optimizeAssignment(state, opts = {}) {
  const m = state.mission;
  if (!m.tasks || !state.tasks.length) return state;
  if ((m.tasks.assign || 'choice') !== 'choice') return state; // 相談できるのは choice のみ
  const restarts = opts.restarts ?? 3;
  const iters = opts.iters ?? 24;
  const rolls = opts.rolls ?? 5;

  const excluded = (m.modifiers || []).filter(x => x.key === 'no_tricks_member').map(x => CHAR_SEAT[x.member]);
  const allowed = [0, 1, 2, 3].filter(s => !excluded.includes(s));
  if (allowed.length <= 1) return state;
  const rng = makeRng((state.seed >>> 0) ^ 0x9e3779b9);
  const n = state.tasks.length;

  let bestOwners = state.tasks.map(t => t.owner);
  let bestScore = evalAssignment(state, bestOwners, rolls);

  for (let rs = 0; rs < restarts; rs++) {
    // 初期解: 1回目は現状、以降はランダム
    let owners = rs === 0 ? bestOwners.slice()
      : state.tasks.map(() => allowed[Math.floor(rng() * allowed.length)]);
    let score = rs === 0 ? bestScore : evalAssignment(state, owners, rolls);
    for (let it = 0; it < iters; it++) {
      // ランダムな1タスクの担当を別の席に変えて改善するか試す（山登り）
      const i = Math.floor(rng() * n);
      const cur = owners[i];
      const alt = allowed.filter(s => s !== cur);
      const cand = alt[Math.floor(rng() * alt.length)];
      const trial = owners.slice(); trial[i] = cand;
      const sc = evalAssignment(state, trial, rolls);
      if (sc >= score) { owners = trial; score = sc; }
      if (score >= 0.98) break;
    }
    if (score > bestScore) { bestScore = score; bestOwners = owners; }
    if (bestScore >= 0.98) break;
  }
  state.tasks.forEach((t, i) => { t.owner = bestOwners[i]; });
  return state;
}

export function chooseCard(view) {
  const legal = view.legal;
  if (legal.length === 1) return legal[0];
  const k = buildKnowledge(view);
  const plan = planTasks(view, k);
  const rng = makeRng(seedFromView(view));
  const worlds = [];
  for (let i = 0; i < SEARCH_WORLDS; i++) worlds.push(sampleWorld(view, k, rng));

  const isLead = view.currentTrick.length === 0;
  let best = legal[0], bestScore = -Infinity;
  for (const card of legal) {
    let wins = 0;
    for (const w of worlds) {
      const st = synthState(view, w);
      playCard(st, view.me, card);
      wins += rollout(st);
    }
    // 勝率が主、ヒューリスティックは同率の目つぶし
    const h = isLead ? scoreLead(card, view, k, plan) : scoreFollow(card, view, k, plan);
    const s = wins / worlds.length + h / 1e7;
    if (s > bestScore) { bestScore = s; best = card; }
  }
  return best;
}

function scoreFollow(card, view, k, plan) {
  const me = view.me;
  const led = parseCard(view.currentTrick[0].card).suit;
  const plays2 = [...view.currentTrick, { player: me, card }];
  const wNow = winnerPlay(plays2);
  const iWin = wNow.player === me;
  const surv = survivalProb(view, k, plays2);
  const noTricksMe = plan.noTricksSeats.includes(me);
  const cardTask = plan.byCard.get(card);
  const pc = parseCard(card);
  let s = 0;

  // (1) 場に出ているおねがい札
  for (const x of view.currentTrick) {
    const t = plan.byCard.get(x.card);
    if (!t) continue;
    if (t.owner === me && plan.tagAllowsNow(t)) {
      s += iWin ? W.CAPTURE * surv : W.FAIL * surv * 0.8; // 取れるのに逃げる＝ほぼ失敗確定
    } else {
      s += iWin ? W.FAIL * surv : W.DUCK;
    }
  }
  // (2) 自分のおねがい札を自分で出す
  if (cardTask && cardTask.owner === me && plan.tagAllowsNow(cardTask)) {
    s += iWin ? W.CAPTURE * surv : W.FAIL * 0.9;
  }
  // (3) フィード: 味方のおねがい札を担当者が勝っているトリックへ
  // （彗星縛りミッションでは「勝ち方」も合っている時だけ投げ込む）
  if (cardTask && cardTask.owner !== me && plan.tagAllowsNow(cardTask)) {
    const cometOnly = view.modifiers.some(m => m.key === 'task_won_by_comet');
    const noComet = view.modifiers.some(m => m.key === 'no_comet_on_task');
    const okKind = c => (!cometOnly || isComet(c)) && (!noComet || !isComet(c));
    if (wNow.player === cardTask.owner && okKind(wNow.card)) {
      s += W.FEED * surv;
    } else {
      // 担当者がまだ後手に控えていて、シグナル公開札で現在の勝ち手を上回れるなら投げ込める
      const ownerNotPlayed = !plays2.some(x => x.player === cardTask.owner);
      const sig = view.signals[cardTask.owner];
      const ownerWillBeat = ownerNotPlayed && sig && view.hand !== undefined &&
        !seenAlready(view, sig.card) && beats(sig.card, wNow.card, led) && okKind(sig.card);
      s += ownerWillBeat ? W.FEED * 0.8 * surv : W.FAIL * 0.7;
    }
  }
  // (3') 順序がまだ先のおねがい札は出さない
  if (cardTask && !plan.tagAllowsNow(cardTask)) s += W.FAIL * 0.6;
  // (3'') 後から落ちてくるおねがい札への警戒:
  // リードスートの未出おねがい札を残り手番の誰かが持ちうるなら、
  // 担当者以外はこのトリックを勝ちにいかない。担当者は逆に勝ちにいく。
  {
    const remainingSeats = [0, 1, 2, 3].filter(q => !plays2.some(x => x.player === q));
    for (const t of plan.pending) {
      const tc = parseCard(t.card);
      if (tc.suit !== led || !k.unseen.includes(t.card)) continue;
      const holders = [...(k.possible.get(t.card) || [])].filter(q => remainingSeats.includes(q));
      if (!holders.length) continue;
      if (iWin) {
        if (t.owner === me && plan.tagAllowsNow(t)) s += 200;
        else s -= 240;
      } else if (t.owner === me && plan.tagAllowsNow(t)) {
        s -= 60; // 担当者が取れるのに降りるのは損
      }
    }
  }
  // (4) 取らない制約・その他特殊条件
  s += modifierWinScore(view, plan, card, iWin);
  // (4') 連勝上限に達したリーダーのトリックは、自分が引き取る
  for (const m of view.modifiers) {
    if (m.key !== 'max_win_streak') continue;
    const h = view.history;
    if (h.length >= m.streak && view.leader !== me &&
      h.slice(-m.streak).every(r => r.winner === view.leader) && iWin) s += 260;
  }
  // (4'') 最後のトリック担当は強い札を温存する
  for (const m of view.modifiers) {
    if (m.key === 'last_trick_member' && CHAR_SEAT[m.member] === me && view.trickNo < TRICKS - 1) {
      if (isComet(card) || k.isBoss(card)) s -= 60 + view.trickNo * 18;
    }
    if (m.key === 'task_won_by_comet' && isComet(card) &&
      plan.pending.some(t => t.owner === me) &&
      !(iWin && plan.pending.some(t => plays2.some(x => x.card === t.card)))) {
      s -= 250; // 彗星は回収のために温存
    }
  }
  // (5) リード獲得価値
  const trickHasTask = view.currentTrick.some(x => plan.byCard.has(x.card));
  if (iWin && !trickHasTask && !noTricksMe && ownsDoableTask(plan, me)) s += W.WIN_LEAD * surv;
  // (6) 資源コスト
  if (isComet(card)) {
    s += W.SPEND_COMET - pc.rank * 8;
    // 自分のおねがい札が他家にあるなら、彗星は回収の切り札として温存する
    const taskInTrickNow = plan.pending.some(t => plays2.some(x => x.card === t.card) && t.owner === me);
    if (!taskInTrickNow && myPendingElsewhere(view, plan, k)) s -= 120;
  } else if (k.isBoss(card) && bossNeededLater(card, plan, me) && !iWin) s += W.SPEND_BOSS;
  // (7) 札の高さの好み
  if (iWin) s -= pc.rank * 2;
  else if (pc.suit === led) s += pc.rank * 1.5; // 負けるなら高い札から処分
  else {
    if (isDangerCard(card, plan, me)) s += W.DANGER_DISCARD + pc.rank * 2;
    else s += (9 - pc.rank);
    if (cardTask) s -= 200; // おねがい札は理由なく捨てない
  }
  return s;
}

function scoreLead(card, view, k, plan) {
  const me = view.me;
  const t = plan.byCard.get(card);
  const pc = parseCard(card);
  const surv = survivalProb(view, k, [{ player: me, card }]);
  const noTricksMe = plan.noTricksSeats.includes(me);
  let s = 0;

  // (A) 自分のおねがい札リード
  if (t && t.owner === me && plan.tagAllowsNow(t)) {
    if (k.isBoss(card)) s += W.CAPTURE * surv;
    else s += surv >= SAFE_SURV ? W.CAPTURE * surv * 0.8 : W.FAIL * 0.5;
  }
  // (A') 順序が先のおねがい札はリードしない
  if (t && !plan.tagAllowsNow(t)) s += W.FAIL * 0.6;
  // (B) 吸い出し: 自分担当の対象札が他家 → 対象スートのボスをリード
  // ボスでないのに自分のおねがいスートをリードすると、おねがい札を
  // 制御できないトリックに吸い出してしまうので厳禁。
  const myTasksElsewhere = plan.pending.filter(x =>
    x.owner === me && plan.tagAllowsNow(x) && plan.locate(x.card) !== 'ME');
  if (!t && myTasksElsewhere.some(x => parseCard(x.card).suit === pc.suit) && !isComet(card)) {
    if (k.isBoss(card)) s += W.FEED_SETUP * surv;
    else s -= 350;
  }
  // (C) 味方のおねがい札を自分が保持 → 担当者が勝てると分かるなら低リードで手渡し
  if (t && t.owner !== me && plan.tagAllowsNow(t)) {
    const sig = view.signals[t.owner];
    const ownerCanBeat = sig && parseCard(sig.card).suit === pc.suit &&
      sig.tag === 'highest' && parseCard(sig.card).rank > pc.rank && k.isBoss(sig.card);
    s += ownerCanBeat ? W.FEED * 0.9 : W.FAIL * 0.6;
  }
  // (C') 担当者の強スート（シグナル済）を低リードして勝たせる
  if (!t) {
    for (const x of plan.pending) {
      if (x.owner === me || !plan.tagAllowsNow(x) || plan.locate(x.card) !== 'ME') continue;
      const sig = view.signals[x.owner];
      if (sig && sig.tag === 'highest' && k.isBoss(sig.card) &&
        parseCard(sig.card).suit === pc.suit && pc.rank < parseCard(sig.card).rank) {
        s += W.FEED_SETUP * 0.6;
      }
    }
  }
  // (D) 特殊条件
  const wouldWin = surv > 0.5; // リードが勝ち残るかの粗い判定
  s += modifierWinScore(view, plan, card, wouldWin && (k.isBoss(card) || isComet(card)));
  if (noTricksMe) s += (9 - pc.rank) * 30 - (k.isBoss(card) ? 300 : 0);
  for (const m of view.modifiers) {
    // 最初のトリック指定: 担当者は最強リード、それ以外は最弱リード
    if (m.key === 'first_trick_member' && view.trickNo === 0) {
      if (CHAR_SEAT[m.member] === me) {
        s += isComet(card) ? 350 + pc.rank * 30 : (k.isBoss(card) ? 320 : pc.rank * 12);
      } else {
        s -= pc.rank * 28 + (isComet(card) ? 300 : 0) + (k.isBoss(card) ? 220 : 0);
      }
    }
    // 連勝上限に達している自分のリードはとにかく弱く
    if (m.key === 'max_win_streak') {
      const h = view.history;
      if (h.length >= m.streak && h.slice(-m.streak).every(r => r.winner === me)) {
        s -= pc.rank * 30 + (k.isBoss(card) ? 250 : 0) + (isComet(card) ? 260 : 0);
      }
    }
    // 最後のトリック担当は強い札を温存
    if (m.key === 'last_trick_member' && CHAR_SEAT[m.member] === me && view.trickNo < TRICKS - 1) {
      if (isComet(card) || k.isBoss(card)) s -= 60 + view.trickNo * 18;
    }
    // 彗星縛り: 担当者の彗星リードは温存
    if (m.key === 'task_won_by_comet' && isComet(card) && plan.pending.some(t => t.owner === me)) {
      s -= 250;
    }
  }
  // 未出のおねがい札があるスートを、担当者以外がボスでリードして吸い込まない
  if (!t && !isComet(card) && k.isBoss(card)) {
    for (const x of plan.pending) {
      const tc = parseCard(x.card);
      if (tc.suit === pc.suit && x.owner !== me && k.unseen.includes(x.card)) s -= 200;
    }
  }
  // (E) デフォルト安全リード
  s += (9 - pc.rank) * 3;
  if (isComet(card)) s += W.SPEND_COMET * 2 - pc.rank * 10;
  if (!t && isDangerCard(card, plan, me)) s -= 80;
  if (!t && !isComet(card) && plan.pending.some(x => {
    const tc = parseCard(x.card);
    return tc.suit === pc.suit && x.owner !== me && pc.rank > tc.rank;
  })) s -= 60; // 他人のおねがいスートを上から荒らさない
  return s;
}

// ---- chooseSignal -----------------------------------------------------------
// 返り値: cardId | null。閾値40以上の最初の機会に1回だけ。終盤は緊急係数で発信しやすく。

export function chooseSignal(view) {
  if (!view.canSignal || !view.signalable.length) return null;
  const k = buildKnowledge(view);
  const plan = planTasks(view, k);
  if (!plan.pending.length) return null;
  const tricksLeft = TRICKS - view.trickNo;
  const urgency = tricksLeft <= 4 ? 1.4 : (tricksLeft <= 7 ? 1.1 : 1.0);

  let best = null, bestV = 0;
  for (const card of view.signalable) {
    const t = plan.byCard.get(card);
    const pc = parseCard(card);
    const suitOfPending = plan.pending.some(x => parseCard(x.card).suit === pc.suit);
    // タグは宣言時に自動判定されるためここで再現
    const same = view.hand.filter(c => parseCard(c).suit === pc.suit);
    const tag = same.length === 1 ? 'only'
      : pc.rank === Math.max(...same.map(c => parseCard(c).rank)) ? 'highest' : 'lowest';
    let v = 0;
    if (t && t.owner !== view.me) v = 100;                    // 味方のおねがい札は私が持つ
    else if (t && t.owner === view.me) v = k.isBoss(card) ? 20 : 10;
    else if (tag === 'highest' && k.isBoss(card) &&
      plan.pending.some(x => x.owner === view.me && parseCard(x.card).suit === pc.suit)) v = 70;
    else if (tag === 'only' && suitOfPending) v = 45;
    else if (tag === 'lowest' && pc.rank <= 3 &&
      plan.pending.some(x => parseCard(x.card).suit === pc.suit && x.owner !== view.me)) v = 25;
    v *= urgency;
    if (v > bestV) { best = card; bestV = v; }
  }
  return bestV >= 40 ? best : null;
}
