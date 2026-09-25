/**
 * @file surface.js — differential geometry of the mandrel, a surface of revolution.
 *
 * ── CONVENTIONS (identical block in docs/THEORY.md) ─────────────────────────────────────────────
 *  Mandrel frame: axis z_M (measured from the leading end), parameters (z, θ):
 *      S(z, θ) = ( r(z) cos θ, r(z) sin θ, z )
 *      S_z = ( r' cos θ, r' sin θ, 1 ),   S_θ = ( −r sin θ, r cos θ, 0 )
 *  Outward unit normal:  n = (S_θ × S_z)/|S_θ × S_z| = ( cos θ, sin θ, −r' ) / √(1 + r'²)
 *      (so the parameter pair (z, θ) is LEFT-handed with respect to n).
 *  First fundamental form:   g_zz = 1 + r'²,  g_zθ = 0,  g_θθ = r².
 *  Second fundamental form (w.r.t. outward n, II = S_ij · n):
 *      ii_zz = r'' / √(1 + r'²),  ii_zθ = 0,  ii_θθ = −r / √(1 + r'²).
 *  Curvatures are reported CONVEX-POSITIVE (a convex body has positive curvatures):
 *      κₙ(t) = −II(t, t) / I(t, t)                       normal curvature in tangent direction t
 *      k_m = −r'' / (1 + r'²)^{3/2}                      meridian principal curvature
 *      k_p = 1 / ( r √(1 + r'²) )                        parallel principal curvature
 *      K = k_m k_p = −r'' / ( r (1 + r'²)² ),  H = (k_m + k_p) / 2
 *  Euler: κₙ(ψ) = k_m cos²ψ + k_p sin²ψ, ψ = angle between t and the meridian.
 *  Braid angle α: signed angle in the tangent plane from the meridian direction m = S_z/|S_z|
 *  towards the parallel direction e = S_θ/|S_θ|;  α = atan2(t·e, t·m).
 *  Darboux frame of a curve on the surface: (t, n, b) with b = n × t; geodesic curvature
 *  κ_g = t' · b, and t' = κ_g b − κₙ n (convex-positive κₙ).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Code naming: g_zz, g_tt (first form), ii_zz, ii_tt (second form) — deliberately NOT E, F, G, L,
 * M, N, which clash with the guide point G, free length L and carrier count N used elsewhere.
 */

import { cross, dot, normalize } from "./vec.js";

/**
 * @typedef {import("./vec.js").Vec3} Vec3
 * @typedef {import("./profiles.js").Profile} Profile
 */

/**
 * @typedef {Object} SurfaceFrame  Local geometry at S(z, θ).
 * @property {number} z
 * @property {number} th     θ (may be unwrapped, i.e. outside (−π, π])
 * @property {number} r      radius [m]
 * @property {number} dr     r'
 * @property {number} d2r    r'' [1/m]
 * @property {Vec3} p        position S(z, θ) [m]
 * @property {Vec3} Sz       ∂S/∂z
 * @property {Vec3} St       ∂S/∂θ [m]
 * @property {Vec3} n        outward unit normal
 * @property {Vec3} m        unit meridian direction (increasing z)
 * @property {Vec3} e        unit parallel direction (increasing θ)
 * @property {number} g_zz   1 + r'²
 * @property {number} g_tt   r² [m²]
 * @property {number} ii_zz  r''/√(1+r'²) [1/m]
 * @property {number} ii_tt  −r/√(1+r'²) [m]
 */

export class SurfaceOfRevolution {
  /** @param {Profile} profile */
  constructor(profile) {
    this.profile = profile;
    this.length = profile.length;
  }

  /** Position S(z, θ) [m]. @param {number} z @param {number} th @returns {Vec3} */
  point(z, th) {
    const r = this.profile.evaluate(z).r;
    return [r * Math.cos(th), r * Math.sin(th), z];
  }

  /**
   * Full local frame and fundamental forms at (z, θ).
   * @param {number} z @param {number} th @returns {SurfaceFrame}
   */
  frame(z, th) {
    const { r, dr, d2r } = this.profile.evaluate(z);
    const c = Math.cos(th), s = Math.sin(th);
    const q = Math.sqrt(1 + dr * dr);
    return {
      z,
      th,
      r,
      dr,
      d2r,
      p: [r * c, r * s, z],
      Sz: [dr * c, dr * s, 1],
      St: [-r * s, r * c, 0],
      n: [c / q, s / q, -dr / q],
      m: [dr * c / q, dr * s / q, 1 / q],
      e: [-s, c, 0],
      g_zz: 1 + dr * dr,
      g_tt: r * r,
      ii_zz: d2r / q,
      ii_tt: -r / q,
    };
  }

