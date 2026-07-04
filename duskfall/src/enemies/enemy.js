// The horde. Procedural humanoid creatures built from capsules/spheres, animated
// with a walk/run cycle (swinging limbs, forward lurch, lolling head) so they
// read as detailed, menacing 3D enemies. Three archetypes, hit-flash + blood +
// knockback, a scripted crumple-death, and a wave manager with arcade scoring.

import * as THREE from 'three';
import { clamp, clamp01, damp, rand, randInt, pick, lerp } from '../engine/math.js';

const WHITE = new THREE.Color(0xffffff);

const TYPES = {
  shambler: { hp: 72, speed: 2.4, radius: 0.42, height: 1.85, damage: 13, attackCd: 1.1, score: 100, skin: 0x9aa27a, rate: 5.5, reach: 0.9 },
  runner: { hp: 46, speed: 5.4, radius: 0.38, height: 1.72, damage: 9, attackCd: 0.85, score: 150, skin: 0xb08a6a, rate: 10, reach: 0.7 },
  brute: { hp: 240, speed: 1.75, radius: 0.72, height: 2.55, damage: 30, attackCd: 1.5, score: 320, skin: 0x8f8f72, rate: 3.8, reach: 1.3 },
};

// --- procedural humanoid --------------------------------------------------
function limb(mat, r, len) {
  const g = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(r, len - r * 2, 4, 8);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  g.add(m);
  return g;
}

function buildHumanoid(def, mat) {
  const s = def.height / 1.85;
  const root = new THREE.Group();

  const hipH = 0.95 * s;
  const pelvis = new THREE.Group();
  pelvis.position.y = hipH;
  root.add(pelvis);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26 * s, 0.5 * s, 4, 10), mat);
  torso.position.y = 0.42 * s;
  torso.castShadow = true;
  pelvis.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19 * s, 12, 10), mat);
  head.position.y = 0.85 * s;
  head.scale.set(1, 1.12, 1.05);
  head.castShadow = true;
  pelvis.add(head);
  // sunken brow / jaw hint
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.08 * s, 0.14 * s), mat);
  jaw.position.set(0, 0.76 * s, 0.12 * s);
  pelvis.add(jaw);

  const armL = limb(mat, 0.09 * s, 0.72 * s); armL.position.set(-0.32 * s, 0.66 * s, 0); pelvis.add(armL);
  const armR = limb(mat, 0.09 * s, 0.72 * s); armR.position.set(0.32 * s, 0.66 * s, 0); pelvis.add(armR);
  const legL = limb(mat, 0.12 * s, hipH); legL.position.set(-0.15 * s, hipH, 0); root.add(legL);
  const legR = limb(mat, 0.12 * s, hipH); legR.position.set(0.15 * s, hipH, 0); root.add(legR);

  root.userData.parts = { pelvis, torso, head, armL, armR, legL, legR, hipH, s };
  // tag hit meshes
  torso.userData.hit = 'body'; head.userData.hit = 'head';
  root.userData.hitMeshes = [torso, head, jaw, armL.children[0], armR.children[0], legL.children[0], legR.children[0]];
  return root;
}

