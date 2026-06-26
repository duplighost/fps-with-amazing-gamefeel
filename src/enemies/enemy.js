// Enemies + wave manager. Two archetypes: GRUNT (fast melee chaser) and SHOOTER
// (keeps its distance, lobs dodgeable energy bolts). Everything is built for
// feedback: white hit-flash, knockback, blood spray, a damage health-bar, a
// brief hitstop on every hit, and a satisfying pop + particle burst on death.

import * as THREE from 'three';
import { clamp, clamp01, damp, rand, randInt, pick, lerp } from '../engine/math.js';

const WHITE = new THREE.Color(0xffffff); // reused for hit-flash tint (no per-frame alloc)

const GRUNT_WINDUP = 0.26;     // telegraph before a grunt's melee strike lands

const GRUNT = {
  type: 'grunt', color: 0xff4d3d, eye: 0xffd24a,
  height: 1.7, radius: 0.5, baseHealth: 60, speed: 4.6,
  attackRange: 2.0, attackDamage: 12, attackCooldown: 1.0, score: 100,
};
const SHOOTER = {
  type: 'shooter', color: 0xb44dff, eye: 0x66e0ff,
  height: 1.4, radius: 0.55, baseHealth: 45, speed: 2.8,
  preferredDist: 13, attackDamage: 9, attackCooldown: 2.0, score: 150,
  projectileSpeed: 18,
};

export class Enemy {
  constructor(manager, def, pos, healthScale, speedScale) {
    this.mgr = manager;
    this.def = def;
    this.alive = true;
    this.maxHealth = def.baseHealth * healthScale;
    this.health = this.maxHealth;
    this.speed = def.speed * speedScale;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.knockback = new THREE.Vector3();
    this.attackTimer = rand(0.3, def.attackCooldown);
    this.charge = 0;            // shooter wind-up / grunt telegraph
    this.windup = 0;            // grunt lunge wind-up timer
    this.flash = 0;             // hit flash amount
    this.spawnT = 0;            // 0..1 spawn-in
    this.deathT = -1;           // >=0 while dying
    this.facing = 0;
    this.bob = rand(0, Math.PI * 2);
    this.hpBarTimer = 0;

    this._build();
  }

