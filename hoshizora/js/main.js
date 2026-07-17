// main.js — 星空探検隊 UIコントローラ
import {
  newGame, currentPlayer, legalCards, playCard, playSignal,
  canSignal, signalableCards, signalTag, makeView, parseCard, isComet,
  SEAT_CHAR, CHAR_SEAT, TRICKS,
} from './engine.js';
import { MISSIONS, AREAS, CHARS, SUIT_INFO, modifierText, missionById } from './missions.js';
import { chooseCard, chooseSignal, optimizeAssignment } from './ai.js';
import { suitGlyph, charSVG, airshipSVG, lampSVG } from './art.js';
import { initSfx, resumeAudio, play, playWinJingle, playTaskDone, playFail, setSfxEnabled, sfxEnabled } from './sfx.js';
import { initLang, currentLang, switchLang, t, tt } from './i18n.js';
import * as store from './storage.js';
import { initAds, showInterstitial, showRewardAd, showBanner, hideBanner } from './ads.js';
import { initIAP, buyRemoveAds, restorePurchases, iapAvailable } from './iap.js';
import {
  connectRoom, disconnectRoom, sendStart, sendAct, sendEnd,
  makeRoomCode, seatsOnline,
} from './online.js';

const app = document.getElementById('app');
const fxLayer = document.getElementById('fx-layer');
const toastEl = document.getElementById('toast');

let state = null;      // 現在のゲーム状態
let curMission = null; // 現在のミッション定義
let attemptSeed = 1;   // リトライ用シード
let busy = false;      // AI処理中などのロック
let lifted = null;     // 手札で持ち上げ中のカード
let pendingLeaderTimer = null;
let hintCard = null;   // ヒントでおすすめ中の札
let isDailyRun = false; // デイリーチャレンジ中か
let clearsThisSession = 0; // インタースティシャル頻度制御
let lastAdAt = 0;          // 直近の全画面広告時刻（120秒クールダウン）
let revengeUsed = false;   // 「同じ配札でリベンジ」は1配札1回まで
let failsThisMission = 0;  // 同じ夜の連続失敗数（3回で救済スキップ提示）
// ---- オンライン協力（決定論ロックステップ） ----
let mySeat = 0;                    // 自分の席（オフライン=0）
let online = false;                // オンライン対戦中か
let humanSeats = new Set([0]);     // 人間が操作する席（離席でAIに切替）
let netQueue = [];                 // サーバから届いた手のキュー（適用はstep経由で決定論順）
let awaitingEcho = false;          // 自分の手のエコー待ち
let animating = false;             // 演出中（pumpKickの再入防止）
let aiTimer = null;                // AI手番の遅延タイマー
let roomCode = null;               // 参加中のルームコード
let lobbySel = 1;                  // ロビーのミッション選択
let aiSigTrick = -1;               // AIシグナルを実行済みのトリック番号（決定論順の固定）
let runId = 0;                     // ゲーム世代トークン（旧ゲームの残タイマー発火を無効化）
let dailyFirstWin = false;         // 今日はじめてのデイリー勝利か（報酬の重複防止）

// 座席→盤面スロット位置（自席が常に下になるよう回転）
function posOf(seatIdx) { return (seatIdx - mySeat + 4) % 4; }

// ---- 起動 -------------------------------------------------------------------

async function boot() {
  initLang();
  buildStars();
  // ストアスクショ撮影用フック（?shot=title|play|map|lobby|result [&lang=en]）
  const q = new URLSearchParams(location.search);
  if (q.get('shot')) { shotMode(q.get('shot'), q.get('lang') || 'ja'); return; }
  showTitle();
  await initSfx();
  initAds();
  initIAP();
  // 広告削除購入者への毎日ヒント1枚（IAP特典）
  try {
    if (store.isAdFree()) {
      const k = 'hz-freehint-' + todayKey();
      if (!localStorage.getItem(k)) { localStorage.setItem(k, '1'); store.addHints(1); }
    }
  } catch (e) {}
}

function buildStars() {
  const bg = document.getElementById('stars-bg');
  let html = '';
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * 100, y = Math.random() * 100;
    const size = 8 + Math.random() * 12, delay = Math.random() * 4;
    html += `<span class="s" style="left:${x}%;top:${y}%;font-size:${size}px;animation-delay:${delay}s">✦</span>`;
  }
  bg.innerHTML = html;
}

// ---- スクショ撮影モード（ストア用。決定論の静止画面を組み立てる） -------------

function shotMode(kind, lang) {
  switchLang(lang);
  document.documentElement.classList.add('shot-mode');
  if (kind === 'title') { showTitle(); return; }
  if (kind === 'iap') {
    // IAP審査用スクショ: 購入行が見える設定画面（Capacitor/StoreKitを疑似有効化）
    window.Capacitor = { isNativePlatform: () => true };
    window.CdvPurchase = {};
    showSettings(); return;
  }
  if (kind === 'map') {
    try {
      const cleared = {}; for (let i = 1; i <= 11; i++) cleared[i] = { clearedAt: 1 };
      localStorage.setItem('hz-progress-v1', JSON.stringify({ cleared, attempts: {}, lang }));
    } catch (e) {}
    showMap(); return;
  }
  if (kind === 'lobby') {
    roomCode = 'MIMI'; mySeat = 0; lobbySel = 12;
    // seatsOnline はネットワーク由来なのでローカル描画用に上書きできないため、
    // showLobby と同等の画面を直接組み立てる代わりに seats を偽装する
    window.__shotSeats = [true, true, true, false];
    showLobby(); return;
  }
  if (kind === 'play' || kind === 'result') {
    curMission = missionById(12);
    isDailyRun = false;
    aiSigTrick = -1;
    state = newGame(curMission, 777003);
    optimizeAssignment(state);
    if (kind === 'play') {
      // 2トリック+2手だけ決定論で進める（場に2枚ある状態で止める）
      for (let i = 0; i < 10; i++) {
        if (state.currentTrick.length === 0) doAISignals();
        playCard(state, currentPlayer(state), chooseCard(makeView(state, currentPlayer(state))));
      }
      showPlay();
      busy = false; renderAll();
      return;
    }
    // result: 勝利画面
    state.status = 'won';
    state.tasks.forEach(tk => { tk.done = true; });
    showResult(true);
    return;
  }
  showTitle();
}

// ---- 画面遷移 ---------------------------------------------------------------

function setScreen(html, cls = '') {
  cancelPendingLeader();
  app.innerHTML = `<section class="screen ${cls}">${html}</section>`;
  const el = app.querySelector('.screen');
  // rAF is throttled in background tabs; setTimeout fires regardless so screens always reveal.
  setTimeout(() => el.classList.add('active'), 24);
  return el;
}

// ---- タイトル ---------------------------------------------------------------

function showTitle() {
  const maxId = store.maxClearedId();
  const cont = maxId > 0 && maxId < 50;
  const contLabel = cont
    ? (currentLang() === 'ja' ? `つづきから（第${maxId + 1}夜）` : `Continue (Night ${maxId + 1})`)
    : t('start');
  const s = setScreen(`
    <div class="title-art"></div>
    <div class="title-body">
      <div class="logo">ほしぞら探検隊<span class="en">STARLIGHT EXPEDITION</span></div>
      <div class="title-btns">
        <button class="btn primary" id="b-start">${contLabel}</button>
        <button class="btn daily-btn" id="b-daily">
          <span class="d-ic">${dailyCleared() ? '✅' : '☀️'}</span>${t('daily')}
          ${dailyStreakLabel()}
        </button>
        <button class="btn" id="b-online">🤝 ${t('online')}</button>
        <button class="btn" id="b-map">${t('missionSelect')}</button>
        <div class="btn-row">
          <button class="btn ghost" id="b-howto">${t('howto')}</button>
          <button class="btn ghost" id="b-settings">${t('settings')}</button>
        </div>
      </div>
      <div class="version">v0.1</div>
    </div>
  `, 'title-screen');
  s.querySelector('#b-start').onclick = () => { tap(); startMission((cont ? maxId + 1 : 1)); };
  s.querySelector('#b-daily').onclick = () => { tap(); startDaily(); };
  s.querySelector('#b-online').onclick = () => { tap(); showOnlineMenu(); };
  s.querySelector('#b-map').onclick = () => { tap(); showMap(); };
  s.querySelector('#b-howto').onclick = () => { tap(); showHowto(false); };
  s.querySelector('#b-settings').onclick = () => { tap(); showSettings(); };
}

// ---- ミッション選択（マップ） -----------------------------------------------

