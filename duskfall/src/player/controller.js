// Player movement: Quake/Source-style ground+air acceleration (crisp, snappy),
// but the vertical axis follows the terrain heightfield and horizontal motion
// collides with foliage cylinders + a soft circular arena boundary.

import * as THREE from 'three';
import { clamp, clamp01, damp } from '../engine/math.js';

const STAND_HEIGHT = 1.8, CROUCH_HEIGHT = 1.0;
const STAND_EYE = 1.65, CROUCH_EYE = 0.95;
const RADIUS = 0.4;

const GRAVITY = 20;
const WALK_SPEED = 6.8;       // reference speed for slide thresholds
const SPRINT_SPEED = 10.6;
const RUN_SPEED = SPRINT_SPEED; // the player always runs at this (no sprint toggle)
const CROUCH_SPEED = 3.4;
const GROUND_ACCEL = 96;
const AIR_ACCEL = 62;
const AIR_CAP = 1.4;
const FRICTION = 9;
const STOP_SPEED = 2.4;
const JUMP_SPEED = 7.7;
const DOUBLE_JUMP_SPEED = 9.6;   // a strong second launch — noticeably higher
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const STICK = 0.75;          // snap-to-ground distance (keeps you on slopes)
const SLIDE_BOOST = 1.26, SLIDE_FRICTION = 2.4, SLIDE_MIN = 7.5, SLIDE_TIME = 0.8;

