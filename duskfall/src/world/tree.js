// THE GREAT TREE — a giant oak over the middle of the map, built into a
// treehouse: spiral branch steps climb to a plank deck holding the loot cage
// (the nook funnel), and the canopy crown is a high perch. It gives the center
// of the arena a landmark you can see from anywhere, a vertical route that
// works with the jump/dash kit, and a home for the cage.
//
// The trunk collider is Y-GATED (yMin) so the cavern that runs directly
// beneath the center of the map stays completely open underground.

import * as THREE from 'three';
import { rand } from '../engine/math.js';

const CANOPY = [0x53702f, 0xc06a1e, 0x9ba2a4];    // summer/autumn/winter (matches foliage)
const CANOPY_CORE = [0x3a5121, 0x8a4b16, 0x767c7e]; // darker inner canopy (fills gaps)
const TRUNK = [0x4b3826, 0x4b3826, 0x3b342e];
const WOOD = [0x6d5136, 0x6d5136, 0x585047];

const _a = new THREE.Color(), _b = new THREE.Color(), _c = new THREE.Color();
function seasonCol(out, tri, season) {
  _a.setHex(tri[0]); _b.setHex(tri[1]); _c.setHex(tri[2]);
  if (season < 0.55) out.copy(_a).lerp(_b, Math.min(1, season / 0.55));
  else out.copy(_b).lerp(_c, Math.min(1, (season - 0.55) / 0.45));
}

