// DUSKFALL — a realistic outdoor horde shooter. Bootstrap + game loop: renderer
// with post-processing (bloom + ACES), a golden-hour world, the smooth-FPS
// engine, an animated humanoid horde, and an arcade point/combo system.

import * as THREE from 'three';
import { clamp, clamp01, damp, rand } from './engine/math.js';
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
const SLOWMO_DAMAGE_MULT = 1.6;   // shots hit this much harder while slow-mo is engaged

// grenades — few, powerful, refilled by rare drops
const GRENADE_START = 2;

// dash strike + finisher tuning
const DASH_DAMAGE = 130;
// dash contact: a KILL skewers the corpse in front + detonates it; a SURVIVOR you
// dash into body-checks you to a rebound stop (never a phase-through).
const PIN_TIME = 0.11;             // how long a killed corpse rides in front before it pops
const PIN_DIST = 1.5;              // how far ahead the corpse is skewered
const PIN_Y = 1.25;                // corpse height above the player's feet
const DASH_CONTACT_MARGIN = 0.3;   // extra reach for the (tight) stop radius
const DASH_CONTACT_DOT = 0.2;      // survivor must be roughly AHEAD to stop you (~78° cone)
const DASH_CONTACT_GRACE = 0.045;  // always commit a visible lunge before a stop can trigger
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
    this.pickups.setNook(this.world.nook);
    this.projectiles = new ProjectileManager(this.scene, this.fx, this.audio, this.world.terrain);
    this.enemies.projectiles = this.projectiles;
    // one layer-aware ground for every system (surface / cave floor / pond ice)
    this.controller.groundFn = this.world.groundAt;
    this.controller.ceilFn = this.world.ceilAt;
    this.controller.isUnderFn = this.world.isUnder;
    this.controller.surfaceProbe = this.world.surfaceAt;
    this.controller.caveSDFFn = this.world.caveSDF;
    this.controller.inCraterFn = this.world.inCrater;
    this.pickups.groundAt = this.world.groundAt;
    this.projectiles.groundAt = this.world.groundAt;
    this._pondWasFrozen = false;
    this._meteors = [];            // wurm-wave surface strikes [{x,z,y,t}]
    this._voids = [];              // live void orbs [{pos,t,spin}]
    this._supply = null;          // live supply crate + beam + waypoint
    this._meteorCd = 1; this._surgeCd = 0.5;
    this._chillT = 0;              // frost-elite slow
    this._mutNight = 0; this._mutFog = 0;   // damped mutator moods
    this._eventDone = true; this._eventAt = 0;   // one surprise event per wave
    this._dashHitSet = new Set();     // enemies struck by the current dash
    this._dashKills = 0; this._dashFinishers = 0;
    this._dashPin = null;             // { e, t } — a killed corpse skewered in front
    this._dashAge = 0;                // time since the current dash began (lunge grace)
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
      const gained = Math.round(base * mult * (e.scoreMult || 1)) + (isHead ? 30 : 0);
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

    this.pickups.onCollect = (type, pos, meta) => {
      if (meta && meta.caged) {
        // banked (cache) loot pays a bonus for the climb, and a FULL cache is a
        // jackpot: a spare grenade, a heal, and a big score pop
        this.score += 40; this.hud.setScore(this.score);
        if (meta.cacheFull) {
          if (this.grenades < this.maxGrenades) { this.grenades++; this.hud.setGrenades(this.grenades, this.maxGrenades); }
          this.health = Math.min(this.maxHealth, this.health + 22); this.hud.setHealth(this.health, this.maxHealth);
          this.score += 200; this.hud.setScore(this.score);
          this.hud.banner('CACHE JACKPOT', '+200 · grenade · heal', '#7df9ff');
          this.audio.perfect();
        }
      }
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
    // frost elites chill you on hit: heavy boots for a moment
    this.enemies.onPlayerChilled = () => { this._chillT = 1.3; };
    this.enemies.onWaveStart = (n, isBoss) => {
      this.hud.setWave(n);
      if (isBoss) {
        const names = { colossus: 'THE COLOSSUS', yeti: 'THE YETI', wurm: 'THE WURM', tempest: 'THE TEMPEST' };
        const subs = { colossus: 'awakens', yeti: 'brings the whiteout', wurm: 'is beneath you — get underground', tempest: 'owns the sky — get OFF the ground' };
        const t = this.enemies.bossTypeFor(n);
        this.hud.banner('⚠  BOSS  ⚠', names[t] + ' ' + subs[t], '#ff6a3a');
      } else if (this.enemies.mutator) {
        this.hud.banner('WAVE ' + n + ' — ' + this.enemies.mutator.name, this.enemies.mutator.desc, '#d9a9ff');
      } else this.hud.banner('WAVE ' + n, (n % 5 === 4) ? 'brace — a boss looms next' : 'incoming', '#ffce7a');
      // schedule this wave's surprise
      this._eventDone = false;
      this._eventAt = (this.time - this.runStart) + rand(12, 22);
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
      } else if (this.state === 'playing') {
        if (this._dashPin) this._detonatePin();   // don't freeze a skewered corpse through the pause
        this.state = 'paused'; this.hud.showPause();
      }
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
    this.post.setSeason(0, 0);
    this._pondWasFrozen = this.world.pond.frozen;
    this._meteors.length = 0; this._meteorCd = 1; this._surgeCd = 0.5;
    this._voids.length = 0; this._clearSupply();
    this._dashHitSet.clear(); this._dashPin = null; this._dashAge = 0;
    this.fx.trauma = 0; this.fx.hitstop = 0; this.fx.slowmo = 1;
    this._chillT = 0; this.controller.speedMult = 1;
    this._mutNight = 0; this._mutFog = 0; this._eventDone = true;
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
    if (this._dashPin) this._detonatePin();
    this._clearSupply();
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
    // raycast only the CHEAP meshes (enemies + props). The two ~13k-triangle
    // heightfield planes — surface terrain and the cave floor/ceil — used to
    // cost ~10ms EACH per ray (×12 shotgun pellets = a ~125ms hitch), so they're
    // excluded here and hit analytically by marching groundAt below instead.
    const targets = this.world.bulletSolids.concat(this.enemies.raycastTargets());
    const hits = this.ray.intersectObjects(targets, false);
    let best = null;
    if (hits.length) {
      const h = hits[0];
      let normal = null;
      if (h.face) normal = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      best = { point: h.point, normal, enemy: h.object.userData.enemy || null, distance: h.distance };
    }
    const ground = this._marchGround(origin, dir, best ? best.distance : range);
    if (ground && (!best || ground.distance < best.distance)) best = ground;
    return best;
  }

  // Analytic ray-vs-heightfield: step along the ray sampling the ground height
  // (terrain, or the cave floor when underground) and stop where the ray dips
  // below it, refining with a few bisection steps. O(steps) and cheap — replaces
  // a brute-force triangle raycast against a 13k-tri plane.
  _marchGround(origin, dir, maxDist) {
    const gAt = this.world.groundAt;
    const STEP = 0.9;
    let pAbove = origin.y - gAt(origin.x, origin.z, origin.y);
    let t = 0;
    for (let nt = STEP; nt <= maxDist; nt += STEP) {
      const x = origin.x + dir.x * nt, y = origin.y + dir.y * nt, z = origin.z + dir.z * nt;
      const above = y - gAt(x, z, y);
      if (above <= 0 && pAbove > 0) {
        // surface crossed between t and nt — bisect toward it
        let lo = t, hi = nt;
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + dir.x * mid, my = origin.y + dir.y * mid, mz = origin.z + dir.z * mid;
          if (my - gAt(mx, mz, my) <= 0) hi = mid; else lo = mid;
        }
        const px = origin.x + dir.x * hi, py = origin.y + dir.y * hi, pz = origin.z + dir.z * hi;
        const point = new THREE.Vector3(px, py, pz);
        // underground, the marched surface is the cave floor/ceiling (flat), not
        // the terrain heightfield — face the normal against the ray (up for a
        // floor hit, down for a ceiling), so decals lie flat. Above ground, use
        // the real terrain gradient.
        let normal;
        if (this.world.isUnder && this.world.isUnder(px, pz, py + (dir.y > 0 ? 0.2 : -0.2))) {
          normal = new THREE.Vector3(0, dir.y > 0 ? -1 : 1, 0);
        } else {
          normal = this.world.terrain.normal ? this.world.terrain.normal(px, pz) : new THREE.Vector3(0, 1, 0);
        }
        return { point, normal, enemy: null, distance: hi };
      }
      pAbove = above; t = nt;
    }
    return null;
  }

  applyDamage(enemy, dmg, point, dir, isHead) {
    // SLOW-MO is offensive now: shots hit harder while you're bending time, so
    // engaging slow-mo to line up a shot pays off (not just for dodging)
    const slow = this._slowmoWasActive;
    if (slow) dmg = Math.round(dmg * SLOWMO_DAMAGE_MULT);
    const killed = enemy.takeDamage(dmg, point, dir, isHead);
    this.hud.popDamage(point, dmg, isHead, this.camera, slow);
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
        this._updateBossHazards(gdt);
        this.world.update(gdt, this.controller.pos);
        this._regen(gdt);
        if (this.comboTimer > 0) { this.comboTimer -= gdt; if (this.comboTimer <= 0) this.combo = 0; }
      }
      this._dashSweep(realDt);
      this._updateDashPin(realDt);
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
      this.post.setSeason(this.season, haunt);

      // frost chill wears off
      this._chillT = Math.max(0, this._chillT - realDt);
      this.controller.speedMult = this._chillT > 0 ? 0.55 : 1;

      // mutator moods: fog closes in / night falls (damped so waves blend)
      const mut = this.enemies.mutator;
      this._mutFog = damp(this._mutFog, mut && mut.id === 'fog' ? 1 : 0, 1.6, realDt);
      this._mutNight = damp(this._mutNight, mut && mut.id === 'night' ? 1 : 0, 1.6, realDt);
      if (this._mutFog > 0.01) this.scene.fog.density += this._mutFog * 0.014;
      if (this._mutNight > 0.01) {
        this.renderer.toneMappingExposure *= 1 - this._mutNight * 0.45;
        this.world.sun.intensity *= 1 - this._mutNight * 0.65;
      }
      // FALLING SKY: ambient meteors anywhere on the surface (light, dodgeable)
      if (mut && mut.id === 'meteor' && !this.enemies.isBossWave) {
        this._ambMeteorCd = (this._ambMeteorCd ?? 2) - gdt;
        if (this._ambMeteorCd <= 0) {
          this._ambMeteorCd = rand(1.6, 3.2);
          const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 30;
          const x = this.controller.pos.x + Math.cos(a) * d, z = this.controller.pos.z + Math.sin(a) * d;
          this._meteors.push({ x, z, y: this.world.terrain.height(x, z), t: 0.8, light: true });
          this.fx.shockwave(new THREE.Vector3(x, this.world.terrain.height(x, z) + 0.3, z), 0xff8a3a, 3.6, 0.7);
        }
      }
      // one mid-wave SURPRISE per wave (surge of reinforcements or a supply drop)
      if (!this._eventDone && this.time - this.runStart > this._eventAt &&
          this.enemies.aliveCount() > 2 && !this.enemies.isBossWave && this.state === 'playing') {
        this._eventDone = true;
        this._fireMidWaveEvent();
      }

      // the moment the pond freezes over: a set-piece (encase whatever's wading)
      const frozenNow = this.world.pond.frozen;
      if (frozenNow && !this._pondWasFrozen) this._onPondFreeze();
      this._pondWasFrozen = frozenNow;

      // adaptive music: swell with the number of enemies bearing down, a boss, or
      // low health; cool + muffle the score as winter/haunt deepen or you descend
      const combat = clamp01(this.enemies.aliveCount() / 9 + (this.enemies.boss ? 0.4 : 0) + (this.health < 35 ? 0.25 : 0));
      this.audio.setTimeScale(this.fx.slowmo);
      this.audio.setMusicIntensity(combat);
      this.audio.setMusicMood(Math.min(1, this.season + this.world.getUnder() * 0.55));

      // dash i-frames (owned by main): block hits through the dash + recovery
      if (this.controller.dashInvuln) this.invuln = Math.max(this.invuln, 0.05);
      // hold right-click for iron sights (dashing / sliding suppress it)
      this.cam.aimTarget = (this.input.isDown('aim') && !this.controller.isDashing() && !this.controller._sliding) ? 1 : 0;
      this.cam.applyView(realDt, this.controller, this.fx, this.input);
      // spatial audio: pin the listener to the camera (head) so enemy voices
      // localise in 3D — left/right, ahead/behind, above, and softer with range
      const _cp = this.camera.getWorldPosition(this._alp || (this._alp = new THREE.Vector3()));
      const _cf = this.camera.getWorldDirection(this._alf || (this._alf = new THREE.Vector3()));
      const _cu = (this._alu || (this._alu = new THREE.Vector3())).setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
      this.audio.setListener(_cp.x, _cp.y, _cp.z, _cf.x, _cf.y, _cf.z, _cu.x, _cu.y, _cu.z);
      // god rays: project the sun to screen and fan warm shafts when we face it
      const _sd = this.world.sunDir;
      const facing = _cf.x * _sd.x + _cf.y * _sd.y + _cf.z * _sd.z;
      if (facing > 0.04) {
        const sp = (this._sunP || (this._sunP = new THREE.Vector3()));
        sp.copy(_cp).addScaledVector(_sd, 1000).project(this.camera);
        const gi = clamp01((facing - 0.04) / 0.45) * 0.5 * (1 - this.world.getUnder()) * (1 - this._mutNight * 0.7);
        this.post.setSun(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, gi);
      } else {
        this.post.setSun(0.5, 1.2, 0);
      }
      this.hud.setAim(this.cam.aimT);
      this.hud.setDash(this.controller.dashCharges, this.controller.maxDashCharges, this.controller.dashRechargeRatio, this.controller.isDashing());
      this.weapons.update(realDt, this.controller, this.input);
      this._updateVoids(gdt);
      this._updateSupply(gdt);
      this._grenadeCd = Math.max(0, this._grenadeCd - realDt);
      if (this.input.wasPressed('grenade')) this._throwGrenade();
      this.pickups.update(realDt, this.controller.pos);
      this.hud.setCache(this.pickups.cacheCount(), this.world.nook ? this.world.nook.cap : 5);
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
    if (ev.stepped) {
      const spd = this.controller.isSprinting ? 1 : 0.5;
      if (this.controller.surface === 'water') {
        this.audio.footstepWater(spd);
        const p = this.controller.pos;
        this.fx.shockwave(new THREE.Vector3(p.x, p.y + 0.06, p.z), 0x7fc4d8, 1.1, 0.35);
      } else if (this.controller.surface === 'ice') this.audio.footstepIce(spd);
      else this.audio.footstep(spd);
    }
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
      if (this._dashPin) this._detonatePin();   // a fresh dash pops any stale skewer
      this._dashHitSet.clear();
      this._dashKills = 0; this._dashFinishers = 0; this._dashAge = 0;
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
    if (this._dashPin) this._detonatePin();   // don't freeze a skewered corpse through the menu
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
    if (!this.input.isTouch) {
      const pr = this.input.requestLock();
      // if the browser rejects the re-lock, fall back to the pause menu (click to
      // resume re-requests it) rather than stranding the run playing-but-unlocked
      if (pr && pr.catch) pr.catch(() => { if (this.state === 'playing') { this.state = 'paused'; this.hud.showPause(); } });
    }
  }

  // A mid-wave surprise: either a reinforcement surge crashes in from one
  // direction, or a supply beacon lands loot somewhere worth running to.
  _fireMidWaveEvent() {
    if (Math.random() < 0.5) {
      this.hud.banner('REINFORCEMENTS', 'they heard the fighting', '#ff9a6a');
      this.audio.waveStart();
      const a = Math.random() * Math.PI * 2;
      const p = new THREE.Vector3(this.controller.pos.x + Math.cos(a) * 26, 0, this.controller.pos.z + Math.sin(a) * 26);
      this.enemies.spawnAdds(p, 5);
    } else {
      this._dropSupply();
    }
  }

  // A SUPPLY DROP you can't miss: a crate slams down somewhere on the field with
  // a tall cyan light beam over it AND a HUD waypoint (distance + edge arrow), so
  // you always know exactly where to run. Reach it and it cracks open, spilling
  // ammo/health/a grenade. Persists on GAME time (survives pauses/menus) and
  // clears itself on pickup, timeout, death, or a new run.
  _dropSupply() {
    this._clearSupply();
    // land it on REACHABLE ground: inside the play radius (past it the terrain
    // walls up), and never in open water or down a sinkhole where you can't grab it
    const maxR = this.world.playRadius - 4;
    let x = this.controller.pos.x, z = this.controller.pos.z;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 12;
      x = this.controller.pos.x + Math.cos(a) * d;
      z = this.controller.pos.z + Math.sin(a) * d;
      const dr = Math.hypot(x, z);
      if (dr > maxR) { const k = maxR / dr; x *= k; z *= k; }
      const gy = this.world.groundAt(x, z, 40);
      const inCrater = this.world.inCrater && this.world.inCrater(x, z);
      const inWater = this.world.surfaceAt && this.world.surfaceAt(x, z, gy) === 'water';
      if (!inCrater && !inWater) break;
    }
    const y = this.world.groundAt(x, z, 40);
    const grp = new THREE.Group(); grp.position.set(x, y, z);
    // the crate: a banded wooden box
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.85, flatShading: true }));
    box.position.y = 0.6; box.rotation.y = Math.random() * 0.6; box.castShadow = true; grp.add(box);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x0a0c14, emissive: 0x7df9ff, emissiveIntensity: 2.4, roughness: 0.4, flatShading: true });
    for (const ax of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.2, 0.16), bandMat);
      band.position.set(0, 0.6, ax * 0.5); grp.add(band);
      const band2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 1.56), bandMat);
      band2.position.set(ax * 0.5, 0.6, 0); grp.add(band2);
    }
    // a tall beam of light so it reads from across the map
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 40, 10, 1, true), beamMat);
    beam.position.y = 20; beam.frustumCulled = false; grp.add(beam);
    const light = new THREE.PointLight(0x7df9ff, 26, 22, 1.8); light.position.y = 2; grp.add(light);
    this.scene.add(grp);
    this.fx.shockwave(new THREE.Vector3(x, y + 0.6, z), 0x7df9ff, 8, 0.9);
    this.fx.impactLight(new THREE.Vector3(x, y + 2, z), 0x7df9ff, 24, 0.5);
    this.audio.perfect();
    this.hud.banner('SUPPLY DROP', 'run to the crate — grab the loot', '#7df9ff');
    this.hud.setWaypoint(new THREE.Vector3(x, y + 2.2, z));
    this._supply = { x, z, y, t: 26, grp, beamMat, light, opened: false };
  }

  _updateSupply(dt) {
    const s = this._supply;
    if (!s) return;
    s.t -= dt;
    if (!s.opened) {
      s.beamMat.opacity = 0.13 + Math.sin(this.time * 4) * 0.05;
      s.light.intensity = 22 + Math.sin(this.time * 4) * 6;
      const near = Math.hypot(this.controller.pos.x - s.x, this.controller.pos.z - s.z) < 4.5;
      if (near) {
        // crack it open: spill the loot, burst, and drop the waypoint
        s.opened = true; s.t = Math.min(s.t, 1.4);
        for (let i = 0; i < 4; i++) {
          const j = new THREE.Vector3(s.x + (Math.random() - 0.5) * 2.4, s.y + 0.6, s.z + (Math.random() - 0.5) * 2.4);
          this.pickups.spawn(i < 2 ? 'ammo' : (i === 2 ? 'health' : 'grenade'), j);
        }
        this.fx.shockwave(new THREE.Vector3(s.x, s.y + 0.7, s.z), 0xbfe8ff, 5, 0.5);
        this.fx.deathBurst(new THREE.Vector3(s.x, s.y + 0.7, s.z), 0x7df9ff);
        this.audio.pickup();
        this.hud.clearWaypoint();
        this.hud.banner('SUPPLIES SECURED', '', '#7df9ff');
      }
    } else {
      s.beamMat.opacity = Math.max(0, s.beamMat.opacity - dt * 0.14);   // fade the beam out
      s.light.intensity = Math.max(0, s.light.intensity - dt * 20);
    }
    if (s.t <= 0) this._clearSupply();
  }

  _clearSupply() {
    const s = this._supply;
    if (!s) return;
    this.scene.remove(s.grp);
    s.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.hud.clearWaypoint();
    this._supply = null;
  }

  // Boss arena hazards. THE WURM's wave rains meteors on the SURFACE (get
  // underground, where the fight is). THE TEMPEST charges the open GROUND (get
  // up on the ring/islands — dash i-frames also carry you across safely).
  _updateBossHazards(dt) {
    const boss = this.enemies.boss;
    const isWurm = boss && boss.alive && boss.type === 'wurm';
    const isTempest = boss && boss.alive && boss.type === 'tempest';
    const under = this.world.isUnder(this.player.pos.x, this.player.pos.z, this.player.pos.y + 0.5);

    if (isWurm && !under) {
      this._meteorCd -= dt;
      if (this._meteorCd <= 0) {
        this._meteorCd = rand(1.0, 1.7);
        const a = Math.random() * Math.PI * 2, d = Math.random() * 6.5;
        const x = this.player.pos.x + Math.cos(a) * d, z = this.player.pos.z + Math.sin(a) * d;
        const y = this.world.terrain.height(x, z);
        this._meteors.push({ x, z, y, t: 0.75 });
        this.fx.shockwave(new THREE.Vector3(x, y + 0.3, z), 0xff8a3a, 4.4, 0.7);
        this.audio.seerCharge(0);
      }
    }
    for (let i = this._meteors.length - 1; i >= 0; i--) {
      const m = this._meteors[i];
      m.t -= dt;
      if (m.t > 0) continue;
      this._meteors.splice(i, 1);
      const at = new THREE.Vector3(m.x, m.y + 0.3, m.z);
      this.fx.deathBurst(at, 0xff7a2e);
      this.fx.shockwave(at, 0xffb060, 6, 0.45);
      this.fx.impactLight(new THREE.Vector3(m.x, m.y + 1.2, m.z), 0xff8030, 18, 0.2);
      this.fx.addTrauma(0.3);
      this.audio.bossSlam(0);
      const dp = Math.hypot(this.player.pos.x - m.x, this.player.pos.z - m.z);
      if (dp < 4.5 && Math.abs(this.player.pos.y - m.y) < 3.5) this.playerTakeDamage(m.light ? 9 : 16, at);
    }

    if (isTempest) {
      const c = this.controller;
      const terrH = this.world.terrain.height(c.pos.x, c.pos.z);
      const onBareGround = c.onGround && !under && c.pos.y <= terrH + 1.0;
      this._surgeCd -= dt;
      if (this._surgeCd <= 0) {
        this._surgeCd = 0.55;
        if (onBareGround) {
          this.playerTakeDamage(4, this.controller.pos.clone());
          this.audio.impact(0);
          for (let k = 0; k < 8; k++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
            this.fx.sparks.emit(c.pos.x + Math.cos(a) * r, c.pos.y + 0.15, c.pos.z + Math.sin(a) * r,
              0, rand(1, 3), 0, 0.62, 0.83, 1.0, 0.22, 0.2, 2, 4);
          }
        }
      }
      // constant faint crackle warning whenever your boots are on charged ground
      if (onBareGround && Math.random() < 0.35) {
        this.fx.sparks.emit(c.pos.x + rand(-1, 1), c.pos.y + 0.1, c.pos.z + rand(-1, 1),
          0, rand(0.5, 2), 0, 0.5, 0.75, 1.0, 0.15, 0.14, 2, 4);
      }
    }
  }

  // The pond snaps frozen: everything wading is encased in the ice; a wading
  // player gets popped up onto the fresh sheet with a slip.
  _onPondFreeze() {
    this.audio.iceCrack();
    this.hud.banner('THE POND FREEZES', 'whatever was in it is not going anywhere', '#bfe4ff');
    this.fx.addTrauma(0.3);
    for (const e of this.enemies.enemies) {
      if (!e.alive || e.def.flyer || e.boss) continue;
      if (this.world.surfaceAt(e.pos.x, e.pos.z, e.pos.y - 0.2) === 'water' ||
          this.world.surfaceAt(e.pos.x, e.pos.z, e.pos.y) === 'water') {
        e.freezeSolid(4.5);
        this.fx.shockwave(new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z), 0xbfe4ff, 2.2, 0.4);
      }
    }
    const c = this.controller;
    if (c.surface === 'water') {
      // the sheet forms under your boots and shoves you up onto it
      c.pos.y = this.world.groundAt(c.pos.x, c.pos.z, 0.5) + 0.02;
      c.vel.y = Math.max(c.vel.y, 3);
      this.cam.addFovPunch(4);
      this.fx.addTrauma(0.25);
    }
  }

  // THE VOID ORB. The thrown orb blooms into a singularity: for ~2 seconds it
  // drags every non-boss enemy in a wide radius into one screaming knot
  // (holding them helpless), then detonates the packed ball. Crowd control AND
  // a crowd-execution — it sets up shotgun blasts and dash skewers instead of
  // competing with them. It still never hurts the player.
  _openVoid(at) {
    at.y = Math.max(at.y, this.world.groundAt(at.x, at.z, at.y) + 1.7);
    this._voids.push({ pos: at, t: 2.05, spin: Math.random() * 6 });
    this.fx.shockwave(at, 0xba7bff, 12, 0.55);
    this.fx.impactLight(at, 0x9a5aff, 30, 0.5);
    this.audio.seerCharge(0);
    this.fx.addTrauma(0.25);
  }

  _updateVoids(dt) {
    if (!this._voids.length) return;
    const PULL_R = 17;
    for (const v of this._voids) {
      v.t -= dt; v.spin += dt * 9;
      // the maw: one steady glow light (held on the pooled flash lights below)
      // + a collapsing ring and a few orbiting motes a few times a second. This
      // is deliberately NOT every-frame — the spinning debris sells the vortex.
      v._fx = (v._fx || 0) - dt;
      if (v._fx <= 0) {
        v._fx = 0.12;
        this.fx.shockwave(v.pos, 0xba7bff, 5.2, 0.28);
        for (let k = 0; k < 3; k++) {
          const a = v.spin + k * 2.09, rr = 2.6 + Math.sin(v.spin * 1.7 + k) * 1.1;
          this.fx.debris.emit(v.pos.x + Math.cos(a) * rr, v.pos.y + Math.sin(v.spin * 2.3 + k) * 1.2, v.pos.z + Math.sin(a) * rr,
            -Math.sin(a) * 6, 0, Math.cos(a) * 6, 0.72, 0.48, 1.0, 0.22, 0.14, 0, 2);
        }
      }
      // keep the maw lit with a single steady light (life just over the refresh
      // cadence so it never blinks) rather than a flash every frame
      this.fx.impactLight(v.pos, 0x8a4aff, 15, 0.16);
      // THE PULL: drag every non-boss enemy toward the maw; held enemies reel
      for (const e of this.enemies.enemies) {
        if (!e.alive || e.boss || e.frozenT > 0) continue;
        const dx = v.pos.x - e.pos.x, dz = v.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz) || 0.001;
        if (d > PULL_R) continue;
        const heavy = e.def.gait === 'stomp' ? 0.35 : 1;   // megaliths barely budge
        const pull = 24 * heavy * clamp01(1.2 - d / PULL_R);
        e.pos.x += (dx / d) * Math.min(pull * dt, d);
        e.pos.z += (dz / d) * Math.min(pull * dt, d);
        if (e.def.flyer) { e.flyY = damp(e.flyY, v.pos.y, 3.5, dt); e.pos.y = e.flyY; }
        else if (d < 5 && heavy === 1) e.pos.y = damp(e.pos.y, v.pos.y - 0.9, 3.0, dt);   // lifted, flailing
        else e.pos.y = this.enemies.groundFor(e.pos.x, e.pos.z, e.pos.y);
        e._stunT = Math.max(e._stunT, 0.14);              // held: can't walk or swing
        e.knockback.set(0, 0, 0);
      }
      if (v.t <= 0) this._detonateVoid(v);
    }
    this._voids = this._voids.filter((v) => v.t > 0);
  }

  _detonateVoid(v) {
    const at = v.pos, R = 10;
    this.fx.shockwave(at.clone(), 0xd9a9ff, R + 3, 0.6);
    this.fx.shockwave(at.clone(), 0xba7bff, R * 0.6, 0.4);
    this.fx.impactLight(at.clone(), 0xc07bff, 40, 0.35);
    this.fx.addTrauma(0.85); this.fx.addHitstop(0.09);
    for (let k = 0; k < 48; k++) {
      const a = Math.random() * Math.PI * 2, el = Math.random() * Math.PI * 0.6, sp = 6 + Math.random() * 14;
      this.fx.debris.emit(at.x, at.y, at.z, Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp,
        0.78, 0.55, 1.0, 0.4 + Math.random() * 0.4, 0.16 + Math.random() * 0.24, 14, 2.4);
    }
    this.audio.grenadeExplode(0);
    const dirV = new THREE.Vector3();
    const hurt = (e) => {
      if (!e || !e.alive) return;
      const cy = e.pos.y + e.def.height * 0.5;
      const d = Math.hypot(e.pos.x - at.x, cy - at.y, e.pos.z - at.z) - e.def.radius;
      if (d > R) return;
      const fall = clamp01(1 - d / R);
      dirV.set(e.pos.x - at.x, 0, e.pos.z - at.z);
      if (dirV.lengthSq() < 1e-5) dirV.set(0, 0, 1); else dirV.normalize();
      e.knockback.addScaledVector(dirV, e.def.gait === 'stomp' ? 3 : 10);
      e.knockback.y += 4;
      e.takeDamage(340 * (0.4 + 0.6 * fall), new THREE.Vector3(e.pos.x, cy, e.pos.z), dirV, false);
    };
    // bosses aren't pulled, but standing in the blast still costs them
    if (this.enemies.boss) hurt(this.enemies.boss);
    for (const e of this.enemies.enemies.slice()) if (e !== this.enemies.boss) hurt(e);
  }

  // Lob the void orb along the aim with a slight arc.
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
      onVoidOpen: (at) => this._openVoid(at),
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

  // While dashing: STRIKE PASS damages everything in a wide bubble (carve the
  // crowd, once each, pin kills). STOP PASS ends the dash on the nearest survivor
  // you physically reach ahead of you (a body-check rebound, never a phase-through).
  _dashSweep(realDt) {
    if (!this.controller.isDashing()) return;
    const cp = this.controller.pos;
    const dd = this.controller.dashDir;
    // (a) strike pass — the generous slash radius. Iterate a snapshot: pinning a
    // kill can detonate+dispose the previous corpse, mutating the live array.
    for (const e of this.enemies.enemies.slice()) {
      if (!e.alive || this._dashHitSet.has(e)) continue;
      if (Math.abs(e.pos.y - cp.y) > e.def.height + this.controller.dashHitRadius) continue;   // don't carve a flyer perched high overhead
      const dx = e.pos.x - cp.x, dz = e.pos.z - cp.z;
      const rr = this.controller.dashHitRadius + e.def.radius;
      if (dx * dx + dz * dz <= rr * rr) {
        this._dashHitSet.add(e);
        const killed = this._dashStrike(e);
        if (killed && !e.boss) this._pinCorpse(e);   // bosses die with their own big spectacle, never skewered
      }
    }
    // (b) stop pass — after a committed lunge, halt on the nearest SURVIVOR we
    // already struck that is genuinely ahead and within true body-contact range
    this._dashAge += realDt;
    if (this._dashAge < DASH_CONTACT_GRACE) return;
    let best = null, bestD2 = Infinity;
    for (const e of this._dashHitSet) {
      if (!e.alive) continue;
      if (Math.abs(e.pos.y - cp.y) > e.def.height * 0.6 + 1.2) continue;   // roughly at your level, not far above/below
      const dx = e.pos.x - cp.x, dz = e.pos.z - cp.z;
      const stop = this.player.radius + e.def.radius + DASH_CONTACT_MARGIN;
      const d2 = dx * dx + dz * dz;
      if (d2 > stop * stop) continue;
      const d = Math.sqrt(d2) || 1;
      if ((dx / d) * dd.x + (dz / d) * dd.z < DASH_CONTACT_DOT) continue;   // must be ahead
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    }
    if (best) this._dashBodyCheck(best);
  }

  _dashStrike(e) {
    const maxHp = e.maxHealth;
    const point = new THREE.Vector3(e.pos.x, e.pos.y + e.def.height * 0.55, e.pos.z);
    const dir = this.controller.dashDir.clone();
    // finisher = the target is "close to being killed" (low health)
    const finisher = e.health <= Math.max(FINISHER_MIN, maxHp * FINISHER_FRAC);
    const pan = this.enemies.panFor(e.pos);
    e.knockback.addScaledVector(dir, finisher ? 4.5 : 3);
    e._killedByDash = !e.boss;   // suppress the corpse's own burst (folded into the pin) — except bosses, which keep their spectacle
    const killed = e.takeDamage(finisher ? e.health + 1 : DASH_DAMAGE, point, dir, false);
    e._killedByDash = false;

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
    return killed;
  }

  // Skewer a freshly-killed corpse to a point in front of the player. Only one
  // rides at a time — a new kill detonates the previous, so a line of fodder
  // reads as a clean skewer-pop-skewer stream instead of a pile.
  _pinCorpse(e) {
    if (this._dashPin && this._dashPin.e !== e) this._detonatePin();
    e._pinned = true; e.flash = 1; e._applyFlash();
    this._dashPin = { e, t: 0 };
  }

  // Glue the pinned corpse in front each frame (on realDt, so it tracks the
  // still-moving player straight through kill hitstop), then pop it.
  _updateDashPin(realDt) {
    const pin = this._dashPin;
    if (!pin) return;
    const e = pin.e;
    if (!e || !e.group || !e.group.parent) { this._dashPin = null; if (e) e._pinned = false; return; }
    pin.t += realDt;
    if (!this.controller.isDashing() || pin.t >= PIN_TIME) { this._detonatePin(); return; }
    const p = this.controller.pos, dd = this.controller.dashDir;
    const ax = p.x + dd.x * PIN_DIST, az = p.z + dd.z * PIN_DIST;
    const centerY = p.y + PIN_Y;
    const originY = e.def.flyer ? centerY : centerY - e.def.height * 0.5;
    e.pos.set(ax, originY, az);
    e.group.position.set(ax, originY, az);
    e.group.rotation.set(0, Math.atan2(dd.x, dd.z), pin.t * 24);   // fast tumble-smear
  }

  // The "explode in your face": burst the pinned corpse in view, then dispose it
  // (the explosion IS the death, so there's no corpse to snap to the ground).
  _detonatePin() {
    const pin = this._dashPin; this._dashPin = null;
    if (!pin) return;
    const e = pin.e;
    const dd = this.controller.dashDir, cp = this.controller.pos;
    const p = new THREE.Vector3(cp.x + dd.x * PIN_DIST, cp.y + PIN_Y, cp.z + dd.z * PIN_DIST);
    this.fx.deathBurst(p, e.def.blood);
    this.fx.shockwave(p, 0xffb060, 4.2, 0.4);
    this.fx.bloodBurst(p, dd, 1.8, e.def.blood);
    this.fx.impactLight(p, 0xffcaa0, 7, 0.08);
    this.fx.addTrauma(0.16); this.fx.addHitstop(0.04);
    this.audio.dashHit(this.enemies.panFor(e.pos));
    e._pinned = false;
    if (e.group && e.group.parent) e._dispose();
  }

  // A survivor you dash into stops you dead — a mass-scaled rebound + a big slam,
  // never a phase-through. Heavy bodies bounce you harder; air-dashes keep their arc.
  _dashBodyCheck(e) {
    const heavy = e.def.radius >= 0.7 || e.def.gait === 'stomp';
    const air = this.controller.dashAir && !this.controller.onGround;
    const rebound = heavy ? (air ? 5.0 : 6.5) : (air ? 3.0 : 4.0);
    const pop = heavy ? 3.0 : 2.0;
    this.controller.endDash(rebound, pop);
    this.invuln = Math.max(this.invuln, 0.2);
    const dd = this.controller.dashDir;
    e.knockback.addScaledVector(dd, heavy ? 4 : 7); e.flash = 1;
    const cp = this.controller.pos;
    const p = new THREE.Vector3(cp.x + dd.x * (0.4 + e.def.radius), cp.y + 1.05, cp.z + dd.z * (0.4 + e.def.radius));
    this.fx.shockwave(p, 0x9fd0ff, heavy ? 5.0 : 3.6, 0.42);
    this.fx.bloodBurst(p, dd, heavy ? 1.2 : 1.6, e.def.blood);
    this.fx.impactLight(p, 0xbfe0ff, 7, 0.08);
    this.fx.addTrauma(heavy ? 0.4 : 0.26); this.fx.addHitstop(heavy ? 0.09 : 0.06);
    this.cam.addFovPunch(-6);                       // compression kick (dash launch is +11)
    this.audio.dashHit(this.enemies.panFor(e.pos));
    this.hud.hitMarker(false, false);
  }

  // Roll for an ammo/health drop when an enemy dies. Adaptive: bias to health
  // when the player is hurt, ammo otherwise; tough enemies drop more.
  _maybeDrop(e, pos) {
    const hpTier = clamp01(e.maxHealth / 240);
    // elites (and gilded bounty marks) ALWAYS pay out
    if (e.elite) {
      this.pickups.spawn(this.health < this.maxHealth * 0.6 ? 'health' : 'ammo', pos);
      if (e.scoreMult > 2 || Math.random() < 0.3) {
        const j = new THREE.Vector3((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4);
        this.pickups.spawn(Math.random() < 0.5 ? 'health' : 'ammo', pos.clone().add(j));
      }
      return;
    }
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
