/**
 * @file profiles.js — axisymmetric mandrel profiles r(z).
 *
 * A mandrel is a surface of revolution in its own frame (see surface.js). Its shape is fully
 * described by the radius function r(z) for z ∈ [0, length], where z is measured along the mandrel
 * axis FROM THE LEADING END (the end that is braided first).
 *
 * Every profile exposes `evaluate(z) → { r, dr, d2r }` (radius [m], dr/dz [-], d²r/dz² [1/m]).
 * All presets are C² (continuous curvature) so that surface curvatures K, H and κₙ are continuous —
 * this matters because the physics (normal pressure p = Tκₙ, slip ratio κ_g/κₙ) is curvature-based.
 *
 * Presets
 *  - cylinder   : r = R.
 *  - cone       : linear r from r0 (z = 0) to r1 (z = length).
 *  - taper      : cylinder r0 → C² smootherstep transition on [zStart, zEnd] → cylinder r1.
 *  - bulge      : r = R + A·(1 − x²)³ for |x| < 1, x = (z − center)/halfWidth (C² bump, K > 0 on top).
 *  - hourglass  : r = R − D·(1 − x²)³ (a waist: K < 0 in the middle, yarns may bridge there).
 *  - custom     : natural cubic spline through user control points (z_i, r_i), with z_0 = 0 and
 *                 z_last = length (edited in the profile editor).
 *
 * Limitations (documented in docs/THEORY.md): a profile is a graph r(z), so closed domes/poles
 * (r → 0) cannot be represented; r must stay ≥ rMin > 0.
 */

import { naturalCubicSpline, smootherstep } from "./numeric.js";

/**
 * @typedef {Object} ProfileSpec
 * @property {"cylinder"|"cone"|"taper"|"bulge"|"hourglass"|"custom"} kind
 * @property {number} length          mandrel length [m]
 * @property {number} [radius]        base radius R [m] (cylinder, bulge, hourglass)
 * @property {number} [r0]            radius at the leading side [m] (cone, taper)
 * @property {number} [r1]            radius at the trailing side [m] (cone, taper)
 * @property {number} [zStart]        taper transition start [m]
 * @property {number} [zEnd]          taper transition end [m]
 * @property {number} [amplitude]     bulge height A [m]
 * @property {number} [depth]         hourglass waist depth D [m]
 * @property {number} [center]        bulge/waist centre [m]
 * @property {number} [halfWidth]     bulge/waist half width [m]
 * @property {Array<[number, number]>} [points]  custom control points [[z, r], ...] [m]
 */

/**
 * @typedef {Object} Profile
 * @property {string} kind
 * @property {number} length                                     [m]
 * @property {(z:number)=>{r:number, dr:number, d2r:number}} evaluate
 * @property {number} rMax    maximum radius over [0, length] (sampled) [m]
 * @property {number} rMin    minimum radius over [0, length] (sampled) [m]
 * @property {ProfileSpec} spec  a copy of the spec used to build the profile
 */

/**
 * C² bump b(x) = (1 − x²)³ on |x| < 1 (zero outside) with derivatives w.r.t. x.
 * b, b', b'' vanish at x = ±1, so the bump joins the base cylinder with continuous curvature.
 */
function bump(x) {
  if (x <= -1 || x >= 1) return { b: 0, db: 0, d2b: 0 };
  const u = 1 - x * x;
  return { b: u * u * u, db: -6 * x * u * u, d2b: u * (30 * x * x - 6) };
}

/**
 * Builds a Profile from a spec. Throws on invalid input (non-positive radii / lengths etc.).
 * @param {ProfileSpec} spec
 * @returns {Profile}
 */
