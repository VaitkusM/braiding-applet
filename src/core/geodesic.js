/**
 * @file geodesic.js — geodesics on the mandrel (surface of revolution) and Clairaut's relation.
 *
 * A yarn under tension lying on a frictionless surface follows a geodesic (κ_g = 0). Braided yarns
 * generally do NOT (interlacing and friction hold non-geodesic paths), so the geodesic through the
 * current fell point is shown as a reference: the gap between the actual path and the geodesic is
 * exactly what friction has to sustain (|κ_g| ≤ μ κₙ).
 *
 * Geodesic equations in the (z, θ) chart, parametrised by arc length s (′ = d/ds):
 *     z″ + Γ^z_zz z′² + Γ^z_θθ θ′² = 0,     θ″ + 2 Γ^θ_zθ z′ θ′ = 0,
 *     Γ^z_zz = r′r″/(1 + r′²),   Γ^z_θθ = −r r′/(1 + r′²),   Γ^θ_zθ = r′/r.
 * Unit speed: (1 + r′²) z′² + r² θ′² = 1.
 * Clairaut's relation (first integral): r² θ′ = r sin α = const, α measured from the meridian.
 */

import { rk4Step } from "./numeric.js";

/**
 * @typedef {import("./profiles.js").Profile} Profile
 * @typedef {{z:number[], th:number[], alpha:number[], s:number[], clairaut:number[]}} GeodesicPath
 */

/**
 * Right-hand side of the geodesic ODE, state y = [z, θ, z′, θ′].
 * @param {Profile} profile
 * @returns {(s:number, y:number[])=>number[]}
 */
export function geodesicRhs(profile) {
  return (_s, y) => {
    const [z, , dz, dth] = y;
    const { r, dr, d2r } = profile.evaluate(z);
    const q = 1 + dr * dr;
    return [
      dz,
      dth,
      -(dr * d2r / q) * dz * dz + (r * dr / q) * dth * dth,
      -2 * (dr / r) * dz * dth,
    ];
  };
}

/**
 * Integrates the geodesic starting at (z0, θ0) with initial braid angle α0 (from the meridian,
 * positive towards increasing θ) using fixed-step RK4 in arc length.
 * Integration stops when z leaves [zMin, zMax] or after `maxLength` of arc length.
 *
 * @param {Profile} profile
 * @param {{z0:number, th0:number, alpha0:number, ds?:number, maxLength?:number,
 *          zMin?:number, zMax?:number}} opts  lengths in [m], angles in [rad]
 * @returns {GeodesicPath}
 */
export function integrateGeodesic(profile, opts) {
  const ds = opts.ds ?? 1e-3;
  const maxLength = opts.maxLength ?? 2;
  const zMin = opts.zMin ?? 0, zMax = opts.zMax ?? profile.length;
  const f = geodesicRhs(profile);

  const e0 = profile.evaluate(opts.z0);
  let y = [
    opts.z0,
    opts.th0,
    Math.cos(opts.alpha0) / Math.sqrt(1 + e0.dr * e0.dr),
    Math.sin(opts.alpha0) / e0.r,
  ];
  /** @type {GeodesicPath} */
  const out = { z: [], th: [], alpha: [], s: [], clairaut: [] };
  const push = (s, y) => {
    const { r, dr } = profile.evaluate(y[0]);
    out.z.push(y[0]);
    out.th.push(y[1]);
    out.alpha.push(Math.atan2(r * y[3], Math.sqrt(1 + dr * dr) * y[2]));
    out.s.push(s);
    out.clairaut.push(r * r * y[3]);
  };
  push(0, y);
  const n = Math.ceil(maxLength / ds);
  for (let i = 1; i <= n; i++) {
    const yn = rk4Step(f, (i - 1) * ds, y, ds);
    if (yn[0] < zMin || yn[0] > zMax || !Number.isFinite(yn[0])) break;
    y = yn;
    push(i * ds, y);
  }
  return out;
}

/**
 * Braid angle a geodesic with Clairaut constant c = r sin α must have at axial position z:
 * α_geo(z) = asin(c / r(z)). Returns NaN beyond a turning point (|c| > r), where the geodesic
 * cannot reach.
 * @param {Profile} profile @param {number} c [m] @param {number} z [m] @returns {number} [rad]
 */
export function clairautAlpha(profile, c, z) {
  const r = profile.evaluate(z).r;
  return Math.abs(c) <= r ? Math.asin(c / r) : NaN;
}
