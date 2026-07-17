// i18n.js — 日英文字列（既定は日本語）
import { getLang, setLang } from './storage.js';

export const STR = {
  appTitle: { ja: 'ほしぞら探検隊', en: 'Starlight Expedition' },
  subtitle: { ja: 'みんなで挑む 協力カードゲーム', en: 'A cooperative trick-taking adventure' },
  start: { ja: '冒険に出発', en: 'Set Sail' },
  howto: { ja: 'あそびかた', en: 'How to Play' },
  settings: { ja: '設定', en: 'Settings' },
  missionSelect: { ja: 'ミッション', en: 'Missions' },
  mission: { ja: 'ミッション', en: 'Mission' },
  tasks: { ja: 'おねがい', en: 'Promises' },
  signalLamp: { ja: 'シグナルランプ', en: 'Signal Lamp' },
  signalUsed: { ja: 'ランプ使用済み', en: 'Lamp used' },
  signalPick: { ja: '見せるカードを選んでください', en: 'Choose a card to show' },
  signalNone: { ja: '今は見せられるカードがありません', en: 'No card can be shown now' },
  tagHighest: { ja: 'この色でいちばん強い', en: 'Highest of this color' },
  tagLowest: { ja: 'この色でいちばん弱い', en: 'Lowest of this color' },
  tagOnly: { ja: 'この色はこれ1枚だけ', en: 'Only one of this color' },
  yourTurn: { ja: 'あなたの番です', en: 'Your turn' },
  missionStart: { ja: 'ミッション開始', en: 'Mission Start' },
  missionClear: { ja: 'ミッション成功！', en: 'Mission Complete!' },
  missionFail: { ja: 'ざんねん…', en: 'Not this time…' },
  retry: { ja: 'もう一度', en: 'Retry' },
  next: { ja: 'つぎのミッションへ', en: 'Next Mission' },
  backToMap: { ja: 'ミッション一覧へ', en: 'Back to Missions' },
  ok: { ja: 'OK', en: 'OK' },
  close: { ja: 'とじる', en: 'Close' },
  cancel: { ja: 'キャンセル', en: 'Cancel' },
  se: { ja: '効果音', en: 'Sound Effects' },
  lang: { ja: '言語 / Language', en: 'Language' },
  cleared: { ja: 'クリア', en: 'Clear' },
  locked: { ja: '未開放', en: 'Locked' },
  commander: { ja: '隊長', en: 'Captain' },
  trick: { ja: 'トリック', en: 'Trick' },
  taskStolen: { ja: 'のおねがいカードを別の隊員が取ってしまった…', en: "'s promise card was taken by someone else…" },
  orderViolation: { ja: 'おねがいの順番を守れなかった…', en: 'The promises were completed out of order…' },
  lastViolation: { ja: '「最後」のおねがいを最後にできなかった…', en: "The 'last' promise wasn't completed last…" },
  tasksIncomplete: { ja: '10トリックでは足りなかった…', en: 'Ran out of tricks…' },
  attempts: { ja: '挑戦回数', en: 'Attempts' },
  hint: { ja: 'ヒント', en: 'Hint' },
  hintReco: { ja: 'おすすめの札はこれ！', en: 'This is the best card!' },
  hintEmpty: { ja: 'ヒントがなくなりました', en: 'Out of hints' },
  hintWatch: { ja: '広告を見てヒントを1回ふやす', en: 'Watch an ad for 1 more hint' },
  hintGot: { ja: 'ヒントがふえました！', en: 'You got a hint!' },
  revenge: { ja: '同じ配札でリベンジ', en: 'Revenge with the same deal' },
  revengeAd: { ja: '▶ 同じ配札でリベンジ（広告）', en: '▶ Same deal revenge (ad)' },
  skipNight: { ja: '▶ 流れ星に乗って次の夜へ（広告）', en: '▶ Ride a shooting star to the next night (ad)' },
  reward2x: { ja: '▶ 報酬2倍（広告）', en: '▶ Double reward (ad)' },
  gotTicket: { ja: 'ヒント券を手に入れた！', en: 'Got a hint ticket!' },
  hintNotTurn: { ja: 'あなたの番に使えます', en: 'Use it on your turn' },
  daily: { ja: '今日の挑戦', en: 'Daily Challenge' },
  dailyDesc: { ja: '毎日かわる特別な配札に挑戦しよう', en: 'A special deal that changes every day' },
  dailyClear: { ja: '今日の挑戦 達成！', en: 'Daily Challenge complete!' },
  dailyDone: { ja: '今日はクリアずみ', en: 'Cleared today' },
  streak: { ja: '連続', en: 'streak' },
  later: { ja: 'あとで', en: 'Later' },
};

let lang = 'ja';
export function initLang() { lang = getLang(); document.documentElement.lang = lang; }
export function currentLang() { return lang; }
export function switchLang(l) { lang = l; setLang(l); document.documentElement.lang = l; }
export function t(key) {
  const e = STR[key];
  if (!e) return key;
  return e[lang] || e.ja;
}
// ミッションデータ等の {ja,en} オブジェクト用
export function tt(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] || obj.ja || '';
}
