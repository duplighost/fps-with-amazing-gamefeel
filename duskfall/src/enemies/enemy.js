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

const TYPES = {
  husk: {
    hp: 70, speed: 4.0, radius: 0.42, height: 1.9, damage: 12, attackCd: 1.1, score: 100,
    skin: 0x59636f, accent: 0xffab33, blood: 0x6b3b2a, rate: 5.5, reach: 0.9,
    gait: 'walk', headY: 0.78, build: buildHusk,
  },
  stalker: {
    hp: 42, speed: 8.4, radius: 0.36, height: 1.55, damage: 9, attackCd: 0.8, score: 150,
    skin: 0x44552f, accent: 0x74ff2e, blood: 0x3f6a1e, rate: 12, reach: 0.7,
    gait: 'run', headY: 0.66, weave: 2.0, lunge: true, build: buildStalker,
  },
  juggernaut: {
    hp: 340, speed: 2.4, radius: 0.95, height: 2.85, damage: 34, attackCd: 1.6, score: 350,
    skin: 0x41444f, accent: 0xff3311, blood: 0xff5a22, rate: 3.4, reach: 1.4,
    gait: 'stomp', headY: 0.82, stomp: true, deathTrauma: 0.28, build: buildJuggernaut,
  },
  wisp: {
    hp: 88, speed: 4.8, radius: 0.44, height: 2.1, damage: 14, attackCd: 1.0, score: 200,
    skin: 0x9fd6e2, accent: 0x33ddff, blood: 0x33ddff, rate: 4, reach: 0.9,
    gait: 'float', headY: 0.74, hover: 1.15, deathStyle: 'dissolve', build: buildWisp,
  },
  bloater: {
    hp: 165, speed: 2.7, radius: 0.7, height: 2.2, damage: 20, attackCd: 1.4, score: 250,
    skin: 0x7c7a34, accent: 0xff8a1e, blood: 0x9fb830, rate: 4.5, reach: 1.1,
    gait: 'waddle', headY: 0.8, burst: true, build: buildBloater,
  },
  // --- BOSS: a towering molten titan that slams and calls in reinforcements ---
  colossus: {
    hp: 1600, speed: 2.9, radius: 1.7, height: 5.0, damage: 42, attackCd: 2.4, score: 3000,
    skin: 0x4a3a3e, accent: 0xff4416, blood: 0xff6a22, rate: 2.4, reach: 3.4,
    gait: 'stomp', headY: 0.9, stomp: true, deathTrauma: 0.7, boss: true, name: 'THE COLOSSUS',
    build: buildColossus,
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

    this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z) + (this.def.hover || 0);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.01);
    mgr.scene.add(this.group);
  }

  isHeadshot(point) {
    return point.y > this.pos.y + this.def.height * (this.def.headY || 0.78);
  }

  takeDamage(dmg, point, dir, isHead) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flash = 1;
    this.hurtLean = clamp((dir.x * Math.sin(this.facing) + dir.z * Math.cos(this.facing)), -1, 1) * 0.25;
    const kb = (isHead ? 3.5 : 2.2) * (this.def.gait === 'stomp' ? 0.35 : 1);
    this.knockback.addScaledVector(dir, kb); this.knockback.y = 0;
    const pan = this.mgr.panFor(this.pos);
    this.mgr.fx.bloodBurst(point, dir, isHead ? 1.6 : 1, this.def.blood);
    this.mgr.audio.enemyHit(pan);
    if (this.health <= 0) { this._die(point, dir, isHead); return true; }
    return false;
  }

  _die(point, dir, isHead) {
    this.alive = false;
    this.deathT = 0;
    this.knockback.addScaledVector(dir, this.def.gait === 'stomp' ? 0.8 : 2.5);
    this._fallDir = Math.atan2(dir.x, dir.z);
    const pan = this.mgr.panFor(this.pos);
    const center = this.group.position.clone().setY(this.pos.y + this.def.height * (isHead ? 0.85 : 0.5));
    this.mgr.fx.deathBurst(center, this.def.blood);
    if (this.def.burst) {
      // rupture: a second, larger gas-and-gore burst
      this.mgr.fx.deathBurst(center, this.def.blood);
      this.mgr.fx.bloodBurst(center, new THREE.Vector3(0, 1, 0), 2.2, this.def.accent);
      this.mgr.fx.addTrauma(0.2);
    }
    this.mgr.fx.addTrauma(this.def.deathTrauma || 0.12);
    this.mgr.audio.enemyDeath(pan);
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
    if (this.deathT >= 0) { this._updateDeath(dt); return; }

    if (this.spawnT < 1) { this.spawnT = clamp01(this.spawnT + dt * 2.4); this.group.scale.setScalar(this.spawnT); }

    const def = this.def;
    const toP = new THREE.Vector3().subVectors(player.pos, this.pos); toP.y = 0;
    const dist = toP.length();
    const dir = dist > 0.001 ? toP.clone().multiplyScalar(1 / dist) : new THREE.Vector3(0, 0, 1);

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
      else if (this.lungeCd <= 0 && dist < 16 && dist > def.reach + 1) { this.lunging = 0.5; this.lungeCd = rand(2.5, 4.5); this.mgr.audio.growl(this.mgr.panFor(this.pos)); }
    }

    if (dist > def.reach + 0.4) desired.addScaledVector(dir, spd);

    // stalker/wisp weave: a sideways sine so they don't beeline (enraged charges straight)
    if (def.weave && this.lunging <= 0 && !this.enraged) {
      this.weavePhase += dt * def.weave;
      const perp = new THREE.Vector3(dir.z, 0, -dir.x);
      desired.addScaledVector(perp, Math.sin(this.weavePhase) * spd * 0.6);
    }

    const sep = this.mgr.separation(this, def.radius);
    desired.addScaledVector(sep, spd);
    this.vel.x = damp(this.vel.x, desired.x, def.gait === 'run' ? 9 : 7, dt);
    this.vel.z = damp(this.vel.z, desired.z, def.gait === 'run' ? 9 : 7, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-7 * dt));
    // wisps float over foliage; everything else pushes out of it
    if (def.gait !== 'float') this.mgr.collideEnemy(this, def.radius);
    else this.mgr.clampBounds(this);
    this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z) + (def.hover || 0);

    this._animate(dt, dist);
    // apply visual bob (float/stomp) on top of pos
    this.group.position.set(this.pos.x, this.pos.y + this.bob, this.pos.z);

    if (this.boss) this._bossBehavior(dt, dist, player);
    else {
      // attack on contact
      this.attackTimer -= dt;
      if (dist <= def.reach + player.radius + 0.5 && this.attackTimer <= 0) {
        this.attackTimer = def.attackCd;
        player.takeDamage((def.damage + this.mgr.wave * 0.5) * this._enrageDmg, this.pos);
        this.mgr.audio.enemyAttack(this.mgr.panFor(this.pos));
        if (this.parts.armL) { this.parts.armL.rotation.x = -2.4; this.parts.armR.rotation.x = -2.4; }
      }
    }

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
    if (this.growlCd <= 0) { this.growlCd = rand(4, 10); if (dist < 30) this.mgr.audio.growl(this.mgr.panFor(this.pos)); }

    this.flash = damp(this.flash, 0, 9, dt);
    this._applyFlash();
  }

  // Boss: telegraphed ground-slam AoE + periodic add-spawns.
  _bossBehavior(dt, dist, player) {
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
          if (dist < slamR) player.takeDamage(def.damage, this.pos);
        }
      } else {
        this._slamT = -1; this._slammed = false;
        this.attackTimer = def.attackCd;
      }
    } else {
      this.attackTimer -= dt;
      if (dist <= def.reach + player.radius && this.attackTimer <= 0) { this._slamT = 0; this._slammed = false; }
    }
    // periodically call in reinforcements
    this._addCd -= dt;
    if (this._addCd <= 0) {
      this._addCd = rand(7, 10);
      if (this.mgr.aliveCount() < 10) this.mgr.spawnAdds(this.pos, 2);
      this.mgr.audio.growl(this.mgr.panFor(this.pos));
    }
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
      this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z) + (def.hover || 0) + k * 0.6;
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      this._setOpacity(fade);
      this.flash = damp(this.flash, 0, 9, dt); this._applyFlash();
      if (t >= 1.0) this._dispose();
      return;
    }

    // default: crumple to the ground, then sink + fade
    const fallAmt = clamp01(t / 0.5);
    this.group.rotation.x = lerp(0, Math.PI * 0.5, easeOut(fallAmt));
    this.pos.y = this.mgr.terrain.height(this.pos.x, this.pos.z);
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
    this.terrain = world.terrain;
    this.colliders = world.colliders;
    this.boundary = world.playRadius;
    this.player = player;
    this.enemies = [];
    this.wave = 0; this.score = 0; this.kills = 0;
    this.spawnQueue = []; this.spawnTimer = 0; this.betweenWaves = 0; this.active = false;
    this.boss = null; this.isBossWave = false;
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
  }

  bossWaveFor(n) { return n > 0 && n % 5 === 0; }

  start() { this.active = true; this.betweenWaves = 2.0; }

  _startWave(n) {
    this.wave = n;
    const hpScale = 1 + (n - 1) * 0.14;
    const speedScale = 1 + (n - 1) * 0.03;
    this.spawnQueue = [];
    this.isBossWave = this.bossWaveFor(n);

    if (this.isBossWave) {
      // a boss plus a light escort. The boss hp climbs each boss encounter.
      const bossNum = n / 5;
      const bossHp = 1 + (bossNum - 1) * 0.7;
      this.spawnQueue.push({ t: 'colossus', hpScale: bossHp, speedScale: 1, boss: true });
      const escort = 3 + bossNum;
      for (let i = 0; i < escort; i++) {
        this.spawnQueue.push({ t: Math.random() < 0.5 ? 'stalker' : 'husk', hpScale, speedScale });
      }
      // fewer at once during the boss so the boss reads clearly
      this.maxConcurrent = 6;
      this.spawnInterval = 0.7;
    } else {
      const count = Math.min(9 + n * 3, 50);
      // weighted spawn pool, unlocking + ramping variety as waves climb
      const pool = [['husk', Math.max(0.5, 2.4 - n * 0.18)]];
      if (n >= 1) pool.push(['stalker', clamp(0.4 + n * 0.12, 0, 1.6)]);
      if (n >= 2) pool.push(['wisp', clamp(0.2 + (n - 2) * 0.1, 0, 0.9)]);
      if (n >= 3) pool.push(['juggernaut', clamp(0.15 + (n - 3) * 0.06, 0, 0.6)]);
      if (n >= 4) pool.push(['bloater', clamp(0.2 + (n - 4) * 0.08, 0, 0.8)]);
      const total = pool.reduce((a, b) => a + b[1], 0);
      for (let i = 0; i < count; i++) {
        let r = Math.random() * total, t = pool[0][0];
        for (const [name, w] of pool) { if (r < w) { t = name; break; } r -= w; }
        this.spawnQueue.push({ t, hpScale, speedScale });
      }
      // keep constant pressure: more enemies on you at once, refilled as you kill
      this.maxConcurrent = Math.min(6 + n, 15);
      this.spawnInterval = Math.max(0.12, 0.3 - n * 0.02);
    }
    this.spawnTimer = 0;
    if (this.onWaveStart) this.onWaveStart(n, this.isBossWave);
    this.audio.waveStart();
  }

  // spawn near a point (boss reinforcements) instead of the arena edge
  spawnAdds(nearPos, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), r = rand(4, 8);
      let x = nearPos.x + Math.cos(a) * r, z = nearPos.z + Math.sin(a) * r;
      this.clampPoint(x, z);
      const t = Math.random() < 0.6 ? 'stalker' : 'husk';
      const e = new Enemy(this, t, new THREE.Vector3(this._cx, 0, this._cz), 1 + this.wave * 0.05, 1);
      this.enemies.push(e);
    }
    if (this.onCountChange) this.onCountChange(this.aliveCount());
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
    const pos = new THREE.Vector3(x, this.terrain.height(x, z), z);
    const e = new Enemy(this, item.t, pos, item.hpScale, item.speedScale);
    this.enemies.push(e);
    if (item.boss) { this.boss = e; if (this.onBoss) this.onBoss('spawn', e); }
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  update(dt) {
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

  panFor(pos) {
    const rel = new THREE.Vector3().subVectors(pos, this.player.pos);
    const yaw = this.player.yaw ? this.player.yaw() : 0;
    const right = Math.cos(yaw) * rel.x - Math.sin(yaw) * rel.z;
    return clamp(right / 16, -1, 1);
  }

  raycastTargets() {
    const arr = [];
    for (const e of this.enemies) if (e.alive) for (const m of e.hitMeshes) arr.push(m);
    return arr;
  }

  aliveCount() { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }

  _onKilled(e, isHead) {
    this.kills++;
    const pos = new THREE.Vector3(e.pos.x, this.terrain.height(e.pos.x, e.pos.z) + e.def.height * 0.6, e.pos.z);
    if (e.boss) { const b = this.boss; this.boss = null; if (this.onBoss) this.onBoss('dead', b || e); }
    if (this.onKill) this.onKill(e, isHead, pos);
    if (this.onCountChange) this.onCountChange(this.aliveCount());
  }

  _remove(e) { const i = this.enemies.indexOf(e); if (i >= 0) this.enemies.splice(i, 1); }
}
