// The horde. Five wildly distinct procedural creatures — each with its own
// silhouette, size, signature colour + glowing emissive accents (so they read
// instantly and pop against the dusk), signature-coloured blood, a bespoke gait,
// and its own movement behaviour. Hit-flash, knockback, scripted deaths, and a
// wave manager driving arcade scoring.
//
//   HUSK       — ashen foot-soldier, amber eyes. The baseline marcher.
//   STALKER    — small, fast, hunched raptor-thing with toxic-green glow. Weaves + lunges.
//   JUGGERNAUT — huge charcoal tank, molten-red core. Slow, ground-shaking.
//   WISP       — legless hovering specter, cyan glow. Drifts and bobs.
//   BLOATER    — round pustular sack, orange glow. Waddles, ruptures on death.

import * as THREE from 'three';
import { clamp, clamp01, damp, rand, randInt, pick, lerp } from '../engine/math.js';

const WHITE = new THREE.Color(0xffffff);
const ICE_TINT = new THREE.Color(0x9fd8ff);   // encased-in-the-frozen-pond tint
const SEER_CHARGE = 0.8;   // seconds a sniper telegraphs (glowing) before a bolt — long enough to dodge
const YETI_WINDUP = 0.85;  // yeti snowball wind-up (telegraph) — read it and dash to reflect
const SNOWBALL_SPEED = 15; // must match projectiles.js snowball def (for lob aiming)
const SNOWBALL_GRAV = 5.5;

const TYPES = {
  husk: {
    hp: 70, speed: 4.0, radius: 0.42, height: 1.9, damage: 12, attackCd: 1.1, score: 100,
    skin: 0x59636f, accent: 0xffab33, blood: 0x6b3b2a, rate: 5.5, reach: 0.9,
    gait: 'walk', headY: 0.78, voice: 1.0, build: buildHusk,
  },
  stalker: {
    hp: 42, speed: 8.4, radius: 0.36, height: 1.55, damage: 9, attackCd: 0.8, score: 150,
    skin: 0x44552f, accent: 0x74ff2e, blood: 0x3f6a1e, rate: 12, reach: 0.7,
    gait: 'run', headY: 0.66, weave: 2.0, lunge: true, flank: true, voice: 1.7, build: buildStalker,
  },
  juggernaut: {
    hp: 340, speed: 2.4, radius: 0.95, height: 2.85, damage: 34, attackCd: 1.6, score: 350,
    skin: 0x41444f, accent: 0xff3311, blood: 0xff5a22, rate: 3.4, reach: 1.4,
    gait: 'stomp', headY: 0.82, stomp: true, deathTrauma: 0.28, charge: true, voice: 0.55, build: buildJuggernaut,
  },
  wisp: {
    hp: 88, speed: 4.8, radius: 0.44, height: 2.1, damage: 14, attackCd: 1.0, score: 200,
    skin: 0x9fd6e2, accent: 0x33ddff, blood: 0x33ddff, rate: 4, reach: 0.9,
    gait: 'float', headY: 0.74, hover: 1.15, deathStyle: 'dissolve', voice: 1.35, build: buildWisp,
  },
  bloater: {
    hp: 165, speed: 2.7, radius: 0.7, height: 2.2, damage: 20, attackCd: 1.4, score: 250,
    skin: 0x7c7a34, accent: 0xff8a1e, blood: 0x9fb830, rate: 4.5, reach: 1.1,
    gait: 'waddle', headY: 0.8, burst: true, fuse: true, voice: 0.75, build: buildBloater,
  },
  // --- HEAVY: a walking stone monolith. Very slow, very tough, and it ZONES —
  // its stomp sends an expanding quake ring across the ground that punishes
  // anyone standing on it (jump or dash over the ring; the air game is safety).
  megalith: {
    hp: 640, speed: 1.5, radius: 1.15, height: 3.4, damage: 30, attackCd: 2.6, score: 500,
    skin: 0x5c635b, accent: 0x7dff9a, blood: 0x8a8f85, rate: 2.0, reach: 1.9,
    gait: 'stomp', headY: 0.86, stomp: true, deathTrauma: 0.4, quake: true, voice: 0.4,
    build: buildMegalith,
  },
  // --- FLYER: a diving carrion bird that climbs to the sky-islands and swoops ---
  raven: {
    hp: 44, speed: 5.2, radius: 0.46, height: 1.3, damage: 11, attackCd: 1.0, score: 175,
    skin: 0x2b2440, accent: 0xff3da8, blood: 0x4a2f5a, rate: 9, reach: 0.9,
    gait: 'fly', headY: 0.6, flyer: true, cruise: 7.5, diveRange: 13, climb: 0.9,
    voice: 1.55, build: buildRaven,
  },
  // --- FLYING SNIPER: holds altitude near an island and fires telegraphed bolts ---
  seer: {
    hp: 70, speed: 3.4, radius: 0.5, height: 1.8, damage: 16, attackCd: 2.6, score: 260,
    skin: 0x3a2c52, accent: 0xba7bff, blood: 0x53356a, rate: 3, reach: 0.9,
    gait: 'fly', headY: 0.72, flyer: true, cruise: 12, diveRange: -1, climb: 2.0,
    standoff: 20, shooter: true, voice: 1.1, build: buildSeer,
  },
  // --- BOSS: a towering molten titan that slams and calls in reinforcements ---
  colossus: {
    hp: 1600, speed: 2.9, radius: 1.7, height: 5.0, damage: 42, attackCd: 2.4, score: 3000,
    skin: 0x4a3a3e, accent: 0xff4416, blood: 0xff6a22, rate: 2.4, reach: 3.4,
    gait: 'stomp', headY: 0.9, stomp: true, deathTrauma: 0.7, boss: true, voice: 0.4, name: 'THE COLOSSUS',
    build: buildColossus,
  },
  // --- BOSS: a burrowing horror that owns the UNDERGROUND. Meteors scour the
  // surface during its wave, forcing you down into the cavern with it. ---
  wurm: {
    hp: 2000, speed: 6.5, radius: 1.3, height: 3.2, damage: 38, attackCd: 2.0, score: 5000,
    skin: 0x2b2436, accent: 0xff7a2e, blood: 0x9a5aff, rate: 2, reach: 2.4,
    gait: 'stomp', headY: 0.8, boss: true, deathTrauma: 0.8, voice: 0.3, name: 'THE WURM',
    build: buildWurm,
  },
  // --- BOSS: a storm-wraith that owns the SKY. The open ground surges with its
  // charge — live on the ring and the islands, fight it in the air. ---
  tempest: {
    hp: 2100, speed: 8, radius: 1.1, height: 2.6, damage: 26, attackCd: 2.6, score: 5000,
    skin: 0x39415a, accent: 0x9fd4ff, blood: 0xbfe4ff, rate: 6, reach: 1.6,
    gait: 'fly', flyer: true, cruise: 15, diveRange: -1, climb: 2, headY: 0.7,
    boss: true, deathTrauma: 0.6, voice: 0.5, name: 'THE TEMPEST', build: buildTempest,
  },
  // --- FINAL BOSS: a mountainous yeti in a whiteout that hurls giant snowballs
  // you can DASH-REFLECT back into it ---
  yeti: {
    hp: 2400, speed: 2.2, radius: 2.3, height: 7.2, damage: 40, attackCd: 2.7, score: 5000,
    skin: 0xaebfd2, accent: 0x8fe6ff, blood: 0xc4e2f2, rate: 2.0, reach: 4.0,
    gait: 'stomp', headY: 0.88, stomp: true, deathTrauma: 0.85, boss: true, thrower: true,
    voice: 0.32, name: 'THE YETI', build: buildYeti,
  },
};

// --- material + primitive helpers ----------------------------------------

// Skin is FLAT-SHADED by default so creatures read as faceted low-poly art
// (matching the trees/rocks), not smooth grey cylinders.
function skinMat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, flatShading: true });
}
// a self-lit accent that bursts through the bloom threshold at dusk
function glowMat(color, ei = 2.6) {
  return new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: color, emissiveIntensity: ei, roughness: 0.4, metalness: 0 });
}
function shade(hex, amt) { return new THREE.Color(hex).lerp(new THREE.Color(0x000000), amt).getHex(); }

// A bone: a tapered, faceted limb (hexagonal cross-section) with a chunky joint
// at the pivot and a knuckle/knob at the end — reads as a real limb, not a pipe.
// returns {group, mesh}; mesh is the tapered shaft used for hit detection.
function bone(mat, rTop, len, rBottom = null) {
  const rb = rBottom == null ? rTop * 0.68 : rBottom;
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(rTop, rb, len, 6, 1);
  geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; g.add(m);
  const joint = new THREE.Mesh(new THREE.IcosahedronGeometry(rTop * 1.08, 0), mat);
  joint.castShadow = true; g.add(joint);
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(rb * 1.35, 0), mat);
  knob.position.y = -len; knob.castShadow = true; g.add(knob);
  return { group: g, mesh: m };
}

// A little cluster of claws (angular cones) fanned around a point, facing +z/down.
function claws(mat, n, size, spread) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(size * 0.34, size, 4), mat);
    c.position.set((i - (n - 1) / 2) * spread, -size * 0.4, 0);
    c.rotation.x = Math.PI * 0.62; c.castShadow = true;
    g.add(c);
  }
  return g;
}

// ==========================================================================
// BUILDERS — each returns { root, parts, hitMeshes, skinMats, materials }
// ==========================================================================

function buildHusk(def) {
  const s = def.height / 1.9;
  const skin = skinMat(def.skin, 0.85);
  const bone_ = skinMat(shade(def.skin, 0.42), 0.8);   // darker bony detail
  const eyeM = glowMat(def.accent, 3.2);
  const materials = [skin, bone_, eyeM];
  const root = new THREE.Group();
  const hitMeshes = [];

  const hipH = 0.98 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);

  // gaunt, hunched ribcage torso (faceted, tapered to a thin waist)
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 * s, 1), skin);
  torso.scale.set(0.92, 1.28, 0.68); torso.position.set(0, 0.42 * s, 0.02 * s);
  torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  // exposed ribs
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.17 * s - i * 0.012 * s, 0.018 * s, 4, 8, Math.PI), bone_);
    rib.position.set(0, 0.55 * s - i * 0.12 * s, 0.13 * s); rib.rotation.x = Math.PI / 2 + 0.3; pelvis.add(rib);
  }
  // clavicle / bony shoulders
  for (const sx of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 * s, 0), bone_);
    sh.position.set(sx * 0.27 * s, 0.68 * s, 0); sh.castShadow = true; pelvis.add(sh);
  }

  // skull head: angular cranium + jutting jaw + brow ridge, sunk on a thin neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.08 * s, 0.16 * s, 6), skin);
  neck.position.y = 0.76 * s; pelvis.add(neck);
  const headG = new THREE.Group(); headG.position.set(0, 0.9 * s, 0.03 * s); pelvis.add(headG);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17 * s, 1), skin);
  head.scale.set(0.92, 1.05, 1.1); head.castShadow = true; headG.add(head);
  head.userData.hit = 'head'; hitMeshes.push(head);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.05 * s, 0.08 * s), bone_);
  brow.position.set(0, 0.05 * s, 0.13 * s); brow.rotation.x = -0.2; headG.add(brow);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.15 * s, 0.08 * s, 0.16 * s), skin);
  jaw.position.set(0, -0.12 * s, 0.1 * s); jaw.rotation.x = 0.15; headG.add(jaw);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03 * s, 6, 6), eyeM);
    eye.position.set(sx * 0.07 * s, 0.0, 0.13 * s); headG.add(eye);
  }

  const parts = { pelvis, torso, head: headG, hipH, s };
  // long gangly arms ending in claws
  for (const sx of [-1, 1]) {
    const arm = bone(skin, 0.08 * s, 0.76 * s, 0.05 * s);
    arm.group.position.set(sx * 0.28 * s, 0.66 * s, 0);
    arm.group.add(placedClaws(bone_, 4, 0.12 * s, 0.06 * s, -0.76 * s));
    pelvis.add(arm.group); parts[sx < 0 ? 'armL' : 'armR'] = arm.group; hitMeshes.push(arm.mesh);
  }
  // legs
  const legL = bone(skin, 0.11 * s, hipH, 0.07 * s); legL.group.position.set(-0.14 * s, hipH, 0);
  const legR = bone(skin, 0.11 * s, hipH, 0.07 * s); legR.group.position.set(0.14 * s, hipH, 0);
  for (const [l, sx] of [[legL, -1], [legR, 1]]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11 * s, 0.06 * s, 0.24 * s), bone_);
    foot.position.set(0, -hipH + 0.03 * s, 0.06 * s); l.group.add(foot);
  }
  root.add(legL.group, legR.group); parts.legL = legL.group; parts.legR = legR.group;
  hitMeshes.push(legL.mesh, legR.mesh);

  return { root, parts, hitMeshes, skinMats: [skin], materials };
}

// A claw cluster placed at the end of a limb group (y = endY).
function placedClaws(mat, n, size, spread, endY) {
  const g = claws(mat, n, size, spread);
  g.position.set(0, endY, 0.02);
  return g;
}

function buildStalker(def) {
  const s = def.height / 1.55;
  const skin = skinMat(def.skin, 0.7);
  const belly = skinMat(shade(def.skin, 0.35), 0.7);
  const glow = glowMat(def.accent, 2.1);
  const materials = [skin, belly, glow];
  const root = new THREE.Group();
  const hitMeshes = [];

  const hipH = 0.86 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);
  // lean, angular torso pitched forward (raptor stance)
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24 * s, 1), skin);
  torso.scale.set(0.8, 0.82, 1.5); torso.position.set(0, 0.28 * s, 0.18 * s); torso.rotation.x = 0.5;
  torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  // a long tail counterbalancing the lunge
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.95 * s, 5), skin);
  tail.position.set(0, 0.2 * s, -0.5 * s); tail.rotation.x = Math.PI / 2 - 0.35; tail.castShadow = true; pelvis.add(tail);
  // dorsal spine of glowing barbs, tallest over the shoulders
  for (let i = 0; i < 6; i++) {
    const h = (0.18 - Math.abs(i - 2) * 0.03) * s;
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, h, 4), glow);
    barb.position.set(0, 0.34 * s - i * 0.05 * s, 0.12 * s - i * 0.14 * s);
    barb.rotation.x = -0.5; pelvis.add(barb);
  }
  // elongated angular muzzle-head thrust forward and low, with a maw + fangs
  const headG = new THREE.Group(); headG.position.set(0, 0.5 * s, 0.42 * s); pelvis.add(headG);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13 * s, 0), skin);
  skull.scale.set(0.85, 0.8, 1.0); skull.castShadow = true; headG.add(skull);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 0.28 * s, 4), skin);
  snout.position.set(0, -0.01 * s, 0.18 * s); snout.rotation.x = Math.PI / 2; snout.castShadow = true; headG.add(snout);
  skull.userData.hit = 'head'; hitMeshes.push(skull);
  const maw = new THREE.Mesh(new THREE.BoxGeometry(0.11 * s, 0.03 * s, 0.22 * s), belly);
  maw.position.set(0, -0.05 * s, 0.14 * s); headG.add(maw);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035 * s, 6, 6), glow);
    eye.position.set(sx * 0.06 * s, 0.05 * s, 0.06 * s); headG.add(eye);
  }

  const parts = { pelvis, torso, head: headG, hipH, s };
  // long grasping arms hung forward, tipped with claws
  for (const sx of [-1, 1]) {
    const arm = bone(skin, 0.055 * s, 0.82 * s, 0.035 * s);
    arm.group.position.set(sx * 0.19 * s, 0.42 * s, 0.16 * s); arm.group.rotation.x = -0.5;
    arm.group.add(placedClaws(glow, 3, 0.11 * s, 0.05 * s, -0.82 * s));
    pelvis.add(arm.group); parts[sx < 0 ? 'armL' : 'armR'] = arm.group; hitMeshes.push(arm.mesh);
  }
  // digitigrade legs with a baked knee and a clawed foot
  const mkLeg = (sx) => {
    const g = new THREE.Group(); g.position.set(sx * 0.13 * s, hipH, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.055 * s, 0.36 * s, 6), skin);
    thigh.position.set(0, -0.2 * s, 0.1 * s); thigh.rotation.x = 0.5; thigh.castShadow = true; g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.03 * s, 0.4 * s, 6), skin);
    shin.position.set(0, -0.54 * s, -0.03 * s); shin.rotation.x = -0.38; shin.castShadow = true; g.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.045 * s, 0.2 * s), skin);
    foot.position.set(0, -0.8 * s, 0.08 * s); g.add(foot);
    foot.add(placedClaws(glow, 3, 0.07 * s, 0.045 * s, 0.11 * s));
    hitMeshes.push(thigh, shin);
    return g;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  root.add(legL, legR); parts.legL = legL; parts.legR = legR;

  return { root, parts, hitMeshes, skinMats: [skin], materials };
}

