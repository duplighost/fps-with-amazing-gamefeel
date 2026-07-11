// The environment, and its slow march from summer through autumn into a haunted
// deep winter. `setSeason(season, haunt, storm)` (0..1 each) retunes the sky,
// sun, fog, exposure, foliage colours and terrain snow, and drives falling snow —
// so the field visibly changes a little more with every wave, ending in a storm.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTerrain } from './terrain.js';
import { buildFoliage } from './foliage.js';
import { buildPlatforms } from './platforms.js';
import { buildCave } from './cave.js';
import { buildLandmarks } from './landmarks.js';
import { buildTreeHouse } from './tree.js';
import { buildOutcrops } from './outcrops.js';
import { POND, WATER_Y, inPond, ENTRANCES, caveSDF, inCraterMouth } from './layout.js';
import { rand, lerp, clamp01, damp } from '../engine/math.js';

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
  const platforms = buildPlatforms(scene, terrain);
  const cave = buildCave(scene);
  const pond = buildPond(scene);
  const waterfall = buildWaterfall(scene, terrain);
  const landmarks = buildLandmarks(scene, terrain);
  foliage.colliders.push(...landmarks.colliders);      // stones block walkers too
  foliage.colliders.push(...cave.colliders);           // entrance arch pillars
  platforms.platforms.push(...landmarks.tops);         // lintels/arch/slab are stand-able
  const tree = buildTreeHouse(scene, terrain);
  foliage.colliders.push(...tree.colliders);           // trunk blocks (surface only)
  platforms.platforms.push(...tree.tops);              // branches/deck/crown are stand-able
  const outcrops = buildOutcrops(scene, terrain);
  foliage.colliders.push(...outcrops.colliders);       // boulders block + are cover
  platforms.platforms.push(...outcrops.tops);          // ...and stand-able hop-tops
  foliage.colliders.push(waterfall.collider);          // the waterfall's rock buttress
  const mountains = buildMountains(scene);
  const clouds = buildClouds(scene);
  const fireflies = buildFireflies(scene, terrain);
  const motes = buildMotes(scene);
  const snow = buildSnow(scene);
  let underT = 0, pondTime = 0;   // 0 = on the surface … 1 = fully underground

  // --- season lerp keyframes: [summer, autumn, winter] ---
  const SUN_W = new THREE.Color(0xffdca8), SUN_C = new THREE.Color(0xcdd9f0);
  const HEMI_SKY_W = new THREE.Color(0xbfd4ff), HEMI_SKY_C = new THREE.Color(0xdde7f2);
  const HEMI_GND_W = new THREE.Color(0x4a5233), HEMI_GND_C = new THREE.Color(0x9aa6b0);
  const FOG_W = new THREE.Color(0xdcc19a), FOG_C = new THREE.Color(0xccd6de), FOG_HAUNT = new THREE.Color(0x6f7883);
  const _cave = new THREE.Color(0x10141d);
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

  // a boss (the yeti) can whip up the storm beyond the natural seasonal level
  let stormBoost = 0;
  let _last = { season: 0, haunt: 0, storm: 0 };

  function setSeason(season, haunt = 0, storm = 0) {
    season = clamp01(season); haunt = clamp01(haunt); storm = clamp01(storm);
    _last = { season, haunt, storm };
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
    // descend underground: the sky's light dies away and the air goes close + dark
    if (underT > 0.005) {
      sun.intensity *= 1 - underT * 0.85;
      hemi.intensity *= 1 - underT * 0.45;
      scene.fog.color.lerp(_cave, underT * 0.85);
      scene.fog.density += underT * 0.018;
      renderer.toneMappingExposure -= underT * 0.12;
    }
    // the pond freezes over in deep winter
    pond.setFrozen(season >= 0.55);
    // terrain snow / autumn tint (GPU)
    terrain.setSeason(season);
    // foliage colours
    seasonCol(foliage.mats.canopy.color, FOL.canopy, season);
    foliage.mats.canopyCore.color.copy(foliage.mats.canopy.color).multiplyScalar(0.66);
    seasonCol(foliage.mats.bush.color, FOL.bush, season);
    seasonCol(foliage.mats.trunk.color, FOL.trunk, season);
    seasonCol(foliage.mats.rock.color, FOL.rock, season);
    seasonCol(foliage.mats.grass.color, FOL.grass, season);
    foliage.grass.visible = season < 0.82;      // snow swallows the tufts
    // sky-islands tint with the ground
    platforms.setSeason(season);
    // distant scenery cools with the year
    mountains.setSeason(season, haunt);
    tree.setSeason(season, haunt);
    outcrops.setSeason(season);
    waterfall.setSeason(season);
    clouds.setSeason(season, haunt);
    fireflies.setFade((1 - clamp01(season * 1.25)) * (1 - haunt * 0.4));
    // particles: pollen motes give way to snow (a boss can force the storm harder)
    const st = Math.max(storm, stormBoost);
    snow.setIntensity(clamp01(Math.max((season - 0.32) / 0.68, stormBoost)), st);
    // the storm also thickens the fog when a boss whips it up
    if (stormBoost > 0.01) scene.fog.density += stormBoost * 0.018;
    motes.setFade(1 - clamp01(season * 1.4));
  }
  // ramp an extra storm layer (0..1) on top of the season. Just sets the level;
  // the per-frame setSeason() call in the game loop applies it (via the Math.max
  // in the snow line + the fog bump), so there's no need to re-tint here.
  function setStormBoost(v) { stormBoost = clamp01(v); }
  setSeason(0);

  // ONE ground function for everything: surface terrain, cave floor when you're
  // underground, and the frozen pond's ice sheet on top in winter.
  function groundAt(x, z, y) {
    let g = terrain.groundAt(x, z, y);
    if (pond.frozen && inPond(x, z, 0.6) && y > WATER_Y - 0.35) g = Math.max(g, WATER_Y);
    return g;
  }
  // what you're standing in/on at the pond: 'water' | 'ice' | null
  function surfaceAt(x, z, footY) {
    if (!inPond(x, z, 0.2)) return null;
    if (pond.frozen) return footY > WATER_Y - 0.35 ? 'ice' : 'water';
    return footY < WATER_Y + 0.3 ? 'water' : null;
  }

  return {
    terrain,
    colliders: foliage.colliders,
    platforms: platforms.platforms,
    nook: tree.nook,
    solids: [terrain.mesh, ...foliage.solids, ...platforms.solids, ...cave.solids, ...landmarks.solids, ...tree.solids, ...outcrops.solids],
    // the big heightfield planes (surface terrain + cave floor/ceil) are ~13k
    // triangles each and murder per-ray raycast cost; bullets march them
    // analytically via groundAt instead, so they're excluded from this list.
    bulletSolids: [...foliage.solids, ...platforms.solids, ...landmarks.solids, ...tree.solids, ...outcrops.solids],
    sun,
    sunDir,
    playRadius: terrain.playRadius,
    groundAt,
    inCrater: inCraterMouth,
    surfaceAt,
    caveSDF,
    isUnder: terrain.isUnder,
    ceilAt: terrain.ceilAt,
    entrances: ENTRANCES,
    pond,
    getUnder: () => underT,
    setSeason,
    setStormBoost,
    update(dt, playerPos) {
      pondTime += dt; pond.update(pondTime);
      waterfall.update(pondTime);
      clouds.update(dt);
      fireflies.update(dt, pondTime);
      cave.update(pondTime);
      if (foliage.mats.grass._shader) foliage.mats.grass._shader.uniforms.uTime.value = pondTime;
      const target = terrain.isUnder(playerPos.x, playerPos.z, playerPos.y + 0.6) ? 1 : 0;
      underT = damp(underT, target, 3.2, dt);
      cave.setUnderground(underT);
      snow.setHidden(underT > 0.5);
      motes.update(dt, playerPos);
      snow.update(dt, playerPos);
      sun.position.copy(sunDir).multiplyScalar(160).add(playerPos);
      sun.target.position.copy(playerPos);
    },
  };
}