export function makeProfile(spec) {
  const L = spec.length;
  if (!(L > 0)) throw new Error("profile: length must be > 0");
  /** @type {(z:number)=>{r:number, dr:number, d2r:number}} */
  let evaluate;

  switch (spec.kind) {
    case "cylinder": {
      const R = spec.radius;
      evaluate = () => ({ r: R, dr: 0, d2r: 0 });
      break;
    }
    case "cone": {
      const { r0, r1 } = spec;
      const k = (r1 - r0) / L;
      evaluate = (z) => ({ r: r0 + k * z, dr: k, d2r: 0 });
      break;
    }
    case "taper": {
      const { r0, r1, zStart, zEnd } = spec;
      if (!(zEnd > zStart)) throw new Error("taper: zEnd must exceed zStart");
      const w = zEnd - zStart;
      evaluate = (z) => {
        const s = smootherstep((z - zStart) / w);
        return {
          r: r0 + (r1 - r0) * s.s,
          dr: (r1 - r0) * s.ds / w,
          d2r: (r1 - r0) * s.d2s / (w * w),
        };
      };
      break;
    }
    case "bulge":
    case "hourglass": {
      const R = spec.radius;
      const A = spec.kind === "bulge" ? spec.amplitude : -spec.depth;
      const { center, halfWidth: hw } = spec;
      if (!(hw > 0)) throw new Error(`${spec.kind}: halfWidth must be > 0`);
      evaluate = (z) => {
        const e = bump((z - center) / hw);
        return { r: R + A * e.b, dr: A * e.db / hw, d2r: A * e.d2b / (hw * hw) };
      };
      break;
    }
    case "custom": {
      const pts = spec.points;
      if (!pts || pts.length < 2) throw new Error("custom: need at least 2 control points");
      const sp = naturalCubicSpline(pts.map((p) => p[0]), pts.map((p) => p[1]));
      evaluate = (z) => {
        const e = sp.evaluate(z);
        return { r: e.y, dr: e.dy, d2r: e.d2y };
      };
      break;
    }
    default:
      throw new Error(`profile: unknown kind "${spec.kind}"`);
  }

  // Sample extremes once (used for ring-clearance checks and camera framing).
  let rMin = Infinity, rMax = -Infinity;
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const r = evaluate((i / n) * L).r;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }
  return { kind: spec.kind, length: L, evaluate, rMin, rMax, spec: structuredClone(spec) };
}

/**
 * Checks a profile for physical/numerical admissibility on a dense grid.
 * Natural splines can overshoot between knots, so this must be run for custom profiles.
 *
 * @param {Profile} profile
 * @param {{rMin?:number, maxSlope?:number, samples?:number}} [limits]
 *   rMin: smallest admissible radius [m] (default 2 mm); maxSlope: max |dr/dz| (default 3).
 * @returns {{ok:boolean, minRadius:number, maxRadius:number, maxAbsSlope:number, messages:string[]}}
 */
export function validateProfile(profile, limits = {}) {
  const rMinAllowed = limits.rMin ?? 0.002;
  const maxSlope = limits.maxSlope ?? 3;
  const n = limits.samples ?? 2000;
  let minRadius = Infinity, maxRadius = -Infinity, maxAbsSlope = 0;
  for (let i = 0; i <= n; i++) {
    const e = profile.evaluate((i / n) * profile.length);
    minRadius = Math.min(minRadius, e.r);
    maxRadius = Math.max(maxRadius, e.r);
    maxAbsSlope = Math.max(maxAbsSlope, Math.abs(e.dr));
  }
  const messages = [];
  if (minRadius < rMinAllowed) {
    messages.push(
      `Radius drops to ${(minRadius * 1e3).toFixed(1)} mm (< ${
        (rMinAllowed * 1e3).toFixed(1)
      } mm).`,
    );
  }
  if (maxAbsSlope > maxSlope) {
    messages.push(`Profile slope |dr/dz| reaches ${maxAbsSlope.toFixed(2)} (> ${maxSlope}).`);
  }
  return { ok: messages.length === 0, minRadius, maxRadius, maxAbsSlope, messages };
}

/**
 * Default control points for the custom profile (a gentle double-bulb on a 0.6 m mandrel).
 * @returns {Array<[number, number]>}
 */
export function defaultCustomPoints() {
  return [
    [0.0, 0.035],
    [0.1, 0.035],
    [0.2, 0.05],
    [0.3, 0.04],
    [0.4, 0.055],
    [0.5, 0.04],
    [0.6, 0.04],
  ];
}