function showMap() {
  const maxCleared = store.maxClearedId();
  const prog = store.getProgress();
  const clearedCount = Object.keys(prog.cleared).length;
  const ja = currentLang() === 'ja';
  // 星座チャート: 各夜をジグザグに配置し、点線の航路でつなぐ
  let sections = '';
  for (let a = 0; a < 10; a++) {
    let beads = '';
    for (let j = 1; j <= 5; j++) {
      const id = a * 5 + j;
      const m = missionById(id);
      const cleared = !!prog.cleared[id];
      const unlocked = store.isUnlocked(id);
      const current = unlocked && !cleared && id === maxCleared + 1;
      const cls = cleared ? 'cleared' : (unlocked ? (current ? 'current' : 'open') : 'locked');
      const side = (id % 2 === 1) ? 'left' : 'right';
      beads += `<div class="cnode ${cls} ${side}" data-id="${id}" data-unlocked="${unlocked}">
        <div class="bead">${cleared ? starSVG() : (unlocked ? starSVG('hollow') : lockSVG())}<span class="bnum">${id}</span>
          ${current ? `<div class="here">${airshipSVG()}</div>` : ''}</div>
        <div class="binfo"><div class="bt">${tt(m.title)}</div><div class="bs">${cleared ? '✦ ' + t('cleared') : (unlocked ? subLabel(m) : t('locked'))}</div></div>
      </div>`;
    }
    sections += `<div class="cregion" data-area="${a}"><div class="cregion-name"><span>${tt(AREAS[a])}</span></div>
      <div class="cbeads">${beads}</div></div>`;
  }
  const s = setScreen(`
    <div class="hdr"><button class="icon-btn" id="b-back">‹</button>
      <div class="title">${t('missionSelect')}</div><span class="progress-pill">✦ ${clearedCount}/50</span></div>
    <div class="map-progress"><div class="map-bar"><i style="width:${clearedCount / 50 * 100}%"></i></div></div>
    <div class="map-scroll"><div class="constellation"><svg class="const-lines" preserveAspectRatio="none"></svg>${sections}</div></div>
  `, 'map-screen');
  s.querySelector('#b-back').onclick = () => { back(); showTitle(); };
  s.querySelectorAll('.cnode').forEach(n => {
    n.onclick = () => {
      const id = +n.dataset.id;
      if (n.dataset.unlocked !== 'true') { tap(); toast(ja ? '前の夜をクリアしよう' : 'Clear the previous night first'); n.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 }); return; }
      tap(); showMissionSheet(id);
    };
  });
  if (!store.isAdFree()) showBanner();
  requestAnimationFrame(() => { drawConstellation(s, maxCleared); scrollToCurrent(s); });
  window.addEventListener('resize', () => drawConstellation(s, maxCleared), { once: true });
}

function drawConstellation(s, maxCleared) {
  const cont = s.querySelector('.constellation');
  const svg = s.querySelector('.const-lines');
  if (!cont || !svg) return;
  const beads = [...s.querySelectorAll('.cnode .bead')];
  const cr = cont.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${cr.width} ${cr.height}`);
  svg.setAttribute('width', cr.width); svg.setAttribute('height', cr.height);
  const pts = beads.map(b => { const r = b.getBoundingClientRect(); return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2, id: +b.closest('.cnode').dataset.id }; });
  let dTraveled = '', dAhead = '';
  for (let i = 1; i < pts.length; i++) {
    const seg = `M${pts[i - 1].x} ${pts[i - 1].y} L${pts[i].x} ${pts[i].y} `;
    if (pts[i].id <= maxCleared + 1) dTraveled += seg; else dAhead += seg;
  }
  svg.innerHTML = `<path d="${dAhead}" class="cl-ahead"/><path d="${dTraveled}" class="cl-done"/>`;
}

function scrollToCurrent(s) {
  const cur = s.querySelector('.cnode.current') || s.querySelector('.cnode.locked');
  if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
}

function starSVG(kind) {
  return `<svg class="bead-star ${kind || 'fill'}" viewBox="0 0 32 32">${'<path d="M16 3.2c.55 0 1.05.33 1.27.85l2.83 6.66 7.2.62c1.16.1 1.63 1.55.75 2.31l-5.47 4.72 1.65 7.04c.26 1.13-.96 2.02-1.96 1.42L16 23.02l-6.26 3.82c-1 .6-2.22-.29-1.96-1.42l1.65-7.04-5.47-4.72c-.88-.76-.41-2.21.75-2.31l7.2-.62 2.83-6.66c.22-.52.72-.85 1.27-.85z"/>'}</svg>`;
}
function lockSVG() {
  return `<svg class="bead-lock" viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1zm2 0h6V8a3 3 0 0 0-6 0v2z" fill="currentColor"/></svg>`;
}

function dailyCleared() { return store.getDaily()[todayKey()] === 'won'; }
function dailyStreakLabel() {
  const st = store.dailyStreak(todayKey());
  if (st <= 0) return '';
  return `<span class="d-streak">🔥${st}</span>`;
}

function subLabel(m) {
  const n = m.tasks.count;
  const ja = currentLang() === 'ja';
  let parts = [ja ? `おねがい${n}` : `${n} promises`];
  if (m.tasks.orderedCount) parts.push(ja ? '順番指定' : 'ordered');
  if (m.modifiers && m.modifiers.length) parts.push(ja ? '特別ルール' : 'special');
  return parts.join(' · ');
}

// ---- ミッション開始シート ---------------------------------------------------

function showMissionSheet(id) {
  const m = missionById(id);
  const ja = currentLang() === 'ja';
  const mods = (m.modifiers || []).map(x => `<div class="mod-line"><span class="ic">◆</span><span>${tt(modifierText(x))}</span></div>`).join('');
  const tagInfo = [];
  if (m.tasks.orderedCount) tagInfo.push(ja ? `${m.tasks.orderedCount}枚は順番指定` : `${m.tasks.orderedCount} ordered`);
  if (m.tasks.lastTag) tagInfo.push(ja ? '「最後」指定あり' : 'has a "last"');
  if (m.tasks.assign === 'random') tagInfo.push(ja ? '担当はランダム' : 'random duties');
  const html = `
    <div class="overlay show center-mode" id="ov">
      <div class="sheet center">
        <div style="text-align:center;font-size:12px;color:var(--c-ink-sub);font-weight:700">${ja ? '第' + id + '夜' : 'Night ' + id}</div>
        <h2>${tt(m.title)}</h2>
        <p class="intro">${tt(m.intro)}</p>
        <div style="text-align:center;font-size:13px;color:var(--c-ink-sub)">${ja ? 'おねがい' : 'Promises'} ${m.tasks.count}${tagInfo.length ? ' · ' + tagInfo.join(' · ') : ''}</div>
        <div class="mods">${mods}</div>
        <div class="sheet-btns">
          <button class="btn ghost" id="b-cancel">${t('cancel')}</button>
          <button class="btn primary" id="b-go">${ja ? '出発する' : 'Set Off'}</button>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  app.appendChild(wrap.firstElementChild);
  const ov = document.getElementById('ov');
  ov.querySelector('#b-cancel').onclick = () => { tap(); ov.remove(); };
  ov.querySelector('#b-go').onclick = () => { tap(); ov.remove(); startMission(id); };
}

// ---- ミッション開始 ---------------------------------------------------------

function startMission(id) {
  isDailyRun = false;
  curMission = missionById(id);
  attemptSeed = (id * 100000 + Date.now() % 90000) >>> 0;
  failsThisMission = 0;
  newDeal();
}

// ---- デイリーチャレンジ（日替わり固定配札。全員同じ問題に挑む） ---------------

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function dailyMission(key) {
  const h = hashStr(key);
  const count = 3 + (h % 3); // 3〜5
  const ordered = ((h >> 4) % 2 === 0) ? 0 : Math.min(2, count - 1);
  const MODS = [[], [], [{ key: 'signal_limit', max: 1 }], [{ key: 'no_comet_on_task' }],
    [{ key: 'max_win_streak', streak: 2 }], [{ key: 'all_members_win' }]];
  return {
    id: 'daily',
    title: { ja: '今日の挑戦', en: 'Daily Challenge' },
    intro: {
      ja: '今夜だけの特別な配札。同じ夜空の下、みんなが同じ問題に挑んでいる。',
      en: 'A special deal for tonight only — everyone faces the same sky.',
    },
    difficulty: 5,
    tasks: { count, orderedCount: ordered, lastTag: false, assign: 'choice' },
    modifiers: MODS[(h >> 8) % MODS.length],
  };
}

function startDaily() {
  isDailyRun = true;
  curMission = dailyMission(todayKey());
  attemptSeed = hashStr('hz-daily-' + todayKey());
  store.setDaily(todayKey(), 'tried');
  newDeal();
}

function newDeal() {
  if (!isDailyRun) {
    store.recordAttempt(curMission.id);
    attemptSeed = (attemptSeed * 1103515245 + 12345) >>> 0; // リトライは配り直し
  } // デイリーはシード固定＝同じ配札に再挑戦
  revengeUsed = false;
  runId++;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  animating = false; lifted = null; hintCard = null;
  aiSigTrick = -1;
  state = newGame(curMission, attemptSeed);
  optimizeAssignment(state); // 作戦会議（担当最適化）
  showIntroAnim();
}

// 「同じ配札でリベンジ」: シードを進めず同じ夜を再開（前回の失敗で得た情報が活きる）
function redealSame() {
  runId++;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  animating = false; lifted = null; hintCard = null;
  aiSigTrick = -1;
  state = newGame(curMission, attemptSeed);
  optimizeAssignment(state);
  showIntroAnim();
}

// 配札→おねがい割当の演出（簡易）
function showIntroAnim() {
  const ja = currentLang() === 'ja';
  const taskRows = state.tasks.map(tk => {
    const c = parseCard(tk.card);
    const owner = SEAT_CHAR[tk.owner];
    return `<div class="assign-row">
      ${chipHTML(tk)}<span class="arrow">→</span>${charMini(owner)}<span class="own-name">${tt(CHARS[owner].name)}</span></div>`;
  }).join('');
  const cmdr = SEAT_CHAR[state.commander];
  const html = `
    <div class="overlay show center-mode" id="ov-intro">
      <div class="sheet center">
        <div style="text-align:center;font-size:12px;color:var(--c-ink-sub);font-weight:700">${isDailyRun ? '☀️ ' + t('daily') : (ja ? '第' + curMission.id + '夜' : 'Night ' + curMission.id)}</div>
        <h2>${t('missionStart')}</h2>
        <p class="intro" style="margin-bottom:10px">${ja ? 'おねがいの担当' : 'Promise assignments'}</p>
        <div>${taskRows}</div>
        <div class="commander-line">${cardHTML('comet-4', false, false)}<span>→</span>${charMini(cmdr)} <b>${tt(CHARS[cmdr].name)}</b> ${ja ? 'が隊長' : 'is the Captain'} 👑</div>
        <div class="sheet-btns"><button class="btn primary" id="b-launch">${ja ? '出発！' : 'Launch!'}</button></div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  app.appendChild(wrap.firstElementChild);
  play('deal');
  document.getElementById('b-launch').onclick = () => {
    tap(); document.getElementById('ov-intro').remove(); showPlay(); startLoop();
  };
}

