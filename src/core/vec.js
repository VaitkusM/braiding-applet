/**
 * @file vec.js — minimal 3-vector helpers for the pure core.
 *
 * Vectors are plain arrays `[x, y, z]` (numbers, SI units wherever they carry a unit).
 * All functions are pure: they never mutate their arguments and always return a new array.
 * The core deliberately does not depend on three.js so it can be unit-tested headlessly with Deno;
 * the view layer converts these arrays to THREE.Vector3 where needed.
 */

/** @typedef {[number, number, number]} Vec3 */

/** a + b @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** a − b @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** s·a @param {Vec3} a @param {number} s @returns {Vec3} */
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** a + s·b @param {Vec3} a @param {Vec3} b @param {number} s @returns {Vec3} */
export const addScaled = (a, b, s) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];

/** a·b @param {Vec3} a @param {Vec3} b @returns {number} */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** a×b @param {Vec3} a @param {Vec3} b @returns {Vec3} */
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Euclidean length |a| @param {Vec3} a @returns {number} */
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/** |a − b| @param {Vec3} a @param {Vec3} b @returns {number} */
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * a/|a|. Returns [0, 0, 0] for the zero vector instead of NaNs, so callers must not rely on the
 * result being unit length when the input may vanish.
 * @param {Vec3} a @returns {Vec3}
 */
export const normalize = (a) => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};

/** (1−s)·a + s·b @param {Vec3} a @param {Vec3} b @param {number} s @returns {Vec3} */
export const lerp = (a, b, s) => [
  a[0] + s * (b[0] - a[0]),
  a[1] + s * (b[1] - a[1]),
  a[2] + s * (b[2] - a[2]),
];

/**
 * Component of `a` orthogonal to the unit vector `u`: a − (a·u)u.
 * @param {Vec3} a @param {Vec3} u unit vector @returns {Vec3}
 */
export const rejectFrom = (a, u) => addScaled(a, u, -dot(a, u));
