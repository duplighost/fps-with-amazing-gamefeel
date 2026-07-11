// Player movement: Quake/Source-style ground+air acceleration (crisp, snappy),
// but the vertical axis follows the terrain heightfield and horizontal motion
// collides with foliage cylinders + a soft circular arena boundary.
//
// The air game is the star: high jumps, strong air control, and a dash that runs
// on regenerating CHARGES and LIFTS you upward in the air — so you can chain
// jump → dash → dash and float/soar across the field for a long time. Layered on
// top: ADS walk, dash i-frames, and the dash-strike hooks the combat needs.

import * as THREE from 'three';
import { clamp, clamp01, damp } from '../engine/math.js';

const STAND_HEIGHT = 1.8, CROUCH_HEIGHT = 1.0;
const STAND_EYE = 1.65, CROUCH_EYE = 0.95;
const RADIUS = 0.4;

const GRAVITY = 18;
const WALK_SPEED = 6.8;       // reference speed for slide thresholds
const SPRINT_SPEED = 10.6;
const RUN_SPEED = SPRINT_SPEED; // the player always runs at this (no sprint toggle)
const CROUCH_SPEED = 3.4;
const GROUND_ACCEL = 128;
const AIR_ACCEL = 88;         // strong air control (Quake air-strafe feel)
const AIR_CAP = 2.2;
const FRICTION = 10.5;
const STOP_SPEED = 2.4;
const JUMP_SPEED = 9.8;
const DOUBLE_JUMP_SPEED = 19.0;   // a HUGE second launch (takes the max of current vy) — the sky ring is the point
const MAX_AIR_JUMPS = 1;
const COYOTE = 0.14;
const JUMP_BUFFER = 0.16;
const JUMP_CUT_GRACE = 0.11;      // short taps still get a real jump before the cut
const DOUBLE_JUMP_CUT_GRACE = 0.16;
const STICK = 0.42;               // snap-to-ground (small, so it never eats a jump)
const EDGE_GRACE = 0.34;          // stand this far past a platform's rim before you drop — your
                                  // body overhangs the ledge (like real footing) instead of the
                                  // top vanishing the instant your CENTRE clears the edge
const PLATFORM_GRACE = 1.7;       // island tops within this ABOVE the feet still count as ground —
                                  // big enough to stair-step along the sky-ring's undulating disc
                                  // chains (and it doubles as generous ledge-catch when landing);
                                  // jumping up through from far below is unaffected (one-way)
// Ledge-mantle: brushing the SIDE of a sky-island near its top vaults you up onto
// it — a fast, momentum-preserving climb so verticality never breaks your flow.
const MANTLE_REACH = 2.9;         // how far below the top your feet can be and still grab
const MANTLE_MARGIN = 0.75;       // horizontal band outside the rim that counts as contact
const MANTLE_COOLDOWN = 0.35;     // don't re-fire mid-vault
const SLIDE_BOOST = 1.26, SLIDE_FRICTION = 2.4, SLIDE_MIN = 7.5, SLIDE_TIME = 0.8;

// dash: charge-based (2 charges, regenerating) with a tiny anti-double cooldown.
// A ground dash hops slightly; an AIR dash lifts you up and lasts a touch longer,
// so chaining air dashes carries you up and across for a long, floaty traversal.
const DASH_SPEED = 24.5, AIR_DASH_SPEED = 28.0, DASH_TIME = 0.18, AIR_DASH_TIME = 0.24;
const DASH_COOLDOWN = 0.14, DASH_REGEN = 0.74, DASH_LIFT = 11.5, DASH_HOP = 3.0, DASH_BUFFER = 0.16;
const DASH_IFRAME = 0.06;          // invulnerability that outlasts the dash a touch
const DASH_CONTACT_IFRAME = 0.2;   // extra i-frames when a dash body-checks a survivor to a stop
const DASH_HIT_RADIUS = 1.7;       // how close an enemy must be to be dash-struck (+ its radius)
const ADS_WALK = 4.6;              // capped move speed while sighted

