// The SKY LAYER — the crown of the GREAT TREE. An irregular closed canopy-walk
// of wooden branch-pads rings the arena, carried on huge limbs that all reach
// back to the tree in the middle of the map (nothing floats unsupported).
// Four CROSS-BRANCHES cut through the crown, so you can travel across the
// circle instead of walking the loop, and low branch pads step you up from the
// ground. Every pad is a one-way platform top (land from above, mantle onto
// its ledge) and all the wood + leaves tint with the seasons.

import * as THREE from 'three';
import { rand, clamp, clamp01, lerp } from '../engine/math.js';

// low on-ramps (heights RELATIVE to local ground): branch pads off the trunk
const SPECS = [
  { a: 5.0, d: 13, y: 6.5, r: 3.0 },
  { a: 0.6, d: 16, y: 8.0, r: 3.6 },
  { a: 2.6, d: 18, y: 10.5, r: 3.2 },
];

// the ring: node count and disc spacing along each edge (heavy overlap)
const RING_NODES = 7;
const RING_SPACING = 4.6;
// ring nodes whose limbs are walkable CROSS-BRANCHES through the crown
const CHORD_NODES = [1, 2, 4, 6];
// the crown hub the cross-branches meet at (matches the tree's crown perch)
const HUB = { x: 0.3, z: 0.6, y: 16.4, r: 2.1 };

// season colour triples [summer, autumn, winter]
const BARK = [0x4b3826, 0x4b3826, 0x3b342e];
const PLANK = [0x84643e, 0x8a5c30, 0x6e675c];
const LEAF = [0x53702f, 0xc06a1e, 0x9ba2a4];
const _a = new THREE.Color(), _b = new THREE.Color(), _c = new THREE.Color();
function seasonCol(out, tri, season) {
  _a.setHex(tri[0]); _b.setHex(tri[1]); _c.setHex(tri[2]);
  if (season < 0.55) out.copy(_a).lerp(_b, clamp01(season / 0.55));
  else out.copy(_b).lerp(_c, clamp01((season - 0.55) / 0.45));
}

