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
import { EnemyManager } from './enemies/enemy.js';
import { HUD } from './ui/hud.js';

const MAX_HEALTH = 100;
const REGEN_DELAY = 5;
const REGEN_RATE = 14;     // hp / sec
const HIT_INVULN = 0.35;

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
    this.fx = new FX(this.scene, this.camera);
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.controller = new Controller(this.level.colliders, this.level.bounds);
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

    this._wireCallbacks();
    this.hud.setHealth(this.health, MAX_HEALTH);
    this.hud.showStart();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    requestAnimationFrame((t) => this.loop(t));
  }

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
      this.input.requestLock();
    });
    this.hud.el.playBtn.addEventListener('mouseenter', () => this.audio.ready && this.audio.uiHover());
  }

  startRun() {
    // fresh run (from menu or after death)
    this.controller.reset();
    this.cam.reset();
    this.weapons.reset();
    this.enemies.reset();
    this.fx.trauma = 0;
    this.fx.hitstop = 0;
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
    this.fx.addTrauma(clamp(amount / 28, 0.12, 0.6));
    this.fx.addHitstop(clamp(amount / 220, 0.015, 0.05)); // brief jolt on being hit
    this.cam.addRecoil(0.02 + amount * 0.0016, (Math.random() - 0.5) * 0.05); // flinch
    if (this.health <= 0) this.die();
  }

  die() {
    this.state = 'dead';
    this.input.exitLock();
    this.audio.gameOver();
    this.audio.setMusicIntensity(0);
    const secs = Math.max(0, Math.floor(this.time - this.runStart));
    const mm = String((secs / 60) | 0).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    this.hud.showGameOver({
      score: this.enemies.score,
      wave: this.enemies.wave,
      kills: this.enemies.kills,
      time: `${mm}:${ss}`,
    });
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
        this.enemies.update(gdt);
        this.level.update(gdt, this.time);
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
    this.input.endFrame();
  }

  _handleMovementAudio() {
    const ev = this.controller.events;
    if (ev.jumped) this.audio.jump();
    if (ev.landed > 0) this.audio.land(ev.landed);
    if (ev.stepped) this.audio.footstep(this.controller.isSprinting ? 1 : 0.5);
    if (ev.slid) this.audio.slide();
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