// dash: a fast committed burst (ground or air). Suppresses gravity for its
// duration and decays into a carried momentum so dash→jump keeps speed.
const DASH_SPEED = 27;
const DASH_END_SPEED = 13;   // speed it decays to by the end (carried out)
const DASH_TIME = 0.17;
const DASH_CD = 0.8;         // ground cooldown; air is additionally gated to 1/airtime
const DASH_IFRAME = 0.06;    // extra invulnerability after the dash ends
const DASH_HIT_RADIUS = 1.7; // how close an enemy must be to be dash-struck (+ its radius)
const ADS_WALK = 4.6;        // capped move speed while sighted (ADS cancels sprint)

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

    this._coyote = 0; this._jumpBuffer = 0; this._stepDist = 0;
    this._sliding = false; this._slideTimer = 0; this._jumpedThisFrame = false;

    // double jump + dash
    this._airJumps = 1;              // extra mid-air jumps left this airtime
    this._airDashes = 1;             // air dashes left this airtime
    this._dashTimer = 0;             // >0 while dashing
    this._dashCd = 0;                // cooldown remaining
    this._dashSpeed = 0;
    this._dashIFrame = 0;            // invulnerable window (dash + a little after)
    this._sinceGround = 0;           // airtime, gates the double jump
    this.dashDir = new THREE.Vector3(0, 0, -1);
    this.dashHitRadius = DASH_HIT_RADIUS;

    this.speed = 0; this.horizSpeed = 0;
    this.isSprinting = false; this.isMoving = false; this.isCrouching = false;
    this.events = { landed: 0, jumped: false, doubleJumped: false, dashed: false, stepped: false, slid: false };
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.onGround = true; this.crouchT = 0; this._sliding = false;
    this._airJumps = 1; this._airDashes = 1;
    this._dashTimer = 0; this._dashCd = 0; this._dashIFrame = 0;
  }

  isDashing() { return this._dashTimer > 0; }
  // player is invulnerable through the dash and a short recovery window
  get dashInvuln() { return this._dashIFrame > 0; }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  update(dt, input, wishYaw) {
    const ev = this.events;
    ev.landed = 0; ev.jumped = false; ev.doubleJumped = false; ev.dashed = false; ev.stepped = false; ev.slid = false;
    this._jumpedThisFrame = false;
    this._dashCd = Math.max(0, this._dashCd - dt);
    this._dashIFrame = Math.max(0, this._dashIFrame - dt);

    const axis = input.moveAxis();
    const sin = Math.sin(wishYaw), cos = Math.cos(wishYaw);
    const wishDir = new THREE.Vector3(axis.x * cos - axis.z * sin, 0, -axis.x * sin - axis.z * cos);
    if (wishDir.lengthSq() > 0) wishDir.normalize();
    // forward (look) direction on the ground plane — dash falls back to this
    const fwdDir = new THREE.Vector3(-sin, 0, -cos);

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

    let maxSpeed = RUN_SPEED;
    if (this.crouchT > 0.5 && !this._sliding) maxSpeed = CROUCH_SPEED;
    if (aiming) maxSpeed = Math.min(maxSpeed, ADS_WALK);
    // "sprinting" now just means moving fast on the ground (drives bob/FOV/steps)
    this.isSprinting = this.onGround && (axis.x || axis.z) && !this._sliding && !aiming && this.crouchT <= 0.5;
    this.isCrouching = this.crouchT > 0.5;

    // --- dash (dedicated key / mouse side button) ---
    if (input.wasPressed('dash') && this._dashTimer <= 0 && this._dashCd <= 0 && (this.onGround || this._airDashes > 0)) {
      const dashDir = wishDir.lengthSq() > 0 ? wishDir.clone() : fwdDir.clone();
      dashDir.y = 0; if (dashDir.lengthSq() < 1e-6) dashDir.copy(fwdDir); dashDir.normalize();
      this.dashDir.copy(dashDir);
      this._dashTimer = DASH_TIME; this._dashSpeed = DASH_SPEED; this._dashCd = DASH_CD;
      this._dashIFrame = DASH_TIME + DASH_IFRAME;
      this.vel.x = dashDir.x * DASH_SPEED; this.vel.z = dashDir.z * DASH_SPEED; this.vel.y = 0;
      if (!this.onGround) this._airDashes--;
      this._sliding = false; ev.dashed = true;
    }

    // track airtime so a ground jump's buffer can't instantly burn the air jump
    this._sinceGround = this.onGround ? 0 : this._sinceGround + dt;

    // jump (coyote + buffer + variable height) + a high mid-air double jump
    if (input.wasPressed('jump')) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt);
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vel.y = JUMP_SPEED; this.onGround = false; this._coyote = 0; this._jumpBuffer = 0;
      this._jumpedThisFrame = true; this._sliding = false; this._dashTimer = 0; ev.jumped = true; // jump cancels a dash into a dash-jump
    } else if (this._jumpBuffer > 0 && !this.onGround && this._coyote <= 0 && this._airJumps > 0 && this._sinceGround > 0.12) {
      // double jump: a strong second launch (overrides any downward velocity).
      // the airtime gate stops a double-tap on the ground from wasting it low.
      this.vel.y = DOUBLE_JUMP_SPEED; this._airJumps--; this._jumpBuffer = 0;
      this._dashTimer = 0;                        // let gravity resume so the arc reads
      ev.doubleJumped = true;
    }
    if (!input.isDown('jump') && this.vel.y > 0 && this._dashTimer <= 0) this.vel.y *= Math.pow(0.0025, dt);

    // horizontal acceleration
    const velXZ = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (this._dashTimer > 0) {
      // dashing: hold the burst along the dash direction, decaying to a carry speed
      this._dashTimer -= dt;
      this._dashSpeed = Math.max(DASH_END_SPEED, this._dashSpeed - (DASH_SPEED - DASH_END_SPEED) / DASH_TIME * dt);
      velXZ.copy(this.dashDir).multiplyScalar(this._dashSpeed);
      this.vel.y = 0;                              // suppress gravity for a clean streak
    } else if (this.onGround) {
      if (!this._jumpedThisFrame) this._friction(velXZ, this._sliding ? SLIDE_FRICTION : FRICTION, dt);
      if (!this._sliding) this._accel(velXZ, wishDir, maxSpeed, GROUND_ACCEL, dt);
      else this._accel(velXZ, wishDir, maxSpeed * 1.1, GROUND_ACCEL * 0.14, dt);
      this.vel.y -= GRAVITY * dt;
    } else {
      this._airAccel(velXZ, wishDir, maxSpeed, AIR_ACCEL, dt);
      this.vel.y -= GRAVITY * dt;
    }
    this.vel.x = velXZ.x; this.vel.z = velXZ.z;

    // integrate horizontal + collide
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._collide();

    // vertical: follow terrain, land, jump
    const wasGround = this.onGround;
    const groundH = this.terrain.height(this.pos.x, this.pos.z);
    const fallSpeed = -this.vel.y;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundH + STICK && this.vel.y <= 0.001) {
      if (!wasGround && fallSpeed > 1.6) ev.landed = clamp01((fallSpeed - 1.6) / 11);
      this.pos.y = groundH; this.vel.y = 0; this.onGround = true;
      this._airJumps = 1; this._airDashes = 1;   // refresh air moves on touchdown
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
      // kill outward velocity
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
