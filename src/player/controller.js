// Player movement controller. Quake/Source-flavoured: explicit ground/air
// acceleration, friction with a stop-speed for crisp halts, air-strafe
// acceleration (so chaining jumps + strafing builds speed), coyote time, jump
// buffering, variable jump height, and a crouch-slide. Collision is per-axis
// swept-AABB against the level's static box colliders plus the y=0 floor.

import * as THREE from 'three';
import { clamp, clamp01, damp } from '../engine/math.js';

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.0;
const STAND_EYE = 1.62;
const CROUCH_EYE = 0.9;
const RADIUS = 0.4;
const STEP_HEIGHT = 0.6;   // auto-climb ledges/ramp steps up to this tall

const GRAVITY = 16;           // low gravity → floaty, moon-y hang time
const WALK_SPEED = 6.6;
const SPRINT_SPEED = 10.5;
const CROUCH_SPEED = 3.3;
const GROUND_ACCEL = 95;
const AIR_ACCEL = 64;
const AIR_CAP = 1.5;          // classic air-accel wishspeed cap → strafe jumping
const FRICTION = 9;
const STOP_SPEED = 2.5;
const JUMP_SPEED = 8.6;       // ~2.3m jump under the low gravity above
const COYOTE = 0.12;          // grace window to still jump after leaving ground
const JUMP_BUFFER = 0.12;     // press jump slightly before landing
const SLIDE_BOOST = 1.28;
const SLIDE_FRICTION = 2.2;
const SLIDE_MIN_SPEED = 7.5;
const SLIDE_TIME = 0.85;

// --- grind rails ---
const GRIND_TARGET = 19;       // base grind speed (m/s) — well above run/sprint
const GRIND_BOOST = 27;        // brief boost right after latching
const GRIND_MIN = 13;
const GRIND_JUMP = 7.0;        // upward pop when jumping off a rail
const GRIND_LATCH_HORIZ = 1.9; // horizontal magnet radius
const GRIND_CD = 0.32;         // re-latch lockout after leaving a rail

const _tmpV = new THREE.Vector3();

export class Controller {
  constructor(colliders, bounds, rails = null) {
    this.colliders = colliders;   // [{min:Vec3, max:Vec3}]
    this.bounds = bounds;         // {minX,maxX,minZ,maxZ} arena walls
    this.rails = rails;           // Rails instance (grindable)
    this.pos = new THREE.Vector3(0, 0, 16);
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.crouchT = 0;
    this.height = STAND_HEIGHT;
    this.eyeHeight = STAND_EYE;

    this._coyote = 0;
    this._jumpBuffer = 0;
    this._stepDist = 0;
    this._sliding = false;
    this._slideTimer = 0;
    this._jumpedThisFrame = false;

    // public per-frame readouts the camera / audio / hud consume
    this.speed = 0;
    this.horizSpeed = 0;
    this.isSprinting = false;
    this.isMoving = false;
    this.isCrouching = false;

    // grind state
    this.grind = null;
    this._grindCd = 0;
    this.isGrinding = false;
    this.grindSpeed = 0;
    this.grindBank = 0;
    this._prevTan = new THREE.Vector3();

    this.events = { landed: 0, jumped: false, stepped: false, slid: false, grindStart: false, grindEnd: false, grinding: false, perfect: false, boosted: false };
  }

  reset() {
    this.pos.set(0, 0, 16);
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.crouchT = 0;
    this._sliding = false;
    this.grind = null;
    this._grindCd = 0;
    this.isGrinding = false;
    this.grindSpeed = 0;
    this.grindBank = 0;
  }