// ---- プレイ画面 -------------------------------------------------------------

function showPlay() {
  setScreen(`
    <div class="hdr">
      <button class="icon-btn" id="b-menu">≡</button>
      <div class="title">${isDailyRun ? '☀️ ' + t('daily') : (currentLang() === 'ja' ? '第' + curMission.id + '夜' : 'Night ' + curMission.id)}</div>
      <span class="progress-pill" id="trick-count"></span>
    </div>
    <div class="crew-row" id="crew-row"></div>
    <div class="board">
      <div class="lead-bar" id="lead-bar"></div>
      <div class="trick-slots" id="trick-slots">
        <div class="slot p2"><div class="ph"></div></div>
        <div class="slot p1"><div class="ph"></div></div>
        <div class="slot p3"><div class="ph"></div></div>
        <div class="slot p0"><div class="ph"></div></div>
      </div>
    </div>
    <div class="my-area">
      <div class="my-tasks" id="my-tasks"></div>
      <div class="hand-wrap">
        <div class="hand" id="hand"></div>
        <button class="lamp-fab" id="lamp-fab" aria-label="signal lamp">${lampSVG()}</button>
        <button class="hint-fab" id="hint-fab" aria-label="hint">✨<span class="hint-count" id="hint-count"></span></button>
      </div>
    </div>
  `, 'play-screen');
  hideBanner();
  document.getElementById('b-menu').onclick = openPauseMenu;
  document.getElementById('lamp-fab').onclick = onLampTap;
  document.getElementById('hint-fab').onclick = onHintTap;
  renderAll();
}

function renderAll() {
  renderCrew();
  renderBoard();
  renderHand();
  renderMyTasks();
  renderLamp();
  const tc = document.getElementById('trick-count');
  if (tc) tc.textContent = `${t('trick')} ${Math.min(state.trickNo + 1, TRICKS)}/${TRICKS}`;
}

function renderCrew() {
  const row = document.getElementById('crew-row');
  if (!row) return;
  const cp = currentPlayer(state);
  let html = '';
  for (let i = 1; i <= 3; i++) { // 自分以外の3席（自席の次から時計回り）
    const p = (mySeat + i) % 4;
    const ch = SEAT_CHAR[p];
    const tasks = state.tasks.filter(tk => tk.owner === p);
    const chips = tasks.map(tk => chipHTML(tk)).join('');
    const sig = state.signals[p];
    const lamp = sig ? `<span class="lamp-mini">${lampSVG('on')}</span>${miniChip(sig.card)}<span class="tag-tok ${sig.tag}">${tagIcon(sig.tag)}</span>` : '';
    const humanBadge = online && humanSeats.has(p) ? '<span class="pbadge">P</span>' : '';
    html += `<div class="crew c-${ch} ${cp === p ? 'active' : ''} ${cp === p && state.status === 'playing' ? 'thinking' : ''}">
      <div class="ava">${charImg(ch)}${state.leader === p ? '<span class="crown">👑</span>' : ''}${humanBadge}</div>
      <div class="nm">${tt(CHARS[ch].name)}</div>
      <div class="tasks">${chips}</div>
      <div class="lamp-slot">${lamp}</div>
    </div>`;
  }
  row.innerHTML = html;
}

function renderBoard() {
  const slots = document.getElementById('trick-slots');
  if (!slots) return;
  const winner = state.currentTrick.length ? liveWinner(state.currentTrick) : -1;
  const taskCards = new Set(state.tasks.filter(tk => !tk.done).map(tk => tk.card));
  [0, 1, 2, 3].forEach(p => {
    const slot = slots.querySelector('.slot.p' + posOf(p));
    const played = state.currentTrick.find(x => x.player === p);
    if (played) {
      const isTask = taskCards.has(played.card);
      slot.innerHTML = `${p === winner ? '<span class="wc">👑</span>' : ''}${cardHTML(played.card, true, isTask)}`;
      slot.classList.toggle('winner', p === winner);
    } else {
      slot.innerHTML = '<div class="ph"></div>';
      slot.classList.remove('winner');
    }
  });
  const lead = document.getElementById('lead-bar');
  if (state.currentTrick.length) {
    const hasComet = state.currentTrick.some(x => isComet(x.card));
    const ledSuit = parseCard(state.currentTrick[0].card).suit;
    if (hasComet) { lead.className = 'lead-bar comet'; lead.innerHTML = `<span class="lg">${suitGlyph('comet')}</span> ${tt(SUIT_INFO.comet.name)}`; }
    else { lead.className = 'lead-bar'; lead.innerHTML = `${currentLang() === 'ja' ? 'リード' : 'Lead'} <span class="lg s-${ledSuit}">${suitGlyph(ledSuit)}</span> ${tt(SUIT_INFO[ledSuit].name)}`; }
    lead.style.visibility = 'visible';
  } else {
    lead.style.visibility = 'hidden';
  }
}

function renderHand() {
  const hand = document.getElementById('hand');
  if (!hand) return;
  const legal = currentPlayer(state) === mySeat ? legalCards(state, mySeat) : [];
  const myTurn = currentPlayer(state) === mySeat && state.status === 'playing' && !busy;
  hand.innerHTML = state.hands[mySeat].map(c => {
    const playable = myTurn && legal.includes(c);
    const dim = myTurn && !legal.includes(c);
    const hinted = myTurn && hintCard === c;
    return `<div class="${cardCls(c)} ${playable ? 'playable' : ''} ${dim ? 'dim' : ''} ${lifted === c ? 'lifted' : ''} ${hinted ? 'hinted' : ''}" data-card="${c}">${cardInner(c)}</div>`;
  }).join('');
  hand.querySelectorAll('.card').forEach(el => { el.onclick = () => onHandTap(el.dataset.card); });
}