  _build() {
    const def = this.def;
    const g = new THREE.Group();
    this.group = g;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: def.color, emissive: def.color, emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.5, flatShading: true,
    });
    this.bodyMat = bodyMat;
    this._baseEmissive = 0.25;

    let bodyGeo;
    if (def.type === 'grunt') {
      bodyGeo = new THREE.ConeGeometry(def.radius, def.height, 6);
    } else {
      bodyGeo = new THREE.OctahedronGeometry(def.radius * 1.2, 0);
    }
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    body.position.y = def.height * 0.5;
    body.userData.enemy = this;
    g.add(body);
    this.body = body;

    // eye / core
    const eyeMat = new THREE.MeshStandardMaterial({ color: def.eye, emissive: def.eye, emissiveIntensity: 2.2 });
    this.eyeMat = eyeMat;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.32, 12, 12), eyeMat);
    eye.position.set(0, def.height * (def.type === 'grunt' ? 0.72 : 0.5), def.radius * 0.55);
    eye.userData.enemy = this;
    g.add(eye);
    this.eye = eye;

    // accent light so they glow into the scene
    this.glow = new THREE.PointLight(def.eye, 0.8, 6, 2);
    this.glow.position.copy(eye.position);
    g.add(this.glow);

    if (def.type === 'shooter') {
      // little orbiting ring of fins
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.16), bodyMat);
        const a = (i / 4) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 0.6, def.height * 0.5, Math.sin(a) * 0.6);
        fin.rotation.y = -a;
        g.add(fin);
      }
    }

    g.position.copy(this.pos);
    g.scale.setScalar(0.01);
    this.mgr.scene.add(g);
  }

  _ensureHpBar() {
    if (this.hpBar) return;
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.6 }));
    bg.scale.set(1.1, 0.16, 1);
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff4040, depthTest: false, transparent: true }));
    fill.scale.set(1.05, 0.11, 1);
    const grp = new THREE.Group();
    grp.add(bg); grp.add(fill);
    grp.position.set(0, this.def.height + 0.5, 0);
    this.group.add(grp);
    this.hpBar = grp;
    this.hpFill = fill;
    this.hpBg = bg;
  }

  isHeadshot(point) {
    // group.position.y is 0 for grunts and the hover height for shooters
    return point.y > this.group.position.y + this.def.height * 0.62;
  }

  takeDamage(dmg, point, dir, isHead) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flash = 1;
    this.knockback.addScaledVector(dir, isHead ? 4 : 2.5);
    this.knockback.y = 0;
    this.hpBarTimer = 2.2;
    this._ensureHpBar();

    const pan = this.mgr.panFor(this.pos);
    this.mgr.fx.bloodBurst(point, dir, isHead ? 1.5 : 1, this.def.color);
    this.mgr.audio.enemyHit(pan);

    if (this.health <= 0) {
      this._die(point, dir);
      return true;
    }
    return false;
  }

  _die(point, dir) {
    this.alive = false;
    this.deathT = 0;
    this.knockback.addScaledVector(dir, 3);
    const pan = this.mgr.panFor(this.pos);
    this.mgr.fx.deathBurst(this.group.position.clone(), this.def.eye);
    this.mgr.fx.addTrauma(0.18);
    this.mgr.audio.enemyDeath(pan);
    if (this.hpBar) this.hpBar.visible = false;
    if (this.glow) this.glow.intensity = 2.5;
    this.mgr._onEnemyKilled(this);
  }

  update(dt, player) {
    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = this.deathT / 0.35;
      // pop then collapse
      const s = t < 0.4 ? lerp(1, 1.35, t / 0.4) : lerp(1.35, 0.01, clamp01((t - 0.4) / 0.6));
      this.group.scale.setScalar(Math.max(0.01, s));
      this.group.position.addScaledVector(this.knockback, dt);
      this.knockback.multiplyScalar(Math.exp(-6 * dt));
      this.body.rotation.x += dt * 6;
      if (this.glow) this.glow.intensity = lerp(2.5, 0, clamp01(t));
      if (this.deathT >= 0.35) this._dispose();
      return;
    }

    // spawn-in
    if (this.spawnT < 1) {
      this.spawnT = clamp01(this.spawnT + dt * 2.2);
      this.group.scale.setScalar(this.spawnT);
    }

    const def = this.def;
    const toPlayer = new THREE.Vector3().subVectors(player.pos, this.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.clone().multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);

    // face the player smoothly
    const targetFacing = Math.atan2(dir.x, dir.z);
    this.facing = dampAngle(this.facing, targetFacing, 8, dt);
    this.group.rotation.y = this.facing;

    // desired velocity
    const desired = new THREE.Vector3();
    if (def.type === 'grunt') {
      if (dist > def.attackRange * 0.8) desired.addScaledVector(dir, this.speed);
    } else {
      // shooter: hold preferred range
      if (dist > def.preferredDist + 2) desired.addScaledVector(dir, this.speed);
      else if (dist < def.preferredDist - 2) desired.addScaledVector(dir, -this.speed);
      else desired.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), this.speed * 0.5 * (Math.sin(this.bob * 0.5) >= 0 ? 1 : -1)); // weaving strafe
    }

    // separation from other enemies
    const sep = this.mgr.separation(this, def.radius);
    desired.addScaledVector(sep, this.speed);

    // steer around cover instead of grinding into it
    const avoid = this.mgr.avoidObstacles(this, def.radius, dir);
    desired.addScaledVector(avoid, this.speed * 1.2);

    // smooth toward desired velocity
    this.vel.x = damp(this.vel.x, desired.x, 8, dt);
    this.vel.z = damp(this.vel.z, desired.z, 8, dt);

    // knockback adds on top, decays
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-7 * dt));

    // collide with arena + obstacles
    this.mgr.collideEnemy(this, def.radius);
    this.pos.y = 0;
    this.group.position.copy(this.pos);

    // idle bob / hover
    this.bob += dt * (def.type === 'shooter' ? 2.5 : 6) * (1 + this.vel.length() * 0.1);
    if (def.type === 'shooter') this.group.position.y = Math.sin(this.bob) * 0.18 + 0.6;
    else this.body.position.y = def.height * 0.5 + Math.abs(Math.sin(this.bob)) * 0.06;

    // attacking
    this.attackTimer -= dt;
    if (def.type === 'grunt') {
      if (this.windup > 0) {
        // committed to a lunge: glow ramps (charge) and the grunt leans in,
        // then the hit lands when the wind-up completes — a fair telegraph.
        this.windup -= dt;
        this.charge = clamp01(1 - this.windup / GRUNT_WINDUP);
        this.vel.addScaledVector(dir, this.speed * 1.5 * dt);
        if (this.windup <= 0) {
          if (dist <= def.attackRange + 0.7) {
            player.takeDamage(def.attackDamage, this.pos);
            this.knockback.addScaledVector(dir, -2.5); // recoil after the lunge
            this.vel.addScaledVector(dir, 5);
            this.flash = Math.max(this.flash, 0.6);
          }
          this.attackTimer = def.attackCooldown;
          this.charge = 0;
        }
      } else {
        this.charge = damp(this.charge, 0, 8, dt);
        if (dist <= def.attackRange && this.attackTimer <= 0) {
          this.windup = GRUNT_WINDUP; // begin telegraph
          this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos));
        }
      }
    } else {
      // shooter charges then fires
      if (dist < def.preferredDist + 6 && this.attackTimer <= def.attackCooldown * 0.35) {
        this.charge = clamp01(this.charge + dt * 3);
      } else {
        this.charge = damp(this.charge, 0, 6, dt);
      }
      if (this.attackTimer <= 0 && dist < def.preferredDist + 8) {
        this.attackTimer = def.attackCooldown;
        this.charge = 0;
        const muzzle = this.eye.getWorldPosition(new THREE.Vector3());
        this.mgr.spawnProjectile(muzzle, player, def.projectileSpeed, def.attackDamage, def.eye);
        this.mgr.audio.enemyShoot(this.mgr.panFor(this.pos));
      }
    }

    // visuals: flash + charge glow + eye pulse (charge ramps the telegraph)
    this.flash = damp(this.flash, 0, 9, dt);
    const pulse = 0.6 + Math.sin(this.bob * 2) * 0.2;
    this.eyeMat.emissiveIntensity = (2.0 + this.charge * 4) * pulse + this.flash * 4;
    this.bodyMat.emissiveIntensity = this._baseEmissive + this.flash * 3 + this.charge * 0.7;
    this.bodyMat.color.setHex(def.color).lerp(WHITE, this.flash * 0.85);
    if (def.type === 'grunt') this.body.scale.setScalar(1 + this.charge * 0.2); // lunge tell
    if (this.glow) this.glow.intensity = 0.8 + this.charge * 2.4 + this.flash * 3;

    // hp bar
    if (this.hpBar) {
      this.hpBarTimer -= dt;
      const show = this.hpBarTimer > 0;
      this.hpBar.visible = show;
      if (show) {
        const r = clamp01(this.health / this.maxHealth);
        this.hpFill.scale.x = 1.05 * r;
        this.hpFill.position.x = -(1.05 * (1 - r)) / 2;
        this.hpFill.material.color.setHSL(lerp(0, 0.33, r), 0.9, 0.5);
        const fade = clamp01(this.hpBarTimer / 0.5);
        this.hpFill.material.opacity = fade;
        this.hpBg.material.opacity = 0.6 * fade;
      }
    }

    // Refresh world matrices now that we've moved, so the bullet raycaster
    // (which reads matrixWorld, normally only updated at render time) hits the
    // enemy at its *current* position — crisp, frame-accurate registration.
    this.group.updateMatrixWorld(true);
  }

  _dispose() {
    this.mgr._removeEnemy(this);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.mgr.scene.remove(this.group);
  }
}