function buildJuggernaut(def) {
  const s = def.height / 2.85;
  const armor = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.5, metalness: 0.35, flatShading: true });
  const plate = new THREE.MeshStandardMaterial({ color: 0x2a2c36, roughness: 0.45, metalness: 0.45, flatShading: true });
  const core = glowMat(def.accent, 3.2);
  const materials = [armor, plate, core];
  const root = new THREE.Group();
  const hitMeshes = [];

  const hipH = 1.15 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);
  // huge broad chest block
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1 * s, 0.95 * s, 0.72 * s), armor);
  torso.position.y = 0.5 * s; torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  // bevel it with a smaller upper block
  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.28 * s, 0.42 * s, 0.66 * s), plate);
  upper.position.y = 0.9 * s; upper.castShadow = true; pelvis.add(upper);
  // glowing molten core + cracks radiating across the chest
  const coreO = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 12, 10), core);
  coreO.position.set(0, 0.52 * s, 0.36 * s); pelvis.add(coreO);
  for (let i = 0; i < 7; i++) {
    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.045 * s, rand(0.22, 0.4) * s, 0.02 * s), core);
    cr.position.set(rand(-0.45, 0.45) * s, 0.5 * s + rand(-0.28, 0.28) * s, 0.37 * s);
    cr.rotation.z = rand(-1.2, 1.2); pelvis.add(cr);
  }
  // a glowing seam under each pauldron
  for (const sx of [-1, 1]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.04 * s, 0.5 * s), core);
    seam.position.set(sx * 0.5 * s, 0.72 * s, 0.02 * s); seam.rotation.z = sx * 0.25; pelvis.add(seam);
  }

  // molten veins + a joint ember running down a limb (children of the bone, so
  // they flex with the swing). reuses the emissive `core` material.
  const addVeins = (g, len, r, n) => {
    for (let k = 0; k < n; k++) {
      const a = rand(-1.15, 1.15);                       // around the front of the limb
      const y = -len * (0.14 + (k / n) * 0.72 + rand(-0.04, 0.04));
      const h = rand(0.14, 0.28) * len;
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.035 * s, h, 0.028 * s), core);
      v.position.set(Math.sin(a) * r * 0.92, y, Math.cos(a) * r * 0.92);
      v.rotation.set(0, -a, rand(-0.5, 0.5));
      g.add(v);
    }
    const ember = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 8, 7), core);
    ember.position.set(0, -len * 0.52, r * 0.5); g.add(ember);
  };
  // massive pauldrons
  for (const sx of [-1, 1]) {
    const pa = new THREE.Mesh(new THREE.SphereGeometry(0.34 * s, 10, 8), plate);
    pa.position.set(sx * 0.72 * s, 0.95 * s, 0); pa.scale.set(1, 0.85, 1); pa.castShadow = true; pelvis.add(pa);
  }
  // tiny head sunk between the shoulders
  const headG = new THREE.Group(); headG.position.y = 1.12 * s; pelvis.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16 * s, 10, 9), armor);
  head.castShadow = true; headG.add(head);
  head.userData.hit = 'head'; hitMeshes.push(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03 * s, 6, 6), core);
    eye.position.set(sx * 0.06 * s, 0.02 * s, 0.14 * s); headG.add(eye);
  }

  const parts = { pelvis, torso, head: headG, hipH, s };
  // gigantic arms
  const armL = bone(armor, 0.19 * s, 1.15 * s); armL.group.position.set(-0.78 * s, 0.86 * s, 0);
  const armR = bone(armor, 0.19 * s, 1.15 * s); armR.group.position.set(0.78 * s, 0.86 * s, 0);
  for (const a of [armL, armR]) {
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.24 * s, 9, 8), plate); fist.position.y = -1.05 * s; a.group.add(fist); fist.castShadow = true;
    // molten knuckles glowing inside the fist
    const knuck = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 8, 7), core); knuck.position.set(0, -1.05 * s, 0.16 * s); a.group.add(knuck);
    addVeins(a.group, 1.15 * s, 0.19 * s, 4);
  }
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);
  // thick legs
  const legL = bone(armor, 0.2 * s, hipH); legL.group.position.set(-0.34 * s, hipH, 0);
  const legR = bone(armor, 0.2 * s, hipH); legR.group.position.set(0.34 * s, hipH, 0);
  for (const l of [legL, legR]) addVeins(l.group, hipH, 0.2 * s, 4);
  root.add(legL.group, legR.group); parts.legL = legL.group; parts.legR = legR.group;
  hitMeshes.push(legL.mesh, legR.mesh);

  return { root, parts, hitMeshes, skinMats: [armor, plate], materials };
}

function buildWisp(def) {
  const s = def.height / 2.1;
  const robe = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.86, emissive: def.accent, emissiveIntensity: 0.25 });
  const core = glowMat(def.accent, 3.4);
  const materials = [robe, core];
  const root = new THREE.Group();
  const hitMeshes = [];

  // pelvis sits high; no legs — a tapering wraith
  const hipH = 1.15 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28 * s, 0.5 * s, 6, 12), robe);
  torso.position.y = 0.28 * s; torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  // tattered tail cone fading down to nothing
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3 * s, 1.0 * s, 10, 1, true), robe);
  tail.position.y = -0.35 * s; tail.rotation.x = Math.PI; pelvis.add(tail);
  // hooded head
  const headG = new THREE.Group(); headG.position.y = 0.72 * s; pelvis.add(headG);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.22 * s, 0.4 * s, 10), robe);
  hood.position.y = 0.05 * s; hood.castShadow = true; headG.add(hood);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15 * s, 10, 9), core);
  head.material = core; head.position.y = -0.02 * s; headG.add(head);
  head.userData.hit = 'head'; hitMeshes.push(head);
  // glowing chest core
  const coreO = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 10, 9), core);
  coreO.position.set(0, 0.3 * s, 0.16 * s); pelvis.add(coreO);

  const parts = { pelvis, torso, head: headG, hipH, s, wisps: [] };
  // drifting sleeve-arms
  const armL = bone(robe, 0.08 * s, 0.62 * s); armL.group.position.set(-0.3 * s, 0.42 * s, 0); armL.group.rotation.z = 0.3;
  const armR = bone(robe, 0.08 * s, 0.62 * s); armR.group.position.set(0.3 * s, 0.42 * s, 0); armR.group.rotation.z = -0.3;
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);
  // trailing tatters that sway
  for (let i = 0; i < 3; i++) {
    const t = bone(robe, 0.05 * s, (0.5 + i * 0.12) * s);
    t.group.position.set((i - 1) * 0.16 * s, -0.1 * s, 0.05 * s);
    pelvis.add(t.group); parts.wisps.push(t.group);
  }

  return { root, parts, hitMeshes, skinMats: [], materials, softFade: [robe] };
}

function buildBloater(def) {
  const s = def.height / 2.2;
  const skin = skinMat(def.skin, 0.85);
  const sac = glowMat(def.accent, 2.4);
  const materials = [skin, sac];
  const root = new THREE.Group();
  const hitMeshes = [];

  const hipH = 0.72 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);
  // huge round belly
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.62 * s, 14, 12), skin);
  belly.position.y = 0.34 * s; belly.scale.set(1.05, 0.98, 1.05); belly.castShadow = true; pelvis.add(belly);
  belly.userData.hit = 'body'; hitMeshes.push(belly);
  // glowing pustule sacs clustered on the body
  const sacSpots = [[0.34, 0.5, 0.42], [-0.4, 0.3, 0.36], [0.12, 0.72, 0.34], [-0.2, 0.62, -0.4], [0.42, 0.2, -0.3], [0, 0.28, -0.5]];
  for (const [x, y, z] of sacSpots) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(rand(0.09, 0.15) * s, 8, 7), sac);
    p.position.set(x * s, y * s, z * s); pelvis.add(p);
  }
  // small head perched on top
  const headG = new THREE.Group(); headG.position.y = 0.92 * s; pelvis.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17 * s, 10, 9), skin);
  head.scale.set(1.1, 0.9, 1); head.castShadow = true; headG.add(head);
  head.userData.hit = 'head'; hitMeshes.push(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035 * s, 6, 6), sac);
    eye.position.set(sx * 0.07 * s, 0.02 * s, 0.15 * s); headG.add(eye);
  }

  const parts = { pelvis, torso: belly, head: headG, hipH, s, belly };
  // stubby thin arms
  const armL = bone(skin, 0.06 * s, 0.5 * s); armL.group.position.set(-0.56 * s, 0.5 * s, 0); armL.group.rotation.z = 0.4;
  const armR = bone(skin, 0.06 * s, 0.5 * s); armR.group.position.set(0.56 * s, 0.5 * s, 0); armR.group.rotation.z = -0.4;
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);
  // stubby legs
  const legL = bone(skin, 0.1 * s, hipH); legL.group.position.set(-0.22 * s, hipH, 0);
  const legR = bone(skin, 0.1 * s, hipH); legR.group.position.set(0.22 * s, hipH, 0);
  root.add(legL.group, legR.group); parts.legL = legL.group; parts.legR = legR.group;
  hitMeshes.push(legL.mesh, legR.mesh);

  return { root, parts, hitMeshes, skinMats: [skin], materials };
}

// A carrion bird: dark violet, swept angular wings, a glowing beak + talons. Its
// root sits at the body centre (it flies), and wingL/wingR flap in the animator.
function buildRaven(def) {
  const s = def.height / 1.3;
  const skin = skinMat(def.skin, 0.6);
  const dark = skinMat(shade(def.skin, 0.4), 0.6);
  const glow = glowMat(def.accent, 2.6);
  const materials = [skin, dark, glow];
  const root = new THREE.Group();
  const hitMeshes = [];

  // body centre acts as the "pelvis" pivot; flyers spawn/​move at this height
  const pelvis = new THREE.Group(); pelvis.position.y = 0; root.add(pelvis);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 * s, 1), skin);
  body.scale.set(0.7, 0.6, 1.35); body.castShadow = true; pelvis.add(body);
  body.userData.hit = 'body'; hitMeshes.push(body);

  // head + glowing beak thrust forward
  const headG = new THREE.Group(); headG.position.set(0, 0.08 * s, 0.42 * s); pelvis.add(headG);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15 * s, 0), skin);
  skull.castShadow = true; headG.add(skull);
  skull.userData.hit = 'head'; hitMeshes.push(skull);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07 * s, 0.28 * s, 4), glow);
  beak.rotation.x = Math.PI / 2; beak.position.z = 0.2 * s; headG.add(beak);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035 * s, 6, 6), glow);
    eye.position.set(sx * 0.08 * s, 0.05 * s, 0.07 * s); headG.add(eye);
  }

  const parts = { pelvis, torso: body, head: headG, hipH: 0, s };
  // wings: a shoulder group flapped about z; a swept membrane + angular primaries
  const mkWing = (sx) => {
    const w = new THREE.Group(); w.position.set(sx * 0.18 * s, 0.1 * s, 0);
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.04 * s, 0.42 * s), skin);
    main.position.set(sx * 0.5 * s, 0, -0.04 * s); main.rotation.y = sx * 0.35; main.castShadow = true; w.add(main);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.035 * s, 0.24 * s), dark);
    tip.position.set(sx * 0.98 * s, 0, -0.22 * s); tip.rotation.y = sx * 0.72; w.add(tip);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.95 * s, 0.05 * s, 0.05 * s), glow);
    edge.position.set(sx * 0.5 * s, 0.02 * s, 0.15 * s); edge.rotation.y = sx * 0.35; w.add(edge);
    pelvis.add(w); return w;
  };
  parts.wingL = mkWing(-1); parts.wingR = mkWing(1);

  // talons + a swept tail
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.22 * s, 4), glow);
    t.rotation.x = Math.PI; t.position.set(sx * 0.1 * s, -0.3 * s, 0.1 * s); pelvis.add(t);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.55 * s, 4), skin);
  tail.scale.set(1, 0.35, 1); tail.rotation.x = Math.PI / 2; tail.position.z = -0.5 * s; pelvis.add(tail);

  return { root, parts, hitMeshes, skinMats: [skin], materials, headHitY: 0.12 * s };
}

