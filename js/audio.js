/*
 * Synthesized sound. No audio files: every effect is built from oscillators
 * and filtered noise, so it stays tiny and responds to the game (a pour's
 * glugs rise in pitch as the receiving tube fills, like a real bottle).
 */
(function (root) {
  'use strict';

  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.7;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, t0, dur, opts) {
    opts = opts || {};
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const peak = opts.gain || 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(opts.dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(t0, dur, opts) {
    opts = opts || {};
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 1200, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    f.Q.value = opts.q || 1;
    const g = ctx.createGain();
    const peak = opts.gain || 0.05;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.02));
    g.gain.setValueAtTime(peak, t0 + Math.max(0.02, dur - (opts.release || 0.06)));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
  }

  const Sound = {
    setEnabled(on) { enabled = on; if (!on && ctx) ctx.suspend(); if (on && ctx) ctx.resume(); },
    unlock() { ensure(); },

    /** Glass tink when lifting a tube. Fuller tubes ring lower. */
    select(fill) {
      if (!ensure()) return;
      const t = ctx.currentTime, f = 1900 - 500 * (fill || 0);
      tone(f, t, 0.16, { gain: 0.07 });
      tone(f * 2.76, t, 0.09, { gain: 0.025 });
    },

    deselect() {
      if (!ensure()) return;
      tone(1300, ctx.currentTime, 0.08, { gain: 0.04 });
    },

    /** Stream plus glugs; pitch follows the receiving tube's fill level. */
    pour(delayMs, durMs, fillFrom, fillTo, cap) {
      if (!ensure()) return;
      const t0 = ctx.currentTime + delayMs / 1000, dur = durMs / 1000;
      noise(t0, dur + 0.08, { freq: 900, to: 1500, q: 0.8, gain: 0.035, attack: 0.04, release: 0.1 });
      const count = Math.max(2, Math.round(dur / 0.075));
      for (let i = 0; i < count; i++) {
        const k = i / count;
        const fill = (fillFrom + (fillTo - fillFrom) * k) / cap;
        const f = 260 + 520 * fill * fill + Math.random() * 30;
        const ti = t0 + 0.04 + k * dur + Math.random() * 0.015;
        tone(f, ti, 0.07, { to: f * 1.5, gain: 0.07 + Math.random() * 0.03, attack: 0.006 });
      }
    },

    /** Cork pop and a small rising chime. */
    complete(order) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.05, { filter: 'lowpass', freq: 2400, gain: 0.12, attack: 0.002, release: 0.04 });
      tone(420, t, 0.12, { to: 160, gain: 0.14 });
      const base = [784, 880, 988, 1047, 1175, 1319][(order || 0) % 6];
      tone(base, t + 0.07, 0.35, { type: 'triangle', gain: 0.09 });
      tone(base * 1.5, t + 0.13, 0.4, { type: 'triangle', gain: 0.06 });
    },

    invalid() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(190, t, 0.12, { to: 140, gain: 0.12, type: 'triangle' });
    },

    undo() {
      if (!ensure()) return;
      noise(ctx.currentTime, 0.18, { freq: 1800, to: 500, q: 1.2, gain: 0.05, attack: 0.01 });
    },

    win() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1047, 1319].forEach((f, i) => {
        tone(f, t + i * 0.09, 0.5, { type: 'triangle', gain: 0.1 });
        tone(f * 2, t + i * 0.09, 0.25, { gain: 0.03 });
      });
      noise(t + 0.4, 0.6, { freq: 6000, q: 0.5, gain: 0.025, attack: 0.1, release: 0.4 });
    },

    tap() {
      if (!ensure()) return;
      tone(900, ctx.currentTime, 0.05, { gain: 0.035 });
    },
  };

  const Haptics = {
    enabled: true,
    buzz(pattern) {
      if (!this.enabled || !root.navigator || !navigator.vibrate) return;
      try { navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
    },
  };

  root.SortSound = Sound;
  root.SortHaptics = Haptics;
})(typeof self !== 'undefined' ? self : this);
