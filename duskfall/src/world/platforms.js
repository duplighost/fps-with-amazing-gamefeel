// Floating sky-islands. Chunks of the meadow torn loose and hovering, matching
// the low-poly faceted look of the ground and foliage. Each island gives a solid
// circular TOP you can land on — wired into the controller as a one-way platform
// (you pass up through it, land on it coming down) — over a craggy torn-earth
// underside lit by a glowing crystal, so the levitation reads as haunted, not
// arbitrary. They tint through the seasons like the terrain (green → autumn →
// snow-capped) so the verticality always looks native to the environment.

import * as THREE from 'three';
import { rand, clamp01, lerp } from '../engine/math.js';

// Hand-placed for good traversal: a rough ring of stepping-stones at climbable
// heights (the air game clears ~20m easily), none over the spawn point.
//   a = angle, d = distance from centre, y = TOP surface height, r = radius
const SPECS = [
  { a: 0.35, d: 15, y: 7.5,  r: 4.6 },
  { a: 1.15, d: 26, y: 12.5, r: 4.2 },
  { a: 2.05, d: 19, y: 16.5, r: 3.6 },
  { a: 3.05, d: 31, y: 9.5,  r: 5.2 },
  { a: 3.95, d: 22, y: 18.5, r: 3.9 },
  { a: 4.75, d: 34, y: 13.5, r: 4.7 },
  { a: 5.55, d: 17, y: 20.5, r: 3.4 },
  // the NOOK: the lowest + smallest island (easy first hop, exposed shooting
  // perch) with a central loot-cage that funneled pickups rise into
  { a: 5.0, d: 13, y: 6.5, r: 3.0, nook: true },
];

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
  let nookDesc = null;    // the loot-cage descriptor (set when the nook is built)

  for (const spec of SPECS) {
    const x = Math.cos(spec.a) * spec.d;
    const z = Math.sin(spec.a) * spec.d;
    const r = spec.r, y = spec.y;
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    // rock body: a faceted chunk tapering downward. Its TOP sits ~0.4 BELOW the
    // grass-cap top (tucked up inside the cap, which is a touch wider) so the two
    // top faces are never coplanar — that coplanarity was the z-fighting flicker.
    const bodyH = 2.6, bodyTop = y - 0.4;
    const bodyGeo = new THREE.CylinderGeometry(r * 0.98, r * 0.46, bodyH, 9, 1);
    bodyGeo.translate(0, bodyTop - bodyH / 2, 0);
    _roughen(bodyGeo, 0.28);
    const body = new THREE.Mesh(bodyGeo, earthMat);
    body.castShadow = true; body.receiveShadow = true; g.add(body); solids.push(body);

    // grass cap: the flat landing surface, top face exactly at y (the collision top)
    const capH = 0.7;
    const capGeo = new THREE.CylinderGeometry(r * 1.04, r * 0.99, capH, 10, 1);
    capGeo.translate(0, y - capH / 2, 0);
    const cap = new THREE.Mesh(capGeo, grassMat);
    cap.castShadow = true; cap.receiveShadow = true; g.add(cap); solids.push(cap);

    // torn-earth underside: a few downward rock spikes of varying length
    const nSpikes = 2 + (spec.d % 2);
    for (let i = 0; i < nSpikes; i++) {
      const sr = r * rand(0.28, 0.5), sh = rand(2.2, 4.6);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(sr, sh, 6), earthMat);
      spike.rotation.x = Math.PI;                       // apex points down
      spike.position.set(rand(-r * 0.4, r * 0.4), y - bodyH - sh / 2 + 0.4, rand(-r * 0.4, r * 0.4));
      spike.castShadow = true; g.add(spike);
    }

    // a glowing crystal cluster hung underneath (bloom accent + the "why it floats")
    const cluster = new THREE.Group();
    cluster.position.set(0, y - bodyH - 1.0, 0);
    for (let i = 0; i < 3; i++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.35, 0.62), 0), crystalMat);
      cr.position.set(rand(-r * 0.3, r * 0.3), rand(-0.5, 0.4), rand(-r * 0.3, r * 0.3));
      cr.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      cluster.add(cr);
    }
    g.add(cluster);

    // scatter a couple of boulders + grass tufts on top so it reads as real ground
    for (let i = 0; i < 3; i++) {
      const ba = rand(0, Math.PI * 2), bd = rand(0, r * 0.72);
      const boul = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.3, 0.6), 0), earthMat);
      boul.position.set(Math.cos(ba) * bd, y + 0.15, Math.sin(ba) * bd);
      boul.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      boul.castShadow = true; g.add(boul);
    }

    // the nook's central loot-cage: purely decorative (never in solids/colliders,
    // so you can shoot down through it), made of the glowing crystal so it blooms
    // and season-tints for free. Funneled pickups rise up inside and stack.
    if (spec.nook) {
      const cageR = 0.9, cageH = 2.0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, cageH, 5), crystalMat);
        bar.position.set(Math.cos(a) * cageR, y + 1.0 + 0.05, Math.sin(a) * cageR);
        g.add(bar);
      }
      const baseRing = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.05, 6, 16), crystalMat);
      baseRing.rotation.x = Math.PI / 2; baseRing.position.y = y + 0.08; g.add(baseRing);
      const topRing = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.05, 6, 16), crystalMat);
      topRing.rotation.x = Math.PI / 2; topRing.position.y = y + 2.05; g.add(topRing);
      nookDesc = { x, z, y, cageFloorY: y + 0.4, cageConfine: 0.75, catchR: 6.0, cap: 5 };
    }

    scene.add(g);
    colliders.push({ x, z, y, r: r * 0.98 });
  }

  return {
    solids,
    platforms: colliders,             // consumed by the controller for landing
    nook: nookDesc,                   // the loot-cage funnel descriptor (or null)
    mats: { grass: grassMat, earth: earthMat, crystal: crystalMat },
    setSeason(season) {
      seasonCol(grassMat.color, GRASS, season);
      seasonCol(earthMat.color, EARTH, season);
      // crystals cool from ice-blue toward a colder violet as the haunt deepens
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