export class Enemy {
  constructor(mgr, typeName, pos, hpScale, speedScale) {
    this.mgr = mgr;
    this.type = typeName;
    this.def = TYPES[typeName];
    this.alive = true;
    this.maxHealth = this.def.hp * hpScale;
    this.health = this.maxHealth;
    this.speed = this.def.speed * speedScale;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.knockback = new THREE.Vector3();
    this.attackTimer = rand(0.2, this.def.attackCd);
    this.phase = rand(0, Math.PI * 2);
    this.flash = 0;
    this.facing = 0;
    this.spawnT = 0;
    this.deathT = -1;
    this.hurtLean = 0;
    this.growlCd = rand(1, 5);

    this.mat = new THREE.MeshStandardMaterial({ color: this.def.skin, roughness: 0.82, metalness: 0.0, flatShading: false });
    this._baseColor = new THREE.Color(this.def.skin);
    this.group = buildHumanoid(this.def, this.mat);
    this.parts = this.group.userData.parts;
    for (const m of this.group.userData.hitMeshes) m.userData.enemy = this;
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.01);
    mgr.scene.add(this.group);
  }

  isHeadshot(point) {
    return point.y > this.pos.y + this.def.height * 0.78;
  }

  takeDamage(dmg, point, dir, isHead) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flash = 1;
    this.hurtLean = clamp((dir.x * Math.sin(this.facing) + dir.z * Math.cos(this.facing)), -1, 1) * 0.25;
    this.knockback.addScaledVector(dir, isHead ? 3.5 : 2.2);
    this.knockback.y = 0;
    const pan = this.mgr.panFor(this.pos);
    this.mgr.fx.bloodBurst(point, dir, isHead ? 1.6 : 1);
    this.mgr.audio.enemyHit(pan);
    if (this.health <= 0) { this._die(point, dir, isHead); return true; }
    return false;
  }

  _die(point, dir, isHead) {
    this.alive = false;
    this.deathT = 0;
    this.knockback.addScaledVector(dir, 2.5);
    this._fallDir = Math.atan2(dir.x, dir.z);
    const pan = this.mgr.panFor(this.pos);
    this.mgr.fx.deathBurst(this.group.position.clone().setY(this.pos.y + this.def.height * (isHead ? 0.85 : 0.5)));
    this.mgr.fx.addTrauma(0.12);
    this.mgr.audio.enemyDeath(pan);
    this.mgr._onKilled(this, isHead);
  }

  update(dt, player) {
    // --- death: crumple to the ground, then sink + fade ---
    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = this.deathT;
      const fall = clamp01(t / 0.5);
      this.group.rotation.x = lerp(0, (this._fallDir !== undefined ? 1 : 1) * Math.PI * 0.5, easeOut(fall));
      this.pos.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.exp(-6 * dt));
      this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z);
      let sink = 0, fade = 1;
      if (t > 1.4) { sink = (t - 1.4) * 0.6; fade = clamp01(1 - (t - 1.4) / 1.0); }
      this.group.position.set(this.pos.x, this.pos.y - sink, this.pos.z);
      this.mat.opacity = fade; this.mat.transparent = fade < 1;
      this.flash = damp(this.flash, 0, 9, dt);
      this._applyFlash();
      if (t >= 2.4) this._dispose();
      return;
    }

    // spawn-in
    if (this.spawnT < 1) { this.spawnT = clamp01(this.spawnT + dt * 2.4); this.group.scale.setScalar(this.spawnT); }

    const def = this.def;
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos); toP.y = 0;
    const dist = toP.length();
    const dir = dist > 0.001 ? toP.clone().multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);

    // face player
    const target = Math.atan2(dir.x, dir.z);
    this.facing = dampAngle(this.facing, target, 6, dt);
    this.group.rotation.y = this.facing;

    // seek + separation
    const desired = new THREE.Vector3();
    if (dist > def.reach + 0.4) desired.addScaledVector(dir, this.speed);
    const sep = this.mgr.separation(this, def.radius);
    desired.addScaledVector(sep, this.speed);
    this.vel.x = damp(this.vel.x, desired.x, 7, dt);
    this.vel.z = damp(this.vel.z, desired.z, 7, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-7 * dt));
    this.mgr.collideEnemy(this, def.radius);
    this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);

    // --- walk cycle animation ---
    const moveSpd = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (def.rate * 0.5 + moveSpd * def.rate * 0.12);
    const sw = Math.sin(this.phase);
    const p = this.parts;
    const stride = clamp01(moveSpd / this.speed);
    p.legL.rotation.x = sw * 0.6 * stride;
    p.legR.rotation.x = -sw * 0.6 * stride;
    if (this.type === 'runner') {
      p.armL.rotation.x = sw * 0.7 * stride - 0.2;
      p.armR.rotation.x = -sw * 0.7 * stride - 0.2;
    } else {
      // shamblers/brutes reach forward, arms outstretched, small sway
      p.armL.rotation.x = -1.1 + Math.sin(this.phase * 0.7) * 0.15;
      p.armR.rotation.x = -1.1 - Math.sin(this.phase * 0.7) * 0.15;
      p.armL.rotation.z = 0.25; p.armR.rotation.z = -0.25;
    }
    p.pelvis.position.y = p.hipH + Math.abs(Math.cos(this.phase)) * 0.05 * p.s;
    const lean = (this.type === 'runner' ? 0.35 : 0.2) + this.hurtLean;
    p.pelvis.rotation.x = damp(p.pelvis.rotation.x, lean, 8, dt);
    p.head.rotation.z = Math.sin(this.phase * 0.5) * (this.type === 'runner' ? 0.05 : 0.14);
    this.hurtLean = damp(this.hurtLean, 0, 5, dt);

    // attack on contact
    this.attackTimer -= dt;
    if (dist <= def.reach + player.radius + 0.5 && this.attackTimer <= 0) {
      this.attackTimer = def.attackCd;
      player.takeDamage(def.damage + this.mgr.wave * 0.5, this.pos);
      this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos));
      // quick lunge/swipe pose
      p.armL.rotation.x = -2.2; p.armR.rotation.x = -2.2;
    }

    // occasional growl
    this.growlCd -= dt;
    if (this.growlCd <= 0) { this.growlCd = rand(4, 10); if (dist < 30) this.mgr.audio.growl(this.mgr.panFor(this.pos)); }

    // hit flash
    this.flash = damp(this.flash, 0, 9, dt);
    this._applyFlash();
  }

  _applyFlash() {
    this.mat.color.copy(this._baseColor).lerp(WHITE, this.flash * 0.9);
    this.mat.emissive = this.mat.emissive || new THREE.Color();
    this.mat.emissive.setRGB(this.flash * 0.5, this.flash * 0.15, this.flash * 0.12);
  }

  _dispose() {
    this.mgr._remove(this);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mat.dispose();
    this.mgr.scene.remove(this.group);
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function dampAngle(a, b, l, dt) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-l * dt));
}