// A hovering caster/sniper: a robed floating body with a bright charged eye and a
// halo of shards. Legless like the wisp; it holds altitude and fires bolts.
function buildSeer(def) {
  const s = def.height / 1.8;
  const robe = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.85, metalness: 0, flatShading: true, transparent: true, opacity: 0.92 });
  const glow = glowMat(def.accent, 3.0);
  const materials = [robe, glow];
  const root = new THREE.Group();
  const hitMeshes = [];

  const pelvis = new THREE.Group(); pelvis.position.y = 0; root.add(pelvis);
  const torso = new THREE.Mesh(new THREE.ConeGeometry(0.34 * s, 1.05 * s, 7), robe);
  torso.position.y = -0.1 * s; torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  // hooded head with a single charged eye (also the "muzzle" of its bolt)
  const headG = new THREE.Group(); headG.position.y = 0.5 * s; pelvis.add(headG);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.26 * s, 0.42 * s, 7), robe);
  hood.position.y = 0.02 * s; hood.castShadow = true; headG.add(hood);
  headG.userData.hit = 'head';
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12 * s, 12, 10), glow);
  eye.position.set(0, -0.02 * s, 0.16 * s); headG.add(eye);
  eye.userData.hit = 'head'; hitMeshes.push(eye);
  // a slow-orbiting halo of shards (charges up before a shot)
  const halo = new THREE.Group(); halo.position.y = 0.15 * s; pelvis.add(halo);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 * s, 0), glow);
    sh.position.set(Math.cos(a) * 0.5 * s, 0, Math.sin(a) * 0.5 * s); halo.add(sh);
  }
  const parts = { pelvis, torso, head: headG, halo, eye, hipH: 0, s, wisps: [] };
  // drifting sleeve-arms cupped forward (aiming)
  const armL = bone(robe, 0.07 * s, 0.5 * s); armL.group.position.set(-0.26 * s, 0.1 * s, 0.12 * s); armL.group.rotation.set(-0.6, 0, 0.4);
  const armR = bone(robe, 0.07 * s, 0.5 * s); armR.group.position.set(0.26 * s, 0.1 * s, 0.12 * s); armR.group.rotation.set(-0.6, 0, -0.4);
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);

  return { root, parts, hitMeshes, skinMats: [], materials, softFade: [robe], muzzleY: 0.65 * s, muzzleZ: 0.3 * s, headHitY: 0.3 * s };
}

// THE WURM — a segmented chitin serpent. The BEHAVIOUR positions the head and
// each segment in world space every frame (the group stays at the origin), so
// the builder just makes the pieces. Buried segments sit below the cave floor,
// where the rock physically blocks your shots — eruptions are the damage window.
function buildWurm(def) {
  const chitin = skinMat(def.skin, 0.6);
  const plateM = skinMat(shade(def.skin, 0.3), 0.55);
  const magma = glowMat(def.accent, 2.6);
  const materials = [chitin, plateM, magma];
  const root = new THREE.Group();
  const hitMeshes = [];

  // head: an armored wedge with mandibles + furnace eyes
  const headG = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), chitin);
  skull.scale.set(1, 0.9, 1.35); skull.castShadow = true; headG.add(skull);
  skull.userData.hit = 'head'; hitMeshes.push(skull);
  for (const sx of [-1, 1]) {
    const mand = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 5), plateM);
    mand.position.set(sx * 0.55, -0.35, 1.15); mand.rotation.x = Math.PI * 0.42; mand.rotation.z = sx * 0.3;
    headG.add(mand);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), magma);
    eye.position.set(sx * 0.42, 0.28, 0.85); headG.add(eye);
  }
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 5), plateM);
  crest.position.set(0, 0.85, -0.2); crest.rotation.x = -0.5; headG.add(crest);
  headG.position.y = -40; root.add(headG);

  // body segments: armored rings with a magma seam, tapering to the tail
  const segs = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const r = 1.0 - i * 0.09;
    const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? plateM : chitin);
    seg.scale.set(1, 0.92, 0.85); seg.castShadow = true; g.add(seg);
    seg.userData.hit = 'body'; hitMeshes.push(seg);
    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.85, 0.09, 6, 12), magma);
    band.rotation.y = Math.PI / 2; g.add(band);
    g.position.y = -40;
    root.add(g); segs.push(g);
  }

  const parts = { head: headG, segs, pelvis: headG, hipH: 0, s: 1 };
  return { root, parts, hitMeshes, skinMats: [chitin, plateM], materials };
}

// THE TEMPEST — a vast storm-wraith: swept lightning-edged wings, a crackling
// core, a crown of shards. Flies its own orbit (custom behaviour).
function buildTempest(def) {
  const body = skinMat(def.skin, 0.55);
  const dark = skinMat(shade(def.skin, 0.35), 0.6);
  const bolt = glowMat(def.accent, 3.0);
  const materials = [body, dark, bolt];
  const root = new THREE.Group();
  const hitMeshes = [];

  const pelvis = new THREE.Group(); root.add(pelvis);
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), body);
  torso.scale.set(1, 0.82, 1.45); torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 9), bolt);
  core.position.set(0, -0.1, 0.45); pelvis.add(core);
  core.userData.hit = 'body'; hitMeshes.push(core);

  const headG = new THREE.Group(); headG.position.set(0, 0.4, 1.15); pelvis.add(headG);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), dark);
  skull.castShadow = true; headG.add(skull);
  skull.userData.hit = 'head'; hitMeshes.push(skull);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), bolt);
    eye.position.set(sx * 0.18, 0.08, 0.3); headG.add(eye);
  }
  for (let i = 0; i < 5; i++) {   // crown of storm shards
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6 + (i % 3) * 0.2, 4), bolt);
    sh.position.set((i - 2) * 0.22, 0.55, -0.1); sh.rotation.x = -0.4; headG.add(sh);
  }
  const mkWing = (sx) => {
    const w = new THREE.Group(); w.position.set(sx * 0.5, 0.25, 0);
    const main = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.15), body);
    main.position.set(sx * 1.4, 0, -0.1); main.rotation.y = sx * 0.4; main.castShadow = true; w.add(main);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.6), dark);
    tip.position.set(sx * 2.8, 0, -0.55); tip.rotation.y = sx * 0.8; w.add(tip);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 0.12), bolt);
    edge.position.set(sx * 1.4, 0.05, 0.42); edge.rotation.y = sx * 0.4; w.add(edge);
    pelvis.add(w); return w;
  };
  const parts = { pelvis, torso, head: headG, hipH: 0, s: 1 };
  parts.wingL = mkWing(-1); parts.wingR = mkWing(1);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 5), body);
  tail.scale.set(1, 1, 0.4); tail.rotation.x = Math.PI / 2; tail.position.z = -1.5; pelvis.add(tail);

  return { root, parts, hitMeshes, skinMats: [body, dark], materials, headHitY: 0.75 };
}

// THE MEGALITH — stacked stone slabs given a slow, terrible will. Rune-green
// seams glow between the slabs; a ring of pebbles orbits its shoulders.
function buildMegalith(def) {
  const stone = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.95, metalness: 0.05, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x40463f, roughness: 0.95, metalness: 0.05, flatShading: true });
  const rune = glowMat(def.accent, 2.4);
  const materials = [stone, dark, rune];
  const root = new THREE.Group();
  const hitMeshes = [];
  const s = def.height / 3.4;

  const hipH = 1.35 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);
  // torso: three offset slabs
  const slabs = [[1.5, 0.7, 1.0, 0.35, 0.06], [1.3, 0.65, 0.9, 0.95, -0.1], [1.05, 0.55, 0.8, 1.5, 0.08]];
  for (const [w, h, d, y, rz] of slabs) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, d * s), stone);
    slab.position.y = y * s; slab.rotation.y = rz * 2; slab.rotation.z = rz;
    slab.castShadow = true; pelvis.add(slab);
    slab.userData.hit = 'body'; hitMeshes.push(slab);
  }
  // rune seams glowing between slabs
  for (const y of [0.66, 1.24]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.15 * s, 0.07 * s, 0.75 * s), rune);
    seam.position.y = y * s; pelvis.add(seam);
  }
  // head: a small capstone with one rune eye
  const headG = new THREE.Group(); headG.position.y = 1.95 * s; pelvis.add(headG);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.45 * s, 0.6 * s), dark);
  cap.rotation.y = 0.3; cap.castShadow = true; headG.add(cap);
  cap.userData.hit = 'head'; hitMeshes.push(cap);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 8, 8), rune);
  eye.position.set(0, 0.02 * s, 0.3 * s); headG.add(eye);
  // orbiting pebbles (animated in update via parts.orbit)
  const orbit = new THREE.Group(); orbit.position.y = 1.6 * s; pelvis.add(orbit);
  for (let i = 0; i < 4; i++) {
    const peb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11 * s, 0), dark);
    peb.position.set(Math.cos(i * 1.57) * 1.1 * s, Math.sin(i * 2.3) * 0.15 * s, Math.sin(i * 1.57) * 1.1 * s);
    orbit.add(peb);
  }
  const parts = { pelvis, head: headG, orbit, hipH, s };
  // massive block arms
  const armL = bone(stone, 0.24 * s, 1.5 * s); armL.group.position.set(-0.95 * s, 1.15 * s, 0);
  const armR = bone(stone, 0.24 * s, 1.5 * s); armR.group.position.set(0.95 * s, 1.15 * s, 0);
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);
  // squat block legs
  const legL = bone(stone, 0.26 * s, hipH); legL.group.position.set(-0.5 * s, hipH, 0);
  const legR = bone(stone, 0.26 * s, hipH); legR.group.position.set(0.5 * s, hipH, 0);
  root.add(legL.group, legR.group); parts.legL = legL.group; parts.legR = legR.group;
  hitMeshes.push(legL.mesh, legR.mesh);

  return { root, parts, hitMeshes, skinMats: [stone, dark], materials };
}

function buildColossus(def) {
  const s = def.height / 5.0;
  const armor = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.6, metalness: 0.3, flatShading: true });
  const plate = new THREE.MeshStandardMaterial({ color: 0x241c1e, roughness: 0.5, metalness: 0.45, flatShading: true });
  const core = glowMat(def.accent, 3.2);
  const materials = [armor, plate, core];
  const root = new THREE.Group();
  const hitMeshes = [];

  const hipH = 2.2 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);

  // colossal chest — two stacked blocks
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.3 * s, 1.9 * s, 1.4 * s), armor);
  torso.position.y = 0.9 * s; torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(2.7 * s, 0.9 * s, 1.3 * s), plate);
  upper.position.y = 1.75 * s; upper.castShadow = true; pelvis.add(upper);

  // huge exposed molten core (the glowing heart) + a cracked ring around it
  const coreO = new THREE.Mesh(new THREE.SphereGeometry(0.55 * s, 16, 14), core);
  coreO.position.set(0, 0.95 * s, 0.7 * s); pelvis.add(coreO);
  coreO.userData.hit = 'body'; hitMeshes.push(coreO);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 * s, 0.1 * s, 8, 20), plate);
  ring.position.set(0, 0.95 * s, 0.72 * s); pelvis.add(ring);

  // enormous pauldrons
  for (const sx of [-1, 1]) {
    const pa = new THREE.Mesh(new THREE.SphereGeometry(0.72 * s, 12, 10), plate);
    pa.position.set(sx * 1.5 * s, 1.7 * s, 0); pa.scale.set(1, 0.8, 1); pa.castShadow = true; pelvis.add(pa);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22 * s, 0.8 * s, 6), plate);
    spike.position.set(sx * 1.6 * s, 2.2 * s, 0); spike.rotation.z = sx * -0.4; pelvis.add(spike);
  }

  // small brutal head sunk between the shoulders
  const headG = new THREE.Group(); headG.position.y = 2.35 * s; pelvis.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34 * s, 12, 10), armor);
  head.scale.set(1, 1.1, 1.05); head.castShadow = true; headG.add(head);
  head.userData.hit = 'head'; hitMeshes.push(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07 * s, 6, 6), core);
    eye.position.set(sx * 0.12 * s, 0.03 * s, 0.28 * s); headG.add(eye);
  }
  // a horn crown
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 0.5 * s, 6), plate);
    horn.position.set(sx * 0.2 * s, 0.35 * s, 0); horn.rotation.z = sx * -0.5; headG.add(horn);
  }

  const parts = { pelvis, torso, head: headG, hipH, s };

  // molten veins for the limbs, reusing the emissive core
  const addVeins = (g, len, r, n) => {
    for (let k = 0; k < n; k++) {
      const a = rand(-1.15, 1.15);
      const y = -len * (0.14 + (k / n) * 0.72);
      const h = rand(0.16, 0.3) * len;
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, h, 0.05 * s), core);
      v.position.set(Math.sin(a) * r * 0.92, y, Math.cos(a) * r * 0.92);
      v.rotation.set(0, -a, rand(-0.5, 0.5));
      g.add(v);
    }
    const ember = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 8, 7), core);
    ember.position.set(0, -len * 0.52, r * 0.5); g.add(ember);
  };
  // chest cracks radiating from the core
  for (let i = 0; i < 8; i++) {
    const cr = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, rand(0.5, 1.0) * s, 0.04 * s), core);
    cr.position.set(rand(-0.9, 0.9) * s, 0.9 * s + rand(-0.5, 0.5) * s, 0.71 * s);
    cr.rotation.z = rand(-1.2, 1.2); pelvis.add(cr);
  }

  // gigantic arms with fists
  const armL = bone(armor, 0.38 * s, 2.3 * s); armL.group.position.set(-1.6 * s, 1.6 * s, 0);
  const armR = bone(armor, 0.38 * s, 2.3 * s); armR.group.position.set(1.6 * s, 1.6 * s, 0);
  for (const a of [armL, armR]) {
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.5 * s, 10, 9), plate); fist.position.y = -2.1 * s; a.group.add(fist); fist.castShadow = true;
    const knuck = new THREE.Mesh(new THREE.SphereGeometry(0.24 * s, 8, 7), core); knuck.position.set(0, -2.1 * s, 0.34 * s); a.group.add(knuck);
    addVeins(a.group, 2.3 * s, 0.38 * s, 5);
  }
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);

  // massive legs
  const legL = bone(armor, 0.42 * s, hipH); legL.group.position.set(-0.7 * s, hipH, 0);
  const legR = bone(armor, 0.42 * s, hipH); legR.group.position.set(0.7 * s, hipH, 0);
  for (const l of [legL, legR]) addVeins(l.group, hipH, 0.42 * s, 5);
  root.add(legL.group, legR.group); parts.legL = legL.group; parts.legR = legR.group;
  hitMeshes.push(legL.mesh, legR.mesh);

  return { root, parts, hitMeshes, skinMats: [armor, plate], materials };
}

// scatter shaggy fur tufts (little flat-shaded cones) over a parent for a AAA
// silhouette without a skinned mesh
function furTufts(parent, mat, n, cx, cy, cz, spread, len) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), r = rand(0, spread);
    const t = new THREE.Mesh(new THREE.ConeGeometry(len * rand(0.18, 0.3), len * rand(0.7, 1.3), 4), mat);
    t.position.set(cx + Math.cos(a) * r, cy + rand(-spread * 0.5, spread * 0.5), cz + Math.sin(a) * r);
    t.rotation.set(rand(-0.6, 0.6), rand(0, Math.PI), rand(-0.6, 0.6));
    parent.add(t);
  }
}

