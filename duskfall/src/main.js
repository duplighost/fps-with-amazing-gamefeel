// DUSKFALL — a realistic outdoor horde shooter. Bootstrap + game loop: renderer
// with post-processing (bloom + ACES), a golden-hour world, the smooth-FPS
// engine, an animated humanoid horde, and an arcade point/combo system.

import * as THREE from 'three';
import { clamp, clamp01, damp } from './engine/math.js';
import { Input } from './engine/input.js';
import { Audio } from './engine/audio.js';
import { FX } from './engine/fx.js';
import { Controller } from './player/controller.js';
import { CameraRig } from './player/camera.js';
import { Weapons } from './weapons/weapon.js';
import { buildWorld } from './world/world.js';
import { EnemyManager } from './enemies/enemy.js';
import { PickupManager } from './world/pickups.js';
import { ProjectileManager } from './world/projectiles.js';
import { HUD } from './ui/hud.js';
import { buildComposer } from './gfx/post.js';

const MAX_HEALTH = 100;
// Passive regen is deliberately weak (only a low floor) — real healing comes
// from health drops and dash finishers, DOOM-style, to force aggression.
const REGEN_DELAY = 4;
const REGEN_RATE = 7;
const REGEN_CAP = 32;
const HIT_INVULN = 0.4;
const BEST_KEY = 'duskfall.best';

// player-controlled slow-mo (hold Q / middle-mouse), a limited meter
// seasonal arc: the world eases from summer toward deep haunted winter, reaching
// full winter (and a snowstorm) around this wave.
const SEASON_FINAL_WAVE = 12;

const SLOWMO_TARGET = 0.32;   // how slow time runs while engaged
const SLOWMO_DRAIN = 4.0;     // seconds of use to empty a full meter
const SLOWMO_REGEN = 8.0;     // seconds to refill from empty

// grenades — few, powerful, refilled by rare drops
const GRENADE_START = 2;

