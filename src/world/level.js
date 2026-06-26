// The arena. Builds a neon-industrial combat space: a grid floor, perimeter
// walls, and a hand-placed mix of crates, pillars, ramps and raised platforms
// that give the player cover and verticality. Returns matched render meshes +
// AABB colliders + enemy spawn points so physics and visuals never disagree.

import * as THREE from 'three';
import { rand } from '../engine/math.js';

const HALF = 32;      // arena half-extent
const WALL_H = 9;

export function buildLevel(scene) {
  const colliders = [];
  const solids = [];   // meshes used for bullet raycasts
  const animated = [];

  // --- atmosphere ---
  scene.background = makeSky();
  scene.fog = new THREE.FogExp2(0x0a0c14, 0.012);

  // --- lights ---
  const hemi = new THREE.HemisphereLight(0x9fc6ff, 0x10121a, 0.7);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dd, 1.15);
  key.position.set(20, 34, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const d = 44;
  key.shadow.camera.left = -d; key.shadow.camera.right = d;
  key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
  key.shadow.camera.near = 1; key.shadow.camera.far = 120;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x4060ff, 0.35);
  fill.position.set(-18, 16, -22);
  scene.add(fill);

  // colored accent lights for mood
  const accents = [
    [0xff3a6b, -HALF + 6, 5, -HALF + 6],
    [0x33d6ff, HALF - 6, 5, HALF - 6],
    [0xffc24a, HALF - 6, 5, -HALF + 6],
    [0x7a3aff, -HALF + 6, 5, HALF - 6],
  ];
  for (const [c, x, y, z] of accents) {
    const l = new THREE.PointLight(c, 0.7, 40, 2);
    l.position.set(x, y, z);
    scene.add(l);
    animated.push({ light: l, base: 0.7, phase: rand(0, 6.28) });
  }

  // --- materials ---
  const floorMat = new THREE.MeshStandardMaterial({
    map: gridTexture(0x141824, 0x2b3a66, 0x3affd0),
    metalness: 0.4, roughness: 0.75,
  });
  floorMat.map.wrapS = floorMat.map.wrapT = THREE.RepeatWrapping;
  floorMat.map.repeat.set(HALF, HALF);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x191d2a, metalness: 0.5, roughness: 0.6 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3e, metalness: 0.55, roughness: 0.45 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x20242f, metalness: 0.6, roughness: 0.4 });
  const neonMat = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5, roughness: 0.3 });

  // --- floor ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  solids.push(floor);

  // helper to add a collidable, shadowing box given footprint + bottom y
  const addBox = (x, y, z, w, h, dd, mat, opts = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = opts.shadow !== false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    solids.push(mesh);
    if (opts.collide !== false) {
      colliders.push({
        min: new THREE.Vector3(x - w / 2, y, z - dd / 2),
        max: new THREE.Vector3(x + w / 2, y + h, z + dd / 2),
      });
    }
    return mesh;
  };

  // neon strip (decorative, non-colliding)
  const addStrip = (x, y, z, w, h, dd, c) => addBox(x, y, z, w, h, dd, neonMat(c), { collide: false, shadow: false });

  // --- perimeter walls ---
  const t = 1.5;
  addBox(0, 0, -HALF, HALF * 2 + t, WALL_H, t, wallMat);
  addBox(0, 0, HALF, HALF * 2 + t, WALL_H, t, wallMat);
  addBox(-HALF, 0, 0, t, WALL_H, HALF * 2 + t, wallMat);
  addBox(HALF, 0, 0, t, WALL_H, HALF * 2 + t, wallMat);
  // glowing baseboard strips along the walls
  addStrip(0, 0.05, -HALF + t / 2 + 0.05, HALF * 2, 0.12, 0.08, 0x3affd0);
  addStrip(0, 0.05, HALF - t / 2 - 0.05, HALF * 2, 0.12, 0.08, 0x3affd0);
  addStrip(-HALF + t / 2 + 0.05, 0.05, 0, 0.08, 0.12, HALF * 2, 0xff3a6b);
  addStrip(HALF - t / 2 - 0.05, 0.05, 0, 0.08, 0.12, HALF * 2, 0xff3a6b);

  // --- central raised platform with ramps ---
  addBox(0, 0, 0, 10, 1.2, 10, pillarMat);
  addStrip(0, 1.21, 0, 10, 0.06, 10, 0x33d6ff); // glowing accent on the platform top
  // ramps rising up to the platform from both z edges (platform spans z -5..5)
  buildRamp(addBox, crateMat, 0, 5, 6, 1.2, 'z+');
  buildRamp(addBox, crateMat, 0, -5, 6, 1.2, 'z-');

  // --- corner cover pillars ---
  const pillars = [
    [-14, -14], [14, -14], [-14, 14], [14, 14],
    [0, -20], [0, 20],
  ];
  for (const [x, z] of pillars) {
    const h = rand(3.5, 5.5);
    addBox(x, 0, z, 2, h, 2, pillarMat);
    addStrip(x, h - 0.2, z + 1.01, 1.4, 0.3, 0.06, pick([0x33d6ff, 0xff3a6b, 0xffc24a]));
  }

  // --- scattered crates (cover) ---
  const crates = [
    [-8, -18, 1.6], [-6, -16, 1.2], [8, 16, 1.8], [10, 14, 1.2],
    [18, -8, 1.6], [16, -10, 1.0], [-18, 8, 1.6], [-16, 10, 1.2],
    [-22, -22, 2.2], [22, 22, 2.2], [22, -22, 1.6], [-22, 22, 1.6],
    [6, -6, 1.0], [-6, 6, 1.0],
  ];
  for (const [x, z, s] of crates) {
    addBox(x, 0, z, s, s, s, crateMat);
  }

  // --- a couple of taller sniper platforms in opposite corners ---
  addBox(-25, 0, -25, 7, 2.6, 7, pillarMat);   // spans z -28.5..-21.5
  buildRamp(addBox, crateMat, -25, -21.5, 5, 2.6, 'z+');
  addBox(25, 0, 25, 7, 2.6, 7, pillarMat);     // spans z 21.5..28.5
  buildRamp(addBox, crateMat, 25, 21.5, 5, 2.6, 'z-');

  // --- central ziggurat: stack of tiers you hop up with the floaty jump ---
  addBox(0, 1.2, 0, 6, 1.8, 6, pillarMat);     // tier 2, top at 3.0
  addStrip(0, 3.01, 0, 6, 0.06, 6, 0x33d6ff);
  addBox(0, 3.0, 0, 3, 2.0, 3, pillarMat);     // tier 3, top at 5.0 (high vantage)
  addStrip(0, 5.01, 0, 3, 0.06, 3, 0xffc24a);

  // --- two high platforms (above), reached by proper staircases ---
  addBox(-20, 0, 0, 6, 4.5, 6, pillarMat);     // west high platform, top 4.5
  addStrip(-20, 4.51, 0, 6, 0.06, 6, 0xff3a6b);
  buildStairs(addBox, crateMat, -10, 0, -1, 0, 10, 0.45, 0.7, 4.5);
  addBox(20, 0, 0, 6, 4.5, 6, pillarMat);      // east high platform, top 4.5
  addStrip(20, 4.51, 0, 6, 0.06, 6, 0xff3a6b);
  buildStairs(addBox, crateMat, 10, 0, 1, 0, 10, 0.45, 0.7, 4.5);

  // --- spawn points around the perimeter (kept off cover) ---
  const spawnPoints = [];
  const ring = HALF - 4;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    spawnPoints.push(new THREE.Vector3(Math.cos(a) * ring, 0, Math.sin(a) * ring));
  }

  const bounds = { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF };

  return {
    colliders,
    solids,
    bounds,
    spawnPoints,
    update(dt, time) {
      for (const a of animated) {
        a.light.intensity = a.base + Math.sin(time * 1.5 + a.phase) * 0.25;
      }
    },
  };
}

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// A straight staircase rising in an axis-aligned direction (dirX/dirZ is ±1 on
// one axis, 0 on the other). Each step is a solid box from the floor up; the
// per-step rise stays under the controller's STEP_HEIGHT so it's walkable.
function buildStairs(addBox, mat, x, z, dirX, dirZ, count, stepH, stepD, width) {
  for (let i = 0; i < count; i++) {
    const h = (i + 1) * stepH;
    const cx = x + dirX * (i + 0.5) * stepD;
    const cz = z + dirZ * (i + 0.5) * stepD;
    const w = dirX !== 0 ? stepD : width;
    const d = dirZ !== 0 ? stepD : width;
    addBox(cx, 0, cz, w, h, d, mat, { shadow: i === count - 1 });
  }
}

