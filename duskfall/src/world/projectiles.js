// Flying ordnance: enemy sniper BOLTS and the yeti's giant SNOWBALLS. A single
// light manager moves them, trails them, and resolves hits. Snowballs are
// REFLECTABLE — dashing into an incoming one bats it back at the boss for big
// damage, which is the intended way to break the yeti.

import * as THREE from 'three';
import { clamp01 } from '../engine/math.js';

const TYPES = {
  bolt: {
    r: 0.35, speed: 30, damage: 15, color: 0xba7bff, life: 3.2, gravity: 0,
    reflectable: false, trail: 'spark',
  },
  snowball: {
    r: 1.35, speed: 15, damage: 34, color: 0xe6f3ff, life: 7, gravity: 5.5,
    reflectable: true, trail: 'snow',
  },
  // the VOID ORB: arcs, bounces, then blooms into a singularity that drags the
  // whole pack into one point and detonates it. NEVER hurts the player.
  grenade: {
    r: 0.26, speed: 24, damage: 240, color: 0xba7bff, life: 1.35, gravity: 22,
    reflectable: false, trail: 'grenade', bounce: true, aoe: true, blastR: 7.5, fuse: true,
  },
};

const REFLECT_R = 3.2;          // dash within this of an incoming snowball to bat it back
const REFLECT_SPEED = 34;       // reflected snowballs fly back fast + true

export class ProjectileManager {
  constructor(scene, fx, audio, terrain) {
    this.scene = scene; this.fx = fx; this.audio = audio; this.terrain = terrain;
    this.groundAt = null;   // layer-aware ground fn (set by main)
    this.list = [];
    this._geo = {
      bolt: new THREE.IcosahedronGeometry(0.32, 0),
      snowball: new THREE.IcosahedronGeometry(1.2, 1),
      grenade: new THREE.IcosahedronGeometry(0.26, 0),
    };
  }

  reset() { for (const p of this.list) this._dispose(p); this.list = []; }

