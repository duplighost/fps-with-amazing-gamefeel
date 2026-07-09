// Weapons + viewmodels. The viewmodel is rendered in a separate overlay scene
// with its own camera (depth cleared) so the gun never clips through walls —
// a hallmark of a polished FPS. Firing is hitscan with spread "bloom" that
// grows while shooting/moving and recovers when you stop. Each shot drives
// recoil, FOV punch, screen shake, muzzle flash, a tracer, smoke and brass.

import * as THREE from 'three';
import { clamp, clamp01, damp, rand, randSign, lerp } from '../engine/math.js';

// No reloads (DOOM-style): each weapon draws from one ammo pool that only
// refills from enemy drops and dash finishers. `capacity` caps the pool, `start`
// is what you spawn with. `ads` is the sighted viewmodel position.
export const WEAPONS = {
  rifle: {
    kind: 'rifle', name: 'CARBINE', auto: true, damage: 26, headMult: 2.2,
    fireInterval: 0.092, capacity: 160, start: 96, drop: 20, finisher: 28,
    recoilPitch: 0.019, recoilYaw: 0.010, pellets: 1,
    spreadBase: 0.0026, spreadMove: 0.018, spreadBloom: 0.0052, spreadMax: 0.05,
    range: 280, fovPunch: 1.0, shake: 0.06, tracer: 0xffe08a, sound: 'gunshot',
    ads: new THREE.Vector3(-0.02, -0.22, -0.44),
  },
  shotgun: {
    kind: 'shotgun', name: 'SHOTGUN', auto: true, damage: 15, headMult: 1.7,
    fireInterval: 0.3, capacity: 56, start: 32, drop: 8, finisher: 10,
    recoilPitch: 0.05, recoilYaw: 0.024, pellets: 12,
    spreadBase: 0.05, spreadMove: 0.02, spreadBloom: 0.006, spreadMax: 0.11,
    range: 58, fovPunch: 4.2, shake: 0.3, tracer: 0xffcf8a, sound: 'shotgun',
    ads: new THREE.Vector3(-0.02, -0.23, -0.46),
  },
};

const ORDER = ['rifle', 'shotgun'];
const REST = new THREE.Vector3(0.26, -0.26, -0.62);