function renderMyTasks() {
  const el = document.getElementById('my-tasks');
  if (!el) return;
  const tasks = state.tasks.filter(tk => tk.owner === mySeat);
  if (!tasks.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="lbl">${currentLang() === 'ja' ? 'あなたのおねがい' : 'Your promises'}</span>` +
    tasks.map(tk => chipHTML(tk)).join('');
}

function renderLamp() {
  const fab = document.getElementById('lamp-fab');
  if (!fab) return;
  const used = state.signals[mySeat] != null;
  const avail = canSignal(state, mySeat) && signalableCards(state, mySeat).length > 0 && !busy;
  fab.className = 'lamp-fab' + (used ? ' used' : (avail ? '' : ' disabled'));
  const hf = document.getElementById('hint-fab');
  if (hf) {
    // ヒントは第6夜（またはデイリー）で解放。序盤は自力で考える楽しさを守る
    const unlocked = isDailyRun || (typeof curMission.id === 'number' && curMission.id >= 6);
    hf.style.display = unlocked ? '' : 'none';
    const myTurn = currentPlayer(state) === mySeat && state.status === 'playing' && !busy;
    hf.className = 'hint-fab' + (myTurn ? '' : ' disabled');
    const hc = document.getElementById('hint-count');
    if (hc) hc.textContent = store.getHints();
  }
}

// ---- ヒント（AI探索の最善手をおすすめ表示。リワード広告で補充） ----------------

function onHintTap() {
  if (busy || !state || state.status !== 'playing') return;
  if (currentPlayer(state) !== mySeat) { toast(t('hintNotTurn')); play('back'); return; }
  if (store.getHints() <= 0) { openHintOffer(); return; }
  store.consumeHint();
  computeAndShowHint();
}

function computeAndShowHint() {
  play('sparkle', { gain: 0.5 });
  let best;
  try { best = chooseCard(makeView(state, mySeat)); }
  catch (e) { best = legalCards(state, mySeat)[0]; }
  hintCard = best;
  renderHand(); renderLamp();
  const el = document.querySelector(`.hand .card[data-card="${best}"]`);
  if (el) burstAtEl(el, 5);
  toast(`✨ ${t('hintReco')}`);
}

function openHintOffer() {
  play('bong', { gain: 0.4 });
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="overlay show center-mode" id="ov-hint"><div class="sheet center">
    <div style="text-align:center;font-size:34px">✨</div>
    <h2>${t('hintEmpty')}</h2>
    <p class="intro">${currentLang() === 'ja' ? 'クルーのソラが、いちばん良い札を教えてくれます。' : 'Sora will show you the best card to play.'}</p>
    <div class="sheet-btns" style="flex-direction:column">
      <button class="btn primary" id="h-watch">▶ ${t('hintWatch')}</button>
      <button class="btn ghost" id="h-later">${t('later')}</button>
    </div></div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  const ov = document.getElementById('ov-hint');
  ov.querySelector('#h-later').onclick = () => { tap(); ov.remove(); };
  ov.querySelector('#h-watch').onclick = () => {
    tap();
    ov.querySelector('#h-watch').textContent = '…';
    showRewardAd(() => {
      store.addHints(1);
      lastAdAt = Date.now();
      ov.remove();
      toast(`🎁 ${t('hintGot')}`);
      renderLamp();
    }, () => { ov.remove(); toast(currentLang() === 'ja' ? '広告を読み込めませんでした' : 'Ad not available'); });
  };
}

// ---- ゲームループ -----------------------------------------------------------

function startLoop() { step(); }

function step() {
  if (!state || state.status !== 'playing') { if (state) endGame(); return; }
  renderAll();
  // トリック開始時: AI席のシグナル（全端末で決定論に同順実行）
  if (state.currentTrick.length === 0) {
    doAISignals();
    renderAll();
  }
  // ネットワークの手を消化（適用したら continuation は commitPlay 側が持つ）
  if (pumpNet()) return;
  if (!state || state.status !== 'playing') { if (state) endGame(); return; }
  const cp = currentPlayer(state);
  if (cp === mySeat) {
    // 自分の番。手札タップ待ち（エコー待ち中はロック維持）
    busy = awaitingEcho;
    renderHand(); renderLamp();
  } else if (online && humanSeats.has(cp)) {
    // 他の人間の手番: サーバからの act を待つ
    busy = true;
    renderCrew(); renderHand(); renderLamp();
  } else {
    aiTurn(cp);
  }
}

// キュー先頭から適用できるだけ適用する。play を1枚適用したら true（演出が継続を持つ）
function pumpNet() {
  while (netQueue.length && state && state.status === 'playing') {
    const ev = netQueue[0];
    if (ev.t === 'seatDrop') {
      netQueue.shift();
      humanSeats.delete(ev.seat);
      toast(`${tt(CHARS[SEAT_CHAR[ev.seat]].name)}${currentLang() === 'ja' ? 'はAIクルーが引き継ぎました' : ' is now AI-controlled'}`);
      renderCrew();
      continue;
    }
    const a = ev.a;
    if (a.kind === 'signal') {
      netQueue.shift();
      try {
        playSignal(state, a.seat, a.card);
        play('lamp');
        if (a.seat !== mySeat) toast(`${tt(CHARS[SEAT_CHAR[a.seat]].name)}のランプ: ${signalPhrase(a.seat, a.card)}`, SEAT_CHAR[a.seat]);
      } catch (e) { /* レース負けのシグナルは全端末で同一に無視 */ }
      // 注意: シグナルのエコーで awaitingEcho（プレイ待ち）は解除しない
      renderAll();
      continue;
    }
    if (a.kind === 'play') {
      const cp = currentPlayer(state);
      if (cp === a.seat) {
        netQueue.shift();
        if (a.seat === mySeat) awaitingEcho = false;
        try { commitPlay(a.seat, a.card); return true; }
        catch (e) { /* 不正手は無視（全端末同一） */ renderAll(); continue; }
      }
      if (humanSeats.has(cp)) {
        // 手番は別の人間 → 先頭の手は永遠に適用不能（本人の手はこの後ろに並ぶ）。
        // 全端末が同一状態・同一順で同じ判断になるため、捨てて進める（デッドロック防止）
        netQueue.shift();
        if (a.seat === mySeat) { awaitingEcho = false; busy = false; renderAll(); }
        continue;
      }
      // AI手番が先。AIが打ってから消化する
      return false;
    }
    netQueue.shift();
  }
  return false;
}

// サーバイベント受信時のキック（演出中/AI思考中なら次のstepで消化される）
function pumpKick() {
  if (!state || state.status !== 'playing') return;
  if (animating || aiTimer) return;
  step();
}

function doAISignals() {
  // 各トリックの開始時に1回だけ実行（全端末で同一の論理順＝決定論同期の要）
  if (state.trickNo === aiSigTrick) return;
  aiSigTrick = state.trickNo;
  for (let i = 0; i < 4; i++) {
    const q = (state.leader + i) % 4;
    if (humanSeats.has(q)) continue; // 人間の席は本人が合図する
    if (canSignal(state, q)) {
      const card = chooseSignal(makeView(state, q));
      if (card) {
        playSignal(state, q, card);
        play('lamp');
        toast(`${tt(CHARS[SEAT_CHAR[q]].name)}のランプ: ${signalPhrase(q, card)}`, SEAT_CHAR[q]);
      }
    }
  }
}

function aiTurn(p) {
  if (aiTimer) return; // 二重スケジュール防止
  busy = true;
  renderCrew(); renderHand(); renderLamp();
  const delay = 620 + Math.random() * 320;
  const rid = runId;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (rid !== runId) return;
    if (!state || state.status !== 'playing') return;
    if (currentPlayer(state) !== p) { step(); return; }
    let card;
    try { card = chooseCard(makeView(state, p)); }
    catch (e) { card = legalCards(state, p)[0]; }
    commitPlay(p, card);
  }, delay);
}

function onHandTap(card) {
  if (busy || currentPlayer(state) !== mySeat || state.status !== 'playing') return;
  const legal = legalCards(state, mySeat);
  if (!legal.includes(card)) {
    // 出せない理由
    const el = document.querySelector(`.hand .card[data-card="${card}"]`);
    if (el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 300); }
    const ledSuit = state.currentTrick.length ? parseCard(state.currentTrick[0].card).suit : null;
    if (ledSuit) toast(`${tt(SUIT_INFO[ledSuit].name)}${currentLang() === 'ja' ? 'の色を出します' : ' must be followed'}`);
    play('back'); return;
  }
  if (lifted !== card) { lifted = card; play('tap'); renderHand(); return; }
  lifted = null;
  if (online) {
    // ロックステップ: サーバのエコー順で適用する（楽観適用しない）
    awaitingEcho = true; busy = true;
    sendAct('play', mySeat, card);
    renderHand(); renderLamp();
    return;
  }
  commitPlay(mySeat, card);
}

function commitPlay(p, card) {
  cancelPendingLeader();
  busy = true;
  animating = true;
  hintCard = null;
  const before = state.history.length;
  playCard(state, p, card);
  play('card', { rate: 0.95 + Math.random() * 0.1 });
  const resolved = state.history.length > before;
  renderCrew(); renderHand(); renderMyTasks(); renderBoard(); renderLamp();
  animateCardEnter(p);
  const rid = runId;
  if (resolved) {
    const rec = state.history[state.history.length - 1];
    setTimeout(() => { if (rid !== runId) return; animateTrickResolve(rec); }, 340);
  } else {
    setTimeout(() => { if (rid !== runId) return; animating = false; busy = false; step(); }, 300);
  }
}

// カードが自席の方向からスロットへ舞い込む
function animateCardEnter(p) {
  const el = document.querySelector('.trick-slots .slot.p' + posOf(p) + ' .card');
  if (!el) return;
  const from = { 0: [0, 70], 1: [-72, 0], 2: [0, -54], 3: [72, 0] }[posOf(p)];
  el.animate([
    { transform: `translate(${from[0]}px, ${from[1]}px) scale(.88) rotate(${from[0] ? (from[0] < 0 ? -6 : 6) : 0}deg)`, opacity: 0 },
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
  ], { duration: 300, easing: 'cubic-bezier(.22,.61,.36,1)' });
}

function animateTrickResolve(rec) {
  busy = true;
  const rid = runId;
  const doneNow = rec ? state.tasks.filter(tk => tk.done && tk.doneAtTrick === rec.trickNo) : [];
  if (state.status === 'lost') {
    // 失敗トリック: 少し見せてから、やさしくリザルトへ
    highlightWinner(rec.winner);
    setTimeout(() => { if (rid !== runId) return; playFail(); animating = false; endGame(); }, 900);
    return;
  }
  highlightWinner(rec.winner);
  if (doneNow.length) { playTaskDone(); starBurstAt(rec.winner); }
  else play('bell', { gain: 0.28, rate: 1.35 });
  // 勝者を見せる → 4枚が勝者スロットへ吸い込まれる → 次へ
  setTimeout(() => {
    if (rid !== runId) return;
    animateTrickCollect(rec.winner, () => {
      if (rid !== runId || !state) return;
      renderAll();
      animating = false;
      if (state.status !== 'playing') { endGame(); return; }
      busy = false;
      step();
    });
  }, doneNow.length ? 620 : 460);
}

function highlightWinner(seat) {
  const pos = posOf(seat);
  if (pos >= 1) {
    const crew = document.querySelectorAll('.crew-row .crew')[pos - 1];
    if (crew) crew.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 440, easing: 'ease-out' });
  }
}

function animateTrickCollect(winner, cb) {
  const slots = document.getElementById('trick-slots');
  const cards = slots ? [...slots.querySelectorAll('.slot .card')] : [];
  const target = slots ? slots.querySelector('.slot.p' + posOf(winner)) : null;
  if (!cards.length || !target) { cb(); return; }
  const tr = target.getBoundingClientRect();
  const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
  let done = 0, called = false;
  const total = cards.length;
  const finish = () => { if (called) return; called = true; cb(); };
  cards.forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const dx = tx - (r.left + r.width / 2), dy = ty - (r.top + r.height / 2);
    const anim = c.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(.3) rotate(${(i - 1.5) * 8}deg)`, opacity: 0 },
    ], { duration: 440, delay: i * 40, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    anim.onfinish = () => { if (++done >= total) finish(); };
  });
  // 保険（onfinishが来ない場合）
  setTimeout(finish, 700);
}

