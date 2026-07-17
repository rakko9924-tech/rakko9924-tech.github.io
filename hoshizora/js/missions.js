// missions.js — 50ミッションのデータ + 特殊条件（modifier）実装
// 文言はすべてオリジナル。{ja,en} 形式。
import { registerModifier, CHAR_SEAT, TRICKS, parseCard, isComet, winnerCardOf } from './engine.js';

// ---- キャラ名（表示用） -----------------------------------------------------
export const CHARS = {
  sora: { emoji: '🐱', name: { ja: 'ソラ', en: 'Sora' } },
  mimi: { emoji: '🐰', name: { ja: 'ミミ', en: 'Mimi' } },
  pen: { emoji: '🐧', name: { ja: 'ペン', en: 'Pen' } },
  koro: { emoji: '🐶', name: { ja: 'コロ', en: 'Koro' } },
};
export const SUIT_INFO = {
  star: { emoji: '★', name: { ja: '星', en: 'Star' } },
  moon: { emoji: '🌙', name: { ja: '月', en: 'Moon' } },
  cloud: { emoji: '☁️', name: { ja: '雲', en: 'Cloud' } },
  wind: { emoji: '🍃', name: { ja: '風', en: 'Wind' } },
  comet: { emoji: '☄️', name: { ja: '彗星', en: 'Comet' } },
};

function seat(member) { return CHAR_SEAT[member]; }
function cname(member) { return CHARS[member].name; }

// ---- 特殊条件の実装（カタログと1:1） ----------------------------------------

