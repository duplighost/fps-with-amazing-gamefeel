// The environment, and its slow march from summer through autumn into a haunted
// deep winter. `setSeason(season, haunt, storm)` (0..1 each) retunes the sky,
// sun, fog, exposure, foliage colours and terrain snow, and drives falling snow —
// so the field visibly changes a little more with every wave, ending in a storm.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTerrain } from './terrain.js';
import { buildFoliage } from './foliage.js';
import { rand, lerp, clamp01 } from '../engine/math.js';

const degToRad = THREE.MathUtils.degToRad;

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
  const azimuth = 150;
  const theta = degToRad(azimuth);
  const setSunElevation = (elev) => {
    sunDir.setFromSphericalCoords(1, degToRad(90 - elev), theta);
    u.sunPosition.value.copy(sunDir);
  };
  setSunElevation(16);

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
  const bounce = new THREE.DirectionalLight(0xffceff, 0.25);
  bounce.position.set(-sunDir.x, 0.3, -sunDir.z).multiplyScalar(100);
  scene.add(bounce);

  scene.fog = new THREE.FogExp2(0xdcc19a, 0.0072);

  const terrain = buildTerrain(scene);
  const foliage = buildFoliage(scene, terrain);
  const motes = buildMotes(scene);
  const snow = buildSnow(scene);

  // --- season lerp keyframes: [summer, autumn, winter] ---
  const SUN_W = new THREE.Color(0xffdca8), SUN_C = new THREE.Color(0xcdd9f0);
  const HEMI_SKY_W = new THREE.Color(0xbfd4ff), HEMI_SKY_C = new THREE.Color(0xdde7f2);
  const HEMI_GND_W = new THREE.Color(0x4a5233), HEMI_GND_C = new THREE.Color(0x9aa6b0);
  const FOG_W = new THREE.Color(0xdcc19a), FOG_C = new THREE.Color(0xccd6de), FOG_HAUNT = new THREE.Color(0x6f7883);
  const FOL = {
    canopy: [0x53702f, 0xc06a1e, 0x9ba2a4], bush: [0x47632a, 0xa85c22, 0x909590],
    trunk: [0x4b3826, 0x4b3826, 0x3b342e], rock: [0x6a655e, 0x6a655e, 0x8f949a], grass: [0x6d8a3a, 0xa08a3a, 0xbcc4c8],
  };
  const _c = new THREE.Color(), _a = new THREE.Color(), _b = new THREE.Color(), _d = new THREE.Color();
  const seasonCol = (out, tri, season) => {
    _a.setHex(tri[0]); _b.setHex(tri[1]); _d.setHex(tri[2]);
    if (season < 0.55) out.copy(_a).lerp(_b, clamp01(season / 0.55));
    else out.copy(_b).lerp(_d, clamp01((season - 0.55) / 0.45));
  };

  function setSeason(season, haunt = 0, storm = 0) {
    season = clamp01(season); haunt = clamp01(haunt); storm = clamp01(storm);
    // sky: hazier, greyer, and the sun sinks + cools
    u.turbidity.value = lerp(7, 12, season);
    u.rayleigh.value = lerp(2.4, 0.55, season);
    setSunElevation(lerp(16, 6.5, season));
    sun.color.copy(SUN_W).lerp(SUN_C, season);
    sun.intensity = lerp(3.1, 1.7, season) * (1 - haunt * 0.28);
    // hemisphere fill shifts from warm-green to cold snow-grey
    hemi.color.copy(HEMI_SKY_W).lerp(HEMI_SKY_C, season);
    hemi.groundColor.copy(HEMI_GND_W).lerp(HEMI_GND_C, season);
    hemi.intensity = lerp(1.0, 1.35, season) * (1 - haunt * 0.3);
    // fog thickens and cools, and darkens as it gets haunted / stormy
    _c.copy(FOG_W).lerp(FOG_C, season).lerp(FOG_HAUNT, haunt * 0.7);
    scene.fog.color.copy(_c);
    scene.fog.density = lerp(0.0072, 0.0135, season) + haunt * 0.004 + storm * 0.02;
    // dimmer, colder exposure as winter and the haunt set in
    renderer.toneMappingExposure = lerp(1.15, 1.0, season) - haunt * 0.13;
    // terrain snow / autumn tint (GPU)
    terrain.setSeason(season);
    // foliage colours
    seasonCol(foliage.mats.canopy.color, FOL.canopy, season);
    seasonCol(foliage.mats.bush.color, FOL.bush, season);
    seasonCol(foliage.mats.trunk.color, FOL.trunk, season);
    seasonCol(foliage.mats.rock.color, FOL.rock, season);
    seasonCol(foliage.mats.grass.color, FOL.grass, season);
    foliage.grass.visible = season < 0.82;      // snow swallows the tufts
    // particles: pollen motes give way to snow
    snow.setIntensity(clamp01((season - 0.32) / 0.68), storm);
    motes.setFade(1 - clamp01(season * 1.4));
  }
  setSeason(0);

  return {
    terrain,
    colliders: foliage.colliders,
    solids: [terrain.mesh, ...foliage.solids],
    sun,
    sunDir,
    playRadius: terrain.playRadius,
    setSeason,
    update(dt, playerPos) {
      motes.update(dt, playerPos);
      snow.update(dt, playerPos);
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
    pos[i * 3] = rand(-R, R); pos[i * 3 + 1] = rand(0.5, Hh); pos[i * 3 + 2] = rand(-R, R);
    vel[i * 3] = rand(-0.25, 0.25); vel[i * 3 + 1] = rand(0.05, 0.35); vel[i * 3 + 2] = rand(-0.25, 0.25);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff0cf, size: 0.13, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; scene.add(points);
  let fade = 1;
  return {
    setFade(f) { fade = clamp01(f); mat.opacity = fade * 0.7; points.visible = fade > 0.02; },
    update(dt, player) {
      if (fade <= 0.02) return;
      const cx = player ? player.x : 0, cz = player ? player.z : 0;
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] > Hh) pos[i * 3 + 1] = 0.5;
        if (pos[i * 3] - cx > R) pos[i * 3] -= 2 * R; else if (pos[i * 3] - cx < -R) pos[i * 3] += 2 * R;
        if (pos[i * 3 + 2] - cz > R) pos[i * 3 + 2] -= 2 * R; else if (pos[i * 3 + 2] - cz < -R) pos[i * 3 + 2] += 2 * R;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Falling snow that wraps around the player. Intensity scales opacity + density;
// storm cranks the fall speed and adds driving wind.
function buildSnow(scene) {
  const COUNT = 1600;
  const R = 46, TOP = 34;
  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = rand(-R, R); pos[i * 3 + 1] = rand(0, TOP); pos[i * 3 + 2] = rand(-R, R);
    seed[i] = rand(0, Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.17, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.visible = false; scene.add(points);
  let intensity = 0, storm = 0, t = 0;
  return {
    setIntensity(v, st) {
      intensity = clamp01(v); storm = clamp01(st || 0);
      mat.opacity = intensity * (0.55 + storm * 0.4);
      mat.size = 0.16 + storm * 0.12;
      points.visible = intensity > 0.01;
    },
    update(dt, player) {
      if (intensity <= 0.01) return;
      t += dt;
      const cx = player ? player.x : 0, cy = player ? player.y : 0, cz = player ? player.z : 0;
      const fall = 3.0 + storm * 11;
      const windX = Math.sin(t * 0.3) * 1.2 + storm * 9;
      const windZ = Math.cos(t * 0.23) * 1.0 + storm * 3;
      for (let i = 0; i < COUNT; i++) {
        const sway = Math.sin(t * 1.6 + seed[i]) * (0.5 + storm);
        pos[i * 3] += (windX + sway) * dt;
        pos[i * 3 + 1] -= (fall + (seed[i] % 1) * 2) * dt;
        pos[i * 3 + 2] += (windZ) * dt;
        // wrap into a box centred on (and slightly above) the player
        if (pos[i * 3 + 1] < cy - 3) pos[i * 3 + 1] = cy + TOP;
        if (pos[i * 3] - cx > R) pos[i * 3] -= 2 * R; else if (pos[i * 3] - cx < -R) pos[i * 3] += 2 * R;
        if (pos[i * 3 + 2] - cz > R) pos[i * 3 + 2] -= 2 * R; else if (pos[i * 3 + 2] - cz < -R) pos[i * 3 + 2] += 2 * R;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
