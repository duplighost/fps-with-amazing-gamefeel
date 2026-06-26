// Keyboard + mouse input with pointer lock. Exposes per-frame held state,
// edge-triggered "just pressed" events, and an accumulated mouse delta that the
// camera consumes once per frame. Raw and immediate — responsiveness first.

const KEY_MAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
  KeyR: 'reload',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3',
  KeyF: 'melee',
  KeyE: 'use',
};

export class Input {
  constructor(domElement) {
    this.el = domElement;
    this.held = new Set();       // action names currently down
    this.pressed = new Set();    // actions that went down this frame
    this.released = new Set();   // actions that went up this frame
    this.locked = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.sensitivity = 0.0022;
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    };
    this._onKeyUp = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      this.held.delete(action);
      this.released.add(action);
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) { if (!this.held.has('fire')) this.pressed.add('fire'); this.held.add('fire'); }
      if (e.button === 2) { if (!this.held.has('aim')) this.pressed.add('aim'); this.held.add('aim'); }
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) { this.held.delete('fire'); this.released.add('fire'); }
      if (e.button === 2) { this.held.delete('aim'); this.released.add('aim'); }
    };
    this._onWheel = (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.held.clear(); } // drop held keys when focus leaves
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    this.el.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    if (!this.locked && this.el.requestPointerLock) this.el.requestPointerLock();
  }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  isDown(action) { return this.held.has(action); }
  wasPressed(action) { return this.pressed.has(action); }
  wasReleased(action) { return this.released.has(action); }

  // Movement axis in local space (x = strafe, z = forward). Normalized.
  moveAxis() {
    let x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let z = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  // Consume accumulated mouse movement (radians). Call once per frame.
  consumeLook() {
    const yaw = -this.mouseDX * this.sensitivity;
    const pitch = -this.mouseDY * this.sensitivity;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { yaw, pitch };
  }

  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  // Clear per-frame edge state. Call at the very end of each frame.
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    this.el.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