// A ring of jagged distant peaks past the treeline — silhouette layering that
// makes the arena read as a place inside a world. Exponential fog would erase
// anything 200m out entirely, so the peaks opt out of fog and fake the haze
// with hand-picked colors + transparency: two rings at two tones = cheap depth.
function buildMountains(scene) {
  const matFar = new THREE.MeshBasicMaterial({ color: 0x8d8496, fog: false, transparent: true, opacity: 0.55, depthWrite: false });
  const matNear = new THREE.MeshBasicMaterial({ color: 0x6f687e, fog: false, transparent: true, opacity: 0.75, depthWrite: false });
  const group = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 9.1) * 0.12;
    const far = i % 2 === 0;
    // the terrain's own rolling rim (~170m out, up to ~27m tall) forms the
    // horizon, so the peaks must be tall enough to clear it from ground level
    const d = (far ? 215 : 165) + ((i * 37) % 11) * 5;
    const h = (far ? 72 : 50) + ((i * 53) % 17) * 3.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(34 + ((i * 29) % 7) * 5, h, 5), far ? matFar : matNear);
    cone.position.set(Math.cos(a) * d, h * 0.35, Math.sin(a) * d);
    cone.rotation.y = i * 1.7;
    group.add(cone);
  }
  scene.add(group);
  const WF = new THREE.Color(0x8d8496), CF = new THREE.Color(0xa8b2c2), HF = new THREE.Color(0x554e64);
  const WN = new THREE.Color(0x6f687e), CN = new THREE.Color(0x8e9aac), HN = new THREE.Color(0x423c52);
  return { setSeason(s, h) {
    matFar.color.copy(WF).lerp(CF, s).lerp(HF, h * 0.5);
    matNear.color.copy(WN).lerp(CN, s).lerp(HN, h * 0.5);
  } };
}

