// The "juice" layer: trauma-based screen shake, hitstop (brief time freeze on
// impactful hits), pooled GPU particle systems, bullet tracers, impact decals,
// and muzzle-flash lights. Everything is pooled so combat never allocates.

import * as THREE from 'three';
import { clamp, clamp01, damp, rand, randSign } from './math.js';

// module-level scratch so the per-particle emitters never allocate in combat
const _scratch = new THREE.Vector3();
const _col = new THREE.Color();

// --- shared procedural textures ------------------------------------------

function softCircleTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bulletHoleTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(8,8,10,0.95)');
  g.addColorStop(0.55, 'rgba(20,20,24,0.8)');
  g.addColorStop(0.8, 'rgba(40,40,46,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  // a few cracks
  ctx.strokeStyle = 'rgba(10,10,12,0.6)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.45, size / 2 + Math.sin(a) * size * 0.45);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- pooled particle system ----------------------------------------------

class ParticlePool {
  constructor(scene, { count = 600, blending = THREE.AdditiveBlending, size = 0.3, texture, depthWrite = false }) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    // hide all initially
    for (let i = 0; i < count; i++) { this.pos[i * 3 + 1] = -9999; }

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / max(-mv.z, 0.1));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(vColor, t.a);
        }`,
      transparent: true,
      blending,
      depthWrite,
      depthTest: true,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.baseSize = size;
    scene.add(this.points);
    this.geo = geo;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life, size, grav = 0, drag = 2) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = life; this.maxLife[i] = life;
    this.sizes[i] = size; this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt) {
    const { pos, vel, life, maxLife, grav, drag, sizes, count } = this;
    let any = false;
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt;
      const ix = i * 3;
      const d = Math.exp(-drag[i] * dt);
      vel[ix] *= d; vel[ix + 1] *= d; vel[ix + 2] *= d;
      vel[ix + 1] -= grav[i] * dt;
      pos[ix] += vel[ix] * dt;
      pos[ix + 1] += vel[ix + 1] * dt;
      pos[ix + 2] += vel[ix + 2] * dt;
      const t = clamp01(life[i] / maxLife[i]);
      sizes[i] = this.baseSize * size01(t) * this._sizeScale(i);
      if (life[i] <= 0) { pos[ix + 1] = -9999; sizes[i] = 0; }
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
    }
  }

  _sizeScale() { return 1; }
}

// particle size envelope: pop in fast, shrink out
function size01(t) { return Math.sin(clamp01(t) * Math.PI * 0.6 + 0.15) * 1.1; }

// --- main FX manager ------------------------------------------------------

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.trauma = 0;
    this.maxTrauma = 1;
    this.shakeTime = 0;
    this.hitstop = 0;
    this.slowmo = 1;          // 1 = normal; <1 dilates world time (kill flourish)
    this._seed = [rand(0, 100), rand(0, 100), rand(0, 100)];

    const circle = softCircleTexture();
    this.sparks = new ParticlePool(scene, { count: 800, blending: THREE.AdditiveBlending, size: 0.5, texture: circle });
    this.debris = new ParticlePool(scene, { count: 600, blending: THREE.NormalBlending, size: 0.4, texture: circle, depthWrite: false });
    this.smoke = new ParticlePool(scene, { count: 300, blending: THREE.NormalBlending, size: 1.2, texture: circle, depthWrite: false });

    // tracer pool (stretched additive boxes)
    this.tracers = [];
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
        color: 0xfff1c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, maxLife: 0.06 });
    }
    this._tracerCursor = 0;

    // decal pool
    this.decals = [];
    const decalTex = bulletHoleTexture();
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
        map: decalTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      }));
      m.visible = false;
      scene.add(m);
      this.decals.push({ mesh: m, life: 0, maxLife: 8 });
    }
    this._decalCursor = 0;

    // muzzle / impact flash lights
    this.flashLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffd27f, 0, 14, 2);
      l.visible = false;
      scene.add(l);
      this.flashLights.push({ light: l, life: 0, maxLife: 0.06, power: 8 });
    }
    this._flashCursor = 0;
  }

  addTrauma(amount) { this.trauma = clamp01(this.trauma + amount); }
  addHitstop(seconds) { this.hitstop = Math.max(this.hitstop, seconds); }
  // Dip world time to `target` (0..1); it eases back to 1 in update().
  addSlowmo(target) { this.slowmo = Math.min(this.slowmo, target); }

  // Returns the scaled dt the rest of the sim should use: 0 during a hit-stop
  // freeze, otherwise the current slow-mo factor. FX itself always advances on
  // real dt so flashes/shake keep animating regardless.
  consumeTimeScale(realDt) {
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      return 0;
    }
    return this.slowmo;
  }

  // --- emitters ----------------------------------------------------------

  bulletImpact(point, normal, colorHex = 0xffcaa0) {
    const c = _col.set(colorHex);
    // sparks flying off the surface along the reflected-ish hemisphere
    for (let i = 0; i < 14; i++) {
      const dir = this._hemisphere(normal, 0.9);
      const s = rand(3, 9);
      this.sparks.emit(point.x, point.y, point.z, dir.x * s, dir.y * s + rand(0, 2), dir.z * s,
        c.r, c.g, c.b, rand(0.12, 0.3), rand(0.25, 0.5), 18, 6);
    }
    // a little dust puff
    for (let i = 0; i < 5; i++) {
      const dir = this._hemisphere(normal, 1);
      this.smoke.emit(point.x, point.y, point.z, dir.x * 1.2, dir.y * 1.2 + 0.6, dir.z * 1.2,
        0.5, 0.48, 0.45, rand(0.3, 0.6), rand(0.4, 0.8), -1, 1.5);
    }
    this.decal(point, normal);
    this.impactLight(point, 0xffb070, 3, 0.04);
  }

  bloodBurst(point, dir, amount = 1, colorHex = 0xff3a3a) {
    const c = _col.set(colorHex);
    const n = (14 * amount) | 0;
    for (let i = 0; i < n; i++) {
      const d = this._cone(dir, 0.7);
      const s = rand(2, 7) * amount;
      this.debris.emit(point.x, point.y, point.z, d.x * s, d.y * s + rand(1, 4), d.z * s,
        c.r * rand(0.7, 1), c.g * 0.15, c.b * 0.15, rand(0.25, 0.5), rand(0.18, 0.45), 16, 3.5);
    }
    // bright core flash
    for (let i = 0; i < 6; i++) {
      const d = this._cone(dir, 0.8);
      this.sparks.emit(point.x, point.y, point.z, d.x * 4, d.y * 4 + 2, d.z * 4,
        1, 0.4, 0.4, rand(0.08, 0.18), rand(0.3, 0.55), 8, 5);
    }
  }

  deathBurst(point, colorHex = 0x66ddff) {
    const c = _col.set(colorHex);
    for (let i = 0; i < 40; i++) {
      const d = this._sphere();
      const s = rand(4, 12);
      this.debris.emit(point.x, point.y + 0.6, point.z, d.x * s, d.y * s + rand(2, 6), d.z * s,
        c.r, c.g, c.b, rand(0.4, 0.9), rand(0.2, 0.5), 14, 2.5);
    }
    for (let i = 0; i < 24; i++) {
      const d = this._sphere();
      const s = rand(5, 14);
      this.sparks.emit(point.x, point.y + 0.6, point.z, d.x * s, d.y * s + rand(2, 8), d.z * s,
        c.r, c.g, c.b, rand(0.15, 0.4), rand(0.35, 0.7), 10, 4);
    }
    for (let i = 0; i < 10; i++) {
      const d = this._sphere();
      this.smoke.emit(point.x, point.y + 0.6, point.z, d.x * 1.5, d.y * 1.5 + 1, d.z * 1.5,
        0.4, 0.45, 0.5, rand(0.5, 1.0), rand(0.6, 1.2), -0.5, 1);
    }
    this.impactLight(point.clone().setY(point.y + 0.6), colorHex, 6, 0.12);
  }

  muzzleSmoke(point, dir) {
    // nudge the spawn forward of the muzzle so puffs don't fill the view
    const p = point.clone().addScaledVector(dir, 0.5);
    for (let i = 0; i < 3; i++) {
      const d = this._cone(dir, 0.4);
      this.smoke.emit(p.x, p.y, p.z, d.x * 2 + rand(-0.4, 0.4), d.y * 2 + 0.4, d.z * 2,
        0.5, 0.48, 0.46, rand(0.2, 0.4), rand(0.18, 0.32), -0.3, 2.5);
    }
    for (let i = 0; i < 5; i++) {
      const d = this._cone(dir, 0.5);
      this.sparks.emit(p.x, p.y, p.z, d.x * 7, d.y * 7, d.z * 7,
        1, 0.7, 0.3, rand(0.03, 0.09), rand(0.1, 0.2), 4, 7);
    }
  }

  brass(point, rightDir) {
    const d = rightDir.clone().multiplyScalar(rand(2, 4));
    d.y += rand(2, 4);
    this.debris.emit(point.x, point.y, point.z, d.x, d.y, d.z, 0.8, 0.6, 0.2, rand(0.5, 0.8), 0.12, 18, 1.5);
  }

  tracer(from, to, colorHex = 0xfff1c0) {
    const t = this.tracers[this._tracerCursor];
    this._tracerCursor = (this._tracerCursor + 1) % this.tracers.length;
    const m = t.mesh;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.001) return;
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.scale.set(0.035, 0.035, len);
    m.lookAt(to);
    m.material.color.setHex(colorHex);
    m.material.opacity = 1;
    m.visible = true;
    t.life = t.maxLife;
  }

  decal(point, normal) {
    const d = this.decals[this._decalCursor];
    this._decalCursor = (this._decalCursor + 1) % this.decals.length;
    const m = d.mesh;
    m.position.copy(point).addScaledVector(normal, 0.012);
    const up = Math.abs(normal.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    m.lookAt(point.clone().add(normal));
    m.rotateZ(rand(0, Math.PI * 2));
    const s = rand(0.18, 0.32);
    m.scale.set(s, s, s);
    m.material.opacity = 0.95;
    m.visible = true;
    d.life = d.maxLife;
  }

  impactLight(point, colorHex, power, life) {
    const f = this.flashLights[this._flashCursor];
    this._flashCursor = (this._flashCursor + 1) % this.flashLights.length;
    f.light.position.copy(point);
    f.light.color.setHex(colorHex);
    f.power = power;
    f.light.intensity = power;
    f.light.visible = true;
    f.life = life;
    f.maxLife = life;
  }

  muzzleFlash(point) { this.impactLight(point, 0xffd27f, 9, 0.05); }

  // --- per-frame update --------------------------------------------------

  update(realDt) {
    this.sparks.update(realDt);
    this.debris.update(realDt);
    this.smoke.update(realDt);

    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= realDt;
        t.mesh.material.opacity = clamp01(t.life / t.maxLife);
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    for (const d of this.decals) {
      if (d.life > 0) {
        d.life -= realDt;
        if (d.life < 1.5) d.mesh.material.opacity = clamp01(d.life / 1.5) * 0.95;
        if (d.life <= 0) d.mesh.visible = false;
      }
    }
    for (const f of this.flashLights) {
      if (f.life > 0) {
        f.life -= realDt;
        f.light.intensity = f.power * clamp01(f.life / f.maxLife);
        if (f.life <= 0) f.light.visible = false;
      }
    }

    // decay trauma + ease slow-mo back to normal (slow enough to be felt)
    this.trauma = clamp01(this.trauma - realDt * 1.6);
    this.slowmo = damp(this.slowmo, 1, 3.2, realDt);
    this.shakeTime += realDt;
  }

  // Sample current shake as camera-space offsets. Camera applies these on top
  // of the player's look so it never corrupts aim state.
  sampleShake() {
    // linear+quadratic blend: small traumas (per-shot, hits) stay visible while
    // big traumas (explosions, player damage) still dominate. Pure trauma²
    // made everything small vanish.
    const s = this.trauma * (0.4 + 0.6 * this.trauma);
    if (s <= 0.0002) return null;
    const t = this.shakeTime * 28;
    const n = (i) => Math.sin(t * (0.8 + i * 0.37) + this._seed[i]) * Math.sin(t * (0.21 + i * 0.13) + this._seed[i] * 1.7);
    return {
      x: n(0) * 0.25 * s,
      y: n(1) * 0.25 * s,
      pitch: n(2) * 0.09 * s,
      yaw: n(0) * 0.09 * s,
      roll: n(1) * 0.1 * s,
    };
  }

  // --- helpers -----------------------------------------------------------

  // These all return a shared scratch vector — read it (or pass it straight to
  // emit) before the next call. Used only synchronously inside emit loops.
  _sphere() {
    const u = rand(0, 1), v = rand(0, 1);
    const theta = u * Math.PI * 2, phi = Math.acos(2 * v - 1);
    return _scratch.set(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
  }
  _hemisphere(normal, spread = 1) {
    const v = this._sphere();
    if (v.dot(normal) < 0) v.multiplyScalar(-1);
    return v.lerp(normal, 1 - spread).normalize();
  }
  _cone(dir, spread = 0.5) {
    const v = this._sphere().multiplyScalar(spread);
    return v.add(dir).normalize();
  }
}