registerModifier('no_tricks_member', {
  onTrickResolved(state, rec, m) {
    if (rec.winner === seat(m.member)) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('all_members_win', {
  blocksEarlyWin(state) { return state.tricksWon.some(w => w === 0); },
  onTrickResolved(state, rec, m) {
    const zero = state.tricksWon.filter(w => w === 0).length;
    if (zero > TRICKS - state.trickNo) return { fail: { type: 'modifier', key: m.key, m } };
  },
  atEnd(state, m) {
    if (state.tricksWon.some(w => w === 0)) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('exact_tricks_member', {
  blocksEarlyWin(state, m) { return state.tricksWon[seat(m.member)] < m.count; },
  onTrickResolved(state, rec, m) {
    const w = state.tricksWon[seat(m.member)];
    if (w > m.count) return { fail: { type: 'modifier', key: m.key, m } };
    if (w + (TRICKS - state.trickNo) < m.count) return { fail: { type: 'modifier', key: m.key, m } };
  },
  atEnd(state, m) {
    if (state.tricksWon[seat(m.member)] !== m.count) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('first_trick_member', {
  onTrickResolved(state, rec, m) {
    if (rec.trickNo === 0 && rec.winner !== seat(m.member)) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('last_trick_member', {
  blocksEarlyWin() { return true; }, // 第10トリックまで必ずプレイ
  onTrickResolved(state, rec, m) {
    if (rec.trickNo === TRICKS - 1 && rec.winner !== seat(m.member)) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('max_win_streak', {
  onTrickResolved(state, rec, m) {
    const n = m.streak + 1; // n連勝で失敗
    const h = state.history;
    if (h.length < n) return;
    const lastN = h.slice(-n);
    if (lastN.every(r => r.winner === rec.winner)) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('fewer_tricks_than', {
  blocksEarlyWin(state, m) { return !(state.tricksWon[seat(m.memberA)] < state.tricksWon[seat(m.memberB)]); },
  onTrickResolved(state, rec, m) {
    const a = state.tricksWon[seat(m.memberA)], b = state.tricksWon[seat(m.memberB)];
    if (a >= b + (TRICKS - state.trickNo)) return { fail: { type: 'modifier', key: m.key, m } };
  },
  atEnd(state, m) {
    if (!(state.tricksWon[seat(m.memberA)] < state.tricksWon[seat(m.memberB)])) {
      return { fail: { type: 'modifier', key: m.key, m } };
    }
  },
});

// signal_limit はエンジンの canSignal が直接参照する制約型（失敗判定なし）
registerModifier('signal_limit', {});

registerModifier('no_comet_on_task', {
  onTrickResolved(state, rec, m) {
    const taskInTrick = state.tasks.some(t => rec.plays.some(x => x.card === t.card));
    if (taskInTrick && isComet(winnerCardOf(rec))) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('task_won_by_comet', {
  onTrickResolved(state, rec, m) {
    const taskInTrick = state.tasks.some(t => rec.plays.some(x => x.card === t.card));
    if (taskInTrick && !isComet(winnerCardOf(rec))) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('no_comet_until', {
  // 制約型: 第trickトリック終了まで彗星を出せない（UIとAIは legalCards 経由で自動遵守）
  legalFilter(state, p, cards, m) {
    if (state.trickNo < m.trick) return cards.filter(c => !isComet(c));
    return cards;
  },
});

registerModifier('no_lead_suit', {
  // 制約型: 指定スートをリードできない（スートカードが指定スートのみなら可。彗星リードは常に可）
  legalFilter(state, p, cards, m) {
    if (state.currentTrick.length !== 0) return cards;
    const nonBanned = cards.filter(c => parseCard(c).suit !== m.suit);
    if (nonBanned.some(c => !isComet(c))) return nonBanned;
    return cards;
  },
});

registerModifier('no_win_with_rank', {
  onTrickResolved(state, rec, m) {
    const wc = winnerCardOf(rec);
    if (!isComet(wc) && parseCard(wc).rank === m.rank) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

registerModifier('must_win_with_rank', {
  blocksEarlyWin(state) { return !state.modState.mustWinDone; },
  onTrickResolved(state, rec, m) {
    if (rec.winner === seat(m.member) && parseCard(winnerCardOf(rec)).rank === m.rank) {
      state.modState.mustWinDone = true;
    }
  },
  atEnd(state, m) {
    if (!state.modState.mustWinDone) return { fail: { type: 'modifier', key: m.key, m } };
  },
});

// ---- 特殊条件の表示文言（label=一覧用 / fail=失敗理由） ----------------------

export function modifierText(m) {
  const K = {
    no_tricks_member: () => ({
      ja: `${cname(m.member).ja}は1トリックも取らない`,
      en: `${cname(m.member).en} must not win any tricks`,
    }),
    all_members_win: () => ({
      ja: '全員が1トリック以上取る',
      en: 'Everyone must win at least one trick',
    }),
    exact_tricks_member: () => ({
      ja: `${cname(m.member).ja}はちょうど${m.count}トリック取る`,
      en: `${cname(m.member).en} must win exactly ${m.count} trick${m.count > 1 ? 's' : ''}`,
    }),
    first_trick_member: () => ({
      ja: `最初のトリックは${cname(m.member).ja}が取る`,
      en: `${cname(m.member).en} must win the first trick`,
    }),
    last_trick_member: () => ({
      ja: `最後のトリックは${cname(m.member).ja}が取る`,
      en: `${cname(m.member).en} must win the last trick`,
    }),
    max_win_streak: () => ({
      ja: `同じ隊員が${m.streak + 1}連続でトリックを取ってはいけない`,
      en: `No one may win ${m.streak + 1} tricks in a row`,
    }),
    fewer_tricks_than: () => ({
      ja: `${cname(m.memberA).ja}のトリック数は${cname(m.memberB).ja}より少なくする`,
      en: `${cname(m.memberA).en} must win fewer tricks than ${cname(m.memberB).en}`,
    }),
    signal_limit: () => (m.max === 0
      ? { ja: 'シグナルランプ禁止', en: 'Signal lamps are forbidden' }
      : { ja: `シグナルランプはチームで${m.max}回まで`, en: `The team may use only ${m.max} signal lamp${m.max > 1 ? 's' : ''}` }),
    no_comet_on_task: () => ({
      ja: 'おねがいカードを彗星で取ってはいけない',
      en: 'Promise cards must not be won with a comet',
    }),
    task_won_by_comet: () => ({
      ja: 'おねがいカードは彗星で勝ったトリックでだけ取れる',
      en: 'Promise cards can only be won with a comet',
    }),
    no_comet_until: () => ({
      ja: `第${m.trick}トリックが終わるまで彗星を出せない`,
      en: `No comets may be played before trick ${m.trick + 1}`,
    }),
    no_lead_suit: () => ({
      ja: `${SUIT_INFO[m.suit].name.ja}${SUIT_INFO[m.suit].emoji}をリードできない`,
      en: `${SUIT_INFO[m.suit].name.en} ${SUIT_INFO[m.suit].emoji} may not be led`,
    }),
    no_win_with_rank: () => ({
      ja: `「${m.rank}」のカードでトリックに勝ってはいけない`,
      en: `Tricks must not be won with a ${m.rank}`,
    }),
    must_win_with_rank: () => ({
      ja: `${cname(m.member).ja}は「${m.rank}」のカードでトリックに勝つ`,
      en: `${cname(m.member).en} must win a trick with a ${m.rank}`,
    }),
  };
  return K[m.key] ? K[m.key]() : { ja: m.key, en: m.key };
}

// ---- 50ミッション -----------------------------------------------------------
// area: 10エリア×5面の章立て（マップ表示用）
export const AREAS = [
  { ja: 'はじまりの空', en: 'The First Sky' },
  { ja: '雲の海', en: 'Sea of Clouds' },
  { ja: '月の港', en: 'Port of the Moon' },
  { ja: '港の大仕事', en: 'Harbor Duties' },
  { ja: '流星群', en: 'Meteor Stream' },
  { ja: '流星のただ中', en: 'Heart of the Storm' },
  { ja: '星座の谷', en: 'Constellation Valley' },
  { ja: '谷の試練', en: 'Trials of the Valley' },
  { ja: '夜明け前', en: 'Before the Dawn' },
  { ja: '夜明けの果て', en: 'Edge of Dawn' },
];

const M = (id, title, intro, difficulty, tasks, modifiers = []) => ({ id, title, intro, difficulty, tasks, modifiers });

export const MISSIONS = [
  M(1, { ja: '出発の夜', en: 'Night of Departure' },
    { ja: '今夜、動物探検隊の飛行船ホシカゼ号が町を飛び立つ。手はじめに、星のかけらを一つ集めてみよう。', en: 'Tonight the airship Hoshikaze lifts off. To start, let’s gather a single fallen star.' },
    1, { count: 1, orderedCount: 0, lastTag: false, assign: 'choice' }),
  M(2, { ja: '雲の海をわたって', en: 'Across the Sea of Clouds' },
    { ja: '眼下に広がるのは真っ白な雲の海。波間に落ちた星が二つ、拾われるのを待っている。', en: 'Below lies a white sea of clouds. Two stars wait among the waves to be found.' },
    1, { count: 2, orderedCount: 0, lastTag: false, assign: 'choice' }),
  M(3, { ja: 'ことばの代わりに', en: 'Instead of Words' },
    { ja: '静かな夜の空では声を出せない。シグナルランプの合図だけで、二つのおねがいをかなえよう。', en: 'In the quiet night sky, no one may speak. Grant two promises using only the signal lamps.' },
    1, { count: 2, orderedCount: 0, lastTag: false, assign: 'choice' }),
  M(4, { ja: '道しるべの星', en: 'Guiding Stars' },
    { ja: '道しるべの星は決まった順に灯すもの。順番を間違えると航路が消えてしまう。', en: 'Guiding stars must be lit in order — mix them up and the route disappears.' },
    2, { count: 2, orderedCount: 2, lastTag: false, assign: 'choice' }),
  M(5, { ja: '三つの積み荷', en: 'Three Parcels' },
    { ja: '月の港へ届ける積み荷は三つ。誰が何を運ぶか、ランプで作戦を伝えよう。', en: 'Three parcels bound for the Port of the Moon. Use your lamps to plan who carries what.' },
    2, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' }),
  M(6, { ja: '夜風の地図', en: 'Map on the Night Wind' },
    { ja: '夜風にさらわれた星図の切れはし。つなぎ直す順番が決まっている。', en: 'The night wind scattered pieces of the star map. They must be joined in the right order.' },
    2, { count: 3, orderedCount: 2, lastTag: false, assign: 'choice' }),
  M(7, { ja: 'とっておきは最後', en: 'Save the Best for Last' },
    { ja: '一番大切な荷物は、他の仕事を全部すませてから受け取る決まり。慌てないで。', en: 'The most precious parcel is collected only after every other job is done. No rushing.' },
    2, { count: 2, orderedCount: 0, lastTag: true, assign: 'choice' }),
  M(8, { ja: '星の階段', en: 'Stairway of Stars' },
    { ja: '星の階段は一段ずつしか登れない。三つのおねがいを順番どおりに。', en: 'The stairway of stars is climbed one step at a time. Three promises, in exact order.' },
    3, { count: 3, orderedCount: 3, lastTag: false, assign: 'choice' }),
  M(9, { ja: 'ペンの見張り当番', en: 'Pen on Watch' },
    { ja: '今夜の見張り当番はペン。最初のトリックはペンが取って、航路の安全を確かめる。', en: 'Pen is on watch tonight. Pen takes the first trick to check that the route is safe.' },
    3, { count: 2, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'first_trick_member', member: 'pen' }]),
  M(10, { ja: '港の灯りが見えたら', en: 'Lights of the Port' },
    { ja: '月の港はもう目の前。着岸の合図に、最後のトリックは隊長ソラが取ること。', en: 'The Port of the Moon is in sight. As the docking signal, Sora must take the last trick.' },
    3, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'last_trick_member', member: 'sora' }]),
  M(11, { ja: '月の港の静けさ', en: 'Stillness of the Port' },
    { ja: '月の港では灯りの決まりが厳しい。シグナルランプはチームで1回だけ。', en: 'The port has strict rules about lights. The team may use only one signal lamp.' },
    3, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'signal_limit', max: 1 }]),
  M(12, { ja: '彗星はおやすみ', en: 'Let the Comets Rest' },
    { ja: '長旅で彗星たちはくたくた。おねがいカードの回収を、彗星の力に頼ってはいけない。', en: 'The comets are worn out from the long journey. Don’t rely on them to collect promise cards.' },
    4, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'no_comet_on_task' }]),
  M(13, { ja: 'ねむれ、ながれ星', en: 'Sleep, Shooting Stars' },
    { ja: '港の見張り塔に見つからないように。第3トリックが終わるまで、彗星は手札で眠らせておこう。', en: 'Stay hidden from the watchtower — keep every comet asleep in hand until trick 3 has ended.' },
    4, { count: 3, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'no_comet_until', trick: 3 }]),
  M(14, { ja: 'ミミのお昼寝', en: 'Mimi’s Nap' },
    { ja: '夜ふかし続きのミミがすやすや。ミミを一度も勝たせないまま、そっと仕事を終わらせよう。', en: 'Mimi is fast asleep after too many late nights. Finish the job without letting her win a single trick.' },
    4, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'no_tricks_member', member: 'mimi' }]),
  M(15, { ja: 'そろって荷降ろし', en: 'All Hands Unloading' },
    { ja: '港の荷降ろしは全員参加が決まり。四人とも最低1トリックは取ること。', en: 'Unloading is everyone’s job. All four crew members must win at least one trick.' },
    4, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'all_members_win' }]),
  M(16, { ja: '月あかりの帳簿', en: 'Moonlit Ledger' },
    { ja: '港長さんに提出する帳簿づけ。四つのおねがいのうち二つは、記入する順番が決まっている。', en: 'The harbor master wants the ledger in order — two of the four promises must be entered in sequence.' },
    4, { count: 4, orderedCount: 2, lastTag: false, assign: 'choice' }),
  M(17, { ja: 'コロの配達当番', en: 'Koro’s Delivery Round' },
    { ja: '配達係のコロは、トリックをちょうど2回だけ取る約束。多くても少なくてもやり直しになる。', en: 'Koro the courier must win exactly two tricks — no more, no less.' },
    5, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'exact_tricks_member', member: 'koro', count: 2 }]),
  M(18, { ja: '消灯ラッパ', en: 'Lights Out' },
    { ja: '今夜は港全体が完全消灯。シグナルランプは一度も使えない。', en: 'The whole port goes dark tonight. No signal lamps at all.' },
    5, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'signal_limit', max: 0 }]),
  M(19, { ja: '双子星の約束', en: 'Promise of the Twin Stars' },
    { ja: '双子星にお祈りした夜は、最初のトリックをミミが取る決まり。二つのおねがいは順番どおりに。', en: 'On twin-star nights, Mimi takes the first trick — and two promises must be kept in order.' },
    5, { count: 4, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'first_trick_member', member: 'mimi' }]),
  M(20, { ja: '出港の鐘', en: 'The Departure Bell' },
    { ja: '鐘が鳴ったら月の港とお別れ。最後の荷物は他の仕事の後で、しかも彗星の力は借りずに。', en: 'When the bell rings, we leave the port. The final parcel comes last — and no comets may touch the promises.' },
    5, { count: 4, orderedCount: 0, lastTag: true, assign: 'choice' },
    [{ key: 'no_comet_on_task' }]),
  M(21, { ja: '流星群の入り口', en: 'Edge of the Meteor Stream' },
    { ja: 'ここから流星群の中へ。同じ隊員が3連続でトリックを取ると、舵がぶれてしまう。', en: 'We enter the meteor stream. If anyone wins three tricks in a row, the helm will shake loose.' },
    5, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'max_win_streak', streak: 2 }]),
  M(22, { ja: 'ゆずりあいの空', en: 'A Sky of Taking Turns' },
    { ja: '流れ星が行き交う混雑空域。操縦は交代制、同じ隊員が2連続で取ってはいけない。', en: 'Busy skies tonight. Steering alternates — no one may win two tricks in a row.' },
    6, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'max_win_streak', streak: 1 }]),
  M(23, { ja: 'ペンはひかえめに', en: 'Pen Holds Back' },
    { ja: '今夜のペンは燃料番。ペンのトリック数は、隊長ソラより少なくおさえること。', en: 'Pen is minding the fuel tonight and must finish with fewer tricks than Captain Sora.' },
    6, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'fewer_tricks_than', memberA: 'pen', memberB: 'sora' }]),
  M(24, { ja: 'くじ引き当番', en: 'Duties by Lottery' },
    { ja: '今夜の担当はくじ引きで決まった。誰にどのおねがいが当たるかは、星のみぞ知る。', en: 'Tonight’s duties were drawn by lot. Only the stars know who gets which promise.' },
    6, { count: 4, orderedCount: 0, lastTag: false, assign: 'random' }),
  M(25, { ja: '星くずの通り道', en: 'Path of Stardust' },
    { ja: '星くずの尾を順番にくぐり抜ける。四つのうち三つは、通る順が決まっている。', en: 'We thread the stardust trails one by one — three of the four passages have a fixed order.' },
    6, { count: 4, orderedCount: 3, lastTag: false, assign: 'choice' }),
  M(26, { ja: '黄色い星はそっと', en: 'Gently with the Yellow Stars' },
    { ja: 'まぶしい星の色を先頭に出すと目立ちすぎる。星（黄）のカードをリードしてはいけない。', en: 'Leading with bright starlight would give us away. Star (yellow) cards may not be led.' },
    6, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'no_lead_suit', suit: 'star' }]),
  M(27, { ja: 'じっとがまんの夜', en: 'A Night of Patience' },
    { ja: '流星群のど真ん中では息をひそめて。第5トリックまで彗星は出さず、合図もチームで1回だけ。', en: 'In the heart of the stream we hold our breath: no comets until trick 5 ends, and only one lamp for the team.' },
    7, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'no_comet_until', trick: 5 }, { key: 'signal_limit', max: 1 }]),
  M(28, { ja: '全員で見た流れ星', en: 'A Shooting Star for Everyone' },
    { ja: '全員が1トリック以上取ったら、最後のおねがいをみんなで見届ける。今夜の流れ星は特別だ。', en: 'Everyone wins a trick, then we watch the final promise together. Tonight’s shooting star is special.' },
    7, { count: 4, orderedCount: 0, lastTag: true, assign: 'choice' },
    [{ key: 'all_members_win' }]),
  M(29, { ja: 'ソラの操縦訓練', en: 'Sora’s Flight Test' },
    { ja: '隊長昇格試験の夜。ソラはトリックをちょうど3回取ること。', en: 'Captain’s exam night: Sora must win exactly three tricks.' },
    7, { count: 4, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'exact_tricks_member', member: 'sora', count: 3 }]),
  M(30, { ja: '流星群の出口', en: 'Exit of the Meteor Stream' },
    { ja: '出口の乱気流は今までで一番強い。五つのおねがいを、交代で舵を取りながら。', en: 'The turbulence at the exit is the worst yet. Five promises, with the helm changing hands.' },
    7, { count: 5, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'max_win_streak', streak: 2 }]),
  M(31, { ja: '小さな一番星', en: 'The Littlest Star' },
    { ja: '星座の谷の入り口で試されるのは勇気。ソラは『1』のカードでトリックに勝ってみせよう。', en: 'At the valley gate, courage is tested: Sora must win a trick with a 1.' },
    7, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'must_win_with_rank', member: 'sora', rank: 1 }]),
  M(32, { ja: 'ミミの大一番', en: 'Mimi’s Big Moment' },
    { ja: '谷の番人へのあいさつは堂々と。ミミは『9』のカードでトリックに勝つこと。', en: 'Greet the valley’s keeper with confidence: Mimi must win a trick with a 9.' },
    7, { count: 4, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'must_win_with_rank', member: 'mimi', rank: 9 }]),
  M(33, { ja: 'くじ引きふたたび', en: 'The Lottery Again' },
    { ja: '谷の風がおねがい札を混ぜてしまった。担当はくじ引き、合図はチームで1回だけ。', en: 'The valley wind shuffled the promise cards. Duties by lot, and only one lamp for the team.' },
    7, { count: 4, orderedCount: 0, lastTag: false, assign: 'random' },
    [{ key: 'signal_limit', max: 1 }]),
  M(34, { ja: '9はやさしく', en: 'Gently with the Nines' },
    { ja: '星座の谷では大きな音が禁物。『9』のカードでトリックに勝ってはいけない。', en: 'Loud noises are forbidden in the valley — tricks must not be won with a 9.' },
    8, { count: 4, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'no_win_with_rank', rank: 9 }]),
  M(35, { ja: '静かな階段', en: 'The Silent Stairs' },
    { ja: '声もランプも無しで、三つの順番をそろえる。仲間の心を読む夜。', en: 'No voices, no lamps — three promises in order, guided only by trust.' },
    8, { count: 5, orderedCount: 3, lastTag: false, assign: 'choice' },
    [{ key: 'signal_limit', max: 0 }]),
  M(36, { ja: '彗星の腕くらべ', en: 'Trial of Comets' },
    { ja: '番人の出す課題は彗星さばき。おねがいカードは、彗星で勝ったトリックでしか回収できない。', en: 'The keeper’s challenge: promise cards may only be collected in tricks won by a comet.' },
    8, { count: 2, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'task_won_by_comet' }]),
  M(37, { ja: 'コロはお留守番', en: 'Koro Sits Out' },
    { ja: 'ひざをすりむいたコロは今夜は見学。最初のトリックはペンが取って、コロを安心させよう。', en: 'Koro scraped a knee and watches tonight. Pen takes the first trick to put him at ease.' },
    8, { count: 5, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'no_tricks_member', member: 'koro' }, { key: 'first_trick_member', member: 'pen' }]),
  M(38, { ja: '月の色をさけて', en: 'Avoiding the Moon’s Color' },
    { ja: '今夜の月は少しご機嫌ななめ。月（青）のカードをリードしてはいけない。', en: 'The moon is a little moody tonight. Moon (blue) cards may not be led.' },
    8, { count: 5, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'no_lead_suit', suit: 'moon' }]),
  M(39, { ja: '番人の最終問題', en: 'The Keeper’s Final Riddle' },
    { ja: '星座の番人が出す最後の問題。順番を守り、締めくくりを飾り、彗星には頼らない。', en: 'The keeper’s last riddle: keep the order, save the finale, and never lean on comets.' },
    9, { count: 4, orderedCount: 2, lastTag: true, assign: 'choice' },
    [{ key: 'no_comet_on_task' }]),
  M(40, { ja: '谷を抜ける翼', en: 'Wings Through the Valley' },
    { ja: '谷の出口へ全速前進。六つのおねがいを、交代の舵と1回きりの合図で。', en: 'Full speed to the valley’s exit — six promises, a rotating helm, and a single lamp.' },
    9, { count: 6, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'max_win_streak', streak: 2 }, { key: 'signal_limit', max: 1 }]),
  M(41, { ja: '夜明け前の暗さ', en: 'Darkest Before Dawn' },
    { ja: '夜が一番深くなる時間。ランプは封印して、まずは隊長ソラが先陣を切る。', en: 'The deepest hour of night. Lamps are sealed, and Captain Sora leads the charge.' },
    9, { count: 6, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'signal_limit', max: 0 }, { key: 'first_trick_member', member: 'sora' }]),
  M(42, { ja: '四人の歯車', en: 'Four Gears Turning' },
    { ja: '四人の力がかみ合わないと、夜明けにはたどり着けない。全員1トリック以上、舵は交代で。', en: 'Only four gears turning together reach the dawn: everyone wins a trick, and the helm keeps changing.' },
    9, { count: 6, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'all_members_win' }, { key: 'max_win_streak', streak: 2 }]),
  M(43, { ja: 'くじ引き大作戦', en: 'The Great Lottery Gambit' },
    { ja: '担当はくじ引き、彗星の力もおねがいには使えない。それでも隊は進む。', en: 'Duties by lot, and comets barred from the promises. Still, the expedition presses on.' },
    9, { count: 4, orderedCount: 2, lastTag: false, assign: 'random' },
    [{ key: 'no_comet_on_task' }]),
  M(44, { ja: 'ちょうどよい風', en: 'Just the Right Wind' },
    { ja: '帆のバランスは繊細だ。ミミもペンも、ちょうど2トリックずつで支えること。', en: 'The sails balance on a knife’s edge: Mimi and Pen must each win exactly two tricks.' },
    9, { count: 5, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'exact_tricks_member', member: 'mimi', count: 2 }, { key: 'exact_tricks_member', member: 'pen', count: 2 }]),
  M(45, { ja: '彗星の帰り道', en: 'The Comets’ Road Home' },
    { ja: '三つのおねがいは、すべて彗星の力で勝ち取る。長い旅の締めくくりだ。', en: 'All three promises must be won by comet — the finale of a long journey.' },
    9, { count: 3, orderedCount: 0, lastTag: false, assign: 'choice' },
    [{ key: 'task_won_by_comet' }]),
  M(46, { ja: '星の大階段', en: 'The Grand Stairway' },
    { ja: '夜明けへ続く大階段が現れた。六つのおねがいのうち四つは、順番どおりに登ること。', en: 'The grand stairway to dawn appears. Four of the six promises must be climbed in order.' },
    10, { count: 6, orderedCount: 4, lastTag: false, assign: 'choice' }),
  M(47, { ja: '音のない大仕事', en: 'The Great Silent Task' },
    { ja: '七つのおねがいを、ランプの合図なしでやり遂げる。信じるのは仲間の呼吸だけ。', en: 'Seven promises with no lamps at all — nothing to trust but each other’s rhythm.' },
    10, { count: 7, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'signal_limit', max: 0 }]),
  M(48, { ja: '一番長い夜', en: 'The Longest Night' },
    { ja: '夜明け前の最難関。彗星は第4トリックまで温存し、舵は交代で取り続ける。', en: 'The final gauntlet: comets rest until trick 4 has ended, and the helm must keep changing.' },
    10, { count: 7, orderedCount: 3, lastTag: false, assign: 'choice' },
    [{ key: 'no_comet_until', trick: 4 }, { key: 'max_win_streak', streak: 2 }]),
  M(49, { ja: '大きな星は鳴らさずに', en: 'Never Ring the Great Stars' },
    { ja: '夜明け直前の静けさを守って。『9』で勝たずに、最後のおねがいまでたどり着こう。', en: 'Guard the stillness before dawn: reach the final promise without ever winning with a 9.' },
    10, { count: 5, orderedCount: 2, lastTag: false, assign: 'choice' },
    [{ key: 'no_win_with_rank', rank: 9 }]),
  M(50, { ja: '夜明けの果てへ', en: 'To the Edge of Dawn' },
    { ja: '探検隊、最後の大仕事。七つのおねがいをかなえた時、ホシカゼ号は夜明けの果てに着く。', en: 'The expedition’s last great task: grant all seven promises, and the Hoshikaze reaches the edge of dawn.' },
    10, { count: 7, orderedCount: 2, lastTag: true, assign: 'choice' },
    []),
];

export function missionById(id) { return MISSIONS.find(m => m.id === id); }