export function buildPlatforms(scene, terrain) {
  const barkMat = new THREE.MeshStandardMaterial({ color: BARK[0], roughness: 0.95, metalness: 0, flatShading: true });
  const plankMat = new THREE.MeshStandardMaterial({ color: PLANK[0], roughness: 0.9, metalness: 0, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: LEAF[0], roughness: 0.9, metalness: 0, flatShading: true });

  const solids = [];
  const colliders = [];   // {x,z,y,r} circular one-way tops for the controller
  const up = new THREE.Vector3(0, 1, 0);

  // one branch-pad: a plank top over a gnarled bark knot. `decor` adds leaf
  // tufts + a hanging vine (nodes only — chain pads stay lean).
  function addPad(x, z, y, r, decor) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const topGeo = new THREE.CylinderGeometry(r * 1.02, r * 0.9, 0.5, 9, 1);
    topGeo.translate(0, y - 0.25, 0);
    _roughen(topGeo, 0.1);
    const top = new THREE.Mesh(topGeo, plankMat);
    top.castShadow = true; top.receiveShadow = true; g.add(top); solids.push(top);

    const knotH = decor ? 1.4 : 1.0;
    const knotGeo = new THREE.CylinderGeometry(r * 0.82, r * 0.3, knotH, 8, 1);
    knotGeo.translate(0, y - 0.5 - knotH / 2, 0);
    _roughen(knotGeo, 0.24);
    const knot = new THREE.Mesh(knotGeo, barkMat);
    knot.castShadow = true; knot.receiveShadow = true; g.add(knot); solids.push(knot);

    if (decor) {
      for (let i = 0; i < 2; i++) {
        const ta = rand(0, Math.PI * 2), td = r * rand(0.55, 0.85);
        const tuft = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.8, 1.3), 0), leafMat);
        tuft.position.set(Math.cos(ta) * td, y + rand(0.25, 0.6), Math.sin(ta) * td);
        tuft.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        tuft.castShadow = true; g.add(tuft);
      }
      // a vine trailing off the underside, tipped with leaves
      const vl = rand(1.6, 3.2);
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, vl, 4), barkMat);
      const va = rand(0, Math.PI * 2), vd = r * rand(0.4, 0.75);
      vine.position.set(Math.cos(va) * vd, y - 0.6 - vl / 2, Math.sin(va) * vd);
      g.add(vine);
      const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), leafMat);
      tip.position.set(Math.cos(va) * vd, y - 0.6 - vl, Math.sin(va) * vd);
      g.add(tip);
    }

    scene.add(g);
    colliders.push({ x, z, y, r: r * 0.98 });
  }

  // a limb: a tapered bough from a point in the tree's crown out to a pad
  function addLimb(ox, oy, oz, tx, ty, tz, r0, r1) {
    const from = new THREE.Vector3(ox, oy, oz), to = new THREE.Vector3(tx, ty, tz);
    const dir = to.clone().sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len, 7, Math.max(2, (len / 7) | 0));
    _roughen(geo, 0.09);
    const limb = new THREE.Mesh(geo, barkMat);
    limb.position.copy(from).addScaledVector(dir, 0.5);
    limb.quaternion.setFromUnitVectors(up, dir.normalize());
    limb.castShadow = true; limb.receiveShadow = true;
    scene.add(limb); solids.push(limb);
  }

  // --- low on-ramps: branch pads on their own boughs off the trunk ---
  for (const spec of SPECS) {
    const x = Math.cos(spec.a) * spec.d;
    const z = Math.sin(spec.a) * spec.d;
    const y = spec.y + Math.max(terrain.height(x, z), 0);
    addPad(x, z, y, spec.r, true);
    addLimb(rand(-0.6, 0.6), y + rand(0.8, 1.8), rand(-0.6, 0.6), x, y - 0.7, z, 0.75, 0.35);
  }

  // --- the RING: an irregular closed canopy-walk in the sky ---
  // Nodes at jittered angle/radius/height; each edge is a chain of overlapping
  // pads whose height eases between the nodes, so the whole loop undulates —
  // a closed shape, but nothing like a perfect circle.
  const nodes = [];
  for (let i = 0; i < RING_NODES; i++) {
    const a = (i / RING_NODES) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.3;
    const d = 26 + ((i * 53) % 17) * 0.55;                    // radius 26..35
    const y = 17 + Math.sin(i * 2.3) * 3.4;                   // height 13.6..20.4 (absolute)
    nodes.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y });
  }
  for (let i = 0; i < RING_NODES; i++) {
    const A = nodes[i], B = nodes[(i + 1) % RING_NODES];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const steps = Math.max(2, Math.ceil(len / RING_SPACING));
    for (let s = 0; s < steps; s++) {                          // B is the next edge's s=0
      const t = s / steps, tt = t * t * (3 - 2 * t);
      const x = lerp(A.x, B.x, t), z = lerp(A.z, B.z, t);
      const y = lerp(A.y, B.y, tt);
      const r = (s === 0 ? 3.8 : 2.9) + Math.sin((i * 7 + s) * 3.1) * 0.35;
      addPad(x, z, y, r, s === 0);
    }
  }

  // --- every node hangs off the great tree by a limb; four of those limbs
  // are wide CROSS-BRANCHES you can WALK, chained with pads from the crown
  // hub out to their node — cut across the circle instead of running the loop
  for (let i = 0; i < RING_NODES; i++) {
    const n = nodes[i];
    const chord = CHORD_NODES.includes(i);
    const oy = clamp(n.y + rand(0.5, 2.0), 13.5, 18.5);
    addLimb(rand(-1, 1), oy, rand(-1, 1), n.x, n.y - 0.8, n.z, chord ? 1.25 : 0.95, chord ? 0.62 : 0.45);
    if (!chord) continue;
    const L = Math.hypot(n.x - HUB.x, n.z - HUB.z);
    const steps = Math.ceil((L - 5) / 4.2);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1), tt = t * t * (3 - 2 * t);
      const x = lerp(n.x, HUB.x, t), z = lerp(n.z, HUB.z, t);
      const y = lerp(n.y, HUB.y, tt);
      addPad(x, z, y, 2.2 + Math.sin((i * 5 + s) * 2.7) * 0.25, s % 3 === 0);
    }
  }

  return {
    solids,
    platforms: colliders,
    nook: null,   // the loot cage lives on the great tree's deck now
    mats: { bark: barkMat, plank: plankMat, leaf: leafMat },
    setSeason(season) {
      seasonCol(barkMat.color, BARK, season);
      seasonCol(plankMat.color, PLANK, season);
      seasonCol(leafMat.color, LEAF, season);
    },
  };
}

// nudge each vertex outward a little for a hand-carved, non-cylindrical look
function _roughen(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr > 0.01) {
      const k = 1 + (rand(-amt, amt));
      p.setX(i, x * k); p.setZ(i, z * k);
    }
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}