// ---- シグナル操作（人間） ---------------------------------------------------

function onLampTap() {
  if (busy || state.signals[mySeat]) { if (state.signals[mySeat]) toast(t('signalUsed')); return; }
  if (!canSignal(state, mySeat)) { toast(currentLang() === 'ja' ? 'トリックの合間に使えます' : 'Use it between tricks'); return; }
  const cards = signalableCards(state, mySeat);
  if (!cards.length) { toast(t('signalNone')); return; }
  openSignalMode(cards);
}

function openSignalMode(cards) {
  play('lamp', { gain: 0.5 });
  const handHTML = state.hands[mySeat].map(c => {
    const pick = cards.includes(c);
    return `<div class="${cardCls(c)} ${pick ? 'pickable' : 'faded'}" data-card="${c}" data-pick="${pick}">${cardInner(c)}</div>`;
  }).join('');
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="signal-mode show" id="sig-mode">
    <div class="sig-title">${t('signalPick')}</div>
    <div class="sig-hand">${handHTML}</div>
    <button class="btn ghost small" style="margin-bottom:calc(24px + var(--safe-b));color:#fff;border-color:rgba(255,255,255,.4)" id="sig-cancel">${t('cancel')}</button>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
  const sm = document.getElementById('sig-mode');
  sm.querySelector('#sig-cancel').onclick = () => { tap(); sm.remove(); };
  sm.querySelectorAll('.card[data-pick="true"]').forEach(el => {
    el.onclick = () => confirmSignal(el.dataset.card, sm);
  });
}

function confirmSignal(card, sm) {
  const tag = signalTag(state, mySeat, card);
  const ja = currentLang() === 'ja';
  const suit = parseCard(card).suit;
  const phrase = `${SUIT_INFO[suit].emoji}${tt(SUIT_INFO[suit].name)}${ja ? 'で' : ' '}${tt(tagLabel(tag))}`;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="overlay show center-mode" id="sig-confirm">
    <div class="sheet center">
      <p class="intro">${ja ? 'この札を合図として公開します' : 'Show this card as your signal'}</p>
      <div style="display:flex;justify-content:center;margin:8px 0">${cardHTML(card, false, false)}</div>
      <div style="text-align:center;font-weight:700;color:var(--c-night)">「${phrase}」</div>
      <div class="sheet-btns">
        <button class="btn ghost" id="sc-back">${currentLang() === 'ja' ? 'もどる' : 'Back'}</button>
        <button class="btn primary" id="sc-ok">${currentLang() === 'ja' ? '合図する' : 'Signal'}</button>
      </div>
    </div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  const cf = document.getElementById('sig-confirm');
  cf.querySelector('#sc-back').onclick = () => { tap(); cf.remove(); };
  cf.querySelector('#sc-ok').onclick = () => {
    if (online) {
      sendAct('signal', mySeat, card); // エコー順で適用（ロックステップ）
    } else {
      playSignal(state, mySeat, card);
    }
    play('lamp'); sparkleAt();
    cf.remove(); if (sm) sm.remove();
    renderAll();
  };
}

// ---- リザルト ---------------------------------------------------------------

function endGame() {
  cancelPendingLeader();
  busy = false;
  if (state.status === 'won') {
    if (isDailyRun) {
      dailyFirstWin = store.getDaily()[todayKey()] !== 'won';
      store.setDaily(todayKey(), 'won');
      if (dailyFirstWin) store.addHints(1); // デイリー報酬は1日1回（勝ち直しファーム防止）
    } else {
      store.recordClear(curMission.id);
      failsThisMission = 0;
    }
    showResult(true);
    // インタースティシャル: 勝利→リザルト描画後のみ。第6夜以降・2夜クリアごと・
    // 120秒クールダウン・失敗直後/デイリー/オンラインは出さない（リワード優先の設計）
    clearsThisSession++;
    const now = Date.now();
    if (!store.isAdFree() && !isDailyRun && !online && typeof curMission.id === 'number' &&
      curMission.id > 5 && clearsThisSession % 2 === 0 && now - lastAdAt > 120000) {
      setTimeout(async () => { if (await showInterstitial()) lastAdAt = Date.now(); }, 800);
    }
  } else {
    if (!isDailyRun) failsThisMission++;
    showResult(false);
  }
  if (online) sendEnd(); // ルームをロビーに戻す（全員が終局を検知している）
}

function showResult(won) {
  const ja = currentLang() === 'ja';
  const nextId = isDailyRun ? -1 : curMission.id + 1;
  const hasNext = !isDailyRun && nextId <= 50;
  let detail = '';
  if (!won && state.failReason) detail = failDetail(state.failReason);
  const winTitle = isDailyRun ? t('dailyClear') : t('missionClear');
  const winDetail = isDailyRun
    ? (store.dailyStreak(todayKey()) > 1 ? `🔥 ${store.dailyStreak(todayKey())}${ja ? '日連続達成！' : '-day streak!'}` : (ja ? 'また明日も新しい配札が待ってるよ' : 'A new deal awaits tomorrow'))
    : (hasNext ? (ja ? '第' + nextId + '夜が開放されました' : 'Night ' + nextId + ' unlocked')
      : (ja ? '全ミッション制覇！おめでとう！' : 'All missions complete! Congratulations!'));
  const s = setScreen(won ? `
    <div class="emoji">${isDailyRun ? '☀️' : '🌟'}</div>
    <div class="crew-dance">${['sora', 'mimi', 'pen', 'koro'].map(c => `<span class="char-mini" style="width:52px;height:52px;background:var(--chara-${c})">${charImg(c)}</span>`).join('')}</div>
    <h1>${winTitle}</h1>
    <p class="cheer">${ja ? '星に届いたよ！' : 'We reached the stars!'}</p>
    <p class="detail">${winDetail}</p>
    <div class="title-btns" style="margin-top:10px">
      ${online ? `<button class="btn primary" id="b-lobby">${t('toLobby')}</button>` : ''}
      ${!online && hasNext ? `<button class="btn primary" id="b-next">${t('next')}</button>` : ''}
      ${!online && isDailyRun ? `<button class="btn primary" id="b-title">${ja ? 'タイトルへ' : 'Back to Title'}</button>` : ''}
      ${!online && !isDailyRun ? `<button class="btn" id="b-map">${t('backToMap')}</button>` : ''}
    </div>
  ` : `
    <div class="emoji">💫</div>
    <h1>${t('missionFail')}</h1>
    <p class="cheer">${ja ? '今夜は星に届かなかったみたい。' : 'We didn’t reach the stars tonight.'}</p>
    <p class="detail">${detail}</p>
    <div class="title-btns" style="margin-top:10px">
      ${online ? `<button class="btn primary" id="b-lobby">${t('toLobby')}</button>` : `
      ${canRevenge() ? `<button class="btn primary reward-btn" id="b-revenge">${t('revengeAd')}</button>` : ''}
      <button class="btn ${canRevenge() ? '' : 'primary'}" id="b-retry">${t('retry')}</button>
      ${canSkipNight() ? `<button class="btn reward-btn" id="b-skip">${t('skipNight')}</button>` : ''}
      ${isDailyRun ? `<button class="btn" id="b-title">${ja ? 'タイトルへ' : 'Back to Title'}</button>` : `<button class="btn ghost" id="b-map">${t('backToMap')}</button>`}`}
    </div>
  `, won ? 'result-screen' : 'result-screen fail');
  if (won) { playWinJingle(); starRain(); } else { shootingStar(); }
  if (!store.isAdFree()) showBanner();
  // デイリー勝利: 報酬2倍ボタン（広告でヒント券をもう1枚）
  if (won && isDailyRun && dailyFirstWin && !store.hintsFull()) {
    const btns = s.querySelector('.title-btns');
    const b2 = document.createElement('button');
    b2.className = 'btn reward-btn'; b2.id = 'b-double'; b2.textContent = t('reward2x');
    btns.insertBefore(b2, btns.firstChild);
    b2.onclick = () => {
      tap(); b2.disabled = true; b2.textContent = '…';
      showRewardAd(() => { store.addHints(1); lastAdAt = Date.now(); b2.remove(); toast(`🎁 ${t('gotTicket')}`); },
        () => { b2.remove(); });
    };
  }
  // シェアボタン（勝利時は常設・デイリー失敗時も惜しさ共有用に表示）
  if (won || isDailyRun) {
    const btns = s.querySelector('.title-btns');
    const sb2 = document.createElement('button');
    sb2.className = 'btn ghost'; sb2.id = 'b-share'; sb2.textContent = `🔗 ${t('share')}`;
    btns.appendChild(sb2);
    sb2.onclick = () => { tap(); doShare(won); };
  }
  const lb = s.querySelector('#b-lobby'); if (lb) lb.onclick = () => { tap(); abandonGame(); online = false; showLobby(); };
  const nb = s.querySelector('#b-next'); if (nb) nb.onclick = () => { tap(); startMission(nextId); };
  const rb = s.querySelector('#b-retry'); if (rb) rb.onclick = () => { tap(); newDeal(); };
  const mb = s.querySelector('#b-map'); if (mb) mb.onclick = () => { tap(); showMap(); };
  const tb = s.querySelector('#b-title'); if (tb) tb.onclick = () => { tap(); state = null; showTitle(); };
  const vb = s.querySelector('#b-revenge');
  if (vb) vb.onclick = () => {
    tap(); vb.disabled = true; vb.textContent = '…';
    showRewardAd(() => { revengeUsed = true; lastAdAt = Date.now(); redealSame(); },
      () => { vb.disabled = false; vb.textContent = t('revengeAd'); toast(currentLang() === 'ja' ? '広告を読み込めませんでした' : 'Ad not available'); });
  };
  const sb = s.querySelector('#b-skip');
  if (sb) sb.onclick = () => {
    tap(); sb.disabled = true; sb.textContent = '…';
    showRewardAd(() => {
      lastAdAt = Date.now();
      store.recordClear(curMission.id);
      const nid = curMission.id + 1;
      if (nid <= 50) startMission(nid); else showMap();
    }, () => { sb.disabled = false; sb.textContent = t('skipNight'); });
  };
}

