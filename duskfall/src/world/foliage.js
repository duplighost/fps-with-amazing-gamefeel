// Instanced foliage: trees (trunk + organic canopy), rocks, bushes and grass.
// Scattered with a density that thins toward the arena centre and thickens into
// a forest ring at the edge. Trees and big rocks return cylinder colliders.

import * as THREE from 'three';
import { inPond, ENTRANCES, ENTRANCE_CARVE } from './layout.js';
import { clamp01 } from '../engine/math.js';

// deterministic RNG so the world is the same every load
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lumpySphere(radius, detail, jitter, rng) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const seed = rng() * 100;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // jitter by a hash of the corner's POSITION, not its index: polyhedron
    // geometries duplicate each corner once per face, and jittering the
    // copies independently tore the canopy into shards full of holes
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453;
    const st = 1 + ((h - Math.floor(h)) - 0.5) * jitter;
    v.multiplyScalar(st);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// no foliage in the pond, down the sinkhole craters, or inside the landmarks
const LM = [
  { x: 2.1, z: 29.9, r: 9 },     // the henge
  { x: 24, z: -6, r: 6.5 },      // the arch
  { x: -26, z: 6, r: 6 },        // the sleeper
  { x: 0, z: 0, r: 8.5 },        // the great tree
];
const blockedSpot = (x, z) => inPond(x, z, 1.5) ||
  ENTRANCES.some((e) => Math.hypot(x - e.x, z - e.z) < ENTRANCE_CARVE + 1) ||
  LM.some((l) => Math.hypot(x - l.x, z - l.z) < l.r);

export function buildFoliage(scene, terrain) {
  const rng = mulberry32(1337);
  const colliders = [];      // {x, z, r}
  const H = terrain.height, N = terrain.normal;
  const HALF = 150;
  const nrm = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  // --- trees ---
  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.42, 4.4, 6);
  trunkGeo.translate(0, 2.2, 0);
  const canopyGeo = lumpySphere(2.7, 1, 0.62, rng);
  canopyGeo.translate(0, 5.4, 0);
  const coreGeo = lumpySphere(2.05, 1, 0.4, rng);
  coreGeo.translate(0, 5.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3826, roughness: 0.95, flatShading: true });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x53702f, roughness: 0.85, flatShading: true });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x3a5121, roughness: 0.95, flatShading: true });

  const treeSpots = [];
  for (let i = 0; i < 1600; i++) {
    const x = (rng() * 2 - 1) * HALF, z = (rng() * 2 - 1) * HALF;
    const d = Math.hypot(x, z);
    if (d < 14 || blockedSpot(x, z)) continue;  // keep spawn/pond/sinkholes clear
    N(x, z, nrm);
    if (nrm.y < 0.72) continue;                 // not on steep slopes
    // density: sparse in the middle, dense in the ring 45..95
    const dens = clamp01((d - 22) / 30) * 0.9 + (d > 100 ? 0.4 : 0);
    if (rng() > dens) continue;
    treeSpots.push({ x, z });
    if (treeSpots.length >= 520) break;
  }
  const treeTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  const treeCanopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeSpots.length);
  const treeCores = new THREE.InstancedMesh(coreGeo, coreMat, treeSpots.length);
  treeTrunks.castShadow = treeCanopies.castShadow = true;
  treeTrunks.receiveShadow = treeCanopies.receiveShadow = true;
  treeSpots.forEach((s, i) => {
    const sc = 0.75 + rng() * 0.9;
    pos.set(s.x, H(s.x, s.z) - 0.2, s.z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scl.set(sc * (0.9 + rng() * 0.2), sc, sc * (0.9 + rng() * 0.2));
    m.compose(pos, q, scl);
    treeTrunks.setMatrixAt(i, m);
    treeCanopies.setMatrixAt(i, m);
    treeCores.setMatrixAt(i, m);
    colliders.push({ x: s.x, z: s.z, r: 0.55 * sc });
  });
  treeCores.castShadow = false; treeCores.receiveShadow = true;
  scene.add(treeTrunks, treeCanopies, treeCores);

  // --- rocks ---
  const rockGeo = lumpySphere(1, 0, 0.7, rng);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a655e, roughness: 1.0, flatShading: true });
  const rockSpots = [];
  for (let i = 0; i < 400; i++) {
    const x = (rng() * 2 - 1) * HALF, z = (rng() * 2 - 1) * HALF;
    const d = Math.hypot(x, z);
    if (d < 10 || blockedSpot(x, z)) continue;
    N(x, z, nrm);
    if (rng() > clamp01((d - 12) / 60) + 0.1) continue;
    rockSpots.push({ x, z, s: 0.4 + rng() * 2.2 });
    if (rockSpots.length >= 220) break;
  }
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
  rocks.castShadow = rocks.receiveShadow = true;
  rockSpots.forEach((s, i) => {
    pos.set(s.x, H(s.x, s.z) + s.s * 0.35 - 0.3, s.z);
    q.setFromAxisAngle(new THREE.Vector3(rng(), rng(), rng()).normalize(), rng() * Math.PI);
    scl.set(s.s * (0.8 + rng() * 0.6), s.s * (0.6 + rng() * 0.5), s.s * (0.8 + rng() * 0.6));
    m.compose(pos, q, scl);
    rocks.setMatrixAt(i, m);
    if (s.s > 1.1) colliders.push({ x: s.x, z: s.z, r: s.s * 0.7 });
  });
  scene.add(rocks);

  // --- bushes ---
  const bushGeo = lumpySphere(1, 1, 0.55, rng);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x47632a, roughness: 0.9, flatShading: true });
  const bushSpots = [];
  for (let i = 0; i < 600; i++) {
    const x = (rng() * 2 - 1) * HALF, z = (rng() * 2 - 1) * HALF;
    const d = Math.hypot(x, z);
    if (d < 12 || blockedSpot(x, z)) continue;
    N(x, z, nrm); if (nrm.y < 0.8) continue;
    if (rng() > clamp01((d - 16) / 50) + 0.05) continue;
    bushSpots.push({ x, z, s: 0.6 + rng() * 1.1 });
    if (bushSpots.length >= 340) break;
  }
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushSpots.length);
  bushes.castShadow = bushes.receiveShadow = true;
  bushSpots.forEach((s, i) => {
    pos.set(s.x, H(s.x, s.z) + s.s * 0.5 - 0.2, s.z);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    scl.set(s.s * 1.3, s.s * 0.8, s.s * 1.3);
    m.compose(pos, q, scl);
    bushes.setMatrixAt(i, m);
  });
  scene.add(bushes);

  // --- grass tufts (alpha-tested crossed blades) ---
  const grass = buildGrass(scene, terrain, rng);

  return {
    colliders, grass, solids: [treeTrunks, rocks],
    mats: { trunk: trunkMat, canopy: canopyMat, canopyCore: coreMat, rock: rockMat, bush: bushMat, grass: grass.material },
  };
}

