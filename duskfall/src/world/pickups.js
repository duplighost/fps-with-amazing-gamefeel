// Dropped pickups: glowing ammo clips and health crosses that enemies leave
// behind. They bob and spin, blooming against the dusk, magnetise toward a near
// player, and auto-collect on contact — the DOOM-style loop that rewards
// aggression (there is no reload and only a trickle of passive regen).

import * as THREE from 'three';
import { clamp01, rand, damp } from '../engine/math.js';

const MAGNET_R = 4.6;    // starts pulling toward the player within this range
const MAGNET_PULL = 18;  // pull strength
const MAGNET_FLOOR = 0.28; // minimum pull fraction at the rim (so it always commits)
const MAGNET_DY = 2.2;   // vertical reach of the magnet (can't tug loot you're far above/below)
const COLLECT_R = 1.7;   // auto-collects within this horizontal range
const COLLECT_DY = 2.2;  // ...and within this vertical range (blocks grabbing caged loot from below)
const LIFETIME = 16;     // seconds before a ground pickup fades away
const STASH_LIFE = 30;   // caged pickups linger longer (you have to climb for them)
const FADE = 2.5;        // fade window at the end of life
// nook funnel tuning
const STACK_GAP = 0.32;      // vertical spacing of caged pickups
const GATHER_LAMBDA = 6;     // how fast a funneled drop slides to the cage axis
const RISE_LAMBDA = 5;       // how fast it then floats up into the cage

export class PickupManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.list = [];
    this.groundAt = null;    // layer-aware ground fn (set by main); falls back to terrain
    this.nook = null;        // { x, z, y, cageFloorY, cageConfine, catchR, cap }
    this.onCollect = null;   // (type) => {}
    this._assets = buildAssets();
  }

  setNook(n) { this.nook = n; }

  // funnel bookkeeping — derived from the live list so reset() needs no changes
  _risingCount() { let n = 0; for (const p of this.list) if (p.rising || p.caged) n++; return n; }
  _lowestFreeSlot() {
    const used = new Set();
    for (const p of this.list) if ((p.rising || p.caged) && p.slot >= 0) used.add(p.slot);
    for (let i = 0; i < this.nook.cap; i++) if (!used.has(i)) return i;
    return -1;
  }
  _repackSlots() {
    const f = this.list.filter((p) => p.rising || p.caged).sort((a, b) => a.slot - b.slot);
    for (let i = 0; i < f.length; i++) f[i].slot = i;
  }

  reset() {
    for (const p of this.list) this._remove(p);
    this.list = [];
  }

  _remove(p) {
    this.scene.remove(p.group);
    // materials were cloned per-instance (so fades are independent) — dispose them
    p.group.traverse((o) => { if (o.material) o.material.dispose(); });
  }

  spawn(type, pos) {
    const proto = this._assets[type] || this._assets.ammo;
    const group = proto.clone();
    // clone() shares materials; give each drop its own so fading is independent
    group.traverse((o) => { if (o.material) o.material = o.material.clone(); });
    const G = this.groundAt || ((x, z, y2) => this.terrain.height(x, z));
    const y = G(pos.x, pos.z, (pos.y || 0) + 0.6);
    group.position.set(pos.x, y + 0.6, pos.z);
    this.scene.add(group);
    // decide by GEOGRAPHY: a drop inside the nook's catch-column funnels up into
    // the cage (if there's a free slot); underground drops never funnel (they'd
    // thread through solid rock). Everything else is a normal ground drop.
    let rising = false, slot = -1;
    if (this.nook && y > -6 && this._risingCount() < this.nook.cap) {
      const ddx = pos.x - this.nook.x, ddz = pos.z - this.nook.z;
      if (ddx * ddx + ddz * ddz <= this.nook.catchR * this.nook.catchR) { rising = true; slot = this._lowestFreeSlot(); }
    }
    this.list.push({ type, group, life: rising ? STASH_LIFE : LIFETIME, phase: rand(0, Math.PI * 2), collected: false, rising, caged: false, slot });
  }

  update(dt, playerPos) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      const g = p.group;
      // bob + spin
      p.phase += dt * 2.4;
      g.rotation.y += dt * 1.8;

      if (p.rising || p.caged) {
        this._updateFunnel(p, dt);
      } else {
        // horizontal magnet toward the player, gated vertically so you can't tug
        // (or later vacuum) loot far above/below you
        const dx = playerPos.x - g.position.x, dz = playerPos.z - g.position.z;
        const d = Math.hypot(dx, dz);
        const dyM = Math.abs(playerPos.y - g.position.y);
        if (d < MAGNET_R && dyM < MAGNET_DY) {
          const pull = (MAGNET_FLOOR + (1 - MAGNET_FLOOR) * (1 - d / MAGNET_R)) * MAGNET_PULL * dt;
          g.position.x += (dx / (d || 1)) * pull;
          g.position.z += (dz / (d || 1)) * pull;
        }
        const G = this.groundAt || ((x, z, y2) => this.terrain.height(x, z));
        g.position.y = G(g.position.x, g.position.z, g.position.y + 0.4) + 0.6 + Math.sin(p.phase) * 0.12;
      }

      // unified 3D collect gate (horizontal AND vertical), never while still rising.
      // The vertical gate makes you climb onto the nook to grab caged loot, and
      // fixes the old horizontal-only collect that let you grab loot through a floor.
      const cdx = playerPos.x - g.position.x, cdz = playerPos.z - g.position.z;
      const cd = Math.hypot(cdx, cdz), cdy = Math.abs(playerPos.y - g.position.y);
      if (!p.collected && !(p.rising && !p.caged) && cd < COLLECT_R && cdy < COLLECT_DY) {
        p.collected = true;
        if (this.onCollect) this.onCollect(p.type, g.position.clone());
        const wasFunnel = p.rising || p.caged;
        this._remove(p); this.list.splice(i, 1);
        if (wasFunnel) this._repackSlots();
        continue;
      }

      // fade out at end of life
      if (p.life < FADE) {
        const o = clamp01(p.life / FADE);
        g.traverse((o2) => { if (o2.material) { o2.material.transparent = true; o2.material.opacity = o; } });
      }
      if (p.life <= 0) {
        const wasFunnel = p.rising || p.caged;
        this._remove(p); this.list.splice(i, 1);
        if (wasFunnel) this._repackSlots();
      }
    }
  }

  // A funneled drop: slide to the cage axis, get confined inside the bars, then
  // float up and stack at its slot height. It owns its own Y (bypasses the
  // terrain-lock), so it visibly threads up through the deck into the cage.
  _updateFunnel(p, dt) {
    const nk = this.nook, g = p.group;
    g.position.x = damp(g.position.x, nk.x, GATHER_LAMBDA, dt);
    g.position.z = damp(g.position.z, nk.z, GATHER_LAMBDA, dt);
    const ox = g.position.x - nk.x, oz = g.position.z - nk.z, or = Math.hypot(ox, oz);
    // keep RISEN/caged loot inside the bars, but don't hard-snap a still-gathering
    // drop — let GATHER_LAMBDA slide it smoothly to the axis first
    if ((p.caged || g.position.y > nk.y) && or > nk.cageConfine) {
      g.position.x = nk.x + ox / or * nk.cageConfine; g.position.z = nk.z + oz / or * nk.cageConfine;
    }
    // rise only once it has reached the axis (so it threads up, not through the rim)
    if (or < 0.6 || p.caged || g.position.y > nk.y) {
      const ty = nk.cageFloorY + p.slot * STACK_GAP;
      g.position.y = damp(g.position.y, ty + Math.sin(p.phase) * 0.06, RISE_LAMBDA, dt);
      if (!p.caged && g.position.y > nk.cageFloorY - 0.05) p.caged = true;
    }
  }
}

