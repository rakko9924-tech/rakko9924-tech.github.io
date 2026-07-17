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