export function buildTreeHouse(scene, terrain) {
  const g = new THREE.Group();
  const solids = [], colliders = [], tops = [];
  const h0 = terrain.height(0, 0);

  const barkMat = new THREE.MeshStandardMaterial({ color: TRUNK[0], roughness: 0.95, metalness: 0, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD[0], roughness: 0.9, metalness: 0, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: CANOPY[0], roughness: 0.9, metalness: 0, flatShading: true });
  const coreMat = new THREE.MeshStandardMaterial({ color: CANOPY_CORE[0], roughness: 0.95, metalness: 0, flatShading: true });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0xffb54a, emissiveIntensity: 2.4, roughness: 0.3 });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x59d4ff, emissiveIntensity: 2.6, roughness: 0.3 });

  const add = (mesh, solid = true) => {
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh); if (solid) solids.push(mesh);
    return mesh;
  };

  // --- trunk + root flares (tall — the whole sky ring hangs off this tree)
  const trunkH = 25;
  const trunkGeo = new THREE.CylinderGeometry(1.05, 2.6, trunkH, 9, 5);
  _gnarl(trunkGeo, 0.22);
  add(new THREE.Mesh(trunkGeo, barkMat)).position.set(0, h0 - 1.2 + trunkH / 2, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.4, 5), barkMat);
    _gnarl(root.geometry, 0.14);
    root.position.set(Math.cos(a) * 2.6, h0 + 0.4, Math.sin(a) * 2.6);
    root.rotation.z = 0.9 * Math.cos(a); root.rotation.x = -0.9 * Math.sin(a);
    add(root);
  }
  colliders.push({ x: 0, z: 0, r: 2.3, yMin: -6.2 });   // below the surface (-4.8), above the cavern ceiling (-7.5)

  // --- spiral branch steps up to the deck (each an easy jump from the last)
  const STEPS = [
    { a: 0.3, rel: 3.4 }, { a: 1.9, rel: 6.4 }, { a: 3.5, rel: 9.4 },
  ];
  for (const st of STEPS) {
    const y = h0 + st.rel;
    const dx = Math.cos(st.a), dz = Math.sin(st.a);
    // the arm out from the trunk
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 3.6, 6), barkMat);
    arm.position.set(dx * 2.6, y - 0.4, dz * 2.6);
    arm.rotation.z = -Math.PI / 2 * dx * 0.9; arm.rotation.x = Math.PI / 2 * dz * 0.9;
    arm.rotation.y = -st.a;
    add(arm);
    // the stand-able pad at its tip
    const padGeo = new THREE.CylinderGeometry(1.9, 1.45, 0.4, 8);
    _gnarl(padGeo, 0.08);
    const pad = add(new THREE.Mesh(padGeo, woodMat));
    pad.position.set(dx * 4.1, y, dz * 4.1);
    tops.push({ x: dx * 4.1, z: dz * 4.1, y: y + 0.2, r: 1.85 });
  }

  // --- the deck: an octagonal plank platform wrapped around the trunk
  const deckY = h0 + 12.6;
  const deckGeo = new THREE.CylinderGeometry(4.6, 4.1, 0.55, 8);
  _gnarl(deckGeo, 0.06);
  add(new THREE.Mesh(deckGeo, woodMat)).position.set(0, deckY, 0);
  tops.push({ x: 0, z: 0, y: deckY + 0.28, r: 4.5 });
  // rail posts + two glowing lanterns so the treehouse reads at dusk
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.39;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), woodMat);
    post.position.set(Math.cos(a) * 4.25, deckY + 0.8, Math.sin(a) * 4.25);
    add(post, false);
    if (i % 4 === 0) {
      const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), lampMat);
      lamp.position.set(Math.cos(a) * 4.25, deckY + 1.5, Math.sin(a) * 4.25);
      g.add(lamp);
    }
  }

  // --- the loot cage lives up here now (same glowing-bar look as before)
  const cageX = 2.55, cageZ = 0.6, cageR = 0.9;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 5), cageMat);
    bar.position.set(cageX + Math.cos(a) * cageR, deckY + 1.3, cageZ + Math.sin(a) * cageR);
    g.add(bar);
  }
  for (const ry of [0.33, 2.3]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.05, 6, 16), cageMat);
    ring.rotation.x = Math.PI / 2; ring.position.set(cageX, deckY + ry, cageZ);
    g.add(ring);
  }
  const nook = { x: cageX, z: cageZ, y: deckY + 0.28, cageFloorY: deckY + 0.68, cageConfine: 0.75, catchR: 6.0, cap: 5 };

  // --- canopy: overlapping blobs over a dark core (no see-through gaps)
  // blob bottoms stay ABOVE deck head-height, so the treehouse deck keeps a
  // clear view out from under its own leaves
  const BLOBS = [
    [0, 19.8, 0, 4.6], [3.1, 18.6, 1.2, 3.4], [-2.9, 18.9, -1.6, 3.2],
    [1.1, 19.1, -3.0, 3.0], [-1.4, 18.4, 2.9, 3.1], [0.3, 21.4, 0.6, 3.0],
    [0.4, 23.4, 0.2, 3.6], [-2.0, 22.2, 1.6, 2.9], [2.3, 22.6, -1.1, 2.7],
  ];
  for (const [bx, by, bz, br] of BLOBS) {
    const geo = new THREE.IcosahedronGeometry(br, 1);
    _gnarl(geo, br * 0.16);
    add(new THREE.Mesh(geo, leafMat)).position.set(bx, h0 + by, bz);
  }
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.9, 1), coreMat);
  core.position.set(0, h0 + 20.4, 0);
  add(core, false);
  // the crown perch — jump + air-dash up from the deck
  tops.push({ x: 0.3, z: 0.6, y: h0 + 21.2, r: 2.1 });

  scene.add(g);

  return {
    solids, colliders, tops, nook,
    setSeason(season, haunt) {
      seasonCol(leafMat.color, CANOPY, season);
      seasonCol(coreMat.color, CANOPY_CORE, season);
      seasonCol(barkMat.color, TRUNK, season);
      seasonCol(woodMat.color, WOOD, season);
      if (haunt > 0) { leafMat.color.multiplyScalar(1 - haunt * 0.25); coreMat.color.multiplyScalar(1 - haunt * 0.25); }
    },
  };
}

// lumpy organic vertex noise. Displacement comes from a hash of the corner's
// POSITION so shared corners (which polyhedron geometries duplicate per face)
// all move together — the mesh stays watertight instead of tearing into shards.
function _gnarl(geo, amt) {
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
