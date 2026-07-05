// The SKY LAYER. An irregular closed RING of elongated floating islands —
// chains of overlapping grass-topped earth chunks — undulating between heights,
// so there's a whole second level you can live on: run the loop, fight along
// it, drop off anywhere. Plus low stepping islands as on-ramps and the NOOK
// (loot-cage perch). Every disc is a one-way platform top (land from above,
// mantle onto its ledge) and everything tints with the seasons.

import * as THREE from 'three';
import { rand, clamp01, lerp } from '../engine/math.js';

// low on-ramps (heights RELATIVE to local ground): the nook + two steppers
const SPECS = [
  { a: 5.0, d: 13, y: 6.5, r: 3.0, nook: true },
  { a: 0.6, d: 16, y: 8.0, r: 3.6 },
  { a: 2.6, d: 18, y: 10.5, r: 3.2 },
];

// the ring: node count, radius band and ABSOLUTE height band (a coherent layer)
const RING_NODES = 7;
const RING_SPACING = 4.6;      // disc spacing along each edge (heavy overlap)

// season colour triples [summer, autumn, winter]
const GRASS = [0x5f7a34, 0x9c7a2c, 0xcfd8de];
const EARTH = [0x6a5334, 0x6a5334, 0x8792a0];
const _a = new THREE.Color(), _b = new THREE.Color(), _c = new THREE.Color();
function seasonCol(out, tri, season) {
  _a.setHex(tri[0]); _b.setHex(tri[1]); _c.setHex(tri[2]);
  if (season < 0.55) out.copy(_a).lerp(_b, clamp01(season / 0.55));
  else out.copy(_b).lerp(_c, clamp01((season - 0.55) / 0.45));
}

export function buildPlatforms(scene, terrain) {
  const grassMat = new THREE.MeshStandardMaterial({ color: GRASS[0], roughness: 0.9, metalness: 0, flatShading: true });
  const earthMat = new THREE.MeshStandardMaterial({ color: EARTH[0], roughness: 0.95, metalness: 0, flatShading: true });
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x59d4ff, emissiveIntensity: 2.6, roughness: 0.3, metalness: 0 });

  const solids = [];
  const colliders = [];   // {x,z,y,r} circular one-way tops for the controller
  let nookDesc = null;

  // one island disc: grass cap over a craggy tapering body. `decor` adds the
  // spikes/crystals/boulders (nodes + standalones only — chain discs stay lean).
  function addDisc(x, z, y, r, decor, nook) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const bodyH = decor ? 2.6 : 2.0, bodyTop = y - 0.4;
    const bodyGeo = new THREE.CylinderGeometry(r * 0.98, r * 0.42, bodyH, 8, 1);
    bodyGeo.translate(0, bodyTop - bodyH / 2, 0);
    _roughen(bodyGeo, 0.28);
    const body = new THREE.Mesh(bodyGeo, earthMat);
    body.castShadow = true; body.receiveShadow = true; g.add(body); solids.push(body);

    const capH = 0.7;
    const capGeo = new THREE.CylinderGeometry(r * 1.04, r * 0.99, capH, 9, 1);
    capGeo.translate(0, y - capH / 2, 0);
    const cap = new THREE.Mesh(capGeo, grassMat);
    cap.castShadow = true; cap.receiveShadow = true; g.add(cap); solids.push(cap);

    if (decor) {
      for (let i = 0; i < 2; i++) {
        const sr = r * rand(0.28, 0.48), sh = rand(2.2, 4.4);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(sr, sh, 6), earthMat);
        spike.rotation.x = Math.PI;
        spike.position.set(rand(-r * 0.4, r * 0.4), y - bodyH - sh / 2 + 0.4, rand(-r * 0.4, r * 0.4));
        spike.castShadow = true; g.add(spike);
      }
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.4, 0.62), 0), crystalMat);
      cr.position.set(rand(-r * 0.3, r * 0.3), y - bodyH - 1.0, rand(-r * 0.3, r * 0.3));
      cr.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      g.add(cr);
      for (let i = 0; i < 2; i++) {
        const ba = rand(0, Math.PI * 2), bd = rand(0, r * 0.7);
        const boul = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.3, 0.55), 0), earthMat);
        boul.position.set(Math.cos(ba) * bd, y + 0.15, Math.sin(ba) * bd);
        boul.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        boul.castShadow = true; g.add(boul);
      }
    }

    if (nook) {
      // the loot-cage: decorative glowing bars pickups funnel up into
      const cageR = 0.9, cageH = 2.0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, cageH, 5), crystalMat);
        bar.position.set(Math.cos(a) * cageR, y + 1.05, Math.sin(a) * cageR);
        g.add(bar);
      }
      const ring1 = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.05, 6, 16), crystalMat);
      ring1.rotation.x = Math.PI / 2; ring1.position.y = y + 0.08; g.add(ring1);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.05, 6, 16), crystalMat);
      ring2.rotation.x = Math.PI / 2; ring2.position.y = y + 2.05; g.add(ring2);
      nookDesc = { x, z, y, cageFloorY: y + 0.4, cageConfine: 0.75, catchR: 6.0, cap: 5 };
    }

    scene.add(g);
    colliders.push({ x, z, y, r: r * 0.98 });
  }

  // --- low on-ramps (relative to the local ground) ---
  for (const spec of SPECS) {
    const x = Math.cos(spec.a) * spec.d;
    const z = Math.sin(spec.a) * spec.d;
    addDisc(x, z, spec.y + Math.max(terrain.height(x, z), 0), spec.r, true, spec.nook);
  }

  // --- the RING: an irregular closed loop of stretched islands in the sky ---
  // Nodes at jittered angle/radius/height; each edge is a chain of overlapping
  // discs whose height eases between the nodes, so the whole loop undulates —
  // a closed shape, but nothing like a perfect circle.
  const nodes = [];
  for (let i = 0; i < RING_NODES; i++) {
    const a = (i / RING_NODES) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.3;
    const d = 26 + ((i * 53) % 17) * 0.55;                    // radius 26..35
    const y = 15.5 + Math.sin(i * 2.3) * 3.4;                 // height 12.1..18.9 (absolute)
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
      addDisc(x, z, y, r, s === 0, false);
    }
  }

  return {
    solids,
    platforms: colliders,
    nook: nookDesc,
    mats: { grass: grassMat, earth: earthMat, crystal: crystalMat },
    setSeason(season) {
      seasonCol(grassMat.color, GRASS, season);
      seasonCol(earthMat.color, EARTH, season);
      crystalMat.emissive.setHex(season > 0.5 ? 0x8fa0ff : 0x59d4ff);
    },
  };
}

// nudge each vertex outward a little for a hand-chiselled, non-cylindrical look
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