  /**
   * Convex-positive normal curvature κₙ = −II/I for the parameter direction (dz, dθ).
   * @param {SurfaceFrame} f @param {number} dz @param {number} dth @returns {number} [1/m]
   */
  normalCurvatureParam(f, dz, dth) {
    const I = f.g_zz * dz * dz + f.g_tt * dth * dth;
    const II = f.ii_zz * dz * dz + f.ii_tt * dth * dth;
    return -II / I;
  }

  /**
   * Convex-positive normal curvature in the direction of a tangent vector t (need not be unit).
   * @param {SurfaceFrame} f @param {Vec3} t @returns {number} [1/m]
   */
  normalCurvature(f, t) {
    const [dz, dth] = this.tangentToParam(f, t);
    return this.normalCurvatureParam(f, dz, dth);
  }

  /**
   * Principal curvatures and their invariants at axial position z (independent of θ).
   * @param {number} z
   * @returns {{k_m:number, k_p:number, K:number, H:number}} convex-positive [1/m], K [1/m²]
   */
  principal(z) {
    const { r, dr, d2r } = this.profile.evaluate(z);
    const q2 = 1 + dr * dr;
    const k_m = -d2r / (q2 * Math.sqrt(q2));
    const k_p = 1 / (r * Math.sqrt(q2));
    return { k_m, k_p, K: k_m * k_p, H: 0.5 * (k_m + k_p) };
  }

  /**
   * Parameter-space components (dz, dθ) of a tangent vector t = dz·S_z + dθ·S_θ.
   * Uses the orthogonality of S_z and S_θ (g_zθ = 0). Any normal component of t is ignored.
   * @param {SurfaceFrame} f @param {Vec3} t @returns {[number, number]}
   */
  tangentToParam(f, t) {
    return [dot(t, f.Sz) / f.g_zz, dot(t, f.St) / f.g_tt];
  }

  /**
   * Tangent vector dz·S_z + dθ·S_θ.
   * @param {SurfaceFrame} f @param {number} dz @param {number} dth @returns {Vec3}
   */
  paramToVector(f, dz, dth) {
    return [
      f.Sz[0] * dz + f.St[0] * dth,
      f.Sz[1] * dz + f.St[1] * dth,
      f.Sz[2] * dz + f.St[2] * dth,
    ];
  }

  /**
   * Signed braid angle α ∈ (−π, π] of tangent t, measured from the meridian towards the parallel.
   * @param {SurfaceFrame} f @param {Vec3} t @returns {number} [rad]
   */
  braidAngle(f, t) {
    return Math.atan2(dot(t, f.e), dot(t, f.m));
  }

  /**
   * Darboux frame (t, n, b = n × t) for a (not necessarily unit, not necessarily tangent) direction.
   * t is projected onto the tangent plane and normalised.
   * @param {SurfaceFrame} f @param {Vec3} dir @returns {{t:Vec3, n:Vec3, b:Vec3}}
   */
  darboux(f, dir) {
    const dn = dot(dir, f.n);
    const t = normalize([dir[0] - dn * f.n[0], dir[1] - dn * f.n[1], dir[2] - dn * f.n[2]]);
    return { t, n: f.n, b: cross(f.n, t) };
  }

  /**
   * Signed radial clearance of a mandrel-frame point x from the surface: ρ(x) − r(z_x).
   * Positive = outside the mandrel. Points beyond the mandrel's axial extent [0, length] cannot
   * touch it, so +Infinity is returned there.
   * @param {Vec3} x @returns {number} [m]
   */
  clearance(x) {
    if (x[2] < 0 || x[2] > this.length) return Infinity;
    return Math.hypot(x[0], x[1]) - this.profile.evaluate(x[2]).r;
  }

  /**
   * Radial projection of a mandrel-frame point onto the surface parameters.
   * θ is chosen in the branch closest to `thRef` (keeps unwrapped angles continuous).
   * @param {Vec3} x @param {number} [thRef=0] @returns {{z:number, th:number}}
   */
  projectRadially(x, thRef = 0) {
    const th0 = Math.atan2(x[1], x[0]);
    const k = Math.round((thRef - th0) / (2 * Math.PI));
    return { z: x[2], th: th0 + 2 * Math.PI * k };
  }
}
