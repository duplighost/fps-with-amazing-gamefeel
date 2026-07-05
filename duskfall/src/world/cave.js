// The underground: renders the cavern + tunnels defined in layout.js. The
// floor and ceiling meshes pinch together at the region edge (sealing the cave)
// and glowing crystal clusters + a few point lights make it read as a cold,
// living hollow instead of a black void.

import * as THREE from 'three';
import { rand, clamp01 } from '../engine/math.js';
import { caveSDF, caveFloorY, caveCeilY, CAVERN_R, ENTRANCES } from './layout.js';

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
  const spots = [[6, 4], [-8, 6], [3, -9], [-5, -6], [11, -2], [-12, -1], [0, 12]];
  spots.forEach(([x, z], i) => clusterAt(x, z, i % 3 === 2 ? emberMat : crystalMat, 3 + (i % 2)));
  for (const e of ENTRANCES) {
    // a marker cluster at each tunnel mouth so you can find your way out
    const nx = e.x / 40, nz = e.z / 40;
    clusterAt(nx * (CAVERN_R + 5), nz * (CAVERN_R + 5), emberMat, 2);
  }

  // a few real lights so the cavern isn't flat black (kept cheap)
  const lights = [];
  const mk = (x, z, color, intensity, dist) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.8);
    l.position.set(x, caveFloorY(x, z) + 2.6, z);
    l.userData.base = intensity;
    scene.add(l); lights.push(l);
  };
  mk(0, 0, 0x6fc4e8, 55, 40);
  mk(9, -6, 0x66d9ff, 26, 24);
  mk(-9, 7, 0xff9a4a, 22, 24);

  return {
    solids: [floor, ceil],
    // lights swell as the player descends (they're mostly wasted on the surface)
    setUnderground(u) {
      for (const l of lights) l.intensity = l.userData.base * (0.2 + 0.8 * u);
    },
  };
}