function dampAngle(a, b, lambda, dt) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * (1 - Math.exp(-lambda * dt));
}

// --- wave manager ---------------------------------------------------------

export class EnemyManager {
  constructor(scene, fx, audio, level, player) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.level = level;
    this.player = player;
    this.colliders = level.colliders;
    this.bounds = level.bounds;
    this.spawnPoints = level.spawnPoints;

    this.enemies = [];
    this.projectiles = [];
    this._projGeo = new THREE.SphereGeometry(0.18, 10, 10);

    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.betweenWaves = 0;
    this.active = false;

    // hud / game callbacks
    this.onScore = null;
    this.onKill = null;
    this.onWaveStart = null;
    this.onWaveCleared = null;
    this.onCountChange = null;
  }

  reset() {
    // dispose GPU resources for anything still alive at restart, not just unlink
    for (const e of this.enemies) {
      e.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.scene.remove(e.group);
    }
    for (const p of this.projectiles) {
      if (p.mesh.material) p.mesh.material.dispose(); // geometry is shared (_projGeo)
      this.scene.remove(p.mesh);
    }
    this.enemies = [];
    this.projectiles = [];
    this.wave = 0; this.score = 0; this.kills = 0;
    this.spawnQueue = []; this.betweenWaves = 0; this.active = false;
  }

  start() {
    this.active = true;
    this.betweenWaves = 1.5;
  }

  _startWave(n) {
    this.wave = n;
    const count = Math.min(4 + n * 2, 26);
    const shooterRatio = clamp(0.15 + n * 0.05, 0, 0.5);
    const healthScale = 1 + (n - 1) * 0.12;
    const speedScale = 1 + (n - 1) * 0.04;
    this.spawnQueue = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      const type = Math.random() < shooterRatio ? SHOOTER : GRUNT;
      t += rand(0.25, 0.6); // cumulative → strictly increasing spawn times
      this.spawnQueue.push({ def: type, healthScale, speedScale, delay: t });
    }
    this.spawnTimer = 0;
    if (this.onWaveStart) this.onWaveStart(n);
    this.audio.waveStart();
    this.audio.setMusicIntensity(clamp01(n / 12));
  }

  spawnNow(item) {
    const sp = pick(this.spawnPoints);
    const pos = new THREE.Vector3(sp.x + rand(-1.5, 1.5), 0, sp.z + rand(-1.5, 1.5));
    const e = new Enemy(this, item.def, pos, item.healthScale, item.speedScale);
    this.enemies.push(e);
    // spawn flash
    this.fx.impactLight(pos.clone().setY(1), item.def.eye, 5, 0.25);
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  update(dt) {
    if (this.active) {
      if (this.spawnQueue.length === 0 && this.aliveCount() === 0 && this.betweenWaves <= 0) {
        // wave cleared (or first start)
        if (this.wave > 0 && this.onWaveCleared) this.onWaveCleared(this.wave);
        if (this.wave > 0) this.audio.waveClear();
        this.betweenWaves = this.wave === 0 ? 1.2 : 3.5;
      }
      if (this.betweenWaves > 0) {
        this.betweenWaves -= dt;
        if (this.betweenWaves <= 0) this._startWave(this.wave + 1);
      }
      // drip-feed spawns
      if (this.spawnQueue.length > 0) {
        this.spawnTimer += dt;
        while (this.spawnQueue.length && this.spawnTimer >= this.spawnQueue[0].delay) {
          this.spawnNow(this.spawnQueue.shift());
          // shift remaining delays so they stay relative
        }
      }
    }

    // iterate a snapshot: an enemy that finishes dying calls _removeEnemy(),
    // which splices this.enemies — mutating the live array mid-iteration.
    const snapshot = this.enemies.slice();
    for (const e of snapshot) e.update(dt, this.player);
    this._updateProjectiles(dt);
  }

  spawnProjectile(from, player, speed, damage, colorHex) {
    const target = player.pos.clone();
    target.y = 1.1; // aim at torso
    const dir = new THREE.Vector3().subVectors(target, from).normalize();
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(this._projGeo, mat);
    mesh.position.copy(from);
    const light = new THREE.PointLight(colorHex, 1.2, 5, 2);
    mesh.add(light);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, pos: from.clone(), vel: dir.multiplyScalar(speed), life: 4, damage });
  }

  _updateProjectiles(dt) {
    const player = this.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 8;

      // trail
      this.fx.sparks.emit(p.pos.x, p.pos.y, p.pos.z, rand(-1, 1), rand(-1, 1), rand(-1, 1),
        p.mesh.material.color.r, p.mesh.material.color.g, p.mesh.material.color.b, 0.12, 0.3, 0, 4);

      let dead = p.life <= 0;
      // hit player?
      const pd = new THREE.Vector3(player.pos.x - p.pos.x, (player.pos.y + 1.0) - p.pos.y, player.pos.z - p.pos.z);
      if (pd.lengthSq() < 0.65 * 0.65) {
        player.takeDamage(p.damage, p.pos);
        this.fx.impactLight(p.pos.clone(), p.mesh.material.color.getHex(), 4, 0.08);
        dead = true;
      }
      // hit world?
      if (!dead && this._pointInSolids(p.pos)) {
        this.fx.bulletImpact(p.pos.clone(), new THREE.Vector3(0, 1, 0), p.mesh.material.color.getHex());
        dead = true;
      }
      if (p.pos.y < 0) {
        this.fx.bulletImpact(p.pos.clone().setY(0.02), new THREE.Vector3(0, 1, 0), p.mesh.material.color.getHex());
        dead = true;
      }
      if (dead) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  _pointInSolids(pt) {
    for (const c of this.colliders) {
      if (pt.x > c.min.x && pt.x < c.max.x && pt.y > c.min.y && pt.y < c.max.y && pt.z > c.min.z && pt.z < c.max.z) return true;
    }
    return false;
  }

  // simple boids-style separation
  separation(self, radius) {
    const push = new THREE.Vector3();
    for (const o of this.enemies) {
      if (o === self || !o.alive) continue;
      const dx = self.pos.x - o.pos.x;
      const dz = self.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const minD = radius + o.def.radius;
      if (d2 < minD * minD && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        push.x += (dx / d) * (1 - d / minD);
        push.z += (dz / d) * (1 - d / minD);
      }
    }
    return push.multiplyScalar(1.5);
  }

  // Steering away from nearby cover, with a tangential bias so enemies slide
  // around an obstacle toward the player rather than stalling against it.
  avoidObstacles(e, r, dirToPlayer) {
    const force = new THREE.Vector3();
    const look = r + 2.2;
    for (const c of this.colliders) {
      if (c.max.y < 0.6) continue; // ignore floor strips / ramp toes
      const cx = clamp(e.pos.x, c.min.x, c.max.x);
      const cz = clamp(e.pos.z, c.min.z, c.max.z);
      const dx = e.pos.x - cx, dz = e.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= look * look || d2 <= 1e-5) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const strength = 1 - d / look;
      // push away from the surface
      force.x += nx * strength;
      force.z += nz * strength;
      // tangential slide: pick the perpendicular that heads toward the player
      let tx = -nz, tz = nx;
      if (tx * dirToPlayer.x + tz * dirToPlayer.z < 0) { tx = -tx; tz = -tz; }
      force.x += tx * strength * 1.6;
      force.z += tz * strength * 1.6;
    }
    return force;
  }

  collideEnemy(e, r) {
    const b = this.bounds;
    e.pos.x = clamp(e.pos.x, b.minX + r, b.maxX - r);
    e.pos.z = clamp(e.pos.z, b.minZ + r, b.maxZ - r);
    // push out of obstacle boxes (treat enemy as a circle on the ground)
    for (const c of this.colliders) {
      if (c.min.y > 1.0) continue; // skip tall thin things they walk under? keep all for safety
      const cx = clamp(e.pos.x, c.min.x, c.max.x);
      const cz = clamp(e.pos.z, c.min.z, c.max.z);
      const dx = e.pos.x - cx;
      const dz = e.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-5) {
          const d = Math.sqrt(d2);
          e.pos.x = cx + (dx / d) * r;
          e.pos.z = cz + (dz / d) * r;
        } else {
          e.pos.x += r; // degenerate: nudge
        }
      }
    }
  }

  panFor(pos) {
    // crude stereo pan based on player-relative position
    const cam = this.player;
    const rel = new THREE.Vector3().subVectors(pos, cam.pos);
    const yaw = cam.yaw ? cam.yaw() : 0;
    const right = Math.cos(yaw) * rel.x - Math.sin(yaw) * rel.z;
    return clamp(right / 12, -1, 1);
  }

  raycastTargets() {
    const arr = [];
    for (const e of this.enemies) {
      if (e.alive) { arr.push(e.body, e.eye); }
    }
    return arr;
  }

  aliveCount() { return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0); }

  _onEnemyKilled(e) {
    this.kills++;
    this.score += e.def.score;
    if (this.onScore) this.onScore(this.score, e.def.score, e.group.position.clone());
    if (this.onKill) this.onKill(e);
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  _removeEnemy(e) {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
  }
}
