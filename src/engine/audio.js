// Fully procedural audio via the Web Audio API — no asset files. Every sound is
// synthesized from oscillators, noise bursts, and filter envelopes. Good audio
// is half of game feel, so each effect is hand-tuned with a punchy envelope and
// a touch of randomization so repeated shots never sound identical.

import { clamp, rand } from './math.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ready = false;
    this._noise = null;
    this._music = null;
    this._grind = null;
    this.enabled = true;
    this._volume = 0.85;
    this._muted = false;
  }

  // Must be called from a user gesture (click / pointer lock) to satisfy
  // browser autoplay policy.
  resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') {
      const r = this.ctx.resume();
      if (r && r.catch) r.catch(() => {}); // ignore autoplay-policy rejections
    }
  }

  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;
    this.master.connect(this.ctx.destination);

    // gentle limiter so stacked explosions don't clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 16;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    comp.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1.0;
    this.sfxGain.connect(comp);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(comp);

    this._noise = this._makeNoiseBuffer(1.0);
    this.ready = true;
  }

  setMasterVolume(v) {
    this._volume = clamp(v, 0, 1);
    if (this.master && !this._muted) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
  }
  setMuted(m) {
    this._muted = m; this.enabled = !m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this._volume, this.ctx.currentTime, 0.02);
  }

  _makeNoiseBuffer(seconds) {
    const len = (this.ctx.sampleRate * seconds) | 0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _now() { return this.ctx.currentTime; }

  // ---- low-level voices -------------------------------------------------

  _noiseBurst({ dur = 0.1, vol = 0.5, type = 'highpass', freq = 1000, q = 1, sweepTo = null, dest = null }) {
    if (!this.ready) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    if (sweepTo != null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), this._now() + dur);
    const g = this.ctx.createGain();
    const t = this._now();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(dest || this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone({ freq = 220, freq2 = null, dur = 0.15, vol = 0.4, type = 'sine', dest = null, attack = 0.004 }) {
    if (!this.ready) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const t = this._now();
    osc.frequency.setValueAtTime(freq, t);
    if (freq2 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Stereo panner that positions a sound left/right based on a -1..1 value.
  // One-shot voices connect to it; we disconnect it shortly after so dead
  // panner nodes don't accumulate on the live sfxGain graph.
  _panned(pan = 0) {
    if (!this.ready) return null; // not initialized yet; callers no-op on null dest
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(this.sfxGain);
    setTimeout(() => { try { p.disconnect(); } catch (e) {} }, 1500);
    return p;
  }

  // ---- gameplay sounds --------------------------------------------------

  gunshot(strength = 1) {
    if (!this.ready) return;
    // crack (filtered noise) + low thump body + a short pitched snap
    this._noiseBurst({ dur: 0.09 * strength, vol: 0.55, type: 'highpass', freq: 1800, sweepTo: 600 });
    this._noiseBurst({ dur: 0.16 * strength, vol: 0.32, type: 'lowpass', freq: 900, sweepTo: 180 });
    this._tone({ freq: rand(170, 210), freq2: 60, dur: 0.12, vol: 0.4, type: 'square' });
  }

  shotgun() {
    if (!this.ready) return;
    this._noiseBurst({ dur: 0.22, vol: 0.65, type: 'lowpass', freq: 1400, sweepTo: 160 });
    this._noiseBurst({ dur: 0.12, vol: 0.4, type: 'highpass', freq: 2200, sweepTo: 700 });
    this._tone({ freq: 130, freq2: 45, dur: 0.2, vol: 0.45, type: 'square' });
  }

  pistol() {
    if (!this.ready) return;
    this._noiseBurst({ dur: 0.07, vol: 0.5, type: 'highpass', freq: 2400, sweepTo: 900 });
    this._tone({ freq: rand(230, 270), freq2: 90, dur: 0.09, vol: 0.34, type: 'square' });
  }

  dryFire() {
    this._tone({ freq: 1800, dur: 0.03, vol: 0.18, type: 'square' });
    this._noiseBurst({ dur: 0.04, vol: 0.12, type: 'highpass', freq: 4000 });
  }

  reloadOut() { this._tone({ freq: 320, freq2: 180, dur: 0.08, vol: 0.22, type: 'square' }); this._noiseBurst({ dur: 0.05, vol: 0.12, type: 'bandpass', freq: 1200 }); }
  reloadIn() { this._tone({ freq: 180, freq2: 360, dur: 0.07, vol: 0.24, type: 'square' }); }
  reloadDone() { this._tone({ freq: 520, freq2: 760, dur: 0.06, vol: 0.22, type: 'square' }); this._noiseBurst({ dur: 0.04, vol: 0.14, type: 'bandpass', freq: 2400 }); }

  impact(pan = 0) {
    if (!this.ready) return;
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.06, vol: 0.3, type: 'bandpass', freq: rand(1400, 2200), q: 1.5, dest });
  }

  hitmarker() { this._tone({ freq: 1400, freq2: 1700, dur: 0.05, vol: 0.3, type: 'triangle' }); }
  headshot() { this._tone({ freq: 1900, freq2: 2500, dur: 0.07, vol: 0.34, type: 'triangle' }); this._tone({ freq: 950, dur: 0.05, vol: 0.18, type: 'square' }); }

  enemyHit(pan = 0) {
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.07, vol: 0.28, type: 'bandpass', freq: rand(500, 800), q: 2, dest });
    this._tone({ freq: rand(120, 160), freq2: 70, dur: 0.08, vol: 0.2, type: 'sawtooth', dest });
  }

  enemyDeath(pan = 0) {
    const dest = this._panned(pan);
    this._tone({ freq: 220, freq2: 40, dur: 0.4, vol: 0.4, type: 'sawtooth', dest });
    this._noiseBurst({ dur: 0.35, vol: 0.4, type: 'lowpass', freq: 1200, sweepTo: 120, dest });
  }

  enemyAttack(pan = 0) {
    const dest = this._panned(pan);
    this._tone({ freq: 420, freq2: 120, dur: 0.18, vol: 0.3, type: 'sawtooth', dest });
  }

  enemyShoot(pan = 0) {
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.1, vol: 0.3, type: 'bandpass', freq: 1400, sweepTo: 500, q: 1.5, dest });
    this._tone({ freq: 300, freq2: 90, dur: 0.1, vol: 0.2, type: 'square', dest });
  }

  playerHurt() {
    this._tone({ freq: 180, freq2: 90, dur: 0.22, vol: 0.4, type: 'sawtooth' });
    this._noiseBurst({ dur: 0.12, vol: 0.25, type: 'lowpass', freq: 700, sweepTo: 200 });
  }

  footstep(speed = 1) {
    this._noiseBurst({ dur: 0.045, vol: 0.1 + 0.06 * speed, type: 'lowpass', freq: rand(380, 520), q: 1 });
  }

  jump() { this._tone({ freq: 320, freq2: 480, dur: 0.1, vol: 0.18, type: 'square' }); }
  slide() { this._noiseBurst({ dur: 0.5, vol: 0.22, type: 'bandpass', freq: 1600, sweepTo: 300, q: 0.8 }); }

  // --- grind rails ---
  grindStart() { [0, 45, 90].forEach((d, i) => setTimeout(() => this._tone({ freq: 523 * Math.pow(1.33, i), dur: 0.08, vol: 0.18, type: 'triangle' }), d)); }
  railLaunch() {
    this._noiseBurst({ dur: 0.2, vol: 0.24, type: 'highpass', freq: 700, sweepTo: 3200 });
    this._tone({ freq: 300, freq2: 760, dur: 0.16, vol: 0.2, type: 'sawtooth' });
  }
  perfect() { [0, 70, 150].forEach((d, i) => setTimeout(() => this._tone({ freq: 880 * Math.pow(1.5, i), dur: 0.12, vol: 0.2, type: 'sine' }), d)); }

  startGrind() {
    if (!this.ready || this._grind) return;
    const t = this._now();
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise; src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 1800; filt.Q.value = 1.2;
    const g = this.ctx.createGain(); g.gain.value = 0.0001;
    src.connect(filt).connect(g).connect(this.sfxGain);
    src.start(t);
    g.gain.setTargetAtTime(0.1, t, 0.05);
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 420;
    const og = this.ctx.createGain(); og.gain.value = 0.0001;
    osc.connect(og).connect(this.sfxGain); osc.start(t);
    og.gain.setTargetAtTime(0.03, t, 0.05);
    this._grind = { src, filt, g, osc, og };
  }
  setGrindIntensity(x) {
    if (!this._grind) return;
    const t = this._now();
    this._grind.filt.frequency.setTargetAtTime(1400 + x * 2600, t, 0.04);
    this._grind.g.gain.setTargetAtTime(0.07 + x * 0.08, t, 0.05);
    this._grind.osc.frequency.setTargetAtTime(360 + x * 540, t, 0.05);
  }
  stopGrind() {
    if (!this._grind) return;
    const t = this._now();
    const m = this._grind; this._grind = null;
    m.g.gain.setTargetAtTime(0.0001, t, 0.04);
    m.og.gain.setTargetAtTime(0.0001, t, 0.04);
    setTimeout(() => { try { m.src.stop(); } catch (e) {} try { m.osc.stop(); } catch (e) {} }, 130);
  }
  land(intensity = 0.5) {
    this._noiseBurst({ dur: 0.08, vol: 0.18 + intensity * 0.2, type: 'lowpass', freq: 500, sweepTo: 120 });
    this._tone({ freq: 110, freq2: 55, dur: 0.1, vol: 0.12 + intensity * 0.1, type: 'sine' });
  }

  pickup() { this._tone({ freq: 660, freq2: 990, dur: 0.12, vol: 0.3, type: 'triangle' }); this._tone({ freq: 990, freq2: 1320, dur: 0.1, vol: 0.2, type: 'triangle' }); }
  uiClick() { this._tone({ freq: 700, freq2: 900, dur: 0.04, vol: 0.2, type: 'square' }); }
  uiHover() { this._tone({ freq: 500, dur: 0.02, vol: 0.08, type: 'square' }); }

  waveStart() {
    this._tone({ freq: 200, freq2: 400, dur: 0.3, vol: 0.3, type: 'sawtooth' });
    setTimeout(() => this._tone({ freq: 400, freq2: 600, dur: 0.4, vol: 0.3, type: 'sawtooth' }), 120);
  }
  waveClear() {
    [0, 130, 260].forEach((d, i) => setTimeout(() => this._tone({ freq: 523 * Math.pow(1.26, i), dur: 0.25, vol: 0.28, type: 'triangle' }), d));
  }
  gameOver() {
    [0, 200, 400, 650].forEach((d, i) => setTimeout(() => this._tone({ freq: 440 / Math.pow(1.2, i), freq2: 200 / Math.pow(1.2, i), dur: 0.5, vol: 0.32, type: 'sawtooth' }), d));
  }

  // ---- ambient music ----------------------------------------------------
  // A slow, evolving two-oscillator drone with a filtered pulse — keeps energy
  // up without samples. Faded in/out via musicGain.

  startMusic() {
    if (!this.ready || this._music) return;
    const t = this._now();
    const nodes = [];
    const baseFreqs = [55, 82.4, 110]; // A1, E2, A2 drone bed
    baseFreqs.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = f * 0.01;
      lfo.connect(lfoGain).connect(o.detune);
      const g = this.ctx.createGain();
      g.gain.value = 0.12 / (i + 1);
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 400 + i * 200;
      o.connect(filt).connect(g).connect(this.musicGain);
      o.start(t); lfo.start(t);
      nodes.push(o, lfo);
    });
    this._music = { nodes };
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(0.5, t, 2.5);
  }

  setMusicIntensity(x) {
    if (!this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(0.3 + clamp(x, 0, 1) * 0.5, this._now(), 1.5);
  }

  stopMusic() {
    if (!this._music) return;
    const t = this._now();
    this.musicGain.gain.setTargetAtTime(0.0, t, 1.0);
    const m = this._music;
    this._music = null;
    setTimeout(() => m.nodes.forEach((n) => { try { n.stop(); } catch (e) {} }), 2000);
  }
}
