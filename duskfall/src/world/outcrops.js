// Natural traversal — weathered boulders and rock shelves scattered in loose
// routes across the meadow. They look like ordinary geology (mossy flat-shaded
// rock, tilted and clustered, matching the foliage rocks), but their heights and
// spacing are tuned so a jump + air-dash chains you from one to the next: you
// can bound across the field, rock to rock, or use them to vault up to the
// canopy village. Each rock is a one-way TOP you can stand on and a side
// COLLIDER you can't walk through — so they read and play as real cover.

import * as THREE from 'three';
import { rand, clamp01 } from '../engine/math.js';
import { inPond, ENTRANCES, ENTRANCE_CARVE } from './layout.js';

const ROCK = [0x6a655e, 0x6a655e, 0x8f949a];   // summer/autumn/winter (matches foliage rock)
const MOSS = [0x5f7a34, 0x8a7130, 0xc7d0d6];   // the mossy/snowy cap
const _a = new THREE.Color(), _b = new THREE.Color(), _c = new THREE.Color();
function seasonCol(out, tri, s) {
  _a.setHex(tri[0]); _b.setHex(tri[1]); _c.setHex(tri[2]);
  if (s < 0.55) out.copy(_a).lerp(_b, clamp01(s / 0.55));
  else out.copy(_b).lerp(_c, clamp01((s - 0.55) / 0.45));
}

// keep-out: pond, sinkholes, the great tree, the henge/arch/sleeper landmarks
const KEEPOUT = [
  { x: 0, z: 0, r: 12 },
  { x: 2.1, z: 29.9, r: 10 }, { x: 24, z: -6, r: 8 }, { x: -26, z: 6, r: 8 },
];
const blocked = (x, z) =>
  inPond(x, z, 3) ||
  ENTRANCES.some((e) => Math.hypot(x - e.x, z - e.z) < ENTRANCE_CARVE + 3) ||
  KEEPOUT.some((k) => Math.hypot(x - k.x, z - k.z) < k.r);

export function buildOutcrops(scene, terrain) {
  const rockMat = new THREE.MeshStandardMaterial({ color: ROCK[0], roughness: 1.0, metalness: 0, flatShading: true });
  const capMat = new THREE.MeshStandardMaterial({ color: MOSS[0], roughness: 0.95, metalness: 0, flatShading: true });
  const H = terrain.height;
  const solids = [], colliders = [], tops = [];

  // one boulder: a squashed lumpy rock with a flat, stand-able shelf whose top
  // sits EXACTLY at topY (so you don't stand sunk into the rock). `rTop` is the
  // walkable radius. Tall boulders get a side collider that BLOCKS at body height
  // but is y-gated OFF once you're within the platform grace of the top — so you
  // can't walk through them, yet standing on top never shoves you off the edge.
  const GRACE = 1.7;   // must match the controller's PLATFORM_GRACE
  function boulder(x, z, topRel, rTop) {
    const gy = H(x, z);
    const topY = gy + topRel;
    const bodyH = topRel + 1.4;              // sink the base below ground
    const FLAT = 0.3;                        // local-y where the shelf flattens
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position, v = new THREE.Vector3();
    const seed = rand(0, 100);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      // position-hashed lump so shared corners move together (watertight)
      const hsh = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453;
      const k = 1 + ((hsh - Math.floor(hsh)) - 0.5) * 0.5;
      v.multiplyScalar(k);
      if (v.y > FLAT) v.y = FLAT;            // hard-flatten into a level shelf
      p.setXYZ(i, v.x * rTop * 1.24, v.y * bodyH, v.z * rTop * 1.24);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rockMat);
    // the shelf (local y = FLAT*bodyH) maps to exactly topY
    m.position.set(x, topY - FLAT * bodyH, z);
    m.rotation.y = rand(0, Math.PI * 2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); solids.push(m);
    // a mossy/snowy cap disc flush on the shelf
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 0.92, rTop * 1.0, 0.2, 8), capMat);
    cap.position.set(x, topY + 0.01, z); cap.rotation.y = rand(0, 3);
    cap.receiveShadow = true; scene.add(cap); solids.push(cap);
    // side collider ONLY for boulders too tall to just step onto (short ones you
    // walk up via the one-way top). y-gated below the top so it never ejects you
    // while you're standing up there.
    if (topRel > GRACE) colliders.push({ x, z, r: rTop * 0.95, yMax: topY - GRACE });
    tops.push({ x, z, y: topY, r: rTop });
    return { x, z, y: topY, r: rTop };
  }

  // a loose scatter of small rubble around a route, purely for looks
  function rubble(cx, cz, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), d = rand(1.5, 5);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (blocked(x, z)) continue;
      const s = rand(0.3, 0.8);
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
      r.position.set(x, H(x, z) + s * 0.4, z);
      r.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      r.castShadow = true; scene.add(r); solids.push(r);
    }
  }

  // ROUTES: hand-placed chains that ASCEND, so a jump + air-dash carries you
  // rock-to-rock across the field and up toward the sky. Each entry is a start
  // point, a heading, and a list of [stepDist, topHeight, topRadius] hops.
  const ROUTES = [
    // a long low causeway sweeping across the west, climbing gently
    { x: -44, z: -30, ang: 0.5, hops: [[0, 1.4, 2.6], [6, 2.1, 2.3], [6.5, 2.9, 2.1], [7, 3.8, 2.0], [7.5, 4.9, 2.2], [8, 6.2, 2.4]] },
    // a stair of shelves climbing the east toward the canopy ring
    { x: 40, z: 18, ang: 2.5, hops: [[0, 1.6, 2.8], [6.5, 3.0, 2.4], [7, 4.6, 2.2], [7.5, 6.6, 2.1], [8, 9.0, 2.3]] },
    // a scatter of big steppers across the south you can bound over
    { x: -6, z: 44, ang: 3.5, hops: [[0, 1.8, 3.0], [7, 2.6, 2.5], [7.5, 1.9, 2.6], [8, 3.2, 2.3], [8, 2.4, 2.7]] },
    // a short high pinnacle cluster near the north-east — a sniper's perch
    { x: 33, z: -34, ang: 4.2, hops: [[0, 2.2, 3.2], [5.5, 4.4, 2.4], [5.5, 7.0, 2.0], [5, 9.4, 1.8]] },
  ];

  for (const rt of ROUTES) {
    let x = rt.x, z = rt.z;
    const dx = Math.cos(rt.ang), dz = Math.sin(rt.ang);
    let first = true;
    for (const [step, topRel, rTop] of rt.hops) {
      x += dx * step + rand(-1.2, 1.2);
      z += dz * step + rand(-1.2, 1.2);
      if (blocked(x, z)) continue;
      boulder(x, z, topRel, rTop);
      if (first || Math.random() < 0.5) rubble(x, z, 3);
      first = false;
    }
  }

  // a handful of lone large boulders elsewhere so cover doesn't cluster only on
  // the routes — natural, and each is still a vault-up if you want the height
  const LONE = [[18, 40], [-38, 12], [8, -40], [-20, -38], [44, -8]];
  for (const [x, z] of LONE) {
    if (blocked(x, z)) continue;
    boulder(x + rand(-2, 2), z + rand(-2, 2), rand(1.8, 3.2), rand(2.6, 3.4));
    rubble(x, z, 4);
  }

  return {
    solids, colliders, tops,
    setSeason(s) { seasonCol(rockMat.color, ROCK, s); seasonCol(capMat.color, MOSS, s); },
  };
}
