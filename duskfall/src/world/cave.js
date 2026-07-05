// The underground: renders the cavern + tunnels defined in layout.js. The
// floor and ceiling meshes pinch together at the region edge (sealing the cave)
// and glowing crystal clusters + a few point lights make it read as a cold,
// living hollow instead of a black void.

import * as THREE from 'three';
import { rand, clamp01 } from '../engine/math.js';
import { caveSDF, caveFloorY, caveCeilY, CAVERN_R, ENTRANCES, ENTRANCE_CARVE } from './layout.js';
import { terrainHeight } from './terrain.js';

const EXTENT = 52, RES = 110;

function buildSheet(scene, sampleY, isCeil) {
  const geo = new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2, RES, RES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const rock = new THREE.Color(0x3a3f4b), rock2 = new THREE.Color(0x262b36), cold = new THREE.Color(0x4b5a74);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const sdf = caveSDF(x, z);
    // outside the region both sheets collapse to the ceiling (buried, invisible)
    const y = sdf >= 0.4 ? caveCeilY(x, z) : sampleY(x, z);
    pos.setY(i, y);
    const depth = clamp01(-sdf / 8);
    col.copy(rock).lerp(rock2, ((x * 13.37 + z * 7.77) % 1 + 1) % 1 * 0.5).lerp(cold, depth * 0.4);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: true,
    side: isCeil ? THREE.BackSide : THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = !isCeil;
  scene.add(mesh);
  return mesh;
}

export function buildCave(scene) {
  const floor = buildSheet(scene, caveFloorY, false);
  const ceil = buildSheet(scene, caveCeilY, true);

  const group = new THREE.Group();
  scene.add(group);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x2e3340, roughness: 0.9, flatShading: true });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c14, emissive: 0x66d9ff, emissiveIntensity: 2.4, roughness: 0.35, flatShading: true,
  });
  const emberMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c14, emissive: 0xff9a4a, emissiveIntensity: 2.0, roughness: 0.4, flatShading: true,
  });

  // stalagmites + stalactites scattered through the cavern (deterministic-ish)
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + Math.sin(i * 7.3) * 0.5;
    const r = 4 + ((i * 37) % 13);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (caveSDF(x, z) > -2.5) continue;
    const fy = caveFloorY(x, z), cy = caveCeilY(x, z);
    const up = i % 2 === 0;
    const h = 0.8 + ((i * 17) % 10) * 0.22;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28 + (i % 3) * 0.14, h, 6), rockMat);
    cone.position.set(x, up ? fy + h / 2 : cy - h / 2, z);
    if (!up) cone.rotation.x = Math.PI;
    cone.castShadow = false;
    group.add(cone);
  }
  // glowing crystal clusters — the cave's light sources (visually)
  const clusterAt = (x, z, mat, n = 3) => {
    const fy = caveFloorY(x, z);
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.32 + (k % 3) * 0.2, 0), mat);
      c.position.set(x + Math.sin(k * 2.4) * 1.1, fy + 0.35 + k * 0.16, z + Math.cos(k * 1.9) * 1.1);
      c.rotation.set(k * 1.3, k * 0.7, k * 2.1);
      group.add(c);
    }
  };
  const spots = [[6, 4], [-8, 6], [3, -9], [-5, -6], [11, -2], [-12, -1], [0, 12], [14, 6], [-4, 13], [8, -13]];
  spots.forEach(([x, z], i) => clusterAt(x, z, i % 3 === 2 ? emberMat : crystalMat, 3 + (i % 2)));

  const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.85, flatShading: true });
  // candles + bones strung along each tunnel — a lit path that leads somewhere
  for (const e of ENTRANCES) {
    const nx = e.x / 40, nz = e.z / 40;
    const ax = nx * (CAVERN_R - 2), az = nz * (CAVERN_R - 2);   // tunnel start (cavern side)
    clusterAt(nx * (CAVERN_R + 4), nz * (CAVERN_R + 4), emberMat, 3);   // mouth marker
    for (const t of [0.3, 0.55, 0.8]) {
      const px = ax + (e.x - ax) * t, pz = az + (e.z - az) * t;
      const side = (t * 10) % 2 < 1 ? 1 : -1;
      const cx = px - nz * side * 2.2, cz = pz + nx * side * 2.2;   // hug the wall
      const fy = caveFloorY(cx, cz);
      // "candles": a stumpy rock with small ember flames on top
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 6), rockMat);
      stump.position.set(cx, fy + 0.25, cz); group.add(stump);
      for (let k = 0; k < 3; k++) {
        const fl = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 + (k % 2) * 0.04, 0), emberMat);
        fl.position.set(cx + Math.sin(k * 2.6) * 0.16, fy + 0.58 + (k % 2) * 0.09, cz + Math.cos(k * 2.2) * 0.16);
        group.add(fl);
      }
      // bone piles across the path from the candles
      const bx = px + nz * side * 1.8, bz = pz - nx * side * 1.8;
      const bfy = caveFloorY(bx, bz);
      for (let k = 0; k < 4; k++) {
        const bone = new THREE.Mesh(
          k % 2 ? new THREE.CylinderGeometry(0.05, 0.05, rand(0.5, 0.9), 5) : new THREE.IcosahedronGeometry(rand(0.1, 0.18), 0),
          boneMat);
        bone.position.set(bx + rand(-0.5, 0.5), bfy + 0.1 + k * 0.03, bz + rand(-0.5, 0.5));
        bone.rotation.set(rand(0, 3), rand(0, 3), Math.PI / 2 + rand(-0.5, 0.5));
        group.add(bone);
      }
    }
  }

  // real lights: a bright cavern heart + tunnel-mouth ambers (kept cheap)
  const lights = [];
  const mk = (x, z, color, intensity, dist, y = null) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.8);
    l.position.set(x, y !== null ? y : caveFloorY(x, z) + 2.6, z);
    l.userData.base = intensity;
    scene.add(l); lights.push(l);
  };
  mk(0, 0, 0x7fd0ec, 95, 52);
  mk(9, -6, 0x66d9ff, 40, 28);
  mk(-9, 7, 0xff9a4a, 36, 28);
  mk(0, 13, 0x66d9ff, 30, 24);
  // a warm glow up each shaft so the way in/out reads from both sides
  for (const e of ENTRANCES) mk(e.x, e.z, 0xffb050, 42, 22, -8);

  // surface beacons: a broken ring of ember stones around each crater rim
  for (const e of ENTRANCES) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + e.a;
      const rx = e.x + Math.cos(a) * (ENTRANCE_CARVE - 0.5), rz = e.z + Math.sin(a) * (ENTRANCE_CARVE - 0.5);
      const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.3 + (i % 3) * 0.12, 0), emberMat);
      st.position.set(rx, terrainHeight(rx, rz) + 0.28, rz);
      st.rotation.set(i, i * 2.1, 0);
      group.add(st);
    }
  }

  return {
    solids: [floor, ceil],
    // lights swell as the player descends (they're mostly wasted on the surface)
    setUnderground(u) {
      for (const l of lights) l.intensity = l.userData.base * (0.2 + 0.8 * u);
    },
  };
}