// dash strike + finisher tuning
const DASH_DAMAGE = 130;
const FINISHER_FRAC = 0.42;      // enemy at/below this fraction of max hp is finishable
const FINISHER_MIN = 55;         // ...or below this absolute hp
const FINISHER_BONUS = 150;
const FINISHER_HEAL = 18;        // Glory-kill style health reward
const DROP_HEALTH = 26;

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
    this.controller = new Controller(this.world.terrain, this.world.colliders, this.world.playRadius + 4, this.world.platforms);
    this.cam = new CameraRig(this.camera);

    this.maxHealth = MAX_HEALTH;   // raised by upgrades
    this.slowmoCap = 1;            // slow-mo duration multiplier, raised by upgrades
    this.upgradeStacks = {};       // upgrade id -> times taken (for display)
    this.health = this.maxHealth;
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
    this.pickups = new PickupManager(this.scene, this.world.terrain);
    this.projectiles = new ProjectileManager(this.scene, this.fx, this.audio, this.world.terrain);
    this.enemies.projectiles = this.projectiles;
    this._dashHitSet = new Set();     // enemies struck by the current dash
    this._dashKills = 0; this._dashFinishers = 0;
    this.slowmoMeter = 1; this._slowmoWasActive = false;
    this.season = 0;   // 0 = summer … 1 = deep winter, eased toward the wave target
    this._stormBoost = 0;  // a live yeti whips the field into a full blizzard
    // grenades: a small stock of powerful throwables, refilled by rare drops
    this.grenades = GRENADE_START; this.maxGrenades = GRENADE_START; this._grenadeCd = 0;
    // drop-rate multipliers (raised by upgrades)
    this.dropMods = { ammo: 1, health: 1, grenade: 1 };
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
    this.hud.setHealth(this.health, this.maxHealth);
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
      this._maybeDrop(e, pos);
    };

    this.pickups.onCollect = (type, pos) => {
      if (type === 'ammo') {
        if (this.weapons.addAmmo(1)) {
          this.hud.ammoFlash();
          this.hud.popText(pos, '+ AMMO', this.camera, 'ammo');
          this.audio.ammoGrab();
        } else { this._scorePickup(pos); }   // already full → never a dead pickup
      } else if (type === 'grenade') {
        if (this.grenades < this.maxGrenades) {
          this.grenades++;
          this.hud.setGrenades(this.grenades, this.maxGrenades);
          this.hud.popText(pos, '+ GRENADE', this.camera, 'finisher');
          this.audio.pickup();
        } else { this._scorePickup(pos); }
      } else {
        if (this.health < this.maxHealth) {
          this.health = Math.min(this.maxHealth, this.health + DROP_HEALTH);
          this.hud.setHealth(this.health, this.maxHealth);
          this.hud.popText(pos, '+' + DROP_HEALTH + ' HP', this.camera, 'score');
          this.audio.pickup();
        } else { this._scorePickup(pos); }
      }
    };
    this.enemies.onCountChange = (n) => this.hud.setEnemies(n);
    this.enemies.onWaveStart = (n, isBoss) => {
      this.hud.setWave(n);
      if (isBoss) this.hud.banner('⚠  BOSS  ⚠', (n >= 10 ? 'THE YETI' : 'THE COLOSSUS') + ' awakens', '#ff6a3a');
      else this.hud.banner('WAVE ' + n, (n % 5 === 4) ? 'brace — a boss looms next' : 'incoming', '#ffce7a');
    };
    this.enemies.onWaveCleared = (n) => {
      const bonus = n * 100;
      this.score += bonus; this.hud.setScore(this.score);
      this._offerUpgrade(n);
    };
    this.enemies.onBoss = (event, boss) => {
      if (event === 'spawn') {
        this.hud.showBoss(boss.def.name || 'BOSS');
        this.audio.bossIntro();
        if (boss.type === 'yeti') setTimeout(() => this.audio.yetiRoar(0), 700);
        this.fx.addTrauma(0.5);
      } else if (event === 'update') {
        this.hud.updateBoss(boss.health / boss.maxHealth);
      } else if (event === 'dead') {
        this.hud.hideBoss();
        const bonus = 2000;
        this.score += bonus; this.hud.setScore(this.score);
        this.hud.banner((boss.def.name || 'BOSS') + ' DOWN', '+' + bonus + ' bonus', '#b6f36a');
        this.audio.bossDeath();
        this.fx.addSlowmo(0.12); this.fx.addTrauma(0.85);
        // spectacle: chained explosions + a guaranteed loot pile
        const gy = this.world.terrain.height(boss.pos.x, boss.pos.z);
        const c = new THREE.Vector3(boss.pos.x, gy + 2, boss.pos.z);
        for (let i = 0; i < 6; i++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 3.5, Math.random() * 3.5, (Math.random() - 0.5) * 3.5);
          this.fx.deathBurst(c.clone().add(off), 0xff6a22);
          this.fx.shockwave(c.clone().add(off), 0xffb060, 5, 0.5);
        }
        for (let i = 0; i < 6; i++) {
          const j = new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5);
          this.pickups.spawn(i % 2 === 0 ? 'ammo' : 'health', new THREE.Vector3(boss.pos.x, 0, boss.pos.z).add(j));
        }
      }
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
    // dash: an edge tap
    hud.touchDash.addEventListener('touchstart', (e) => { e.preventDefault(); hud.touchDash.classList.add('active'); this.input.setHeld('dash', true); this.input.setHeld('dash', false); }, { passive: false });
    hud.touchDash.addEventListener('touchend', () => hud.touchDash.classList.remove('active'));
    // ADS: a toggle on touch
    this._touchAiming = false;
    hud.touchAim.addEventListener('touchstart', (e) => { e.preventDefault(); this._touchAiming = !this._touchAiming; hud.touchAim.classList.toggle('active', this._touchAiming); this.input.setHeld('aim', this._touchAiming); }, { passive: false });
    hud.touchPause.addEventListener('touchstart', (e) => { e.preventDefault(); if (this.state === 'playing') { this.state = 'paused'; this.hud.showPause(); } }, { passive: false });
  }

  // hold-to-slow-mo, drawing from a regenerating meter (great in the air)
  _updateSlowmo(dt) {
    const active = this.input.isDown('slowmo') && this.slowmoMeter > 0.02;
    if (active) {
      this.fx.addSlowmo(SLOWMO_TARGET);
      this.slowmoMeter = Math.max(0, this.slowmoMeter - dt / (SLOWMO_DRAIN * this.slowmoCap));
      if (!this._slowmoWasActive) this.audio.slowmoIn();
    } else {
      this.slowmoMeter = Math.min(1, this.slowmoMeter + dt / SLOWMO_REGEN);
      if (this._slowmoWasActive) this.audio.slowmoOut();
    }
    this._slowmoWasActive = active;
    this.hud.setSlowmo(this.slowmoMeter, active);
  }

  _scorePickup(pos) {
    this.score += 25; this.hud.setScore(this.score);
    this.hud.popText(pos, '+25', this.camera, 'ammo');
    this.audio.ammoGrab();
  }

  startRun() {
    this.controller.reset(0, 0);
    this.cam.reset();
    this.weapons.reset();
    this.enemies.reset();
    this.pickups.reset();
    this.projectiles.reset();
    this.world.setStormBoost(0);
    this.hud.hideBoss();
    this.slowmoMeter = 1; this._slowmoWasActive = false;
    this.grenades = GRENADE_START; this.maxGrenades = GRENADE_START; this._grenadeCd = 0;
    this.dropMods = { ammo: 1, health: 1, grenade: 1 };
    this.hud.setGrenades(this.grenades, this.maxGrenades);
    this.season = 0; this._stormBoost = 0; this.world.setSeason(0, 0, 0);   // back to summer
    this._dashHitSet.clear();
    this.fx.trauma = 0; this.fx.hitstop = 0; this.fx.slowmo = 1;
    this.maxHealth = MAX_HEALTH; this.slowmoCap = 1; this.upgradeStacks = {};
    this.health = this.maxHealth; this.invuln = 0; this.lastDamage = this.time;
    this.weapons.setCapacityMult(1);
    this.score = 0; this.combo = 0;
    this.hud.setHealth(this.health, this.maxHealth); this.hud.setScore(0); this.hud.combo = 0;
    this.enemies.start();
    this.audio.startMusic();
    this.runStart = this.time;
    this.state = 'playing';
  }

  playerTakeDamage(amount, sourcePos) {
    if (this.state !== 'playing' || this.invuln > 0 || this.controller.dashInvuln) return;
    this.health -= amount; this.invuln = HIT_INVULN; this.lastDamage = this.time;
    this.combo = 0; this.hud.breakCombo(); // getting hit breaks your combo (score + meter)
    this.hud.setHealth(Math.max(0, this.health), this.maxHealth);
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
      this._updateSlowmo(realDt);
      const scale = this.fx.consumeTimeScale(realDt);
      const gdt = realDt * scale;
      this.cam.processLook(realDt, this.input);
      const dashing = this.controller.isDashing();
      // Always advance the controller. A live dash runs on realDt so it lunges
      // crisply through kill slow-mo; otherwise it runs on gdt (which is 0 during
      // a hitstop freeze — a no-op move, but the frame still consumes a dash/jump
      // input edge so presses aren't dropped mid-freeze).
      this.controller.update(dashing ? realDt : gdt, this.input, this.cam.yaw);
      this._movementEvents();
      if (gdt > 0) {
        this.enemies.update(gdt);
        this._updateProjectiles(gdt);
        this.world.update(gdt, this.controller.pos);
        this._regen(gdt);
        if (this.comboTimer > 0) { this.comboTimer -= gdt; if (this.comboTimer <= 0) this.combo = 0; }
      }
      this._dashSweep();
      // ease the season toward this wave's target so the world changes a little
      // more each level, drifting from summer into a haunted, snowbound winter
      const wv = Math.max(0, this.enemies.wave - 1);
      const seasonTarget = clamp01(wv / (SEASON_FINAL_WAVE - 1));
      this.season = damp(this.season, seasonTarget, 0.4, realDt);
      const haunt = clamp01((this.season - 0.15) / 0.85);
      const storm = clamp01((this.season - 0.8) / 0.2);
      // a live yeti forces a full whiteout blizzard on top of the season
      const yetiActive = this.enemies.boss && this.enemies.boss.type === 'yeti' && this.enemies.boss.alive;
      this._stormBoost = damp(this._stormBoost, yetiActive ? 1 : 0, 1.5, realDt);
      this.world.setStormBoost(this._stormBoost);
      this.world.setSeason(this.season, haunt, Math.max(storm, this._stormBoost));

      // adaptive music: swell with the number of enemies bearing down, a boss, or
      // low health; cool + muffle the whole score as winter/haunt deepen
      const combat = clamp01(this.enemies.aliveCount() / 9 + (this.enemies.boss ? 0.4 : 0) + (this.health < 35 ? 0.25 : 0));
      this.audio.setMusicIntensity(combat);
      this.audio.setMusicMood(this.season);

      // dash i-frames (owned by main): block hits through the dash + recovery
      if (this.controller.dashInvuln) this.invuln = Math.max(this.invuln, 0.05);
      // hold right-click for iron sights (dashing / sliding suppress it)
      this.cam.aimTarget = (this.input.isDown('aim') && !this.controller.isDashing() && !this.controller._sliding) ? 1 : 0;
      this.cam.applyView(realDt, this.controller, this.fx, this.input);
      this.hud.setAim(this.cam.aimT);
      this.hud.setDash(this.controller.dashCharges, this.controller.maxDashCharges, this.controller.dashRechargeRatio, this.controller.isDashing());
      this.weapons.update(realDt, this.controller, this.input);
      this._grenadeCd = Math.max(0, this._grenadeCd - realDt);
      if (this.input.wasPressed('grenade')) this._throwGrenade();
      this.pickups.update(realDt, this.controller.pos);
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

  _movementEvents() {
    const ev = this.controller.events;
    if (ev.jumped) this.audio.jump();
    if (ev.landed > 0) this.audio.land(ev.landed);
    if (ev.stepped) this.audio.footstep(this.controller.isSprinting ? 1 : 0.5);
    if (ev.slid) this.audio.slide();
    if (ev.mantled) {
      this.audio.mantle();
      this.cam.addFovPunch(3);
      const m = this.controller.pos;
      this.fx.dashDust(new THREE.Vector3(m.x, m.y + 0.3, m.z), new THREE.Vector3(0, -1, 0));
    }
    if (ev.doubleJumped) {
      this.audio.doubleJump();
      this.cam.addFovPunch(4);
      this.fx.addTrauma(0.08);
      const f = this.controller.pos;
      this.fx.shockwave(new THREE.Vector3(f.x, f.y + 0.1, f.z), 0x7df9ff, 2.0, 0.3); // cyan feet-ring
      this.fx.dashDust(new THREE.Vector3(f.x, f.y, f.z), new THREE.Vector3(0, -1, 0));
    }
    if (ev.dashed) {
      this._dashHitSet.clear();
      this._dashKills = 0; this._dashFinishers = 0;
      this.audio.dash();
      this.cam.addFovPunch(11);
      this.fx.addTrauma(0.14);
      this.hud.dashFx();
      const p = this.controller.pos;
      this.fx.dashDust(new THREE.Vector3(p.x, p.y + 0.2, p.z), this.controller.dashDir);
    }
  }

  // After each wave, offer a choice of 3 stacking upgrades. Odd waves give the
  // "capacity" set (max HP / slow-mo / ammo); even waves give the "drops" set.
  _offerUpgrade(waveJustCleared) {
    const setA = waveJustCleared % 2 === 1;
    const cards = setA ? [
      { id: 'maxhp', icon: '✛', name: 'VITALITY', desc: '+25 MAX HEALTH', color: '#63ff8a',
        apply: () => { this.maxHealth += 25; this.health = Math.min(this.maxHealth, this.health + 25); this.hud.setHealth(this.health, this.maxHealth); } },
      { id: 'slowmo', icon: '◷', name: 'TEMPORAL', desc: '+35% SLOW-MO DURATION', color: '#7cc4ff',
        apply: () => { this.slowmoCap += 0.35; this.slowmoMeter = 1; } },
      { id: 'ammo', icon: '▦', name: 'BANDOLIER', desc: '+30% MAX AMMO', color: '#ffb545',
        apply: () => { this.weapons.setCapacityMult(this.weapons.capacityMult + 0.3); } },
    ] : [
      { id: 'ammodrop', icon: '▦', name: 'SCAVENGER', desc: 'MORE AMMO DROPS', color: '#ffb545',
        apply: () => { this.dropMods.ammo += 0.6; } },
      { id: 'healthdrop', icon: '✛', name: 'BLOODHOUND', desc: 'MORE HEALTH DROPS', color: '#63ff8a',
        apply: () => { this.dropMods.health += 0.6; } },
      { id: 'grendrop', icon: '✸', name: 'DEMOLITIONIST', desc: 'MORE GRENADE DROPS · CARRY +1', color: '#ff9a4a',
        apply: () => { this.dropMods.grenade += 1.2; this.maxGrenades += 1; this.hud.setGrenades(this.grenades, this.maxGrenades); } },
    ];
    for (const c of cards) { const s = this.upgradeStacks[c.id] || 0; if (s > 0) c.stack = 'LV ' + (s + 1); }
    this.state = 'upgrading';
    if (!this.input.isTouch) this.input.exitLock();
    this.audio.waveClear();
    this.hud.showUpgrades(cards, (i) => this._applyUpgrade(cards[i]), 'WAVE ' + waveJustCleared + ' CLEARED');
  }

  _applyUpgrade(card) {
    if (this.state !== 'upgrading') return;
    card.apply();
    this.upgradeStacks[card.id] = (this.upgradeStacks[card.id] || 0) + 1;
    this.hud.hideUpgrades();
    this.audio.perfect();
    this.hud.banner(card.name, card.desc, card.color || '#b6f36a');
    this.enemies.betweenWaves = 1.4;   // snappy resume into the next wave
    this.state = 'playing';
    if (!this.input.isTouch) this.input.requestLock();
  }

  // Lob a grenade along the aim with a slight arc. Powerful AoE, no self-damage.
  _throwGrenade() {
    if (this.grenades <= 0 || this._grenadeCd > 0) return;
    this.grenades--;
    this._grenadeCd = 0.5;
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = this.cam.aimDirection();
    const start = origin.clone().addScaledVector(dir, 0.8);
    const vel = dir.clone().multiplyScalar(24); vel.y += 3.5;   // toss with a lob
    this.projectiles.spawn('grenade', start, vel.clone().normalize(), { owner: 'player', speed: vel.length() });
    this.audio.grenadeThrow();
    this.cam.addFovPunch(2);
    this.hud.setGrenades(this.grenades, this.maxGrenades);
  }

  // Move enemy bolts + boss snowballs, resolve hits, and let a dash reflect a
  // snowball back into the boss for a big chunk.
  _updateProjectiles(dt) {
    this.projectiles.update(dt, {
      player: this.player,
      controller: this.controller,
      enemies: this.enemies,
      boss: this.enemies.boss,
      onHitPlayer: (dmg, pos) => this.playerTakeDamage(dmg, pos),
      onReflect: (pos) => {
        this.hud.hitMarker(false, false);
        this.score += 40; this.hud.setScore(this.score);
        this.hud.popText(pos, 'DEFLECT', this.camera, 'finisher');
      },
      onHitEnemy: (enemy, dmg, pos, reflected) => {
        const dir = new THREE.Vector3(0, 0, 1);
        const killed = enemy.takeDamage(dmg, pos, dir, false);
        this.hud.popDamage(pos, dmg, false, this.camera);
        if (reflected) {
          // a reflected snowball staggers a boss and pays out
          this.fx.addTrauma(0.4); this.fx.addHitstop(0.05);
          enemy.knockback.set(0, 0, 0);
          if (enemy.boss) { enemy._slamT = -1; enemy._stagger = 1.1; }
          this.score += 120; this.hud.setScore(this.score);
        }
        if (killed) this.fx.addHitstop(0.08);
      },
    });
  }

  // While dashing, strike every enemy the player sweeps through (once each);
  // low-health enemies are executed with a finisher.
  _dashSweep() {
    if (!this.controller.isDashing()) return;
    const cp = this.controller.pos;
    for (const e of this.enemies.enemies) {
      if (!e.alive || this._dashHitSet.has(e)) continue;
      const dx = e.pos.x - cp.x, dz = e.pos.z - cp.z;
      const rr = this.controller.dashHitRadius + e.def.radius;
      if (dx * dx + dz * dz <= rr * rr) {
        this._dashHitSet.add(e);
        this._dashStrike(e);
      }
    }
  }

  _dashStrike(e) {
    const maxHp = e.maxHealth;
    const point = new THREE.Vector3(e.pos.x, e.pos.y + e.def.height * 0.55, e.pos.z);
    const dir = this.controller.dashDir.clone();
    // finisher = the target is "close to being killed" (low health)
    const finisher = e.health <= Math.max(FINISHER_MIN, maxHp * FINISHER_FRAC);
    const pan = this.enemies.panFor(e.pos);
    e.knockback.addScaledVector(dir, finisher ? 4.5 : 3);
    const killed = e.takeDamage(finisher ? e.health + 1 : DASH_DAMAGE, point, dir, false);

    // always a big, visible strike (no floating number — the ring/blood carry it)
    this.fx.shockwave(point, finisher ? 0xffe08a : 0xff8a3a, finisher ? 4.2 : 3);
    this.fx.bloodBurst(point, dir, finisher ? 2.2 : 1.4, e.def.blood);
    this.fx.addTrauma(finisher ? 0.35 : 0.18);
    this.fx.addHitstop(0.03);                       // per-body "chunk"
    this.hud.hitMarker(false, killed);
    this.audio.dashHit(pan);
    if (killed) this._dashKills++;

    if (killed && finisher) {
      this.fx.addSlowmo(0.14);
      this.hud.finisherFx();
      // only the first finisher of a dash gets the word, to avoid stacked text
      if (this._dashFinishers++ === 0) this.hud.popText(point, 'FINISHER', this.camera, 'finisher');
      this.score += FINISHER_BONUS; this.hud.setScore(this.score);
      this.audio.finisher(pan);
      // the aggressive loop: a finisher refills ammo and heals
      this.weapons.grantFinisherAmmo();
      this.hud.ammoFlash();
      this.health = Math.min(this.maxHealth, this.health + FINISHER_HEAL);
      this.hud.setHealth(this.health, this.maxHealth);
    }
    // reward slicing through a crowd
    if (this._dashKills === 3) {
      this.hud.popText(this.controller.eyePosition.addScaledVector(dir, 3), 'SLICE ×3+', this.camera, 'finisher');
    }
  }

  // Roll for an ammo/health drop when an enemy dies. Adaptive: bias to health
  // when the player is hurt, ammo otherwise; tough enemies drop more.
  _maybeDrop(e, pos) {
    const hpTier = clamp01(e.maxHealth / 240);
    // rare grenade drop (much rarer than ammo/health; boosted by its upgrade)
    if (this.grenades < this.maxGrenades && Math.random() < (0.035 + hpTier * 0.05) * this.dropMods.grenade) {
      this.pickups.spawn('grenade', pos);
      return;
    }
    const chance = 0.42 + hpTier * 0.4;
    if (Math.random() > chance) return;
    const hurt = this.health < this.maxHealth * 0.6;
    // upgrades bias which resource drops
    const hW = (hurt ? 0.62 : 0.24) * this.dropMods.health;
    const aW = (hurt ? 0.38 : 0.76) * this.dropMods.ammo;
    const wantHealth = Math.random() < hW / (hW + aW);
    const type = wantHealth ? 'health' : 'ammo';
    this.pickups.spawn(type, pos);
    if (e.maxHealth >= 240 && Math.random() < 0.6) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4);
      this.pickups.spawn(wantHealth ? 'ammo' : 'health', pos.clone().add(jitter));
    }
  }

  _regen(dt) {
    // only a slow trickle, and only up to a low floor — encourages going for drops
    if (this.health < REGEN_CAP && this.time - this.lastDamage > REGEN_DELAY) {
      this.health = Math.min(REGEN_CAP, this.health + REGEN_RATE * dt);
      this.hud.setHealth(this.health, this.maxHealth);
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
