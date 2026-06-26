// Game bootstrap + main loop. Owns the renderer, the state machine
// (menu → playing ⇄ paused → dead), hitscan resolution, player health, and the
// two-pass render (world, then the viewmodel overlay with depth cleared).

import * as THREE from 'three';
import { clamp, clamp01 } from './engine/math.js';
import { Input } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { FX } from './engine/fx.js';
import { Controller } from './player/controller.js';
import { CameraRig } from './player/camera.js';
import { Weapons } from './weapons/weapon.js';
import { buildLevel } from './world/level.js';
import { buildRails } from './world/rails.js';
import { EnemyManager } from './enemies/enemy.js';
import { HUD } from './ui/hud.js';

const MAX_HEALTH = 100;
const REGEN_DELAY = 5;
const REGEN_RATE = 14;     // hp / sec
const HIT_INVULN = 0.35;
const BEST_KEY = 'neonbreach.best';
const SLOWMO_KEY = 'neonbreach.slowmo';

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(88, window.innerWidth / window.innerHeight, 0.05, 400);

    this.level = buildLevel(this.scene);
    this.rails = buildRails(this.scene);
    this.fx = new FX(this.scene, this.camera);
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.controller = new Controller(this.level.colliders, this.level.bounds, this.rails);
    this.cam = new CameraRig(this.camera);

    // player handle the enemy system reads/writes
    this.health = MAX_HEALTH;
    this.invuln = 0;
    this.lastDamage = -999;
    this.player = {
      pos: this.controller.pos,
      yaw: () => this.cam.yaw,
      takeDamage: (amt, src) => this.playerTakeDamage(amt, src),
    };

    this.enemies = new EnemyManager(this.scene, this.fx, this.audio, this.level, this.player);

    this.weapons = new Weapons({
      fx: this.fx,
      audio: this.audio,
      cam: this.cam,
      mainCamera: this.camera,
      hitscan: (o, d, r) => this.hitscan(o, d, r),
      applyDamage: (e, dmg, pt, dir, head) => this.applyDamage(e, dmg, pt, dir, head),
    });

    this.hud = new HUD(document.getElementById('hud'));
    this.ray = new THREE.Raycaster();
    this.ray.firstHitOnly = false;

    this.state = 'menu';
    this.time = 0;
    this.runStart = 0;
    this.last = performance.now();

    this.best = this._loadBest();
    this.slowmoEnabled = localStorage.getItem(SLOWMO_KEY) !== 'off';

    this._wireCallbacks();
    this.hud.setHealth(this.health, MAX_HEALTH);
    this.hud.showStart();
    this.hud.setBest(this.best);
    if (this.input.isTouch) this.hud.enableTouchUI();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    requestAnimationFrame((t) => this.loop(t));
  }

  _loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || { score: 0, wave: 0, kills: 0 }; }
    catch (e) { return { score: 0, wave: 0, kills: 0 }; }
  }
  _saveBest() { try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)); } catch (e) {} }

  _wireCallbacks() {
    this.weapons.onAmmoChange = (a) => this.hud.setAmmo(a);
    this.weapons.onSpread = (s) => this.hud.setSpread(s);

    this.enemies.onScore = (total, gained, pos) => {
      this.hud.setScore(total);
      this.hud.popScore(pos, gained, this.camera);
    };
    this.enemies.onKill = () => {
      this.hud.registerKill();
      this.audio.hitmarker();
    };
    this.enemies.onCountChange = (n) => this.hud.setEnemies(n);
    this.enemies.onWaveStart = (n) => {
      this.hud.setWave(n);
      this.hud.banner('WAVE ' + n, n % 5 === 0 ? 'they keep coming…' : 'incoming', '#7df9ff');
    };
    this.enemies.onWaveCleared = (n) => {
      this.hud.banner('WAVE ' + n + ' CLEARED', '+' + (n * 50) + ' bonus', '#3affc0');
      this.enemies.score += n * 50;
      this.hud.setScore(this.enemies.score);
    };

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.audio.resume();
        if (this.state === 'menu' || this.state === 'dead') this.startRun();
        else if (this.state === 'paused') this.state = 'playing';
        this.hud.hideOverlay();
      } else if (this.state === 'playing') {
        this.state = 'paused';
        this.hud.showPause();
      }
    };

    this.hud.el.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.resume();
      if (this.input.isTouch) {
        // no pointer lock on mobile — drive the state machine directly
        if (this.state === 'menu' || this.state === 'dead') this.startRun();
        else if (this.state === 'paused') this.state = 'playing';
        this.hud.hideOverlay();
      } else {
        this.input.requestLock();
      }
    });
    this.hud.el.playBtn.addEventListener('mouseenter', () => this.audio.ready && this.audio.uiHover());

    // touch action buttons
    if (this.input.isTouch) this._wireTouchButtons();

    // 'T' toggles the kill-time slow-mo (persisted)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyT') return;
      this.slowmoEnabled = !this.slowmoEnabled;
      localStorage.setItem(SLOWMO_KEY, this.slowmoEnabled ? 'on' : 'off');
      this.hud.banner(this.slowmoEnabled ? 'TIME-WARP ON' : 'TIME-WARP OFF', '', '#b78bff');
    });
  }

  _wireTouchButtons() {
    const hud = this.hud.el;
    const hold = (el, action) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('active'); this.input.setHeld(action, true); }, { passive: false });
      const up = (e) => { e.preventDefault(); el.classList.remove('active'); this.input.setHeld(action, false); };
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
    };
    hold(hud.touchFire, 'fire');
    hold(hud.touchJump, 'jump');
    hud.touchReload.addEventListener('touchstart', (e) => {
      e.preventDefault();
      hud.touchReload.classList.add('active');
      this.input.setHeld('reload', true);
      this.input.setHeld('reload', false); // a tap = one press
    }, { passive: false });
    hud.touchReload.addEventListener('touchend', () => hud.touchReload.classList.remove('active'));
    hud.touchPause.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.state === 'playing') { this.state = 'paused'; this.hud.showPause(); }
    }, { passive: false });
  }

  startRun() {
    // fresh run (from menu or after death)
    this.controller.reset();
    this.cam.reset();
    this.weapons.reset();
    this.enemies.reset();
    this.fx.trauma = 0;
    this.fx.hitstop = 0;
    this.fx.slowmo = 1;
    this.audio.stopGrind();
    this.health = MAX_HEALTH;
    this.invuln = 0;
    this.lastDamage = this.time;
    this.hud.setHealth(this.health, MAX_HEALTH);
    this.hud.setScore(0);
    this.hud.combo = 0;
    this.enemies.start();
    this.audio.startMusic();
    this.runStart = this.time;
    this.state = 'playing';
  }

  playerTakeDamage(amount, sourcePos) {
    if (this.state !== 'playing' || this.invuln > 0) return;
    this.health -= amount;
    this.invuln = HIT_INVULN;
    this.lastDamage = this.time;
    this.hud.setHealth(Math.max(0, this.health), MAX_HEALTH);
    this.hud.damageFlash(clamp01(amount / 30), sourcePos, this.camera);
    this.audio.playerHurt();
    this.fx.addTrauma(clamp(amount / 22, 0.2, 0.7));
    this.fx.addHitstop(clamp(amount / 200, 0.02, 0.06)); // brief jolt on being hit
    this.cam.addRecoil(0.05 + amount * 0.0022, (Math.random() - 0.5) * 0.09); // flinch
    if (this.health <= 0) this.die();
  }

  die() {
    this.state = 'dead';
    this.input.exitLock();
    this.audio.stopGrind();
    this.audio.gameOver();
    this.audio.setMusicIntensity(0);
    const secs = Math.max(0, Math.floor(this.time - this.runStart));
    const mm = String((secs / 60) | 0).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const score = this.enemies.score, wave = this.enemies.wave, kills = this.enemies.kills;
    const newBest = score > this.best.score;
    if (newBest) { this.best = { score, wave, kills }; this._saveBest(); }
    this.hud.setBest(this.best);
    this.hud.showGameOver({ score, wave, kills, time: `${mm}:${ss}`, best: this.best.score, newBest });
  }

  // Raycast against world + enemies, return nearest hit.
  hitscan(origin, dir, range) {
    this.ray.set(origin, dir);
    this.ray.far = range;
    const targets = this.level.solids.concat(this.enemies.raycastTargets());
    const hits = this.ray.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    const enemy = h.object.userData.enemy || null;
    let normal = null;
    if (h.face) {
      normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
    }
    return { point: h.point, normal, enemy, distance: h.distance };
  }

  applyDamage(enemy, dmg, point, dir, isHead) {
    const killed = enemy.takeDamage(dmg, point, dir, isHead);
    this.hud.popDamage(point, dmg, isHead, this.camera);
    this.hud.hitMarker(isHead, killed);
    // Hit-stop only on impactful moments — a freeze on every body shot would
    // make sustained auto-fire stutter badly.
    if (killed) this.fx.addHitstop(0.075);
    else if (isHead) this.fx.addHitstop(0.04);
    if (isHead && !killed) this.audio.headshot();

    // Slow-mo flourish on kills (toggle with 'T'): clearly readable — the world
    // visibly crawls for a beat. Deeper on head-kills, deepest on a wave-clear.
    if (killed && this.slowmoEnabled) {
      const cleared = this.enemies.aliveCount() === 0 && this.enemies.spawnQueue.length === 0;
      this.fx.addSlowmo(cleared ? 0.15 : isHead ? 0.28 : 0.42);
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weapons.syncCamera(this.cam.fov, w / h);
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const realDt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.step(realDt);
    this.render();
  }

  // One simulation tick on a given real delta. Separated from rAF so it can be
  // driven deterministically (fixed dt) by automated tests.
  step(realDt) {
    this.time += realDt;

    if (this.state === 'playing') {
      this.invuln = Math.max(0, this.invuln - realDt);
      const scale = this.fx.consumeTimeScale(realDt);
      const gdt = realDt * scale;

      this.cam.processLook(realDt, this.input); // aim stays responsive even mid-hitstop

      // Move the world first (player, then enemies), so when we fire below the
      // ray sees everything at its current position.
      if (gdt > 0) {
        this.controller.update(gdt, this.input, this.cam.yaw);
        this._handleMovementAudio();
        this._handleGrind(gdt);
        this.enemies.update(gdt);
        this.level.update(gdt, this.time);
        this.rails.update(gdt);
        this._regen(gdt);
      }
      // Position the camera (eye, bob, shake) before resolving shots from it.
      this.cam.applyView(realDt, this.controller, this.fx, this.input);
      // Weapons run on realDt (not gdt) so firing/aim stay responsive and the
      // fire cadence doesn't stutter during a brief kill hit-stop.
      this.weapons.update(realDt, this.controller, this.input);
      if (this.weapons.reloading) {
        this.hud.setReloadProgress(1 - this.weapons.reloadTimer / this.weapons.def.reloadTime);
      }
    }

    this.fx.update(realDt);
    this.hud.update(realDt, this.camera);
    this.hud.setGrind(this.controller.isGrinding, this.controller.grindSpeed);
    this.hud.setTimewarp(this.fx.slowmo);
    if (this.input.isTouch) {
      this.hud.renderTouchStick(this.input.moveStick);
      this.hud.el.touchControls.style.display = this.state === 'playing' ? '' : 'none';
    }
    this.input.endFrame();
  }

  _handleMovementAudio() {
    const ev = this.controller.events;
    if (ev.jumped) this.audio.jump();
    if (ev.landed > 0) this.audio.land(ev.landed);
    if (ev.stepped) this.audio.footstep(this.controller.isSprinting ? 1 : 0.5);
    if (ev.slid) this.audio.slide();
  }

  _handleGrind(dt) {
    const c = this.controller;
    const ev = c.events;
    if (ev.grindStart) { this.audio.grindStart(); this.audio.startGrind(); this.cam.addFovPunch(3); }
    if (ev.grinding) {
      this.audio.setGrindIntensity(clamp01((c.grindSpeed - 10) / 18));
      this.fx.addTrauma(0.02);
      // spark trail streaming off behind the player
      const l = Math.hypot(c.vel.x, c.vel.y, c.vel.z) || 1;
      for (let i = 0; i < 2; i++) {
        this.fx.sparks.emit(
          c.pos.x, c.pos.y + 0.2, c.pos.z,
          -c.vel.x / l * 3 + (Math.random() - 0.5) * 2, -c.vel.y / l * 3 + 1.5 + Math.random(), -c.vel.z / l * 3 + (Math.random() - 0.5) * 2,
          0.6, 0.95, 1, 0.18 + Math.random() * 0.12, 0.4, 5, 5
        );
      }
    }
    if (ev.grindEnd) { this.audio.stopGrind(); this.audio.railLaunch(); this.fx.addTrauma(0.12); }
    if (ev.perfect) {
      this.audio.perfect();
      this.fx.addSlowmo(0.34);
      this.fx.addTrauma(0.22);
      this.cam.addFovPunch(7);
      this.enemies.score += 250;
      this.hud.setScore(this.enemies.score);
      this.hud.banner('PERFECT LAUNCH', '+250', '#7df9ff');
    }
  }

  _regen(dt) {
    if (this.health < MAX_HEALTH && this.time - this.lastDamage > REGEN_DELAY) {
      this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
      this.hud.setHealth(this.health, MAX_HEALTH);
    }
  }

  render() {
    this.weapons.syncCamera(this.cam.fov, this.camera.aspect);
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.weapons.viewScene, this.weapons.viewCamera);
    this.renderer.autoClear = true;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.__game = new Game(); // exposed for debugging / automated smoke tests
  } catch (err) {
    console.error(err);
    const o = document.getElementById('hud');
    if (o) o.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-family:monospace;padding:2rem;text-align:center">
      <div><h2>Failed to start</h2><pre style="white-space:pre-wrap;color:#ff8080">${(err && err.message) || err}</pre>
      <p>This game needs a WebGL2-capable browser. Serve the folder over http (not file://).</p></div></div>`;
  }
});

export { Game };
