// View feel. Takes the bare aim angles from the mouse and layers on everything
// that makes a first-person camera feel alive: head bob, a two-stage recoil
// (snappy kick, smooth recovery), dynamic FOV (sprint + per-shot punch), a
// strafe lean/roll, a sprung landing dip, and screen shake from the FX system.
// Aim state (yaw/pitch) is kept clean; all the juice is added on top at render.

import * as THREE from 'three';
import { clamp, damp, spring, lerp } from '../engine/math.js';

const PITCH_LIMIT = Math.PI / 2 - 0.04;
const BASE_FOV = 88;
const SPRINT_FOV = 10;

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;     // face -z toward the arena interior
    this.pitch = 0;

    // recoil: an instant kick added straight onto the offset, then damped back
    // to zero — frame-rate independent and reaches full kick every shot.
    this.recoilPitch = 0;
    this.recoilYaw = 0;

    this.bobPhase = 0;
    this.roll = 0;
    this.fov = BASE_FOV;
    this.fovPunch = 0;

    this.dip = 0;
    this.dipVel = 0;

    this._prevYaw = this.yaw;
    this.sens = 1;
    this.lastLook = { yaw: 0, pitch: 0 }; // consumed by the weapon for sway
  }

  reset() {
    this.yaw = 0; this.pitch = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.bobPhase = 0; this.roll = 0; this.fov = BASE_FOV; this.fovPunch = 0;
    this.dip = 0; this.dipVel = 0;
  }

  // Called BEFORE the controller so movement uses fresh aim yaw.
  processLook(dt, input) {
    const look = input.consumeLook();
    this.lastLook.yaw = look.yaw * this.sens;
    this.lastLook.pitch = look.pitch * this.sens;
    this.yaw += this.lastLook.yaw;
    this.pitch = clamp(this.pitch + this.lastLook.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    return this.yaw;
  }

  // Punchy kick: caller supplies an upward pitch impulse and a random yaw nudge.
  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }
  addFovPunch(amount) { this.fovPunch = Math.min(this.fovPunch + amount, 14); }

  // Called AFTER the controller, just before render.
  applyView(dt, ctrl, fx, input) {
    // recoil recovers smoothly back to center (the kick was applied instantly)
    this.recoilPitch = damp(this.recoilPitch, 0, 9, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 9, dt);

    // head bob driven by ground speed
    const speed01 = clamp(ctrl.horizSpeed / 10.5, 0, 1.3);
    const grounded = ctrl.onGround ? 1 : 0;
    this.bobPhase += ctrl.horizSpeed * dt * 1.5;
    const bobAmt = speed01 * grounded * (ctrl.isSprinting ? 1.25 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.045 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.06 * bobAmt;

    // landing dip spring
    if (ctrl.events.landed > 0) {
      this.dipVel += ctrl.events.landed * 9;
      fx.addTrauma(ctrl.events.landed * 0.4);
      ctrl.events.landed = 0; // consume so a hitstop frame can't re-trigger it
    }
    [this.dip, this.dipVel] = spring(this.dip, 0, this.dipVel, 170, 18, dt);
    this.dip = clamp(this.dip, -0.05, 0.6);

    // strafe lean + look-yaw lean
    const axis = input.moveAxis();
    const yawVel = (this.yaw - this._prevYaw) / Math.max(dt, 1e-4);
    this._prevYaw = this.yaw;
    let targetRoll = -axis.x * 0.035 - clamp(yawVel, -8, 8) * 0.004;
    if (ctrl._sliding) targetRoll += -axis.x * 0.05 - 0.02;
    if (ctrl.isGrinding) targetRoll += ctrl.grindBank; // bank into the rail's turns
    this.roll = damp(this.roll, targetRoll, ctrl.isGrinding ? 7 : 10, dt);

    // FOV: base + sprint + grind speed + per-shot punch
    let targetFov = BASE_FOV;
    if (ctrl.isSprinting) targetFov += SPRINT_FOV;
    if (ctrl._sliding) targetFov += SPRINT_FOV * 1.4;
    if (ctrl.isGrinding) targetFov += clamp((ctrl.grindSpeed - 10) * 0.95, 0, 18);
    targetFov += this.fovPunch;
    this.fovPunch = damp(this.fovPunch, 0, 11, dt);
    this.fov = damp(this.fov, targetFov, 12, dt);

    // --- compose final transform ---
    const eye = ctrl.eyePosition;
    eye.y -= this.dip;

    // bob offset is in view-local space (right / up), rotate into world by yaw
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    eye.x += bobX * cos;
    eye.z += -bobX * sin;
    eye.y += bobY;

    const shake = fx.sampleShake();
    let sx = 0, sy = 0, sPitch = 0, sYaw = 0, sRoll = 0;
    if (shake) {
      sx = shake.x; sy = shake.y; sPitch = shake.pitch; sYaw = shake.yaw; sRoll = shake.roll;
      eye.x += sx * cos;
      eye.z += -sx * sin;
      eye.y += sy;
    }

    this.camera.position.copy(eye);
    this.camera.rotation.set(
      this.pitch + this.recoilPitch + sPitch,
      this.yaw + this.recoilYaw + sYaw,
      this.roll + sRoll,
      'YXZ'
    );
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Clean aim direction including recoil (so shots track the kick) — used by the
  // weapon for raycasting.
  aimDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    const e = new THREE.Euler(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, 0, 'YXZ');
    return dir.applyEuler(e);
  }
}