export class Controller {
  constructor(terrain, colliders, boundary, platforms = []) {
    this.terrain = terrain;
    this.colliders = colliders;      // [{x,z,r}]
    this.platforms = platforms;      // [{x,z,y,r}] one-way sky-island tops
    this.boundary = boundary;        // max radius from origin
    // layer hooks (set by main): layer-aware ground, cave ceiling, pond surface
    this.groundFn = null; this.ceilFn = null; this.isUnderFn = null; this.surfaceProbe = null;
    this.caveSDFFn = null;           // signed distance to the cave region (walls)
    this.inCraterFn = null;          // inside a sinkhole crater mouth (open air)
    this.surface = null;             // 'water' | 'ice' | null — what the feet are in/on
    this.speedMult = 1;              // external slow (frost-elite chill)
    this.pos = new THREE.Vector3(0, 0, 0);
    this.pos.y = terrain.height(0, 0);
    this.vel = new THREE.Vector3();
    this.onGround = true;
    this.crouchT = 0;
    this.height = STAND_HEIGHT;
    this.eyeHeight = STAND_EYE;

    this._coyote = 0; this._jumpBuffer = 0; this._jumpCutGrace = 0; this._stepDist = 0;
    this._sliding = false; this._slideTimer = 0; this._jumpedThisFrame = false;
    this._airJumps = 0;

    this._mantleCd = 0;              // ledge-mantle re-fire cooldown

    // charge-based dash
    this._dashTimer = 0; this._dashCooldown = 0; this._dashRecharge = 0; this._dashBuffer = 0;
    this._dashIFrame = 0;            // invulnerable window (dash + a little after)
    this.dashAir = false;
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this.dashHitRadius = DASH_HIT_RADIUS;
    this.dashCharges = 2; this.maxDashCharges = 2; this.dashRechargeRatio = 1;

    this.speed = 0; this.horizSpeed = 0;
    this.isSprinting = false; this.isMoving = false; this.isCrouching = false;
    this.events = { landed: 0, jumped: false, doubleJumped: false, dashed: false, stepped: false, slid: false, mantled: false };
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.onGround = true; this.crouchT = 0; this._sliding = false;
    this._airJumps = 0; this._jumpCutGrace = 0; this._mantleCd = 0;
    this._dashTimer = 0; this._dashCooldown = 0; this._dashRecharge = 0; this._dashBuffer = 0; this._dashIFrame = 0;
    this.dashCharges = this.maxDashCharges; this.dashRechargeRatio = 1;
  }

  isDashing() { return this._dashTimer > 0; }
  // invulnerable through the dash and a short recovery window
  get dashInvuln() { return this._dashIFrame > 0; }

