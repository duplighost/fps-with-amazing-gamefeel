// Player movement: Quake/Source-style ground+air acceleration (crisp, snappy),
// but the vertical axis follows the terrain heightfield and horizontal motion
// collides with foliage cylinders + a soft circular arena boundary.

import * as THREE from 'three';
import { clamp, clamp01, damp } from '../engine/math.js';

const STAND_HEIGHT = 1.8, CROUCH_HEIGHT = 1.0;
const STAND_EYE = 1.65, CROUCH_EYE = 0.95;
const RADIUS = 0.4;

const GRAVITY = 20;
const WALK_SPEED = 6.8;
const SPRINT_SPEED = 10.6;
const CROUCH_SPEED = 3.4;
const GROUND_ACCEL = 96;
const AIR_ACCEL = 62;
const AIR_CAP = 1.4;
const FRICTION = 9;
const STOP_SPEED = 2.4;
const JUMP_SPEED = 7.7;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const STICK = 0.75;          // snap-to-ground distance (keeps you on slopes)
const SLIDE_BOOST = 1.26, SLIDE_FRICTION = 2.4, SLIDE_MIN = 7.5, SLIDE_TIME = 0.8;

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

    this.speed = 0; this.horizSpeed = 0;
    this.isSprinting = false; this.isMoving = false; this.isCrouching = false;
    this.events = { landed: 0, jumped: false, stepped: false, slid: false };
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, this.terrain.height(x, z), z);
    this.vel.set(0, 0, 0);
    this.onGround = true; this.crouchT = 0; this._sliding = false;
  }

  get eyePosition() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  update(dt, input, wishYaw) {
    const ev = this.events;
    ev.landed = 0; ev.jumped = false; ev.stepped = false; ev.slid = false;
    this._jumpedThisFrame = false;

    const axis = input.moveAxis();
    const sin = Math.sin(wishYaw), cos = Math.cos(wishYaw);
    const wishDir = new THREE.Vector3(axis.x * cos - axis.z * sin, 0, -axis.x * sin - axis.z * cos);
    if (wishDir.lengthSq() > 0) wishDir.normalize();

    // crouch / slide / sprint
    const wantCrouch = input.isDown('crouch');
    const wantSprint = input.isDown('sprint') && axis.z > 0 && !wantCrouch;
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

    let maxSpeed = WALK_SPEED;
    if (wantSprint && !this._sliding) maxSpeed = SPRINT_SPEED;
    else if (this.crouchT > 0.5 && !this._sliding) maxSpeed = CROUCH_SPEED;
    this.isSprinting = wantSprint && this.onGround && (axis.x || axis.z) && !this._sliding;
    this.isCrouching = this.crouchT > 0.5;

    // jump (coyote + buffer + variable height)
    if (input.wasPressed('jump')) this._jumpBuffer = JUMP_BUFFER;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt);
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.vel.y = JUMP_SPEED; this.onGround = false; this._coyote = 0; this._jumpBuffer = 0;
      this._jumpedThisFrame = true; this._sliding = false; ev.jumped = true;
    }
    if (!input.isDown('jump') && this.vel.y > 0) this.vel.y *= Math.pow(0.0025, dt);

    // horizontal acceleration
    const velXZ = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (this.onGround) {
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

    // vertical: follow terrain, land, jump
    const wasGround = this.onGround;
    const groundH = this.terrain.height(this.pos.x, this.pos.z);
    const fallSpeed = -this.vel.y;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundH + STICK && this.vel.y <= 0.001) {
      if (!wasGround && fallSpeed > 1.6) ev.landed = clamp01((fallSpeed - 1.6) / 11);
      this.pos.y = groundH; this.vel.y = 0; this.onGround = true;
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
