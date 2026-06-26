// Grind rails — the Rocket-Shoes idea ported to 3D. Each rail is a smooth
// Catmull-Rom curve through space, rendered as a glowing neon tube. Rails wrap
// the arena (a loop), climb from the floor up to the rooftops (risers), and arc
// high across the middle (a sky bridge). The controller magnetically latches to
// the nearest one and the rail carries the player along it, fast.

import * as THREE from 'three';
import { clamp } from '../engine/math.js';

// Control points (x, y, z). Loop is closed; the rest are open lines.
const RAIL_DEFS = [
  {
    name: 'loop', closed: true, color: 0x7df9ff, radius: 0.1,
    // a perimeter circuit hugging the arena walls (~3m inside the ±32 walls):
    // a rounded square that dips low (2.4) at the mid-walls — easy on-ramps you
    // can run onto — and rises (3.8) over the corners.
    points: [
      [29, 2.4, 0], [27, 3.8, 27], [0, 2.4, 29], [-27, 3.8, 27],
      [-29, 2.4, 0], [-27, 3.8, -27], [0, 2.4, -29], [27, 3.8, -27],
    ],
  },
];

export function buildRails(scene) {
  const list = [];
  for (const def of RAIL_DEFS) {
    const pts = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, !!def.closed, 'catmullrom', 0.5);
    const length = curve.getLength();

    // cached samples for fast nearest-rail queries (latching)
    const N = Math.max(28, Math.ceil(length / 0.8));
    const samples = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      samples.push({ t, p: curve.getPointAt(t), tan: curve.getTangentAt(t).clone().normalize() });
    }

    // visuals: a solid emissive tube + a fat additive glow shell
    const seg = Math.max(48, Math.ceil(length * 2.2));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, seg, def.radius, 7, !!def.closed),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 1.7, metalness: 0.4, roughness: 0.3 })
    );
    tube.castShadow = false;
    scene.add(tube);
    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(curve, seg, def.radius * 2.6, 7, !!def.closed),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    scene.add(glow);

    list.push({ def, curve, closed: !!def.closed, length, samples, color: def.color, tube, glow, _phase: pts.length });
  }
  return new Rails(list);
}

export class Rails {
  constructor(list) {
    this.list = list;
    this.time = 0;
  }

  // Nearest GRABBABLE rail by horizontal distance, restricted to samples whose
  // height is within [yMin, yMax] — so a high rail passing overhead can't shadow
  // a low rail you're standing next to. Returns the sample, or null.
  nearest(point, maxHoriz, yMin, yMax) {
    let best = null;
    let bestD = maxHoriz * maxHoriz;
    for (const r of this.list) {
      const s = r.samples;
      for (let i = 0; i < s.length; i++) {
        if (s[i].p.y < yMin || s[i].p.y > yMax) continue;
        const dx = s[i].p.x - point.x, dz = s[i].p.z - point.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) { bestD = d2; best = { rail: r, t: s[i].t, point: s[i].p, tangent: s[i].tan }; }
      }
    }
    return best;
  }

  pointAt(rail, t) {
    return rail.curve.getPointAt(rail.closed ? wrap01(t) : clamp(t, 0, 1));
  }
  tangentAt(rail, t) {
    return rail.curve.getTangentAt(rail.closed ? wrap01(t) : clamp(t, 0, 1)).clone().normalize();
  }

  update(dt) {
    this.time += dt;
    for (const r of this.list) {
      r.tube.material.emissiveIntensity = 1.5 + Math.sin(this.time * 3 + r._phase) * 0.35;
    }
  }
}

function wrap01(t) { return ((t % 1) + 1) % 1; }