// THE YETI — a mountainous shaggy brute of ice and fur. Broad hunched body under a
// mane, ice-blue eyes + shards, huge fists it winds back to hurl snowballs.
function buildYeti(def) {
  const s = def.height / 7.2;
  const fur = skinMat(def.skin, 0.92);
  const fur2 = skinMat(shade(def.skin, 0.24), 0.92);
  const belly = new THREE.MeshStandardMaterial({ color: 0xeef4fb, roughness: 0.9, metalness: 0, flatShading: true });
  const ice = glowMat(def.accent, 3.0);
  const dark = skinMat(0x232a36, 0.7);
  const materials = [fur, fur2, belly, ice, dark];
  const root = new THREE.Group();
  const hitMeshes = [];

  const hipH = 3.0 * s;
  const pelvis = new THREE.Group(); pelvis.position.y = hipH; root.add(pelvis);

  // huge hunched torso
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 * s, 1), fur);
  torso.scale.set(1.15, 1.15, 0.95); torso.position.y = 0.55 * s; torso.castShadow = true; pelvis.add(torso);
  torso.userData.hit = 'body'; hitMeshes.push(torso);
  // pale belly
  const gut = new THREE.Mesh(new THREE.SphereGeometry(1.05 * s, 12, 10), belly);
  gut.scale.set(1.0, 1.05, 0.8); gut.position.set(0, 0.3 * s, 0.55 * s); pelvis.add(gut);
  // shaggy mane over shoulders/chest
  furTufts(pelvis, fur, 26, 0, 1.1 * s, 0, 1.5 * s, 0.7 * s);
  furTufts(pelvis, fur2, 18, 0, 0.5 * s, -0.4 * s, 1.4 * s, 0.6 * s);

  // massive shoulders with jutting ice shards
  for (const sx of [-1, 1]) {
    const pa = new THREE.Mesh(new THREE.SphereGeometry(0.85 * s, 12, 10), fur);
    pa.position.set(sx * 1.5 * s, 1.35 * s, 0); pa.castShadow = true; pelvis.add(pa);
    furTufts(pelvis, fur2, 8, sx * 1.5 * s, 1.35 * s, 0, 0.7 * s, 0.55 * s);
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.14 * s, rand(0.7, 1.2) * s, 5), ice);
      shard.position.set(sx * (1.3 + i * 0.18) * s, (1.7 + rand(0, 0.4)) * s, rand(-0.4, 0.2) * s);
      shard.rotation.z = sx * rand(-0.5, -0.1); shard.rotation.x = rand(-0.4, 0.2); pelvis.add(shard);
    }
  }
  // a ridge of ice shards down the back
  for (let i = 0; i < 4; i++) {
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, (0.9 - i * 0.12) * s, 5), ice);
    shard.position.set(0, (1.5 - i * 0.28) * s, (-0.9 - i * 0.03) * s); shard.rotation.x = -0.7; pelvis.add(shard);
  }

  // brutal head: broad skull, heavy brow, glowing eyes, tusked maw, fur ruff
  const headG = new THREE.Group(); headG.position.set(0, 2.0 * s, 0.15 * s); pelvis.add(headG);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62 * s, 1), fur);
  head.scale.set(1.05, 0.95, 1.0); head.castShadow = true; headG.add(head);
  head.userData.hit = 'head'; hitMeshes.push(head);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.16 * s, 0.3 * s), fur2);
  brow.position.set(0, 0.16 * s, 0.44 * s); brow.rotation.x = -0.25; headG.add(brow);
  const maw = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.26 * s, 0.32 * s), dark);
  maw.position.set(0, -0.28 * s, 0.42 * s); headG.add(maw);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 8, 8), ice);
    eye.position.set(sx * 0.22 * s, 0.02 * s, 0.5 * s); headG.add(eye);
    // lower tusks
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.06 * s, 0.28 * s, 5), belly);
    tusk.position.set(sx * 0.16 * s, -0.2 * s, 0.5 * s); headG.add(tusk);
  }
  furTufts(headG, fur, 14, 0, 0.1 * s, -0.2 * s, 0.7 * s, 0.5 * s);   // mane ruff

  const parts = { pelvis, torso, head: headG, hipH, s };

  // gigantic arms; the RIGHT is the throwing arm (behaviour rotates parts.armR)
  const armL = bone(fur, 0.4 * s, 2.6 * s); armL.group.position.set(-1.7 * s, 1.25 * s, 0);
  const armR = bone(fur, 0.4 * s, 2.6 * s); armR.group.position.set(1.7 * s, 1.25 * s, 0);
  for (const a of [armL, armR]) {
    const fist = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * s, 0), fur2); fist.position.y = -2.5 * s; fist.castShadow = true; a.group.add(fist);
    for (let i = 0; i < 4; i++) {   // claws
      const cl = new THREE.Mesh(new THREE.ConeGeometry(0.08 * s, 0.34 * s, 4), belly);
      cl.position.set((i - 1.5) * 0.16 * s, -2.9 * s, 0.28 * s); cl.rotation.x = 1.2; a.group.add(cl);
    }
    furTufts(a.group, fur, 8, 0, -1.2 * s, 0, 0.45 * s, 0.5 * s);
  }
  pelvis.add(armL.group, armR.group); parts.armL = armL.group; parts.armR = armR.group;
  hitMeshes.push(armL.mesh, armR.mesh);

  // thick legs + big feet
  const legL = bone(fur, 0.5 * s, hipH); legL.group.position.set(-0.8 * s, hipH, 0);
  const legR = bone(fur, 0.5 * s, hipH); legR.group.position.set(0.8 * s, hipH, 0);
  for (const [l, sx] of [[legL, -1], [legR, 1]]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.4 * s, 1.1 * s), fur2);
    foot.position.set(0, -hipH + 0.2 * s, 0.35 * s); foot.castShadow = true; l.group.add(foot);
    furTufts(l.group, fur, 6, 0, -0.8 * s, 0, 0.4 * s, 0.5 * s);
  }
  root.add(legL.group, legR.group); parts.legL = legL.group; parts.legR = legR.group;
  hitMeshes.push(legL.mesh, legR.mesh);

  // world-space fist muzzle for the throw (relative to enemy pos): high + forward
  return { root, parts, hitMeshes, skinMats: [fur, fur2], materials, muzzleY: 5.2 * s, muzzleZ: 1.6 * s };
}

// ==========================================================================