// ---- オンライン協力（ロビー/接続） ------------------------------------------

function showOnlineMenu() {
  const ja = currentLang() === 'ja';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="overlay show center-mode" id="ov-online"><div class="sheet center">
    <div style="text-align:center;font-size:34px">🤝</div>
    <h2>${t('online')}</h2>
    <p class="intro">${ja ? '2〜4人で同じ夜に挑戦。空いた席はAIクルーが担当します。' : 'Play a night together with 2–4 players. Empty seats are AI crew.'}</p>
    <div class="sheet-btns" style="flex-direction:column">
      <button class="btn primary" id="o-create">${t('createRoom')}</button>
      <div class="join-row">
        <input id="o-code" class="code-input" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off" spellcheck="false">
        <button class="btn" id="o-join">${t('joinRoom')}</button>
      </div>
      <button class="btn ghost" id="o-cancel">${t('cancel')}</button>
    </div></div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  const ov = document.getElementById('ov-online');
  ov.querySelector('#o-cancel').onclick = () => { tap(); ov.remove(); };
  ov.querySelector('#o-create').onclick = () => { tap(); ov.remove(); enterRoom(makeRoomCode()); };
  ov.querySelector('#o-join').onclick = () => {
    const code = (ov.querySelector('#o-code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { toast(ja ? '4文字のコードを入れてください' : 'Enter the 4-letter code'); return; }
    tap(); ov.remove(); enterRoom(code);
  };
}

function enterRoom(code) {
  roomCode = code;
  connectRoom(code, {
    onJoined: (seat) => { mySeat = seat; showLobby(); },
    onRoster: () => { if (document.getElementById('lobby-seats')) showLobby(); },
    onStart: (m) => startOnlineMission(m),
    onAct: (a) => { netQueue.push({ t: 'act', a }); pumpKick(); },
    onSeatDrop: (seat) => {
      if (state && state.status === 'playing') { netQueue.push({ t: 'seatDrop', seat }); pumpKick(); }
      else if (document.getElementById('lobby-seats')) showLobby();
    },
    onLobby: () => { if (!state || state.status !== 'playing') showLobby(); },
    onFull: () => { toast(t('roomFull')); showTitle(); },
    onClosed: () => {
      // 自分の接続断: 残りをAIにしてオフライン続行
      if (state && state.status === 'playing' && online) {
        online = false; humanSeats = new Set([mySeat]); netQueue = [];
        awaitingEcho = false; toast(t('connLost'));
        if (!animating && !aiTimer) step();
      } else {
        roomCode = null; online = false;
      }
    },
  });
}

function showLobby() {
  online = false; // プレイはまだ。開始時にtrue
  const ja = currentLang() === 'ja';
  const seats = seatsNow();
  const maxNight = Math.min(50, store.maxClearedId() + 1);
  lobbySel = Math.min(Math.max(1, lobbySel), maxNight);
  const seatCards = [0, 1, 2, 3].map(p => {
    const ch = SEAT_CHAR[p];
    const occupied = seats[p];
    const label = p === mySeat ? t('youSeat') : (occupied ? 'P' + (p + 1) : t('aiSeat'));
    return `<div class="lobby-seat ${occupied ? 'occ' : ''} ${p === mySeat ? 'me' : ''}">
      <span class="char-mini" style="width:44px;height:44px;background:var(--chara-${ch})">${charImg(ch)}</span>
      <div class="ls-name">${tt(CHARS[ch].name)}</div>
      <div class="ls-tag">${label}</div>
    </div>`;
  }).join('');
  const isCaptain = mySeat === 0;
  const s = setScreen(`
    <div class="hdr"><button class="icon-btn" id="b-back">‹</button>
      <div class="title">🤝 ${t('online')}</div><span style="width:40px"></span></div>
    <div class="lobby-body">
      <div class="room-code-box">
        <div class="rc-label">${t('roomCode')}</div>
        <div class="rc-code" id="rc-code">${roomCode}</div>
        <div class="rc-hint">${t('codeShare')}</div>
      </div>
      <div class="lobby-seats" id="lobby-seats">${seatCards}</div>
      ${isCaptain ? `
        <div class="night-picker">
          <button class="icon-btn" id="np-prev">‹</button>
          <div class="np-label">${ja ? '第' : 'Night '}<b id="np-num">${lobbySel}</b>${ja ? '夜' : ''}</div>
          <button class="icon-btn" id="np-next">›</button>
        </div>
        <button class="btn primary" id="b-depart" style="width:min(280px,80vw)">${t('depart')}</button>
      ` : `<p class="intro" style="text-align:center">${t('waitingCaptain')}</p>`}
    </div>
  `, 'lobby-screen');
  s.querySelector('#b-back').onclick = () => { back(); leaveRoomToTitle(); };
  s.querySelector('#rc-code').onclick = () => {
    try { navigator.clipboard.writeText(roomCode); toast(`📋 ${t('shareCopied')}`); } catch (e) {}
  };
  if (isCaptain) {
    s.querySelector('#np-prev').onclick = () => { tap(); lobbySel = Math.max(1, lobbySel - 1); s.querySelector('#np-num').textContent = lobbySel; };
    s.querySelector('#np-next').onclick = () => { tap(); lobbySel = Math.min(maxNight, lobbySel + 1); s.querySelector('#np-num').textContent = lobbySel; };
    s.querySelector('#b-depart').onclick = () => {
      tap();
      sendStart(lobbySel, (Date.now() % 2147483647) >>> 0);
    };
  }
}

function seatsNow() {
  if (window.__shotSeats) return window.__shotSeats.slice(); // スクショモード用
  const a = seatsOnline();
  if (mySeat >= 0) a[mySeat] = true;
  return a;
}

function startOnlineMission(m) {
  isDailyRun = false;
  online = true;
  humanSeats = new Set(m.humanSeats);
  netQueue = [];
  awaitingEcho = false;
  curMission = missionById(m.missionId);
  attemptSeed = m.seed >>> 0;
  revengeUsed = true; // オンラインではリベンジ/スキップは出さない
  failsThisMission = 0;
  runId++;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  animating = false; lifted = null; hintCard = null;
  aiSigTrick = -1;
  state = newGame(curMission, attemptSeed);
  optimizeAssignment(state);
  showIntroAnim();
}

// ゲームを放棄して画面を離れる（残タイマー無効化）
function abandonGame() {
  runId++;
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  animating = false; busy = false; awaitingEcho = false;
  lifted = null; hintCard = null;
  state = null;
}

function leaveRoomToTitle() {
  disconnectRoom();
  abandonGame();
  roomCode = null; online = false; mySeat = 0; humanSeats = new Set([0]);
  netQueue = [];
  showTitle();
}

// ---- シェア（ゼロコストの成長装置。Wordle型の絵文字グリッド） ----------------

const SHARE_URL = 'https://rakko9924-tech.github.io/hoshizora/';

function shareText(won) {
  const ja = currentLang() === 'ja';
  // トリック経過グリッド: ⭐=おねがい達成トリック / 🌙=その他 / 💥=失敗
  const marks = [];
  for (let i = 0; i < state.trickNo; i++) {
    marks.push(state.tasks.some(tk => tk.doneAtTrick === i) ? '⭐' : '🌙');
  }
  if (!won) marks.push('💥');
  const grid = marks.join('');
  if (isDailyRun) {
    const key = todayKey();
    const streak = store.dailyStreak(key);
    return `🎈${ja ? 'ほしぞら探検隊 今日の挑戦' : 'Starlight Expedition Daily'} ${key.slice(5).replace('-', '/')}\n` +
      `${grid} ${won ? (ja ? `${state.trickNo}トリックで達成！` : `cleared in ${state.trickNo} tricks!`) : (ja ? 'ざんねん…' : 'so close…')}\n` +
      (streak > 1 ? `🔥${streak}${ja ? '日連続' : '-day streak'}\n` : '') + SHARE_URL;
  }
  const nightLabel = ja ? `第${curMission.id}夜` : `Night ${curMission.id}`;
  const head = curMission.id === 50 && won
    ? (ja ? '🌅 全50夜制覇！' : '🌅 All 50 nights complete!')
    : `${won ? '🌟' : '💫'}${nightLabel}${won ? (ja ? ' クリア！' : ' clear!') : ''}`;
  return `🎈${ja ? 'ほしぞら探検隊' : 'Starlight Expedition'} ${head}\n${grid}\n${SHARE_URL}`;
}

function doShare(won) {
  const text = shareText(won);
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    try {
      navigator.clipboard.writeText(text).then(() => toast(`📋 ${t('shareCopied')}`));
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast(`📋 ${t('shareCopied')}`);
    }
  }
}

// 「同じ配札でリベンジ」提示条件: 第6夜以降・1配札1回・キャンペーンのみ
function canRevenge() {
  return !isDailyRun && typeof curMission.id === 'number' && curMission.id >= 6 && !revengeUsed;
}
// 救済スキップ提示条件: 同じ夜で3回連続失敗したときだけ（誘導ではなく救済）
function canSkipNight() {
  return !isDailyRun && typeof curMission.id === 'number' && failsThisMission >= 3 && curMission.id < 50;
}

function failDetail(r) {
  const ja = currentLang() === 'ja';
  if (r.type === 'taskStolen' && r.task) {
    return `${miniCardText(r.task.card)} ${ja ? 'が別の隊員のもとへ行きました' : 'went to the wrong crew member'}`;
  }
  if (r.type === 'orderViolation') return t('orderViolation');
  if (r.type === 'lastViolation') return t('lastViolation');
  if (r.type === 'tasksIncomplete') return t('tasksIncomplete');
  if (r.type === 'modifier' && r.m) return tt(modifierText(r.m));
  return '';
}

// ---- ポーズ/設定/あそびかた -------------------------------------------------

function openPauseMenu() {
  tap();
  const ja = currentLang() === 'ja';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="overlay show" id="ov-pause"><div class="sheet">
    <h2>${ja ? 'メニュー' : 'Menu'}</h2>
    <div class="menu-list">
      <button id="m-resume">${ja ? 'ゲームにもどる' : 'Resume'}</button>
      ${online ? '' : `<button id="m-restart">${ja ? '最初からやり直す' : 'Restart mission'}</button>`}
      <button id="m-howto">${t('howto')}</button>
      <button id="m-settings">${t('settings')}</button>
      ${online ? `<button id="m-leave" class="danger">${t('leaveRoom')}</button>` : `<button id="m-map">${t('backToMap')}</button>`}
    </div>
  </div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  const ov = document.getElementById('ov-pause');
  const close = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) close(); };
  ov.querySelector('#m-resume').onclick = () => { tap(); close(); };
  const mr = ov.querySelector('#m-restart'); if (mr) mr.onclick = () => { tap(); close(); newDeal(); };
  ov.querySelector('#m-howto').onclick = () => { tap(); close(); showHowto(true); };
  ov.querySelector('#m-settings').onclick = () => { tap(); close(); showSettings(); };
  const mm = ov.querySelector('#m-map'); if (mm) mm.onclick = () => { tap(); close(); abandonGame(); showMap(); };
  const ml = ov.querySelector('#m-leave'); if (ml) ml.onclick = () => { tap(); close(); leaveRoomToTitle(); };
}

