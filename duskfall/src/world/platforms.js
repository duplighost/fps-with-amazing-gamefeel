// The SKY LAYER — a CANOPY VILLAGE strung through the crown of the great tree.
// A handful of big, obviously-walkable plank DECKS (railed, so you can stand
// and shoot up there without stumbling off) ringed around the tree at canopy
// height, joined to each other and back to the tree by rope-and-plank BRIDGES.
// Every deck is carried on a limb from the trunk and braced by a support post
// to the ground, so nothing floats — it reads as a place people built.
//
// Readability, by construction:
//   • decks are large flat plank platforms with a rim + railing → "stand here"
//   • bridges are plank slats between two rope lines → "walk across here"
//   • railings have DOORWAYS only where a bridge meets the deck
// Decks + bridge planks are one-way tops (jump up onto them, land from above);
// the railings only stop a grounded walk-off, never a jump.

import * as THREE from 'three';
import { rand, clamp01, lerp } from '../engine/math.js';

// low approach steps from the ground up to the ring (relative to local ground)
const STEPS = [
  { a: 5.0, d: 13, y: 6.5, r: 2.6 },
  { a: 0.6, d: 16, y: 9.0, r: 2.8 },
  { a: 2.6, d: 18, y: 11.5, r: 2.8 },
];

// the crown hub at the top of the tree (matches tree.js crown perch) — bridges
// spoke back to it so you can cross the middle instead of walking the whole loop
const HUB = { x: 0.3, z: 0.6, y: 16.4, r: 2.1 };

// season colour triples [summer, autumn, winter]
const BARK = [0x4b3826, 0x4b3826, 0x3b342e];
const PLANK = [0x8a6a42, 0x8a5c30, 0x726b60];
const ROPE = [0x6b5a3c, 0x6b5a3c, 0x565049];
const LEAF = [0x53702f, 0xc06a1e, 0x9ba2a4];
const _a = new THREE.Color(), _b = new THREE.Color(), _c = new THREE.Color();
function seasonCol(out, tri, season) {
  _a.setHex(tri[0]); _b.setHex(tri[1]); _c.setHex(tri[2]);
  if (season < 0.55) out.copy(_a).lerp(_b, clamp01(season / 0.55));
  else out.copy(_b).lerp(_c, clamp01((season - 0.55) / 0.45));
}