export class Enemy {
  constructor(mgr, typeName, pos, hpScale, speedScale) {
    this.mgr = mgr;
    this.type = typeName;
    this.def = TYPES[typeName];
    this.alive = true;
    this.maxHealth = this.def.hp * hpScale;
    this.health = this.maxHealth;
    this.speed = this.def.speed * speedScale;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.knockback = new THREE.Vector3();
    this.attackTimer = rand(0.2, this.def.attackCd);
    this.phase = rand(0, Math.PI * 2);
    this.flash = 0;
    this.facing = 0;
    this.spawnT = 0;
    this.deathT = -1;
    this.hurtLean = 0;
    this.growlCd = rand(1, 5);
    this.lungeCd = rand(1.5, 3.5);
    this.lunging = 0;
    this.weavePhase = rand(0, Math.PI * 2);
    this.bob = 0;
    this._stepSign = 0;
    this.enraged = false;
    this.boss = !!this.def.boss;
    this._beacon = null;
    this._slamT = -1;              // boss slam windup timer (-1 = idle)
    this._addCd = rand(6, 9);     // boss add-spawn cooldown
    this._enrageDmg = 1;
    this._stagger = 0;            // yeti reel after a reflected snowball
    this._swoopClimb = 0;        // raven pull-up timer after a diving strike

    const built = this.def.build(this.def);
    this.group = built.root;
    this.parts = built.parts;
    this.materials = built.materials;
    this.skinMats = built.skinMats;          // tinted white on hit-flash
    this.softFade = built.softFade || [];    // materials with a base opacity < 1
    this._baseColors = this.skinMats.map((m) => m.color.clone());
    this.mat = this.materials[0];            // legacy alias
    this.hitMeshes = built.hitMeshes;
    this.group.userData.parts = this.parts;
    this.group.userData.hitMeshes = this.hitMeshes;
    for (const m of this.hitMeshes) m.userData.enemy = this;

    this.pos.y = this.mgr.groundFor(this.pos.x, this.pos.z, this.pos.y) + (this.def.hover || 0);
    // flyers spawn already aloft at their cruise altitude (surface only)
    if (this.def.flyer) this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z) + this.def.cruise;
    this.flyY = this.pos.y;
    this._inWater = false;         // pond wading (for the splash)
    this.frozenT = 0;              // encased when the pond froze around it
    this._ent = new THREE.Vector3();
    this.elite = null;             // 'blazing' | 'frost' | 'volatile' | 'gilded'
    this.scoreMult = 1;
    this._flank = Math.random() < 0.5 ? 1 : -1;   // which side a flanker arcs to
    this._quakeCd = rand(3, 6);    // megalith stomp cooldown
    this._quakeT = -1;             // telegraph timer
    this._ring = null;             // live quake ring { r, hit }
    this._chgCd = rand(4, 7);      // juggernaut charge cooldown
    this._chgState = 0;            // 0 idle, 1 telegraph, 2 charging
    this._chgT = 0; this._chgDir = new THREE.Vector3();
    this._stunT = 0;               // stunned after crashing into an obstacle
    this._fusing = -1;             // bloater self-destruct fuse
    this._deathVy = 0;
    this.shootTimer = rand(1.4, this.def.attackCd || 2.5);   // seer bolt cadence
    this._chargeT = -1;                                        // >=0 while telegraphing a shot
    // seer's world-space muzzle offset (from its build)
    this._muzzleY = built.muzzleY || this.def.height * 0.6;
    this._muzzleZ = built.muzzleZ || 0;
    // for flyers (body-centred), the local Y above which a hit counts as a headshot
    this._headHitY = built.headHitY || 0;
    this._addVeins();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.01);
    mgr.scene.add(this.group);
  }

  // MAGMA VEINS: every grounded creature carries glowing cracks in its hide,
  // in its signature accent colour — so the horde reads at a glance even in
  // fog, NIGHTFALL waves, or the underground dark.
  _addVeins() {
    if (this.def.flyer) return;   // ravens are already lit by their wing edges
    const anchor = this.parts.pelvis || this.group;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a0a12, emissive: this.def.accent, emissiveIntensity: 3.2, roughness: 0.4, flatShading: true,
    });
    const big = this.def.radius >= 0.9;
    const n = big ? 5 : 3;
    const rr = this.def.radius * 0.6;
    const spanY = Math.max(0.5, this.def.height * 0.3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.055, rand(0.3, 0.3 + spanY * 0.7), 0.055), mat);
      crack.position.set(Math.cos(a) * rr, rand(-0.1, spanY), Math.sin(a) * rr);
      crack.rotation.set(rand(-0.4, 0.4), a, rand(-0.5, 0.5));
      anchor.add(crack);
    }
    // a molten droplet running down from one of the cracks
    const drip = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), mat);
    const da = rand(0, Math.PI * 2);
    drip.position.set(Math.cos(da) * rr, -0.05, Math.sin(da) * rr);
    anchor.add(drip);
    this.materials.push(mat);
  }

  // Turn this enemy into an ELITE: aura-tinted, crowned with an orbiting shard,
  // tougher and meaner — each kind bends a different rule (Risk-of-Rain style).
  makeElite(kind) {
    if (this.boss || this.elite) return;
    this.elite = kind;
    const AURAS = { blazing: 0xff7a2e, frost: 0x9fd8ff, volatile: 0xba7bff, gilded: 0xffd24a };
    const aura = new THREE.Color(AURAS[kind] || 0xffffff);
    if (kind !== 'gilded') {
      this.maxHealth *= 2.2; this.health *= 2.2;
      this._enrageDmg *= 1.4;
      this.scoreMult = 1.6;
    } else this.scoreMult = 2.5;
    // permanent aura tint (flash logic keeps working off _baseColors)
    for (const c of this._baseColors) c.lerp(aura, 0.42);
    this._applyFlash();
    // a glowing crown-shard that orbits overhead
    const m = new THREE.MeshBasicMaterial({ color: AURAS[kind] || 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), m);
    orb.position.y = this.def.height + 0.55;
    this.group.add(orb);
    this._eliteOrb = orb;
    this.materials.push(m);
  }

  isHeadshot(point) {
    // grounded models put the origin at the feet (headY is a fraction of height);
    // flyer models are body-centred, so their head sits just above the origin.
    if (this.def.flyer) return point.y > this.pos.y + this._headHitY;
    return point.y > this.pos.y + this.def.height * (this.def.headY || 0.78);
  }

  takeDamage(dmg, point, dir, isHead) {
    if (!this.alive) return false;
    if (this.frozenT > 0) dmg *= 1.5;   // encased in ice = brittle
    this.health -= dmg;
    this.flash = 1;
    this.hurtLean = clamp((dir.x * Math.sin(this.facing) + dir.z * Math.cos(this.facing)), -1, 1) * 0.25;
    let kb = (isHead ? 3.5 : 2.2) * (this.def.gait === 'stomp' ? 0.35 : 1);
    if (this.elite === 'frost') kb *= 0.35;   // frost elites barely budge
    this.knockback.addScaledVector(dir, kb); this.knockback.y = 0;
    const pan = this.mgr.panFor(this.pos);
    this.mgr.fx.bloodBurst(point, dir, isHead ? 1.6 : 1, this.def.blood);
    this.mgr.audio.enemyHit(pan, this.def.voice);
    if (this.health <= 0) { this._die(point, dir, isHead); return true; }
    return false;
  }

  _die(point, dir, isHead) {
    this.alive = false;
    this.deathT = 0;
    this.knockback.addScaledVector(dir, this.def.gait === 'stomp' ? 0.8 : 2.5);
    this._fallDir = Math.atan2(dir.x, dir.z);
    const pan = this.mgr.panFor(this.pos);
    // flyer models are body-centred (origin at the torso), so the burst sits at
    // pos.y; grounded models are feet-origin and need the head/chest offset
    const centerOff = this.def.flyer ? 0 : this.def.height * (isHead ? 0.85 : 0.5);
    const center = this.group.position.clone().setY(this.pos.y + centerOff);
    // a dash-kill's gore is concentrated into the in-face pin detonation instead
    if (!this._killedByDash) {
      this.mgr.fx.deathBurst(center, this.def.blood);
      if (this.def.burst) {
        // rupture: a second, larger gas-and-gore burst — dangerous up close
        this.mgr.fx.deathBurst(center, this.def.blood);
        this.mgr.fx.bloodBurst(center, new THREE.Vector3(0, 1, 0), 2.2, this.def.accent);
        this.mgr.fx.addTrauma(0.2);
        const bpd = Math.hypot(this.mgr.player.pos.x - this.pos.x, this.mgr.player.pos.z - this.pos.z);
        if (bpd < 3.4) this.mgr.player.takeDamage(20, this.pos);
      }
    }
    this.mgr.fx.addTrauma(this.def.deathTrauma || 0.12);
    // elite death payloads: blazing scorches close-by, volatile flings bolts
    if (this.elite === 'blazing') {
      this.mgr.fx.deathBurst(center, 0xff7a2e);
      this.mgr.fx.shockwave(center, 0xff9a4a, 4, 0.4);
      const pdd = Math.hypot(this.mgr.player.pos.x - this.pos.x, this.mgr.player.pos.z - this.pos.z);
      if (pdd < 3.2) this.mgr.player.takeDamage(14, this.pos);
    } else if (this.elite === 'volatile' && this.mgr.projectiles) {
      for (let k = 0; k < 3; k++) {
        const a = this.facing + (k - 1) * 2.1;
        const d2 = new THREE.Vector3(Math.sin(a), 0.12, Math.cos(a));
        this.mgr.projectiles.spawn('bolt', center.clone(), d2, { owner: 'enemy', damage: 10 });
      }
    }
    this.mgr.audio.enemyDeath(pan, this.def.voice);
    this.mgr._onKilled(this, isHead);
  }

  // Turn the lone straggler into a hunter: faster, hits harder, beelines you,
  // and plants a tall glowing beacon so you can find it across the field.
  enrage() {
    if (this.enraged || this.boss) return;
    this.enraged = true;
    this.speed *= 1.75;
    this._enrageDmg = 1.6;
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 46, 8, 1, true), mat);
    beacon.position.y = 20; beacon.frustumCulled = false;
    this.group.add(beacon); this._beacon = beacon;
    // a marker chevron orb over the head
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xff5030 });
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), orbMat);
    orb.position.y = this.def.height + 0.9; this.group.add(orb); this._orb = orb;
    this.materials.push(mat, orbMat);   // so they fade + dispose with the enemy
    this.mgr.fx.addTrauma(0.25);
    this.mgr.audio.enrage(this.mgr.panFor(this.pos));
  }

  update(dt, player) {
    if (this._pinned) return;   // main owns the corpse transform while it's skewered on a dash
    if (this.deathT >= 0) { this._updateDeath(dt); return; }
    if (this.frozenT > 0) { this._frozenTick(dt); return; }
    if (this._stunT > 0) {
      // crashed into something mid-charge: reeling, extra-vulnerable
      this._stunT -= dt;
      if (this.parts.pelvis) this.parts.pelvis.rotation.z = Math.sin(this._stunT * 9) * 0.18;
      this.flash = Math.max(this.flash, 0.25);
      this._applyFlash();
      this.group.position.set(this.pos.x, this.pos.y + this.bob, this.pos.z);
      return;
    }
    if (this.type === 'wurm') { this._wurmBehavior(dt, player); this.flash = damp(this.flash, 0, 9, dt); this._applyFlash(); return; }
    if (this.type === 'tempest') { this._tempestBehavior(dt, player); this.flash = damp(this.flash, 0, 9, dt); this._applyFlash(); return; }

    if (this.spawnT < 1) { this.spawnT = clamp01(this.spawnT + dt * 2.4); this.group.scale.setScalar(this.spawnT); }

    const def = this.def;
    // movement seeks either the player or — when we're on different LAYERS —
    // the nearest sinkhole entrance (walkers path down/up through it, flyers
    // loiter over it). Combat always measures the REAL distance to the player.
    const seek = this._seekPos(player);
    const toP = new THREE.Vector3(seek.x - this.pos.x, 0, seek.z - this.pos.z);
    const dist = toP.length();
    const pdist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const dir = dist > 0.001 ? toP.clone().multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);
    // flankers (stalkers, ravens) arc around to a side instead of beelining
    if (def.flank && pdist > 7 && !this.enraged && this.lunging <= 0) {
      const a = this._flank * 0.55;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = dir.x * ca - dir.z * sa, nz = dir.x * sa + dir.z * ca;
      dir.set(nx, 0, nz);
    }

    // face player
    const target = Math.atan2(dir.x, dir.z);
    this.facing = dampAngle(this.facing, target, def.gait === 'run' ? 9 : 6, dt);
    this.group.rotation.y = this.facing;

    // --- behaviour: seek + separation + per-type flavour ---
    const desired = new THREE.Vector3();
    let spd = this.speed;

    // stalker lunges: periodic bursts of speed straight at the player
    if (def.lunge) {
      this.lungeCd -= dt;
      if (this.lunging > 0) { this.lunging -= dt; spd = this.speed * 2.1; }
      else if (this.lungeCd <= 0 && pdist < 16 && pdist > def.reach + 1) { this.lunging = 0.5; this.lungeCd = rand(2.5, 4.5); this.mgr.audio.growl(this.mgr.panFor(this.pos), this.def.voice); }
    }

    if (def.shooter) {
      // a sniper holds a firing standoff — advance if far, back off if crowded
      if (dist > def.standoff + 3) desired.addScaledVector(dir, spd);
      else if (dist < def.standoff - 4) desired.addScaledVector(dir, -spd * 0.8);
    } else if (dist > def.reach + 0.4) desired.addScaledVector(dir, spd);

    // stalker/wisp weave: a sideways sine so they don't beeline (enraged charges straight)
    if (def.weave && this.lunging <= 0 && !this.enraged) {
      this.weavePhase += dt * def.weave;
      const perp = new THREE.Vector3(dir.z, 0, -dir.x);
      desired.addScaledVector(perp, Math.sin(this.weavePhase) * spd * 0.6);
    }

    // juggernaut BULL CHARGE: telegraph, then a locked straight rush. Baiting it
    // into a rock/tree stuns it — the obstacles are your matador's cape.
    if (def.charge && this._chgState === 0 && this.spawnT >= 1) {
      this._chgCd -= dt;
      if (this._chgCd <= 0 && pdist > 7 && pdist < 24 && !this.mgr.playerUnder === !this.underground) {
        this._chgState = 1; this._chgT = 0.8;
        this.flash = 1;
        this.mgr.audio.growl(this.mgr.panFor(this.pos), 0.4);
      }
    }
    if (this._chgState === 1) {
      this._chgT -= dt;
      desired.set(0, 0, 0);
      if (this.parts.pelvis) this.parts.pelvis.rotation.x = -0.28;   // rear back
      this.flash = Math.max(this.flash, 0.3);
      if (this._chgT <= 0) {
        this._chgState = 2; this._chgT = 1.15;
        this._chgDir.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z).normalize();
        this.mgr.fx.addTrauma(0.2);
        this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos), 0.35);
      }
    } else if (this._chgState === 2) {
      this._chgT -= dt;
      desired.copy(this._chgDir).multiplyScalar(this.speed * 4.6);
      // trample the player on contact (once per charge)
      if (!this._chgHit && pdist < def.radius + player.radius + 0.6 && Math.abs(player.pos.y - this.pos.y) < def.height) {
        this._chgHit = true;
        player.takeDamage(def.damage * 1.2, this.pos);
        this.mgr.fx.addTrauma(0.3);
      }
      // crashing into a collider stuns it hard
      for (const c of this.mgr.colliders) {
        const dx2 = this.pos.x + this._chgDir.x * def.radius - c.x, dz2 = this.pos.z + this._chgDir.z * def.radius - c.z;
        if (dx2 * dx2 + dz2 * dz2 < (c.r + def.radius * 0.6) ** 2) {
          this._chgState = 0; this._chgCd = rand(6, 9); this._chgHit = false;
          this._stunT = 1.7;
          this.mgr.fx.shockwave(new THREE.Vector3(this.pos.x, this.pos.y + 1.4, this.pos.z), 0xffb060, 3.4, 0.4);
          this.mgr.fx.addTrauma(0.35);
          this.mgr.audio.bossSlam(this.mgr.panFor(this.pos));
          break;
        }
      }
      if (this._chgT <= 0) { this._chgState = 0; this._chgCd = rand(6, 9); this._chgHit = false; }
    }

    const sep = this.mgr.separation(this, def.radius);
    desired.addScaledVector(sep, spd);
    this.vel.x = damp(this.vel.x, desired.x, def.gait === 'run' ? 9 : 7, dt);
    this.vel.z = damp(this.vel.z, desired.z, def.gait === 'run' ? 9 : 7, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-7 * dt));
    // wisps + flyers float over foliage; everything else pushes out of it
    if (def.gait !== 'float' && !def.flyer) this.mgr.collideEnemy(this, def.radius);
    else this.mgr.clampBounds(this);
    if (def.flyer) {
      // altitude control: cruise above the ground, dive to the player to strike,
      // then pull up and swoop back for another pass. (A sniper holds a high
      // standoff and never dives: diveRange < 0.)
      const groundY = this.mgr.terrain.height(this.pos.x, this.pos.z);
      const cruise = groundY + def.cruise;
      if (this._swoopClimb > 0) this._swoopClimb -= dt;
      let ty;
      if (def.diveRange > 0 && dist < def.diveRange && this._swoopClimb <= 0) ty = player.pos.y + def.height * 0.25;
      else ty = Math.max(cruise, player.pos.y * 0.55 + groundY * 0.2 + def.cruise * 0.45);
      if (this._swoopClimb > 0) ty = Math.max(ty, player.pos.y + def.cruise * 0.8);   // climb clear of the player after a strike
      ty = Math.max(ty, groundY + 1.0);
      this.flyY = damp(this.flyY, ty, def.climb * (this._swoopClimb > 0 ? 1.6 : 1), dt);
      this.pos.y = this.flyY;
    } else {
      // underground walkers can't phase out through the cave walls either
      // (but inside a sinkhole crater the funnel is ordinary open terrain —
      // clamping there walled off the way OUT and pinned enemies in the hole)
      if (this.underground && this.mgr.world && this.mgr.world.caveSDF &&
          !(this.mgr.world.inCrater && this.mgr.world.inCrater(this.pos.x, this.pos.z))) {
        const d = this.mgr.world.caveSDF(this.pos.x, this.pos.z);
        if (d > -0.6) {
          const e2 = 0.4;
          const gx = (this.mgr.world.caveSDF(this.pos.x + e2, this.pos.z) - this.mgr.world.caveSDF(this.pos.x - e2, this.pos.z)) / (2 * e2);
          const gz = (this.mgr.world.caveSDF(this.pos.x, this.pos.z + e2) - this.mgr.world.caveSDF(this.pos.x, this.pos.z - e2)) / (2 * e2);
          const L = Math.hypot(gx, gz) || 1;
          this.pos.x -= (gx / L) * (d + 0.6);
          this.pos.z -= (gz / L) * (d + 0.6);
        }
      }
      this.pos.y = this.mgr.groundFor(this.pos.x, this.pos.z, this.pos.y) + (def.hover || 0);
      // an audible splash when a walker crosses the pond line
      if (this.mgr.world && this.mgr.world.surfaceAt) {
        const inW = this.mgr.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y) === 'water';
        if (inW !== this._inWater) { this._inWater = inW; this.mgr.audio.splash(this.mgr.panFor(this.pos)); }
      }
    }

    // stall watchdog: a far-away walker that hasn't actually moved for ~9s is
    // wedged on SOMETHING (whatever the cause) — quietly re-drop it at the
    // arena edge so the horde never dribbles away into stuck stragglers.
    if (!this.boss && this.spawnT >= 1 && this.frozenT <= 0 && this._stunT <= 0) {
      this._stallRef = this._stallRef || this.pos.clone();
      if (this.pos.distanceToSquared(this._stallRef) > 2.25) { this._stallRef.copy(this.pos); this._stallT = 0; }
      else if ((this._stallT = (this._stallT || 0) + dt) > 9 && pdist > 22) {
        this.mgr.relocate(this);
        this._stallRef.copy(this.pos); this._stallT = 0;
      }
    }

    this._animate(dt, dist);
    // apply visual bob (float/stomp) on top of pos
    this.group.position.set(this.pos.x, this.pos.y + this.bob, this.pos.z);

    // vertical gap: a ground melee can't reach a player who has jumped/flown up.
    // Reach scales with the creature's size (big things swing higher).
    const vGap = Math.abs(player.pos.y - this.pos.y);
    const vReach = def.reach + def.height * 0.65;

    if (this.boss) this._bossBehavior(dt, pdist, vGap, player);
    else if (def.shooter) this._shootBehavior(dt, pdist, player);
    else {
      if (def.quake) this._quakeBehavior(dt, pdist, player);
      if (def.fuse && this._fusing < 0 && pdist < 2.8 && this.spawnT >= 1) {
        // a bloater that gets close arms itself — kill it or GET AWAY
        this._fusing = 0.8;
        this.mgr.audio.seerCharge(this.mgr.panFor(this.pos));
      }
      if (this._fusing >= 0) {
        this._fusing -= dt;
        this.flash = Math.max(this.flash, 0.4 + Math.sin(this.phase * 26) * 0.4);
        if (this._fusing <= 0) { this.takeDamage(this.health + 1, this.pos.clone().setY(this.pos.y + 1), new THREE.Vector3(0, 1, 0), false); return; }
      }
      // attack on contact (must be within horizontal AND vertical reach)
      this.attackTimer -= dt;
      if (pdist <= def.reach + player.radius + 0.5 && vGap <= vReach && this.attackTimer <= 0) {
        this.attackTimer = def.attackCd;
        player.takeDamage((def.damage + this.mgr.wave * 0.5) * this._enrageDmg, this.pos);
        if (this.elite === 'frost' && this.mgr.onPlayerChilled) this.mgr.onPlayerChilled();
        this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos), this.def.voice);
        if (this.parts.armL) { this.parts.armL.rotation.x = -2.4; this.parts.armR.rotation.x = -2.4; }
        if (def.flyer) this._swoopClimb = rand(1.1, 1.7);   // a raven peels off and climbs for another pass
      }
    }

    if (this._eliteOrb) { this._eliteOrb.rotation.y += dt * 4; this._eliteOrb.position.y = this.def.height + 0.55 + Math.sin(this.phase * 2.2) * 0.12; }
    if (this.parts.orbit) this.parts.orbit.rotation.y += dt * 1.6;

    // enrage beacon: pulse + keep the marker floating (billboard-ish orb spin)
    if (this._beacon) {
      const pulse = 0.4 + Math.abs(Math.sin(this.phase * 1.5)) * 0.4;
      this._beacon.material.opacity = pulse;
      this._beacon.scale.x = this._beacon.scale.z = 1 + Math.sin(this.phase * 2) * 0.15;
      if (this._orb) { this._orb.rotation.y += dt * 3; this._orb.position.y = this.def.height + 0.9 + Math.sin(this.phase * 2) * 0.15; }
      this.flash = Math.max(this.flash, 0.25 + Math.abs(Math.sin(this.phase * 1.5)) * 0.3);
    }

    // occasional growl
    this.growlCd -= dt;
    if (this.growlCd <= 0) { this.growlCd = rand(4, 10); if (pdist < 30) this.mgr.audio.growl(this.mgr.panFor(this.pos), this.def.voice); }

    this.flash = damp(this.flash, 0, 9, dt);
    this._applyFlash();
  }

  // THE WURM: a three-beat loop that owns the cavern. BURIED it drifts under
  // the player (rumble + dust); it TELEGRAPHS an eruption point; then it ERUPTS
  // in an arc — head + segments threading out of the floor and back in. The
  // rock physically blocks bullets while it's buried, so eruptions are the
  // damage window. It only hunts players who are actually underground —
  // meteors (main.js) make the surface no place to wait it out.
  _wurmBehavior(dt, player) {
    const W = this.mgr.world;
    if (!this._wstate) {
      this._wstate = 'buried'; this._wt = 1.2;
      this._burrow = new THREE.Vector3(this.pos.x, 0, this.pos.z);
      this._eruptA = new THREE.Vector3(); this._eruptB = new THREE.Vector3();
      this.spawnT = 1; this.group.scale.setScalar(1);
      this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0);
    }
    const p = this.parts;
    const floorAt = (x, z) => this.mgr.groundFor(x, z, -12);
    const pdx = player.pos.x - this._burrow.x, pdz = player.pos.z - this._burrow.z;
    const pd = Math.hypot(pdx, pdz);

    if (this._wstate === 'buried') {
      this._wt -= dt;
      if (pd > 0.5) { this._burrow.x += (pdx / pd) * this.speed * dt; this._burrow.z += (pdz / pd) * this.speed * dt; }
      // stay inside the cave region
      if (W && W.isUnder && !W.isUnder(this._burrow.x, this._burrow.z, -12)) this._burrow.multiplyScalar(0.98);
      this.pos.set(this._burrow.x, floorAt(this._burrow.x, this._burrow.z) - 2.5, this._burrow.z);
      // hide the body while buried
      p.head.position.y = -40; for (const g of p.segs) g.position.y = -40;
      if (this.mgr.playerUnder && pd < 14) {
        this.mgr.fx.addTrauma(0.9 * dt);
        if (Math.random() < 0.25) this.mgr.fx.smoke.emit(this._burrow.x, floorAt(this._burrow.x, this._burrow.z) + 0.3, this._burrow.z, 0, 0.8, 0, 0.3, 0.27, 0.24, 0.4, 0.5, -0.4, 2);
      }
      if (this._wt <= 0 && this.mgr.playerUnder && pd < 34) {
        this._wstate = 'telegraph'; this._wt = 0.85;
        this._eruptA.set(player.pos.x, 0, player.pos.z);
        const fy = floorAt(this._eruptA.x, this._eruptA.z);
        this.mgr.fx.shockwave(new THREE.Vector3(this._eruptA.x, fy + 0.3, this._eruptA.z), 0xff7a2e, 4.5, 0.8);
        this.mgr.audio.growl(this.mgr.panFor(player.pos), 0.3);
      }
      return;
    }

    if (this._wstate === 'telegraph') {
      this._wt -= dt;
      this.mgr.fx.addTrauma(1.4 * dt);
      const fy = floorAt(this._eruptA.x, this._eruptA.z);
      if (Math.random() < 0.6) this.mgr.fx.debris.emit(
        this._eruptA.x + rand(-1.2, 1.2), fy + 0.3, this._eruptA.z + rand(-1.2, 1.2),
        rand(-1, 1), rand(2, 5), rand(-1, 1), 0.28, 0.24, 0.22, 0.4, 0.14, 14, 3);
      if (this._wt <= 0) {
        this._wstate = 'erupt'; this._wt = 0; this._eruptHit = false;
        // arc toward where the player is NOW, clamped inside the cave
        let dx = player.pos.x - this._eruptA.x, dz = player.pos.z - this._eruptA.z;
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        this._eruptB.set(this._eruptA.x + dx * 9, 0, this._eruptA.z + dz * 9);
        if (W && W.isUnder && !W.isUnder(this._eruptB.x, this._eruptB.z, -12)) this._eruptB.set(this._eruptA.x * 0.55, 0, this._eruptA.z * 0.55);
        const fy2 = floorAt(this._eruptA.x, this._eruptA.z);
        this.mgr.fx.deathBurst(new THREE.Vector3(this._eruptA.x, fy2 + 0.5, this._eruptA.z), 0x6b533a);
        this.mgr.fx.addTrauma(0.55);
        this.mgr.audio.yetiRoar(this.mgr.panFor(player.pos));
      }
      return;
    }

    // erupting: head + trailing segments follow the arc out of the floor
    this._wt += dt / 1.5;
    const A = this._eruptA, B = this._eruptB;
    const fyA = floorAt(A.x, A.z);
    const ceilY = W && W.ceilAt ? W.ceilAt(A.x, A.z) : fyA + 8;
    const arcH = Math.min(5, ceilY - fyA - 1.4);
    const place = (g, t) => {
      if (t <= 0 || t >= 1) { g.position.y = -40; return null; }
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
      const y = floorAt(x, z) + Math.sin(t * Math.PI) * arcH + 0.4;
      g.position.set(x, y, z);
      return g.position;
    };
    const hp = place(p.head, this._wt);
    if (hp) {
      const t2 = Math.min(1, this._wt + 0.06);
      const nx = A.x + (B.x - A.x) * t2, nz = A.z + (B.z - A.z) * t2;
      p.head.lookAt(nx, floorAt(nx, nz) + Math.sin(t2 * Math.PI) * arcH + 0.4, nz);
      this.pos.copy(hp);
      // the strike: touching the emerging serpent hurts (once per eruption)
      const hd = Math.hypot(player.pos.x - hp.x, player.pos.z - hp.z);
      if (!this._eruptHit && this._wt > 0.04 && this._wt < 0.85 && hd < 2.5 && Math.abs(player.pos.y - hp.y) < 3) {
        this._eruptHit = true;
        player.takeDamage(this.def.damage, this.pos);
        this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos), this.def.voice);
      }
      if (Math.random() < 0.35) this.mgr.fx.debris.emit(hp.x, hp.y - 1, hp.z, rand(-2, 2), rand(1, 4), rand(-2, 2), 0.3, 0.26, 0.22, 0.35, 0.15, 14, 3);
    }
    for (let i = 0; i < p.segs.length; i++) place(p.segs[i], this._wt - (i + 1) * 0.085);
    if (this._wt >= 1 + (p.segs.length + 1) * 0.085) {
      this._wstate = 'buried'; this._wt = rand(1.1, 2.0);
      this._burrow.set(B.x, 0, B.z);
    }
  }

  // THE TEMPEST: orbits the sky at ring height, volleys bolts, and periodically
  // dives straight through your position. The ground-surge that makes terra
  // firma lethal during this fight lives in main (_updateBossHazards).
  _tempestBehavior(dt, player) {
    const p = this.parts;
    if (!this._tstate) {
      this._tstate = 'orbit';
      this._orbA = Math.atan2(this.pos.z, this.pos.x);
      this._volley = 2.4; this._diveCd = 8; this._diveT = 0;
      this._diveFrom = new THREE.Vector3(); this._diveTo = new THREE.Vector3();
      this.spawnT = 1; this.group.scale.setScalar(1);
    }
    this.phase += dt * 5;
    if (p.wingL) { const f = Math.sin(this.phase * 1.7); p.wingL.rotation.z = f * 0.55; p.wingR.rotation.z = -f * 0.55; }
    this.facing = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    this.group.rotation.y = this.facing;

    if (this._tstate === 'orbit') {
      this._orbA += dt * 0.34;
      const R = 27;
      const tx = Math.cos(this._orbA) * R, tz = Math.sin(this._orbA) * R;
      const ty = 16.5 + Math.sin(this.phase * 0.25) * 2;
      this.pos.x = damp(this.pos.x, tx, 1.6, dt);
      this.pos.z = damp(this.pos.z, tz, 1.6, dt);
      this.pos.y = damp(this.pos.y, ty, 2.0, dt);
      // bolt volleys (never through rock)
      this._volley -= dt;
      if (this._volley <= 0 && !this.mgr.playerUnder && this.mgr.projectiles) {
        this._volley = 2.6;
        const origin = new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z);
        const aim = new THREE.Vector3(player.pos.x - origin.x, player.pos.y + 1.1 - origin.y, player.pos.z - origin.z).normalize();
        const perp = new THREE.Vector3(-aim.z, 0, aim.x);
        for (let k = -1; k <= 1; k++) {
          const d2 = aim.clone().addScaledVector(perp, k * 0.1).normalize();
          this.mgr.projectiles.spawn('bolt', origin.clone().addScaledVector(d2, 2), d2, { owner: 'enemy', damage: 15 });
        }
        this.mgr.audio.enemyShoot(this.mgr.panFor(this.pos));
      }
      this._diveCd -= dt;
      if (this._diveCd <= 0 && !this.mgr.playerUnder) {
        this._tstate = 'dive'; this._diveT = 0; this._diveHit = false;
        this._diveFrom.copy(this.pos);
        this._diveTo.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
        this.mgr.audio.seerCharge(this.mgr.panFor(this.pos));
      }
    } else {
      // dive: swoop through the target point, then climb back to the orbit
      this._diveT += dt / 1.1;
      const t = this._diveT;
      if (t < 0.5) {
        const k = (t * 2) * (t * 2) * (3 - 2 * t * 2) * 0.5 + t;   // eased in
        this.pos.lerpVectors(this._diveFrom, this._diveTo, Math.min(1, t * 2));
      } else {
        const up = new THREE.Vector3(Math.cos(this._orbA) * 27, 17, Math.sin(this._orbA) * 27);
        this.pos.lerpVectors(this._diveTo, up, (t - 0.5) * 2);
      }
      const hd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (!this._diveHit && hd < 2.3 && Math.abs(player.pos.y + 1 - this.pos.y) < 2.4) {
        this._diveHit = true;
        player.takeDamage(this.def.damage, this.pos);
        this.mgr.fx.addTrauma(0.3);
        this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos), this.def.voice);
      }
      if (Math.random() < 0.5) this.mgr.fx.sparks.emit(this.pos.x, this.pos.y, this.pos.z, 0, 0, 0, 0.62, 0.83, 1.0, 0.14, 0.3, 0, 3);
      if (this._diveT >= 1) { this._tstate = 'orbit'; this._diveCd = rand(7, 10); }
    }
    this.group.position.copy(this.pos);
  }

  // MEGALITH quake: crouch-telegraph, stomp, then an expanding ground ring that
  // hurts anyone STANDING on the ground when it passes. Jump/dash over it.
  _quakeBehavior(dt, pdist, player) {
    if (this._ring) {
      const ring = this._ring;
      ring.r += 13.5 * dt;
      // dust puffs around the current radius
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const px = this.pos.x + Math.cos(a) * ring.r, pz = this.pos.z + Math.sin(a) * ring.r;
        this.mgr.fx.debris.emit(px, this.mgr.groundFor(px, pz, this.pos.y) + 0.2, pz,
          0, rand(1, 2.5), 0, 0.5, 0.55, 0.45, 0.25, 0.12, 10, 3);
      }
      if (!ring.hit) {
        const pd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        const grounded = (player.pos.y - this.mgr.groundFor(player.pos.x, player.pos.z, player.pos.y)) < 1.1;
        if (Math.abs(pd - ring.r) < 1.3 && grounded) {
          ring.hit = true;
          player.takeDamage(24, this.pos);
        }
      }
      if (ring.r > 17) this._ring = null;
    }
    if (this._quakeT >= 0) {
      this._quakeT -= dt;
      if (this.parts.pelvis) this.parts.pelvis.position.y = this.parts.hipH - Math.min(0.5, (0.7 - this._quakeT));
      this.flash = Math.max(this.flash, 0.35);
      if (this._quakeT <= 0) {
        this._quakeT = -1;
        if (this.parts.pelvis) this.parts.pelvis.position.y = this.parts.hipH;
        const gp = new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z);
        this.mgr.fx.shockwave(gp, 0x7dff9a, 16, 1.1);
        this.mgr.fx.addTrauma(0.4);
        this.mgr.audio.bossSlam(this.mgr.panFor(this.pos));
        this._ring = { r: 0.5, hit: false };
      }
      return;
    }
    this._quakeCd -= dt;
    if (this._quakeCd <= 0 && pdist < 15 && this.spawnT >= 1) {
      this._quakeCd = rand(4.5, 7);
      this._quakeT = 0.7;
      this.mgr.audio.growl(this.mgr.panFor(this.pos), 0.32);
    }
  }

  // Where should movement head? The player, unless we're on different layers of
  // the world — then the nearest sinkhole entrance (the only way up/down).
  _seekPos(player) {
    const w = this.mgr.world;
    if (!w || !w.isUnder || !w.entrances) return player.pos;
    const pUnder = this.mgr.playerUnder;
    const meUnder = w.isUnder(this.pos.x, this.pos.z, this.pos.y + 0.5);
    this.underground = meUnder;
    if (this.def.flyer) return pUnder ? this._nearestEntrance(player.pos) : player.pos;
    if (pUnder === meUnder) return player.pos;
    if (meUnder) {
      // heading UP: aim for the hole nearest to ME (not the player — that can
      // be across the map), and once inside its shaft keep walking OUT past
      // the crater rim on the player's side. Standing at the bottom of the
      // bowl "arrived at the entrance" was how enemies got stuck in holes.
      const e = this._nearestEntrance(this.pos);
      const dx = this.pos.x - e.x, dz = this.pos.z - e.z;
      if (dx * dx + dz * dz < 100) {
        let ox = player.pos.x - e.x, oz = player.pos.z - e.z;
        const L = Math.hypot(ox, oz) || 1;
        this._ent.set(e.x + (ox / L) * 17, 0, e.z + (oz / L) * 17);
      }
      return this._ent;
    }
    return this._nearestEntrance(player.pos);
  }
  _nearestEntrance(ref) {
    const w = this.mgr.world;
    let best = w.entrances[0], bd = Infinity;
    for (const e of w.entrances) {
      const d = Math.hypot(e.x - ref.x, e.z - ref.z);
      if (d < bd) { bd = d; best = e; }
    }
    this._ent.set(best.x, 0, best.z);
    return best;
  }

  // Encased in the pond's ice: held solid, tinted frost, brittle to damage.
  _frozenTick(dt) {
    this.frozenT -= dt;
    for (let i = 0; i < this.skinMats.length; i++) this.skinMats[i].color.copy(this._baseColors[i]).lerp(ICE_TINT, 0.72);
    if (this.frozenT <= 0) {
      for (let i = 0; i < this.skinMats.length; i++) this.skinMats[i].color.copy(this._baseColors[i]);
      // thaw out and clamber up onto the ice sheet
      this.pos.y = this.mgr.groundFor(this.pos.x, this.pos.z, 0.5) + (this.def.hover || 0);
    }
  }
  freezeSolid(t) {
    this.frozenT = t;
    this.attackTimer = Math.max(this.attackTimer, 1);
  }

  // Boss dispatch: the yeti fights differently (ranged snowball-thrower).
  _bossBehavior(dt, dist, vGap, player) {
    if (this.type === 'yeti') { this._yetiBehavior(dt, dist, vGap, player); return; }
    const def = this.def;
    const p = this.parts;
    if (this._slamT >= 0) {
      // winding up / slamming
      this._slamT += dt;
      const wind = 0.65;
      if (this._slamT < wind) {
        // rear the fists overhead
        const e = this._slamT / wind;
        if (p.armL) { p.armL.rotation.x = -2.6 * e; p.armR.rotation.x = -2.6 * e; }
      } else if (this._slamT < wind + 0.12) {
        // the slam frame: fists down, AoE shock
        if (p.armL) { p.armL.rotation.x = 0.4; p.armR.rotation.x = 0.4; }
        if (!this._slammed) {
          this._slammed = true;
          const gp = new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z);
          this.mgr.fx.shockwave(gp, 0xff6622, 8, 0.5);
          this.mgr.fx.addTrauma(0.6);
          this.mgr.audio.bossSlam(this.mgr.panFor(this.pos));
          const slamR = def.reach + 3.5;
          if (dist < slamR && vGap < def.height * 0.8 + 2) player.takeDamage(def.damage, this.pos);
        }
      } else {
        this._slamT = -1; this._slammed = false;
        this.attackTimer = def.attackCd;
      }
    } else {
      this.attackTimer -= dt;
      if (dist <= def.reach + player.radius && vGap < def.height && this.attackTimer <= 0) { this._slamT = 0; this._slammed = false; }
    }
    // periodically call in reinforcements
    this._addCd -= dt;
    if (this._addCd <= 0) {
      this._addCd = rand(7, 10);
      if (this.mgr.aliveCount() < 10) this.mgr.spawnAdds(this.pos, 2);
      this.mgr.audio.growl(this.mgr.panFor(this.pos), this.def.voice);
    }
  }

  // The yeti: a ranged brute. Hurls telegraphed snowballs (dash-reflectable),
  // ground-slams anyone who closes in, staggers when its own snowball comes back,
  // and calls in flying ravens.
  _yetiBehavior(dt, dist, vGap, player) {
    const def = this.def;
    const p = this.parts;
    if (this.mgr.playerUnder) { this._chargeT = -1; this._slamT = -1; return; }   // it prowls the entrances instead

    // reeling from a reflected snowball — drop everything and stagger
    if (this._stagger > 0) {
      this._stagger -= dt;
      p.pelvis.rotation.x = damp(p.pelvis.rotation.x, -0.45, 6, dt);
      if (p.armL) { p.armL.rotation.x = damp(p.armL.rotation.x, -1.7, 6, dt); p.armR.rotation.x = damp(p.armR.rotation.x, -1.7, 6, dt); }
      this._chargeT = -1; this._slamT = -1;
      return;
    }
    p.pelvis.rotation.x = damp(p.pelvis.rotation.x, 0.05, 5, dt);

    // ground-slam (melee) in progress
    if (this._slamT >= 0) {
      this._slamT += dt;
      const wind = 0.6;
      if (this._slamT < wind) { const e = this._slamT / wind; if (p.armL) { p.armL.rotation.x = -2.6 * e; p.armR.rotation.x = -2.6 * e; } }
      else if (this._slamT < wind + 0.12) {
        if (p.armL) { p.armL.rotation.x = 0.5; p.armR.rotation.x = 0.5; }
        if (!this._slammed) {
          this._slammed = true;
          const gp = new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z);
          this.mgr.fx.shockwave(gp, 0xcfe6ff, 11, 0.55); this.mgr.fx.addTrauma(0.65);
          this.mgr.audio.bossSlam(this.mgr.panFor(this.pos));
          const slamR = def.reach + 4;
          if (dist < slamR && vGap < def.height * 0.8 + 2) player.takeDamage(def.damage, this.pos);
        }
      } else { this._slamT = -1; this._slammed = false; this.attackTimer = def.attackCd; }
      return;
    }

    // winding up / releasing a snowball throw
    if (this._chargeT >= 0) {
      this._chargeT += dt;
      const e = clamp01(this._chargeT / YETI_WINDUP);
      if (p.armR) { p.armR.rotation.x = -2.9 * e; p.armR.rotation.z = -0.5 * e; }
      if (p.pelvis) p.pelvis.rotation.y = 0.35 * e;
      if (this._chargeT >= YETI_WINDUP) {
        this._throwSnowball(player);
        this._chargeT = -1;
        if (p.armR) { p.armR.rotation.x = 1.0; p.armR.rotation.z = 0; }   // follow-through
        if (p.pelvis) p.pelvis.rotation.y = -0.25;
        this.shootTimer = def.attackCd + rand(0.3, 1.3);
      }
      return;
    }
    if (p.pelvis) p.pelvis.rotation.y = damp(p.pelvis.rotation.y, 0, 5, dt);

    // choose: slam if the player is right on top of it, else lob a snowball
    if (dist <= def.reach + player.radius + 1.5 && vGap < def.height) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) { this._slamT = 0; this._slammed = false; }
    } else {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0 && dist < 62 && this.mgr.projectiles) {
        this._chargeT = 0;
        this.mgr.audio.yetiRoar(this.mgr.panFor(this.pos));
      }
    }

    // call in flying ravens to pressure the sky
    this._addCd -= dt;
    if (this._addCd <= 0) {
      this._addCd = rand(8, 12);
      if (this.mgr.aliveCount() < 8) this.mgr.spawnAdds(this.pos, 2, 'raven');
    }
  }

  _throwSnowball(player) {
    const def = this.def;
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + this._muzzleY, this.pos.z);
    const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    origin.addScaledVector(fwd, this._muzzleZ);
    const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
    // solve the lob: pick the launch direction so the arc (under the projectile's
    // own gravity, launched at SNOWBALL_SPEED) lands on the target. Iterate a few
    // times because the flight time depends on the (unknown) horizontal speed.
    const flatX = target.x - origin.x, flatZ = target.z - origin.z;
    const D = Math.hypot(flatX, flatZ);
    const dir = new THREE.Vector3(flatX, target.y - origin.y, flatZ);
    let t = D / Math.max(1, SNOWBALL_SPEED);
    for (let k = 0; k < 4; k++) {
      const drop = 0.5 * SNOWBALL_GRAV * t * t;
      dir.set(flatX, (target.y + drop) - origin.y, flatZ);
      const len = dir.length() || 1;
      const horiz = SNOWBALL_SPEED * (D / len);          // actual horizontal speed
      t = D / Math.max(1, horiz);
    }
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    this.mgr.projectiles.spawn('snowball', origin, dir, { owner: 'enemy', damage: def.damage + this.mgr.wave * 0.4 });
    this.mgr.audio.snowballThrow(this.mgr.panFor(this.pos));
    this.mgr.fx.addTrauma(0.15);
  }

  // Sniper: telegraph with a growing charge glow, then fire a dodgeable bolt.
  _shootBehavior(dt, dist, player) {
    const def = this.def;
    if (!this.mgr.projectiles) return;
    if (this.mgr.playerUnder) { this._chargeT = -1; return; }   // no sniping through rock
    if (this._chargeT >= 0) {
      this._chargeT += dt;
      const k = clamp01(this._chargeT / SEER_CHARGE);
      if (this.parts.eye) { this.parts.eye.scale.setScalar(1 + k * 0.7); this.flash = Math.max(this.flash, k * 0.5); }
      if (this._chargeT >= SEER_CHARGE) {
        this._fireBolt(player);
        this._chargeT = -1;
        this.shootTimer = def.attackCd;
        if (this.parts.eye) this.parts.eye.scale.setScalar(1);
      }
    } else {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0 && dist < 46 && this.spawnT >= 1) {
        this._chargeT = 0;
        this.mgr.audio.seerCharge(this.mgr.panFor(this.pos));
      }
    }
  }

  _fireBolt(player) {
    const def = this.def;
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + this._muzzleY, this.pos.z);
    const aim = new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z).sub(origin);
    if (aim.lengthSq() < 1e-6) aim.set(0, 0, 1);
    aim.normalize();
    origin.addScaledVector(aim, this._muzzleZ + 0.35);
    this.mgr.projectiles.spawn('bolt', origin, aim, { owner: 'enemy', damage: def.damage + this.mgr.wave * 0.4 });
    this.mgr.audio.enemyShoot(this.mgr.panFor(this.pos));
    this.mgr.fx.impactLight(origin, def.accent, 5, 0.1);
  }

  _animate(dt, dist) {
    const def = this.def, p = this.parts;
    const moveSpd = Math.hypot(this.vel.x, this.vel.z);
    const stride = clamp01(moveSpd / Math.max(0.5, this.speed));
    this.phase += dt * (def.rate * 0.5 + moveSpd * def.rate * 0.12);
    const sw = Math.sin(this.phase);

    switch (def.gait) {
      case 'run': {
        if (p.legL) { p.legL.rotation.x = sw * 0.9 * stride + 0.2; p.legR.rotation.x = -sw * 0.9 * stride + 0.2; }
        p.armL.rotation.x = -0.5 + sw * 0.6 * stride; p.armR.rotation.x = -0.5 - sw * 0.6 * stride;
        p.pelvis.rotation.x = damp(p.pelvis.rotation.x, 0.15 + this.hurtLean, 8, dt);
        p.head.rotation.z = Math.sin(this.phase * 0.7) * 0.06;
        this.bob = Math.abs(Math.cos(this.phase)) * 0.06 * stride;
        break;
      }
      case 'stomp': {
        if (p.legL) { p.legL.rotation.x = sw * 0.5 * stride; p.legR.rotation.x = -sw * 0.5 * stride; }
        p.armL.rotation.x = -0.15 + sw * 0.25 * stride; p.armR.rotation.x = -0.15 - sw * 0.25 * stride;
        p.armL.rotation.z = 0.32; p.armR.rotation.z = -0.32;
        p.pelvis.rotation.x = damp(p.pelvis.rotation.x, 0.08 + this.hurtLean, 8, dt);
        this.bob = Math.abs(Math.cos(this.phase)) * 0.12 * stride;
        // footfall trauma: one thump per leg-plant (sin crosses zero), when close + moving
        const sgn = sw >= 0 ? 1 : -1;
        if (sgn !== this._stepSign) {
          this._stepSign = sgn;
          if (dist < 28 && stride > 0.4) this.mgr.fx.addTrauma(0.12);
        }
        break;
      }
      case 'fly': {
        // wing flap (fast, driven by rate), forward-pitched diving posture
        const flap = Math.sin(this.phase * 1.6);
        if (p.wingL) { p.wingL.rotation.z = flap * 0.85; p.wingR.rotation.z = -flap * 0.85; }
        if (p.halo) { p.halo.rotation.y += dt * (this._chargeT >= 0 ? 7 : 1.4); }   // seer's shards orbit, faster while charging
        p.pelvis.rotation.x = damp(p.pelvis.rotation.x, (def.shooter ? 0.0 : 0.25) + this.hurtLean, 6, dt);
        if (p.head) p.head.rotation.x = def.shooter ? 0 : -0.12;
        this.bob = Math.sin(this.phase * 1.6) * 0.1;
        break;
      }
      case 'float': {
        this.bob = Math.sin(this.phase * 0.8) * 0.18 + 0.05;
        p.pelvis.rotation.z = Math.sin(this.phase * 0.5) * 0.08;
        p.pelvis.rotation.x = damp(p.pelvis.rotation.x, 0.1 + this.hurtLean, 5, dt);
        p.armL.rotation.x = -0.3 + Math.sin(this.phase * 0.6) * 0.25;
        p.armR.rotation.x = -0.3 - Math.sin(this.phase * 0.6) * 0.25;
        if (p.wisps) p.wisps.forEach((w, i) => { w.rotation.x = Math.sin(this.phase * 0.7 + i) * 0.3; w.rotation.z = Math.cos(this.phase * 0.5 + i) * 0.2; });
        p.head.rotation.z = Math.sin(this.phase * 0.4) * 0.1;
        break;
      }
      case 'waddle': {
        if (p.legL) { p.legL.rotation.x = sw * 0.35 * stride; p.legR.rotation.x = -sw * 0.35 * stride; }
        p.pelvis.rotation.z = Math.sin(this.phase) * 0.16 * (0.4 + stride);   // side-to-side roll
        p.armL.rotation.z = 0.4 + Math.sin(this.phase) * 0.1; p.armR.rotation.z = -0.4 - Math.sin(this.phase) * 0.1;
        p.armL.rotation.x = -0.1; p.armR.rotation.x = -0.1;
        if (p.belly) { const j = 1 + Math.abs(Math.sin(this.phase)) * 0.04; p.belly.scale.set(1.05 * j, 0.98 / j, 1.05 * j); }
        p.pelvis.rotation.x = damp(p.pelvis.rotation.x, 0.05 + this.hurtLean, 8, dt);
        this.bob = Math.abs(Math.cos(this.phase)) * 0.03 * stride;
        break;
      }
      default: { // walk (husk)
        if (p.legL) { p.legL.rotation.x = sw * 0.6 * stride; p.legR.rotation.x = -sw * 0.6 * stride; }
        p.armL.rotation.x = -1.1 + Math.sin(this.phase * 0.7) * 0.15;
        p.armR.rotation.x = -1.1 - Math.sin(this.phase * 0.7) * 0.15;
        p.armL.rotation.z = 0.25; p.armR.rotation.z = -0.25;
        p.pelvis.rotation.x = damp(p.pelvis.rotation.x, 0.2 + this.hurtLean, 8, dt);
        p.head.rotation.z = Math.sin(this.phase * 0.5) * 0.14;
        this.bob = Math.abs(Math.cos(this.phase)) * 0.045 * stride;
      }
    }
    this.hurtLean = damp(this.hurtLean, 0, 5, dt);
  }

  _updateDeath(dt) {
    if (this.type === 'wurm') {
      // the serpent's pieces are strewn in world space — just burn it out fast
      this.deathT += dt;
      this._setOpacity(1 - clamp01(this.deathT / 0.8));
      if (this.deathT >= 0.8) this._dispose();
      return;
    }
    this.deathT += dt;
    const t = this.deathT;
    const def = this.def;
    this.pos.addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-6 * dt));
    let fade = 1, sink = 0;

    if (def.deathStyle === 'dissolve') {
      // wisps unravel: rise slightly, spin, and fade out fast
      const k = clamp01(t / 0.9);
      this.group.rotation.y += dt * 3;
      this.group.scale.setScalar(this.spawnT * (1 - k * 0.4));
      fade = 1 - k;
      this.pos.y = this.mgr.groundFor(this.pos.x, this.pos.z, this.pos.y) + (def.hover || 0) + k * 0.6;
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      this._setOpacity(fade);
      this.flash = damp(this.flash, 0, 9, dt); this._applyFlash();
      if (t >= 1.0) this._dispose();
      return;
    }

    // default: crumple to the ground, then sink + fade
    const fallAmt = clamp01(t / 0.5);
    this.group.rotation.x = lerp(0, Math.PI * 0.5, easeOut(fallAmt));
    const gy = this.mgr.groundFor(this.pos.x, this.pos.z, this.pos.y);
    if (def.flyer && this.pos.y > gy + 0.1) {
      // shot out of the sky: tumble and plummet until it hits the ground
      this._deathVy -= 30 * dt;
      this.pos.y = Math.max(gy, this.pos.y + this._deathVy * dt);
      this.group.rotation.z += dt * 5;
    } else {
      this.pos.y = gy;
    }
    if (t > 1.4) { sink = (t - 1.4) * 0.6; fade = clamp01(1 - (t - 1.4) / 1.0); }
    this.group.position.set(this.pos.x, this.pos.y - sink, this.pos.z);
    this._setOpacity(fade);
    this.flash = damp(this.flash, 0, 9, dt); this._applyFlash();
    if (t >= 2.4) this._dispose();
  }

  _setOpacity(o) {
    for (const m of this.materials) {
      const base = this.softFade.includes(m) ? 0.86 : 1;
      m.opacity = o * base;
      m.transparent = o < 1 || base < 1;
    }
  }

  _applyFlash() {
    for (let i = 0; i < this.skinMats.length; i++) {
      const m = this.skinMats[i];
      m.color.copy(this._baseColors[i]).lerp(WHITE, this.flash * 0.9);
      if (!m.emissive) m.emissive = new THREE.Color();
      m.emissive.setRGB(this.flash * 0.5, this.flash * 0.15, this.flash * 0.12);
    }
  }

  _dispose() {
    this.mgr._remove(this);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    this.mgr.scene.remove(this.group);
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function dampAngle(a, b, l, dt) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-l * dt));
}