function showSettings() {
  const ja = currentLang() === 'ja';
  const s = setScreen(`
    <div class="hdr"><button class="icon-btn" id="b-back">‹</button><div class="title">${t('settings')}</div><span style="width:40px"></span></div>
    <div style="padding:16px;flex:1;overflow-y:auto">
      <div class="menu-list">
        <button id="s-se">${t('se')}<span class="toggle ${sfxEnabled() ? 'on' : ''}" id="tg-se"></span></button>
        <div class="menu-static">${t('lang')}<span class="seg"><span id="lg-ja" class="${currentLang() === 'ja' ? 'on' : ''}">日本語</span><span id="lg-en" class="${currentLang() === 'en' ? 'on' : ''}">EN</span></span></div>
        ${iapAvailable() && !store.isAdFree() ? `<button id="s-noads">⭐ ${ja ? '広告を消す ¥500（毎日ヒント+1特典つき）' : 'Remove ads ¥500'}<span class="chev">›</span></button>` : ''}
        ${iapAvailable() ? `<button id="s-restore">${ja ? '購入を復元' : 'Restore purchases'}<span class="chev">›</span></button>` : ''}
        <button id="s-howto">${t('howto')}<span class="chev">›</span></button>
        <button id="s-reset" class="danger">${ja ? '進行をリセット' : 'Reset progress'}<span class="chev">›</span></button>
      </div>
      <div style="text-align:center;color:var(--c-ink-faint);font-size:11px;margin-top:20px">ほしぞら探検隊 v0.2</div>
    </div>
  `, 'settings-screen');
  s.querySelector('#b-back').onclick = () => { back(); state ? showPlayOrTitle() : showTitle(); };
  s.querySelector('#s-se').onclick = () => {
    const on = !sfxEnabled(); setSfxEnabled(on); play('tap');
    s.querySelector('#tg-se').classList.toggle('on', on);
  };
  const setL = l => { if (l !== currentLang()) { tap(); switchLang(l); showSettings(); } };
  s.querySelector('#lg-ja').onclick = () => setL('ja');
  s.querySelector('#lg-en').onclick = () => setL('en');
  const na = s.querySelector('#s-noads');
  if (na) na.onclick = () => { tap(); buyRemoveAds(() => toast(currentLang() === 'ja' ? 'この端末では購入できません' : 'Purchases unavailable')); };
  const rs2 = s.querySelector('#s-restore');
  if (rs2) rs2.onclick = () => { tap(); restorePurchases(); toast(currentLang() === 'ja' ? '購入を確認しています…' : 'Restoring…'); };
  s.querySelector('#s-howto').onclick = () => { tap(); showHowto(!!state); };
  s.querySelector('#s-reset').onclick = () => { tap(); confirmReset(); };
}

function showPlayOrTitle() { if (state && state.status === 'playing') { showPlay(); } else showTitle(); }