// Prototype meshes cloned per drop (bright MeshBasic accents bloom nicely).
function buildAssets() {
  // --- ammo clip: dark body + glowing amber cells ---
  const ammo = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.6 });
  const glowAmber = new THREE.MeshBasicMaterial({ color: 0xffb545 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.16), bodyMat);
  body.castShadow = true; ammo.add(body);
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.18), glowAmber);
  cell.position.y = 0.05; ammo.add(cell);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.2), glowAmber);
  tip.position.set(0.18, 0.16, 0); ammo.add(tip);
  ammo.scale.setScalar(1.15);

  // --- health cross: a glowing green plus ---
  const health = new THREE.Group();
  const glowGreen = new THREE.MeshBasicMaterial({ color: 0x63ff8a });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x0d3320, roughness: 0.6, emissive: 0x0a2a18, emissiveIntensity: 0.4 });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.16), shellMat);
  shell.castShadow = true; health.add(shell);
  const barV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.2), glowGreen);
  const barH = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), glowGreen);
  health.add(barV, barH);
  health.scale.setScalar(1.0);

  // --- grenade: a dark metallic body with a hot glowing band + top light ---
  const grenade = new THREE.Group();
  const gshell = new THREE.MeshStandardMaterial({ color: 0x2b3026, roughness: 0.5, metalness: 0.7 });
  const glowOrange = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  const gbody = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), gshell);
  gbody.castShadow = true; grenade.add(gbody);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 12), glowOrange);
  band.rotation.x = Math.PI / 2; grenade.add(band);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 6), gshell);
  cap.position.y = 0.22; grenade.add(cap);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), glowOrange);
  light.position.y = 0.3; grenade.add(light);
  grenade.scale.setScalar(1.1);

  return { ammo, health, grenade };
}