// Build a ramp from stacked steps that RISE toward the platform, so the player
// can walk up with the existing AABB step-up (no slope code needed). `edgeZ` is
// the platform edge; the ramp extends outward in `dir` with the tallest step
// (full platform height) adjacent to the edge and shrinking outward. Each step
// rise stays under the controller's STEP_HEIGHT so it's always climbable.
function buildRamp(addBox, mat, cx, edgeZ, width, topY, dir) {
  const steps = 5;
  const depth = 0.9;
  const sgn = dir === 'z+' ? 1 : -1;
  for (let i = 0; i < steps; i++) {
    const h = topY * (1 - i / steps);           // topY, .8, .6, .4, .2 × topY
    const z = edgeZ + sgn * (i + 0.5) * depth;  // i=0 sits just off the edge
    addBox(cx, 0, z, width, h, depth + 0.02, mat, { shadow: i === 0 });
  }
}

// --- procedural textures --------------------------------------------------

function gridTexture(bg, line, glow) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + bg.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  // major grid
  ctx.strokeStyle = '#' + line.toString(16).padStart(6, '0');
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, size, size);
  // inner subdivisions
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(120,150,220,0.25)';
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  // glow corner accents
  ctx.fillStyle = '#' + glow.toString(16).padStart(6, '0');
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, 10, 10);
  ctx.fillRect(size - 10, size - 10, 10, 10);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// A procedural equirectangular night sky: deep-space gradient, a starfield that