function confirmReset() {
  const ja = currentLang() === 'ja';
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="overlay show center-mode" id="ov-reset"><div class="sheet center">
    <h2>${ja ? '進行をリセット' : 'Reset progress'}</h2>
    <p class="intro">${ja ? 'すべてのクリア記録が消えます。よろしいですか？' : 'All progress will be erased. Are you sure?'}</p>
    <div class="sheet-btns">
      <button class="btn primary" id="r-cancel">${t('cancel')}</button>
      <button class="btn ghost" id="r-ok" style="color:var(--suit-cloud);border-color:var(--suit-cloud)">${ja ? 'リセット' : 'Reset'}</button>
    </div></div></div>`;
  document.body.appendChild(wrap.firstElementChild);
  const ov = document.getElementById('ov-reset');
  ov.querySelector('#r-cancel').onclick = () => { tap(); ov.remove(); };
  ov.querySelector('#r-ok').onclick = () => {
    try { localStorage.removeItem('hz-progress-v1'); } catch (e) {}
    ov.remove(); showTitle();
  };
}

function showHowto(fromGame) {
  const ja = currentLang() === 'ja';
  const pages = howtoPages(ja);
  const s = setScreen(`
    <div class="hdr"><button class="icon-btn" id="b-back">‹</button><div class="title">${t('howto')}</div><span style="width:40px"></span></div>
    <div class="howto-page">${pages}</div>
  `, 'howto-screen');
  s.querySelector('#b-back').onclick = () => { back(); if (fromGame && state && state.status === 'playing') showPlay(); else showTitle(); };
}

function howtoPages(ja) {
  const P = [
    {
      h: ja ? '静かな夜の冒険' : 'A Quiet Night’s Adventure',
      p: ja ? '動物たちの飛行船で夜空を旅します。しずかな夜なので声は出せません。合図は「シグナルランプ」だけ。みんなで力を合わせて「おねがい」をかなえましょう。' : 'Sail the night sky with an animal crew. No talking is allowed — only the signal lamp. Work together to fulfill every promise.',
      demo: `<div style="width:110px">${airshipSVG()}</div>` + ['sora', 'mimi', 'pen', 'koro'].map(charMini).join(''),
    },
    {
      h: ja ? 'カードと強さ' : 'Cards & Strength',
      p: ja ? `4つの色（${inlineSuit('star')}星・${inlineSuit('moon')}月・${inlineSuit('cloud')}雲・${inlineSuit('wind')}風）が1〜9まで。同じ色なら数字の大きい方が強いです。${inlineSuit('comet')}彗星は特別な切り札で、どの色にも勝ちます。` : `Four suits (${inlineSuit('star')}${inlineSuit('moon')}${inlineSuit('cloud')}${inlineSuit('wind')}) run 1–9. In the same suit, higher wins. The ${inlineSuit('comet')}comet is the trump — it beats any suit.`,
      demo: cardHTML('star-7', false, false) + cardHTML('moon-3', false, false) + cardHTML('comet-2', false, false),
    },
    {
      h: ja ? 'トリックのルール' : 'Trick Rules',
      p: ja ? '4人が1枚ずつ出して、一番強いカードを出した隊員が「トリック」に勝ちます。最初に出た色（リード）と同じ色を持っていたら、必ずその色を出します。' : 'Each of the 4 plays one card; the strongest wins the trick. You must follow the led suit if you can.',
      demo: cardHTML('moon-2', false, false) + cardHTML('moon-8', false, false) + cardHTML('star-9', false, false) + cardHTML('moon-5', false, false),
    },
    {
      h: ja ? 'おねがい' : 'Promises',
      p: ja ? '各ミッションには「おねがいカード」があり、担当の隊員がそのカードを含むトリックに勝つと達成です。ちがう隊員が取ってしまうと失敗。①②の番号は取る順番、「終」は最後に取る印です。' : 'Each mission has promise cards. The assigned crew member must win the trick containing their card. If someone else takes it, you fail. Numbers show the order; “last” must come last.',
      demo: chipHTML({ card: 'wind-6', owner: 1, order: 1, last: false, done: false }) + chipHTML({ card: 'star-4', owner: 2, order: 2, last: false, done: false }) + chipHTML({ card: 'moon-8', owner: 3, order: null, last: true, done: false }),
    },
    {
      h: ja ? 'シグナルランプ' : 'The Signal Lamp',
      p: ja ? '1ミッションに1回だけ、手札を1枚見せて合図できます。「この色でいちばん強い／これ1枚だけ／いちばん弱い」のどれかが自動でつきます。仲間の合図をヒントに作戦を立てましょう。' : 'Once per mission you may reveal one card as a hint: highest of its suit, only one of its suit, or lowest. Read your crew’s signals to plan.',
      demo: `<div style="width:30px">${lampSVG()}</div>` + cardHTML('star-9', false, false),
    },
    {
      h: ja ? 'さあ、出発！' : 'Let’s Set Off!',
      p: ja ? 'カードは1回タップで持ち上げ、もう1回タップで出します。50の夜を、仲間と一緒に旅しましょう。' : 'Tap a card once to lift it, again to play it. Travel all 50 nights with your crew!',
      demo: '🌟',
    },
  ];
  return P.map(pg => `<div class="howto-card"><h3>${pg.h}</h3><div class="howto-demo">${pg.demo}</div><p>${pg.p}</p></div>`).join('');
}

// ---- カード/チップの描画ヘルパ ----------------------------------------------

function cardCls(c) { return 'card c-' + parseCard(c).suit; }
function cardInner(c) {
  const { suit, rank } = parseCard(c);
  const g = suitGlyph(suit);
  return `<span class="corner"><span class="num">${rank}</span><span class="cs">${g}</span></span>
    <span class="center">${g}</span>
    <span class="corner br"><span class="num">${rank}</span><span class="cs">${g}</span></span>`;
}
function cardHTML(c, lg, isTask) {
  return `<div class="${cardCls(c)}${lg ? ' lg' : ''}${isTask ? ' tasktag' : ''}">${cardInner(c)}${isTask ? '<span class="tasktag-mark">✦</span>' : ''}</div>`;
}
function chipHTML(tk) {
  const { suit, rank } = parseCard(tk.card);
  const ord = tk.order ? `<span class="ord">${tk.order}</span>` : '';
  const last = tk.last ? `<span class="lasttag">${currentLang() === 'ja' ? '終' : 'L'}</span>` : '';
  return `<div class="chip s-${suit} ${tk.done ? 'done' : ''}">${ord}${last}<span>${rank}</span><span class="cs">${suitGlyph(suit)}</span></div>`;
}
function miniChip(c) {
  const { suit, rank } = parseCard(c);
  return `<span class="minichip s-${suit}">${rank}<span class="cs">${suitGlyph(suit)}</span></span>`;
}
function miniCardText(c) { const { suit, rank } = parseCard(c); return `${tt(SUIT_INFO[suit].name)}${rank}`; }
function tagIcon(tag) { return tag === 'highest' ? '▲' : tag === 'only' ? '●' : '▼'; }
function charImg(ch, cls = '') { return `<img class="char-img ${cls}" src="assets/img/${ch}.png" alt="">`; }
function charMini(ch) { return `<span class="char-mini" style="background:var(--chara-${ch})">${charImg(ch)}</span>`; }
function inlineSuit(suit) { return `<span class="isuit s-${suit}">${suitGlyph(suit)}</span>`; }
function tagLabel(tag) { return tag === 'highest' ? { ja: 'いちばん強い', en: 'the highest' } : tag === 'only' ? { ja: 'これ1枚だけ', en: 'the only one' } : { ja: 'いちばん弱い', en: 'the lowest' }; }
function signalPhrase(p, card) {
  const tag = signalTag(state, p, card);
  return `${miniCardText(card)} ${tt(tagLabel(tag))}`;
}
function liveWinner(plays) {
  const comets = plays.filter(x => isComet(x.card));
  if (comets.length) return comets.reduce((a, b) => parseCard(a.card).rank > parseCard(b.card).rank ? a : b).player;
  const led = parseCard(plays[0].card).suit;
  const inSuit = plays.filter(x => parseCard(x.card).suit === led);
  return inSuit.reduce((a, b) => parseCard(a.card).rank > parseCard(b.card).rank ? a : b).player;
}

// ---- エフェクト -------------------------------------------------------------

function starBurst() { burstAtEl(document.getElementById('trick-slots')); }
function starBurstAt(seat) {
  const el = document.querySelector('.trick-slots .slot.p' + seat) || document.getElementById('trick-slots');
  burstAtEl(el, 8);
}
function burstAtEl(el, n = 6) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'particle'; p.textContent = '✦';
    p.style.left = cx + 'px'; p.style.top = cy + 'px';
    p.style.color = i % 2 ? 'var(--suit-star)' : 'var(--c-glow)'; p.style.fontSize = (11 + Math.random() * 11) + 'px';
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = 34 + Math.random() * 40;
    p.animate([{ transform: 'translate(0,0) scale(0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) scale(1.3) rotate(180deg)`, opacity: 0 }], { duration: 720, easing: 'ease-out' });
    fxLayer.appendChild(p); setTimeout(() => p.remove(), 740);
  }
}
function sparkleAt() { starBurst(); }
function starRain() {
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle'; p.textContent = '⭐';
    p.style.left = Math.random() * 100 + 'vw'; p.style.top = '-30px';
    p.style.fontSize = (10 + Math.random() * 14) + 'px';
    p.style.animation = `fall ${2 + Math.random() * 2}s linear ${Math.random()}s forwards`;
    fxLayer.appendChild(p); setTimeout(() => p.remove(), 4500);
  }
}
function shootingStar() {
  const p = document.createElement('div');
  p.className = 'particle'; p.textContent = '💫'; p.style.fontSize = '28px';
  p.style.right = '20vw'; p.style.top = '20vh';
  p.style.animation = 'shoot 1.2s ease-in forwards';
  fxLayer.appendChild(p); setTimeout(() => p.remove(), 1300);
}

// ---- 汎用ヘルパ -------------------------------------------------------------

let toastTimer = null;
function toast(msg, ch) {
  toastEl.innerHTML = (ch ? charMini(ch) + ' ' : '') + `<span>${msg}</span>`;
  toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}
function tap() { resumeAudio(); play('tap', { gain: 0.6 }); }
function back() { resumeAudio(); play('back', { gain: 0.6 }); }
function cancelPendingLeader() { if (pendingLeaderTimer) { clearTimeout(pendingLeaderTimer); pendingLeaderTimer = null; } }

boot();
