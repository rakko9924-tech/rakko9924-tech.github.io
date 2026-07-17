// sfx.js — 効果音（Kenney CC0 実素材、SFX-CREDITS.md 参照）
const NAMES = ['tap', 'tap2', 'card', 'deal', 'deal2', 'ok', 'task', 'sparkle', 'lamp',
  'back', 'bong', 'fail', 'intro', 'win', 'bell', 'soft'];

const buffers = {};
let ctx = null;
let enabled = true;

export function setSfxEnabled(v) { enabled = v; try { localStorage.setItem('hz-sfx', v ? '1' : '0'); } catch (e) {} }
export function sfxEnabled() { return enabled; }

export async function initSfx() {
  try { enabled = localStorage.getItem('hz-sfx') !== '0'; } catch (e) {}
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  await Promise.all(NAMES.map(async n => {
    try {
      const res = await fetch('assets/se/' + n + '.m4a');
      const buf = await res.arrayBuffer();
      buffers[n] = await ctx.decodeAudioData(buf);
    } catch (e) { /* 素材が読めなくてもゲームは続行 */ }
  }));
}

export function resumeAudio() { // iOSは初回タップで resume が必要
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function play(name, { rate = 1, gain = 0.9, delay = 0 } = {}) {
  if (!enabled || !ctx || !buffers[name]) return;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}

// ミッション成功ジングル: 鈴の実素材をアルペジオで
export function playWinJingle() {
  play('bell', { rate: 1.0, gain: 0.5, delay: 0 });
  play('bell', { rate: 1.26, gain: 0.5, delay: 0.16 });
  play('bell', { rate: 1.5, gain: 0.5, delay: 0.32 });
  play('bell', { rate: 2.0, gain: 0.6, delay: 0.48 });
  play('win', { gain: 0.7, delay: 0.1 });
}

export function playTaskDone() {
  play('task', { gain: 0.8 });
  play('sparkle', { gain: 0.6, delay: 0.08 });
}

export function playFail() {
  play('fail', { gain: 0.7, rate: 0.9 });
}