// thickens toward the zenith, soft neon nebula clouds, a glowing horizon band,
// and a moon. Wrapped around the scene as the skybox.
function makeSky() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // base vertical gradient (top = zenith, middle = horizon, bottom = nadir)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, '#05060f');
  g.addColorStop(0.30, '#0a0a1e');
  g.addColorStop(0.46, '#1a1140');
  g.addColorStop(0.50, '#3a1d5e');
  g.addColorStop(0.54, '#0c0a1a');
  g.addColorStop(1.0, '#020308');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // nebula clouds (additive), in the upper sky
  ctx.globalCompositeOperation = 'lighter';
  const nebs = [
    ['rgba(120,40,200,0.16)', 0.20, 0.22, 440],
    ['rgba(40,120,220,0.13)', 0.62, 0.30, 540],
    ['rgba(220,40,140,0.10)', 0.86, 0.16, 380],
    ['rgba(40,200,200,0.10)', 0.42, 0.40, 320],
    ['rgba(150,90,255,0.10)', 0.05, 0.34, 360],
  ];
  for (const [col, fx, fy, r] of nebs) {
    const x = fx * W, y = fy * H;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // stars — denser toward the top, only above the horizon
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * W;
    const y = Math.pow(Math.random(), 1.5) * 0.48 * H;
    const bright = Math.random();
    const size = bright < 0.92 ? 0.6 + Math.random() * 1.1 : 1.5 + Math.random() * 1.7;
    const a = 0.3 + Math.random() * 0.7;
    ctx.fillStyle = `rgba(${(205 + Math.random() * 50) | 0},${(220 + Math.random() * 35) | 0},255,${a})`;
    ctx.fillRect(x, y, size, size);
    if (bright > 0.975) { // a few bright stars get a glow
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 7);
      rg.addColorStop(0, `rgba(180,220,255,${a * 0.6})`); rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    }
  }

  // glowing horizon band
  const hb = ctx.createLinearGradient(0, 0.40 * H, 0, 0.56 * H);
  hb.addColorStop(0, 'transparent');
  hb.addColorStop(0.5, 'rgba(120,80,220,0.35)');
  hb.addColorStop(0.66, 'rgba(60,200,230,0.22)');
  hb.addColorStop(1, 'transparent');
  ctx.fillStyle = hb;
  ctx.fillRect(0, 0.40 * H, W, 0.16 * H);

  // a soft moon with a halo
  const mx = 0.72 * W, my = 0.17 * H;
  const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 80);
  halo.addColorStop(0, 'rgba(220,235,255,0.9)');
  halo.addColorStop(0.28, 'rgba(170,205,255,0.45)');
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(mx, my, 80, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(232,240,255,0.96)';
  ctx.beginPath(); ctx.arc(mx, my, 26, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