export class Weapons {
  constructor(ctx) {
    // ctx: { fx, audio, cam, mainCamera, hitscan(origin,dir,range), applyDamage }
    this.ctx = ctx;
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.viewScene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30301f, 0.9));
    const key = new THREE.DirectionalLight(0xffe6c0, 2.2); // warm golden-hour key
    key.position.set(-0.6, 1, 0.8);
    this.viewScene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.7); // cool sky rim
    rim.position.set(1, 0.4, -1);
    this.viewScene.add(rim);

    this.models = {};
    this.ammo = {};
    for (const id of ORDER) {
      const m = buildViewmodel(WEAPONS[id]);
      m.visible = false;
      this.viewScene.add(m);
      this.models[id] = m;
      this.ammo[id] = WEAPONS[id].start;   // single ammo pool per weapon, no reload
    }

    this.current = 'rifle';
    this.def = WEAPONS.rifle;
    this.model = this.models.rifle;
    this.model.visible = true;
    this.capacityMult = 1;   // raised by the "+max ammo" upgrade

    this.fireTimer = 0;
    this.switchTimer = 0;
    this.spread = this.def.spreadBase;
    this.aimT = 0;               // ADS blend, read from the camera each frame

    // animated viewmodel offsets
    this.pos = REST.clone();
    this.rot = new THREE.Vector3();
    this.kick = 0;           // recoil push-back amount
    this.kickRot = 0;
    this.sway = new THREE.Vector2();
    this.bobPhase = 0;
    this.raiseT = 0;         // 0 = lowered, 1 = up

    // muzzle flash sprite in view space
    this.muzzle = new THREE.Group();
    const flashTex = makeFlashTexture();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xffd27f, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.flashSprite.scale.set(0.5, 0.5, 0.5);
    this.flashSprite.material.opacity = 0;
    this.muzzle.add(this.flashSprite);
    this.viewScene.add(this.muzzle);
    this.flashLife = 0;

    this.onAmmoChange = null; // hud hook
    this._emitAmmo();
  }

  reset() {
    for (const id of ORDER) this.ammo[id] = WEAPONS[id].start;
    this.switchTo('rifle', true);
    this._emitAmmo();
  }

  switchTo(id, instant = false) {
    if (!WEAPONS[id] || (id === this.current && !instant)) return;
    this.model.visible = false;
    this.current = id;
    this.def = WEAPONS[id];
    this.model = this.models[id];
    this.model.visible = true;
    this.switchTimer = instant ? 0 : 0.32;
    this.raiseT = instant ? 1 : 0;
    this.fireTimer = Math.max(this.fireTimer, 0.12);
    this.ctx.audio.reloadIn();
    this._emitAmmo();
  }

  cycle(dir) {
    const i = ORDER.indexOf(this.current);
    const n = (i + (dir > 0 ? 1 : ORDER.length - 1)) % ORDER.length;
    this.switchTo(ORDER[n]);
  }

  update(dt, ctrl, input) {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.switchTimer = Math.max(0, this.switchTimer - dt);
    this.raiseT = damp(this.raiseT, 1, 12, dt);
    this.aimT = this.ctx.cam.aimT || 0;

    // input: switch weapons
    if (input.wasPressed('weapon1')) this.switchTo('rifle');
    if (input.wasPressed('weapon2')) this.switchTo('shotgun');
    const wheel = input.consumeWheel();
    if (wheel !== 0) this.cycle(wheel);

    // firing — no reload; draws straight from the ammo pool
    const wantFire = this.def.auto ? input.isDown('fire') : input.wasPressed('fire');
    if (wantFire && this.fireTimer <= 0 && this.switchTimer <= 0) {
      if (this.ammo[this.current] > 0) {
        this._fire(ctrl);
      } else if (input.wasPressed('fire')) {
        // empty: dry click, and hop to the other weapon if it still has rounds
        this.ctx.audio.dryFire();
        if (!this._autoSwitch()) this.fireTimer = 0.18;
      }
    }

    // spread = base + movement/air penalty (tightened while sighted), bloom decays
    const movePenalty = clamp01(ctrl.horizSpeed / 10) * this.def.spreadMove + (ctrl.onGround ? 0 : 0.025);
    const target = (this.def.spreadBase + movePenalty) * lerp(1, 0.28, this.aimT);
    this.spread = Math.max(target, damp(this.spread, target, 7, dt));

    this._animate(dt, ctrl);
    this._emitSpread();
  }

  // Switch to any other weapon that still has ammo. Returns true if it switched.
  _autoSwitch() {
    for (const id of ORDER) {
      if (id !== this.current && this.ammo[id] > 0) { this.switchTo(id); return true; }
    }
    return false;
  }

  // effective ammo cap for a weapon (raised by the +max-ammo upgrade)
  _cap(id) { return Math.round(WEAPONS[id].capacity * this.capacityMult); }

  // Raise every weapon's ammo capacity (upgrade). Also tops each pool up by the
  // gained headroom so the pick feels immediately rewarding.
  setCapacityMult(m) {
    const prev = this.capacityMult;
    this.capacityMult = m;
    if (m > prev) {
      for (const id of ORDER) {
        const gained = this._cap(id) - Math.round(WEAPONS[id].capacity * prev);
        this.ammo[id] = Math.min(this._cap(id), this.ammo[id] + Math.max(0, gained));
      }
    }
    this._emitAmmo();
  }

  // Pickup top-up for both weapons (mult scales the amount). Returns true if any
  // pool actually gained rounds (so a full player doesn't vacuum up a pickup).
  addAmmo(mult = 1) {
    let added = false;
    for (const id of ORDER) {
      const before = this.ammo[id];
      this.ammo[id] = Math.min(this._cap(id), before + Math.round(WEAPONS[id].drop * mult));
      if (this.ammo[id] > before) added = true;
    }
    this._emitAmmo();
    return added;
  }

  // A chunky guaranteed reward for a dash finisher (the aggressive "chainsaw" loop).
  grantFinisherAmmo() {
    for (const id of ORDER) this.ammo[id] = Math.min(this._cap(id), this.ammo[id] + WEAPONS[id].finisher);
    this._emitAmmo();
  }

  hasAnyAmmo() { return ORDER.some((id) => this.ammo[id] > 0); }

  _fire(ctrl) {
    const def = this.def;
    this.ammo[this.current]--;
    this.fireTimer = def.fireInterval;

    const cam = this.ctx.cam;
    const origin = this.ctx.mainCamera.getWorldPosition(new THREE.Vector3());
    const baseDir = cam.aimDirection();

    // world-space muzzle position for tracers / smoke
    const right = new THREE.Vector3().crossVectors(baseDir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, baseDir).normalize();
    const muzzleWorld = origin.clone()
      .addScaledVector(baseDir, 0.7)
      .addScaledVector(right, 0.16)
      .addScaledVector(up, -0.12);

    for (let p = 0; p < def.pellets; p++) {
      const dir = baseDir.clone();
      const s = this.spread;
      dir.x += rand(-s, s); dir.y += rand(-s, s); dir.z += rand(-s, s);
      dir.normalize();

      const hit = this.ctx.hitscan(origin, dir, def.range);
      const endPoint = hit ? hit.point : origin.clone().addScaledVector(dir, def.range);
      this.ctx.fx.tracer(muzzleWorld, endPoint, def.tracer);

      if (hit) {
        if (hit.enemy && hit.enemy.alive) {
          const isHead = hit.enemy.isHeadshot(hit.point);
          const dmg = def.damage * (isHead ? def.headMult : 1);
          this.ctx.applyDamage(hit.enemy, dmg, hit.point.clone(), dir.clone(), isHead);
        } else {
          this.ctx.fx.bulletImpact(hit.point, hit.normal || new THREE.Vector3(0, 1, 0));
        }
      }
    }

    // feedback
    this.spread = Math.min(this.spread + def.spreadBloom, def.spreadMax);
    cam.addRecoil(def.recoilPitch * (0.85 + Math.random() * 0.3), def.recoilYaw * randSign() * rand(0.4, 1));
    cam.addFovPunch(def.fovPunch);
    this.ctx.fx.addTrauma(def.shake);
    this.ctx.fx.muzzleFlash(muzzleWorld);
    this.ctx.fx.muzzleSmoke(muzzleWorld, baseDir);
    this.ctx.fx.brass(muzzleWorld, right);

    // viewmodel kick
    this.kick = Math.min(this.kick + 0.06 + def.fovPunch * 0.01, 0.16);
    this.kickRot = Math.min(this.kickRot + def.recoilPitch * 2.2, 0.5);

    // muzzle flash sprite (kept small so it reads as a pop, not a screen-wash)
    this.flashLife = 0.035;
    this.flashSprite.material.opacity = 0.5;
    this.flashSprite.material.rotation = rand(0, Math.PI * 2);
    const fscale = def.pellets > 1 ? 0.075 : 0.045;
    this.flashSprite.scale.setScalar(fscale * rand(0.85, 1.15));

    this.ctx.audio[def.sound]();
    this._emitAmmo();
  }

  _animate(dt, ctrl) {
    const def = this.def;
    // sway from look movement (gun lags the camera)
    const look = this.ctx.cam.lastLook;
    const swayTargetX = clamp(-look.yaw * 8, -0.06, 0.06);
    const swayTargetY = clamp(look.pitch * 8, -0.06, 0.06);
    this.sway.x = damp(this.sway.x, swayTargetX, 10, dt);
    this.sway.y = damp(this.sway.y, swayTargetY, 10, dt);

    // bob synced with movement (suppressed while sighted)
    const aimT = this.aimT;
    this.bobPhase += ctrl.horizSpeed * dt * 1.5;
    const bobAmt = clamp01(ctrl.horizSpeed / 10.5) * (ctrl.onGround ? 1 : 0.2) * (1 - aimT * 0.9);
    const bobX = Math.cos(this.bobPhase) * 0.012 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.016 * bobAmt;

    // recoil recovery
    this.kick = damp(this.kick, 0, 12, dt);
    this.kickRot = damp(this.kickRot, 0, 11, dt);

    // raise / lower on switch + a quick dip while dashing
    const lower = (1 - this.raiseT) * 0.5 + (ctrl.isDashing() ? 0.22 : 0);

    const target = REST.clone();
    target.x += this.sway.x + bobX;
    target.y += this.sway.y + bobY - lower;
    target.z += this.kick;
    // blend toward the sighted (ADS) pose
    target.lerp(def.ads, aimT);
    this.pos.lerp(target, 1 - Math.exp(-18 * dt));

    this.model.position.copy(this.pos);
    const rotScale = 1 - aimT * 0.7;   // steadier hold while sighted (recoil stays)
    this.model.rotation.set(
      this.kickRot + this.sway.y * 1.5 * rotScale,
      -this.sway.x * 2 * rotScale,
      (this.sway.x * 1.5 + (ctrl._sliding ? -0.12 : 0)) * rotScale,
      'YXZ'
    );

    // flash follows the muzzle tip of the model
    this.muzzle.position.set(this.pos.x + 0.02, this.pos.y + 0.02, this.pos.z - 0.85);
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashSprite.material.opacity = clamp01(this.flashLife / 0.05);
      if (this.flashLife <= 0) this.flashSprite.material.opacity = 0;
    }
  }

  syncCamera(fov, aspect) {
    this.viewCamera.fov = fov;
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  _emitAmmo() {
    if (this.onAmmoChange) {
      this.onAmmoChange({ name: this.def.name, ammo: this.ammo[this.current], capacity: this._cap(this.current), kind: this.def.kind });
    }
  }
  _emitSpread() {
    if (this.onSpread) this.onSpread(this.spread);
  }
}