  // End the dash early — a body-check into a survivor. Zeroing the timer is the
  // ONLY way to actually stop (the dash branch overwrites vel.x/z each frame while
  // it runs). Applies a backward rebound + optional grounded vy pop, and keeps you
  // invulnerable through the bounce recovery.
  endDash(rebound = 0, popY = 0) {
    if (this._dashTimer <= 0) return;
    this._dashTimer = 0;
    if (rebound > 0) { this.vel.x = -this.dashDir.x * rebound; this.vel.z = -this.dashDir.z * rebound; }
    if (popY > 0 && this.onGround) this.vel.y = Math.max(this.vel.y, popY);
    this._dashIFrame = Math.max(this._dashIFrame, DASH_CONTACT_IFRAME);
  }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  update(dt, input, wishYaw) {
    const ev = this.events;
    ev.landed = 0; ev.jumped = false; ev.doubleJumped = false; ev.dashed = false; ev.stepped = false; ev.slid = false; ev.mantled = false;
    this._jumpedThisFrame = false;
    this._dashCooldown = Math.max(0, this._dashCooldown - dt);
    this._dashIFrame = Math.max(0, this._dashIFrame - dt);
    this._mantleCd = Math.max(0, this._mantleCd - dt);

    // buffer the dash input (responsive, like the jump buffer)
    if (input.wasPressed('dash')) this._dashBuffer = DASH_BUFFER;
    this._dashBuffer = Math.max(0, this._dashBuffer - dt);
    // regenerate dash charges over time (faster on the ground)
    if (this.dashCharges < this.maxDashCharges) {
      this._dashRecharge += dt * (this.onGround ? 1.35 : 1.0);
      while (this._dashRecharge >= DASH_REGEN && this.dashCharges < this.maxDashCharges) {
        this._dashRecharge -= DASH_REGEN; this.dashCharges++;
      }
    } else this._dashRecharge = 0;
    this.dashRechargeRatio = this.dashCharges < this.maxDashCharges ? clamp01(this._dashRecharge / DASH_REGEN) : 1;

    const axis = input.moveAxis();
    const sin = Math.sin(wishYaw), cos = Math.cos(wishYaw);
    const wishDir = new THREE.Vector3(axis.x * cos - axis.z * sin, 0, -axis.x * sin - axis.z * cos);
    if (wishDir.lengthSq() > 0) wishDir.normalize();
    const fwdDir = new THREE.Vector3(-sin, 0, -cos);   // dash falls back to look dir

    // crouch / slide (no sprint toggle — you always run at the top speed)
    const wantCrouch = input.isDown('crouch');
    if (wantCrouch && this.onGround && !this._sliding && this.horizSpeed > SLIDE_MIN && input.wasPressed('crouch')) {
      this._sliding = true; this._slideTimer = SLIDE_TIME;
      this.vel.x *= SLIDE_BOOST; this.vel.z *= SLIDE_BOOST; ev.slid = true;
    }
    if (this._sliding) {
      this._slideTimer -= dt;
      if (!wantCrouch || this._slideTimer <= 0 || this.horizSpeed < WALK_SPEED * 0.6 || !this.onGround) this._sliding = false;
    }
    const targetCrouch = (wantCrouch || this._sliding) ? 1 : 0;
    this.crouchT = damp(this.crouchT, targetCrouch, 14, dt);
    this.height = STAND_HEIGHT - (STAND_HEIGHT - CROUCH_HEIGHT) * this.crouchT;
    this.eyeHeight = STAND_EYE - (STAND_EYE - CROUCH_EYE) * this.crouchT;

    // ADS drops you to a steady walk; crouch slows you; otherwise full run speed
    const aiming = input.isDown('aim') && !this._sliding && this._dashTimer <= 0;
    let maxSpeed = (this.crouchT > 0.5 && !this._sliding) ? CROUCH_SPEED : RUN_SPEED;
    if (aiming) maxSpeed = Math.min(maxSpeed, ADS_WALK);
    if (this.surface === 'water') maxSpeed *= 0.78;   // wading is heavy
    maxSpeed *= this.speedMult;
    this.isCrouching = this.crouchT > 0.5;
    this.isSprinting = this.onGround && (axis.x || axis.z) && !this._sliding && !this.isCrouching && !aiming;

    // jump: coyote + buffer + variable height, plus a high mid-air double jump
    if (input.wasPressed('jump')) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._jumpCutGrace = Math.max(0, this._jumpCutGrace - dt);
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt);
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vel.y = JUMP_SPEED; this.onGround = false; this._coyote = 0; this._jumpBuffer = 0;
      this._jumpCutGrace = JUMP_CUT_GRACE;
      this._jumpedThisFrame = true; this._sliding = false; ev.jumped = true;
    } else if (this._jumpBuffer > 0 && this._airJumps < MAX_AIR_JUMPS) {
      this.vel.y = Math.max(this.vel.y, DOUBLE_JUMP_SPEED);   // never kills upward momentum
      this._airJumps++; this._jumpBuffer = 0;
      this._jumpCutGrace = DOUBLE_JUMP_CUT_GRACE;
      this._jumpedThisFrame = true; this._sliding = false;
      ev.jumped = true; ev.doubleJumped = true;
    }
    if (!input.isDown('jump') && this.vel.y > 0 && this._jumpCutGrace <= 0) this.vel.y *= Math.pow(0.0025, dt);

    // dash: spend a charge; an air dash lifts you up, a ground dash hops
    if (this._dashBuffer > 0 && this.dashCharges > 0 && this._dashCooldown <= 0) {
      const dir = wishDir.lengthSq() > 0 ? wishDir.clone() : fwdDir.clone();
      dir.y = 0; if (dir.lengthSq() < 1e-6) dir.copy(fwdDir); dir.normalize();
      this.dashDir.copy(dir);
      this.dashAir = !this.onGround;
      this._dashTimer = this.dashAir ? AIR_DASH_TIME : DASH_TIME;
      this._dashCooldown = DASH_COOLDOWN;
      this._dashIFrame = this._dashTimer + DASH_IFRAME;
      this._dashBuffer = 0; this.dashCharges--; this._dashRecharge = 0;
      this._sliding = false;
      this.vel.y = Math.max(this.vel.y, this.dashAir ? DASH_LIFT : DASH_HOP);
      ev.dashed = true;
    }

    // horizontal acceleration
    const velXZ = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const dashNow = this._dashTimer > 0;
    if (dashNow) {
      // hold the burst; gravity still acts on vy so the air-dash arcs up then over
      this._dashTimer = Math.max(0, this._dashTimer - dt);
      velXZ.copy(this.dashDir).multiplyScalar(this.dashAir ? AIR_DASH_SPEED : DASH_SPEED);
    } else if (this.onGround) {
      // frozen pond: barely any grip — you skate, carrying momentum
      const onIce = this.surface === 'ice';
      const fr = onIce ? 1.5 : (this._sliding ? SLIDE_FRICTION : FRICTION);
      if (!this._jumpedThisFrame) this._friction(velXZ, fr, dt);
      if (!this._sliding) this._accel(velXZ, wishDir, maxSpeed, GROUND_ACCEL * (onIce ? 0.2 : 1), dt);
      else this._accel(velXZ, wishDir, maxSpeed * 1.1, GROUND_ACCEL * 0.14, dt);
    } else {
      this._airAccel(velXZ, wishDir, maxSpeed, AIR_ACCEL, dt);
    }
    this.vel.x = velXZ.x; this.vel.z = velXZ.z;
    this.vel.y -= GRAVITY * dt;

    // integrate horizontal + collide
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._collide();

    // ledge-mantle: brushing a sky-island's side near its top vaults you up
    if (!dashNow) this._tryMantle(wishDir);

    // vertical: follow terrain (or a sky-island top), land
    const wasGround = this.onGround;
    // ground height = terrain, or the highest one-way platform we're over and
    // whose top we're at/above (footY = pos.y BEFORE this frame's fall)
    const groundH = this.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    const fallSpeed = -this.vel.y;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundH + STICK && this.vel.y <= 0.001) {
      if (!wasGround && fallSpeed > 1.6) ev.landed = clamp01((fallSpeed - 1.6) / 11);
      this.pos.y = groundH; this.vel.y = 0; this.onGround = true;
      this._airJumps = 0;
      // treehouse deck railings: while you're standing on a railed deck, its
      // edge stops you from strolling off (so you can turn + shoot up there),
      // EXCEPT through the doorways facing its bridges. Jumping lifts you off
      // the deck (onGround false) so deliberate leaps are never blocked.
      if (this._groundPlat && this._groundPlat.rail) this._railClamp(this._groundPlat);
    } else {
      this.onGround = false;
    }

    // underground WALLS: while inside the cave, you can't walk out through the
    // pinch at the region edge (that used to teleport you up through the rock —
    // now it's simply a wall you slide along)
    if (this.caveSDFFn && this.isUnderFn && this.isUnderFn(this.pos.x, this.pos.z, this.pos.y + 0.4) &&
        !(this.inCraterFn && this.inCraterFn(this.pos.x, this.pos.z))) {
      const d = this.caveSDFFn(this.pos.x, this.pos.z);
      if (d > -0.55) {
        const e = 0.4;
        const gx = (this.caveSDFFn(this.pos.x + e, this.pos.z) - this.caveSDFFn(this.pos.x - e, this.pos.z)) / (2 * e);
        const gz = (this.caveSDFFn(this.pos.x, this.pos.z + e) - this.caveSDFFn(this.pos.x, this.pos.z - e)) / (2 * e);
        const L = Math.hypot(gx, gz) || 1;
        const push = d + 0.55;
        this.pos.x -= (gx / L) * push;
        this.pos.z -= (gz / L) * push;
      }
    }

    // underground ceiling: keep the head out of the rock. Open shafts (where the
    // carved surface is BELOW the cave ceiling) skip this so you can jump out.
    if (this.ceilFn && this.isUnderFn && this.isUnderFn(this.pos.x, this.pos.z, this.pos.y + 0.4)) {
      const ceil = this.ceilFn(this.pos.x, this.pos.z);
      if (this.terrain.height(this.pos.x, this.pos.z) > ceil && this.pos.y + this.height > ceil - 0.08) {
        this.pos.y = ceil - 0.08 - this.height;
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }
    // what the feet are in/on (pond water, winter ice) — read by feel + sounds
    this.surface = this.surfaceProbe ? this.surfaceProbe(this.pos.x, this.pos.z, this.pos.y) : null;

    // readouts + footsteps
    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = this.vel.length();
    this.isMoving = this.horizSpeed > 0.6;
    if (this.onGround && this.isMoving && !this._sliding) {
      this._stepDist += this.horizSpeed * dt;
      const stride = this.isSprinting ? 2.6 : 1.9;
      if (this._stepDist >= stride) { this._stepDist = 0; ev.stepped = true; }
    }
  }

  // Effective ground under (x,z): the terrain, raised to a sky-island top when
  // the player is horizontally over it AND their feet are at/above that top —
  // giving classic one-way platforms (jump up through, land coming down).
  groundHeight(x, z, footY) {
    let g = this.groundFn ? this.groundFn(x, z, footY) : this.terrain.height(x, z);
    let plat = null;
    for (const p of this.platforms) {
      const dx = x - p.x, dz = z - p.z;
      const rr = p.r + EDGE_GRACE;   // body-overhang ledge, so edges feel solid underfoot
      if (dx * dx + dz * dz <= rr * rr && p.y > g && footY >= p.y - PLATFORM_GRACE) { g = p.y; plat = p; }
    }
    this._groundPlat = plat;
    return g;
  }

  // Keep the player on a railed deck: push them back inside the rim and cancel
  // outward speed, unless they're heading out through a bridge doorway (a gap
  // angle stored on p.rail). Only runs while grounded — a jump clears the deck.
  _railClamp(p) {
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    const lim = p.r - 0.45;
    if (d <= lim || d < 1e-4) return;
    const ang = Math.atan2(dz, dx);
    for (const gp of p.rail) {
      let da = Math.abs(ang - gp); if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.5) return;   // in a doorway — let them walk out onto the bridge
    }
    this.pos.x = p.x + (dx / d) * lim;
    this.pos.z = p.z + (dz / d) * lim;
    const outv = (this.vel.x * dx + this.vel.z * dz) / d;
    if (outv > 0) { this.vel.x -= outv * (dx / d); this.vel.z -= outv * (dz / d); }
  }

  // If the player is pressed against the SIDE of a sky-island just below its top,
  // vault them up and over the lip — a quick, momentum-preserving mantle so the
  // vertical play never stalls into a stop-and-clamber.
  _tryMantle(wishDir) {
    if (this._mantleCd > 0) return;
    const feetY = this.pos.y;
    for (const p of this.platforms) {
      const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) continue;
      // at the rim: near the edge radius, and feet a short way below the top
      if (d < p.r - 0.6 || d > p.r + RADIUS + MANTLE_MARGIN) continue;
      const below = p.y - feetY;
      if (below <= 0.4 || below > MANTLE_REACH) continue;
      // intent: don't yank the player if they're clearly moving/steering AWAY
      const inX = -dx / d, inZ = -dz / d;
      const velInto = this.vel.x * inX + this.vel.z * inZ;
      const wishInto = wishDir.x * inX + wishDir.z * inZ;
      if (velInto < -1.5 || wishInto < -0.4) continue;
      // pop up just over the lip, carry inward, keep the horizontal pace.
      // Math.max so a mantle never ROBS an already-faster ascent (same invariant
      // the double-jump + dash preserve) — brushing a ledge mid-soar only helps.
      this.vel.y = Math.max(this.vel.y, Math.sqrt(2 * GRAVITY * (below + 0.65)));
      this.vel.x += inX * 5.5; this.vel.z += inZ * 5.5;
      this._jumpCutGrace = 0.3;      // protect the vault from the variable-jump cut
      this._mantleCd = MANTLE_COOLDOWN;
      this._airJumps = 0;            // refresh air options so you can keep chaining
      this._sliding = false;
      this.onGround = false;
      this.events.mantled = true;
      return;
    }
  }

  _collide() {
    const r = RADIUS;
    for (const c of this.colliders) {
      if (c.yMin !== undefined && this.pos.y < c.yMin) continue;   // e.g. the cavern under the great tree
      if (c.yMax !== undefined && this.pos.y > c.yMax) continue;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const min = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x = c.x + (dx / d) * min;
        this.pos.z = c.z + (dz / d) * min;
      }
    }
    // soft circular boundary
    const b = this.boundary - r;
    const dr = Math.hypot(this.pos.x, this.pos.z);
    if (dr > b) {
      const k = b / dr;
      this.pos.x *= k; this.pos.z *= k;
      const nx = this.pos.x / dr, nz = this.pos.z / dr;
      const outv = this.vel.x * nx + this.vel.z * nz;
      if (outv > 0) { this.vel.x -= outv * nx; this.vel.z -= outv * nz; }
    }
  }

  _accel(vel, dir, wishSpeed, accel, dt) {
    const cur = vel.dot(dir); const add = wishSpeed - cur;
    if (add <= 0) return;
    let a = accel * wishSpeed * dt; if (a > add) a = add;
    vel.addScaledVector(dir, a);
  }
  _airAccel(vel, dir, wishSpeed, accel, dt) {
    const capped = Math.min(wishSpeed, AIR_CAP);
    const cur = vel.dot(dir); const add = capped - cur;
    if (add <= 0) return;
    let a = accel * wishSpeed * dt; if (a > add) a = add;
    vel.addScaledVector(dir, a);
  }
  _friction(vel, friction, dt) {
    const speed = vel.length();
    if (speed < 0.01) { vel.set(0, 0, 0); return; }
    const control = speed < STOP_SPEED ? STOP_SPEED : speed;
    const newSpeed = Math.max(0, speed - control * friction * dt);
    vel.multiplyScalar(newSpeed / speed);
  }
}
