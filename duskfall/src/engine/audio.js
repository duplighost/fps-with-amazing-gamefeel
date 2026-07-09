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
    this._lastPlay = {};   // per-key timestamps for rate-limiting repetitive sfx
  }

  // Rate-limit a repeating sound so bursts (e.g. carving a crowd during slow-mo)
  // don't machine-gun the same voice into an abrasive stutter. Returns false to skip.
  _throttle(key, gap) {
    if (!this.ready) return false;
    const t = this.ctx.currentTime;
    const last = this._lastPlay[key];
    if (last !== undefined && t - last < gap) return false;
    this._lastPlay[key] = t;
    return true;
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

  _noiseBurst({ dur = 0.1, vol = 0.5, type = 'highpass', freq = 1000, q = 1, sweepTo = null, dest = null, delay = 0 }) {
    if (!this.ready) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    const t = this._now() + delay;
    filt.frequency.setValueAtTime(freq, t);
    filt.Q.value = q;
    if (sweepTo != null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(dest || this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone({ freq = 220, freq2 = null, dur = 0.15, vol = 0.4, type = 'sine', dest = null, attack = 0.004, delay = 0 }) {
    if (!this.ready) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const t = this._now() + delay;
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
  // Positional destination. Pass a WORLD POSITION ({x,y,z}) for true 3D audio —
  // an HRTF panner places it relative to the listener (the camera), so you hear
  // enemies to your left/right, AHEAD vs BEHIND, ABOVE (divers, the canopy), and
  // softer with distance. Pass a NUMBER for a plain stereo pan (UI / player sfx).
  _panned(arg = 0) {
    if (!this.ready) return null; // not initialized yet; callers no-op on null dest
    let node;
    if (arg && typeof arg === 'object') {
      node = this.ctx.createPanner();
      node.panningModel = 'HRTF';
      node.distanceModel = 'inverse';
      node.refDistance = 8; node.rolloffFactor = 0.85; node.maxDistance = 110;
      if (node.positionX) { node.positionX.value = arg.x; node.positionY.value = arg.y; node.positionZ.value = arg.z; }
      else if (node.setPosition) node.setPosition(arg.x, arg.y, arg.z);
    } else {
      node = this.ctx.createStereoPanner();
      node.pan.value = clamp(arg, -1, 1);
    }
    node.connect(this.sfxGain);
    setTimeout(() => { try { node.disconnect(); } catch (e) {} }, 1500);
    return node;
  }

  // Place the audio listener at the camera each frame (position + facing + up),
  // so the HRTF panners above resolve to real world-space direction cues.
  setListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(px, t); l.positionY.setValueAtTime(py, t); l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(ux, t); l.upY.setValueAtTime(uy, t); l.upZ.setValueAtTime(uz, t);
    } else if (l.setPosition) {
      l.setPosition(px, py, pz); l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---- gameplay sounds --------------------------------------------------

  gunshot(strength = 1) {
    if (!this.ready) return;
    // punchy rifle: a whip-crack transient, a mid body, a boom tail, and a sub thump
    this._noiseBurst({ dur: 0.02, vol: 0.72, type: 'highpass', freq: 4400, sweepTo: 1500 });
    this._noiseBurst({ dur: 0.095 * strength, vol: 0.5, type: 'bandpass', freq: 1250, q: 0.7, sweepTo: 360 });
    this._noiseBurst({ dur: 0.22 * strength, vol: 0.42, type: 'lowpass', freq: 400, sweepTo: 72 });
    this._tone({ freq: 108, freq2: 40, dur: 0.14, vol: 0.36, type: 'sine' });
    this._tone({ freq: 58, freq2: 30, dur: 0.1, vol: 0.22, type: 'sine' });   // sub
  }

  shotgun() {
    if (!this.ready) return;
    // A big, powerful blast (not a pop): a hard crack transient, a loud weighty
    // body sweeping down into a deep chest-thump + sub, a gritty mid crunch for
    // bite, and a short air-tail so it reads as a cannon, not a cap gun.
    this._noiseBurst({ dur: 0.03, vol: 0.9, type: 'highpass', freq: 3900, sweepTo: 650 });   // crack
    this._noiseBurst({ dur: 0.28, vol: 0.82, type: 'lowpass', freq: 1300, sweepTo: 68, q: 0.9 }); // blast body
    this._noiseBurst({ dur: 0.15, vol: 0.5, type: 'bandpass', freq: 1750, q: 0.7, sweepTo: 340 }); // grit
    this._tone({ freq: 98, freq2: 30, dur: 0.26, vol: 0.62, type: 'sine' });     // chest boom
    this._tone({ freq: 150, freq2: 58, dur: 0.09, vol: 0.34, type: 'triangle' });// knock
    this._tone({ freq: 52, freq2: 25, dur: 0.2, vol: 0.42, type: 'sine' });      // deep sub
    this._noiseBurst({ dur: 0.24, vol: 0.3, type: 'lowpass', freq: 480, sweepTo: 80, delay: 0.035 }); // tail
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

  // Each enemy type passes a `voice` (a pitch multiplier) so the horde doesn't
  // sound like one creature. Softer waveforms + wide randomisation keep repeated
  // hits from getting grating.
  enemyHit(pan = 0, voice = 1) {
    if (!this._throttle('ehit', 0.045)) return;   // don't stutter on rapid multi-hits
    const dest = this._panned(pan);
    this._noiseBurst({ dur: rand(0.04, 0.07), vol: 0.2, type: 'lowpass', freq: rand(560, 820), sweepTo: 190, dest });
    this._tone({ freq: rand(140, 210) * voice, freq2: 72 * voice, dur: rand(0.06, 0.11), vol: 0.14, type: 'triangle', dest });
  }

  enemyDeath(pan = 0, voice = 1) {
    if (!this._throttle('edeath', 0.06)) return;  // a dash through a crowd shouldn't machine-gun deaths
    const dest = this._panned(pan);
    this._tone({ freq: rand(150, 210) * voice, freq2: 46 * voice, dur: rand(0.4, 0.6), vol: 0.24, type: 'sawtooth', dest });
    this._tone({ freq: rand(84, 120) * voice, freq2: 38 * voice, dur: 0.5, vol: 0.14, type: 'triangle', dest });
    this._noiseBurst({ dur: 0.16, vol: 0.2, type: 'lowpass', freq: 440, sweepTo: 80, dest, delay: rand(0.16, 0.26) });
  }

  enemyAttack(pan = 0, voice = 1) {
    if (!this._throttle('eatk', 0.06)) return;
    const dest = this._panned(pan);
    this._tone({ freq: rand(160, 200) * voice, freq2: rand(300, 360) * voice, dur: rand(0.1, 0.16), vol: 0.2, type: 'triangle', dest });
    this._noiseBurst({ dur: 0.11, vol: 0.14, type: 'bandpass', freq: 850, q: 0.8, sweepTo: 1500, dest });
  }

  growl(pan = 0, voice = 1) {
    if (!this._throttle('growl', 0.14)) return;
    const dest = this._panned(pan);
    this._tone({ freq: rand(64, 108) * voice, freq2: rand(52, 84) * voice, dur: rand(0.4, 0.62), vol: 0.1, type: 'sawtooth', dest });
    this._noiseBurst({ dur: 0.34, vol: 0.045, type: 'lowpass', freq: 360, dest });
  }

  enrage(pan = 0) {
    // the straggler goes berserk: a rising, distorted roar
    const dest = this._panned(pan);
    this._tone({ freq: 90, freq2: 260, dur: 0.5, vol: 0.34, type: 'sawtooth', dest });
    this._tone({ freq: 140, freq2: 320, dur: 0.4, vol: 0.2, type: 'square', dest });
    this._noiseBurst({ dur: 0.4, vol: 0.2, type: 'bandpass', freq: 600, sweepTo: 2200, q: 0.8, dest });
  }

  bossIntro() {
    // cinematic arrival: a deep sub boom, a rising brass-ish swell, and a hit
    this._tone({ freq: 55, freq2: 34, dur: 1.2, vol: 0.4, type: 'sine' });
    this._tone({ freq: 110, freq2: 220, dur: 0.9, vol: 0.3, type: 'sawtooth' });
    this._noiseBurst({ dur: 0.7, vol: 0.22, type: 'lowpass', freq: 300, sweepTo: 1400 });
    setTimeout(() => { this._tone({ freq: 82, freq2: 41, dur: 0.8, vol: 0.34, type: 'sawtooth' }); this._noiseBurst({ dur: 0.2, vol: 0.3, type: 'lowpass', freq: 400, sweepTo: 80 }); }, 520);
  }

  bossSlam(pan = 0) {
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.22, vol: 0.5, type: 'lowpass', freq: 800, sweepTo: 60, dest });
    this._tone({ freq: 90, freq2: 34, dur: 0.3, vol: 0.4, type: 'sine', dest });
    this._tone({ freq: 160, freq2: 50, dur: 0.14, vol: 0.24, type: 'square', dest });
  }

  bossDeath() {
    // a drawn-out collapse: chained explosions + a descending groan
    [0, 140, 300, 480].forEach((d, i) => setTimeout(() => {
      this._noiseBurst({ dur: 0.4, vol: 0.4, type: 'lowpass', freq: 700 - i * 120, sweepTo: 70 });
      this._tone({ freq: 120 / (1 + i * 0.3), freq2: 40, dur: 0.6, vol: 0.32, type: 'sawtooth' });
    }, d));
    setTimeout(() => this._tone({ freq: 523, freq2: 784, dur: 0.5, vol: 0.24, type: 'triangle' }), 650);
  }

  enemyShoot(pan = 0) {
    // a sniper bolt release: a sharp zap with a whistling tail
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.1, vol: 0.3, type: 'bandpass', freq: 1400, sweepTo: 500, q: 1.5, dest });
    this._tone({ freq: 640, freq2: 180, dur: 0.16, vol: 0.22, type: 'sawtooth', dest });
  }
  seerCharge(pan = 0) {
    // a rising, ominous telegraph so you know to dodge
    const dest = this._panned(pan);
    this._tone({ freq: 180, freq2: 720, dur: 0.7, vol: 0.16, type: 'triangle', dest });
    this._noiseBurst({ dur: 0.6, vol: 0.08, type: 'bandpass', freq: 700, sweepTo: 2400, q: 1.2, dest });
  }
  snowballThrow(pan = 0) {
    // a heavy grunt + a low whoomph of a huge mass being hurled
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.28, vol: 0.34, type: 'lowpass', freq: 520, sweepTo: 140, dest });
    this._tone({ freq: 150, freq2: 60, dur: 0.3, vol: 0.28, type: 'sawtooth', dest });
  }
  snowballImpact(pan = 0) {
    // a wet, crunchy pack of snow bursting
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.16, vol: 0.34, type: 'lowpass', freq: 900, sweepTo: 160, q: 0.8, dest });
    this._noiseBurst({ dur: 0.1, vol: 0.18, type: 'highpass', freq: 3000, sweepTo: 1200, dest });
    this._tone({ freq: 110, freq2: 50, dur: 0.14, vol: 0.16, type: 'sine', dest });
  }
  snowballReflect(pan = 0) {
    // a satisfying, bright "PING" of batting it back
    const dest = this._panned(pan);
    this._tone({ freq: 900, freq2: 1600, dur: 0.14, vol: 0.34, type: 'triangle', dest });
    this._tone({ freq: 500, freq2: 900, dur: 0.1, vol: 0.2, type: 'square', dest });
    this._noiseBurst({ dur: 0.12, vol: 0.24, type: 'bandpass', freq: 2000, sweepTo: 600, q: 1, dest });
  }
  grenadeThrow() {
    // a quick pin-pull click + an airy underhand toss whoosh
    this._tone({ freq: 1200, dur: 0.03, vol: 0.16, type: 'square' });
    this._noiseBurst({ dur: 0.2, vol: 0.16, type: 'bandpass', freq: 600, sweepTo: 1900, q: 0.7 });
  }
  grenadeExplode(pan = 0) {
    // a huge, powerful detonation: a sharp crack, a massive low boom + sub, grit tail
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.03, vol: 0.9, type: 'highpass', freq: 4200, sweepTo: 500, dest });
    this._noiseBurst({ dur: 0.5, vol: 0.85, type: 'lowpass', freq: 1400, sweepTo: 55, q: 0.8, dest });
    this._noiseBurst({ dur: 0.28, vol: 0.5, type: 'bandpass', freq: 1300, q: 0.6, sweepTo: 260, dest });
    this._tone({ freq: 78, freq2: 26, dur: 0.5, vol: 0.6, type: 'sine', dest });
    this._tone({ freq: 46, freq2: 22, dur: 0.4, vol: 0.42, type: 'sine', dest });
    this._noiseBurst({ dur: 0.5, vol: 0.34, type: 'lowpass', freq: 400, sweepTo: 70, dest, delay: 0.05 });
  }
  yetiRoar(pan = 0) {
    // a huge, cavernous bellow
    const dest = this._panned(pan);
    this._tone({ freq: 70, freq2: 130, dur: 0.9, vol: 0.4, type: 'sawtooth', dest });
    this._tone({ freq: 105, freq2: 62, dur: 0.8, vol: 0.26, type: 'sawtooth', dest });
    this._noiseBurst({ dur: 0.7, vol: 0.22, type: 'lowpass', freq: 500, sweepTo: 1300, dest });
  }

  playerHurt() {
    this._tone({ freq: 180, freq2: 90, dur: 0.22, vol: 0.4, type: 'sawtooth' });
    this._noiseBurst({ dur: 0.12, vol: 0.25, type: 'lowpass', freq: 700, sweepTo: 200 });
  }

  footstep(speed = 1) {
    this._noiseBurst({ dur: 0.045, vol: 0.1 + 0.06 * speed, type: 'lowpass', freq: rand(380, 520), q: 1 });
  }
  footstepWater(speed = 1) {
    // sloshing wade: a wet plop + a bright droplet spray
    this._noiseBurst({ dur: 0.09, vol: 0.16 + 0.08 * speed, type: 'lowpass', freq: rand(700, 1000), sweepTo: 220, q: 0.8 });
    this._noiseBurst({ dur: 0.06, vol: 0.09, type: 'highpass', freq: rand(2400, 3400), sweepTo: 1400, delay: 0.02 });
    this._tone({ freq: rand(190, 260), freq2: 90, dur: 0.06, vol: 0.06, type: 'sine' });
  }
  footstepIce(speed = 1) {
    // hard glassy click with a faint skate hiss
    this._tone({ freq: rand(900, 1300), freq2: 500, dur: 0.03, vol: 0.1 + 0.05 * speed, type: 'triangle' });
    this._noiseBurst({ dur: 0.07, vol: 0.06, type: 'highpass', freq: 3200, sweepTo: 1800 });
  }
  splash(pan = 0, size = 1) {
    if (!this._throttle('splash', 0.09)) return;
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.16 * size, vol: 0.22 * size, type: 'lowpass', freq: 900, sweepTo: 200, q: 0.7, dest });
    this._noiseBurst({ dur: 0.1, vol: 0.1 * size, type: 'highpass', freq: 2600, sweepTo: 1200, delay: 0.03, dest });
  }
  iceCrack() {
    // the whole pond snapping frozen: sharp cracks over a deep groan
    [0, 90, 210].forEach((d, i) => setTimeout(() => {
      this._noiseBurst({ dur: 0.05, vol: 0.4 - i * 0.08, type: 'highpass', freq: 2600 - i * 500, sweepTo: 900 });
      this._tone({ freq: 1500 - i * 320, freq2: 500, dur: 0.06, vol: 0.22, type: 'triangle' });
    }, d));
    this._tone({ freq: 68, freq2: 34, dur: 0.9, vol: 0.34, type: 'sine' });
    this._noiseBurst({ dur: 0.5, vol: 0.16, type: 'lowpass', freq: 420, sweepTo: 90 });
  }

  jump() { this._tone({ freq: 320, freq2: 480, dur: 0.1, vol: 0.18, type: 'square' }); }
  doubleJump() {
    // an airy upward whoosh + a bright confirming chime for the second launch
    this._noiseBurst({ dur: 0.22, vol: 0.22, type: 'bandpass', freq: 500, sweepTo: 2600, q: 0.7 });
    this._tone({ freq: 440, freq2: 880, dur: 0.14, vol: 0.22, type: 'triangle' });
  }
  slide() { this._noiseBurst({ dur: 0.5, vol: 0.22, type: 'bandpass', freq: 1600, sweepTo: 300, q: 0.8 }); }
  mantle() {
    // a quick scramble-and-vault: a short grunt of effort + a rising whoosh
    this._noiseBurst({ dur: 0.12, vol: 0.18, type: 'bandpass', freq: 700, sweepTo: 2000, q: 0.7 });
    this._tone({ freq: 260, freq2: 520, dur: 0.12, vol: 0.18, type: 'triangle' });
  }
  dash() {
    // a fast air-tearing swoosh with a low body thump
    this._noiseBurst({ dur: 0.24, vol: 0.34, type: 'bandpass', freq: 900, sweepTo: 3400, q: 0.6 });
    this._noiseBurst({ dur: 0.16, vol: 0.2, type: 'lowpass', freq: 700, sweepTo: 180 });
    this._tone({ freq: 220, freq2: 520, dur: 0.13, vol: 0.2, type: 'sawtooth' });
  }
  dashHit(pan = 0) {
    if (!this._throttle('dashhit', 0.04)) return;
    // a heavy shoulder-charge crunch
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.09, vol: 0.4, type: 'lowpass', freq: 900, sweepTo: 150, q: 1, dest });
    this._tone({ freq: 150, freq2: 60, dur: 0.14, vol: 0.3, type: 'square', dest });
  }
  finisher(pan = 0) {
    // a decisive, cinematic execution stinger: deep boom + metallic shing
    const dest = this._panned(pan);
    this._noiseBurst({ dur: 0.14, vol: 0.5, type: 'lowpass', freq: 700, sweepTo: 90, dest });
    this._tone({ freq: 120, freq2: 44, dur: 0.4, vol: 0.36, type: 'sawtooth', dest });
    this._tone({ freq: 1600, freq2: 2600, dur: 0.12, vol: 0.28, type: 'triangle', dest });
    setTimeout(() => this._tone({ freq: 880, freq2: 1320, dur: 0.16, vol: 0.22, type: 'triangle' }), 60);
  }
  ammoGrab() {
    // a crisp mechanical "clip in" confirm
    this._tone({ freq: 740, freq2: 1180, dur: 0.09, vol: 0.26, type: 'square' });
    this._noiseBurst({ dur: 0.05, vol: 0.16, type: 'bandpass', freq: 2600, q: 0.8 });
  }

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

  slowmoIn() {
    // a downward "vwoom" into bullet-time
    this._tone({ freq: 520, freq2: 130, dur: 0.5, vol: 0.24, type: 'sawtooth' });
    this._noiseBurst({ dur: 0.4, vol: 0.14, type: 'lowpass', freq: 1800, sweepTo: 300, q: 0.7 });
  }
  slowmoOut() {
    // snap back up to real time
    this._tone({ freq: 180, freq2: 620, dur: 0.24, vol: 0.2, type: 'sawtooth' });
    this._noiseBurst({ dur: 0.18, vol: 0.12, type: 'highpass', freq: 500, sweepTo: 2400 });
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

  // ---- adaptive ambient music ------------------------------------------
  // Three fully-synth layers routed through a mood filter:
  //   drone   — an evolving minor pad, always present
  //   tension — a bandpassed shimmer that swells with the action
  //   pulse   — a low heartbeat throb that deepens + quickens in combat
  // setMusicIntensity() cross-fades tension/pulse; setMusicMood() closes the
  // filter to a cold, muffled hush as winter and the haunt set in.

  startMusic() {
    if (!this.ready || this._music) return;
    const t = this._now();
    const nodes = [];
    const mood = this.ctx.createBiquadFilter();
    mood.type = 'lowpass'; mood.frequency.value = 900; mood.Q.value = 0.6;
    mood.connect(this.musicGain);

    // --- drone bed (A minor-ish) ---
    const droneG = this.ctx.createGain(); droneG.gain.value = 1; droneG.connect(mood);
    [55, 82.4, 110, 130.8].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i >= 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.045 + i * 0.028;
      const lg = this.ctx.createGain(); lg.gain.value = f * 0.008;
      lfo.connect(lg).connect(o.detune);
      const g = this.ctx.createGain(); g.gain.value = 0.11 / (i + 1);
      o.connect(g).connect(droneG); o.start(t); lfo.start(t);
      nodes.push(o, lfo);
    });

    // --- tension shimmer (swells with intensity) ---
    const tenG = this.ctx.createGain(); tenG.gain.value = 0.0001; tenG.connect(mood);
    const to = this.ctx.createOscillator(); to.type = 'sawtooth'; to.frequency.value = 220;
    const to2 = this.ctx.createOscillator(); to2.type = 'sawtooth'; to2.frequency.value = 329.6; to2.detune.value = 8;
    const tf = this.ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 900; tf.Q.value = 2.2;
    const tlfo = this.ctx.createOscillator(); tlfo.frequency.value = 0.13;
    const tlg = this.ctx.createGain(); tlg.gain.value = 500; tlfo.connect(tlg).connect(tf.frequency);
    to.connect(tf); to2.connect(tf); tf.connect(tenG);
    to.start(t); to2.start(t); tlfo.start(t); nodes.push(to, to2, tlfo);

    // --- combat pulse (heartbeat throb) ---
    const pulseG = this.ctx.createGain(); pulseG.gain.value = 0.0001; pulseG.connect(mood);
    const po = this.ctx.createOscillator(); po.type = 'sine'; po.frequency.value = 55;
    const plfo = this.ctx.createOscillator(); plfo.type = 'sine'; plfo.frequency.value = 1.9;
    const plg = this.ctx.createGain(); plg.gain.value = 0.16; plfo.connect(plg).connect(pulseG.gain);
    po.connect(pulseG); po.start(t); plfo.start(t); nodes.push(po, plfo);

    this._music = { nodes, mood, tenG, pulseG, plfo, pulseBase: 0.0001 };
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setTargetAtTime(0.5, t, 2.5);
  }

  setMusicIntensity(x) {
    if (!this._music) return;
    x = clamp(x, 0, 1); const t = this._now();
    this._music.tenG.gain.setTargetAtTime(0.015 + x * 0.11, t, 1.2);
    this._music.plfo.frequency.setTargetAtTime(1.5 + x * 2.4, t, 1.5);   // pulse quickens
    this._music.pulseBase = x * 0.12;                                     // pulse deepens
    this._music.pulseG.gain.setTargetAtTime(this._music.pulseBase + 0.0001, t, 1.0);
    this.musicGain.gain.setTargetAtTime(0.34 + x * 0.32, t, 1.5);
  }

  // season 0..1 → progressively colder, more muffled and dread-laden
  setMusicMood(season) {
    if (!this._music) return;
    const s = clamp(season, 0, 1);
    this._music.mood.frequency.setTargetAtTime(1000 - s * 560, this._now(), 2.0);
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