function grassTexture() {
  const w = 64, h = 64;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let b = 0; b < 7; b++) {
    const x = 6 + Math.random() * (w - 12);
    const bw = 2 + Math.random() * 3;
    const g = 90 + Math.random() * 70;
    ctx.beginPath();
    ctx.moveTo(x - bw, h);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 16, h * 0.4, x + (Math.random() - 0.5) * 10, 4);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 16, h * 0.4, x + bw, h);
    ctx.fillStyle = `rgb(${(g * 0.55) | 0},${g | 0},${(g * 0.35) | 0})`;
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildGrass(scene, terrain, rng) {
  const tex = grassTexture();
  const blade = new THREE.PlaneGeometry(0.85, 0.5);
  blade.translate(0, 0.25, 0);
  const blade2 = blade.clone(); blade2.rotateY(Math.PI / 2);
  // merge the two crossed quads by hand into one geometry (no utils dep)
  const merged = mergeTwo(blade, blade2);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide,
    color: 0x6d8a3a, roughness: 1.0, metalness: 0,
  });
  // a gentle wind sway: blade tips lean on a slow travelling wave (per-tuft
  // phase from the instance's world position, so the field ripples)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float swayPh = instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.27;
        transformed.x += sin(uTime * 1.7 + swayPh) * 0.09 * smoothstep(0.02, 0.5, position.y);
        transformed.z += cos(uTime * 1.3 + swayPh * 1.4) * 0.06 * smoothstep(0.02, 0.5, position.y);
      #endif`
    );
    mat._shader = shader;
  };
  const COUNT = 4200;
  const mesh = new THREE.InstancedMesh(merged, mat, COUNT);
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < COUNT * 3 && n < COUNT; i++) {
    const x = (rng() * 2 - 1) * 70, z = (rng() * 2 - 1) * 70;
    const d = Math.hypot(x, z);
    if (d > 72 || blockedSpot(x, z)) continue;
    const nrm = terrain.normal(x, z);
    if (nrm.y < 0.82) continue;
    const s = 0.6 + rng() * 0.9;
    pos.set(x, terrain.height(x, z) - 0.05, z);
    q.setFromAxisAngle(up, rng() * Math.PI);
    scl.set(s, s * (0.8 + rng() * 0.6), s);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// merge two simple geometries (position/normal/uv) into one BufferGeometry
function mergeTwo(a, b) {
  const geo = new THREE.BufferGeometry();
  const merge = (name, size) => {
    const aa = a.attributes[name], ba = b.attributes[name];
    const arr = new Float32Array(aa.array.length + ba.array.length);
    arr.set(aa.array, 0); arr.set(ba.array, aa.array.length);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  };
  merge('position', 3); merge('normal', 3); merge('uv', 2);
  const ai = a.index.array, bi = b.index.array;
  const offset = a.attributes.position.count;
  const idx = new Uint16Array(ai.length + bi.length);
  idx.set(ai, 0);
  for (let i = 0; i < bi.length; i++) idx[ai.length + i] = bi[i] + offset;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}
