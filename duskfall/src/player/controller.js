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
const DOUBLE_JUMP_SPEED = 14.4;   // a big second launch (takes the max of current vy)
const MAX_AIR_JUMPS = 1;
const COYOTE = 0.14;
const JUMP_BUFFER = 0.16;
const JUMP_CUT_GRACE = 0.11;      // short taps still get a real jump before the cut
const DOUBLE_JUMP_CUT_GRACE = 0.16;
const STICK = 0.42;               // snap-to-ground (small, so it never eats a jump)
const SLIDE_BOOST = 1.26, SLIDE_FRICTION = 2.4, SLIDE_MIN = 7.5, SLIDE_TIME = 0.8;

// dash: charge-based (2 charges, regenerating) with a tiny anti-double cooldown.
// A ground dash hops slightly; an AIR dash lifts you up and lasts a touch longer,
// so chaining air dashes carries you up and across for a long, floaty traversal.
const DASH_SPEED = 24.5, AIR_DASH_SPEED = 28.0, DASH_TIME = 0.18, AIR_DASH_TIME = 0.24;
const DASH_COOLDOWN = 0.14, DASH_REGEN = 0.74, DASH_LIFT = 11.5, DASH_HOP = 3.0, DASH_BUFFER = 0.16;
const DASH_IFRAME = 0.06;          // invulnerability that outlasts the dash a touch
const DASH_HIT_RADIUS = 1.7;       // how close an enemy must be to be dash-struck (+ its radius)
const ADS_WALK = 4.6;              // capped move speed while sighted

export class Controller {
  constructor(terrain, colliders, boundary) {
    this.terrain = terrain;
    this.colliders = colliders;      // [{x,z,r}]
    this.boundary = boundary;        // max radius from origin
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

    // charge-based dash
    this._dashTimer = 0; this._dashCooldown = 0; this._dashRecharge = 0; this._dashBuffer = 0;
    this._dashIFrame = 0;            // invulnerable window (dash + a little after)
    this.dashAir = false;
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this.dashHitRadius = DASH_HIT_RADIUS;
    this.dashCharges = 2; this.maxDashCharges = 2; this.dashRechargeRatio = 1;

    this.speed = 0; this.horizSpeed = 0;
    this.isSprinting = false; this.isMoving = false; this.isCrouching = false;
    this.events = { landed: 0, jumped: false, doubleJumped: false, dashed: false, stepped: false, slid: false };
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.onGround = true; this.crouchT = 0; this._sliding = false;
    this._airJumps = 0; this._jumpCutGrace = 0;
    this._dashTimer = 0; this._dashCooldown = 0; this._dashRecharge = 0; this._dashBuffer = 0; this._dashIFrame = 0;
    this.dashCharges = this.maxDashCharges; this.dashRechargeRatio = 1;
  }

  isDashing() { return this._dashTimer > 0; }
  // invulnerable through the dash and a short recovery window
  get dashInvuln() { return this._dashIFrame > 0; }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  update(dt, input, wishYaw) {
    const ev = this.events;
    ev.landed = 0; ev.jumped = false; ev.doubleJumped = false; ev.dashed = false; ev.stepped = false; ev.slid = false;
    this._jumpedThisFrame = false;
    this._dashCooldown = Math.max(0, this._dashCooldown - dt);
    this._dashIFrame = Math.max(0, this._dashIFrame - dt);

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
      if (!this._jumpedThisFrame) this._friction(velXZ, this._sliding ? SLIDE_FRICTION : FRICTION, dt);
      if (!this._sliding) this._accel(velXZ, wishDir, maxSpeed, GROUND_ACCEL, dt);
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

    // vertical: follow terrain, land
    const wasGround = this.onGround;
    const groundH = this.terrain.height(this.pos.x, this.pos.z);
    const fallSpeed = -this.vel.y;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundH + STICK && this.vel.y <= 0.001) {
      if (!wasGround && fallSpeed > 1.6) ev.landed = clamp01((fallSpeed - 1.6) / 11);
      this.pos.y = groundH; this.vel.y = 0; this.onGround = true;
      this._airJumps = 0;
    } else {
      this.onGround = false;
    }

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

  _collide() {
    const r = RADIUS;
    for (const c of this.colliders) {
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