  // wishYaw is the camera yaw (radians) used to orient movement input.
  update(dt, input, wishYaw) {
    const ev = this.events;
    ev.landed = 0; ev.jumped = false; ev.stepped = false; ev.slid = false;
    ev.grindStart = false; ev.grindEnd = false; ev.grinding = false; ev.perfect = false; ev.boosted = false;
    this._jumpedThisFrame = false;
    this._grindCd = Math.max(0, this._grindCd - dt);

    // --- grind rails take over movement entirely while active ---
    if (this.grind) { this._rideRail(dt, input, wishYaw); return; }
    if (this.rails && this._grindCd <= 0 && this._tryLatch(input, wishYaw)) {
      this._rideRail(dt, input, wishYaw);
      return;
    }
    this.isGrinding = false;
    this.grindBank = damp(this.grindBank, 0, 10, dt);

    const axis = input.moveAxis();
    const moving = axis.x !== 0 || axis.z !== 0;

    // world-space wish direction from camera yaw
    const sin = Math.sin(wishYaw), cos = Math.cos(wishYaw);
    const wishDir = new THREE.Vector3(
      axis.x * cos - axis.z * sin,
      0,
      -axis.x * sin - axis.z * cos
    );
    if (wishDir.lengthSq() > 0) wishDir.normalize();

    // --- crouch / slide state ---
    const wantCrouch = input.isDown('crouch');
    const wantSprint = input.isDown('sprint') && axis.z > 0 && !wantCrouch;

    // start a slide: sprinting fast + crouch while grounded
    if (wantCrouch && this.onGround && !this._sliding && this.horizSpeed > SLIDE_MIN_SPEED && input.wasPressed('crouch')) {
      this._sliding = true;
      this._slideTimer = SLIDE_TIME;
      this.vel.x *= SLIDE_BOOST; // horizontal only — don't fling vertical velocity
      this.vel.z *= SLIDE_BOOST;
      ev.slid = true;
    }
    if (this._sliding) {
      this._slideTimer -= dt;
      if (!wantCrouch || this._slideTimer <= 0 || this.horizSpeed < WALK_SPEED * 0.6 || !this.onGround) {
        this._sliding = false;
      }
    }

    // smooth crouch amount; block uncrouch if no headroom
    const targetCrouch = (wantCrouch || this._sliding) ? 1 : (this._canStand() ? 0 : 1);
    this.crouchT = damp(this.crouchT, targetCrouch, 14, dt);
    this.height = STAND_HEIGHT - (STAND_HEIGHT - CROUCH_HEIGHT) * this.crouchT;
    this.eyeHeight = STAND_EYE - (STAND_EYE - CROUCH_EYE) * this.crouchT;

    let maxSpeed = WALK_SPEED;
    if (wantSprint && !this._sliding) maxSpeed = SPRINT_SPEED;
    else if (this.crouchT > 0.5 && !this._sliding) maxSpeed = CROUCH_SPEED;
    this.isSprinting = wantSprint && this.onGround && moving && !this._sliding;
    this.isCrouching = this.crouchT > 0.5;

    // --- jump (coyote + buffer + variable height) ---
    if (input.wasPressed('jump')) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt);

    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vel.y = JUMP_SPEED;
      this.onGround = false;
      this._coyote = 0;
      this._jumpBuffer = 0;
      this._jumpedThisFrame = true;
      this._sliding = false;
      ev.jumped = true;
    }
    // variable jump height: releasing jump early cuts the rise
    if (!input.isDown('jump') && this.vel.y > 0) this.vel.y *= Math.pow(0.0025, dt);

    // --- horizontal acceleration ---
    const velXZ = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (this.onGround) {
      if (!this._jumpedThisFrame) this._applyFriction(velXZ, this._sliding ? SLIDE_FRICTION : FRICTION, dt);
      if (!this._sliding) this._accelerate(velXZ, wishDir, maxSpeed, GROUND_ACCEL, dt);
      else this._accelerate(velXZ, wishDir, maxSpeed * 1.1, GROUND_ACCEL * 0.15, dt); // slight slide steering
    } else {
      this._airAccelerate(velXZ, wishDir, maxSpeed, AIR_ACCEL, dt);
    }
    this.vel.x = velXZ.x;
    this.vel.z = velXZ.z;

    // gravity
    this.vel.y -= GRAVITY * dt;

    // --- integrate + collide ---
    const wasGround = this.onGround;
    const fallSpeed = -this.vel.y;
    this._move(dt);

    // landing detection
    if (this.onGround && !wasGround && fallSpeed > 1.5) {
      ev.landed = clamp01((fallSpeed - 1.5) / 12);
    }

    // footstep accumulator
    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = this.vel.length();
    this.isMoving = this.horizSpeed > 0.6;
    if (this.onGround && this.isMoving && !this._sliding) {
      this._stepDist += this.horizSpeed * dt;
      const stride = this.isSprinting ? 2.6 : 1.9;
      if (this._stepDist >= stride) { this._stepDist = 0; ev.stepped = true; }
    } else {
      this._stepDist = Math.min(this._stepDist, 1.2);
    }
  }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  // --- grind rails ----------------------------------------------------------

  _tryLatch(input, wishYaw) {
    _tmpV.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
    const feetY = this.pos.y;
    const hit = this.rails.nearest(_tmpV, GRIND_LATCH_HORIZ, feetY - 0.9, feetY + 2.4); // grabbable band
    if (!hit) return false;

    const tan = hit.tangent;
    let dot = this.vel.x * tan.x + this.vel.z * tan.z;
    // Airborne: grab any rail you're near (jump onto it). Grounded: only grab if
    // you're actually running ALONG it — so slow strafing in a firefight near a
    // rail doesn't snatch you onto it.
    const intent = !this.onGround || (this.horizSpeed > 5 && Math.abs(dot) > 3);
    if (!intent) return false;

    // travel direction from current velocity, falling back to look direction
    if (Math.abs(dot) < 1.5) dot = (-Math.sin(wishYaw)) * tan.x + (-Math.cos(wishYaw)) * tan.z;
    const dir = dot >= 0 ? 1 : -1;
    const entry = clamp(Math.max(this.horizSpeed, GRIND_MIN), GRIND_MIN, GRIND_BOOST);

    this.grind = { rail: hit.rail, t: hit.t, dir, speed: entry, boostT: 0.45, t0: 0 };
    const p = this.rails.pointAt(hit.rail, hit.t);
    this.pos.set(p.x, p.y, p.z);
    this.onGround = false;
    this._sliding = false;
    this.crouchT = 0;
    this.eyeHeight = STAND_EYE;
    this.height = STAND_HEIGHT;
    const t0 = this.rails.tangentAt(hit.rail, hit.t);
    this._prevTan.set(t0.x * dir, 0, t0.z * dir);
    this.events.grindStart = true;
    this.events.boosted = true;
    return true;
  }

  _rideRail(dt, input, wishYaw) {
    const g = this.grind;
    const ev = this.events;
    g.t0 += dt;
    g.boostT = Math.max(0, g.boostT - dt);

    const target = g.boostT > 0 ? GRIND_BOOST : GRIND_TARGET;
    g.speed = damp(g.speed, target, g.boostT > 0 ? 8 : 4.5, dt);

    const tan = this.rails.tangentAt(g.rail, g.t);
    const axis = input.moveAxis();
    const sin = Math.sin(wishYaw), cos = Math.cos(wishYaw);
    const wishX = axis.x * cos - axis.z * sin;
    const wishZ = -axis.x * sin - axis.z * cos;
    const along = wishX * tan.x + wishZ * tan.z;
    const nlen = Math.hypot(tan.x, tan.z) || 1;
    const nx = -tan.z / nlen, nz = tan.x / nlen;
    const side = wishX * nx + wishZ * nz;

    // steer the travel direction with forward/back input (after a short commit
    // window, so the entry direction holds for a beat and you can't instantly
    // flip on the frame you latch)
    if (g.t0 > 0.16 && along * g.dir < -0.6) g.dir = -g.dir;

    // hard sideways push peels you off the rail with momentum
    if (g.t0 > 0.12 && Math.abs(side) > 0.6 && Math.abs(side) > Math.abs(along) * 0.7) {
      this._detachRail(g, tan, nx * Math.sign(side), nz * Math.sign(side), 5.5, 1.6);
      return;
    }
    // jump = launch off (perfect if near the tip of an open rail)
    if (input.wasPressed('jump')) {
      const nearEnd = !g.rail.closed && (g.dir > 0 ? g.t > 0.82 : g.t < 0.18);
      this._launchOff(g, tan, GRIND_JUMP * (nearEnd ? 1.18 : 1), nearEnd);
      return;
    }
    // crouch = drop off, keeping horizontal momentum
    if (input.isDown('crouch')) { this._launchOff(g, tan, 0.4, false); return; }

    // advance along the curve
    g.t += g.dir * g.speed * dt / g.rail.length;
    let ended = false;
    if (g.rail.closed) g.t = ((g.t % 1) + 1) % 1;
    else if (g.t >= 1) { g.t = 1; ended = true; }
    else if (g.t <= 0) { g.t = 0; ended = true; }

    const p = this.rails.pointAt(g.rail, g.t);
    this.pos.set(p.x, p.y, p.z);

    const ntan = this.rails.tangentAt(g.rail, g.t);
    this.vel.set(ntan.x * g.dir * g.speed, ntan.y * g.dir * g.speed, ntan.z * g.dir * g.speed);

    // camera bank from the rail's horizontal turn rate
    const turn = ntan.x * this._prevTan.z - ntan.z * this._prevTan.x;
    this.grindBank = clamp(turn * g.speed * 0.5, -0.5, 0.5);
    this._prevTan.set(ntan.x * g.dir, 0, ntan.z * g.dir);

    this.eyeHeight = STAND_EYE;
    this.height = STAND_HEIGHT;
    this.horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = this.vel.length();
    this.isMoving = true;
    this.isGrinding = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this.grindSpeed = g.speed;
    ev.grinding = true;

    if (ended) this._launchOff(g, ntan, 0.6, false);
  }

  _launchOff(g, tan, up, perfect) {
    this.vel.set(tan.x * g.dir * g.speed, tan.y * g.dir * g.speed + up, tan.z * g.dir * g.speed);
    this.grind = null;
    this.isGrinding = false;
    this.grindSpeed = 0;
    this.grindBank = 0;
    this._grindCd = GRIND_CD;
    this.onGround = false;
    this.events.grindEnd = true;
    if (perfect) this.events.perfect = true;
  }

  _detachRail(g, tan, vx, vz, boost, up) {
    this.vel.set(tan.x * g.dir * g.speed + vx * boost, tan.y * g.dir * g.speed + up, tan.z * g.dir * g.speed + vz * boost);
    this.grind = null;
    this.isGrinding = false;
    this.grindSpeed = 0;
    this.grindBank = 0;
    this._grindCd = GRIND_CD;
    this.onGround = false;
    this.events.grindEnd = true;
  }

  // --- physics helpers ----------------------------------------------------

  _accelerate(vel, wishDir, wishSpeed, accel, dt) {
    const current = vel.dot(wishDir);
    const add = wishSpeed - current;
    if (add <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > add) accelSpeed = add;
    vel.addScaledVector(wishDir, accelSpeed);
  }

  _airAccelerate(vel, wishDir, wishSpeed, accel, dt) {
    const capped = Math.min(wishSpeed, AIR_CAP);
    const current = vel.dot(wishDir);
    const add = capped - current;
    if (add <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > add) accelSpeed = add;
    vel.addScaledVector(wishDir, accelSpeed);
  }

  _applyFriction(vel, friction, dt) {
    const speed = vel.length();
    if (speed < 0.01) { vel.set(0, 0, 0); return; }
    const control = speed < STOP_SPEED ? STOP_SPEED : speed;
    const drop = control * friction * dt;
    const newSpeed = Math.max(0, speed - drop);
    vel.multiplyScalar(newSpeed / speed);
  }

  // Per-axis swept AABB resolution with auto step-up so the player can walk up
  // ramp steps and small ledges instead of being walled by them.
  _move(dt) {
    const r = RADIUS;
    const wasGround = this.onGround;
    this.onGround = false;

    // vertical first (lands us on platform tops / the floor)
    this.pos.y += this.vel.y * dt;
    this._resolveY(r);
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    }

    // horizontal, remembering where we started so we can detect a block
    const sx = this.pos.x, sz = this.pos.z, sy = this.pos.y;
    const svx = this.vel.x, svz = this.vel.z;
    this.pos.x += svx * dt; this._resolveAxis('x', r);
    this.pos.z += svz * dt; this._resolveAxis('z', r);

    const blocked = Math.abs(svx * dt) - Math.abs(this.pos.x - sx) > 1e-3 ||
                    Math.abs(svz * dt) - Math.abs(this.pos.z - sz) > 1e-3;
    if (blocked && (wasGround || this.onGround) && (svx !== 0 || svz !== 0)) {
      const hx = this.pos.x, hz = this.pos.z; // the blocked, un-stepped result
      // retry the move from a raised position
      this.pos.set(sx, sy + STEP_HEIGHT, sz);
      this.pos.x += svx * dt; this._resolveAxis('x', r);
      this.pos.z += svz * dt; this._resolveAxis('z', r);
      // settle onto the highest surface within the step band, if we fit there
      const support = this._supportBelow(r, this.pos.y, sy - 0.02);
      if (support !== null && support > sy + 1e-3 && this._canFitAt(this.pos.x, support, this.pos.z, r)) {
        this.pos.y = support;
        this.onGround = true;
        this.vel.x = svx; this.vel.z = svz; // preserve momentum up the step
      } else {
        this.pos.set(hx, sy, hz); // no valid step → keep the blocked result
      }
    }

    // arena outer walls
    const b = this.bounds;
    if (b) {
      if (this.pos.x < b.minX + r) { this.pos.x = b.minX + r; if (this.vel.x < 0) this.vel.x = 0; }
      if (this.pos.x > b.maxX - r) { this.pos.x = b.maxX - r; if (this.vel.x > 0) this.vel.x = 0; }
      if (this.pos.z < b.minZ + r) { this.pos.z = b.minZ + r; if (this.vel.z < 0) this.vel.z = 0; }
      if (this.pos.z > b.maxZ - r) { this.pos.z = b.maxZ - r; if (this.vel.z > 0) this.vel.z = 0; }
    }

    // ground probe for stable grounding on platform tops
    if (!this.onGround && this.vel.y <= 0.2 && this._groundProbe(r)) this.onGround = true;
  }

  // Highest surface (collider top or floor) under the footprint within
  // [yLow, yHigh]; null if nothing supports the player there.
  _supportBelow(r, yHigh, yLow) {
    let best = (0 >= yLow && 0 <= yHigh) ? 0 : null;
    for (const c of this.colliders) {
      const top = c.max.y;
      if (top < yLow || top > yHigh) continue;
      if (this.pos.x + r <= c.min.x || this.pos.x - r >= c.max.x) continue;
      if (this.pos.z + r <= c.min.z || this.pos.z - r >= c.max.z) continue;
      if (best === null || top > best) best = top;
    }
    return best;
  }

  _canFitAt(x, y, z, r) {
    const a = {
      min: { x: x - r, y: y + 0.02, z: z - r },
      max: { x: x + r, y: y + this.height - 0.02, z: z + r },
    };
    for (const c of this.colliders) if (overlap(a, c)) return false;
    return true;
  }

  _playerAABB(r) {
    return {
      min: { x: this.pos.x - r, y: this.pos.y, z: this.pos.z - r },
      max: { x: this.pos.x + r, y: this.pos.y + this.height, z: this.pos.z + r },
    };
  }

  _resolveAxis(axis, r) {
    for (const c of this.colliders) {
      const a = this._playerAABB(r);
      if (!overlap(a, c)) continue;
      if (axis === 'x') {
        if (this.vel.x > 0) this.pos.x = c.min.x - r - 1e-4;
        else if (this.vel.x < 0) this.pos.x = c.max.x + r + 1e-4;
        else this.pos.x = (this.pos.x < (c.min.x + c.max.x) / 2) ? c.min.x - r - 1e-4 : c.max.x + r + 1e-4;
        this.vel.x = 0;
      } else {
        if (this.vel.z > 0) this.pos.z = c.min.z - r - 1e-4;
        else if (this.vel.z < 0) this.pos.z = c.max.z + r + 1e-4;
        else this.pos.z = (this.pos.z < (c.min.z + c.max.z) / 2) ? c.min.z - r - 1e-4 : c.max.z + r + 1e-4;
        this.vel.z = 0;
      }
    }
  }

  _resolveY(r) {
    for (const c of this.colliders) {
      const a = this._playerAABB(r);
      if (!overlap(a, c)) continue;
      if (this.vel.y > 0) {
        this.pos.y = c.min.y - this.height - 1e-4;
        this.vel.y = 0;
      } else {
        this.pos.y = c.max.y + 1e-4;
        this.vel.y = 0;
        this.onGround = true;
      }
    }
  }

  _groundProbe(r) {
    const feetY = this.pos.y;
    for (const c of this.colliders) {
      if (c.max.y < feetY - 0.14 || c.max.y > feetY + 0.06) continue;
      if (this.pos.x + r <= c.min.x || this.pos.x - r >= c.max.x) continue;
      if (this.pos.z + r <= c.min.z || this.pos.z - r >= c.max.z) continue;
      this.pos.y = c.max.y;
      return true;
    }
    return false;
  }

  _canStand() {
    // test whether the full standing AABB would overlap anything
    const a = {
      min: { x: this.pos.x - RADIUS, y: this.pos.y, z: this.pos.z - RADIUS },
      max: { x: this.pos.x + RADIUS, y: this.pos.y + STAND_HEIGHT, z: this.pos.z + RADIUS },
    };
    for (const c of this.colliders) if (overlap(a, c)) return false;
    return true;
  }
}

function overlap(a, c) {
  return a.min.x < c.max.x && a.max.x > c.min.x &&
         a.min.y < c.max.y && a.max.y > c.min.y &&
         a.min.z < c.max.z && a.max.z > c.min.z;
}
