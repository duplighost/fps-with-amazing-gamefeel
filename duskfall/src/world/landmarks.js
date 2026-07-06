// Arena landmarks — big stone furniture that plays with the mechanics:
// LOS-breaking cover you can orbit fights around, tops you can mantle onto and
// hold, and hard obstacles a charging juggernaut can be baited into. All
// flat-shaded stone that matches the meadow's look.
//   THE HENGE   — a ring of standing stones with two fallen lintels (mantle-able)
//   THE ARCH    — a rock arch: dash under it, fight on top of it
//   THE SLEEPER — a half-buried fallen monolith forming a natural ramp

import * as THREE from 'three';
import { rand } from '../engine/math.js';

export const LANDMARK_SPOTS = [
  { x: 2.1, z: 29.9, r: 9 },    // henge
  { x: 24, z: -6, r: 6.5 },     // arch
  { x: -26, z: 6, r: 6 },       // sleeper
];

export function buildLandmarks(scene, terrain) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x6d7268, roughness: 0.95, metalness: 0.04, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4c5049, roughness: 0.95, metalness: 0.04, flatShading: true });
  const rune = new THREE.MeshStandardMaterial({ color: 0x0c0f0c, emissive: 0x7dff9a, emissiveIntensity: 1.5, roughness: 0.4, flatShading: true });

  const solids = [], colliders = [], tops = [];
  const H = terrain.height;

  const slab = (w, h, d, x, y, z, ry = 0, rz = 0, mat = stone) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    _chip(geo, 0.06);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); solids.push(m);
    return m;
  };

  // --- THE HENGE: 7 standing stones, 2 carrying fallen lintels you can stand on
  {
    const cx = 2.1, cz = 29.9, R = 6.5;
    const stoneTop = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const gy = H(x, z);
      const h = 4.2 + Math.sin(i * 3.7) * 0.9;
      slab(1.5, h, 1.0, x, gy + h / 2, z, a + 1.57, Math.sin(i * 5.1) * 0.05, i % 3 === 0 ? dark : stone);
      if (i === 2 || i === 5) {   // rune-marked stones glow faintly
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.18, h * 0.55, 0.14), rune);
        seam.position.set(x + Math.cos(a) * -0.5, gy + h * 0.55, z + Math.sin(a) * -0.5);
        seam.rotation.y = a + 1.57;
        scene.add(seam);
      }
      colliders.push({ x, z, r: 1.05 });
      stoneTop.push({ x, z, top: gy + h, a });
    }
    // two lintels bridging neighbouring stones — one-way platform tops
    for (const [i, j] of [[0, 1], [3, 4]]) {
      const A = stoneTop[i], B = stoneTop[j];
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      const my = Math.max(A.top, B.top) + 0.3;
      const len = Math.hypot(B.x - A.x, B.z - A.z) + 1.6;
      slab(len, 0.6, 1.3, mx, my, mz, Math.atan2(B.x - A.x, B.z - A.z) + 1.57, 0, dark);
      tops.push({ x: mx, z: mz, y: my + 0.3, r: len * 0.42 });
    }
    // a low altar block at the centre (cover + a hop-up)
    const ay = H(cx, cz);
    slab(2.4, 1.3, 1.6, cx, ay + 0.65, cz, 0.5, 0, dark);
    tops.push({ x: cx, z: cz, y: ay + 1.3, r: 1.3 });
    colliders.push({ x: cx, z: cz, r: 1.4 });
  }

  // --- THE ARCH: two pillars + a walkable lintel; dash under, fight on top
  {
    const x = 24, z1 = -9.2, z2 = -2.8;
    const g1 = H(x, z1), g2 = H(x, z2);
    const topY = Math.max(g1, g2) + 6.2;
    for (const [z, gy] of [[z1, g1], [z2, g2]]) {
      const geo = new THREE.CylinderGeometry(1.35, 1.7, topY - gy, 7);
      _chip(geo, 0.14);
      const pil = new THREE.Mesh(geo, stone);
      pil.position.set(x, gy + (topY - gy) / 2, z);
      pil.castShadow = true; pil.receiveShadow = true;
      scene.add(pil); solids.push(pil);
      colliders.push({ x, z, r: 1.5 });
    }
    slab(2.6, 0.8, (z2 - z1) + 3.4, x, topY + 0.4, (z1 + z2) / 2, 0, 0.03, stone);
    tops.push({ x, z: (z1 + z2) / 2, y: topY + 0.8, r: 1.8 });
    tops.push({ x, z: z1 + 1.2, y: topY + 0.8, r: 1.5 });
    tops.push({ x, z: z2 - 1.2, y: topY + 0.8, r: 1.5 });
  }

  // --- THE SLEEPER: a huge fallen monolith, half-buried — a natural ramp/perch.
  // No side colliders: the platform step-up grace walks you right up its spine.
  {
    const x = -26, z = 6;
    const gy = H(x, z);
    slab(9.5, 1.1, 2.6, x, gy + 1.1, z, 0.7, 0.16, stone);
    const my = gy + 1.1;
    tops.push({ x: x - 2.8, z: z - 2.2, y: my + 0.15, r: 1.9 });
    tops.push({ x, z, y: my + 0.62, r: 1.9 });
    tops.push({ x: x + 2.8, z: z + 2.2, y: my + 1.1, r: 1.9 });
    // a couple of shattered chunks around it
    for (let i = 0; i < 3; i++) {
      const bx = x + rand(-4, 4), bz = z + rand(-4, 4);
      const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.5, 0.9), 0), dark);
      chunk.position.set(bx, H(bx, bz) + 0.3, bz);
      chunk.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      chunk.castShadow = true;
      scene.add(chunk); solids.push(chunk);
    }
  }

  return { solids, colliders, tops };
}

// bevel-ish vertex noise so the slabs read as worked stone, not boxes.
// Position-hashed so duplicated corners move together (no torn seams).
function _chip(geo, amt) {
  const p = geo.attributes.position;
  const seed = rand(0, 100);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = (k) => {
      const t = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed + k * 51.7) * 43758.5453;
      return (t - Math.floor(t)) - 0.5;
    };
    p.setXYZ(i, x + h(1) * 2 * amt, y + h(2) * 2 * amt, z + h(3) * 2 * amt);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}