export function buildPlatforms(scene, terrain) {
  const barkMat = new THREE.MeshStandardMaterial({ color: BARK[0], roughness: 0.95, metalness: 0, flatShading: true });
  const plankMat = new THREE.MeshStandardMaterial({ color: PLANK[0], roughness: 0.85, metalness: 0, flatShading: true });
  const rimMat = new THREE.MeshStandardMaterial({ color: BARK[0], roughness: 0.9, metalness: 0, flatShading: true });
  const ropeMat = new THREE.MeshStandardMaterial({ color: ROPE[0], roughness: 1.0, metalness: 0, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: LEAF[0], roughness: 0.9, metalness: 0, flatShading: true });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0xffb54a, emissiveIntensity: 2.4, roughness: 0.3 });

  const solids = [];
  const colliders = [];   // {x,z,y,r,rail?} one-way tops (rail = walk-off guard)
  const up = new THREE.Vector3(0, 1, 0);

  const mesh = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    scene.add(m); solids.push(m);
    return m;
  };

  // a bough from a point in the crown out to (or down to) a target
  function addLimb(from, to, r0, r1) {
    const dir = to.clone().sub(from); const len = dir.length();
    if (len < 0.2) return;
    const geo = new THREE.CylinderGeometry(r1, r0, len, 6);
    const limb = mesh(geo, barkMat);
    limb.position.copy(from).addScaledVector(dir, 0.5);
    limb.quaternion.setFromUnitVectors(up, dir.normalize());
  }

  // --- a DECK: a big flat plank platform with a bark rim + railing. `gaps` are
  // angles (toward bridges) where the railing opens into a doorway.
  function addDeck(x, z, y, r, gaps) {
    // plank floor
    const floor = mesh(new THREE.CylinderGeometry(r, r * 0.96, 0.5, 12), plankMat);
    floor.position.set(x, y - 0.25, z);
    // plank seams (a couple of raised boards so the top reads as decking)
    for (let i = 0; i < 3; i++) {
      const seam = mesh(new THREE.BoxGeometry(r * 1.7, 0.08, 0.16), plankMat, false);
      seam.position.set(x, y + 0.02, z + (i - 1) * r * 0.5);
    }
    // a thick bark rim around the edge (visual "this is the edge")
    const rim = mesh(new THREE.TorusGeometry(r, 0.22, 5, 20), rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.set(x, y + 0.14, z);
    // railing: posts + a top rail, skipping the bridge doorways
    const posts = 12;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      if (gaps.some((gp) => angDist(a, gp) < 0.55)) continue;   // doorway
      const post = mesh(new THREE.BoxGeometry(0.14, 0.95, 0.14), rimMat, false);
      post.position.set(x + Math.cos(a) * (r - 0.2), y + 0.45, z + Math.sin(a) * (r - 0.2));
      if (i % 3 === 0) {
        const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), lampMat);
        lamp.position.set(x + Math.cos(a) * (r - 0.2), y + 1.05, z + Math.sin(a) * (r - 0.2));
        scene.add(lamp);
      }
    }
    // a top rail ring (thin torus at hand height), with gaps faked by leaving it
    // whole — the posts read the doorways; the ring is just a guide line
    const railRing = mesh(new THREE.TorusGeometry(r - 0.2, 0.05, 4, 24), ropeMat, false);
    railRing.rotation.x = Math.PI / 2; railRing.position.set(x, y + 0.85, z);
    // leaf clusters hang BELOW the rim, never on the deck floor — the play
    // surface stays clear so nothing blocks your view or your aim up here
    for (let i = 0; i < 3; i++) {
      const ta = (i / 3) * Math.PI * 2 + rand(-0.4, 0.4);
      const tuft = mesh(new THREE.IcosahedronGeometry(rand(0.9, 1.4), 0), leafMat);
      tuft.position.set(x + Math.cos(ta) * (r + 0.1), y - rand(0.6, 1.4), z + Math.sin(ta) * (r + 0.1));
    }
    colliders.push({ x, z, y: y + 0.25, r: r * 0.98, rail: gaps });
    return { x, z, y };
  }

  // --- a BRIDGE: plank slats laid between two rope catenaries from A to B.
  // Lays a line of overlapping one-way tops so you can walk across.
  function addBridge(A, B) {
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const n = Math.max(3, Math.round(len / 1.6));
    const nx = dx / len, nz = dz / len;               // along
    const px = -nz, pz = nx;                          // across (rope offset)
    const sag = Math.min(1.6, len * 0.06);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cx = lerp(A.x, B.x, t), cz = lerp(A.z, B.z, t);
      const dip = Math.sin(t * Math.PI) * sag;
      const cy = lerp(A.y, B.y, t) - dip;
      // plank slat
      const slat = mesh(new THREE.BoxGeometry(1.9, 0.14, 0.42), plankMat, false);
      slat.position.set(cx, cy - 0.08, cz);
      slat.rotation.y = Math.atan2(nz, nx);
      if (i < n) colliders.push({ x: lerp(A.x, B.x, (i + 0.5) / n), z: lerp(A.z, B.z, (i + 0.5) / n),
        y: lerp(A.y, B.y, (i + 0.5) / n) - Math.sin((i + 0.5) / n * Math.PI) * sag, r: 1.5 });
    }
    // the two rope handlines (thin sagging tubes) on either side
    for (const s of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const y0 = lerp(A.y, B.y, t0) - Math.sin(t0 * Math.PI) * sag + 0.75;
        const y1 = lerp(A.y, B.y, t1) - Math.sin(t1 * Math.PI) * sag + 0.75;
        const p0 = new THREE.Vector3(lerp(A.x, B.x, t0) + px * s, y0, lerp(A.z, B.z, t0) + pz * s);
        const p1 = new THREE.Vector3(lerp(A.x, B.x, t1) + px * s, y1, lerp(A.z, B.z, t1) + pz * s);
        const seg = p1.clone().sub(p0); const sl = seg.length();
        const rope = mesh(new THREE.CylinderGeometry(0.045, 0.045, sl, 4), ropeMat, false);
        rope.position.copy(p0).addScaledVector(seg, 0.5);
        rope.quaternion.setFromUnitVectors(up, seg.normalize());
      }
    }
    // slat colliders were added inside the loop above (skip the last so it stops
    // inside deck B); walkable line is complete.
  }

  const angDist = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d; return d; };

  // --- low approach steps (own little pads on boughs off the trunk) ---
  for (const st of STEPS) {
    const x = Math.cos(st.a) * st.d, z = Math.sin(st.a) * st.d;
    const y = st.y + Math.max(terrain.height(x, z), 0);
    const floor = mesh(new THREE.CylinderGeometry(st.r, st.r * 0.82, 0.45, 9), plankMat);
    floor.position.set(x, y - 0.22, z);
    const rim = mesh(new THREE.TorusGeometry(st.r, 0.18, 5, 16), rimMat, false);
    rim.rotation.x = Math.PI / 2; rim.position.set(x, y + 0.12, z);
    colliders.push({ x, z, y: y + 0.2, r: st.r * 0.98 });
    addLimb(new THREE.Vector3(rand(-0.6, 0.6), y + rand(0.6, 1.6), rand(-0.6, 0.6)),
      new THREE.Vector3(x, y - 0.6, z), 0.6, 0.3);
  }

  // --- the RING of decks: irregular angles / radii / heights (not a circle) ---
  const NODES = 5;
  const decks = [];
  for (let i = 0; i < NODES; i++) {
    const a = (i / NODES) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.42;
    const d = 25 + ((i * 53) % 13) * 0.9;                    // radius 25..35.8
    const y = 15.5 + Math.sin(i * 2.3 + 1) * 2.6;            // height 12.9..18.1
    const r = 4.2 + ((i * 37) % 7) * 0.28;                  // radius 4.2..6.0
    decks.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y, r, gaps: [] });
  }
  // edges: the ring loop (i -> i+1), plus 3 spokes back to the crown hub
  const edges = [];
  for (let i = 0; i < NODES; i++) edges.push([decks[i], decks[(i + 1) % NODES]]);
  for (const i of [0, 2, 3]) edges.push([decks[i], HUB]);
  // record doorway angles on each deck (toward every edge it touches)
  for (const [A, B] of edges) {
    A.gaps.push(Math.atan2(B.z - A.z, B.x - A.x));
    if (B.gaps) B.gaps.push(Math.atan2(A.z - B.z, A.x - B.x));
  }
  // build decks, then the limbs holding them, then support posts, then bridges
  for (const dk of decks) {
    addDeck(dk.x, dk.z, dk.y, dk.r, dk.gaps);
    // a big limb from up in the trunk out to the deck (visible support)
    addLimb(new THREE.Vector3(rand(-1, 1), lerp(dk.y, 15, 0.4) + rand(1, 3), rand(-1, 1)),
      new THREE.Vector3(dk.x, dk.y - 0.7, dk.z), 1.15, 0.5);
    // a support post down to the ground, so the deck reads as braced, not floaty
    const gy = terrain.height(dk.x, dk.z);
    const post = mesh(new THREE.CylinderGeometry(0.5, 0.85, dk.y - gy - 0.5, 7), barkMat);
    post.position.set(dk.x, gy + (dk.y - gy - 0.5) / 2, dk.z);
  }
  for (const [A, B] of edges) addBridge(A, B);

  return {
    solids,
    platforms: colliders,
    nook: null,   // the loot cage lives on the great tree's deck now
    mats: { bark: barkMat, plank: plankMat, rope: ropeMat, leaf: leafMat },
    setSeason(season) {
      seasonCol(barkMat.color, BARK, season);
      seasonCol(plankMat.color, PLANK, season);
      seasonCol(rimMat.color, BARK, season);
      seasonCol(ropeMat.color, ROPE, season);
      seasonCol(leafMat.color, LEAF, season);
    },
  };
}
