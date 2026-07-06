// World layout — the pond and the underground cave network, as pure math.
// Terrain, rendering, and gameplay all sample these same functions, so the
// player, enemies, pickups and projectiles agree about every surface.

import { clamp01, lerp } from '../engine/math.js';

// --- the pond -------------------------------------------------------------
export const POND = { x: -7, z: -22, r: 6.5, rimBlend: 4.5 };
// The waterline is CALIBRATED at load by terrain.js: it samples the basin rim
// and sets the water just below the rim's lowest point, so the pond is always
// a true depression in the local terrain — never a puddle perched on a hill.
export let WATER_Y = -0.6;
export function setPondLevel(y) { WATER_Y = y; }
export const POND_DEPTH = 0.85;   // pond floor sits this far below the waterline

export function pondDist(x, z) { return Math.hypot(x - POND.x, z - POND.z); }
export function inPond(x, z, pad = 0) { return pondDist(x, z) <= POND.r + pad; }

// --- the underground: a big central cavern + radial tunnels to sinkholes ---
export const CAVERN_R = 19;            // open cavern under the middle of the map
export const CAVERN_FLOOR = -16, CAVERN_CEIL = -7.5;
export const TUNNEL_HALFW = 4;
export const TUNNEL_FLOOR = -13.5, TUNNEL_CEIL = -9;
export const ENTRANCE_R = 6;           // sinkhole shaft radius (cave-region side)
export const ENTRANCE_CARVE = 11;      // surface crater radius that funnels down

// sinkhole entrances around the map (also where the surface is carved down)
export const ENTRANCES = [0.7, 2.2, 3.9, 5.3].map((a) => ({
  a, x: Math.cos(a) * 40, z: Math.sin(a) * 40,
}));

function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// signed distance to the cave region (negative = inside). Union of the cavern
// disc, the radial tunnels, and the entrance shafts.
export function caveSDF(x, z) {
  let d = Math.hypot(x, z) - CAVERN_R;
  for (const e of ENTRANCES) {
    const nx = e.x / 40, nz = e.z / 40;
    d = Math.min(d, distSeg(x, z, nx * (CAVERN_R - 2), nz * (CAVERN_R - 2), e.x, e.z) - TUNNEL_HALFW);
    d = Math.min(d, Math.hypot(x - e.x, z - e.z) - ENTRANCE_R);
  }
  return d;
}

// floor/ceiling of the underground. The floor rises to MEET the ceiling at the
// region edge (a pinch), so the cave seals itself — no separate walls needed.
export function caveFloorY(x, z) {
  const rC = Math.hypot(x, z);
  const deep = clamp01((CAVERN_R - rC) / 7);            // 1 deep in the cavern
  const base = lerp(TUNNEL_FLOOR, CAVERN_FLOOR, deep * deep);
  const ceil = caveCeilY(x, z);
  const t = clamp01(-caveSDF(x, z) / 2.5);              // 0 at the wall → pinch
  return lerp(ceil, base, t);
}
export function caveCeilY(x, z) {
  const rC = Math.hypot(x, z);
  const deep = clamp01((CAVERN_R - rC) / 7);
  return lerp(TUNNEL_CEIL, CAVERN_CEIL, deep * deep);
}

// is a point (with a y) inside the underground space?
export function isUnder(x, z, y) {
  return caveSDF(x, z) < 0 && y < caveCeilY(x, z) + 0.4;
}

// inside a sinkhole crater's open mouth (no rock to clip through here — the
// funnel walls are ordinary walkable terrain, so wall clamps must stand down)
export function inCraterMouth(x, z) {
  for (const e of ENTRANCES) {
    const dx = x - e.x, dz = z - e.z;
    if (dx * dx + dz * dz < (ENTRANCE_CARVE + 1.5) * (ENTRANCE_CARVE + 1.5)) return true;
  }
  return false;
}