// --- procedural viewmodel meshes -----------------------------------------

function buildViewmodel(def) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.85, roughness: 0.42 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.5, roughness: 0.6 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x2c2a26, metalness: 0.2, roughness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, metalness: 0.1, roughness: 0.7 });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const cyl = (r1, r2, len, mat, x, y, z) => add(new THREE.CylinderGeometry(r1, r2, len, 14), mat, x, y, z, Math.PI / 2, 0, 0);

  if (def.kind === 'shotgun') {
    box(0.09, 0.11, 0.62, metal, 0, 0, -0.18);            // receiver
    cyl(0.05, 0.05, 1.0, black, 0, 0.055, -0.55);          // barrel
    cyl(0.038, 0.038, 0.86, black, 0, -0.01, -0.5);        // magazine tube
    box(0.085, 0.09, 0.24, poly, 0, -0.02, -0.42);         // pump/forend
    box(0.09, 0.2, 0.16, wood, 0, -0.14, 0.14, 0.32, 0, 0); // grip
    box(0.08, 0.14, 0.28, wood, 0, 0.0, 0.32, -0.12, 0, 0); // stock
    box(0.02, 0.04, 0.03, black, 0, 0.12, -1.02);          // bead sight
  } else {
    // carbine
    box(0.075, 0.12, 0.7, metal, 0, 0, -0.16);             // receiver/upper
    box(0.07, 0.05, 0.34, metal, 0, 0.075, -0.16);         // top rail
    cyl(0.026, 0.026, 0.5, black, 0, 0.03, -0.62);         // barrel
    box(0.08, 0.11, 0.34, poly, 0, 0.0, -0.5);             // handguard
    box(0.09, 0.16, 0.14, poly, 0, -0.14, 0.08, 0.28, 0, 0); // grip
    box(0.06, 0.19, 0.11, black, 0, -0.16, -0.04);         // magazine
    box(0.09, 0.1, 0.28, poly, 0, 0.005, 0.32, -0.05, 0, 0); // stock body
    box(0.09, 0.14, 0.06, poly, 0, -0.03, 0.46);           // butt pad
    box(0.03, 0.06, 0.03, black, 0, 0.12, -0.32);          // front sight
    cyl(0.04, 0.045, 0.06, black, 0, 0.03, -0.9);          // muzzle device
  }
  g.scale.setScalar(1.05);
  return g;
}

function makeFlashTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,240,200,0.95)');
  g.addColorStop(0.5, 'rgba(255,180,90,0.5)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // star spikes
  ctx.translate(cx, cx);
  ctx.fillStyle = 'rgba(255,230,170,0.85)';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * 0.9, cx * 0.08);
    ctx.lineTo(cx * 0.9, -cx * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
