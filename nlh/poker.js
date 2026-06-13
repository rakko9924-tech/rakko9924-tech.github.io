/* poker.js — トランプ表現と 7枚から最強5枚を判定する評価器
   完全オフライン・依存なしの素朴な実装。
   カードは {r, s} で表す。 r: 2..14 (11=J,12=Q,13=K,14=A), s: 0..3 (s,h,d,c) */

const SUITS = ['s', 'h', 'd', 'c']; // spade, heart, diamond, club
const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR = { s: 'black', c: 'black', h: 'red', d: 'red' };
const RANK_LABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2' };

const HAND_NAME = {
  9: 'ロイヤルフラッシュ',
  8: 'ストレートフラッシュ',
  7: 'フォーカード',
  6: 'フルハウス',
  5: 'フラッシュ',
  4: 'ストレート',
  3: 'スリーカード',
  2: 'ツーペア',
  1: 'ワンペア',
  0: 'ハイカード',
};

function makeDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 2; r <= 14; r++) d.push({ r, s: SUITS[s] });
  }
  return d;
}

// Fisher-Yates。crypto があればより良い乱数を使う。
function shuffle(deck) {
  const a = deck.slice();
  const rnd = (n) => {
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardLabel(c) {
  return RANK_LABEL[c.r] + SUIT_SYMBOL[c.s];
}

/* 5枚のカードを評価し、比較可能な配列を返す。
   返り値: [category, tiebreak1, tiebreak2, ...]  （辞書順で大きいほど強い） */
function rank5(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);

  // 役のためのランク出現数
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  // [出現数, ランク] を 出現数→ランク の順で降順ソート
  const groups = Object.keys(counts)
    .map((r) => [counts[r], parseInt(r, 10)])
    .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));

  // ストレート判定（A-2-3-4-5 のホイールに対応）
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A2345
  }

  if (isFlush && straightHigh) {
    return [straightHigh === 14 ? 9 : 8, straightHigh];
  }
  if (groups[0][0] === 4) {
    return [7, groups[0][1], groups[1][1]];
  }
  if (groups[0][0] === 3 && groups[1][0] === 2) {
    return [6, groups[0][1], groups[1][1]];
  }
  if (isFlush) {
    return [5, ...ranks];
  }
  if (straightHigh) {
    return [4, straightHigh];
  }
  if (groups[0][0] === 3) {
    const kick = ranks.filter((r) => r !== groups[0][1]);
    return [3, groups[0][1], ...kick];
  }
  if (groups[0][0] === 2 && groups[1][0] === 2) {
    const hi = Math.max(groups[0][1], groups[1][1]);
    const lo = Math.min(groups[0][1], groups[1][1]);
    const kick = ranks.find((r) => r !== hi && r !== lo);
    return [2, hi, lo, kick];
  }
  if (groups[0][0] === 2) {
    const kick = ranks.filter((r) => r !== groups[0][1]);
    return [1, groups[0][1], ...kick];
  }
  return [0, ...ranks];
}

function cmpScore(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// 5〜7枚から最強の5枚を選ぶ。{score, name, best:[5枚]} を返す。
function evaluate7(cards) {
  const n = cards.length;
  if (n < 5) throw new Error('evaluate needs at least 5 cards');
  let best = null;
  let bestCombo = null;
  // C(n,5) の全組み合わせ（n は最大7なので総当たりで十分）
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const sc = rank5(combo);
            if (!best || cmpScore(sc, best) > 0) {
              best = sc;
              bestCombo = combo;
            }
          }
  return { score: best, name: HAND_NAME[best[0]], best: bestCombo };
}

window.Poker = { makeDeck, shuffle, cardLabel, evaluate7, cmpScore, SUIT_SYMBOL, SUIT_COLOR, RANK_LABEL, HAND_NAME };
