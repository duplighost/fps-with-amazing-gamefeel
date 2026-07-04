// DUSKFALL — a realistic outdoor horde shooter. Bootstrap + game loop: renderer
// with post-processing (bloom + ACES), a golden-hour world, the smooth-FPS
// engine, an animated humanoid horde, and an arcade point/combo system.

import * as THREE from 'three';
import { clamp, clamp01 } from './engine/math.js';
import { Input } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { FX } from './engine/fx.js';
import { Controller } from './player/controller.js';
import { CameraRig } from './player/camera.js';
import { Weapons } from './weapons/weapon.js';
import { buildWorld } from './world/world.js';
import { EnemyManager } from './enemies/enemy.js';
import { HUD } from './ui/hud.js';
import { buildComposer } from './gfx/post.js';

const MAX_HEALTH = 100;
const REGEN_DELAY = 6;
const REGEN_RATE = 12;
const HIT_INVULN = 0.4;
const BEST_KEY = 'duskfall.best';

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 700);

    this.world = buildWorld(this.scene, this.renderer);
    this.fx = new FX(this.scene, this.camera);
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.controller = new Controller(this.world.terrain, this.world.colliders, this.world.playRadius + 4);
    this.cam = new CameraRig(this.camera);

    this.health = MAX_HEALTH;
    this.invuln = 0;
    this.lastDamage = -999;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.player = {
      pos: this.controller.pos,
      radius: 0.4,
      yaw: () => this.cam.yaw,
      takeDamage: (a, src) => this.playerTakeDamage(a, src),
    };

    this.enemies = new EnemyManager(this.scene, this.fx, this.audio, this.world, this.player);
    this.weapons = new Weapons({
      fx: this.fx, audio: this.audio, cam: this.cam, mainCamera: this.camera,
      hitscan: (o, d, r) => this.hitscan(o, d, r),
      applyDamage: (e, dmg, pt, dir, head) => this.applyDamage(e, dmg, pt, dir, head),
    });

    this.hud = new HUD(document.getElementById('hud'));
    this.ray = new THREE.Raycaster();
    this.post = buildComposer(this.renderer, this.scene, this.camera);
    this.renderer.autoClear = false;

    this.state = 'menu';
    this.time = 0; this.runStart = 0; this.last = performance.now();
    this.best = this._loadBest();

    this._wire();
    this.hud.setHealth(this.health, MAX_HEALTH);
    this.hud.showStart();
    this.hud.setBest(this.best);
    if (this.input.isTouch) this.hud.enableTouchUI();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    requestAnimationFrame((t) => this.loop(t));
  }

  _loadBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || { score: 0, wave: 0, kills: 0 }; } catch (e) { return { score: 0, wave: 0, kills: 0 }; } }
  _saveBest() { try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)); } catch (e) {} }

  _wire() {
    this.weapons.onAmmoChange = (a) => this.hud.setAmmo(a);
    this.weapons.onSpread = (s) => this.hud.setSpread(s);

    this.enemies.onKill = (e, isHead, pos) => {
      this.combo++; this.comboTimer = 3.2;
      const mult = 1 + Math.min(this.combo, 20) * 0.1;    // up to x3
      const base = e.def.score;
      const gained = Math.round(base * mult) + (isHead ? 30 : 0);
      this.score += gained;
      this.hud.setScore(this.score);
      this.hud.popScore(pos, gained, this.camera);
      this.hud.registerKill();
      this.fx.addTrauma(0.1);
      if (this.slowmoOn()) {
        const cleared = this.enemies.aliveCount() === 0 && this.enemies.spawnQueue.length === 0;
        this.fx.addSlowmo(cleared ? 0.18 : isHead ? 0.32 : 0.5);
      }
    };
    this.enemies.onCountChange = (n) => this.hud.setEnemies(n);
    this.enemies.onWaveStart = (n) => { this.hud.setWave(n); this.hud.banner('WAVE ' + n, n % 5 === 0 ? 'they keep coming…' : 'incoming', '#ffce7a'); };
    this.enemies.onWaveCleared = (n) => {
      const bonus = n * 100;
      this.score += bonus; this.hud.setScore(this.score);
      this.hud.banner('WAVE ' + n + ' CLEARED', '+' + bonus + ' bonus', '#b6f36a');
    };

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.audio.resume();
        if (this.state === 'menu' || this.state === 'dead') this.startRun();
        else if (this.state === 'paused') this.state = 'playing';
        this.hud.hideOverlay();
      } else if (this.state === 'playing') { this.state = 'paused'; this.hud.showPause(); }
    };

    this.hud.el.playBtn.addEventListener('click', (e) => {
      e.stopPropagation(); this.audio.resume();
      if (this.input.isTouch) {
        if (this.state === 'menu' || this.state === 'dead') this.startRun();
        else if (this.state === 'paused') this.state = 'playing';
        this.hud.hideOverlay();
      } else this.input.requestLock();
    });
    this.hud.el.playBtn.addEventListener('mouseenter', () => this.audio.ready && this.audio.uiHover());
    if (this.input.isTouch) this._wireTouch();
  }

  slowmoOn() { return true; }

  _wireTouch() {
    const hud = this.hud.el;
    const hold = (el, action) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('active'); this.input.setHeld(action, true); }, { passive: false });
      const up = (e) => { e.preventDefault(); el.classList.remove('active'); this.input.setHeld(action, false); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    hold(hud.touchFire, 'fire'); hold(hud.touchJump, 'jump');
    hud.touchReload.addEventListener('touchstart', (e) => { e.preventDefault(); hud.touchReload.classList.add('active'); this.input.setHeld('reload', true); this.input.setHeld('reload', false); }, { passive: false });
    hud.touchReload.addEventListener('touchend', () => hud.touchReload.classList.remove('active'));
    hud.touchPause.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.state === 'playing') { this.state = 'paused'; this.hud.showPause(); } }, { passive: false });
  }

  startRun() {
    this.controller.reset(0, 0);
    this.cam.reset();
    this.weapons.reset();
    this.enemies.reset();
    this.fx.trauma = 0; this.fx.hitstop = 0; this.fx.slowmo = 1;
    this.health = MAX_HEALTH; this.invuln = 0; this.lastDamage = this.time;
    this.score = 0; this.combo = 0;
    this.hud.setHealth(this.health, MAX_HEALTH); this.hud.setScore(0); this.hud.combo = 0;
    this.enemies.start();
    this.runStart = this.time;
    this.state = 'playing';
  }

  playerTakeDamage(amount, sourcePos) {
    if (this.state !== 'playing' || this.invuln > 0) return;
    this.health -= amount; this.invuln = HIT_INVULN; this.lastDamage = this.time;
    this.combo = 0; // getting hit breaks your combo
    this.hud.setHealth(Math.max(0, this.health), MAX_HEALTH);
    this.hud.damageFlash(clamp01(amount / 28), sourcePos, this.camera);
    this.audio.playerHurt();
    this.fx.addTrauma(clamp(amount / 22, 0.22, 0.7));
    this.fx.addHitstop(clamp(amount / 200, 0.02, 0.06));
    this.cam.addRecoil(0.05 + amount * 0.0022, (Math.random() - 0.5) * 0.09);
    if (this.health <= 0) this.die();
  }

  die() {
    this.state = 'dead';
    this.input.exitLock();
    this.audio.gameOver();
    const secs = Math.max(0, Math.floor(this.time - this.runStart));
    const mm = String((secs / 60) | 0).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const newBest = this.score > this.best.score;
    if (newBest) { this.best = { score: this.score, wave: this.enemies.wave, kills: this.enemies.kills }; this._saveBest(); }
    this.hud.setBest(this.best);
    this.hud.showGameOver({ score: this.score, wave: this.enemies.wave, kills: this.enemies.kills, time: `${mm}:${ss}`, best: this.best.score, newBest });
  }

  hitscan(origin, dir, range) {
    this.ray.set(origin, dir);
    this.ray.far = range;
    const targets = this.world.solids.concat(this.enemies.raycastTargets());
    const hits = this.ray.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    const enemy = h.object.userData.enemy || null;
    let normal = null;
    if (h.face) normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
    return { point: h.point, normal, enemy, distance: h.distance };
  }

  applyDamage(enemy, dmg, point, dir, isHead) {
    const killed = enemy.takeDamage(dmg, point, dir, isHead);
    this.hud.popDamage(point, dmg, isHead, this.camera);
    this.hud.hitMarker(isHead, killed);
    if (killed) this.fx.addHitstop(0.07);
    else if (isHead) { this.fx.addHitstop(0.035); this.audio.headshot(); }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
    this.weapons.syncCamera(this.cam.fov, w / h);
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const realDt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.step(realDt);
    this.render();
  }

  step(realDt) {
    this.time += realDt;
    if (this.state === 'playing') {
      this.invuln = Math.max(0, this.invuln - realDt);
      const scale = this.fx.consumeTimeScale(realDt);
      const gdt = realDt * scale;
      this.cam.processLook(realDt, this.input);
      if (gdt > 0) {
        this.controller.update(gdt, this.input, this.cam.yaw);
        this._moveAudio();
        this.enemies.update(gdt);
        this.world.update(gdt, this.controller.pos);
        this._regen(gdt);
        if (this.comboTimer > 0) { this.comboTimer -= gdt; if (this.comboTimer <= 0) this.combo = 0; }
      }
      this.cam.applyView(realDt, this.controller, this.fx, this.input);
      this.weapons.update(realDt, this.controller, this.input);
      if (this.weapons.reloading) this.hud.setReloadProgress(1 - this.weapons.reloadTimer / this.weapons.def.reloadTime);
    }
    this.fx.update(realDt);
    this.hud.update(realDt, this.camera);
    this.hud.setTimewarp(this.fx.slowmo);
    if (this.input.isTouch) {
      this.hud.renderTouchStick(this.input.moveStick);
      this.hud.el.touchControls.style.display = this.state === 'playing' ? '' : 'none';
    }
    this.input.endFrame();
  }

  _moveAudio() {
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
    this.post.render();                       // world + bloom + tone-map to screen
    this.renderer.clearDepth();
    this.weapons.syncCamera(this.cam.fov, this.camera.aspect);
    this.renderer.render(this.weapons.viewScene, this.weapons.viewCamera); // gun overlay
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.__game = new Game(); }
  catch (err) {
    console.error(err);
    const o = document.getElementById('hud');
    if (o) o.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-family:sans-serif;padding:2rem;text-align:center">
      <div><h2>Failed to start</h2><pre style="white-space:pre-wrap;color:#ff9a9a">${(err && err.message) || err}</pre>
      <p>This game needs a WebGL2 browser. Serve it over http (not file://).</p></div></div>`;
  }
});

export { Game };