  // origin/dir are THREE.Vector3; opts: { owner:'enemy'|'player', speed, damage }
  spawn(type, origin, dir, opts = {}) {
    const def = TYPES[type];
    if (!def || this.list.length > 40) return null;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a0a12, emissive: def.color, emissiveIntensity: type === 'snowball' ? 0.9 : 2.6,
      roughness: type === 'snowball' ? 0.9 : 0.4, metalness: 0, flatShading: true,
    });
    if (type === 'snowball') { mat.color.setHex(0xdbe9f5); mat.emissiveIntensity = 0.5; }
    if (type === 'grenade') { mat.color.setHex(0x1c1626); mat.metalness = 0.7; mat.roughness = 0.5; mat.emissive.setHex(0xba7bff); mat.emissiveIntensity = 1.5; }
    const mesh = new THREE.Mesh(this._geo[type], mat);
    mesh.position.copy(origin); mesh.castShadow = type === 'snowball';
    this.scene.add(mesh);
    const speed = opts.speed || def.speed;
    const p = {
      type, def, mesh, mat,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(speed),
      spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
      life: def.life, owner: opts.owner || 'enemy',
      r: def.r, dmg: opts.damage || def.damage,
      reflected: false,
    };
    this.list.push(p);
    return p;
  }

  // ctx: { player, controller, enemies, boss, onHitPlayer(dmg,pos), onReflect(pos), onHitEnemy(enemy,dmg,pos,reflected) }
  update(dt, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.vel.y -= p.def.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += p.spin.x * dt; p.mesh.rotation.y += p.spin.y * dt; p.mesh.rotation.z += p.spin.z * dt;
      this._trail(p);

      // grenade: arc + bounce off the ground, blink faster as the fuse burns down,
      // then detonate in a big AoE (never hurts the player)
      if (p.type === 'grenade') {
        const nearBlow = clamp01(1 - p.life / p.def.life);
        p.mat.emissiveIntensity = 1.2 + nearBlow * 2.4 + Math.sin(p.life * (30 + nearBlow * 130)) * (0.4 + nearBlow * 0.9);
        const gy = this.groundAt ? this.groundAt(p.pos.x, p.pos.z, p.pos.y) : this.terrain.height(p.pos.x, p.pos.z);
        if (p.pos.y <= gy + p.r) {
          p.pos.y = gy + p.r;
          if (p.vel.y < 0) p.vel.y = -p.vel.y * 0.42;   // bounce restitution
          p.vel.x *= 0.68; p.vel.z *= 0.68;             // ground friction
          p.spin.multiplyScalar(0.7);
        }
        if (p.life <= 0) {
          // the orb doesn't just explode — it OPENS: main runs the void
          // (vacuum + detonation). Fallback to a plain blast if unhooked.
          if (ctx.onVoidOpen) ctx.onVoidOpen(p.pos.clone());
          else this._explodeGrenade(p, ctx);
          this._kill(i);
        }
        continue;
      }

      // reflect: a dashing player bats an incoming enemy snowball back at the boss
      if (p.def.reflectable && p.owner === 'enemy' && ctx.controller &&
          (ctx.controller.isDashing() || ctx.controller.dashInvuln)) {
        const dx = p.pos.x - ctx.player.pos.x, dy = p.pos.y - (ctx.player.pos.y + 1.2), dz = p.pos.z - ctx.player.pos.z;
        if (dx * dx + dy * dy + dz * dz < REFLECT_R * REFLECT_R) {
          this._reflect(p, ctx);
          continue;
        }
      }

      // ground / terrain impact (layer-aware: cave floor when underground)
      const gy = this.groundAt ? this.groundAt(p.pos.x, p.pos.z, p.pos.y) : this.terrain.height(p.pos.x, p.pos.z);
      if (p.pos.y <= gy + p.r * 0.5) {
        this._impact(p, new THREE.Vector3(p.pos.x, gy, p.pos.z), ctx, false);
        this._kill(i); continue;
      }

      if (p.owner === 'enemy') {
        // hit the player? (a little generous so a well-aimed bolt lands unless you
        // actually move — dodging, not luck, is the counter)
        const rr = p.r + ctx.player.radius + 0.4;
        const dx = p.pos.x - ctx.player.pos.x, dy = p.pos.y - (ctx.player.pos.y + 1.0), dz = p.pos.z - ctx.player.pos.z;
        if (dx * dx + dy * dy + dz * dz < rr * rr) {
          if (ctx.onHitPlayer) ctx.onHitPlayer(p.dmg, p.pos.clone());
          this._impact(p, p.pos.clone(), ctx, false);
          this._kill(i); continue;
        }
      } else {
        // player-owned (reflected): hit an enemy / the boss
        const hit = this._enemyHit(p, ctx);
        if (hit) {
          if (ctx.onHitEnemy) ctx.onHitEnemy(hit, p.dmg, p.pos.clone(), p.reflected);
          this._impact(p, p.pos.clone(), ctx, true);
          this._kill(i); continue;
        }
      }

      if (p.life <= 0) { this._impact(p, p.pos.clone(), ctx, false); this._kill(i); }
    }
  }

  _reflect(p, ctx) {
    p.owner = 'player'; p.reflected = true;
    // aim it back at the boss (or straight back at the sky if none), boosted
    let dir;
    if (ctx.boss && ctx.boss.alive) {
      dir = new THREE.Vector3(
        ctx.boss.pos.x - p.pos.x,
        ctx.boss.pos.y + ctx.boss.def.height * 0.55 - p.pos.y,
        ctx.boss.pos.z - p.pos.z,
      ).normalize();
    } else {
      dir = p.vel.clone().negate().normalize();
    }
    p.vel.copy(dir).multiplyScalar(REFLECT_SPEED);
    p.dmg = Math.max(p.dmg, 120);         // a reflected snowball hits the yeti HARD
    p.life = 4;
    // recolour to a hot, "now it's yours" white-gold + a punchy ring
    p.mat.color.setHex(0xfff2d0); p.mat.emissive.setHex(0xffd27f); p.mat.emissiveIntensity = 1.6;
    this.fx.shockwave(p.pos.clone(), 0xfff2d0, 3.4, 0.3);
    this.fx.addTrauma(0.2);
    if (this.audio) this.audio.snowballReflect(0);
    if (ctx.onReflect) ctx.onReflect(p.pos.clone());
  }

  _enemyHit(p, ctx) {
    // prefer the boss; else any live enemy in radius
    const check = (e) => {
      if (!e || !e.alive) return false;
      const cy = e.pos.y + e.def.height * 0.5;
      const dx = p.pos.x - e.pos.x, dy = p.pos.y - cy, dz = p.pos.z - e.pos.z;
      const rr = p.r + e.def.radius + 0.3;
      return dx * dx + dy * dy + dz * dz < rr * rr;
    };
    if (check(ctx.boss)) return ctx.boss;
    for (const e of ctx.enemies.enemies) if (e !== ctx.boss && check(e)) return e;
    return null;
  }

  _trail(p) {
    if (p.def.trail === 'spark') {
      const c = p.reflected ? [1.0, 0.85, 0.4] : [0.73, 0.48, 1.0];
      this.fx.sparks.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, c[0], c[1], c[2], 0.12, 0.13, 0, 3);
    } else if (p.def.trail === 'grenade') {
      // a faint smoke wisp + a hot ember so you can track the arc
      this.fx.smoke.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0.4, 0, 0.35, 0.32, 0.3, 0.18, 0.22, -0.3, 2.5);
      this.fx.sparks.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 1.0, 0.5, 0.16, 0.1, 0.1, 0, 3);
    } else {
      this.fx.smoke.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0.2, 0, 0.86, 0.92, 1.0, 0.22, 0.5, -0.3, 2.4);
      if (p.reflected) this.fx.sparks.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 1.0, 0.85, 0.4, 0.14, 0.4, 0, 3);
    }
  }

  // A grenade detonation: a big fireball + shock rings, and distance-falloff AoE
  // damage to every enemy (and the boss) in range. The player is never hurt.
  _explodeGrenade(p, ctx) {
    const at = p.pos.clone();
    const R = p.def.blastR;
    // spectacle
    this.fx.shockwave(at.clone().setY(at.y + 0.4), 0xffd070, R, 0.5);
    this.fx.shockwave(at.clone().setY(at.y + 0.4), 0xff5a1e, R * 0.6, 0.34);
    this.fx.impactLight(at.clone().setY(at.y + 0.5), 0xff8030, 26, 0.28);
    this.fx.addTrauma(0.75); this.fx.addHitstop(0.05);
    for (let k = 0; k < 42; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5, s = 5 + Math.random() * 12;
      const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e) + 0.4, dz = Math.sin(a) * Math.cos(e);
      this.fx.debris.emit(at.x, at.y + 0.4, at.z, dx * s, dy * s + 2, dz * s,
        1.0, 0.55 + Math.random() * 0.3, 0.15, 0.4 + Math.random() * 0.5, 0.18 + Math.random() * 0.28, 16, 2.2);
    }
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      this.fx.smoke.emit(at.x, at.y + 0.6, at.z, Math.cos(a) * s, Math.random() * 3 + 1, Math.sin(a) * s,
        0.3, 0.26, 0.24, 0.6 + Math.random() * 0.6, 0.7 + Math.random() * 0.6, 1, 1.8);
    }
    if (this.audio) this.audio.grenadeExplode(0);
    // AoE: distance falloff from the blast centre; applied straight through
    // enemy.takeDamage so kills flow to score/drops. NEVER touches the player.
    const hurt = (e) => {
      if (!e || !e.alive) return;
      const cy = e.pos.y + e.def.height * 0.5;
      const d = Math.hypot(e.pos.x - at.x, cy - at.y, e.pos.z - at.z) - e.def.radius;
      if (d > R) return;
      const fall = clamp01(1 - d / R);
      const dmg = p.def.damage * (0.45 + 0.55 * fall);
      const dir = new THREE.Vector3(e.pos.x - at.x, 0, e.pos.z - at.z);
      if (dir.lengthSq() < 1e-5) dir.set(0, 0, 1); else dir.normalize();
      e.knockback.addScaledVector(dir, e.def.gait === 'stomp' ? 3 : 8);
      e.takeDamage(dmg, new THREE.Vector3(e.pos.x, cy, e.pos.z), dir, false);
    };
    if (ctx.boss) hurt(ctx.boss);
    for (const e of ctx.enemies.enemies.slice()) if (e !== ctx.boss) hurt(e);
    if (ctx.onGrenadeBlast) ctx.onGrenadeBlast(at);
  }

  _impact(p, at, ctx, onEnemy) {
    if (p.type === 'snowball') {
      // a burst of snow + a shock ring
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
        this.fx.debris.emit(at.x, at.y + 0.4, at.z, Math.cos(a) * s, Math.random() * 5 + 1, Math.sin(a) * s,
          0.85, 0.92, 1.0, 0.4 + Math.random() * 0.4, 0.12 + Math.random() * 0.2, 14, 2.6);
      }
      this.fx.shockwave(at.clone().setY(at.y + 0.3), p.reflected ? 0xffe0a0 : 0xcfe6ff, p.reflected ? 4 : 3, 0.35);
      this.fx.addTrauma(p.reflected ? 0.25 : 0.14);
      if (this.audio) this.audio.snowballImpact(0);
    } else {
      this.fx.bulletImpact(at, new THREE.Vector3(0, 1, 0), p.def.color);
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
        this.fx.sparks.emit(at.x, at.y, at.z, Math.cos(a) * s, Math.random() * 3, Math.sin(a) * s, 0.73, 0.48, 1.0, 0.2, 0.14, 4, 4);
      }
    }
  }

  _kill(i) { this._dispose(this.list[i]); this.list.splice(i, 1); }
  _dispose(p) { this.scene.remove(p.mesh); if (p.mat) p.mat.dispose(); }
}
