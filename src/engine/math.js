// Small math toolkit tuned for game-feel work: frame-rate-independent damping,
// easing curves, and cheap random helpers. Keep this dependency-free.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const remap = (v, inA, inB, outA, outB) => lerp(outA, outB, invLerp(inA, inB, v));

// Frame-rate-independent exponential smoothing. `lambda` is the rate (1/sec);
// higher = snappier. This is the backbone of nearly every smooth motion here.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

// Spring-damper step (semi-implicit). Returns [newValue, newVelocity].
export function spring(value, target, vel, stiffness, damping, dt) {
  const force = (target - value) * stiffness - vel * damping;
  const v = vel + force * dt;
  return [value + v * dt, v];
}

export const smoothstep = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeInCubic = (x) => x * x * x;
export const easeOutQuad = (x) => 1 - (1 - x) * (1 - x);
export const easeOutBack = (x) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
export const easeOutElastic = (x) => {
  const c4 = TAU / 3;
  return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
};

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Move `current` toward `target` by at most `maxDelta` (linear, no overshoot).
export const moveToward = (current, target, maxDelta) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

export const wrapAngle = (a) => {
  a = a % TAU;
  if (a < -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return a;
};
