/* sound.js — 効果音（Web Audio API で合成するロイヤリティフリーSFX）
   外部音源ファイル不要・完全オフライン・ライセンス/帰属表示の心配なし。
   window.SFX.play('名前') で再生。iOSはユーザー操作後にAudioContextを起動する必要があるため、
   最初のタッチ/クリックで自動的にresumeする。 */
(function () {
  let ctx = null;
  let enabled = true; // game.js 側の設定で上書きされる

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch (e) { ctx = null; }
    return ctx;
  }

  // 最初のユーザー操作で AudioContext を起動（iOS対策）
  function unlock() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, unlock, { passive: true })
  );

  // ---- 合成プリミティブ ----
  function env(node, gainNode, t0, attack, hold, release, peak) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack);
    g.setValueAtTime(peak, t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  function tone(t0, { freq = 440, to = null, dur = 0.15, type = 'sine', gain = 0.2, attack = 0.005 }) {
    const c = ctx;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    env(osc, g, t0, attack, 0.01, dur, gain);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(t0, { dur = 0.12, gain = 0.2, type = 'bandpass', freq = 1800, q = 0.8, to = null }) {
    const c = ctx;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    if (to) filt.frequency.exponentialRampToValueAtTime(Math.max(50, to), t0 + dur);
    filt.Q.value = q;
    const g = c.createGain();
    env(src, g, t0, 0.004, 0.005, dur, gain);
    src.connect(filt).connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // チップが当たる金属的なクリックを1つ
  function chipHit(t0, base) {
    tone(t0, { freq: base, dur: 0.05, type: 'triangle', gain: 0.18, attack: 0.001 });
    tone(t0, { freq: base * 1.8, dur: 0.04, type: 'square', gain: 0.05, attack: 0.001 });
    noise(t0, { dur: 0.03, gain: 0.06, type: 'highpass', freq: 4000 });
  }

  // ---- 効果音定義 ----
  const SOUNDS = {
    click() { const t = ctx.currentTime; tone(t, { freq: 660, dur: 0.04, type: 'square', gain: 0.12, attack: 0.001 }); },
    flip() { const t = ctx.currentTime; noise(t, { dur: 0.09, gain: 0.18, type: 'bandpass', freq: 2600, to: 1200, q: 0.7 }); },
    deal() {
      const t = ctx.currentTime;
      noise(t, { dur: 0.14, gain: 0.16, type: 'bandpass', freq: 1800, to: 3200, q: 0.6 });
    },
    check() {
      const t = ctx.currentTime;
      tone(t, { freq: 160, dur: 0.06, type: 'sine', gain: 0.22, attack: 0.001 });
      tone(t + 0.09, { freq: 150, dur: 0.06, type: 'sine', gain: 0.18, attack: 0.001 });
    },
    chip() { const t = ctx.currentTime; chipHit(t, 2000); chipHit(t + 0.05, 2300); },
    chips() {
      const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) chipHit(t + i * 0.045 + Math.random() * 0.01, 1900 + i * 120);
    },
    allin() {
      const t = ctx.currentTime;
      for (let i = 0; i < 7; i++) chipHit(t + i * 0.04 + Math.random() * 0.012, 1700 + i * 90);
      tone(t, { freq: 110, to: 70, dur: 0.4, type: 'sine', gain: 0.18, attack: 0.005 });
    },
    fold() { const t = ctx.currentTime; noise(t, { dur: 0.22, gain: 0.14, type: 'lowpass', freq: 1400, to: 300, q: 0.4 }); },
    win() {
      const t = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => tone(t + i * 0.1, { freq: f, dur: 0.22, type: 'triangle', gain: 0.16, attack: 0.005 }));
    },
    lose() {
      const t = ctx.currentTime;
      const notes = [392.0, 329.63, 261.63]; // G4 E4 C4
      notes.forEach((f, i) => tone(t + i * 0.12, { freq: f, dur: 0.22, type: 'sine', gain: 0.14, attack: 0.005 }));
    },
  };

  window.SFX = {
    setEnabled(v) { enabled = !!v; },
    play(name) {
      if (!enabled) return;
      const c = ensureCtx();
      if (!c) return;
      if (c.state === 'suspended') c.resume().catch(() => {});
      const fn = SOUNDS[name];
      if (!fn) return;
      try { fn(); } catch (e) { /* 失敗しても無視 */ }
    },
  };
})();