// --- wave manager ---------------------------------------------------------
export class EnemyManager {
  constructor(scene, fx, audio, world, player) {
    this.scene = scene; this.fx = fx; this.audio = audio;
    this.terrain = world.terrain;
    this.colliders = world.colliders;
    this.boundary = world.playRadius;
    this.player = player;
    this.enemies = [];
    this.wave = 0; this.score = 0; this.kills = 0;
    this.spawnQueue = []; this.spawnTimer = 0; this.betweenWaves = 0; this.active = false;
    this.onScore = null; this.onKill = null; this.onWaveStart = null; this.onWaveCleared = null; this.onCountChange = null;
  }

  reset() {
    for (const e of this.enemies) { e.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); e.mat.dispose(); this.scene.remove(e.group); }
    this.enemies = []; this.wave = 0; this.score = 0; this.kills = 0;
    this.spawnQueue = []; this.betweenWaves = 0; this.active = false;
  }

  start() { this.active = true; this.betweenWaves = 2.0; }

  _startWave(n) {
    this.wave = n;
    const count = Math.min(6 + n * 3, 40);
    const runnerR = clamp(0.1 + n * 0.05, 0, 0.5);
    const bruteR = n >= 3 ? clamp(0.06 + n * 0.02, 0, 0.22) : 0;
    const hpScale = 1 + (n - 1) * 0.14;
    const speedScale = 1 + (n - 1) * 0.03;
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      let t = 'shambler';
      const r = Math.random();
      if (r < bruteR) t = 'brute'; else if (r < bruteR + runnerR) t = 'runner';
      this.spawnQueue.push({ t, hpScale, speedScale, delay: (this.spawnQueue.length) * rand(0.25, 0.55) });
    }
    this.spawnTimer = 0;
    if (this.onWaveStart) this.onWaveStart(n);
    this.audio.waveStart();
  }

  spawnNow(item) {
    // emerge from the treeline: a random angle at the arena edge, around the player
    const a = rand(0, Math.PI * 2);
    const r = this.boundary * rand(0.82, 0.98);
    let x = this.player.pos.x + Math.cos(a) * (r - Math.hypot(this.player.pos.x, this.player.pos.z) * 0);
    let z = this.player.pos.z + Math.sin(a) * r;
    // keep inside the arena
    const dr = Math.hypot(x, z);
    if (dr > this.boundary - 2) { const k = (this.boundary - 2) / dr; x *= k; z *= k; }
    const pos = new THREE.Vector3(x, this.terrain.height(x, z), z);
    const e = new Enemy(this, item.t, pos, item.hpScale, item.speedScale);
    this.enemies.push(e);
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  update(dt) {
    if (this.active) {
      if (this.spawnQueue.length === 0 && this.aliveCount() === 0 && this.betweenWaves <= 0) {
        if (this.wave > 0 && this.onWaveCleared) this.onWaveCleared(this.wave);
        if (this.wave > 0) this.audio.waveClear();
        this.betweenWaves = this.wave === 0 ? 1.0 : 4.0;
      }
      if (this.betweenWaves > 0) {
        this.betweenWaves -= dt;
        if (this.betweenWaves <= 0) this._startWave(this.wave + 1);
      }
      if (this.spawnQueue.length > 0) {
        this.spawnTimer += dt;
        while (this.spawnQueue.length && this.spawnTimer >= this.spawnQueue[0].delay) this.spawnNow(this.spawnQueue.shift());
      }
    }
    const snap = this.enemies.slice();
    for (const e of snap) e.update(dt, this.player);
  }

  separation(self, radius) {
    const push = new THREE.Vector3();
    for (const o of this.enemies) {
      if (o === self || !o.alive) continue;
      const dx = self.pos.x - o.pos.x, dz = self.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = radius + o.def.radius;
      if (d2 < min * min && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        push.x += (dx / d) * (1 - d / min);
        push.z += (dz / d) * (1 - d / min);
      }
    }
    return push.multiplyScalar(1.4);
  }

  collideEnemy(e, r) {
    // push out of foliage colliders + keep in bounds
    for (const c of this.colliders) {
      const dx = e.pos.x - c.x, dz = e.pos.z - c.z;
      const min = c.r + r; const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-5) { const d = Math.sqrt(d2); e.pos.x = c.x + dx / d * min; e.pos.z = c.z + dz / d * min; }
    }
    const dr = Math.hypot(e.pos.x, e.pos.z);
    const b = this.boundary + 3;
    if (dr > b) { const k = b / dr; e.pos.x *= k; e.pos.z *= k; }
  }

  panFor(pos) {
    const rel = new THREE.Vector3().subVectors(pos, this.player.pos);
    const yaw = this.player.yaw ? this.player.yaw() : 0;
    const right = Math.cos(yaw) * rel.x - Math.sin(yaw) * rel.z;
    return clamp(right / 16, -1, 1);
  }

  raycastTargets() {
    const arr = [];
    for (const e of this.enemies) if (e.alive) for (const m of e.group.userData.hitMeshes) arr.push(m);
    return arr;
  }

  aliveCount() { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  _onKilled(e, isHead) {
    this.kills++;
    const pos = new THREE.Vector3(e.pos.x, this.terrain.height(e.pos.x, e.pos.z) + e.def.height * 0.6, e.pos.z);
    if (this.onKill) this.onKill(e, isHead, pos);
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  _remove(e) { const i = this.enemies.indexOf(e); if (i >= 0) this.enemies.splice(i, 1); }
}