// --- wave manager ---------------------------------------------------------
export class EnemyManager {
  constructor(scene, fx, audio, world, player) {
    this.scene = scene; this.fx = fx; this.audio = audio;
    this.world = world;              // layer-aware ground/entrances/pond
    this.playerUnder = false;        // recomputed each update
    this.terrain = world.terrain;
    this.colliders = world.colliders;
    this.boundary = world.playRadius;
    this.player = player;
    this.enemies = [];
    this.projectiles = null;   // set by main; enemy shooters spawn bolts through it
    this.wave = 0; this.score = 0; this.kills = 0;
    this.spawnQueue = []; this.spawnTimer = 0; this.betweenWaves = 0; this.active = false;
    this.boss = null; this.isBossWave = false;
    this.mutator = null; this._lastMutId = null;   // named per-wave variants
    this.maxConcurrent = 6; this.spawnInterval = 0.28;   // pressure spawner
    this.onScore = null; this.onKill = null; this.onWaveStart = null; this.onWaveCleared = null; this.onCountChange = null; this.onBoss = null;
  }

  reset() {
    for (const e of this.enemies) {
      e.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const m of e.materials) m.dispose();
      this.scene.remove(e.group);
    }
    this.enemies = []; this.wave = 0; this.score = 0; this.kills = 0;
    this.spawnQueue = []; this.betweenWaves = 0; this.active = false;
    this.boss = null; this.isBossWave = false;
    this.mutator = null; this._lastMutId = null;
  }

  bossWaveFor(n) { return n > 0 && n % 5 === 0; }
  bossTypeFor(n) { return ['colossus', 'yeti', 'wurm', 'tempest'][(Math.max(1, n / 5 | 0) - 1) % 4]; }

  start() { this.active = true; this.betweenWaves = 2.0; }

  _startWave(n) {
    this.wave = n;
    const hpScale = 1 + (n - 1) * 0.14;
    const speedScale = 1 + (n - 1) * 0.03;
    this.spawnQueue = [];
    this.isBossWave = this.bossWaveFor(n);

    if (this.isBossWave) {
      this.mutator = null;
      // a boss plus a fitting escort. The boss hp climbs each boss encounter.
      const bossNum = n / 5;
      // the boss roster rotates: colossus -> yeti (blizzard) -> wurm (underground)
      // -> tempest (sky), then repeats with scaled health
      const roster = ['colossus', 'yeti', 'wurm', 'tempest'];
      const bossType = roster[(bossNum - 1) % roster.length];
      const bossHp = 1 + (bossNum - 1) * 0.6;
      this.spawnQueue.push({ t: bossType, hpScale: bossHp, speedScale: 1, boss: true });
      const escort = 3 + bossNum;
      for (let i = 0; i < escort; i++) {
        // each boss brings a fitting escort
        const escort = {
          colossus: ['stalker', 'husk'], yeti: ['raven', 'stalker'],
          wurm: ['husk', 'stalker'], tempest: ['raven', 'seer'],
        }[bossType];
        const t = pick(escort);
        this.spawnQueue.push({ t, hpScale, speedScale });
      }
      // fewer at once during the boss so the boss reads clearly
      this.maxConcurrent = 6;
      this.spawnInterval = 0.7;
    } else {
      let count = Math.min(9 + n * 3, 50);
      // --- WAVE MUTATORS: every wave past 2 has a good chance of a named twist,
      // never the same one twice in a row — you can SAY what this wave was.
      this.mutator = null;
      if (n >= 3 && Math.random() < 0.62) {
        const MUTS = [
          { id: 'swarm', name: 'THE SWARM', desc: 'twice the bodies, half the bone' },
          { id: 'elite', name: 'ELITE MARCH', desc: 'every one of them is crowned' },
          { id: 'fog', name: 'FOG OF DREAD', desc: 'they move quick in the murk' },
          { id: 'night', name: 'NIGHTFALL', desc: 'only their glow gives them away' },
          { id: 'meteor', name: 'FALLING SKY', desc: 'the sky itself is shooting' },
          { id: 'bounty', name: 'GILDED HOUR', desc: 'golden marks pay double' },
        ].filter((m) => m.id !== this._lastMutId);
        this.mutator = pick(MUTS);
        this._lastMutId = this.mutator.id;
        if (this.mutator.id === 'swarm') { count = Math.round(count * 1.8); }
        if (this.mutator.id === 'elite') { count = Math.round(count * 0.55); }
        if (this.mutator.id === 'fog') { }
      }
      const hpMut = this.mutator && this.mutator.id === 'swarm' ? 0.6 : (this.mutator && this.mutator.id === 'elite' ? 0.85 : 1);
      const spdMut = this.mutator && this.mutator.id === 'fog' ? 1.15 : 1;
      // weighted spawn pool, unlocking + ramping variety as waves climb
      const pool = [['husk', Math.max(0.5, 2.4 - n * 0.18)]];
      if (n >= 1) pool.push(['stalker', clamp(0.4 + n * 0.12, 0, 1.6)]);
      if (n >= 2) pool.push(['wisp', clamp(0.2 + (n - 2) * 0.1, 0, 0.9)]);
      if (n >= 3) pool.push(['juggernaut', clamp(0.15 + (n - 3) * 0.06, 0, 0.6)]);
      if (n >= 3) pool.push(['raven', clamp(0.3 + (n - 3) * 0.1, 0, 1.1)]);     // flyers reach the sky-islands
      if (n >= 4) pool.push(['bloater', clamp(0.2 + (n - 4) * 0.08, 0, 0.8)]);
      if (n >= 5) pool.push(['megalith', clamp(0.12 + (n - 5) * 0.05, 0, 0.5)]);
      if (n >= 5) pool.push(['seer', clamp(0.15 + (n - 5) * 0.06, 0, 0.55)]);    // perched snipers, after the first few levels
      const total = pool.reduce((a, b) => a + b[1], 0);
      for (let i = 0; i < count; i++) {
        let r = Math.random() * total, t = pool[0][0];
        for (const [name, w] of pool) { if (r < w) { t = name; break; } r -= w; }
        this.spawnQueue.push({ t, hpScale: hpScale * hpMut, speedScale: speedScale * spdMut });
      }
      // keep constant pressure: more enemies on you at once, refilled as you kill
      this.maxConcurrent = Math.min(6 + n, 15) + (this.mutator && this.mutator.id === 'swarm' ? 5 : 0);
      this.spawnInterval = Math.max(0.12, 0.3 - n * 0.02) * (this.mutator && this.mutator.id === 'swarm' ? 0.6 : 1);
    }
    this.spawnTimer = 0;
    if (this.onWaveStart) this.onWaveStart(n, this.isBossWave);
    this.audio.waveStart();
  }

  // spawn near a point (boss reinforcements) instead of the arena edge
  spawnAdds(nearPos, count, type = null) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), r = rand(4, 8);
      let x = nearPos.x + Math.cos(a) * r, z = nearPos.z + Math.sin(a) * r;
      this.clampPoint(x, z);
      const t = type || (Math.random() < 0.6 ? 'stalker' : 'husk');
      const e = new Enemy(this, t, new THREE.Vector3(this._cx, 0, this._cz), 1 + this.wave * 0.05, 1);
      this.enemies.push(e);
    }
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  // re-drop a wedged enemy at a sensible fresh spot: near the player's layer
  // entrance if they're underground, else at the arena edge (out in the fog)
  relocate(e) {
    let x, z, y;
    if (this.playerUnder && this.world.entrances) {
      const ent = pick(this.world.entrances);
      x = ent.x * 0.55 + rand(-1.5, 1.5); z = ent.z * 0.55 + rand(-1.5, 1.5); y = -13;
    } else {
      const a = rand(0, Math.PI * 2), r = this.boundary * rand(0.85, 0.96);
      x = this.player.pos.x + Math.cos(a) * r; z = this.player.pos.z + Math.sin(a) * r;
      const dr = Math.hypot(x, z);
      if (dr > this.boundary - 2) { const k = (this.boundary - 2) / dr; x *= k; z *= k; }
      y = this.terrain.height(x, z);
    }
    this.fx.debris.emit(e.pos.x, e.pos.y + 0.6, e.pos.z, 0, 1.5, 0, 0.8, 0.4, 0.35, 0.3, 0.14, 8, 3);
    e.pos.set(x, y, z);
    e.vel.set(0, 0, 0); e.knockback.set(0, 0, 0);
  }

  clampPoint(x, z) {
    const dr = Math.hypot(x, z), b = this.boundary - 2;
    if (dr > b) { const k = b / dr; x *= k; z *= k; }
    this._cx = x; this._cz = z; return this;
  }

  spawnNow(item) {
    const a = rand(0, Math.PI * 2);
    const r = this.boundary * rand(0.82, 0.98);
    let x = this.player.pos.x + Math.cos(a) * r;
    let z = this.player.pos.z + Math.sin(a) * r;
    const dr = Math.hypot(x, z);
    if (dr > this.boundary - 2) { const k = (this.boundary - 2) / dr; x *= k; z *= k; }
    let y = this.terrain.height(x, z);
    // if the player is holed up underground, most walkers spawn down in the
    // tunnels at a sinkhole instead of uselessly pacing the surface
    if (item.boss && item.t === 'wurm') { x = rand(-3, 3); z = rand(-3, 3); y = -16; }
    else if (this.playerUnder && !TYPES[item.t].flyer && !item.boss && this.world.entrances && Math.random() < 0.65) {
      // spawn INSIDE the tunnel (out of sight), so they stalk out of the dark
      // instead of popping into view at the crater floor
      const e = pick(this.world.entrances);
      const t = rand(0.3, 0.6);
      x = e.x + (e.x * 0.475 - e.x) * t + rand(-1.5, 1.5);
      z = e.z + (e.z * 0.475 - e.z) * t + rand(-1.5, 1.5);
      y = -13;
    }
    const pos = new THREE.Vector3(x, y, z);
    const e = new Enemy(this, item.t, pos, item.hpScale, item.speedScale);
    // elites: rarer normally, guaranteed on an ELITE MARCH, golden on a BOUNTY
    if (!item.boss) {
      const kinds = ['blazing', 'frost', 'volatile'];
      if (this.mutator && this.mutator.id === 'elite') e.makeElite(pick(kinds));
      else if (this.mutator && this.mutator.id === 'bounty' && Math.random() < 0.3) e.makeElite('gilded');
      else if (this.wave >= 4 && Math.random() < Math.min(0.22, 0.045 * (this.wave - 3))) e.makeElite(pick(kinds));
    }
    this.enemies.push(e);
    if (item.boss) { this.boss = e; if (this.onBoss) this.onBoss('spawn', e); }
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  groundFor(x, z, y) {
    return this.world && this.world.groundAt ? this.world.groundAt(x, z, y) : this.terrain.height(x, z);
  }

  update(dt) {
    this.playerUnder = this.world && this.world.isUnder
      ? this.world.isUnder(this.player.pos.x, this.player.pos.z, this.player.pos.y + 0.5) : false;
    if (this.active) {
      if (this.spawnQueue.length === 0 && this.aliveCount() === 0 && this.betweenWaves <= 0) {
        if (this.wave > 0 && this.onWaveCleared) this.onWaveCleared(this.wave);
        if (this.wave > 0) this.audio.waveClear();
        this.betweenWaves = this.wave === 0 ? 1.0 : 4.0;
      }
      if (this.betweenWaves > 0) {
        this.betweenWaves -= dt;
        if (this.betweenWaves <= 0) this._startWave(this.wave + 1);
      }
      // pressure spawner: keep ~maxConcurrent enemies alive, refilling as you kill
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        let budget = 3;
        while (this.spawnQueue.length && this.aliveCount() < this.maxConcurrent && this.spawnTimer <= 0 && budget-- > 0) {
          this.spawnNow(this.spawnQueue.shift());
          this.spawnTimer = this.spawnInterval;
        }
      }
      // enrage the lone straggler so it hunts you (and is easy to find)
      if (this.spawnQueue.length === 0 && this.wave > 0 && this.aliveCount() === 1) {
        for (const e of this.enemies) { if (e.alive && !e.boss && !e.enraged) { e.enrage(); break; } }
      }
      // live boss health bar
      if (this.boss && this.onBoss) {
        if (this.boss.alive) this.onBoss('update', this.boss);
      }
    }
    const snap = this.enemies.slice();
    for (const e of snap) e.update(dt, this.player);
  }

  separation(self, radius) {
    const push = new THREE.Vector3();
    for (const o of this.enemies) {
      if (o === self || !o.alive) continue;
      const dx = self.pos.x - o.pos.x, dz = self.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = radius + o.def.radius;
      if (d2 < min * min && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        push.x += (dx / d) * (1 - d / min);
        push.z += (dz / d) * (1 - d / min);
      }
    }
    return push.multiplyScalar(1.4);
  }

  collideEnemy(e, r) {
    for (const c of this.colliders) {
      if (c.yMin !== undefined && e.pos.y < c.yMin) continue;
      if (c.yMax !== undefined && e.pos.y > c.yMax) continue;
      const dx = e.pos.x - c.x, dz = e.pos.z - c.z;
      const min = c.r + r; const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-5) { const d = Math.sqrt(d2); e.pos.x = c.x + dx / d * min; e.pos.z = c.z + dz / d * min; }
    }
    this.clampBounds(e);
  }

  clampBounds(e) {
    const dr = Math.hypot(e.pos.x, e.pos.z);
    const b = this.boundary + 3;
    if (dr > b) { const k = b / dr; e.pos.x *= k; e.pos.z *= k; }
  }

  // A spatial descriptor for a sound source: just the WORLD POSITION now. The
  // audio layer feeds it to an HRTF panner against the camera-placed listener,
  // so every enemy voice is localised in full 3D (direction, front/back, above,
  // distance) instead of the old left/right-only stereo pan. Kept the name so
  // all the existing `audio.x(panFor(pos), ...)` call sites need no change.
  panFor(pos) {
    return { x: pos.x, y: pos.y + 0.8, z: pos.z };   // +0.8 → sound from the torso, not the feet
  }

  raycastTargets() {
    const arr = [];
    for (const e of this.enemies) if (e.alive) for (const m of e.hitMeshes) arr.push(m);
    return arr;
  }

  aliveCount() { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  _onKilled(e, isHead) {
    this.kills++;
    // a flyer dies in the air — pop the feedback at its actual altitude, not the ground
    const fy = e.def.flyer ? e.pos.y : this.groundFor(e.pos.x, e.pos.z, e.pos.y) + e.def.height * 0.6;
    const pos = new THREE.Vector3(e.pos.x, fy, e.pos.z);
    if (e.boss) { const b = this.boss; this.boss = null; if (this.onBoss) this.onBoss('dead', b || e); }
    if (this.onKill) this.onKill(e, isHead, pos);
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  _remove(e) { const i = this.enemies.indexOf(e); if (i >= 0) this.enemies.splice(i, 1); }
}