// Soft procedural clouds drifting high over the field.
function buildClouds(scene) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 32, 4, 64, 32, 60);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  const sprites = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.42, depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    const a = (i / 12) * Math.PI * 2 + Math.sin(i * 7.7);
    s.position.set(Math.cos(a) * (40 + (i * 31) % 80), 58 + (i * 17) % 26, Math.sin(a) * (40 + (i * 43) % 80));
    const w = 40 + (i * 23) % 34;
    s.scale.set(w, w * 0.34, 1);
    scene.add(s); sprites.push(s);
  }
  const W = new THREE.Color(0xfff2dd), C = new THREE.Color(0xd7dde6), D = new THREE.Color(0x8a8f9c);
  return {
    setSeason(se, h) { const col = new THREE.Color().copy(W).lerp(C, se).lerp(D, h * 0.6); for (const s of sprites) s.material.color.copy(col); },
    update(dt) {
      for (const s of sprites) {
        s.position.x += dt * 0.7;
        if (s.position.x > 150) s.position.x = -150;
      }
    },
  };
}

// Fireflies wandering the meadow at golden hour — they die back as winter comes.
function buildFireflies(scene, terrain) {
  const COUNT = 80;
  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const a = rand(0, Math.PI * 2), d = rand(18, 52);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    pos[i * 3] = x; pos[i * 3 + 1] = terrain.height(x, z) + rand(0.4, 2.4); pos[i * 3 + 2] = z;
    seed[i] = rand(0, Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffe27a, size: 0.12, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; scene.add(points);
  let fade = 1;
  return {
    setFade(f) { fade = clamp01(f); points.visible = fade > 0.03; },
    update(dt, t) {
      if (fade <= 0.03) return;
      mat.opacity = fade * (0.5 + Math.sin(t * 2.1) * 0.35);
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] += Math.sin(t * 0.7 + seed[i]) * dt * 0.5;
        pos[i * 3 + 1] += Math.cos(t * 0.9 + seed[i] * 2) * dt * 0.3;
        pos[i * 3 + 2] += Math.cos(t * 0.6 + seed[i]) * dt * 0.5;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// The pond: a translucent water disc that hardens into ice in deep winter.
function buildPond(scene) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2e6b7a, transparent: true, opacity: 0.72, roughness: 0.18,
    metalness: 0.05, emissive: 0x0a2830, emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.8, 30), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(POND.x, WATER_Y, POND.z);
  scene.add(mesh);
  let frozen = false;
  return {
    mesh,
    get frozen() { return frozen; },
    setFrozen(f) {
      if (f === frozen) return;
      frozen = f;
      if (f) {
        mat.color.setHex(0xd4e6f0); mat.opacity = 0.97; mat.roughness = 0.3;
        mat.emissive.setHex(0x27394c); mat.emissiveIntensity = 0.22;
        mesh.position.y = WATER_Y + 0.02;
      } else {
        mat.color.setHex(0x2e6b7a); mat.opacity = 0.72; mat.roughness = 0.18;
        mat.emissive.setHex(0x0a2830); mat.emissiveIntensity = 0.35;
        mesh.position.y = WATER_Y;
      }
    },
    update(t) { if (!frozen) mat.emissiveIntensity = 0.3 + Math.sin(t * 1.7) * 0.08; },
  };
}

// A procedural water sheet: soft vertical streaks + foam flecks on a translucent
// blue gradient, tiled so it can scroll seamlessly. Two seeded variants layer up
// for parallax depth in the falling curtain.
function waterCurtainTexture(variant) {
  const w = 96, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(236,247,255,0.92)');
  g.addColorStop(0.12, 'rgba(206,232,246,0.72)');
  g.addColorStop(1, 'rgba(178,214,234,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const R = (n) => { const t = Math.sin((n + variant * 91.3) * 12.9898) * 43758.5453; return t - Math.floor(t); };
  for (let i = 0; i < 60; i++) {                       // wavy vertical streaks
    const x = R(i) * w;
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + R(i + 7) * 0.5})`;
    ctx.lineWidth = 0.5 + R(i + 3) * 2.2;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y < h; y += 10) ctx.lineTo(x + Math.sin(y * 0.06 + i) * 1.6, y);
    ctx.stroke();
  }
  for (let i = 0; i < 260; i++) {                      // foam flecks
    ctx.fillStyle = `rgba(255,255,255,${0.15 + R(i + 100) * 0.6})`;
    const s = 0.5 + R(i + 50) * 1.8;
    ctx.fillRect(R(i + 200) * w, R(i + 300) * h, s, s * 2.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A waterfall cascading down a rock buttress into the pond's OUTER rim (so its
// face turns back toward the field). Animated water curtain, a foam lip, a
// pulsing splash ring, rising mist, and a cool glow — all icing over as winter
// sets in, to match the freezing pond. Decorative apart from one rock collider.
function buildWaterfall(scene, terrain) {
  const group = new THREE.Group();
  scene.add(group);
  const dl = Math.hypot(POND.x, POND.z) || 1;
  const nx = POND.x / dl, nz = POND.z / dl;            // outward from centre toward the pond
  const baseX = POND.x + nx * (POND.r - 0.2), baseZ = POND.z + nz * (POND.r - 0.2);
  const FALL_H = 8.5;
  const topY = WATER_Y + FALL_H;
  const faceYaw = Math.atan2(-nx, -nz);                // curtain normal points back at the field
  const curtainX = baseX + nx * 0.1, curtainZ = baseZ + nz * 0.1;

  // --- rock buttress the water pours down (a stack climbing the basin wall) ---
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5c5750, roughness: 0.97, metalness: 0.02, flatShading: true });
  const rockDark = new THREE.MeshStandardMaterial({ color: 0x433f39, roughness: 0.97, metalness: 0.02, flatShading: true });
  const chip = (geo, amt) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const s = Math.sin(x * 12.9 + y * 78.2 + z * 37.7 + 3.17) * 43758.5;
      const hh = (s - Math.floor(s)) - 0.5;
      p.setXYZ(i, x + hh * amt, y + hh * amt, z + hh * amt);
    }
    geo.computeVertexNormals();
  };
  for (let i = 0; i < 7; i++) {
    const up = i / 6;
    const w = 5.4 - up * 1.6 + (i % 2) * 0.5, hgt = 2.2 + (i % 3) * 0.5, bk = 3.0 - up * 0.8;
    const blk = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, bk), i % 2 ? rockDark : rockMat);
    chip(blk.geometry, 0.5);
    const along = 0.6 + up * 2.2;
    blk.position.set(baseX + nx * along + Math.sin(i * 2.3) * 0.5, WATER_Y - 0.6 + up * FALL_H, baseZ + nz * along + Math.cos(i * 2.3) * 0.5);
    blk.rotation.y = faceYaw + Math.sin(i * 1.7) * 0.2;
    blk.castShadow = true; blk.receiveShadow = true;
    group.add(blk);
  }
  for (const sgn of [-1, 1]) {                          // framing boulders at the pool
    const b = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), rockMat);
    chip(b.geometry, 0.35);
    b.position.set(baseX + (-nz * sgn) * 2.4 + nx * 0.4, WATER_Y + 0.3, baseZ + (nx * sgn) * 2.4 + nz * 0.4);
    b.rotation.set(sgn, sgn * 2, 0); b.castShadow = true; group.add(b);
  }

  // --- the falling water: two scrolling translucent sheets for parallax depth ---
  const tex1 = waterCurtainTexture(1), tex2 = waterCurtainTexture(2);
  tex1.repeat.set(1, 2.2); tex2.repeat.set(1.3, 3.0);
  const sheetMat = (tex, op) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.4, FALL_H), sheetMat(tex2, 0.5));
  const front = new THREE.Mesh(new THREE.PlaneGeometry(3.0, FALL_H + 0.3), sheetMat(tex1, 0.82));
  back.rotation.y = front.rotation.y = faceYaw;
  back.position.set(curtainX + nx * 0.25, WATER_Y + FALL_H / 2, curtainZ + nz * 0.25);
  front.position.set(curtainX, WATER_Y + FALL_H / 2 + 0.1, curtainZ);
  group.add(back, front);

  // --- foam lip pouring over the top ---
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.9, depthWrite: false });
  const lip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 1.1), foamMat);
  lip.position.set(curtainX + nx * 0.3, topY - 0.1, curtainZ + nz * 0.3);
  lip.rotation.y = faceYaw; group.add(lip);

  // --- splash ring foaming on the pool at the base ---
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const splash = new THREE.Mesh(new THREE.RingGeometry(0.8, 2.6, 26), splashMat);
  splash.rotation.x = -Math.PI / 2; splash.position.set(curtainX, WATER_Y + 0.06, curtainZ);
  group.add(splash);

  // --- rising mist at the base ---
  const MIST = 46;
  const mpos = new Float32Array(MIST * 3), mseed = new Float32Array(MIST);
  for (let i = 0; i < MIST; i++) { mseed[i] = rand(0, Math.PI * 2); mpos[i * 3] = curtainX; mpos[i * 3 + 1] = WATER_Y; mpos[i * 3 + 2] = curtainZ; }
  const mgeo = new THREE.BufferGeometry(); mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  const mmat = new THREE.PointsMaterial({ color: 0xdff0ff, size: 0.5, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const mist = new THREE.Points(mgeo, mmat); mist.frustumCulled = false; group.add(mist);

  const glow = new THREE.PointLight(0x9fdcff, 10, 15, 2.0);
  glow.position.set(curtainX, WATER_Y + 2.2, curtainZ); scene.add(glow);

  const CLEAR = new THREE.Color(0xffffff), ICE = new THREE.Color(0xd6ebff), _wf = new THREE.Color();
  let winter = 0;
  return {
    collider: { x: baseX + nx * 1.6, z: baseZ + nz * 1.6, r: 2.6 },
    setSeason(season) {
      winter = clamp01((season - 0.5) / 0.3);           // freezes alongside the pond (>=0.55)
      _wf.copy(CLEAR).lerp(ICE, winter);
      front.material.color.copy(_wf); back.material.color.copy(_wf);
      foamMat.color.copy(CLEAR).lerp(ICE, winter * 0.6);
      mmat.opacity = 0.3 * (1 - winter * 0.7);
      glow.intensity = 10 * (1 - winter * 0.5);
    },
    update(t) {
      const flow = 1 - winter * 0.85;                   // nearly stills as it ices over
      tex1.offset.y = -t * 0.62 * flow; tex2.offset.y = -t * 0.44 * flow;
      tex1.offset.x = Math.sin(t * 0.5) * 0.02;
      const pulse = 0.5 + Math.sin(t * 5) * 0.18 * flow;
      splashMat.opacity = pulse * (1 - winter * 0.6);
      splash.scale.setScalar(1 + Math.sin(t * 5) * 0.06 * flow);
      const arr = mgeo.attributes.position.array;
      for (let i = 0; i < MIST; i++) {
        const rise = (t * 0.5 + mseed[i]) % 3;
        const spread = 0.5 + rise * 0.5;
        arr[i * 3] = curtainX + Math.cos(mseed[i] * 3 + t * 0.4) * spread;
        arr[i * 3 + 1] = WATER_Y + rise;
        arr[i * 3 + 2] = curtainZ + Math.sin(mseed[i] * 3 + t * 0.4) * spread;
      }
      mgeo.attributes.position.needsUpdate = true;
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
  let intensity = 0, storm = 0, t = 0, hidden = false;
  return {
    setIntensity(v, st) {
      intensity = clamp01(v); storm = clamp01(st || 0);
      mat.opacity = intensity * (0.55 + storm * 0.4);
      mat.size = 0.16 + storm * 0.12;
      points.visible = !hidden && intensity > 0.01;
    },
    setHidden(h) { hidden = h; points.visible = !h && intensity > 0.01; },
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
