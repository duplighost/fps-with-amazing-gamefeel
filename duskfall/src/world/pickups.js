// Dropped pickups: glowing ammo clips and health crosses that enemies leave
// behind. They bob and spin, blooming against the dusk, magnetise toward a near
// player, and auto-collect on contact — the DOOM-style loop that rewards
// aggression (there is no reload and only a trickle of passive regen).

import * as THREE from 'three';
import { clamp01, rand } from '../engine/math.js';

const MAGNET_R = 3.6;    // starts pulling toward the player within this range
const COLLECT_R = 1.5;   // auto-collects within this range
const LIFETIME = 16;     // seconds before it fades away
const FADE = 2.5;        // fade window at the end of life

export class PickupManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.list = [];
    this.onCollect = null;   // (type) => {}
    this._assets = buildAssets();
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
    const proto = type === 'health' ? this._assets.health : this._assets.ammo;
    const group = proto.clone();
    // clone() shares materials; give each drop its own so fading is independent
    group.traverse((o) => { if (o.material) o.material = o.material.clone(); });
    const y = this.terrain.height(pos.x, pos.z);
    group.position.set(pos.x, y + 0.6, pos.z);
    this.scene.add(group);
    this.list.push({ type, group, life: LIFETIME, phase: rand(0, Math.PI * 2), collected: false });
  }

  update(dt, playerPos) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      const g = p.group;
      // bob + spin
      p.phase += dt * 2.4;
      g.rotation.y += dt * 1.8;
      // horizontal magnet toward the player, then collect on contact
      const dx = playerPos.x - g.position.x, dz = playerPos.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < MAGNET_R) {
        const pull = (1 - d / MAGNET_R) * 14 * dt;
        g.position.x += (dx / (d || 1)) * pull;
        g.position.z += (dz / (d || 1)) * pull;
      }
      const baseY = this.terrain.height(g.position.x, g.position.z) + 0.6;
      g.position.y = baseY + Math.sin(p.phase) * 0.12;
      if (d < COLLECT_R && !p.collected) {
        p.collected = true;
        if (this.onCollect) this.onCollect(p.type, g.position.clone());
        this._remove(p); this.list.splice(i, 1); continue;
      }
      // fade out at end of life
      if (p.life < FADE) {
        const o = clamp01(p.life / FADE);
        g.traverse((o2) => { if (o2.material) { o2.material.transparent = true; o2.material.opacity = o; } });
      }
      if (p.life <= 0) { this._remove(p); this.list.splice(i, 1); }
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

  return { ammo, health };
}
