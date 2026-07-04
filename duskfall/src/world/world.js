// The environment: an atmospheric-scattering sky at golden hour, a warm sun with
// shadows, hemisphere fill, hazy fog, terrain + foliage, and drifting dust motes.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTerrain } from './terrain.js';
import { buildFoliage } from './foliage.js';
import { rand } from '../engine/math.js';

export function buildWorld(scene, renderer) {
  // --- sky (Preetham atmospheric scattering) ---
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const u = sky.material.uniforms;
  u.turbidity.value = 7;
  u.rayleigh.value = 2.4;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.82;
  scene.add(sky);

  const sunDir = new THREE.Vector3();
  const elevation = 16;    // late-afternoon golden sun (lit, playable field)
  const azimuth = 150;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDir.setFromSphericalCoords(1, phi, theta);
  u.sunPosition.value.copy(sunDir);

  // --- lights ---
  const sun = new THREE.DirectionalLight(0xffdca8, 3.1);
  sun.position.copy(sunDir).multiplyScalar(160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 78;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a5233, 1.0);
  scene.add(hemi);
  // a soft warm bounce from the low sun
  const bounce = new THREE.DirectionalLight(0xffceff, 0.25);
  bounce.position.set(-sunDir.x, 0.3, -sunDir.z).multiplyScalar(100);
  scene.add(bounce);

  // --- warm hazy fog tuned to the horizon ---
  scene.fog = new THREE.FogExp2(0xdcc19a, 0.0072);

  // --- terrain + foliage ---
  const terrain = buildTerrain(scene);
  const foliage = buildFoliage(scene, terrain);

  // --- drifting dust / pollen motes ---
  const motes = buildMotes(scene);

  return {
    terrain,
    colliders: foliage.colliders,
    solids: [terrain.mesh, ...foliage.solids],
    sun,
    sunDir,
    playRadius: terrain.playRadius,
    update(dt, playerPos) {
      motes.update(dt, playerPos);
      // keep the shadow frustum centred on the player
      sun.position.copy(sunDir).multiplyScalar(160).add(playerPos);
      sun.target.position.copy(playerPos);
    },
  };
}

function buildMotes(scene) {
  const COUNT = 340;
  const R = 55, Hh = 22;
  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = rand(-R, R);
    pos[i * 3 + 1] = rand(0.5, Hh);
    pos[i * 3 + 2] = rand(-R, R);
    vel[i * 3] = rand(-0.25, 0.25);
    vel[i * 3 + 1] = rand(0.05, 0.35);
    vel[i * 3 + 2] = rand(-0.25, 0.25);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff0cf, size: 0.13, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    update(dt, player) {
      const cx = player ? player.x : 0, cz = player ? player.z : 0;
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] > Hh) pos[i * 3 + 1] = 0.5;
        // wrap around the player so motes are always around you
        if (pos[i * 3] - cx > R) pos[i * 3] -= 2 * R; else if (pos[i * 3] - cx < -R) pos[i * 3] += 2 * R;
        if (pos[i * 3 + 2] - cz > R) pos[i * 3 + 2] -= 2 * R; else if (pos[i * 3 + 2] - cz < -R) pos[i * 3 + 2] += 2 * R;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
