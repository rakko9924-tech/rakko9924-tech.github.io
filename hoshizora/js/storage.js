// storage.js — 進行状況の保存（localStorage）
const KEY = 'hz-progress-v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

export function getProgress() {
  const d = load();
  return {
    cleared: d.cleared || {},        // { [missionId]: { attempts, clearedAt } }
    attempts: d.attempts || {},      // { [missionId]: n }
    lang: d.lang || 'ja',
    tutorialSeen: !!d.tutorialSeen,
  };
}

export function maxClearedId() {
  const c = getProgress().cleared;
  const ids = Object.keys(c).map(Number);
  return ids.length ? Math.max(...ids) : 0;
}

export function isUnlocked(missionId) {
  return missionId <= maxClearedId() + 1;
}

export function recordAttempt(missionId) {
  const d = load();
  d.attempts = d.attempts || {};
  d.attempts[missionId] = (d.attempts[missionId] || 0) + 1;
  save(d);
}

export function recordClear(missionId) {
  const d = load();
  d.cleared = d.cleared || {};
  if (!d.cleared[missionId]) d.cleared[missionId] = { clearedAt: Date.now() };
  save(d);
}

export function setLang(lang) { const d = load(); d.lang = lang; save(d); }
export function getLang() { return load().lang || 'ja'; }
export function setTutorialSeen() { const d = load(); d.tutorialSeen = true; save(d); }

// ---- ヒントチケット（第6夜で解放・3枚付与。広告1視聴=+1、ストック上限5） ----
const HINT_INIT = 3;
const HINT_MAX = 5;
export function getHints() {
  const d = load();
  return d.hints == null ? HINT_INIT : d.hints;
}
export function consumeHint() {
  const d = load();
  const cur = d.hints == null ? HINT_INIT : d.hints;
  if (cur <= 0) return false;
  d.hints = cur - 1; save(d);
  return true;
}
export function addHints(n) {
  const d = load();
  d.hints = Math.min(HINT_MAX, (d.hints == null ? HINT_INIT : d.hints) + n); save(d);
  return d.hints;
}
export function hintsFull() { return getHints() >= HINT_MAX; }

// ---- 広告削除IAP（正はStoreKit。ここは補助キャッシュ） ----
export function isAdFree() { return !!load().adFree; }
export function setAdFree(v) { const d = load(); d.adFree = !!v; save(d); }

// ---- デイリーチャレンジ ----
export function getDaily() { const d = load(); return d.daily || {}; } // { [dateKey]: 'won'|'tried' }
export function setDaily(dateKey, status) {
  const d = load(); d.daily = d.daily || {};
  if (d.daily[dateKey] !== 'won') d.daily[dateKey] = status;
  save(d);
}
export function dailyStreak(todayKey) {
  const d = load().daily || {};
  let streak = 0;
  const day = new Date(todayKey + 'T00:00:00');
  for (let i = 0; i < 999; i++) {
    const k = day.toISOString().slice(0, 10);
    if (d[k] === 'won') { streak++; day.setDate(day.getDate() - 1); }
    else break;
  }
  return streak;
}
